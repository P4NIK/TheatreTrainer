import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Wirft die WASM-Binärdatei von onnxruntime aus dem Build.
 *
 * transformers.js verweist mit `new URL(…, import.meta.url)` darauf, deshalb
 * kopiert der Bundler die 23 MB nach dist/ – und holt sie dann nie: die
 * Erkennung bekommt in sttWorker.ts ausdrücklich die Kopie aus
 * public/wasm/whisper/ genannt, denn nur zu der passt die Glue-Datei, die
 * daneben liegt. Zwei Kopien derselben Datei, eine davon tot.
 */
function dropBundledOnnxWasm(): Plugin {
  return {
    name: 'drop-bundled-onnx-wasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name]
      }
    },
  }
}

/**
 * Schreibt die Adressen im Manifest aus, sobald der Build weiß, wo die Seite
 * liegt.
 *
 * `"./"` ist die Fassung, die überall stimmt – die Norm löst `start_url` und
 * `scope` gegen die Adresse des Manifests auf, und das ergibt unter
 * `github.io/TheatreTrainer/` genau das Richtige. Nur muss sich der Browser
 * daran auch halten. Ein iPhone, das die App auf den Home-Bildschirm legt,
 * hat dabei die Wurzel der Domain gespeichert – und eine Adresse, die es
 * nicht gibt, ist als Fehler teurer als jede Umständlichkeit hier.
 *
 * Deshalb steht nach dem Build kein `"./"` mehr im Manifest, sondern der
 * ausgeschriebene Pfad: `/TheatreTrainer/`. Der ist gegen die Wurzel
 * aufgelöst dasselbe wie gegen das Manifest – da kann nichts mehr auseinander
 * gehen. Im Dev-Server bleibt es bei `"./"`, dort ist beides ohnehin `/`.
 */
function manifestMitBasis(): Plugin {
  let basis = '/'
  let ziel = 'dist'

  return {
    name: 'manifest-mit-basis',
    apply: 'build',
    configResolved(config) {
      basis = config.base
      ziel = config.build.outDir
    },
    // Nach dem Schreiben: public/ wird vom Bundler kopiert, und die Kopie
    // soll hier das letzte Wort haben.
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        const datei = join(ziel, 'manifest.webmanifest')
        const manifest = JSON.parse(await readFile(datei, 'utf8')) as Record<string, unknown>

        const ausschreiben = (wert: unknown): unknown => {
          if (typeof wert === 'string') {
            return wert.startsWith('./') ? basis + wert.slice(2) : wert
          }
          if (Array.isArray(wert)) return wert.map(ausschreiben)
          if (wert && typeof wert === 'object') {
            return Object.fromEntries(
              Object.entries(wert as Record<string, unknown>).map(([k, v]) => [k, ausschreiben(v)]),
            )
          }
          return wert
        }

        await writeFile(datei, JSON.stringify(ausschreiben(manifest), null, 2) + '\n')
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), dropBundledOnnxWasm(), manifestMitBasis()],
  /*
   * Ohne diese Zeile lädt der Dev-Server die Seite neu, sobald der
   * Whisper-Worker das erste Mal geladen wird: Vite entdeckt dabei eine neue
   * Abhängigkeit, bündelt sie vor und meldet "optimized dependencies changed.
   * reloading" – man landet mitten im Einschalten wieder auf der Startseite.
   * Ausgenommen wird sie einmal beim Start aufgelöst und nie wieder angefasst.
   * Betrifft nur `npm run dev`; der Build hat das Problem nicht.
   */
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  // Kein Proxy mehr: die Seite spricht mit keinem Server. Was sie lädt, kommt
  // aus dem eigenen Ordner oder direkt von HuggingFace.
  server: { port: 5173 },
})
