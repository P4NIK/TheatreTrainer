import { describe, expect, it, vi } from 'vitest'

import type { Block, Speakers } from '../types'
import { DIRECTION_KEY } from '../types'
import { cacheKey, type SynthRequest } from './pipeline'
import { BlockCache, memoryStore } from './storage'
import { cachedRenderer, runSynthesis, tidyCache, GAP_MS, SAMPLE_RATE, SKIPPED_ROLE_MS } from './synth'

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
  ANNA: voice('de_DE-thorsten-medium'),
  [DIRECTION_KEY]: voice('de_DE-thorsten-medium'),
}

const known = ['de_DE-thorsten-medium']

const request = (over: Partial<SynthRequest> = {}): SynthRequest => ({
  text: 'Guten Abend.',
  model: 'de_DE-thorsten-medium',
  speakerId: 0,
  lengthScale: 1,
  volume: 1,
  pitch: 1,
  ...over,
})

/** A Piper that always says the same thing – a tone, so pitch is audible. */
function fakePiper(rate = RATE, n = RATE) {
  const calls: SynthRequest[] = []
  const synthesize = async (req: SynthRequest) => {
    calls.push(req)
    const samples = new Int16Array(n)
    for (let i = 0; i < n; i++) samples[i] = Math.round(9000 * Math.sin((2 * Math.PI * 180 * i) / rate))
    return { samples, sampleRate: rate }
  }
  return { calls, synthesize }
}

describe('cachedRenderer', () => {
  it('fragt Piper einmal und danach den Zwischenspeicher', async () => {
    const piper = fakePiper()
    const cache = new BlockCache(memoryStore())
    const render = cachedRenderer(piper.synthesize, cache)

    const first = await render(request())
    const second = await render(request())

    expect(piper.calls.length).toBe(1)
    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(true)
    expect(Array.from(second.samples)).toEqual(Array.from(first.samples))
  })

  // Der Schlüssel kennt Lautstärke und Tonhöhe nicht – genau deshalb ist ein
  // verschobener Regler umsonst und eine geänderte Replik nicht.
  it('erzeugt für einen anderen Regler nichts neu', async () => {
    const piper = fakePiper()
    const cache = new BlockCache(memoryStore())
    const render = cachedRenderer(piper.synthesize, cache)

    const laut = await render(request({ volume: 1 }))
    const leise = await render(request({ volume: 0.5 }))

    expect(piper.calls.length).toBe(1)
    expect(leise.fromCache).toBe(true)
    expect(Math.abs(leise.samples[1000])).toBeLessThan(Math.abs(laut.samples[1000]))
  })

  it('erzeugt für einen anderen Text neu', async () => {
    const piper = fakePiper()
    const render = cachedRenderer(piper.synthesize, new BlockCache(memoryStore()))

    await render(request())
    await render(request({ text: 'Etwas ganz anderes.' }))
    expect(piper.calls.length).toBe(2)
  })

  it('legt unter dem Schlüssel der Pipeline ab', async () => {
    const store = memoryStore()
    const piper = fakePiper()
    await cachedRenderer(piper.synthesize, new BlockCache(store))(request())

    const key = await cacheKey(request())
    expect((await store.list()).map((f) => f.name)).toEqual([`${key}.wav`])
  })

  it('lässt leeren Text gar nicht erst zu Piper', async () => {
    const piper = fakePiper()
    const render = cachedRenderer(piper.synthesize, new BlockCache(memoryStore()))

    const out = await render(request({ text: '  \n\t ' }))
    expect(piper.calls.length).toBe(0)
    expect(out.samples.length).toBe(0)
  })

  // Ein Zwischenspeicher, der nicht schreiben kann, ist ärgerlich – aber kein
  // Grund, den Durchlauf abzubrechen. Das Backend hat es geloggt und
  // weitergemacht.
  it('läuft weiter, wenn die Ablage streikt', async () => {
    const store = memoryStore()
    store.write = async () => {
      throw new Error('voll')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const piper = fakePiper()

    const out = await cachedRenderer(piper.synthesize, new BlockCache(store))(request())
    expect(out.samples.length).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('kommt auch ganz ohne Zwischenspeicher zurecht', async () => {
    const piper = fakePiper()
    const render = cachedRenderer(piper.synthesize)
    expect((await render(request())).fromCache).toBe(false)
    expect((await render(request())).fromCache).toBe(false)
  })
})

describe('runSynthesis', () => {
  const blocks = [
    block({ id: 'a', order: 0, speaker: 'HUGO', text: 'Guten Abend.' }),
    block({ id: 'b', order: 1, speaker: 'ANNA', text: 'Auch Ihnen einen guten Abend.' }),
  ]

  /*
   * Der Punkt, um den es geht: dieselbe Spur, einmal im Speicher gebaut und
   * einmal Stück für Stück auf die Platte geschrieben. Byte für Byte gleich –
   * sonst wäre der sparsame Weg ein anderer Weg.
   */
  it('schreibt dieselbe Datei, ob über den Speicher oder in eine Senke', async () => {
    const lauf = (sink?: Awaited<ReturnType<ReturnType<typeof memoryStore>['open']>>) =>
      runSynthesis(
        {
          project: { myRole: '' },
          blocks,
          speakers,
          options: { skipMyRole: false, includeDirections: true },
          knownModels: known,
        },
        cachedRenderer(fakePiper().synthesize, new BlockCache(memoryStore())),
        { sink },
      )

    const speicher = await lauf()
    const platte = memoryStore()
    const gestreamt = await lauf(await platte.open('track.wav'))

    expect(gestreamt.sampleCount).toBe(speicher.sampleCount)
    expect(gestreamt.samples.length).toBe(0) // nichts mehr im Speicher
    expect(gestreamt.stats).toEqual(speicher.stats)

    const erwartet = new Uint8Array(speicher.wav)
    const bekommen = new Uint8Array(await gestreamt.file.arrayBuffer())
    expect(bekommen.length).toBe(erwartet.length)
    expect(bekommen).toEqual(erwartet)
    // Und die Datei liegt danach wirklich im Speicher der Senke.
    expect((await platte.read('track.wav'))?.byteLength).toBe(erwartet.length)
  })

  // Ein Browser, der nicht zurückschreiben kann, soll das am Anfang sagen und
  // nicht nach getaner Arbeit.
  it('baut die Spur im Speicher, wenn die Senke nicht zurückschreiben kann', async () => {
    const platte = memoryStore()
    const sink = await platte.open('track.wav')
    sink.patch = () => Promise.reject(new Error('kein Zurückschreiben'))
    const abbruch = vi.spyOn(sink, 'abort')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const out = await runSynthesis(
      {
        project: { myRole: '' },
        blocks,
        speakers,
        options: { skipMyRole: false, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(fakePiper().synthesize, new BlockCache(memoryStore())),
      { sink },
    )

    expect(abbruch).toHaveBeenCalled()
    expect(out.samples.length).toBeGreaterThan(0)
    expect(out.file.size).toBe(44 + out.samples.length * 2)
    vi.restoreAllMocks()
  })

  it('schließt die Senke auch beim Abbruch', async () => {
    const platte = memoryStore()
    const sink = await platte.open('track.wav')
    const abbruch = vi.spyOn(sink, 'abort')
    const controller = new AbortController()
    controller.abort()

    await expect(
      runSynthesis(
        {
          project: { myRole: '' },
          blocks,
          speakers,
          options: { skipMyRole: false, includeDirections: true },
          knownModels: known,
        },
        cachedRenderer(fakePiper().synthesize, new BlockCache(memoryStore())),
        { sink, signal: controller.signal },
      ),
    ).rejects.toThrow()
    expect(abbruch).toHaveBeenCalled()
  })

  it('setzt die Blöcke mit Pausen zu einer Spur zusammen', async () => {
    const piper = fakePiper()
    const out = await runSynthesis(
      {
        project: { myRole: '' },
        blocks,
        speakers,
        options: { skipMyRole: false, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(piper.synthesize, new BlockCache(memoryStore())),
    )

    const gap = Math.trunc((SAMPLE_RATE * GAP_MS) / 1000)
    expect(out.samples.length).toBe(2 * (RATE + gap))
    expect(out.stats).toEqual({ rendered: 2, cached: 0, skippedRole: 0, fixedPauses: 0 })
    expect(out.problems).toEqual([])
    // Der WAV-Kopf sind 44 Bytes, danach zwei je Sample.
    expect(out.wav.byteLength).toBe(44 + out.samples.length * 2)
  })

  // Die eigene Rolle wird trotzdem erzeugt: erst ihre Länge sagt, wie lang die
  // Pause sein muss. Und im Zwischenspeicher liegt sie danach auch.
  it('macht aus der eigenen Rolle eine Pause von gleicher Länge', async () => {
    const piper = fakePiper()
    const out = await runSynthesis(
      {
        project: { myRole: 'ANNA' },
        blocks,
        speakers,
        options: { skipMyRole: true, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(piper.synthesize, new BlockCache(memoryStore())),
    )

    const gap = Math.trunc((SAMPLE_RATE * GAP_MS) / 1000)
    expect(piper.calls.length).toBe(2)
    expect(out.samples.length).toBe(2 * (RATE + gap))
    expect(out.stats.skippedRole).toBe(1)
    // Die zweite Hälfte ist still.
    const zweite = out.samples.subarray(RATE + gap, 2 * RATE + gap)
    expect(zweite.every((v) => v === 0)).toBe(true)
  })

  // Zwei Rollen, dieselbe Stimme, derselbe Satz: der Schlüssel kennt nur
  // Modell, Sprecher-ID, Tempo und Text – also fällt das zweite "Ja." in den
  // Zwischenspeicher des ersten.
  it('erzeugt denselben Satz nur einmal', async () => {
    const piper = fakePiper()
    const out = await runSynthesis(
      {
        project: { myRole: '' },
        blocks: [block({ id: 'a', speaker: 'HUGO', text: 'Ja.' }),
                 block({ id: 'b', speaker: 'ANNA', text: 'Ja.' })],
        speakers,
        options: { skipMyRole: false, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(piper.synthesize, new BlockCache(memoryStore())),
    )

    expect(piper.calls.length).toBe(1)
    expect(out.stats).toMatchObject({ rendered: 1, cached: 1 })
  })

  it('nimmt eine feste Pause, wenn die Rolle gar keine Stimme hat', async () => {
    const piper = fakePiper()
    const out = await runSynthesis(
      {
        project: { myRole: 'OHNE' },
        blocks: [block({ id: 'x', speaker: 'OHNE' })],
        speakers,
        options: { skipMyRole: true, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(piper.synthesize),
    )

    const gap = Math.trunc((SAMPLE_RATE * GAP_MS) / 1000)
    const pause = Math.trunc((SAMPLE_RATE * SKIPPED_ROLE_MS) / 1000)
    expect(piper.calls.length).toBe(0)
    expect(out.samples.length).toBe(pause + gap)
    expect(out.stats.fixedPauses).toBe(1)
  })

  it('meldet eine fehlende Stimme, statt sie stillschweigend wegzulassen', async () => {
    const out = await runSynthesis(
      {
        project: { myRole: '' },
        blocks: [block({ id: 'a', speaker: 'FREMD' })],
        speakers: { ...speakers, FREMD: voice('de_DE-gibtsnicht') },
        options: { skipMyRole: false, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(fakePiper().synthesize),
    )
    expect(out.problems.join(' ')).toContain('FREMD')
  })

  it('rechnet eine fremde Abtastrate auf die des Laufs um', async () => {
    const piper = fakePiper(16000, 16000)
    const out = await runSynthesis(
      {
        project: { myRole: '' },
        blocks: [block({ id: 'a' })],
        speakers,
        options: { skipMyRole: false, includeDirections: true },
        knownModels: known,
      },
      cachedRenderer(piper.synthesize),
    )

    const gap = Math.trunc((SAMPLE_RATE * GAP_MS) / 1000)
    expect(Math.abs(out.samples.length - (RATE + gap))).toBeLessThan(4)
  })

  it('bricht ab, wenn das Signal abbricht', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runSynthesis(
        {
          project: { myRole: '' },
          blocks,
          speakers,
          options: { skipMyRole: false, includeDirections: true },
          knownModels: known,
        },
        cachedRenderer(fakePiper().synthesize),
        { signal: controller.signal },
      ),
    ).rejects.toThrow()
  })
})

describe('tidyCache', () => {
  it('behält, was gebraucht wird, und wirft den Rest weg', async () => {
    const store = memoryStore()
    const cache = new BlockCache(store)
    const piper = fakePiper()
    const render = cachedRenderer(piper.synthesize, cache)

    const blocks = [block({ id: 'a', text: 'Erstens.' }), block({ id: 'b', text: 'Zweitens.' })]
    for (const b of blocks) await render(request({ text: b.text }))
    expect((await cache.stats()).files).toBe(2)

    // Der zweite Block ist gelöscht worden.
    const entfernt = await tidyCache(cache, { myRole: '' }, blocks.slice(0, 1), speakers)
    expect(entfernt).toBe(1)
    expect((await cache.stats()).files).toBe(1)
  })
})
