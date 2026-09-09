/**
 * What the browser keeps: rendered blocks and downloaded models.
 *
 * A replacement for backend/internal/synth/cache.go. The keys come from
 * pipeline.ts and are byte for byte the ones the backend used, so an existing
 * `data/projects/<id>/cache/` folder stays valid.
 *
 * Measured (spike-storage/): 3.5 ms per block, 1400 blocks in 4.9 s, read back
 * at 103 MB/s. Caching a whole play therefore costs two percent of the time
 * spent synthesizing it. Going through a server would have been about six
 * times as expensive.
 *
 * The storage itself sits behind `BlobStore` so that everything above it stays
 * testable without a browser – there is no OPFS in Node.
 */

import { encodeWav } from './audio'

/** A flat store of named byte blobs. */
export interface BlobStore {
  read(name: string): Promise<Uint8Array | null>
  write(name: string, data: Uint8Array): Promise<void>
  remove(name: string): Promise<void>
  list(): Promise<{ name: string; size: number }[]>
}

/* ------------------------------------------------------------------ OPFS */

/**
 * The real store, in the Origin Private File System.
 *
 * Deliberately `createWritable` on the main thread rather than
 * `createSyncAccessHandle` in a worker: measured on a work machine, the simple
 * way was even faster (2.3 against 3.5 ms per block). The usual advice holds
 * for many small writes, not for 180 kB blocks.
 */
export function opfsStore(directory: string): BlobStore {
  const dir = async () => {
    let handle = await navigator.storage.getDirectory()
    // A path, not a name: "projects/<id>/cache" keeps one project's blocks
    // together and makes deleting a project a single removeEntry later.
    for (const segment of directory.split('/').filter(Boolean)) {
      handle = await handle.getDirectoryHandle(segment, { create: true })
    }
    return handle
  }

  return {
    async read(name) {
      try {
        const handle = await (await dir()).getFileHandle(name)
        return new Uint8Array(await (await handle.getFile()).arrayBuffer())
      } catch {
        return null // not there is a miss, not an error
      }
    },

    async write(name, data) {
      const handle = await (await dir()).getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      try {
        await writable.write(unshared(data))
      } finally {
        await writable.close()
      }
    },

    async remove(name) {
      try {
        await (await dir()).removeEntry(name)
      } catch {
        // already gone
      }
    },

    async list() {
      const out: { name: string; size: number }[] = []
      const handle = await dir()
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind !== 'file') continue
        out.push({ name, size: (await entry.getFile()).size })
      }
      return out
    },
  }
}

/**
 * The same view of the same bytes, only without `SharedArrayBuffer` in its
 * type.
 *
 * To TypeScript a `Uint8Array` is "some buffer, possibly a shared one", while
 * the file system's write interface takes unshared ones only. Nothing shared
 * ever arrives here – we never build one – so a fresh view of the same memory
 * is enough. Nothing is copied, which is the point at 63 MB of voice.
 */
function unshared(data: Uint8Array) {
  return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
}

/** An in-memory store – for tests, and as a fallback where OPFS is missing. */
export function memoryStore(): BlobStore {
  const files = new Map<string, Uint8Array>()
  return {
    async read(name) {
      return files.get(name) ?? null
    },
    async write(name, data) {
      files.set(name, data.slice())
    },
    async remove(name) {
      files.delete(name)
    },
    async list() {
      return [...files].map(([name, data]) => ({ name, size: data.byteLength }))
    },
  }
}

/* ---------------------------------------------------------- Block cache */

const SUFFIX = '.wav'

export interface CacheStats {
  files: number
  bytes: number
}

export interface CachedBlock {
  samples: Int16Array
  sampleRate: number
}

/**
 * The cache of rendered blocks.
 *
 * Stored as WAV, the way the backend did it – not out of nostalgia, but
 * because a file you can listen to when something looks wrong is worth more
 * than a format of our own. Reading is strict: anything that does not look
 * like a WAV we wrote counts as a miss and is rendered again, rather than
 * played back as whatever it is.
 */
export class BlockCache {
  private readonly store: BlobStore

  // Written out rather than declared in the parameter list: the project
  // compiles with erasableSyntaxOnly, and a parameter property is not
  // erasable – it is TypeScript that emits code.
  constructor(store: BlobStore) {
    this.store = store
  }

  async get(key: string): Promise<CachedBlock | null> {
    const bytes = await this.store.read(key + SUFFIX)
    return bytes ? decodeWav(bytes) : null
  }

  async put(key: string, samples: Int16Array, sampleRate: number): Promise<void> {
    await this.store.write(key + SUFFIX, new Uint8Array(encodeWav(samples, sampleRate)))
  }

  /**
   * Throws away what no block points at any more, and reports how many that
   * was. Which keys are needed is `referencedKeys()` in pipeline.ts – and that
   * one ignores both switches on purpose.
   */
  async keepOnly(keys: Set<string>): Promise<number> {
    let removed = 0
    for (const { name } of await this.store.list()) {
      if (!name.endsWith(SUFFIX)) continue
      if (keys.has(name.slice(0, -SUFFIX.length))) continue
      await this.store.remove(name)
      removed++
    }
    return removed
  }

  async stats(): Promise<CacheStats> {
    const files = await this.store.list()
    return { files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) }
  }

  async clear(): Promise<number> {
    return this.keepOnly(new Set())
  }
}

/** Reads a WAV that encodeWav wrote. Anything else counts as broken. */
export function decodeWav(bytes: Uint8Array): CachedBlock | null {
  if (bytes.byteLength < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1),
                        view.getUint8(offset + 2), view.getUint8(offset + 3))

  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(36) !== 'data') return null
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1) return null
  if (view.getUint16(34, true) !== 16) return null

  const dataBytes = view.getUint32(40, true)
  if (dataBytes % 2 !== 0 || 44 + dataBytes > bytes.byteLength) return null

  const samples = new Int16Array(dataBytes / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true)
  return { samples, sampleRate: view.getUint32(24, true) }
}

/* --------------------------------------------------------- Model store */

export interface DownloadProgress {
  /** Bytes loaded so far. */
  loaded: number
  /** Total size, or 0 when the server does not say. */
  total: number
}

/**
 * Fetches a file once and keeps it.
 *
 * For the voice (63 MB) and later the Whisper model. The second call comes out
 * of OPFS without touching the network – that is the difference between
 * waiting once and waiting on every visit.
 */
export class ModelStore {
  private readonly store: BlobStore

  constructor(store: BlobStore) {
    this.store = store
  }

  async has(name: string): Promise<boolean> {
    return (await this.store.read(name)) !== null
  }

  async get(
    name: string,
    url: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<Uint8Array> {
    const cached = await this.store.read(name)
    if (cached) return cached

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`${name} konnte nicht geladen werden: ${response.status} ${response.statusText}`)
    }

    const total = Number(response.headers.get('Content-Length') ?? 0)
    const reader = response.body?.getReader()

    let data: Uint8Array
    if (!reader) {
      data = new Uint8Array(await response.arrayBuffer())
      onProgress?.({ loaded: data.byteLength, total: total || data.byteLength })
    } else {
      const parts: Uint8Array[] = []
      let loaded = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        loaded += value.byteLength
        onProgress?.({ loaded, total })
      }
      data = new Uint8Array(loaded)
      let at = 0
      for (const part of parts) {
        data.set(part, at)
        at += part.byteLength
      }
    }

    await this.store.write(name, data)
    return data
  }

  async remove(name: string): Promise<void> {
    await this.store.remove(name)
  }

  async stats(): Promise<CacheStats> {
    const files = await this.store.list()
    return { files: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) }
  }
}

/* ------------------------------------------------------------ Persistence */

export interface StorageState {
  /** The browser will no longer clear this origin on its own. */
  persisted: boolean
  /** What the browser calls the quota – a hint, not a limit. */
  quota: number
  used: number
}

export async function storageState(): Promise<StorageState> {
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {}
  return {
    persisted: navigator.storage?.persisted ? await navigator.storage.persisted() : false,
    quota: estimate.quota ?? 0,
    used: estimate.usage ?? 0,
  }
}

/**
 * Asks the browser not to clear this origin's storage.
 *
 * Without a backend, the PDF and the learning progress live here too, not just
 * the cache that can be recomputed – a tidied-up origin would be data loss.
 * Chrome usually grants it silently, Safari is stricter; relying on it would
 * be a mistake, which is why there is also the export to a file.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
