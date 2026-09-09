import { describe, expect, it } from 'vitest'

import { memoryStore, ModelStore } from './storage'
import { fetchVoice, VOICES, voiceByName, voiceReady, voiceUrls } from './voices'

const NAME = 'de_DE-thorsten-medium'

const config = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'de' },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  phoneme_id_map: { _: [0], '^': [1], $: [2] },
  num_speakers: 1,
}

/** Ein Netz, das die beiden Dateien einer Stimme kennt und mitzählt. */
function fakeNet(model: Uint8Array) {
  const asked: string[] = []
  const fetcher = async (url: string | URL) => {
    const text = String(url)
    asked.push(text)
    const body = text.endsWith('.json')
      ? new TextEncoder().encode(JSON.stringify(config))
      : model
    return new Response(body.slice().buffer as ArrayBuffer, {
      status: 200,
      headers: { 'Content-Length': String(body.byteLength) },
    })
  }
  return { asked, fetcher }
}

describe('Stimmenliste', () => {
  it('führt Thorsten und findet ihn über den Modellnamen', () => {
    expect(VOICES.map((v) => v.name)).toContain(NAME)
    expect(voiceByName(NAME)?.label).toBe('Thorsten')
    expect(voiceByName('gibtsnicht')).toBeUndefined()
  })

  it('setzt die beiden Adressen aus dem Pfad zusammen', () => {
    const urls = voiceUrls(voiceByName(NAME)!)
    expect(urls.model).toBe(
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
    )
    expect(urls.config).toBe(`${urls.model}.json`)
  })
})

describe('fetchVoice', () => {
  it('holt beide Dateien einmal und danach nie wieder', async () => {
    const model = new Uint8Array([1, 2, 3, 4, 5])
    const net = fakeNet(model)
    globalThis.fetch = net.fetcher as typeof fetch

    const store = memoryStore()
    const models = new ModelStore(store)
    expect(await voiceReady(models, NAME)).toBe(false)

    const first = await fetchVoice(models, NAME)
    expect(Array.from(first.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(first.config.audio.sample_rate).toBe(22050)
    expect(net.asked.length).toBe(2)

    const second = await fetchVoice(models, NAME)
    expect(Array.from(second.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(net.asked.length).toBe(2)
    expect(await voiceReady(models, NAME)).toBe(true)
  })

  it('meldet den Fortschritt des Modells, nicht den der Beschreibung', async () => {
    const model = new Uint8Array(4096)
    globalThis.fetch = fakeNet(model).fetcher as typeof fetch

    const gesehen: number[] = []
    await fetchVoice(new ModelStore(memoryStore()), NAME, (p) => gesehen.push(p.total))
    expect(gesehen.length).toBeGreaterThan(0)
    expect(gesehen.every((total) => total === 4096)).toBe(true)
  })

  it('sagt es, wenn die Stimme gar nicht in der Liste steht', async () => {
    await expect(fetchVoice(new ModelStore(memoryStore()), 'de_DE-erfunden')).rejects.toThrow(
      /Unbekannte Stimme/,
    )
  })
})
