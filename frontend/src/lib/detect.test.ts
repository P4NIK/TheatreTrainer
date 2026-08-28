import { describe, expect, it } from 'vitest'

import { detectBlocks, learnProfile, looksLikeSpeakerName, stripParentheticals } from './detect'
import type { TextPiece } from './pdfText'
import type { Block } from '../types'

/**
 * The fixtures below mirror how a real script is typeset: the speaker name and
 * the stage directions start at 6 % of the page width, the spoken text at
 * 24 %. Every case here was found in an actual play PDF.
 */
const LEFT = 0.06
const SPEECH = 0.242
const H = 0.0143

let row = 0
function line(pieces: [x: number, w: number, str: string][]): TextPiece[] {
  const y = 0.05 + row * 0.02
  row++
  return pieces.map(([x, w, str]) => ({ x, y, w, h: H, str }))
}
function reset() {
  row = 0
}

const profile = {
  leftX: LEFT,
  speechX: SPEECH,
  tolerance: 0.025,
  source: 'learned' as const,
  sampleSize: 5,
}

function detect(pages: Map<number, TextPiece[]>, existing: Block[] = []) {
  return detectBlocks(pages, profile, existing, 1, {
    stripInlineDirections: true,
    skipPagesWithoutDialogue: false,
  })
}

describe('looksLikeSpeakerName', () => {
  it('accepts names as they appear in scripts', () => {
    for (const name of ['HUGO', 'SIR ROWLAND', 'MRS MILLER', 'CLARISSA:', 'INSPEKTOR']) {
      expect(looksLikeSpeakerName(name), name).toBe(true)
    }
  })

  it('rejects prose that merely starts with a name', () => {
    for (const text of [
      'HUGO nimmt SIR ROWLAND das Glas ab.',
      'Er gibt ihm das nächste Glas',
      'CLARISSA HAILSHAM-BROWN kommt aus der Bibliothek. Sie ist Mitte dreißig',
    ]) {
      expect(looksLikeSpeakerName(text), text).toBe(false)
    }
  })
})

describe('stripParentheticals', () => {
  it('removes inserts and tidies the spacing', () => {
    expect(stripParentheticals('(kostet) Ich würde sagen, ja.')).toBe('Ich würde sagen, ja.')
    expect(stripParentheticals('Wo ist der Nächste? (Er nippt.) Ja, sicher.')).toBe(
      'Wo ist der Nächste? Ja, sicher.',
    )
  })

  it('leaves text without inserts alone', () => {
    expect(stripParentheticals('Ganz normaler Satz.')).toBe('Ganz normaler Satz.')
  })
})

describe('detectBlocks', () => {
  it('separates speech, speaker and stage directions', () => {
    reset()
    const page = [
      ...line([[LEFT, 0.34, 'HUGO nimmt SIR ROWLAND das Glas ab.']]),
      ...line([
        [LEFT, 0.12, 'SIR ROWLAND'],
        [SPEECH, 0.30, 'Ah, ein exquisiter Tropfen.'],
      ]),
      ...line([[SPEECH, 0.20, 'Jahrgang 1928.']]),
    ]
    const { blocks } = detect(new Map([[4, page]]))

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'direction', speaker: null })
    expect(blocks[1]).toMatchObject({ type: 'line', speaker: 'SIR ROWLAND' })
    // The continuation line belongs to the speech, not to a block of its own.
    expect(blocks[1].text).toBe('Ah, ein exquisiter Tropfen. Jahrgang 1928.')
  })

  it('keeps speaker names that are typeset as two pieces', () => {
    reset()
    const page = line([
      [LEFT, 0.026, 'SIR'],
      [0.091, 0.09, 'ROWLAND'],
      [SPEECH, 0.42, 'Absolut. Nur vernünftig.'],
    ])
    const { blocks } = detect(new Map([[12, page]]))

    expect(blocks).toHaveLength(1)
    expect(blocks[0].speaker).toBe('SIR ROWLAND')
    expect(blocks[0].text).toBe('Absolut. Nur vernünftig.')
  })

  it('does not mistake a direction that begins with a name for a speech', () => {
    reset()
    // The prose runs straight across the column boundary – no gap before the
    // speech column, unlike a real speaker name.
    const page = line([
      [LEFT, 0.17, 'CLARISSA HAILSHAM'],
      [0.23, 0.006, '-'],
      [0.236, 0.52, 'BROWN kommt aus der Bibliothek. Sie ist Mitte dreißig.'],
    ])
    const { blocks } = detect(new Map([[6, page]]))

    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('direction')
    expect(blocks[0].text).toContain('CLARISSA HAILSHAM-BROWN kommt aus der Bibliothek')
  })

  it('ignores page numbers and centred headings', () => {
    reset()
    const page = [
      ...line([[0.496, 0.009, '4']]),
      ...line([[0.438, 0.124, 'Erster Akt']]),
      ...line([
        [LEFT, 0.05, 'HUGO'],
        [SPEECH, 0.2, 'Wer ist das?'],
      ]),
    ]
    const { blocks } = detect(new Map([[4, page]]))

    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Wer ist das?')
  })

  it('gives a speech continued on the next page the speaker it belongs to', () => {
    reset()
    const first = line([
      [LEFT, 0.05, 'PIPPA'],
      [SPEECH, 0.3, 'Das ist eine lange Rede,'],
    ])
    reset()
    const second = line([[SPEECH, 0.3, 'die auf der nächsten Seite weitergeht.']])
    const { blocks } = detect(
      new Map([
        [10, first],
        [11, second],
      ]),
    )

    expect(blocks).toHaveLength(2)
    expect(blocks[1].page).toBe(11)
    expect(blocks[1].speaker).toBe('PIPPA')
  })

  it('leaves areas alone that an existing block already covers', () => {
    reset()
    const page = line([
      [LEFT, 0.05, 'HUGO'],
      [SPEECH, 0.2, 'Wer ist das?'],
    ])
    const existing: Block[] = [
      {
        id: 'b1',
        page: 4,
        rect: { x: 0.2, y: 0.04, w: 0.5, h: 0.03 },
        order: 1,
        type: 'line',
        speaker: 'HUGO',
        text: 'Wer ist das?',
      },
    ]
    const result = detect(new Map([[4, page]]), existing)

    expect(result.blocks).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('skips pages on which nobody speaks when asked to', () => {
    reset()
    const frontMatter = line([[LEFT, 0.8, 'Rechtliche Hinweise. Alle Rechte vorbehalten.']])
    reset()
    const dialogue = line([
      [LEFT, 0.05, 'HUGO'],
      [SPEECH, 0.2, 'Wer ist das?'],
    ])
    const pages = new Map([
      [2, frontMatter],
      [4, dialogue],
    ])

    const withSkip = detectBlocks(pages, profile, [], 1, {
      stripInlineDirections: true,
      skipPagesWithoutDialogue: true,
    })
    expect(withSkip.blocks).toHaveLength(1)
    expect(withSkip.pagesWithoutDialogue).toEqual([2])

    const without = detect(pages)
    expect(without.blocks).toHaveLength(2)
  })
})

describe('learnProfile', () => {
  it('recovers both columns from hand-drawn blocks', () => {
    reset()
    const page = line([
      [LEFT, 0.12, 'SIR ROWLAND'],
      [SPEECH, 0.3, 'Ah, ein exquisiter Tropfen.'],
    ])
    const drawn: Block[] = [
      {
        id: 'b1',
        page: 4,
        rect: { x: 0.03, y: 0.03, w: 0.9, h: 0.05 },
        order: 1,
        type: 'line',
        speaker: 'SIR ROWLAND',
        text: 'Ah, ein exquisiter Tropfen.',
      },
    ]
    const learned = learnProfile(new Map([[4, page]]), drawn)

    expect(learned).not.toBeNull()
    expect(learned!.leftX).toBeCloseTo(LEFT, 3)
    expect(learned!.speechX).toBeCloseTo(SPEECH, 3)
    expect(learned!.source).toBe('learned')
  })
})

describe('scripts without an indented speech column', () => {
  const inline = { ...profile, speechX: LEFT }

  it('reads "NAME: text" from the line itself', () => {
    reset()
    const page = [
      ...line([[LEFT, 0.5, 'HUGO: Guten Abend, Sir Rowland.']]),
      ...line([[LEFT, 0.5, 'SIR ROWLAND stellt das Glas ab.']]),
    ]
    const { blocks } = detectBlocks(new Map([[1, page]]), inline, [], 1, {
      stripInlineDirections: true,
      skipPagesWithoutDialogue: false,
    })

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'line', speaker: 'HUGO' })
    expect(blocks[0].text).toBe('Guten Abend, Sir Rowland.')
    expect(blocks[1].type).toBe('direction')
  })
})
