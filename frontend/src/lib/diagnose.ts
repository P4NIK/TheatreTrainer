/**
 * What this device can actually do, measured on the device itself.
 *
 * In a desktop browser everything the app needs is a given: a file system in
 * the origin, workers, a microphone, WebAssembly. On a phone none of it is,
 * and on iOS the answer changes between versions. Reading it off the user
 * agent would be the wrong way round, so each thing is tried once and the
 * report says what happened.
 *
 * The harder question is not whether it works today – the first minute of use
 * answers that – but whether it is still there in three weeks. A browser may
 * clear an origin it considers abandoned, and Safari does so after about a
 * week without a visit. No single session can measure that, which is why there
 * is a marker: a small note written on the first visit and read on every later
 * one. It carries the longest pause the storage has survived so far, so the
 * answer gets more convincing the longer the app is in use.
 *
 * The note is written twice, into OPFS and into localStorage. The same rules
 * govern both, but not always at the same moment; if one is gone and the other
 * is not, that says which of the two the browser dropped.
 */

import { ModelStore, opfsStore, storageState } from './storage'
import { VOICES, voiceReady } from './voices'

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface Check {
  key: string
  /** The headline in the list. */
  title: string
  status: CheckStatus
  /** What was found, in a sentence or two. */
  detail: string
  /** Only when something is off: what would help. */
  advice?: string
}

const MB = 1024 * 1024

/** Voice, recogniser and app together, as a rough floor for the free space. */
export const NEEDED_BYTES = 330 * MB

/* ------------------------------------------------------------ small things */

/** Bytes the way a person would write them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  if (bytes < 1024 * MB) return `${Math.round(bytes / MB)} MB`
  return `${(bytes / (1024 * MB)).toFixed(1).replace('.', ',')} GB`
}

/** Whole days between two moments, never negative. */
export function daysApart(from: string | number | Date, to: string | number | Date): number {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0
}

function day(count: number): string {
  return count === 1 ? '1 Tag' : `${count} Tage`
}

/** Dieselbe Angabe nach „vor": ein Tag, zwei Tagen. */
function days(count: number): string {
  return count === 1 ? '1 Tag' : `${count} Tagen`
}

function date(value: string): string {
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? '?' : at.toLocaleDateString('de-DE')
}

/* --------------------------------------------------------- device, browser */

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS calls itself Macintosh; the touch points give it away.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

/** True when the page runs from the home screen rather than in a tab. */
export function isStandalone(): boolean {
  const legacy = (navigator as unknown as { standalone?: boolean }).standalone === true
  return legacy || window.matchMedia?.('(display-mode: standalone)').matches === true
}

export function browserLabel(): string {
  const ua = navigator.userAgent
  if (/CriOS/.test(ua)) return 'Chrome auf iOS'
  if (/FxiOS/.test(ua)) return 'Firefox auf iOS'
  if (/EdgiOS|Edg\//.test(ua)) return 'Edge'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'unbekannter Browser'
}

export function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android-Gerät'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows-Rechner'
  return 'Gerät'
}

export function deviceCheck(): Check {
  return {
    key: 'device',
    title: 'Gerät',
    status: 'ok',
    detail: `${deviceLabel()} · ${browserLabel()} · Fenster ${window.innerWidth}×${window.innerHeight} Punkte`,
  }
}

export function homeScreenCheck(): Check {
  const title = 'Vom Home-Bildschirm gestartet'
  if (isStandalone()) {
    return {
      key: 'standalone',
      title,
      status: 'ok',
      detail:
        'Die App läuft als eigenes Fenster, nicht in einem Browser-Tab. Das ist die Fassung, deren Daten am längsten liegen bleiben.',
    }
  }
  if (isIos()) {
    return {
      key: 'standalone',
      title,
      status: 'warn',
      detail: 'Die Seite läuft in einem Safari-Tab.',
      advice:
        'Teilen-Knopf → „Zum Home-Bildschirm". Danach zählt die Seite für iOS als App: sie darf um dauerhaften Speicher bitten, und der Aufräumdienst, der Tab-Daten nach etwa einer Woche ohne Besuch löscht, greift nicht mehr.',
    }
  }
  return {
    key: 'standalone',
    title,
    status: 'ok',
    detail: 'Die Seite läuft in einem Browser-Tab – auf diesem Gerät genügt das.',
  }
}

/* ------------------------------------------------------------------ speicher */

const PROBE_BYTES = MB

/**
 * Ein eigener Name je Lauf.
 *
 * React startet einen Effekt in der Entwicklungsfassung zweimal, und zwei
 * gleichzeitige Schreibproben auf denselben Namen räumen sich gegenseitig die
 * Datei weg – die zweite meldete dann einen Fehler, den es nicht gibt.
 */
function probeName(): string {
  const zufall = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `schreibprobe-${zufall}.bin`
}

/** Writes a megabyte, reads it back, deletes it – the storage, end to end. */
export async function opfsCheck(): Promise<Check> {
  const key = 'opfs'
  const title = 'Speicher im Browser'
  if (!navigator.storage?.getDirectory) {
    return {
      key,
      title,
      status: 'fail',
      detail: 'Dieser Browser hat keinen eigenen Dateispeicher (OPFS). Die App kann hier nichts behalten.',
      advice: 'Auf dem iPhone hilft Safari; ein privates Fenster kann OPFS ebenfalls verweigern.',
    }
  }

  const store = opfsStore('diagnose')
  const probe = probeName()
  const written = new Uint8Array(PROBE_BYTES)
  for (let i = 0; i < PROBE_BYTES; i += 997) written[i] = (i * 7) & 255

  const started = performance.now()
  try {
    await store.write(probe, written)
    const back = await store.read(probe)

    if (!back || back.byteLength !== PROBE_BYTES) {
      throw new Error(`zurückgelesen kamen ${back ? back.byteLength : 0} statt ${PROBE_BYTES} Bytes`)
    }
    for (let i = 0; i < PROBE_BYTES; i += 997) {
      if (back[i] !== written[i]) throw new Error(`Byte ${i} weicht ab`)
    }

    const ms = Math.round(performance.now() - started)
    return {
      key,
      title,
      status: 'ok',
      detail: `1 MB geschrieben und Stichprobe für Stichprobe zurückgelesen – ${ms} ms. Genau hier liegen Stücke, Stimme und Aufnahmen.`,
    }
  } catch (error) {
    return {
      key,
      title,
      status: 'fail',
      detail: `Die Schreibprobe ging schief: ${(error as Error).message}`,
      advice: 'Ohne diesen Speicher kann die App nichts behalten. Privates Fenster? Speicher voll?',
    }
  } finally {
    await store.remove(probe).catch(() => undefined)
  }
}

export async function persistenceCheck(): Promise<Check> {
  const key = 'persist'
  const title = 'Dauerhafter Speicher'
  if (!navigator.storage?.persisted) {
    return {
      key,
      title,
      status: 'warn',
      detail: 'Dieser Browser kennt die Frage nicht, ob er den Speicher in Ruhe lässt.',
      advice: 'Dann bleibt die Sicherungskopie als Datei die einzige Zusage – ein Klick pro Stück.',
    }
  }
  if (await navigator.storage.persisted()) {
    return {
      key,
      title,
      status: 'ok',
      detail: 'Der Browser hat zugesagt, diesen Speicher nicht von sich aus aufzuräumen.',
    }
  }
  return {
    key,
    title,
    status: 'warn',
    detail: 'Der Browser darf den Speicher aufräumen, wenn es eng wird oder die App lange unbenutzt bleibt.',
    advice:
      'Unten „Dauerhaft anfordern" drücken. Safari entscheidet danach selbst, und die Chancen stehen besser, wenn die App auf dem Home-Bildschirm liegt und regelmäßig benutzt wird.',
  }
}

export async function spaceCheck(): Promise<Check> {
  const key = 'space'
  const title = 'Platz'
  const { quota, used } = await storageState()
  if (!quota) {
    return {
      key,
      title,
      status: 'warn',
      detail: `Der Browser sagt nicht, wie viel Platz er gibt. Belegt sind ${formatBytes(used)}.`,
    }
  }
  const free = quota - used
  return {
    key,
    title,
    status: free < NEEDED_BYTES ? 'warn' : 'ok',
    detail: `${formatBytes(used)} belegt, ${formatBytes(free)} frei von ${formatBytes(quota)}.`,
    advice:
      free < NEEDED_BYTES
        ? `Stimme und Spracherkennung brauchen zusammen etwa ${formatBytes(NEEDED_BYTES)}. Auf dem Gerät Platz schaffen, oder auf die Spracherkennung verzichten – vorlesen lassen geht auch mit 70 MB.`
        : undefined,
  }
}

/** How many files of the recogniser lie in the Cache API. */
async function whisperFiles(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  let count = 0
  for (const name of await caches.keys()) {
    const cache = await caches.open(name)
    for (const request of await cache.keys()) {
      if (request.url.includes('whisper')) count++
    }
  }
  return count
}

/** What is already downloaded – the answer to "muss ich wieder warten?". */
export async function storedCheck(): Promise<Check> {
  const key = 'stored'
  const title = 'Schon heruntergeladen'
  const models = new ModelStore(opfsStore('models'))
  const voice = VOICES[0]

  let hasVoice = false
  try {
    hasVoice = await voiceReady(models, voice.name)
  } catch {
    hasVoice = false
  }
  const whisper = await whisperFiles().catch(() => 0)

  const parts = [
    hasVoice ? `Stimme „${voice.label}" liegt hier` : `Stimme „${voice.label}" fehlt noch (${formatBytes(voice.bytes)})`,
    whisper > 0 ? `Spracherkennung liegt hier (${whisper} Dateien)` : 'Spracherkennung fehlt noch (rund 200 MB)',
  ]
  return {
    key,
    title,
    status: 'ok',
    detail: `${parts.join(' · ')}. Was hier liegt, wird nie wieder geladen – auch nicht ohne Netz.`,
  }
}

/* ---------------------------------------------------------------- ton, rechnen */

export function audioCheck(): Check {
  const key = 'audio'
  const title = 'Tonausgabe'
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    return { key, title, status: 'fail', detail: 'Dieser Browser hat keine Web Audio API – Vorlesen geht nicht.' }
  }

  let context: AudioContext
  let asked = true
  try {
    context = new Ctor({ sampleRate: 16000 })
  } catch {
    context = new Ctor()
    asked = false
  }
  const rate = context.sampleRate
  void context.close()

  return {
    key,
    title,
    status: 'ok',
    detail:
      asked && rate === 16000
        ? 'Der Browser nimmt jede Abtastrate an; die Spracherkennung bekommt ihre 16 000 Hz direkt.'
        : `Der Browser besteht auf ${rate} Hz. Die App rechnet die Aufnahme um – kostet einen Wimpernschlag, sonst nichts.`,
  }
}

export function recorderCheck(): Check {
  const key = 'recorder'
  const title = 'Mikrofon-Aufnahme'
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return {
      key,
      title,
      status: 'warn',
      detail: 'Dieser Browser kann nicht aufnehmen. Vorlesen lassen geht, die eigene Rolle prüfen nicht.',
      advice: 'Aufnahme braucht eine https-Adresse – über http gibt der Browser das Mikrofon nicht her.',
    }
  }
  const supported = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].filter(
    (type) => MediaRecorder.isTypeSupported(type),
  )
  if (supported.length === 0) {
    return {
      key,
      title,
      status: 'warn',
      detail: 'Der Browser nennt kein Aufnahmeformat, das er sicher beherrscht. Der Versuch unten zeigt, ob es trotzdem geht.',
    }
  }
  return {
    key,
    title,
    status: 'ok',
    detail: `Aufnehmen geht (${supported[0]}). Ob das Mikrofon wirklich etwas hört, zeigt erst der Versuch unten.`,
  }
}

/** The SIMD test module from wasm-feature-detect: 27 bytes that need v128. */
const SIMD_MODULE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])

export function wasmCheck(): Check {
  const key = 'wasm'
  const title = 'Rechenwerk (WebAssembly)'
  if (typeof WebAssembly === 'undefined') {
    return { key, title, status: 'fail', detail: 'Ohne WebAssembly läuft weder die Stimme noch die Erkennung.' }
  }
  const simd = WebAssembly.validate(SIMD_MODULE)
  const worker = typeof Worker !== 'undefined'
  return {
    key,
    title,
    status: worker ? 'ok' : 'fail',
    detail: worker
      ? `WebAssembly ist da${simd ? ', mit SIMD – das ist die schnelle Fassung' : ' (ohne SIMD, also gemächlicher)'}. Eigener Rechenthread: ja.`
      : 'WebAssembly ist da, aber der Browser gibt keinen eigenen Rechenthread her – die Seite würde beim Vorlesen einfrieren.',
  }
}

/* ------------------------------------------------------------------- marke */

/** The note that outlives a session. */
export interface Marker {
  /** First visit this note has seen, ISO. */
  first: string
  /** Previous visit, ISO. */
  last: string
  visits: number
  /** Longest pause between two visits so far, in days. */
  maxGap: number
  /** navigator.storage.estimate().usage at that visit. */
  used: number
}

export interface MarkerState {
  opfs: Marker | null
  local: Marker | null
}

const MARKER_FILE = 'marke.json'
const MARKER_KEY = 'theater-marke'

function parseMarker(text: string | null): Marker | null {
  if (!text) return null
  try {
    const raw = JSON.parse(text) as Partial<Marker>
    if (!raw?.first || !raw?.last) return null
    return {
      first: String(raw.first),
      last: String(raw.last),
      visits: Number(raw.visits) || 1,
      maxGap: Number(raw.maxGap) || 0,
      used: Number(raw.used) || 0,
    }
  } catch {
    return null
  }
}

export async function readMarker(): Promise<MarkerState> {
  let opfs: Marker | null = null
  try {
    const bytes = await opfsStore('diagnose').read(MARKER_FILE)
    opfs = parseMarker(bytes ? new TextDecoder().decode(bytes) : null)
  } catch {
    opfs = null
  }
  let local: Marker | null = null
  try {
    local = parseMarker(window.localStorage.getItem(MARKER_KEY))
  } catch {
    local = null
  }
  return { opfs, local }
}

/** The note as it should look after this visit. */
export function nextMarker(before: MarkerState, now: Date, used: number): Marker {
  const known = before.opfs ?? before.local
  const stamp = now.toISOString()
  if (!known) return { first: stamp, last: stamp, visits: 1, maxGap: 0, used }
  return {
    first: known.first,
    last: stamp,
    visits: known.visits + 1,
    maxGap: Math.max(known.maxGap, daysApart(known.last, now)),
    used,
  }
}

let touched: Promise<MarkerState> | null = null

/**
 * Reads the note, writes it forward, and hands back what it said before.
 *
 * Called once when the app starts, so the count says "opened the app" and not
 * "opened this page". Every later caller in the same session gets the same
 * answer – otherwise the diagnosis would compare this visit with itself.
 */
export function touchMarker(): Promise<MarkerState> {
  if (touched) return touched
  touched = (async () => {
    const before = await readMarker()
    const { used } = await storageState().catch(() => ({ used: 0, quota: 0, persisted: false }))
    const next = JSON.stringify(nextMarker(before, new Date(), used))
    try {
      await opfsStore('diagnose').write(MARKER_FILE, new TextEncoder().encode(next))
    } catch {
      // no OPFS – then the check below reports exactly that
    }
    try {
      window.localStorage.setItem(MARKER_KEY, next)
    } catch {
      // private mode, or storage full
    }
    return before
  })()
  return touched
}

/**
 * What the note says about the long run.
 *
 * The interesting case is the third one: a note that was there and is gone
 * means the browser cleared this origin – which is exactly the thing that
 * cannot be seen in a single session.
 */
export function markerCheck(before: MarkerState, now: Date, used: number): Check {
  const key = 'marker'
  const title = 'Langzeit-Marke'
  const known = before.opfs ?? before.local

  if (!known) {
    return {
      key,
      title,
      status: 'ok',
      detail:
        'Eben gesetzt. Ab jetzt hält diese Seite fest, wie lange die Daten unangetastet liegen bleiben – die Antwort auf „hält das auch nächste Woche noch" steht beim nächsten Besuch hier.',
    }
  }

  const since = daysApart(known.last, now)
  const age = daysApart(known.first, now)
  const gap = Math.max(known.maxGap, since)
  const history = `Erster Besuch vor ${days(age)} (${date(known.first)}), ${known.visits + 1}. Besuch gerade. Längste Pause bisher: ${day(gap)}.`

  if (!before.opfs && before.local) {
    return {
      key,
      title,
      status: 'fail',
      detail: `Der Dateispeicher war leer, die kleine Notiz nicht: Der Browser hat die Stücke gelöscht, zuletzt gesehen am ${date(known.last)}. ${history}`,
      advice: 'Genau dafür gibt es die Sicherungskopie. Danach: App auf den Home-Bildschirm und dauerhaften Speicher anfordern.',
    }
  }
  if (before.opfs && !before.local) {
    return {
      key,
      title,
      status: 'warn',
      detail: `Die kleine Notiz war weg, der Dateispeicher steht noch. ${history}`,
      advice: 'Halb aufgeräumt heißt: der Browser räumt hier grundsätzlich auf. Sicherungskopien nicht vergessen.',
    }
  }

  // Ein gelöschtes Stück lässt den Platzbedarf auch fallen; das ist kein
  // Datenverlust. Verdächtig wird es erst, wenn nicht einmal mehr die Stimme
  // da ist – und die allein wiegt 63 MB.
  const shrunk = known.used > 50 * MB && used < 20 * MB
  if (shrunk) {
    return {
      key,
      title,
      status: 'warn',
      detail: `Beim letzten Besuch lagen hier ${formatBytes(known.used)}, jetzt sind es ${formatBytes(used)}. Da hat etwas aufgeräumt. ${history}`,
      advice: 'Nachsehen, ob die Stücke noch da sind – und die Sicherungskopien prüfen.',
    }
  }

  return {
    key,
    title,
    status: 'ok',
    detail:
      since === 0
        ? `Alles unverändert da. ${history}`
        : `${day(since)} nicht hier gewesen – alles noch da. ${history}`,
  }
}

/* ------------------------------------------------------------------ bericht */

/** The whole report as text, for pasting into a message. */
export function reportText(checks: Check[], now = new Date()): string {
  const zeichen: Record<CheckStatus, string> = { ok: '[ok]', warn: '[!]', fail: '[X]' }
  const lines = [
    `Theater-Vorleser · Technik-Prüfung · ${now.toLocaleString('de-DE')}`,
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    '',
  ]
  for (const check of checks) {
    lines.push(`${zeichen[check.status]} ${check.title}: ${check.detail}`)
    if (check.advice) lines.push(`      → ${check.advice}`)
  }
  return lines.filter((line) => line !== undefined).join('\n')
}

/** One sentence over the whole list. */
export function summary(checks: Check[]): { status: CheckStatus; text: string } {
  const fails = checks.filter((c) => c.status === 'fail').length
  const warns = checks.filter((c) => c.status === 'warn').length
  if (fails > 0) {
    return {
      status: 'fail',
      text: `${fails === 1 ? 'Ein Punkt geht' : `${fails} Punkte gehen`} auf diesem Gerät nicht. Was dann noch fehlt, steht unten in Rot.`,
    }
  }
  if (warns > 0) {
    return {
      status: 'warn',
      text: `Alles Nötige geht. ${warns === 1 ? 'Ein Punkt wäre' : `${warns} Punkte wären`} noch zu verbessern, damit es auch auf Dauer hält.`,
    }
  }
  return { status: 'ok', text: 'Dieses Gerät kann alles, was die App braucht – und behält es auch.' }
}
