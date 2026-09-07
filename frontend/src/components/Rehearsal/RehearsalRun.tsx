/**
 * The rehearsal loop itself: listen – speak – compare.
 *
 * Everything the others say is played back. When your own line comes up the
 * playback stops and waits for you; afterwards it reads out what should have
 * been said, so you hear the difference right where you made it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Kbd,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconCheck,
  IconEye,
  IconMicrophone,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPencil,
  IconRepeat,
  IconWaveSine,
  IconX,
} from '@tabler/icons-react'

import { ApiError, api } from '../../api/client'
import { suggestGrade } from '../../lib/cards'
import { compareSpoken } from '../../lib/compare'
import { contextBefore, upcomingBlockIDs, type Step } from '../../lib/rehearsal'
import type { Grade } from '../../types'
import ComparisonView from './ComparisonView'
import type { BlockAudio } from './useBlockAudio'
import { useRecorder, type Take } from './useRecorder'

/** The three buttons of the flashcard judgement, in the order they are shown. */
const GRADES: { value: Grade; label: string; color: string; key: string }[] = [
  { value: 'again', label: 'Daneben', color: 'red', key: '1' },
  { value: 'hard', label: 'Wackelig', color: 'yellow', key: '2' },
  { value: 'good', label: 'Saß', color: 'green', key: '3' },
]

/** Wording of the closing screen – a card session counts something else. */
export interface DoneScreen {
  title: string
  summary: string
  /** Left out, the "once more" button disappears with it. */
  repeatLabel?: string
}

export interface RunOptions {
  /** Read along with what the others say. */
  showText: boolean
  /** Show your own line already during the pause instead of only afterwards. */
  revealOwn: boolean
  /** Seconds after which the pause ends by itself; null means you click. */
  autoAdvance: number | null
  record: boolean
  /** Send the take to the local speech recognition and compare it. */
  analyze: boolean
}

interface Props {
  projectId: string
  steps: Step[]
  role: string
  options: RunOptions
  audio: BlockAudio
  /** The step the run begins at – carrying on, or a chosen page. */
  startIndex?: number
  /**
   * Reports where the run stands, so it can be picked up another day. Called
   * with the last step and `done` once the run reaches the end.
   */
  onProgress?: (index: number, done: boolean) => void
  /**
   * Turns the resolution of your own lines into a judgement: the run stops and
   * asks how it went instead of moving on. This is what makes a run a deck of
   * flashcards. `steps` may grow while the run is going – a card that did not
   * sit is put back in behind the current position, and the step index is
   * handed over so the caller knows where "behind" starts.
   */
  onGrade?: (blockId: string, grade: Grade, index: number) => void
  done?: DoneScreen
  /** Fixing the text of a block right where the mistake showed up. */
  onCorrectBlock: (blockId: string, text: string) => void
  onExit: () => void
}

type Phase = 'listen' | 'speak' | 'reveal' | 'jump' | 'done'

const phaseFor = (step: Step | undefined): Phase =>
  step === undefined ? 'done' : step.kind === 'speak' ? 'speak' : step.kind

export default function RehearsalRun({
  projectId,
  steps,
  role,
  options,
  audio,
  startIndex = 0,
  onProgress,
  onGrade,
  done,
  onCorrectBlock,
  onExit,
}: Props) {
  const [index, setIndex] = useState(startIndex)
  const [phase, setPhase] = useState<Phase>(() => phaseFor(steps[startIndex]))
  const [paused, setPaused] = useState(false)
  const [repeat, setRepeat] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [takes, setTakes] = useState<Record<number, Take>>({})
  const [heard, setHeard] = useState<Record<number, string>>({})
  const [listening, setListening] = useState<number | null>(null)
  const [sttError, setSttError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)

  const rec = useRecorder()
  // Created inside the run, which only exists after a click – browsers allow
  // playback on an element that was set up in a user-triggered context.
  const player = useRef<HTMLAudioElement | null>(null)
  if (player.current === null && typeof Audio !== 'undefined') player.current = new Audio()
  const timer = useRef<number | null>(null)

  const step = steps[index]
  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  // Read inside `forget`, which must not depend on the takes to stay stable.
  const takesRef = useRef(takes)
  takesRef.current = takes

  /**
   * Throws away the attempt stored for one step.
   *
   * Both halves have to go. The take alone is overwritten by the next
   * recording anyway – but the transcript is what the comparison is drawn
   * from, and the recogniser skips a step that already has one. Left behind,
   * it would quietly keep showing what was said the first time round.
   */
  const forget = useCallback((i: number) => {
    const old = takesRef.current[i]
    if (old) URL.revokeObjectURL(old.url)
    setTakes((t) => {
      if (t[i] === undefined) return t
      const rest = { ...t }
      delete rest[i]
      return rest
    })
    setHeard((h) => {
      if (h[i] === undefined) return h
      const rest = { ...h }
      delete rest[i]
      return rest
    })
    // A recognition still running for this step belongs to the take just
    // dropped; without this the spinner would sit there for good.
    setListening((l) => (l === i ? null : l))
  }, [])

  const goTo = useCallback(
    (i: number) => {
      setRevealed(false)
      setElapsed(0)
      setEditing(null)
      setSttError(null)
      if (i < 0) return
      // Stepping onto a line means doing it again – the previous attempt at it
      // goes. Coming out of the resolution this is the same index, which is
      // exactly the "let me say that once more" case.
      forget(i)
      // The index moves past the end as well, rather than stopping short of
      // it: that is what lets a run pick itself up again when the list grows –
      // see the effect below.
      setIndex(i)
      setPhase(i >= steps.length ? 'done' : phaseFor(steps[i]))
    },
    [steps, forget],
  )

  /**
   * A run whose list has grown is not over after all.
   *
   * The flashcards put a card that did not sit back into the sitting, and when
   * that card was the last one there was nothing left to put it in front of –
   * so it lands behind the position the run has just moved to. Without this the
   * closing screen would swallow it, because the grading and the step onto the
   * next position happen in the same render, from the list as it was.
   */
  useEffect(() => {
    if (phase === 'done' && index < steps.length) setPhase(phaseFor(steps[index]))
  }, [phase, index, steps])

  /**
   * Ends the pause and keeps the take.
   *
   * `stop` is deliberately called without asking whether a recording is
   * running: the automatic pause fires from a closure created when the pause
   * began, and back then the microphone had not started yet. Asking the flag
   * there would silently throw the take away. `stop` reads a ref and returns
   * null when there is nothing to stop.
   */
  const stop = rec.stop
  const finishSpeaking = useCallback(async () => {
    const take = await stop()
    if (take) setTakes((t) => ({ ...t, [index]: take }))
  }, [stop, index])

  const next = useCallback(async () => {
    clearTimer()
    if (phase === 'speak') {
      await finishSpeaking()
      setRevealed(true)
      setPhase('reveal')
      return
    }
    goTo(index + 1)
  }, [phase, finishSpeaking, goTo, index])

  const back = useCallback(async () => {
    clearTimer()
    await finishSpeaking()
    goTo(phase === 'reveal' ? index : index - 1)
  }, [phase, index, finishSpeaking, goTo])

  /**
   * With a recording of your own the resolution is not the end of the step –
   * and with grading switched on it never is: a card is not done until it has
   * been judged.
   *
   * Read through a ref inside the loop, never as a dependency: keeping the
   * take flips this in the render *before* the phase moves on to 'reveal', and
   * a loop that restarts on it would start a second recording of the pause it
   * has just ended.
   */
  const grading = onGrade !== undefined && step?.kind === 'speak'
  const waitAfterReveal = takes[index] !== undefined || grading
  const waitRef = useRef(false)
  waitRef.current = waitAfterReveal

  /**
   * The judgement, and on to the next card. Through a ref for the same reason
   * as the progress report: the callback is rebuilt on every render above.
   */
  const gradeRef = useRef(onGrade)
  gradeRef.current = onGrade
  const grade = useCallback(
    (value: Grade) => {
      const id = steps[index]?.block?.id
      if (id) gradeRef.current?.(id, value, index)
      void next()
    },
    [steps, index, next],
  )

  // --- the loop ------------------------------------------------------------
  useEffect(() => {
    if (paused || phase === 'done') return
    let cancelled = false
    const el = player.current

    const advance = () => {
      if (!cancelled) void next()
    }

    if (phase === 'jump') {
      timer.current = window.setTimeout(advance, 1600)
    } else if (phase === 'listen' || phase === 'reveal') {
      const id = steps[index]?.block?.id
      if (!id || !el) {
        timer.current = window.setTimeout(advance, 400)
      } else {
        void audio
          .get(id)
          .then((url) => {
            if (cancelled) return
            el.src = url
            el.onended = () => {
              if (cancelled) return
              // After the resolution the run waits when there is a take: you
              // want to listen to yourself and read the comparison, and a run
              // that jumps on takes that away.
              if (phase === 'reveal' && waitRef.current) return
              // A short breath before the next line, as on stage.
              timer.current = window.setTimeout(advance, phase === 'reveal' ? 600 : 250)
            }
            return el.play()
          })
          .then(() => !cancelled && setBlocked(null))
          .catch((e) => {
            if (cancelled) return
            setBlocked((e as Error).message)
            setPaused(true)
          })
      }
    } else if (phase === 'speak') {
      if (options.record && rec.supported) void rec.start()
      if (options.autoAdvance !== null) {
        timer.current = window.setTimeout(advance, options.autoAdvance * 1000)
      }
    }

    return () => {
      cancelled = true
      clearTimer()
      el?.pause()
      if (el) el.onended = null
    }
    // `next` and `rec` change on every render; the loop is driven by the four
    // values below and must not restart for anything else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase, paused, repeat])

  // The recogniser runs while the resolution plays, so its few seconds are
  // spent on something you are listening to anyway.
  // Only the id of the block matters here, not the step list: with the
  // flashcards that list grows while the run is going, and a dependency on it
  // would cancel a recognition halfway through and start the same one over.
  const spokenBlockId = steps[index]?.block?.id
  useEffect(() => {
    const take = takes[index]
    if (!options.analyze || !take || !spokenBlockId || heard[index] !== undefined) return

    let cancelled = false
    setListening(index)
    setSttError(null)
    api
      .transcribe(projectId, spokenBlockId, take.blob)
      .then((t) => !cancelled && setHeard((h) => ({ ...h, [index]: t.text })))
      .catch((e) => {
        if (cancelled) return
        setSttError(
          e instanceof ApiError && e.status === 424
            ? e.message
            : `Spracherkennung fehlgeschlagen: ${(e as Error).message}`,
        )
      })
      .finally(() => !cancelled && setListening(null))
    return () => {
      cancelled = true
    }
  }, [takes, index, spokenBlockId, options.analyze, heard, projectId])

  // Load the next few lines while the current one plays.
  useEffect(() => {
    audio.prefetch(upcomingBlockIDs(steps, index, 4))
  }, [audio, steps, index])

  /**
   * Remembering the position.
   *
   * Through a ref, never as a dependency: the callback is rebuilt on every
   * render of the panel above, and depending on it would restart the timer
   * constantly. Delayed by a moment as well, so skipping through five lines
   * leaves one mark instead of five.
   */
  const report = useRef(onProgress)
  report.current = onProgress
  useEffect(() => {
    if (steps.length === 0) return
    if (phase === 'done') {
      report.current?.(steps.length - 1, true)
      return
    }
    const id = window.setTimeout(() => report.current?.(index, false), 1500)
    return () => window.clearTimeout(id)
  }, [index, phase, steps.length])

  /** Leaving early still counts – the position is written out before the exit. */
  const exit = useCallback(() => {
    if (phase !== 'done' && steps.length > 0) report.current?.(index, false)
    onExit()
  }, [phase, index, steps.length, onExit])

  // A stopwatch during your line – it makes a silent pause feel less endless.
  useEffect(() => {
    if (phase !== 'speak' || paused) return
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [phase, paused, index])

  // Keyboard: the whole run is meant to be usable with the script in hand.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (grading && phase === 'reveal') {
        const chosen = GRADES.find((g) => g.key === e.key)
        if (chosen) {
          e.preventDefault()
          grade(chosen.value)
          return
        }
        // The space bar must not walk past the judgement – the card would stay
        // unjudged and quietly keep its old place in the deck.
        if (e.code === 'Space' || e.code === 'ArrowRight') {
          e.preventDefault()
          return
        }
      }
      if (e.code === 'Space' || e.code === 'ArrowRight') {
        e.preventDefault()
        void next()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        void back()
      } else if (e.code === 'KeyR') {
        setRepeat((n) => n + 1)
      } else if (e.code === 'KeyP') {
        setPaused((p) => !p)
      } else if (e.code === 'KeyT') {
        setRevealed(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, grade, grading, phase])

  useEffect(() => {
    return () => {
      rec.release()
      player.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recomputed whenever the transcript or the block text changes, so a
  // correction re-colours the comparison without asking the recogniser again.
  const comparison = useMemo(() => {
    const text = steps[index]?.block?.text
    const spoken = heard[index]
    if (text === undefined || spoken === undefined) return null
    return compareSpoken(text, spoken)
  }, [steps, index, heard])

  /** Pre-selects a button, decides nothing – see suggestGrade. */
  const suggestion = comparison ? suggestGrade(comparison.score) : null

  const total = steps.length
  const percent = total === 0 ? 0 : Math.round(((index + (phase === 'done' ? 1 : 0)) / total) * 100)
  const waitingFor = step?.block?.id && audio.loading.has(step.block.id)

  if (phase === 'done') {
    const spoken = Object.keys(takes).length
    const repeat = done === undefined ? 'Noch einmal' : done.repeatLabel
    return (
      <Card withBorder padding="lg" maw={860}>
        <Stack>
          <Title order={4}>{done?.title ?? 'Durchlauf beendet'}</Title>
          <Text size="sm" c="dimmed">
            {done?.summary ??
              `${steps.filter((s) => s.kind === 'speak').length} eigene Repliken, ${
                steps.filter((s) => s.kind === 'listen').length
              } gehört${spoken > 0 ? ` · ${spoken} aufgenommen` : ''}.`}
          </Text>
          <Group>
            {repeat !== undefined && (
              <Button onClick={() => goTo(0)} leftSection={<IconRepeat size={18} />}>
                {repeat}
              </Button>
            )}
            <Button variant="subtle" onClick={exit}>
              Zurück zur Einrichtung
            </Button>
          </Group>
        </Stack>
      </Card>
    )
  }

  return (
    <Stack maw={860}>
      <Group justify="space-between">
        <Group gap="xs">
          <Badge variant="light">
            {index + 1} / {total}
          </Badge>
          {paused && (
            <Badge color="yellow" variant="light">
              pausiert
            </Badge>
          )}
          {rec.recording && (
            <Badge color="red" variant="filled" leftSection={<IconMicrophone size={12} />}>
              Aufnahme
            </Badge>
          )}
        </Group>
        <Button variant="subtle" color="gray" size="compact-sm" leftSection={<IconX size={16} />} onClick={exit}>
          Beenden
        </Button>
      </Group>

      <Progress value={percent} />

      {blocked && (
        <Alert color="yellow" title="Der Browser hat die Wiedergabe gestoppt">
          {blocked} – auf „Weiter“ drücken, dann läuft es weiter.
        </Alert>
      )}
      {rec.error && (
        <Alert color="yellow" title="Aufnahme nicht möglich">
          {rec.error}
        </Alert>
      )}

      {/* What was said just before – enough context to know where you are. */}
      <Stack gap={2}>
        {contextBefore(steps, index, 2).map((s, i) => (
          <Text key={i} size="xs" c="dimmed" lineClamp={1}>
            <b>{s.block?.type === 'direction' ? 'Regie' : s.block?.speaker}</b> {s.block?.text}
          </Text>
        ))}
      </Stack>

      <Card withBorder padding="lg" mih={220}>
        {phase === 'jump' && (
          <Stack align="center" gap="xs" py="xl">
            <Text size="sm" c="dimmed">
              Sprung
            </Text>
            <Title order={4}>{step?.announce}</Title>
          </Stack>
        )}

        {phase === 'listen' && step?.block && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge variant="light" color={step.block.type === 'direction' ? 'gray' : 'blue'}>
                {step.block.type === 'direction' ? 'Regie' : step.block.speaker}
              </Badge>
              {waitingFor && (
                <Group gap={6}>
                  <Loader size="xs" />
                  <Text size="xs" c="dimmed">
                    wird vorbereitet …
                  </Text>
                </Group>
              )}
            </Group>
            <Text
              size="lg"
              fs={step.block.type === 'direction' ? 'italic' : undefined}
              c={options.showText ? undefined : 'dimmed'}
            >
              {options.showText ? step.block.text : '· · ·'}
            </Text>
          </Stack>
        )}

        {phase === 'speak' && step?.block && (
          <Stack gap="sm" align="center" py="md">
            <Badge size="lg" color="green" variant="filled">
              {role} – du bist dran
            </Badge>
            <Text size="2rem" fw={700} c="dimmed">
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
              {String(elapsed % 60).padStart(2, '0')}
            </Text>
            {options.revealOwn || revealed ? (
              <Text size="lg" ta="center">
                {step.block.text}
              </Text>
            ) : (
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconEye size={16} />}
                onClick={() => setRevealed(true)}
              >
                Text zeigen
              </Button>
            )}
            <Button onClick={() => void next()} size="md">
              Fertig – auflösen
            </Button>
          </Stack>
        )}

        {phase === 'reveal' && step?.block && (
          <Stack gap="sm">
            <Group gap="xs" justify="space-between">
              <Group gap="xs">
                <Badge color="green" variant="light">
                  {role} – so steht es im Buch
                </Badge>
                {waitingFor && <Loader size="xs" />}
              </Group>
              {editing === null && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconPencil size={14} />}
                  onClick={() => setEditing(step.block!.text)}
                >
                  Text korrigieren
                </Button>
              )}
            </Group>

            {editing !== null ? (
              <Stack gap="xs">
                <Textarea
                  autosize
                  minRows={2}
                  maxRows={10}
                  value={editing}
                  onChange={(e) => setEditing(e.currentTarget.value)}
                  description="Stimmt der Text nicht mit dem Buch überein, korrigierst du ihn hier – gespeichert wird im Block."
                />
                <Group gap="xs">
                  <Button
                    size="compact-sm"
                    leftSection={<IconCheck size={16} />}
                    disabled={editing.trim() === ''}
                    onClick={() => {
                      const text = editing.trim()
                      onCorrectBlock(step.block!.id, text)
                      // The old rendering says something else now.
                      audio.invalidate(step.block!.id)
                      setEditing(null)
                    }}
                  >
                    Übernehmen
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="gray"
                    onClick={() => setEditing(null)}
                  >
                    Abbrechen
                  </Button>
                </Group>
              </Stack>
            ) : (
              <Text size="lg">{step.block.text}</Text>
            )}

            {takes[index] && (
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Deine Aufnahme:
                </Text>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls src={takes[index].url} style={{ height: 32 }} />
              </Group>
            )}

            {listening === index && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">
                  Aufnahme wird ausgewertet …
                </Text>
              </Group>
            )}
            {sttError && listening !== index && (
              <Alert color="yellow" title="Kein Vergleich möglich" p="xs">
                <Text size="xs">{sttError}</Text>
              </Alert>
            )}
            {comparison && <ComparisonView comparison={comparison} spoken={heard[index]} />}
            {takes[index] && !options.analyze && (
              <Text size="xs" c="dimmed">
                <IconWaveSine
                  size={13}
                  style={{ verticalAlign: -2, marginRight: 4 }}
                />
                Zum Abgleich Wort für Wort in der Einrichtung „Gesagtes auswerten“ einschalten.
              </Text>
            )}

            {grading ? (
              <Stack gap={6}>
                <Text size="xs" c="dimmed">
                  Saß der Text? Der Vergleich oben ist nur ein Hinweis – die Erkennung verhört
                  sich oft genug, dass sie das nicht entscheiden darf.
                </Text>
                <Group gap="xs">
                  {GRADES.map((g) => (
                    <Button
                      key={g.value}
                      color={g.color}
                      variant={suggestion === g.value ? 'filled' : 'light'}
                      onClick={() => grade(g.value)}
                      rightSection={<Kbd>{g.key}</Kbd>}
                    >
                      {g.label}
                    </Button>
                  ))}
                </Group>
              </Stack>
            ) : (
              waitAfterReveal && (
                <Group>
                  <Button onClick={() => void next()}>Weiter</Button>
                  <Text size="xs" c="dimmed">
                    Der Durchlauf wartet, solange du dir die Aufnahme anhörst.
                  </Text>
                </Group>
              )
            )}
          </Stack>
        )}
      </Card>

      <Group justify="space-between">
        <Group gap="xs">
          <Tooltip label="Zurück (←)">
            <ActionIcon variant="default" size="lg" onClick={() => void back()} aria-label="Zurück">
              <IconPlayerSkipBack size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={paused ? 'Weiterlaufen (P)' : 'Anhalten (P)'}>
            <ActionIcon
              variant="default"
              size="lg"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? 'Weiterlaufen' : 'Anhalten'}
            >
              {paused ? <IconPlayerPlay size={18} /> : <IconPlayerPause size={18} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Wiederholen (R)">
            <ActionIcon
              variant="default"
              size="lg"
              onClick={() => setRepeat((n) => n + 1)}
              aria-label="Wiederholen"
            >
              <IconRepeat size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Weiter (Leertaste)">
            <ActionIcon variant="default" size="lg" onClick={() => void next()} aria-label="Weiter">
              <IconPlayerSkipForward size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Paper withBorder px="sm" py={4}>
          <Text size="xs" c="dimmed">
            {grading && phase === 'reveal' ? (
              <>
                <Kbd>1</Kbd> daneben · <Kbd>2</Kbd> wackelig · <Kbd>3</Kbd> saß
              </>
            ) : (
              <>
                <Kbd>Leer</Kbd> weiter · <Kbd>R</Kbd> wiederholen · <Kbd>T</Kbd> Text ·{' '}
                <Kbd>P</Kbd> Pause
              </>
            )}
          </Text>
        </Paper>
      </Group>
    </Stack>
  )
}
