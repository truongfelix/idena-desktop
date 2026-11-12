const {ask, buildRequest, checkAddress, replyText} = require('./providers')

const parts = [
  {type: 'text', text: 'Which order?'},
  {type: 'image', mediaType: 'image/png', data: 'iVBORw0K'},
]

describe('agent provider addresses', () => {
  test('a local model must run on this computer', () => {
    expect(checkAddress('local', 'http://127.0.0.1:11434/v1/')).toBe(
      'http://127.0.0.1:11434/v1'
    )
    expect(checkAddress('local', 'http://localhost:1234/v1')).toBe(
      'http://localhost:1234/v1'
    )
    expect(checkAddress('local', 'http://[::1]:8080')).toBe('http://[::1]:8080')
    for (const address of [
      'http://192.168.1.10:11434/v1',
      'http://127.0.0.1.example.com/v1',
      'http://localhost.example.com/v1',
      'file:///etc/passwd',
    ])
      expect(() => checkAddress('local', address)).toThrow()
  })

  test('a hosted model needs https, with no name or password', () => {
    expect(checkAddress('openai', 'https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1'
    )
    expect(() => checkAddress('openai', 'http://api.openai.com/v1')).toThrow(
      'https'
    )
    expect(() =>
      checkAddress('anthropic', 'https://user:pw@api.anthropic.com')
    ).toThrow('name or password')
    expect(() => checkAddress('openai', 'https://x.test/v1?key=1')).toThrow()
    expect(() => checkAddress('openai', 'not an address')).toThrow()
  })
})

describe('agent provider requests', () => {
  test('OpenAI-compatible: chat completions, pictures as data addresses', () => {
    const request = buildRequest(
      {provider: 'openai', address: 'https://x.test/v1', model: 'm', key: 'sk'},
      'system',
      parts
    )
    expect(request.url).toBe('https://x.test/v1/chat/completions')
    expect(request.headers.authorization).toBe('Bearer sk')
    expect(request.body.messages[0]).toEqual({
      role: 'system',
      content: 'system',
    })
    expect(request.body.messages[1].content[1]).toEqual({
      type: 'image_url',
      image_url: {url: 'data:image/png;base64,iVBORw0K'},
    })
  })

  test('a local server without a key sends no authorization', () => {
    const request = buildRequest(
      {provider: 'local', address: 'http://127.0.0.1:11434/v1', model: 'm'},
      's',
      parts
    )
    expect(request.headers).not.toHaveProperty('authorization')
  })

  test('Anthropic: messages, base64 pictures, its key header', () => {
    const request = buildRequest(
      {
        provider: 'anthropic',
        address: 'https://api.anthropic.com',
        model: 'claude-x',
        key: 'sk-ant',
      },
      'system',
      parts
    )
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers['x-api-key']).toBe('sk-ant')
    expect(request.headers['anthropic-version']).toBeTruthy()
    expect(request.body.system).toBe('system')
    expect(request.body.messages[0].content[1]).toEqual({
      type: 'image',
      source: {type: 'base64', media_type: 'image/png', data: 'iVBORw0K'},
    })
  })

  test('a hosted model without a key or a model is not asked', () => {
    expect(() =>
      buildRequest(
        {provider: 'openai', address: 'https://x.test', model: 'm'},
        's',
        parts
      )
    ).toThrow('no key')
    expect(() =>
      buildRequest(
        {provider: 'local', address: 'http://127.0.0.1', model: ''},
        's',
        parts
      )
    ).toThrow('no model')
  })

  test('reply text from each shape', () => {
    expect(replyText('openai', {choices: [{message: {content: 'left'}}]})).toBe(
      'left'
    )
    expect(
      replyText('openai', {
        choices: [{message: {content: [{type: 'text', text: 'ri'}, 'ght']}}],
      })
    ).toBe('right')
    expect(
      replyText('anthropic', {
        content: [
          {type: 'thinking', thinking: 'x'},
          {type: 'text', text: '{"a":1}'},
        ],
      })
    ).toBe('{"a":1}')
    expect(replyText('openai', {})).toBe('')
  })
})

describe('agent provider calls', () => {
  const config = {
    provider: 'anthropic',
    address: 'https://api.anthropic.com',
    model: 'claude-x',
    key: 'sk-ant-secret',
  }

  test('no redirects, the deadline passed on', async () => {
    const request = jest.fn().mockResolvedValue({
      data: {content: [{type: 'text', text: 'ok'}]},
    })
    await expect(
      ask(config, 's', parts, {timeoutMs: 5000, request})
    ).resolves.toBe('ok')
    expect(request.mock.calls[0][0]).toMatchObject({
      maxRedirects: 0,
      timeout: 5000,
    })
  })

  test('an error says the status and the message, never the key', async () => {
    const error = Object.assign(new Error('Request failed'), {
      config: {headers: {'x-api-key': config.key}},
      response: {status: 401, data: {error: {message: 'invalid x-api-key'}}},
    })
    const request = jest.fn().mockRejectedValue(error)
    const thrown = await ask(config, 's', parts, {request}).catch((e) => e)
    expect(thrown.message).toBe(
      'the model answered HTTP 401: invalid x-api-key'
    )
    expect(JSON.stringify(thrown)).not.toContain(config.key)
    expect(thrown).not.toHaveProperty('config')
  })

  test('a timeout or an abort reads as no answer in time', async () => {
    for (const code of ['ECONNABORTED', 'ERR_CANCELED']) {
      const request = jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('x'), {code}))
      // eslint-disable-next-line no-await-in-loop
      await expect(ask(config, 's', parts, {request})).rejects.toThrow(
        'no answer before the deadline'
      )
    }
  })
})
