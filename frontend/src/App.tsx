import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell, Anchor, Group, Loader, Text } from '@mantine/core'
import { IconMasksTheater } from '@tabler/icons-react'

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

/**
 * Minimal hash based routing – the app has exactly two screens, so a router
 * dependency would be overkill.
 *   #/            → project list
 *   #/p/<id>      → editor
 */
function currentProjectId(): string | null {
  const m = window.location.hash.match(/^#\/p\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(currentProjectId)

  useEffect(() => {
    const onHash = () => setProjectId(currentProjectId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
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
          {projectId ? (
            <EditorPage projectId={projectId} onBack={goHome} />
          ) : (
            <ProjectsPage onOpen={(id) => (window.location.hash = `#/p/${encodeURIComponent(id)}`)} />
          )}
        </Suspense>
      </AppShell.Main>
    </AppShell>
  )
}
