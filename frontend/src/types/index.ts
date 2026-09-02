/** Shared types – these mirror the Go structs in backend/internal/project. */

export interface Project {
  id: string
  name: string
  pdfFile: string
  pageCount: number
  createdAt: string
  /** Speaker name of your own role, or "" if none is selected. */
  myRole: string
}

/** Selection rectangle in page-relative coordinates (0..1). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type BlockType = 'line' | 'direction'

export interface Block {
  id: string
  /** 1-based page number. */
  page: number
  rect: Rect
  /** Reading order across the whole play. */
  order: number
  type: BlockType
  /** null for stage directions. */
  speaker: string | null
  text: string
}

export interface SpeakerConfig {
  model: string
  speakerId: number
  lengthScale: number
  volume: number
  /** Shifts the voice up or down without changing the tempo. 1 = unchanged. */
  pitch: number
  color: string
}

export type Speakers = Record<string, SpeakerConfig>

/** Pseudo speaker key used for stage directions. */
export const DIRECTION_KEY = '_direction'

export interface Voice {
  name: string
  language: string
  quality: string
  numSpeakers: number
  speakerIds?: Record<string, number>
  sampleRate: number
}

/** Result of the Piper auto-detection on the server. */
export interface PiperInfo {
  available: boolean
  /** The command that worked, e.g. "python -m piper". */
  command?: string
  /** Every command that was probed. */
  tried: string[]
  /** True when PIPER_BIN was set explicitly, which disables detection. */
  explicit: boolean
  /** Why the probed commands failed. */
  detail?: string
}

export interface VoicesResponse {
  dir: string
  piperAvailable: boolean
  piper?: PiperInfo
  voices: Voice[]
}

export type JobStatus = 'pending' | 'running' | 'done' | 'error'

export interface Job {
  id: string
  projectId: string
  status: JobStatus
  total: number
  done: number
  /** Blocks that had to go through Piper, and blocks taken from the cache. */
  rendered: number
  cached: number
  /** Own-role lines replaced by a pause of the same length. */
  skippedRole: number
  message: string
  error?: string
  format?: 'wav' | 'mp3'
  startedAt: string
  endedAt?: string
}

/**
 * One entry of the render list. Either a block of the play, or a short spoken
 * marker ("Weiter auf Seite 12.") that is read with the stage-direction voice.
 */
export interface SelectionItem {
  blockId?: string
  announce?: string
}

export interface SynthOptions {
  skipMyRole: boolean
  includeDirections: boolean
  /** Restricts the run to a part of the play. Omitted means the whole play. */
  selection?: SelectionItem[]
}

/** Result of the speech-recognition auto-detection on the server. */
export interface SttInfo {
  available: boolean
  /** The command that worked, e.g. "python -m whisper". */
  command?: string
  tried: string[]
  /** True when WHISPER_BIN or STT_CMD was set, which disables detection. */
  explicit: boolean
  model?: string
  detail?: string
}

export interface Transcript {
  text: string
  engine?: string
}

export interface CacheStatus {
  files: number
  bytes: number
}
