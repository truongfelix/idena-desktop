let mockLocale = 'en-US'

jest.mock('electron', () => ({
  app: {getLocale: () => mockLocale},
}))

const i18next = require('i18next')
const {getI18nConfig} = require('./language')

function instance() {
  const i = i18next.createInstance()
  i.init({...getI18nConfig(), initAsync: false})
  return i
}

describe("the main process's translations", () => {
  it('read a variable the call does not pass as nothing', () => {
    mockLocale = 'en-US'
    expect(instance().t('Epoch #{{epoch}}')).toBe('Epoch #')
  })

  it('follow a Greek system language', () => {
    mockLocale = 'el-GR'
    const i = instance()
    expect(i.language).toBe('el')
    expect(i.t('Quit')).toBe('Έξοδος')
  })
})
