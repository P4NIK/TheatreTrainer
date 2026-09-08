import { describe, expect, it } from 'vitest'

import type { Block, Speakers } from '../types'
import { DIRECTION_KEY } from '../types'
import {
  cacheKey,
  doneMessage,
  formatFloat,
  normalizeText,
  planRun,
  referencedKeys,
  renderPlan,
  requestFor,
  speakerKeyOf,
  type PlanItem,
  type PlanOptions,
  type SynthRequest,
} from './pipeline'

const RATE = 22050

function block(over: Partial<Block> & Pick<Block, 'id'>): Block {
  return {
    page: 1,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    order: 0,
    type: 'line',
    speaker: 'HUGO',
    text: 'Guten Abend.',
    ...over,
  }
}

const voice = (model: string) => ({
  model, speakerId: 0, lengthScale: 1, volume: 1, pitch: 1, color: '#000',
})

const speakers: Speakers = {
  HUGO: voice('de_DE-thorsten-medium'),
  ANNA: voice('de_DE-mls-medium'),
  [DIRECTION_KEY]: voice('de_DE-thorsten-medium'),
}

const known = ['de_DE-thorsten-medium', 'de_DE-mls-medium']
const both: PlanOptions = { skipMyRole: false, includeDirections: true }

describe('speakerKeyOf', () => {
  it('lässt Regieanweisungen weg, wenn sie nicht gewünscht sind', () => {
    const b = block({ id: 'r', type: 'direction', speaker: null })
    expect(speakerKeyOf(b, { myRole: '' }, { skipMyRole: false, includeDirections: false }))
      .toEqual({ key: '', skip: true })
    expect(speakerKeyOf(b, { myRole: '' }, both)).toEqual({ key: DIRECTION_KEY, skip: false })
  })

  it('schickt eine Replik ohne Sprechernamen zur Regiestimme', () => {
    expect(speakerKeyOf(block({ id: 'a', speaker: null }), { myRole: '' }, both))
      .toEqual({ key: DIRECTION_KEY, skip: false })
    expect(speakerKeyOf(block({ id: 'a', speaker: '   ' }), { myRole: '' }, both))
      .toEqual({ key: DIRECTION_KEY, skip: false })
  })

  it('erkennt die eigene Rolle ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    const b = block({ id: 'a', speaker: 'Hugo' })
    const opts: PlanOptions = { skipMyRole: true, includeDirections: true }
    expect(speakerKeyOf(b, { myRole: 'HUGO' }, opts)).toEqual({ key: 'Hugo', skip: true })
    expect(speakerKeyOf(b, { myRole: 'ANNA' }, opts)).toEqual({ key: 'Hugo', skip: false })
    // Ohne eigene Rolle wird nichts übersprungen.
    expect(speakerKeyOf(b, { myRole: '' }, opts)).toEqual({ key: 'Hugo', skip: false })
  })
})

describe('requestFor', () => {
  it('setzt fehlende Werte auf 1', () => {
    const withZeroes: Speakers = { HUGO: { ...voice('m'), lengthScale: 0, volume: 0, pitch: -1 } }
    const { request } = requestFor(block({ id: 'a' }), { myRole: '' }, withZeroes, both)
    expect(request).toMatchObject({ lengthScale: 1, volume: 1, pitch: 1 })
  })

  it('lehnt ab, was nicht sprechbar ist', () => {
    expect(requestFor(block({ id: 'a', text: '   ' }), { myRole: '' }, speakers, both).ok).toBe(false)
    expect(requestFor(block({ id: 'a', speaker: 'FREMD' }), { myRole: '' }, speakers, both).ok).toBe(false)
    const noModel: Speakers = { HUGO: voice('  ') }
    expect(requestFor(block({ id: 'a' }), { myRole: '' }, noModel, both).ok).toBe(false)
  })
})

describe('planRun', () => {
  const blocks = [
    block({ id: 'b1', speaker: 'HUGO', text: 'Erstens.' }),
    block({ id: 'b2', speaker: 'ANNA', text: 'Zweitens.' }),
    block({ id: 'b3', type: 'direction', speaker: null, text: '(leise)' }),
  ]

  it('nimmt ohne Auswahl das ganze Stück in Blockreihenfolge', () => {
    const { items, problems } = planRun({ project: { myRole: '' }, blocks, speakers, options: both, knownModels: known })
    expect(items.map((i) => i.request?.text)).toEqual(['Erstens.', 'Zweitens.', '(leise)'])
    expect(problems).toEqual([])
  })

  it('lässt Regieanweisungen weg, wenn sie abgewählt sind', () => {
    const { items } = planRun({
      project: { myRole: '' }, blocks, speakers, knownModels: known,
      options: { skipMyRole: false, includeDirections: false },
    })
    expect(items.map((i) => i.request?.text)).toEqual(['Erstens.', 'Zweitens.'])
  })

  it('erzeugt die eigene Rolle trotzdem, markiert sie aber als Pause', () => {
    const { items } = planRun({
      project: { myRole: 'HUGO' }, blocks, speakers, knownModels: known,
      options: { skipMyRole: true, includeDirections: true },
    })
    expect(items[0]).toMatchObject({ skip: true, fixedPause: false, label: 'HUGO' })
    expect(items[0].request?.text).toBe('Erstens.')
    expect(items[1].skip).toBe(false)
  })

  it('nimmt eine feste Pause, wenn die eigene Rolle gar keine Stimme hat', () => {
    const { items, problems } = planRun({
      project: { myRole: 'HUGO' }, blocks: [blocks[0]], speakers: { ANNA: voice('x') },
      knownModels: known, options: { skipMyRole: true, includeDirections: true },
    })
    expect(items).toEqual([{ skip: true, fixedPause: true, label: 'HUGO' }])
    expect(problems).toEqual([])
  })

  it('meldet fehlende Stimmen und unbekannte Modelle, sortiert und ohne Dopplung', () => {
    const { items, problems } = planRun({
      project: { myRole: '' },
      blocks: [
        block({ id: 'a', speaker: 'ZOE' }),
        block({ id: 'b', speaker: 'ZOE' }),
        block({ id: 'c', speaker: 'ANNA' }),
      ],
      speakers: { ANNA: voice('gibt-es-nicht') },
      knownModels: known,
      options: both,
      voicesLocation: 'voices/',
    })
    expect(items).toEqual([])
    expect(problems).toEqual([
      'ANNA: Modell "gibt-es-nicht" liegt nicht in voices/',
      'ZOE: keine Stimme zugewiesen',
    ])
  })

  it('nennt die Regiestimme beim Namen', () => {
    const { problems } = planRun({
      project: { myRole: '' }, blocks: [blocks[2]], speakers: {}, knownModels: known, options: both,
    })
    expect(problems).toEqual(['Regieanweisungen: keine Stimme zugewiesen'])
  })

  it('übergeht leere Blöcke und unbekannte Block-IDs', () => {
    const { items } = planRun({
      project: { myRole: '' },
      blocks: [block({ id: 'a', text: '  ' })],
      speakers, knownModels: known, options: both,
      selection: [{ blockId: 'a' }, { blockId: 'gibtesnicht' }],
    })
    expect(items).toEqual([])
  })

  describe('Sprungmarken', () => {
    it('spricht sie mit der Regiestimme', () => {
      const { items } = planRun({
        project: { myRole: '' }, blocks, speakers, knownModels: known, options: both,
        selection: [{ announce: 'Weiter auf Seite 31.' }, { blockId: 'b1' }],
      })
      expect(items[0]).toMatchObject({ label: 'Sprungmarke', skip: false })
      expect(items[0].request?.text).toBe('Weiter auf Seite 31.')
    })

    it('lässt sie stillschweigend weg, wenn es keine Regiestimme gibt', () => {
      const { items, problems } = planRun({
        project: { myRole: '' }, blocks, speakers: { HUGO: voice('de_DE-thorsten-medium') },
        knownModels: known, options: both, selection: [{ announce: 'Weiter auf Seite 31.' }],
      })
      expect(items).toEqual([])
      expect(problems).toEqual([]) // eine Hilfe, kein Inhalt - kein Fehler
    })
  })
})

describe('cacheKey', () => {
  const base: SynthRequest = {
    text: 'Guten Abend, Frau Nachbarin.', model: 'de_DE-thorsten-medium',
    speakerId: 0, lengthScale: 1, volume: 1, pitch: 1,
  }

  // Festgenagelt an der Ausgabe von synth.Key aus dem Backend. Ändert sich
  // dieser Wert, passt der gesamte vorhandene Zwischenspeicher nicht mehr.
  it('erzeugt denselben Schlüssel wie das Backend', async () => {
    expect(await cacheKey(base)).toBe('fe6f05e744a805d021fd0dae962894a9')
    expect(await cacheKey({ ...base, model: 'de_DE-mls-medium', speakerId: 7, lengthScale: 1.1 }))
      .toBe('4732bd9235f937bed8f4ba60a5408408')
  })

  it('ändert sich nicht mit Lautstärke und Tonhöhe', async () => {
    const moved = await cacheKey({ ...base, volume: 0.3, pitch: 1.25 })
    expect(moved).toBe(await cacheKey(base))
  })

  it('behandelt Leerraum wie Piper', async () => {
    expect(await cacheKey({ ...base, text: '  Guten   Abend,\tFrau\nNachbarin.  ' }))
      .toBe(await cacheKey(base))
  })

  it('nimmt für ein fehlendes Tempo 1,0', async () => {
    expect(await cacheKey({ ...base, lengthScale: 0 })).toBe(await cacheKey(base))
    expect(await cacheKey({ ...base, lengthScale: -5 })).toBe(await cacheKey(base))
  })

  it('unterscheidet, was Piper unterscheidet', async () => {
    const keys = new Set(await Promise.all([
      cacheKey(base),
      cacheKey({ ...base, text: 'Guten Abend, Frau Nachbarin!' }),
      cacheKey({ ...base, model: 'de_DE-mls-medium' }),
      cacheKey({ ...base, speakerId: 1 }),
      cacheKey({ ...base, lengthScale: 1.1 }),
    ]))
    expect(keys.size).toBe(5)
  })
})

describe('normalizeText und formatFloat', () => {
  it('fasst Leerraum zusammen', () => {
    expect(normalizeText('  a \t b \n c  ')).toBe('a b c')
    expect(normalizeText('   ')).toBe('')
    expect(normalizeText('')).toBe('')
  })

  // Go schreibt Fließkommazahlen nie mit Exponent; JavaScript ab 1e21 schon.
  it('schreibt Zahlen aus, wie Go es tut', () => {
    expect(formatFloat(1)).toBe('1')
    expect(formatFloat(1.1)).toBe('1.1')
    expect(formatFloat(1e21)).toBe('1000000000000000000000')
    expect(formatFloat(1e-7)).toBe('0.0000001')
    expect(formatFloat(-2.5e22)).toBe('-25000000000000000000000')
  })
})

describe('referencedKeys', () => {
  it('behält auch, was gerade nicht gebraucht wird', async () => {
    const blocks = [
      block({ id: 'a', speaker: 'HUGO', text: 'Meine Replik.' }),
      block({ id: 'b', type: 'direction', speaker: null, text: '(ab)' }),
    ]
    // Eigene Rolle und ausgeschaltete Regieanweisungen dürfen nichts entfernen.
    const keys = await referencedKeys({ myRole: 'HUGO' }, blocks, speakers)
    expect(keys.size).toBe(2)
  })
})

describe('renderPlan', () => {
  const tone = (n: number) => {
    const s = new Int16Array(n)
    for (let i = 0; i < n; i++) s[i] = 1000
    return s
  }
  const request: SynthRequest = {
    text: 'x', model: 'm', speakerId: 0, lengthScale: 1, volume: 1, pitch: 1,
  }
  const item = (over: Partial<PlanItem> = {}): PlanItem =>
    ({ request, skip: false, fixedPause: false, label: 'HUGO', ...over })

  const render = async () => ({ samples: tone(1000), sampleRate: RATE, fromCache: false })
  const options = { sampleRate: RATE, gapMs: 450, skippedRoleMs: 2500, render }

  it('hängt hinter jeden Block die Pause, auch hinter den letzten', async () => {
    const { samples } = await renderPlan([item(), item()], options)
    const gap = Math.trunc((RATE * 450) / 1000)
    expect(samples.length).toBe(2 * (1000 + gap))
    expect(samples[samples.length - 1]).toBe(0)
  })

  it('ersetzt die eigene Rolle durch Stille gleicher Länge', async () => {
    const { samples, stats } = await renderPlan([item({ skip: true })], options)
    const gap = Math.trunc((RATE * 450) / 1000)
    expect(samples.length).toBe(1000 + gap)
    expect(Array.from(samples.slice(0, 1000)).every((v) => v === 0)).toBe(true)
    expect(stats.skippedRole).toBe(1)
    // Trotzdem erzeugt - nur so ist die Länge bekannt.
    expect(stats.rendered).toBe(1)
  })

  it('nimmt die feste Pause, wenn keine Stimme da ist', async () => {
    const { samples, stats } = await renderPlan(
      [{ skip: true, fixedPause: true, label: 'HUGO' }], options)
    const expected = Math.trunc((RATE * 2500) / 1000) + Math.trunc((RATE * 450) / 1000)
    expect(samples.length).toBe(expected)
    expect(stats).toMatchObject({ rendered: 0, cached: 0, skippedRole: 1, fixedPauses: 1 })
  })

  it('rechnet einen Block mit anderer Abtastrate um', async () => {
    const { samples } = await renderPlan([item()], {
      ...options,
      render: async () => ({ samples: tone(1000), sampleRate: 16000, fromCache: false }),
    })
    const gap = Math.trunc((RATE * 450) / 1000)
    // 1000 Samples bei 16 kHz werden zu rund 1378 bei 22,05 kHz.
    expect(samples.length - gap).toBeGreaterThan(1370)
    expect(samples.length - gap).toBeLessThan(1385)
  })

  it('zählt Zwischenspeicher und Neuerzeugung getrennt', async () => {
    let call = 0
    const { stats, message } = await renderPlan([item(), item(), item()], {
      ...options,
      render: async () => ({ samples: tone(100), sampleRate: RATE, fromCache: call++ > 0 }),
    })
    expect(stats).toMatchObject({ rendered: 1, cached: 2 })
    expect(message).toBe('Fertig – 1 neu erzeugt, 2 aus dem Zwischenspeicher')
  })

  it('meldet den Fortschritt für jeden Eintrag', async () => {
    const seen: string[] = []
    await renderPlan([item(), { skip: true, fixedPause: true, label: 'HUGO' }], {
      ...options,
      onProgress: (p) => seen.push(`${p.done}/${p.total} ${p.message}`),
    })
    expect(seen).toEqual([
      '1/2 1/2 – 1 neu, 0 aus dem Zwischenspeicher',
      '2/2 Pause für die eigene Rolle',
    ])
  })

  it('bricht ab, wenn das Signal ausgelöst wird', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(renderPlan([item()], { ...options, signal: controller.signal }))
      .rejects.toThrow('Job abgebrochen')
  })
})

describe('doneMessage', () => {
  it('formuliert wie das Backend', () => {
    expect(doneMessage({ rendered: 3, cached: 4, skippedRole: 0, fixedPauses: 0 }))
      .toBe('Fertig – 3 neu erzeugt, 4 aus dem Zwischenspeicher')
    expect(doneMessage({ rendered: 3, cached: 4, skippedRole: 2, fixedPauses: 0 }))
      .toBe('Fertig – 3 neu erzeugt, 4 aus dem Zwischenspeicher, 2 Repliken als Pause')
    expect(doneMessage({ rendered: 3, cached: 4, skippedRole: 2, fixedPauses: 1 }))
      .toBe('Fertig – 3 neu erzeugt, 4 aus dem Zwischenspeicher, 2 Repliken als Pause'
        + ' (davon 1 mit fester Länge, weil der Rolle keine Stimme zugewiesen ist)')
  })
})
