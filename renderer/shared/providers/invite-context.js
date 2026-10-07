/* eslint-disable react/prop-types */
import React, {useCallback, useMemo} from 'react'
import {useInterval} from '../hooks/use-interval'
import {HASH_IN_MEMPOOL, callRpc} from '../utils/utils'
import {useIdentityState} from './identity-context'
import {IdentityStatus} from '../types'
import {fetchIdentity, killInvitee, sendInvite} from '../api/dna'
import {useFailToast} from '../hooks/use-toast'
import {strip} from '../utils/obj'
import {
  checkMining,
  checkTerminations,
  loadInvites,
  savedContacts,
} from '../../screens/contacts/utils'

const db = global.invitesDb || {}

const InviteStateContext = React.createContext()
const InviteDispatchContext = React.createContext()

export function InviteProvider({children}) {
  // The saved contacts show at once; what the node knows about them follows (loadInvites).
  const [invites, setInvites] = React.useState(() =>
    savedContacts(db.getInvites())
  )
  const [activationTx, setActivationTx] = React.useState()

  const {address, invitees} = useIdentityState()

  React.useEffect(() => {
    let ignore = false

    loadInvites(db.getInvites(), invitees, {
      callRpc,
      fetchIdentity,
      saveInvite: (id, invite) => db.updateInvite(id, invite),
    })
      .then((nextInvites) => {
        if (!ignore) {
          setInvites(nextInvites)
        }
      })
      .catch((e) => {
        global.logger.error(
          'An error occured while fetching identity',
          e.message
        )
      })

    setActivationTx(db.getActivationTx())

    return () => {
      ignore = true
    }
  }, [invitees])

  const failToast = useFailToast()

  useInterval(
    async () => {
      function resetActivation() {
        setActivationTx('')
        db.clearActivationTx()
      }

      try {
        const {blockHash} = await callRpc('bcn_transaction', activationTx)
        if (blockHash !== HASH_IN_MEMPOOL) resetActivation()
      } catch (error) {
        resetActivation()
        failToast(error?.message ?? 'Activation failed. Tx no longer exists')
      }
    },
    activationTx ? 1000 * 10 : null
  )

  // One check after the other: each answers the whole list, so two checks side by side would undo each other's
  // changes.
  useInterval(
    async () => {
      const afterMining = (await checkMining(invites, {callRpc})) ?? invites
      const nextInvites =
        (await checkTerminations(afterMining, {callRpc})) ?? afterMining
      if (nextInvites !== invites) setInvites(nextInvites)
    },
    invites.some(({mining, terminating}) => mining || terminating)
      ? 1000 * 10
      : null
  )

  const addInvite = useCallback(
    async (to, amount, firstName = '', lastName = '') => {
      const {result, error} = await sendInvite({to, amount})
      if (result) {
        const issuedInvite = {
          amount,
          firstName,
          lastName,
          ...result,
          activated: false,
          canKill: true,
        }

        const id = db.addInvite(issuedInvite)
        const invite = {...issuedInvite, id, mining: true}
        setInvites([...invites, invite])

        return invite
      }
      throw new Error(error.message)
    },
    [invites]
  )

  const updateInvite = useCallback(
    async (id, firstName, lastName) => {
      const key = id
      const newFirstName = firstName || ''
      const newLastName = lastName || ''

      setInvites(
        invites.map((inv) => {
          if (inv.id === id) {
            return {
              ...inv,
              firstName: newFirstName,
              lastName: newLastName,
            }
          }
          return inv
        })
      )

      const invite = {id: key, firstName: newFirstName, lastName: newLastName}
      db.updateInvite(id, invite)
    },
    [invites]
  )

  const deleteInvite = useCallback(
    async (id) => {
      const deletedAt = Date.now()
      setInvites(
        invites.map((currentInvite) =>
          currentInvite.id === id
            ? {...currentInvite, deletedAt}
            : currentInvite
        )
      )
      db.updateInvite(id, {id, deletedAt})
    },
    [invites]
  )

  const killInvite = useCallback(
    async (id, from, to) => {
      const {result, error} = await killInvitee(from, to)

      if (result) {
        setInvites(
          // eslint-disable-next-line no-shadow
          invites.map((invite) =>
            invite.id === id
              ? {
                  ...invite,
                  terminateHash: result,
                  terminating: true,
                  state: IdentityStatus.Terminating,
                  canKill: false,
                }
              : invite
          )
        )
        const invite = {id, terminateHash: result, terminatedAt: Date.now()}
        db.updateInvite(id, invite)
      }

      return {result, error}
    },
    [invites]
  )

  const recoverInvite = useCallback(
    async (id) => {
      const key = id

      setInvites(
        invites.map((inv) => {
          if (inv.id === id) {
            return {
              ...inv,
              deletedAt: null,
            }
          }
          return inv
        })
      )
      const invite = {id: key, deletedAt: null}
      db.updateInvite(id, invite)
    },
    [invites]
  )

  const activateInvite = useCallback(
    async (code) => {
      const result = await callRpc(
        'dna_activateInvite',
        strip({to: address, key: code})
      )
      setActivationTx(result)
      db.setActivationTx(result)
    },
    [address]
  )

  return (
    <InviteStateContext.Provider
      value={useMemo(() => ({invites, activationTx}), [activationTx, invites])}
    >
      <InviteDispatchContext.Provider
        value={useMemo(
          () => ({
            addInvite,
            updateInvite,
            deleteInvite,
            recoverInvite,
            activateInvite,
            killInvite,
          }),
          [
            activateInvite,
            addInvite,
            deleteInvite,
            killInvite,
            recoverInvite,
            updateInvite,
          ]
        )}
      >
        {children}
      </InviteDispatchContext.Provider>
    </InviteStateContext.Provider>
  )
}

export function useInviteState() {
  const context = React.useContext(InviteStateContext)
  if (context === undefined) {
    throw new Error('useInviteState must be used within a InviteProvider')
  }
  return context
}

export function useInviteDispatch() {
  const context = React.useContext(InviteDispatchContext)
  if (context === undefined) {
    throw new Error('useInviteDispatch must be used within a InviteProvider')
  }
  return context
}

export function useInvite() {
  return [useInviteState(), useInviteDispatch()]
}
