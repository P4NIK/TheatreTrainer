import { useMemo, useState } from 'react'
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

import {
  buildSelection,
  defaultSelection,
  selectionSuffix,
  type SelectionSettings,
} from '../../lib/selection'
import { DIRECTION_KEY, type Block, type Project, type Speakers } from '../../types'
import SelectionCard from './SelectionCard'
import { useSynthesis } from './useSynthesis'

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
  // The run happens in this tab now; the hook holds what used to be a job.
  const { state, cache, start: startRun, cancel, clearCache } = useSynthesis(project, blocks, speakers)
  /** Suffix of the run that produced the audio – the settings may change afterwards. */
  const [suffix, setSuffix] = useState('')
  /** Only for a failed save; everything about the run itself is in `state`. */
  const [saveError, setSaveError] = useState('')

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

  const start = async () => {
    setSaveError('')
    try {
      await onBeforeStart()
    } catch (e) {
      setSaveError((e as Error).message)
      return
    }
    setSuffix(selectionSuffix(selection))
    await startRun({
      skipMyRole,
      includeDirections,
      // The whole play goes as an empty selection – then simply every block
      // in order.
      selection: selection.mode === 'all' ? undefined : picked.items,
    })
  }

  const running = state.status === 'running' || state.status === 'voice'
  const percent = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0
  const voicePercent =
    state.voice && state.voice.total > 0
      ? Math.round((state.voice.loaded / state.voice.total) * 100)
      : 0

  return (
    <Stack maw={720}>
      <Title order={4}>Hörfassung erzeugen</Title>

      <Card withBorder padding="md">
        <Stack gap="sm">
          <SelectionCard
            project={project}
            blocks={blocks}
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
                onClick={() => void clearCache()}
              >
                leeren
              </Button>
            )}
          </Group>

          <Group>
            <Button
              leftSection={<IconPlayerPlay size={18} />}
              onClick={start}
              loading={running}
              disabled={lines.length === 0 && directions.length === 0}
            >
              Audio erzeugen
            </Button>
            {running && (
              <Button variant="subtle" color="red" onClick={cancel}>
                Abbrechen
              </Button>
            )}
          </Group>
        </Stack>
      </Card>

      {state.problems.length > 0 && (
        <Alert color="red" title="Es fehlen noch Zuordnungen">
          <List size="sm">
            {state.problems.map((p) => (
              <List.Item key={p}>{p}</List.Item>
            ))}
          </List>
        </Alert>
      )}

      {saveError && (
        <Alert color="red" title="Fehler">
          {saveError}
        </Alert>
      )}

      {state.status !== 'idle' && (
        <Card withBorder padding="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                {state.status === 'done'
                  ? 'Fertig'
                  : state.status === 'error'
                    ? 'Abgebrochen'
                    : state.status === 'voice'
                      ? 'Stimme wird geladen'
                      : 'Synthese läuft'}
              </Text>
              <Text size="xs" c="dimmed">
                {state.status === 'voice' && state.voice
                  ? `${formatBytes(state.voice.loaded)}${state.voice.total ? ` von ${formatBytes(state.voice.total)}` : ''}`
                  : `${state.done}/${state.total}`}
              </Text>
            </Group>
            <Progress
              value={
                state.status === 'done' ? 100 : state.status === 'voice' ? voicePercent : percent
              }
              animated={running}
              color={state.error ? 'red' : undefined}
            />
            <Text size="xs" c="dimmed">
              {state.message}
            </Text>

            {state.error && (
              <Alert color="red" title="Synthese fehlgeschlagen">
                <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                  {state.error}
                </Text>
              </Alert>
            )}

            {state.status === 'done' && state.url && (
              <Stack gap="xs">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls style={{ width: '100%' }} src={state.url} />
                <Group>
                  <Button
                    component="a"
                    href={state.url}
                    download={`${project.id}${suffix}.wav`}
                    variant="light"
                    leftSection={<IconDownload size={16} />}
                  >
                    Herunterladen (WAV)
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
