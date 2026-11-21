// A quit waits for the page's answer: the page asks first while the built-in node mines (renderer ConfirmQuit).
// A page that never answers (a hung window, a node call that never returns) must not hold the quit for good: the
// app quits after a timeout, unless the page says it shows the question (the person then decides).
const QUIT_ANSWER_TIMEOUT_MS = 15 * 1000

function createQuitRequest({
  ask,
  quit,
  timeoutMs = QUIT_ANSWER_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null

  const stopWaiting = () => {
    if (timer) clearTimer(timer)
    timer = null
  }

  return {
    // Asks the page; quits when no answer comes in time.
    request() {
      stopWaiting()
      ask()
      timer = setTimer(() => {
        timer = null
        quit('no answer from the page')
      }, timeoutMs)
    },
    // The page shows the question: no timeout.
    asked: stopWaiting,
    // The page says quit.
    confirmed() {
      stopWaiting()
      quit('confirmed')
    },
  }
}

module.exports = {QUIT_ANSWER_TIMEOUT_MS, createQuitRequest}
