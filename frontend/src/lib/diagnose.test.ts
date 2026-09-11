import { describe, expect, it } from 'vitest'

import {
  daysApart,
  restartCheck,
  formatBytes,
  markerCheck,
  nextMarker,
  reportText,
  summary,
  type Check,
  type Marker,
  type StartEntry,
} from './diagnose'

const MB = 1024 * 1024

function marker(over: Partial<Marker> = {}): Marker {
  return {
    first: '2026-01-01T10:00:00.000Z',
    last: '2026-01-10T10:00:00.000Z',
    visits: 3,
    maxGap: 4,
    used: 300 * MB,
    ...over,
  }
}

describe('formatBytes', () => {
  it('bleibt bei runden Zahlen', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(4096)).toBe('4 kB')
    expect(formatBytes(63 * MB)).toBe('63 MB')
    expect(formatBytes(1536 * MB)).toBe('1,5 GB')
  })
})

describe('daysApart', () => {
  it('zählt ganze Tage und nie rückwärts', () => {
    expect(daysApart('2026-01-01T10:00:00Z', '2026-01-08T09:00:00Z')).toBe(6)
    expect(daysApart('2026-01-08T10:00:00Z', '2026-01-01T10:00:00Z')).toBe(0)
    expect(daysApart('kaputt', '2026-01-01T10:00:00Z')).toBe(0)
  })
})

describe('nextMarker', () => {
  it('legt beim ersten Besuch eine neue Marke an', () => {
    const now = new Date('2026-02-01T12:00:00Z')
    expect(nextMarker({ opfs: null, local: null }, now, 5)).toEqual({
      first: now.toISOString(),
      last: now.toISOString(),
      visits: 1,
      maxGap: 0,
      used: 5,
    })
  })

  it('merkt sich die längste Pause', () => {
    const before = { opfs: marker({ maxGap: 4 }), local: null }
    const next = nextMarker(before, new Date('2026-01-21T10:00:00Z'), 7)
    expect(next.first).toBe(before.opfs.first)
    expect(next.visits).toBe(4)
    expect(next.maxGap).toBe(11)
    expect(next.used).toBe(7)
  })

  it('vergisst eine längere Pause von früher nicht', () => {
    const before = { opfs: marker({ maxGap: 30 }), local: null }
    expect(nextMarker(before, new Date('2026-01-11T10:00:00Z'), 0).maxGap).toBe(30)
  })

  it('nimmt die kleine Notiz, wenn der Dateispeicher leer ist', () => {
    const before = { opfs: null, local: marker() }
    expect(nextMarker(before, new Date('2026-01-11T10:00:00Z'), 0).visits).toBe(4)
  })
})

describe('markerCheck', () => {
  const now = new Date('2026-01-21T10:00:00Z')

  it('meldet die frisch gesetzte Marke', () => {
    const check = markerCheck({ opfs: null, local: null }, now, 0)
    expect(check.status).toBe('ok')
    expect(check.detail).toContain('gesetzt')
  })

  it('nennt die überstandene Pause', () => {
    const check = markerCheck({ opfs: marker(), local: marker() }, now, 300 * MB)
    expect(check.status).toBe('ok')
    expect(check.detail).toContain('11 Tage')
  })

  it('erkennt den geleerten Dateispeicher', () => {
    const check = markerCheck({ opfs: null, local: marker() }, now, 0)
    expect(check.status).toBe('fail')
    expect(check.advice).toContain('Sicherungskopie')
  })

  it('erkennt den halb geleerten Speicher', () => {
    const check = markerCheck({ opfs: marker(), local: null }, now, 300 * MB)
    expect(check.status).toBe('warn')
  })

  it('merkt, wenn der Platzbedarf eingebrochen ist', () => {
    const check = markerCheck({ opfs: marker(), local: marker() }, now, 1 * MB)
    expect(check.status).toBe('warn')
    expect(check.detail).toContain('aufgeräumt')
  })

  it('hält ein gelöschtes Stück nicht für Datenverlust', () => {
    // 300 MB auf 120 MB: ein Stück weniger, die Stimme liegt noch da.
    const before = { opfs: marker(), local: marker() }
    expect(markerCheck(before, now, 120 * MB).status).toBe('ok')
  })

  it('hält kleine Schwankungen nicht für Datenverlust', () => {
    const before = { opfs: marker({ used: 2 * MB }), local: marker({ used: 2 * MB }) }
    expect(markerCheck(before, now, 1 * MB).status).toBe('ok')
  })
})

describe('summary und reportText', () => {
  const checks: Check[] = [
    { key: 'a', title: 'Erstes', status: 'ok', detail: 'geht' },
    { key: 'b', title: 'Zweites', status: 'warn', detail: 'ginge besser', advice: 'so geht es besser' },
  ]

  it('zählt die offenen Punkte', () => {
    expect(summary(checks).status).toBe('warn')
    expect(summary([checks[0]]).status).toBe('ok')
    expect(summary([...checks, { key: 'c', title: 'Drittes', status: 'fail', detail: 'nein' }]).status).toBe('fail')
  })

  it('schreibt jeden Punkt in eine Zeile', () => {
    const text = reportText(checks, new Date('2026-01-21T10:00:00Z'))
    expect(text).toContain('[ok] Erstes: geht')
    expect(text).toContain('[!] Zweites: ginge besser')
    expect(text).toContain('→ so geht es besser')
  })
})

describe('restartCheck', () => {
  const jetzt = new Date('2026-09-11T17:30:00Z')
  const start = (min: number, over: Partial<StartEntry> = {}): StartEntry => {
    const at = new Date(jetzt.getTime() - min * 60_000).toISOString()
    return { at, alive: at, where: '#/', left: at, ...over }
  }

  it('sagt nichts, solange es nur diesen einen Start gibt', () => {
    expect(restartCheck(jetzt, []).status).toBe('ok')
    expect(restartCheck(jetzt, [start(0)]).detail).toContain('Noch kein zweiter Start')
  })

  /*
   * Wer die App weglegt, verabschiedet sich über `pagehide`. Dass iOS sie
   * danach aus dem Speicher wirft, ist normal – und keine Warnung wert.
   */
  it('hält ordentliches Verlassen für normal', () => {
    const check = restartCheck(jetzt, [start(180), start(120), start(60), start(0)])
    expect(check.status).toBe('ok')
    expect(check.detail).toContain('3 Starts')
    expect(check.detail).toContain('iOS')
  })

  it('erkennt den Abbruch mitten im Betrieb', () => {
    const abbruch: StartEntry = {
      at: new Date(jetzt.getTime() - 65 * 60_000).toISOString(),
      alive: new Date(jetzt.getTime() - 61 * 60_000).toISOString(),
      where: '#/p/hamlet',
      // kein left – die Seite war einfach weg
    }
    const check = restartCheck(jetzt, [start(180), abbruch, start(0)])
    expect(check.status).toBe('warn')
    expect(check.detail).toContain('ohne Abschied')
    expect(check.detail).toContain('4 Minuten')
    expect(check.detail).toContain('in einem Stück')
    expect(check.advice).toBeTruthy()
  })

  it('zählt mehrere Abbrüche', () => {
    const weg = (min: number): StartEntry => ({
      at: new Date(jetzt.getTime() - min * 60_000).toISOString(),
      alive: new Date(jetzt.getTime() - (min - 2) * 60_000).toISOString(),
      where: '#/technik',
    })
    const check = restartCheck(jetzt, [weg(300), weg(200), start(100), start(0)])
    expect(check.detail).toContain('davon 2 ohne Abschied')
    expect(check.detail).toContain('in der Technik-Prüfung')
  })
})
