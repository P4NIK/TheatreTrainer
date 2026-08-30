/**
 * Picks which part of the play the run should cover. The maths lives in
 * lib/selection.ts; this is only the dialog around it.
 */
import { Badge, Group, NumberInput, SegmentedControl, Stack, Switch, Text } from '@mantine/core'

import {
  describeStretch,
  type Selection,
  type SelectionMode,
  type SelectionSettings,
} from '../../lib/selection'
import type { Project } from '../../types'

interface Props {
  project: Project
  settings: SelectionSettings
  onChange: (next: SelectionSettings) => void
  selection: Selection
  /** Blocks in the whole play, for the "x of y" line. */
  total: number
}

export default function SelectionCard({ project, settings, onChange, selection, total }: Props) {
  const set = <K extends keyof SelectionSettings>(key: K, value: SelectionSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const pages = Math.max(1, project.pageCount)
  const num = (key: 'fromPage' | 'toPage' | 'lead' | 'trail' | 'mergeGap', max: number) => ({
    value: settings[key],
    min: key === 'fromPage' || key === 'toPage' ? 1 : 0,
    max,
    step: 1,
    w: 120,
    onChange: (v: string | number) => {
      const n = typeof v === 'number' ? v : Number.parseInt(v, 10)
      if (Number.isFinite(n)) set(key, n)
    },
  })

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={settings.mode}
        onChange={(v) => set('mode', v as SelectionMode)}
        data={[
          { value: 'all', label: 'Ganzes Stück' },
          { value: 'pages', label: 'Seitenbereich' },
          {
            value: 'role',
            label: project.myRole ? `Auftritte von ${project.myRole}` : 'Meine Auftritte',
            disabled: !project.myRole,
          },
        ]}
      />

      {settings.mode === 'pages' && (
        <Group align="flex-end" gap="sm">
          <NumberInput label="Von Seite" {...num('fromPage', pages)} />
          <NumberInput label="Bis Seite" {...num('toPage', pages)} />
          <Text size="xs" c="dimmed" pb={8}>
            Das Stück hat {pages} {pages === 1 ? 'Seite' : 'Seiten'}.
          </Text>
        </Group>
      )}

      {settings.mode === 'role' && (
        <Stack gap="xs">
          <Group align="flex-end" gap="sm">
            <NumberInput
              label="Blöcke davor"
              description="Einsatz"
              {...num('lead', 20)}
            />
            <NumberInput
              label="Blöcke danach"
              description="Ausklang"
              {...num('trail', 20)}
            />
            <NumberInput
              label="Lücke überbrücken"
              description="Abstand, ab dem getrennt wird"
              {...num('mergeGap', 50)}
              w={200}
            />
          </Group>
          <Switch
            checked={settings.announce}
            onChange={(e) => set('announce', e.currentTarget.checked)}
            label="Übersprungene Stellen ansagen"
            description={
              'Vor jedem Abschnitt wird "Weiter auf Seite N." eingesprochen – mit der Stimme ' +
              'für Regieanweisungen. Ohne diese Stimme entfällt die Ansage.'
            }
          />
        </Stack>
      )}

      {settings.mode !== 'all' && (
        <Group gap="xs" align="center">
          <Badge variant="light" color={selection.blocks.length === 0 ? 'red' : 'blue'}>
            {selection.blocks.length} von {total} Blöcken
          </Badge>
          {selection.stretches.length > 0 && (
            <Text size="xs" c="dimmed">
              {selection.stretches.length === 1
                ? describeStretch(selection.stretches[0])
                : `${selection.stretches.length} Abschnitte: ` +
                  selection.stretches.slice(0, 6).map(describeStretch).join(', ') +
                  (selection.stretches.length > 6 ? ' …' : '')}
            </Text>
          )}
          {selection.blocks.length === 0 && (
            <Text size="xs" c="red">
              {settings.mode === 'role'
                ? `Für ${project.myRole || 'die eigene Rolle'} ist kein Block markiert.`
                : 'In diesem Seitenbereich liegt kein Block.'}
            </Text>
          )}
        </Group>
      )}
    </Stack>
  )
}
