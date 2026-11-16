const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const {buildImageRequest, drawImage} = require('./providers')
const {createAgent} = require('./agent')
const {createAgentProfiles, validationAgentSettings} = require('./profiles')
const {mediaType} = require('./flips')

// B-236 Make the images: one picture per prompt from an OpenAI-compatible images endpoint, on the agent's service.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const HOSTED = {
  provider: 'openai',
  address: 'https://images.example/v1',
  imageModel: 'img-1',
  key: 'sk-x',
}

describe('the picture request', () => {
  test("the service's images endpoint, its image model, one square picture, the key as bearer", () => {
    const {url, headers, body} = buildImageRequest(HOSTED, 'A kite.')
    expect(url).toBe('https://images.example/v1/images/generations')
    expect(headers.authorization).toBe('Bearer sk-x')
    expect(body).toEqual({
      model: 'img-1',
      prompt: 'A kite.',
      n: 1,
      size: '1024x1024',
    })
    expect(buildImageRequest(HOSTED, 'x'.repeat(9000)).body.prompt.length).toBe(
      4000
    )
  })

  test('refused: the Anthropic API, no image model, a hosted service without its key', () => {
    expect(() =>
      buildImageRequest({...HOSTED, provider: 'anthropic'}, 'p')
    ).toThrow('draws no pictures')
    expect(() => buildImageRequest({...HOSTED, imageModel: ''}, 'p')).toThrow(
      'no image model'
    )
    expect(() => buildImageRequest({...HOSTED, key: ''}, 'p')).toThrow('no key')
  })

  test('the picture in the answer is taken; a link, or bytes that are no picture, are not', async () => {
    const reply = (data) => () => Promise.resolve({data})
    await expect(
      drawImage(HOSTED, 'p', {
        request: reply({data: [{b64_json: PNG.toString('base64')}]}),
        mediaTypeOf: mediaType,
      })
    ).resolves.toEqual({mediaType: 'image/png', data: PNG.toString('base64')})
    await expect(
      drawImage(HOSTED, 'p', {
        request: reply({data: [{url: 'https://cdn.example/x.png'}]}),
        mediaTypeOf: mediaType,
      })
    ).rejects.toThrow('a link, not a picture')
    await expect(
      drawImage(HOSTED, 'p', {
        request: reply({
          data: [{b64_json: Buffer.from('<html>').toString('base64')}],
        }),
        mediaTypeOf: mediaType,
      })
    ).rejects.toThrow('no picture')
    await expect(
      drawImage(HOSTED, 'p', {request: reply({}), mediaTypeOf: mediaType})
    ).rejects.toThrow('no picture')
  })

  test("the service's refusal reaches the person, never the request", async () => {
    const request = () =>
      Promise.reject(
        Object.assign(new Error('x'), {
          response: {status: 400, data: {error: {message: 'bad model'}}},
          config: {headers: {authorization: 'Bearer sk-x'}},
        })
      )
    const error = await drawImage(HOSTED, 'p', {
      request,
      mediaTypeOf: mediaType,
    }).catch((e) => e)
    expect(error.message).toBe('the model answered HTTP 400: bad model')
    expect(JSON.stringify(error)).not.toContain('sk-x')
  })
})

describe("the agent's picture command", () => {
  let dir
  let draw

  const start = (actions, more = {}) => {
    fs.writeJsonSync(path.join(dir, 'agents.json'), {
      v: 1,
      paused: false,
      agents: [
        {
          id: 'aaaaaaaaaaaaaaaa',
          name: 'Story agent',
          enabled: true,
          provider: 'openai',
          address: 'https://images.example/v1',
          model: 'chat-1',
          imageModel: 'img-1',
          actions,
          ...more,
        },
      ],
    })
    const profiles = createAgentProfiles({
      file: () => path.join(dir, 'agents.json'),
    })
    return createAgent({
      settings: validationAgentSettings(profiles),
      profiles,
      key: {
        keychain: () => ({available: true, reason: null}),
        has: () => true,
        hasAny: () => true,
        read: () => 'sk-x',
        set: jest.fn(),
        clear: jest.fn(),
      },
      ask: jest.fn(),
      draw,
      pendingFile: () => path.join(dir, 'pending.json'),
      now: () => 1,
    })
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-image-'))
    draw = jest
      .fn()
      .mockResolvedValue({mediaType: 'image/png', data: PNG.toString('base64')})
  })
  afterEach(() => fs.removeSync(dir))

  test('with Write flip stories: drawn by its image model, on its service and key, logged', async () => {
    const agent = start({flipStory: {level: 'ask'}})
    await expect(
      agent.handle('drawStoryPicture', {
        agentId: 'aaaaaaaaaaaaaaaa',
        prompt: 'A kite.',
      })
    ).resolves.toMatchObject({mediaType: 'image/png'})
    const [config, prompt] = draw.mock.calls[0]
    expect(config).toEqual({
      provider: 'openai',
      address: 'https://images.example/v1',
      imageModel: 'img-1',
      key: 'sk-x',
    })
    expect(prompt).toBe('A kite.')
    const [line] = await agent.handle('activity', {
      agentId: 'aaaaaaaaaaaaaaaa',
    })
    expect(line).toMatchObject({action: 'flipImage', decision: 'ask'})
  })

  test('without the action, Off, or the agent off: refused, nothing drawn', async () => {
    for (const [actions, more] of [
      [{}, {}],
      [{flipStory: {level: 'off'}}, {}],
      [{flipStory: {level: 'alone'}}, {enabled: false}],
    ]) {
      const agent = start(actions, more)
      await expect(
        agent.handle('drawStoryPicture', {
          agentId: 'aaaaaaaaaaaaaaaa',
          prompt: 'A kite.',
        })
      ).rejects.toThrow('may not do it')
    }
    expect(draw).not.toHaveBeenCalled()
  })

  test('its pictures a day (B-269): past them, refused and logged; a failed one counts too', async () => {
    const agent = start({flipStory: {level: 'ask', picturesPerDay: 2}})
    const picture = () =>
      agent.handle('drawStoryPicture', {
        agentId: 'aaaaaaaaaaaaaaaa',
        prompt: 'A kite.',
      })
    await expect(picture()).resolves.toMatchObject({mediaType: 'image/png'})
    // The service may have drawn and billed it before it failed.
    draw.mockRejectedValueOnce(new Error('service busy'))
    await expect(picture()).rejects.toThrow('service busy')
    await expect(picture()).rejects.toThrow('its 2 pictures a day are reached')
    expect(draw).toHaveBeenCalledTimes(2)
    // A refused key cannot have been billed: given back.
    const other = start({flipStory: {level: 'ask', picturesPerDay: 3}})
    draw.mockRejectedValueOnce(
      new Error('the model answered HTTP 401: invalid key')
    )
    await expect(
      other.handle('drawStoryPicture', {
        agentId: 'aaaaaaaaaaaaaaaa',
        prompt: 'A kite.',
      })
    ).rejects.toThrow('HTTP 401')
    await expect(
      other.handle('drawStoryPicture', {
        agentId: 'aaaaaaaaaaaaaaaa',
        prompt: 'A kite.',
      })
    ).resolves.toMatchObject({mediaType: 'image/png'})
    // A restart keeps the day's count.
    const again = start({flipStory: {level: 'ask', picturesPerDay: 2}})
    await expect(
      again.handle('drawStoryPicture', {
        agentId: 'aaaaaaaaaaaaaaaa',
        prompt: 'A kite.',
      })
    ).rejects.toThrow('its 2 pictures a day are reached')
    // One drawn, the failed one, the refused key and the one after it: none more after the restart.
    expect(draw).toHaveBeenCalledTimes(4)
    const [line] = await agent.handle('activity', {
      agentId: 'aaaaaaaaaaaaaaaa',
    })
    expect(line).toMatchObject({
      action: 'flipImage',
      decision: 'off',
      detail: 'pictures a day reached',
    })
  })

  test('the image model is kept with the agent and travels in its file', async () => {
    const agent = start({flipStory: {level: 'ask'}})
    const {agents} = await agent.handle('agents')
    expect(agents[0].imageModel).toBe('img-1')
    const {text} = await agent.handle('exportAgent', {
      agentId: 'aaaaaaaaaaaaaaaa',
    })
    expect(JSON.parse(text).imageModel).toBe('img-1')
  })
})
