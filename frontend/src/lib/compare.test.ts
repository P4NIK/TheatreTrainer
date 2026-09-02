import { describe, expect, it } from 'vitest'

import { cologne, compareSpoken, levenshtein, normalizeWord, related } from './compare'

describe('cologne', () => {
  // Die klassischen Beispiele aus der Literatur zur Kölner Phonetik.
  it('bildet die dokumentierten Codes', () => {
    expect(cologne('Müller-Lüdenscheidt')).toBe('65752682')
    expect(cologne('Wikipedia')).toBe('3412')
    expect(cologne('Breschnew')).toBe('17863')
  })

  it('gibt gleich klingenden Namen denselben Code', () => {
    expect(cologne('Meyer')).toBe(cologne('Mayr'))
    expect(cologne('Schmidt')).toBe(cologne('Schmitt'))
    expect(cologne('Conti')).toBe(cologne('Konti'))
  })

  it('unterscheidet, was verschieden klingt', () => {
    expect(cologne('Wein')).not.toBe(cologne('Bein'))
  })

  it('kommt mit Leerem zurecht', () => {
    expect(cologne('')).toBe('')
    expect(cologne('123')).toBe('')
  })
})

describe('levenshtein', () => {
  it('zählt einzelne Änderungen', () => {
    expect(levenshtein('haus', 'haus')).toBe(0)
    expect(levenshtein('haus', 'maus')).toBe(1)
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('', 'abc')).toBe(3)
  })
})

describe('related', () => {
  it('lässt Verhörer der Erkennung durchgehen', () => {
    expect(related('romanee', 'romane')).toBe(true)
    expect(related('rowland', 'rohland')).toBe(true)
  })

  it('ist bei kurzen Wörtern streng', () => {
    expect(related('der', 'den')).toBe(false)
    expect(related('ein', 'kein')).toBe(false)
  })

  it('erkennt echte Verwechslungen als verschieden', () => {
    expect(related('wein', 'bier')).toBe(false)
  })
})

describe('normalizeWord', () => {
  it('wirft Satzzeichen und Akzente weg', () => {
    expect(normalizeWord('„Schöner!“')).toBe('schoner')
    expect(normalizeWord('Straße,')).toBe('strasse')
    expect(normalizeWord('Romanée')).toBe('romanee')
    expect(normalizeWord('–')).toBe('')
  })
})

describe('compareSpoken', () => {
  it('markiert eine wortgleiche Replik als sitzend', () => {
    const c = compareSpoken('Bei Wein kannst du mir nichts vormachen.', 'bei wein kannst du mir nichts vormachen')
    expect(c.words.every((w) => w.state === 'ok')).toBe(true)
    expect(c.score).toBe(1)
  })

  it('lässt einen Verhörer als „fast“ durchgehen', () => {
    const c = compareSpoken('Der 29er Romanée Conti.', 'der 29er Romane Conti')
    expect(c.words.map((w) => w.state)).toEqual(['ok', 'ok', 'near', 'ok'])
    expect(c.score).toBeGreaterThan(0.8)
  })

  it('findet ein fehlendes Wort', () => {
    const c = compareSpoken('Ich würde sagen, mit Sicherheit ja', 'ich würde sagen ja')
    const missing = c.words.filter((w) => w.state === 'missing').map((w) => w.expected)
    expect(missing).toEqual(['mit', 'Sicherheit'])
    expect(c.hits).toBe(4)
  })

  it('findet ein zusätzlich gesagtes Wort', () => {
    const c = compareSpoken('Wer ist das?', 'wer ist denn das')
    expect(c.words.map((w) => w.state)).toEqual(['ok', 'ok', 'extra', 'ok'])
    expect(c.words[2].spoken).toBe('denn')
  })

  it('nennt beim Danebengesagten beide Fassungen', () => {
    const c = compareSpoken('Er trinkt Wein.', 'er trinkt bier')
    const wrong = c.words.find((w) => w.state === 'wrong')
    expect(wrong).toMatchObject({ expected: 'Wein.', spoken: 'bier' })
  })

  it('behält die Schreibweise des Buchs für die Anzeige', () => {
    const c = compareSpoken('Guten Abend, Sir Rowland.', 'guten abend sir rowland')
    expect(c.words.map((w) => w.expected)).toEqual(['Guten', 'Abend,', 'Sir', 'Rowland.'])
  })

  it('wertet Schweigen als nichts getroffen', () => {
    const c = compareSpoken('Nur der junge Warrender.', '')
    expect(c.words.every((w) => w.state === 'missing')).toBe(true)
    expect(c.score).toBe(0)
  })

  it('kommt mit einem leeren Block zurecht', () => {
    const c = compareSpoken('', 'irgendwas gesagt')
    expect(c.expectedCount).toBe(0)
    expect(c.words.every((w) => w.state === 'extra')).toBe(true)
  })
})
