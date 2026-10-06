const {createDnaLinkInbox} = require('./dna-link-inbox')

describe('dna link inbox', () => {
  it('keeps a received link until it is handled', () => {
    const inbox = createDnaLinkInbox()
    expect(inbox.pending()).toBeNull()

    const link = inbox.receive('dna://send/v1?address=0x1')
    expect(link).toEqual({id: 1, url: 'dna://send/v1?address=0x1'})
    expect(inbox.pending()).toBe(link)
    expect(inbox.pending()).toBe(link)

    inbox.markHandled(link.id)
    expect(inbox.pending()).toBeNull()
  })

  it('ignores a missing link', () => {
    const inbox = createDnaLinkInbox()
    expect(inbox.receive(undefined)).toBeNull()
    expect(inbox.receive('')).toBeNull()
    expect(inbox.pending()).toBeNull()
  })

  it('keeps the newest link when an older one is reported handled', () => {
    const inbox = createDnaLinkInbox()
    const first = inbox.receive('dna://send/v1?address=0x1')
    const second = inbox.receive('dna://vote/v1?address=0x2')

    inbox.markHandled(first.id)
    expect(inbox.pending()).toBe(second)

    inbox.markHandled(second.id)
    expect(inbox.pending()).toBeNull()
  })

  it('gives the same link a new id each time it comes', () => {
    const inbox = createDnaLinkInbox()
    const url = 'dna://send/v1?address=0x1'
    const first = inbox.receive(url)
    inbox.markHandled(first.id)

    const second = inbox.receive(url)
    expect(second.id).toBeGreaterThan(first.id)
    expect(inbox.pending()).toBe(second)
  })
})
