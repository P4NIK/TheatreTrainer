/**
 * Piper in the browser.
 *
 * A replacement for backend/internal/synth/piper.go: instead of calling the
 * command line, the ONNX model is driven here. The route is the one `piper`
 * takes – text to phonemes with espeak-ng, phonemes to ids through the voice's
 * own map, ids through the VITS network – and the result is the same, sample
 * for sample.
 *
 * What does *not* happen here: volume, pitch, de-clicking. That lives in
 * audio.ts, exactly as in the backend, where it sits outside piper.go. The
 * reason is the same one: only that way does the expensive part stay
 * cacheable, and moving a slider stay free.
 *
 * Nothing is loaded until the first sentence is spoken. Whoever only opens a
 * PDF and marks blocks fetches neither the 18 MB of espeak data nor a voice.
 */

import { fromFloat32 } from './audio'

/** What is needed from the .onnx.json – the rest does not matter here. */
export interface VoiceConfig {
  audio: { sample_rate: number }
  espeak: { voice: string }
  inference: { noise_scale: number; length_scale: number; noise_w: number }
  phoneme_id_map: Record<string, number[]>
  num_speakers: number
}

export interface SynthesisOptions {
  /** Tempo. 1 leaves the voice as it is; larger is slower. */
  lengthScale?: number
  noiseScale?: number
  noiseW?: number
  /** Only for multi-speaker models; without effect on Thorsten. */
  speakerId?: number
  /**
   * Pull every sentence up to full scale, the way Piper does without
   * --no-normalize. On by default; off is mainly there for comparing against
   * the command line.
   */
  normalize?: boolean
}

export interface Synthesis {
  samples: Int16Array
  sampleRate: number
  /** For the progress display and for measuring. */
  phonemizeMs: number
  inferMs: number
  sentences: number
}

/**
 * Silence between two sentences, in seconds. Piper's default – and part of
 * matching the command line, not a matter of taste.
 */
const SENTENCE_SILENCE = 0.2

let wasmBase = '/wasm/'

/** Where the WASM files live. Must be set before the first load. */
export function configure(options: { wasmBase?: string }): void {
  if (options.wasmBase) wasmBase = options.wasmBase
}

/* ------------------------------------------------------- Phonemization */

type PhonemizeModule = {
  callMain(args: string[]): void
}

type PhonemizeFactory = (options: {
  print(line: string): void
  printErr(line: string): void
  locateFile(file: string): string
}) => Promise<PhonemizeModule>

let phonemizer: PhonemizeModule | null = null
let phonemizerLoading: Promise<PhonemizeModule> | null = null
let printed: string[] = []

/**
 * espeak-ng as WASM. The module can be used more than once – a second call
 * then costs five milliseconds instead of the 18 MB all over again.
 */
async function getPhonemizer(): Promise<PhonemizeModule> {
  if (phonemizer) return phonemizer
  if (phonemizerLoading) return phonemizerLoading

  phonemizerLoading = (async () => {
    const module = await importGenerated(`${wasmBase}piper_phonemize.mjs`)
    const factory = (module.default ?? module) as PhonemizeFactory
    phonemizer = await factory({
      print: (line) => printed.push(line),
      printErr: (line) => console.warn('espeak-ng:', line),
      locateFile: (file) => `${wasmBase}${file}`,
    })
    return phonemizer
  })()
  return phonemizerLoading
}

/**
 * Turns a file that ships *next to* the app into something importable.
 *
 * The direct route – `import('/wasm/x.mjs')` – works in the build but not in
 * Vite's dev server, which refuses to serve anything from `public/` as a
 * module because those files never went through its transforms. Fetching the
 * text and importing it as a blob works in both, and it keeps every generated
 * artifact in one folder instead of smuggling one of them into `src/`.
 */
async function generatedUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} konnte nicht geladen werden: ${response.status} ${response.statusText}`)
  }
  return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }))
}

async function importGenerated(url: string): Promise<Record<string, unknown>> {
  const blob = await generatedUrl(url)
  try {
    return await import(/* @vite-ignore */ blob)
  } finally {
    URL.revokeObjectURL(blob)
  }
}

interface PhonemeLine {
  phonemes: string[]
  phoneme_ids: number[]
  text: string
}

/** Calls espeak-ng once for all sentences; it prints one line per sentence. */
function phonemize(module: PhonemizeModule, sentences: string[], espeakVoice: string): PhonemeLine[] {
  printed = []
  module.callMain([
    '-l', espeakVoice,
    '--input', JSON.stringify(sentences.map((text) => ({ text }))),
    '--espeak_data', '/espeak-ng-data',
  ])
  return printed.map((line) => JSON.parse(line) as PhonemeLine)
}

/**
 * The way from phonemes to ids, as Piper walks it: BOS, PAD, then every
 * phoneme followed by PAD, and EOS at the end.
 *
 * Built here on purpose instead of taking the ids the WASM already hands out:
 * the map built into it is the default map, while the voice brings its own.
 * For the German voices they are the same – were that ever to change, it would
 * show up here rather than in the sound.
 */
export function phonemesToIds(
  phonemes: string[],
  map: Record<string, number[]>,
): { ids: number[]; missing: string[] } {
  const pad = map._[0]
  const ids = [map['^'][0], pad]
  const missing: string[] = []

  for (const phoneme of phonemes) {
    const mapped = map[phoneme]
    if (!mapped) {
      missing.push(phoneme)
      continue
    }
    for (const id of mapped) ids.push(id)
    ids.push(pad)
  }
  ids.push(map.$[0])
  return { ids, missing }
}

/**
 * Splits a block into sentences, the way the command line does.
 *
 * The WASM command returns *one* line for multi-sentence text and therefore
 * synthesizes it in one go; Piper splits into sentences and puts silence
 * between them. Without that split the output differs.
 *
 * Known difference: Piper splits using espeak's sentence detection, while this
 * uses Intl.Segmenter – and that one makes two sentences out of "z. B.". It
 * costs an extra pause of 0.2 s, not the text. Fixing it properly would take a
 * WASM build that hands out espeak's sentence boundaries.
 */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return []

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('de', { granularity: 'sentence' })
    const parts = [...segmenter.segment(clean)].map((s) => s.segment.trim()).filter(Boolean)
    if (parts.length) return parts
  }
  return clean.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean)
}

/* ------------------------------------------------------------- Inference */

type OrtModule = typeof import('onnxruntime-web/wasm')

let ort: OrtModule | null = null

async function getOrt(): Promise<OrtModule> {
  if (ort) return ort
  ort = await import('onnxruntime-web/wasm')
  // Both files by name, and the glue as a blob.
  //
  // onnxruntime loads its own glue file as a module. Pointed at a folder it
  // builds the path itself, which breaks in the dev server (see above) and,
  // in the build, resolves next to the bundle where the file is not. Naming
  // both explicitly and handing the glue over as a blob is the one shape that
  // works in dev and in the build. The URL is not revoked: onnxruntime keeps
  // it for as long as it may reload the glue.
  ort.env.wasm.wasmPaths = {
    wasm: `${wasmBase}ort-wasm-simd-threaded.wasm`,
    mjs: await generatedUrl(`${wasmBase}ort-wasm-simd-threaded.mjs`),
  }
  // Measured: one thread is as fast as twelve, and without threads the page
  // needs no cross-origin isolation – and therefore no server of its own.
  ort.env.wasm.numThreads = 1
  ort.env.logLevel = 'error'
  return ort
}

export interface Voice {
  readonly config: VoiceConfig
  synthesize(text: string, options?: SynthesisOptions): Promise<Synthesis>
  release(): Promise<void>
}

/**
 * Loads a voice. `model` are the bytes of the .onnx file, `config` the content
 * of the .onnx.json that goes with it.
 */
export async function loadVoice(model: ArrayBuffer | Uint8Array, config: VoiceConfig): Promise<Voice> {
  const runtime = await getOrt()
  await getPhonemizer()

  const session = await runtime.InferenceSession.create(model as ArrayBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  })
  const hasSpeakerInput = session.inputNames.includes('sid')

  return {
    config,

    async synthesize(text, options = {}) {
      const module = await getPhonemizer()
      const sentences = splitSentences(text)
      if (sentences.length === 0) {
        return { samples: new Int16Array(0), sampleRate: config.audio.sample_rate,
                 phonemizeMs: 0, inferMs: 0, sentences: 0 }
      }

      const startedPhonemize = performance.now()
      const lines = phonemize(module, sentences, config.espeak.voice)
      const phonemizeMs = performance.now() - startedPhonemize

      const noiseScale = options.noiseScale ?? config.inference.noise_scale
      const lengthScale = options.lengthScale ?? config.inference.length_scale
      const noiseW = options.noiseW ?? config.inference.noise_w

      const chunks: Float32Array[] = []
      let inferMs = 0
      const missing = new Set<string>()

      for (const line of lines) {
        const built = phonemesToIds(line.phonemes, config.phoneme_id_map)
        for (const phoneme of built.missing) missing.add(phoneme)

        const ids = BigInt64Array.from(built.ids, BigInt)
        const feeds: Record<string, InstanceType<OrtModule['Tensor']>> = {
          input: new runtime.Tensor('int64', ids, [1, ids.length]),
          input_lengths: new runtime.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
          scales: new runtime.Tensor('float32',
            Float32Array.from([noiseScale, lengthScale, noiseW]), [3]),
        }
        if (hasSpeakerInput) {
          feeds.sid = new runtime.Tensor('int64',
            BigInt64Array.from([BigInt(options.speakerId ?? 0)]), [1])
        }

        const started = performance.now()
        const output = await session.run(feeds)
        inferMs += performance.now() - started

        // Piper normalizes every sentence on its own to full scale as long as
        // --no-normalize is missing. The backend called it without that flag,
        // so it belongs here and not in the post-processing.
        const raw = output[session.outputNames[0]].data as Float32Array
        chunks.push(options.normalize === false ? raw : normalizePeak(raw))
      }

      if (missing.size > 0) {
        console.warn('Phoneme ohne Eintrag in phoneme_id_map:', [...missing].join(' '))
      }

      const sampleRate = config.audio.sample_rate
      return {
        samples: fromFloat32(join(chunks, sampleRate)),
        sampleRate,
        phonemizeMs,
        inferMs,
        sentences: lines.length,
      }
    },

    async release() {
      await session.release()
    },
  }
}

/* --------------------------------------------------------------- Helpers */

function normalizePeak(samples: Float32Array): Float32Array {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i])
    if (value > max) max = value
  }
  if (max < 1e-8) return samples

  const out = new Float32Array(samples.length)
  // float32 here too: NumPy divides a float32 array by a float32 value.
  for (let i = 0; i < samples.length; i++) out[i] = Math.fround(samples[i] / max)
  return out
}

function join(chunks: Float32Array[], sampleRate: number): Float32Array {
  const gap = Math.round(sampleRate * SENTENCE_SILENCE)
  let total = 0
  for (const chunk of chunks) total += chunk.length
  total += gap * Math.max(0, chunks.length - 1)

  const out = new Float32Array(total)
  let at = 0
  chunks.forEach((chunk, index) => {
    out.set(chunk, at)
    at += chunk.length + (index < chunks.length - 1 ? gap : 0)
  })
  return out
}
