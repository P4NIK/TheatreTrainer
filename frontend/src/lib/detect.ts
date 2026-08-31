/**
 * Automatic block detection.
 *
 * Play scripts are typeset in columns: the speaker name and the stage
 * directions sit in the left margin, the spoken text is indented. Those two
 * column positions are the only thing the detector needs, and they are learned
 * from the blocks that were drawn by hand – every publisher indents
 * differently, so hard-coding them would only ever fit one book.
 *
 * Deliberately not used: the font names pdf.js reports (`g_d0_f3` and such).
 * They are assigned per page, so the same name means the speaker on one page
 * and a heading on the next.
 */
import type { Block, BlockType, Rect } from '../types'
import { piecesToText, type TextPiece } from './pdfText'
import { newBlockId, splitBlockAtParens } from './blocks'

export interface LayoutProfile {
  /** Column where speaker names and stage directions begin (0..1). */
  leftX: number
  /** Column where spoken text begins. Equal to leftX if the script does not indent. */
  speechX: number
  /** How far an item may sit from a column and still count as part of it. */
  tolerance: number
  /** Where the profile came from – shown in the UI. */
  source: 'learned' | 'guessed'
  /** How many hand-drawn blocks the profile was learned from. */
  sampleSize: number
}

export interface DetectionResult {
  blocks: Block[]
  /** Blocks skipped because that area is already covered. */
  skipped: number
  pagesScanned: number
  /** Pages dropped because they contain no dialogue at all. */
  pagesWithoutDialogue: number[]
}

/** A visual line: all pieces that share a baseline. */
interface Line {
  y: number
  pieces: TextPiece[]
}

const DEFAULT_TOLERANCE = 0.025

export function groupLines(pieces: TextPiece[]): Line[] {
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Line[] = []
  for (const p of sorted) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(p.y - last.y) <= Math.max(p.h, 0.008) * 0.6) {
      last.pieces.push(p)
    } else {
      lines.push({ y: p.y, pieces: [p] })
    }
  }
  for (const l of lines) l.pieces.sort((a, b) => a.x - b.x)
  return lines
}

/**
 * Removes parenthesised inserts from a spoken line. In a script those are
 * stage directions for the actor – having the character read "(kostet)" aloud
 * is exactly the kind of noise a rehearsal recording does not need.
 */
export function stripParentheticals(text: string): string {
  return text
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits "HUGO: Guten Abend." into name and text.
 *
 * Only the colon form counts here. Without an indented speech column there is
 * no geometry to fall back on, and treating a leading upper-case run as a name
 * would turn every stage direction that starts with a character into a line –
 * "SIR ROWLAND stellt das Glas ab." is not a speech.
 */
export function splitInlineSpeaker(text: string): { speaker: string; rest: string } | null {
  const m = text.match(/^\s*([^:]{1,34}?)\s*:\s+(\S.*)$/)
  if (!m) return null
  const speaker = m[1].trim()
  if (!looksLikeSpeakerName(speaker)) return null
  return { speaker, rest: m[2].trim() }
}

/**
 * A speaker name is short, upper case and carries no sentence punctuation.
 * Stage directions mention characters in upper case too, but they are prose.
 */
export function looksLikeSpeakerName(text: string): boolean {
  const t = text.trim().replace(/[:.]$/, '')
  if (t.length === 0 || t.length > 34) return false
  if (t.split(/\s+/).length > 4) return false
  if (/[.!?,;]/.test(t)) return false

  const letters = t.replace(/[^A-Za-zÄÖÜäöüß]/g, '')
  if (letters.length < 2) return false
  const upper = letters.replace(/[^A-ZÄÖÜ]/g, '')
  return upper.length / letters.length >= 0.8
}

/**
 * Learns the column layout from blocks that were drawn by hand. Speech blocks
 * tell us both columns: the speaker name sits at the left one, the text that
 * follows it at the other.
 */
export function learnProfile(
  piecesByPage: Map<number, TextPiece[]>,
  blocks: Block[],
): LayoutProfile | null {
  const lefts: number[] = []
  const speeches: number[] = []

  for (const block of blocks) {
    const pieces = piecesByPage.get(block.page)
    if (!pieces) continue

    const inside = pieces.filter((p) => centerInside(p, block.rect))
    if (inside.length === 0) continue

    const lines = groupLines(inside)
    const first = lines[0]
    if (!first) continue

    if (block.type === 'direction') {
      lefts.push(first.pieces[0].x)
      continue
    }

    // Speech block: find the gap between the name and the text after it.
    const start = first.pieces[0]
    const name = block.speaker?.trim()
    if (name && looksLikeSpeakerName(name)) {
      const after = first.pieces.find((p) => p.x > start.x + start.w + 0.01)
      if (after) {
        lefts.push(start.x)
        speeches.push(after.x)
        continue
      }
    }
    // No name on the first line – the block starts inside the speech column.
    speeches.push(start.x)
  }

  if (speeches.length === 0 && lefts.length === 0) return null

  const leftX = median(lefts.length ? lefts : speeches)
  const speechX = median(speeches.length ? speeches : lefts)
  return {
    leftX,
    speechX: Math.max(speechX, leftX),
    tolerance: DEFAULT_TOLERANCE,
    source: 'learned',
    sampleSize: blocks.length,
  }
}

/**
 * Fallback when nothing has been drawn yet: take the two most common left
 * edges on the sampled pages. Less reliable than learning, so the UI says so.
 */
export function guessProfile(piecesByPage: Map<number, TextPiece[]>): LayoutProfile | null {
  const counts = new Map<number, number>()
  for (const pieces of piecesByPage.values()) {
    for (const line of groupLines(pieces)) {
      for (const p of line.pieces) {
        const bucket = Math.round(p.x * 100) / 100
        counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
      }
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (ranked.length < 2) return null

  const columns = ranked.map(([x]) => x).sort((a, b) => a - b)
  return {
    leftX: columns[0],
    speechX: columns.find((x) => x > columns[0] + 0.08) ?? columns[0],
    tolerance: DEFAULT_TOLERANCE,
    source: 'guessed',
    sampleSize: 0,
  }
}

function centerInside(p: TextPiece, r: Rect): boolean {
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

interface Draft {
  page: number
  type: BlockType
  speaker: string | null
  pieces: TextPiece[]
  /** Set when the text differs from the pieces, e.g. an inline "NAME:" prefix. */
  textOverride?: string
}

/**
 * Scans pages and returns the blocks it found. Areas that an existing block
 * already covers are left alone, so running this twice changes nothing and a
 * partially annotated play can be completed.
 */
/**
 * What to do with a stage direction printed inside a spoken line, as in
 * "Wer ist das? (Er tritt ans Fenster.) Nur der junge Warrender."
 *
 * - `strip`: throw the insert away – shortest path to a clean recording.
 * - `split`: make it a block of its own, so it is read in the stage-direction
 *   voice while the speech keeps the character's.
 * - `keep`: leave it in the spoken text, brackets and all.
 */
export type InlineDirections = 'strip' | 'split' | 'keep'

export interface DetectOptions {
  inlineDirections: InlineDirections
  /**
   * Ignore pages on which no character speaks. Title page, legal notice and
   * cast list would otherwise turn into one enormous stage direction.
   */
  skipPagesWithoutDialogue: boolean
}

export function detectBlocks(
  piecesByPage: Map<number, TextPiece[]>,
  profile: LayoutProfile,
  existing: Block[],
  startOrder: number,
  options: DetectOptions = { inlineDirections: 'strip', skipPagesWithoutDialogue: true },
): DetectionResult {
  const drafts: Draft[] = []
  const pagesWithoutDialogue: number[] = []
  const pages = [...piecesByPage.keys()].sort((a, b) => a - b)

  for (const page of pages) {
    const pieces = piecesByPage.get(page) ?? []
    const pageStart = drafts.length
    let current: Draft | null = null
    const push = () => {
      if (current && piecesToText(current.pieces) !== '') drafts.push(current)
      current = null
    }

    const indented = profile.speechX - profile.tolerance
    const indentedLayout = profile.speechX > profile.leftX + 0.05

    for (const line of groupLines(pieces)) {
      // Everything left of the speech column belongs to the left column. Using
      // a narrow band around leftX instead would silently drop the second half
      // of names that are set as two pieces, such as "SIR" + "ROWLAND".
      const left = line.pieces.filter((p) => p.x < indented)
      const speech = line.pieces.filter((p) => p.x >= indented)
      const startsLeft = line.pieces[0].x <= profile.leftX + profile.tolerance
      // A line of spoken text always begins at the speech column. Page numbers
      // and running heads sit further right and are ignored.
      const startsIndented =
        speech.length > 0 && speech[0].x <= profile.speechX + profile.tolerance

      if (!startsLeft && !startsIndented) continue

      // Scripts without an indented speech column write the name inline, as in
      // "HUGO: Guten Abend." There is no geometry to go by, so the text itself
      // has to decide.
      if (!indentedLayout) {
        const guess = splitInlineSpeaker(piecesToText(line.pieces))
        if (guess) {
          push()
          drafts.push({
            page,
            type: 'line',
            speaker: guess.speaker,
            pieces: line.pieces,
            textOverride: guess.rest,
          })
        } else if (current?.type === 'direction') {
          current.pieces.push(...line.pieces)
        } else {
          push()
          current = { page, type: 'direction', speaker: null, pieces: [...line.pieces] }
        }
        continue
      }

      if (startsLeft && left.length > 0) {
        const leftText = piecesToText(left)
        // A speaker name is followed by a clear gap before the speech column.
        // A stage direction that happens to begin with a character name runs
        // straight across the column boundary instead.
        const leftEnd = Math.max(...left.map((p) => p.x + p.w))
        const gap = speech.length > 0 ? speech[0].x - leftEnd : 0
        const isSpeaker = startsIndented && gap >= 0.015 && looksLikeSpeakerName(leftText)

        if (isSpeaker) {
          push()
          current = {
            page,
            type: 'line',
            speaker: leftText.replace(/[:.]$/, '').trim(),
            pieces: speech,
          }
          continue
        }

        // Everything else in the left column is a stage direction. Consecutive
        // lines belong to the same one.
        if (current?.type === 'direction') {
          current.pieces.push(...line.pieces)
        } else {
          push()
          current = { page, type: 'direction', speaker: null, pieces: [...line.pieces] }
        }
        continue
      }

      // Only indented text: continuation of whatever is open.
      if (current) {
        current.pieces.push(...line.pieces)
      } else {
        // A speech carried over from the previous page. It keeps the speaker
        // of the block it continues, so it is spoken in the right voice.
        const previous = drafts[drafts.length - 1]
        const carried = previous?.type === 'line' ? previous.speaker : null
        current = { page, type: 'line', speaker: carried, pieces: [...line.pieces] }
      }
    }
    push()

    if (options.skipPagesWithoutDialogue) {
      const spoke = drafts.slice(pageStart).some((d) => d.type === 'line' && d.speaker)
      if (!spoke) {
        drafts.length = pageStart
        pagesWithoutDialogue.push(page)
      }
    }
  }

  const blocks: Block[] = []
  let skipped = 0
  let order = startOrder

  for (const d of drafts) {
    const rect = boundingBox(d.pieces)
    if (!rect) continue
    let text = d.textOverride ?? piecesToText(d.pieces)
    if (d.type === 'line' && options.inlineDirections === 'strip') {
      text = stripParentheticals(text)
    }
    if (text === '') continue
    if (existing.some((b) => b.page === d.page && overlaps(b.rect, rect))) {
      skipped++
      continue
    }
    const block: Block = {
      id: newBlockId(),
      page: d.page,
      rect,
      order: 0, // filled in below, after a possible split
      type: d.type,
      speaker: d.type === 'direction' ? null : d.speaker,
      text,
    }
    const parts =
      d.type === 'line' && options.inlineDirections === 'split'
        ? splitBlockAtParens(block)
        : [block]
    for (const p of parts) blocks.push({ ...p, order: order++ })
  }

  return { blocks, skipped, pagesScanned: pages.length, pagesWithoutDialogue }
}

function boundingBox(pieces: TextPiece[]): Rect | null {
  if (pieces.length === 0) return null
  let x0 = 1
  let y0 = 1
  let x1 = 0
  let y1 = 0
  for (const p of pieces) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x + p.w)
    y1 = Math.max(y1, p.y + p.h)
  }
  const pad = 0.004
  return {
    x: Math.max(0, x0 - pad),
    y: Math.max(0, y0 - pad),
    w: Math.min(1, x1 - x0 + 2 * pad),
    h: Math.min(1, y1 - y0 + 2 * pad),
  }
}

/** True when two rectangles share a meaningful part of their area. */
function overlaps(a: Rect, b: Rect): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (ox <= 0 || oy <= 0) return false
  const area = ox * oy
  return area > 0.3 * Math.min(a.w * a.h, b.w * b.h)
}
