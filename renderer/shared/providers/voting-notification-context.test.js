import {interpret} from 'xstate'
import {SimulatedClock} from 'xstate/lib/SimulatedClock'
import {
  VOTING_NOTIFICATION_INTERVAL_MS,
  canBeOracle,
  createVotingNotificationMachine,
} from './voting-notification-context'

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

function start(fetchUnreadCount) {
  const clock = new SimulatedClock()
  const service = interpret(
    createVotingNotificationMachine({fetchUnreadCount}),
    {
      clock,
    }
  ).start()
  return {service, clock}
}

describe('oracle voting To-Do count', () => {
  it('reads the count, then every five minutes', async () => {
    const fetchUnreadCount = jest.fn(async () => [{}, {}])
    const {service, clock} = start(fetchUnreadCount)
    service.send('START', {epoch: 229, address: '0xa'})
    await flush()
    expect(service.state.context.todoCount).toBe(2)
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1)

    clock.increment(10000)
    await flush()
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1)

    clock.increment(VOTING_NOTIFICATION_INTERVAL_MS)
    await flush()
    expect(fetchUnreadCount).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('reads again after a failed read', async () => {
    const fetchUnreadCount = jest
      .fn()
      .mockRejectedValueOnce(new Error('api.idena.io down'))
      .mockResolvedValue([{}])
    const {service, clock} = start(fetchUnreadCount)
    service.send('START', {epoch: 229, address: '0xa'})
    await flush()
    expect(service.state.matches({ready: 'idle'})).toBe(true)

    clock.increment(VOTING_NOTIFICATION_INTERVAL_MS)
    await flush()
    expect(service.state.context.todoCount).toBe(1)
    service.stop()
  })

  it('stops reading on STOP', async () => {
    const fetchUnreadCount = jest.fn(async () => [])
    const {service, clock} = start(fetchUnreadCount)
    service.send('START', {epoch: 229, address: '0xa'})
    await flush()
    service.send('STOP')
    clock.increment(VOTING_NOTIFICATION_INTERVAL_MS * 3)
    await flush()
    expect(service.state.matches('waiting')).toBe(true)
    expect(fetchUnreadCount).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('reads only for identities that can sit on an oracle committee', () => {
    expect(canBeOracle('Human')).toBe(true)
    expect(canBeOracle('Newbie')).toBe(true)
    expect(canBeOracle('Candidate')).toBe(false)
    expect(canBeOracle('Undefined')).toBe(false)
    expect(canBeOracle(undefined)).toBe(false)
  })
})
