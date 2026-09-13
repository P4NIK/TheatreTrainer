/**
 * Die E2E-Prüfungen.
 *
 *   npx playwright install chromium     # einmalig
 *   npm run e2e                         # gebaute Fassung, wie sie ausgeliefert wird
 *   npm run e2e:dev                     # Dev-Server, also mit StrictMode
 *   npm run e2e:bericht                 # den letzten Lauf im Browser ansehen
 *
 * Zwei Fassungen, weil sie verschiedene Fehler zeigen. Die gebaute ist das,
 * was auf dem Telefon läuft. Die Entwicklungsfassung ruft unter `StrictMode`
 * jede Zustandsfunktion zweimal auf – dort fiel der Fehler auf, der die
 * Hörfassung weiß machte, und in der gebauten Fassung fiel er nicht auf.
 *
 * Der Server wird selbst gestartet. Drei Kleinigkeiten daran haben einen
 * Grund, und alle drei kosteten einmal zwei Minuten Warten und die Meldung
 * „Timed out waiting 120000ms from config.webServer“:
 *
 *   - `npm run build` steht vor dem Ausliefern. `vite preview` zeigt `dist/`;
 *     ohne vorherigen Build gibt es das nicht, und der Server beendet sich
 *     sofort wieder.
 *   - `--host 127.0.0.1`. Ohne das horcht Vite auf „localhost“, und unter
 *     Windows ist das seit Node 18 zuerst ::1 – geklopft wird aber an
 *     127.0.0.1, und da macht niemand auf.
 *   - `stdout: 'pipe'`. Damit steht beim nächsten Mal die Meldung des Servers
 *     im Protokoll statt nur „abgelaufen“.
 */

import { defineConfig, devices } from '@playwright/test'

/** Die gebaute Fassung wird von `vite preview` unter diesem Port gezeigt. */
export const PORT = 4173

/*
 * Normalerweise nimmt Playwright den Browser, den es selbst mitbringt. Wo
 * schon einer liegt (Prüfstände, abgeschottete Rechner ohne Zugang zum
 * Playwright-Spiegel), sagt E2E_CHROMIUM, wo.
 */
const eigenerBrowser = process.env.E2E_CHROMIUM
  ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] }
  : {}

export default defineConfig({
  testDir: './e2e',
  // Ein Durchlauf erzeugt Ton; das dauert, und nebeneinander laufende Läufe
  // würden sich um Speicher und Rechenzeit streiten.
  fullyParallel: false,
  workers: 1,
  timeout: 10 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    launchOptions: eigenerBrowser,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      /*
       * Das Telefon ist der Ernstfall – dort läuft die App als Web-App auf
       * dem Home-Bildschirm. Gefahren wird sie in Chromium, weil das überall
       * da ist; wer WebKit installiert hat (`npx playwright install webkit`),
       * setzt E2E_WEBKIT=1 und prüft damit genau die Engine des iPhones.
       */
      name: 'telefon',
      use: {
        ...devices['iPhone 13'],
        browserName: process.env.E2E_WEBKIT === '1' ? 'webkit' : 'chromium',
      },
    },
    {
      name: 'rechner',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: `npm run build && vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    // Ein schon laufender Server wird genommen, wie er ist – praktisch beim
    // Schreiben von Prüfungen, wenn nebenher `npm run dev` läuft.
    reuseExistingServer: true,
    // Der Build ist mit drin; auf einem müden Rechner dauert das.
    timeout: 240 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
