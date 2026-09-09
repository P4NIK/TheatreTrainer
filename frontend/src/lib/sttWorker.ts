/// <reference lib="webworker" />

/**
 * The thread Whisper runs on.
 *
 * Bookkeeping only, like synthWorker.ts: transformers.js does the work, and
 * this keeps the loaded pipeline and answers one message at a time. A worker
 * is not optional here – recognising one line takes about a second, and a
 * second of frozen page in the middle of a rehearsal is unusable.
 */

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

import { generatedUrl } from './generated'

/** Main thread to worker. */
export type ToStt =
  | { id: number; type: 'load'; model: string; wasmBase: string; modelHost?: string }
  | { id: number; type: 'transcribe'; audio: Float32Array }

/**
 * Worker back to the main thread.
 *
 * Told apart by `type`, including the failure: a union whose variants do not
 * all carry the same field cannot be narrowed, and the compiler is right to
 * say so.
 */
export type FromStt =
  | { id: number; type: 'load' }
  | { id: number; type: 'transcribe'; text: string; ms: number }
  | { id: number; type: 'error'; error: string }
  | { id: 0; type: 'progress'; file: string; loaded: number; total: number }

let transcriber: AutomaticSpeechRecognitionPipeline | null = null

self.onmessage = async (event: MessageEvent<ToStt>) => {
  const message = event.data
  try {
    switch (message.type) {
      case 'load': {
        if (!transcriber) transcriber = await load(message)
        reply({ id: message.id, type: 'load' })
        break
      }

      case 'transcribe': {
        if (!transcriber) throw new Error('Die Spracherkennung ist nicht geladen')
        const started = performance.now()
        const out = await transcriber(message.audio, { language: 'de', task: 'transcribe' })
        const text = Array.isArray(out) ? (out[0]?.text ?? '') : (out.text ?? '')
        reply({
          id: message.id,
          type: 'transcribe',
          text: text.trim(),
          ms: performance.now() - started,
        })
        break
      }
    }
  } catch (error) {
    reply({
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function load(
  message: Extract<ToStt, { type: 'load' }>,
): Promise<AutomaticSpeechRecognitionPipeline> {
  // The models come from Hugging Face and are kept in the browser cache;
  // "local models" would mean files next to the app, which there are none of.
  env.allowLocalModels = false
  if (message.modelHost) env.remoteHost = message.modelHost

  // Both files named, and the glue handed over as a blob – the same shape
  // piper.ts needs, and for the same reason (see generated.ts): left to
  // itself, onnxruntime imports its glue file from a path that exists in
  // neither the dev server nor the build.
  //
  // Which of the four builds it would otherwise pick depends on the browser –
  // asyncify, jspi, jsep or plain – and the glue only fits the .wasm of its
  // own kind. Naming both pins one pair for every browser: asyncify, the one
  // onnxruntime asks for on a normal desktop Chrome.
  const wasm = env.backends.onnx.wasm
  if (!wasm) throw new Error('onnxruntime bietet keine WASM-Einstellungen an')

  wasm.wasmPaths = {
    wasm: `${message.wasmBase}whisper/ort-wasm-simd-threaded.asyncify.wasm`,
    mjs: await generatedUrl(`${message.wasmBase}whisper/ort-wasm-simd-threaded.asyncify.mjs`),
  }
  // Threads would need cross-origin isolation, which would cost the app its
  // plain static hosting. Whisper is fast enough on one.

  wasm.numThreads = 1

  return pipeline('automatic-speech-recognition', message.model, {
    device: 'wasm',
    // Encoder in full precision, decoder small – see the note in stt.ts.
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    progress_callback: (progress: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (progress.status !== 'progress') return
      reply({
        id: 0,
        type: 'progress',
        file: progress.file ?? '',
        loaded: progress.loaded ?? 0,
        total: progress.total ?? 0,
      })
    },
  })
}

function reply(message: FromStt, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}
