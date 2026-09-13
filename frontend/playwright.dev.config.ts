/**
 * Dieselben Prüfungen, aber gegen den Dev-Server.
 *
 * Eine eigene Datei statt einer Umgebungsvariablen: `E2E_DEV=1 playwright
 * test` funktioniert nur in einer Unix-Schale, unter Windows ist es ein
 * Syntaxfehler – und eine weitere Abhängigkeit (`cross-env`) für eine Zeile
 * wäre zu viel des Guten.
 *
 * Auch nicht: die Variable hier oben setzen und die andere Datei importieren.
 * Ein `import` wird vorgezogen, die Zuweisung käme zu spät – und Playwright
 * liest die Datei zweimal, im Hauptlauf und noch einmal im Arbeiter. Beim
 * ersten Versuch lief dadurch der Server auf dem einen Port und die Prüfung
 * gegen den anderen. Also wird hier ausgeschrieben, was anders ist.
 *
 * Der Unterschied ist nicht kosmetisch: Im Dev-Server läuft React im
 * StrictMode und ruft jede Zustandsfunktion zweimal auf. Genau dort fiel der
 * Fehler auf, der die Hörfassung weiß machte – in der gebauten Fassung fiel er
 * nicht auf.
 */

import { defineConfig } from '@playwright/test'

import basis from './playwright.config'

const PORT = 5174

export default defineConfig({
  ...basis,
  use: { ...basis.use, baseURL: `http://127.0.0.1:${PORT}/` },
  webServer: {
    command: `vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
