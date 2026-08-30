import { describe, expect, it } from 'vitest'

import {
  buildSelection,
  defaultSelection,
  selectionSuffix,
  type SelectionSettings,
} from './selection'
import type { Block, Project } from '../types'

const project: Project = {
  id: 'p',
  name: 'Stück',
  pdfFile: 'source.pdf',
  pageCount: 10,
  createdAt: '2026-01-01T00:00:00Z',
  myRole: 'HUGO',
}

/** Builds a play from a compact notation: "HUGO", "SIR", "-" (stage direction). */
function play(spec: string[], pageEvery = 4): Block[] {
  return spec.map((who, i) => ({
    id: `b${i + 1}`,
    page: Math.floor(i / pageEvery) + 1,
    rect: { x: 0, y: 0, w: 1, h: 0.02 },
    order: i + 1,
    type: who === '-' ? ('direction' as const) : ('line' as const),
    speaker: who === '-' ? null : who,
    text: `${who} ${i + 1}`,
  }))
}

const settings = (over: Partial<SelectionSettings>): SelectionSettings => ({
  ...defaultSelection,
  ...over,
})

describe('buildSelection – ganzes Stück', () => {
  it('nimmt alles und kündigt nichts an', () => {
    const blocks = play(['SIR', 'HUGO', '-', 'SIR'])
    const sel = buildSelection(blocks, project, settings({ mode: 'all' }))

    expect(sel.blocks).toHaveLength(4)
    expect(sel.items.every((i) => i.blockId)).toBe(true)
    expect(sel.omitted).toBe(0)
  })
})

describe('buildSelection – Seitenbereich', () => {
  const blocks = play(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 2) // 2 Blöcke je Seite

  it('nimmt genau die Blöcke der gewählten Seiten', () => {
    const sel = buildSelection(blocks, project, settings({ mode: 'pages', fromPage: 2, toPage: 3 }))

    expect(sel.blocks.map((b) => b.text)).toEqual(['C 3', 'D 4', 'E 5', 'F 6'])
    expect(sel.omitted).toBe(4)
  })

  it('dreht eine verkehrt herum eingegebene Spanne um', () => {
    const a = buildSelection(blocks, project, settings({ mode: 'pages', fromPage: 3, toPage: 2 }))
    const b = buildSelection(blocks, project, settings({ mode: 'pages', fromPage: 2, toPage: 3 }))
    expect(a.blocks).toEqual(b.blocks)
  })

  it('liefert nichts, wenn der Bereich hinter dem Stück liegt', () => {
    const sel = buildSelection(blocks, project, settings({ mode: 'pages', fromPage: 9, toPage: 9 }))
    expect(sel.blocks).toHaveLength(0)
  })
})

describe('buildSelection – meine Auftritte', () => {
  //            0     1      2     3     4     5     6     7      8     9     10
  const spec = ['SIR', 'SIR', '-', 'HUGO', 'SIR', '-', 'SIR', 'SIR', 'SIR', 'SIR', 'HUGO']
  const blocks = play(spec, 4)

  it('nimmt Vorlauf und Nachlauf um jede eigene Replik', () => {
    const sel = buildSelection(
      blocks,
      project,
      settings({ mode: 'role', lead: 2, trail: 1, mergeGap: 0, announce: false }),
    )

    // Um Index 3: 1..4, um Index 10: 8..10
    expect(sel.blocks.map((b) => b.order)).toEqual([2, 3, 4, 5, 9, 10, 11])
    expect(sel.stretches).toHaveLength(2)
    expect(sel.stretches[0].ownLines).toBe(1)
  })

  it('fasst nah beieinander liegende Auftritte zusammen', () => {
    const dense = play(['SIR', 'HUGO', 'SIR', 'SIR', 'HUGO', 'SIR'], 4)
    const sel = buildSelection(
      dense,
      project,
      settings({ mode: 'role', lead: 1, trail: 1, mergeGap: 3, announce: false }),
    )

    expect(sel.stretches).toHaveLength(1)
    expect(sel.blocks).toHaveLength(6)
  })

  it('lässt getrennte Auftritte getrennt, wenn die Lücke groß ist', () => {
    const sel = buildSelection(
      blocks,
      project,
      settings({ mode: 'role', lead: 0, trail: 0, mergeGap: 1, announce: false }),
    )
    expect(sel.stretches).toHaveLength(2)
  })

  it('kündigt die Seite an, wo etwas übersprungen wurde', () => {
    const sel = buildSelection(
      blocks,
      project,
      settings({ mode: 'role', lead: 2, trail: 1, mergeGap: 0, announce: true }),
    )

    const announcements = sel.items.filter((i) => i.announce)
    // Vor dem ersten Stück (es beginnt nicht bei Block 1) und vor dem zweiten.
    expect(announcements).toHaveLength(2)
    expect(announcements[1].announce).toMatch(/^Weiter auf Seite \d+\.$/)
  })

  it('sagt nichts an, wenn die Auswahl lückenlos am Anfang beginnt', () => {
    const early = play(['HUGO', 'SIR', 'SIR'], 4)
    const sel = buildSelection(
      early,
      project,
      settings({ mode: 'role', lead: 2, trail: 2, mergeGap: 0, announce: true }),
    )
    expect(sel.items.filter((i) => i.announce)).toHaveLength(0)
  })

  it('liefert nichts, wenn die eigene Rolle gar nicht spricht', () => {
    const sel = buildSelection(
      play(['SIR', 'SIR']),
      { ...project, myRole: 'PIPPA' },
      settings({ mode: 'role' }),
    )
    expect(sel.blocks).toHaveLength(0)
  })

  it('erkennt die eigene Rolle unabhängig von Groß- und Kleinschreibung', () => {
    const sel = buildSelection(
      play(['SIR', 'hugo', 'SIR']),
      project,
      settings({ mode: 'role', lead: 0, trail: 0, mergeGap: 0, announce: false }),
    )
    expect(sel.blocks).toHaveLength(1)
  })
})

describe('buildSelection – einzelne Blöcke', () => {
  const blocks = play(['A', 'B', 'C', 'D', 'E', 'F'], 2) // 2 Blöcke je Seite

  it('nimmt genau die gewählten Blöcke in der Reihenfolge des Stücks', () => {
    const sel = buildSelection(
      blocks,
      project,
      settings({ mode: 'blocks', blockIds: ['b5', 'b1', 'b2'], announce: false }),
    )

    expect(sel.blocks.map((b) => b.order)).toEqual([1, 2, 5])
    expect(sel.omitted).toBe(3)
  })

  it('kündigt die Seite an, wo etwas übersprungen wurde', () => {
    const sel = buildSelection(
      blocks,
      project,
      settings({ mode: 'blocks', blockIds: ['b1', 'b2', 'b5'], announce: true }),
    )

    // b1/b2 stehen am Anfang – davor fehlt nichts. Vor b5 klafft eine Lücke.
    const announcements = sel.items.filter((i) => i.announce)
    expect(announcements).toHaveLength(1)
    expect(announcements[0].announce).toBe('Weiter auf Seite 3.')
    expect(sel.stretches).toHaveLength(2)
  })

  it('ignoriert Blöcke, die es nicht mehr gibt', () => {
    const sel = buildSelection(
      blocks,
      project,
      settings({ mode: 'blocks', blockIds: ['b2', 'geloescht'], announce: false }),
    )
    expect(sel.blocks.map((b) => b.id)).toEqual(['b2'])
  })

  it('liefert nichts, wenn nichts gewählt ist', () => {
    const sel = buildSelection(blocks, project, settings({ mode: 'blocks', blockIds: [] }))
    expect(sel.blocks).toHaveLength(0)
    expect(sel.items).toHaveLength(0)
  })
})

describe('selectionSuffix', () => {
  it('bleibt leer für das ganze Stück', () => {
    expect(selectionSuffix(settings({ mode: 'all' }))).toBe('')
  })

  it('nennt den Seitenbereich', () => {
    expect(selectionSuffix(settings({ mode: 'pages', fromPage: 4, toPage: 9 }))).toBe(
      '-seiten-4-9',
    )
    expect(selectionSuffix(settings({ mode: 'pages', fromPage: 7, toPage: 7 }))).toBe('-seite-7')
    // Verkehrt herum eingegeben ergibt denselben Namen.
    expect(selectionSuffix(settings({ mode: 'pages', fromPage: 9, toPage: 4 }))).toBe(
      '-seiten-4-9',
    )
  })

  it('markiert die Auftritte', () => {
    expect(selectionSuffix(settings({ mode: 'role' }))).toBe('-auftritte')
  })

  it('markiert die Einzelauswahl', () => {
    expect(selectionSuffix(settings({ mode: 'blocks' }))).toBe('-auswahl')
  })
})
