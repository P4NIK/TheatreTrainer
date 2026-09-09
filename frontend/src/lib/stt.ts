/**
 * Speech recognition in the browser.
 *
 * Replaces backend/internal/stt: instead of handing the recording to a Whisper
 * process on a server, the model runs here. The comparison with the text was
 * always done in the browser (compare.ts), so what moves is only the
 * recognition itself.
 *
 * Which model, and why (measured in spike-whisper/, against the metric this
 * app actually uses – "did the line sit?", not the word error rate):
 *
 *   tiny   65 %   too weak, swallows short interjections
 *   base   77 %   ~200 MB, 0.95 s per line   ← this one
 *   small  78 %   three times the size for one point
 *
 * The dtype is the usual compromise: the encoder in full precision, the
 * decoder in q4. A q8 encoder saves space but drops syllables on quiet or
 * acted speech – and quiet and acted is the normal case in a theatre.
 *
 * Nothing is loaded until the learning mode is switched on. That is the point
 * of keeping it out of the app bundle: whoever only listens to their play
 * never fetches these 200 MB.
 */

import { WASM_BASE } from './generated'
import type { FromStt, ToStt } from './sttWorker'

/** What the worker sends in answer to a message – progress is not an answer. */
type SttReply = Exclude<FromStt, { type: 'progress' }>

export const WHISPER_MODEL = 'onnx-community/whisper-base'

/** Roughly what the first use downloads – for a sentence before the wait. */
export const WHISPER_BYTES = 200 * 1024 * 1024

export interface SttProgress {
  /** The file being fetched, e.g. "onnx/encoder_model.onnx". */
  file: string
  loaded: number
  total: number
}

export interface Recognition {
  text: string
  /** How long the recognition itself took. */
  ms: number
}

let wasmBase = WASM_BASE
let modelHost: string | undefined

/** Where the WASM files live, and optionally where the models come from. */
export function configure(options: { wasmBase?: string; modelHost?: string }): void {
  if (options.wasmBase) wasmBase = options.wasmBase
  if (options.modelHost !== undefined) modelHost = options.modelHost
}

/**
 * Whisper on a thread of its own.
 *
 * One instance for the whole app, not one per project: the model is 200 MB in
 * memory and has nothing to do with which play is open.
 */
export class SttEngine {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve(value: SttReply): void; reject(error: Error): void }
  >()
  private readonly listeners = new Set<(progress: SttProgress) => void>()
  private loading: Promise<void> | null = null
  private loaded = false
  private readonly createWorker?: () => Worker

  constructor(options: { createWorker?: () => Worker } = {}) {
    this.createWorker = options.createWorker
  }

  /** True once the model is in the worker, so a recognition starts at once. */
  ready(): boolean {
    return this.loaded
  }

  /** Watches the download; returns the function that stops watching. */
  watch(listener: (progress: SttProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Makes sure the model is loaded. Worth calling when the learning mode is
   * switched on rather than when the first line has been spoken – a wait with
   * a progress bar is a wait, a wait after speaking looks like a failure.
   */
  async ensure(): Promise<void> {
    if (this.loaded) return
    if (this.loading) return this.loading

    this.loading = (async () => {
      await this.send({ id: 0, type: 'load', model: WHISPER_MODEL, wasmBase, modelHost })
      this.loaded = true
    })()
    this.loading.catch(() => {
      this.loading = null
    })
    return this.loading
  }

  /**
   * What was said, as text. Takes the recording as it comes off the recorder;
   * the decoding to 16 kHz mono happens here, because a worker has no audio
   * context.
   */
  async transcribe(audio: Blob | ArrayBuffer | Float32Array): Promise<Recognition> {
    await this.ensure()
    const samples = audio instanceof Float32Array ? audio : await toMono16k(audio)

    const answer = await this.send({ id: 0, type: 'transcribe', audio: samples }, [
      samples.buffer as ArrayBuffer,
    ])
    if (answer.type !== 'transcribe') throw new Error('Unerwartete Antwort der Spracherkennung')
    return { text: answer.text, ms: answer.ms }
  }

  /** Ends the worker and gives the 200 MB back. */
  close(): void {
    this.worker?.terminate()
    this.worker = null
    this.loaded = false
    this.loading = null
    for (const { reject } of this.pending.values()) reject(new Error('Spracherkennung beendet'))
    this.pending.clear()
  }

  private start(): Worker {
    if (this.worker) return this.worker
    this.worker = this.createWorker
      ? this.createWorker()
      : new Worker(new URL('./sttWorker.ts', import.meta.url), { type: 'module' })

    this.worker.onmessage = (event: MessageEvent<FromStt>) => {
      const message = event.data
      if (message.type === 'progress') {
        for (const listener of this.listeners) {
          listener({ file: message.file, loaded: message.loaded, total: message.total })
        }
        return
      }
      const waiting = this.pending.get(message.id)
      if (!waiting) return
      this.pending.delete(message.id)
      if (message.type === 'error') waiting.reject(new Error(message.error))
      else waiting.resolve(message)
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Die Spracherkennung ist abgestürzt')
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
    return this.worker
  }

  private send(message: ToStt, transfer: Transferable[] = []): Promise<SttReply> {
    const worker = this.start()
    const id = this.nextId++
    return new Promise<SttReply>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ ...message, id }, transfer)
    })
  }
}

/** The one engine of this app. */
export const stt = new SttEngine()

/**
 * The recording as Whisper wants it: 16 kHz, mono, float.
 *
 * An AudioContext at 16 kHz does the resampling while decoding; where a
 * browser refuses that, an OfflineAudioContext does it afterwards. Both are
 * main-thread only, which is why this does not live in the worker.
 */
export async function toMono16k(data: Blob | ArrayBuffer): Promise<Float32Array> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data

  const context = new AudioContext({ sampleRate: 16000 })
  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(buffer.slice(0))
  } finally {
    void context.close()
  }

  if (decoded.sampleRate !== 16000) {
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    decoded = await offline.startRendering()
  }

  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0)

  const mixed = new Float32Array(decoded.length)
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel)
    for (let i = 0; i < data.length; i++) mixed[i] += data[i] / decoded.numberOfChannels
  }
  return mixed
}
