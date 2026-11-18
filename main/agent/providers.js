const axios = require('axios')
const {fillSlots} = require('./app-parts')
const {searchesOf} = require('./internet')

// The agent's calls to its model: an OpenAI-compatible chat server (on this computer, as Ollama, LM Studio or
// llama.cpp serve, or a hosted service) or the Anthropic Messages API. One request per question, no redirects
// (the key goes to the address the user typed, nowhere else), and an error never carries the request (its
// headers hold the key).

const ANTHROPIC_VERSION = '2023-06-01'
// The longest answer asked of an Anthropic model when neither the person nor the task sets one: a cap, not a cost
// (only what it writes is billed). On a model whose thinking cannot be turned off, its thinking counts in it too.
const ANTHROPIC_MAX_TOKENS = 4096
/** The efforts an OpenAI-compatible service takes; the two above high are sent as high. */
const OPENAI_EFFORTS = ['low', 'medium', 'high']
const MAX_REPLY_BYTES = 1024 * 1024
// A picture comes back in base64 in the JSON: a 1024x1024 PNG is a few MB.
const MAX_IMAGE_REPLY_BYTES = 25 * 1024 * 1024
const MAX_IMAGE_PROMPT = 4000
const MAX_ERROR_TEXT = 200
/** How many times a turn the service paused (its tools' loop, B-294) is sent again to go on. */
const MAX_RESUMES = 3

const LOOPBACK_HOSTS = new Set(['localhost', '[::1]'])

function isLoopbackHost(hostname) {
  if (LOOPBACK_HOSTS.has(hostname)) return true
  return /^127(\.\d{1,3}){3}$/u.test(hostname)
}

/**
 * The provider's base address, checked: "local" must be on this computer (http allowed there), a hosted one https.
 * No user name or password in it. Throws on a refused address.
 */
function checkAddress(provider, address) {
  let url
  try {
    url = new URL(String(address || ''))
  } catch {
    throw new Error('invalid address')
  }
  if (url.username || url.password)
    throw new Error('the address cannot hold a name or password')
  if (url.search || url.hash) throw new Error('invalid address')
  if (provider === 'local') {
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('invalid address')
    if (!isLoopbackHost(url.hostname))
      throw new Error('a local model must run on this computer')
  } else if (url.protocol !== 'https:') {
    throw new Error('a hosted model needs an https address')
  }
  return url.href.replace(/\/+$/u, '')
}

/** OpenAI's own API wants `max_completion_tokens` (its reasoning models refuse `max_tokens`); others `max_tokens`. */
function isOpenAiApi(address) {
  try {
    return new URL(address).hostname === 'api.openai.com'
  } catch {
    return false
  }
}

/** The person's limits for an OpenAI-compatible service, only those set: the service's defaults stay otherwise. */
function openAiLimits(base, {maxTokens, effort}) {
  const limits = {}
  if (maxTokens)
    limits[isOpenAiApi(base) ? 'max_completion_tokens' : 'max_tokens'] =
      maxTokens
  if (effort)
    limits.reasoning_effort = OPENAI_EFFORTS.includes(effort) ? effort : 'high'
  return limits
}

function openAiBody(model, system, parts) {
  return {
    model,
    messages: [
      {role: 'system', content: system},
      {
        role: 'user',
        content: parts.map((part) =>
          part.type === 'image'
            ? {
                type: 'image_url',
                image_url: {url: `data:${part.mediaType};base64,${part.data}`},
              }
            : {type: 'text', text: part.text}
        ),
      },
    ],
  }
}

function anthropicBody(model, system, parts, maxTokens, effort, tools) {
  return {
    model,
    max_tokens: maxTokens || ANTHROPIC_MAX_TOKENS,
    ...(effort ? {output_config: {effort}} : {}),
    // Its internet tools (B-294), only when it may search.
    ...(tools && tools.length ? {tools} : {}),
    system,
    messages: [
      {
        role: 'user',
        content: parts.map((part) =>
          part.type === 'image'
            ? {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: part.mediaType,
                  data: part.data,
                },
              }
            : {type: 'text', text: part.text}
        ),
      },
    ],
  }
}

/** The text of a reply, whichever shape the server gave it. */
function replyText(provider, data) {
  if (provider === 'anthropic') {
    const all = Array.isArray(data && data.content) ? data.content : []
    // After a search (B-294), only what follows its last result: the words before it ("Let me look that up") are no
    // part of the answer, whose format the app reads.
    const last = all.reduce(
      (at, block, i) =>
        block && /_tool_result$/u.test(String(block.type)) ? i : at,
      -1
    )
    const blocks = all.slice(last + 1)
    return blocks
      .filter((block) => block && block.type === 'text')
      .map((block) => block.text)
      .join('')
  }
  const content = data && data.choices && data.choices[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
  return ''
}

/**
 * The request for one question: url, headers and body, before it is sent. The config's `maxTokens` and `effort` are
 * the agent's (B-265: null and '' when the person set none); the option `maxTokens` is the task's own longest answer
 * for an Anthropic model (a story's four prompts need more than a flip's JSON), sent only when the agent has none:
 * the person's setting is the limit for every task, as on the other services.
 */
function buildRequest(
  {provider, address, model, key, maxTokens: agentMaxTokens, effort},
  system,
  parts,
  {maxTokens, tools} = {}
) {
  const base = checkAddress(provider, address)
  if (!model) throw new Error('no model chosen')
  if (provider !== 'local' && !key) throw new Error('no key kept')
  if (provider === 'anthropic') {
    return {
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': key,
      },
      body: anthropicBody(
        model,
        system,
        parts,
        agentMaxTokens || maxTokens,
        effort,
        tools
      ),
    }
  }
  const headers = {'content-type': 'application/json'}
  if (key) headers.authorization = `Bearer ${key}`
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      ...openAiBody(model, system, parts),
      ...openAiLimits(base, {maxTokens: agentMaxTokens, effort}),
    },
  }
}

/**
 * Why the model stopped, when that makes its answer unusable (B-265): 'cut' (it reached the longest answer: a
 * reply cut in the middle, or empty when its thinking took it all), 'refused' (the service or the model declined).
 * null for an answer that ended by itself.
 */
function stopProblem(provider, data) {
  if (provider === 'anthropic') {
    const stop = data && data.stop_reason
    if (stop === 'max_tokens' || stop === 'model_context_window_exceeded')
      return 'cut'
    if (stop === 'refusal') return 'refused'
    return null
  }
  const reason = data && data.choices && data.choices[0]?.finish_reason
  if (reason === 'length') return 'cut'
  if (reason === 'content_filter') return 'refused'
  return null
}

/** The error for an unusable stop, in words for Activity. */
function stopError(problem, limit) {
  if (problem === 'refused') return new Error('the model refused to answer')
  return new Error(
    limit
      ? `the answer was cut short: it reached the longest answer (${limit} tokens)`
      : 'the answer was cut short by the service'
  )
}

/** A provider's error, as text for the user: its status and its own message, never the request. */
function providerError(error) {
  if (axios.isCancel(error) || error?.code === 'ERR_CANCELED')
    return new Error('no answer before the deadline')
  if (error?.code === 'ECONNABORTED')
    return new Error('no answer before the deadline')
  const status = error?.response?.status
  if (status) {
    const {data} = error.response
    const text = String(data?.error?.message || data?.message || '').slice(
      0,
      MAX_ERROR_TEXT
    )
    return new Error(
      `the model answered HTTP ${status}${text ? `: ${text}` : ''}`
    )
  }
  return new Error(`the model cannot be reached (${error?.code || 'no reply'})`)
}

/**
 * One question to the model: a system text and the user's parts (text, or image with mediaType and base64 data).
 * Resolves with the reply's text. `timeoutMs` ends it, as does `signal`. `tools`: an Anthropic request's internet
 * tools (B-294); `onSearches(n)` is told the searches each request of the answer made (each one is billed), also
 * when a later one fails.
 */
async function ask(
  config,
  system,
  parts,
  {
    timeoutMs,
    signal,
    maxTokens,
    tools,
    onSearches = () => {},
    request = axios.request,
  } = {}
) {
  const {url, headers, body} = buildRequest(config, system, parts, {
    maxTokens,
    tools: config.provider === 'anthropic' ? tools : undefined,
  })
  const send = async (data) => {
    try {
      return await request({
        method: 'post',
        url,
        headers,
        data,
        timeout: timeoutMs,
        signal,
        maxRedirects: 0,
        maxContentLength: MAX_REPLY_BYTES,
        responseType: 'json',
      })
    } catch (error) {
      // Stopped by the app (the agent paused, the test stopped): not the model's fault, nor a deadline.
      if (signal && signal.aborted) throw new Error('stopped')
      throw providerError(error)
    }
  }
  let response = await send(body)
  if (config.provider === 'anthropic') onSearches(searchesOf(response.data))
  // A turn the service paused in its tools' loop goes on when its answer so far is sent back as it came.
  for (
    let resumes = 0;
    config.provider === 'anthropic' &&
    response.data &&
    response.data.stop_reason === 'pause_turn';
    resumes += 1
  ) {
    if (resumes >= MAX_RESUMES)
      throw new Error('the model searched too long without an answer')
    const messages = [
      ...body.messages,
      {role: 'assistant', content: response.data.content},
    ]
    // eslint-disable-next-line no-await-in-loop
    response = await send({...body, messages})
    onSearches(searchesOf(response.data))
  }
  const problem = stopProblem(config.provider, response.data)
  if (problem)
    throw stopError(problem, body.max_tokens || body.max_completion_tokens)
  return replyText(config.provider, response.data)
}

/**
 * The request for one picture (B-236): an OpenAI-compatible images endpoint, on the agent's own service and key, with
 * its image model. The Anthropic API draws no pictures. `texts`: the agent's own words for it (B-285): `imagePrompt`
 * around the prompt (its slot `{{prompt}}`; without one the prompt goes at its end), `imageSize` the size asked.
 */
const IMAGE_PROMPT = '{{prompt}}'
const IMAGE_SIZE = '1024x1024'

/** The prompt as sent: in the agent's own words when it has some, the prompt cut to the room they leave. */
function imagePrompt(prompt, own) {
  const asked = String(prompt || '')
  if (!own) return asked.slice(0, MAX_IMAGE_PROMPT)
  const fill = (value) =>
    fillSlots(own, {prompt: value}, {required: ['prompt'], drop: false})
  // The words alone, and the two line breaks before a prompt that has no slot.
  const room =
    MAX_IMAGE_PROMPT - fill('').length - (own.includes('{{prompt}}') ? 0 : 2)
  return fill(asked.slice(0, Math.max(0, room))).slice(0, MAX_IMAGE_PROMPT)
}

function buildImageRequest(
  {provider, address, imageModel, key},
  prompt,
  texts = null
) {
  if (provider === 'anthropic')
    throw new Error('this service draws no pictures')
  const base = checkAddress(provider, address)
  if (!imageModel) throw new Error('no image model chosen')
  if (provider !== 'local' && !key) throw new Error('no key kept')
  const headers = {'content-type': 'application/json'}
  if (key) headers.authorization = `Bearer ${key}`
  return {
    url: `${base}/images/generations`,
    headers,
    body: {
      model: imageModel,
      prompt: imagePrompt(prompt, texts && texts.imagePrompt),
      n: 1,
      size: (texts && texts.imageSize && texts.imageSize.trim()) || IMAGE_SIZE,
    },
  }
}

/**
 * One picture from the prompt: {mediaType, data} (base64 PNG, JPEG or WebP). Only a picture sent in the answer is
 * taken (`b64_json`): a link would be a second request to an address the service chose.
 */
async function drawImage(
  config,
  prompt,
  {timeoutMs, signal, request = axios.request, mediaTypeOf, texts} = {}
) {
  const {url, headers, body} = buildImageRequest(config, prompt, texts)
  let response
  try {
    response = await request({
      method: 'post',
      url,
      headers,
      data: body,
      timeout: timeoutMs,
      signal,
      maxRedirects: 0,
      maxContentLength: MAX_IMAGE_REPLY_BYTES,
      maxBodyLength: MAX_IMAGE_REPLY_BYTES,
      responseType: 'json',
    })
  } catch (error) {
    if (signal && signal.aborted) throw new Error('stopped')
    throw providerError(error)
  }
  const first = Array.isArray(response.data?.data)
    ? response.data.data[0]
    : null
  if (!first || typeof first.b64_json !== 'string') {
    throw new Error(
      first && first.url
        ? 'the service sent a link, not a picture'
        : 'the service sent no picture'
    )
  }
  const bytes = Buffer.from(first.b64_json, 'base64')
  const type = mediaTypeOf ? mediaTypeOf(bytes) : null
  if (!type) throw new Error('the service sent no picture')
  return {mediaType: type, data: bytes.toString('base64')}
}

module.exports = {
  IMAGE_PROMPT,
  IMAGE_SIZE,
  ask,
  buildImageRequest,
  buildRequest,
  checkAddress,
  drawImage,
  replyText,
  providerError,
  stopProblem,
}
