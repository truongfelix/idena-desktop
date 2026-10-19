import {assign, createMachine} from 'xstate'
import {log} from 'xstate/lib/actions'

// The web picture sources, as main/image-search.js names them: each one is asked on its own, so its pictures show
// as soon as it answers (B-33), not after the slowest one.
export const IMAGE_SOURCES = ['openverse', 'wikimedia']

const MAX_IMAGES = 64

/** `images` with `found` added after them, each picture once (by its image URL), at most 64. */
export function addImages(images, found) {
  const seen = new Set(images.map(({image}) => image))
  const added = (Array.isArray(found) ? found : []).filter(({image}) => {
    if (seen.has(image)) return false
    seen.add(image)
    return true
  })
  return images.concat(added).slice(0, MAX_IMAGES)
}

/**
 * Asks every source for `query` (`search(query, source)`: its pictures), sending FOUND with each answer as it comes,
 * then ALL_FOUND once all have answered, or SEARCH_FAILED. Stopping it drops the answers still to come.
 */
export const searchEverySource = (search, query) => (callback) => {
  let stopped = false
  Promise.all(
    IMAGE_SOURCES.map((source) =>
      search(query, source).then((images) => {
        if (!stopped) callback({type: 'FOUND', images})
      })
    )
  ).then(
    () => {
      if (!stopped) callback('ALL_FOUND')
    },
    (error) => {
      if (!stopped) callback({type: 'SEARCH_FAILED', data: error})
    }
  )
  return () => {
    stopped = true
  }
}

const searchImage = (query, source) =>
  global.ipcRenderer.invoke('search-image', query, source)

/**
 * The web picture search: `images` grows while `searching`, a source at a time; `done` once every source answered
 * (the nonsense picture waits for it). A picture can be picked while the others still come.
 */
export const imageSearchMachine = createMachine(
  {
    context: {
      images: [],
      query: '',
    },
    initial: 'idle',
    states: {
      idle: {},
      searching: {
        entry: assign({images: []}),
        invoke: {
          // eslint-disable-next-line no-shadow
          src: ({query}, {query: queryParam}) =>
            searchEverySource(searchImage, query || queryParam),
        },
        on: {
          FOUND: {
            actions: assign({
              images: ({images}, {images: found}) => addImages(images, found),
            }),
          },
          ALL_FOUND: {target: 'done', actions: log()},
          SEARCH_FAILED: 'fail',
          PICK: {actions: 'pick'},
        },
      },
      done: {
        on: {
          PICK: {actions: ['pick', log()]},
        },
      },
      fail: {
        entry: ['onError', log()],
      },
    },
    on: {
      SEARCH: 'searching',
      TYPE: {
        actions: [
          assign({
            // eslint-disable-next-line no-shadow
            query: (_, {query}) => query,
          }),
        ],
      },
    },
  },
  {
    actions: {
      pick: assign({
        selectedImage: (_, {image}) => image,
      }),
    },
  }
)
