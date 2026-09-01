import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  IconDeviceFloppy,
  IconHeadphones,
  IconSchool,
  IconSquareRoundedLetterA,
  IconUsers,
  IconWand,
} from '@tabler/icons-react'

import { api } from '../api/client'
import AutoDetectModal from '../components/AutoDetect/AutoDetectModal'
import BlockEditModal from '../components/BlockList/BlockEditModal'
import BlockList from '../components/BlockList/BlockList'
import PdfCanvasEditor from '../components/PdfCanvasEditor/PdfCanvasEditor'
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
import { guessSpeaker } from '../lib/pdfText'
import type { Block, Project, Rect, Speakers } from '../types'

interface Props {
  projectId: string
  onBack: () => void
}

const AUTOSAVE_MS = 1200

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

  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const loaded = useRef(false)
  const saveTimer = useRef<number | null>(null)

  // --- loading -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    loaded.current = false
    Promise.all([
      api.getProject(projectId),
      api.getBlocks(projectId),
      api.getSpeakers(projectId),
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
      await api.saveBlocks(projectId, blocks)
      await api.saveSpeakers(projectId, speakers)
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
          void api.updateProject(projectId, { pageCount: n }).catch(() => undefined)
          return { ...p, pageCount: n }
        }
        return p
      })
    },
    [projectId],
  )

  const setMyRole = (role: string) => {
    if (!project) return
    setProject({ ...project, myRole: role })
    api
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

  if (!project) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  return (
    <Box>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Tooltip label="Zur Projektliste">
            <ActionIcon variant="subtle" onClick={onBack} aria-label="Zurück">
              <IconArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Title order={3}>{project.name}</Title>
          {project.myRole && (
            <Badge variant="light" color="indigo">
              meine Rolle: {project.myRole}
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {saving ? 'speichert …' : dirty ? 'ungespeicherte Änderungen' : 'gespeichert'}
          </Text>
          <Button
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
        </Group>
      </Group>

      <Tabs defaultValue="editor" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="editor" leftSection={<IconSquareRoundedLetterA size={16} />}>
            Editor
          </Tabs.Tab>
          <Tabs.Tab value="speakers" leftSection={<IconUsers size={16} />}>
            Sprecher
          </Tabs.Tab>
          <Tabs.Tab value="audio" leftSection={<IconHeadphones size={16} />}>
            Hörfassung
          </Tabs.Tab>
          <Tabs.Tab value="rehearsal" leftSection={<IconSchool size={16} />}>
            Lernmodus
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="editor">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 340px',
              gap: 16,
              height: 'calc(100vh - 210px)',
            }}
          >
            <PdfCanvasEditor
              fileUrl={api.pdfUrl(projectId)}
              blocks={blocks}
              speakers={speakers}
              page={page}
              onPageChange={setPage}
              onNumPages={onNumPages}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRectDrawn={onRectDrawn}
            />
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
        </Tabs.Panel>

        <Tabs.Panel value="speakers">
          <SpeakerConfig
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
            onBeforeStart={save}
          />
        </Tabs.Panel>
      </Tabs>

      <AutoDetectModal
        opened={detectOpen}
        onClose={() => setDetectOpen(false)}
        fileUrl={api.pdfUrl(projectId)}
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
