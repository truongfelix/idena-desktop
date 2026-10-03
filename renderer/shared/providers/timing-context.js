import React from 'react'
import {fetchCeremonyIntervals} from '../api/dna'
import {useInterval} from '../hooks/use-interval'
import {useChainState} from './chain-context'

/**
 * Whether the node finds its computer's clock wrong (this computer with the built-in node): it compares
 * the clock with internet time (NTP) every minute and reports a drift over 10 s in bcn_syncing's
 * wrongTime. Nothing while the node does not answer.
 */
export function nodeReportsWrongTime({offline, wrongTime}) {
  return !offline && wrongTime === true
}

const TimingStateContext = React.createContext()

export function TimingProvider(props) {
  const [timing, setTiming] = React.useState({
    validation: null,
    flipLottery: null,
    shortSession: null,
    longSession: null,
  })

  const [interval, setInterval] = React.useState(1000 * 60)

  useInterval(
    async () => {
      try {
        const {
          ValidationInterval: validation,
          FlipLotteryDuration: flipLottery,
          ShortSessionDuration: shortSession,
          LongSessionDuration: longSession,
        } = await fetchCeremonyIntervals()

        setTiming({
          validation,
          flipLottery,
          shortSession,
          longSession,
        })
        setInterval(1000 * 60 * 1)
      } catch (error) {
        setInterval(1000 * 5 * 1)
        global.logger.error(
          'An error occured while fetching ceremony intervals',
          error.message
        )
      }
    },
    interval,
    true
  )

  // Given with the timing on every render: the minute poll above replaces the timing object, so a flag kept in it
  // was dropped after a minute and "Wrong time" disappeared.
  const wrongClientTime = nodeReportsWrongTime(useChainState())

  const value = React.useMemo(
    () => ({...timing, wrongClientTime}),
    [timing, wrongClientTime]
  )

  return <TimingStateContext.Provider value={value} {...props} />
}

export function useTimingState() {
  const context = React.useContext(TimingStateContext)
  if (context === undefined) {
    throw new Error('useTimingState must be used within a TimingProvider')
  }
  return context
}
