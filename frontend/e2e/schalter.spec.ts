/**
 * Die Schalter: umlegen, neu laden, nachsehen.
 *
 * Zwei Fragen, die zusammengehören. Erstens: Bringt ein Klick die Ansicht um?
 * Das ist keine erfundene Sorge – ein Schalter in der Hörfassung hat die Seite
 * weiß gemacht, und zwar nur in der Entwicklungsfassung, weil React dort jede
 * Zustandsfunktion zweimal aufruft. Zweitens: Steht der Schalter nach einem
 * Neuladen noch so, wie man ihn gestellt hat? Dafür sind die Einstellungen da.
 *
 * „Gesagtes auswerten“ wird ausgelassen: Der Schalter lädt beim Einschalten
 * rund 200 MB Spracherkennung nach. Was er sonst tut – gemerkt werden und nach
 * einem Absturz ausgeschaltet sein – prüfen die Vitest-Tests zu prefs.ts.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  achteAufFehler,
  einfuehrungWeg,
  fangnetzZugeschlagen,
  reiter,
  schalterListe,
  stimmeBereitstellen,
  stueckAnlegen,
} from './hilfen'

/** Schalter, die etwas Großes nachladen – hier nicht anfassen. */
const ZU_TEUER = /auswerten/i

/** Knöpfe, die aus der Ansicht führen oder Minuten dauern; die prüft der Durchlauf. */
const NICHT_DRUECKEN =
  /^(Zurück|Audio erzeugen|Probe starten|Ab hier starten|Sitzung starten|Vorbereiten|Abbrechen|Öffnen|.* löschen|Einführung starten)$/

/** Blöcke besorgen, damit Sprecher, Hörfassung und Karten etwas zu zeigen haben. */
async function stueckMitBloecken(page: Page) {
  // Damit die Hörprobe im Sprecher-Reiter nicht ins Netz muss.
  await stimmeBereitstellen(page)
  const angelegt = await stueckAnlegen(page, 'fett', 2)
  await page.getByRole('button', { name: 'Automatisch erkennen' }).first().click()
  await page.waitForTimeout(3500)
  await page.getByText(/Alle \d+ Seiten/).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Durchsuchen' }).click()
  const uebernehmen = page.getByRole('button', { name: /Blöcke übernehmen/ })
  await uebernehmen.waitFor({ timeout: 60000 })
  await uebernehmen.click()
  await page.waitForTimeout(2500)

  // Eine eigene Rolle, sonst bleibt „Rolle aussparen“ gesperrt.
  await reiter(page, 'Sprecher')
  await page.getByRole('radio', { name: /ist meine Rolle/ }).first().check()
  await page.waitForTimeout(800)
  return angelegt
}

const REITER = ['Editor', 'Sprecher', 'Hörfassung', 'Lernmodus', 'Karteikarten'] as const

test.describe('Schalter und Knöpfe', () => {
  test('jeder Schalter überlebt den Klick und das Neuladen', async ({ page }, testInfo) => {
    const fehler = achteAufFehler(page)
    await stueckMitBloecken(page)

    /** Was nach dem Umlegen stehen soll: Name → Zustand. */
    const erwartet = new Map<string, boolean>()
    let umgelegt = 0

    for (const name of REITER) {
      await reiter(page, name)
      const schalter = await schalterListe(page)
      for (let i = 0; i < schalter.length; i++) {
        // Nach jedem Klick baut Mantine die Beschreibung neu – frisch holen.
        const jetzt = (await schalterListe(page))[i]
        if (!jetzt) continue
        if (ZU_TEUER.test(jetzt.name)) continue
        if (await jetzt.ort.isDisabled()) continue

        const vorher = await jetzt.ort.isChecked()
        await jetzt.ort.click()
        await page.waitForTimeout(250)
        umgelegt++

        expect(await jetzt.ort.isChecked(), jetzt.name).toBe(!vorher)
        expect(await fangnetzZugeschlagen(page), jetzt.name).toBe('')
        erwartet.set(`${name}/${jetzt.name}`, !vorher)
      }
    }

    expect(umgelegt, 'es gibt Schalter zu prüfen').toBeGreaterThan(8)
    testInfo.annotations.push({ type: 'Schalter', description: `${umgelegt} umgelegt` })

    /* Und jetzt die eigentliche Frage: Steht das alles nach einem Neuladen noch? */
    await page.reload()
    await page.waitForTimeout(2500)
    await einfuehrungWeg(page)

    const falsch: string[] = []
    for (const name of REITER) {
      await reiter(page, name)
      for (const { name: schalterName, ort } of await schalterListe(page)) {
        const soll = erwartet.get(`${name}/${schalterName}`)
        if (soll === undefined) continue
        const ist = await ort.isChecked()
        if (ist !== soll) falsch.push(`${name}/${schalterName}: ${ist} statt ${soll}`)
      }
    }
    expect(falsch, falsch.join(' | ')).toEqual([])
    expect(fehler, fehler.join(' | ')).toEqual([])
  })

  test('auch Auswahl und Zahlen bleiben stehen', async ({ page }) => {
    const fehler = achteAufFehler(page)
    await stueckMitBloecken(page)

    await test.step('Blockliste: alle statt nur diese Seite', async () => {
      await reiter(page, 'Editor')
      await page.getByText('Alle', { exact: true }).click()
      await page.waitForTimeout(400)
    })

    await test.step('Hörfassung: ein Seitenbereich', async () => {
      await reiter(page, 'Hörfassung')
      await page.getByText('Seitenbereich', { exact: true }).click()
      await page.waitForTimeout(400)
      await page.locator('input[inputmode=decimal]').nth(0).fill('3')
      await page.waitForTimeout(600)
    })

    await test.step('Karteikarten: alles statt nur Fälliges, Stichwort 0', async () => {
      await reiter(page, 'Karteikarten')
      await page.getByText('Alles', { exact: true }).click()
      await page.getByRole('textbox', { name: 'Stichwort' }).fill('0')
      await page.waitForTimeout(600)
    })

    await page.reload()
    await page.waitForTimeout(2500)
    await einfuehrungWeg(page)

    await reiter(page, 'Editor')
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLInputElement>('.mantine-SegmentedControl-input:checked')?.value ?? null,
      ),
      'Blocklistenfilter',
    ).toBe('all')

    await reiter(page, 'Hörfassung')
    await expect(page.getByRole('radio', { name: 'Seitenbereich' })).toBeChecked()
    expect(await page.locator('input[inputmode=decimal]').nth(0).inputValue()).toBe('3')

    await reiter(page, 'Karteikarten')
    await expect(page.getByRole('radio', { name: 'Alles' })).toBeChecked()
    expect(await page.getByRole('textbox', { name: 'Stichwort' }).inputValue()).toBe('0')

    expect(fehler, fehler.join(' | ')).toEqual([])
  })

  test('jeder Knopf lässt sich drücken, ohne dass etwas zerbricht', async ({ page }, testInfo) => {
    const fehler = achteAufFehler(page)
    await stueckMitBloecken(page)

    const gedrueckt: string[] = []
    for (const name of REITER) {
      await reiter(page, name)

      /*
       * Alle Knöpfe der Ansicht, mit ihrem zugänglichen Namen: Beschriftung
       * oder aria-label. Symbolknöpfe haben nur Letzteres – und wären ohne
       * es weder für ein Vorleseprogramm noch für diese Prüfung auffindbar.
       */
      const namen: string[] = await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .filter((b) => b.getAttribute('role') !== 'tab' && !b.disabled)
          .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().split('\n')[0])
          .filter((t) => t.length > 0),
      )

      for (const knopf of [...new Set(namen)]) {
        if (NICHT_DRUECKEN.test(knopf)) continue
        const ort = page.getByRole('button', { name: knopf, exact: true }).first()
        if ((await ort.count()) === 0 || (await ort.isDisabled().catch(() => true))) continue
        await ort.click({ timeout: 8000 }).catch(() => undefined)
        await page.waitForTimeout(500)
        gedrueckt.push(`${name}/${knopf}`)

        // Ein Dialog, der aufgeht, wird wieder geschlossen.
        const abbrechen = page.getByRole('button', { name: /Abbrechen|Schließen/ })
        if (await abbrechen.count()) {
          await abbrechen.first().click().catch(() => undefined)
          await page.waitForTimeout(400)
        }
        expect(await fangnetzZugeschlagen(page), `${name}/${knopf}`).toBe('')
        expect((await page.locator('body').innerText()).length, `${name}/${knopf}`).toBeGreaterThan(50)

        // Falls ein Knopf doch weggeführt hat: zurück in den Reiter.
        if ((await page.getByRole('tab', { name, exact: true }).count()) === 0) {
          await page.goBack()
          await page.waitForTimeout(1200)
          await einfuehrungWeg(page)
        }
        if (!(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'))?.includes('true')) {
          await reiter(page, name)
        }
      }
    }

    testInfo.annotations.push({ type: 'Knöpfe', description: gedrueckt.join(', ') })
    console.log(`Gedrückt (${gedrueckt.length}): ${gedrueckt.join(', ')}`)
    // Die Schwelle schützt nur davor, dass die Prüfung nichts findet und
    // trotzdem grün ist.
    expect(gedrueckt.length).toBeGreaterThan(8)
    expect(fehler, fehler.join(' | ')).toEqual([])
  })
})
