/**
 * Ein Fehler in einer Ansicht darf nicht die ganze Seite kosten.
 *
 * Ohne das hier endet jeder Fehler beim Zeichnen so: React wirft alles weg,
 * zurück bleibt ein weißes Fenster, und was passiert ist, steht nur in der
 * Entwicklerkonsole – die auf einem Telefon niemand öffnet. Gemeldet wird
 * dann „die Seite ist weiß“, und damit kann niemand etwas anfangen.
 *
 * Also: Der Fehler wird gefangen, ins Protokoll geschrieben (und liegt damit
 * im Bericht der Technik-Prüfung), und an der Stelle der abgestürzten Ansicht
 * steht, was los ist. „Noch einmal versuchen“ baut nur diese Ansicht neu auf –
 * ein Reiter, der nicht will, lässt die anderen in Ruhe.
 *
 * Eine Klasse, weil React das Fangen bis heute nur so anbietet.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, Button, Code, Group, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'

import { flush, log } from '../../lib/protokoll'

interface Props {
  /** Wie die Ansicht heißt – steht im Protokoll und in der Meldung. */
  name: string
  children: ReactNode
}

interface State {
  error: Error | null
  /** Wird hochgezählt, um die Kinder neu aufzubauen. */
  versuch: number
}

export default class Fehlerfang extends Component<Props, State> {
  state: State = { error: null, versuch: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Die erste Zeile des Komponentenstapels sagt, welches Stück Anzeige es
    // war; der ganze Stapel wäre im Protokoll eine Textwand.
    const wo = (info.componentStack ?? '').trim().split('\n')[0]?.trim() ?? ''
    log(`Anzeige „${this.props.name}“ abgestürzt: ${error.message}${wo ? ` · ${wo}` : ''}`)
    flush()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return <div key={this.state.versuch}>{this.props.children}</div>

    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />} title={`${this.props.name} ist abgestürzt`}>
        <Stack gap="xs">
          <Text size="sm">
            Der Fehler steht im Protokoll und damit auch im Bericht der Technik-Prüfung – von dort
            lässt er sich weitergeben. Deine Blöcke und Einstellungen sind unberührt.
          </Text>
          <Code block style={{ whiteSpace: 'pre-wrap' }}>
            {error.message}
          </Code>
          <Group gap="xs">
            <Button size="compact-sm" onClick={() => this.setState((s) => ({ error: null, versuch: s.versuch + 1 }))}>
              Noch einmal versuchen
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => window.location.reload()}
            >
              Seite neu laden
            </Button>
          </Group>
        </Stack>
      </Alert>
    )
  }
}
