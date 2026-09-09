/**
 * The one-time move out of the old backend.
 *
 * As long as the Go server is still installed, the plays that were made with
 * it live in its `data/` folder – PDF, blocks, speakers, learning state. This
 * fetches one of them through the endpoints that are still there and turns it
 * into the same shape `exportProject()` writes, so importing it is the same
 * code path as restoring a backup.
 *
 * Everything in this file is temporary. When the backend goes, so does it.
 */

import type { Block, Card, Deck, Project, Speakers } from '../types'
import { toBase64, type ProjectExport } from './store'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const response = await fetch(BASE + path)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

/**
 * The plays the old backend still holds, or an empty list when it is not
 * running. Not being able to reach it is the normal case, not an error.
 */
export async function legacyProjects(): Promise<Project[]> {
  try {
    return await get<Project[]>('/projects')
  } catch {
    return []
  }
}

/** One play from the old backend, in the shape of a backup file. */
export async function legacyExport(id: string): Promise<ProjectExport> {
  const [project, blocks, speakers, cards] = await Promise.all([
    get<Project>(`/projects/${id}`),
    get<Block[]>(`/projects/${id}/blocks`),
    get<Speakers>(`/projects/${id}/speakers`),
    get<Record<string, Card>>(`/projects/${id}/cards`).catch(() => ({}) as Deck),
  ])

  const pdf = await fetch(`${BASE}/projects/${id}/pdf`)
  if (!pdf.ok) throw new Error(`PDF: ${pdf.status} ${pdf.statusText}`)

  return {
    format: 'theater-tts',
    version: 1,
    exportedAt: new Date().toISOString(),
    project,
    blocks,
    speakers,
    cards,
    pdf: toBase64(new Uint8Array(await pdf.arrayBuffer())),
  }
}
