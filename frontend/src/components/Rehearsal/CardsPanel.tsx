/**
 * Flashcards: the lines of your role, dealt out by how badly they are needed.
 *
 * The sitting itself is the rehearsal run with the judgement switched on – cue,
 * pause, resolution, and then three buttons. Everything new lives here: which
 * line is wanted today, and where a line that did not sit goes back into the
 * evening. The maths behind both is in lib/cards.ts, where a test can pin it
 * down.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconAlertTriangle, IconCards, IconPlayerPlay, IconTrash } from '@tabler/icons-react'


import { speakerNames } from '../../lib/blocks'
import {
  BOX_DAYS,
  buildDeck,
  cardSteps,
  dayKey,
  daysToPremiere,
  deckStats,
  describeDue,
  MAX_BOX,
  requeue,
  review,
  sessionDelay,
  sessionQueue,
  type DeckFilter,
} from '../../lib/cards'
import { upcomingBlockIDs, type Step } from '../../lib/rehearsal'
import { store } from '../../lib/store'
import {
  bool,
  globalKey,
  num,
  numOrNull,
  oneOf,
  pick,
  projectKey,
  str,
  usePrefs,
  useRisk,
  wasDefused,
  forgetDefused,
} from '../../lib/prefs'
import {
  buildSelection,
  defaultSelection,
  readSelection,
  type SelectionSettings,
} from '../../lib/selection'
import {
  DIRECTION_KEY,
  type Block,
  // Mantine has a Card component, and both are on this screen.
  type Card as CardState,
  type Deck,
  type Grade,
  type Project,
  type Speakers,
} from '../../types'
import SelectionCard from '../SynthesizePanel/SelectionCard'
import RehearsalRun from './RehearsalRun'
import { readRunOptions, type RunOptions } from './runOptions'
import { useBlockAudio } from './useBlockAudio'
import { sttHint, useStt } from './useStt'

/** „Diese Sitzung“ – dieselbe Gewohnheit für jedes Stück. */
const SITZUNG_KEY = globalKey('karten')
/** Der Schalter, der die Seite umbringen kann. */
const AUSWERTEN = { pref: SITZUNG_KEY, field: 'analyze' }

/** One colour per Leitner box, from "just started" to "sits". */
const BOX_COLORS = ['red', 'orange', 'yellow', 'lime', 'teal', 'green']

interface Tally {
  again: number
  hard: number
  good: number
}

const NO_GRADES: Tally = { again: 0, hard: 0, good: 0 }

interface Props {
  project: Project
  blocks: Block[]
  speakers: Speakers
  /** Fixing the text of a block from inside the sitting. */
  onCorrectBlock: (blockId: string, text: string) => void
  /** Called before starting, so unsaved edits are on the server. */
  onBeforeStart: () => Promise<void>
  /** The premiere lives on the project – it caps every interval. */
  onPremiereChange: (premiere: string) => void
}

export default function CardsPanel({
  project,
  blocks,
  speakers,
  onCorrectBlock,
  onBeforeStart,
  onPremiereChange,
}: Props) {
  /* Rolle und Ausschnitt gehören zu diesem Stück. */
  const [stueck, setStueck] = usePrefs(projectKey(project.id, 'karten'), (raw) => {
    const role = str(pick(raw, 'role'), project.myRole)
    return {
      role,
      selection: readSelection(pick(raw, 'selection'), project.pageCount, role !== '', {
        ...defaultSelection,
        toPage: Math.max(1, project.pageCount),
      }),
    }
  })
  const { role, selection } = stueck
  const setRole = useCallback((wer: string) => setStueck((s) => ({ ...s, role: wer })), [setStueck])
  const setSelection = useCallback(
    (next: SelectionSettings) => setStueck((s) => ({ ...s, selection: next })),
    [setStueck],
  )

  /*
   * Wie eine Sitzung aussehen soll, gehört zur Person: nur Fälliges oder
   * alles, wie viele Karten, wie viel Stichwort – und die Schalter des
   * Durchlaufs, die im Lernmodus dieselben sind.
   */
  const [sitzung, setSitzung] = usePrefs(SITZUNG_KEY, (raw) => ({
    filter: oneOf(pick(raw, 'filter'), ['due', 'all'] as const, 'due'),
    limit: numOrNull(pick(raw, 'limit'), 20, 1, 500),
    cueCount: num(pick(raw, 'cueCount'), 1, 0, 3),
    includeDirections: bool(pick(raw, 'includeDirections'), true),
    ...readRunOptions(raw),
  }))
  const { filter, limit, cueCount, includeDirections } = sitzung
  const options = useMemo<RunOptions>(
    () => ({
      showText: sitzung.showText,
      revealOwn: sitzung.revealOwn,
      autoAdvance: sitzung.autoAdvance,
      record: sitzung.record,
      analyze: sitzung.analyze,
    }),
    [sitzung],
  )
  const setFilter = (was: DeckFilter) => setSitzung((s) => ({ ...s, filter: was }))
  const setLimit = (wie: number | null) => setSitzung((s) => ({ ...s, limit: wie }))
  const setCueCount = (wie: number) => setSitzung((s) => ({ ...s, cueCount: wie }))
  const setIncludeDirections = (an: boolean) => setSitzung((s) => ({ ...s, includeDirections: an }))

  /* Dieselbe Zündschnur wie im Lernmodus, an ihrem eigenen Schalter. */
  useRisk(AUSWERTEN, sitzung.analyze)
  const [abgestuerzt, setAbgestuerzt] = useState(() => wasDefused(AUSWERTEN))

  const [cards, setCards] = useState<Deck>({})
  const [loading, setLoading] = useState(true)
  const stt = useStt()
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [preparing, setPreparing] = useState<number | null>(null)

  // The sitting: a step list that grows as cards are put back into it.
  const [steps, setSteps] = useState<Step[]>([])
  const [tally, setTally] = useState<Tally>(NO_GRADES)

  const audio = useBlockAudio(project, blocks, speakers)

  useEffect(() => {
    let cancelled = false
    store
      .getCards(project.id)
      .then((d) => !cancelled && setCards(d))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [project.id])

  const roles = useMemo(() => speakerNames(blocks), [blocks])
  const ordered = useMemo(() => [...blocks].sort((a, b) => a.order - b.order), [blocks])

  // Fixed for as long as the panel is open: a sitting that crossed midnight and
  // silently re-sorted itself would be worse than one day out of date.
  const today = useMemo(() => dayKey(new Date()), [])
  const toPremiere = daysToPremiere(project.premiere, today)

  const asRole = useMemo(() => ({ ...project, myRole: role }), [project, role])
  const picked = useMemo(() => buildSelection(blocks, asRole, selection), [blocks, asRole, selection])
  const inSelection = useMemo(() => new Set(picked.blocks.map((b) => b.id)), [picked])

  const deck = useMemo(() => {
    const all = buildDeck(blocks, role, cards, today)
    return selection.mode === 'all' ? all : all.filter((e) => inSelection.has(e.block.id))
  }, [blocks, role, cards, today, selection.mode, inSelection])

  const stats = useMemo(() => deckStats(deck), [deck])
  const queue = useMemo(() => sessionQueue(deck, filter, limit), [deck, filter, limit])
  const cues = useMemo(() => ({ includeDirections }), [includeDirections])
  const planned = useMemo(
    () => queue.flatMap((e) => cardSteps(e.block, ordered, cueCount, cues)),
    [queue, ordered, cueCount, cues],
  )

  /** Stage directions in reach of a cue – what the switch below has to work on. */
  const directions = useMemo(
    () => picked.blocks.filter((b) => b.type === 'direction' && b.text.trim() !== '').length,
    [picked],
  )

  const set = <K extends keyof RunOptions>(key: K, value: RunOptions[K]) =>
    setSitzung((s) => ({ ...s, [key]: value }))

  const missing = useMemo(() => {
    const need = new Set<string>()
    for (const s of planned) {
      const b = s.block
      if (!b) continue
      if (b.type === 'direction') need.add(DIRECTION_KEY)
      else if (b.speaker?.trim()) need.add(b.speaker.trim())
    }
    return [...need].filter((k) => !speakers[k]?.model)
  }, [planned, speakers])

  /**
   * A grading moves two clocks at once: the Leitner box for the coming days,
   * and the sitting itself, where a line that did not sit comes round again.
   * Storage failures are swallowed – a rehearsal that stops because a card
   * could not be written would be the worse bug.
   */
  const handleGrade = useCallback(
    (blockId: string, grade: Grade, at: number) => {
      const next: CardState = review(cards[blockId], grade, new Date(), project.premiere)
      setCards((d) => ({ ...d, [blockId]: next }))
      store
        .saveCards(project.id, { [blockId]: next })
        .then(setCards)
        .catch(() => undefined)

      setTally((t) => ({ ...t, [grade]: t[grade] + 1 }))

      const delay = sessionDelay(grade)
      if (delay === 0) return
      const block = ordered.find((b) => b.id === blockId)
      if (!block) return
      setSteps((prev) => requeue(prev, at, cardSteps(block, ordered, cueCount, cues), delay))
    },
    [cards, project.id, project.premiere, ordered, cueCount, cues],
  )

  const prepare = async () => {
    const ids = upcomingBlockIDs(planned, 0, planned.length)
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
      // Ein gemerkter Schalter lädt nichts beim Öffnen des Reiters – die
      // 200 MB kommen erst, wenn wirklich eine Sitzung beginnt.
      if (options.analyze && !stt.ready) await stt.load()
      setSteps(planned)
      setTally(NO_GRADES)
      setRunning(true)
    } finally {
      setStarting(false)
    }
  }

  const resetDeck = () => {
    store
      .clearCards(project.id)
      .then(() => setCards({}))
      .catch(() => undefined)
  }

  if (running) {
    const graded = tally.again + tally.hard + tally.good
    return (
      <RehearsalRun
        steps={steps}
        role={role}
        options={options}
        audio={audio}
        onGrade={handleGrade}
        done={{
          title: 'Sitzung beendet',
          summary:
            graded === 0
              ? 'Keine Karte bewertet – am Lernstand hat sich nichts geändert.'
              : `${graded} ${graded === 1 ? 'Karte' : 'Karten'} bewertet · ${tally.good} saßen, ` +
                `${tally.hard} wackelig, ${tally.again} daneben.`,
        }}
        onCorrectBlock={onCorrectBlock}
        onExit={() => setRunning(false)}
      />
    )
  }

  const boxSections = stats.byBox.map((count, i) => ({
    value: stats.total === 0 ? 0 : (count / stats.total) * 100,
    color: BOX_COLORS[i],
    label: `Fach ${i + 1}`,
    count,
  }))

  return (
    <Stack maw={860}>
      <div>
        <Title order={4}>Karteikarten</Title>
        <Text size="sm" c="dimmed">
          Jede Replik deiner Rolle ist eine Karte: Du hörst das Stichwort, sprichst – und sagst
          danach selbst, ob es saß. Was saß, kommt seltener wieder; was daneben ging, noch in
          dieser Sitzung.
        </Text>
      </div>

      <Card withBorder padding="md" data-tour="stapel">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <Group gap="xs">
              <IconCards size={20} />
              <Text fw={600}>Der Stapel</Text>
              {loading && (
                <Text size="xs" c="dimmed">
                  wird geladen …
                </Text>
              )}
            </Group>
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              leftSection={<IconTrash size={14} />}
              onClick={resetDeck}
              disabled={stats.total === 0}
            >
              Lernstand zurücksetzen
            </Button>
          </Group>

          {stats.total === 0 ? (
            <Text size="sm" c="dimmed">
              {role === ''
                ? 'Wähle unten deine Rolle – daraus entsteht der Stapel.'
                : `Für ${role} ist in dieser Auswahl keine Replik markiert.`}
            </Text>
          ) : (
            <>
              <Group gap="xs">
                <Badge color={stats.due === 0 ? 'gray' : 'blue'} variant="light">
                  {stats.due} fällig
                </Badge>
                <Badge color="gray" variant="light">
                  {stats.fresh} neu
                </Badge>
                <Badge color="green" variant="light">
                  {stats.solid} sitzen
                </Badge>
                <Text size="xs" c="dimmed">
                  von {stats.total} {stats.total === 1 ? 'Replik' : 'Repliken'}
                </Text>
              </Group>

              <Progress.Root size="lg">
                {boxSections.map((s) =>
                  s.count === 0 ? null : (
                    <Tooltip
                      key={s.label}
                      label={`${s.label}: ${s.count} ${s.count === 1 ? 'Replik' : 'Repliken'}`}
                    >
                      <Progress.Section value={s.value} color={s.color} />
                    </Tooltip>
                  ),
                )}
              </Progress.Root>
              <Text size="xs" c="dimmed">
                Von links nach rechts: Fach 1 bis {MAX_BOX}. Je weiter rechts, desto länger
                bleibt eine Replik liegen – im letzten Fach {BOX_DAYS[MAX_BOX - 1]} Tage.
              </Text>
            </>
          )}

          <Divider my="xs" />

          <Group align="flex-end" gap="sm">
            <TextInput
              type="date"
              label="Premiere"
              description="Leer lassen, wenn kein Termin feststeht"
              w={200}
              value={project.premiere}
              onChange={(e) => onPremiereChange(e.currentTarget.value)}
            />
            <Text size="xs" c="dimmed" pb={8}>
              {toPremiere === null
                ? 'Ohne Termin gelten die vollen Abstände bis zu 35 Tagen.'
                : toPremiere === 0
                  ? 'Heute ist es so weit – alle Karten sind fällig.'
                  : `Noch ${toPremiere} ${toPremiere === 1 ? 'Tag' : 'Tage'}: kein Abstand geht ` +
                    `über den Vortag hinaus, damit keine Replik die Premiere überspringt.`}
            </Text>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Select
            label="Deine Rolle"
            placeholder="Rolle wählen"
            data={roles}
            value={role === '' ? null : role}
            onChange={(v) => setRole(v ?? '')}
            searchable
            description="Aus ihren Repliken besteht der Stapel."
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

          <Divider my="xs" label="Diese Sitzung" labelPosition="left" />

          <Group align="flex-end" gap="sm" wrap="nowrap" data-tour="stichwort">
            <SegmentedControl
              value={filter}
              onChange={(v) => setFilter(v as DeckFilter)}
              data={[
                { value: 'due', label: 'Nur Fälliges' },
                { value: 'all', label: 'Alles' },
              ]}
            />
            <NumberInput
              label="Höchstens"
              description="Karten in dieser Sitzung"
              placeholder="ohne Grenze"
              w={170}
              min={1}
              max={500}
              value={limit ?? ''}
              onChange={(v) => {
                const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10)
                setLimit(Number.isFinite(n) ? n : null)
              }}
            />
            <NumberInput
              label="Stichwort"
              description="Repliken davor"
              w={150}
              min={0}
              max={3}
              value={cueCount}
              onChange={(v) => {
                const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10)
                if (Number.isFinite(n)) setCueCount(n)
              }}
            />
          </Group>

          <Switch
            checked={includeDirections}
            onChange={(e) => setIncludeDirections(e.currentTarget.checked)}
            label="Regieanweisungen als Stichwort zulassen"
            disabled={cueCount === 0 || directions === 0}
            description={
              cueCount === 0
                ? 'Ohne Stichwort gibt es nichts zu überspringen.'
                : directions === 0
                  ? 'In dieser Auswahl gibt es keine Regieanweisungen.'
                  : `Aus überspringt sie: Der Einsatz ist dann die letzte gesprochene Replik, nicht ` +
                    `die Anweisung davor. ${
                      directions === 1 ? '1 Regieblock' : `${directions} Regieblöcke`
                    } in der Auswahl.`
            }
          />

          <Divider my="xs" label="Wie viel Hilfe" labelPosition="left" />

          <Switch
            checked={options.showText}
            onChange={(e) => set('showText', e.currentTarget.checked)}
            label="Stichwort mitlesen"
            description="Aus heißt: nur hören, wie auf der Bühne."
          />
          <Switch
            checked={options.revealOwn}
            onChange={(e) => set('revealOwn', e.currentTarget.checked)}
            label="Eigenen Text schon während der Pause zeigen"
            description="Für den ersten Durchgang. Sonst deckst du ihn bei Bedarf mit einem Klick auf."
          />
          <Switch
            checked={options.record}
            onChange={(e) => {
              const on = e.currentTarget.checked
              setSitzung((s) => ({ ...s, record: on, analyze: on && s.analyze }))
            }}
            label="Mitschneiden, was ich sage"
            description="Die Aufnahme bleibt im Browser und lässt sich vor der Bewertung anhören."
          />
          {abgestuerzt && (
            <Alert
              color="orange"
              icon={<IconAlertTriangle size={18} />}
              withCloseButton
              onClose={() => {
                forgetDefused(AUSWERTEN)
                setAbgestuerzt(false)
              }}
            >
              Beim letzten Mal hat die Seite das Auswerten nicht überlebt – deshalb ist der
              Schalter jetzt aus. Einschalten geht wieder; eine Sitzung läuft auch ohne
              Auswertung.
            </Alert>
          )}
          <Switch
            checked={options.analyze}
            onChange={(e) => {
              const an = e.currentTarget.checked
              set('analyze', an)
              // Lieber jetzt laden, mit Fortschritt, als bei der ersten Replik.
              if (an) void stt.load()
            }}
            label="Gesagtes auswerten"
            disabled={!options.record}
            description={
              !options.record
                ? 'Braucht den Mitschnitt – erst den Schalter darüber einschalten.'
                : `${sttHint(stt)} Der Vergleich wählt einen der drei Knöpfe vor; entscheiden tust du – die Erkennung verhört sich zu oft, um über den Stapel zu bestimmen.`
            }
          />
        </Stack>
      </Card>

      {role === '' && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          Ohne Rolle gibt es nichts zu üben – wähle oben aus, wen du lernst.
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
            {queue.length === 0
              ? filter === 'due'
                ? 'Heute ist nichts fällig. Mit „Alles" gehst du den Stapel trotzdem durch.'
                : 'In dieser Auswahl liegt keine Karte.'
              : `${queue.length} ${queue.length === 1 ? 'Karte' : 'Karten'} in dieser Sitzung – ` +
                `angefangen bei „${describeDue(queue[0])}".`}
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
              Danebengegangene Karten kommen drei Karten später noch einmal, wackelige zehn – so
              wird eine lange Sitzung von selbst zur Wiederholung. „Vorbereiten“ erzeugt vorab
              alle Stichworte und Repliken, damit nichts stockt.
            </Text>
          )}

          {/* Was der Startknopf gerade nachlädt, siehe Lernmodus. */}
          {stt.loading && (
            <Stack gap={4}>
              <Progress value={Math.round(stt.progress * 100)} animated />
              <Text size="xs" c="dimmed">
                Spracherkennung wird geladen … {Math.round(stt.progress * 100)} % (beim ersten Mal
                rund 200 MB)
              </Text>
            </Stack>
          )}

          <Group>
            <Button
              data-tour="sitzung-starten"
              leftSection={<IconPlayerPlay size={18} />}
              onClick={() => void start()}
              loading={starting}
              disabled={queue.length === 0 || preparing !== null}
            >
              Sitzung starten
            </Button>
            <Button
              variant="light"
              onClick={() => void prepare()}
              loading={preparing !== null}
              disabled={queue.length === 0}
            >
              Vorbereiten
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  )
}
