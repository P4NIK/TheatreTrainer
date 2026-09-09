/// <reference lib="webworker" />

/**
 * The thread Piper runs on.
 *
 * Everything here is bookkeeping: the work is in piper.ts, and this file only
 * keeps the loaded voices and answers one message at a time. It stays this
 * thin on purpose – whatever is in here cannot be tested without a browser.
 *
 * Note that the voices are kept per model name, not one at a time: a play with
 * a narrator and three roles uses one voice with different pitches, but if a
 * second model ever turns up it should not throw the first one out on every
 * other block.
 */

import { configure, loadVoice, type Voice } from './piper'
import type { FromWorker, ToWorker } from './synth'

const voices = new Map<string, Voice>()

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data
  try {
    switch (message.type) {
      case 'load': {
        configure({ wasmBase: message.wasmBase })
        if (!voices.has(message.voice)) {
          voices.set(message.voice, await loadVoice(message.model, message.config))
        }
        reply({ id: message.id, type: 'load' })
        break
      }

      case 'synthesize': {
        const voice = voices.get(message.voice)
        if (!voice) throw new Error(`Stimme ${message.voice} ist nicht geladen`)

        const out = await voice.synthesize(message.text, {
          lengthScale: message.lengthScale,
          speakerId: message.speakerId,
        })
        // Transferred, not copied: a long block is a megabyte and a half.
        reply(
          {
            id: message.id,
            type: 'synthesize',
            samples: out.samples,
            sampleRate: out.sampleRate,
            phonemizeMs: out.phonemizeMs,
            inferMs: out.inferMs,
          },
          [out.samples.buffer as ArrayBuffer],
        )
        break
      }

      case 'release': {
        await voices.get(message.voice)?.release()
        voices.delete(message.voice)
        reply({ id: message.id, type: 'release' })
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

function reply(message: FromWorker, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(message, transfer)
}
