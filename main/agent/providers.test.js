const {
  ask,
  buildRequest,
  checkAddress,
  replyText,
  stopProblem,
} = require('./providers')

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

  const anthropic = {
    provider: 'anthropic',
    address: 'https://api.anthropic.com',
    model: 'claude-x',
    key: 'sk-ant',
  }

  test("Anthropic: the agent's longest answer over the task's, its effort when set (B-265)", () => {
    const plain = buildRequest(anthropic, 's', parts).body
    expect(plain.max_tokens).toBe(4096)
    expect(plain).not.toHaveProperty('output_config')
    expect(
      buildRequest(anthropic, 's', parts, {maxTokens: 8000}).body
    ).toMatchObject({max_tokens: 8000})
    const set = buildRequest(
      {...anthropic, maxTokens: 1500, effort: 'low'},
      's',
      parts,
      {maxTokens: 8000}
    ).body
    // The person's setting is the limit, for a story or a plan too: the task's own room is for an agent without one.
    expect(set.max_tokens).toBe(1500)
    expect(set.output_config).toEqual({effort: 'low'})
    expect(
      buildRequest({...anthropic, maxTokens: 1500}, 's', parts).body.max_tokens
    ).toBe(1500)
  })

  test('OpenAI-compatible: nothing added unless set; OpenAI itself takes max_completion_tokens (B-265)', () => {
    const openai = {
      provider: 'openai',
      address: 'https://api.openai.com/v1',
      model: 'm',
      key: 'sk',
    }
    const plain = buildRequest(openai, 's', parts, {maxTokens: 8000}).body
    expect(plain).not.toHaveProperty('max_tokens')
    expect(plain).not.toHaveProperty('max_completion_tokens')
    expect(plain).not.toHaveProperty('reasoning_effort')
    expect(
      buildRequest({...openai, maxTokens: 300, effort: 'medium'}, 's', parts)
        .body
    ).toMatchObject({max_completion_tokens: 300, reasoning_effort: 'medium'})
    const local = buildRequest(
      {
        provider: 'local',
        address: 'http://127.0.0.1:11434/v1',
        model: 'm',
        maxTokens: 300,
        effort: 'max',
      },
      's',
      parts
    ).body
    // Another server reads max_tokens; the efforts above high are sent as high.
    expect(local).toMatchObject({max_tokens: 300, reasoning_effort: 'high'})
    expect(local).not.toHaveProperty('max_completion_tokens')
  })

  test('why the model stopped: cut, refused, or nothing to say (B-265)', () => {
    expect(stopProblem('anthropic', {stop_reason: 'max_tokens'})).toBe('cut')
    expect(stopProblem('anthropic', {stop_reason: 'refusal'})).toBe('refused')
    expect(
      stopProblem('anthropic', {stop_reason: 'model_context_window_exceeded'})
    ).toBe('cut')
    expect(stopProblem('anthropic', {stop_reason: 'end_turn'})).toBeNull()
    expect(stopProblem('anthropic', {})).toBeNull()
    expect(stopProblem('openai', {choices: [{finish_reason: 'length'}]})).toBe(
      'cut'
    )
    expect(
      stopProblem('local', {choices: [{finish_reason: 'content_filter'}]})
    ).toBe('refused')
    expect(
      stopProblem('local', {choices: [{finish_reason: 'stop'}]})
    ).toBeNull()
    expect(stopProblem('openai', null)).toBeNull()
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
    // The clock stands still: a loaded PC lets milliseconds pass before the request is built (B-304).
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      await expect(
        ask(config, 's', parts, {timeoutMs: 5000, request})
      ).resolves.toBe('ok')
    } finally {
      now.mockRestore()
    }
    expect(request.mock.calls[0][0]).toMatchObject({
      maxRedirects: 0,
      timeout: 5000,
    })
  })

  test('a cut or refused answer is an error, with the limit it reached (B-265)', async () => {
    const reply = (data) => jest.fn().mockResolvedValue({data})
    await expect(
      ask({...config, maxTokens: 50}, 's', parts, {
        request: reply({
          stop_reason: 'max_tokens',
          content: [{type: 'text', text: 'The answer is'}],
        }),
      })
    ).rejects.toThrow(
      'the answer was cut short: it reached the longest answer (50 tokens)'
    )
    await expect(
      ask(config, 's', parts, {
        request: reply({stop_reason: 'refusal', content: []}),
      })
    ).rejects.toThrow('the model refused to answer')
    await expect(
      ask(
        {provider: 'local', address: 'http://127.0.0.1:1/v1', model: 'm'},
        's',
        parts,
        {
          request: reply({
            choices: [{finish_reason: 'length', message: {content: 'x'}}],
          }),
        }
      )
    ).rejects.toThrow('the answer was cut short by the service')
    await expect(
      ask(config, 's', parts, {
        request: reply({
          stop_reason: 'end_turn',
          content: [{type: 'text', text: 'ok'}],
        }),
      })
    ).resolves.toBe('ok')
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

  test('stopped by the app reads as stopped, not as a deadline', async () => {
    const controller = new AbortController()
    controller.abort()
    const request = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('x'), {code: 'ERR_CANCELED'}))
    await expect(
      ask(config, 's', parts, {request, signal: controller.signal})
    ).rejects.toThrow(/^stopped$/u)
  })
})
