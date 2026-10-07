import React from 'react'
import {useTranslation} from 'react-i18next'
import {LIKE, SocialCall, makePostArgument} from './contract'
import {socialRpc} from './node'
import {
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
 * Writing to idena.social, as the phone app does (SocialModel): the editor's draft, the confirmation with the fees,
 * then the node signs and sends, and the app waits for the block and reads it. One action at a time (`busy`);
 * what was sent stays `waiting` until the scan has read it, so a like is not sent twice. `readNewBlocks` asks the
 * scan for the new blocks; `scannedHashes` are the transactions the scan has read.
 */
export function useSocialSending({ready, readNewBlocks, scannedHashes}) {
  const {t} = useTranslation()
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState(null)
  const [confirm, setConfirm] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [draftText, setDraftText] = React.useState('')
  const [draftImage, setDraftImage] = React.useState(null)
  const [textOnIpfs, setTextOnIpfs] = React.useState(false)
  const [waiting, setWaiting] = React.useState([])
  const storedRef = React.useRef(new Set())
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

  // What the scan has read is no longer waiting.
  React.useEffect(() => {
    setWaiting((current) =>
      current.some(({hash}) => scannedHashes.has(hash))
        ? current.filter(({hash}) => !scannedHashes.has(hash))
        : current
    )
  }, [scannedHashes])

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
            target: draft.target,
          },
          storedRef.current
        ),
      {fromEditor: true}
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
    const what = whatOf[kind]
    if (outcome.result === 'dropped' || outcome.error)
      setWaiting((current) => current.filter((item) => item.hash !== hash))
    if (outcome.result === 'dropped')
      show(
        t('{{what}} was not sent: the node no longer has it. Try again.', {
          what,
          nsSeparator: '|',
        }),
        {error: true}
      )
    else if (outcome.error)
      show(
        t(
          '{{what}} is in a block, but the contract refused it ({{message}}): the fee is paid, nothing is posted.',
          {what, message: outcome.error, nsSeparator: '|'}
        ),
        {error: true}
      )
    else {
      show(t('{{what}} is in a block.', {what}), {ms: MINED_MS})
      readNewBlocks()
    }
  }

  const send = async () => {
    const pending = confirm
    setConfirm(null)
    if (!pending) return
    const what = whatOf[pending.kind]
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
    if (pending.fromEditor) {
      setDraft(null)
      setDraftText('')
      setDraftImage(null)
      setTextOnIpfs(false)
    }
    setWaiting((current) => [
      ...current,
      {hash, kind: pending.kind, likeOf: pending.likeOf ?? null},
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

  return {
    canAct: ready && !busy,
    busy,
    status,
    confirm,
    cancelConfirm: () => setConfirm(null),
    send,
    prepareLike,
    prepareTip,
    pendingLikes,
    draft,
    startDraft: (target, answered = null) =>
      setDraft({kind: draftKindOf(target), target, answered}),
    cancelDraft: () => setDraft(null),
    draftText,
    setDraftText,
    draftImage,
    setDraftImage,
    textOnIpfs,
    setTextOnIpfs,
    prepareDraft,
  }
}
