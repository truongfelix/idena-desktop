import React from 'react'
import {
  conversationKey,
  conversations as listConversations,
  emptyChatStore,
  findPublicKey,
  keysToAsk,
  readNewMessages,
  unreadCount,
} from './messages'
import {messageCodeFor} from './message-code'
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
  const messageKeysRef = React.useRef(messageKeys)
  messageKeysRef.current = messageKeys
  // The addresses whose key is being looked up: each is asked once at a time, however often the views ask.
  const askingRef = React.useRef(new Set())

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
  const cacheHigh = cache?.high ?? 0
  // The last block whose calls were read (readThrough), and the scan's last one now.
  const readThroughRef = React.useRef(0)
  const cacheHighRef = React.useRef(cacheHigh)
  cacheHighRef.current = cacheHigh
  // A read that ended behind the scan reads again at once, not with the next block.
  const [again, setAgain] = React.useState(0)
  React.useEffect(() => {
    if (!ready || !account || account !== me) return
    if (busyRef.current) return
    if (!calls?.length) {
      readThroughRef.current = cacheHigh
      return
    }
    busyRef.current = true
    readNewMessages(storeRef.current, calls, me, nodeMessages().decrypt)
      .then((next) => {
        if (next !== storeRef.current && account === me) save(me, next)
        readThroughRef.current = Math.max(readThroughRef.current, cacheHigh)
      })
      // A node that does not answer, or without social_decrypt: tried again with the next scan step.
      .catch(() => {})
      .finally(() => {
        busyRef.current = false
        if (cacheHighRef.current > cacheHigh) setAgain((n) => n + 1)
      })
    // `again` asks for one more read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, calls, cacheHigh, me, ready, save, again])

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
            listConversations(
              store.messages,
              me,
              people,
              store.groupKeys,
              store.groupMessages
            ),
            blocked
          )
        : [],
    [blocked, me, people, store.messages, store.groupKeys, store.groupMessages]
  )

  const conversationsRef = React.useRef(conversations)
  conversationsRef.current = conversations

  // How far the messages are read (a block height), and a conversation as it stands now.
  const readThrough = React.useCallback(() => readThroughRef.current, [])
  const latestConversation = React.useCallback(
    (key) => conversationsRef.current.find((one) => one.key === key) ?? null,
    []
  )

  const unreadConversations = React.useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          !conversation.isRequest &&
          unreadCount(
            conversation,
            me,
            store.seen[conversation.key],
            store.readBefore
          ) > 0
      ).length,
    [conversations, me, store.seen, store.readBefore]
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
      const asking = askingRef.current
      const todo = keysToAsk(addresses, messageKeysRef.current, asking)
      todo.forEach((address) => asking.add(address))
      for (const address of todo) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const key = await findPublicKey(address, {
            identityKey: node.identityKey,
            scannedKeys: cache?.keys || {},
            callHeights: cache ? callHeightsOf(cache, address) : [],
            keysAt: node.keysAt,
            sharedKeys: storeRef.current.sharedKeys,
          })
          setMessageKeys((current) => ({...current, [address]: key || ''}))
        } catch {
          // A node that does not answer leaves it unknown.
        } finally {
          asking.delete(address)
        }
      }
    },
    [cache]
  )

  // Keeps the key of a message code `text` for `address` once checked against it (messageCodeFor): it can be
  // written to from now on, before it signed anything. False for a code of another account.
  const addMessageCode = React.useCallback(
    (address, text) => {
      const lower = String(address).toLowerCase()
      const key = messageCodeFor(text, lower)
      if (!key || !me || account !== me) return false
      if (storeRef.current.sharedKeys?.[lower] !== key)
        save(me, {
          ...storeRef.current,
          sharedKeys: {...storeRef.current.sharedKeys, [lower]: key},
        })
      setMessageKeys((current) => ({...current, [lower]: key}))
      return true
    },
    [account, me, save]
  )

  const chatKey = React.useCallback(
    (others) => conversationKey([...others, me]),
    [me]
  )

  return React.useMemo(
    () => ({
      chatStore: store,
      // Whether the account's saved messages are loaded (before, its groups and message codes are not known yet).
      chatsLoaded: Boolean(me) && account === me,
      conversations,
      unreadConversations,
      markChatSeen,
      messageKeys,
      lookUpKeys,
      addMessageCode,
      chatKey,
      readThrough,
      latestConversation,
    }),
    [
      account,
      addMessageCode,
      chatKey,
      conversations,
      latestConversation,
      lookUpKeys,
      markChatSeen,
      me,
      messageKeys,
      readThrough,
      store,
      unreadConversations,
    ]
  )
}
