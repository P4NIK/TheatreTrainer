/**
 * Typed client for the Go backend. All requests go through the relative
 * "/api" prefix, which Vite proxies to the backend during development and the
 * Go server serves itself in production – no hard-coded hosts anywhere.
 */
import type {
  Block,
  Job,
  Project,
  Speakers,
  SynthOptions,
  VoicesResponse,
} from '../types'

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

const json = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listProjects: () => request<Project[]>('/projects'),

  getProject: (id: string) => request<Project>(`/projects/${id}`),

  createProject: (name: string, pdf: File) => {
    const form = new FormData()
    form.append('name', name)
    form.append('pdf', pdf)
    return request<Project>('/projects', { method: 'POST', body: form })
  },

  updateProject: (
    id: string,
    patch: Partial<Pick<Project, 'name' | 'myRole' | 'pageCount'>>,
  ) => request<Project>(`/projects/${id}`, json(patch)),

  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),

  /** URL of the original PDF – handed to react-pdf directly. */
  pdfUrl: (id: string) => `${BASE}/projects/${id}/pdf`,

  getBlocks: (id: string) => request<Block[]>(`/projects/${id}/blocks`),

  saveBlocks: (id: string, blocks: Block[]) =>
    request<Block[]>(`/projects/${id}/blocks`, json(blocks)),

  getSpeakers: (id: string) => request<Speakers>(`/projects/${id}/speakers`),

  saveSpeakers: (id: string, speakers: Speakers) =>
    request<Speakers>(`/projects/${id}/speakers`, json(speakers)),

  listVoices: () => request<VoicesResponse>('/voices'),

  /** Renders a short sample and returns it as an object URL for <audio>. */
  previewVoice: async (body: {
    model: string
    speakerId: number
    lengthScale: number
    volume: number
    text?: string
  }): Promise<string> => {
    const res = await fetch(`${BASE}/voices/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        const b = await res.json()
        if (b?.error) message = b.error
      } catch {
        /* ignore */
      }
      throw new ApiError(message, res.status)
    }
    return URL.createObjectURL(await res.blob())
  },

  startSynthesis: (id: string, opts: SynthOptions) =>
    request<Job>(`/projects/${id}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),

  jobStatus: (id: string, jobId: string) =>
    request<Job>(`/projects/${id}/synthesize/${jobId}`),

  cancelJob: (id: string, jobId: string) =>
    request<void>(`/projects/${id}/synthesize/${jobId}`, { method: 'DELETE' }),

  audioUrl: (id: string, jobId: string) => `${BASE}/projects/${id}/audio/${jobId}`,
}
