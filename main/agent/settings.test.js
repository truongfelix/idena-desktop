const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {
  ACTIONS,
  DEFAULT_ADDRESSES,
  createAgentSettings,
  defaultSettings,
  normalizeSettings,
} = require('./settings')
const {checkAction} = require('./permissions')

describe('agent settings', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-settings-'))
  })
  afterEach(() => fs.removeSync(dir))

  test('starts off, every action listed, validation actions asking first', () => {
    const settings = defaultSettings()
    expect(settings.enabled).toBe(false)
    expect(Object.keys(settings.permissions)).toEqual(Object.keys(ACTIONS))
    expect(settings.permissions.answerFlip.level).toBe('ask')
    expect(settings.permissions.send.level).toBe('off')
  })

  test('a missing or broken file reads as the defaults', () => {
    const store = createAgentSettings({file: () => path.join(dir, 'a.json')})
    expect(store.read()).toEqual(defaultSettings())
    fs.writeFileSync(path.join(dir, 'a.json'), '{broken')
    const warn = jest.fn()
    const broken = createAgentSettings({
      file: () => path.join(dir, 'a.json'),
      logger: {warn},
    })
    expect(broken.read()).toEqual(defaultSettings())
    expect(warn).toHaveBeenCalled()
  })

  test('an older file without the newer actions gets their defaults', () => {
    const file = path.join(dir, 'a.json')
    fs.writeJsonSync(file, {
      enabled: true,
      provider: 'anthropic',
      permissions: {answerFlip: {level: 'alone'}},
    })
    const settings = createAgentSettings({file: () => file}).read()
    expect(settings.enabled).toBe(true)
    expect(settings.address).toBe(DEFAULT_ADDRESSES.anthropic)
    expect(settings.permissions.answerFlip).toEqual({
      level: 'alone',
      limit: null,
    })
    expect(settings.permissions.report).toEqual(ACTIONS.report)
  })

  test('unknown values are replaced, unknown keys dropped', () => {
    const settings = normalizeSettings({
      enabled: 'yes',
      provider: 'other',
      model: 7,
      key: 'sk-never-saved',
      permissions: {
        answerFlip: {level: 'always'},
        send: {level: 'alone', limit: -5},
        mine: {level: 'alone'},
      },
    })
    expect(settings.enabled).toBe(false)
    expect(settings.provider).toBe('local')
    expect(settings.model).toBe('')
    expect(settings).not.toHaveProperty('key')
    expect(settings.permissions.answerFlip.level).toBe('ask')
    expect(settings.permissions.send).toEqual({level: 'alone', limit: 0})
    expect(settings.permissions).not.toHaveProperty('mine')
  })

  test('written whole and read back', () => {
    const file = path.join(dir, 'agent', 'settings.json')
    const store = createAgentSettings({file: () => file})
    store.write({...defaultSettings(), enabled: true, model: 'llava'})
    expect(store.read()).toMatchObject({enabled: true, model: 'llava'})
  })
})

describe('the permission check', () => {
  const on = (permissions) => normalizeSettings({enabled: true, permissions})

  test('nothing when the agent is off or paused, or the action unknown', () => {
    expect(checkAction(defaultSettings(), 'answerFlip').decision).toBe('off')
    expect(checkAction({...on({}), paused: true}, 'answerFlip').decision).toBe(
      'off'
    )
    expect(checkAction(on({}), 'deleteEverything').decision).toBe('off')
    expect(checkAction(on({}), 'toString').decision).toBe('off')
  })

  test('each level decides', () => {
    expect(checkAction(on({}), 'send').decision).toBe('off')
    expect(checkAction(on({}), 'answerFlip').decision).toBe('ask')
    expect(
      checkAction(on({answerFlip: {level: 'alone'}}), 'answerFlip').decision
    ).toBe('alone')
  })

  test('alone within the limit, asking above it', () => {
    const settings = on({send: {level: 'alone', limit: 10}})
    expect(checkAction(settings, 'send', {usage: 4, amount: 6}).decision).toBe(
      'alone'
    )
    expect(checkAction(settings, 'send', {usage: 4, amount: 7}).decision).toBe(
      'ask'
    )
    const reports = on({report: {level: 'alone', limit: 2}})
    expect(checkAction(reports, 'report', {usage: 1}).decision).toBe('alone')
    expect(checkAction(reports, 'report', {usage: 2}).decision).toBe('ask')
  })
})
