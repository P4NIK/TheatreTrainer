import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core'
import { IconGripVertical, IconPencil, IconPlayerPlay, IconTrash } from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'
import { useRef, useState } from 'react'


import { encodeWav } from '../../lib/audio'
import { blockColor, renumber, splitParens } from '../../lib/blocks'
import { engineFor } from '../../lib/engine'
import { requestFor } from '../../lib/pipeline'
import type { Block, Speakers } from '../../types'

interface Props {
  projectId: string
  blocks: Block[]
  speakers: Speakers
  page: number
  filter: 'page' | 'all'
  onFilterChange: (f: 'page' | 'all') => void
  selectedId: string | null
  onSelect: (id: string) => void
  onEdit: (block: Block) => void
  onDelete: (id: string) => void
  /** Receives the complete, renumbered block list. */
  onReorder: (blocks: Block[]) => void
}

export default function BlockList({
  projectId,
  blocks,
  speakers,
  page,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onReorder,
}: Props) {
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // The first play of a block synthesizes it; from then on it comes out of the
  // cache and starts immediately – and the full run gets it for free.
  const play = async (id: string) => {
    setPlaying(id)
    try {
      const block = blocks.find((b) => b.id === id)
      if (!block) throw new Error('Diesen Block gibt es nicht mehr')

      // The own role plays no part here: nothing is skipped, whoever presses
      // play wants to hear this one block.
      const { request, ok } = requestFor(block, { myRole: '' }, speakers, {
        skipMyRole: false,
        includeDirections: true,
      })
      if (!ok || !request) throw new Error('Für diesen Block ist keine Stimme konfiguriert')

      const rendered = await engineFor(projectId).render(request)
      const url = URL.createObjectURL(
        new Blob([encodeWav(rendered.samples, rendered.sampleRate)], { type: 'audio/wav' }),
      )
      audioRef.current?.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (e) {
      notifications.show({ color: 'red', title: 'Block konnte nicht abgespielt werden', message: (e as Error).message })
    } finally {
      setPlaying(null)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  const visible = filter === 'page' ? ordered.filter((b) => b.page === page) : ordered

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = visible.findIndex((b) => b.id === active.id)
    const to = visible.findIndex((b) => b.id === over.id)
    if (from < 0 || to < 0) return

    // Reorder only the visible subset, then write it back into the global
    // positions it occupied. That keeps "current page" filtering usable.
    const movedVisible = arrayMove(visible, from, to)
    const slots = ordered
      .map((b, i) => (visible.some((v) => v.id === b.id) ? i : -1))
      .filter((i) => i >= 0)

    const next = [...ordered]
    slots.forEach((slot, i) => {
      next[slot] = movedVisible[i]
    })
    onReorder(renumber(next))
  }

  return (
    <Stack gap="xs" h="100%">
      <Group justify="space-between">
        <Text fw={600}>Blöcke</Text>
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={(v) => onFilterChange(v as 'page' | 'all')}
          data={[
            { label: 'Diese Seite', value: 'page' },
            { label: 'Alle', value: 'all' },
          ]}
        />
      </Group>

      {visible.length === 0 ? (
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            Noch keine Blöcke. Ziehe im PDF ein Rechteck über eine Textzeile.
          </Text>
        </Paper>
      ) : (
        <ScrollArea style={{ flex: 1 }} offsetScrollbars>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visible.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              <Stack gap={6}>
                {visible.map((b) => (
                  <SortableRow
                    key={b.id}
                    block={b}
                    color={blockColor(b, speakers)}
                    selected={b.id === selectedId}
                    showPage={filter === 'all'}
                    onSelect={() => onSelect(b.id)}
                    onEdit={() => onEdit(b)}
                    onDelete={() => onDelete(b.id)}
                    onPlay={() => play(b.id)}
                    playing={playing === b.id}
                  />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        </ScrollArea>
      )}
    </Stack>
  )
}

interface RowProps {
  block: Block
  color: string
  selected: boolean
  showPage: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onPlay: () => void
  playing: boolean
}

function SortableRow({
  block,
  color,
  selected,
  showPage,
  onSelect,
  onEdit,
  onDelete,
  onPlay,
  playing,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="xs"
      onClick={onSelect}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        borderLeft: `4px solid ${color}`,
        background: selected ? 'var(--mantine-color-indigo-0)' : undefined,
        cursor: 'pointer',
      }}
    >
      <Group gap={6} wrap="nowrap" align="flex-start">
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          {...attributes}
          {...listeners}
          style={{ cursor: 'grab' }}
          aria-label="Reihenfolge ändern"
        >
          <IconGripVertical size={14} />
        </ActionIcon>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} mb={2}>
            <Badge size="xs" variant="light" color="gray">
              {block.order}
            </Badge>
            {showPage && (
              <Badge size="xs" variant="outline" color="gray">
                S. {block.page}
              </Badge>
            )}
            <Text size="xs" fw={600} c={block.type === 'direction' ? 'blue' : undefined}>
              {block.type === 'direction' ? 'Regie' : block.speaker || 'ohne Sprecher'}
            </Text>
          </Group>
          <Text size="xs" lineClamp={3} fs={block.type === 'direction' ? 'italic' : undefined}>
            {splitParens(block.text).map((part, i) => (
              <span key={i} style={part.paren ? { fontStyle: 'italic', color: '#1c7ed6' } : undefined}>
                {part.text}
              </span>
            ))}
          </Text>
        </div>

        <Stack gap={2}>
          <ActionIcon
            variant="subtle"
            size="sm"
            loading={playing}
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
            aria-label="Block anhören"
          >
            <IconPlayerPlay size={14} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            aria-label="Block bearbeiten"
          >
            <IconPencil size={14} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            aria-label="Block löschen"
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Stack>
      </Group>
    </Paper>
  )
}
