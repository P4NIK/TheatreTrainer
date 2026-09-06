/**
 * The rehearsal run: turning a selection into a sequence of steps.
 *
 * Rehearsing with a recording is a simple loop – listen, speak, compare – and
 * the only thing that really has to be decided is where your own lines are.
 * Everything else is playback. Keeping that decision here, away from the
 * component, makes it something a test can pin down.
 */
import type { Block, SelectionItem } from '../types'

export type StepKind =
  /** Someone else speaks – or a stage direction is read. */
  | 'listen'
  /** Your line: the recording pauses and waits for you. */
  | 'speak'
  /** A gap in the selection: "Weiter auf Seite 12." */
  | 'jump'

export interface Step {
  kind: StepKind
  /** Set for 'listen' and 'speak'. */
  block?: Block
  /** Set for 'jump'. */
  announce?: string
}

/** Case-insensitive, because speaker names are typed by hand. */
export function isOwnLine(block: Block, role: string): boolean {
  return (
    block.type === 'line' &&
    role.trim() !== '' &&
    (block.speaker ?? '').trim().toLowerCase() === role.trim().toLowerCase()
  )
}

export interface StepOptions {
  /** Read the stage directions along, or skip them entirely. */
  includeDirections: boolean
}

/**
 * Turns the render list of a selection into rehearsal steps. Blocks without
 * text are dropped – there is nothing to play and nothing to say.
 */
export function buildSteps(
  items: SelectionItem[],
  blocks: Block[],
  role: string,
  options: StepOptions = { includeDirections: true },
): Step[] {
  const byID = new Map(blocks.map((b) => [b.id, b]))
  const steps: Step[] = []

  for (const item of items) {
    if (item.announce) {
      steps.push({ kind: 'jump', announce: item.announce })
      continue
    }
    const block = item.blockId ? byID.get(item.blockId) : undefined
    if (!block || block.text.trim() === '') continue
    if (block.type === 'direction' && !options.includeDirections) continue
    steps.push({ kind: isOwnLine(block, role) ? 'speak' : 'listen', block })
  }

  return steps
}

export interface RunStats {
  total: number
  /** Your own lines – the ones that make the rehearsal a rehearsal. */
  speak: number
  listen: number
}

export function statsOf(steps: Step[]): RunStats {
  return {
    total: steps.length,
    speak: steps.filter((s) => s.kind === 'speak').length,
    listen: steps.filter((s) => s.kind === 'listen').length,
  }
}

/**
 * The lines just before `index`, newest last – the little bit of context that
 * makes it clear where in the scene you are.
 */
export function contextBefore(steps: Step[], index: number, count: number): Step[] {
  const out: Step[] = []
  for (let i = index - 1; i >= 0 && out.length < count; i--) {
    if (steps[i].kind !== 'jump') out.unshift(steps[i])
  }
  return out
}

/** Block IDs of the next `count` steps that need audio, for prefetching. */
export function upcomingBlockIDs(steps: Step[], index: number, count: number): string[] {
  const ids: string[] = []
  for (let i = index; i < steps.length && ids.length < count; i++) {
    const id = steps[i].block?.id
    if (id) ids.push(id)
  }
  return ids
}

/** How long a spoken line roughly takes – used for the optional auto-pause. */
export function estimatedSeconds(text: string): number {
  // ~13 characters per second is about the pace of the synthesised voices,
  // measured on the German Piper models this app ships with.
  return Math.max(2, Math.round(text.trim().length / 13))
}

// --- where a run begins ----------------------------------------------------

/**
 * A position sitting directly behind a jump marker is moved onto the marker.
 * "Weiter auf Seite 12." is the sentence that says where you are; starting just
 * after it drops you into a scene with no idea how you got there.
 */
function withJump(steps: Step[], index: number): number {
  if (index <= 0) return index
  return steps[index - 1].kind === 'jump' ? index - 1 : index
}

/** Pages that actually carry a step, ascending – the range "from page" allows. */
export function pagesOf(steps: Step[]): number[] {
  const seen = new Set<number>()
  for (const s of steps) if (s.block) seen.add(s.block.page)
  return [...seen].sort((a, b) => a - b)
}

/**
 * The first step on `page` or after it. -1 when the run ends before that page –
 * the caller has to say so rather than quietly starting at the top.
 */
export function indexOfPage(steps: Step[], page: number): number {
  const i = steps.findIndex((s) => s.block !== undefined && s.block.page >= page)
  return withJump(steps, i)
}

/**
 * The block a position is remembered by. Jump markers carry none, so the next
 * real step stands in – and at the very end, the previous one.
 */
export function anchorAt(steps: Step[], index: number): Block | undefined {
  for (let i = Math.max(0, index); i < steps.length; i++) {
    if (steps[i].block) return steps[i].block
  }
  for (let i = Math.min(index, steps.length) - 1; i >= 0; i--) {
    if (steps[i].block) return steps[i].block
  }
  return undefined
}

/** How a saved position was found again. */
export type ResumeMatch = 'exact' | 'nearest' | 'lost'

export interface ResumePoint {
  index: number
  match: ResumeMatch
}

/** The parts of a saved position that are needed to find it again. */
export interface ResumeAnchor {
  blockId: string
  order: number
  page: number
}

/**
 * Where to pick up a saved position.
 *
 * The block is looked for first. It can be gone – deleted, or cut away by a
 * different selection – and then the reading order and finally the page decide,
 * so the run resumes near where it stopped instead of at the beginning. Only
 * when even that finds nothing does it start over, and says so.
 */
export function resumeIndex(steps: Step[], anchor: ResumeAnchor): ResumePoint {
  const exact = steps.findIndex((s) => s.block?.id === anchor.blockId)
  if (exact >= 0) return { index: withJump(steps, exact), match: 'exact' }

  const byOrder = steps.findIndex((s) => s.block !== undefined && s.block.order >= anchor.order)
  if (byOrder >= 0) return { index: withJump(steps, byOrder), match: 'nearest' }

  const byPage = indexOfPage(steps, anchor.page)
  if (byPage >= 0) return { index: byPage, match: 'nearest' }

  return { index: 0, match: 'lost' }
}

/**
 * "vor 5 Minuten", "gestern", "12.03.2026" – how long ago the position was
 * saved. Vague on purpose: the point is whether this was today or a while back,
 * not the exact minute.
 */
export function describeWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`

  const days = Math.round(hours / 24)
  if (days === 1) return 'gestern'
  if (days < 7) return `vor ${days} Tagen`

  return then.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
