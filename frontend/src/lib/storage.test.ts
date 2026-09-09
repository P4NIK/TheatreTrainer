import { describe, expect, it } from 'vitest'

import { encodeWav } from './audio'
import {
  BlockCache,
  decodeWav,
  memoryStore,
  ModelStore,
  type BlobStore,
} from './storage'

const samples = (n: number, value = 1000) => {
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = value + i
  return out
}

describe('BlockCache', () => {
  it('gibt zurück, was hineingelegt wurde', async () => {
    const cache = new BlockCache(memoryStore())
    await cache.put('abc', samples(100), 22050)

    const got = await cache.get('abc')
    expect(got?.sampleRate).toBe(22050)
    expect(Array.from(got!.samples)).toEqual(Array.from(samples(100)))
  })

  it('meldet einen Fehltreffer statt zu werfen', async () => {
    expect(await new BlockCache(memoryStore()).get('gibtesnicht')).toBe(null)
  })

  it('behält die Extremwerte', async () => {
    const cache = new BlockCache(memoryStore())
    const extreme = Int16Array.from([0, 32767, -32768, -1, 1])
    await cache.put('x', extreme, 16000)
    expect(Array.from((await cache.get('x'))!.samples)).toEqual(Array.from(extreme))
  })

  it('wirft weg, worauf kein Block mehr zeigt', async () => {
    const cache = new BlockCache(memoryStore())
    for (const key of ['a', 'b', 'c']) await cache.put(key, samples(10), 22050)

    expect(await cache.keepOnly(new Set(['a', 'c']))).toBe(1)
    expect(await cache.get('b')).toBe(null)
    expect(await cache.get('a')).not.toBe(null)
    expect((await cache.stats()).files).toBe(2)
  })

  it('zählt Dateien und Bytes', async () => {
    const cache = new BlockCache(memoryStore())
    await cache.put('a', samples(100), 22050)
    await cache.put('b', samples(50), 22050)

    const stats = await cache.stats()
    expect(stats.files).toBe(2)
    // Zweimal 44 Byte Kopf plus die Samples.
    expect(stats.bytes).toBe(2 * 44 + 100 * 2 + 50 * 2)
  })

  it('leert vollständig', async () => {
    const cache = new BlockCache(memoryStore())
    await cache.put('a', samples(10), 22050)
    expect(await cache.clear()).toBe(1)
    expect((await cache.stats()).files).toBe(0)
  })

  // Ein halb geschriebener oder fremder Eintrag darf nicht abgespielt werden.
  it('behandelt Beschädigtes als Fehltreffer', async () => {
    const store = memoryStore()
    const cache = new BlockCache(store)
    await store.write('kaputt.wav', new Uint8Array(200))
    await store.write('kurz.wav', new Uint8Array(10))
    expect(await cache.get('kaputt')).toBe(null)
    expect(await cache.get('kurz')).toBe(null)
  })
})

describe('decodeWav', () => {
  it('liest, was encodeWav schreibt', () => {
    const original = samples(64)
    const got = decodeWav(new Uint8Array(encodeWav(original, 22050)))
    expect(got?.sampleRate).toBe(22050)
    expect(Array.from(got!.samples)).toEqual(Array.from(original))
  })

  it('weist zurück, was nicht danach aussieht', () => {
    expect(decodeWav(new Uint8Array(0))).toBe(null)
    expect(decodeWav(new Uint8Array(100))).toBe(null)

    const wav = new Uint8Array(encodeWav(samples(10), 22050))
    const view = new DataView(wav.buffer)
    view.setUint16(22, 2, true) // plötzlich Stereo
    expect(decodeWav(wav)).toBe(null)
  })

  it('weist eine abgeschnittene Datei zurück', () => {
    const wav = new Uint8Array(encodeWav(samples(100), 22050))
    expect(decodeWav(wav.slice(0, 100))).toBe(null)
  })
})

describe('ModelStore', () => {
  /** Ein fetch, das mitzählt, wie oft es gefragt wurde. */
  function fakeFetch(bytes: Uint8Array, calls: { n: number }) {
    return async () => {
      calls.n++
      // Als Puffer, weil `Response` ein `Uint8Array` nicht annimmt: das könnte
      // für TypeScript ein geteilter Speicher sein.
      return new Response(bytes.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }
  }

  it('lädt einmal und behält es dann', async () => {
    const calls = { n: 0 }
    const payload = new Uint8Array([1, 2, 3, 4])
    globalThis.fetch = fakeFetch(payload, calls) as typeof fetch

    const models = new ModelStore(memoryStore())
    expect(Array.from(await models.get('stimme', '/egal'))).toEqual([1, 2, 3, 4])
    expect(Array.from(await models.get('stimme', '/egal'))).toEqual([1, 2, 3, 4])
    expect(calls.n).toBe(1)
    expect(await models.has('stimme')).toBe(true)
  })

  it('meldet den Fortschritt', async () => {
    globalThis.fetch = fakeFetch(new Uint8Array(1000), { n: 0 }) as typeof fetch

    const seen: number[] = []
    await new ModelStore(memoryStore()).get('m', '/egal', (p) => seen.push(p.loaded))
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(1000)
  })

  it('sagt beim Fehlschlag, was los war', async () => {
    globalThis.fetch = (async () =>
      new Response('', { status: 404, statusText: 'Not Found' })) as typeof fetch

    await expect(new ModelStore(memoryStore()).get('m', '/weg'))
      .rejects.toThrow(/404 Not Found/)
  })

  it('legt nichts ab, wenn der Abruf scheitert', async () => {
    const store: BlobStore = memoryStore()
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch

    await expect(new ModelStore(store).get('m', '/kaputt')).rejects.toThrow()
    expect(await store.read('m')).toBe(null)
  })
})
