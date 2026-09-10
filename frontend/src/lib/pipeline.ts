/**
 * What gets read aloud, in which order, and what goes between the blocks.
 *
 * A port of the planning and concatenation half of
 * backend/internal/synth/pipeline.go. The synthesis itself is not here: this
 * module is handed a function that turns one request into samples, so it can
 * be tested without Piper and without a network.
 *
 * The job registry of job.go has no counterpart. In the backend a run had to
 * survive the request that started it; in the browser the run *is* the caller,
 * and progress is a callback.
 *
 * Two rules in here look strange until you have heard the result:
 *
 *  - A skipped line is synthesized anyway. Only then is its length known, and
 *    only a pause of that length puts your cue at the right moment.
 *  - referencedKeys() ignores both switches on purpose, so a block whose audio
 *    is currently unused keeps its cache entry and flipping a switch back
 *    costs nothing.
 */

import type { Block, Project, SelectionItem, Speakers } from '../types'
import { DIRECTION_KEY } from '../types'
import { pcmBytes, resample, silence } from './audio'

/** Everything Piper needs for one block. Mirrors synth.Request. */
export interface SynthRequest {
  text: string
  model: string
  speakerId: number
  lengthScale: number
  volume: number
  pitch: number
}

export interface PlanOptions {
  skipMyRole: boolean
  includeDirections: boolean
}

/** One entry of the render list. */
export interface PlanItem {
  /** Absent only when fixedPause is set – then there is nothing to render. */
  request?: SynthRequest
  /** Render it, but put silence into the file. */
  skip: boolean
  /** The skipped line has no voice at all, so a fixed pause stands in. */
  fixedPause: boolean
  /** Speaker name for progress and error messages. */
  label: string
}

export interface Plan {
  items: PlanItem[]
  /** Sorted, deduplicated – missing voices above all. */
  problems: string[]
}

/**
 * Bumped whenever a change would make Piper produce different audio for
 * unchanged settings. Old cache entries then stop matching instead of being
 * served stale. Must stay in step with renderVersion in cache.go.
 */
export const RENDER_VERSION = 1

/** Collapses the text the way it is handed to Piper. */
export function normalizeText(text: string): string {
  const trimmed = text.trim()
  return trimmed === '' ? '' : trimmed.split(/\s+/).join(' ')
}

function orDefault(value: number, fallback: number): number {
  return value <= 0 ? fallback : value
}

/**
 * Go prints floats with strconv.FormatFloat(f, 'f', -1, 64): the shortest
 * decimal that reads back as the same number, and never an exponent.
 * JavaScript agrees on everything in between, but switches to exponent
 * notation outside 1e-6 … 1e21 – which would silently change the cache key.
 */
export function formatFloat(value: number): string {
  const plain = String(value)
  const parts = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]\d+)$/.exec(plain)
  if (!parts) return plain

  // Both languages emit the shortest decimal that reads back as the same
  // number, so the digits already agree – only the notation differs. Writing
  // the exponent out by hand is exact; toFixed() is not, because it gives up
  // and returns exponential notation again from 1e21 upwards.
  const [, sign, whole, fraction = '', exponent] = parts
  const digits = whole + fraction
  const point = whole.length + Number(exponent)

  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length)
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/**
 * Which speakers entry a block uses, and whether it should be replaced by a
 * pause because it is your own role.
 */
export function speakerKeyOf(
  block: Block,
  project: Pick<Project, 'myRole'>,
  options: PlanOptions,
): { key: string; skip: boolean } {
  if (block.type === 'direction') {
    if (!options.includeDirections) return { key: '', skip: true }
    return { key: DIRECTION_KEY, skip: false }
  }

  const name = (block.speaker ?? '').trim()
  if (name === '') return { key: DIRECTION_KEY, skip: false }

  if (options.skipMyRole && project.myRole !== '' &&
      name.toLowerCase() === project.myRole.toLowerCase()) {
    return { key: name, skip: true }
  }
  return { key: name, skip: false }
}

/**
 * Builds the synthesis request of a block, or reports that the block has no
 * usable voice configuration.
 */
export function requestFor(
  block: Block,
  project: Pick<Project, 'myRole'>,
  speakers: Speakers,
  options: PlanOptions,
): { request?: SynthRequest; key: string; ok: boolean } {
  const { key } = speakerKeyOf(block, project, options)
  if (key === '' || block.text.trim() === '') return { key, ok: false }

  const config = speakers[key]
  if (!config || config.model.trim() === '') return { key, ok: false }

  return {
    key,
    ok: true,
    request: {
      text: block.text,
      model: config.model,
      speakerId: config.speakerId,
      lengthScale: orDefault(config.lengthScale, 1),
      volume: orDefault(config.volume, 1),
      pitch: orDefault(config.pitch, 1),
    },
  }
}

export interface PlanInput {
  project: Pick<Project, 'myRole'>
  /** In reading order; the order of this array is the order of the run. */
  blocks: Block[]
  speakers: Speakers
  options: PlanOptions
  /** Empty or omitted means the whole play. */
  selection?: SelectionItem[]
  /** Names of the voice models that are actually available. */
  knownModels: Set<string> | string[]
  /** Only for the wording of the error message about a missing model. */
  voicesLocation?: string
}

/** Turns a project plus a selection into the list of things to render. */
export function planRun(input: PlanInput): Plan {
  const { project, blocks, speakers, options } = input
  const known = input.knownModels instanceof Set
    ? input.knownModels
    : new Set(input.knownModels)
  const where = input.voicesLocation ?? 'den installierten Stimmen'

  const byId = new Map(blocks.map((b) => [b.id, b]))
  const selection: SelectionItem[] = input.selection?.length
    ? input.selection
    : blocks.map((b) => ({ blockId: b.id }))

  const items: PlanItem[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  const note = (label: string, text: string) => {
    if (seen.has(label + text)) return
    seen.add(label + text)
    problems.push(`${label}: ${text}`)
  }

  for (const entry of selection) {
    if (entry.announce) {
      // Markers are spoken by the stage-direction voice. Without one they are
      // simply left out – they are an aid, not content.
      const config = speakers[DIRECTION_KEY]
      if (config && known.has(config.model)) {
        items.push({
          skip: false,
          fixedPause: false,
          label: 'Sprungmarke',
          request: {
            text: entry.announce,
            model: config.model,
            speakerId: config.speakerId,
            lengthScale: orDefault(config.lengthScale, 1),
            volume: orDefault(config.volume, 1),
            pitch: orDefault(config.pitch, 1),
          },
        })
      }
      continue
    }

    const block = entry.blockId ? byId.get(entry.blockId) : undefined
    if (!block || block.text.trim() === '') continue
    if (block.type === 'direction' && !options.includeDirections) continue

    const { request, key, ok } = requestFor(block, project, speakers, options)
    const { skip } = speakerKeyOf(block, project, options)

    const label = key === DIRECTION_KEY ? 'Regieanweisungen' : key

    if (!ok || !request) {
      if (skip) {
        // A skipped role does not strictly need a voice; without one the fixed
        // pause stands in for the real length.
        items.push({ skip: true, fixedPause: true, label })
        continue
      }
      note(label, 'keine Stimme zugewiesen')
      continue
    }
    if (!known.has(request.model)) {
      note(label, `Modell "${request.model}" liegt nicht in ${where}`)
      continue
    }
    items.push({ request, skip, fixedPause: false, label })
  }

  problems.sort()
  return { items, problems }
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * The identity of a rendered block.
 *
 * Covers exactly what Piper sees: the text and the settings that reach the
 * command line. Volume and pitch are applied afterwards and are deliberately
 * *not* part of the key – moving those sliders has to stay instant.
 *
 * The layout of the hashed string has to match cache.go byte for byte, or the
 * whole existing cache stops matching. tools/pipeline-parity checks it.
 */
export async function cacheKey(request: SynthRequest): Promise<string> {
  const preimage =
    `v${RENDER_VERSION}\n` +
    `${request.model}\n` +
    `${request.speakerId}\n` +
    `${formatFloat(orDefault(request.lengthScale, 1))}\n` +
    `${normalizeText(request.text)}\n`

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage))
  return hex(new Uint8Array(digest)).slice(0, 32)
}

/**
 * The cache entries the current blocks still need.
 *
 * Both switches are ignored on purpose: a block whose audio is currently not
 * used keeps its entry, so flipping a switch back is instant instead of
 * costing another full run.
 */
export async function referencedKeys(
  project: Pick<Project, 'myRole'>,
  blocks: Block[],
  speakers: Speakers,
): Promise<Set<string>> {
  const options: PlanOptions = { skipMyRole: false, includeDirections: true }
  const keys = new Set<string>()
  for (const block of blocks) {
    const { request, ok } = requestFor(block, project, speakers, options)
    if (ok && request) keys.add(await cacheKey(request))
  }
  return keys
}

/** What a run produced, for the summary line and the progress display. */
export interface RunStats {
  /** Blocks that had to go through Piper. */
  rendered: number
  /** Blocks that came from the cache. */
  cached: number
  /** Own-role lines replaced by a pause. */
  skippedRole: number
  /** Of those, the ones with no voice at all, where the pause has a fixed length. */
  fixedPauses: number
}

export interface RenderedBlock {
  samples: Int16Array
  sampleRate: number
  /** True when this came out of the cache rather than out of Piper. */
  fromCache: boolean
}

export interface RenderPlanOptions {
  sampleRate: number
  /** Silence between two blocks. */
  gapMs: number
  /** Pause for an own-role line that has no voice at all. */
  skippedRoleMs: number
  render: (request: SynthRequest) => Promise<RenderedBlock>
  onProgress?: (progress: { done: number; total: number; message: string } & RunStats) => void
  signal?: AbortSignal
  /**
   * Where the samples go while the run is still going.
   *
   * Without it they pile up in memory and are joined at the end – fine for a
   * scene, and four copies of a whole play. With it the track goes to disk
   * block by block and `samples` comes back empty; `sampleCount` says how long
   * it got.
   */
  sink?: { write(part: Uint8Array): Promise<void> }
}

/** Summarises a finished run in one line, as the backend does. */
export function doneMessage(stats: RunStats): string {
  let message = `Fertig – ${stats.rendered} neu erzeugt, ${stats.cached} aus dem Zwischenspeicher`
  if (stats.skippedRole > 0) message += `, ${stats.skippedRole} Repliken als Pause`
  if (stats.fixedPauses > 0) {
    message += ` (davon ${stats.fixedPauses} mit fester Länge, weil der Rolle keine Stimme zugewiesen ist)`
  }
  return message
}

function concat(parts: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * Renders a plan into one continuous track.
 *
 * Every block is followed by the gap, including the last one – that is what
 * the backend does, and a rehearsal file that stops dead on the final word is
 * unpleasant to work with.
 */
export async function renderPlan(
  items: PlanItem[],
  options: RenderPlanOptions,
): Promise<{ samples: Int16Array; sampleCount: number; stats: RunStats; message: string }> {
  const { sampleRate, render, sink } = options
  const gap = silence(options.gapMs, sampleRate)
  const skipPause = silence(options.skippedRoleMs, sampleRate)

  const parts: Int16Array[] = []
  let total = 0
  const push = async (part: Int16Array) => {
    total += part.length
    if (sink) await sink.write(pcmBytes(part))
    else parts.push(part)
  }

  const stats: RunStats = { rendered: 0, cached: 0, skippedRole: 0, fixedPauses: 0 }

  for (let i = 0; i < items.length; i++) {
    if (options.signal?.aborted) throw new DOMException('Job abgebrochen', 'AbortError')
    const item = items[i]

    if (item.fixedPause) {
      await push(skipPause)
      await push(gap)
      stats.skippedRole++
      stats.fixedPauses++
      options.onProgress?.({ done: i + 1, total: items.length, message: 'Pause für die eigene Rolle', ...stats })
      continue
    }
    if (!item.request) continue

    const block = await render(item.request)
    if (block.fromCache) stats.cached++
    else stats.rendered++

    let samples = resample(block.samples, block.sampleRate, sampleRate)
    if (item.skip) {
      // Synthesized anyway: only its length tells us how long the pause has to
      // be, and the audio lands in the cache, which makes switching the option
      // back instant.
      samples = new Int16Array(samples.length)
      stats.skippedRole++
    }
    await push(samples)
    await push(gap)

    options.onProgress?.({
      done: i + 1,
      total: items.length,
      message: `${i + 1}/${items.length} – ${stats.rendered} neu, ${stats.cached} aus dem Zwischenspeicher`,
      ...stats,
    })
  }

  return {
    samples: sink ? new Int16Array(0) : concat(parts, total),
    sampleCount: total,
    stats,
    message: doneMessage(stats),
  }
}
