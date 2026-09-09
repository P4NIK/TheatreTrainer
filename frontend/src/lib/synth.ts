/**
 * A run, from the selection to the finished WAV – in the browser.
 *
 * This is the half of backend/internal/synth/pipeline.go that job.go used to
 * drive: look in the cache, otherwise ask Piper, apply volume and pitch, and
 * hand the result to renderPlan(). What the backend needed a job registry for
 * is a promise here, because the run no longer has to outlive a request.
 *
 * The order of the layers is the same as it was, and for the same reason:
 *
 *   plan (pipeline.ts) -> cache (storage.ts) -> Piper (worker, piper.ts)
 *                                            -> volume/pitch (audio.ts)
 *
 * Only the raw Piper output goes into the cache. Volume and pitch sit on top,
 * so moving those sliders costs nothing while changing the text costs one
 * block.
 */

import { encodeWav, postProcess } from './audio'
import {
  cacheKey,
  normalizeText,
  planRun,
  referencedKeys,
  renderPlan,
  type Plan,
  type PlanInput,
  type RenderedBlock,
  type RunStats,
  type SynthRequest,
} from './pipeline'
import type { VoiceConfig } from './piper'
import type { BlockCache, DownloadProgress, ModelStore } from './storage'
import type { Block, Project, Speakers } from '../types'
import { fetchVoice } from './voices'

/** The defaults of the backend configuration, now simply the defaults. */
export const SAMPLE_RATE = 22050
export const GAP_MS = 450
export const SKIPPED_ROLE_MS = 2500

/** What is left of Piper once the caching is somebody else's problem. */
export type Synthesizer = (
  request: SynthRequest,
) => Promise<{ samples: Int16Array; sampleRate: number }>

/* --------------------------------------------------------- Cache in front */

/**
 * Wraps a synthesizer in the block cache.
 *
 * A miss costs what Piper costs; a hit costs a read plus the post-processing.
 * A store that refuses to write is a nuisance, not a reason to stop the run –
 * the backend logged it and carried on, and so do we.
 */
export function cachedRenderer(
  synthesize: Synthesizer,
  cache?: BlockCache | null,
): (request: SynthRequest) => Promise<RenderedBlock> {
  return async (request) => {
    // Text that normalizes to nothing has no audio, and no cache entry either.
    if (normalizeText(request.text) === '') {
      return { samples: new Int16Array(0), sampleRate: 0, fromCache: true }
    }

    const key = await cacheKey(request)
    const hit = cache ? await cache.get(key) : null
    if (hit) {
      return {
        samples: postProcess(hit.samples, hit.sampleRate, request),
        sampleRate: hit.sampleRate,
        fromCache: true,
      }
    }

    const raw = await synthesize(request)
    if (cache) {
      try {
        await cache.put(key, raw.samples, raw.sampleRate)
      } catch (error) {
        console.warn('Zwischenspeicher:', error)
      }
    }
    return {
      samples: postProcess(raw.samples, raw.sampleRate, request),
      sampleRate: raw.sampleRate,
      fromCache: false,
    }
  }
}

/** Throws away cache entries no block points at any more. */
export async function tidyCache(
  cache: BlockCache,
  project: Pick<Project, 'myRole'>,
  blocks: Block[],
  speakers: Speakers,
): Promise<number> {
  return cache.keepOnly(await referencedKeys(project, blocks, speakers))
}

/* ------------------------------------------------------------- The run */

export interface RunOptions {
  sampleRate?: number
  gapMs?: number
  skippedRoleMs?: number
  onProgress?: (progress: { done: number; total: number; message: string } & RunStats) => void
  signal?: AbortSignal
}

export interface RunResult {
  wav: ArrayBuffer
  samples: Int16Array
  sampleRate: number
  stats: RunStats
  /** The one-line summary, worded as the backend worded it. */
  message: string
  /** Blocks that could not be rendered – missing voice, and the like. */
  problems: string[]
}

/**
 * Plans the selection and renders it into one continuous track.
 *
 * Deliberately not "and writes it somewhere": what happens with the WAV –
 * play, download, keep – is the caller's business, and in the browser those
 * are three different things.
 */
export async function runSynthesis(
  input: PlanInput,
  render: (request: SynthRequest) => Promise<RenderedBlock>,
  options: RunOptions = {},
): Promise<RunResult> {
  const plan: Plan = planRun(input)
  const sampleRate = options.sampleRate ?? SAMPLE_RATE

  const { samples, stats, message } = await renderPlan(plan.items, {
    sampleRate,
    gapMs: options.gapMs ?? GAP_MS,
    skippedRoleMs: options.skippedRoleMs ?? SKIPPED_ROLE_MS,
    render,
    onProgress: options.onProgress,
    signal: options.signal,
  })

  return {
    wav: encodeWav(samples, sampleRate),
    samples,
    sampleRate,
    stats,
    message,
    problems: plan.problems,
  }
}

/* ---------------------------------------------------------- The worker */

/** Main thread to worker. */
export type ToWorker =
  | { id: number; type: 'load'; voice: string; wasmBase: string; model: ArrayBuffer; config: VoiceConfig }
  | { id: number; type: 'synthesize'; voice: string; text: string; lengthScale: number; speakerId: number }
  | { id: number; type: 'release'; voice: string }

/**
 * Worker back to the main thread.
 *
 * Told apart by `type`, including the failure – the same shape sttWorker.ts
 * uses. A union whose variants do not all carry the same field cannot be
 * narrowed.
 */
export type FromWorker =
  | { id: number; type: 'load' }
  | { id: number; type: 'synthesize'; samples: Int16Array; sampleRate: number; phonemizeMs: number; inferMs: number }
  | { id: number; type: 'release' }
  | { id: number; type: 'error'; error: string }

/**
 * Piper on a thread of its own.
 *
 * Not for speed – a second thread buys nothing, that was measured – but so the
 * page stays usable. A run over a whole play takes three and a half minutes,
 * and a frozen tab for three and a half minutes reads as a crash.
 *
 * The voice is loaded on the main thread and handed over: the bytes come out
 * of OPFS or off the network, both of which want a progress display, and
 * transferring the buffer costs nothing.
 */
export class PiperPool {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve(value: FromWorker): void; reject(error: Error): void }>()
  private readonly voices = new Map<string, Promise<void>>()

  private readonly options: {
    models: ModelStore
    /** Where the WASM files live; the worker passes this on to piper.ts. */
    wasmBase?: string
    /** Only for tests and for a page that wants to build the worker itself. */
    createWorker?: () => Worker
    onVoiceProgress?: (voice: string, progress: DownloadProgress) => void
  }

  // Written out rather than declared in the parameter list: the project
  // compiles with erasableSyntaxOnly, and a parameter property is not
  // erasable – it is TypeScript that emits code.
  constructor(options: PiperPool['options']) {
    this.options = options
  }

  /** True once the voice is in the worker, so a run will not stall on it. */
  ready(voice: string): boolean {
    return this.voices.has(voice)
  }

  /**
   * Makes sure a voice is loaded. Callable before a run, so the download has
   * a progress bar instead of hiding inside the first block.
   */
  async ensure(voice: string): Promise<void> {
    const known = this.voices.get(voice)
    if (known) return known

    const loading = (async () => {
      const { bytes, config } = await fetchVoice(this.options.models, voice, (progress) =>
        this.options.onVoiceProgress?.(voice, progress),
      )
      // A view into a larger buffer cannot be transferred, and the whole
      // buffer would be the wrong bytes – so copy in that case, only then.
      const whole =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? (bytes.buffer as ArrayBuffer)
          : (bytes.slice().buffer as ArrayBuffer)

      await this.send(
        { id: 0, type: 'load', voice, wasmBase: this.options.wasmBase ?? '/wasm/', model: whole, config },
        [whole],
      )
    })()

    // A failed download must not poison the voice for good.
    this.voices.set(voice, loading)
    loading.catch(() => this.voices.delete(voice))
    return loading
  }

  /** The synthesizer to hand to cachedRenderer(). */
  readonly synthesize: Synthesizer = async (request) => {
    await this.ensure(request.model)
    const answer = await this.send({
      id: 0,
      type: 'synthesize',
      voice: request.model,
      text: request.text,
      lengthScale: request.lengthScale,
      speakerId: request.speakerId,
    })
    if (answer.type !== 'synthesize') throw new Error('Unerwartete Antwort des Sprach-Workers')
    return { samples: answer.samples, sampleRate: answer.sampleRate }
  }

  /** Ends the worker. The voices are gone with it; the cache stays. */
  close(): void {
    this.worker?.terminate()
    this.worker = null
    this.voices.clear()
    for (const { reject } of this.pending.values()) {
      reject(new Error('Sprach-Worker beendet'))
    }
    this.pending.clear()
  }

  private start(): Worker {
    if (this.worker) return this.worker
    this.worker = this.options.createWorker
      ? this.options.createWorker()
      : new Worker(new URL('./synthWorker.ts', import.meta.url), { type: 'module' })

    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data
      const waiting = this.pending.get(message.id)
      if (!waiting) return
      this.pending.delete(message.id)
      if (message.type === 'error') waiting.reject(new Error(message.error))
      else waiting.resolve(message)
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'Der Sprach-Worker ist abgestürzt')
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
    return this.worker
  }

  private send(message: ToWorker, transfer: Transferable[] = []): Promise<FromWorker> {
    const worker = this.start()
    const id = this.nextId++
    return new Promise<FromWorker>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ ...message, id }, transfer)
    })
  }
}
