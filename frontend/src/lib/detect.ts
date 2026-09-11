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
  /**
   * Nach welcher Regel gelesen wird – und woher sie kommt.
   *
   * `learned` und `guessed` meinen dasselbe Muster: Sprecher und Regie stehen
   * in der linken Spalte, der Sprechtext eingerückt daneben. `fontStyle` ist
   * ein anderes Stück Typografie: keine Spalten, sondern fett für den Namen
   * und kursiv für die Regie, alles im selben Absatz.
   */
  source: 'learned' | 'guessed' | 'fontStyle'
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
  /**
   * Wie oft jede Rolle aufgerufen wurde – gezählt an den Namen, nicht an den
   * Blöcken. Eine Replik, die von einer Regieanweisung geteilt wird, ergibt
   * zwei Blöcke, aber einen Einsatz; nur so ist die Zahl mit der Rollenliste
   * des Stücks vergleichbar.
   */
  cues: Map<string, number>
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
  /**
   * Gesetzt, wo das Rechteck nicht aus den eigenen Stücken kommt.
   *
   * Im Schriftschnitt-Muster gehören mehrere Blöcke zu einem Absatz und teilen
   * sich dessen Umriss – Sprechtext und Regieanweisung stehen dort in
   * derselben Zeile, ein eigenes Rechteck je Block wäre ein Strich mitten
   * durch ein Wort.
   */
  rect?: Rect
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

/* ------------------------------------------- Muster: fett und kursiv */

/*
 * Das zweite Muster, nach dem Stücke gesetzt werden.
 *
 * Es gibt keine Spalten. Alles beginnt am linken Rand, und was der Leser
 * unterscheidet, unterscheidet er an der Schrift: der Sprechername fett und
 * mit Doppelpunkt, die Regieanweisung kursiv – mitten im Sprechtext in
 * Klammern, oder als ganzer Absatz für sich. Ein Block ist hier nicht eine
 * Zeile in einer Spalte, sondern ein Absatz, und der zerfällt in so viele
 * Blöcke, wie die Schrift darin wechselt.
 *
 * Was dabei nicht zum Stück gehört, muss vorher weg: die Kopfzeile des
 * Verlags, die Fußzeile mit der Seitenzahl, Akt- und Szenenüberschriften und
 * die Zeile mit den Personen der Szene.
 */

/** Eine Zeile mit dem, was die Absatzerkennung von ihr wissen muss. */
interface TextLine {
  y: number
  x0: number
  x1: number
  height: number
  text: string
  pieces: TextPiece[]
}

function textLines(pieces: TextPiece[]): TextLine[] {
  return groupLines(pieces).map((line) => ({
    y: line.y,
    x0: Math.min(...line.pieces.map((p) => p.x)),
    x1: Math.max(...line.pieces.map((p) => p.x + p.w)),
    height: Math.max(...line.pieces.map((p) => p.h)),
    text: piecesToText(line.pieces),
    pieces: line.pieces,
  }))
}

/** Höchstens so viele Wörter darf ein Name vor dem Doppelpunkt haben. */
const NAME_WORDS = 5

interface SpeakerHead {
  name: string
  /** Erstes Stück nach dem Namen. */
  next: number
  /** Was im selben Stück hinter dem Doppelpunkt stand. */
  rest: string
}

/**
 * Liest einen fett gesetzten Namen mit Doppelpunkt, beginnend bei `from`.
 *
 * Fett *und* Doppelpunkt müssen beide zutreffen. Fett allein ist im Fließtext
 * eine Hervorhebung, ein Doppelpunkt allein steht in jedem zweiten Satz.
 */
export function speakerHead(pieces: TextPiece[], from: number): SpeakerHead | null {
  if (!pieces[from]?.bold) return null

  for (let i = from; i < Math.min(from + NAME_WORDS + 1, pieces.length); i++) {
    const piece = pieces[i]
    const colon = piece.str.indexOf(':')
    if (colon >= 0) {
      const name = piecesToText(pieces.slice(from, i + 1)).split(':')[0].trim()
      if (!name || name.includes('(') || name.length > 40) return null
      return { name, next: i + 1, rest: piece.str.slice(colon + 1).trim() }
    }
    if (!piece.bold) return null
  }
  return null
}

const HEADING_RE = /^\d+\s*\.\s*(Akt|Szene|Aufzug|Auftritt|Bild)\b/i
const STAGE_WORDS = new Set(['vorhang', 'ende', 'pause', 'schluss', 'zwischenvorhang'])
/** Wie weit oben oder unten eine Zeile stehen muss, um Kopf- oder Fußzeile zu sein. */
const BAND = 0.15
/** Auf so vielen Seiten muss sie stehen, damit sie als laufende Zeile gilt. */
const RUNNING_SHARE = 0.6
/**
 * Und auf mindestens so vielen, gleichgültig wie kurz der Bereich ist.
 *
 * Sonst reichen bei drei durchsuchten Seiten schon zwei Treffer – und ein
 * Sprechername, der zweimal unten auf der Seite landet, wäre plötzlich eine
 * Fußzeile. Genau das ist beim Prüfen passiert.
 */
const RUNNING_PAGES = 3
/** So wenig darf ihre Höhe über die Seiten schwanken. Eine Fußzeile steht still. */
const RUNNING_DRIFT = 0.02
/** Zeile mit den Personen einer Szene: „Wilhelm, Gisela“, mittig gesetzt. */
const CAST_LINE_RE =
  /^[A-ZÄÖÜ][\wäöüß.-]*( [A-ZÄÖÜ][\wäöüß.-]*)*( *(,|und) *[A-ZÄÖÜ][\wäöüß.-]*( [A-ZÄÖÜ][\wäöüß.-]*)*)+$/

interface DocStats {
  /** Die Größe der Grundschrift; alles Größere ist eine Überschrift. */
  bodyHeight: number
  /** Zeilentexte, die auf fast jeder Seite oben oder unten stehen. */
  running: Set<string>
  /** Seite mit der ersten Akt- oder Szenenüberschrift; davor steht Beiwerk. */
  firstAct: number | null
}

/** Seitenzahlen wechseln, der Rest der Fußzeile nicht. */
function runningKey(text: string): string {
  return text.replace(/\d+/g, '#')
}

function documentStats(linesByPage: Map<number, TextLine[]>): DocStats {
  const heights: number[] = []
  const bands = new Map<string, { pages: Set<number>; top: number; bottom: number }>()
  let firstAct: number | null = null

  for (const page of [...linesByPage.keys()].sort((a, b) => a - b)) {
    for (const line of linesByPage.get(page) ?? []) {
      for (const piece of line.pieces) heights.push(piece.h)
      if (line.y <= BAND || line.y >= 1 - BAND) {
        const key = runningKey(line.text)
        const seen = bands.get(key) ?? { pages: new Set<number>(), top: line.y, bottom: line.y }
        seen.pages.add(page)
        seen.top = Math.min(seen.top, line.y)
        seen.bottom = Math.max(seen.bottom, line.y)
        bands.set(key, seen)
      }
      if (firstAct === null && HEADING_RE.test(line.text.trim())) firstAct = page
    }
  }

  const genug = Math.max(RUNNING_PAGES, linesByPage.size * RUNNING_SHARE)
  const running = new Set<string>()
  for (const [key, seen] of bands) {
    // Oft genug – und immer an derselben Stelle. Ein Satz, der zufällig
    // zweimal ans Seitenende rutscht, tut Letzteres nicht.
    if (seen.pages.size >= genug && seen.bottom - seen.top < RUNNING_DRIFT) running.add(key)
  }
  return { bodyHeight: heights.length ? median(heights) : 0.014, running, firstAct }
}

function isRunning(line: TextLine, stats: DocStats): boolean {
  if (line.y > BAND && line.y < 1 - BAND) return false
  return stats.running.has(runningKey(line.text))
}

function isHeading(line: TextLine, stats: DocStats): boolean {
  const text = line.text.trim()
  if (HEADING_RE.test(text)) return true
  if (line.height > stats.bodyHeight * 1.15) return true
  const centred = Math.abs((line.x0 + line.x1) / 2 - 0.5) < 0.05
  return (
    centred &&
    line.pieces[0]?.bold === true &&
    STAGE_WORDS.has(text.toLowerCase().replace(/[.!:\-\s]/g, ''))
  )
}

function isCastLine(line: TextLine): boolean {
  const centred = Math.abs((line.x0 + line.x1) / 2 - 0.5) < 0.04
  return centred && CAST_LINE_RE.test(line.text.trim())
}

/**
 * Absätze über die Zeilenabstände.
 *
 * Überschriften und Personenzeilen sind keine Blöcke, trennen aber – sonst
 * verschluckt eine Szenenüberschrift den Absatz, der ihr folgt.
 */
function paragraphsOf(lines: TextLine[], stats: DocStats): TextLine[][] {
  const body = lines.filter((line) => line.text.trim() !== '' && !isRunning(line, stats))
  if (body.length === 0) return []

  const gaps = body.slice(1).map((line, i) => line.y - body[i].y).filter((gap) => gap > 0)
  const limit = Math.max(gaps.length ? median(gaps) * 1.5 : 0.02, stats.bodyHeight * 1.6)

  const groups: TextLine[][] = []
  let current: TextLine[] = []
  let previous: TextLine | null = null

  for (const line of body) {
    if (isHeading(line, stats) || isCastLine(line)) {
      if (current.length) groups.push(current)
      current = []
      previous = null
      continue
    }
    if (previous && line.y - previous.y > limit) {
      groups.push(current)
      current = []
    }
    current.push(line)
    previous = line
  }
  if (current.length) groups.push(current)
  return groups.filter((group) => group.length > 0)
}

/**
 * Der Text einer kursiven Stelle, ohne die Klammern.
 *
 * Steht der ganze Absatz kursiv, ist er die Regieanweisung – auch wenn
 * irgendwo darin eine Klammer vorkommt. Nur wenn außerhalb der Klammern
 * nichts weiter steht, sind die Klammern die Blöcke.
 */
function directionTexts(text: string): string[] {
  const inner = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
  if (inner.length === 0) return [text.trim()].filter(Boolean)
  const outside = text.replace(/\([^)]*\)/g, ' ').replace(/[\s.,;:!?–-]+/g, '')
  return outside === '' ? inner : [text.trim()].filter(Boolean)
}

/** Zerlegt einen Absatz und gibt den Sprecher zurück, der danach gilt. */
function segmentParagraph(
  lines: TextLine[],
  page: number,
  speaker: string | null,
  options: DetectOptions,
  out: Draft[],
  cues: Map<string, number>,
): string | null {
  const pieces = lines.flatMap((line) => line.pieces)
  const lineStarts = new Set(lines.map((line) => line.pieces[0]).filter(Boolean))
  const rect = boundingBox(pieces)
  if (!rect) return speaker

  let buffer: TextPiece[] = []

  const push = (type: BlockType, text: string) => {
    if (text === '') return
    out.push({
      page,
      type,
      speaker: type === 'line' ? speaker : null,
      pieces,
      rect,
      textOverride: text,
    })
  }

  const flush = () => {
    if (buffer.length === 0) return

    const runs: { italic: boolean; pieces: TextPiece[] }[] = []
    for (const piece of buffer) {
      const last = runs[runs.length - 1]
      if (last && last.italic === (piece.italic === true)) last.pieces.push(piece)
      else runs.push({ italic: piece.italic === true, pieces: [piece] })
    }
    const onlyDirection = runs.every((run) => run.italic)

    // „im Text lassen“ heißt: gar nicht erst trennen.
    if (!onlyDirection && options.inlineDirections === 'keep') {
      push('line', piecesToText(buffer))
      buffer = []
      return
    }

    for (const run of runs) {
      const text = piecesToText(run.pieces)
      if (text === '') continue
      if (!run.italic) {
        push('line', text)
        continue
      }
      if (!onlyDirection && options.inlineDirections === 'strip') continue
      for (const part of directionTexts(text)) push('direction', part)
    }
    buffer = []
  }

  let i = 0
  while (i < pieces.length) {
    const head = lineStarts.has(pieces[i]) ? speakerHead(pieces, i) : null
    if (head) {
      flush()
      speaker = head.name
      cues.set(speaker, (cues.get(speaker) ?? 0) + 1)
      i = head.next
      // „Luzifer: Sie sind hier falsch.“ – der Rest steht im selben Stück.
      if (head.rest) {
        buffer.push({ ...pieces[head.next - 1], str: head.rest, bold: false, italic: false })
      }
      continue
    }
    buffer.push(pieces[i])
    i++
  }
  flush()
  return speaker
}

function draftsByFontStyle(
  piecesByPage: Map<number, TextPiece[]>,
  options: DetectOptions,
  cues: Map<string, number>,
): { drafts: Draft[]; pagesWithoutDialogue: number[] } {
  const linesByPage = new Map<number, TextLine[]>()
  for (const [page, pieces] of piecesByPage) linesByPage.set(page, textLines(pieces))
  const stats = documentStats(linesByPage)

  const drafts: Draft[] = []
  const pagesWithoutDialogue: number[] = []
  let speaker: string | null = null

  for (const page of [...piecesByPage.keys()].sort((a, b) => a - b)) {
    // Vor dem ersten Akt stehen Titelblatt, Verlagsbedingungen und
    // Rollenliste. Deren fett gesetzte Überschriften mit Doppelpunkt sehen
    // wie Sprechernamen aus – „Bühnenbild:“ ist keine Rolle.
    if (options.skipPagesWithoutDialogue && stats.firstAct !== null && page < stats.firstAct) {
      pagesWithoutDialogue.push(page)
      continue
    }

    const pageStart = drafts.length
    for (const paragraph of paragraphsOf(linesByPage.get(page) ?? [], stats)) {
      speaker = segmentParagraph(paragraph, page, speaker, options, drafts, cues)
    }

    if (options.skipPagesWithoutDialogue) {
      const spoke = drafts.slice(pageStart).some((d) => d.type === 'line' && d.speaker)
      if (!spoke) {
        drafts.length = pageStart
        pagesWithoutDialogue.push(page)
      }
    }
  }
  return { drafts, pagesWithoutDialogue }
}

/**
 * Erkennt das Muster daran, dass Absätze mit einem fetten Namen und einem
 * Doppelpunkt beginnen.
 *
 * Drei Treffer sind wenig, aber der Doppelpunkt hinter fetter Schrift am
 * Zeilenanfang kommt im Fließtext praktisch nicht vor. Der Anteil hält
 * zusätzlich ein Stück davon ab, an einer einzelnen fetten Zwischenzeile
 * hängenzubleiben.
 */
export function fontStyleProfile(piecesByPage: Map<number, TextPiece[]>): LayoutProfile | null {
  let names = 0
  let lines = 0
  let left = 1

  for (const pieces of piecesByPage.values()) {
    for (const line of textLines(pieces)) {
      if (line.text.trim() === '') continue
      lines++
      if (speakerHead(line.pieces, 0)) {
        names++
        left = Math.min(left, line.x0)
      }
    }
  }
  if (names < 3 || names < lines * 0.05) return null

  return {
    leftX: left,
    speechX: left,
    tolerance: DEFAULT_TOLERANCE,
    source: 'fontStyle',
    sampleSize: names,
  }
}

/**
 * Das Muster, nach dem gelesen wird.
 *
 * Der Schriftschnitt hat Vorrang: Wo fett und kursiv den Aufbau tragen, sagen
 * die Spaltenpositionen nichts – dort beginnt jede Zeile links. Erst danach
 * kommt das, was aus vorhandenen Blöcken gelernt oder aus dem Seitenaufbau
 * geraten wurde.
 */
export function chooseProfile(
  piecesByPage: Map<number, TextPiece[]>,
  blocks: Block[],
): LayoutProfile | null {
  const byFont = fontStyleProfile(piecesByPage)
  if (byFont) return byFont
  return (blocks.length ? learnProfile(piecesByPage, blocks) : null) ?? guessProfile(piecesByPage)
}

export interface CastEntry {
  role: string
  /** Was die Liste als Zahl der Einsätze nennt. */
  cues: number
}

/**
 * Die Rollenliste des Stücks, wo es eine gibt: „Wilhelm Holme (138)“.
 *
 * Zum Vergleich, nicht zur Korrektur. Die Zahl stammt aus dem Verlag und
 * stimmt nur, solange niemand das Stück gekürzt hat – als Anhaltspunkt taugt
 * sie trotzdem: Wer sie um zwei verfehlt, hat vermutlich zwei Einsätze
 * übersehen; wer sie um hundert verfehlt, hat ein anderes Problem.
 */
export function castList(piecesByPage: Map<number, TextPiece[]>): CastEntry[] {
  const out: CastEntry[] = []
  const seen = new Set<string>()

  for (const pieces of piecesByPage.values()) {
    for (const line of textLines(pieces)) {
      const match = line.text.trim().match(/^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-–— ]{1,40}?)\s*\((\d{1,4})\)$/)
      if (!match) continue
      const role = match[1].trim()
      if (seen.has(role)) continue
      seen.add(role)
      out.push({ role, cues: Number(match[2]) })
    }
  }
  return out
}

export function detectBlocks(
  piecesByPage: Map<number, TextPiece[]>,
  profile: LayoutProfile,
  existing: Block[],
  startOrder: number,
  options: DetectOptions = { inlineDirections: 'strip', skipPagesWithoutDialogue: true },
): DetectionResult {
  const pages = [...piecesByPage.keys()].sort((a, b) => a - b)
  const cues = new Map<string, number>()
  const { drafts, pagesWithoutDialogue } =
    profile.source === 'fontStyle'
      ? draftsByFontStyle(piecesByPage, options, cues)
      : draftsByColumns(piecesByPage, profile, options, cues)

  const blocks: Block[] = []
  let skipped = 0
  let order = startOrder

  for (const d of drafts) {
    const rect = d.rect ?? boundingBox(d.pieces)
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

  return { blocks, skipped, pagesScanned: pages.length, pagesWithoutDialogue, cues }
}

/**
 * Das Spalten-Muster: Sprechername und Regie links, Sprechtext eingerückt.
 *
 * Unverändert das, was die Erkennung von Anfang an konnte – nur steht es
 * jetzt neben dem zweiten Muster statt allein.
 */
function draftsByColumns(
  piecesByPage: Map<number, TextPiece[]>,
  profile: LayoutProfile,
  options: DetectOptions,
  cues: Map<string, number>,
): { drafts: Draft[]; pagesWithoutDialogue: number[] } {
  const drafts: Draft[] = []
  const pagesWithoutDialogue: number[] = []

  for (const page of [...piecesByPage.keys()].sort((a, b) => a - b)) {
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
          cues.set(guess.speaker, (cues.get(guess.speaker) ?? 0) + 1)
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
          cues.set(
            leftText.replace(/[:.]$/, '').trim(),
            (cues.get(leftText.replace(/[:.]$/, '').trim()) ?? 0) + 1,
          )
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

  return { drafts, pagesWithoutDialogue }
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
