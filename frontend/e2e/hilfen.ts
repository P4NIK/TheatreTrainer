/**
 * Was jede E2E-Prüfung braucht.
 *
 * Vor allem dreierlei: die Einführung wegklicken (sie legt sich beim ersten
 * Besuch über alles), ein Stück anlegen, und die Stimme bereitstellen, ohne
 * dafür 63 MB aus dem Netz zu holen.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { baueTextbuch, type Profil, type Wahrheit } from './stueck'

/** Wo eine Stimme liegen darf, damit die Prüfung ohne Netz auskommt. */
const STIMME_PFADE = [
  process.env.E2E_STIMME ?? '',
  resolve(process.cwd(), '../voices/de_DE-thorsten-medium.onnx'),
  resolve(process.cwd(), 'public/voice/de_DE-thorsten-medium.onnx'),
].filter(Boolean)

export function stimmeAufDerPlatte(): string | null {
  return STIMME_PFADE.find((pfad) => existsSync(pfad)) ?? null
}

/**
 * Die Stimme aus einer Datei bedienen statt aus dem Netz.
 *
 * Die App holt sie von HuggingFace. In einer Prüfung ist das die eine Stelle,
 * an der ein fremder Server über Erfolg oder Misserfolg entscheidet – und
 * 63 MB je Lauf kosten würde er auch. Liegt eine Stimme lokal, wird die
 * Anfrage von dort beantwortet; sonst geht sie wie gewohnt ins Netz.
 */
export async function stimmeBereitstellen(page: Page): Promise<'platte' | 'netz'> {
  const onnx = stimmeAufDerPlatte()
  if (!onnx) return 'netz'
  await page.route(/huggingface\.co.*\.onnx$/, (route) =>
    route.fulfill({ path: onnx, contentType: 'application/octet-stream' }),
  )
  await page.route(/huggingface\.co.*\.onnx\.json$/, (route) =>
    route.fulfill({ path: `${onnx}.json`, contentType: 'application/json' }),
  )
  return 'platte'
}

/**
 * Die Einführung wegklicken.
 *
 * Sie startet beim ersten Öffnen jedes Reiters von selbst – richtig so, aber
 * sie fängt jeden Klick ab, den die Prüfung eigentlich meint.
 */
export async function einfuehrungWeg(page: Page): Promise<number> {
  let weg = 0
  for (let i = 0; i < 15; i++) {
    if ((await page.locator('[role=dialog]').count()) === 0) break
    await page
      .locator('[role=dialog]')
      .last()
      .getByRole('button', { name: /überspringen|schließen|Fertig/ })
      .click({ timeout: 5000 })
      .catch(() => undefined)
    weg++
    await page.waitForTimeout(250)
  }
  return weg
}

/** Auf einen Reiter wechseln und die Einführung dazu wegklicken. */
export async function reiter(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click()
  await page.waitForTimeout(600)
  await einfuehrungWeg(page)
}

/** Meldet jeden Fehler der Seite als Testfehler – sonst gehen sie unter. */
export function achteAufFehler(page: Page): string[] {
  const fehler: string[] = []
  page.on('pageerror', (e) => fehler.push(e.message.split('\n')[0]))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    /*
     * Was das Netz betrifft, ist kein Fehler der App: Die Stimme kommt von
     * HuggingFace, und ein Prüfstand ohne Zugang (oder mit Sperre davor)
     * würde sonst bei jedem Lauf rot – obwohl der Code nichts dafür kann.
     * Was die App daraus macht, prüft der Durchlauf an anderer Stelle.
     */
    if (/favicon|net::ERR_/.test(text)) return
    fehler.push(`console: ${text.split('\n')[0].slice(0, 160)}`)
  })
  return fehler
}

/** Ist die Ansicht abgestürzt? Das Fangnetz sagt es. */
export async function fangnetzZugeschlagen(page: Page): Promise<string> {
  if ((await page.getByText(/ist abgestürzt/).count()) === 0) return ''
  const meldung = await page.getByText(/ist abgestürzt/).first().innerText()
  const grund = await page.locator('code').first().innerText().catch(() => '')
  return `${meldung}: ${grund}`
}

export interface AngelegtesStueck {
  wahrheit: Wahrheit
  projektId: string
}

/**
 * Ein Stück anlegen – gebaut, nicht mitgebracht.
 *
 * Das PDF entsteht in diesem Augenblick aus e2e/stueck.ts; im Repository
 * liegt kein fremder Text und überhaupt kein PDF.
 */
export async function stueckAnlegen(
  page: Page,
  profil: Profil = 'fett',
  seiten = 6,
): Promise<AngelegtesStueck> {
  const { pdf, wahrheit } = baueTextbuch(profil, seiten)

  await page.goto('/')
  await page.waitForTimeout(1200)
  await einfuehrungWeg(page)

  await page.getByRole('button', { name: /Erstes Projekt|Neues Projekt/ }).first().click()
  await page.getByLabel('Name des Stücks').fill(wahrheit.titel)
  await page.locator('input[type=file]').last().setInputFiles({
    name: 'pruefstueck.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf),
  })
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click()

  await expect(page.getByRole('tab', { name: 'Editor' })).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1500)
  await einfuehrungWeg(page)

  const projektId = await page.evaluate(() => decodeURIComponent(location.hash.replace('#/p/', '')))
  return { wahrheit, projektId }
}

/** Alle Schalter einer Ansicht, mit ihrem Namen. */
export async function schalterListe(page: Page): Promise<{ name: string; ort: Locator }[]> {
  const schalter = page.locator('input[role=switch]')
  const wie = await schalter.count()
  const out: { name: string; ort: Locator }[] = []
  for (let i = 0; i < wie; i++) {
    const ort = schalter.nth(i)
    const name = await ort.evaluate((el) => {
      const id = el.getAttribute('id')
      const label = id ? document.querySelector(`label[for="${id}"]`) : null
      return (label?.textContent ?? el.getAttribute('aria-label') ?? '(ohne Namen)')
        .slice(0, 40)
        .trim()
    })
    out.push({ name, ort })
  }
  return out
}

/**
 * Eine Hörfassung erzeugen und warten, bis sie wirklich fertig ist.
 *
 * Der Umweg über „erst verschwindet die alte Meldung“ ist nötig, weil sonst
 * die *vorige* gelesen wird: Nach einem zweiten Klick steht „Fertig – 9 neu
 * erzeugt“ noch da, und eine Prüfung, die sofort liest, hält das für das
 * Ergebnis des zweiten Laufs. Genau darauf ist diese Prüfung einmal
 * hereingefallen und hat einen Fehler im Zwischenspeicher gemeldet, den es
 * nicht gab.
 */
export async function hoerfassungErzeugen(page: Page, zeit = 4 * 60 * 1000): Promise<string> {
  const fertig = page.getByText(/Fertig –/)
  await page.getByRole('button', { name: 'Audio erzeugen' }).click()

  // Der Lauf hat angefangen, wenn die alte Meldung weg ist.
  await expect(fertig).toHaveCount(0, { timeout: 30000 })
  await expect(fertig).toHaveCount(1, { timeout: zeit })
  return fertig.innerText()
}

/** Das Protokoll, das die App selbst geschrieben hat. */
export async function protokoll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const roh = JSON.parse(localStorage.getItem('theater-protokoll') ?? '[]') as {
        text: string
      }[]
      return roh.map((e) => e.text)
    } catch {
      return []
    }
  })
}
