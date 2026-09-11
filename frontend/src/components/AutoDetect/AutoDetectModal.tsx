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
import { useMediaQuery } from '@mantine/hooks'
import { IconAlertTriangle, IconInfoCircle, IconWand } from '@tabler/icons-react'

import {
  castList,
  chooseProfile,
  detectBlocks,
  type CastEntry,
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

/** Ein paar Seiten quer durchs Stück, die aktuelle darunter. */
function spread(current: number, total: number): number[] {
  const wanted = [current, current + 1]
  for (let i = 1; i <= LEARN_FROM_PAGES; i++) wanted.push(Math.round((total * i) / (LEARN_FROM_PAGES + 1)))
  return [...new Set(wanted)].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
}

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
  const [cast, setCast] = useState<{ entry: CastEntry; found: number }[]>([])
  const [extraRoles, setExtraRoles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [learnedFrom, setLearnedFrom] = useState<number[]>([])
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const schmal = useMediaQuery('(max-width: 62em)') ?? false

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
        //
        // Ohne eigene Blöcke wird über das ganze Stück verteilt geschaut und
        // nicht bloß auf die Seite, die gerade offen ist: Nach dem Import ist
        // das die Titelseite, und auf der spricht niemand.
        const samplePages = annotated.length
          ? annotated.slice(0, LEARN_FROM_PAGES)
          : spread(currentPage, doc.numPages)
        setLearnedFrom(annotated)

        const pieces = await piecesForPages(doc, samplePages)
        if (cancelled) return
        setProfile(chooseProfile(pieces, annotated.length ? existing : []))
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
    setCast([])
    setExtraRoles([])
    try {
      const pages = pagesFor(range)
      const pieces: Map<number, TextPiece[]> = await piecesForPages(doc, pages, (done, total) =>
        setProgress(Math.round((done / total) * 100)),
      )
      /*
       * Jetzt liegen alle Seiten vor, die durchsucht werden sollen – das ist
       * die bessere Grundlage für die Musterwahl als die Handvoll Seiten beim
       * Öffnen. Findet sich hier nichts, bleibt es bei dem, was oben steht.
       */
      const gewaehlt = chooseProfile(pieces, existing) ?? profile
      setProfile(gewaehlt)

      const maxOrder = existing.reduce((m, b) => Math.max(m, b.order), 0)
      const result = detectBlocks(pieces, gewaehlt, existing, maxOrder + 1, {
        inlineDirections: inline,
        skipPagesWithoutDialogue: skipFrontMatter,
      })
      setFound(result.blocks)
      setSkipped(result.skipped)
      setEmptyPages(result.pagesWithoutDialogue)

      /*
       * Der Abgleich mit der Rollenliste des Stücks.
       *
       * Die Zahl in Klammern hinter jedem Namen ist die Zahl der Einsätze,
       * die der Verlag gezählt hat. Sie ist ein Hinweis und keine Vorgabe:
       * Wer sein Textbuch gekürzt hat, hat weniger, und die Erkennung ist
       * deshalb nicht schlechter. Als grober Fehlerzeiger taugt sie trotzdem.
       */
      const liste = castList(pieces)
      const zuRolle = (name: string) =>
        liste.find((e) => e.role.toLowerCase().includes(name.split(' ')[0].toLowerCase()))
      setCast(
        liste.map((entry) => ({
          entry,
          found: Math.max(
            0,
            ...[...result.cues].filter(([n]) => zuRolle(n)?.role === entry.role).map(([, c]) => c),
          ),
        })),
      )
      setExtraRoles([...result.cues.keys()].filter((n) => !zuRolle(n)))
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
    <Modal
      opened={opened}
      onClose={onClose}
      title="Blöcke automatisch erkennen"
      size="xl"
      centered
      fullScreen={schmal}
    >
      <Stack>
        {profile?.source === 'fontStyle' ? (
          <Alert color="green" icon={<IconInfoCircle size={18} />} title="Muster erkannt: fett und kursiv">
            <Text size="sm">
              Nicht Spalten gliedern dieses Stück, sondern die Schrift: Sprechername fett mit
              Doppelpunkt, Regieanweisung kursiv. <Code>{profile.sampleSize}</Code> solcher Namen
              gefunden. Kopfzeile, Fußzeile und Szenenüberschriften bleiben draußen.
            </Text>
          </Alert>
        ) : profile?.source === 'learned' ? (
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

        <Group align="flex-end" gap="lg" grow={schmal}>
          <div>
            <Text size="sm" fw={500} mb={4}>
              Bereich
            </Text>
            <SegmentedControl
              fullWidth={schmal}
              orientation={schmal ? 'vertical' : 'horizontal'}
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
          label={
            profile?.source === 'fontStyle'
              ? 'Kursive Einschübe im Sprechtext'
              : 'Eingeklammerte Regieanweisungen im Sprechtext'
          }
          description={INLINE_HINT[inline]}
        >
          <SegmentedControl
            mt={6}
            fullWidth
            orientation={schmal ? 'vertical' : 'horizontal'}
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

            {cast.length > 0 && (
              <Alert color="gray" variant="light" title="Abgleich mit der Rollenliste des Stücks">
                <Table verticalSpacing={2} withRowBorders={false}>
                  <Table.Tbody>
                    {cast.map(({ entry, found: erkannt }) => (
                      <Table.Tr key={entry.role}>
                        <Table.Td>
                          <Text size="xs">{entry.role}</Text>
                        </Table.Td>
                        <Table.Td w={90}>
                          <Text size="xs" c="dimmed">
                            Liste {entry.cues}
                          </Text>
                        </Table.Td>
                        <Table.Td w={90}>
                          <Text size="xs" c={erkannt === entry.cues ? 'teal' : 'orange'}>
                            erkannt {erkannt}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                <Text size="xs" c="dimmed" mt={6}>
                  Die Zahl in Klammern hinter jeder Rolle ist die Zahl der Einsätze aus dem
                  Textbuch. Sie stimmt nur, solange nichts gekürzt wurde – wo sie um eins oder zwei
                  danebenliegt, lohnt ein Blick, wo sie weit danebenliegt, stimmt etwas anderes
                  nicht.
                  {extraRoles.length > 0 && ` Nicht in der Liste: ${extraRoles.join(', ')}.`}
                </Text>
              </Alert>
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
