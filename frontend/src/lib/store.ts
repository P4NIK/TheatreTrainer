/**
 * The plays, in the browser.
 *
 * A port of backend/internal/project/store.go. The layout is the one the
 * backend used, file for file:
 *
 *   projects/<id>/project.json   name, page count, own role, progress
 *   projects/<id>/blocks.json    the marked areas and their text
 *   projects/<id>/speakers.json  voice per role
 *   projects/<id>/cards.json     the learning state
 *   projects/<id>/source.pdf     the play itself
 *   projects/<id>/cache/         the rendered blocks (storage.ts)
 *
 * Keeping it identical is what makes `exportProject()` a real backup and the
 * one-off import from the old backend a copy rather than a conversion.
 *
 * The rules the Go store enforced on write are enforced here too – a stage
 * direction has no speaker, blocks are stored in reading order, an unknown
 * project is an error rather than an empty one. Anything the UI relied on
 * would otherwise quietly change.
 */

import {
  memoryProjects,
  opfsProjects,
  unshared,
  type BlobStore,
  type ProjectStorage,
} from './storage'
import type { Block, Card, Deck, Progress, ProgressInput, Project, Speakers } from '../types'
import { DIRECTION_KEY } from '../types'
import { DEFAULT_VOICE } from './voices'

const FILES = {
  project: 'project.json',
  blocks: 'blocks.json',
  speakers: 'speakers.json',
  cards: 'cards.json',
  pdf: 'source.pdf',
} as const

/** The format written by `exportProject()`. */
export const EXPORT_VERSION = 1

export interface ProjectExport {
  format: 'theater-tts'
  version: number
  exportedAt: string
  project: Project
  blocks: Block[]
  speakers: Speakers
  cards: Deck
  /** The PDF, base64 – a backup without the play is no backup. */
  pdf: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** What a project starts with: a voice for the stage directions, and nothing else. */
function defaultSpeakers(): Speakers {
  return {
    [DIRECTION_KEY]: {
      model: DEFAULT_VOICE,
      speakerId: 0,
      lengthScale: 1.15,
      volume: 0.7,
      pitch: 1,
      color: '#868e96',
    },
  }
}

async function readJson<T>(files: BlobStore, name: string, fallback: T): Promise<T> {
  const bytes = await files.read(name)
  if (!bytes) return fallback
  try {
    return JSON.parse(decoder.decode(bytes)) as T
  } catch {
    // A file that is there but unreadable is not an empty one: saying so
    // beats overwriting a play with the empty list on the next save.
    throw new Error(`${name} ist beschädigt`)
  }
}

async function writeJson(files: BlobStore, name: string, value: unknown): Promise<void> {
  await files.write(name, encoder.encode(JSON.stringify(value, null, 2)))
}

/** The id of a new project, from its name – the same shape the backend made. */
export function slugify(name: string): string {
  const umlauts: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }
  const plain = name
    .toLowerCase()
    .trim()
    .replace(/[äöüß]/g, (c) => umlauts[c])
    .replace(/[^a-z0-9]+/g, '-')
  return plain.replace(/^-+|-+$/g, '')
}

export class ProjectStore {
  private readonly storage: ProjectStorage

  constructor(storage: ProjectStorage) {
    this.storage = storage
  }

  /* ------------------------------------------------------------ Projects */

  /**
   * Every project, newest first.
   *
   * A folder without a readable project.json is skipped rather than reported:
   * reading a project creates its folder on the way, and an interrupted
   * creation would otherwise leave a ghost in the list for ever.
   */
  async listProjects(): Promise<Project[]> {
    const out: Project[] = []
    for (const id of await this.storage.list()) {
      const project = await readJson<Project | null>(this.storage.files(id), FILES.project, null)
      if (project) out.push(project)
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  }

  async getProject(id: string): Promise<Project> {
    const project = await readJson<Project | null>(this.storage.files(id), FILES.project, null)
    if (!project) throw new Error(`Das Stück "${id}" gibt es nicht (mehr).`)
    return project
  }

  async createProject(name: string, pdf: File | Blob | Uint8Array): Promise<Project> {
    const trimmed = name.trim()
    const id = await this.freeId(slugify(trimmed))
    const files = this.storage.files(id)

    const project: Project = {
      id,
      name: trimmed,
      pdfFile: FILES.pdf,
      pageCount: 0,
      createdAt: new Date().toISOString(),
      myRole: '',
      premiere: '',
    }

    await files.write(FILES.pdf, await bytesOf(pdf))
    await writeJson(files, FILES.project, project)
    await writeJson(files, FILES.blocks, [])
    await writeJson(files, FILES.speakers, defaultSpeakers())
    return project
  }

  /** Patches metadata. Fields that are not given stay as they are. */
  async updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'myRole' | 'pageCount' | 'premiere'>>,
  ): Promise<Project> {
    const project = await this.getProject(id)
    // An empty name is a slip of the hand, not a rename – the backend ignored
    // it too, and a play without a name is unfindable in the list.
    if (patch.name !== undefined && patch.name.trim() !== '') project.name = patch.name.trim()
    if (patch.myRole !== undefined) project.myRole = patch.myRole
    if (patch.pageCount !== undefined) project.pageCount = patch.pageCount
    if (patch.premiere !== undefined) project.premiere = patch.premiere.trim()

    await writeJson(this.storage.files(id), FILES.project, project)
    return project
  }

  async deleteProject(id: string): Promise<void> {
    await this.storage.remove(id)
  }

  /* ------------------------------------------------------------ Progress */

  /**
   * Where the rehearsal stands. Written once per line of a running rehearsal,
   * so it touches nothing else in the project – and the timestamp is set here
   * rather than taken from the caller.
   */
  async saveProgress(id: string, progress: ProgressInput): Promise<Project> {
    const project = await this.getProject(id)
    project.progress = { ...progress, updatedAt: new Date().toISOString() } as Progress
    await writeJson(this.storage.files(id), FILES.project, project)
    return project
  }

  /** "Start over": forget the saved position. */
  async clearProgress(id: string): Promise<Project> {
    const project = await this.getProject(id)
    delete project.progress
    await writeJson(this.storage.files(id), FILES.project, project)
    return project
  }

  /* -------------------------------------------------------------- Blocks */

  async getBlocks(id: string): Promise<Block[]> {
    await this.getProject(id)
    return readJson<Block[]>(this.storage.files(id), FILES.blocks, [])
  }

  async saveBlocks(id: string, blocks: Block[]): Promise<Block[]> {
    await this.getProject(id)
    const clean: Block[] = (blocks ?? []).map((block) => {
      const type: Block['type'] = block.type === 'direction' ? 'direction' : 'line'
      // A stage direction has no speaker – it is read by the direction voice,
      // and a leftover name here would put it in the wrong role's list.
      return { ...block, type, speaker: type === 'direction' ? null : block.speaker }
    })
    clean.sort((a, b) => a.order - b.order)
    await writeJson(this.storage.files(id), FILES.blocks, clean)
    return clean
  }

  /* ------------------------------------------------------------ Speakers */

  async getSpeakers(id: string): Promise<Speakers> {
    await this.getProject(id)
    return readJson<Speakers>(this.storage.files(id), FILES.speakers, {})
  }

  async saveSpeakers(id: string, speakers: Speakers): Promise<Speakers> {
    await this.getProject(id)
    const clean = speakers ?? {}
    await writeJson(this.storage.files(id), FILES.speakers, clean)
    return clean
  }

  /* --------------------------------------------------------------- Cards */

  /** A missing deck is an empty one: a play that was never rehearsed has none. */
  async getCards(id: string): Promise<Deck> {
    await this.getProject(id)
    return readJson<Deck>(this.storage.files(id), FILES.cards, {})
  }

  /**
   * Merges single cards into the deck rather than replacing it – a sitting
   * grades one line at a time, and two windows on the same play would
   * otherwise overwrite each other. A null entry drops that card.
   */
  async saveCards(id: string, patch: Record<string, Card | null>): Promise<Deck> {
    const deck = await this.getCards(id)
    for (const [blockId, card] of Object.entries(patch)) {
      if (card === null) delete deck[blockId]
      else deck[blockId] = card
    }
    await writeJson(this.storage.files(id), FILES.cards, deck)
    return deck
  }

  /** Forgets the learning state, not the lines. */
  async clearCards(id: string): Promise<void> {
    await this.getProject(id)
    await writeJson(this.storage.files(id), FILES.cards, {})
  }

  /* ----------------------------------------------------------------- PDF */

  async getPdf(id: string): Promise<Uint8Array> {
    const bytes = await this.storage.files(id).read(FILES.pdf)
    if (!bytes) throw new Error('Zu diesem Stück ist kein PDF gespeichert.')
    return bytes
  }

  /** The PDF as something a viewer can open – it is no longer an address. */
  async getPdfBlob(id: string): Promise<Blob> {
    return new Blob([unshared(await this.getPdf(id))], { type: 'application/pdf' })
  }

  /* ------------------------------------------------------- Backup */

  /**
   * The whole project in one file.
   *
   * Without a backend this is the only copy that survives a browser clearing
   * its storage, and it is also how a play moves to another device. The cache
   * stays out: it is recomputable, and it is a hundred times the size.
   */
  async exportProject(id: string): Promise<ProjectExport> {
    return {
      format: 'theater-tts',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      project: await this.getProject(id),
      blocks: await this.getBlocks(id),
      speakers: await this.getSpeakers(id),
      cards: await this.getCards(id),
      pdf: toBase64(await this.getPdf(id)),
    }
  }

  /**
   * Puts an exported project back, under a free id.
   *
   * Deliberately never overwrites: importing a backup next to the current
   * state is recoverable, importing it *over* the current state is not.
   */
  async importProject(data: unknown): Promise<Project> {
    const parsed = data as Partial<ProjectExport>
    if (!parsed || parsed.format !== 'theater-tts' || !parsed.project) {
      throw new Error('Das ist keine Sicherungskopie eines Stücks.')
    }
    if ((parsed.version ?? 0) > EXPORT_VERSION) {
      throw new Error('Diese Sicherungskopie stammt aus einer neueren Fassung des Programms.')
    }

    const id = await this.freeId(parsed.project.id || slugify(parsed.project.name ?? ''))
    const files = this.storage.files(id)
    const project: Project = { ...parsed.project, id, pdfFile: FILES.pdf }

    if (parsed.pdf) await files.write(FILES.pdf, fromBase64(parsed.pdf))
    await writeJson(files, FILES.project, project)
    await writeJson(files, FILES.blocks, parsed.blocks ?? [])
    await writeJson(files, FILES.speakers, parsed.speakers ?? defaultSpeakers())
    await writeJson(files, FILES.cards, parsed.cards ?? {})
    return project
  }

  /* ------------------------------------------------------------- Helpers */

  /** `hamlet`, or `hamlet-2` when that is taken – as the backend numbered them. */
  private async freeId(base: string): Promise<string> {
    const wanted = base || 'stueck'
    const taken = new Set(await this.storage.list())
    if (!taken.has(wanted)) return wanted
    for (let i = 2; ; i++) {
      const candidate = `${wanted}-${i}`
      if (!taken.has(candidate)) return candidate
    }
  }
}

async function bytesOf(data: File | Blob | Uint8Array): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data
  return new Uint8Array(await data.arrayBuffer())
}

/** Base64 in chunks: one huge apply() on a 5 MB PDF blows the argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let at = 0; at < bytes.length; at += step) {
    binary += String.fromCharCode(...bytes.subarray(at, at + step))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** The store the app uses. Tests build their own on `memoryProjects()`. */
export const store = new ProjectStore(opfsProjects())

/** For tests and for a quick throwaway store. */
export function memoryProjectStore(): ProjectStore {
  return new ProjectStore(memoryProjects())
}
