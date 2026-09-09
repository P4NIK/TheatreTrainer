import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './index.css'

import App from './App'

const theme = createTheme({
  primaryColor: 'indigo',
  fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  defaultRadius: 'md',
})

/*
 * Nach dem ersten Besuch läuft die Seite ohne Netz – siehe public/sw.js.
 *
 * Nur im Build: im Dev-Server würde ein Service Worker die Dateien
 * zwischenspeichern, die Vite gerade frisch ausliefern will.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // Über BASE_URL, damit es auch dann stimmt, wenn die Seite in einem
    // Unterordner liegt – auf GitHub Pages ist das der Normalfall.
    const base = import.meta.env.BASE_URL
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
)
