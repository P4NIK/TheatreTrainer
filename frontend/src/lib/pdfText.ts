/**
 * Text extraction from the PDF text layer.
 *
 * pdf.js gives us every text item together with its transform matrix in PDF
 * user space (origin bottom-left). We convert those to page-relative
 * coordinates (0..1, origin top-left) so they can be compared directly with
 * the selection rectangles drawn on the canvas.
 */
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Rect } from '../types'

export interface TextPiece {
  /** page-relative box, origin top-left */
  x: number
  y: number
  w: number
  h: number
  str: string
}

export async function extractPieces(page: PDFPageProxy): Promise<TextPiece[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const pieces: TextPiece[] = []

  for (const item of content.items) {
    if (!('str' in item) || typeof item.str !== 'string') continue
    if (item.str.trim() === '') continue

    const t = item.transform as number[]
    const height = Math.hypot(t[1], t[3]) || item.height || 0
    const left = t[4]
    const baseline = t[5]
    const top = viewport.height - baseline - height

    pieces.push({
      x: left / viewport.width,
      y: top / viewport.height,
      w: (item.width || 0) / viewport.width,
      h: height / viewport.height,
      str: item.str,
    })
  }
  return pieces
}

/** True when the centre of a text piece lies inside the rectangle. */
function inside(p: TextPiece, r: Rect): boolean {
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
}

/**
 * Collects all text inside a rectangle and joins it into a single line.
 * Piper reads one line per utterance, so line breaks from the layout are
 * intentionally flattened. Hyphenation at a line end is undone.
 */
export function textInRect(pieces: TextPiece[], rect: Rect): string {
  const hits = pieces.filter((p) => inside(p, rect))
  if (hits.length === 0) return ''

  // Group into visual lines: pieces whose vertical centres are close together.
  const sorted = [...hits].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: TextPiece[][] = []
  for (const p of sorted) {
    const last = lines[lines.length - 1]
    if (last) {
      const ref = last[0]
      const tolerance = Math.max(ref.h, p.h) * 0.6
      if (Math.abs(p.y - ref.y) <= tolerance) {
        last.push(p)
        continue
      }
    }
    lines.push([p])
  }

  const lineTexts = lines.map((line) => {
    const ordered = [...line].sort((a, b) => a.x - b.x)
    let out = ''
    let prev: TextPiece | null = null
    for (const p of ordered) {
      if (prev) {
        const gap = p.x - (prev.x + prev.w)
        // pdf.js splits words at kerning boundaries; only insert a space when
        // there is a visible gap and neither side already has one.
        const needsSpace =
          gap > prev.h * 0.12 && !/\s$/.test(out) && !/^\s/.test(p.str)
        if (needsSpace) out += ' '
      }
      out += p.str
      prev = p
    }
    return out.trim()
  })

  let text = ''
  for (const line of lineTexts) {
    if (!line) continue
    if (text === '') {
      text = line
    } else if (/[-­]$/.test(text)) {
      text = text.slice(0, -1) + line // undo hyphenation
    } else {
      text += ' ' + line
    }
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Guesses speaker and spoken text from an extracted line.
 * Play scripts usually look like "HUGO: Guten Abend." or
 * "SIR ROWLAND Guten Abend." – an all-caps prefix is treated as the speaker.
 */
export function guessSpeaker(text: string): { speaker: string | null; rest: string } {
  const colon = text.match(/^\s*([A-ZÄÖÜ][A-ZÄÖÜß0-9 .'-]{1,30}?)\s*[:.]\s+(.*)$/)
  if (colon) return { speaker: colon[1].trim(), rest: colon[2].trim() }

  const caps = text.match(/^\s*([A-ZÄÖÜ][A-ZÄÖÜß]+(?: [A-ZÄÖÜ][A-ZÄÖÜß]+){0,2})\s+(?=[A-ZÄÖÜa-zäöü(])(.*)$/)
  if (caps && caps[2].trim().length > 0) {
    return { speaker: caps[1].trim(), rest: caps[2].trim() }
  }
  return { speaker: null, rest: text.trim() }
}
