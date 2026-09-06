import { describe, expect, it } from 'vitest'

import {
  anchorAt,
  buildSteps,
  contextBefore,
  describeWhen,
  estimatedSeconds,
  indexOfPage,
  isOwnLine,
  pagesOf,
  resumeIndex,
  statsOf,
  upcomingBlockIDs,
} from './rehearsal'
import type { Block, SelectionItem } from '../types'

function block(id: string, order: number, speaker: string | null, text = `Text ${id}`): Block {
  return {
    id,
    page: 1,
    rect: { x: 0, y: 0, w: 1, h: 0.02 },
    order,
    type: speaker === null ? 'direction' : 'line',
    speaker,
    text,
  }
}

const blocks = [
  block('b1', 1, 'SIR'),
  block('b2', 2, 'HUGO'),
  block('b3', 3, null),
  block('b4', 4, 'hugo'),
  block('b5', 5, 'SIR', '   '),
]

const items: SelectionItem[] = [
  { blockId: 'b1' },
  { blockId: 'b2' },
  { announce: 'Weiter auf Seite 7.' },
  { blockId: 'b3' },
  { blockId: 'b4' },
  { blockId: 'b5' },
  { blockId: 'weggeworfen' },
]

describe('buildSteps', () => {
  it('markiert die eigenen Repliken als Sprechpause', () => {
    const steps = buildSteps(items, blocks, 'HUGO')
    expect(steps.map((s) => s.kind)).toEqual(['listen', 'speak', 'jump', 'listen', 'speak'])
  })

  it('erkennt die eigene Rolle unabhängig von Groß- und Kleinschreibung', () => {
    const steps = buildSteps([{ blockId: 'b4' }], blocks, 'HUGO')
    expect(steps[0].kind).toBe('speak')
  })

  it('lässt leere Blöcke und unbekannte IDs weg', () => {
    const steps = buildSteps(items, blocks, 'HUGO')
    expect(steps.map((s) => s.block?.id)).toEqual(['b1', 'b2', undefined, 'b3', 'b4'])
  })

  it('macht ohne eigene Rolle eine reine Hörfassung', () => {
    const steps = buildSteps(items, blocks, '')
    expect(steps.some((s) => s.kind === 'speak')).toBe(false)
  })

  it('behandelt Regieanweisungen nie als eigene Replik', () => {
    expect(isOwnLine(block('x', 1, null), 'HUGO')).toBe(false)
  })

  it('überspringt Regieanweisungen auf Wunsch', () => {
    const steps = buildSteps(items, blocks, 'HUGO', { includeDirections: false })
    expect(steps.map((s) => s.block?.id)).toEqual(['b1', 'b2', undefined, 'b4'])
    expect(steps.some((s) => s.block?.type === 'direction')).toBe(false)
  })

  it('behält Sprungmarken auch ohne Regieanweisungen', () => {
    const steps = buildSteps(items, blocks, 'HUGO', { includeDirections: false })
    expect(steps.filter((s) => s.kind === 'jump')).toHaveLength(1)
  })
})

describe('statsOf', () => {
  it('zählt, worauf es ankommt', () => {
    expect(statsOf(buildSteps(items, blocks, 'HUGO'))).toEqual({ total: 5, speak: 2, listen: 2 })
  })
})

describe('contextBefore', () => {
  it('liefert die letzten Repliken ohne Sprungmarken', () => {
    const steps = buildSteps(items, blocks, 'HUGO')
    // Index 4 ist b4; davor liegen b3, eine Sprungmarke und b2.
    expect(contextBefore(steps, 4, 2).map((s) => s.block?.id)).toEqual(['b2', 'b3'])
  })

  it('kommt am Anfang mit weniger aus', () => {
    const steps = buildSteps(items, blocks, 'HUGO')
    expect(contextBefore(steps, 0, 3)).toHaveLength(0)
  })
})

describe('upcomingBlockIDs', () => {
  it('überspringt Sprungmarken beim Vorladen', () => {
    const steps = buildSteps(items, blocks, 'HUGO')
    expect(upcomingBlockIDs(steps, 1, 3)).toEqual(['b2', 'b3', 'b4'])
  })

  it('läuft am Ende nicht über', () => {
    const steps = buildSteps(items, blocks, 'HUGO')
    expect(upcomingBlockIDs(steps, 4, 5)).toEqual(['b4'])
  })
})

describe('estimatedSeconds', () => {
  it('wächst mit der Länge, bleibt aber immer spürbar', () => {
    expect(estimatedSeconds('Ja.')).toBe(2)
    expect(estimatedSeconds('x'.repeat(130))).toBe(10)
  })
})

// --- where a run begins ----------------------------------------------------

function onPage(id: string, order: number, page: number, speaker: string | null = 'SIR'): Block {
  return { ...block(id, order, speaker), page }
}

/** Pages deliberately have gaps: a play does not start on page 1 of a scene. */
const paged: Block[] = [
  onPage('a', 1, 1),
  onPage('b', 2, 2),
  onPage('c', 3, 2, 'HUGO'),
  onPage('d', 4, 5),
]
const all = buildSteps(
  paged.map((b) => ({ blockId: b.id })),
  paged,
  'HUGO',
)
/** A selection with a hole in it, so the jump marker is in play. */
const gapped = buildSteps(
  [{ blockId: 'a' }, { announce: 'Weiter auf Seite 5.' }, { blockId: 'd' }],
  paged,
  'HUGO',
)

describe('pagesOf', () => {
  it('nennt die Seiten, auf denen etwas liegt, ohne Dopplungen', () => {
    expect(pagesOf(all)).toEqual([1, 2, 5])
  })

  it('ist bei leerem Durchlauf leer', () => {
    expect(pagesOf([])).toEqual([])
  })
})

describe('indexOfPage', () => {
  it('findet den ersten Schritt auf der Seite', () => {
    expect(indexOfPage(all, 2)).toBe(1)
  })

  it('nimmt die nächste vorhandene Seite, wenn die gewünschte leer ist', () => {
    expect(indexOfPage(all, 3)).toBe(3)
  })

  it('meldet hinter der letzten Seite -1, statt stillschweigend vorn zu beginnen', () => {
    expect(indexOfPage(all, 6)).toBe(-1)
  })

  it('beginnt auf der Sprungmarke, nicht dahinter', () => {
    // Without "Weiter auf Seite 5." you land in the scene not knowing where.
    expect(gapped[1].kind).toBe('jump')
    expect(indexOfPage(gapped, 5)).toBe(1)
  })
})

describe('anchorAt', () => {
  it('nimmt den nächsten echten Schritt, wenn die Stelle eine Sprungmarke ist', () => {
    expect(anchorAt(gapped, 1)?.id).toBe('d')
  })

  it('fällt hinter dem Ende auf den letzten Schritt zurück', () => {
    expect(anchorAt(all, 99)?.id).toBe('d')
  })

  it('hat bei leerem Durchlauf nichts anzubieten', () => {
    expect(anchorAt([], 0)).toBeUndefined()
  })
})

describe('resumeIndex', () => {
  it('findet den gemerkten Block selbst', () => {
    expect(resumeIndex(all, { blockId: 'c', order: 3, page: 2 })).toEqual({
      index: 2,
      match: 'exact',
    })
  })

  it('weicht auf die Lesereihenfolge aus, wenn der Block fehlt', () => {
    // Deleted in the editor, or cut away by a different selection.
    expect(resumeIndex(all, { blockId: 'weg', order: 3, page: 2 })).toEqual({
      index: 2,
      match: 'nearest',
    })
  })

  it('weicht auf die Seite aus, wenn die Reihenfolge nichts findet', () => {
    // Re-ordered blocks: the page is the last thing still recognisable.
    const shuffled = [onPage('x', 1, 9), onPage('y', 2, 1)]
    const steps = buildSteps(
      shuffled.map((b) => ({ blockId: b.id })),
      shuffled,
      'HUGO',
    )
    expect(resumeIndex(steps, { blockId: 'weg', order: 50, page: 9 })).toEqual({
      index: 0,
      match: 'nearest',
    })
  })

  it('sagt es, wenn die Stelle gar nicht in die Auswahl passt', () => {
    expect(resumeIndex(all, { blockId: 'weg', order: 99, page: 99 })).toEqual({
      index: 0,
      match: 'lost',
    })
  })

  it('landet auf der Sprungmarke vor dem gemerkten Block', () => {
    expect(resumeIndex(gapped, { blockId: 'd', order: 4, page: 5 })).toEqual({
      index: 1,
      match: 'exact',
    })
  })
})

describe('describeWhen', () => {
  const now = new Date('2026-03-12T20:00:00Z')
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

  it('bleibt bei kurz Zurückliegendem ungenau', () => {
    expect(describeWhen(ago(0), now)).toBe('gerade eben')
    expect(describeWhen(ago(1), now)).toBe('vor 1 Minute')
    expect(describeWhen(ago(40), now)).toBe('vor 40 Minuten')
    expect(describeWhen(ago(3 * 60), now)).toBe('vor 3 Stunden')
  })

  it('wechselt zu Tagen und dann zum Datum', () => {
    expect(describeWhen(ago(24 * 60), now)).toBe('gestern')
    expect(describeWhen(ago(3 * 24 * 60), now)).toBe('vor 3 Tagen')
    expect(describeWhen(ago(40 * 24 * 60), now)).toMatch(/^\d{2}\.\d{2}\.\d{4}$/)
  })

  it('bleibt bei kaputtem Zeitstempel still, statt „Invalid Date“ zu zeigen', () => {
    expect(describeWhen('kein datum', now)).toBe('')
  })
})
