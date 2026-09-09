/**
 * What is left of the Go backend: the speech recognition.
 *
 * Everything else has moved into the browser – the plays and their PDFs live
 * in OPFS (lib/store.ts), synthesis runs in a worker (lib/synth.ts). Whisper
 * is the last thing that still needs a server, and it is next.
 *
 * The requests go through the relative "/api" prefix, which Vite proxies to
 * the backend during development and the Go server serves itself in
 * production – no hard-coded hosts anywhere.
 */
import type { SttInfo, Transcript } from '../types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  problems?: string[]

  constructor(message: string, status: number, problems?: string[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.problems = problems
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init)
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    let problems: string[] | undefined
    try {
      const body = await res.json()
      if (body?.error) message = body.error
      if (Array.isArray(body?.problems)) problems = body.problems
    } catch {
      /* body was not JSON – keep the status text */
    }
    throw new ApiError(message, res.status, problems)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  /** Whether a local speech recognition was found – the comparison needs it. */
  sttInfo: () => request<SttInfo>('/stt'),

  /**
   * Sends a recording of one block and returns what was understood. The
   * comparison with the text happens in the browser, so correcting the block
   * re-colours the result without asking the recogniser again.
   */
  transcribe: (id: string, blockId: string, audio: Blob): Promise<Transcript> => {
    const form = new FormData()
    form.append('audio', audio, 'take.webm')
    return request<Transcript>(`/projects/${id}/blocks/${blockId}/transcribe`, {
      method: 'POST',
      body: form,
    })
  },
}
