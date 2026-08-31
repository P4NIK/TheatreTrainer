import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Group,
  Input,
  Autocomplete,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
} from '@mantine/core'
import { IconScissors, IconTrash } from '@tabler/icons-react'

import { hasParentheticals, splitBlockAtParens } from '../../lib/blocks'
import { stripParentheticals } from '../../lib/detect'
import type { Block, BlockType } from '../../types'

interface Props {
  /** null closes the modal. */
  block: Block | null
  /** Existing speaker names for the autocomplete. */
  speakerOptions: string[]
  isNew: boolean
  /** Receives one block – or several, when the block was split up. */
  onSave: (blocks: Block[]) => void
  onClose: () => void
}

export default function BlockEditModal({ block, speakerOptions, isNew, onSave, onClose }: Props) {
  const [type, setType] = useState<BlockType>('line')
  const [speaker, setSpeaker] = useState('')
  const [text, setText] = useState('')

  useEffect(() => {
    if (!block) return
    setType(block.type)
    setSpeaker(block.speaker ?? '')
    setText(block.text)
  }, [block])

  /** The block as it currently stands in the dialog. */
  const edited = (): Block | null =>
    block && {
      ...block,
      type,
      speaker: type === 'direction' ? null : speaker.trim() || null,
      text: text.trim(),
    }

  const save = () => {
    const b = edited()
    if (b) onSave([b])
  }

  const split = () => {
    const b = edited()
    if (b) onSave(splitBlockAtParens(b))
  }

  const current = edited()
  const preview = current && hasParentheticals(text) ? splitBlockAtParens(current) : []
  const canSplit = preview.length > 1

  return (
    <Modal
      opened={block !== null}
      onClose={onClose}
      title={isNew ? 'Neuer Block' : `Block ${block?.order} bearbeiten`}
      centered
      size="lg"
    >
      <Stack>
        <Input.Wrapper
          label="Wie wird dieser Block gelesen?"
          description="Gilt für den ganzen Block – umschalten ändert nur die Stimme, nicht den Text."
        >
          <SegmentedControl
            mt={6}
            fullWidth
            value={type}
            onChange={(v) => setType(v as BlockType)}
            data={[
              { label: 'Als Sprechtext einer Rolle', value: 'line' },
              { label: 'Als Regieanweisung', value: 'direction' },
            ]}
          />
        </Input.Wrapper>

        {type === 'line' && (
          <Autocomplete
            label="Sprecher"
            placeholder="z. B. SIR ROWLAND"
            data={speakerOptions}
            value={speaker}
            onChange={setSpeaker}
            description="Neue Namen werden automatisch in die Sprecher-Verwaltung übernommen."
          />
        )}

        <Textarea
          label="Text"
          autosize
          minRows={3}
          maxRows={12}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          description="Aus dem PDF übernommen – hier korrigieren, bevor er vorgelesen wird."
          data-autofocus
        />

        {canSplit && (
          <Paper withBorder p="sm" bg="var(--mantine-color-gray-0)">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Dieser Block enthält Text in Klammern
              </Text>
              <Text size="xs" c="dimmed">
                Im Stück sind das Regieanweisungen. So wie er ist, liest ihn eine einzige Stimme
                komplett vor – Klammern inklusive. Entweder du machst {preview.length} eigene
                Blöcke daraus, dann bekommt jeder Teil seine Stimme, oder du wirfst die
                Klammerteile weg.
              </Text>

              <Stack gap={4}>
                {preview.map((p, i) => (
                  <Group key={i} gap={6} wrap="nowrap" align="baseline">
                    <Badge
                      size="xs"
                      variant="light"
                      color={p.type === 'direction' ? 'gray' : 'blue'}
                      style={{ flexShrink: 0 }}
                    >
                      {p.type === 'direction' ? 'Regie' : p.speaker || 'ohne Sprecher'}
                    </Badge>
                    <Text size="xs" lineClamp={1} fs={p.type === 'direction' ? 'italic' : undefined}>
                      {p.text}
                    </Text>
                  </Group>
                ))}
              </Stack>

              <Group gap="xs">
                <Button
                  size="compact-sm"
                  variant="light"
                  leftSection={<IconScissors size={16} />}
                  onClick={split}
                >
                  In {preview.length} Blöcke aufteilen
                </Button>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => setText(stripParentheticals(text))}
                >
                  Klammerteile entfernen
                </Button>
              </Group>
            </Stack>
          </Paper>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={text.trim() === ''}>
            {isNew ? 'Hinzufügen' : 'Speichern'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
