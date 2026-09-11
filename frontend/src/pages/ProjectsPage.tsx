import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  FileInput,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconDownload,
  IconFilePlus,
  IconFileTypePdf,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'

import { closeEngine } from '../lib/engine'
import { hasSeen, markSeen, onAskForTour, stepsFor } from '../lib/tour'
import Tour from '../components/Tour/Tour'
import { store } from '../lib/store'
import type { Project } from '../types'

interface Props {
  onOpen: (id: string) => void
}

export default function ProjectsPage({ onOpen }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')
  const [pdf, setPdf] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /*
   * Die Einführung: beim allerersten Besuch von selbst, später über das
   * Fragezeichen im Seitenkopf.
   */
  const touch = useMediaQuery('(pointer: coarse)') ?? false
  const [tour, setTour] = useState(() => !hasSeen('stuecke'))
  useEffect(() => onAskForTour(() => setTour(true)), [])
  const tourZu = () => {
    markSeen('stuecke')
    setTour(false)
  }

  const load = useCallback(async () => {
    try {
      setProjects(await store.listProjects())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      setProjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim() || !pdf) return
    setBusy(true)
    try {
      const p = await store.createProject(name.trim(), pdf)
      setModalOpen(false)
      setName('')
      setPdf(null)
      onOpen(p.id)
    } catch (e) {
      notifications.show({ color: 'red', title: 'Anlegen fehlgeschlagen', message: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Project) => {
    if (!window.confirm(`Projekt "${p.name}" mit PDF und Audio wirklich löschen?`)) return
    try {
      await store.deleteProject(p.id)
      closeEngine(p.id)
      await load()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Löschen fehlgeschlagen', message: (e as Error).message })
    }
  }

  /**
   * The backup. Without a server this is the only copy that survives a browser
   * clearing its storage – and it is how a play gets onto a second device.
   */
  const save = async (p: Project) => {
    try {
      const data = await store.exportProject(p.id)
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${p.id}.theater.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Sicherungskopie fehlgeschlagen',
        message: (e as Error).message,
      })
    }
  }

  const restore = async (file: File | null) => {
    if (!file) return
    try {
      const p = await store.importProject(JSON.parse(await file.text()))
      await load()
      notifications.show({ color: 'green', message: `„${p.name}" ist wieder da.` })
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Sicherungskopie konnte nicht gelesen werden',
        message: (e as Error).message,
      })
    }
  }

  return (
    <Container size="md">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Meine Stücke</Title>
        <Group gap="xs">
          <Button
            data-tour="sicherung"
            variant="default"
            leftSection={<IconUpload size={18} />}
            onClick={() => fileInput.current?.click()}
          >
            Sicherungskopie öffnen
          </Button>
          <Button
            data-tour="neues-projekt"
            leftSection={<IconFilePlus size={18} />}
            onClick={() => setModalOpen(true)}
          >
            Neues Projekt
          </Button>
        </Group>
      </Group>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void restore(e.currentTarget.files?.[0] ?? null)
          e.currentTarget.value = ''
        }}
      />

      {error && (
        <Alert color="red" mb="md" title="Der Browser-Speicher ließ sich nicht lesen">
          {error}
        </Alert>
      )}

      {projects === null ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : projects.length === 0 ? (
        <Card withBorder padding="xl">
          <Stack align="center" gap="xs">
            <IconFileTypePdf size={40} opacity={0.4} />
            <Text fw={500}>Noch kein Projekt angelegt</Text>
            <Text size="sm" c="dimmed" ta="center">
              Lade ein Theaterstück als PDF hoch, markiere die Sprechblöcke und lass sie dir vorlesen.
            </Text>
            <Button mt="sm" variant="light" onClick={() => setModalOpen(true)}>
              Erstes Projekt anlegen
            </Button>
          </Stack>
        </Card>
      ) : (
        <Stack gap="sm">
          {projects.map((p) => (
            <Card key={p.id} withBorder padding="md">
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text fw={600} truncate>
                    {p.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    angelegt am {new Date(p.createdAt).toLocaleDateString('de-DE')}
                    {p.myRole ? ` · meine Rolle: ${p.myRole}` : ''}
                  </Text>
                </div>
                <Group gap="xs" wrap="nowrap">
                  <Button variant="light" onClick={() => onOpen(p.id)}>
                    Öffnen
                  </Button>
                  <Tooltip label="Sicherungskopie speichern">
                    <ActionIcon variant="subtle" onClick={() => save(p)}>
                      <IconDownload size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Projekt löschen">
                    <ActionIcon variant="subtle" color="red" onClick={() => remove(p)}>
                      <IconTrash size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      <Text size="xs" c="dimmed" mt="xl">
        Alle Stücke liegen in diesem Browser, nicht auf einem Server. Das ist schnell und kostet
        nichts – aber wer den Browser-Speicher löscht, löscht sie mit. Eine Sicherungskopie ist eine
        Datei und dauert einen Klick.{' '}
        <Anchor
          data-tour="technik"
          size="xs"
          component="button"
          type="button"
          onClick={() => (window.location.hash = '#/technik')}
        >
          Läuft alles auf diesem Gerät?
        </Anchor>
      </Text>

      {tour && <Tour steps={stepsFor('stuecke', touch)} onClose={tourZu} />}

      <Modal opened={modalOpen} onClose={() => setModalOpen(false)} title="Neues Projekt" centered>
        <Stack>
          <TextInput
            label="Name des Stücks"
            placeholder="z. B. Hamlet"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            data-autofocus
          />
          <FileInput
            label="PDF des Stücks"
            placeholder="Datei auswählen"
            accept="application/pdf"
            value={pdf}
            onChange={setPdf}
            leftSection={<IconFileTypePdf size={16} />}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setModalOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={create} loading={busy} disabled={!name.trim() || !pdf}>
              Anlegen
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  )
}
