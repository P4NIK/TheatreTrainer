/**
 * The rehearsal loop itself: listen – speak – compare.
 *
 * Everything the others say is played back. When your own line comes up the
 * playback stops and waits for you; afterwards it reads out what should have
 * been said, so you hear the difference right where you made it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconEye,
  IconMicrophone,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconRepeat,
  IconX,
} from '@tabler/icons-react'

import { contextBefore, upcomingBlockIDs, type Step } from '../../lib/rehearsal'
import type { BlockAudio } from './useBlockAudio'
import { useRecorder } from './useRecorder'

export interface RunOptions {
  /** Read along with what the others say. */
  showText: boolean
  /** Show your own line already during the pause instead of only afterwards. */
  revealOwn: boolean
  /** Seconds after which the pause ends by itself; null means you click. */
  autoAdvance: number | null
  record: boolean
}

interface Props {
  steps: Step[]
  role: string
  options: RunOptions
  audio: BlockAudio
  onExit: () => void
}

type Phase = 'listen' | 'speak' | 'reveal' | 'jump' | 'done'

const phaseFor = (step: Step | undefined): Phase =>
  step === undefined ? 'done' : step.kind === 'speak' ? 'speak' : step.kind

export default function RehearsalRun({ steps, role, options, audio, onExit }: Props) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>(() => phaseFor(steps[0]))
  const [paused, setPaused] = useState(false)
  const [repeat, setRepeat] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [takes, setTakes] = useState<Record<number, string>>({})
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

  const goTo = useCallback(
    (i: number) => {
      setRevealed(false)
      setElapsed(0)
      if (i < 0) return
      if (i >= steps.length) {
        setPhase('done')
        return
      }
      setIndex(i)
      setPhase(phaseFor(steps[i]))
    },
    [steps],
  )

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
    const url = await stop()
    if (url) setTakes((t) => ({ ...t, [index]: url }))
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

  // Load the next few lines while the current one plays.
  useEffect(() => {
    audio.prefetch(upcomingBlockIDs(steps, index, 4))
  }, [audio, steps, index])

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
  }, [next, back])

  useEffect(() => {
    return () => {
      rec.release()
      player.current?.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const total = steps.length
  const percent = total === 0 ? 0 : Math.round(((index + (phase === 'done' ? 1 : 0)) / total) * 100)
  const waitingFor = step?.block?.id && audio.loading.has(step.block.id)

  if (phase === 'done') {
    const spoken = Object.keys(takes).length
    return (
      <Card withBorder padding="lg" maw={860}>
        <Stack>
          <Title order={4}>Durchlauf beendet</Title>
          <Text size="sm" c="dimmed">
            {steps.filter((s) => s.kind === 'speak').length} eigene Repliken,{' '}
            {steps.filter((s) => s.kind === 'listen').length} gehört
            {spoken > 0 && ` · ${spoken} aufgenommen`}.
          </Text>
          <Group>
            <Button onClick={() => goTo(0)} leftSection={<IconRepeat size={18} />}>
              Noch einmal
            </Button>
            <Button variant="subtle" onClick={onExit}>
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
        <Button variant="subtle" color="gray" size="compact-sm" leftSection={<IconX size={16} />} onClick={onExit}>
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
            <Group gap="xs">
              <Badge color="green" variant="light">
                {role} – so steht es im Buch
              </Badge>
              {waitingFor && <Loader size="xs" />}
            </Group>
            <Text size="lg">{step.block.text}</Text>
            {takes[index] && (
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Deine Aufnahme:
                </Text>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls src={takes[index]} style={{ height: 32 }} />
              </Group>
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
            <Kbd>Leer</Kbd> weiter · <Kbd>R</Kbd> wiederholen · <Kbd>T</Kbd> Text · <Kbd>P</Kbd>{' '}
            Pause
          </Text>
        </Paper>
      </Group>
    </Stack>
  )
}
