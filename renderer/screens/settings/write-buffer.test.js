import {DB_WRITE_BUFFERS, restartRisk, writeBufferPending} from './write-buffer'

const now = new Date('2026-10-04T12:00:00Z')
const inMinutes = (minutes) =>
  new Date(now.getTime() + minutes * 60 * 1000).toISOString()

describe('write buffer setting', () => {
  it('offers the four sizes', () => {
    expect(DB_WRITE_BUFFERS.map(({mib}) => mib)).toEqual([4, 16, 32, 64])
  })

  it('is pending only while the node runs with another size', () => {
    expect(
      writeBufferPending({nodeStarted: true, runningMiB: 4, chosenMiB: 32})
    ).toBe(true)
    expect(
      writeBufferPending({nodeStarted: true, runningMiB: 32, chosenMiB: 32})
    ).toBe(false)
    expect(
      writeBufferPending({nodeStarted: false, runningMiB: 4, chosenMiB: 32})
    ).toBe(false)
    expect(
      writeBufferPending({nodeStarted: true, runningMiB: null, chosenMiB: 32})
    ).toBe(false)
  })

  it('blocks a restart during the validation', () => {
    for (const currentPeriod of [
      'FlipLottery',
      'ShortSession',
      'LongSession',
    ]) {
      expect(
        restartRisk(now, {currentPeriod, nextValidation: inMinutes(-1)})
          .canRestart
      ).toBe(false)
    }
  })

  it('warns within three hours before the validation', () => {
    const risk = restartRisk(now, {
      currentPeriod: 'None',
      nextValidation: inMinutes(150),
    })
    expect(risk.canRestart).toBe(true)
    expect(risk.message).toMatch('starts soon')
    expect(
      restartRisk(now, {currentPeriod: 'None', nextValidation: inMinutes(179)})
    ).not.toBeNull()
  })

  it('says nothing otherwise', () => {
    expect(
      restartRisk(now, {currentPeriod: 'None', nextValidation: inMinutes(180)})
    ).toBeNull()
    expect(
      restartRisk(now, {currentPeriod: 'None', nextValidation: inMinutes(-60)})
    ).toBeNull()
    expect(restartRisk(now, null)).toBeNull()
    expect(restartRisk(now, {currentPeriod: 'None'})).toBeNull()
  })
})
