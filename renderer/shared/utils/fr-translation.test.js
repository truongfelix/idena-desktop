import fs from 'fs'
import path from 'path'

// The French interface is whole: every English text has a French one, in French, with the English text's
// placeholders and tags. A text that reads the same in both languages is listed in SAME_IN_FRENCH, read once.

const locales = path.join(__dirname, '..', '..', '..', 'locales')
const read = (lang) =>
  JSON.parse(fs.readFileSync(path.join(locales, lang, 'translation.json')))
const en = read('en')
const fr = read('fr')

const SAME_IN_FRENCH = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fr-same-texts.json')))
)

const placeholders = (text) =>
  [...text.matchAll(/\{\{[^}]+\}\}|<\/?\d+>|<\/?[a-z]+>/g)]
    .map((m) => m[0])
    .sort()

describe('the French interface', () => {
  it('has a French text for every English one', () => {
    expect(Object.keys(en).filter((key) => !(key in fr))).toEqual([])
  })

  it('has no English text left, but for the texts the same in both', () => {
    expect(
      Object.keys(en).filter(
        (key) => fr[key] === en[key] && !SAME_IN_FRENCH.has(key)
      )
    ).toEqual([])
  })

  it('has no copy of a key whose English text differs from it', () => {
    // A plural's singular ("Create {{count}} required flip") is stored under the plural's key.
    expect(
      Object.keys(en).filter((key) => en[key] !== key && fr[key] === key)
    ).toEqual([])
  })

  it('lists as the same in French only texts that still are', () => {
    expect([...SAME_IN_FRENCH].filter((key) => fr[key] !== en[key])).toEqual([])
  })

  it('keeps the placeholders and tags of each English text', () => {
    expect(
      Object.keys(en).filter(
        (key) =>
          key in fr &&
          placeholders(en[key]).join() !== placeholders(fr[key]).join()
      )
    ).toEqual([])
  })

  it('says nœud, as the phone app does', () => {
    expect(
      Object.entries(fr)
        .filter(([, text]) => /\bnodes?\b|noeud/i.test(text))
        .map(([key]) => key)
    ).toEqual([])
  })
})
