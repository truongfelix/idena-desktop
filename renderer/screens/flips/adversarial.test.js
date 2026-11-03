import {
  adversarialSearchNeeded,
  adversarialSourceChoice,
  adversarialSources,
  pickAdversarialSources,
} from './utils'

// The nonsense picture is a collage of four pictures: the web search's, or the story pictures when the
// search found fewer than four (search off, no results, no connection).
describe('pickAdversarialSources', () => {
  it('never picks an empty slot', () => {
    // 5 of 8 search slots set: an empty slot picked used to leave the picture waiting forever.
    const images = ['a', undefined, 'b', '', 'c', undefined, 'd', 'e']
    for (let i = 0; i < 200; i += 1) {
      const picked = pickAdversarialSources(images)
      expect(picked).toHaveLength(4)
      picked.forEach((image) =>
        expect(['a', 'b', 'c', 'd', 'e']).toContain(image)
      )
      expect(new Set(picked).size).toBe(4)
    }
  })

  it('takes four slots even when two hold the same picture', () => {
    // Used to loop forever: it wanted four different pictures.
    expect(pickAdversarialSources(['a', 'a', 'b', 'c']).sort()).toEqual([
      'a',
      'a',
      'b',
      'c',
    ])
  })

  it('gives none with fewer than four pictures', () => {
    expect(pickAdversarialSources(['a', undefined, 'b', 'c'])).toEqual([])
    expect(pickAdversarialSources(undefined)).toEqual([])
  })
})

const mirror = async (src) => `mirror-${src}`

describe('adversarialSources', () => {
  describe('from the search pictures', () => {
    const source = {source: 'search', mirror}

    it('uses the search pictures when there are four', async () => {
      const found = ['s1', undefined, 's2', 's3', 's4']
      await expect(
        adversarialSources(found, ['p1', 'p2', 'p3'], source)
      ).resolves.toEqual(['s1', 's2', 's3', 's4'])
    })

    it('adds the story pictures when the search found fewer', async () => {
      await expect(
        adversarialSources(['s1', 's2'], ['p1', undefined, 'p2'], source)
      ).resolves.toEqual(['s1', 's2', 'p1', 'p2'])
    })

    it('gives what it has when there are no story pictures', async () => {
      await expect(
        adversarialSources(Array.from({length: 8}), [], source)
      ).resolves.toEqual([])
    })
  })

  describe('from the story pictures', () => {
    const source = {source: 'story', mirror}

    it('uses only the story pictures, a mirrored one making four', async () => {
      await expect(
        adversarialSources(['s1', 's2', 's3', 's4'], ['p1', 'p2', 'p3'], source)
      ).resolves.toEqual(['p1', 'p2', 'p3', 'mirror-p1'])
    })

    it('falls back on the search pictures without a story picture', async () => {
      await expect(
        adversarialSources(['s1', 's2', 's3', 's4'], [], source)
      ).resolves.toEqual(['s1', 's2', 's3', 's4'])
    })
  })

  describe('both mixed', () => {
    const fromSearch = (list) => list.filter((x) => x.startsWith('s'))
    const fromStory = (list) => list.filter((x) => x.startsWith('p'))

    it('is the default: two search pictures and two story pictures', async () => {
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const sources = await adversarialSources(
          ['s1', 's2', 's3', 's4', 's5'],
          ['p1', 'p2', 'p3'],
          {mirror}
        )
        expect(sources).toHaveLength(4)
        expect(new Set(sources).size).toBe(4)
        expect(fromSearch(sources)).toHaveLength(2)
        expect(fromStory(sources)).toHaveLength(2)
      }
    })

    it('takes more search pictures when the story has one', async () => {
      const sources = await adversarialSources(
        ['s1', 's2', 's3', 's4'],
        ['p1'],
        {source: 'both', mirror}
      )
      expect(fromSearch(sources)).toHaveLength(3)
      expect(sources).toContain('p1')
    })

    it('takes the story pictures and a mirror without the search', async () => {
      await expect(
        adversarialSources([], ['p1', 'p2', 'p3'], {source: 'both', mirror})
      ).resolves.toEqual(expect.arrayContaining(['p1', 'p2', 'p3']))
      const sources = await adversarialSources([], ['p1', 'p2', 'p3'], {
        mirror,
      })
      expect(sources).toHaveLength(4)
      expect(sources.filter((x) => x.startsWith('mirror-'))).toHaveLength(1)
    })

    it('reads an unknown saved choice as both', () => {
      expect(adversarialSourceChoice('story')).toBe('story')
      expect(adversarialSourceChoice(undefined)).toBe('both')
      expect(adversarialSourceChoice('later')).toBe('both')
    })
  })
})

describe('adversarialSearchNeeded', () => {
  it('skips the picture search for My pictures only', () => {
    expect(adversarialSearchNeeded('story')).toBe(false)
    expect(adversarialSearchNeeded('search')).toBe(true)
    expect(adversarialSearchNeeded('both')).toBe(true)
    // Never chosen, or a later version's choice: both, which uses the search.
    expect(adversarialSearchNeeded(undefined)).toBe(true)
    expect(adversarialSearchNeeded('later')).toBe(true)
  })
})
