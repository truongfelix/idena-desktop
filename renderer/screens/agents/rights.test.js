import {AREAS, actionCatalog} from './catalog'
import {
  FLIP_STEPS,
  areaCount,
  firstArea,
  flipStarts,
  isOn,
  rowOf,
  withLevels,
  withRow,
} from './rights'

const main = require('../../../main/agent/profiles')

// B-280: the rights as one table per area.
const t = (text) => text
const catalog = actionCatalog(t)
const entry = (id) => catalog.find((one) => one.id === id)

describe('a row of the table', () => {
  test('a right never given shows Off with the catalog defaults', () => {
    const agent = {actions: {}}
    expect(rowOf(agent, entry('tip'))).toEqual({
      level: 'off',
      limit: 5,
      amount: 1,
    })
    // A read's default is on: a row never given is still Off.
    expect(rowOf(agent, entry('readPosts')).level).toBe('off')
    expect(rowOf(agent, entry('answerFlip'))).toEqual({level: 'off'})
    expect(isOn(agent, 'tip')).toBe(false)
  })

  test('its own row when it has one', () => {
    const agent = {actions: {tip: {level: 'ask', limit: 2, amount: 3}}}
    expect(rowOf(agent, entry('tip'))).toBe(agent.actions.tip)
    expect(isOn(agent, 'tip')).toBe(true)
  })
})

describe('a change to a row', () => {
  test('a level on a right never given adds it with its defaults', () => {
    expect(withRow({}, entry('like'), {level: 'alone'})).toEqual({
      like: {level: 'alone', limit: 10},
    })
  })

  test('Off keeps the row and its limits', () => {
    const actions = {like: {level: 'alone', limit: 4, spendPerDay: 1}}
    expect(withRow(actions, entry('like'), {level: 'off'})).toEqual({
      like: {level: 'off', limit: 4, spendPerDay: 1},
    })
  })

  test('Off takes out a right only one agent may hold, and only that one', () => {
    const actions = {answerFlip: {level: 'ask'}, report: {level: 'alone'}}
    expect(withRow(actions, entry('answerFlip'), {level: 'off'})).toEqual({
      report: {level: 'alone'},
    })
    // Nothing is added for a right that stays Off.
    expect(withRow({}, entry('report'), {level: 'off'})).toEqual({})
  })

  test('the other rows are untouched, the input too', () => {
    const actions = {post: {level: 'ask', limit: 1}}
    const next = withRow(actions, entry('reply'), {level: 'ask'})
    expect(next.post).toBe(actions.post)
    expect(actions).toEqual({post: {level: 'ask', limit: 1}})
  })
})

describe('the areas', () => {
  test('counts the rights that are not Off, of all the area has', () => {
    const agent = {
      actions: {
        post: {level: 'alone', limit: 1},
        like: {level: 'off', limit: 10},
        readPosts: {level: 'alone', window: 'day', count: 10},
      },
    }
    const social = catalog.filter(({area}) => area === 'social').length
    expect(areaCount(agent, catalog, 'social')).toEqual({on: 2, of: social})
    expect(areaCount(agent, catalog, 'flips').on).toBe(0)
    expect(firstArea(agent, catalog, AREAS)).toBe('social')
    expect(firstArea({actions: {}}, catalog, AREAS)).toBe(AREAS[0])
  })
})

describe('the starting points of Flips', () => {
  test('each sets every step of the catalog, and no other right', () => {
    // Deleting a sent flip costs a fee (B-277): it is a row of Flips that no starting point sets.
    const steps = catalog
      .filter(({area, id}) => area === 'flips' && id !== 'flipDeleteSent')
      .map(({id}) => id)
    expect(FLIP_STEPS).toEqual(steps)
    flipStarts(t).forEach(({levels}) =>
      expect(Object.keys(levels)).toEqual(steps)
    )
  })

  test('levels change, limits stay, the other rights stay', () => {
    const actions = {
      flipStory: {level: 'off', limit: 7},
      post: {level: 'alone', limit: 1},
    }
    const {levels} = flipStarts(t).find(({id}) => id === 'drafts')
    const next = withLevels(actions, catalog, levels)
    expect(next.flipStory).toEqual({level: 'alone', limit: 7})
    expect(next.flipSubmit).toEqual({level: 'ask', limit: 3})
    expect(next.flipPictures).toEqual({
      level: 'alone',
      limit: 3,
      picturesPerDay: 9,
    })
    expect(next.post).toBe(actions.post)
  })

  test('the main process keeps what a starting point saves', () => {
    const {levels} = flipStarts(t).find(({id}) => id === 'alone')
    const actions = withLevels({}, catalog, levels)
    const file = main.normalizeAgents({
      agents: [{id: 'a1', name: 'A', actions, flipSteps: true}],
    })
    FLIP_STEPS.forEach((id) =>
      expect(file.agents[0].actions[id].level).toBe('alone')
    )
  })
})
