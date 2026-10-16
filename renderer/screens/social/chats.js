import React from 'react'
import {
  conversationKey,
  conversations as listConversations,
  emptyChatStore,
  findPublicKey,
  readNewMessages,
  unreadCount,
} from './messages'
import {nodeMessages} from './node'
import {visibleConversations} from './hiding'
import {callHeightsOf} from './scan'
import {loadChatStore, saveChatStore} from './storage'

/**
 * The private messages of the node's account `me`, as the phone app's SocialChats: the scan keeps every sendMessage
 * call still encrypted (cache.messages); each new one is tried once with the node's key (social_decrypt), and those
 * for the account are kept on this computer, per account, with how far each conversation was read. Nothing is tried
 * while the node is not `ready`. `people` sets which conversations wait in Requests; those with an account of
 * `blocked` are not shown.
 */
export function useChats({me, cache, ready, people, blocked = new Set()}) {
  const [store, setStore] = React.useState(emptyChatStore)
  const [account, setAccount] = React.useState(null)
  const storeRef = React.useRef(store)
  const busyRef = React.useRef(false)
  // By address: its public key once looked up, '' when it has none; absent until then.
  const [messageKeys, setMessageKeys] = React.useState({})

  const save = React.useCallback((address, next) => {
    storeRef.current = next
    setStore(next)
    saveChatStore(address, next).catch((error) =>
      global.logger?.error('Cannot save the messages', error?.message)
    )
  }, [])

  // Another account's messages are not shown.
  React.useEffect(() => {
    if (!me) return undefined
    let alive = true
    setAccount(null)
    loadChatStore(me)
      .catch(() => emptyChatStore())
      .then((saved) => {
        if (!alive) return
        storeRef.current = saved
        setStore(saved)
        setAccount(me)
      })
    return () => {
      alive = false
    }
  }, [me])

  const calls = cache?.messages
  React.useEffect(() => {
    if (!ready || !account || account !== me || !calls?.length) return
    if (busyRef.current) return
    busyRef.current = true
    readNewMessages(storeRef.current, calls, me, nodeMessages().decrypt)
      .then((next) => {
        if (next !== storeRef.current && account === me) save(me, next)
      })
      // A node that does not answer, or without social_decrypt: tried again with the next scan step.
      .catch(() => {})
      .finally(() => {
        busyRef.current = false
      })
  }, [account, calls, me, ready, save])

  // An address without a key may have signed a call since: looked up again when asked.
  const scannedKeys = cache?.keys
  React.useEffect(() => {
    setMessageKeys((current) =>
      Object.values(current).includes('')
        ? Object.fromEntries(
            Object.entries(current).filter(([, key]) => key !== '')
          )
        : current
    )
  }, [scannedKeys])

  const conversations = React.useMemo(
    () =>
      me
        ? visibleConversations(
            listConversations(store.messages, me, people),
            blocked
          )
        : [],
    [blocked, me, people, store.messages]
  )

  const unreadConversations = React.useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          !conversation.isRequest &&
          unreadCount(conversation, me, store.seen[conversation.key]) > 0
      ).length,
    [conversations, me, store.seen]
  )

  const markChatSeen = React.useCallback(
    (conversation) => {
      if (!me || account !== me) return
      const {height, index} = conversation.last
      const seen = storeRef.current.seen[conversation.key]
      if (seen && seen[0] === height && seen[1] === index) return
      save(me, {
        ...storeRef.current,
        seen: {...storeRef.current.seen, [conversation.key]: [height, index]},
      })
    },
    [account, me, save]
  )

  const lookUpKeys = React.useCallback(
    async (addresses) => {
      const node = nodeMessages()
      const todo = [...new Set(addresses.map((a) => a.toLowerCase()))].filter(
        (address) => messageKeys[address] === undefined
      )
      for (const address of todo) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const key = await findPublicKey(address, {
            identityKey: node.identityKey,
            scannedKeys: cache?.keys || {},
            callHeights: cache ? callHeightsOf(cache, address) : [],
            keysAt: node.keysAt,
          })
          setMessageKeys((current) => ({...current, [address]: key || ''}))
        } catch {
          // A node that does not answer leaves it unknown.
        }
      }
    },
    [cache, messageKeys]
  )

  const chatKey = React.useCallback(
    (others) => conversationKey([...others, me]),
    [me]
  )

  return React.useMemo(
    () => ({
      chatStore: store,
      conversations,
      unreadConversations,
      markChatSeen,
      messageKeys,
      lookUpKeys,
      chatKey,
    }),
    [
      chatKey,
      conversations,
      lookUpKeys,
      markChatSeen,
      messageKeys,
      store,
      unreadConversations,
    ]
  )
}
