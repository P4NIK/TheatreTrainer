import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  Tabs,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconArrowLeft,
  IconCards,
  IconDeviceFloppy,
  IconHeadphones,
  IconSchool,
  IconSquareRoundedLetterA,
  IconUsers,
  IconWand,
} from '@tabler/icons-react'

import AutoDetectModal from '../components/AutoDetect/AutoDetectModal'
import Tour from '../components/Tour/Tour'
import { hasSeen, markSeen, onAskForTour, stepsFor, type TabValue } from '../lib/tour'
import BlockEditModal from '../components/BlockList/BlockEditModal'
import BlockList from '../components/BlockList/BlockList'
import PdfCanvasEditor from '../components/PdfCanvasEditor/PdfCanvasEditor'
import CardsPanel from '../components/Rehearsal/CardsPanel'
import RehearsalPanel from '../components/Rehearsal/RehearsalPanel'
import SpeakerConfig from '../components/SpeakerConfig/SpeakerConfig'
import SynthesizePanel from '../components/SynthesizePanel/SynthesizePanel'
import {
  newBlockId,
  nextOrder,
  renumber,
  speakerNames,
  syncSpeakers,
} from '../lib/blocks'
import { closeOtherEngines } from '../lib/engine'
import { guessSpeaker } from '../lib/pdfText'
import { store } from '../lib/store'
import type { Block, Project, Rect, Speakers } from '../types'

interface Props {
  projectId: string
  onBack: () => void
}

const AUTOSAVE_MS = 1200

/**
 * The PDF as something the viewer can open.
 *
 * It used to be an address on the server; now it is a file in this browser,
 * so it has to be turned into a blob URL once and let go of when the play is
 * closed – otherwise every visit leaves a few megabytes behind.
 */
function usePdfUrl(projectId: string, onError: (message: string) => void): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let made = ''
    store
      .getPdfBlob(projectId)
      .then((blob) => {
        if (cancelled) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      })
      // Without this the page would wait for a file that is not coming.
      .catch((e: Error) => onError(e.message))

    return () => {
      cancelled = true
      setUrl(null)
      if (made) URL.revokeObjectURL(made)
    }
  }, [projectId, onError])

  return url
}

export default function EditorPage({ projectId, onBack }: Props) {
  const [project, setProject] = useState<Project | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [speakers, setSpeakers] = useState<Speakers>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'page' | 'all'>('page')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ block: Block; isNew: boolean } | null>(null)
  const [detectOpen, setDetectOpen] = useState(false)

  const pdfUrl = usePdfUrl(projectId, setLoadError)

  /*
   * Auf dem Telefon ist alles ein Zug: der Editor legt PDF und Blockliste
   * untereinander statt nebeneinander, die Kopfzeile wird schmal, und die
   * Reiter zeigen nur ihre Symbole. Fünf Wörter nebeneinander passen auf
   * 390 Punkte nicht, fünf Symbole schon.
   */
  const schmal = useMediaQuery('(max-width: 62em)') ?? false

  // One play at a time: the worker of another one would go on holding its
  // 63 MB of voice for nothing.
  useEffect(() => {
    closeOtherEngines(projectId)
  }, [projectId])

  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)
  const saveTimer = useRef<number | null>(null)

  // --- loading -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    loaded.current = false
    Promise.all([
      store.getProject(projectId),
      store.getBlocks(projectId),
      store.getSpeakers(projectId),
    ])
      .then(([p, b, s]) => {
        if (cancelled) return
        setProject(p)
        setBlocks(b)
        setSpeakers(syncSpeakers(b, s))
        setLoadError(null)
        loaded.current = true
      })
      .catch((e) => !cancelled && setLoadError((e as Error).message))
    return () => {
      cancelled = true
    }
  }, [projectId])

  // --- saving --------------------------------------------------------------
  const save = useCallback(async () => {
    if (!loaded.current) return
    setSaving(true)
    try {
      await store.saveBlocks(projectId, blocks)
      await store.saveSpeakers(projectId, speakers)
      setDirty(false)
    } catch (e) {
      notifications.show({ color: 'red', title: 'Speichern fehlgeschlagen', message: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }, [projectId, blocks, speakers])

  // Debounced autosave whenever blocks or speakers change.
  useEffect(() => {
    if (!loaded.current || !dirty) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void save(), AUTOSAVE_MS)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [blocks, speakers, dirty, save])

  const mutateBlocks = (next: Block[]) => {
    setBlocks(next)
    setSpeakers((s) => syncSpeakers(next, s))
    setDirty(true)
  }

  const mutateSpeakers = (next: Speakers) => {
    setSpeakers(next)
    setDirty(true)
  }

  // --- block editing -------------------------------------------------------
  const onRectDrawn = (rect: Rect, extracted: string) => {
    const guess = guessSpeaker(extracted)
    setDraft({
      isNew: true,
      block: {
        id: newBlockId(),
        page,
        rect,
        order: nextOrder(blocks),
        type: 'line',
        speaker: guess.speaker,
        text: guess.speaker ? guess.rest : extracted,
      },
    })
  }

  /**
   * Takes the result of the edit dialog. That is normally one block, but a
   * block that mixed speech and stage directions comes back as several – the
   * first one keeps the id, the rest slot in behind it.
   */
  const saveDraft = (parts: Block[]) => {
    if (parts.length === 0) return
    const first = parts[0]
    const exists = blocks.some((b) => b.id === first.id)
    const next = exists
      ? blocks.flatMap((b) => (b.id === first.id ? parts : [b]))
      : [...blocks, ...parts]
    mutateBlocks(renumber([...next].sort((a, b) => a.order - b.order)))
    setSelectedId(first.id)
    setDraft(null)
    if (parts.length > 1) {
      notifications.show({
        color: 'green',
        title: 'Block aufgeteilt',
        message: `Aus einem Block wurden ${parts.length}: Sprechtext und Regieanweisungen sind jetzt getrennt.`,
      })
    }
  }

  /** Fixing a wrong text from inside the rehearsal, without leaving the run. */
  const correctBlock = (id: string, text: string) => {
    mutateBlocks(blocks.map((b) => (b.id === id ? { ...b, text } : b)))
  }

  const deleteBlock = (id: string) => {
    mutateBlocks(renumber(blocks.filter((b) => b.id !== id)))
    if (selectedId === id) setSelectedId(null)
  }

  const selectBlock = (id: string) => {
    setSelectedId(id)
    const b = blocks.find((x) => x.id === id)
    if (b && b.page !== page) setPage(b.page)
  }

  const onNumPages = useCallback(
    (n: number) => {
      setProject((p) => {
        if (p && p.pageCount !== n) {
          void store.updateProject(projectId, { pageCount: n }).catch(() => undefined)
          return { ...p, pageCount: n }
        }
        return p
      })
    },
    [projectId],
  )

  /** The premiere caps every flashcard interval, so it lives on the project. */
  const setPremiere = (premiere: string) => {
    if (!project) return
    setProject({ ...project, premiere })
    store
      .updateProject(projectId, { premiere })
      .catch((e) =>
        notifications.show({
          color: 'red',
          title: 'Premierentermin konnte nicht gespeichert werden',
          message: (e as Error).message,
        }),
      )
  }

  const setMyRole = (role: string) => {
    if (!project) return
    setProject({ ...project, myRole: role })
    store
      .updateProject(projectId, { myRole: role })
      .catch((e) =>
        notifications.show({ color: 'red', title: 'Rolle konnte nicht gespeichert werden', message: (e as Error).message }),
      )
  }

  const options = useMemo(() => speakerNames(blocks), [blocks])

  /**
   * Adds automatically detected blocks. The combined list is put back into
   * reading order – page, then position on the page – and renumbered.
   */
  /*
   * Der Reiter wird gesteuert, nicht nur voreingestellt: Die Einführung
   * blättert selbst dorthin, wo der nächste Schritt steht.
   */
  const [tab, setTab] = useState<string | null>('editor')
  const [tour, setTour] = useState<'editor' | 'proben' | null>(() =>
    hasSeen('editor') ? null : 'editor',
  )

  // Das Fragezeichen im Kopf fragt, welche Einführung hierher passt.
  useEffect(() => onAskForTour(() => setTour(tab === 'rehearsal' ? 'proben' : 'editor')), [tab])

  /** Die zweite Einführung wartet, bis der Lernmodus zum ersten Mal offen ist. */
  const reiterWechsel = (wohin: string | null) => {
    setTab(wohin)
    if (wohin === 'rehearsal' && !hasSeen('proben')) setTour('proben')
  }

  const tourZu = () => {
    if (tour) markSeen(tour)
    setTour(null)
  }

  const addDetected = (detected: Block[]) => {
    const merged = [...blocks, ...detected].sort(
      (a, b) => a.page - b.page || a.rect.y - b.rect.y || a.rect.x - b.rect.x,
    )
    mutateBlocks(renumber(merged))
    notifications.show({
      color: 'green',
      title: 'Blöcke übernommen',
      message: `${detected.length} Blöcke hinzugefügt.`,
    })
  }

  if (loadError) {
    return (
      <Box>
        <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} mb="md">
          Zurück
        </Button>
        <Alert color="red" title="Projekt konnte nicht geladen werden">
          {loadError}
        </Alert>
      </Box>
    )
  }

  if (!project || !pdfUrl) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  return (
    <Box>
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Tooltip label="Zur Projektliste">
            <ActionIcon variant="subtle" onClick={onBack} aria-label="Zurück">
              <IconArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Title order={schmal ? 5 : 3} lineClamp={1}>
            {project.name}
          </Title>
          {project.myRole && !schmal && (
            <Badge variant="light" color="indigo">
              meine Rolle: {project.myRole}
            </Badge>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {!schmal && (
            <Text size="xs" c="dimmed">
              {saving ? 'speichert …' : dirty ? 'ungespeicherte Änderungen' : 'gespeichert'}
            </Text>
          )}
          {schmal ? (
            <>
              {/* Auf dem Telefon nur die Symbole – die Namen stehen im Tooltip
                  und die Fläche gewinnt eine halbe Zeile. */}
              <Tooltip label="Automatisch erkennen">
                <ActionIcon
                  data-tour="erkennen"
                  variant="light"
                  size="lg"
                  onClick={() => setDetectOpen(true)}
                  aria-label="Automatisch erkennen"
                >
                  <IconWand size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={dirty ? 'Speichern' : 'Gespeichert'}>
                <ActionIcon
                  variant="light"
                  size="lg"
                  onClick={() => void save()}
                  loading={saving}
                  disabled={!dirty}
                  aria-label="Speichern"
                >
                  <IconDeviceFloppy size={18} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : (
            <>
              <Button
                data-tour="erkennen"
                size="xs"
                variant="light"
                leftSection={<IconWand size={16} />}
                onClick={() => setDetectOpen(true)}
              >
                Automatisch erkennen
              </Button>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={() => void save()}
                loading={saving}
                disabled={!dirty}
              >
                Speichern
              </Button>
            </>
          )}
        </Group>
      </Group>

      <Tabs value={tab} onChange={reiterWechsel} keepMounted={false}>
        <Tabs.List mb="md" grow={schmal} data-tour="reiter">
          <Tabs.Tab
            value="editor"
            leftSection={<IconSquareRoundedLetterA size={18} />}
            aria-label="Editor"
            title="Editor"
          >
            {schmal ? null : 'Editor'}
          </Tabs.Tab>
          <Tabs.Tab
            value="speakers"
            leftSection={<IconUsers size={18} />}
            aria-label="Sprecher"
            title="Sprecher"
          >
            {schmal ? null : 'Sprecher'}
          </Tabs.Tab>
          <Tabs.Tab
            value="audio"
            leftSection={<IconHeadphones size={18} />}
            aria-label="Hörfassung"
            title="Hörfassung"
          >
            {schmal ? null : 'Hörfassung'}
          </Tabs.Tab>
          <Tabs.Tab
            value="rehearsal"
            leftSection={<IconSchool size={18} />}
            aria-label="Lernmodus"
            title="Lernmodus"
          >
            {schmal ? null : 'Lernmodus'}
          </Tabs.Tab>
          <Tabs.Tab
            value="cards"
            leftSection={<IconCards size={18} />}
            aria-label="Karteikarten"
            title="Karteikarten"
          >
            {schmal ? null : 'Karteikarten'}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="editor">
          {/*
            Nebeneinander, solange Platz ist; darunter untereinander. Auf dem
            Telefon bekommt das PDF eine feste Höhe statt der ganzen
            Fensterhöhe – sonst stünde die Blockliste immer unterhalb des
            sichtbaren Bereichs und niemand fände sie.
          */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: schmal ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 340px',
              gap: 16,
              height: schmal ? undefined : 'calc(100vh - 210px)',
            }}
          >
            <div
              data-tour="pdf"
              style={{ height: schmal ? '65vh' : '100%', minHeight: 0, minWidth: 0 }}
            >
            <PdfCanvasEditor
              fileUrl={pdfUrl}
              blocks={blocks}
              speakers={speakers}
              page={page}
              onPageChange={setPage}
              onNumPages={onNumPages}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRectDrawn={onRectDrawn}
            />
            </div>
            <div data-tour="blockliste" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <BlockList
              projectId={projectId}
              blocks={blocks}
              speakers={speakers}
              page={page}
              filter={filter}
              onFilterChange={setFilter}
              selectedId={selectedId}
              onSelect={selectBlock}
              onEdit={(b) => setDraft({ block: b, isNew: false })}
              onDelete={deleteBlock}
              onReorder={mutateBlocks}
            />
            </div>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="speakers">
          <SpeakerConfig
            projectId={project.id}
            blocks={blocks}
            speakers={speakers}
            onChange={mutateSpeakers}
            myRole={project.myRole}
            onMyRoleChange={setMyRole}
          />
        </Tabs.Panel>

        <Tabs.Panel value="audio">
          <SynthesizePanel
            project={project}
            blocks={blocks}
            speakers={speakers}
            onBeforeStart={save}
          />
        </Tabs.Panel>

        <Tabs.Panel value="rehearsal">
          <RehearsalPanel
            project={project}
            blocks={blocks}
            speakers={speakers}
            onCorrectBlock={correctBlock}
            onBeforeStart={save}
          />
        </Tabs.Panel>

        <Tabs.Panel value="cards">
          <CardsPanel
            project={project}
            blocks={blocks}
            speakers={speakers}
            onCorrectBlock={correctBlock}
            onBeforeStart={save}
            onPremiereChange={setPremiere}
          />
        </Tabs.Panel>
      </Tabs>

      {tour && (
        <Tour
          steps={stepsFor(tour, schmal)}
          onClose={tourZu}
          onTab={(wohin: TabValue) => setTab(wohin)}
        />
      )}

      <AutoDetectModal
        opened={detectOpen}
        onClose={() => setDetectOpen(false)}
        fileUrl={pdfUrl}
        currentPage={page}
        existing={blocks}
        onApply={addDetected}
      />

      <BlockEditModal
        block={draft?.block ?? null}
        isNew={draft?.isNew ?? false}
        speakerOptions={options}
        onSave={saveDraft}
        onClose={() => setDraft(null)}
      />
    </Box>
  )
}
