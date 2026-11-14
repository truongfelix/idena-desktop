const axios = require('axios')

// The agent's calls to its model: an OpenAI-compatible chat server (on this computer, as Ollama, LM Studio or
// llama.cpp serve, or a hosted service) or the Anthropic Messages API. One request per question, no redirects
// (the key goes to the address the user typed, nowhere else), and an error never carries the request (its
// headers hold the key).

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_MAX_TOKENS = 1024
const MAX_REPLY_BYTES = 1024 * 1024
const MAX_ERROR_TEXT = 200

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

function anthropicBody(model, system, parts) {
  return {
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
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
    const blocks = Array.isArray(data && data.content) ? data.content : []
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

/** The request for one question: url, headers and body, before it is sent. */
function buildRequest({provider, address, model, key}, system, parts) {
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
      body: anthropicBody(model, system, parts),
    }
  }
  const headers = {'content-type': 'application/json'}
  if (key) headers.authorization = `Bearer ${key}`
  return {
    url: `${base}/chat/completions`,
    headers,
    body: openAiBody(model, system, parts),
  }
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
 * Resolves with the reply's text. `timeoutMs` ends it, as does `signal`.
 */
async function ask(
  config,
  system,
  parts,
  {timeoutMs, signal, request = axios.request} = {}
) {
  const {url, headers, body} = buildRequest(config, system, parts)
  try {
    const response = await request({
      method: 'post',
      url,
      headers,
      data: body,
      timeout: timeoutMs,
      signal,
      maxRedirects: 0,
      maxContentLength: MAX_REPLY_BYTES,
      responseType: 'json',
    })
    return replyText(config.provider, response.data)
  } catch (error) {
    // Stopped by the app (the agent paused, the test stopped): not the model's fault, nor a deadline.
    if (signal && signal.aborted) throw new Error('stopped')
    throw providerError(error)
  }
}

module.exports = {ask, buildRequest, checkAddress, replyText, providerError}
