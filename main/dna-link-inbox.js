// The last dna:// link the app received, kept until the renderer reports it handled. A link that arrives before the
// page listens (it started the app, or a second instance passed it during startup) or before the dialog that
// opens it is shown (send, raw and vote wait for the synced node) is read again from here; each link gets a new id
// so the renderer handles it once, even when the same link comes twice.
function createDnaLinkInbox() {
  let pending = null
  let lastId = 0

  return {
    receive(url) {
      if (typeof url !== 'string' || !url) return null
      lastId += 1
      pending = {id: lastId, url}
      return pending
    },
    pending() {
      return pending
    },
    markHandled(id) {
      if (pending && pending.id === id) pending = null
    },
  }
}

module.exports = {createDnaLinkInbox}
