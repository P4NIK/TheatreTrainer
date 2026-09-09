/** Shared types – these mirror the Go structs in backend/internal/project. */

export interface Project {
  id: string
  name: string
  pdfFile: string
  pageCount: number
  createdAt: string
  /** Speaker name of your own role, or "" if none is selected. */
  myRole: string
  /** Where the last rehearsal run stopped; absent until one has been run. */
  progress?: Progress | null
  /** Opening night as "2026-10-31", or "" when unknown. */
  premiere: string
}

/** Self-assessment after a flashcard. */
export type Grade = 'again' | 'hard' | 'good'

/** Learning state of one line – mirrors project.Card on the server. */
export interface Card {
  /** Leitner box, 1-based; higher means longer between repeats. */
  box: number
  /** The day the line is wanted again, as "2026-09-12". */
  due: string
  reviews: number
  lapses: number
  /** Run of consecutive "good" gradings. */
  streak: number
  lastGrade: Grade | ''
  lastReviewed: string
}

/**
 * Block ID -> learning state. Only graded lines appear: the deck itself is
 * derived from the blocks of the role, so editing the play needs no
 * bookkeeping here.
 */
export type Deck = Record<string, Card>

/** Which part of the play a run covers. */
export type SelectionMode = 'all' | 'pages' | 'role' | 'blocks'

/** The setup of a run – mirrors project.RunSelection on the server. */
export interface RunSelection {
  mode: SelectionMode
  /** Page range, used by mode 'pages'. */
  fromPage: number
  toPage: number
  /** Blocks kept before and after each of your own lines, used by mode 'role'. */
  lead: number
  trail: number
  /** Two stretches closer than this many blocks are joined instead of split. */
  mergeGap: number
  /** Hand-picked block IDs, used by mode 'blocks'. Order does not matter. */
  blockIds: string[]
  /** Announce the page before every stretch that does not follow the previous one. */
  announce: boolean
}

/**
 * Where the last rehearsal run stopped.
 *
 * The anchor is the block, not the step number: blocks get edited, re-ordered
 * and re-cut, and a bare index would quietly slide to a different line. Order
 * and page are kept alongside so a block that has dropped out of the selection
 * can still be resolved to the nearest position.
 */
export interface Progress {
  blockId: string
  page: number
  order: number
  /** The part that was rehearsed, not necessarily the project's own role. */
  role: string
  /** For the summary line only – the position is resolved from blockId. */
  index: number
  total: number
  selection?: RunSelection
  /** A finished run: then starting over is the honest offer, not carrying on. */
  done: boolean
  /** Stamped by the server. */
  updatedAt: string
}

/** What the client sends – the server owns the timestamp. */
export type ProgressInput = Omit<Progress, 'updatedAt'>

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

/* The voice list, the Piper detection and the synthesis job have no type
   here any more: the voices are in lib/voices.ts, and a run is a promise in
   lib/synth.ts rather than something the server hands out an id for. */

/**
 * One entry of the render list. Either a block of the play, or a short spoken
 * marker ("Weiter auf Seite 12.") that is read with the stage-direction voice.
 */
export interface SelectionItem {
  blockId?: string
  announce?: string
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
