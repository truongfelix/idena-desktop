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
 * Whether the window's timers stay awake (B-302): an agent acts in the validation (`mode`, agentMode), not paused,
 * from the lottery to the end of the long session. Hidden or minimized, a window's timers otherwise slow down to
 * about once a minute: the app then opened the validation 94 s late, and Autopilot's submit came 54 s after its
 * countdown (devnet trial 2026-11-22).
 */
export function keepsAwake({mode, paused, period}) {
  return Boolean(mode) && !paused && CEREMONY_PERIODS.includes(period)
}

/** At the app's root: asks the main process to keep the window's timers awake while keepsAwake holds. */
export function ValidationAgentAwake() {
  const epoch = useEpochState()
  const [agent, setAgent] = React.useState({mode: null, paused: false})

  React.useEffect(() => {
    let live = true
    const show = ({settings}) => {
      if (live)
        setAgent({mode: agentMode(settings), paused: Boolean(settings.paused)})
    }
    agentStatus().then(show, () => {})
    const off = onAgentChange(show)
    return () => {
      live = false
      off()
    }
  }, [])

  const on = keepsAwake({...agent, period: epoch?.currentPeriod})
  React.useEffect(() => {
    if (!on) return undefined
    global.ipcRenderer?.send(WINDOW_COMMAND, 'agent-awake', {on: true})
    return () =>
      global.ipcRenderer?.send(WINDOW_COMMAND, 'agent-awake', {on: false})
  }, [on])

  return null
}
