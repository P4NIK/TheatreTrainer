/**
 * Piper im Browser.
 *
 * Ersetzt backend/internal/synth/piper.go: statt die Kommandozeile
 * aufzurufen, wird das ONNX-Modell hier selbst gefahren. Der Weg ist derselbe,
 * den auch `piper` geht – Text zu Phonemen mit espeak-ng, Phoneme zu IDs über
 * die Karte der Stimme, IDs durch das VITS-Netz – und das Ergebnis ist
 * sample-genau dasselbe.
 *
 * Was hier *nicht* passiert: Lautstärke, Tonhöhe, Entknacksen. Das steht in
 * audio.ts, genau wie im Backend, wo es außerhalb von piper.go liegt. Der
 * Grund ist derselbe: nur so bleibt der teure Teil zwischenspeicherbar und ein
 * verschobener Regler kostenlos.
 *
 * Geladen wird alles erst beim ersten Sprechen. Wer nur ein PDF öffnet und
 * Blöcke markiert, holt sich weder die 18 MB espeak-Daten noch die Stimme.
 */

/** Was aus der .onnx.json gebraucht wird – der Rest interessiert hier nicht. */
import { fromFloat32 } from './audio'

export interface VoiceConfig {
  audio: { sample_rate: number }
  espeak: { voice: string }
  inference: { noise_scale: number; length_scale: number; noise_w: number }
  phoneme_id_map: Record<string, number[]>
  num_speakers: number
}

export interface SynthesisOptions {
  /** Tempo. 1 lässt die Stimme, wie sie ist; größer wird langsamer. */
  lengthScale?: number
  noiseScale?: number
  noiseW?: number
  /** Nur bei Mehrsprecher-Modellen; bei Thorsten ohne Wirkung. */
  speakerId?: number
  /**
   * Jeden Satz auf Vollausschlag ziehen, wie Piper es ohne --no-normalize tut.
   * Vorgabe an; aus ist vor allem für den Vergleich mit der Kommandozeile da.
   */
  normalize?: boolean
}

export interface Synthesis {
  samples: Int16Array
  sampleRate: number
  /** Für die Fortschrittsanzeige und die Messung. */
  phonemizeMs: number
  inferMs: number
  sentences: number
}

/**
 * Stille zwischen zwei Sätzen, in Sekunden. Pipers Vorgabe – und Teil der
 * Übereinstimmung mit der Kommandozeile, nicht Geschmackssache.
 */
const SENTENCE_SILENCE = 0.2

let wasmBase = '/wasm/'

/** Wo die WASM-Dateien liegen. Muss vor dem ersten Laden gesetzt werden. */
export function configure(options: { wasmBase?: string }): void {
  if (options.wasmBase) wasmBase = options.wasmBase
}

/* ------------------------------------------------------- Phonemisierung */

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
 * espeak-ng als WASM. Das Modul lässt sich mehrfach benutzen – ein zweiter
 * Aufruf kostet danach fünf Millisekunden statt der 18 MB noch einmal.
 */
async function getPhonemizer(): Promise<PhonemizeModule> {
  if (phonemizer) return phonemizer
  if (phonemizerLoading) return phonemizerLoading

  phonemizerLoading = (async () => {
    const module = await import(/* @vite-ignore */ `${wasmBase}piper_phonemize.mjs`)
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

interface PhonemeLine {
  phonemes: string[]
  phoneme_ids: number[]
  text: string
}

/** Ruft espeak-ng einmal für alle Sätze auf; es druckt eine Zeile je Satz. */
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
 * Der Weg von Phonemen zu IDs, wie ihn Piper geht: BOS, PAD, dann jedes
 * Phonem gefolgt von PAD, am Ende EOS.
 *
 * Bewusst selbst gebaut statt die IDs zu nehmen, die das WASM schon liefert:
 * die dort eingebaute Karte ist die Standardkarte, die Stimme bringt aber ihre
 * eigene mit. Bei den deutschen Stimmen sind sie gleich – wäre es einmal
 * anders, fiele es hier auf und nicht erst am Klang.
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
 * Zerlegt einen Block in Sätze, wie es die Kommandozeile tut.
 *
 * Das WASM-Kommando gibt für mehrsätzigen Text *eine* Zeile zurück,
 * synthetisiert also alles am Stück; Piper teilt in Sätze und legt Stille
 * dazwischen. Ohne diese Teilung weicht die Ausgabe ab.
 *
 * Bekannter Unterschied: Piper teilt über espeaks Satzerkennung, hier trennt
 * Intl.Segmenter – und der macht bei „z. B." zwei Sätze daraus. Das kostet eine
 * zusätzliche Pause von 0,2 s, nicht den Text. Sauber zu beheben wäre es nur
 * mit einem WASM-Build, der espeaks Satzgrenzen herausgibt.
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

/* ------------------------------------------------------------- Inferenz */

type OrtModule = typeof import('onnxruntime-web/wasm')

let ort: OrtModule | null = null

async function getOrt(): Promise<OrtModule> {
  if (ort) return ort
  ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmPaths = wasmBase
  // Gemessen: ein Thread ist so schnell wie zwölf, und ohne Threads braucht
  // die Seite keine Cross-Origin-Isolation – also auch keinen eigenen Server.
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
 * Lädt eine Stimme. `model` sind die Bytes der .onnx-Datei, `config` der
 * Inhalt der zugehörigen .onnx.json.
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

        // Piper normalisiert jeden Satz einzeln auf Vollausschlag, solange
        // --no-normalize fehlt. Das Backend ruft es ohne dieses Flag auf, also
        // gehört es hierher und nicht in die Nachbearbeitung.
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

/* -------------------------------------------------------------- Hilfen */

function normalizePeak(samples: Float32Array): Float32Array {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i])
    if (value > max) max = value
  }
  if (max < 1e-8) return samples

  const out = new Float32Array(samples.length)
  // Auch hier float32: NumPy teilt ein float32-Array durch einen float32-Wert.
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


