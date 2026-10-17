import {lastRestartText} from './node-reports'

const t = (text, values = {}) =>
  text.replace(/{{(\w+)}}/g, (_, key) => values[key])

describe('the Node reports line', () => {
  it('says when the app never restarted the node', () => {
    expect(lastRestartText([], t)).toBe(
      'The app has not had to restart the node.'
    )
    expect(lastRestartText(undefined, t)).toBe(
      'The app has not had to restart the node.'
    )
  })

  it('names the last restart', () => {
    expect(lastRestartText([3000, 1000, 2000], t, (ms) => `at ${ms}`)).toBe(
      'The app restarted the node on at 3000: it had stopped answering.'
    )
  })
})
