import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cardPlacement,
  forgetTours,
  hasSeen,
  markSeen,
  needsScroll,
  RAND,
  sameSpot,
  seenTours,
  stepsFor,
  TOURS,
  tourForTab,
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

  /*
   * Der Grund für die Aufteilung: Wer im Lernmodus auf das Fragezeichen
   * drückt, soll etwas über den Lernmodus hören – und nicht zuerst zu den
   * Sprechern geschickt werden. Also hat jeder Reiter genau eine Tour.
   */
  it('gibt jedem Reiter seine eigene Einführung', () => {
    expect(tourForTab('editor')).toBe('editor')
    expect(tourForTab('speakers')).toBe('sprecher')
    expect(tourForTab('audio')).toBe('hoerfassung')
    expect(tourForTab('rehearsal')).toBe('probe')
    expect(tourForTab('cards')).toBe('karten')
    // Und keine dieser Touren ist leer.
    for (const tab of ['editor', 'speakers', 'audio', 'rehearsal', 'cards'] as const) {
      expect(stepsFor(tourForTab(tab), false).length).toBeGreaterThan(0)
    }
  })

  it('kennt keine Tour ohne Namen', () => {
    expect(stepsFor('stuecke', false).length).toBe(3)
    // @ts-expect-error – absichtlich falscher Name
    expect(stepsFor('gibtsnicht', false)).toEqual([])
  })
})

/*
 * Der Kasten sprang zweimal: erst stand er an der alten Stelle des Ziels, dann
 * rollte die Seite hin, dann rückte er nach. Beides hat einen Grund – gerollt
 * wurde auch dorthin, wo längst nichts zu rollen war, und angezeigt wurde,
 * bevor irgendetwas stillstand.
 */
describe('needsScroll', () => {
  const view = { width: 390, height: 664 }
  const ziel = (top: number, height = 40): Kasten => ({ top, left: 20, width: 200, height })

  it('lässt die Seite stehen, wo das Ziel schon bequem im Bild ist', () => {
    expect(needsScroll(ziel(300), view)).toBe(false)
    expect(needsScroll(ziel(60), view)).toBe(false)
    expect(needsScroll(ziel(564), view)).toBe(false)
  })

  it('rollt zu allem, was am Rand klebt oder draußen steht', () => {
    expect(needsScroll(ziel(-100), view)).toBe(true)
    expect(needsScroll(ziel(10), view)).toBe(true)
    expect(needsScroll(ziel(640), view)).toBe(true)
    expect(needsScroll(ziel(2000), view)).toBe(true)
  })

  /* Das PDF ist höher als jedes Telefon – es ganz ins Bild zu rollen ist
     unmöglich, und der Versuch verschöbe die Seite bei jedem Schritt. */
  it('gibt sich bei hohen Zielen mit einem Stück zufrieden', () => {
    expect(needsScroll(ziel(0, 2000), view)).toBe(false)
    expect(needsScroll(ziel(-1500, 2000), view)).toBe(false)
    expect(needsScroll(ziel(-2000, 2000), view)).toBe(true)
    expect(needsScroll(ziel(700, 2000), view)).toBe(true)
  })
})

describe('sameSpot', () => {
  const a: Kasten = { top: 100, left: 20, width: 200, height: 40 }

  it('übersieht das Zittern einer weich rollenden Seite', () => {
    expect(sameSpot(a, { ...a, top: 100.4 })).toBe(true)
    expect(sameSpot(a, { ...a, top: 101 })).toBe(false)
  })

  it('zählt „kein Ziel“ als eigene Stelle', () => {
    expect(sameSpot(null, null)).toBe(true)
    expect(sameSpot(a, null)).toBe(false)
    expect(sameSpot(null, a)).toBe(false)
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
    expect(() => markSeen('probe')).not.toThrow()
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
