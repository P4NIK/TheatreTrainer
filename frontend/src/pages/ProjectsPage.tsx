import { useCallback, useEffect, useState } from 'react'
import {
  ActionIcon,
  Alert,
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
import { IconFilePlus, IconFileTypePdf, IconTrash } from '@tabler/icons-react'

import { api } from '../api/client'
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

  const load = useCallback(async () => {
    try {
      setProjects(await api.listProjects())
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
      const p = await api.createProject(name.trim(), pdf)
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
      await api.deleteProject(p.id)
      await load()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Löschen fehlgeschlagen', message: (e as Error).message })
    }
  }

  return (
    <Container size="md">
      <Group justify="space-between" mb="lg">
        <Title order={2}>Meine Stücke</Title>
        <Button leftSection={<IconFilePlus size={18} />} onClick={() => setModalOpen(true)}>
          Neues Projekt
        </Button>
      </Group>

      {error && (
        <Alert color="red" mb="md" title="Backend nicht erreichbar">
          {error} – läuft der Go-Server auf Port 8080?
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
