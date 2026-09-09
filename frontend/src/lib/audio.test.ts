import { describe, expect, it } from 'vitest'

import {
  applyVolume,
  clampInt16,
  encodeWav,
  fadeEdges,
  fromFloat32,
  pitchShift,
  postProcess,
  removeDCOffset,
  resample,
  silence,
  timeStretch,
} from './audio'

const RATE = 22050

/** Ein reiner Ton, so wie ihn auch audio_test.go im Backend erzeugt. */
function sine(rate: number, freq: number, n: number): Int16Array {
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = Math.round(9000 * Math.sin((2 * Math.PI * freq * i) / rate))
  }
  return out
}

/** Stärkste Frequenz über den Autokorrelations-Gipfel. */
function dominantFreq(samples: Int16Array, rate: number): number {
  const n = Math.min(4096, samples.length)
  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n

  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) x[i] = samples[i] - mean

  let best = 0
  let bestLag = 0
  for (let lag = Math.trunc(rate / 400); lag < rate / 60 && lag < n; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += x[i] * x[i + lag]
    if (sum > best) {
      best = sum
      bestLag = lag
    }
  }
  return bestLag === 0 ? 0 : rate / bestLag
}

function rms(x: Int16Array): number {
  if (x.length === 0) return 0
  let sum = 0
  for (const v of x) sum += v * v
  return Math.sqrt(sum / x.length)
}

describe('clampInt16', () => {
  it('hält den Wertebereich ein', () => {
    expect(clampInt16(40000)).toBe(32767)
    expect(clampInt16(-40000)).toBe(-32768)
    expect(clampInt16(0)).toBe(0)
  })

  // Go rundet halbe Werte vom Nullpunkt weg, JavaScript rundet sie nach oben.
  // Genau hier läuft die Portierung sonst auseinander.
  it('rundet halbe Werte vom Nullpunkt weg, wie Go', () => {
    expect(clampInt16(0.5)).toBe(1)
    expect(clampInt16(-0.5)).toBe(-1)
    expect(clampInt16(1.5)).toBe(2)
    expect(clampInt16(-1.5)).toBe(-2)
    expect(clampInt16(2.5)).toBe(3)
    expect(clampInt16(-2.5)).toBe(-3)
  })
})

describe('resample', () => {
  it('ändert die Länge im Verhältnis der Abtastraten', () => {
    const input = new Int16Array(16000)
    const out = resample(input, 16000, 22050)
    expect(out.length).toBeGreaterThanOrEqual(22048)
    expect(out.length).toBeLessThanOrEqual(22052)
  })

  it('lässt gleiche Abtastrate unangetastet', () => {
    const input = sine(RATE, 200, 1000)
    expect(resample(input, RATE, RATE)).toBe(input)
  })

  it('behält die Frequenz beim Wechsel der Abtastrate', () => {
    const out = resample(sine(RATE, 220, RATE), RATE, 16000)
    expect(Math.abs(dominantFreq(out, 16000) - 220) / 220).toBeLessThan(0.02)
  })
})

describe('applyVolume', () => {
  it('begrenzt statt zu überlaufen', () => {
    const got = applyVolume(Int16Array.from([30000, -30000, 0]), 2)
    expect(got[0]).toBe(32767)
    expect(got[1]).toBe(-32768)
    expect(got[2]).toBe(0)
  })

  it('macht bei Null stumm', () => {
    expect(applyVolume(Int16Array.from([1000]), 0)[0]).toBe(0)
  })

  it('lässt 1,0 unangetastet', () => {
    const input = Int16Array.from([1, 2, 3])
    expect(applyVolume(input, 1)).toBe(input)
  })
})

describe('silence', () => {
  it('rechnet Millisekunden in Samples um wie das Backend', () => {
    expect(silence(450, 22050).length).toBe(9922)
    expect(silence(2500, 22050).length).toBe(55125)
    expect(silence(0, 22050).length).toBe(0)
  })
})

describe('removeDCOffset', () => {
  it('zieht den Mittelwert ab', () => {
    const withOffset = sine(RATE, 200, RATE)
    for (let i = 0; i < withOffset.length; i++) withOffset[i] = clampInt16(withOffset[i] + 900)

    const out = removeDCOffset(withOffset)
    let mean = 0
    for (const v of out) mean += v
    expect(Math.abs(mean / out.length)).toBeLessThan(1)
  })

  it('lässt einen sauberen Block unangetastet', () => {
    const clean = sine(RATE, 200, RATE)
    expect(removeDCOffset(clean)).toBe(clean)
  })
})

describe('fadeEdges', () => {
  it('beginnt und endet bei null', () => {
    const out = fadeEdges(sine(RATE, 200, RATE), RATE, 8)
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(0)
  })

  it('lässt einen zu kurzen Block in Ruhe', () => {
    const tiny = sine(RATE, 200, 10)
    expect(fadeEdges(tiny, RATE, 8)).toBe(tiny)
  })
})

describe('timeStretch', () => {
  // Das Gegenstück zu TestTimeStretchKeepsPitch im Backend.
  it('ändert die Länge, aber nicht die Tonhöhe', () => {
    for (const s of [0.8, 1.2, 1.4]) {
      const input = sine(RATE, 180, RATE)
      const out = timeStretch(input, RATE, s)

      const want = Math.trunc(input.length * s)
      expect(Math.abs(out.length - want) / want).toBeLessThan(0.02)
      expect(Math.abs(dominantFreq(out, RATE) - 180) / 180).toBeLessThan(0.02)
    }
  })

  // Das Gegenstück zu TestTimeStretchKeepsTheEnd: läuft die Analyse rückwärts
  // weg, fehlt am Ende das letzte Wort.
  it('verliert das Ende nicht', () => {
    for (const s of [0.84, 0.9, 1.15, 1.25]) {
      const input = new Int16Array(RATE)
      input.set(sine(RATE, 200, Math.trunc((RATE * 8) / 10)))

      const out = timeStretch(input, RATE, s)

      const tail = Math.trunc(RATE * 0.15 * s)
      expect(rms(out.subarray(out.length - tail))).toBeLessThan(200)

      const toneEnd = Math.trunc(RATE * 0.7 * s)
      expect(rms(out.subarray(toneEnd - Math.trunc(RATE / 20), toneEnd))).toBeGreaterThan(3000)
    }
  })

  it('lässt zu kurze Blöcke unangetastet', () => {
    const short = sine(RATE, 300, 500)
    expect(timeStretch(short, RATE, 1.2)).toBe(short)
  })
})

describe('pitchShift', () => {
  // Das Gegenstück zu TestPitchShiftMovesPitchNotDuration.
  it('verschiebt die Tonhöhe, nicht die Dauer', () => {
    const freq = 110
    for (const pitch of [0.85, 1.0, 1.15, 1.25]) {
      const input = sine(RATE, freq, RATE)
      const out = pitchShift(input, RATE, pitch)

      expect(Math.abs(out.length - input.length) / input.length).toBeLessThan(0.03)

      const want = freq * pitch
      expect(Math.abs(dominantFreq(out, RATE) - want) / want).toBeLessThan(0.02)
    }
  })
})

describe('postProcess', () => {
  it('fährt die Kette des Backends und endet stumm an den Rändern', () => {
    const out = postProcess(sine(RATE, 200, RATE), RATE, { volume: 0.8, pitch: 1.1 })
    expect(out[0]).toBe(0)
    expect(out[out.length - 1]).toBe(0)
    expect(Math.abs(out.length - RATE) / RATE).toBeLessThan(0.03)
  })

  it('begrenzt die Tonhöhe auf den Bereich des Backends', () => {
    const input = sine(RATE, 110, RATE)
    // 2,0 wird auf 1,3 gekappt – beide müssen dasselbe liefern.
    expect(Array.from(postProcess(input, RATE, { pitch: 2 })))
      .toEqual(Array.from(postProcess(input, RATE, { pitch: 1.3 })))
  })
})

// Die Funktionen im Backend arbeiten auf ihrer Eingabe; hier tun sie das
// bewusst nicht, weil dieselben Samples im Browser noch dem Zwischenspeicher
// oder einer Worker-Nachricht gehören.
describe('lässt die Eingabe in Ruhe', () => {
  it('verändert das übergebene Array nicht', () => {
    const input = sine(RATE, 200, RATE)
    const before = Array.from(input)

    applyVolume(input, 0.5)
    fadeEdges(input, RATE, 8)
    resample(input, RATE, 16000)
    timeStretch(input, RATE, 1.2)
    pitchShift(input, RATE, 1.1)
    postProcess(input, RATE, { volume: 0.5, pitch: 1.2 })

    expect(Array.from(input)).toEqual(before)
  })
})

describe('fromFloat32', () => {
  // Nachgerechnet an voice.py: clip(x * 32767, -32767, 32767), dann astype,
  // das abschneidet. 0,5 wird also 16383 und nicht 16384, und der tiefste
  // Wert ist -32767 und nicht -32768.
  it('rechnet wie Piper, nicht wie üblich', () => {
    const got = fromFloat32(Float32Array.from([0, 1, -1, 0.5, -0.5, 2, -2]))
    expect(Array.from(got)).toEqual([0, 32767, -32767, 16383, -16383, 32767, -32767])
  })

  it('schneidet ab, statt zu runden', () => {
    // 0,99999 * 32767 = 32766,67 -> 32766
    expect(fromFloat32(Float32Array.from([0.99999]))[0]).toBe(32766)
    expect(fromFloat32(Float32Array.from([-0.99999]))[0]).toBe(-32766)
  })
})

describe('encodeWav', () => {
  it('schreibt einen gültigen Kopf und die Samples dahinter', () => {
    const samples = Int16Array.from([0, 1000, -1000, 32767, -32768, 0])
    const view = new DataView(encodeWav(samples, 22050))
    const text = (offset: number, length: number) =>
      String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)))

    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(22050)
    expect(view.getUint16(34, true)).toBe(16) // Bit je Sample
    expect(text(36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)

    for (let i = 0; i < samples.length; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(samples[i])
    }
  })
})
