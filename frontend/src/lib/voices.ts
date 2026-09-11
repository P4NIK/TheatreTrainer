/**
 * Which voices there are, and where they come from.
 *
 * This replaces the `voices/` folder and the README section about downloading
 * models: the browser fetches the voice from the piper-voices repository the
 * first time it is needed and keeps it in OPFS afterwards. The second visit
 * costs nothing, and there is nothing to install.
 *
 * Both files of a voice go through the same store, the small .onnx.json
 * included – otherwise the app would work offline right up to the moment it
 * needs to know the sample rate.
 */

import type { VoiceConfig } from './piper'
import type { DownloadProgress, ModelStore } from './storage'

export interface VoiceInfo {
  /** The name that appears in speakers[].model. */
  name: string
  /** What a person sees in the list. */
  label: string
  /** One line about how it sounds. */
  note: string
  /** How many speakers the model holds; 1 means the speaker id does nothing. */
  speakers: number
  /** Size of the .onnx, so a progress bar has a total before the first byte. */
  bytes: number
  /** The folder inside the repository. */
  path: string
}

/** Where the models live. Open for cross-origin requests, and free. */
export const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'

/**
 * One entry, on purpose.
 *
 * Of the freely available German voices this is the only one whose quality
 * carries a whole play; the multi-speaker models sound worse the longer you
 * listen. Several roles come out of this one voice through pitch and tempo
 * (see audio.ts), which is the better trade. A second entry is five lines here
 * as soon as a voice worth having appears.
 */
export const VOICES: VoiceInfo[] = [
  {
    name: 'de_DE-thorsten-medium',
    label: 'Thorsten',
    note: 'männlich, ruhig – die Grundstimme, aus der die Rollen abgeleitet werden',
    speakers: 1,
    bytes: 63201294,
    path: 'de/de_DE/thorsten/medium/',
  },
]

/**
 * Die Stimme, die eine Rolle bekommt, solange niemand etwas anderes sagt.
 *
 * Es gibt genau eine, und „keine“ ist kein sinnvoller Ausgangszustand: Eine
 * Rolle ohne Stimme lässt den Durchlauf mit „ohne Stimme“ stehenbleiben, und
 * zu wählen gibt es dabei nichts. Kommt eine zweite Stimme dazu, bleibt dies
 * die Vorgabe – nur erscheint dann in der Sprecher-Verwaltung auch wieder
 * eine Auswahlliste.
 */
export const DEFAULT_VOICE = VOICES[0]?.name ?? ''

export function voiceByName(name: string): VoiceInfo | undefined {
  return VOICES.find((voice) => voice.name === name)
}

/** The two files of a voice. */
export function voiceUrls(voice: VoiceInfo): { model: string; config: string } {
  const stem = `${VOICE_BASE}${voice.path}${voice.name}.onnx`
  return { model: stem, config: `${stem}.json` }
}

/** True when both files are already in the store, so nothing has to be fetched. */
export async function voiceReady(models: ModelStore, name: string): Promise<boolean> {
  return (await models.has(`${name}.onnx`)) && (await models.has(`${name}.onnx.json`))
}

/**
 * Hands back the bytes of a voice, from the store or from the network.
 *
 * The progress callback only ever reports the model – the config is a few
 * kilobytes and would make the bar jump for no reason.
 */
export async function fetchVoice(
  models: ModelStore,
  name: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<{ bytes: Uint8Array; config: VoiceConfig }> {
  const voice = voiceByName(name)
  if (!voice) throw new Error(`Unbekannte Stimme: ${name}`)

  const urls = voiceUrls(voice)
  const configBytes = await models.get(`${name}.onnx.json`, urls.config)
  const config = JSON.parse(new TextDecoder().decode(configBytes)) as VoiceConfig
  const bytes = await models.get(`${name}.onnx`, urls.model, onProgress)
  return { bytes, config }
}
