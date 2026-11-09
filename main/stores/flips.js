const {prepareDb} = require('./setup')

const store = prepareDb('flips')

const keyName = 'flips'
store.defaults({[keyName]: []}).write()

function readFlips() {
  return store.get(keyName).value() || []
}

function getFlips() {
  return readFlips()
}

function getFlip(id) {
  return readFlips().find((draft) => draft.id === id)
}

function saveFlips(flips) {
  store.set(keyName, flips).write()
}

function addDraft(draft) {
  const drafts = readFlips()
  store.set(keyName, drafts.concat(draft)).write()
}

function updateDraft(draft) {
  const drafts = readFlips()
  const draftIdx = drafts.findIndex(({id}) => id === draft.id)
  if (draftIdx > -1) {
    const nextDrafts = [
      ...drafts.slice(0, draftIdx),
      {...drafts[draftIdx], ...draft},
      ...drafts.slice(draftIdx + 1),
    ]
    store.set(keyName, nextDrafts).write()
    return nextDrafts
  }
  return drafts
}

function deleteDraft(id) {
  const drafts = readFlips()
  store
    .set(
      keyName,
      drafts.map((flip) =>
        flip.id === id
          ? {...flip, type: 'Removed', images: null, scenes: null}
          : flip
      )
    )
    .write()
  return id
}

function clear() {
  store.set(keyName, []).write()
}

module.exports = {
  getFlips,
  getFlip,
  saveFlips,
  addDraft,
  updateDraft,
  deleteDraft,
  clear,
}
