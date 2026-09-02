/**
 * Records what you say during your own lines, so you can listen back right
 * after hearing how it should have sounded.
 *
 * The microphone stream is opened once and kept for the whole run – asking for
 * permission before every single line would make the rehearsal unusable.
 * Nothing leaves the browser: the recording lives in an object URL and is
 * dropped when the panel closes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Take {
  /** Object URL for playing it back right away. */
  url: string
  /** The same audio as data – this is what goes to the recogniser. */
  blob: Blob
}

export interface Recorder {
  /** False in browsers without MediaRecorder, or outside a secure context. */
  supported: boolean
  recording: boolean
  /** Set when the microphone was refused or is missing. */
  error: string | null
  start: () => Promise<void>
  /** Stops and returns the take, or null if nothing came of it. */
  stop: () => Promise<Take | null>
  release: () => void
}

/**
 * Whether this page may ask for a microphone at all.
 *
 * Browsers hand out `navigator.mediaDevices` only in a secure context – HTTPS
 * or localhost. Opened as plain http from another machine (a home server, say)
 * it is simply `undefined`, with no error and no prompt, so the switch has to
 * say why instead of quietly doing nothing.
 */
export function microphoneAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

export function useRecorder(): Recorder {
  const supported = microphoneAvailable()

  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const release = useCallback(() => {
    recorder.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setRecording(false)
  }, [])

  useEffect(() => release, [release])

  const start = useCallback(async () => {
    if (!supported || recorder.current) return // already running
    try {
      if (!stream.current) {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      chunks.current = []
      const rec = new MediaRecorder(stream.current)
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.start()
      recorder.current = rec
      setRecording(true)
      setError(null)
    } catch (e) {
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'Kein Zugriff auf das Mikrofon – im Browser erlauben oder die Aufnahme abschalten.'
          : (e as Error).message,
      )
    }
  }, [supported])

  const stop = useCallback((): Promise<Take | null> => {
    const rec = recorder.current
    if (!rec || rec.state === 'inactive') {
      setRecording(false)
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        setRecording(false)
        recorder.current = null
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
        resolve(blob.size > 0 ? { url: URL.createObjectURL(blob), blob } : null)
      }
      rec.stop()
    })
  }, [])

  return { supported, recording, error, start, stop, release }
}
