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
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '@mantine/hooks'
import { Badge, Button, Card, Group, Portal, Stack, Text } from '@mantine/core'

import type { TabValue, TourStep } from '../../lib/tour'

interface Props {
  steps: TourStep[]
  /** Wird beim Schließen gerufen – auch beim Überspringen. */
  onClose: () => void
  /** Schaltet den Reiter um, den ein Schritt braucht. */
  onTab?: (tab: TabValue) => void
}

/** Abstand zwischen Loch und Rahmen. */
const PADDING = 6
const CARD_WIDTH = 380
const GAP = 14

export default function Tour({ steps, onClose, onTab }: Props) {
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<DOMRect | null>(null)
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

  if (!step) return null

  /*
   * Wo der Kasten steht.
   *
   * Auf dem Telefon immer am Rand – unten, oder oben, wenn das Ziel selbst
   * unten liegt. Am Rechner neben dem Ziel: darunter, wenn Platz ist, sonst
   * darüber, und waagerecht so weit geschoben, dass er im Bild bleibt.
   */
  const platz = (): React.CSSProperties => {
    if (schmal || !box) {
      const obenHin = box ? box.top + box.height / 2 > window.innerHeight / 2 : false
      return obenHin
        ? { top: 12, left: 12, right: 12 }
        : { bottom: 12, left: 12, right: 12 }
    }
    const darunter = box.bottom + GAP
    const passtDarunter = darunter + 220 < window.innerHeight
    const links = Math.min(
      Math.max(12, box.left + box.width / 2 - CARD_WIDTH / 2),
      window.innerWidth - CARD_WIDTH - 12,
    )
    return passtDarunter
      ? { top: darunter, left: links, width: CARD_WIDTH }
      : { bottom: window.innerHeight - box.top + GAP, left: links, width: CARD_WIDTH }
  }

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
        style={{ position: 'fixed', zIndex: 301, ...platz() }}
      >
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>{step.title}</Text>
            <Badge variant="light" color="gray" size="sm">
              {index + 1}/{steps.length}
            </Badge>
          </Group>

          <Text size="sm" c="dimmed">
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
