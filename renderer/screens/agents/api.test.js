import {
  lastAgentStatus,
  onAgentChange,
  onAgentsChange,
  updateAgent,
} from '../settings/agent/api'

/** A main process holding the agents, its saveAgent slower than its reads. */
function fakeMain(agents) {
  let saved = agents
  global.ipcRenderer = {
    invoke: jest.fn(async (channel, command, data) => {
      if (command === 'saveAgent') {
        await new Promise((resolve) => {
          setTimeout(resolve, 5)
        })
        const isNew = data.id === undefined
        const agent = isNew ? {...data, id: 'new'} : data
        saved = isNew
          ? [...saved, agent]
          : saved.map((a) => (a.id === agent.id ? agent : a))
        return {paused: false, agents: saved, savedId: agent.id}
      }
      if (command === 'agents') return {paused: false, agents: saved}
      if (command === 'status') return {settings: {enabled: true}}
      throw new Error(`unexpected ${command}`)
    }),
  }
  return () => saved
}

afterEach(() => {
  delete global.ipcRenderer
})

describe("an agent's page writes", () => {
  test('two quick changes of one agent both stay', async () => {
    const saved = fakeMain([{id: 'a', name: 'A', enabled: false, hasKey: true}])
    await Promise.all([
      updateAgent('a', (a) => ({...a, name: 'B'})),
      updateAgent('a', (a) => ({...a, enabled: true})),
    ])
    expect(saved()).toEqual([{id: 'a', name: 'B', enabled: true}])
  })

  test('the list sent to the main process holds no hasKey, and a new agent gets its id back', async () => {
    fakeMain([])
    const result = await updateAgent(null, () => ({name: 'New agent'}))
    expect(result.savedId).toBe('new')
    const saves = global.ipcRenderer.invoke.mock.calls.filter(
      ([, command]) => command === 'saveAgent'
    )
    expect(saves[0][2]).toEqual({name: 'New agent'})
  })

  test('both views hear the change: the validation status and the list', async () => {
    fakeMain([{id: 'a', name: 'A'}])
    const heard = []
    const off = onAgentChange((status) => heard.push(['status', status]))
    const offList = onAgentsChange((list) => heard.push(['list', list]))
    await updateAgent('a', (a) => ({...a, name: 'B'}))
    off()
    offList()
    expect(heard.map(([kind]) => kind)).toEqual(['status', 'list'])
    expect(heard[1][1].agents[0].name).toBe('B')
    expect(lastAgentStatus()).toEqual({settings: {enabled: true}})
  })

  test('a change of an agent removed meanwhile is refused', async () => {
    fakeMain([])
    await expect(updateAgent('gone', (a) => a)).rejects.toThrow('no such agent')
  })
})
