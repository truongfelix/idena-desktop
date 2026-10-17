import fs from 'fs'
import path from 'path'

// The app's community links go to the community's channels (questions.md Q-21 in the workspace): the original
// team's announcements channel is no longer kept up (B-109: the onboarding tip still linked it).
const OLD_TEAM_CHANNELS = ['t.me/IdenaAnnouncements']

function sources(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory())
      return ['.next', 'out', 'node_modules'].includes(entry.name)
        ? []
        : sources(file)
    return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')
      ? [file]
      : []
  })
}

describe('the community links', () => {
  it("never point to the original team's announcements channel", () => {
    const found = sources(path.join(__dirname, '..', '..')).filter((file) =>
      OLD_TEAM_CHANNELS.some((channel) =>
        fs.readFileSync(file, 'utf8').includes(channel)
      )
    )
    expect(found).toEqual([])
  })
})
