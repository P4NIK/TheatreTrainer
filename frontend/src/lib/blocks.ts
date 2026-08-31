import { DIRECTION_KEY, type Block, type SpeakerConfig, type Speakers } from '../types'

/** Palette used when a new speaker shows up in the editor. */
const PALETTE = [
  '#4A90D9', '#D9784A', '#4AA96C', '#B14AD9', '#D94A6E',
  '#3FA9B8', '#C7A22E', '#7A5CD9', '#D9564A', '#2E8B57',
]

export function newBlockId(): string {
  return 'b' + Math.random().toString(36).slice(2, 10)
}

export function nextOrder(blocks: Block[]): number {
  return blocks.reduce((max, b) => Math.max(max, b.order), 0) + 1
}

/** Renumbers order 1..n along the current array order. */
export function renumber(blocks: Block[]): Block[] {
  return blocks.map((b, i) => ({ ...b, order: i + 1 }))
}

/** All distinct speaker names used by line blocks, alphabetically. */
export function speakerNames(blocks: Block[]): string[] {
  const set = new Set<string>()
  for (const b of blocks) {
    if (b.type === 'line' && b.speaker && b.speaker.trim() !== '') {
      set.add(b.speaker.trim())
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'de'))
}

/**
 * Default pitches for new speakers. German Piper voices are few and only
 * thorsten is really good, so roles are told apart by pitch rather than by
 * model: every new speaker starts on a different one.
 */
const PITCHES = [1.0, 0.88, 1.12, 0.94, 1.2, 0.82, 1.06, 0.98]

export function defaultSpeakerConfig(index: number): SpeakerConfig {
  return {
    model: '',
    speakerId: 0,
    lengthScale: 1,
    volume: 1,
    pitch: PITCHES[index % PITCHES.length],
    color: PALETTE[index % PALETTE.length],
  }
}

/**
 * Adds an entry for every speaker that appears in the blocks but is missing
 * from speakers.json, so new names configure themselves automatically.
 */
export function syncSpeakers(blocks: Block[], speakers: Speakers): Speakers {
  const next: Speakers = { ...speakers }
  let changed = false

  if (!next[DIRECTION_KEY]) {
    next[DIRECTION_KEY] = { model: '', speakerId: 0, lengthScale: 1.15, volume: 0.7, pitch: 1, color: '#868e96' }
    changed = true
  }
  const names = speakerNames(blocks)
  names.forEach((name, i) => {
    if (!next[name]) {
      next[name] = defaultSpeakerConfig(i)
      changed = true
    }
  })
  return changed ? next : speakers
}

export function blockColor(block: Block, speakers: Speakers): string {
  if (block.type === 'direction') return speakers[DIRECTION_KEY]?.color || '#1c7ed6'
  const name = block.speaker?.trim()
  if (name && speakers[name]?.color) return speakers[name].color
  return '#343a40'
}

/** True when the text carries a parenthesised insert, i.e. a stage direction. */
export function hasParentheticals(text: string): boolean {
  return /\([^)]*\)/.test(text)
}

/**
 * Turns one block that mixes speech and parenthesised stage directions into
 * several blocks – one per part, in the original order.
 *
 * A printed script writes both into the same line ("Wer ist das? (Er tritt ans
 * Fenster.) Nur der junge Warrender."), but for reading aloud they are two
 * different things: the speech belongs to the character's voice, the insert to
 * the stage-direction voice. Only splitting them gives each its own.
 *
 * The first part keeps the block's id, so an edit stays an edit; the rest are
 * new blocks slotted in directly behind it. All of them keep the rectangle of
 * the original – they really do come from the same spot on the page.
 */
export function splitBlockAtParens(block: Block): Block[] {
  const parts = splitParens(block.text)
    .map((p) => ({
      direction: p.paren,
      text: (p.paren ? p.text.replace(/^\(|\)$/g, '') : p.text).trim(),
    }))
    .filter((p) => p.text !== '')

  if (parts.length < 2) return [block]

  return parts.map((p, i) => ({
    ...block,
    id: i === 0 ? block.id : newBlockId(),
    // Fractional steps keep the parts together until the list is renumbered.
    order: block.order + i / (parts.length + 1),
    type: p.direction ? 'direction' : block.type,
    speaker: p.direction ? null : block.speaker,
    text: p.text,
  }))
}

/**
 * Splits a text into normal parts and parenthesised parts so the UI can show
 * stage-like inserts in italics. Purely visual – the stored text is unchanged.
 */
export function splitParens(text: string): { text: string; paren: boolean }[] {
  const out: { text: string; paren: boolean }[] = []
  const re = /\(([^)]*)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), paren: false })
    out.push({ text: m[0], paren: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), paren: false })
  return out.length ? out : [{ text, paren: false }]
}
