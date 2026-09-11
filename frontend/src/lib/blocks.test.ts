import { describe, expect, it } from 'vitest'

import {
  hasParentheticals,
  renumber,
  splitBlockAtParens,
  splitParens,
  syncSpeakers,
} from './blocks'
import { DEFAULT_VOICE, VOICES } from './voices'
import { DIRECTION_KEY, type Block, type Speakers } from '../types'

const block = (text: string, over: Partial<Block> = {}): Block => ({
  id: 'b1',
  page: 4,
  rect: { x: 0.1, y: 0.2, w: 0.8, h: 0.05 },
  order: 7,
  type: 'line',
  speaker: 'HUGO',
  text,
  ...over,
})

describe('splitBlockAtParens', () => {
  it('trennt Sprechtext und Regieanweisung in eigene Blöcke', () => {
    const parts = splitBlockAtParens(
      block('Wer ist das? (Er tritt ans Fenster.) Nur der junge Warrender.'),
    )

    expect(parts.map((p) => [p.type, p.speaker, p.text])).toEqual([
      ['line', 'HUGO', 'Wer ist das?'],
      ['direction', null, 'Er tritt ans Fenster.'],
      ['line', 'HUGO', 'Nur der junge Warrender.'],
    ])
  })

  it('behält Rechteck und Seite, damit die Herkunft stimmt', () => {
    const original = block('Ja. (nickt) Sicher.')
    for (const p of splitBlockAtParens(original)) {
      expect(p.rect).toEqual(original.rect)
      expect(p.page).toBe(original.page)
    }
  })

  it('gibt dem ersten Teil die alte ID und den anderen neue', () => {
    const parts = splitBlockAtParens(block('Ja. (nickt) Sicher.'))
    expect(parts[0].id).toBe('b1')
    expect(new Set(parts.map((p) => p.id)).size).toBe(3)
  })

  it('sortiert die neuen Teile direkt hinter den alten Block', () => {
    const others = [block('davor', { id: 'a', order: 6 }), block('danach', { id: 'z', order: 8 })]
    const parts = splitBlockAtParens(block('Ja. (nickt) Sicher.'))
    const merged = renumber(
      [...others, ...parts].sort((a, b) => a.order - b.order),
    )
    expect(merged.map((b) => b.text)).toEqual(['davor', 'Ja.', 'nickt', 'Sicher.', 'danach'])
  })

  it('lässt einen Block ohne Klammern unangetastet', () => {
    const original = block('Ganz normaler Satz.')
    expect(splitBlockAtParens(original)).toEqual([original])
  })

  it('macht aus einer reinen Klammer keinen zweiten leeren Block', () => {
    const parts = splitBlockAtParens(block('(Er nippt.)'))
    expect(parts).toHaveLength(1)
    expect(parts[0].text).toBe('(Er nippt.)')
  })

  it('lässt eine Regieanweisung eine Regieanweisung bleiben', () => {
    const parts = splitBlockAtParens(
      block('Er tritt ein. (leise) Und geht wieder.', { type: 'direction', speaker: null }),
    )
    expect(parts.every((p) => p.type === 'direction')).toBe(true)
  })
})

describe('hasParentheticals', () => {
  it('erkennt eingeschobene Regieanweisungen', () => {
    expect(hasParentheticals('Ja. (nickt) Sicher.')).toBe(true)
    expect(hasParentheticals('Ganz normaler Satz.')).toBe(false)
    expect(hasParentheticals('Eine offene Klammer ( ohne Ende')).toBe(false)
  })
})

describe('splitParens', () => {
  it('behält den Text vollständig', () => {
    const text = 'Ja. (nickt) Sicher.'
    expect(splitParens(text).map((p) => p.text).join('')).toBe(text)
  })
})

describe('syncSpeakers', () => {
  const blocks = [
    block('Guten Abend.', { id: 'a', speaker: 'Gisela' }),
    block('Auch Ihnen.', { id: 'b', speaker: 'Wilhelm' }),
  ]

  it('legt jede neue Rolle mit der vorhandenen Stimme an', () => {
    const speakers = syncSpeakers(blocks, {})
    expect(Object.keys(speakers).sort()).toEqual(['Gisela', 'Wilhelm', DIRECTION_KEY])
    for (const config of Object.values(speakers)) {
      expect(config.model).toBe(DEFAULT_VOICE)
      expect(VOICES.some((v) => v.name === config.model)).toBe(true)
    }
  })

  /*
   * Ältere Projekte und alles, was von außen hereinkommt, führen Rollen ohne
   * Stimme: Früher musste eine ausgewählt werden, heute gibt es nur eine.
   */
  it('trägt die Stimme in Rollen nach, die keine haben', () => {
    const leer: Speakers = {
      Gisela: { model: '', speakerId: 0, lengthScale: 1, volume: 1, pitch: 1, color: '#000' },
    }
    const speakers = syncSpeakers(blocks, leer)
    expect(speakers.Gisela.model).toBe(DEFAULT_VOICE)
    expect(speakers.Gisela.color).toBe('#000')
  })

  it('lässt eine Stimme stehen, die es nicht mehr gibt', () => {
    const alt: Speakers = {
      Gisela: { model: 'de_DE-eva_k-x_low', speakerId: 0, lengthScale: 1, volume: 1, pitch: 1, color: '#000' },
    }
    expect(syncSpeakers(blocks, alt).Gisela.model).toBe('de_DE-eva_k-x_low')
  })

  it('gibt dieselbe Tabelle zurück, wenn nichts zu tun ist', () => {
    const einmal = syncSpeakers(blocks, {})
    expect(syncSpeakers(blocks, einmal)).toBe(einmal)
  })
})
