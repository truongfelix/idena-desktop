import * as React from 'react'
import {WINDOW_COMMAND} from '../../../../main/channels'
import {useEpochState} from '../../../shared/providers/epoch-context'
import {EpochPeriod} from '../../../shared/types'
import {agentStatus, onAgentChange} from '../../settings/agent/api'
import {agentMode} from './use-agent-validation'

const CEREMONY_PERIODS = [
  EpochPeriod.FlipLottery,
  EpochPeriod.ShortSession,
  EpochPeriod.LongSession,
]

/**
 * How long before the validation's time the timers wake already: the epoch poll that shows the lottery runs on the
 * slowed timers too (about once a minute after 5 minutes hidden).
 */
export const AWAKE_LEAD_MS = 10 * 60 * 1000

/** Whether the ceremony is on or comes within AWAKE_LEAD_MS (`nextValidation`, ms; `now`, ms). */
export function nearCeremony({period, nextValidation, now}) {
  if (CEREMONY_PERIODS.includes(period)) return true
  return (
    Number.isFinite(nextValidation) &&
    nextValidation - now <= AWAKE_LEAD_MS &&
    now < nextValidation
  )
}

/**
 * Whether the window's timers stay awake (B-302): an agent acts in the validation (`mode`, agentMode), not paused,
 * near the ceremony (nearCeremony). Hidden or minimized, a window's timers otherwise slow down to about once a
 * minute: the app then opened the validation 94 s late, and Autopilot's submit came 54 s after its countdown
 * (devnet trial 2026-11-22).
 */
export function keepsAwake({mode, paused, ...when}) {
  return Boolean(mode) && !paused && nearCeremony(when)
}

const agentOf = (settings) => {
  try {
    return {mode: agentMode(settings), paused: Boolean(settings.paused)}
  } catch {
    // Settings without the validation's permissions: no agent acts there.
    return {mode: null, paused: false}
  }
}

/** At the app's root: asks the main process to keep the window's timers awake while keepsAwake holds. */
export function ValidationAgentAwake() {
  const epoch = useEpochState()
  const [agent, setAgent] = React.useState({mode: null, paused: false})
  const [now, setNow] = React.useState(() => Date.now())
  const nextValidation = Date.parse(epoch?.nextValidation)
  const near = nearCeremony({period: epoch?.currentPeriod, nextValidation, now})

  // One wake when the lead before the validation starts.
  React.useEffect(() => {
    const at = nextValidation - AWAKE_LEAD_MS
    if (!Number.isFinite(at) || at <= Date.now()) return undefined
    const timer = setTimeout(() => setNow(Date.now()), at - Date.now() + 50)
    return () => clearTimeout(timer)
  }, [nextValidation])

  // Read again when the ceremony comes near: a read that failed at the app's start is not the last word.
  React.useEffect(() => {
    let live = true
    const show = ({settings}) => {
      if (live) setAgent(agentOf(settings))
    }
    agentStatus().then(show, () => {})
    const off = onAgentChange(show)
    return () => {
      live = false
      off()
    }
  }, [near])

  const on = keepsAwake({
    ...agent,
    period: epoch?.currentPeriod,
    nextValidation,
    now,
  })
  React.useEffect(() => {
    if (!on) return undefined
    const send = (value) =>
      global.ipcRenderer?.send(WINDOW_COMMAND, 'agent-awake', {
        on: value,
        source: 'root',
      })
    send(true)
    return () => send(false)
  }, [on])

  return null
}
