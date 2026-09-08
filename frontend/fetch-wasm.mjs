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
  ['@diffusionstudio/piper-wasm/build', 'piper_phonemize.data'],
]

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

/*
 * piper_phonemize.js ist ein klassisches Skript und definiert
 * createPiperPhonemize als Top-Level-Variable. Es fehlt nur der Export, dann
 * lässt es sich importieren – ohne globale Variable und ohne eval, was auch
 * in einem Worker und unter einer strengen CSP funktioniert.
 */
const classic = join(modules, '@diffusionstudio', 'piper-wasm', 'build', 'piper_phonemize.js')
if (!existsSync(classic)) fail('piper_phonemize.js fehlt. Erst "npm install" laufen lassen.')
writeFileSync(
  join(out, 'piper_phonemize.mjs'),
  `${readFileSync(classic, 'utf8')}\nexport default createPiperPhonemize;\n`,
)

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
let total = 0
const listed = [...sources.map(([, f]) => f), 'piper_phonemize.mjs'].sort()
for (const file of listed) {
  const { size } = await import('node:fs').then((fs) => fs.statSync(join(out, file)))
  total += size
  console.log(`  ${file.padEnd(34)} ${mb(size).padStart(9)}`)
}
console.log(`\npublic/wasm/ bereit – ${mb(total)} gesamt.`)
