import i18next from 'i18next'
import translation from '../../../locales/en/translation.json'
import {ActivityKind} from './activity'
import {noticeTitle, waitsForNames} from './notices'
import {shortAddress} from './people'

const liker = '0x022353D8A3E5852F2EB8DF3E23A7B0F738752536'
const tipper = '0x34004a3e1b2c3d4e5f60718293a4b5c6d7e8b850'

describe('the notice of new activity', () => {
  const i18n = i18next.createInstance()
  i18n.init({
    resources: {en: {translation}},
    lng: 'en',
    keySeparator: false,
    initImmediate: false,
    interpolation: {escapeValue: false},
  })
  const t = i18n.t.bind(i18n)
  const like = {kind: ActivityKind.Like, actor: liker}
  const tip = {kind: ActivityKind.Tip, actor: tipper, amount: '5'}

  it('names the identity by its profile name, else by its short address', () => {
    const names = {[liker.toLowerCase()]: '@felixflx'}
    expect(noticeTitle([like], names, t)).toBe('@felixflx liked your post')
    expect(noticeTitle([tip], names, t)).toBe(
      `${shortAddress(tipper)} tipped you 5 iDNA`
    )
  })

  it('waits for the names while the profiles are read (B-127)', () => {
    // A new liker: the profiles are read again with its address, its name is not there yet.
    expect(waitsForNames([like], {}, true)).toBe(true)
    expect(
      waitsForNames([like], {[liker.toLowerCase()]: '@felixflx'}, true)
    ).toBe(false)
    // The read is over: an identity without a name shows its address.
    expect(waitsForNames([like, tip], {}, false)).toBe(false)
    // One name missing is enough to wait.
    expect(
      waitsForNames([like, tip], {[liker.toLowerCase()]: '@felixflx'}, true)
    ).toBe(true)
  })
})
