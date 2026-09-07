/**
 * Numbers said aloud against numbers in the book.
 *
 * A recogniser writes "29er" where the book has "neunundzwanziger", and "1918"
 * where it has "neunzehnhundertachtzehn". Neither of the two tools in
 * compare.ts can bridge that: the edit distance is enormous, and cologne()
 * throws digits away before it even starts. So the two spellings are reduced
 * to the only thing they share – their value.
 *
 * The same test also works the other way round. "20er" and "29er" are one
 * typing mistake apart and used to pass as the same word; they are not the
 * same number, and now they no longer pass.
 *
 * Deliberately narrow. This is not a general parser for German numerals; it
 * covers what turns up in a play – counts, years, ordinals, vintages – and
 * answers `null` for everything else, which leaves the normal comparison
 * exactly as it was.
 *
 * Input is a word that has already been through normalizeWord(): lower case,
 * no punctuation, no accents. The tables below are therefore spelled the way
 * that function leaves them ("funf", "zwolf", "dreissig"); numbers.test.ts
 * checks that this assumption still holds.
 */

/** 1–9. Kept apart from the rest because only these open an "…und…" compound. */
const UNITS = new Map<string, number>([
  ['ein', 1], ['eins', 1], ['zwei', 2], ['zwo', 2], ['drei', 3], ['vier', 4],
  ['funf', 5], ['sechs', 6], ['sieben', 7], ['acht', 8], ['neun', 9],
])

/** Whole tens, the right-hand side of an "…und…" compound. */
const TENS = new Map<string, number>([
  ['zwanzig', 20], ['dreissig', 30], ['vierzig', 40], ['funfzig', 50],
  ['sechzig', 60], ['siebzig', 70], ['achtzig', 80], ['neunzig', 90],
])

/** Everything below a hundred that is a word of its own. */
const SMALL = new Map<string, number>([
  ['null', 0],
  ...UNITS,
  ['zehn', 10], ['elf', 11], ['zwolf', 12], ['dreizehn', 13], ['vierzehn', 14],
  ['funfzehn', 15], ['sechzehn', 16], ['siebzehn', 17], ['achtzehn', 18],
  ['neunzehn', 19],
  ...TENS,
])

/**
 * Ordinal stems that are not the cardinal plus an ending. Only reachable once
 * an ending has been taken off, so the adverb "erst" on its own stays a word
 * and not a number.
 */
const IRREGULAR = new Map<string, number>([
  ['erst', 1], ['dritt', 3], ['siebt', 7],
])

/**
 * Endings a numeral picks up in a sentence – ordinals ("neunundzwanzigsten"),
 * vintages ("29er"), multipliers ("dreimal"). Longest first, so "sten" is
 * tried before "en".
 */
const SUFFIXES = [
  'jahrigen', 'jahriger', 'jahrige', 'fach', 'mal',
  'stem', 'sten', 'ster', 'stes', 'ste',
  'tem', 'ten', 'ter', 'tes', 'te',
  'ern', 'ers', 'er', 'en', 'e',
]

/** Below a hundred, including the "vierundzwanzig" compound. */
function under100(word: string): number | null {
  if (word === '') return null

  const direct = SMALL.get(word)
  if (direct !== undefined) return direct

  // "sechsundsechzig" – the unit comes first in German, the ten after "und".
  const at = word.indexOf('und')
  if (at > 0) {
    const unit = UNITS.get(word.slice(0, at))
    const ten = TENS.get(word.slice(at + 3))
    if (unit !== undefined && ten !== undefined) return ten + unit
  }
  return null
}

/**
 * Below a thousand – and the year form on top of it: "neunzehnhundertachtzehn"
 * is 19 hundreds plus 18, which is how a play writes 1918.
 */
function under1000(word: string): number | null {
  const at = word.indexOf('hundert')
  if (at < 0) return under100(word)

  const before = word.slice(0, at)
  const after = word.slice(at + 'hundert'.length)
  const left = before === '' ? 1 : under100(before)
  const right = after === '' ? 0 : under100(after)
  if (left === null || right === null) return null
  return left * 100 + right
}

function fromNumeral(word: string): number | null {
  const at = word.indexOf('tausend')
  if (at < 0) return under1000(word)

  const before = word.slice(0, at)
  const after = word.slice(at + 'tausend'.length)
  const left = before === '' ? 1 : under1000(before)
  const right = after === '' ? 0 : under1000(after)
  if (left === null || right === null) return null
  return left * 1000 + right
}

/** A written-out numeral, with or without an ending. */
function fromWords(word: string): number | null {
  const plain = fromNumeral(word)
  if (plain !== null) return plain

  for (const suffix of SUFFIXES) {
    if (word.length <= suffix.length || !word.endsWith(suffix)) continue
    const stem = word.slice(0, -suffix.length)
    const irregular = IRREGULAR.get(stem)
    if (irregular !== undefined) return irregular
    const value = fromNumeral(stem)
    if (value !== null) return value
  }
  return null
}

/** Digits, with the same endings a numeral can carry: "29er", "1918". */
function fromDigits(word: string): number | null {
  const match = /^(\d+)([a-z]*)$/.exec(word)
  if (!match) return null
  const [, digits, ending] = match
  if (ending !== '' && !SUFFIXES.includes(ending)) return null
  return Number(digits)
}

/**
 * The value of a word, or null if it is not a number at all.
 *
 * Expects the output of normalizeWord(). Answering null is the normal case and
 * costs nothing: the caller then compares the way it always did.
 */
export function numberValue(word: string): number | null {
  if (word === '') return null
  return fromDigits(word) ?? fromWords(word)
}
