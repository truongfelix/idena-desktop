import * as React from 'react'
import {assign, createMachine} from 'xstate'
import {useMachine} from '@xstate/react'
import {log} from 'xstate/lib/actions'
import {eitherState, skipSSR} from '../../shared/utils/utils'
import {useAutoUpdateState} from '../../shared/providers/update-context'
import {requestDb, subDb} from '../../shared/utils/db'
import {isHardForkUpdate} from '../../shared/utils/node'

function createVotingStatusDb(version) {
  const db = subDb(requestDb(), 'updates')
  const key = `hardForkVoting!!${version}`

  return {
    async get() {
      try {
        return await db.get(key)
      } catch (error) {
        if (error.notFound) return null
        throw error
      }
    },
    set(status) {
      return db.put(key, status)
    },
  }
}

const HardforkVotingStatus = {
  Approve: 'approve',
  Reject: 'reject',
  Unknown: 'unknown',
}

export function useHardFork() {
  const {nodeCurrentVersion, nodeRemoteVersion, nodeRemoteHardFork} =
    useAutoUpdateState()

  // Declared by our own node release (main/hard-fork-info.js), no third-party service.
  const hardFork = isHardForkUpdate(
    nodeCurrentVersion,
    nodeRemoteVersion,
    nodeRemoteHardFork
  )
    ? nodeRemoteHardFork
    : null

  const statusDb = React.useMemo(
    () => skipSSR(() => createVotingStatusDb(nodeRemoteVersion)),
    [nodeRemoteVersion]
  )

  const [current, send] = useMachine(
    createMachine(
      {
        context: {
          changes: [],
          didActivate: undefined,
          startActivationDate: undefined,
          endActivationDate: undefined,
          votingStatus: HardforkVotingStatus.Unknown,
          isReady: false,
          isAvailable: false,
        },
        initial: 'idle',
        states: {
          idle: {
            on: {FETCH: 'fetching'},
          },
          fetching: {
            invoke: {
              src: async (_, {hardFork: declared}) => ({
                changes: declared.changes,
                didActivate: declared.activated,
                startActivationDate: declared.startActivationDate,
                endActivationDate: declared.endActivationDate,
                votingStatus: await statusDb.get(),
              }),
              onDone: {
                target: 'fetched',
                actions: [
                  assign((context, {data}) => ({
                    ...context,
                    ...data,
                  })),
                  log(),
                ],
              },
              onError: 'failed',
            },
          },
          fetched: {
            entry: [assign({isReady: true})],
            on: {
              FETCH: 'fetching',
              REJECT: {
                actions: [
                  assign({votingStatus: HardforkVotingStatus.Reject}),
                  'persist',
                ],
              },
              RESET: {
                actions: [
                  assign({votingStatus: HardforkVotingStatus.Unknown}),
                  'persist',
                ],
              },
            },
          },
          failed: {entry: [log()], on: {FETCH: 'fetching'}},
        },
      },
      {
        actions: {
          // eslint-disable-next-line no-shadow
          persist: ({votingStatus}) => statusDb.set(votingStatus),
        },
      }
    )
  )

  React.useEffect(() => {
    if (hardFork) {
      send('FETCH', {hardFork})
    }
  }, [hardFork, send])

  const {
    changes,
    startActivationDate,
    endActivationDate,
    didActivate,
    votingStatus,
  } = current.context

  return [
    {
      details: {
        changes,
        startActivationDate,
        endActivationDate,
      },
      votingStatus,
      isAvailable: Boolean(hardFork) && eitherState(current, 'fetched'),
      didActivate,
      didReject: current.context.votingStatus === HardforkVotingStatus.Reject,
    },
    {
      reject: () => send('REJECT'),
      reset: () => send('RESET'),
    },
  ]
}
