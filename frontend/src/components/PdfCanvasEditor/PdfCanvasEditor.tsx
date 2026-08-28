import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Document, Page } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'

import { blockColor } from '../../lib/blocks'
import '../../lib/pdfWorker'
import { extractPieces, textInRect, type TextPiece } from '../../lib/pdfText'
import type { Block, Rect, Speakers } from '../../types'

interface Props {
  fileUrl: string
  blocks: Block[]
  speakers: Speakers
  page: number
  onPageChange: (page: number) => void
  onNumPages: (n: number) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Fired when the user finished drawing a rectangle. */
  onRectDrawn: (rect: Rect, extractedText: string) => void
}

const MIN_W = 0.01
const MIN_H = 0.004

export default function PdfCanvasEditor({
  fileUrl,
  blocks,
  speakers,
  page,
  onPageChange,
  onNumPages,
  selectedId,
  onSelect,
  onRectDrawn,
}: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [width, setWidth] = useState(800)
  const [pieces, setPieces] = useState<TextPiece[]>([])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Rect | null>(null)

  const overlayRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)

  const file = useMemo(() => fileUrl, [fileUrl])

  const onDocumentLoad = useCallback(
    (doc: PDFDocumentProxy) => {
      setPdfDoc(doc)
      setNumPages(doc.numPages)
      onNumPages(doc.numPages)
      setError(null)
    },
    [onNumPages],
  )

  // Load the text layer of the current page for rectangle-based extraction.
  useEffect(() => {
    if (!pdfDoc) return
    let cancelled = false
    setPieces([])
    pdfDoc
      .getPage(page)
      .then(extractPieces)
      .then((ps) => {
        if (!cancelled) setPieces(ps)
      })
      .catch(() => {
        if (!cancelled) setPieces([])
      })
    return () => {
      cancelled = true
    }
  }, [pdfDoc, page])

  const relative = (e: React.MouseEvent): { x: number; y: number } | null => {
    const el = overlayRef.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const p = relative(e)
    if (!p) return
    startRef.current = p
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
    onSelect(null)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const start = startRef.current
    if (!start) return
    const p = relative(e)
    if (!p) return
    setDraft({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    })
  }

  const finishDraw = () => {
    const rect = draft
    startRef.current = null
    setDraft(null)
    if (!rect || rect.w < MIN_W || rect.h < MIN_H) return
    onRectDrawn(rect, textInRect(pieces, rect))
  }

  const pageBlocks = blocks.filter((b) => b.page === page)

  return (
    <Stack gap="xs" h="100%">
      <Group justify="space-between">
        <Group gap={4}>
          <ActionIcon
            variant="default"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Vorherige Seite"
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
          <NumberInput
            value={page}
            min={1}
            max={Math.max(1, numPages)}
            onChange={(v) => {
              const n = typeof v === 'number' ? v : parseInt(String(v), 10)
              if (!Number.isNaN(n) && n >= 1 && n <= numPages) onPageChange(n)
            }}
            w={72}
            size="xs"
            hideControls
          />
          <Text size="sm" c="dimmed">
            / {numPages || '?'}
          </Text>
          <ActionIcon
            variant="default"
            disabled={numPages > 0 && page >= numPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Nächste Seite"
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>

        <Group gap={4}>
          <Badge variant="light" color="gray">
            {pageBlocks.length === 1 ? '1 Block' : `${pageBlocks.length} Blöcke`} auf dieser Seite
          </Badge>
          <Tooltip label="Verkleinern">
            <ActionIcon variant="default" onClick={() => setWidth((w) => Math.max(400, w - 100))}>
              <IconZoomOut size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Vergrößern">
            <ActionIcon variant="default" onClick={() => setWidth((w) => Math.min(2000, w + 100))}>
              <IconZoomIn size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {error && <Alert color="red">{error}</Alert>}

      <Paper withBorder p="md" style={{ overflow: 'auto', flex: 1, background: '#f1f3f5' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div
            className="pdf-stage"
            style={{ position: 'relative', width, lineHeight: 0, boxShadow: '0 1px 8px rgba(0,0,0,.15)' }}
          >
            <Document
              file={file}
              onLoadSuccess={onDocumentLoad}
              onLoadError={(e) => setError('PDF konnte nicht geladen werden: ' + e.message)}
              loading={
                <Group justify="center" p="xl">
                  <Loader size="sm" />
                </Group>
              }
            >
              <Page
                pageNumber={page}
                width={width}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            </Document>

            {/* Selection overlay: draws new rectangles and shows existing ones */}
            <div
              ref={overlayRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={finishDraw}
              onMouseLeave={() => startRef.current && finishDraw()}
              style={{
                position: 'absolute',
                inset: 0,
                cursor: 'crosshair',
              }}
            >
              {pageBlocks.map((b) => {
                const color = blockColor(b, speakers)
                const selected = b.id === selectedId
                return (
                  <div
                    key={b.id}
                    style={{
                      position: 'absolute',
                      left: `${b.rect.x * 100}%`,
                      top: `${b.rect.y * 100}%`,
                      width: `${b.rect.w * 100}%`,
                      height: `${b.rect.h * 100}%`,
                      border: `${selected ? 2 : 1.5}px ${b.type === 'direction' ? 'dashed' : 'solid'} ${color}`,
                      background: selected ? `${color}22` : 'transparent',
                      pointerEvents: 'none',
                      borderRadius: 2,
                    }}
                  >
                    <span
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        onSelect(b.id)
                      }}
                      title={b.text}
                      style={{
                        position: 'absolute',
                        top: -9,
                        left: 2,
                        pointerEvents: 'auto',
                        cursor: 'pointer',
                        background: color,
                        color: 'white',
                        fontSize: 9,
                        lineHeight: '14px',
                        padding: '0 5px',
                        borderRadius: 7,
                        whiteSpace: 'nowrap',
                        fontStyle: b.type === 'direction' ? 'italic' : 'normal',
                        maxWidth: '90%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: 'inline-block',
                      }}
                    >
                      {b.order}. {b.type === 'direction' ? 'Regie' : b.speaker || 'ohne Sprecher'}
                    </span>
                  </div>
                )
              })}

              {draft && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${draft.x * 100}%`,
                    top: `${draft.y * 100}%`,
                    width: `${draft.w * 100}%`,
                    height: `${draft.h * 100}%`,
                    border: '2px dashed #4c6ef5',
                    background: 'rgba(76,110,245,.12)',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </Paper>

      <Text size="xs" c="dimmed">
        Ziehe mit der Maus ein Rechteck um eine Textzeile – der Text wird automatisch aus dem PDF
        übernommen und kann anschließend korrigiert werden.
      </Text>
    </Stack>
  )
}
