/**
 * Hand-picking the blocks for a run. Neither a page range nor "everything
 * around my role" fits every rehearsal – sometimes it really is these eleven
 * lines and nothing else.
 *
 * The list keeps the play's order and is grouped by page, so it reads like the
 * script on the table. Shift-click extends from the last click, which is how a
 * scene gets selected in two clicks instead of thirty.
 */
import { useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'

import { DIRECTION_KEY, type Block, type Project } from '../../types'

interface Props {
  opened: boolean
  onClose: () => void
  blocks: Block[]
  project: Project
  /** Currently selected block IDs. */
  value: string[]
  onApply: (ids: string[]) => void
}

function toInt(v: string | number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

export default function BlockPickerModal({ opened, onClose, ...rest }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title="Blöcke auswählen">
      {/* Mounted only while open, so every visit starts from what is in effect. */}
      {opened && <Picker onClose={onClose} {...rest} />}
    </Modal>
  )
}

function Picker({ onClose, blocks, project, value, onApply }: Omit<Props, 'opened'>) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(value))
  const [query, setQuery] = useState('')
  const [speaker, setSpeaker] = useState<string | null>(null)
  const [fromPage, setFromPage] = useState(1)
  const [toPage, setToPage] = useState(Math.max(1, project.pageCount))
  const lastClicked = useRef<number | null>(null)

  const ordered = useMemo(() => [...blocks].sort((a, b) => a.order - b.order), [blocks])

  const speakers = useMemo(() => {
    const names = new Set<string>()
    for (const b of ordered) if (b.speaker?.trim()) names.add(b.speaker.trim())
    return [...names].sort((a, b) => a.localeCompare(b, 'de'))
  }, [ordered])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const lo = Math.min(fromPage, toPage)
    const hi = Math.max(fromPage, toPage)
    return ordered.filter((b) => {
      if (b.page < lo || b.page > hi) return false
      if (speaker === DIRECTION_KEY && b.type !== 'direction') return false
      if (speaker && speaker !== DIRECTION_KEY && b.speaker !== speaker) return false
      if (q === '') return true
      return b.text.toLowerCase().includes(q) || (b.speaker ?? '').toLowerCase().includes(q)
    })
  }, [ordered, query, speaker, fromPage, toPage])

  /** Shift-click applies the new state to everything since the last click. */
  const toggle = (index: number, checked: boolean, extend: boolean) => {
    const from = extend && lastClicked.current !== null ? lastClicked.current : index
    const [lo, hi] = from <= index ? [from, index] : [index, from]
    const next = new Set(picked)
    for (let i = lo; i <= hi; i++) {
      if (checked) next.add(visible[i].id)
      else next.delete(visible[i].id)
    }
    setPicked(next)
    lastClicked.current = index
  }

  const setAllVisible = (checked: boolean) => {
    const next = new Set(picked)
    for (const b of visible) {
      if (checked) next.add(b.id)
      else next.delete(b.id)
    }
    setPicked(next)
    lastClicked.current = null
  }

  /** Grouped by page so the list reads like the script on the table. */
  const groups = useMemo(() => {
    const out: { page: number; rows: { block: Block; index: number }[] }[] = []
    visible.forEach((block, index) => {
      const last = out[out.length - 1]
      if (last && last.page === block.page) last.rows.push({ block, index })
      else out.push({ page: block.page, rows: [{ block, index }] })
    })
    return out
  }, [visible])

  const isOwn = (b: Block) =>
    project.myRole !== '' &&
    (b.speaker ?? '').trim().toLowerCase() === project.myRole.trim().toLowerCase()

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <TextInput
          flex={1}
          label="Suchen"
          placeholder="Text oder Sprecher"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <Select
          label="Sprecher"
          placeholder="alle"
          clearable
          w={200}
          value={speaker}
          onChange={setSpeaker}
          data={[
            ...speakers.map((s) => ({ value: s, label: s })),
            { value: DIRECTION_KEY, label: 'Regieanweisungen' },
          ]}
        />
        <NumberInput
          label="Seite von"
          w={100}
          min={1}
          max={Math.max(1, project.pageCount)}
          value={fromPage}
          onChange={(v) => setFromPage(toInt(v, fromPage))}
        />
        <NumberInput
          label="bis"
          w={100}
          min={1}
          max={Math.max(1, project.pageCount)}
          value={toPage}
          onChange={(v) => setToPage(toInt(v, toPage))}
        />
      </Group>

      <Group gap="xs">
        <Button size="compact-sm" variant="light" onClick={() => setAllVisible(true)}>
          Sichtbare wählen
        </Button>
        <Button
          size="compact-sm"
          variant="subtle"
          color="gray"
          onClick={() => setAllVisible(false)}
        >
          Sichtbare abwählen
        </Button>
        <Text size="xs" c="dimmed">
          {visible.length === ordered.length
            ? `${ordered.length} Blöcke`
            : `${visible.length} von ${ordered.length} Blöcken sichtbar`}
          {' · '}
          Mit gedrückter Umschalttaste wählst du bis zum vorigen Klick.
        </Text>
      </Group>

      <ScrollArea h={440} type="auto" offsetScrollbars>
        <Stack gap={2}>
          {groups.map((group, gi) => (
            <div key={`${group.page}-${group.rows[0].block.id}`}>
              <Text size="xs" fw={700} c="dimmed" mt={gi === 0 ? 0 : 'sm'} mb={4}>
                Seite {group.page}
              </Text>
              <Stack gap={2}>
                {group.rows.map(({ block: b, index }) => (
                  <Checkbox
                    key={b.id}
                    checked={picked.has(b.id)}
                    onChange={(e) =>
                      toggle(index, e.currentTarget.checked, (e.nativeEvent as MouseEvent).shiftKey)
                    }
                    label={
                      <Group gap={6} wrap="nowrap" align="baseline">
                        <Text size="xs" c="dimmed" w={28} ta="right" style={{ flexShrink: 0 }}>
                          {b.order}
                        </Text>
                        <Badge
                          size="xs"
                          variant={isOwn(b) ? 'filled' : 'light'}
                          color={b.type === 'direction' ? 'gray' : isOwn(b) ? 'green' : 'blue'}
                          style={{ flexShrink: 0 }}
                        >
                          {b.type === 'direction' ? 'Regie' : (b.speaker ?? '?')}
                        </Badge>
                        <Text size="sm" lineClamp={2}>
                          {b.text.trim() || <span style={{ opacity: 0.5 }}>(leer)</span>}
                        </Text>
                      </Group>
                    }
                  />
                ))}
              </Stack>
            </div>
          ))}
          {visible.length === 0 && (
            <Text size="sm" c="dimmed" py="lg" ta="center">
              Kein Block passt zu dieser Suche.
            </Text>
          )}
        </Stack>
      </ScrollArea>

      <Group justify="space-between">
        <Text size="sm" c={picked.size === 0 ? 'red' : undefined}>
          {picked.size} von {ordered.length} Blöcken gewählt
        </Text>
        <Group gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            onClick={() => {
              onApply([...picked])
              onClose()
            }}
          >
            Übernehmen
          </Button>
        </Group>
      </Group>
    </Stack>
  )
}
