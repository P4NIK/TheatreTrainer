/**
 * Central pdf.js setup.
 *
 * pdf.js needs its worker as a separate bundle; Vite resolves this URL at
 * build time, so it works in dev and in the production build alike. Everything
 * that touches pdf.js imports `pdfjs` from here, so the worker is configured
 * exactly once and no matter which module happens to load first.
 */
import { pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjs }
