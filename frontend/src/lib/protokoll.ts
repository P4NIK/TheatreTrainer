/**
 * Das Protokoll: was der letzte Lauf getan hat, bevor er schiefging.
 *
 * Anlass war ein Bericht, mit dem niemand etwas anfangen konnte:
 *
 *   espeak-ng: Aborted()
 *   339/1854 – 109 neu, 230 aus dem Zwischenspeicher
 *   Synthese fehlgeschlagen: Aborted(). Build with -sASSERTIONS for more info.
 *
 * Darin fehlt alles, was die Ursache verraten hätte: welcher Block, welcher
 * Text, wie viele Aufrufe der Phonemisierer seit seinem letzten Neuaufbau
 * hinter sich hatte. Genau diese Zahl war die Antwort.
 *
 * Deshalb schreibt der Lauf jetzt mit. Wenige Zeilen, aber die richtigen: der
 * Anfang mit Umfang und Stimmen, jeder 25. Block, jede Auffrischung des
 * Phonemisierers, jeder Fehler mit Block, Seite, Sprecher und Textprobe – und
 * das Ende. Das Ganze liegt im localStorage, überlebt also auch einen
 * Absturz, und steht in der Technik-Prüfung zum Kopieren.
 *
 * Absichtlich kein allgemeines Log-Framework: Es gibt einen Leser, und der
 * schickt den Text aus der Technik-Prüfung weiter.
 */

const KEY = 'theater-protokoll'
/** So viele Zeilen werden aufgehoben; ältere fallen vorne heraus. */
const MAX = 300
/** Häufiger als so wird nicht geschrieben – ein Lauf meldet sich oft. */
const FLUSH_MS = 1000

export interface Eintrag {
  /** Millisekunden seit 1970. */
  at: number
  text: string
}

let zeilen: Eintrag[] = readStored()
let timer: number | null = null

function readStored(): Eintrag[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (e): e is Eintrag =>
          typeof e === 'object' && e !== null && typeof (e as Eintrag).text === 'string',
      )
      .slice(-MAX)
  } catch {
    return []
  }
}

/** Sofort schreiben – am Ende eines Laufs und beim Verlassen der Seite. */
export function flush(): void {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(zeilen))
  } catch {
    // Voller Speicher: Das Protokoll ist das Erste, was man dann opfert.
  }
}

/**
 * Eine Zeile ins Protokoll.
 *
 * Geschrieben wird verzögert: Ein Lauf meldet Hunderte Zeilen, und jede
 * einzeln in den localStorage zu legen würde mehr kosten als das Erzeugen
 * einer Replik. Eine Sekunde Verzug ist der Preis dafür, dass bei einem
 * Absturz höchstens die letzte Sekunde fehlt.
 */
export function log(text: string): void {
  zeilen.push({ at: Date.now(), text })
  if (zeilen.length > MAX) zeilen = zeilen.slice(-MAX)
  if (timer === null && typeof window !== 'undefined') {
    timer = window.setTimeout(() => {
      timer = null
      flush()
    }, FLUSH_MS)
  }
}

export function entries(): Eintrag[] {
  return zeilen
}

export function clearProtokoll(): void {
  zeilen = []
  flush()
}

/** Das Protokoll als Text – für die Technik-Prüfung und zum Weiterschicken. */
export function protokollText(max = MAX): string {
  return zeilen
    .slice(-max)
    .map((e) => `${new Date(e.at).toLocaleTimeString('de-DE')}  ${e.text}`)
    .join('\n')
}

/* ------------------------------------------------------------ Werkzeuge */

/** Eine Textprobe fürs Protokoll: kurz, einzeilig, ohne Überraschungen. */
export function probe(text: string, max = 60): string {
  const eine = text.replace(/\s+/g, ' ').trim()
  return eine.length > max ? `${eine.slice(0, max)}…` : eine
}

/**
 * Zeichen, die man einem Text nicht ansieht.
 *
 * Wenn ein Block den Phonemisierer umbringt, ist die erste Frage: Steht da
 * etwas Unsichtbares drin? Steuerzeichen, geschützte Leerzeichen, Zeichen
 * jenseits der gewohnten Ebene – die stehen hier mit ihrer Nummer.
 */
export function auffaellig(text: string): string {
  const gefunden = new Map<string, number>()
  for (const zeichen of text) {
    const code = zeichen.codePointAt(0) ?? 0
    const normal =
      (code >= 0x20 && code <= 0x7e) ||
      'äöüÄÖÜßéèêáàâíìîóòôúùûñç„“‚‘–—…«»›‹€§°'.includes(zeichen)
    if (normal) continue
    const name = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`
    gefunden.set(name, (gefunden.get(name) ?? 0) + 1)
  }
  return [...gefunden]
    .map(([name, wie]) => (wie > 1 ? `${name}×${wie}` : name))
    .join(' ')
}
