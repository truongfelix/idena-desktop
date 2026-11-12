import {agentCardLine} from './agent-card'
import {onAgentChange, saveAgentSettings} from './api'

const t = (text) => text
const settings = (level, paused = false) => ({
  enabled: true,
  paused,
  permissions: {answerFlip: {level}},
})

describe("the agent's card in the menu", () => {
  test('says what the agent does now', () => {
    expect(agentCardLine(t, settings('alone'))).toBe(
      'Autopilot in the validation'
    )
    expect(agentCardLine(t, settings('ask'))).toBe(
      'Suggests the answers in the validation'
    )
    expect(agentCardLine(t, settings('off'))).toBe('Every action is off')
    expect(agentCardLine(t, settings('alone', true))).toMatch(/^Paused/u)
  })

  test('hears each saved change, until it stops listening', async () => {
    const saved = {settings: settings('ask', true)}
    global.ipcRenderer = {invoke: jest.fn().mockResolvedValue(saved)}
    const heard = jest.fn()
    const off = onAgentChange(heard)
    await saveAgentSettings(saved.settings)
    expect(heard).toHaveBeenCalledWith(saved)
    off()
    await saveAgentSettings(saved.settings)
    expect(heard).toHaveBeenCalledTimes(1)
    delete global.ipcRenderer
  })
})
