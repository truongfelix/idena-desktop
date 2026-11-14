import {approveAction} from './pending-api'

const item = {id: 'p1', action: 'post', body: 'A joke'}

function fakeMain() {
  global.ipcRenderer = {
    invoke: jest.fn(async (channel, command, data) => {
      if (command === 'approve')
        return {...item, body: data.body ?? item.body, state: 'running'}
      if (command === 'finish') return []
      throw new Error(`unexpected ${command}`)
    }),
  }
  return () => global.ipcRenderer.invoke.mock.calls.map(([, c, d]) => [c, d])
}

afterEach(() => {
  delete global.ipcRenderer
})

describe('an approval', () => {
  test('the executor gets the approved item with the edit, then the main process hears it was done', async () => {
    const calls = fakeMain()
    const post = jest.fn().mockResolvedValue('posted')
    await expect(approveAction(item, 'Edited', {post})).resolves.toBe('posted')
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({body: 'Edited', state: 'running'})
    )
    expect(calls()).toEqual([
      ['approve', {id: 'p1', body: 'Edited'}],
      ['finish', {id: 'p1', ok: true, detail: 'posted'}],
    ])
  })

  test('a failed action is reported back as failed, and its error shown', async () => {
    const calls = fakeMain()
    const post = jest.fn().mockRejectedValue(new Error('no iDNA for the fee'))
    await expect(approveAction(item, undefined, {post})).rejects.toThrow(
      'no iDNA for the fee'
    )
    expect(calls()[1]).toEqual([
      'finish',
      {id: 'p1', ok: false, detail: 'no iDNA for the fee'},
    ])
  })

  test('done, then the main process cannot be told: still done, not reported failed', async () => {
    global.ipcRenderer = {
      invoke: jest.fn(async (channel, command) => {
        if (command === 'approve') return {...item, state: 'running'}
        throw new Error('window closing')
      }),
    }
    const post = jest.fn().mockResolvedValue('posted')
    await expect(approveAction(item, undefined, {post})).resolves.toBe('posted')
    const finishes = global.ipcRenderer.invoke.mock.calls.filter(
      ([, command]) => command === 'finish'
    )
    expect(finishes.map(([, , data]) => data.ok)).toEqual([true])
  })

  test('an action this app cannot do is not handed over at all', async () => {
    const calls = fakeMain()
    await expect(approveAction(item, undefined, {})).rejects.toThrow(
      'cannot do this action'
    )
    expect(calls()).toEqual([])
  })

  test('a refusal of the main process runs nothing', async () => {
    global.ipcRenderer = {
      invoke: jest.fn().mockRejectedValue(new Error('paused')),
    }
    const post = jest.fn()
    await expect(approveAction(item, undefined, {post})).rejects.toThrow(
      'paused'
    )
    expect(post).not.toHaveBeenCalled()
  })
})
