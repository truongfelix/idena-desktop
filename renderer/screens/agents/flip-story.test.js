import {storyAgentOf, storyWords} from './flip-story'

// B-236: the flip editor shows the story panel only for an agent that is on and holds "Write flip stories".

const agent = (more) => ({
  id: 'a',
  name: 'A',
  enabled: true,
  actions: {flipStory: {level: 'ask'}},
  ...more,
})

describe('who writes the flip stories', () => {
  test('an agent that is on with the action, Ask me or Alone', () => {
    expect(storyAgentOf({paused: false, agents: [agent()]}).id).toBe('a')
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({actions: {flipStory: {level: 'alone'}}})],
      }).id
    ).toBe('a')
  })

  test('nobody: no agent, the action Off or absent, the agent off, all paused', () => {
    expect(storyAgentOf(null)).toBeNull()
    expect(storyAgentOf({paused: false, agents: []})).toBeNull()
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({actions: {flipStory: {level: 'off'}}})],
      })
    ).toBeNull()
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({actions: {answerFlip: {level: 'ask'}}})],
      })
    ).toBeNull()
    expect(
      storyAgentOf({paused: false, agents: [agent({enabled: false})]})
    ).toBeNull()
    expect(storyAgentOf({paused: true, agents: [agent()]})).toBeNull()
  })

  test('the first agent holding it, past one that does not', () => {
    expect(
      storyAgentOf({
        paused: false,
        agents: [agent({id: 'x', actions: {}}), agent({id: 'y'})],
      }).id
    ).toBe('y')
  })
})

describe("the flip's keywords as the agent gets them", () => {
  test('the two English words, their descriptions', () => {
    expect(
      storyWords({
        words: [
          {id: 1, name: 'ladder', desc: 'a set of steps'},
          {id: 2, name: 'kite', desc: null},
        ],
      })
    ).toEqual([
      {name: 'ladder', desc: 'a set of steps'},
      {name: 'kite', desc: ''},
    ])
  })

  test('missing keywords: none', () => {
    expect(storyWords({words: []})).toBeNull()
    expect(storyWords({words: [{name: 'ladder'}]})).toBeNull()
    expect(storyWords(undefined)).toBeNull()
  })
})
