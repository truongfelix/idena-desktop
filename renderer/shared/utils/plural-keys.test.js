import fs from 'fs'
import path from 'path'
import i18next from 'i18next'

// The locales hold i18next's v4 plural keys: key_<category> for the categories of the language's Intl.PluralRules
// (one, few, many, other, ...), and key_zero where the text at 0 differs from its category's. i18next 27 reads no
// other plural key: a v3 key (key_plural, key_0, key_1, ...) would be shown as the singular or the English text.

const locales = path.join(__dirname, '..', '..', '..', 'locales')
const langs = fs.readdirSync(locales)
const read = (lang, ns) =>
  JSON.parse(fs.readFileSync(path.join(locales, lang, `${ns}.json`)))

function instance(lng) {
  const i = i18next.createInstance()
  const resources = {}
  for (const l of langs) resources[l] = {translation: read(l, 'translation')}
  // The renderer's and the main process's options (renderer/i18n.js, main/language.js).
  i.init({
    lng,
    resources,
    fallbackLng: 'en',
    keySeparator: false,
    missingInterpolationHandler: () => '',
    interpolation: {escapeValue: false},
    initAsync: false,
  })
  return i
}

describe('plural texts', () => {
  it('use no v3 plural key in any language', () => {
    const v3 = []
    for (const lang of langs)
      for (const ns of ['translation', 'error'])
        v3.push(
          ...Object.keys(read(lang, ns))
            .filter((key) => /_(plural|\d+)$/.test(key))
            .map((key) => `${lang}/${ns}: ${key}`)
        )
    expect(v3).toEqual([])
  })

  it('use only the categories of their language', () => {
    const wrong = []
    for (const lang of langs) {
      const categories = new Set([
        ...new Intl.PluralRules(lang).resolvedOptions().pluralCategories,
        'zero',
      ])
      for (const key of Object.keys(read(lang, 'translation'))) {
        const m = key.match(/\{\{count\}\}.*_([a-z]+)$/)
        if (m && !categories.has(m[1])) wrong.push(`${lang}: ${key}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it.each([
    ['en', '{{count}} votes', 1, '1 vote'],
    ['en', '{{count}} votes', 2, '2 votes'],
    ['en', '{{count}} votes', 0, '0 votes'],
    ['fr', '{{count}} votes', 0, '0 vote'],
    ['fr', '{{count}} votes', 2, '2 votes'],
    ['ru', '{{count}} votes', 1, '1 голос'],
    ['ru', '{{count}} votes', 3, '3 голоса'],
    ['ru', '{{count}} votes', 5, '5 голосов'],
    ['ru', '{{count}} votes', 21, '21 голос'],
    [
      'tr',
      'Create {{count}} required flips',
      0,
      'Gerekli 0 anahtarlamayı oluştur',
    ],
    [
      'tr',
      'Create {{count}} required flips',
      2,
      'Gerekli 2 anahtarlamaları oluştur',
    ],
    ['ja', '{{count}} votes', 3, '3 件の投票'],
  ])('%s: %s at %d reads %s', (lng, key, count, text) => {
    expect(instance(lng).t(key, {count})).toBe(text)
  })
})

describe('the variables of a translation', () => {
  // i18next shows a variable the call does not pass as nothing (missingInterpolationHandler): a translation that
  // names another variable than the English text loses its value ("{{remainingrequiredflipps}}" in Chinese).
  const names = (text) =>
    [...String(text || '').matchAll(/\{\{\s*([^}\s,]+)/g)].map((m) => m[1])

  it('are among the English text’s', () => {
    const en = read('en', 'translation')
    const wrong = []
    for (const lang of langs)
      for (const [key, text] of Object.entries(read(lang, 'translation'))) {
        const base = key.replace(/_(zero|one|two|few|many|other)$/, '')
        const known = new Set([
          ...names(base),
          ...names(en[key]),
          ...names(en[base]),
        ])
        const unknown = names(text).filter((name) => !known.has(name))
        if (unknown.length) wrong.push(`${lang}: ${key} -> ${unknown}`)
      }
    expect(wrong).toEqual([])
  })

  it('read as nothing when the call does not pass them', () => {
    expect(instance('en').t('Epoch #{{epoch}}')).toBe('Epoch #')
  })

  it('read as nothing in the app too: both processes set the handler', () => {
    const root = path.join(__dirname, '..', '..', '..')
    const missing = ['renderer/i18n.js', 'main/language.js'].filter(
      (file) =>
        !fs
          .readFileSync(path.join(root, file), 'utf8')
          .includes("missingInterpolationHandler: () => '',")
    )
    expect(missing).toEqual([])
  })
})
