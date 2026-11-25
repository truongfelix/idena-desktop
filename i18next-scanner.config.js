const AVAILABLE_LANGS = [
  'en',
  'id',
  'fr',
  'de',
  'es',
  'ru',
  'zh',
  'ko',
  'hr',
  'uk',
  'sr',
  'ro',
  'it',
  'pt',
  'pl',
  'sl',
  'hi',
  'tr',
  'bg',
  'sv',
  'ja',
  'el',
]

module.exports = {
  input: [
    'main/**/*.{js,jsx}',
    'renderer/**/*.{js,jsx}',
    '!**/renderer/out/**',
    '!**/renderer/.next/**',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  output: './',
  options: {
    debug: true,
    trans: false,
    func: {
      list: ['t'],
      extensions: ['.js', '.jsx'],
    },
    lngs: AVAILABLE_LANGS,
    defaultValue(_lng, _ns, key) {
      return key
    },
    ns: ['error'],
    resource: {
      loadPath: 'locales/{{lng}}/{{ns}}.json',
      savePath: 'locales/{{lng}}/{{ns}}.json',
      jsonIndent: 2,
      lineEnding: '\n',
    },
    keySeparator: false,
    // The locales use i18next's v4 plural keys (key_one, key_few, key_other, key_zero): this scanner (2.x) would add
    // v3 keys (key_plural) that i18next 27 no longer reads. Plural texts are added by hand.
    plural: false,
  },
}
