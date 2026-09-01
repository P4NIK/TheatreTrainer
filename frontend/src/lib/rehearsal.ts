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

/**
 * Turns the render list of a selection into rehearsal steps. Blocks without
 * text are dropped – there is nothing to play and nothing to say.
 */
export function buildSteps(items: SelectionItem[], blocks: Block[], role: string): Step[] {
  const byID = new Map(blocks.map((b) => [b.id, b]))
  const steps: Step[] = []

  for (const item of items) {
    if (item.announce) {
      steps.push({ kind: 'jump', announce: item.announce })
      continue
    }
    const block = item.blockId ? byID.get(item.blockId) : undefined
    if (!block || block.text.trim() === '') continue
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
