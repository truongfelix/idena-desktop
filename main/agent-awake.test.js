const {createAgentAwake} = require('./agent-awake')

describe("The window's timers kept awake for a validation agent (B-302)", () => {
  const setup = () => {
    const calls = []
    return {
      awake: createAgentAwake((throttled) => calls.push(throttled)),
      calls,
    }
  }

  it('stays awake while either asker asks', () => {
    const {awake, calls} = setup()
    awake.set('root', true)
    awake.set('screen', true)
    awake.set('root', false)
    expect(calls).toEqual([false, false, false])
    awake.set('screen', false)
    expect(calls.at(-1)).toBe(true)
  })

  it('ends every request when a page load starts', () => {
    const {awake, calls} = setup()
    awake.set('root', true)
    awake.reset()
    expect(calls.at(-1)).toBe(true)
    awake.set('screen', false)
    expect(calls.at(-1)).toBe(true)
  })

  it('ignores an unknown asker', () => {
    const {awake, calls} = setup()
    awake.set('other', true)
    expect(calls).toEqual([])
  })
})
