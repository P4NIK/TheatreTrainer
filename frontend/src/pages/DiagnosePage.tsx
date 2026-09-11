/**
 * Die Technik-Prüfung: läuft das hier, und bleibt es auch morgen noch hier?
 *
 * Gedacht für das Telefon. Am Rechner ist ohnehin alles vorhanden; auf einem
 * iPhone hängt es an Safari, an der iOS-Fassung und daran, ob die Seite als
 * App auf dem Home-Bildschirm liegt. Statt darüber zu spekulieren, probiert
 * diese Seite jedes Stück einmal aus und schreibt hin, was herauskam.
 *
 * Zwei Prüfungen kosten etwas und laufen deshalb nur auf Knopfdruck: das
 * Mikrofon (fragt nach Erlaubnis) und die Sprechprobe (lädt beim ersten Mal
 * die 63 MB der Stimme).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Anchor,
  Button,
  Card,
  Container,
  Group,
  Loader,
  Progress,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconClipboardText,
  IconEar,
  IconMicrophone,
  IconRefresh,
  IconVolume,
  IconX,
} from '@tabler/icons-react'

import {
  audioCheck,
  deviceCheck,
  formatBytes,
  homeScreenCheck,
  markerCheck,
  opfsCheck,
  persistenceCheck,
  recorderCheck,
  restartCheck,
  reportText,
  spaceCheck,
  storedCheck,
  streamCheck,
  summary,
  touchMarker,
  wasmCheck,
  type Check,
  type CheckStatus,
} from '../lib/diagnose'
import { encodeWav } from '../lib/audio'
import { ModelStore, opfsStore, requestPersistence, storageState } from '../lib/storage'
import { freeVoices } from '../lib/engine'
import { precisionFor, stt, toMono16k, WHISPER_BYTES } from '../lib/stt'
import { forgetTours } from '../lib/tour'
import { PiperPool } from '../lib/synth'
import { VOICES } from '../lib/voices'

/** Kurz, mit Umlauten und einer Zahl – das deckt die Aussprache-Ecken ab. */
const PROBENSATZ = 'Guten Abend. Die Bühne ist bereit, in dreißig Sekunden geht der Vorhang auf.'

const FARBE: Record<CheckStatus, string> = { ok: 'teal', warn: 'yellow', fail: 'red' }

function Zeichen({ status }: { status: CheckStatus }) {
  return (
    <ThemeIcon color={FARBE[status]} variant="light" radius="xl" size={28}>
      {status === 'ok' ? (
        <IconCheck size={16} />
      ) : status === 'warn' ? (
        <IconAlertTriangle size={16} />
      ) : (
        <IconX size={16} />
      )}
    </ThemeIcon>
  )
}

function Punkt({ check }: { check: Check }) {
  return (
    <Card withBorder padding="sm">
      <Group align="flex-start" gap="sm" wrap="nowrap">
        <Zeichen status={check.status} />
        <div style={{ minWidth: 0 }}>
          <Text fw={600} size="sm">
            {check.title}
          </Text>
          <Text size="sm" c="dimmed">
            {check.detail}
          </Text>
          {check.advice && (
            <Text size="sm" mt={4} c={FARBE[check.status]}>
              {check.advice}
            </Text>
          )}
        </div>
      </Group>
    </Card>
  )
}

interface Props {
  onBack: () => void
}

export default function DiagnosePage({ onBack }: Props) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [extra, setExtra] = useState<Check[]>([])
  const [busy, setBusy] = useState(false)
  const [bericht, setBericht] = useState('')

  // Mikrofon
  const [nimmtAuf, setNimmtAuf] = useState(false)
  // Spracherkennung
  const [erkennt, setErkennt] = useState(false)
  const [erkennerLaden, setErkennerLaden] = useState(0)
  // Sprechprobe
  const [spricht, setSpricht] = useState(false)
  const [fortschritt, setFortschritt] = useState(0)
  const [probe, setProbe] = useState('')
  const probeUrl = useRef('')

  const laeuft = useRef(false)
  const pruefen = useCallback(async () => {
    // React startet den Effekt in der Entwicklungsfassung zweimal; zwei
    // gleichzeitige Läufe würden sich bei der Schreibprobe ins Gehege kommen.
    if (laeuft.current) return
    laeuft.current = true
    setBusy(true)
    try {
      // Die Marke zuerst: sie muss den Stand *vor* diesem Besuch liefern.
      const vorher = await touchMarker()
      const { used } = await storageState().catch(() => ({ used: 0, quota: 0, persisted: false }))
      setChecks([
        deviceCheck(),
        homeScreenCheck(),
        await opfsCheck(),
        await streamCheck(),
        await persistenceCheck(),
        await spaceCheck(),
        await storedCheck(),
        audioCheck(),
        recorderCheck(),
        wasmCheck(),
        markerCheck(vorher, new Date(), used),
        restartCheck(),
      ])
    } finally {
      laeuft.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void pruefen()
  }, [pruefen])

  useEffect(() => {
    return () => {
      if (probeUrl.current) URL.revokeObjectURL(probeUrl.current)
    }
  }, [])

  const dauerhaft = async () => {
    const zugesagt = await requestPersistence().catch(() => false)
    notifications.show({
      color: zugesagt ? 'green' : 'yellow',
      message: zugesagt
        ? 'Der Browser lässt den Speicher jetzt in Ruhe.'
        : 'Der Browser hat abgelehnt. Auf dem iPhone hilft es, die App auf den Home-Bildschirm zu legen und sie eine Weile zu benutzen.',
    })
    await pruefen()
  }

  /** Drei Sekunden aufnehmen und nachsehen, ob wirklich etwas ankam. */
  const mikrofonPruefen = async () => {
    setNimmtAuf(true)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const teile: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) teile.push(e.data)
      }
      const fertig = new Promise<void>((resolve) => {
        rec.onstop = () => resolve()
      })
      rec.start()
      await new Promise((r) => setTimeout(r, 3000))
      rec.stop()
      await fertig

      const blob = new Blob(teile, { type: rec.mimeType || 'audio/webm' })
      const samples = await toMono16k(blob)
      let laut = 0
      for (const wert of samples) laut = Math.max(laut, Math.abs(wert))

      const still = laut < 0.02
      setExtra((alt) => [
        ...alt.filter((c) => c.key !== 'mikro'),
        {
          key: 'mikro',
          title: 'Mikrofon-Versuch',
          status: still ? 'warn' : 'ok',
          detail: still
            ? `Aufgenommen wurde (${formatBytes(blob.size)}, ${rec.mimeType || 'ohne Formatangabe'}), aber es war fast still – Ausschlag ${(laut * 100).toFixed(0)} %.`
            : `${(samples.length / 16000).toFixed(1)} s aufgenommen, ${formatBytes(blob.size)} als ${rec.mimeType || 'unbenanntes Format'}, umgerechnet auf 16 kHz. Lautester Ausschlag ${(laut * 100).toFixed(0)} %.`,
          advice: still ? 'Noch einmal versuchen und dabei sprechen; sonst nimmt das Gerät das falsche Mikrofon.' : undefined,
        },
      ])
    } catch (error) {
      setExtra((alt) => [
        ...alt.filter((c) => c.key !== 'mikro'),
        {
          key: 'mikro',
          title: 'Mikrofon-Versuch',
          status: 'fail',
          detail: `Ging nicht: ${(error as Error).message}`,
          advice: 'Ohne Mikrofon bleibt das Vorlesen; die eigene Rolle prüfen lassen geht dann nicht.',
        },
      ])
    } finally {
      stream?.getTracks().forEach((t) => t.stop())
      setNimmtAuf(false)
    }
  }

  /**
   * Die Spracherkennung aufbauen – der Teil, an dem ein Telefon am ehesten
   * zerbricht.
   *
   * Nicht das Herunterladen ist das Riskante, sondern der Augenblick danach:
   * Aus den geladenen Dateien baut onnxruntime das Netz im Speicher auf. Geht
   * dabei die Seite verloren, steht es beim nächsten Öffnen unter „Neustarts“
   * – deshalb ist dieser Knopf hier und nicht im Lernmodus.
   */
  const erkennerPruefen = async () => {
    setErkennt(true)
    setErkennerLaden(0)
    const aus = stt.watch((p) => {
      if (p.total > 0) setErkennerLaden(Math.min(1, p.loaded / Math.max(p.total, WHISPER_BYTES)))
    })
    const begonnen = performance.now()
    try {
      // Dieselbe Vorsichtsmaßnahme wie im Lernmodus: erst die Stimme aus dem
      // Speicher, dann das Netz aufbauen.
      freeVoices()
      await stt.ensure()
      const dauer = Math.round((performance.now() - begonnen) / 1000)
      setExtra((alt) => [
        ...alt.filter((c) => c.key !== 'erkenner'),
        {
          key: 'erkenner',
          title: 'Spracherkennung',
          status: 'ok',
          detail: `Aufgebaut und bereit – ${dauer} s, Genauigkeit ${precisionFor() === 'q8' ? 'sparsam (q8)' : 'voll (fp32)'}. Wenn die Seite das hier übersteht, übersteht sie es auch im Lernmodus.`,
        },
      ])
    } catch (error) {
      setExtra((alt) => [
        ...alt.filter((c) => c.key !== 'erkenner'),
        {
          key: 'erkenner',
          title: 'Spracherkennung',
          status: 'fail',
          detail: `Ging nicht: ${(error as Error).message}`,
          advice: 'Ohne sie läuft der Lernmodus weiter, nur ohne Auswertung des Gesagten.',
        },
      ])
    } finally {
      aus()
      setErkennt(false)
      void pruefen()
    }
  }

  /** Einmal wirklich sprechen lassen – das ist der teuerste Teil der App. */
  const sprechprobe = async () => {
    setSpricht(true)
    setFortschritt(0)
    const pool = new PiperPool({
      models: new ModelStore(opfsStore('models')),
      onVoiceProgress: (_stimme, p) => setFortschritt(p.total ? p.loaded / p.total : 0),
    })
    const begonnen = performance.now()
    try {
      const stimme = VOICES[0]
      const { samples, sampleRate } = await pool.synthesize({
        text: PROBENSATZ,
        model: stimme.name,
        speakerId: 0,
        lengthScale: 1,
        volume: 1,
        pitch: 1,
      })
      const dauer = Math.round(performance.now() - begonnen)

      if (probeUrl.current) URL.revokeObjectURL(probeUrl.current)
      probeUrl.current = URL.createObjectURL(
        new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' }),
      )
      setProbe(probeUrl.current)
      setExtra((alt) => [
        ...alt.filter((c) => c.key !== 'sprechprobe'),
        {
          key: 'sprechprobe',
          title: 'Sprechprobe',
          status: 'ok',
          detail: `${(samples.length / sampleRate).toFixed(1)} s Sprache in ${(dauer / 1000).toFixed(1)} s gerechnet. Zum Anhören unten auf den Abspieler drücken.`,
        },
      ])
    } catch (error) {
      setExtra((alt) => [
        ...alt.filter((c) => c.key !== 'sprechprobe'),
        {
          key: 'sprechprobe',
          title: 'Sprechprobe',
          status: 'fail',
          detail: `Ging nicht: ${(error as Error).message}`,
          advice:
            'Beim ersten Mal hängt es fast immer am Netz – die Stimme ist der größte Brocken der App. Später ist es der Arbeitsspeicher, an dem ein älteres Telefon hier scheitern kann.',
        },
      ])
    } finally {
      pool.close()
      setSpricht(false)
      void pruefen()
    }
  }

  const alle = [...(checks ?? []), ...extra]
  const kopieren = async () => {
    const text = reportText(alle)
    try {
      await navigator.clipboard.writeText(text)
      notifications.show({ color: 'green', message: 'Bericht kopiert.' })
    } catch {
      setBericht(text)
    }
  }

  const fazit = alle.length > 0 ? summary(alle) : null
  const nichtDauerhaft = alle.some((c) => c.key === 'persist' && c.status === 'warn')

  return (
    <Container size="sm" pb="xl">
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Button variant="subtle" px={6} onClick={onBack} aria-label="Zurück">
            <IconArrowLeft size={18} />
          </Button>
          <Title order={3} style={{ minWidth: 0 }}>
            Technik-Prüfung
          </Title>
        </Group>
        <Button variant="default" onClick={() => void pruefen()} loading={busy} px={10}>
          <IconRefresh size={18} />
        </Button>
      </Group>

      <Text size="sm" c="dimmed" mb="md">
        Diese Seite probiert auf diesem Gerät aus, was die App braucht. Interessant ist sie vor allem
        auf dem Telefon – und beim zweiten Mal: Sie merkt sich, wie lange die Daten schon unangetastet
        hier liegen.
      </Text>

      {fazit && (
        <Alert color={FARBE[fazit.status]} mb="md" title="Kurz gesagt">
          {fazit.text}
        </Alert>
      )}

      {checks === null ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <Stack gap="xs">
          {alle.map((check) => (
            <Punkt key={check.key} check={check} />
          ))}
        </Stack>
      )}

      <Stack gap="xs" mt="lg">
        {nichtDauerhaft && (
          <Button variant="light" onClick={() => void dauerhaft()}>
            Dauerhaften Speicher anfordern
          </Button>
        )}
        <Button
          variant="light"
          leftSection={<IconMicrophone size={18} />}
          onClick={() => void mikrofonPruefen()}
          loading={nimmtAuf}
          color={nimmtAuf ? 'red' : undefined}
        >
          {nimmtAuf ? 'Sprich jetzt – drei Sekunden' : 'Mikrofon prüfen (3 s Aufnahme)'}
        </Button>
        <Button
          variant="light"
          leftSection={<IconVolume size={18} />}
          onClick={() => void sprechprobe()}
          loading={spricht}
        >
          Sprechprobe
        </Button>
        <Button
          variant="light"
          leftSection={<IconEar size={18} />}
          onClick={() => void erkennerPruefen()}
          loading={erkennt}
        >
          Spracherkennung aufbauen
        </Button>
        <Text size="xs" c="dimmed" ta="center" mt={-4}>
          Das ist die Stelle, an der die Seite auf dem Telefon am ehesten neu lädt. Hier ausgelöst,
          steht danach unter „Neustarts“, ob sie es überlebt hat.
        </Text>
        {erkennt && erkennerLaden > 0 && erkennerLaden < 1 && (
          <Progress value={erkennerLaden * 100} size="sm" striped animated />
        )}
        <Text size="xs" c="dimmed" ta="center" mt={-4}>
          Lässt die Stimme einen Satz sprechen. Beim ersten Mal lädt sie dabei
          ({formatBytes(VOICES[0].bytes)}), danach nie wieder.
        </Text>
        {spricht && fortschritt > 0 && fortschritt < 1 && (
          <Progress value={fortschritt * 100} size="sm" striped animated />
        )}
        {probe && (
          <audio src={probe} controls style={{ width: '100%' }} />
        )}
        <Button variant="default" leftSection={<IconClipboardText size={18} />} onClick={() => void kopieren()}>
          Bericht kopieren
        </Button>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          onClick={() => {
            forgetTours()
            notifications.show({
              message: 'Die Einführungen starten beim nächsten Öffnen wieder von vorn.',
            })
          }}
        >
          Einführungen zurücksetzen
        </Button>
        {bericht && (
          <Textarea value={bericht} readOnly autosize minRows={6} onFocus={(e) => e.currentTarget.select()} />
        )}
      </Stack>

      <Card withBorder mt="lg" padding="md">
        <Text fw={600} size="sm" mb={4}>
          Was „langfristig" hier heißt
        </Text>
        <Text size="sm" c="dimmed">
          Alles liegt im Browser, und ein Browser darf aufräumen. Safari löscht die Daten einer Seite
          nach etwa sieben Tagen ohne Besuch – es sei denn, die Seite liegt als App auf dem
          Home-Bildschirm oder hat dauerhaften Speicher zugesagt bekommen. Beides steht oben. Der
          dritte Punkt ist die Sicherungskopie: eine Datei pro Stück, die keinen Browser braucht.
        </Text>
        <Anchor component="button" type="button" size="sm" mt="sm" onClick={onBack}>
          Zurück zu meinen Stücken
        </Anchor>
      </Card>
    </Container>
  )
}
