import { describe, expect, it } from 'vitest'

import { normalizeWord } from './compare'
import { numberValue } from './numbers'

describe('numberValue', () => {
  it('liest Ziffern, auch mit Endung', () => {
    expect(numberValue('3')).toBe(3)
    expect(numberValue('29')).toBe(29)
    expect(numberValue('1918')).toBe(1918)
    expect(numberValue('29er')).toBe(29)
    expect(numberValue('1918er')).toBe(1918)
  })

  it('liest ausgeschriebene Zahlen bis neunundneunzig', () => {
    expect(numberValue('null')).toBe(0)
    expect(numberValue('drei')).toBe(3)
    expect(numberValue('zwolf')).toBe(12)
    expect(numberValue('neunzehn')).toBe(19)
    expect(numberValue('dreissig')).toBe(30)
    expect(numberValue('neunundzwanzig')).toBe(29)
    expect(numberValue('einunddreissig')).toBe(31)
    expect(numberValue('sechsundsechzig')).toBe(66)
  })

  it('liest Hunderter und die Jahresform', () => {
    expect(numberValue('hundert')).toBe(100)
    expect(numberValue('zweihundert')).toBe(200)
    expect(numberValue('dreihundertsiebenundzwanzig')).toBe(327)
    // So schreibt ein Stück eine Jahreszahl.
    expect(numberValue('neunzehnhundertachtzehn')).toBe(1918)
    expect(numberValue('achtzehnhundertdreizehn')).toBe(1813)
  })

  it('liest Tausender', () => {
    expect(numberValue('tausend')).toBe(1000)
    expect(numberValue('zweitausend')).toBe(2000)
    expect(numberValue('zweitausendvierhundert')).toBe(2400)
    expect(numberValue('eintausendneunhundertachtzehn')).toBe(1918)
  })

  it('kommt mit Ordnungszahlen zurecht, auch den unregelmäßigen', () => {
    expect(numberValue('vierte')).toBe(4)
    expect(numberValue('zwanzigste')).toBe(20)
    expect(numberValue('neunundzwanzigsten')).toBe(29)
    expect(numberValue('erste')).toBe(1)
    expect(numberValue('ersten')).toBe(1)
    expect(numberValue('dritten')).toBe(3)
    expect(numberValue('siebte')).toBe(7)
    expect(numberValue('achte')).toBe(8)
  })

  it('kommt mit Ableitungen zurecht', () => {
    expect(numberValue('neunundzwanziger')).toBe(29)
    expect(numberValue('dreimal')).toBe(3)
    expect(numberValue('vierfach')).toBe(4)
    expect(numberValue('zwote')).toBe(2)
  })

  it('sagt bei allem anderen nein', () => {
    expect(numberValue('')).toBe(null)
    expect(numberValue('wein')).toBe(null)
    expect(numberValue('sieger')).toBe(null)
    expect(numberValue('kinder')).toBe(null)
    expect(numberValue('eltern')).toBe(null)
    expect(numberValue('meter')).toBe(null)
    expect(numberValue('kein')).toBe(null)
    expect(numberValue('meine')).toBe(null)
    // Zahl plus etwas, das keine Endung einer Zahl ist.
    expect(numberValue('3d')).toBe(null)
    expect(numberValue('2b')).toBe(null)
  })

  it('lässt „erst" ein Adverb bleiben, solange keine Endung dranhängt', () => {
    expect(numberValue('erst')).toBe(null)
    expect(numberValue('dritt')).toBe(null)
  })

  // Die Tabellen in numbers.ts sind so geschrieben, wie normalizeWord die
  // Wörter hinterlässt. Wenn sich dort etwas ändert, muss das hier auffallen –
  // sonst findet numberValue seine eigenen Einträge nicht mehr.
  it('passt zu dem, was normalizeWord aus den Wörtern macht', () => {
    expect(normalizeWord('fünf')).toBe('funf')
    expect(normalizeWord('zwölf')).toBe('zwolf')
    expect(normalizeWord('dreißig')).toBe('dreissig')
    expect(normalizeWord('fünfzig')).toBe('funfzig')
    expect(normalizeWord('29er')).toBe('29er')
    expect(normalizeWord('29.')).toBe('29')

    for (const [wort, wert] of [
      ['fünf', 5], ['zwölf', 12], ['dreißig', 30], ['fünfundvierzig', 45],
      ['neunundzwanzigsten', 29], ['neunzehnhundertachtzehn', 1918],
    ] as [string, number][]) {
      expect(numberValue(normalizeWord(wort))).toBe(wert)
    }
  })
})
