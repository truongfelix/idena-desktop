import React from 'react'
import {useTranslation} from 'react-i18next'
import {LIKE, SocialCall, makePostArgument} from './contract'
import {keccak256Hex} from './keccak'
import {MESSAGE_AMOUNT, plainMessage, sendMessageArgument} from './messages'
import {topicChannel, typedTopic} from './topics'
import {socialRpc, socialRpcSettled} from './node'
import {
  callbackGas,
  keepStateGas,
  readProfiles,
  withAmount,
  withCallbackGas,
} from './profiles'
import {memberExtraFor} from './vouching'
import {
  prepareFile,
  estimateCall,
  prepareCall,
  prepareDraft as prepareDraftCall,
  sendPrepared,
  waitForBlock,
} from './posting'

/** How long a status stays: a refusal 2 minutes, "in a block" 30 seconds; the others until the next. */
const REFUSED_MS = 120 * 1000
const MINED_MS = 30 * 1000

/** What the editor writes: a post, a reply to a post, or a comment in a reply's discussion. */
export const DraftKind = {Post: 'post', Reply: 'reply', Comment: 'comment'}

/** The kind of draft that answers a target (PostTarget): a reply to a post, a comment otherwise. */
export function draftKindOf(target) {
  if (!target.level) return DraftKind.Post
  return target.level === 'post' ? DraftKind.Reply : DraftKind.Comment
}

/**
 * The target of the editor's draft: a new post goes in the topic typed (`topic`, blank for none). Throws when what
 * is typed is not a topic name.
 */
export function draftTarget(target, topic) {
  if (target.level || String(topic ?? '').trim() === '') return target
  const name = typedTopic(topic)
  if (name === null)
    throw new Error(
      `"${String(
        topic
      ).trim()}" is not a topic name (a-z, 0-9 and _, 3 to 21 characters)`
    )
  return {...target, channel: topicChannel(name)}
}

const recipientCount = (recipients) => Math.max(recipients.length, 1)

/**
 * The sent actions still waiting once the feed shows the blocks through `scannedThrough`: those not in a block yet
 * (`height` null) or in a later block, as the phone's SentList.
 */
export const stillWaiting = (waiting, scannedThrough) =>
  waiting.filter(({height}) => height === null || height > scannedThrough)

/**
 * Which action a profile call is, to tell the same one sent twice: its contract, method and argument, without the
 * callback gas the second dry run sizes (`_gas`, `_keepGas`), as the phone's.
 */
export const actionKey = ({contract = '', method, argument}) =>
  `${String(contract).toLowerCase()}:${method}:${String(argument ?? '')
    .replace(/,"_gas":\d+/, '')
    .replace(/,"_keepGas":\d+/, '')}`

/**
 * What the editor gets back when a draft it sent (`sent`: {text, image, textOnIpfs}) is dropped by the node or
 * refused by the contract: the draft, if the editor holds no text and no image (`editor`: {text, image}); null when
 * it holds something, which stays. The editor does not open: as after Cancel, the next draft starts from it.
 */
export const draftToPutBack = (sent, editor) =>
  sent && editor.text.trim() === '' && editor.image === null ? sent : null

/**
 * Writing to idena.social, as the phone app does (SocialModel): the editor's draft, the confirmation with the fees,
 * then the node signs and sends, and the app waits for the block and reads it. One action at a time (`busy`);
 * what was sent stays `waiting` until the feed shows its block, so a like is not sent twice and its pill stays off.
 * `readNewBlocks` asks the scan for the new blocks; the feed shows the blocks through `scannedThrough`.
 */
/** The kinds of action written to the profiles contract (prepareProfile). */
const PROFILE_KINDS = new Set([
  'name',
  'dropName',
  'profile',
  'trust',
  'untrust',
  'challenge',
  'vouch',
  'acceptVouch',
  'declineOffer',
  'cancelOffer',
  'endVouch',
])

/** The profile calls a vouched member pays for with an extra amount, burned (payIfVouched in the contract). */
const MEMBER_PAYS = new Set(['name', 'profile', 'trust', 'challenge'])

export function useSocialSending({
  ready,
  readNewBlocks,
  scannedThrough,
  onProfileChange,
}) {
  const {t} = useTranslation()
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState(null)
  const [confirm, setConfirm] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [draftText, setDraftText] = React.useState('')
  const [draftImage, setDraftImage] = React.useState(null)
  const [textOnIpfs, setTextOnIpfs] = React.useState(false)
  const [draftTopic, setDraftTopic] = React.useState('')
  const [waiting, setWaiting] = React.useState([])
  // The profile calls the node accepted, until their block (or a refusal, or the node dropping them): the same
  // action is not sent again meanwhile (the contract would refuse it in the block, its fee lost).
  const [inFlight, setInFlight] = React.useState([])
  // Counts the private messages sent: the conversation's box empties then.
  const [messagesSent, setMessagesSent] = React.useState(0)
  const storedRef = React.useRef(new Set())
  // The drafts sent from the editor, by transaction hash, until their block; what the editor holds now.
  const sentDraftsRef = React.useRef(new Map())
  const editorRef = React.useRef({text: '', image: null})
  React.useEffect(() => {
    editorRef.current = {text: draftText, image: draftImage}
  }, [draftText, draftImage])
  const aliveRef = React.useRef(true)
  React.useEffect(
    () => () => {
      aliveRef.current = false
    },
    []
  )

  const whatOf = React.useMemo(
    () => ({
      post: t('Post'),
      reply: t('Reply'),
      comment: t('Comment'),
      like: t('Like'),
      tip: t('Tip'),
      message: t('Message'),
      name: t('Name'),
      dropName: t('Drop the name'),
      profile: t('Profile'),
      trust: t('Trust'),
      untrust: t('Take your Trust back'),
      challenge: t('Challenge'),
      vouch: t('Vouch'),
      acceptVouch: t('Accept the vouch'),
      declineOffer: t('Decline the offer'),
      cancelOffer: t('Withdraw the offer'),
      endVouch: t('End the vouch'),
    }),
    [t]
  )

  const show = React.useCallback((text, {error = false, ms = null} = {}) => {
    const next = {text, error, id: Math.random()}
    setStatus(next)
    if (ms)
      setTimeout(
        () =>
          setStatus((current) => (current?.id === next.id ? null : current)),
        ms
      )
  }, [])

  const refused = React.useCallback(
    (kind, error) =>
      show(
        t('{{what}}: the node refused: {{message}}', {
          what: whatOf[kind],
          message: error?.message || String(error),
          nsSeparator: '|',
        }),
        {error: true, ms: REFUSED_MS}
      ),
    [show, t, whatOf]
  )

  // What the feed shows is no longer waiting.
  React.useEffect(() => {
    if (stillWaiting(waiting, scannedThrough).length < waiting.length)
      setWaiting((current) => stillWaiting(current, scannedThrough))
  }, [scannedThrough, waiting])

  const prepare = async (kind, make, extra = {}) => {
    setBusy(true)
    setStatus(null)
    try {
      const pending = await make()
      setConfirm({...pending, kind, ...extra})
    } catch (error) {
      refused(kind, error)
    } finally {
      setBusy(false)
    }
  }

  const prepareLike = (target, postId) =>
    prepare(
      'like',
      () =>
        prepareCall(socialRpc, SocialCall.post(makePostArgument(LIKE, target))),
      {likeOf: postId}
    )

  const prepareTip = (postId, amount, name) =>
    prepare(
      'tip',
      () => prepareCall(socialRpc, SocialCall.tip(postId, amount)),
      {
        detail: t('Tip {{amount}} iDNA to {{name}} for this post', {
          amount,
          name,
        }),
      }
    )

  /**
   * A private message `text` to `recipients` (lowercase, the account left out), with their public `keys` in the same
   * order (findPublicKey): the plain message in idena.social's format, encrypted by the node for the account and each
   * recipient (social_encrypt), then sendMessage with the website's 0.00002 iDNA.
   */
  const prepareMessage = (recipients, keys, text, encrypt) =>
    prepare(
      'message',
      async () => {
        const from = String(
          await socialRpc('dna_getCoinbaseAddr')
        ).toLowerCase()
        let others = recipients.filter((address) => address !== from)
        if (others.length === 0) others = [from]
        if (keys.length !== others.length)
          throw new Error('no public key for every person of the conversation')
        const plain = plainMessage(from, others, text)
        const parts = await encrypt(keys, plain)
        if (!Array.isArray(parts) || parts.length !== others.length + 1)
          throw new Error(
            `the node encrypted ${parts?.length} parts for ${
              others.length + 1
            } participants`
          )
        const socialCall = {
          method: 'sendMessage',
          argument: sendMessageArgument(parts, keccak256Hex(plain)),
          amount: MESSAGE_AMOUNT,
        }
        const fee = await estimateCall(socialRpc, from, socialCall)
        return {from, socialCall, fee, files: []}
      },
      {
        detail: t('A private message to {{count}} people', {
          count: recipientCount(recipients),
        }),
      }
    )

  /**
   * A call to the profiles contract (`kind`: name, dropName, profile, trust, untrust): `makeCall(picture)` gives it,
   * with the "ipfs://" reference of `image` (bytes) once its CID is known; the image is stored on IPFS first, with
   * its own fee, as a post's.
   */
  const prepareProfile = (kind, makeCall, {detail = null, image = null} = {}) =>
    prepare(
      kind,
      async () => {
        const from = await socialRpc('dna_getCoinbaseAddr')
        const files = image
          ? [
              await prepareFile(
                socialRpc,
                from,
                'image',
                image,
                storedRef.current
              ),
            ]
          : []
        let profileCall = makeCall(files[0] ? `ipfs://${files[0].cid}` : null)
        // A vouched member adds about one more call's fee, burned by the contract.
        let extra = null
        if (MEMBER_PAYS.has(kind)) {
          const mine = (await readProfiles(socialRpcSettled, [from]))[
            String(from).toLowerCase()
          ]
          extra = await memberExtraFor(socialRpc, socialRpcSettled, mine)
          if (extra) profileCall = withAmount(profileCall, extra.amount)
        }
        let estimate = await estimateCall(socialRpc, from, profileCall)
        // A second dry run with the callback's gas sized from the first: the max fee then reserves less.
        const gas = callbackGas(estimate.receipt)
        const keepGas = keepStateGas(estimate.receipt)
        if (gas !== null || keepGas !== null) {
          profileCall = withCallbackGas(profileCall, gas, keepGas)
          estimate = await estimateCall(socialRpc, from, profileCall)
        }
        const {fee, maxFee} = estimate
        return {
          from,
          socialCall: profileCall,
          fee: {fee, maxFee},
          files,
          memberExtra: extra,
        }
      },
      {detail}
    )

  const prepareDraft = () =>
    prepare(
      draft.kind,
      () =>
        prepareDraftCall(
          socialRpc,
          {
            text: draftText,
            textOnIpfs,
            image: draftImage?.bytes || null,
            target: draftTarget(draft.target, draftTopic),
          },
          storedRef.current
        ),
      {
        sentDraft: {
          text: draftText,
          image: draftImage,
          textOnIpfs,
          topic: draft.target.level ? '' : draftTopic,
        },
      }
    )

  const watch = async (kind, hash) => {
    const outcome = await waitForBlock(socialRpc, hash, {
      pause: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms)
        }),
      isStopped: () => !aliveRef.current,
    })
    if (outcome.result === 'stopped') return
    setInFlight((current) => current.filter((item) => item.hash !== hash))
    const what = whatOf[kind]
    const sentDraft = sentDraftsRef.current.get(hash) ?? null
    sentDraftsRef.current.delete(hash)
    const failed = outcome.result === 'dropped' || Boolean(outcome.error)
    let draftNote = null
    if (failed) {
      setWaiting((current) => current.filter((item) => item.hash !== hash))
      const back = draftToPutBack(sentDraft, editorRef.current)
      if (back) {
        setDraftText(back.text)
        setDraftImage(back.image)
        setTextOnIpfs(back.textOnIpfs)
        setDraftTopic(back.topic ?? '')
        editorRef.current = {text: back.text, image: back.image}
        draftNote = t('The draft is back in the editor.')
      } else if (sentDraft)
        draftNote = t(
          'The editor holds another draft, so this one was not put back.'
        )
    }
    if (outcome.result === 'dropped')
      show(
        `${t('{{what}} was not sent: the node no longer has it.', {
          what,
          nsSeparator: '|',
        })} ${draftNote ?? t('Try again.')}`,
        {error: true}
      )
    else if (outcome.error)
      show(
        [
          t(
            '{{what}} is in a block, but the contract refused it ({{message}}): the fee is paid, nothing is posted.',
            {what, message: outcome.error, nsSeparator: '|'}
          ),
          draftNote,
        ]
          .filter(Boolean)
          .join(' '),
        {error: true}
      )
    else {
      setWaiting((current) =>
        current.map((item) =>
          item.hash === hash ? {...item, height: outcome.height} : item
        )
      )
      show(t('{{what}} is in a block.', {what}), {ms: MINED_MS})
      if (PROFILE_KINDS.has(kind)) onProfileChange?.()
      else readNewBlocks()
    }
  }

  const send = async () => {
    const pending = confirm
    setConfirm(null)
    if (!pending) return
    const what = whatOf[pending.kind]
    const key = PROFILE_KINDS.has(pending.kind)
      ? actionKey(pending.socialCall)
      : null
    if (key !== null && inFlight.some((item) => item.key === key)) {
      refused(pending.kind, new Error(t('it already waits for its block')))
      return
    }
    setBusy(true)
    let hash
    try {
      hash = await sendPrepared(socialRpc, pending, {
        onFile: (file) =>
          show(
            file === 'text'
              ? t('{{what}}: storing the text on IPFS…', {
                  what,
                  nsSeparator: '|',
                })
              : t('{{what}}: storing the image on IPFS…', {
                  what,
                  nsSeparator: '|',
                })
          ),
        onStored: (cid) => storedRef.current.add(cid),
      })
    } catch (error) {
      refused(pending.kind, error)
      return
    } finally {
      setBusy(false)
    }
    if (pending.kind === 'message') setMessagesSent((n) => n + 1)
    if (pending.sentDraft) {
      sentDraftsRef.current.set(hash, pending.sentDraft)
      setDraft(null)
      setDraftText('')
      setDraftImage(null)
      setTextOnIpfs(false)
      setDraftTopic('')
    }
    if (key !== null)
      setInFlight((current) => [...current, {key, kind: pending.kind, hash}])
    setWaiting((current) => [
      ...current,
      {hash, kind: pending.kind, likeOf: pending.likeOf ?? null, height: null},
    ])
    show(
      t('{{what}} sent, waiting for a block ({{hash}}…)', {
        what,
        hash: String(hash).slice(0, 10),
      })
    )
    watch(pending.kind, hash)
  }

  const pendingLikes = React.useMemo(
    () =>
      new Set(
        waiting.filter(({likeOf}) => likeOf !== null).map(({likeOf}) => likeOf)
      ),
    [waiting]
  )

  const isInFlight = (call) =>
    inFlight.some((item) => item.key === actionKey(call))

  return {
    canAct: ready && !busy,
    busy,
    // The profile calls waiting for their block ({key, kind, hash}), each with what it is.
    inFlight: inFlight.map((item) => ({...item, what: whatOf[item.kind]})),
    isInFlight,
    kindInFlight: (...kinds) =>
      inFlight.some((item) => kinds.includes(item.kind)),
    status,
    confirm,
    cancelConfirm: () => setConfirm(null),
    send,
    prepareLike,
    prepareTip,
    prepareMessage,
    prepareProfile,
    messagesSent,
    pendingLikes,
    draft,
    // A new post opened from a topic's page starts in that topic.
    startDraft: (target, answered = null, topic = null) => {
      if (topic !== null) setDraftTopic(topic)
      setDraft({kind: draftKindOf(target), target, answered})
    },
    cancelDraft: () => setDraft(null),
    draftText,
    setDraftText,
    draftImage,
    setDraftImage,
    textOnIpfs,
    setTextOnIpfs,
    draftTopic,
    setDraftTopic,
    prepareDraft,
  }
}
