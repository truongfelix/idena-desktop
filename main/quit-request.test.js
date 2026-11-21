const {QUIT_ANSWER_TIMEOUT_MS, createQuitRequest} = require('./quit-request')

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

function setup() {
  const ask = jest.fn()
  const quit = jest.fn()
  return {ask, quit, request: createQuitRequest({ask, quit})}
}

describe('createQuitRequest', () => {
  it('quits when the page never answers', () => {
    const {ask, quit, request} = setup()
    request.request()
    expect(ask).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(QUIT_ANSWER_TIMEOUT_MS - 1)
    expect(quit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(quit).toHaveBeenCalledWith('no answer from the page')
  })

  it('quits at once on the page confirmation, and not again later', () => {
    const {quit, request} = setup()
    request.request()
    request.confirmed()
    expect(quit).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(QUIT_ANSWER_TIMEOUT_MS * 2)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('waits for the person while the page shows the question', () => {
    const {quit, request} = setup()
    request.request()
    request.asked()
    jest.advanceTimersByTime(QUIT_ANSWER_TIMEOUT_MS * 10)
    expect(quit).not.toHaveBeenCalled()
  })

  it('counts the time again from a second quit', () => {
    const {ask, quit, request} = setup()
    request.request()
    jest.advanceTimersByTime(QUIT_ANSWER_TIMEOUT_MS - 1000)
    request.request()
    expect(ask).toHaveBeenCalledTimes(2)
    jest.advanceTimersByTime(QUIT_ANSWER_TIMEOUT_MS - 1)
    expect(quit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })
})
