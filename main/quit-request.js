// A quit waits for the page's answer: the page asks first while the built-in node mines, or may (it does not answer
// in time: renderer ConfirmQuit). A page that never answers (a hung window) must not hold the quit for good: the
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
  let quitting = false

  const quitOnce = (reason) => {
    if (quitting) return
    quitting = true
    quit(reason)
  }

  const stopWaiting = () => {
    if (timer) clearTimer(timer)
    timer = null
  }

  return {
    // Asks the page; quits when no answer comes in time.
    request() {
      if (quitting) return
      stopWaiting()
      ask()
      timer = setTimer(() => {
        timer = null
        quitOnce('no answer from the page')
      }, timeoutMs)
    },
    // The page shows the question: no timeout.
    asked: stopWaiting,
    // The page says quit.
    confirmed() {
      stopWaiting()
      quitOnce('confirmed')
    },
  }
}

module.exports = {QUIT_ANSWER_TIMEOUT_MS, createQuitRequest}
