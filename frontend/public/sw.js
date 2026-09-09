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
 *   alles andere    erst Zwischenspeicher, dann Netz. Die Dateinamen tragen
 *                   einen Hash, eine alte Antwort kann also nicht veralten.
 *
 * Nicht angefasst wird, was von fremden Adressen kommt: die Stimme liegt in
 * OPFS, das Whisper-Modell im Cache von transformers.js. Beide sind größer als
 * alles hier und haben ihre eigene Verwaltung.
 */

const CACHE = 'theater-v1'

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
  event.respondWith(cacheFirst(request))
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

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  await put(request, response)
  return response
}

async function put(request, response) {
  // Teilantworten (206) darf der Cache nicht aufnehmen, und fremde
  // Fehlermeldungen sollen nicht als gültige Antwort hängenbleiben.
  if (!response.ok || response.status === 206) return
  const cache = await caches.open(CACHE)
  await cache.put(request, response.clone())
}
