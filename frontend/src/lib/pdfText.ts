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
  /** Set where the typeface was readable – see FontIndex. */
  bold?: boolean
  italic?: boolean
}

/* ----------------------------------------------------------- Schriftschnitt */

export interface FontStyle {
  bold: boolean
  italic: boolean
}

const PLAIN: FontStyle = { bold: false, italic: false }

/** Was pdf.js über eine geladene Schrift preisgibt – mehr braucht es nicht. */
interface LoadedFont {
  name?: string
  bold?: boolean
  italic?: boolean
}

/**
 * Welche Schrift auf einer Seite fett ist und welche kursiv.
 *
 * In manchen Stücken steckt der ganze Aufbau darin: der Sprechername fett, die
 * Regieanweisung kursiv, sonst nichts – keine Spalten, keine Großschreibung.
 * `getTextContent()` verrät davon nichts; es nennt nur Namen wie `g_d0_f4`,
 * und `styles[…].fontFamily` sagt bloß „serif“.
 *
 * Den wirklichen Namen – `TimesNewRomanPS-BoldMT` – hat pdf.js erst, wenn es
 * die Seite auch zeichnen könnte. `getOperatorList()` bringt ihn hervor, und
 * das kostet: eine Fünftelsekunde je Seite. Deshalb wird eine Seite nur dann
 * so weit gelesen, wenn auf ihr eine Schrift steht, die noch keine kennt –
 * nach der ersten Textseite ist das fast nie mehr der Fall.
 */
export class FontIndex {
  private readonly known = new Map<string, FontStyle>()

  /** True, sobald zu einer Schrift etwas bekannt ist. */
  has(font: string): boolean {
    return this.known.has(font)
  }

  styleOf(font: string | undefined): FontStyle {
    return (font && this.known.get(font)) || PLAIN
  }

  /** Holt nach, was von den genannten Schriften noch fehlt. */
  async learn(page: PDFPageProxy, fonts: Iterable<string>): Promise<void> {
    const fehlend = [...new Set(fonts)].filter((f) => f && !this.known.has(f))
    if (fehlend.length === 0) return

    try {
      await page.getOperatorList()
    } catch {
      // Ohne die Namen bleibt es beim Aufbau über die Spalten; das ist kein
      // Grund, die Erkennung abzubrechen.
      for (const f of fehlend) this.known.set(f, PLAIN)
      return
    }

    const objs = page.commonObjs as unknown as { get(id: string): unknown }
    for (const f of fehlend) {
      let font: LoadedFont | null = null
      try {
        font = objs.get(f) as LoadedFont
      } catch {
        font = null
      }
      const name = (font?.name ?? '').toLowerCase()
      this.known.set(f, {
        bold: font?.bold === true || /bold|black|heavy|semibold/.test(name),
        italic: font?.italic === true || /italic|oblique/.test(name),
      })
    }
  }
}

/**
 * Anteil gedrehter Stücke, ab dem sie nicht mehr als Ausreißer gelten.
 *
 * Gedreht steht auf einer Seite fast immer das, was nicht dazugehört: der
 * Sperrvermerk quer über den Rand, ein Wasserzeichen. Ist die Mehrheit
 * gedreht, liegt die ganze Seite quer – dann wäre das Aussortieren falsch.
 */
const ROTATED_LIMIT = 0.25

export async function extractPieces(page: PDFPageProxy, fonts?: FontIndex): Promise<TextPiece[]> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()

  if (fonts) {
    await fonts.learn(
      page,
      content.items.map((item) => ('str' in item ? item.fontName : '')),
    )
  }

  const pieces: TextPiece[] = []
  const upright: boolean[] = []

  for (const item of content.items) {
    if (!('str' in item) || typeof item.str !== 'string') continue
    if (item.str.trim() === '') continue

    const t = item.transform as number[]
    const height = Math.hypot(t[1], t[3]) || item.height || 0
    const left = t[4]
    const baseline = t[5]
    const top = viewport.height - baseline - height

    const style = fonts?.styleOf(item.fontName) ?? PLAIN
    pieces.push({
      x: left / viewport.width,
      y: top / viewport.height,
      w: (item.width || 0) / viewport.width,
      h: height / viewport.height,
      str: item.str,
      bold: style.bold,
      italic: style.italic,
    })
    // Waagerecht heißt: keine Drehung und keine Schräglage in der Matrix.
    upright.push(Math.abs(t[1]) < 0.01 && Math.abs(t[2]) < 0.01)
  }

  const gedreht = upright.filter((u) => !u).length
  if (gedreht === 0 || gedreht > pieces.length * ROTATED_LIMIT) return pieces
  return pieces.filter((_, i) => upright[i])
}

/** True when the centre of a text piece lies inside the rectangle. */
function inside(p: TextPiece, r: Rect): boolean {
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h
}

/**
 * Collects all text inside a rectangle. Piper reads one line per utterance, so
 * line breaks from the layout are intentionally flattened.
 */
export function textInRect(pieces: TextPiece[], rect: Rect): string {
  return piecesToText(pieces.filter((p) => inside(p, rect)))
}

/**
 * Joins text pieces into a single line of readable text.
 *
 * Shared by the manual rectangle selection and the automatic detection so both
 * produce exactly the same text for the same pieces. pdf.js splits words at
 * kerning boundaries, so spaces have to be re-inserted from the geometry, and
 * hyphenation at a line end is undone.
 */
export function piecesToText(pieces: TextPiece[]): string {
  if (pieces.length === 0) return ''

  // Group into visual lines: pieces whose vertical centres are close together.
  const sorted = [...pieces].sort((a, b) => a.y - b.y || a.x - b.x)
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
        // Only insert a space where there is a visible gap and neither side
        // already has one.
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
    } else if (/[-\u00ad]$/.test(text)) {
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

/**
 * Loads the text layer of several pages at once. Used by the automatic
 * detection, which needs pages the editor has not rendered.
 */
export async function piecesForPages(
  doc: { getPage: (n: number) => Promise<PDFPageProxy> },
  pages: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, TextPiece[]>> {
  const result = new Map<number, TextPiece[]>()
  // Einer für den ganzen Durchgang: die Namen der Schriften gelten im ganzen
  // Dokument, also lernt Seite 40 nichts mehr, was Seite 7 schon wusste.
  const fonts = new FontIndex()

  for (let i = 0; i < pages.length; i++) {
    const page = await doc.getPage(pages[i])
    result.set(pages[i], await extractPieces(page, fonts))
    // Was pdf.js für diese Seite aufgebaut hat, wird nicht mehr gebraucht.
    // Bei sechzig Seiten ist das der Unterschied zwischen ein paar Megabyte
    // und dem ganzen Dokument im Speicher.
    page.cleanup()
    onProgress?.(i + 1, pages.length)
  }
  return result
}
