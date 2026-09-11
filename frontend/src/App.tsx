import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell, Anchor, Group, Loader, Text } from '@mantine/core'
import { IconMasksTheater } from '@tabler/icons-react'

import { noteStart, touchMarker } from './lib/diagnose'
import ProjectsPage from './pages/ProjectsPage'

/**
 * Der Editor wird nachgeladen.
 *
 * An ihm hängt pdf.js, und das ist der größte Brocken der Anwendung. Wer die
 * Seite aufruft, sieht aber erst einmal seine Stückeliste – und die soll sofort
 * dastehen. Geholt wird der Editor beim Öffnen eines Stücks, was ohnehin einen
 * Wimpernschlag dauert.
 */
const EditorPage = lazy(() => import('./pages/EditorPage'))

/** Die Technik-Prüfung braucht kaum jemand, und dann sofort. Also auch später. */
const DiagnosePage = lazy(() => import('./pages/DiagnosePage'))

/**
 * Minimal hash based routing – the app has a handful of screens, so a router
 * dependency would be overkill.
 *   #/            → project list
 *   #/p/<id>      → editor
 *   #/technik     → what this device can do
 */
type Route = { page: 'projects' } | { page: 'editor'; id: string } | { page: 'technik' }

function currentRoute(): Route {
  const hash = window.location.hash
  const m = hash.match(/^#\/p\/([^/]+)/)
  if (m) return { page: 'editor', id: decodeURIComponent(m[1]) }
  if (hash.startsWith('#/technik')) return { page: 'technik' }
  return { page: 'projects' }
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute)

  useEffect(() => {
    const onHash = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /*
   * Die Langzeit-Marke wird beim Start gesetzt, nicht erst in der
   * Technik-Prüfung: Gezählt werden soll, wann jemand die App benutzt hat, und
   * nicht, wann er zuletzt nachgesehen hat, ob sie noch funktioniert.
   */
  useEffect(() => {
    void touchMarker().catch(() => undefined)
    // Und ein Strich für diesen Start – siehe noteStart().
    noteStart()
  }, [])

  const goHome = () => {
    window.location.hash = '#/'
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <IconMasksTheater size={22} />
            <Anchor onClick={goHome} c="inherit" underline="never" fw={600}>
              Theater-Vorleser
            </Anchor>
          </Group>
          <Text size="xs" c="dimmed" visibleFrom="sm">
            im Browser · offline · ohne Server
          </Text>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Suspense
          fallback={
            <Group justify="center" py="xl">
              <Loader />
            </Group>
          }
        >
          {route.page === 'editor' ? (
            <EditorPage projectId={route.id} onBack={goHome} />
          ) : route.page === 'technik' ? (
            <DiagnosePage onBack={goHome} />
          ) : (
            <ProjectsPage onOpen={(id) => (window.location.hash = `#/p/${encodeURIComponent(id)}`)} />
          )}
        </Suspense>
      </AppShell.Main>
    </AppShell>
  )
}
