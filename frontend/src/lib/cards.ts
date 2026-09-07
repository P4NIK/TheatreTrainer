/**
 * Flashcards for the lines of a role: which one is wanted today, and when it
 * comes back after you have judged yourself.
 *
 * Two clocks run side by side. The Leitner boxes are the slow one – days
 * between repeats, growing while a line sits still. The session queue is the
 * fast one: a line you fluffed comes back a few cards later in the same
 * sitting, because that is where it actually gets learned. Both are capped by
 * the premiere: an interval that steps clean over the opening night is no use
 * to anyone.
 *
 * What is deliberately *not* here is a judgement. The recogniser suggests a
 * grade and nothing more – see suggestGrade.
 */
import type { Block, Card, Deck, Grade } from '../types'
import type { Step } from './rehearsal'

/** Days a card rests after landing in each box. Index = box - 1. */
export const BOX_DAYS = [0, 1, 3, 7, 16, 35]

export const MAX_BOX = BOX_DAYS.length

// --- days ------------------------------------------------------------------
//
// A due date is a calendar day, not a moment: whether a line is due today must
// not depend on whether the rehearsal is at ten in the morning or at midnight.
// Everything below therefore works on local "2026-09-12" keys, and parses them
// at midday so an hour of daylight saving cannot shift a day.

/** The local day of a moment, as "2026-09-12". */
export function dayKey(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const day = String(when.getDate()).padStart(2, '0')
  return `${when.getFullYear()}-${month}-${day}`
}

function parseDay(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from)
  const b = parseDay(to)
  if (!a || !b) return 0
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function addDays(key: string, days: number): string {
  const d = parseDay(key)
  if (!d) return key
  d.setDate(d.getDate() + days)
  return dayKey(d)
}

/**
 * Days left until the premiere, or null when there is none to worry about.
 * A premiere that has been and gone stops capping anything – the play may well
 * be running, and then the long intervals are wanted again.
 */
export function daysToPremiere(premiere: string, today: string): number | null {
  if (!premiere) return null
  const left = daysBetween(today, premiere)
  return left >= 0 ? left : null
}

/**
 * How long a card rests in `box`.
 *
 * The ceiling is what makes this usable in the last weeks before an opening:
 * a line put away for 35 days when the premiere is in nine is a line you will
 * not have said again by then. The day before the premiere is the last one
 * that still counts as practice.
 */
export function intervalDays(box: number, toPremiere: number | null): number {
  const plain = BOX_DAYS[Math.min(Math.max(box, 1), MAX_BOX) - 1]
  if (toPremiere === null) return plain
  return Math.max(0, Math.min(plain, toPremiere - 1))
}

// --- grading ---------------------------------------------------------------

/**
 * The card as it stands after a grading.
 *
 * Every grading moves the box straight away, including one given on a repeat
 * within the same sitting. Getting a line only on the second attempt therefore
 * lands it in box 2 rather than back where it was – which is the honest
 * reading of what just happened.
 */
export function review(card: Card | undefined, grade: Grade, now: Date, premiere: string): Card {
  const today = dayKey(now)
  const box = card?.box ?? 1
  const next = grade === 'good' ? Math.min(box + 1, MAX_BOX) : grade === 'hard' ? box : 1

  return {
    box: next,
    due: addDays(today, intervalDays(next, daysToPremiere(premiere, today))),
    reviews: (card?.reviews ?? 0) + 1,
    lapses: (card?.lapses ?? 0) + (grade === 'again' ? 1 : 0),
    streak: grade === 'good' ? (card?.streak ?? 0) + 1 : 0,
    lastGrade: grade,
    lastReviewed: now.toISOString(),
  }
}

/**
 * How many cards later a line comes round again in this sitting; 0 means it is
 * done for today.
 *
 * Straight afterwards would only test the echo. Three cards on, the line has to
 * be found again; ten cards on, it is a memory. That short loop is what makes a
 * long evening before the premiere worth sitting through – the Leitner days
 * alone cannot repeat anything twice in one session.
 */
export function sessionDelay(grade: Grade): number {
  return grade === 'again' ? 3 : grade === 'hard' ? 10 : 0
}

/**
 * What the recogniser would say, if it were the one deciding. It is not.
 *
 * This only pre-selects a button. Whisper swallows endings, invents words and
 * is thrown by names – a deck that graded itself would bury the lines that
 * trip the recogniser, not the ones that trip you. The person speaking is the
 * only one who knows whether it sat.
 */
export function suggestGrade(score: number): Grade {
  if (score >= 0.85) return 'good'
  if (score >= 0.55) return 'hard'
  return 'again'
}

// --- the deck --------------------------------------------------------------

export interface DeckEntry {
  block: Block
  card?: Card
  /** Days until it is due: negative overdue, 0 today, positive still resting. */
  rest: number
  /** Never graded – it has not been in the deck yet. */
  fresh: boolean
}

/** Case-insensitive, because speaker names are typed by hand. */
function isOwnLine(block: Block, role: string): boolean {
  return (
    block.type === 'line' &&
    role.trim() !== '' &&
    (block.speaker ?? '').trim().toLowerCase() === role.trim().toLowerCase() &&
    block.text.trim() !== ''
  )
}

/**
 * The deck of a role: one entry per line, in the play's own order. Lines the
 * deck no longer contains simply drop out of the stored state – nothing has to
 * be pruned when the play is edited.
 */
export function buildDeck(blocks: Block[], role: string, cards: Deck, today: string): DeckEntry[] {
  return [...blocks]
    .sort((a, b) => a.order - b.order)
    .filter((b) => isOwnLine(b, role))
    .map((block) => {
      const card = cards[block.id]
      return {
        block,
        card,
        rest: card?.due ? daysBetween(today, card.due) : 0,
        fresh: card === undefined,
      }
    })
}

/** Which part of the deck a sitting works through. */
export type DeckFilter = 'due' | 'all'

export function isDue(entry: DeckEntry): boolean {
  return entry.fresh || entry.rest <= 0
}

/**
 * The order a sitting goes through.
 *
 * Weakest first, and that is the whole point of the mode: the lines still in
 * box 1 are the ones the evening should be spent on. Within a box the most
 * overdue goes first, and the play's own order breaks the last tie so a run
 * through a scene still feels like the scene.
 */
export function sessionQueue(
  deck: DeckEntry[],
  filter: DeckFilter,
  limit: number | null,
): DeckEntry[] {
  const wanted = filter === 'due' ? deck.filter(isDue) : [...deck]
  wanted.sort(
    (a, b) =>
      (a.card?.box ?? 1) - (b.card?.box ?? 1) ||
      a.rest - b.rest ||
      a.block.order - b.block.order,
  )
  return limit === null ? wanted : wanted.slice(0, Math.max(0, limit))
}

export interface DeckStats {
  total: number
  due: number
  /** Never graded. */
  fresh: number
  /** Box 4 and up – said right three times running, at least. */
  solid: number
  /** How many cards sit in each box; index = box - 1. */
  byBox: number[]
}

export function deckStats(deck: DeckEntry[]): DeckStats {
  const byBox = new Array<number>(MAX_BOX).fill(0)
  let due = 0
  let fresh = 0
  let solid = 0

  for (const entry of deck) {
    const box = entry.card?.box ?? 1
    byBox[Math.min(Math.max(box, 1), MAX_BOX) - 1]++
    if (isDue(entry)) due++
    if (entry.fresh) fresh++
    else if (box >= 4) solid++
  }
  return { total: deck.length, due, fresh, solid, byBox }
}

/** "neu", "heute fällig", "3 Tage überfällig", "in 5 Tagen". */
export function describeDue(entry: DeckEntry): string {
  if (entry.fresh) return 'neu'
  if (entry.rest === 0) return 'heute fällig'
  if (entry.rest < 0) {
    const late = -entry.rest
    return late === 1 ? '1 Tag überfällig' : `${late} Tage überfällig`
  }
  return entry.rest === 1 ? 'morgen' : `in ${entry.rest} Tagen`
}

// --- one card as rehearsal steps -------------------------------------------

export interface CueOptions {
  /**
   * Let a stage direction stand as a cue, or step over it and keep looking for
   * a spoken line.
   */
  includeDirections: boolean
}

/**
 * A card, expressed in the same steps the rehearsal run walks through: the cue
 * first, then your line.
 *
 * The cue is what comes before the line in the play. On stage that is what you
 * come in on, and a line practised without it is only half practised – you end
 * up knowing the words and missing the entrance. Empty blocks are skipped, so
 * a cue never turns into silence.
 *
 * Skipped stage directions are stepped over, not counted: the search carries on
 * backwards until it has the number of cues that was asked for. Switching them
 * off therefore shortens nobody's entrance, it only makes it a spoken one.
 */
export function cardSteps(
  block: Block,
  ordered: Block[],
  cueCount: number,
  options: CueOptions = { includeDirections: true },
): Step[] {
  const at = ordered.findIndex((b) => b.id === block.id)
  const cues: Step[] = []

  for (let i = at - 1; i >= 0 && cues.length < Math.max(0, cueCount); i--) {
    if (ordered[i].text.trim() === '') continue
    if (ordered[i].type === 'direction' && !options.includeDirections) continue
    cues.unshift({ kind: 'listen', block: ordered[i] })
  }
  return [...cues, { kind: 'speak', block }]
}

/**
 * Puts a card back into the sitting, `delay` cards further along.
 *
 * `at` is the step just judged; counting forward over the "speak" steps that
 * follow finds the place to slot it in. Only ever behind the current position,
 * so the run's own index keeps pointing at the same step. Fewer cards left than
 * the delay asks for means the end of the sitting is near, and there the card
 * simply goes last – still one more go at it today.
 */
export function requeue(steps: Step[], at: number, card: Step[], delay: number): Step[] {
  if (delay <= 0 || card.length === 0) return steps

  let seen = 0
  let pos = steps.length
  for (let i = at + 1; i < steps.length; i++) {
    if (steps[i].kind !== 'speak') continue
    seen++
    if (seen >= delay) {
      pos = i + 1
      break
    }
  }
  return [...steps.slice(0, pos), ...card, ...steps.slice(pos)]
}
