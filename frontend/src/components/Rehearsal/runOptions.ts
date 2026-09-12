/**
 * Die Schalter eines Durchlaufs – und wie sie gemerkt zurückkommen.
 *
 * Eigene Datei, weil sie zwei Ansichten und den Durchlauf selbst betreffen:
 * Lernmodus und Karteikarten stellen dieselben Fragen („mitlesen? aufdecken?
 * mitschneiden?“), und RehearsalRun beantwortet sie.
 */

import { bool, numOrNull, pick } from '../../lib/prefs'

export interface RunOptions {
  /** Read along with what the others say. */
  showText: boolean
  /** Show your own line already during the pause instead of only afterwards. */
  revealOwn: boolean
  /** Seconds after which the pause ends by itself; null means you click. */
  autoAdvance: number | null
  record: boolean
  /** Send the take to the local speech recognition and compare it. */
  analyze: boolean
}

export const defaultRunOptions: RunOptions = {
  showText: true,
  revealOwn: false,
  autoAdvance: null,
  record: false,
  analyze: false,
}

/**
 * Die gemerkten Schalter, zurückgelesen.
 *
 * `analyze` kann nur mit `record` bestehen: Ein Mitschnitt, den es nicht gibt,
 * lässt sich nicht auswerten – der Schalter wäre gesperrt und trotzdem an.
 */
export function readRunOptions(raw: unknown, fallback: RunOptions = defaultRunOptions): RunOptions {
  const record = bool(pick(raw, 'record'), fallback.record)
  return {
    showText: bool(pick(raw, 'showText'), fallback.showText),
    revealOwn: bool(pick(raw, 'revealOwn'), fallback.revealOwn),
    autoAdvance: numOrNull(pick(raw, 'autoAdvance'), fallback.autoAdvance, 2, 120),
    record,
    analyze: record && bool(pick(raw, 'analyze'), fallback.analyze),
  }
}
