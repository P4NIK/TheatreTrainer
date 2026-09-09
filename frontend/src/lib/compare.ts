/**
 * Comparing what was said with what is in the book.
 *
 * The input is a machine transcript, so exact string equality is the wrong
 * question: a recogniser writes "Romane Conti" for "Romanée Conti" and
 * "Rowlands" for "Rowland". Marking those red would train the actor to fight
 * the recogniser instead of learning the text. So two words count as the same
 * when they are close by edit distance **or** share a Cologne phonetic code –
 * the German counterpart of Soundex, which maps letters to digits by how they
 * sound and therefore treats "Meyer" and "Mayr" as one word.
 *
 * The result deliberately has three shades, not two: the word sat, it was said
 * differently, or it is missing. A rehearsal aid, not a verdict.
 */

import { numberValue } from './numbers'

export type WordState =
  /** Word for word what the book says. */
  | 'ok'
  /** Close enough that it is almost certainly the same word. */
  | 'near'
  /** Something else was said in this place. */
  | 'wrong'
  /** The word does not appear in the recording at all. */
  | 'missing'
  /** Said, but not in the book. */
  | 'extra'

export interface WordResult {
  state: WordState
  /** The word from the book, missing only for 'extra'. */
  expected?: string
  /** What was understood, missing for 'missing'. */
  spoken?: string
}

export interface Comparison {
  words: WordResult[]
  /** Words that sat exactly. */
  hits: number
  /** Words counted as close enough. */
  near: number
  /** Words in the book. */
  expectedCount: number
  /** 0..1 – near matches count half. */
  score: number
}

interface Token {
  raw: string
  key: string
}

/**
 * Lower case, without punctuation and without accents: ß becomes ss, ä/ö/ü
 * become a/o/u and é becomes e. A recogniser writes "Romanee" where the book
 * has "Romanée", and that is not a mistake worth marking.
 */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .map((raw) => ({ raw: raw.trim(), key: normalizeWord(raw) }))
    .filter((t) => t.key !== '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * Cologne phonetics (Postel 1969) – the German answer to Soundex. Same sound,
 * same digits, so spelling mistakes of a speech recogniser fall away.
 */
export function cologne(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '')
  if (w === '') return ''

  /** Careful: "csz".includes("") is true, so the end of a word needs a guard. */
  const has = (set: string, ch: string) => ch !== '' && set.includes(ch)

  const codes: string[] = []
  for (let i = 0; i < w.length; i++) {
    const c = w[i]
    const next = w[i + 1] ?? ''
    const prev = w[i - 1] ?? ''

    switch (c) {
      case 'a':
      case 'e':
      case 'i':
      case 'j':
      case 'o':
      case 'u':
      case 'y':
        codes.push('0')
        break
      case 'h':
        break
      case 'b':
        codes.push('1')
        break
      case 'p':
        codes.push(next === 'h' ? '3' : '1')
        break
      case 'd':
      case 't':
        codes.push(has('csz', next) ? '8' : '2')
        break
      case 'f':
      case 'v':
      case 'w':
        codes.push('3')
        break
      case 'g':
      case 'k':
      case 'q':
        codes.push('4')
        break
      case 'c':
        if (i === 0) codes.push(has('ahklogqrux', next) ? '4' : '8')
        else if (has('sz', prev)) codes.push('8')
        else codes.push(has('ahkoqux', next) ? '4' : '8')
        break
      case 'x':
        if (has('ckq', prev)) codes.push('8')
        else codes.push('4', '8')
        break
      case 'l':
        codes.push('5')
        break
      case 'm':
      case 'n':
        codes.push('6')
        break
      case 'r':
        codes.push('7')
        break
      case 's':
      case 'z':
        codes.push('8')
        break
      default:
        break
    }
  }

  // Neighbouring identical digits collapse, then every 0 but a leading one goes.
  const collapsed = codes.filter((code, i) => i === 0 || code !== codes[i - 1])
  return collapsed.filter((code, i) => code !== '0' || i === 0).join('')
}

/**
 * Two words count as the same when they are one or two typing mistakes apart,
 * or when they sound alike. Short words get no tolerance – "der" and "den"
 * are one step apart and mean different things. Numbers are the exception:
 * they are compared by value, see numbers.ts.
 */
export function related(a: string, b: string): boolean {
  if (a === b) return true

  // Numbers are decided on their value, and that verdict is final. The book
  // writes "neunundzwanziger" where the recogniser writes "29er" - no edit
  // distance and no phonetic code can bridge that, because cologne() drops
  // digits before it starts. The same test keeps "20er" and "29er" apart:
  // one typing mistake, one identical Cologne code, and two different years.
  const numberA = numberValue(a)
  const numberB = numberValue(b)
  if (numberA !== null && numberB !== null) return numberA === numberB

  const shortest = Math.min(a.length, b.length)
  const longest = Math.max(a.length, b.length)
  const limit = shortest <= 3 ? 0 : longest <= 6 ? 1 : 2
  if (levenshtein(a, b) <= limit) return true

  const ca = cologne(a)
  return shortest >= 4 && ca !== '' && ca === cologne(b)
}

// Alignment costs. A substitution is cheaper than a deletion plus an
// insertion, so "said something else here" wins over "dropped a word and
// added another" – which is what actually happens when a line is fumbled.
const COST_EXACT = 0
const COST_NEAR = 1
const COST_DIFFERENT = 3
const COST_GAP = 2

/**
 * Aligns the transcript to the text of the block with Needleman-Wunsch and
 * reports what happened to every word.
 */
export function compareSpoken(expected: string, spoken: string): Comparison {
  const want = tokenize(expected)
  const got = tokenize(spoken)

  if (want.length === 0) {
    return {
      words: got.map((t) => ({ state: 'extra' as const, spoken: t.raw })),
      hits: 0,
      near: 0,
      expectedCount: 0,
      score: 0,
    }
  }

  const n = want.length
  const m = got.length
  const cost = (i: number, j: number) => {
    if (want[i].key === got[j].key) return COST_EXACT
    return related(want[i].key, got[j].key) ? COST_NEAR : COST_DIFFERENT
  }

  // d[i][j] = cheapest way to align the first i expected and j spoken words.
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) d[i][0] = i * COST_GAP
  for (let j = 1; j <= m; j++) d[0][j] = j * COST_GAP
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(
        d[i - 1][j - 1] + cost(i - 1, j - 1),
        d[i - 1][j] + COST_GAP,
        d[i][j - 1] + COST_GAP,
      )
    }
  }

  const words: WordResult[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost(i - 1, j - 1)) {
      const c = cost(i - 1, j - 1)
      words.unshift({
        state: c === COST_EXACT ? 'ok' : c === COST_NEAR ? 'near' : 'wrong',
        expected: want[i - 1].raw,
        spoken: got[j - 1].raw,
      })
      i--
      j--
    } else if (i > 0 && d[i][j] === d[i - 1][j] + COST_GAP) {
      words.unshift({ state: 'missing', expected: want[i - 1].raw })
      i--
    } else {
      words.unshift({ state: 'extra', spoken: got[j - 1].raw })
      j--
    }
  }

  const hits = words.filter((w) => w.state === 'ok').length
  const near = words.filter((w) => w.state === 'near').length
  return {
    words,
    hits,
    near,
    expectedCount: n,
    score: Math.min(1, (hits + near / 2) / n),
  }
}
