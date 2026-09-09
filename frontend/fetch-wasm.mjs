/**
 * Legt die WASM-Dateien nach public/wasm/.
 *
 * Sie liegen nicht im Repo: 30 MB, davon 18 MB espeak-ng-Daten für alle
 * Sprachen. Vite fasst public/ nicht an und kopiert es beim Bauen unverändert
 * nach dist/ – genau richtig für WASM und Datenblobs.
 *
 * Das Skript lädt nichts herunter. onnxruntime-web und @diffusionstudio/piper-wasm
 * stehen in der package.json, npm holt sie also ohnehin; hier werden die
 * Binärdateien nur aus node_modules herüberkopiert. Damit läuft es unter
 * Windows, macOS und Linux gleich, und ohne Netz auch.
 *
 * Aufruf: npm run wasm   (läuft auch automatisch nach npm install)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'public', 'wasm')
const modules = join(here, 'node_modules')

/**
 * Welche onnxruntime-Variante geladen wird, entscheidet ort selbst und je nach
 * Version anders. Fehlt die richtige, meldet es "no available backend found" –
 * eine Fehlermeldung, die nach einem Modellproblem aussieht und keines ist.
 * Deshalb wandern alle mit; der Browser lädt ohnehin nur die eine, die er braucht.
 */
const sources = [
  ['onnxruntime-web/dist', 'ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist', 'ort-wasm-simd-threaded.wasm'],
  ['@diffusionstudio/piper-wasm/build', 'piper_phonemize.wasm'],
]

/*
 * Whisper bringt seine eigene onnxruntime mit – eine neuere als die, die Piper
 * benutzt, weshalb npm sie unter @huggingface/transformers/node_modules ablegt.
 * Die beiden dürfen nicht durcheinandergeraten: die Glue-Datei aus dem einen
 * Paket passt nicht zur .wasm des anderen. Deshalb ein eigener Unterordner.
 *
 * Von den vier Ausführungen (asyncify, jspi, jsep, schlicht) wandert genau die
 * mit, die sttWorker.ts festnagelt – siehe die Begründung dort.
 */
const whisperOrt = '@huggingface/transformers/node_modules/onnxruntime-web/dist'
const whisper = [
  [whisperOrt, 'ort-wasm-simd-threaded.asyncify.mjs'],
  [whisperOrt, 'ort-wasm-simd-threaded.asyncify.wasm'],
]

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`

function fail(message) {
  console.error(`\nfetch-wasm: ${message}\n`)
  process.exit(1)
}

mkdirSync(out, { recursive: true })

for (const [pkg, file] of sources) {
  const from = join(modules, ...pkg.split('/'), file)
  if (!existsSync(from)) fail(`${pkg}/${file} fehlt. Erst "npm install" laufen lassen.`)
  copyFileSync(from, join(out, file))
}

const whisperOut = join(out, 'whisper')
mkdirSync(whisperOut, { recursive: true })
for (const [pkg, file] of whisper) {
  const from = join(modules, ...pkg.split('/'), file)
  if (!existsSync(from)) fail(`${pkg}/${file} fehlt. Erst "npm install" laufen lassen.`)
  copyFileSync(from, join(whisperOut, file))
}

/*
 * piper_phonemize.js ist ein klassisches Skript und definiert
 * createPiperPhonemize als Top-Level-Variable. Es fehlt nur der Export, dann
 * lässt es sich importieren – ohne globale Variable und ohne eval, was auch
 * in einem Worker und unter einer strengen CSP funktioniert.
 *
 * Gleichzeitig wird der Datenblob beschnitten. Er enthält die Wörterbücher
 * *aller* Sprachen; gebraucht werden zwei:
 *
 *   de_dict   die Sprache, um die es geht
 *   en_dict   der Rückfall für Fremdwörter. Ohne ihn klingt "Romanée Conti"
 *             anders – gemessen, nicht vermutet: ohne en_dict wich genau der
 *             Satz mit den französischen Namen ab, mit ihm sind alle
 *             Testsätze sample-genau dieselben wie mit dem vollen Blob.
 *
 * Der Rest (Phonemtabellen, Stimmdefinitionen aller Sprachen) bleibt drin: er
 * ist zusammen keine 30 kB, und espeak liest das Verzeichnis beim Start.
 *
 * 17,2 MB werden so zu 1,0 MB – der größte Posten des ersten Besuchs.
 */
const KEEP_DICTS = ['/espeak-ng-data/de_dict', '/espeak-ng-data/en_dict']

const classic = join(modules, '@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.js')
const blob = join(modules, '@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.data')
if (!existsSync(classic) || !existsSync(blob)) {
  fail('piper_phonemize.js/.data fehlt. Erst "npm install" laufen lassen.')
}

const glue = readFileSync(classic, 'utf8')
const data = readFileSync(blob)

// Das Verzeichnis des Blobs steht als JSON-Argument von loadPackage({...}) im
// Skript: eine Liste aus Dateiname, Anfang und Ende.
const at = glue.indexOf('loadPackage({')
if (at < 0) fail('In piper_phonemize.js steht kein loadPackage({…}) – Paket geändert?')
const metaStart = glue.indexOf('{', at)
let depth = 0
let metaEnd = -1
for (let i = metaStart; i < glue.length; i++) {
  if (glue[i] === '{') depth++
  else if (glue[i] === '}' && --depth === 0) {
    metaEnd = i + 1
    break
  }
}
const meta = JSON.parse(glue.slice(metaStart, metaEnd))

const parts = []
const files = []
let offset = 0
for (const file of meta.files) {
  if (file.filename.endsWith('_dict') && !KEEP_DICTS.includes(file.filename)) continue
  parts.push(data.subarray(file.start, file.end))
  files.push({ ...file, start: offset, end: (offset += file.end - file.start) })
}

const trimmed = Buffer.concat(parts)
const patched =
  glue.slice(0, metaStart) +
  JSON.stringify({ ...meta, files, remote_package_size: trimmed.length }) +
  glue.slice(metaEnd)

writeFileSync(join(out, 'piper_phonemize.data'), trimmed)
writeFileSync(join(out, 'piper_phonemize.mjs'), `${patched}\nexport default createPiperPhonemize;\n`)
console.log(
  `  espeak-Daten: ${meta.files.length} Dateien (${mb(data.length)}) -> ` +
    `${files.length} (${mb(trimmed.length)})\n`,
)

let total = 0
const listed = [
  ...[...sources.map(([, f]) => f), 'piper_phonemize.mjs', 'piper_phonemize.data'].sort(),
  ...whisper.map(([, f]) => join('whisper', f)).sort(),
]
for (const file of listed) {
  const { size } = await import('node:fs').then((fs) => fs.statSync(join(out, file)))
  total += size
  console.log(`  ${file.padEnd(42)} ${mb(size).padStart(9)}`)
}
console.log(`\npublic/wasm/ bereit – ${mb(total)} gesamt.`)
