/**
 * The state of the speech recognition, for the two panels that offer it.
 *
 * There is nothing to detect any more – no Whisper on the machine, no server
 * that has one. What there is instead is a download of about 200 MB the first
 * time, which is why this exists at all: switching "analyse what I said" on
 * has to start that download and show how far it is, rather than letting the
 * first spoken line wait on it in silence.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { stt, WHISPER_BYTES } from '../../lib/stt'

export interface SttState {
  /** The model is in the worker; a recognition starts at once. */
  ready: boolean
  /** Set while the model is being fetched. */
  loading: boolean
  /** 0 … 1 while loading, as far as the sizes are known. */
  progress: number
  error: string
  /** Starts the download, or does nothing if it already ran. */
  load: () => void
}

export function useStt(): SttState {
  const [ready, setReady] = useState(() => stt.ready())
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const seen = useRef(new Map<string, { loaded: number; total: number }>())

  useEffect(() => {
    // The files arrive one after another; the bar should not jump back to zero
    // with every one of them, so they are added up.
    return stt.watch((p) => {
      seen.current.set(p.file, { loaded: p.loaded, total: p.total })
      let loaded = 0
      let total = 0
      for (const file of seen.current.values()) {
        loaded += file.loaded
        total += file.total
      }
      setProgress(Math.min(1, loaded / Math.max(total, WHISPER_BYTES)))
    })
  }, [])

  const load = useCallback(() => {
    if (stt.ready() || loading) return
    setLoading(true)
    setError('')
    stt
      .ensure()
      .then(() => setReady(true))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [loading])

  return { ready, loading, progress, error, load }
}

/**
 * One sentence about the state of the recognition, for the switch that turns
 * it on. Whether it says "200 MB" depends on whether that is still ahead.
 */
export function sttHint(state: SttState): string {
  if (state.error) return `Die Spracherkennung ließ sich nicht laden: ${state.error}`
  if (state.loading) {
    return `Die Spracherkennung wird geladen … ${Math.round(state.progress * 100)} %`
  }

  const wie =
    'Der Mitschnitt wird hier im Browser in Text verwandelt und Wort für Wort mit dem Buch ' +
    'verglichen – eine Gedächtnisstütze, kein Urteil.'
  return state.ready
    ? wie
    : `${wie} Beim ersten Mal werden dafür rund 200 MB geladen, danach geht es ohne Netz.`
}
