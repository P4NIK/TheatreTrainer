import { useEffect, useMemo, useRef, useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  ColorInput,
  Group,
  Progress,
  Radio,
  Select,
  Slider,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDownload, IconPlayerPlay } from '@tabler/icons-react'

import { encodeWav } from '../../lib/audio'
import { speakerNames } from '../../lib/blocks'
import { engineFor } from '../../lib/engine'
import { VOICES, voiceReady } from '../../lib/voices'
import { DIRECTION_KEY, type Block, type Speakers } from '../../types'

interface Props {
  /** The engine is per project – the preview shares it with the run. */
  projectId: string
  blocks: Block[]
  speakers: Speakers
  onChange: (speakers: Speakers) => void
  myRole: string
  onMyRoleChange: (role: string) => void
}

const SAMPLE_TEXT = 'Guten Abend. Dies ist eine Hörprobe für die Theaterprobe.'

export default function SpeakerConfig({
  projectId,
  blocks,
  speakers,
  onChange,
  myRole,
  onMyRoleChange,
}: Props) {
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [download, setDownload] = useState<{ loaded: number; total: number } | null>(null)
  const [stored, setStored] = useState<string[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef('')

  const engine = engineFor(projectId)

  /*
   * Acht Spalten passen auf ein Telefon nicht. Statt sie waagerecht scrollen
   * zu lassen – wo die Regler dann außerhalb des Bildschirms liegen –
   * bekommt jede Rolle eine Karte.
   */
  const schmal = useMediaQuery('(max-width: 62em)') ?? false

  // Which voices are already in the browser – so the first preview does not
  // surprise anyone with a 63 MB download.
  useEffect(() => {
    let alive = true
    Promise.all(
      VOICES.map(async (voice) => ((await voiceReady(engine.models, voice.name)) ? voice.name : '')),
    ).then((names) => {
      if (alive) setStored(names.filter(Boolean))
    })
    return () => {
      alive = false
    }
  }, [engine, previewing])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const names = useMemo(() => speakerNames(blocks), [blocks])
  const rows = useMemo(() => {
    const keys = new Set<string>([...names, ...Object.keys(speakers)])
    keys.delete(DIRECTION_KEY)
    return [...keys].sort((a, b) => a.localeCompare(b, 'de'))
  }, [names, speakers])

  const voiceOptions = VOICES.map((voice) => ({ value: voice.name, label: voice.label }))

  /** Was für eine Rolle eingestellt ist – oder was sie mitbekommt, wenn nichts. */
  const configOf = (key: string, isDirection: boolean): Speakers[string] =>
    speakers[key] ?? {
      model: '',
      speakerId: 0,
      lengthScale: isDirection ? 1.15 : 1,
      volume: isDirection ? 0.7 : 1,
      pitch: 1,
      color: isDirection ? '#868e96' : '#4A90D9',
    }

  const update = (key: string, patch: Partial<Speakers[string]>) => {
    const current = speakers[key] ?? {
      model: '',
      speakerId: 0,
      lengthScale: 1,
      volume: 1,
      pitch: 1,
      color: '#868e96',
    }
    onChange({ ...speakers, [key]: { ...current, ...patch } })
  }

  /**
   * The sample is rendered the same way a block is – same worker, same cache.
   * So the first one costs a second and every later one is instant, including
   * after a change to volume or pitch: those are not part of the cache key.
   *
   * The backend deliberately went around the cache here, because a preview
   * text is ad hoc. This one is not: it is the same sentence every time, so it
   * costs one entry per voice and tempo, and `tidyCache()` clears it after the
   * next run. In exchange, dragging a slider and pressing play again is
   * instant – which is exactly what one does on this screen.
   */
  const preview = async (key: string) => {
    const cfg = speakers[key]
    if (!cfg?.model) {
      notifications.show({ color: 'yellow', message: 'Bitte zuerst eine Stimme auswählen.' })
      return
    }

    setPreviewing(key)
    const unwatch = engine.watchVoice((progress) =>
      setDownload({ loaded: progress.loaded, total: progress.total }),
    )
    try {
      const block = await engine.render({
        text: SAMPLE_TEXT,
        model: cfg.model,
        speakerId: cfg.speakerId,
        lengthScale: cfg.lengthScale || 1,
        volume: cfg.volume || 1,
        pitch: cfg.pitch || 1,
      })

      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(
        new Blob([encodeWav(block.samples, block.sampleRate)], { type: 'audio/wav' }),
      )
      const audio = new Audio(urlRef.current)
      audioRef.current = audio
      await audio.play()
    } catch (e) {
      notifications.show({
        color: 'red',
        title: 'Hörprobe fehlgeschlagen',
        message: (e as Error).message,
      })
    } finally {
      unwatch()
      setDownload(null)
      setPreviewing(null)
    }
  }

  const renderCard = (key: string, label: string, isDirection: boolean) => {
    const cfg = configOf(key, isDirection)
    const known = VOICES.some((voice) => voice.name === cfg.model)

    return (
      <Card key={key} withBorder padding="sm">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <div
                style={{ width: 10, height: 10, borderRadius: 5, background: cfg.color, flexShrink: 0 }}
              />
              <Text size="sm" fw={600} fs={isDirection ? 'italic' : undefined} lineClamp={1}>
                {label}
              </Text>
              {!isDirection && myRole === key && (
                <Badge size="xs" color="indigo" variant="light">
                  meine Rolle
                </Badge>
              )}
            </Group>
            <Group gap={4} wrap="nowrap">
              {!isDirection && (
                <Tooltip label="Das ist meine Rolle">
                  <Radio
                    checked={myRole === key}
                    onChange={() => onMyRoleChange(myRole === key ? '' : key)}
                    onClick={() => myRole === key && onMyRoleChange('')}
                    aria-label={`${label} ist meine Rolle`}
                  />
                </Tooltip>
              )}
              <ActionIcon
                variant="light"
                size="lg"
                onClick={() => preview(key)}
                loading={previewing === key}
                disabled={!cfg.model || previewing !== null}
                aria-label="Hörprobe abspielen"
              >
                <IconPlayerPlay size={18} />
              </ActionIcon>
            </Group>
          </Group>

          <Select
            size="sm"
            placeholder="Stimme wählen"
            data={voiceOptions}
            value={known ? cfg.model : null}
            onChange={(v) => update(key, { model: v ?? '', speakerId: 0 })}
            clearable
          />
          {cfg.model !== '' && !known && (
            <Text size="xs" c="red">
              „{cfg.model}“ gibt es nicht mehr – bitte neu wählen.
            </Text>
          )}

          {(
            [
              ['Tempo', 'lengthScale', 0.6, 1.8, 0.05, (v: number) => `${v.toFixed(2)}× langsamer`],
              ['Tonhöhe', 'pitch', 0.75, 1.3, 0.02,
                (v: number) => (v === 1 ? 'unverändert' : `${v > 1 ? 'höher' : 'tiefer'} ×${v.toFixed(2)}`)],
              ['Lautstärke', 'volume', 0.2, 1.5, 0.05, (v: number) => `${Math.round(v * 100)} %`],
            ] as const
          ).map(([titel, feld, min, max, step, beschriften]) => (
            <div key={feld}>
              <Group justify="space-between" gap="xs">
                <Text size="xs" c="dimmed">
                  {titel}
                </Text>
                <Text size="xs" c="dimmed">
                  {beschriften(cfg[feld] || 1)}
                </Text>
              </Group>
              <Slider
                size="md"
                min={min}
                max={max}
                step={step}
                value={cfg[feld] || 1}
                onChange={(v) => update(key, { [feld]: v })}
                label={beschriften}
                marks={feld === 'pitch' ? [{ value: 1 }] : undefined}
              />
            </div>
          ))}

          <ColorInput
            size="xs"
            label="Farbe"
            format="hex"
            value={cfg.color}
            onChange={(v) => update(key, { color: v })}
            withEyeDropper={false}
          />
        </Stack>
      </Card>
    )
  }

  const renderRow = (key: string, label: string, isDirection: boolean) => {
    const cfg = configOf(key, isDirection)
    const known = VOICES.some((voice) => voice.name === cfg.model)

    return (
      <Table.Tr key={key}>
        <Table.Td>
          <Group gap={6} wrap="nowrap">
            <div
              style={{ width: 10, height: 10, borderRadius: 5, background: cfg.color, flexShrink: 0 }}
            />
            <Text size="sm" fw={600} fs={isDirection ? 'italic' : undefined}>
              {label}
            </Text>
            {!isDirection && myRole === key && (
              <Badge size="xs" color="indigo" variant="light">
                meine Rolle
              </Badge>
            )}
          </Group>
        </Table.Td>

        <Table.Td>
          <Stack gap={2}>
            <Select
              size="xs"
              placeholder="Stimme wählen"
              data={voiceOptions}
              value={known ? cfg.model : null}
              onChange={(v) => update(key, { model: v ?? '', speakerId: 0 })}
              clearable
              w={230}
            />
            {/* Older projects may still point at a voice from the days of the
                voices/ folder. Saying so is friendlier than an empty field. */}
            {cfg.model !== '' && !known && (
              <Text size="xs" c="red">
                „{cfg.model}“ gibt es nicht mehr – bitte neu wählen.
              </Text>
            )}
          </Stack>
        </Table.Td>

        <Table.Td w={150}>
          <Slider
            size="sm"
            min={0.6}
            max={1.8}
            step={0.05}
            value={cfg.lengthScale || 1}
            onChange={(v) => update(key, { lengthScale: v })}
            label={(v) => `${v.toFixed(2)}× langsamer`}
          />
        </Table.Td>

        <Table.Td w={150}>
          <Slider
            size="sm"
            min={0.75}
            max={1.3}
            step={0.02}
            value={cfg.pitch || 1}
            onChange={(v) => update(key, { pitch: v })}
            label={(v) => (v === 1 ? 'unverändert' : `${v > 1 ? 'höher' : 'tiefer'} ×${v.toFixed(2)}`)}
            marks={[{ value: 1 }]}
          />
        </Table.Td>

        <Table.Td w={150}>
          <Slider
            size="sm"
            min={0.2}
            max={1.5}
            step={0.05}
            value={cfg.volume || 1}
            onChange={(v) => update(key, { volume: v })}
            label={(v) => `${Math.round(v * 100)} %`}
          />
        </Table.Td>

        <Table.Td>
          <ColorInput
            size="xs"
            w={120}
            format="hex"
            value={cfg.color}
            onChange={(v) => update(key, { color: v })}
            withEyeDropper={false}
          />
        </Table.Td>

        <Table.Td>
          {isDirection ? (
            <Text size="xs" c="dimmed">
              –
            </Text>
          ) : (
            <Radio
              checked={myRole === key}
              onChange={() => onMyRoleChange(myRole === key ? '' : key)}
              onClick={() => myRole === key && onMyRoleChange('')}
              aria-label={`${label} ist meine Rolle`}
            />
          )}
        </Table.Td>

        <Table.Td>
          <Tooltip label="Hörprobe abspielen">
            <ActionIcon
              variant="light"
              onClick={() => preview(key)}
              loading={previewing === key}
              disabled={!cfg.model || previewing !== null}
            >
              <IconPlayerPlay size={16} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
      </Table.Tr>
    )
  }

  const missing = VOICES.filter((voice) => !stored.includes(voice.name))

  return (
    <Stack>
      {missing.length > 0 && (
        <Alert color="blue" icon={<IconDownload size={18} />} variant="light">
          <Text size="sm">
            {missing.map((v) => v.label).join(', ')} wird beim ersten Vorlesen einmal geladen (
            {missing.map((v) => `${Math.round(v.bytes / 1024 / 1024)} MB`).join(', ')}) und bleibt
            danach im Browser – auch ohne Internet.
          </Text>
        </Alert>
      )}

      {download && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Stimme wird geladen …{' '}
            {download.total > 0
              ? `${Math.round((download.loaded / download.total) * 100)} %`
              : `${Math.round(download.loaded / 1024 / 1024)} MB`}
          </Text>
          <Progress
            value={download.total > 0 ? (download.loaded / download.total) * 100 : 0}
            animated
          />
        </Stack>
      )}

      {schmal ? (
        <Stack gap="sm">
          {rows.map((name) => renderCard(name, name, false))}
          {renderCard(DIRECTION_KEY, 'Regieanweisungen', true)}
        </Stack>
      ) : (
      <Table.ScrollContainer minWidth={1050}>
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Sprecher</Table.Th>
              <Table.Th>Stimme</Table.Th>
              <Table.Th>Tempo</Table.Th>
              <Table.Th>Tonhöhe</Table.Th>
              <Table.Th>Lautstärke</Table.Th>
              <Table.Th>Farbe</Table.Th>
              <Table.Th>Meine Rolle</Table.Th>
              <Table.Th>Test</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((name) => renderRow(name, name, false))}
            {renderRow(DIRECTION_KEY, 'Regieanweisungen', true)}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      )}

      {rows.length === 0 && (
        <Text size="sm" c="dimmed">
          Sobald du im Editor Blöcke mit Sprechernamen anlegst, erscheinen sie hier automatisch.
        </Text>
      )}

      <Text size="xs" c="dimmed">
        Alle Rollen teilen sich eine Stimme; unterschieden werden sie über Tonhöhe und Tempo. Das
        klingt besser als eine zweite, schlechtere Stimme – und die Regler kosten nichts, weil nur
        der Text neu erzeugt wird, nicht die Bearbeitung.
      </Text>
    </Stack>
  )
}
