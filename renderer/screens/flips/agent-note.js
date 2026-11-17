/* eslint-disable react/prop-types */
import * as React from 'react'
import {Stack, Text} from '@chakra-ui/react'
import {useTranslation} from 'react-i18next'
import {FlipType} from '../../shared/types'
import {draftStatus} from '../agents/flips/drafts'
import {evaluateDraft} from '../agents/flips/run'
import {flipsDeps, verdictText} from '../agents/flips/execute'
import {useFailToast, useSuccessToast} from '../../shared/hooks/use-toast'

// What the agents did with a draft, on its card in the Flips list (B-284): the step it waits for, the judge's verdict
// on it as it is, how many times it was written again; and the list's Evaluate, the judge asked for one draft.

const POLL_MS = 3000

/** The step a draft waits for, in words ('' for none). */
export function stepText(step, t) {
  switch (step) {
    case 'approval':
      return t('Waits in To approve')
    case 'pictures':
      return t('Story written, pictures next')
    case 'protection':
      return t('Pictures made, protection next')
    case 'evaluation':
      return t('Ready, evaluation next')
    case 'sending':
      return t('Evaluation passed, sending next')
    case 'left':
      return t('Failed its evaluation, left to you')
    default:
      return ''
  }
}

/** The lines of a draft's status (draftStatus), as the card shows them: [{text, bad}]. */
export function statusLines(status, t) {
  if (!status) return []
  const {step, verdict, rewrites} = status
  const lines = []
  const said = stepText(step, t)
  if (said) lines.push({text: said, bad: step === 'left'})
  // The verdict in words: a failure's reasons, and the person's own draft's (it has no step).
  const settled = verdict && !verdict.waiting && !verdict.declined
  if (settled && (!verdict.pass || !step))
    lines.push({text: verdictText(verdict, t), bad: !verdict.pass})
  if (rewrites > 0)
    lines.push({
      text: t('Rewrites so far: {{n}}', {n: rewrites, nsSeparator: '!!'}),
      bad: false,
    })
  return lines
}

/** The agent that judges flips: on, not paused, Judge the flip not Off. Null without one. */
export function judgeAgentOf(list) {
  if (!list || list.paused) return null
  return (
    list.agents.find(
      (a) =>
        a.enabled && a.actions.flipJudge && a.actions.flipJudge.level !== 'off'
    ) || null
  )
}

/** Whether the stored flip is no longer the draft the list loaded (`seenAt`: its modifiedAt then). */
export const changedSince = (stamp, seenAt) =>
  !stamp || stamp.type !== FlipType.Draft || stamp.modifiedAt !== seenAt

/**
 * The draft's status with the agents, from the flip store now and every few seconds (an agent's run changes it while
 * the list is open): its small marks are watched (getFlipStamp), the whole flip read only when they change. `watch`:
 * only a draft is read. `seenAt`: the draft's modifiedAt as the list loaded it. Returns {status, changed}: `changed`
 * when the stored flip is no longer that draft (written again, sent, deleted by an agent): the card's pictures and
 * its Submit would be the old ones.
 */
export function useDraftStatus(id, watch, seenAt) {
  const [state, setState] = React.useState({
    key: '',
    status: null,
    changed: false,
  })
  React.useEffect(() => {
    const store = global.flipStore
    if (!watch || !store || !store.getFlipStamp) {
      setState({key: '', status: null, changed: false})
      return undefined
    }
    const read = () => {
      const stamp = store.getFlipStamp(id)
      const key = JSON.stringify(stamp)
      setState((before) =>
        before.key === key
          ? before
          : {
              key,
              status: draftStatus(store.getFlip(id)),
              changed: changedSince(stamp, seenAt),
            }
      )
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => clearInterval(timer)
  }, [id, watch, seenAt])
  return state
}

export function DraftAgentNote({status, changed = false}) {
  const {t} = useTranslation()
  const lines = statusLines(status, t).concat(
    changed
      ? [
          {
            text: t('Changed since this list opened: open it again.', {
              nsSeparator: '!!',
            }),
            bad: false,
          },
        ]
      : []
  )
  if (!lines.length) return null
  return (
    <Stack spacing={0} mt={1} data-agent-note>
      {lines.map(({text, bad}) => (
        <Text key={text} fontSize="sm" color={bad ? 'red.500' : 'muted'}>
          {text}
        </Text>
      ))}
    </Stack>
  )
}

/** What the person is told when an evaluation could not be done (evaluateDraft's errors). */
export function evaluateErrorText(error, t) {
  switch (error && error.message) {
    case 'not ready':
      return t(
        'Protect and shuffle the flip first: it is evaluated as it would be sent.',
        {nsSeparator: '!!'}
      )
    case 'waiting':
      return t('This draft waits in To approve.')
    case 'changed':
      return t('The draft changed meanwhile: evaluate it again.', {
        nsSeparator: '!!',
      })
    case 'gone':
      return t('The draft is gone.')
    default:
      return String((error && error.message) || error)
  }
}

/**
 * The list's Evaluate on one draft: `judge` the agent asked (judgeAgentOf). {evaluate, busy}; the verdict is shown in
 * a toast and on the card.
 */
export function useEvaluate(judge, id) {
  const {t} = useTranslation()
  const [busy, setBusy] = React.useState(false)
  const done = useSuccessToast()
  const fail = useFailToast()
  const evaluate = async () => {
    if (busy || !judge) return
    setBusy(true)
    try {
      const verdict = await evaluateDraft(judge, id, flipsDeps({t}))
      ;(verdict.pass ? done : fail)(verdictText(verdict, t))
    } catch (error) {
      fail(evaluateErrorText(error, t))
    } finally {
      setBusy(false)
    }
  }
  return {evaluate, busy}
}
