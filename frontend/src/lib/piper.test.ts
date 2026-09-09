import { describe, expect, it } from 'vitest'

import { phonemesToIds, splitSentences } from './piper'

describe('phonemesToIds', () => {
  // Pipers Aufbau: BOS, PAD, dann jedes Phonem gefolgt von PAD, am Ende EOS.
  const map = { _: [0], '^': [1], $: [2], a: [10], b: [11], c: [12, 13] }

  it('baut die Kette wie Piper', () => {
    expect(phonemesToIds(['a', 'b'], map).ids).toEqual([1, 0, 10, 0, 11, 0, 2])
  })

  it('kommt mit Phonemen zurecht, die auf mehrere IDs zeigen', () => {
    expect(phonemesToIds(['c'], map).ids).toEqual([1, 0, 12, 13, 0, 2])
  })

  it('meldet Unbekanntes, statt es stillschweigend zu verschlucken', () => {
    const got = phonemesToIds(['a', '?', 'b'], map)
    expect(got.ids).toEqual([1, 0, 10, 0, 11, 0, 2])
    expect(got.missing).toEqual(['?'])
  })

  it('liefert auch ohne Phoneme eine gültige Kette', () => {
    expect(phonemesToIds([], map).ids).toEqual([1, 0, 2])
  })
})

describe('splitSentences', () => {
  it('teilt an Satzenden', () => {
    expect(splitSentences('Eins. Zwei! Drei?')).toEqual(['Eins.', 'Zwei!', 'Drei?'])
  })

  it('fasst Leerraum zusammen wie Piper', () => {
    expect(splitSentences('  Ein   Satz\tmit\nUmbruch.  ')).toEqual(['Ein Satz mit Umbruch.'])
  })

  it('lässt einen Satz ohne Punkt stehen', () => {
    expect(splitSentences('Ohne Punkt')).toEqual(['Ohne Punkt'])
  })

  it('gibt für Leeres nichts zurück', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('   ')).toEqual([])
  })

  // Bekannter Unterschied zur Kommandozeile, hier festgehalten statt versteckt:
  // Piper teilt über espeaks Satzerkennung, wir über Intl.Segmenter – und der
  // trennt bei einer Abkürzung mit Punkt. Folge ist eine zusätzliche Pause von
  // 0,2 s mitten im Satz, kein falscher Text. Wer das beheben will, braucht
  // einen WASM-Build, der die Satzgrenzen von espeak herausgibt; der jetzige
  // liefert für mehrsätzigen Text nur eine einzige Zeile.
  it('trennt bei Abkürzungen anders als Piper', () => {
    expect(splitSentences('Es war z. B. im Herbst.')).toEqual(['Es war z.', 'B. im Herbst.'])
  })
})
