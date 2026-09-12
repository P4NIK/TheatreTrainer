import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  armRisk,
  bool,
  defuseCrashes,
  disarmRisk,
  forgetDefused,
  forgetPrefs,
  globalKey,
  num,
  numOrNull,
  oneOf,
  pick,
  projectKey,
  readRaw,
  str,
  strings,
  wasDefused,
  write,
} from './prefs'
import { defaultSelection, readSelection } from './selection'
import { readRunOptions } from '../components/Rehearsal/runOptions'

/** Ein localStorage, das sich wie eines benimmt – Node hat keines. */
function fakeStorage() {
  const daten = new Map<string, string>()
  return {
    get length() {
      return daten.size
    },
    key: (i: number) => [...daten.keys()][i] ?? null,
    getItem: (k: string) => daten.get(k) ?? null,
    setItem: (k: string, v: string) => void daten.set(k, v),
    removeItem: (k: string) => void daten.delete(k),
  }
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeStorage() })
})

describe('Schlüssel', () => {
  it('trennt Person und Stück', () => {
    expect(globalKey('lernmodus')).toBe('theater-opt/lernmodus')
    expect(projectKey('abc', 'lernmodus')).toBe('theater-opt/abc/lernmodus')
    expect(projectKey('abc', 'lernmodus')).not.toBe(globalKey('lernmodus'))
  })
})

describe('lesen und schreiben', () => {
  it('gibt zurück, was hineingelegt wurde', () => {
    write('theater-opt/x', { a: 1, b: 'zwei' })
    expect(readRaw('theater-opt/x')).toEqual({ a: 1, b: 'zwei' })
  })

  it('meldet nichts, wo nichts liegt', () => {
    expect(readRaw('theater-opt/leer')).toBeUndefined()
  })

  /* Ein halber Schreibvorgang oder eine fremde Erweiterung – lesbar ist das
     nicht, aber es darf die App nicht mitnehmen. */
  it('überlebt Unsinn im Speicher', () => {
    window.localStorage.setItem('theater-opt/kaputt', '{nicht wirklich json')
    expect(readRaw('theater-opt/kaputt')).toBeUndefined()
  })

  it('überlebt einen Speicher, der nicht mitspielt', () => {
    vi.stubGlobal('window', {
      localStorage: {
        get length() {
          return 0
        },
        key: () => null,
        getItem: () => {
          throw new Error('privates Fenster')
        },
        setItem: () => {
          throw new Error('privates Fenster')
        },
        removeItem: () => undefined,
      },
    })
    expect(() => write('theater-opt/x', { a: 1 })).not.toThrow()
    expect(readRaw('theater-opt/x')).toBeUndefined()
    expect(() => forgetPrefs()).not.toThrow()
  })

  it('vergisst nur das Eigene', () => {
    write('theater-opt/lernmodus', { record: true })
    write('theater-opt/abc/karten', { role: 'Wilhelm' })
    window.localStorage.setItem('theater-touren', '["stuecke"]')
    window.localStorage.setItem('theater-starts', '[]')
    forgetPrefs()
    expect(readRaw('theater-opt/lernmodus')).toBeUndefined()
    expect(readRaw('theater-opt/abc/karten')).toBeUndefined()
    // Die Einführungen und das Neustart-Protokoll gehören jemand anderem.
    expect(window.localStorage.getItem('theater-touren')).toBe('["stuecke"]')
    expect(window.localStorage.getItem('theater-starts')).toBe('[]')
  })
})

describe('Prüfer', () => {
  it('holt Felder auch aus dem, was keines hat', () => {
    expect(pick({ a: 1 }, 'a')).toBe(1)
    expect(pick(null, 'a')).toBeUndefined()
    expect(pick('text', 'a')).toBeUndefined()
    expect(pick([1, 2], 'a')).toBeUndefined()
  })

  it('nimmt nur, was zur Frage passt', () => {
    expect(bool(true, false)).toBe(true)
    expect(bool('true', false)).toBe(false)
    expect(bool(undefined, true)).toBe(true)
    expect(str('Wilhelm', '')).toBe('Wilhelm')
    expect(str(42, 'Vorgabe')).toBe('Vorgabe')
    expect(strings(['a', 1, 'b'], [])).toEqual(['a', 'b'])
    expect(strings('a', ['x'])).toEqual(['x'])
  })

  it('hält Zahlen in ihren Grenzen', () => {
    expect(num(5, 1, 0, 10)).toBe(5)
    expect(num(500, 1, 0, 10)).toBe(10)
    expect(num(-5, 1, 0, 10)).toBe(0)
    expect(num(Number.NaN, 3, 0, 10)).toBe(3)
    expect(num('7', 3, 0, 10)).toBe(3)
  })

  it('kennt den Unterschied zwischen „keine Zahl“ und „ohne Grenze“', () => {
    expect(numOrNull(null, 20, 1, 500)).toBeNull()
    expect(numOrNull(9000, 20, 1, 500)).toBe(500)
    expect(numOrNull('viele', 20, 1, 500)).toBe(20)
    expect(numOrNull(undefined, null, 1, 500)).toBeNull()
  })

  it('lässt nur bekannte Namen durch', () => {
    const erlaubt = ['due', 'all'] as const
    expect(oneOf('all', erlaubt, 'due')).toBe('all')
    expect(oneOf('irgendwas', erlaubt, 'due')).toBe('due')
    expect(oneOf(7, erlaubt, 'due')).toBe('due')
  })
})

describe('die Schalter eines Durchlaufs', () => {
  it('kommen zurück, wie sie gesetzt wurden', () => {
    const gelesen = readRunOptions({
      showText: false,
      revealOwn: true,
      autoAdvance: 30,
      record: true,
      analyze: true,
    })
    expect(gelesen).toEqual({
      showText: false,
      revealOwn: true,
      autoAdvance: 30,
      record: true,
      analyze: true,
    })
  })

  /* Auswerten ohne Mitschnitt ist ein gesperrter Schalter, der trotzdem an
     steht – und ein Durchlauf, der auf eine Aufnahme wartet, die nie kommt. */
  it('lassen Auswerten nicht ohne Mitschnitt bestehen', () => {
    expect(readRunOptions({ record: false, analyze: true }).analyze).toBe(false)
    expect(readRunOptions({ record: true, analyze: true }).analyze).toBe(true)
  })

  it('nehmen keine unmöglichen Wartezeiten', () => {
    expect(readRunOptions({ autoAdvance: 0 }).autoAdvance).toBe(2)
    expect(readRunOptions({ autoAdvance: 9999 }).autoAdvance).toBe(120)
    expect(readRunOptions({ autoAdvance: 'gleich' }).autoAdvance).toBeNull()
    expect(readRunOptions({}).autoAdvance).toBeNull()
  })

  it('halten die Vorgabe, wo nichts gemerkt wurde', () => {
    expect(readRunOptions(undefined)).toEqual({
      showText: true,
      revealOwn: false,
      autoAdvance: null,
      record: false,
      analyze: false,
    })
  })
})

describe('eine gemerkte Auswahl', () => {
  it('bleibt, was sie war', () => {
    const gemerkt = { ...defaultSelection, mode: 'pages' as const, fromPage: 4, toPage: 9 }
    expect(readSelection(gemerkt, 60, true)).toMatchObject({ mode: 'pages', fromPage: 4, toPage: 9 })
  })

  /* Das Stück kann seit gestern gekürzt sein – eine Auswahl „Seite 40 bis 59“
     zeigt dann auf nichts. */
  it('passt sich einem kürzeren Stück an', () => {
    const gemerkt = { ...defaultSelection, mode: 'pages' as const, fromPage: 40, toPage: 59 }
    const gelesen = readSelection(gemerkt, 12, true)
    expect(gelesen.fromPage).toBe(12)
    expect(gelesen.toPage).toBe(12)
  })

  it('gibt „meine Auftritte“ auf, wo es keine Rolle gibt', () => {
    const gemerkt = { ...defaultSelection, mode: 'role' as const }
    expect(readSelection(gemerkt, 60, false).mode).toBe('all')
    expect(readSelection(gemerkt, 60, true).mode).toBe('role')
  })

  it('nimmt die Vorgabe, wo nichts gemerkt wurde', () => {
    const gelesen = readSelection(undefined, 30, true, {
      ...defaultSelection,
      mode: 'role',
      toPage: 30,
    })
    expect(gelesen.mode).toBe('role')
    expect(gelesen.toPage).toBe(30)
  })

  it('lässt sich von Unsinn nicht beirren', () => {
    const gelesen = readSelection(
      { mode: 'irgendwas', fromPage: 'zwei', lead: -9, blockIds: 'keine', announce: 'ja' },
      20,
      true,
    )
    expect(gelesen.mode).toBe('all')
    expect(gelesen.fromPage).toBe(1)
    expect(gelesen.lead).toBe(0)
    expect(gelesen.blockIds).toEqual([])
    expect(gelesen.announce).toBe(true)
  })
})

/*
 * Der Schalter, der die Seite umbringen kann.
 *
 * Auf dem Telefon hat Safari die Seite beim Laden der Spracherkennung schon
 * beendet. Käme sie mit demselben Schalter zurück, ginge es sofort wieder los.
 */
describe('die Zündschnur', () => {
  const AUSWERTEN = { pref: 'theater-opt/lernmodus', field: 'analyze' }

  it('schaltet nach einem Absturz aus – und nur den betroffenen Schalter', () => {
    write(AUSWERTEN.pref, { record: true, analyze: true, showText: false })
    armRisk(AUSWERTEN)
    // Hier stirbt die Seite: kein disarm, kein pagehide.

    expect(defuseCrashes()).toEqual([AUSWERTEN])
    expect(readRaw(AUSWERTEN.pref)).toEqual({ record: true, analyze: false, showText: false })
    expect(wasDefused(AUSWERTEN)).toBe(true)
  })

  it('lässt einen ordentlich beendeten Schalter in Ruhe', () => {
    write(AUSWERTEN.pref, { analyze: true })
    armRisk(AUSWERTEN)
    disarmRisk(AUSWERTEN) // pagehide oder Schalter aus
    expect(defuseCrashes()).toEqual([])
    expect(readRaw(AUSWERTEN.pref)).toEqual({ analyze: true })
    expect(wasDefused(AUSWERTEN)).toBe(false)
  })

  it('brennt nur einmal – der zweite Start ist wieder unbelastet', () => {
    write(AUSWERTEN.pref, { analyze: true })
    armRisk(AUSWERTEN)
    defuseCrashes()
    write(AUSWERTEN.pref, { analyze: true }) // der Mensch schaltet wieder ein
    expect(defuseCrashes()).toEqual([])
    expect(readRaw(AUSWERTEN.pref)).toEqual({ analyze: true })
  })

  it('hält mehrere Wagnisse auseinander', () => {
    const karten = { pref: 'theater-opt/karten', field: 'analyze' }
    write(AUSWERTEN.pref, { analyze: true })
    write(karten.pref, { analyze: true })
    armRisk(AUSWERTEN)
    armRisk(karten)
    disarmRisk(karten)
    expect(defuseCrashes()).toEqual([AUSWERTEN])
    expect(readRaw(karten.pref)).toEqual({ analyze: true })
  })

  it('kommt auch ohne vorhandene Einstellung zurecht', () => {
    armRisk(AUSWERTEN)
    expect(defuseCrashes()).toEqual([AUSWERTEN])
    expect(readRaw(AUSWERTEN.pref)).toEqual({ analyze: false })
  })

  it('vergisst den Hinweis, wenn er gelesen wurde', () => {
    write(AUSWERTEN.pref, { analyze: true })
    armRisk(AUSWERTEN)
    defuseCrashes()
    expect(wasDefused(AUSWERTEN)).toBe(true)
    forgetDefused(AUSWERTEN)
    expect(wasDefused(AUSWERTEN)).toBe(false)
  })
})
