import {
  clearAgentKey,
  lastAgentStatus,
  onAgentChange,
  updateAgentSettings,
} from './api'
import {agentMode} from '../../validation/agent/use-agent-validation'

const settings = (level, more = {}) => ({
  enabled: true,
  paused: false,
  provider: 'local',
  model: 'm',
  permissions: {answerFlip: {level}},
  ...more,
})

/** A main process holding the settings, its saveSettings slower than its status. */
function fakeMain(initial) {
  let saved = initial
  const status = () => ({settings: saved, hasKey: false})
  global.ipcRenderer = {
    invoke: jest.fn(async (channel, command, data) => {
      if (command === 'saveSettings') {
        await new Promise((resolve) => {
          setTimeout(resolve, 5)
        })
        saved = data
      }
      return status()
    }),
  }
  return () => saved
}

afterEach(() => {
  delete global.ipcRenderer
})

// The agent's settings written from several places (api.js), and its mode in a validation; kept from the menu card's
// tests when the card went (B-255).
describe("the agent's settings, written in turn", () => {
  test('two quick changes from two places are both kept, one after the other', async () => {
    const saved = fakeMain(settings('ask'))
    // The page's field and the card's Pause, sent together.
    await Promise.all([
      updateAgentSettings((s) => ({...s, model: 'other'})),
      updateAgentSettings((s) => ({...s, paused: !s.paused})),
      updateAgentSettings((s) => ({...s, paused: !s.paused})),
    ])
    expect(saved()).toMatchObject({model: 'other', paused: false})
    expect(lastAgentStatus().settings).toMatchObject({model: 'other'})
  })

  test('every change written is heard, the key too, until it stops listening', async () => {
    fakeMain(settings('ask'))
    const heard = jest.fn()
    const off = onAgentChange(heard)
    await updateAgentSettings((s) => ({...s, paused: true}))
    await clearAgentKey()
    expect(heard).toHaveBeenCalledTimes(2)
    off()
    await clearAgentKey()
    expect(heard).toHaveBeenCalledTimes(2)
  })

  test('a failed write does not stop the next one', async () => {
    fakeMain(settings('ask'))
    await expect(
      updateAgentSettings(() => {
        throw new Error('no')
      })
    ).rejects.toThrow('no')
    await expect(
      updateAgentSettings((s) => ({...s, paused: true}))
    ).resolves.toMatchObject({settings: {paused: true}})
  })
})

describe("the agent's mode in a validation", () => {
  test('follows the settings: off, Suggest, Autopilot', () => {
    expect(agentMode(settings('ask'))).toBe('suggest')
    expect(agentMode(settings('alone'))).toBe('autopilot')
    expect(agentMode(settings('off'))).toBeNull()
    // A pause is apart: the screen shows it, with Resume.
    expect(agentMode(settings('alone', {paused: true}))).toBe('autopilot')
    expect(agentMode(settings('alone', {enabled: false}))).toBeNull()
  })
})
