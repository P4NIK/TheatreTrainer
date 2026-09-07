import { describe, expect, it } from 'vitest'

import {
  addDays,
  BOX_DAYS,
  buildDeck,
  cardSteps,
  dayKey,
  daysBetween,
  daysToPremiere,
  deckStats,
  describeDue,
  intervalDays,
  isDue,
  MAX_BOX,
  requeue,
  review,
  sessionDelay,
  sessionQueue,
  suggestGrade,
  type DeckEntry,
} from './cards'
import type { Block, Card, Deck } from '../types'

function line(id: string, order: number, speaker: string | null, text = `Text ${id}`): Block {
  return {
    id,
    page: Math.ceil(order / 3),
    rect: { x: 0, y: 0, w: 1, h: 0.02 },
    order,
    type: speaker === null ? 'direction' : 'line',
    speaker,
    text,
  }
}

function card(box: number, due: string, extra: Partial<Card> = {}): Card {
  return {
    box,
    due,
    reviews: 1,
    lapses: 0,
    streak: 0,
    lastGrade: 'good',
    lastReviewed: '2026-09-01T10:00:00.000Z',
    ...extra,
  }
}

/** 6 September 2026, a Sunday evening – rehearsal time. */
const now = new Date(2026, 8, 6, 20, 0)
const today = '2026-09-06'

const blocks = [
  line('b1', 1, 'SIR'),
  line('b2', 2, 'ILL'),
  line('b3', 3, null),
  line('b4', 4, 'ill'),
  line('b5', 5, 'ILL', '   '),
  line('b6', 6, 'SIR'),
  line('b7', 7, 'ILL'),
]

describe('Tage', () => {
  it('schreibt den lokalen Tag, nicht den UTC-Tag', () => {
    // Kurz vor Mitternacht Ortszeit ist immer noch derselbe Probentag.
    expect(dayKey(new Date(2026, 8, 6, 23, 30))).toBe('2026-09-06')
    expect(dayKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })

  it('rechnet über Monatsgrenzen', () => {
    expect(addDays('2026-09-28', 5)).toBe('2026-10-03')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-28', '2026-10-03')).toBe(5)
  })

  it('zählt Vergangenes negativ', () => {
    expect(daysBetween('2026-09-06', '2026-09-03')).toBe(-3)
    expect(daysBetween('2026-09-06', '2026-09-06')).toBe(0)
  })
})

describe('intervalDays', () => {
  it('nimmt ohne Premiere den vollen Abstand des Fachs', () => {
    expect(intervalDays(1, null)).toBe(BOX_DAYS[0])
    expect(intervalDays(MAX_BOX, null)).toBe(35)
  })

  it('bleibt in den Fachgrenzen, auch bei Unsinn', () => {
    expect(intervalDays(0, null)).toBe(BOX_DAYS[0])
    expect(intervalDays(99, null)).toBe(BOX_DAYS[MAX_BOX - 1])
  })

  it('springt nicht über die Premiere', () => {
    // Neun Tage vorher hilft ein Fach mit 35 Tagen niemandem mehr.
    expect(intervalDays(MAX_BOX, 9)).toBe(8)
    // Weit vorher bleibt der normale Abstand stehen.
    expect(intervalDays(3, 60)).toBe(3)
  })

  it('macht am Premierentag alles sofort fällig', () => {
    expect(intervalDays(MAX_BOX, 0)).toBe(0)
    expect(intervalDays(MAX_BOX, 1)).toBe(0)
  })

  it('hört nach der Premiere auf zu deckeln', () => {
    // Das Stück läuft – dann sind die langen Abstände wieder erwünscht.
    expect(daysToPremiere('2026-09-01', today)).toBeNull()
    expect(daysToPremiere('2026-09-15', today)).toBe(9)
    expect(daysToPremiere('', today)).toBeNull()
  })
})

describe('review', () => {
  it('schiebt eine gesessene Karte ein Fach weiter', () => {
    const next = review(card(2, today), 'good', now, '')
    expect(next.box).toBe(3)
    expect(next.due).toBe(addDays(today, BOX_DAYS[2]))
    expect(next.streak).toBe(1)
    expect(next.reviews).toBe(2)
  })

  it('lässt eine wackelige Karte im Fach', () => {
    const next = review(card(3, today, { streak: 4 }), 'hard', now, '')
    expect(next.box).toBe(3)
    expect(next.streak).toBe(0)
    expect(next.lapses).toBe(0)
  })

  it('wirft eine danebengegangene Karte ins erste Fach zurück', () => {
    const next = review(card(5, today, { streak: 4, lapses: 1 }), 'again', now, '')
    expect(next.box).toBe(1)
    expect(next.lapses).toBe(2)
    expect(next.streak).toBe(0)
    expect(next.due).toBe(today)
  })

  it('behandelt eine noch nie geübte Replik wie Fach 1', () => {
    const next = review(undefined, 'good', now, '')
    expect(next.box).toBe(2)
    expect(next.reviews).toBe(1)
    expect(next.lastGrade).toBe('good')
  })

  it('kommt über das letzte Fach nicht hinaus', () => {
    expect(review(card(MAX_BOX, today), 'good', now, '').box).toBe(MAX_BOX)
  })

  it('deckelt die Fälligkeit an der Premiere', () => {
    // Premiere in vier Tagen: die Karte kommt spätestens am Vortag wieder.
    const next = review(card(5, today), 'good', now, '2026-09-10')
    expect(next.box).toBe(6)
    expect(next.due).toBe('2026-09-09')
  })
})

describe('sessionDelay', () => {
  it('holt Danebengegangenes in derselben Sitzung zurück', () => {
    // Sofort danach prüfte nur das Echo, drei Karten später das Gedächtnis.
    expect(sessionDelay('again')).toBe(3)
    expect(sessionDelay('hard')).toBe(10)
    expect(sessionDelay('good')).toBe(0)
  })
})

describe('suggestGrade', () => {
  it('schlägt vor, entscheidet aber nichts', () => {
    expect(suggestGrade(0.95)).toBe('good')
    expect(suggestGrade(0.7)).toBe('hard')
    expect(suggestGrade(0.2)).toBe('again')
  })
})

describe('buildDeck', () => {
  it('nimmt nur die Repliken der Rolle, in Stückreihenfolge', () => {
    const deck = buildDeck(blocks, 'ILL', {}, today)
    expect(deck.map((e) => e.block.id)).toEqual(['b2', 'b4', 'b7'])
  })

  it('lässt leere Repliken und Regieanweisungen weg', () => {
    // b5 ist leer, b3 eine Regieanweisung – beides gibt keine Karte her.
    const ids = buildDeck(blocks, 'ILL', {}, today).map((e) => e.block.id)
    expect(ids).not.toContain('b5')
    expect(ids).not.toContain('b3')
  })

  it('hat ohne Rolle nichts zu bieten', () => {
    expect(buildDeck(blocks, '', {}, today)).toEqual([])
  })

  it('rechnet die Restdauer aus dem gespeicherten Stand', () => {
    const cards: Deck = { b2: card(3, '2026-09-09'), b4: card(1, '2026-09-04') }
    const deck = buildDeck(blocks, 'ILL', cards, today)
    expect(deck[0].rest).toBe(3)
    expect(deck[1].rest).toBe(-2)
    expect(deck[2].fresh).toBe(true)
  })
})

describe('sessionQueue', () => {
  const cards: Deck = {
    b2: card(4, '2026-09-20'), // sitzt, ruht noch
    b4: card(1, '2026-09-04'), // schwach und überfällig
    b7: card(4, '2026-09-06'), // sitzt, heute fällig
  }
  const deck = buildDeck(blocks, 'ILL', cards, today)

  it('nimmt die schwächsten Karten zuerst', () => {
    expect(sessionQueue(deck, 'all', null).map((e) => e.block.id)).toEqual(['b4', 'b7', 'b2'])
  })

  it('lässt bei „fällig" die ruhenden Karten liegen', () => {
    expect(sessionQueue(deck, 'due', null).map((e) => e.block.id)).toEqual(['b4', 'b7'])
  })

  it('zählt noch nie Geübtes als fällig', () => {
    const fresh = buildDeck(blocks, 'ILL', {}, today)
    expect(fresh.every(isDue)).toBe(true)
    expect(sessionQueue(fresh, 'due', null)).toHaveLength(3)
  })

  it('sortiert im selben Fach das Überfälligste nach vorn', () => {
    const same: Deck = { b2: card(2, '2026-09-06'), b4: card(2, '2026-09-01'), b7: card(2, '2026-09-05') }
    const ids = sessionQueue(buildDeck(blocks, 'ILL', same, today), 'all', null).map((e) => e.block.id)
    expect(ids).toEqual(['b4', 'b7', 'b2'])
  })

  it('hält sich an die Obergrenze', () => {
    expect(sessionQueue(deck, 'all', 2)).toHaveLength(2)
    expect(sessionQueue(deck, 'all', 0)).toHaveLength(0)
  })
})

describe('deckStats', () => {
  it('zählt, worauf es beim Blick auf den Stapel ankommt', () => {
    const cards: Deck = { b2: card(4, '2026-09-20'), b4: card(1, '2026-09-04') }
    const stats = deckStats(buildDeck(blocks, 'ILL', cards, today))
    expect(stats.total).toBe(3)
    expect(stats.due).toBe(2) // b4 überfällig, b7 noch nie geübt
    expect(stats.fresh).toBe(1)
    expect(stats.solid).toBe(1) // nur b2 steht in Fach 4
    expect(stats.byBox).toHaveLength(MAX_BOX)
    expect(stats.byBox[0]).toBe(2) // b4 und die ungeübte b7
    expect(stats.byBox[3]).toBe(1)
  })
})

describe('describeDue', () => {
  const at = (rest: number, fresh = false): DeckEntry => ({
    block: blocks[1],
    card: fresh ? undefined : card(2, today),
    rest,
    fresh,
  })

  it('sagt in Worten, wann etwas dran ist', () => {
    expect(describeDue(at(0, true))).toBe('neu')
    expect(describeDue(at(0))).toBe('heute fällig')
    expect(describeDue(at(-1))).toBe('1 Tag überfällig')
    expect(describeDue(at(-4))).toBe('4 Tage überfällig')
    expect(describeDue(at(1))).toBe('morgen')
    expect(describeDue(at(5))).toBe('in 5 Tagen')
  })
})

describe('cardSteps', () => {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)

  it('stellt das Stichwort vor die eigene Replik', () => {
    const steps = cardSteps(ordered[3], ordered, 2) // b4
    expect(steps.map((s) => [s.kind, s.block?.id])).toEqual([
      ['listen', 'b2'],
      ['listen', 'b3'],
      ['speak', 'b4'],
    ])
  })

  it('überspringt leere Blöcke, damit das Stichwort nicht zu Stille wird', () => {
    const steps = cardSteps(ordered[6], ordered, 2) // b7, davor die leere b5
    expect(steps.map((s) => s.block?.id)).toEqual(['b4', 'b6', 'b7'])
  })

  it('kommt am Anfang des Stücks ohne Stichwort aus', () => {
    expect(cardSteps(ordered[0], ordered, 2)).toHaveLength(1)
  })

  it('lässt das Stichwort ganz weg, wenn keines gewünscht ist', () => {
    const steps = cardSteps(ordered[3], ordered, 0)
    expect(steps).toHaveLength(1)
    expect(steps[0].kind).toBe('speak')
  })

  it('nimmt Regieanweisungen auf Wunsch nicht als Stichwort', () => {
    // b3 ist Regie: übersprungen wird sie, aber der Einsatz bleibt – gesucht
    // wird weiter rückwärts, bis eine gesprochene Replik da ist.
    const steps = cardSteps(ordered[3], ordered, 2, { includeDirections: false })
    expect(steps.map((s) => s.block?.id)).toEqual(['b1', 'b2', 'b4'])
  })

  it('kommt ohne Stichwort aus, wenn davor nur Regie steht', () => {
    const onlyDirection = [line('d1', 1, null), line('d2', 2, 'ILL')]
    const steps = cardSteps(onlyDirection[1], onlyDirection, 1, { includeDirections: false })
    expect(steps).toHaveLength(1)
    expect(steps[0].block?.id).toBe('d2')
  })
})

describe('requeue', () => {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  /** Drei Karten hintereinander, jede mit einem Stichwort davor. */
  const session = [
    ...cardSteps(ordered[1], ordered, 1), // b1, b2
    ...cardSteps(ordered[3], ordered, 1), // b3, b4
    ...cardSteps(ordered[6], ordered, 1), // b6, b7
  ]
  const again = cardSteps(ordered[1], ordered, 1)

  it('setzt die Karte hinter die geforderte Zahl weiterer Karten', () => {
    // Nach Schritt 1 (b2 gesprochen) zwei Karten warten: hinter b7.
    const next = requeue(session, 1, again, 2)
    expect(next.map((s) => s.block?.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b6', 'b7', 'b1', 'b2'])
  })

  it('hängt ans Ende, wenn so viele Karten nicht mehr kommen', () => {
    const next = requeue(session, 1, again, 99)
    expect(next).toHaveLength(session.length + again.length)
    expect(next[next.length - 1].block?.id).toBe('b2')
  })

  it('bleibt immer hinter der aktuellen Stelle', () => {
    // Sonst verschöbe sich der Index des laufenden Durchlaufs unter ihm weg.
    const next = requeue(session, 1, again, 1)
    expect(next.slice(0, 2).map((s) => s.block?.id)).toEqual(['b1', 'b2'])
  })

  it('lässt bei „saß" alles, wie es ist', () => {
    expect(requeue(session, 1, again, 0)).toBe(session)
    expect(requeue(session, 1, [], 3)).toBe(session)
  })
})
