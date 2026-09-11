import { beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetTours, hasSeen, markSeen, seenTours, stepsFor, TOURS } from './tour'

/** Ein localStorage, das sich wie eines benimmt – Node hat keines. */
function fakeStorage() {
  const daten = new Map<string, string>()
  return {
    getItem: (k: string) => daten.get(k) ?? null,
    setItem: (k: string, v: string) => void daten.set(k, v),
    removeItem: (k: string) => void daten.delete(k),
  }
}

describe('die Touren selbst', () => {
  it('haben eindeutige Namen und überall Text', () => {
    const ids = TOURS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(2)
      for (const step of tour.steps) {
        expect(step.title.length).toBeGreaterThan(3)
        expect(step.text.length).toBeGreaterThan(20)
      }
    }
  })

  /*
   * Auf dem Telefon zieht man erst nach einem Knopfdruck ein Rechteck, am
   * Rechner sofort. Denselben Schritt beiden zu zeigen wäre für die eine
   * Hälfte falsch.
   */
  it('zeigt jedem Gerät seinen Weg zum Markieren', () => {
    const finger = stepsFor('editor', true).map((s) => s.target)
    const maus = stepsFor('editor', false).map((s) => s.target)
    expect(finger).toContain('markieren')
    expect(finger).not.toContain('pdf')
    expect(maus).toContain('pdf')
    expect(maus).not.toContain('markieren')
    // Der Rest ist für beide gleich.
    expect(finger.length).toBe(maus.length)
  })

  it('sagt für jeden Schritt der Probe, welcher Reiter dazugehört', () => {
    for (const step of stepsFor('proben', false)) expect(step.tab).toBeTruthy()
  })

  it('kennt keine Tour ohne Namen', () => {
    expect(stepsFor('stuecke', false).length).toBe(3)
    // @ts-expect-error – absichtlich falscher Name
    expect(stepsFor('gibtsnicht', false)).toEqual([])
  })
})

describe('was schon gesehen wurde', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: fakeStorage() })
  })

  it('merkt sich jede Tour einmal', () => {
    expect(seenTours()).toEqual([])
    markSeen('stuecke')
    markSeen('stuecke')
    expect(seenTours()).toEqual(['stuecke'])
    expect(hasSeen('stuecke')).toBe(true)
    expect(hasSeen('editor')).toBe(false)
  })

  it('kann alles vergessen', () => {
    markSeen('editor')
    forgetTours()
    expect(seenTours()).toEqual([])
  })

  it('kommt auch ohne Speicher zurecht', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('privates Fenster')
        },
        setItem: () => {
          throw new Error('privates Fenster')
        },
        removeItem: () => undefined,
      },
    })
    expect(seenTours()).toEqual([])
    expect(() => markSeen('proben')).not.toThrow()
  })
})
