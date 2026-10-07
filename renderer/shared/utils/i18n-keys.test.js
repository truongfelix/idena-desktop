import fs from 'fs'
import path from 'path'

// i18next reads the text before the first ':' of a key as a namespace and shows only the rest ("The node in use
// cannot change it: it runs with 4 MiB" showed "it runs with 4 MiB"). The app's texts with a ':' pass their own
// nsSeparator ('!!' or '|') to t().

/** The whole `t(...)` call starting at `start` (the index of "t("), up to its matching parenthesis. */
function callAt(source, start) {
  let depth = 0
  let quote = null
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
    } else if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start)
}

function callsMissingSeparator() {
  const offenders = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['.next', 'out', 'node_modules'].includes(entry.name)) visit(file)
      } else if (
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.test.js')
      ) {
        const source = fs.readFileSync(file, 'utf8')
        for (const match of source.matchAll(
          /\bt\(\s*(?:(['"`])((?:(?!\1)[^\\]|\\.)*?)\1|risk\.message)/gu
        )) {
          const key = match[2] ?? 'risk.message'
          const isColonText =
            key === 'risk.message' ||
            (key.includes(':') && !key.includes('://'))
          if (
            isColonText &&
            !callAt(source, match.index).includes('nsSeparator')
          ) {
            offenders.push(`${path.basename(file)}: ${key.slice(0, 60)}`)
          }
        }
      }
    }
  }
  visit(path.join(__dirname, '..', '..'))
  return offenders
}

describe('translation keys with a colon', () => {
  it('pass their own namespace separator to t()', () => {
    expect(callsMissingSeparator()).toEqual([])
  })
})

// A text missing from locales/en/translation.json cannot be translated: every language shows it as written.

const ROOT = path.join(__dirname, '..', '..', '..')

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))
}

/** The keys `source` passes to t() as a quoted text (a template literal without `${…}`) or to <Trans i18nKey>. */
function writtenKeys(source) {
  const keys = []
  for (const match of source.matchAll(
    /\bt\(\s*(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/gu
  )) {
    if (!(match[1] === '`' && match[2].includes('${')))
      keys.push(match[2].replace(/\\(['"`\\])/gu, '$1'))
  }
  for (const match of source.matchAll(/\bi18nKey="([^"]*)"/gu))
    keys.push(match[1])
  return keys
}

function keysMissingFromEnglish() {
  const translation = readJson('locales/en/translation.json')
  const error = readJson('locales/en/error.json')
  const missing = new Set()
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['.next', 'out', 'node_modules'].includes(entry.name)) visit(file)
      } else if (
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.test.js')
      ) {
        const source = fs.readFileSync(file, 'utf8')
        // useTranslation(['translation', 'error']): t() also finds the keys of the error namespace.
        const readsErrors = /useTranslation\(\[[^\]]*'error'/u.test(source)
        for (const key of writtenKeys(source)) {
          if (!(key in translation) && !(readsErrors && key in error))
            missing.add(`${path.relative(ROOT, file)}: ${key}`)
        }
      }
    }
  }
  visit(path.join(ROOT, 'renderer'))
  visit(path.join(ROOT, 'main'))
  return [...missing]
}

describe('English texts', () => {
  it('hold every text passed to t() as written', () => {
    expect(keysMissingFromEnglish()).toEqual([])
  })

  it('hold the texts the pages pass to t() from their lists', () => {
    /* eslint-disable global-require */
    const {
      DB_WRITE_BUFFERS,
      IPFS_CONNECTION_CHOICES,
      IPFS_WRITE_BUFFERS,
      PEER_LEVEL_CHOICES,
      WRITE_BUFFER_NOTE,
      restartRisk,
    } = require('../../screens/settings/advanced-settings')
    const {txTypeName, txTypeNames} = require('../../screens/history/utils')
    const {mapVotingStatus} = require('../../screens/oracles/utils')
    const {mapToFriendlyStatus} = require('../providers/identity-context')
    const {EpochPeriod, IdentityStatus, VotingStatus} = require('../types')
    /* eslint-enable global-require */
    const translation = readJson('locales/en/translation.json')

    // `${mib} MiB`: the values the restart dialog lists (pendingNodeOptions).
    const texts = [
      ...DB_WRITE_BUFFERS.flatMap(({mib, label}) => [label, `${mib} MiB`]),
      ...IPFS_WRITE_BUFFERS.flatMap(({mib, label}) => [label, `${mib} MiB`]),
      WRITE_BUFFER_NOTE,
      ...PEER_LEVEL_CHOICES.flatMap(({label, detail}) => [label, detail]),
      // A number (an IPFS connection limit) needs no translation.
      ...IPFS_CONNECTION_CHOICES.map(({label}) => label).filter((label) =>
        Number.isNaN(Number(label))
      ),
      restartRisk(new Date(0), {currentPeriod: EpochPeriod.ShortSession})
        .message,
      restartRisk(new Date(0), {
        currentPeriod: EpochPeriod.None,
        nextValidation: new Date(60 * 1000).toISOString(),
      }).message,
      ...Object.values(txTypeNames),
      txTypeName({type: 'online', payload: '0x'}),
      txTypeName({type: 'online', payload: '0x1'}),
      ...Object.values(VotingStatus).map(mapVotingStatus),
      ...Object.values(IdentityStatus).map(mapToFriendlyStatus),
    ]

    expect(
      [...new Set(texts)].filter((text) => !(text in translation))
    ).toEqual([])
  })
})
