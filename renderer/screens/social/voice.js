// A voice note recorded in the post editor (B-223, as the phone's SocialVoice.kt): Opus from the microphone at
// 24 kbit/s (clear speech, about 3 KB a second), in Ogg when this Chromium records it, else in WebM; stopped before
// the file passes what a post can store, and sent as a sound as it is.

import React from 'react'
import {MAX_IPFS_FILE} from './posting'

/** The voice note's size limit: under one IPFS file, with room for the last chunk. */
export const MAX_VOICE_BYTES = MAX_IPFS_FILE - 20000

/** The longest voice note: 5 minutes, about 900 KB at the bit rate. */
export const MAX_VOICE_MS = 5 * 60 * 1000

const VOICE_BIT_RATE = 24000

/** The recorder's container: Ogg when supported (as the phone's), else WebM; and the type its post declares. */
export function voiceFormat(isTypeSupported) {
  if (isTypeSupported('audio/ogg;codecs=opus'))
    return {mimeType: 'audio/ogg;codecs=opus', type: 'audio/ogg'}
  return {mimeType: 'audio/webm;codecs=opus', type: 'audio/webm'}
}

/**
 * One voice note at a time: `start` asks for the microphone and records; `stop` ends it, and `onDone` gets
 * {bytes, type, limited} (`limited`: null, or 'size' / 'time' when it stopped at that limit) or {error}. `elapsed` is the time recorded.
 */
export function useVoiceRecorder(onDone) {
  const [recording, setRecording] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const ref = React.useRef(null)
  const done = React.useRef(onDone)
  done.current = onDone

  // `limited`: null (Stop), 'size' or 'time'.
  const finish = React.useCallback((limited) => {
    const {current} = ref
    if (!current?.recorder || current.recorder.state === 'inactive') return
    current.limited = limited
    current.recorder.stop()
  }, [])

  const start = React.useCallback(async () => {
    if (ref.current) return
    // Taken before the microphone opens: a second click waits, and leaving the editor meanwhile cancels.
    const current = {chunks: [], size: 0, limited: null, started: 0}
    ref.current = current
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: true})
    } catch {
      ref.current = null
      done.current({error: 'the microphone is not available or not allowed'})
      return
    }
    const release = () => stream.getTracks().forEach((track) => track.stop())
    if (current.cancelled) {
      release()
      return
    }
    const format = voiceFormat((type) => MediaRecorder.isTypeSupported(type))
    let recorder
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        audioBitsPerSecond: VOICE_BIT_RATE,
      })
      recorder.start(1000)
    } catch {
      release()
      ref.current = null
      done.current({error: 'this computer cannot record a voice note'})
      return
    }
    current.recorder = recorder
    current.started = Date.now()
    recorder.ondataavailable = ({data}) => {
      if (!data || data.size === 0) return
      current.chunks.push(data)
      current.size += data.size
      if (current.size >= MAX_VOICE_BYTES) finish('size')
    }
    recorder.onstop = async () => {
      release()
      if (current.cancelled) {
        ref.current = null
        setRecording(false)
        return
      }
      const bytes = new Uint8Array(
        await new Blob(current.chunks, {type: format.type}).arrayBuffer()
      )
      // The draft holds the note before Record and Post come back.
      done.current(
        bytes.length === 0
          ? {error: 'nothing was recorded'}
          : {bytes, type: format.type, limited: current.limited}
      )
      ref.current = null
      setRecording(false)
    }
    setElapsed(0)
    setRecording(true)
  }, [finish])

  // The time shown, and the time limit.
  React.useEffect(() => {
    if (!recording) return undefined
    const timer = setInterval(() => {
      const {current} = ref
      if (!current?.started) return
      const ms = Date.now() - current.started
      setElapsed(ms)
      if (ms >= MAX_VOICE_MS) finish('time')
    }, 500)
    return () => clearInterval(timer)
  }, [recording, finish])

  // Leaving the editor stops the microphone without a sound.
  React.useEffect(
    () => () => {
      const {current} = ref
      if (current) {
        current.cancelled = true
        if (current.recorder && current.recorder.state !== 'inactive')
          current.recorder.stop()
      }
    },
    []
  )

  return {recording, elapsed, start, stop: () => finish(null)}
}

/** `ms` as minutes and seconds ("1:05"). */
export function playTime(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
