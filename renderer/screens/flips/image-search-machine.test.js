import {interpret} from 'xstate'
import {
  IMAGE_SOURCES,
  addImages,
  imageSearchMachine,
  searchSuggestions,
} from './image-search-machine'

const {IMAGE_SOURCE_NAMES} = require('../../../main/image-search')

const pic = (name) => ({
  image: `https://example.com/${name}.jpg`,
  thumbnail: `https://example.com/${name}-t.jpg`,
})

// A search-image invoke per source, answered by hand: answer(source, images).
function fakeIpc() {
  const waiting = {}
  const asked = []
  global.ipcRenderer = {
    invoke: (channel, query, source) => {
      asked.push([channel, query, source])
      return new Promise((resolve) => {
        waiting[`${query}/${source}`] = resolve
      })
    },
  }
  return {
    asked,
    answer: async (query, source, images) => {
      waiting[`${query}/${source}`](images)
      await new Promise((r) => {
        setTimeout(r, 0)
      })
    },
  }
}

const start = () =>
  interpret(imageSearchMachine.withConfig({actions: {onError: () => {}}}), {
    logger: () => {},
  }).start()

describe('the picture search (B-33)', () => {
  afterEach(() => {
    delete global.ipcRenderer
  })

  it('asks the sources the main process has', () => {
    expect(IMAGE_SOURCES).toEqual(IMAGE_SOURCE_NAMES)
  })

  it('shows each source pictures as it answers, done after the last', async () => {
    const ipc = fakeIpc()
    const service = start()
    service.send('SEARCH', {query: 'cat'})
    expect(ipc.asked).toEqual(
      IMAGE_SOURCES.map((source) => ['search-image', 'cat', source])
    )

    await ipc.answer('cat', 'wikimedia', [pic('w1'), pic('w2')])
    expect(service.state.value).toBe('searching')
    expect(service.state.context.images).toEqual([pic('w1'), pic('w2')])

    service.send('PICK', {image: pic('w2').thumbnail})
    expect(service.state.context.selectedImage).toBe(pic('w2').thumbnail)

    await ipc.answer('cat', 'openverse', [pic('w1'), pic('o1')])
    expect(service.state.value).toBe('done')
    expect(service.state.context.images).toEqual([
      pic('w1'),
      pic('w2'),
      pic('o1'),
    ])
    expect(service.state.context.selectedImage).toBe(pic('w2').thumbnail)
    service.stop()
  })

  it('drops the answers of a search replaced by a new one', async () => {
    const ipc = fakeIpc()
    const service = start()
    service.send('SEARCH', {query: 'cat'})
    service.send('TYPE', {query: 'dog'})
    service.send('SEARCH')
    await ipc.answer('cat', 'wikimedia', [pic('cat')])
    expect(service.state.context.images).toEqual([])
    await ipc.answer('dog', 'wikimedia', [pic('dog')])
    expect(service.state.context.images).toEqual([pic('dog')])
    service.stop()
  })

  it('keeps each picture once, at most 64', () => {
    const many = Array.from({length: 70}, (_, i) => pic(`p${i}`))
    expect(addImages([pic('a')], [pic('a'), pic('b')])).toEqual([
      pic('a'),
      pic('b'),
    ])
    expect(addImages([], many)).toHaveLength(64)
    expect(addImages([pic('a')], null)).toEqual([pic('a')])
  })
})

describe("the searches suggested from the flip's keywords (B-170)", () => {
  afterEach(() => {
    delete global.ipcRenderer
  })

  it('offers each keyword, then both together', () => {
    expect(searchSuggestions([{name: 'cat'}, {name: 'sun'}])).toEqual([
      'cat',
      'sun',
      'cat sun',
    ])
  })

  it('leaves out blank and repeated keywords', () => {
    expect(searchSuggestions([{name: ' cat '}, {name: ''}])).toEqual(['cat'])
    expect(searchSuggestions([{name: 'cat'}, {name: 'cat'}])).toEqual([
      'cat',
      'cat cat',
    ])
    expect(searchSuggestions([{name: 'cat'}, undefined])).toEqual(['cat'])
    expect(searchSuggestions(undefined)).toEqual([])
  })

  it('a suggestion typed then searched asks for that text', () => {
    const ipc = fakeIpc()
    const service = start()
    service.send('TYPE', {query: 'old words'})
    service.send('TYPE', {query: 'cat sun'})
    service.send('SEARCH')
    expect(ipc.asked).toEqual(
      IMAGE_SOURCES.map((source) => ['search-image', 'cat sun', source])
    )
    service.stop()
  })
})
