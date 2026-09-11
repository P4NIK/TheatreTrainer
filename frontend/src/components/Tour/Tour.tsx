/**
 * Der Kasten, der durch die Seite führt.
 *
 * Ein Loch im abgedunkelten Bild und ein Kärtchen daneben – mehr ist eine
 * Einführung nicht. Das Loch entsteht ohne Maske: ein Kästchen über dem Ziel,
 * dessen Schatten den ganzen Bildschirm füllt.
 *
 * Das Ziel bewegt sich, während die Tour läuft: Ein Reiter wird umgeschaltet,
 * das PDF rendert nach, auf dem Telefon klappt die Tastatur auf. Statt an
 * jedes dieser Ereignisse zu denken, wird die Stelle viermal in der Sekunde
 * nachgemessen. Das kostet nichts und sitzt immer.
 *
 * Der Kasten misst dabei auch sich selbst. Mit einer angenommenen Höhe zu
 * rechnen ging schief, sobald der Text länger oder das Fenster niedriger war
 * als gedacht: Dann stand der Kasten halb über dem oberen Rand, und die
 * Überschrift war weg. Gemessen und in den sichtbaren Bereich geschoben kann
 * das nicht mehr passieren – und wenn selbst das nicht reicht, rollt der Text
 * im Kasten, während die Knöpfe stehen bleiben.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import { Badge, Button, Card, Group, Portal, Stack, Text } from '@mantine/core'

import { cardPlacement, RAND, type TabValue, type TourStep } from '../../lib/tour'

interface Props {
  steps: TourStep[]
  /** Wird beim Schließen gerufen – auch beim Überspringen. */
  onClose: () => void
  /** Schaltet den Reiter um, den ein Schritt braucht. */
  onTab?: (tab: TabValue) => void
}

/** Abstand zwischen Loch und Rahmen. */
const PADDING = 6

export default function Tour({ steps, onClose, onTab }: Props) {
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<DOMRect | null>(null)
  const [hoehe, setHoehe] = useState(200)
  const schmal = useMediaQuery('(max-width: 62em)') ?? false
  const karte = useRef<HTMLDivElement>(null)

  const step = steps[index]
  const letzter = index >= steps.length - 1

  const weiter = useCallback(() => {
    if (letzter) onClose()
    else setIndex((i) => i + 1)
  }, [letzter, onClose])

  const zurueck = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Der Reiter zuerst: sonst wird ein Ziel gemessen, das noch gar nicht steht.
  useEffect(() => {
    if (step?.tab) onTab?.(step.tab)
    // onTab ist bei jedem Bild ein neues Stück Funktion; hier zählt der Schritt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step?.tab])

  useEffect(() => {
    if (!step) return
    let ersteMessung = true

    const messen = () => {
      const ziel = step.target
        ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
        : null
      setBox(ziel ? ziel.getBoundingClientRect() : null)
      if (ziel && ersteMessung) {
        ersteMessung = false
        ziel.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }

    messen()
    const takt = window.setInterval(messen, 250)
    return () => window.clearInterval(takt)
  }, [index, step])

  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') weiter()
      else if (e.key === 'ArrowLeft') zurueck()
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [onClose, weiter, zurueck])

  useEffect(() => {
    karte.current?.focus()
  }, [index])

  /*
   * Die eigene Höhe im Blick behalten.
   *
   * Sie hängt am Text des Schrittes, an der Fensterbreite und daran, ob ein
   * „Zurück“ danebensteht – und sie wird gebraucht, um den Kasten ins Bild zu
   * schieben. Ein Beobachter meldet jede Änderung, auch die durch eine spät
   * geladene Schrift; die Schwelle hält winzige Ausschläge draußen.
   */
  useLayoutEffect(() => {
    const el = karte.current
    if (!el) return
    const beobachter = new ResizeObserver(() => {
      const gemessen = el.getBoundingClientRect().height
      setHoehe((alt) => (Math.abs(alt - gemessen) > 2 ? gemessen : alt))
    })
    beobachter.observe(el)
    return () => beobachter.disconnect()
  }, [])

  if (!step) return null

  const platz = cardPlacement({
    box: box && { top: box.top, left: box.left, width: box.width, height: box.height },
    cardHeight: hoehe,
    view: { width: window.innerWidth, height: window.innerHeight },
    narrow: schmal,
  })

  return (
    <Portal>
      {/* Das Loch – oder, wo es kein Ziel gibt, einfach ein dunkles Bild. */}
      {box ? (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: box.top - PADDING,
            left: box.left - PADDING,
            width: box.width + PADDING * 2,
            height: box.height + PADDING * 2,
            borderRadius: 10,
            boxShadow: '0 0 0 9999px rgba(15, 18, 25, 0.55)',
            outline: '2px solid var(--mantine-color-indigo-4)',
            pointerEvents: 'none',
            zIndex: 300,
            transition: 'all 120ms ease-out',
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 18, 25, 0.55)', zIndex: 300 }}
        />
      )}

      <Card
        ref={karte}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        withBorder
        shadow="lg"
        padding="md"
        style={{
          position: 'fixed',
          zIndex: 301,
          maxHeight: `calc(100vh - ${2 * RAND}px)`,
          display: 'flex',
          flexDirection: 'column',
          ...platz,
        }}
      >
        <Stack gap="xs" style={{ minHeight: 0 }}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>{step.title}</Text>
            <Badge variant="light" color="gray" size="sm">
              {index + 1}/{steps.length}
            </Badge>
          </Group>

          {/* Nur der Text rollt; „Weiter“ muss immer erreichbar bleiben. */}
          <Text size="sm" c="dimmed" style={{ overflowY: 'auto', minHeight: 0 }}>
            {step.text}
          </Text>

          <Group justify="space-between" wrap="nowrap" mt={4}>
            <Button variant="subtle" color="gray" size="compact-sm" onClick={onClose}>
              {letzter ? 'schließen' : 'überspringen'}
            </Button>
            <Group gap="xs" wrap="nowrap">
              {index > 0 && (
                <Button variant="default" size="compact-sm" onClick={zurueck}>
                  Zurück
                </Button>
              )}
              <Button size="compact-sm" onClick={weiter}>
                {letzter ? 'Fertig' : 'Weiter'}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Card>
    </Portal>
  )
}
