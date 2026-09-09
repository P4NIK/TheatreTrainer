/**
 * Loading files that ship *next to* the app rather than inside it.
 *
 * `public/wasm/` holds what `npm run wasm` puts there: espeak-ng, the
 * onnxruntime glue, the runtime of transformers.js. None of it goes through
 * the bundler, which is the point – and also the problem:
 *
 *   - Vite's dev server refuses to serve anything from `public/` as a module
 *     ("this file is in /public … should not be imported from source code"),
 *     because those files never went through its transforms.
 *   - In the build the same import resolves next to the bundle, where the file
 *     is not.
 *
 * Fetching the text and importing it as a blob works in both, and it keeps
 * every generated artifact in one folder instead of smuggling some of them
 * into `src/`. The cost is one extra fetch of a file that is a few hundred
 * kilobytes and lands in the browser cache anyway.
 */

/** The URL of a module that can be imported – a blob of the fetched source. */
export async function generatedUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} konnte nicht geladen werden: ${response.status} ${response.statusText}`)
  }
  return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }))
}

/** Imports such a module and lets go of the blob afterwards. */
export async function importGenerated(url: string): Promise<Record<string, unknown>> {
  const blob = await generatedUrl(url)
  try {
    return await import(/* @vite-ignore */ blob)
  } finally {
    URL.revokeObjectURL(blob)
  }
}
