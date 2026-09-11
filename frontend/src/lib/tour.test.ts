import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cardPlacement,
  forgetTours,
  hasSeen,
  markSeen,
  RAND,
  seenTours,
  stepsFor,
  TOURS,
  type Kasten,
} from './tour'

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

/*
 * Der Kasten muss ganz im Bild stehen – sonst fehlt die Überschrift oder der
 * Knopf „Weiter“. Genau das ist passiert, solange mit einer angenommenen Höhe
 * gerechnet wurde: In einem flachen Fenster rutschte er über den oberen Rand.
 */
describe('cardPlacement', () => {
  const ziel = (over: Partial<Kasten> = {}): Kasten => ({
    top: 300,
    left: 400,
    width: 200,
    height: 40,
    ...over,
  })

  /** Steht der Kasten vollständig im Fenster? */
  const drin = (platz: { top: number; left: number; width: number }, hoehe: number, view: { width: number; height: number }) => {
    const hoch = Math.min(hoehe, view.height - 2 * RAND)
    return (
      platz.top >= RAND - 0.01 &&
      platz.top + hoch <= view.height - RAND + 0.01 &&
      platz.left >= RAND - 0.01 &&
      platz.left + platz.width <= view.width - RAND + 0.01
    )
  }

  const fenster = [
    { width: 1280, height: 900 },
    { width: 1280, height: 260 },
    { width: 1280, height: 200 },
    { width: 390, height: 664 },
    { width: 360, height: 420 },
  ]

  it('bleibt in jedem Fenster ganz sichtbar', () => {
    for (const view of fenster) {
      for (const narrow of [true, false]) {
        for (const hoehe of [120, 200, 400, 2000]) {
          for (const oben of [0, 20, view.height / 2, view.height - 60, view.height - 1]) {
            const platz = cardPlacement({ box: ziel({ top: oben }), cardHeight: hoehe, view, narrow })
            expect(
              drin(platz, hoehe, view),
              `${view.width}×${view.height} narrow=${narrow} Kasten ${hoehe} Ziel bei ${oben}: ${JSON.stringify(platz)}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('bleibt auch ohne Ziel im Bild', () => {
    for (const view of fenster) {
      const platz = cardPlacement({ box: null, cardHeight: 300, view, narrow: false })
      expect(drin(platz, 300, view)).toBe(true)
    }
  })

  it('stellt sich am Rechner unter das Ziel, wenn Platz ist', () => {
    const view = { width: 1280, height: 900 }
    const platz = cardPlacement({ box: ziel({ top: 200, height: 50 }), cardHeight: 190, view, narrow: false })
    expect(platz.top).toBeGreaterThan(250)
    // und waagerecht mittig unter dem Ziel
    expect(platz.left + platz.width / 2).toBeCloseTo(500, 0)
  })

  it('weicht auf dem Telefon an den gegenüberliegenden Rand aus', () => {
    const view = { width: 390, height: 664 }
    const obenAmZiel = cardPlacement({ box: ziel({ top: 40 }), cardHeight: 190, view, narrow: true })
    const untenAmZiel = cardPlacement({ box: ziel({ top: 500 }), cardHeight: 190, view, narrow: true })
    expect(obenAmZiel.top).toBeGreaterThan(view.height / 2)
    expect(untenAmZiel.top).toBe(RAND)
  })
})
