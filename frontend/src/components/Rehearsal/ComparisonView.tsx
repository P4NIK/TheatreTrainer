/**
 * Shows what the recogniser understood against what the book says.
 *
 * Three shades, not two. A red word here means "the recogniser heard
 * something else" at least as often as it means "you said something else" –
 * so the display names both versions and leaves the judgement to the reader.
 */
import { Badge, Group, Stack, Text } from '@mantine/core'

import type { Comparison, WordState } from '../../lib/compare'

const STYLE: Record<WordState, React.CSSProperties> = {
  ok: { color: 'var(--mantine-color-green-9)' },
  near: { color: 'var(--mantine-color-yellow-8)', textDecoration: 'underline dotted' },
  wrong: { color: 'var(--mantine-color-red-8)', fontWeight: 600 },
  missing: {
    color: 'var(--mantine-color-red-8)',
    textDecoration: 'underline wavy',
    opacity: 0.85,
  },
  extra: { color: 'var(--mantine-color-gray-6)', fontStyle: 'italic' },
}

interface Props {
  comparison: Comparison
  /** The raw transcript, shown underneath so the reading stays checkable. */
  spoken: string
}

export default function ComparisonView({ comparison, spoken }: Props) {
  const percent = Math.round(comparison.score * 100)
  const color = percent >= 85 ? 'green' : percent >= 60 ? 'yellow' : 'red'

  return (
    <Stack gap={6}>
      <Group gap="xs">
        <Badge color={color} variant="light">
          {percent} % getroffen
        </Badge>
        <Text size="xs" c="dimmed">
          {comparison.hits} von {comparison.expectedCount} Wörtern wörtlich
          {comparison.near > 0 && `, ${comparison.near} fast`}
        </Text>
      </Group>

      <Text size="lg" style={{ lineHeight: 1.7 }}>
        {comparison.words.map((w, i) => (
          <span key={i}>
            <span
              style={STYLE[w.state]}
              title={
                w.state === 'wrong'
                  ? `verstanden: ${w.spoken}`
                  : w.state === 'near'
                    ? `verstanden: ${w.spoken}`
                    : w.state === 'missing'
                      ? 'nicht gehört'
                      : w.state === 'extra'
                        ? 'zusätzlich gesagt'
                        : undefined
              }
            >
              {w.state === 'extra' ? `(${w.spoken})` : w.expected}
            </span>{' '}
          </span>
        ))}
      </Text>

      <Text size="xs" c="dimmed">
        <b>Verstanden:</b> {spoken.trim() === '' ? '– nichts –' : spoken}
      </Text>

      <Group gap="md">
        <Legend state="ok" label="sitzt" />
        <Legend state="near" label="fast" />
        <Legend state="wrong" label="anders gesagt" />
        <Legend state="missing" label="nicht gehört" />
        <Legend state="extra" label="zusätzlich" />
      </Group>
    </Stack>
  )
}

function Legend({ state, label }: { state: WordState; label: string }) {
  return (
    <Text size="xs" style={STYLE[state]}>
      {label}
    </Text>
  )
}
