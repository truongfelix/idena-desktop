#!/usr/bin/env node

// Starts the packaged app (electron-builder's unpacked output in dist/) with a new profile and waits until its
// built-in node answers an RPC call, then quits it: shows on each release runner that the app starts and runs the
// node it carries. Linux needs a display (xvfb-run -a) and gets a temporary XDG_CONFIG_HOME. On macOS and Windows
// the app uses the user's data folder, so outside CI the script refuses to run when that folder exists.
// Usage: node scripts/smoke-packaged-app.js [timeout seconds]

const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawn, spawnSync} = require('child_process')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const PRODUCT_NAME = 'Idena'
const DEFAULT_RPC_PORT = 9119

function findApp(platform = process.platform) {
  if (platform === 'linux') {
    return path.join(DIST, 'linux-unpacked', 'idena-desktop')
  }
  if (platform === 'win32') {
    return path.join(DIST, 'win-unpacked', `${PRODUCT_NAME}.exe`)
  }
  if (platform === 'darwin') {
    const dir = fs
      .readdirSync(DIST)
      .find((name) =>
        fs.existsSync(path.join(DIST, name, `${PRODUCT_NAME}.app`))
      )
    if (!dir) throw new Error(`no ${PRODUCT_NAME}.app under ${DIST}`)
    return path.join(
      DIST,
      dir,
      `${PRODUCT_NAME}.app`,
      'Contents',
      'MacOS',
      PRODUCT_NAME
    )
  }
  throw new Error(`unsupported platform ${platform}`)
}

// The folder Electron gives app.getPath('userData') for this product.
function userDataDir(env = process.env, platform = process.platform) {
  if (platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      PRODUCT_NAME
    )
  }
  if (platform === 'win32') {
    return path.join(env.APPDATA, PRODUCT_NAME)
  }
  return path.join(
    env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    PRODUCT_NAME
  )
}

function rpcPort(dataDir) {
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8')
    )
    return Number(settings.internalPort) || DEFAULT_RPC_PORT
  } catch {
    return DEFAULT_RPC_PORT
  }
}

async function nodeAnswers(dataDir) {
  const keyFile = path.join(dataDir, 'node', 'datadir', 'api.key')
  if (!fs.existsSync(keyFile)) return null
  const key = fs.readFileSync(keyFile, 'utf8').trim()
  try {
    const response = await fetch(`http://127.0.0.1:${rpcPort(dataDir)}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({method: 'bcn_syncing', params: [], id: 1, key}),
      signal: AbortSignal.timeout(5000),
    })
    const body = await response.json()
    return body && body.result ? body.result : null
  } catch {
    return null
  }
}

function stopApp(child) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'])
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

async function main() {
  const timeoutMs = Number(process.argv[2] || 300) * 1000
  const env = {...process.env}
  if (process.platform === 'linux') {
    env.XDG_CONFIG_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'idena-smoke-'))
  }
  const dataDir = userDataDir(env)
  if (!process.env.CI && fs.existsSync(dataDir)) {
    throw new Error(`${dataDir} exists: the smoke test runs on a new profile`)
  }

  const app = findApp()
  const args = process.platform === 'linux' ? ['--no-sandbox'] : []
  console.log(`starting ${app}, data in ${dataDir}`)
  const child = spawn(app, args, {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: process.platform !== 'win32',
  })
  let exited = false
  child.on('exit', (code, signal) => {
    exited = true
    console.log(`app exited (code ${code}, signal ${signal})`)
  })

  const deadline = Date.now() + timeoutMs
  let result = null
  while (!exited && Date.now() < deadline && !result) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 3000)
    })
    // eslint-disable-next-line no-await-in-loop
    result = await nodeAnswers(dataDir)
  }
  stopApp(child)

  if (!result) {
    throw new Error(
      exited
        ? 'the app exited before its node answered'
        : `the node did not answer within ${timeoutMs / 1000} s`
    )
  }
  console.log(`the built-in node answers: ${JSON.stringify(result)}`)
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`[smoke] ${error.message}`)
      process.exit(1)
    })
}

module.exports = {findApp, userDataDir}
