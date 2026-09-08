/**
 * The audio work that used to happen in the backend: resampling, de-clicking,
 * volume, and the pitch shift that lets several roles come out of one good
 * voice.
 *
 * This is a port of backend/internal/synth/audio.go, and it is meant to stay
 * one: `tools/audio-parity` runs both over the same inputs and compares the
 * results sample by sample. Where the Go code looks odd, it is usually because
 * something audible depends on it – the comments explain which.
 *
 * Samples are 16-bit mono, the same as everywhere else in the app. Every value
 * that lands in an Int16Array goes through clampInt16 first, so nothing ever
 * wraps around silently.
 *
 * One deliberate difference to the Go: these functions do not modify their
 * input. Go could hand a slice around and edit it in place because the
 * pipeline copied it once up front; in the browser the same array is often
 * still owned by the cache or a worker message, and a hidden edit there is the
 * kind of bug that shows up as a click three blocks later.
 */

/** Width of the resampling kernel. Four lobes trade sharpness against cost. */
const LANCZOS_LOBES = 4

const INT16_MAX = 32767
const INT16_MIN = -32768

/**
 * Go's math.Round rounds halves away from zero; JavaScript's Math.round rounds
 * them towards positive infinity. That single difference would put -0.5 at 0
 * instead of -1 and quietly break the sample-for-sample comparison with the
 * backend, so it is spelled out here.
 */
function goRound(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** Go's integer division truncates towards zero. */
function intDiv(a: number, b: number): number {
  return Math.trunc(a / b)
}

export function clampInt16(value: number): number {
  const rounded = goRound(value)
  if (rounded > INT16_MAX) return INT16_MAX
  if (rounded < INT16_MIN) return INT16_MIN
  return rounded
}

function lanczos(x: number): number {
  if (x === 0) return 1
  if (Math.abs(x) >= LANCZOS_LOBES) return 0
  const px = Math.PI * x
  return (LANCZOS_LOBES * Math.sin(px) * Math.sin(px / LANCZOS_LOBES)) / (px * px)
}

/**
 * Converts samples to another sample rate.
 *
 * Piper voices come in different sample rates, and the pitch feature
 * deliberately misdeclares a segment's rate to shift it – so this runs on
 * nearly every block. It uses a band-limited windowed-sinc (Lanczos) kernel
 * rather than linear interpolation: linear interpolation acts as a crude
 * low-pass and audibly dulls sibilants, the range that carries speech
 * intelligibility.
 */
export function resample(samples: Int16Array, sampleRate: number, target: number): Int16Array {
  if (sampleRate === target || sampleRate === 0 || samples.length === 0) return samples

  const ratio = target / sampleRate
  const outLength = Math.trunc(samples.length * ratio)
  if (outLength <= 0) return new Int16Array(0)

  // When downsampling, the kernel is widened so it also low-passes at the new
  // Nyquist frequency and does not alias.
  const scale = Math.min(1, ratio)
  const halfWidth = LANCZOS_LOBES / scale
  const last = samples.length - 1

  const out = new Int16Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const center = i / ratio
    const from = Math.ceil(center - halfWidth)
    const to = Math.floor(center + halfWidth)

    let sum = 0
    let norm = 0
    for (let j = from; j <= to; j++) {
      const k = j < 0 ? 0 : j > last ? last : j
      const w = lanczos((center - j) * scale)
      sum += samples[k] * w
      norm += w
    }
    out[i] = clampInt16(norm !== 0 ? sum / norm : sum)
  }
  return out
}

/**
 * Subtracts the mean value of the segment.
 *
 * Several Piper voices carry a noticeable DC offset – the German MLS models
 * sit up to 3 % of full scale away from zero. The offset itself is inaudible,
 * but it means the waveform jumps from that value to zero wherever a segment
 * meets the silence between two blocks, which is heard as a click.
 */
export function removeDCOffset(samples: Int16Array): Int16Array {
  if (samples.length === 0) return samples

  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i]
  const offset = sum / samples.length
  if (Math.abs(offset) < 1) return samples

  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = clampInt16(samples[i] - offset)
  return out
}

/**
 * Ramps the first and last few milliseconds in and out so a segment always
 * starts and ends at zero. Together with removeDCOffset this keeps the joins
 * between blocks silent.
 */
export function fadeEdges(samples: Int16Array, sampleRate: number, ms: number): Int16Array {
  const n = intDiv(sampleRate * ms, 1000)
  if (n <= 0 || samples.length < 2 * n) return samples

  const out = Int16Array.from(samples)
  for (let i = 0; i < n; i++) {
    const gain = i / n
    out[i] = clampInt16(out[i] * gain)
    const j = out.length - 1 - i
    out[j] = clampInt16(out[j] * gain)
  }
  return out
}

/** Scales samples with clipping protection. Volume 1.0 is a no-op. */
export function applyVolume(samples: Int16Array, volume: number): Int16Array {
  if (volume <= 0) return new Int16Array(samples.length)
  if (volume === 1) return samples

  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = clampInt16(samples[i] * volume)
  return out
}

/** A block of silent samples of the given duration. */
export function silence(ms: number, sampleRate: number): Int16Array {
  const n = intDiv(sampleRate * ms, 1000)
  return new Int16Array(n > 0 ? n : 0)
}

/**
 * Returns the offset near `ideal` whose samples continue the template most
 * smoothly. The template is a window of `x` starting at templateStart.
 */
function bestMatch(
  x: Int16Array,
  templateStart: number,
  frame: number,
  ideal: number,
  search: number,
): number {
  let from = ideal - search
  if (from < 0) from = 0
  let to = ideal + search
  if (to + frame > x.length) to = x.length - frame
  if (to < from) return ideal

  let best = from
  let bestScore = -Infinity
  for (let cand = from; cand <= to; cand++) {
    let dot = 0
    let energy = 0
    // A coarse stride is plenty: we are looking for the alignment of pitch
    // periods, not for sample-exact similarity.
    for (let i = 0; i < frame; i += 4) {
      const v = x[cand + i]
      dot += v * x[templateStart + i]
      energy += v * v
    }
    // Normalising by the candidate's energy matters: a plain dot product
    // prefers whatever is loudest, which drags the search towards the louder
    // middle of an utterance and away from its quiet ending.
    const score = dot / Math.sqrt(energy + 1)
    if (score > bestScore) {
      best = cand
      bestScore = score
    }
  }
  return best
}

/**
 * Changes the length of a segment by the factor s without moving its pitch,
 * using WSOLA (waveform similarity overlap-add): overlapping frames are laid
 * down at the new spacing, and each frame is picked from a small search window
 * around its ideal position so that it continues the previous one as smoothly
 * as possible. That alignment is what keeps the periodicity – and therefore
 * the pitch – intact.
 */
export function timeStretch(x: Int16Array, rate: number, s: number): Int16Array {
  if (x.length === 0 || s <= 0 || Math.abs(s - 1) < 1e-6) return x

  let frame = intDiv(rate * 40, 1000) // 40 ms holds several pitch periods
  if (frame % 2 === 1) frame++
  if (x.length < 3 * frame) return x // too short to stretch without artefacts

  const hop = intDiv(frame, 2) // Hann windows at half a frame sum to one
  const search = intDiv(frame, 4)

  const win = new Float64Array(frame)
  for (let i = 0; i < frame; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame)
  }

  const outLength = Math.trunc(x.length * s)
  const acc = new Float64Array(outLength + frame)
  const weight = new Float64Array(outLength + frame)

  /** Where the previous frame would have continued naturally; -1 for none. */
  let templateStart = -1

  for (let n = 0; ; n++) {
    const out = n * hop
    if (out + frame > outLength) break

    // The ideal position is computed from the frame index, never from the
    // previous match. Advancing from the match instead would let the search
    // offset accumulate: the analysis would creep backwards and the tail of
    // the input would never be reached, cutting off the end.
    const ideal = goRound((n * hop) / s)

    let start = templateStart >= 0 ? bestMatch(x, templateStart, frame, ideal, search) : ideal
    if (start + frame > x.length) start = x.length - frame
    if (start < 0) start = 0

    for (let i = 0; i < frame; i++) {
      acc[out + i] += x[start + i] * win[i]
      weight[out + i] += win[i]
    }

    const next = start + hop
    templateStart = next + frame <= x.length ? next : -1
  }

  const result = new Int16Array(outLength)
  for (let i = 0; i < outLength; i++) {
    if (weight[i] > 1e-6) result[i] = clampInt16(acc[i] / weight[i])
  }
  return result
}

/**
 * Moves a segment's pitch and formants by the given factor while keeping its
 * duration. Resampling alone would shorten the segment; the time stretch
 * undoes exactly that.
 *
 * Pitch and formants move together, which is what makes a voice sound like a
 * different person rather than a sped-up tape.
 */
export function pitchShift(samples: Int16Array, rate: number, pitch: number): Int16Array {
  if (samples.length === 0 || pitch <= 0 || Math.abs(pitch - 1) < 1e-6) return samples
  const shifted = resample(samples, goRound(rate * pitch), rate)
  return timeStretch(shifted, rate, pitch)
}

/** Bounds for the pitch factor, as in the backend: beyond roughly ±25 % the
 * formants shift so far that the voice turns into a caricature. */
export const MIN_PITCH = 0.75
export const MAX_PITCH = 1.3

export function clampPitch(pitch: number): number {
  if (pitch <= 0) return 1
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch))
}

/** Milliseconds of ramp at each edge – inaudible, long enough to kill clicks. */
export const EDGE_FADE_MS = 8

/**
 * Everything that happens to a block after synthesis, in the order the backend
 * does it: volume, then the pitch shift, then the de-clicking of the edges.
 *
 * Volume and pitch are applied here and not during synthesis on purpose – that
 * is what lets a moved slider reuse the cached block instead of paying for
 * another synthesis run.
 */
export function postProcess(
  samples: Int16Array,
  sampleRate: number,
  options: { volume?: number; pitch?: number } = {},
): Int16Array {
  if (samples.length === 0) return samples

  let out = samples
  const volume = options.volume ?? 1
  if (volume > 0 && volume !== 1) out = applyVolume(out, volume)

  const pitch = clampPitch(options.pitch ?? 1)
  if (pitch !== 1) out = pitchShift(out, sampleRate, pitch)

  return fadeEdges(removeDCOffset(out), sampleRate, EDGE_FADE_MS)
}

/**
 * Converts what the browser's Piper hands back – floats between -1 and 1 – to
 * the 16-bit samples everything else works in. The asymmetric factors are the
 * conventional ones and match what the Piper command line writes.
 */
export function fromFloat32(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? goRound(s * 32768) : goRound(s * 32767)
  }
  return out
}

/** Mono 16-bit PCM in a WAV container, ready for a Blob or a download. */
export function encodeWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true)
  return buffer
}
