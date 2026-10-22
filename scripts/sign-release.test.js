const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')

const script = path.join(__dirname, 'sign-release.sh')

// The release key's keyring, with no passphrase: gpg reads it from the keyring's own gpg.conf, so the script runs
// as it does for the developer, without a test switch.
function makeKeyring(root, name) {
  const home = path.join(root, name)
  fs.mkdirSync(home, {mode: 0o700})
  fs.writeFileSync(
    path.join(home, 'gpg.conf'),
    'batch\npinentry-mode loopback\npassphrase \n'
  )
  return home
}

function run(args, {home, publicKey}) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      IDENA_RELEASE_GNUPGHOME: home,
      IDENA_RELEASE_PUBLIC_KEY: publicKey,
    },
  })
}

function makeRelease(root, name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'idena-client-linux-1.0.0.deb'), 'deb')
  fs.writeFileSync(path.join(dir, 'idena-client-win-1.0.0.exe'), 'exe')
  spawnSync('bash', ['-c', 'sha256sum -- * > SHA256SUMS.txt'], {cwd: dir})
  return dir
}

function verifies(publicKey, file) {
  const keyring = `${publicKey}.gpg`
  spawnSync('bash', ['-c', `gpg --dearmor < "${publicKey}" > "${keyring}"`])
  return (
    spawnSync('gpgv', ['--keyring', keyring, `${file}.asc`, file]).status === 0
  )
}

const linux = process.platform === 'linux' ? describe : describe.skip

linux('sign-release.sh', () => {
  let root
  let home
  let publicKey
  const homes = []

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-release-'))
    home = makeKeyring(root, 'keys')
    homes.push(home)
    publicKey = path.join(root, 'release-signing-key.asc')
    const made = run(['new-key'], {home, publicKey})
    expect({status: made.status, stderr: made.stderr}).toMatchObject({
      status: 0,
    })
  })

  afterAll(() => {
    for (const h of homes)
      spawnSync('gpgconf', ['--homedir', h, '--kill', 'gpg-agent'])
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('makes the key once and writes its public half', () => {
    expect(fs.readFileSync(publicKey, 'utf8')).toContain(
      'BEGIN PGP PUBLIC KEY BLOCK'
    )
    const again = run(['new-key'], {home, publicKey})
    expect(again.status).toBe(1)
    expect(again.stderr).toContain('exists already')
  })

  it('signs the list and the .deb with the published key', () => {
    const dir = makeRelease(root, 'good')
    const signed = run(['sign-dir', dir], {home, publicKey})
    expect(signed.status).toBe(0)
    expect(verifies(publicKey, path.join(dir, 'SHA256SUMS.txt'))).toBe(true)
    expect(
      verifies(publicKey, path.join(dir, 'idena-client-linux-1.0.0.deb'))
    ).toBe(true)
    expect(
      fs.existsSync(path.join(dir, 'idena-client-win-1.0.0.exe.asc'))
    ).toBe(false)
  })

  it('refuses a .deb that does not match the list', () => {
    const dir = makeRelease(root, 'changed')
    fs.writeFileSync(path.join(dir, 'idena-client-linux-1.0.0.deb'), 'other')
    const signed = run(['sign-dir', dir], {home, publicKey})
    expect(signed.status).toBe(1)
    expect(signed.stderr).toContain('does not match SHA256SUMS.txt')
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.asc'))).toEqual([])
  })

  it('refuses a .deb the list does not name', () => {
    const dir = makeRelease(root, 'unlisted')
    fs.writeFileSync(path.join(dir, 'idena-client-linux-1.0.1.deb'), 'deb')
    const signed = run(['sign-dir', dir], {home, publicKey})
    expect(signed.status).toBe(1)
    expect(signed.stderr).toContain(
      'has no line for idena-client-linux-1.0.1.deb'
    )
  })

  it('refuses to sign with a key other than the published one', () => {
    const other = makeKeyring(root, 'other-keys')
    homes.push(other)
    const otherPublic = path.join(root, 'other.asc')
    expect(run(['new-key'], {home: other, publicKey: otherPublic}).status).toBe(
      0
    )
    const dir = makeRelease(root, 'wrong-key')
    const signed = run(['sign-dir', dir], {home: other, publicKey})
    expect(signed.status).toBe(1)
    expect(signed.stderr).toContain('holds no secret key for')
  })
})
