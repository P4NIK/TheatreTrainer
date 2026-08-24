import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  ColorInput,
  Group,
  Loader,
  Radio,
  Select,
  Slider,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPlayerPlay, IconVolume } from '@tabler/icons-react'

import { api } from '../../api/client'
import { speakerNames } from '../../lib/blocks'
import { DIRECTION_KEY, type Block, type Speakers, type VoicesResponse } from '../../types'

interface Props {
  blocks: Block[]
  speakers: Speakers
  onChange: (speakers: Speakers) => void
  myRole: string
  onMyRoleChange: (role: string) => void
}

const SAMPLE_TEXT = 'Guten Abend. Dies ist eine Hörprobe für die Theaterprobe.'

export default function SpeakerConfig({ blocks, speakers, onChange, myRole, onMyRoleChange }: Props) {
  const [voices, setVoices] = useState<VoicesResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    api
      .listVoices()
      .then(setVoices)
      .catch((e) => setLoadError((e as Error).message))
  }, [])

  const names = useMemo(() => speakerNames(blocks), [blocks])
  const rows = useMemo(() => {
    const keys = new Set<string>([...names, ...Object.keys(speakers)])
    keys.delete(DIRECTION_KEY)
    return [...keys].sort((a, b) => a.localeCompare(b, 'de'))
  }, [names, speakers])

  const voiceOptions = (voices?.voices ?? []).map((v) => ({
    value: v.name,
    label: `${v.name}${v.numSpeakers > 1 ? ` (${v.numSpeakers} Stimmen)` : ''}`,
  }))

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

  const preview = async (key: string) => {
    const cfg = speakers[key]
    if (!cfg?.model) {
      notifications.show({ color: 'yellow', message: 'Bitte zuerst ein Stimm-Modell auswählen.' })
      return
    }
    setPreviewing(key)
    try {
      const url = await api.previewVoice({
        model: cfg.model,
        speakerId: cfg.speakerId,
        lengthScale: cfg.lengthScale || 1,
        volume: cfg.volume || 1,
        pitch: cfg.pitch || 1,
        text: SAMPLE_TEXT,
      })
      audioRef.current?.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Hörprobe fehlgeschlagen', message: (e as Error).message })
    } finally {
      setPreviewing(null)
    }
  }

  const renderRow = (key: string, label: string, isDirection: boolean) => {
    const cfg = speakers[key] ?? {
      model: '',
      speakerId: 0,
      lengthScale: isDirection ? 1.15 : 1,
      volume: isDirection ? 0.7 : 1,
      pitch: 1,
      color: isDirection ? '#868e96' : '#4A90D9',
    }
    const voice = voices?.voices.find((v) => v.name === cfg.model)
    const speakerIdOptions = voice?.speakerIds
      ? Object.entries(voice.speakerIds)
          .sort((a, b) => a[1] - b[1])
          .map(([n, id]) => ({ value: String(id), label: `${id} – ${n}` }))
      : []

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
          <Select
            size="xs"
            placeholder={voiceOptions.length ? 'Stimme wählen' : 'keine Modelle gefunden'}
            data={voiceOptions}
            value={cfg.model || null}
            onChange={(v) => update(key, { model: v ?? '', speakerId: 0 })}
            searchable
            clearable
            disabled={voiceOptions.length === 0}
            w={230}
          />
        </Table.Td>

        <Table.Td>
          {speakerIdOptions.length > 0 ? (
            <Select
              size="xs"
              data={speakerIdOptions}
              value={String(cfg.speakerId)}
              onChange={(v) => update(key, { speakerId: Number(v ?? 0) })}
              w={130}
            />
          ) : (
            <Text size="xs" c="dimmed">
              –
            </Text>
          )}
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
              disabled={!cfg.model || !voices?.piperAvailable}
            >
              <IconPlayerPlay size={16} />
            </ActionIcon>
          </Tooltip>
        </Table.Td>
      </Table.Tr>
    )
  }

  if (loadError) {
    return <Alert color="red" title="Stimmen konnten nicht geladen werden">{loadError}</Alert>
  }
  if (!voices) {
    return (
      <Group justify="center" p="xl">
        <Loader />
      </Group>
    )
  }

  return (
    <Stack>
      {!voices.piperAvailable && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Piper nicht gefunden">
          <Stack gap={6}>
            <Text size="sm">
              Hörproben und Synthese sind deaktiviert. Getestet wurde:{' '}
              {(voices.piper?.tried ?? ['piper']).map((t, i) => (
                <span key={t}>
                  {i > 0 && ', '}
                  <code>{t}</code>
                </span>
              ))}
              .
            </Text>
            {voices.piper?.explicit && (
              <Text size="xs">
                <code>PIPER_BIN</code> ist gesetzt – dadurch wird nur dieser Befehl geprüft. Setze
                die Variable auf einen funktionierenden Aufruf oder entferne sie, damit die
                automatische Suche greift.
              </Text>
            )}
            {voices.piper?.detail && (
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                {voices.piper.detail}
              </Text>
            )}
            <Text size="xs">
              Falls Piper über <code>pip install piper-tts</code> installiert ist, prüfe im selben
              Terminal <code>python -m piper --help</code>. Danach unten „Stimmen neu einlesen“
              drücken – ein Neustart des Servers ist nicht nötig.
            </Text>
          </Stack>
        </Alert>
      )}
      {voices.piperAvailable && voices.piper?.command && (
        <Text size="xs" c="dimmed">
          Piper-Aufruf: <code>{voices.piper.command}</code>
        </Text>
      )}
      {voices.voices.length === 0 && (
        <Alert color="yellow" icon={<IconVolume size={18} />} title="Keine Stimm-Modelle gefunden">
          Lege Piper-Modelle (<code>*.onnx</code> + <code>*.onnx.json</code>) in den Ordner{' '}
          <code>{voices.dir}</code>. Die Liste aktualisiert sich beim nächsten Laden der Seite.
        </Alert>
      )}

      <Table.ScrollContainer minWidth={1150}>
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Sprecher</Table.Th>
              <Table.Th>Stimm-Modell</Table.Th>
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

      {rows.length === 0 && (
        <Text size="sm" c="dimmed">
          Sobald du im Editor Blöcke mit Sprechernamen anlegst, erscheinen sie hier automatisch.
        </Text>
      )}

      <Group>
        <Button
          variant="subtle"
          size="xs"
          onClick={() => api.listVoices().then(setVoices).catch(() => undefined)}
        >
          Stimmen neu einlesen
        </Button>
      </Group>
    </Stack>
  )
}
