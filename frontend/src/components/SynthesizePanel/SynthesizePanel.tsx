import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  List,
  Progress,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core'
import { IconAlertTriangle, IconDatabase, IconDownload, IconPlayerPlay } from '@tabler/icons-react'

import { ApiError, api } from '../../api/client'
import {
  buildSelection,
  defaultSelection,
  selectionSuffix,
  type SelectionSettings,
} from '../../lib/selection'
import {
  DIRECTION_KEY,
  type Block,
  type CacheStatus,
  type Job,
  type Project,
  type Speakers,
} from '../../types'
import SelectionCard from './SelectionCard'

interface Props {
  project: Project
  blocks: Block[]
  speakers: Speakers
  /** Called before starting, so unsaved edits are persisted first. */
  onBeforeStart: () => Promise<void>
}

export default function SynthesizePanel({ project, blocks, speakers, onBeforeStart }: Props) {
  const [skipMyRole, setSkipMyRole] = useState(false)
  const [includeDirections, setIncludeDirections] = useState(true)
  const [selection, setSelection] = useState<SelectionSettings>({
    ...defaultSelection,
    toPage: Math.max(1, project.pageCount),
  })
  const [job, setJob] = useState<Job | null>(null)
  /** Suffix of the run that produced `job` – the settings may change afterwards. */
  const [jobSuffix, setJobSuffix] = useState('')
  const [starting, setStarting] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cache, setCache] = useState<CacheStatus | null>(null)
  const timer = useRef<number | null>(null)

  const refreshCache = useCallback(() => {
    api.cacheStatus(project.id).then(setCache).catch(() => setCache(null))
  }, [project.id])

  useEffect(() => {
    refreshCache()
  }, [refreshCache])

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [])

  const picked = useMemo(
    () => buildSelection(blocks, project, selection),
    [blocks, project, selection],
  )
  /** Everything below counts only what the current selection actually renders. */
  const inRun = selection.mode === 'all' ? blocks : picked.blocks

  const lines = inRun.filter((b) => b.type === 'line' && b.text.trim() !== '')
  const directions = inRun.filter((b) => b.type === 'direction' && b.text.trim() !== '')
  const myRoleLines = project.myRole
    ? lines.filter((b) => (b.speaker ?? '').toLowerCase() === project.myRole.toLowerCase()).length
    : 0
  const announcements = picked.items.filter((i) => i.announce).length

  const missing = (() => {
    const need = new Set<string>()
    for (const b of lines) if (b.speaker?.trim()) need.add(b.speaker.trim())
    if (includeDirections && directions.length > 0) need.add(DIRECTION_KEY)
    return [...need].filter((k) => !speakers[k]?.model)
  })()

  const poll = (jobId: string) => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = window.setInterval(async () => {
      try {
        const j = await api.jobStatus(project.id, jobId)
        setJob(j)
        if (j.status === 'done' || j.status === 'error') {
          if (timer.current) window.clearInterval(timer.current)
          timer.current = null
          refreshCache()
        }
      } catch (e) {
        setError((e as Error).message)
        if (timer.current) window.clearInterval(timer.current)
        timer.current = null
      }
    }, 1000)
  }

  const start = async () => {
    setStarting(true)
    setProblems([])
    setError(null)
    try {
      await onBeforeStart()
      const j = await api.startSynthesis(project.id, {
        skipMyRole,
        includeDirections,
        // The whole play goes as an empty selection – the server then simply
        // takes every block in order.
        selection: selection.mode === 'all' ? undefined : picked.items,
      })
      setJobSuffix(selectionSuffix(selection))
      setJob(j)
      poll(j.id)
    } catch (e) {
      if (e instanceof ApiError && e.problems?.length) {
        setProblems(e.problems)
      } else {
        setError((e as Error).message)
      }
    } finally {
      setStarting(false)
    }
  }

  const running = job?.status === 'pending' || job?.status === 'running'
  const percent = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0

  return (
    <Stack maw={720}>
      <Title order={4}>Hörfassung erzeugen</Title>

      <Card withBorder padding="md">
        <Stack gap="sm">
          <SelectionCard
            project={project}
            settings={selection}
            onChange={setSelection}
            selection={picked}
            total={blocks.length}
          />

          <Divider my="xs" />

          <Switch
            checked={skipMyRole}
            onChange={(e) => setSkipMyRole(e.currentTarget.checked)}
            label={
              project.myRole
                ? `Meine Rolle (${project.myRole}) als Sprechpause aussparen`
                : 'Eigene Rolle aussparen – erst in der Sprecher-Verwaltung eine Rolle markieren'
            }
            disabled={!project.myRole}
            description={
              project.myRole
                ? `${myRoleLines === 1 ? '1 Replik wird' : `${myRoleLines} Repliken werden`} durch eine Pause ` +
                  'in Originallänge ersetzt – dein Einsatz kommt also zeitlich richtig. ' +
                  'Dafür wird deine Rolle mitsynthetisiert; ohne zugewiesene Stimme gibt es 2,5 s Pause.'
                : undefined
            }
          />
          <Switch
            checked={includeDirections}
            onChange={(e) => setIncludeDirections(e.currentTarget.checked)}
            label="Regieanweisungen mitlesen"
            description={
              directions.length === 1
                ? '1 Regieblock vorhanden.'
                : `${directions.length} Regieblöcke vorhanden.`
            }
          />
          <Text size="sm" c="dimmed">
            {lines.length === 1 ? '1 Sprechblock' : `${lines.length} Sprechblöcke`}
            {selection.mode === 'all' ? ' insgesamt' : ' in der Auswahl'}
            {announcements > 0 &&
              ` · ${announcements === 1 ? '1 Ansage' : `${announcements} Ansagen`}`}
            .
          </Text>

          {missing.length > 0 && (
            <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
              Ohne Stimme:{' '}
              {missing.map((m) => (m === DIRECTION_KEY ? 'Regieanweisungen' : m)).join(', ')}
            </Alert>
          )}

          <Group gap="xs" align="center">
            <IconDatabase size={16} opacity={0.6} />
            <Text size="xs" c="dimmed">
              {cache && cache.files > 0
                ? `${cache.files} Blöcke zwischengespeichert (${formatBytes(cache.bytes)}) – nur geänderte Blöcke werden neu erzeugt.`
                : 'Noch nichts zwischengespeichert – der erste Durchlauf erzeugt alle Blöcke.'}
            </Text>
            {cache && cache.files > 0 && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={async () => {
                  await api.clearCache(project.id).catch(() => undefined)
                  refreshCache()
                }}
              >
                leeren
              </Button>
            )}
          </Group>

          <Group>
            <Button
              leftSection={<IconPlayerPlay size={18} />}
              onClick={start}
              loading={starting || running}
              disabled={lines.length === 0 && directions.length === 0}
            >
              Audio erzeugen
            </Button>
            {running && job && (
              <Button
                variant="subtle"
                color="red"
                onClick={() => api.cancelJob(project.id, job.id).catch(() => undefined)}
              >
                Abbrechen
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {problems.length > 0 && (
        <Alert color="red" title="Es fehlen noch Zuordnungen">
          <List size="sm">
            {problems.map((p) => (
              <List.Item key={p}>{p}</List.Item>
            ))}
          </List>
        </Alert>
      )}

      {error && (
        <Alert color="red" title="Fehler">
          {error}
        </Alert>
      )}

      {job && (
        <Card withBorder padding="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                {job.status === 'done'
                  ? 'Fertig'
                  : job.status === 'error'
                    ? 'Abgebrochen'
                    : 'Synthese läuft'}
              </Text>
              <Text size="xs" c="dimmed">
                {job.done}/{job.total}
              </Text>
            </Group>
            <Progress
              value={job.status === 'done' ? 100 : percent}
              animated={running}
              color={job.status === 'error' ? 'red' : undefined}
            />
            <Text size="xs" c="dimmed">
              {job.message}
            </Text>

            {job.status === 'error' && (
              <Alert color="red" title="Synthese fehlgeschlagen">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                  {job.error}
                </Text>
              </Alert>
            )}

            {job.status === 'done' && (
              <Stack gap="xs">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls style={{ width: '100%' }} src={api.audioUrl(project.id, job.id)} />
                <Group>
                  <Button
                    component="a"
                    href={api.audioUrl(project.id, job.id)}
                    download={`${project.id}${jobSuffix}.${job.format ?? 'wav'}`}
                    variant="light"
                    leftSection={<IconDownload size={16} />}
                  >
                    Herunterladen ({(job.format ?? 'wav').toUpperCase()})
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
