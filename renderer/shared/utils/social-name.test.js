import fs from 'fs'
import path from 'path'

// The texts name the app's social network "Idena Social", never by the website's address (owner 2026-10-21); the
// address stays only in the code (contract names, the credit's repository link).

const locales = path.join(__dirname, '..', '..', '..', 'locales')

describe('the social network in the texts', () => {
  for (const lang of ['en', 'fr']) {
    it(`is Idena Social in ${lang}, never idena.social`, () => {
      const texts = JSON.parse(
        fs.readFileSync(path.join(locales, lang, 'translation.json'))
      )
      expect(
        Object.entries(texts)
          .filter(
            ([key, text]) =>
              /idena\.social/i.test(text) || /idena\.social/i.test(key)
          )
          .map(([key]) => key)
      ).toEqual([])
    })
  }
})
