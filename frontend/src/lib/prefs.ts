/**
 * Was eine Ansicht behält.
 *
 * Die Schalter einer Probe sind Gewohnheit: Wer Regieanweisungen nicht hören
 * will, will sie morgen auch nicht hören. Sie jedes Mal neu zu stellen ist
 * genau die Art Arbeit, die eine App abnehmen soll.
 *
 * Zwei Schubladen, weil zwei Arten von Einstellung vorkommen:
 *
 * - Was zur Person gehört – mitlesen, mitschneiden, Regieanweisungen – liegt
 *   für alle Stücke zusammen (`globalKey`). Beim zweiten Stück steht es
 *   schon so, wie man es mag.
 * - Was zum Stück gehört – Rolle, Seitenbereich, Aufbau des Textbuchs –
 *   liegt je Stück (`projectKey`). Eine Seitenzahl aus einem anderen Buch
 *   wäre hier nur Unsinn.
 *
 * Gespeichert wird im localStorage: klein, sofort da (kein Aufblitzen der
 * Voreinstellung beim Öffnen) und pro Browser – wie alles andere hier auch.
 * Gelesen wird nie blind: was herauskommt, hat ein Mensch in einem privaten
 * Fenster, eine alte Fassung der App oder ein halber Schreibvorgang
 * hinterlassen können, deshalb geht jeder Wert durch einen Prüfer.
 */

import { useEffect, useRef, useState } from 'react'

/** Alles, was hierher gehört, beginnt so – das macht Vergessen einfach. */
const RAUM = 'theater-opt'

/** Für alle Stücke zusammen. */
export function globalKey(panel: string): string {
  return `${RAUM}/${panel}`
}

/** Für dieses eine Stück. */
export function projectKey(projectId: string, panel: string): string {
  return `${RAUM}/${projectId}/${panel}`
}

export function readRaw(key: string): unknown {
  try {
    const roh = window.localStorage.getItem(key)
    return roh === null ? undefined : JSON.parse(roh)
  } catch {
    // Privates Fenster oder halb geschriebenes JSON: dann eben die Vorgabe.
    return undefined
  }
}

export function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Voller oder gesperrter Speicher. Eine Einstellung ist es nicht wert,
    // dafür eine Probe abzubrechen.
  }
}

/** Alle gemerkten Einstellungen vergessen – für die Technik-Prüfung. */
export function forgetPrefs(): void {
  try {
    const speicher = window.localStorage
    const weg: string[] = []
    for (let i = 0; i < speicher.length; i++) {
      const key = speicher.key(i)
      if (key && (key.startsWith(`${RAUM}/`) || key === ZUENDER)) weg.push(key)
    }
    for (const key of weg) speicher.removeItem(key)
  } catch {
    // nichts zu vergessen
  }
}

/* --------------------------------------------------------------- Prüfer */

/** Ein Feld aus dem, was im Speicher lag – ohne Annahme, dass es das gibt. */
export function pick(raw: unknown, name: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  return (raw as Record<string, unknown>)[name]
}

export function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback
}

export function num(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

/** Eine Zahl, die auch „gar keine“ sein darf – etwa „ohne Grenze“. */
export function numOrNull(
  raw: unknown,
  fallback: number | null,
  min: number,
  max: number,
): number | null {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, raw))
}

export function oneOf<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback
}

export function str(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback
}

/** Eine Liste von Texten – etwa von Hand gewählte Blöcke. */
export function strings(raw: unknown, fallback: string[]): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : fallback
}

/* ----------------------------------------------------------------- Haken */

/**
 * Eine Ansicht und ihr Gedächtnis.
 *
 * Gelesen wird einmal beim Aufbau, geschrieben bei jeder Änderung – aber
 * nicht sofort wieder das, was gerade gelesen wurde. Der Schlüssel muss über
 * die Lebensdauer gleich bleiben; die Reiter bauen ihre Tafeln ohnehin neu
 * auf, wenn man das Stück wechselt.
 */
export function usePrefs<T>(
  key: string,
  read: (raw: unknown) => T,
): [T, (next: T | ((alt: T) => T)) => void] {
  const [wert, setWert] = useState<T>(() => read(readRaw(key)))
  const frisch = useRef(true)

  useEffect(() => {
    if (frisch.current) {
      frisch.current = false
      return
    }
    write(key, wert)
  }, [key, wert])

  return [wert, setWert]
}

/* --------------------------------------------------------------- Zünder */

/*
 * Schalter, die etwas Schweres nachladen.
 *
 * „Gesagtes auswerten“ holt beim ersten Mal rund 200 MB Spracherkennung und
 * baut sie neben der Stimme im Speicher auf. Auf einem Telefon endet das
 * gelegentlich damit, dass Safari die Seite beendet. Würde der Schalter
 * gemerkt, käme die Seite genau in dem Zustand zurück, der sie umgebracht
 * hat – beim nächsten Versuch wieder, und wieder.
 *
 * Also liegt neben der Einstellung eine Zündschnur: Sie wird angezündet,
 * solange das Wagnis läuft, und ausgetreten, wenn die Seite sich ordentlich
 * abmeldet (`pagehide`, das auch beim Schließen und beim Wegwischen kommt).
 * Wird sie beim nächsten Start noch brennend gefunden, hat die Seite das
 * letzte Mal nicht überlebt – dann geht der Schalter aus, und die Ansicht
 * sagt, warum. Genau diese Unterscheidung nutzt auch das Neustart-Protokoll
 * in diagnose.ts.
 */

const ZUENDER = 'theater-wagnis'

export interface Risk {
  /** Der Schlüssel der Einstellung, in der der Schalter liegt. */
  pref: string
  /** Das Feld darin. */
  field: string
}

const marke = (r: Risk) => `${r.pref}#${r.field}`

function readFuses(): Record<string, number> {
  const roh = readRaw(ZUENDER)
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return {}
  const map: Record<string, number> = {}
  for (const [k, v] of Object.entries(roh as Record<string, unknown>)) {
    if (typeof v === 'number') map[k] = v
  }
  return map
}

export function armRisk(risk: Risk): void {
  const map = readFuses()
  map[marke(risk)] = Date.now()
  write(ZUENDER, map)
}

export function disarmRisk(risk: Risk): void {
  const map = readFuses()
  if (!(marke(risk) in map)) return
  delete map[marke(risk)]
  write(ZUENDER, map)
}

/** Welche Wagnisse liefen noch, als die Seite starb. Nur für Anzeigen. */
let entschaerft: Risk[] = []

/**
 * Beim Programmstart genau einmal aufrufen, vor dem ersten Bild: Was noch
 * brannte, wird ausgeschaltet – im Speicher, damit die Ansicht es gar nicht
 * anders zu sehen bekommt.
 */
export function defuseCrashes(): Risk[] {
  const map = readFuses()
  const liste: Risk[] = []
  for (const eintrag of Object.keys(map)) {
    const trenn = eintrag.lastIndexOf('#')
    if (trenn <= 0) continue
    const risk = { pref: eintrag.slice(0, trenn), field: eintrag.slice(trenn + 1) }
    const alt = readRaw(risk.pref)
    const neu =
      alt && typeof alt === 'object' && !Array.isArray(alt)
        ? { ...(alt as Record<string, unknown>) }
        : {}
    neu[risk.field] = false
    write(risk.pref, neu)
    liste.push(risk)
  }
  if (Object.keys(map).length > 0) write(ZUENDER, {})
  entschaerft = liste
  return liste
}

/** Wurde dieser Schalter beim Start wegen eines Absturzes ausgeschaltet? */
export function wasDefused(risk: Risk): boolean {
  return entschaerft.some((r) => r.pref === risk.pref && r.field === risk.field)
}

/** Der Hinweis ist gelesen. */
export function forgetDefused(risk: Risk): void {
  entschaerft = entschaerft.filter((r) => !(r.pref === risk.pref && r.field === risk.field))
}

/**
 * Die Zündschnur an das hängen, was gerade läuft.
 *
 * `active` heißt: Der Schalter steht auf ein, diese Ansicht ist offen, das
 * Wagnis kann jeden Moment Speicher brauchen. Beim Wechsel des Reiters und
 * beim Ausschalten wird ausgetreten; über ein `pagehide` hinweg wird sie
 * gelöscht und bei der Rückkehr wieder angezündet, denn ein Telefon schiebt
 * eine Seite auch ohne Absturz in den Hintergrund.
 */
export function useRisk(risk: Risk, active: boolean): void {
  const { pref, field } = risk

  useEffect(() => {
    const dieses = { pref, field }
    if (!active) {
      disarmRisk(dieses)
      return
    }

    armRisk(dieses)
    const weg = () => disarmRisk(dieses)
    const zurueck = () => armRisk(dieses)
    window.addEventListener('pagehide', weg)
    window.addEventListener('pageshow', zurueck)
    return () => {
      window.removeEventListener('pagehide', weg)
      window.removeEventListener('pageshow', zurueck)
      disarmRisk(dieses)
    }
  }, [pref, field, active])
}
