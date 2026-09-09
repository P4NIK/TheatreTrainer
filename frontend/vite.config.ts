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

// Der Proxy ist nur noch für die einmalige Übernahme alter Stücke da
// (lib/legacyImport.ts). Sonst spricht das Frontend mit keinem Server mehr.
// Standardmäßig läuft das Go-Backend auf :8080, VITE_API_TARGET ändert das.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), dropBundledOnnxWasm()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
