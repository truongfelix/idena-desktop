import {isHardForkUpdate} from './node'

describe('isHardForkUpdate', () => {
  const hardFork = {version: '1.2.0'}

  it('needs a hard fork declared by the release', () => {
    expect(isHardForkUpdate('1.1.2', '1.2.0', hardFork)).toBeTruthy()
    expect(isHardForkUpdate('1.1.2', '1.2.0', null)).toBeFalsy()
    expect(isHardForkUpdate('1.1.2', '2.0.0', undefined)).toBeFalsy()
  })

  it('needs the description of that very release', () => {
    expect(isHardForkUpdate('1.1.2', '1.2.1', hardFork)).toBeFalsy()
    expect(isHardForkUpdate('1.1.2', 'v1.2.0', hardFork)).toBeTruthy()
  })

  it('needs an older current node', () => {
    expect(isHardForkUpdate('1.2.0', '1.2.0', hardFork)).toBeFalsy()
    expect(isHardForkUpdate('1.3.0', '1.2.0', hardFork)).toBeFalsy()
  })

  it('handles edge cases', () => {
    expect(isHardForkUpdate('0.0.1', '1.2.0', hardFork)).toBeFalsy()
    expect(isHardForkUpdate('0.1.0foo', '1.2.0', hardFork)).toBeFalsy()
    expect(isHardForkUpdate('not a', 'semver string', hardFork)).toBeFalsy()
  })
})
