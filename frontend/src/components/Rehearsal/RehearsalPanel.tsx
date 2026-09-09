/**
 * Setting up a rehearsal run: which role, which part of the play, and how much
 * help you want. The run itself lives in RehearsalRun.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { IconAlertTriangle, IconHistory, IconPlayerPlay, IconRepeat } from '@tabler/icons-react'

import { api } from '../../api/client'

import { speakerNames } from '../../lib/blocks'
import { buildSelection, defaultSelection, type SelectionSettings } from '../../lib/selection'
import { store } from '../../lib/store'
import {
  anchorAt,
  buildSteps,
  describeWhen,
  indexOfPage,
  pagesOf,
  resumeIndex,
  statsOf,
  upcomingBlockIDs,
} from '../../lib/rehearsal'
import {
  DIRECTION_KEY,
  type Block,
  // Mantine has a Progress component of its own, and both are on this screen.
  type Progress as SavedProgress,
  type ProgressInput,
  type Project,
  type Speakers,
  type SttInfo,
} from '../../types'
import SelectionCard from '../SynthesizePanel/SelectionCard'
import RehearsalRun, { type RunOptions } from './RehearsalRun'
import { useBlockAudio } from './useBlockAudio'

/** Why the run starts where it starts – this drives the line under the field. */
type StartReason = 'begin' | 'page' | 'page-empty' | 'resume' | 'resume-nearest' | 'resume-lost'

interface StartInfo {
  index: number
  reason: StartReason
}

const shorten = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max).trimEnd()} …` : text

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

  // The saved position is kept here rather than pushed back into the project
  // above: replacing the project object on every write would rebuild the step
  // list mid-run, and the running rehearsal would notice.
  const [progress, setProgress] = useState<SavedProgress | null>(project.progress ?? null)
  const [startPage, setStartPage] = useState<number | null>(null)
  const [resuming, setResuming] = useState(false)
  const [pending, setPending] = useState<'resume' | 'restart' | null>(null)
  const [runIndex, setRunIndex] = useState(0)

  const audio = useBlockAudio(project, blocks, speakers)

  useEffect(() => {
    api.sttInfo().then(setStt).catch(() => setStt(null))
  }, [])

  // The tab unmounts when you switch away, so the position handed down with the
  // project is the one from page load. Asking once on mount keeps the card
  // honest – and picks up a run made in another window.
  useEffect(() => {
    let cancelled = false
    store
      .getProject(project.id)
      .then((p) => !cancelled && setProgress(p.progress ?? null))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [project.id])
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

  const pages = useMemo(() => pagesOf(steps), [steps])
  const firstPage = pages[0] ?? 1
  const lastPage = pages[pages.length - 1] ?? Math.max(1, project.pageCount)

  /**
   * Where the run begins. Both ways in lead here: the remembered position and a
   * page picked by hand ask the same question – which step comes first.
   */
  const startInfo = useMemo((): StartInfo => {
    if (resuming && progress) {
      const point = resumeIndex(steps, progress)
      if (point.match === 'lost') return { index: 0, reason: 'resume-lost' }
      return { index: point.index, reason: point.match === 'exact' ? 'resume' : 'resume-nearest' }
    }
    if (startPage !== null) {
      const i = indexOfPage(steps, startPage)
      return i >= 0 ? { index: i, reason: 'page' } : { index: 0, reason: 'page-empty' }
    }
    return { index: 0, reason: 'begin' }
  }, [resuming, progress, startPage, steps])

  const startStep = steps[startInfo.index]
  const startLabel = startStep?.block
    ? `${startStep.block.type === 'direction' ? 'Regie' : startStep.block.speaker}: „${shorten(startStep.block.text)}“`
    : (startStep?.announce ?? '')

  const startHint = (() => {
    switch (startInfo.reason) {
      case 'page-empty':
        return `Ab Seite ${startPage} liegt nichts in dieser Auswahl – es geht vorne los.`
      case 'resume-lost':
        return 'Die gemerkte Stelle kommt in dieser Auswahl nicht vor – es geht vorne los.'
      case 'begin':
        return 'Der Durchlauf beginnt am Anfang der Auswahl.'
      case 'resume-nearest':
        return `Die gemerkte Replik fehlt in dieser Auswahl – weiter bei ${startLabel} · Schritt ${startInfo.index + 1} von ${stats.total}`
      default:
        return `Beginnt bei ${startLabel} · Schritt ${startInfo.index + 1} von ${stats.total}`
    }
  })()

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
    // Only from the starting point on – rendering the pages before it is time
    // spent on lines this run will never reach.
    const ids = upcomingBlockIDs(steps, startInfo.index, steps.length)
    setPreparing(0)
    for (let i = 0; i < ids.length; i++) {
      await audio.get(ids[i]).catch(() => undefined)
      setPreparing(Math.round(((i + 1) / ids.length) * 100))
    }
    setPreparing(null)
  }

  const start = async (at: number) => {
    setStarting(true)
    try {
      await onBeforeStart()
      setRunIndex(at)
      setRunning(true)
    } finally {
      setStarting(false)
    }
  }

  /**
   * Writing the position down. Errors are swallowed on purpose: a rehearsal
   * that stops because a bookmark could not be saved would be the worse bug.
   */
  const handleProgress = useCallback(
    (i: number, done: boolean) => {
      const block = anchorAt(steps, i)
      if (!block) return
      const body: ProgressInput = {
        blockId: block.id,
        page: block.page,
        order: block.order,
        role,
        index: i,
        total: steps.length,
        selection,
        done,
      }
      store
        .saveProgress(project.id, body)
        .then((p) => setProgress(p.progress ?? null))
        .catch(() => undefined)
    },
    [steps, role, selection, project.id],
  )

  /**
   * Carrying on restores the run the position came from – role and selection
   * first, because a position without the cut it was taken from points at a
   * different line. Starting has to wait for the next render, when the steps
   * have been rebuilt from those settings.
   */
  const resume = () => {
    if (!progress) return
    setRole(progress.role)
    if (progress.selection) setSelection(progress.selection)
    setStartPage(null)
    setResuming(true)
    setPending('resume')
  }

  /** Netflix's "start over": from the top, and the position moves along as usual. */
  const restart = () => {
    setStartPage(null)
    setResuming(false)
    setPending('restart')
  }

  /** Dropping the bookmark without starting anything. */
  const forget = () => {
    setResuming(false)
    store
      .clearProgress(project.id)
      .then(() => setProgress(null))
      .catch(() => undefined)
  }

  useEffect(() => {
    if (pending === null) return
    setPending(null)
    void start(pending === 'resume' ? startInfo.index : 0)
    // `start` is rebuilt on every render; this effect is driven by `pending`
    // alone and reads the starting point of the render that set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, startInfo.index])

  if (running) {
    return (
      <RehearsalRun
        projectId={project.id}
        steps={steps}
        role={role}
        options={options}
        audio={audio}
        startIndex={runIndex}
        onProgress={handleProgress}
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

      {progress && (
        <Card withBorder padding="md" bg="var(--mantine-color-blue-light)">
          <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
            <Stack gap={2}>
              <Group gap="xs">
                <IconHistory size={18} />
                <Text fw={600}>{progress.done ? 'Zuletzt durchgelaufen' : 'Weitermachen'}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {progress.role || 'ohne Rolle'} · Seite {progress.page} · Schritt{' '}
                {progress.index + 1} von {progress.total} · {describeWhen(progress.updatedAt)}
              </Text>
            </Stack>
            <Group gap="xs" wrap="nowrap">
              {!progress.done && (
                <Button
                  leftSection={<IconPlayerPlay size={18} />}
                  onClick={resume}
                  disabled={starting || blocks.length === 0}
                >
                  Weiter ab Seite {progress.page}
                </Button>
              )}
              <Button
                variant={progress.done ? 'filled' : 'light'}
                leftSection={<IconRepeat size={18} />}
                onClick={restart}
                disabled={starting || stats.total === 0}
              >
                Von vorne
              </Button>
              <Button variant="subtle" color="gray" size="compact-sm" onClick={forget}>
                vergessen
              </Button>
            </Group>
          </Group>
        </Card>
      )}

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

          {stats.total > 0 && (
            <Group align="flex-start" gap="sm" wrap="nowrap">
              <NumberInput
                label="Ab Seite"
                description={
                  firstPage === lastPage
                    ? `Auswahl liegt auf S. ${firstPage}`
                    : `Auswahl: S. ${firstPage}–${lastPage}`
                }
                placeholder="von vorn"
                w={170}
                min={firstPage}
                max={lastPage}
                value={startPage ?? ''}
                onChange={(v) => {
                  const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10)
                  setResuming(false)
                  setStartPage(Number.isFinite(n) ? n : null)
                }}
              />
              <Text size="xs" c="dimmed" pt={30} style={{ flex: 1 }}>
                {startHint}
              </Text>
            </Group>
          )}

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
              onClick={() => void start(startInfo.index)}
              loading={starting}
              disabled={stats.total === 0 || preparing !== null}
            >
              {startInfo.index > 0 ? 'Ab hier starten' : 'Probe starten'}
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
