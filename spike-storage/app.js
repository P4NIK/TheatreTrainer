/* Speicher-Spike: gehört der Block-Zwischenspeicher in den Browser oder ans
 * Backend?
 *
 * Der Vergleich ist bewusst schief. Das Backend hat eine Festplatte – dort ist
 * Kapazität keine Frage, sondern gegeben. Zu klären ist deshalb nur, ob OPFS
 * *reicht*: schnell genug für 1400 Blöcke, groß genug für ein halbes Jahr
 * Proben, und verlässlich genug, dass nichts still verschwindet. Der
 * HTTP-Abschnitt liefert dazu nur eine Größenordnung, kein Wettrennen – der
 * Messserver ist Python, das echte Backend wäre Go.
 */

const $ = (id) => document.getElementById(id)

/* Ein Block der App: rund 180 kB, also gut vier Sekunden bei 22,05 kHz
 * 16 Bit Mono. Ein abendfüllendes Stück sind ~1400 davon, ~250 MB. */
const BLOCK_BYTES = 180 * 1024
const FULL_PLAY_BLOCKS = 1400

const state = { worker: null, nextId: 1, payload: null }

function log(message, cls) {
  const el = $('log')
  const line = document.createElement('div')
  if (cls) line.className = cls
  line.textContent = `[${new Date().toLocaleTimeString('de-DE')}] ${message}`
  el.appendChild(line)
  el.scrollTop = el.scrollHeight
}

const fail = (error) => {
  console.error(error)
  log((error && error.message) || String(error), 'err')
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`
const rate = (bytes, ms) => `${(bytes / 1048576 / (ms / 1000)).toFixed(0)} MB/s`

/** Bytes, die sich nicht wegkomprimieren lassen – sonst misst man den Trick. */
function makePayload(bytes) {
  const out = new Uint8Array(bytes)
  let seed = 12345
  for (let i = 0; i < bytes; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = seed & 0xff
  }
  return out
}

function callWorker(op, extra = {}) {
  return new Promise((resolve, reject) => {
    const id = state.nextId++
    const onMessage = (event) => {
      if (event.data.id !== id) return
      state.worker.removeEventListener('message', onMessage)
      event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error))
    }
    state.worker.addEventListener('message', onMessage)
    state.worker.postMessage({ id, op, ...extra })
  })
}

/* ------------------------------------------------------------- Umgebung */

async function showEnvironment() {
  const rows = []
  const supported = 'storage' in navigator && 'getDirectory' in (navigator.storage || {})
  rows.push(['OPFS', supported ? 'vorhanden' : 'FEHLT'])

  let estimate = { quota: 0, usage: 0 }
  if (navigator.storage?.estimate) estimate = await navigator.storage.estimate()
  rows.push(['Kontingent', estimate.quota ? mb(estimate.quota) : 'unbekannt'])
  rows.push(['davon belegt', mb(estimate.usage || 0)])

  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false
  rows.push(['dauerhaft', persisted ? 'ja' : 'nein – kann geräumt werden'])

  // Ob es syncAccessHandle gibt, sagt keine Eigenschaft: es muss im Worker
  // probiert werden.
  let sync = 'nicht geprüft'
  try {
    await callWorker('sweep')
    sync = 'ja'
  } catch (e) {
    sync = `nein (${e.message})`
  }
  rows.push(['createSyncAccessHandle', sync])
  rows.push(['Browser', navigator.userAgent.replace(/^Mozilla\/5\.0 /, '')])

  $('env').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')

  if (estimate.quota) {
    const plays = estimate.quota / (FULL_PLAY_BLOCKS * BLOCK_BYTES)
    log(`Gemeldetes Kontingent entspricht ${plays.toFixed(1)} Stück à ${
      mb(FULL_PLAY_BLOCKS * BLOCK_BYTES)} – aber die Zahl bindet nicht, ` +
      'siehe Belastungstest.')
  }
  if (estimate.usage > estimate.quota) {
    log(`Belegt (${mb(estimate.usage)}) liegt über dem gemeldeten Kontingent (${
      mb(estimate.quota)}). estimate().quota ist ein Hinweis, keine Grenze.`, 'warn')
  }
}

async function requestPersist() {
  try {
    const granted = await navigator.storage.persist()
    log(granted
      ? 'Dauerhafte Speicherung gewährt – der Browser räumt den Zwischenspeicher nicht mehr von sich aus weg.'
      : 'Dauerhafte Speicherung abgelehnt. Der Zwischenspeicher kann bei Platznot geräumt werden.',
      granted ? 'ok' : 'warn')
    await showEnvironment()
  } catch (e) {
    fail(e)
  }
}

/* ------------------------------------------------------------ OPFS-Lauf */

/** Der langsame Weg: createWritable(), der einzige im Hauptthread. */
async function writeMainThread(count, payload) {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle('spike-cache-main', { create: true })
  const started = performance.now()
  for (let i = 0; i < count; i++) {
    const file = await dir.getFileHandle(`block-${i}.wav`, { create: true })
    const writable = await file.createWritable()
    await writable.write(payload)
    await writable.close()
  }
  const ms = performance.now() - started

  for await (const name of dir.keys()) await dir.removeEntry(name)
  return ms
}

async function runOpfs() {
  const count = Number($('blocks').value)
  const bytes = count * BLOCK_BYTES
  $('runOpfs').disabled = true
  try {
    log(`OPFS: ${count} Blöcke à ${mb(BLOCK_BYTES)} = ${mb(bytes)} …`)

    const write = await callWorker('write', { count, payload: state.payload })
    const read = await callWorker('read', { count, payload: state.payload })
    const sweep = await callWorker('sweep')

    // Zum Vergleich derselbe Weg im Hauptthread, aber nur mit einer Handvoll
    // Blöcken – er ist zu langsam, um ihn über die volle Menge zu fahren.
    const sample = Math.min(count, 25)
    const mainMs = await writeMainThread(sample, state.payload)

    const sorted = [...write.perBlock].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]
    const slowest = sorted[sorted.length - 1]

    $('opfsBox').style.display = ''
    $('opfsResult').innerHTML = [
      ['Geschrieben', `${mb(write.written)} in ${(write.ms / 1000).toFixed(2)} s`],
      ['Schreibrate', rate(write.written, write.ms)],
      ['je Block (Median)', `${median.toFixed(1)} ms`],
      ['langsamster Block', `${slowest.toFixed(1)} ms`],
      ['Gelesen', `${mb(read.read)} in ${(read.ms / 1000).toFixed(2)} s`],
      ['Leserate', rate(read.read, read.ms)],
      ['Unversehrt', read.corrupt === 0 ? 'alle Blöcke' : `${read.corrupt} beschädigt!`],
      ['Aufräumen', `${sweep.count} Dateien: ${sweep.listMs.toFixed(0)} ms auflisten, ${
        sweep.deleteMs.toFixed(0)} ms löschen`],
      ['Hauptthread', `${(mainMs / sample).toFixed(1)} ms je Block (${sample} Blöcke) – Faktor ${
        (mainMs / sample / median).toFixed(1)} langsamer`],
      ['hochgerechnet', `${FULL_PLAY_BLOCKS} Blöcke ≈ ${
        ((median * FULL_PLAY_BLOCKS) / 1000).toFixed(1)} s Schreibzeit`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')

    log(`OPFS fertig: ${rate(write.written, write.ms)} schreiben, ${
      rate(read.read, read.ms)} lesen, ${read.corrupt} beschädigt.`,
      read.corrupt ? 'err' : 'ok')
    await showEnvironment()
  } catch (e) {
    fail(e)
  } finally {
    $('runOpfs').disabled = false
  }
}

/* -------------------------------------------------------- Belastungstest */

/** Schreibt in Schüben weiter, bis das Ziel erreicht ist oder es klemmt. */
async function runFill() {
  const targetMb = Number($('target').value)
  const perBatch = 200
  $('runFill').disabled = true
  try {
    log(`Belastungstest: schreibe bis ${targetMb} MB oder bis es klemmt …`)
    let written = 0
    let batch = 0
    const started = performance.now()

    while (written < targetMb * 1048576) {
      try {
        const result = await callWorker('write', {
          count: perBatch, payload: state.payload, offset: batch * perBatch,
        })
        written += result.written
        batch++
        const estimate = await navigator.storage.estimate()
        $('fillInfo').textContent =
          `${mb(written)} geschrieben, Browser meldet ${mb(estimate.usage || 0)} belegt von ${
            mb(estimate.quota || 0)}`
        await new Promise((r) => setTimeout(r, 0))
      } catch (e) {
        log(`Bei ${mb(written)} abgebrochen: ${e.message}`, 'warn')
        break
      }
    }

    const seconds = (performance.now() - started) / 1000
    const estimate = await navigator.storage.estimate()
    $('fillBox').style.display = ''
    $('fillResult').innerHTML = [
      ['Geschrieben', `${mb(written)} in ${seconds.toFixed(1)} s`],
      ['Durchsatz', rate(written, seconds * 1000)],
      ['Schübe', `${batch} × ${perBatch} Blöcke`],
      ['Browser meldet belegt', mb(estimate.usage || 0)],
      ['Kontingent', mb(estimate.quota || 0)],
      ['Ziel erreicht', written >= targetMb * 1048576 ? 'ja' : 'NEIN – vorher abgebrochen'],
      ['entspricht', `${(written / (FULL_PLAY_BLOCKS * BLOCK_BYTES)).toFixed(1)} Stücken`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')

    const sweep = await callWorker('sweep')
    log(`Aufgeräumt: ${sweep.count} Dateien in ${(sweep.deleteMs / 1000).toFixed(1)} s.`, 'ok')
    await showEnvironment()
  } catch (e) {
    fail(e)
  } finally {
    $('runFill').disabled = false
  }
}

/* ------------------------------------------------------------ HTTP-Weg */

async function runHttp() {
  const count = Number($('httpBlocks').value)
  $('runHttp').disabled = true
  try {
    log(`HTTP: ${count} Blöcke zum Server und zurück …`)
    const body = state.payload

    // Ein "Failed to fetch" sagt nichts. Wo es passiert ist und was der Server
    // geantwortet hat, schon.
    const put = async (i) => {
      try {
        const res = await fetch(`/spike-api/blobs/block-${i}.wav`, { method: 'PUT', body })
        if (!res.ok) throw new Error(`Server antwortete ${res.status} ${res.statusText}`)
      } catch (e) {
        throw new Error(`PUT von Block ${i} von ${count} fehlgeschlagen: ${e.message}. ` +
          'Läuft serve.py noch? Im Serverfenster steht der Grund.')
      }
    }

    const t0 = performance.now()
    for (let i = 0; i < count; i++) await put(i)
    const writeMs = performance.now() - t0

    const t1 = performance.now()
    let read = 0
    for (let i = 0; i < count; i++) {
      try {
        const res = await fetch(`/spike-api/blobs/block-${i}.wav`)
        if (!res.ok) throw new Error(`Server antwortete ${res.status} ${res.statusText}`)
        read += (await res.arrayBuffer()).byteLength
      } catch (e) {
        throw new Error(`GET von Block ${i} von ${count} fehlgeschlagen: ${e.message}`)
      }
    }
    const readMs = performance.now() - t1

    await fetch('/spike-api/blobs', { method: 'DELETE' })

    const bytes = count * BLOCK_BYTES
    $('httpBox').style.display = ''
    $('httpResult').innerHTML = [
      ['Hochgeladen', `${mb(bytes)} in ${(writeMs / 1000).toFixed(2)} s`],
      ['Schreibrate', rate(bytes, writeMs)],
      ['je Block', `${(writeMs / count).toFixed(1)} ms`],
      ['Gelesen', `${mb(read)} in ${(readMs / 1000).toFixed(2)} s`],
      ['Leserate', rate(read, readMs)],
      ['hochgerechnet', `${FULL_PLAY_BLOCKS} Blöcke ≈ ${
        ((writeMs / count) * FULL_PLAY_BLOCKS / 1000).toFixed(1)} s Uploadzeit`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')

    log(`HTTP fertig: ${(writeMs / count).toFixed(1)} ms je Block hoch, ${
      (readMs / count).toFixed(1)} ms runter.`, 'ok')
  } catch (e) {
    fail(e)
  } finally {
    $('runHttp').disabled = false
  }
}

/* ---------------------------------------------------------------- Start */

window.addEventListener('DOMContentLoaded', async () => {
  state.payload = makePayload(BLOCK_BYTES)
  state.worker = new Worker('opfs-worker.js')
  state.worker.onerror = (e) => fail(new Error(`Worker: ${e.message}`))

  $('persist').onclick = requestPersist
  $('runOpfs').onclick = runOpfs
  $('runFill').onclick = runFill
  $('runHttp').onclick = runHttp
  for (const [id, out] of [['blocks', 'blocksOut'], ['target', 'targetOut'],
                           ['httpBlocks', 'httpBlocksOut']]) {
    const el = $(id)
    const set = () => { $(out).textContent = el.value }
    el.addEventListener('input', set)
    set()
  }

  try {
    await showEnvironment()
  } catch (e) {
    fail(e)
  }

  // Für die Testautomatisierung.
  window.__spike = { runOpfs, runFill, runHttp, showEnvironment, callWorker, BLOCK_BYTES }
})
