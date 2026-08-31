import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Input,
  List,
  Modal,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
} from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle, IconWand } from '@tabler/icons-react'

import {
  detectBlocks,
  guessProfile,
  learnProfile,
  type InlineDirections,
  type LayoutProfile,
} from '../../lib/detect'
import { piecesForPages, type TextPiece } from '../../lib/pdfText'
import { pdfjs } from '../../lib/pdfWorker'
import type { Block } from '../../types'

interface Props {
  opened: boolean
  onClose: () => void
  /** URL of the PDF. The dialog opens its own copy of the document – see below. */
  fileUrl: string
  currentPage: number
  existing: Block[]
  onApply: (blocks: Block[]) => void
}

type Range = 'page' | 'rest' | 'all'

const INLINE_HINT: Record<InlineDirections, string> = {
  strip: 'Einschübe wie „(kostet)“ fallen weg – der kürzeste Weg zu einer sauberen Aufnahme.',
  split:
    'Jeder Einschub wird ein eigener Block und damit mit der Regie-Stimme gelesen, ' +
    'während der Sprechtext bei der Rolle bleibt.',
  keep: 'Die Rolle liest den Einschub samt Klammern mit vor.',
}

/** How many annotated pages are sampled to learn the layout from. */
const LEARN_FROM_PAGES = 5

/**
 * The dialog loads the PDF itself instead of borrowing the document from the
 * canvas editor. react-pdf destroys its document as soon as its component
 * unmounts – which happens on every switch to another tab – and a borrowed
 * reference would then be dead while still looking usable.
 */
export default function AutoDetectModal({
  opened,
  onClose,
  fileUrl,
  currentPage,
  existing,
  onApply,
}: Props) {
  const [range, setRange] = useState<Range>('rest')
  const [inline, setInline] = useState<InlineDirections>('strip')
  const [skipFrontMatter, setSkipFrontMatter] = useState(true)
  const [profile, setProfile] = useState<LayoutProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [found, setFound] = useState<Block[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [emptyPages, setEmptyPages] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [learnedFrom, setLearnedFrom] = useState<number[]>([])
  const docRef = useRef<PDFDocumentProxy | null>(null)

  // Open the document and learn the column layout from the existing blocks.
  useEffect(() => {
    if (!opened) return
    let cancelled = false
    setError(null)
    setFound(null)
    setProfile(null)

    const task = pdfjs.getDocument(fileUrl)
    task.promise
      .then(async (doc) => {
        if (cancelled) return
        docRef.current = doc
        setNumPages(doc.numPages)

        const annotated = [...new Set(existing.map((b) => b.page))]
          .filter((p) => p >= 1 && p <= doc.numPages)
          .sort((a, b) => a - b)
        // A handful of pages is plenty to read the column layout from, and it
        // keeps the dialog quick on a play that is already fully annotated.
        const samplePages = annotated.length
          ? annotated.slice(0, LEARN_FROM_PAGES)
          : [currentPage, currentPage + 1].filter((p) => p >= 1 && p <= doc.numPages)
        setLearnedFrom(annotated)

        const pieces = await piecesForPages(doc, samplePages)
        if (cancelled) return
        setProfile(
          (annotated.length ? learnProfile(pieces, existing) : null) ?? guessProfile(pieces),
        )
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })

    return () => {
      cancelled = true
      docRef.current = null
      // Destroys the loading task and the document it produced.
      void task.destroy()
    }
    // `existing` is read once when the dialog opens; it does not change while
    // it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, fileUrl, currentPage])

  const pagesFor = (r: Range): number[] => {
    if (r === 'page') return [currentPage]
    const from = r === 'rest' ? currentPage : 1
    return Array.from({ length: numPages - from + 1 }, (_, i) => from + i)
  }

  const scan = async () => {
    const doc = docRef.current
    if (!doc || !profile) return
    setBusy(true)
    setProgress(0)
    setError(null)
    try {
      const pages = pagesFor(range)
      const pieces: Map<number, TextPiece[]> = await piecesForPages(doc, pages, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      )
      const maxOrder = existing.reduce((m, b) => Math.max(m, b.order), 0)
      const result = detectBlocks(pieces, profile, existing, maxOrder + 1, {
        inlineDirections: inline,
        skipPagesWithoutDialogue: skipFrontMatter,
      })
      setFound(result.blocks)
      setSkipped(result.skipped)
      setEmptyPages(result.pagesWithoutDialogue)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    if (!found) return
    onApply(found)
    setFound(null)
    onClose()
  }

  const lines = found?.filter((b) => b.type === 'line').length ?? 0
  const directions = found?.filter((b) => b.type === 'direction').length ?? 0
  const speakers = [...new Set(found?.filter((b) => b.speaker).map((b) => b.speaker!))].sort()

  return (
    <Modal opened={opened} onClose={onClose} title="Blöcke automatisch erkennen" size="xl" centered>
      <Stack>
        {profile?.source === 'learned' ? (
          <Alert color="green" icon={<IconInfoCircle size={18} />} title="Muster aus deinen Blöcken gelernt">
            <Text size="sm">
              Aus vorhandenen Blöcken auf {describePages(learnedFrom)}: Sprechernamen und
              Regieanweisungen beginnen bei <Code>{(profile.leftX * 100).toFixed(1)} %</Code> der
              Seitenbreite, der Sprechtext bei <Code>{(profile.speechX * 100).toFixed(1)} %</Code>.
            </Text>
          </Alert>
        ) : profile ? (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Noch nichts zum Lernen da">
            <Text size="sm">
              Die Spalten wurden aus dem Seitenaufbau geraten (
              <Code>{(profile.leftX * 100).toFixed(1)} %</Code> /{' '}
              <Code>{(profile.speechX * 100).toFixed(1)} %</Code>). Zeichne zwei oder drei Blöcke von
              Hand – eine Sprechzeile und eine Regieanweisung genügen –, dann trifft die Erkennung
              deutlich besser.
            </Text>
          </Alert>
        ) : (
          <Text size="sm" c="dimmed">
            Seitenaufbau wird gelesen …
          </Text>
        )}

        <Group align="flex-end" gap="lg">
          <div>
            <Text size="sm" fw={500} mb={4}>
              Bereich
            </Text>
            <SegmentedControl
              value={range}
              onChange={(v) => {
                setRange(v as Range)
                setFound(null)
              }}
              data={[
                { label: `Nur Seite ${currentPage}`, value: 'page' },
                { label: `Ab Seite ${currentPage}`, value: 'rest' },
                { label: numPages ? `Alle ${numPages} Seiten` : 'Alle Seiten', value: 'all' },
              ]}
            />
          </div>
          <Button
            leftSection={<IconWand size={18} />}
            onClick={scan}
            loading={busy}
            disabled={!profile || numPages === 0}
          >
            Durchsuchen
          </Button>
        </Group>

        <Switch
          checked={skipFrontMatter}
          onChange={(e) => {
            setSkipFrontMatter(e.currentTarget.checked)
            setFound(null)
          }}
          label="Seiten ohne Dialog überspringen"
          description="Titelseite, Rechtehinweise und Personenverzeichnis werden sonst zu riesigen Regie-Blöcken."
        />

        <Input.Wrapper
          label="Eingeklammerte Regieanweisungen im Sprechtext"
          description={INLINE_HINT[inline]}
        >
          <SegmentedControl
            mt={6}
            fullWidth
            value={inline}
            onChange={(v) => {
              setInline(v as InlineDirections)
              setFound(null)
            }}
            data={[
              { label: 'entfernen', value: 'strip' },
              { label: 'als eigene Blöcke', value: 'split' },
              { label: 'im Text lassen', value: 'keep' },
            ]}
          />
        </Input.Wrapper>

        {busy && <Progress value={progress} animated />}

        {error && (
          <Alert color="red" title="Erkennung fehlgeschlagen">
            {error}
          </Alert>
        )}

        {found && (
          <>
            <Group gap="xs">
              <Badge color="indigo" variant="light" size="lg">
                {lines} Sprechtext
              </Badge>
              <Badge color="blue" variant="light" size="lg">
                {directions} Regie
              </Badge>
              {skipped > 0 && (
                <Badge color="gray" variant="light" size="lg">
                  {skipped} übersprungen (schon belegt)
                </Badge>
              )}
              {emptyPages.length > 0 && (
                <Badge color="gray" variant="outline" size="lg">
                  {emptyPages.length} {emptyPages.length === 1 ? 'Seite' : 'Seiten'} ohne Dialog
                  übersprungen
                </Badge>
              )}
            </Group>

            {speakers.length > 0 && (
              <Text size="sm">
                Gefundene Sprecher: <b>{speakers.join(', ')}</b>
              </Text>
            )}

            {found.length === 0 ? (
              <Alert color="yellow">
                Nichts gefunden. Stimmen die Spalten? Zeichne einen Block von Hand und öffne diesen
                Dialog erneut.
              </Alert>
            ) : (
              <>
                <Text size="sm" c="dimmed">
                  Vorschau der ersten 20 Blöcke – prüfe vor allem, ob Sprecher und Typ stimmen:
                </Text>
                <ScrollArea h={260} offsetScrollbars>
                  <Table verticalSpacing={4} striped>
                    <Table.Tbody>
                      {found.slice(0, 20).map((b) => (
                        <Table.Tr key={b.id}>
                          <Table.Td w={50}>
                            <Text size="xs" c="dimmed">
                              S.{b.page}
                            </Text>
                          </Table.Td>
                          <Table.Td w={130}>
                            <Text size="xs" fw={600} c={b.type === 'direction' ? 'blue' : undefined}>
                              {b.type === 'direction' ? 'Regie' : b.speaker || 'ohne Sprecher'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" lineClamp={2}>
                              {b.text}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </>
            )}

            <Alert color="gray" variant="light">
              <List size="xs" spacing={2}>
                <List.Item>Vorhandene Blöcke bleiben unverändert.</List.Item>
                <List.Item>
                  Die Vorlese-Reihenfolge wird anschließend nach Seite und Position neu vergeben.
                </List.Item>
                <List.Item>
                  Der Text stammt unverändert aus dem PDF – Fehler im PDF bleiben Fehler und lassen
                  sich in der Blockliste korrigieren.
                </List.Item>
              </List>
            </Alert>
          </>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={apply} disabled={!found || found.length === 0}>
            {found ? `${found.length} Blöcke übernehmen` : 'Übernehmen'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** "Seite 4" / "den Seiten 4, 5 und 6" / "81 Seiten" – je nach Menge. */
function describePages(pages: number[]): string {
  if (pages.length === 0) return 'dieser Seite'
  if (pages.length === 1) return `Seite ${pages[0]}`
  if (pages.length <= 4) {
    const head = pages.slice(0, -1).join(', ')
    return `den Seiten ${head} und ${pages[pages.length - 1]}`
  }
  return `${pages.length} Seiten`
}
