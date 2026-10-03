import fs from 'fs'
import path from 'path'
import {
  ROBOHASH_COLORS,
  ROBOHASH_PARTS,
  ROBOHASH_VARIANTS,
  cachedRobot,
  robot,
  robotLayers,
} from './robohash'

// The color and pictures e1ven/Robohash (robohash.py) chooses for these addresses; two checked pixel for
// pixel on robohash.idena.io (the phone app's RobohashTest holds the same values).
const reference = {
  '0x0000000000000000000000000000000000000000': ['pink', [5, 6, 4, 7, 1]],
  '0x34004a3e1d2c3b4a59687766554433221100b850': ['orange', [6, 5, 1, 8, 3]],
  '0x9f1c2e7d5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d': ['white', [5, 8, 1, 1, 0]],
  '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd': ['purple', [8, 9, 1, 9, 8]],
  '0x1111111111111111111111111111111111111111': ['white', [1, 5, 0, 7, 4]],
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef': ['brown', [7, 2, 4, 7, 4]],
}

describe('robot avatars', () => {
  it('chooses as RoboHash', async () => {
    for (const [address, [color, parts]] of Object.entries(reference)) {
      // eslint-disable-next-line no-await-in-loop
      expect(await robot(address)).toEqual({color, parts})
    }
  })

  it('keeps a robot once computed', async () => {
    const address = '0x2222222222222222222222222222222222222222'
    expect(cachedRobot(address)).toBeUndefined()
    const computed = await robot(address)
    expect(cachedRobot(address)).toBe(computed)
  })

  it('draws the body first and the mouth last', () => {
    expect(robotLayers({color: 'brown', parts: [7, 2, 4, 7, 4]})).toEqual([
      '/static/robohash/brown/3/7.png',
      '/static/robohash/brown/4/4.png',
      '/static/robohash/brown/2/4.png',
      '/static/robohash/brown/1/2.png',
      '/static/robohash/brown/0/7.png',
    ])
  })

  it('has every picture', () => {
    const root = path.join(__dirname, '..', '..', 'public')
    for (const color of ROBOHASH_COLORS) {
      for (let part = 0; part < ROBOHASH_PARTS; part += 1) {
        for (let n = 0; n < ROBOHASH_VARIANTS; n += 1) {
          expect(
            fs.existsSync(
              path.join(
                root,
                'static',
                'robohash',
                color,
                `${part}`,
                `${n}.png`
              )
            )
          ).toBe(true)
        }
      }
    }
  })
})
