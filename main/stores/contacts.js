const {nanoid} = require('nanoid')
const {prepareDb} = require('./setup')

// Written atomically, a damaged file put aside (main/stores/setup.js, B-177).
const db = prepareDb('contacts')

// Set some defaults (required if your JSON file is empty)
db.defaults({contacts: []}).write()

function getContacts() {
  return db.get('contacts')
}

module.exports = {
  getContacts() {
    return getContacts().value()
  },
  getContact(id) {
    return getContacts().find({id}).read()
  },
  addContact(contact) {
    return getContacts()
      .push({id: nanoid(), ...contact})
      .write()
  },
  removeContact(id) {
    return getContacts().remove({id}).write()
  },
}
