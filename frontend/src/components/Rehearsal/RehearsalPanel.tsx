/**
 * Setting up a rehearsal run: which role, which part of the play, and how much
 * help you want. The run itself lives in RehearsalRun.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core'
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react'

import { api } from '../../api/client'

import { speakerNames } from '../../lib/blocks'
import { buildSelection, defaultSelection, type SelectionSettings } from '../../lib/selection'
import { buildSteps, statsOf, upcomingBlockIDs } from '../../lib/rehearsal'
import {
  DIRECTION_KEY,
  type Block,
  type Project,
  type Speakers,
  type SttInfo,
} from '../../types'
import SelectionCard from '../SynthesizePanel/SelectionCard'
import RehearsalRun, { type RunOptions } from './RehearsalRun'
import { useBlockAudio } from './useBlockAudio'

interface Props {
  project: Project
  blocks: Block[]
  speakers: Speakers
  /** Fixing the text of a block from inside the run. */
  onCorrectBlock: (blockId: string, text: string) => void
  /** Called before starting, so unsaved edits are on the server. */
  onBeforeStart: () => Promise<void>
}

export default function RehearsalPanel({
  project,
  blocks,
  speakers,
  onCorrectBlock,
  onBeforeStart,
}: Props) {
  const [role, setRole] = useState(project.myRole)
  const [selection, setSelection] = useState<SelectionSettings>({
    ...defaultSelection,
    mode: project.myRole ? 'role' : 'all',
    toPage: Math.max(1, project.pageCount),
  })
  const [includeDirections, setIncludeDirections] = useState(true)
  const [options, setOptions] = useState<RunOptions>({
    showText: true,
    revealOwn: false,
    autoAdvance: null,
    record: false,
    analyze: false,
  })
  const [stt, setStt] = useState<SttInfo | null>(null)
  const [running, setRunning] = useState(false)
  const [preparing, setPreparing] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)

  const audio = useBlockAudio(project.id)

  useEffect(() => {
    api.sttInfo().then(setStt).catch(() => setStt(null))
  }, [])
  const roles = useMemo(() => speakerNames(blocks), [blocks])

  // The selection knows "my appearances" – for the rehearsal that has to mean
  // the role picked here, which is not necessarily the project's own role.
  const asRole = useMemo(() => ({ ...project, myRole: role }), [project, role])
  const picked = useMemo(() => buildSelection(blocks, asRole, selection), [blocks, asRole, selection])
  const steps = useMemo(
    () => buildSteps(picked.items, blocks, role, { includeDirections }),
    [picked, blocks, role, includeDirections],
  )
  const stats = statsOf(steps)
  const directions = useMemo(
    () => picked.blocks.filter((b) => b.type === 'direction' && b.text.trim() !== '').length,
    [picked],
  )

  const set = <K extends keyof RunOptions>(key: K, value: RunOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }))

  const missing = useMemo(() => {
    const need = new Set<string>()
    for (const s of steps) {
      const b = s.block
      if (!b) continue
      if (b.type === 'direction') need.add(DIRECTION_KEY)
      else if (b.speaker?.trim()) need.add(b.speaker.trim())
    }
    return [...need].filter((k) => !speakers[k]?.model)
  }, [steps, speakers])

  const roleHasVoice = role !== '' && !!speakers[role]?.model

  const prepare = async () => {
    const ids = upcomingBlockIDs(steps, 0, steps.length)
    setPreparing(0)
    for (let i = 0; i < ids.length; i++) {
      await audio.get(ids[i]).catch(() => undefined)
      setPreparing(Math.round(((i + 1) / ids.length) * 100))
    }
    setPreparing(null)
  }

  const start = async () => {
    setStarting(true)
    try {
      await onBeforeStart()
      setRunning(true)
    } finally {
      setStarting(false)
    }
  }

  if (running) {
    return (
      <RehearsalRun
        projectId={project.id}
        steps={steps}
        role={role}
        options={options}
        audio={audio}
        onCorrectBlock={onCorrectBlock}
        onExit={() => setRunning(false)}
      />
    )
  }

  return (
    <Stack maw={860}>
      <div>
        <Title order={4}>Lernmodus</Title>
        <Text size="sm" c="dimmed">
          Alles wird vorgelesen, bis deine Rolle dran ist. Dann hält die Aufnahme an, du sprichst –
          und danach hörst du, was im Buch steht.
        </Text>
      </div>

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Select
            label="Deine Rolle"
            placeholder="Rolle wählen"
            data={roles}
            value={role === '' ? null : role}
            onChange={(v) => setRole(v ?? '')}
            searchable
            description={
              project.myRole && role !== project.myRole
                ? `Im Projekt ist ${project.myRole} als eigene Rolle eingetragen – hier übst du eine andere.`
                : 'Bei dieser Rolle hält der Durchlauf an und wartet auf dich.'
            }
            w={320}
          />

          <Divider my="xs" label="Welcher Teil" labelPosition="left" />

          <SelectionCard
            project={asRole}
            blocks={blocks}
            settings={selection}
            onChange={setSelection}
            selection={picked}
            total={blocks.length}
          />

          <Switch
            checked={includeDirections}
            onChange={(e) => setIncludeDirections(e.currentTarget.checked)}
            label="Regieanweisungen mitlesen"
            description={
              directions === 0
                ? 'In dieser Auswahl gibt es keine Regieanweisungen.'
                : `Aus überspringt sie – dann hörst du nur die Repliken. ${
                    directions === 1 ? '1 Regieblock' : `${directions} Regieblöcke`
                  } in der Auswahl.`
            }
            disabled={directions === 0}
          />

          <Divider my="xs" label="Wie viel Hilfe" labelPosition="left" />

          <Switch
            checked={options.showText}
            onChange={(e) => set('showText', e.currentTarget.checked)}
            label="Text der anderen mitlesen"
            description="Aus lässt dich nur zuhören – näher an der echten Probe."
          />
          <Switch
            checked={options.revealOwn}
            onChange={(e) => set('revealOwn', e.currentTarget.checked)}
            label="Eigenen Text schon während der Pause zeigen"
            description="Zum ersten Durchgehen. Sonst deckst du ihn bei Bedarf mit einem Klick auf."
          />
          <Group align="flex-end" gap="sm">
            <Switch
              checked={options.autoAdvance !== null}
              onChange={(e) => set('autoAdvance', e.currentTarget.checked ? 15 : null)}
              label="Pause automatisch beenden"
              description="Sonst klickst du selbst, wenn du fertig bist."
            />
            {options.autoAdvance !== null && (
              <NumberInput
                w={120}
                min={2}
                max={120}
                suffix=" s"
                value={options.autoAdvance}
                onChange={(v) => {
                  const n = typeof v === 'number' ? v : Number.parseInt(v, 10)
                  if (Number.isFinite(n)) set('autoAdvance', n)
                }}
              />
            )}
          </Group>
          <Switch
            checked={options.record}
            onChange={(e) => {
              const on = e.currentTarget.checked
              setOptions((o) => ({ ...o, record: on, analyze: on && o.analyze }))
            }}
            label="Mitschneiden, was ich sage"
            description="Die Aufnahme bleibt im Browser und lässt sich direkt nach der Auflösung anhören. Der Durchlauf wartet dann, bis du auf „Weiter“ drückst."
          />
          <Switch
            checked={options.analyze}
            onChange={(e) => set('analyze', e.currentTarget.checked)}
            label="Gesagtes auswerten"
            disabled={!options.record || !stt?.available}
            description={
              !options.record
                ? 'Braucht den Mitschnitt – erst den Schalter darüber einschalten.'
                : stt?.available
                  ? `Der Mitschnitt wird lokal in Text verwandelt (${stt.command}, Modell ${stt.model}) und Wort für Wort mit dem Buch verglichen. Das dauert ein paar Sekunden pro Replik und ist eine Gedächtnisstütze, kein Urteil.`
                  : 'Keine lokale Spracherkennung gefunden – siehe README, Abschnitt Lernmodus.'
            }
          />
        </Stack>
      </Card>

      {role === '' && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          Ohne Rolle wird nur vorgelesen – wähle oben aus, wen du übst.
        </Alert>
      )}
      {role !== '' && !roleHasVoice && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          {role} hat keine Stimme zugewiesen. Die Auflösung zeigt dann nur den Text, ohne ihn
          vorzulesen – im Sprecher-Tab lässt sich das ändern.
        </Alert>
      )}
      {missing.length > 0 && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          Ohne Stimme und daher stumm:{' '}
          {missing.map((m) => (m === DIRECTION_KEY ? 'Regieanweisungen' : m)).join(', ')}
        </Alert>
      )}

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text size="sm">
            {stats.total === 0
              ? 'Diese Auswahl enthält nichts zum Üben.'
              : `${stats.total} Schritte – davon ${stats.speak} eigene ${
                  stats.speak === 1 ? 'Replik' : 'Repliken'
                }.`}
          </Text>

          {preparing !== null ? (
            <Stack gap={4}>
              <Progress value={preparing} animated />
              <Text size="xs" c="dimmed">
                Repliken werden erzeugt … {preparing} %
              </Text>
            </Stack>
          ) : (
            <Text size="xs" c="dimmed">
              Beim ersten Durchlauf wird jede Replik einmal erzeugt, das kostet ein paar Sekunden
              pro Zeile. Danach kommt alles aus dem Zwischenspeicher. „Vorbereiten“ erledigt das
              vorab, damit der Durchlauf ohne Wartezeiten läuft.
            </Text>
          )}

          <Group>
            <Button
              leftSection={<IconPlayerPlay size={18} />}
              onClick={() => void start()}
              loading={starting}
              disabled={stats.total === 0 || preparing !== null}
            >
              Probe starten
            </Button>
            <Button
              variant="light"
              onClick={() => void prepare()}
              loading={preparing !== null}
              disabled={stats.total === 0}
            >
              Vorbereiten
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  )
}
