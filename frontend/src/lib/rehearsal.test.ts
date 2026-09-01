import { describe, expect, it } from 'vitest'

import {
  buildSteps,
  contextBefore,
  estimatedSeconds,
  isOwnLine,
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
