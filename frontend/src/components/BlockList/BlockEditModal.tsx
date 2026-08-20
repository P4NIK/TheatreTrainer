import { useEffect, useState } from 'react'
import {
  Autocomplete,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Textarea,
} from '@mantine/core'

import type { Block, BlockType } from '../../types'

interface Props {
  /** null closes the modal. */
  block: Block | null
  /** Existing speaker names for the autocomplete. */
  speakerOptions: string[]
  isNew: boolean
  onSave: (block: Block) => void
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

  const save = () => {
    if (!block) return
    onSave({
      ...block,
      type,
      speaker: type === 'direction' ? null : speaker.trim() || null,
      text: text.trim(),
    })
  }

  return (
    <Modal
      opened={block !== null}
      onClose={onClose}
      title={isNew ? 'Neuer Block' : `Block ${block?.order} bearbeiten`}
      centered
      size="lg"
    >
      <Stack>
        <SegmentedControl
          value={type}
          onChange={(v) => setType(v as BlockType)}
          data={[
            { label: 'Sprechtext', value: 'line' },
            { label: 'Regieanweisung', value: 'direction' },
          ]}
        />

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
