/**
 * Picking a part of the play instead of the whole thing.
 *
 * Two things are wanted in practice: a plain range ("only act one", which in
 * the script is a range of pages), and everything around one's own role, with
 * a couple of lines of lead-in so the cue is there. Both end up as the same
 * thing – a list of blocks, plus optional spoken markers where something was
 * left out, so it stays clear where in the play you are.
 */
import type { Block, Project, SelectionItem } from '../types'

export type { SelectionItem }

export type SelectionMode = 'all' | 'pages' | 'role'

export interface SelectionSettings {
  mode: SelectionMode
  /** Page range, used by mode 'pages'. */
  fromPage: number
  toPage: number
  /** Blocks kept before and after each of your own lines, used by mode 'role'. */
  lead: number
  trail: number
  /** Two stretches closer than this many blocks are joined instead of split. */
  mergeGap: number
  /** Announce the page before every stretch that does not follow the previous one. */
  announce: boolean
}

export interface Stretch {
  from: number
  to: number
  fromPage: number
  toPage: number
  blocks: number
  /** Own lines inside this stretch. */
  ownLines: number
}

export interface Selection {
  items: SelectionItem[]
  blocks: Block[]
  stretches: Stretch[]
  /** Blocks left out compared to the whole play. */
  omitted: number
}

export const defaultSelection: SelectionSettings = {
  mode: 'all',
  fromPage: 1,
  toPage: 1,
  lead: 2,
  trail: 1,
  mergeGap: 3,
  announce: true,
}

function ordered(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => a.order - b.order)
}

/** Case-insensitive, because speaker names are typed by hand. */
function isOwnLine(b: Block, myRole: string): boolean {
  return (
    b.type === 'line' &&
    myRole !== '' &&
    (b.speaker ?? '').trim().toLowerCase() === myRole.trim().toLowerCase()
  )
}

/**
 * Turns index ranges into the render list, inserting a spoken marker wherever
 * a piece of the play was skipped.
 */
function assemble(all: Block[], ranges: [number, number][], announce: boolean): Selection {
  const items: SelectionItem[] = []
  const blocks: Block[] = []
  const stretches: Stretch[] = []
  let previousEnd = -1

  for (const [from, to] of ranges) {
    const part = all.slice(from, to + 1)
    if (part.length === 0) continue

    if (announce && (from > 0 || previousEnd >= 0) && from !== previousEnd + 1) {
      items.push({ announce: `Weiter auf Seite ${part[0].page}.` })
    }
    for (const b of part) {
      items.push({ blockId: b.id })
      blocks.push(b)
    }
    stretches.push({
      from,
      to,
      fromPage: part[0].page,
      toPage: part[part.length - 1].page,
      blocks: part.length,
      ownLines: 0,
    })
    previousEnd = to
  }

  return { items, blocks, stretches, omitted: all.length - blocks.length }
}

/** Merges ranges that overlap or sit closer together than `mergeGap` blocks. */
function mergeRanges(ranges: [number, number][], mergeGap: number): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] - last[1] - 1 <= mergeGap) {
      last[1] = Math.max(last[1], r[1])
    } else {
      out.push([...r] as [number, number])
    }
  }
  return out
}

export function buildSelection(
  blocks: Block[],
  project: Project,
  settings: SelectionSettings,
): Selection {
  const all = ordered(blocks)
  if (all.length === 0) return { items: [], blocks: [], stretches: [], omitted: 0 }

  if (settings.mode === 'all') {
    return assemble(all, [[0, all.length - 1]], false)
  }

  if (settings.mode === 'pages') {
    const from = Math.min(settings.fromPage, settings.toPage)
    const to = Math.max(settings.fromPage, settings.toPage)
    const first = all.findIndex((b) => b.page >= from)
    if (first < 0) return { items: [], blocks: [], stretches: [], omitted: all.length }
    let last = first
    for (let i = first; i < all.length; i++) {
      if (all[i].page <= to) last = i
    }
    // Announcing makes no sense for a single continuous range.
    return assemble(all, [[first, last]], false)
  }

  // mode 'role'
  const own = all
    .map((b, i) => (isOwnLine(b, project.myRole) ? i : -1))
    .filter((i) => i >= 0)
  if (own.length === 0) return { items: [], blocks: [], stretches: [], omitted: all.length }

  const ranges = mergeRanges(
    own.map((i) => [
      Math.max(0, i - Math.max(0, settings.lead)),
      Math.min(all.length - 1, i + Math.max(0, settings.trail)),
    ]),
    Math.max(0, settings.mergeGap),
  )

  const selection = assemble(all, ranges, settings.announce)
  for (const s of selection.stretches) {
    s.ownLines = all.slice(s.from, s.to + 1).filter((b) => isOwnLine(b, project.myRole)).length
  }
  return selection
}

/** "S. 4–8" or "S. 12" – for the summary in the dialog. */
export function describeStretch(s: Stretch): string {
  return s.fromPage === s.toPage ? `S. ${s.fromPage}` : `S. ${s.fromPage}–${s.toPage}`
}

/** Goes into the download name, so several excerpts can live side by side. */
export function selectionSuffix(settings: SelectionSettings): string {
  if (settings.mode === 'pages') {
    const from = Math.min(settings.fromPage, settings.toPage)
    const to = Math.max(settings.fromPage, settings.toPage)
    return from === to ? `-seite-${from}` : `-seiten-${from}-${to}`
  }
  if (settings.mode === 'role') return '-auftritte'
  return ''
}
