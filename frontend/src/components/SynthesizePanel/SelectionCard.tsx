/**
 * Picks which part of the play the run should cover. The maths lives in
 * lib/selection.ts; this is only the dialog around it.
 */
import { useState } from 'react'
import {
  Badge,
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from '@mantine/core'
import { IconListCheck } from '@tabler/icons-react'

import {
  describeStretch,
  type Selection,
  type SelectionMode,
  type SelectionSettings,
} from '../../lib/selection'
import type { Block, Project } from '../../types'
import BlockPickerModal from './BlockPickerModal'

interface Props {
  project: Project
  blocks: Block[]
  settings: SelectionSettings
  onChange: (next: SelectionSettings) => void
  selection: Selection
  /** Blocks in the whole play, for the "x of y" line. */
  total: number
}

export default function SelectionCard({
  project,
  blocks,
  settings,
  onChange,
  selection,
  total,
}: Props) {
  const [picking, setPicking] = useState(false)

  const set = <K extends keyof SelectionSettings>(key: K, value: SelectionSettings[K]) =>
    onChange({ ...settings, [key]: value })

  /**
   * Switching to the hand-picked mode carries the blocks that are currently in
   * effect over as a starting point – refining a rough selection beats ticking
   * two hundred boxes. Coming from "whole play" that would select everything,
   * which is no help, so that one starts empty.
   */
  const changeMode = (mode: SelectionMode) => {
    if (mode === 'blocks' && settings.blockIds.length === 0 && settings.mode !== 'all') {
      onChange({ ...settings, mode, blockIds: selection.blocks.map((b) => b.id) })
      return
    }
    onChange({ ...settings, mode })
  }

  const refine = () =>
    onChange({ ...settings, mode: 'blocks', blockIds: selection.blocks.map((b) => b.id) })

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
        onChange={(v) => changeMode(v as SelectionMode)}
        data={[
          { value: 'all', label: 'Ganzes Stück' },
          { value: 'pages', label: 'Seitenbereich' },
          {
            value: 'role',
            label: project.myRole ? `Auftritte von ${project.myRole}` : 'Meine Auftritte',
            disabled: !project.myRole,
          },
          { value: 'blocks', label: 'Einzelne Blöcke' },
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
        <Group align="flex-end" gap="sm">
          <NumberInput label="Blöcke davor" description="Einsatz" {...num('lead', 20)} />
          <NumberInput label="Blöcke danach" description="Ausklang" {...num('trail', 20)} />
          <NumberInput
            label="Lücke überbrücken"
            description="Abstand, ab dem getrennt wird"
            {...num('mergeGap', 50)}
            w={200}
          />
        </Group>
      )}

      {settings.mode === 'blocks' && (
        <Group gap="sm">
          <Button
            variant="light"
            leftSection={<IconListCheck size={18} />}
            onClick={() => setPicking(true)}
          >
            Blöcke auswählen
          </Button>
          <Text size="xs" c="dimmed">
            {settings.blockIds.length === 0
              ? 'Noch nichts gewählt – such dir die Blöcke aus der Liste zusammen.'
              : 'Die Auswahl bleibt erhalten, bis du sie änderst.'}
          </Text>
        </Group>
      )}

      {(settings.mode === 'role' || settings.mode === 'blocks') && (
        <Switch
          checked={settings.announce}
          onChange={(e) => set('announce', e.currentTarget.checked)}
          label="Übersprungene Stellen ansagen"
          description={
            'Vor jedem Abschnitt wird "Weiter auf Seite N." eingesprochen – mit der Stimme ' +
            'für Regieanweisungen. Ohne diese Stimme entfällt die Ansage.'
          }
        />
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
                : settings.mode === 'blocks'
                  ? 'Ohne gewählte Blöcke gibt es nichts vorzulesen.'
                  : 'In diesem Seitenbereich liegt kein Block.'}
            </Text>
          )}
          {settings.mode !== 'blocks' && selection.blocks.length > 0 && (
            <Button size="compact-xs" variant="subtle" onClick={refine}>
              einzeln nachjustieren
            </Button>
          )}
        </Group>
      )}

      <BlockPickerModal
        opened={picking}
        onClose={() => setPicking(false)}
        blocks={blocks}
        project={project}
        value={settings.blockIds}
        onApply={(ids) => set('blockIds', ids)}
      />
    </Stack>
  )
}
