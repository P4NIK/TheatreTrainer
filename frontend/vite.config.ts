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

export default defineConfig({
  plugins: [react(), dropBundledOnnxWasm()],
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
