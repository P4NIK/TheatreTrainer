/* Whisper-WASM-Spike fuer Theater-Vorleser.
 *
 * Die Frage ist nicht "erkennt Whisper Deutsch" - das tut es. Die Frage ist,
 * welches Modell fuer den Lernmodus reicht: dort wird nicht transkribiert,
 * sondern verglichen, ob die Replik sass. Gemessen wird deshalb nicht die
 * Wortfehlerrate, sondern genau die Metrik der App - compare.js ist aus
 * frontend/src/lib/compare.ts erzeugt.
 *
 * Alles bewusst ohne Framework und ohne Build-Schritt.
 */

import { pipeline, env } from './vendor/transformers.web.min.js'
import { compareSpoken } from './compare.js'

const VENDOR = new URL('vendor/', document.baseURI).href

env.allowLocalModels = false
env.backends.onnx.wasm.wasmPaths = VENDOR

const $ = (id) => document.getElementById(id)

const state = {
  transcriber: null,
  modelId: null,
  device: null,
  dtype: null,
  loadMs: 0,
  loadBytes: 0,
  samples: [],
  recorder: null,
  recordingFor: null,
}

/* ------------------------------------------------------------------ Log */

function log(msg, cls) {
  const el = $('log')
  const line = document.createElement('div')
  if (cls) line.className = cls
  line.textContent = `[${new Date().toLocaleTimeString('de-DE')}] ${msg}`
  el.appendChild(line)
  el.scrollTop = el.scrollHeight
}

function fail(err) {
  console.error(err)
  const msg = (err && err.message) || String(err)
  log(msg, 'err')

  // Zwei Fehler sehen sich zum Verwechseln aehnlich und haben nichts
  // miteinander zu tun: eine fehlende onnxruntime-Datei in vendor/ und ein
  // fehlgeschlagener Modell-Download. Wer sie verwechselt, sucht lange.
  const wasmFile = msg.match(/(ort-wasm[\w.-]*\.(?:mjs|wasm))/)
  if (wasmFile || /no available backend/i.test(msg)) {
    log(`onnxruntime findet ${wasmFile ? wasmFile[1] : 'eine seiner WASM-Dateien'} nicht ` +
        'in vendor/. Das ist kein Modell-Problem. Welche Variante gebraucht wird, ' +
        'entscheidet die ort-Version selbst - fetch-vendor.sh neu laufen lassen.', 'warn')
    return
  }
  if (/Can't create a session|MatMulNBits|Missing required scale|INVALID_PROTOBUF/i.test(msg)) {
    log('Die Dateien wurden geladen, aber onnxruntime kann daraus keine Sitzung bauen: ' +
        'dieses Modell hat die gewaehlte dtype-Variante nicht (oder nicht in einer Form, ' +
        'die geladen werden kann). Mit "Varianten anzeigen" nachsehen, was das Repository ' +
        'wirklich enthaelt, statt zu raten.', 'warn')
    return
  }
  if (/fetch|network|404|403/i.test(msg)) {
    log('Sieht nach einem fehlgeschlagenen Modell-Download aus. Modell-ID richtig ' +
        'geschrieben? Netzzugang zu huggingface.co vorhanden? Bei aktivem COOP/COEP ' +
        'notfalls mit "serve.py --no-coi" gegenpruefen.', 'warn')
  }
}

const ms = (v) => `${v.toFixed(0)} ms`
const mb = (v) => `${(v / 1048576).toFixed(1)} MB`
const pct = (v) => `${Math.round(v * 100)} %`

/* -------------------------------------------------------------- Umgebung */

async function showEnvironment() {
  const isolated = self.crossOriginIsolated === true
  let gpu = 'nicht vorhanden'
  if ('gpu' in navigator) {
    gpu = 'vorhanden'
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        const info = adapter.info || {}
        gpu = [info.vendor, info.architecture, info.description]
          .filter(Boolean).join(' ') || 'Adapter da, keine Angaben'
      } else {
        gpu = 'kein Adapter'
      }
    } catch (e) {
      gpu = `Adapter-Abfrage fehlgeschlagen: ${e.message}`
    }
  }

  const rows = [
    ['crossOriginIsolated', isolated ? 'ja - WASM-Threads moeglich'
                                     : 'nein - onnxruntime laeuft einthreadig'],
    ['hardwareConcurrency', String(navigator.hardwareConcurrency || '?')],
    ['WebGPU', gpu],
    ['transformers.js', env.version || '?'],
    ['Mikrofon', navigator.mediaDevices ? 'API vorhanden' : 'nicht verfuegbar'],
  ]
  $('env').innerHTML = rows
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')

  const t = $('threads')
  const max = navigator.hardwareConcurrency || 4
  t.max = String(isolated ? max : 1)
  t.value = String(isolated ? Math.min(4, max) : 1)
  t.disabled = !isolated
  $('threadsOut').textContent = t.value

  if (!('gpu' in navigator)) {
    const opt = $('device').querySelector('option[value=webgpu]')
    if (opt) opt.disabled = true
    log('Kein WebGPU in diesem Browser - es bleibt bei WASM auf der CPU.', 'warn')
  }
}

/* ------------------------------------------------------------ Audio */

/* Whisper will 16 kHz Mono als Float32. decodeAudioData rechnet in einem
 * AudioContext mit 16 kHz gleich mit um; wo das ein Browser nicht tut, macht
 * es der OfflineAudioContext hinterher. */
async function toMono16k(arrayBuffer) {
  const ac = new AudioContext({ sampleRate: 16000 })
  let decoded
  try {
    decoded = await ac.decodeAudioData(arrayBuffer)
  } finally {
    ac.close()
  }

  if (decoded.sampleRate !== 16000) {
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
    const src = off.createBufferSource()
    src.buffer = decoded
    src.connect(off.destination)
    src.start()
    decoded = await off.startRendering()
  }

  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0)

  const out = new Float32Array(decoded.length)
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c)
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / decoded.numberOfChannels
  }
  return out
}

function wavBlob(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  str(36, 'data'); view.setUint32(40, samples.length * 2, true)
  let at = 44
  for (let i = 0; i < samples.length; i++, at += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(at, s < 0 ? s * 32768 : s * 32767, true)
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/* ------------------------------------------------- Aufnahmen aufbewahren */

/* Sieben Repliken einzusprechen dauert eine Minute. Sie beim Neuladen zu
 * verlieren - und genau das passiert beim Modellwechsel gern - waere die
 * teuerste Kleinigkeit dieses Spikes. Also in die IndexedDB damit. */
const DB_NAME = 'theater-spike-whisper'
const STORE = 'recordings'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req && req.result)
    t.onerror = () => reject(t.error)
  })
}

async function saveRecording(file, blob) {
  try {
    const db = await openDb()
    await tx(db, 'readwrite', (st) => st.put(blob, file))
    db.close()
  } catch (e) {
    log(`Aufnahme konnte nicht gesichert werden: ${e.message}`, 'warn')
  }
}

async function restoreRecordings() {
  try {
    const db = await openDb()
    let restored = 0
    for (const s of state.samples) {
      const blob = await tx(db, 'readonly', (st) => st.get(s.file))
      if (blob) { s.own = blob; s.source = 'eigen'; s.audio = null; restored++ }
    }
    db.close()
    if (restored) {
      renderSamples()
      log(`${restored} eigene Aufnahme(n) aus der letzten Sitzung wiederhergestellt.`, 'ok')
    }
  } catch (e) {
    log(`Aufnahmen konnten nicht gelesen werden: ${e.message}`, 'warn')
  }
}

async function forgetRecordings() {
  try {
    const db = await openDb()
    await tx(db, 'readwrite', (st) => st.clear())
    db.close()
    for (const s of state.samples) { s.own = null; s.audio = null; s.source = 'piper' }
    renderSamples()
    log('Alle eigenen Aufnahmen verworfen.', 'ok')
  } catch (e) {
    fail(e)
  }
}

/* ------------------------------------------------------------- Repliken */

async function loadSamples() {
  const data = await (await fetch('samples/index.json')).json()
  state.samples = data.samples.map((s, i) => ({
    ...s, index: i, audio: null, source: 'piper', own: null,
  }))
  renderSamples()
  log(`${state.samples.length} Repliken geladen (mit Piper erzeugt, ${
    data.samples.reduce((a, s) => a + s.seconds, 0).toFixed(1)} s gesamt)`)
}

function renderSamples() {
  const tb = $('samples')
  tb.innerHTML = ''
  for (const s of state.samples) {
    const tr = document.createElement('tr')
    tr.innerHTML =
      `<td>${s.index + 1}</td>` +
      `<td class="txt">${s.text}</td>` +
      `<td class="num">${s.words}</td>` +
      `<td><span class="tag ${s.source === 'eigen' ? 'own' : ''}">${
        s.source === 'eigen' ? 'eigene Aufnahme' : 'Piper'}</span></td>` +
      `<td class="acts"></td>`
    const acts = tr.querySelector('.acts')

    const play = document.createElement('button')
    play.className = 'mini'; play.textContent = '▶'
    play.title = 'anhoeren'
    play.onclick = () => playSample(s)
    acts.appendChild(play)

    const rec = document.createElement('button')
    rec.className = 'mini'
    rec.textContent = state.recordingFor === s.index ? '■' : '●'
    rec.title = 'selbst einsprechen'
    rec.onclick = () => (state.recordingFor === s.index ? stopRecording() : startRecording(s))
    acts.appendChild(rec)

    if (s.source === 'eigen') {
      const undo = document.createElement('button')
      undo.className = 'mini'; undo.textContent = '↺'
      undo.title = 'zurueck zur Piper-Aufnahme'
      undo.onclick = async () => {
        s.source = 'piper'; s.audio = null; s.own = null
        renderSamples()
        try { const db = await openDb(); await tx(db, 'readwrite', (st) => st.delete(s.file)); db.close() } catch { /* egal */ }
      }
      acts.appendChild(undo)
    }
    tb.appendChild(tr)
  }
}

async function playSample(s) {
  const audio = $('player')
  if (s.source === 'eigen' && s.own) audio.src = URL.createObjectURL(s.own)
  else audio.src = `samples/${s.file}`
  audio.play().catch(() => {})
}

/* Liefert die 16-kHz-Spur einer Replik und merkt sie sich, damit ein zweiter
 * Modelllauf nicht noch einmal dekodieren muss. */
async function audioOf(s) {
  if (s.audio) return s.audio
  const buf = s.source === 'eigen' && s.own
    ? await s.own.arrayBuffer()
    : await (await fetch(`samples/${s.file}`)).arrayBuffer()
  s.audio = await toMono16k(buf)
  return s.audio
}

/* ----------------------------------------------------------- Aufnahme */

async function startRecording(s) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      state.recordingFor = null
      state.recorder = null
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      s.own = blob
      s.audio = null
      s.source = 'eigen'
      renderSamples()
      await saveRecording(s.file, blob)
      log(`Replik ${s.index + 1} selbst eingesprochen (${(blob.size / 1024).toFixed(0)} kB, gesichert)`)
    }
    state.recorder = rec
    state.recordingFor = s.index
    renderSamples()
    rec.start()
    log(`Aufnahme laeuft fuer Replik ${s.index + 1} - noch einmal klicken zum Stoppen.`)
  } catch (e) {
    fail(e)
  }
}

function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop()
}

/* -------------------------------------------------------------- Modell */

function chosenDtype() {
  const v = $('dtype').value
  if (v !== 'hybrid') return v
  // Ein q8-Encoder verschluckt bei leisem oder gespieltem Sprechen Silben;
  // volle Genauigkeit im Encoder und ein kleiner Decoder ist der uebliche
  // Kompromiss.
  return { encoder_model: 'fp32', decoder_model_merged: 'q4' }
}

async function loadModel() {
  const modelId = $('model').value.trim()
  if (!modelId) {
    log('Kein Modell angegeben - oben eine Modell-ID eintragen oder aus den Vorschlaegen waehlen.', 'warn')
    return false
  }
  $('load').disabled = true
  // Das bisherige Modell bleibt stehen, bis das neue wirklich da ist - sonst
  // steht man nach einem fehlgeschlagenen dtype-Wechsel ohne alles da.
  const previous = { transcriber: state.transcriber, modelId: state.modelId,
                     device: state.device, dtype: state.dtype,
                     loadMs: state.loadMs, loadBytes: state.loadBytes }

  const device = $('device').value
  const dtype = chosenDtype()
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
    ? Number($('threads').value) || 1 : 1

  const seen = new Map()
  const t0 = performance.now()
  try {
    log(`Lade ${modelId} (${device}, dtype ${$('dtype').value}) …`)
    state.transcriber = await pipeline('automatic-speech-recognition', modelId, {
      device,
      dtype,
      progress_callback: (p) => {
        if (p.status === 'progress' && p.file) {
          seen.set(p.file, Math.max(seen.get(p.file) || 0, p.loaded || 0))
          $('loadInfo').textContent =
            `${p.file} – ${mb([...seen.values()].reduce((a, b) => a + b, 0))}`
        }
      },
    })
    state.loadMs = performance.now() - t0
    state.loadBytes = [...seen.values()].reduce((a, b) => a + b, 0)
    state.modelId = modelId
    state.device = device
    state.dtype = $('dtype').value

    $('loadInfo').textContent = state.loadBytes
      ? `${mb(state.loadBytes)} geladen in ${ms(state.loadMs)}`
      : `bereit in ${ms(state.loadMs)} (aus dem Browser-Cache)`
    log(`Bereit: ${modelId} auf ${device}, ${
      state.loadBytes ? mb(state.loadBytes) + ' geladen' : 'aus dem Cache'}, ${ms(state.loadMs)}`, 'ok')
    $('run').disabled = false
    $('bench').disabled = false
    setStatus(`${modelId} · ${device} · dtype ${state.dtype}`)
    return true
  } catch (e) {
    fail(e)
    Object.assign(state, previous)
    $('loadInfo').textContent = 'fehlgeschlagen'
    if (state.transcriber) {
      setStatus(`${state.modelId} · ${state.device} · dtype ${state.dtype} (unveraendert)`)
      log(`Das vorige Modell (${state.modelId}, dtype ${state.dtype}) bleibt geladen.`, 'warn')
      $('run').disabled = false
      $('bench').disabled = false
    } else {
      setStatus('kein Modell geladen')
    }
    return false
  } finally {
    $('load').disabled = false
  }
}

function setStatus(text) {
  for (const id of ['statusRun', 'statusBench']) {
    const el = $(id)
    if (el) el.textContent = text
  }
}

/* Der Knopf soll nie in einer Sackgasse enden: ist noch kein Modell da, wird
 * es hier geladen, statt den Nutzer raten zu lassen, warum nichts passiert.
 * (Der graue "Durchlauf"-Knopf ohne Begruendung war genau diese Sackgasse.) */
async function ensureModel() {
  if (state.transcriber) return true
  log('Noch kein Modell geladen - wird jetzt nachgeholt.')
  return loadModel()
}

/* ------------------------------------------------------------ Erkennen */

async function transcribe(audio) {
  const t0 = performance.now()
  const out = await state.transcriber(audio, {
    language: 'de',
    task: 'transcribe',
  })
  return { text: (out.text || '').trim(), inferMs: performance.now() - t0 }
}

function renderComparison(cmp, into) {
  const el = $(into)
  el.innerHTML = cmp.words.map((w) => {
    const label = w.state === 'missing' ? w.expected : (w.spoken ?? w.expected)
    const title = w.state === 'near' || w.state === 'wrong'
      ? ` title="im Buch: ${w.expected}"` : ''
    return `<span class="w ${w.state}"${title}>${label}</span>`
  }).join(' ')
}

async function runOnce() {
  $('run').disabled = true
  try {
    if (!(await ensureModel())) return
    const s = state.samples[Number($('pick').value)]
    const expected = $('expected').value.trim() || s.text
    const audio = await audioOf(s)
    const { text, inferMs } = await transcribe(audio)
    const cmp = compareSpoken(expected, text)

    $('heard').textContent = text || '(nichts verstanden)'
    renderComparison(cmp, 'comparison')
    $('single').style.display = ''
    const secs = audio.length / 16000
    $('singleStats').innerHTML =
      `<div><span>Trefferquote</span><b>${pct(cmp.score)}</b></div>` +
      `<div><span>woertlich</span><b>${cmp.hits} von ${cmp.expectedCount}</b></div>` +
      `<div><span>fast</span><b>${cmp.near}</b></div>` +
      `<div><span>Rechenzeit</span><b>${ms(inferMs)} fuer ${secs.toFixed(1)} s</b></div>` +
      `<div><span>Realtime-Faktor</span><b>${(secs / (inferMs / 1000)).toFixed(1)}×</b></div>`
    log(`Replik ${s.index + 1}: ${pct(cmp.score)} getroffen, ${ms(inferMs)}`, 'ok')
  } catch (e) {
    fail(e)
  } finally {
    $('run').disabled = false
  }
}

/* ------------------------------------------------------------- Durchlauf */

async function runBenchmark() {
  $('bench').disabled = true
  $('run').disabled = true
  $('results').innerHTML = ''
  try {
    if (!(await ensureModel())) return
    log('Aufwaermlauf …')
    await transcribe(await audioOf(state.samples[0]))

    let audioTotal = 0, inferTotal = 0, scoreTotal = 0, hits = 0, words = 0
    const allWords = []

    for (const s of state.samples) {
      const audio = await audioOf(s)
      const { text, inferMs } = await transcribe(audio)
      const cmp = compareSpoken(s.text, text)
      const secs = audio.length / 16000

      audioTotal += secs; inferTotal += inferMs
      scoreTotal += cmp.score; hits += cmp.hits; words += cmp.expectedCount
      allWords.push(...cmp.words)

      const tr = document.createElement('tr')
      tr.innerHTML =
        `<td>${s.index + 1}</td>` +
        `<td class="txt">${s.text.length > 40 ? s.text.slice(0, 40) + '…' : s.text}</td>` +
        `<td class="txt">${text || '—'}</td>` +
        `<td><span class="tag ${s.source === 'eigen' ? 'own' : ''}">${
          s.source === 'eigen' ? 'eigen' : 'Piper'}</span></td>` +
        `<td class="num">${pct(cmp.score)}</td>` +
        `<td class="num">${cmp.hits}/${cmp.expectedCount}</td>` +
        `<td class="num">${secs.toFixed(2)}</td>` +
        `<td class="num">${inferMs.toFixed(0)}</td>` +
        `<td class="num">${(secs / (inferMs / 1000)).toFixed(1)}×</td>`
      $('results').appendChild(tr)
      await new Promise((r) => setTimeout(r, 0))
    }

    const n = state.samples.length
    const own = state.samples.filter((s) => s.source === 'eigen').length
    $('summary').innerHTML =
      `<div><span>Modell</span><b>${state.modelId}</b></div>` +
      `<div><span>Backend</span><b>${state.device}, dtype ${state.dtype}${
        state.device === 'wasm' ? `, ${env.backends.onnx.wasm.numThreads} Thread(s)` : ''}</b></div>` +
      `<div><span>Download</span><b>${state.loadBytes ? mb(state.loadBytes) : 'aus Cache'} / ${ms(state.loadMs)}</b></div>` +
      `<div><span>Quelle</span><b>${own ? `${own} von ${n} selbst eingesprochen` : 'nur Piper-Stimme'}</b></div>` +
      `<div><span>ø Trefferquote</span><b>${pct(scoreTotal / n)}</b></div>` +
      `<div><span>woertlich</span><b>${hits} von ${words} Woertern</b></div>` +
      `<div><span>Rechenzeit</span><b>${(inferTotal / 1000).toFixed(1)} s fuer ${audioTotal.toFixed(1)} s Ton</b></div>` +
      `<div><span>Realtime-Faktor</span><b>${(audioTotal / (inferTotal / 1000)).toFixed(1)}×</b></div>` +
      `<div><span>je Replik</span><b>${(inferTotal / n / 1000).toFixed(2)} s</b></div>`
    $('summaryBox').style.display = ''
    renderErrorProfile(allWords)
    log(`Durchlauf fertig: ø ${pct(scoreTotal / n)} getroffen, ${
      (inferTotal / n / 1000).toFixed(2)} s je Replik`, 'ok')
    if (!own) {
      log('Achtung: Das war die Piper-Stimme - sauber, laut, ohne Raum. Die Zahl ist ' +
          'eine Obergrenze, kein Probenalltag. Fuer den echten Wert die Repliken selbst ' +
          'einsprechen (● in der Liste).', 'warn')
    }
  } catch (e) {
    fail(e)
  } finally {
    $('bench').disabled = false
    $('run').disabled = false
  }
}

/* -------------------------------------------------------- Selbsttest */

/* Genau ein Fehler hat diesen Spike zweimal ausgebremst: onnxruntime findet
 * seine WASM-Datei nicht, meldet aber "no available backend found" - und das
 * liest sich wie ein Modell-Problem. Der Selbsttest trennt die beiden Faelle
 * in zwei Sekunden, ohne dass ein Modell geladen werden muss. */
async function selfTest() {
  $('selftest').disabled = true
  try {
    const t0 = performance.now()
    const ort = await import('onnxruntime-web/webgpu')
    ort.env.wasm.wasmPaths = VENDOR
    const buf = await (await fetch('samples/_ort-selftest.onnx')).arrayBuffer()
    const session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] })
    const out = await session.run({
      a: new ort.Tensor('float32', Float32Array.from([1, 2]), [2]),
      b: new ort.Tensor('float32', Float32Array.from([10, 20]), [2]),
    })
    const got = Array.from(out.c.data)
    const ok = got[0] === 11 && got[1] === 22
    log(`onnxruntime laeuft: [1,2] + [10,20] = [${got}] in ${ms(performance.now() - t0)}${
      ok ? '' : ' - ERGEBNIS FALSCH'}`, ok ? 'ok' : 'err')
  } catch (e) {
    fail(e)
  } finally {
    $('selftest').disabled = false
  }
}

/* Ein Mittelwert von 77 % sagt nicht, ob die fehlenden 23 % aus Eigennamen,
 * Zahlwoertern oder verschluckten Fuellwoertern bestehen - und genau daran
 * haengt, ob das Modell fuer den Lernmodus taugt. Also aufschluesseln. */
function renderErrorProfile(allWords) {
  const total = allWords.length || 1
  const count = (st) => allWords.filter((w) => w.state === st).length
  const states = [
    ['ok', 'sitzt'], ['near', 'fast'], ['wrong', 'anders gesagt'],
    ['missing', 'nicht gehoert'], ['extra', 'zusaetzlich'],
  ]
  $('stateCounts').innerHTML = states.map(([st, label]) =>
    `<div><span class="w ${st}">${label}</span><b>${count(st)} · ${
      Math.round((count(st) / total) * 100)} %</b></div>`).join('')

  // Was das Modell nicht getroffen hat, nach Haeufigkeit - die kurze Liste
  // beantwortet die Frage "woran liegt es" schneller als jede Prozentzahl.
  const misses = new Map()
  for (const w of allWords) {
    if (w.state !== 'wrong' && w.state !== 'missing') continue
    const key = (w.expected || '').toLowerCase()
    if (!key) continue
    const entry = misses.get(key) || { expected: w.expected, n: 0, heard: new Set() }
    entry.n++
    if (w.spoken) entry.heard.add(w.spoken)
    misses.set(key, entry)
  }
  const rows = [...misses.values()].sort((a, b) => b.n - a.n).slice(0, 20)
  $('missList').innerHTML = rows.length
    ? rows.map((m) => `<tr><td class="txt">${m.expected}</td><td class="num">${m.n}</td>` +
        `<td class="txt">${[...m.heard].join(', ') || '— nichts gehoert —'}</td></tr>`).join('')
    : '<tr><td colspan="3" class="txt">Kein Wort daneben.</td></tr>'
  $('errorBox').style.display = ''
}

/* Welche dtype-Varianten es gibt, entscheidet allein das Repository. Drei
 * gescheiterte Ladeversuche mit identischer, nichtssagender Fehlermeldung sind
 * der Preis fuers Raten - die Dateiliste kostet einen Aufruf. */
async function fetchVariants(modelId) {
  const res = await fetch(`https://huggingface.co/api/models/${modelId}`)
  if (!res.ok) throw new Error(`HuggingFace antwortet mit ${res.status} fuer ${modelId}`)
  const data = await res.json()
  return (data.siblings || [])
    .map((f) => f.rfilename)
    .filter((f) => f.endsWith('.onnx') || f.endsWith('.onnx_data'))
}

/* Aus "onnx/decoder_model_merged_q4.onnx" wird die dtype-Angabe "q4"; die
 * Datei ohne Suffix ist fp32. */
function dtypeOf(file, base) {
  const name = file.replace(/^.*\//, '').replace(/\.onnx(_data)?$/, '')
  if (name === base) return 'fp32'
  return name.startsWith(base + '_') ? name.slice(base.length + 1) : null
}

async function showVariants() {
  const modelId = $('model').value.trim()
  if (!modelId) { log('Erst eine Modell-ID eintragen.', 'warn'); return }
  $('variants').disabled = true
  try {
    const files = await fetchVariants(modelId)
    renderVariants(modelId, files)
  } catch (e) {
    fail(e)
  } finally {
    $('variants').disabled = false
  }
}

function renderVariants(modelId, files) {
  const groups = ['encoder_model', 'decoder_model_merged']
  const rows = groups.map((base) => {
    const found = files
      .map((f) => dtypeOf(f, base))
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
    return `<div><span>${base}</span><b>${found.join(', ') || '– keine –'}</b></div>`
  })
  const other = files.filter((f) => !groups.some((g) => f.includes(g)))
  if (other.length) {
    rows.push(`<div><span>sonstige Dateien</span><b>${other.length}</b></div>`)
  }
  $('variantList').innerHTML = rows.join('')
  $('variantBox').style.display = ''
  log(`${modelId}: ${files.length} ONNX-Datei(en) im Repository.`, 'ok')
}

/* ---------------------------------------------------------------- Cache */

async function clearCache() {
  try {
    const names = await caches.keys()
    for (const n of names) await caches.delete(n)
    log(`Browser-Cache geleert (${names.length} Eintrag/Eintraege): ${names.join(', ') || '-'}`, 'ok')
  } catch (e) {
    fail(e)
  }
}

/* ---------------------------------------------------------------- Start */

function wireUp() {
  const t = $('threads')
  t.addEventListener('input', () => { $('threadsOut').textContent = t.value })
  $('load').onclick = loadModel
  $('run').onclick = runOnce
  $('bench').onclick = runBenchmark
  $('clear').onclick = clearCache
  $('forget').onclick = forgetRecordings
  $('selftest').onclick = selfTest
  $('variants').onclick = showVariants
  $('pick').onchange = () => {
    const s = state.samples[Number($('pick').value)]
    if (s) $('expected').value = s.text
  }
  $('preset').onchange = () => {
    if ($('preset').value) $('model').value = $('preset').value
  }
}

/* Test-Griff: der headless-Durchlauf prueft damit Audio-Aufbereitung und
 * Vergleich, ohne die Oberflaeche zu bedienen. Kostet nichts und schadet nicht. */
window.__spike = { state, toMono16k, audioOf, compareSpoken, transcribe,
                  saveRecording, restoreRecordings, forgetRecordings,
                  renderErrorProfile, renderVariants, dtypeOf }

window.addEventListener('DOMContentLoaded', async () => {
  wireUp()
  await showEnvironment()
  try {
    await loadSamples()
    await restoreRecordings()
    const pick = $('pick')
    pick.innerHTML = state.samples
      .map((s) => `<option value="${s.index}">${s.index + 1}. ${
        s.text.length > 40 ? s.text.slice(0, 40) + '…' : s.text}</option>`).join('')
    $('expected').value = state.samples[0].text
  } catch (e) {
    fail(e)
  }
})
