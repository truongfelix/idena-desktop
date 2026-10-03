import * as React from 'react'
import {useMachine} from '@xstate/react'
import {Machine} from 'xstate'
import {assign, log} from 'xstate/lib/actions'
import {useIdentityState} from './identity-context'
import {useEpochState} from './epoch-context'
import {fetchLastOpenVotings} from '../../screens/oracles/utils'
import {requestDb, subDb} from '../utils/db'
import {IdentityStatus} from '../types'

const VotingNotificationStateContext = React.createContext()
const VotingNotificationDispatchContext = React.createContext()

// How often the count of new oracle votings is read (api.idena.io, sent with the address): it was every 10 s.
export const VOTING_NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000

/** Whether an identity in `state` can sit on an oracle committee (validated): only then is the count read. */
export function canBeOracle(state) {
  return [
    IdentityStatus.Newbie,
    IdentityStatus.Verified,
    IdentityStatus.Human,
    IdentityStatus.Suspended,
    IdentityStatus.Zombie,
  ].includes(state)
}

/**
 * The To-Do count of new oracle votings: read once started, then every VOTING_NOTIFICATION_INTERVAL_MS; a failed
 * read waits for the next one (it stopped the count for the session).
 */
export function createVotingNotificationMachine({fetchUnreadCount}) {
  return Machine(
    {
      context: {
        todoCount: 0,
      },
      initial: 'waiting',
      states: {
        waiting: {
          on: {
            START: {
              target: 'ready',
              actions: ['setStartParams'],
            },
          },
        },
        ready: {
          initial: 'fetch',
          states: {
            fetch: {
              invoke: {
                src: 'fetchUnreadCount',
                onDone: {
                  target: 'idle',
                  actions: ['applyTodoCount', log()],
                },
                onError: 'idle',
              },
            },
            idle: {
              after: {
                [VOTING_NOTIFICATION_INTERVAL_MS]: 'fetch',
              },
            },
          },
          on: {
            RESET: '.fetch',
            STOP: 'waiting',
          },
        },
      },
    },
    {
      services: {fetchUnreadCount},
      actions: {
        // eslint-disable-next-line no-shadow
        setStartParams: assign((context, {epoch, address}) => ({
          ...context,
          epoch,
          address,
        })),
        applyTodoCount: assign({
          todoCount: (_, {data}) => data.length,
        }),
      },
    }
  )
}

// eslint-disable-next-line no-shadow
async function readUnreadVotings({address}) {
  const lastVotings = (await fetchLastOpenVotings({oracle: address})) ?? []

  const votingDb = subDb(requestDb(), 'votings')

  const lastVotingTimestamp = await (async () => {
    try {
      return await votingDb.get('lastVotingTimestamp')
    } catch (error) {
      if (error.notFound) {
        return new Date(0)
      }
    }
  })()

  return lastVotings.filter(
    ({createTime}) => new Date(createTime) > new Date(lastVotingTimestamp)
  )
}

export function VotingNotificationProvider(props) {
  const {address, state} = useIdentityState()
  const {epoch} = useEpochState() ?? {epoch: -1}

  const [current, send] = useMachine(() =>
    createVotingNotificationMachine({fetchUnreadCount: readUnreadVotings})
  )

  React.useEffect(() => {
    if (epoch && address && canBeOracle(state)) {
      send('START', {epoch, address})
    } else {
      send('STOP')
    }
  }, [address, epoch, send, state])

  return (
    <VotingNotificationStateContext.Provider value={current.context}>
      <VotingNotificationDispatchContext.Provider
        value={React.useMemo(
          () => ({
            resetLastVotingTimestamp() {
              send('RESET')
            },
          }),
          [send]
        )}
        {...props}
      />
    </VotingNotificationStateContext.Provider>
  )
}

export function useVotingNotificationState() {
  const context = React.useContext(VotingNotificationStateContext)
  if (context === undefined) {
    throw new Error(
      'useVotingNotificationState must be used within a VotingNotificationProvider'
    )
  }
  return context
}

export function useVotingNotificationDispatch() {
  const context = React.useContext(VotingNotificationDispatchContext)
  if (context === undefined) {
    throw new Error(
      'useVotingNotificationDispatch must be used within a VotingNotificationDispatchContext'
    )
  }
  return context
}

export function useVotingNotification() {
  return [useVotingNotificationState(), useVotingNotificationDispatch()]
}
