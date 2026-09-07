/* Piper-WASM-Spike fuer Theater-Vorleser.
 *
 * Beantwortet drei Fragen, mehr nicht:
 *   1. Laeuft de_DE-thorsten-medium unveraendert im Browser?
 *   2. Lassen sich Sprecher-ID und Tempo (length_scale) dabei steuern?
 *   3. Wie schnell ist das, verglichen mit dem Go-Backend (1-3 s je Block)?
 *
 * Alles bewusst ohne Framework und ohne Build-Schritt.
 */

const VENDOR = 'vendor/';
const SENTENCE_SILENCE = 0.2; // s, wie Pipers Standard zwischen zwei Saetzen

const $ = (id) => document.getElementById(id);

const state = {
  phonemizer: null,
  session: null,
  config: null,
  voice: null,
  ep: 'wasm',
  threads: 1,
};

/* ------------------------------------------------------------------ Log */

function log(msg, cls) {
  const el = $('log');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  const t = new Date().toLocaleTimeString('de-DE');
  line.textContent = `[${t}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function fail(err) {
  console.error(err);
  log((err && err.message) || String(err), 'err');
}

const ms = (v) => `${v.toFixed(0)} ms`;
const mb = (v) => `${(v / 1048576).toFixed(1)} MB`;

/* -------------------------------------------------------------- Umgebung */

function showEnvironment() {
  const isolated = self.crossOriginIsolated === true;
  const rows = [
    ['crossOriginIsolated', isolated ? 'ja - WASM-Threads moeglich'
                                     : 'NEIN - onnxruntime laeuft einthreadig'],
    ['hardwareConcurrency', String(navigator.hardwareConcurrency || '?')],
    ['SharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined' ? 'ja' : 'nein'],
    ['WebGPU', 'gpu' in navigator ? 'vorhanden' : 'nicht vorhanden'],
    ['onnxruntime-web', (window.ort && ort.env && ort.env.versions
      ? ort.env.versions.common : '?')],
  ];
  $('env').innerHTML = rows
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join('');

  const t = $('threads');
  const max = navigator.hardwareConcurrency || 4;
  t.max = String(isolated ? max : 1);
  t.value = String(isolated ? Math.min(4, max) : 1);
  if (!isolated) {
    t.disabled = true;
    log('Ohne Cross-Origin-Isolation: Threads sind aus. Server mit COOP/COEP starten ' +
        '(serve.py tut das), sonst misst der Benchmark den Einthread-Fall.', 'warn');
  }
  $('threadsOut').textContent = t.value;

}

/* ------------------------------------------------------------- Stimmen */

async function loadVoiceList() {
  const res = await fetch('/spike-api/voices');
  const data = await res.json();
  if (data.error) throw new Error(`voices/ nicht lesbar: ${data.error}`);
  const sel = $('voice');
  sel.innerHTML = '';
  if (!data.voices.length) {
    throw new Error(`Keine Stimmen in ${data.dir} gefunden.`);
  }
  for (const v of data.voices) {
    const o = document.createElement('option');
    o.value = JSON.stringify(v);
    o.textContent = `${v.id}  (${mb(v.bytes)}${v.numSpeakers > 1 ? `, ${v.numSpeakers} Sprecher` : ''})`;
    sel.appendChild(o);
  }
  sel.onchange = onVoicePicked;
  onVoicePicked();
  log(`${data.voices.length} Stimme(n) gefunden in ${data.dir}`);
}

function onVoicePicked() {
  const v = JSON.parse($('voice').value);
  const multi = v.numSpeakers > 1;
  $('sidRow').style.display = multi ? '' : 'none';
  $('sid').max = String(Math.max(0, v.numSpeakers - 1));
  $('sidMax').textContent = `0 – ${v.numSpeakers - 1}`;
  $('run').disabled = true;
  $('bench').disabled = true;
  state.session = null;
  state.config = null;
}

/* -------------------------------------------------------- Phonemisierung */

let phonemeLines = [];

function loadPhonemizer() {
  if (state.phonemizer) return Promise.resolve(state.phonemizer);
  const t0 = performance.now();
  return createPiperPhonemize({
    print: (line) => phonemeLines.push(line),
    printErr: (line) => log(`espeak: ${line}`, 'warn'),
    locateFile: (f) => new URL(VENDOR + f, document.baseURI).href,
  }).then((mod) => {
    state.phonemizer = mod;
    log(`espeak-ng (piper_phonemize.wasm + 18 MB Daten) geladen in ${ms(performance.now() - t0)}`);
    return mod;
  });
}

/* Ruft das WASM-Kommando einmal fuer alle Saetze auf; es druckt pro Eintrag
 * eine JSON-Zeile mit phonemes, phoneme_ids und dem Originaltext. */
function phonemize(sentences, espeakVoice) {
  phonemeLines = [];
  state.phonemizer.callMain([
    '-l', espeakVoice,
    '--input', JSON.stringify(sentences.map((text) => ({ text }))),
    '--espeak_data', '/espeak-ng-data',
  ]);
  return phonemeLines.map((l) => JSON.parse(l));
}

/* Der Weg von Phonemen zu IDs, wie ihn Piper geht: BOS, PAD, dann jedes
 * Phonem gefolgt von PAD, am Ende EOS. Bewusst selbst gebaut und gegen die
 * IDs aus dem WASM geprueft - so faellt auf, wenn eine Stimme eine eigene
 * phoneme_id_map mitbringt. */
function sameIds(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function phonemesToIds(phonemes, map) {
  const pad = map['_'][0];
  const ids = [map['^'][0], pad];
  const missing = [];
  for (const p of phonemes) {
    const mapped = map[p];
    if (!mapped) { missing.push(p); continue; }
    for (const id of mapped) ids.push(id);
    ids.push(pad);
  }
  ids.push(map['$'][0]);
  return { ids, missing };
}

function splitSentences(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (!$('split').checked) return [clean];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('de', { granularity: 'sentence' });
    const out = [...seg.segment(clean)].map((s) => s.segment.trim()).filter(Boolean);
    if (out.length) return out;
  }
  return clean.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

/* -------------------------------------------------------------- Modell */

async function loadModel() {
  const v = JSON.parse($('voice').value);
  state.voice = v;
  $('load').disabled = true;
  try {
    await loadPhonemizer();

    const t0 = performance.now();
    state.config = await (await fetch(v.config)).json();
    applyModelDefaults(state.config);
    const buf = await (await fetch(v.onnx)).arrayBuffer();
    log(`Modell geladen: ${mb(buf.byteLength)} in ${ms(performance.now() - t0)}`);

    state.ep = $('ep').value;
    state.threads = Number($('threads').value) || 1;
    // Absolute URL noetig: onnxruntime importiert die .mjs dynamisch,
    // und ein relativer Pfad ist kein gueltiger Modul-Specifier.
    ort.env.wasm.wasmPaths = new URL(VENDOR, document.baseURI).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? state.threads : 1;
    ort.env.wasm.simd = true;
    ort.env.logLevel = 'error';

    const t1 = performance.now();
    state.session = await ort.InferenceSession.create(buf, {
      executionProviders: [state.ep],
      graphOptimizationLevel: 'all',
    });
    log(`Session bereit (${state.ep}, ${ort.env.wasm.numThreads} Thread(s)) in ${ms(performance.now() - t1)}`);
    log(`Eingaenge: ${state.session.inputNames.join(', ')} | Ausgaenge: ${state.session.outputNames.join(', ')}`);

    if (v.numSpeakers > 1 && !state.session.inputNames.includes('sid')) {
      log('Achtung: Modell meldet mehrere Sprecher, hat aber keinen sid-Eingang.', 'warn');
    }
    $('run').disabled = false;
    $('bench').disabled = false;
  } catch (e) {
    fail(e);
  } finally {
    $('load').disabled = false;
  }
}

/* ----------------------------------------------------------- Synthese */

function currentOptions() {
  // Bewusst ohne ||-Fallback: 0 ist ein gueltiger Wert fuer die Rausch-Regler
  // und macht die Ausgabe deterministisch - genau das braucht der Vergleich
  // mit der Piper-Kommandozeile.
  const num = (id) => { const v = Number($(id).value); return Number.isFinite(v) ? v : 0; };
  return {
    lengthScale: num('length'),
    noiseScale: num('noise'),
    noiseW: num('noisew'),
    speakerId: num('sid'),
    normalize: $('normalize').checked,
  };
}

/* Jede Stimme bringt in inference eigene Standardwerte mit - de_DE-mls-medium
 * zum Beispiel 0.333 statt 0.667/0.8. Werden die ignoriert, klingt das Modell
 * deutlich schlechter als ueber die Kommandozeile. */
function applyModelDefaults(cfg) {
  const inf = cfg.inference || {};
  const set = (id, v) => {
    if (v === undefined || v === null) return;
    const el = $(id);
    el.value = String(v);
    el.dispatchEvent(new Event('input'));
  };
  set('length', inf.length_scale ?? 1);
  set('noise', inf.noise_scale ?? 0.667);
  set('noisew', inf.noise_w ?? 0.8);
  log(`Standardwerte der Stimme: noise_scale ${inf.noise_scale}, noise_w ${inf.noise_w}, length_scale ${inf.length_scale}`);
}

async function synthesize(text, opts) {
  const sr = state.config.audio.sample_rate;
  const sentences = splitSentences(text);
  if (!sentences.length) throw new Error('Kein Text.');

  const tp = performance.now();
  const items = phonemize(sentences, state.config.espeak.voice);
  const phonemizeMs = performance.now() - tp;

  const chunks = [];
  let inferMs = 0;
  let mismatches = 0;
  let missing = [];

  for (const item of items) {
    const built = phonemesToIds(item.phonemes, state.config.phoneme_id_map);
    if (built.missing.length) missing = missing.concat(built.missing);
    if (item.phoneme_ids && !sameIds(item.phoneme_ids, built.ids)) mismatches++;

    const ids = BigInt64Array.from(built.ids, BigInt);
    const feeds = {
      input: new ort.Tensor('int64', ids, [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor('float32',
        Float32Array.from([opts.noiseScale, opts.lengthScale, opts.noiseW]), [3]),
    };
    if (state.session.inputNames.includes('sid')) {
      feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(opts.speakerId)]), [1]);
    }

    const t0 = performance.now();
    const out = await state.session.run(feeds);
    inferMs += performance.now() - t0;

    let chunk = out[state.session.outputNames[0]].data;
    if (opts.normalize) chunk = normalizePeak(chunk);
    chunks.push(chunk);
  }

  if (missing.length) {
    log(`Phoneme ohne Eintrag in phoneme_id_map: ${[...new Set(missing)].join(' ')}`, 'warn');
  }
  if (mismatches) {
    log(`${mismatches} Satz/Saetze: eigene ID-Bildung weicht von piper_phonemize ab.`, 'warn');
  }

  const samples = joinWithSilence(chunks, sr, SENTENCE_SILENCE);
  return {
    samples,
    sampleRate: sr,
    seconds: samples.length / sr,
    phonemizeMs,
    inferMs,
    sentences: sentences.length,
  };
}

/* Piper normalisiert jeden Satz einzeln auf Vollausschlag (voice.py:
 * audio = audio / max(abs(audio))), solange --no-normalize fehlt. Das Go-Backend
 * ruft Piper ohne dieses Flag auf - wer die gleiche Lautheit will, muss es hier
 * genauso machen. */
function normalizePeak(samples) {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > max) max = a;
  }
  if (max < 1e-8) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / max;
  return out;
}

function joinWithSilence(chunks, sampleRate, seconds) {
  const gap = Math.round(sampleRate * seconds);
  let total = 0;
  for (const c of chunks) total += c.length;
  total += gap * Math.max(0, chunks.length - 1);
  const out = new Float32Array(total);
  let at = 0;
  chunks.forEach((c, i) => {
    out.set(c, at);
    at += c.length + (i < chunks.length - 1 ? gap : 0);
  });
  return out;
}

function wavBlob(samples, sampleRate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let at = 44;
  for (let i = 0; i < samples.length; i++, at += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, s < 0 ? s * 32768 : s * 32767, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

/* ------------------------------------------------------------ Einzeltest */

async function runOnce() {
  $('run').disabled = true;
  try {
    const opts = currentOptions();
    const r = await synthesize($('text').value, opts);
    const url = URL.createObjectURL(wavBlob(r.samples, r.sampleRate));
    $('player').src = url;
    const dl = $('download');
    dl.href = url;
    dl.download = `${state.voice.id}_sid${opts.speakerId}_len${opts.lengthScale}.wav`;
    dl.style.display = '';
    $('player').play().catch(() => {});
    const rtf = r.seconds / (r.inferMs / 1000);
    log(`${r.sentences} Satz/Saetze - ${r.seconds.toFixed(2)} s Ton, ` +
        `Phoneme ${ms(r.phonemizeMs)}, Inferenz ${ms(r.inferMs)} => ${rtf.toFixed(1)}x Echtzeit`, 'ok');
  } catch (e) {
    fail(e);
  } finally {
    $('run').disabled = false;
  }
}

/* ------------------------------------------------------------- Benchmark */

const CORPUS = [
  'Ja.',
  'Was soll das heissen?',
  'Guten Abend, Frau Nachbarin. Sie sehen bezaubernd aus heute.',
  'Ich habe Ihnen doch gesagt, dass ich damit nichts zu tun haben will!',
  '(leise, zu sich) Wenn er wuesste, was in dem Brief steht, waere alles vorbei.',
  'Mein Herr, ich bitte Sie: Setzen Sie sich, trinken Sie einen Schluck, und dann erzaehlen Sie mir in aller Ruhe, was gestern nacht im Garten vorgefallen ist.',
  'Nein! Niemals! Eher gehe ich zugrunde, als dass ich diesem Menschen noch einmal unter die Augen trete.',
  'Es war im Herbst, die Blaetter fielen schon, und der alte Garten lag so still da, als haette ihn jemand vergessen. Ich ging den Kiesweg hinunter, wie ich ihn hundertmal gegangen bin, und dachte an nichts Boeses.',
  'Und Sie glauben wirklich, dass sich das so einfach regeln laesst?',
  'Der Vorhang faellt.',
];

async function runBenchmark() {
  $('bench').disabled = true;
  $('run').disabled = true;
  const tbody = $('results');
  tbody.innerHTML = '';
  try {
    const opts = currentOptions();

    // Der erste Lauf einer frischen Session ist deutlich langsamer: onnxruntime
    // legt dabei seine Speicherarena an. Mit einem kurzen Satz aufzuwaermen
    // reicht nicht - der Effekt haelt sich sonst ueber die ersten Bloecke.
    log('Aufwaermlauf (langer Block) …');
    const warm = await synthesize(CORPUS[7], opts);
    log(`Erster Block nach dem Laden: ${ms(warm.inferMs)} fuer ${warm.seconds.toFixed(1)} s Ton ` +
        `(${(warm.seconds / (warm.inferMs / 1000)).toFixed(1)}x) - danach wird es schneller.`);

    let audioTotal = 0;
    let inferTotal = 0;
    let phonTotal = 0;

    for (let i = 0; i < CORPUS.length; i++) {
      const text = CORPUS[i];
      const r = await synthesize(text, opts);
      audioTotal += r.seconds;
      inferTotal += r.inferMs;
      phonTotal += r.phonemizeMs;

      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td class="txt">${text.length > 60 ? text.slice(0, 60) + '…' : text}</td>` +
        `<td class="num">${text.length}</td>` +
        `<td class="num">${r.seconds.toFixed(2)}</td>` +
        `<td class="num">${r.phonemizeMs.toFixed(0)}</td>` +
        `<td class="num">${r.inferMs.toFixed(0)}</td>` +
        `<td class="num">${(r.seconds / (r.inferMs / 1000)).toFixed(1)}×</td>`;
      tbody.appendChild(tr);
      await new Promise((r2) => setTimeout(r2, 0)); // UI atmen lassen
    }

    const rtf = audioTotal / (inferTotal / 1000);
    const perBlock = (inferTotal + phonTotal) / CORPUS.length / 1000;
    // Ein abendfuellendes Stueck: rund 1400 Bloecke laut README.
    const play = (perBlock * 1400) / 60;

    $('summary').innerHTML =
      `<div><span>Stimme</span><b>${state.voice.id}${state.session.inputNames.includes('sid') ? `, sid ${opts.speakerId}` : ''}</b></div>` +
      `<div><span>Backend</span><b>${state.ep}, ${ort.env.wasm.numThreads} Thread(s)</b></div>` +
      `<div><span>length_scale</span><b>${opts.lengthScale}</b></div>` +
      `<div><span>Ton gesamt</span><b>${audioTotal.toFixed(1)} s</b></div>` +
      `<div><span>Rechenzeit</span><b>${(inferTotal / 1000).toFixed(1)} s (+ ${(phonTotal / 1000).toFixed(2)} s Phoneme)</b></div>` +
      `<div><span>Realtime-Faktor</span><b>${rtf.toFixed(1)}× Echtzeit</b></div>` +
      `<div><span>je Block</span><b>${perBlock.toFixed(2)} s</b></div>` +
      `<div><span>hochgerechnet</span><b>1400 Bloecke ≈ ${play.toFixed(0)} min</b></div>`;
    $('summaryBox').style.display = '';
    log(`Benchmark fertig: ${rtf.toFixed(1)}x Echtzeit, ${perBlock.toFixed(2)} s je Block`, 'ok');
  } catch (e) {
    fail(e);
  } finally {
    $('bench').disabled = false;
    $('run').disabled = false;
  }
}

/* ---------------------------------------------------------------- Start */

function wireUp() {
  for (const [id, out] of [['length', 'lengthOut'], ['noise', 'noiseOut'],
                           ['noisew', 'noisewOut'], ['threads', 'threadsOut'],
                           ['sid', 'sidOut']]) {
    const el = $(id);
    const set = () => { $(out).textContent = el.value; };
    el.addEventListener('input', set);
    set();
  }
  $('load').onclick = loadModel;
  $('run').onclick = runOnce;
  $('bench').onclick = runBenchmark;
}

window.addEventListener('DOMContentLoaded', () => {
  wireUp();
  showEnvironment();
  loadVoiceList().catch(fail);
});
