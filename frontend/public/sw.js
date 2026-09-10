/*
 * Der Service Worker: nach dem ersten Besuch läuft die Seite ohne Netz.
 *
 * Er liegt bewusst in public/ und geht nicht durch den Bundler – ein Service
 * Worker muss unter einer festen Adresse liegen, sonst gilt er nicht für die
 * ganze Seite.
 *
 * Es gibt keine Vorab-Liste. Sie wäre entweder falsch (die Dateinamen des
 * Builds enthalten einen Hash, den dieses Skript nicht kennt) oder teuer: die
 * WASM-Dateien sind zusammen 35 MB, und die beim ersten Besuch zu laden wäre
 * genau das Gegenteil dessen, was der stufenweise Aufbau erreichen soll.
 *
 * Stattdessen wird abgelegt, was ohnehin geholt wurde:
 *
 *   Seitenaufrufe   erst Netz, dann Zwischenspeicher. So kommt eine neue
 *                   Fassung an, und ohne Netz startet trotzdem die alte.
 *   assets/         erst Zwischenspeicher, dann Netz. Diese Dateinamen tragen
 *                   einen Hash, eine alte Antwort kann also nicht veralten.
 *   alles andere    Zwischenspeicher zuerst, aber im Hintergrund nachgeholt.
 *                   manifest.webmanifest, die Symbole und die WASM-Dateien
 *                   heißen immer gleich – einmal abgelegt, blieben sie sonst
 *                   für immer stehen. Das ist einmal teuer geworden: im
 *                   Manifest steht, unter welcher Adresse die App auf dem
 *                   Home-Bildschirm landet, und die alte Fassung zeigte auf
 *                   die falsche.
 *
 * Nicht angefasst wird, was von fremden Adressen kommt: die Stimme liegt in
 * OPFS, das Whisper-Modell im Cache von transformers.js. Beide sind größer als
 * alles hier und haben ihre eigene Verwaltung.
 */

// Der Name ist die Handhabe zum Aufräumen: Wer ihn ändert, wirft beim nächsten
// Start alles Alte weg – siehe das activate-Ereignis.
const CACHE = 'theater-v2'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  /*
   * Das Manifest nie aus dem Zwischenspeicher, solange Netz da ist.
   *
   * In ihm steht, unter welcher Adresse die App auf dem Home-Bildschirm
   * landet. Eine veraltete Kopie ist hier teurer als ein kurzer Umweg übers
   * Netz: Sie schickt jeden, der das Symbol antippt, an die falsche Stelle,
   * und das lässt sich von der Seite aus nicht mehr geradebiegen.
   */
  if (url.pathname.endsWith('.webmanifest')) {
    event.respondWith(freshFirst(request))
    return
  }
  // Alles unter assets/ hat einen Hash im Namen und ändert sich nie.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  event.respondWith(revalidate(event, request))
})

async function networkFirst(request) {
  try {
    const response = await fetch(request)
    await put(request, response)
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    // Eine gespeicherte Startseite tut es auch: die Adressen der Stücke sind
    // Zustand im Tab, keine eigenen Seiten. `scope` statt "/", damit es auch
    // in einem Unterordner stimmt.
    const start = await caches.match(self.registration.scope)
    if (start) return start
    throw error
  }
}

/** Netz zuerst, die abgelegte Kopie nur, wenn keins da ist. */
async function freshFirst(request) {
  try {
    const response = await fetch(request)
    await put(request, response)
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  await put(request, response)
  return response
}

/**
 * Die alte Antwort sofort, die neue für das nächste Mal.
 *
 * Für Dateien mit festem Namen. Nachgeladen wird im Hintergrund und über den
 * ganz normalen Zwischenspeicher des Browsers – bei 35 MB WASM sind das in der
 * Regel ein paar 304er und kein einziges Byte Nutzlast.
 */
async function revalidate(event, request) {
  const cached = await caches.match(request)
  const frisch = fetch(request)
    .then(async (response) => {
      await put(request, response)
      return response
    })
    .catch(() => null)

  if (!cached) {
    const response = await frisch
    if (response) return response
    throw new Error(`${request.url}: weder abgelegt noch erreichbar`)
  }

  // Ohne waitUntil darf der Browser den Worker beenden, sobald die Antwort
  // draußen ist – und dann käme die neue Fassung nie an.
  event.waitUntil(frisch)
  return cached
}

async function put(request, response) {
  // Teilantworten (206) darf der Cache nicht aufnehmen, und fremde
  // Fehlermeldungen sollen nicht als gültige Antwort hängenbleiben.
  if (!response.ok || response.status === 206) return
  const cache = await caches.open(CACHE)
  await cache.put(request, response.clone())
}
