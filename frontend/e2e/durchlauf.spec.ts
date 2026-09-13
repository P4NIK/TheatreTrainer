/**
 * Der ganze Weg, einmal: Stück anlegen, Blöcke markieren, automatisch
 * erkennen, Stimmen einstellen, Hörfassung erzeugen, proben, Karten lernen,
 * sichern, löschen, zurückholen.
 *
 * Das Stück dafür wird gebaut (siehe stueck.ts) – im Repository liegt kein
 * fremder Text. Weil der Bauplan die Wahrheit kennt, prüft dieser Durchlauf
 * nicht „ungefähr genug Blöcke“, sondern genau die Zahlen, die hineingingen:
 * 69 Repliken, 13 Regieanweisungen, und je Rolle die Zahl aus dem
 * Personenverzeichnis.
 */

import { expect, test } from '@playwright/test'

import {
  achteAufFehler,
  einfuehrungWeg,
  fangnetzZugeschlagen,
  hoerfassungErzeugen,
  protokoll,
  reiter,
  stimmeBereitstellen,
  stueckAnlegen,
} from './hilfen'

test.describe('ein Stück von vorne bis hinten', () => {
  test('anlegen, erkennen, hören, proben, sichern', async ({ page }, testInfo) => {
    const fehler = achteAufFehler(page)
    const woher = await stimmeBereitstellen(page)
    testInfo.annotations.push({ type: 'Stimme', description: woher })

    const { wahrheit, projektId } = await stueckAnlegen(page, 'fett', 6)

    await test.step('das Stück ist da', async () => {
      await expect(page.getByText(wahrheit.titel).first()).toBeVisible()
      expect(projektId.length).toBeGreaterThan(3)
    })

    await test.step('ein Block von Hand', async () => {
      /*
       * Das Rechteck wird nicht nach Gefühl gezogen: Der Bauplan weiß, auf
       * welcher Seite und an welcher Stelle die erste Replik steht, und zwar
       * in Anteilen der Seite – genau der Koordinaten, in denen der Editor
       * rechnet.
       */
      const { seite, rahmen } = wahrheit.ersteReplik
      for (let i = 1; i < seite; i++) {
        await page.getByRole('button', { name: 'Nächste Seite' }).click()
        await page.waitForTimeout(400)
      }
      await page.waitForTimeout(2500)

      /*
       * Erst den Markier-Knopf, dann messen.
       *
       * Auf dem Telefon schiebt der Finger sonst die Seite statt ein Rechteck
       * zu ziehen – und der Knopf schiebt beim Erscheinen die Leinwand um
       * seine eigene Höhe nach unten. Wer vorher misst, zieht zwei Zeilen
       * daneben; genau das ist beim Schreiben dieser Prüfung passiert.
       */
      const markieren = page.getByRole('button', { name: /Markieren/ })
      if (await markieren.count()) await markieren.click()
      await page.waitForTimeout(600)

      const box = await page.locator('canvas').first().boundingBox()
      expect(box).not.toBeNull()
      if (!box) return

      await page.mouse.move(box.x + rahmen.x * box.width, box.y + rahmen.y * box.height)
      await page.mouse.down()
      await page.mouse.move(
        box.x + (rahmen.x + rahmen.w) * box.width,
        box.y + (rahmen.y + rahmen.h) * box.height,
        { steps: 12 },
      )
      await page.mouse.up()
      await page.waitForTimeout(800)

      const dialog = page.getByRole('dialog').filter({ hasText: /Block/ }).first()
      await expect(dialog).toBeVisible({ timeout: 10000 })

      // Sprecher und Text stehen in Feldern – innerText sieht sie nicht.
      const sprecher = await dialog.getByRole('combobox', { name: 'Sprecher' }).inputValue()
      const text = await dialog.getByRole('textbox', { name: 'Text' }).inputValue()
      expect(sprecher).toBe(wahrheit.ersteReplik.rolle)
      expect(text.replace(/\s+/g, ' ')).toContain(wahrheit.ersteReplik.text.slice(0, 24))
      // Im Dialog, nicht in der Kopfzeile: dort heißt ein anderer Knopf auch
      // „Speichern“ und ist meistens gesperrt.
      await dialog.getByRole('button', { name: /Hinzufügen|Übernehmen|Speichern/ }).click()
      await page.waitForTimeout(600)
    })

    await test.step('automatisch erkennen', async () => {
      await page.getByRole('button', { name: 'Automatisch erkennen' }).first().click()
      await page.waitForTimeout(4000)

      await page.getByText(/Alle \d+ Seiten/).click()
      await page.getByText('als eigene Blöcke').click()
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: 'Durchsuchen' }).click()

      const uebernehmen = page.getByRole('button', { name: /Blöcke übernehmen/ })
      await expect(uebernehmen).toBeVisible({ timeout: 60000 })

      /*
       * Der Abgleich mit dem Personenverzeichnis ist die schärfste Prüfung,
       * die es hier gibt: Das Verzeichnis wurde beim Bauen aus denselben
       * Zahlen geschrieben, die der Erkenner jetzt selbst zählen muss.
       */
      const tabelle = await page.getByText(/Abgleich mit der Rollenliste/).isVisible()
      expect(tabelle).toBe(true)
      const zeilen = await page.locator('table tr').allInnerTexts()
      for (const [rolle, wie] of Object.entries(wahrheit.einsaetze)) {
        const zeile = zeilen.find((z) => z.includes(rolle))
        expect(zeile, `${rolle} fehlt im Abgleich`).toBeTruthy()
        expect(zeile, `${rolle}: ${zeile}`).toContain(`erkannt ${wie}`)
      }

      const angebot = await uebernehmen.innerText()
      await uebernehmen.click()
      await page.waitForTimeout(3000)
      testInfo.annotations.push({ type: 'Erkennung', description: angebot })
    })

    await test.step('die Blockliste stimmt', async () => {
      const bloecke = await page.evaluate(async (id) => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(id)
        const datei = await (await dir.getFileHandle('blocks.json')).getFile()
        return JSON.parse(await datei.text()) as {
          type: string
          speaker: string | null
          rect: { x: number; y: number; w: number; h: number }
        }[]
      }, projektId)

      const repliken = bloecke.filter((b) => b.type === 'line').length
      const regie = bloecke.filter((b) => b.type === 'direction').length

      /*
       * „als eigene Blöcke“ war gewählt: Aus jeder Replik mit einem
       * eingeklammerten Einschub werden drei Blöcke – Text, Einschub, Text.
       * Der von Hand gezogene Block ist einer der erkannten; er wird beim
       * Erkennen übersprungen, nicht verdoppelt.
       */
      expect(repliken).toBe(wahrheit.repliken + wahrheit.einschuebe)
      expect(regie).toBe(wahrheit.regie + wahrheit.einschuebe)

      /*
       * Und jeder Block hat seinen eigenen Rahmen.
       *
       * Bis diese Prüfung es zeigte, bekamen alle Blöcke eines Absatzes den
       * Rahmen des ganzen Absatzes – bei einem Stück ohne Leerzeile zwischen
       * den Repliken also alle Blöcke einer Seite denselben, seitenhohen.
       * Im Editor war dann kein einzelner Block mehr anzuklicken, und ein von
       * Hand markierter Block ließ „Automatisch erkennen“ die ganze Seite als
       * belegt überspringen.
       *
       * Dass sich ein paar Rahmen teilen, ist richtig so: Ein eingeklammerter
       * Einschub mitten im Sprechtext wird zu einem eigenen Block, hat aber
       * keine eigene Stelle im PDF – er steckt in derselben Textzeile.
       */
      const zuHoch = bloecke.filter((b) => b.rect.h > 0.25)
      expect(zuHoch.map((b) => b.rect.h), 'kein Rahmen deckt die halbe Seite').toEqual([])

      const rahmen = new Set(bloecke.map((b) => JSON.stringify(b.rect)))
      // Die geteilten sind genau die aufgeteilten Repliken: drei Blöcke, eine Zeile.
      expect(rahmen.size).toBe(bloecke.length - 2 * wahrheit.einschuebe)

      const rollen = new Set(bloecke.filter((b) => b.speaker).map((b) => b.speaker))
      expect([...rollen].sort()).toEqual(Object.keys(wahrheit.einsaetze).sort())
    })

    await test.step('Sprecher: eigene Rolle und Regler', async () => {
      await reiter(page, 'Sprecher')
      // Jede Rolle hat die eine Stimme schon, ohne Auswahlliste.
      await expect(page.getByText('Stimme: Thorsten').first()).toBeVisible()
      expect(await page.locator('input[placeholder="Stimme wählen"]').count()).toBe(0)

      const meine = page.getByRole('radio', { name: /ist meine Rolle/ }).first()
      await meine.check()
      await page.waitForTimeout(400)
      expect(await meine.isChecked()).toBe(true)
      // Das Abzeichen an der Rolle; im Kopf steht es nur am Rechner.
      await expect(page.getByText('meine Rolle', { exact: true }).first()).toBeVisible()
    })

    await test.step('Hörfassung erzeugen', async () => {
      await reiter(page, 'Hörfassung')

      // Nur ein Stück davon – die Prüfung soll den Weg zeigen, nicht warten.
      await page.getByText('Seitenbereich', { exact: true }).click()
      await page.waitForTimeout(500)
      const zahlen = page.locator('input[inputmode=decimal]')
      await zahlen.nth(0).fill('3')
      await zahlen.nth(1).fill('3')
      await page.waitForTimeout(800)

      const fertig = await hoerfassungErzeugen(page)
      expect(fertig).toContain('neu erzeugt')
      await expect(page.locator('audio')).toBeVisible()

      const spur = await page.evaluate(async (id) => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(id)
        const datei = await (await dir.getFileHandle('track.wav')).getFile()
        const kopf = new DataView(await datei.slice(0, 44).arrayBuffer())
        const text = (o: number, n: number) =>
          String.fromCharCode(...new Uint8Array(kopf.buffer, o, n))
        return {
          bytes: datei.size,
          riff: text(0, 4) + text(8, 4),
          rate: kopf.getUint32(24, true),
          sekunden: kopf.getUint32(40, true) / 2 / kopf.getUint32(24, true),
        }
      }, projektId)

      expect(spur.riff).toBe('RIFFWAVE')
      expect(spur.rate).toBe(22050)
      // Eine Seite Dialog ist mindestens eine halbe Minute Ton.
      expect(spur.sekunden).toBeGreaterThan(20)
      expect(spur.bytes).toBeGreaterThan(44 + 22050 * 2 * 20)
      testInfo.annotations.push({
        type: 'Hörfassung',
        description: `${Math.round(spur.sekunden)} s, ${Math.round(spur.bytes / 1024)} kB`,
      })
    })

    await test.step('der Zwischenspeicher greift', async () => {
      // Derselbe Ausschnitt noch einmal: jetzt kommt alles aus dem Speicher.
      const meldung = await hoerfassungErzeugen(page, 2 * 60 * 1000)
      expect(meldung).toContain('0 neu erzeugt')
    })

    await test.step('Lernmodus: ein paar Schritte', async () => {
      await reiter(page, 'Lernmodus')
      await page.getByRole('button', { name: /Probe starten|Ab hier starten/ }).click()
      await page.waitForTimeout(3000)

      /*
       * Ein paar Schritte weiter. „Weiter“ gibt es zweimal – als Knopf unter
       * der eigenen Replik und als Symbol in der Fußzeile; beide tun
       * dasselbe. Wichtig ist nur, dass hier nicht „Zurück“ in der Kopfzeile
       * erwischt wird: Das führt aus dem Stück heraus.
       */
      for (let i = 0; i < 5; i++) {
        const weiter = page.getByRole('button', { name: 'Weiter', exact: true })
        if (await weiter.count()) await weiter.first().click({ timeout: 10000 })
        await page.waitForTimeout(1500)
      }
      await page.getByRole('button', { name: 'Beenden', exact: true }).click()
      await page.waitForTimeout(1500)

      // Die Stelle ist gemerkt.
      await expect(page.getByText(/Weitermachen|Zuletzt durchgelaufen/)).toBeVisible()
    })

    await test.step('Karteikarten: eine Karte bewerten', async () => {
      await reiter(page, 'Karteikarten')
      await expect(page.getByText('Der Stapel', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Sitzung starten' }).click()
      await page.waitForTimeout(4000)

      let bewertet = false
      for (let i = 0; i < 10; i++) {
        const note = page.getByRole('button', { name: /Saß|Wackelig|Daneben/ })
        if (await note.count()) {
          await note.first().click()
          bewertet = true
          break
        }
        const weiter = page.getByRole('button', { name: 'Weiter', exact: true })
        if (await weiter.count()) await weiter.first().click({ timeout: 10000 })
        await page.waitForTimeout(1500)
      }
      expect(bewertet, 'eine Karte wurde bewertet').toBe(true)
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Beenden', exact: true }).click()
      await page.waitForTimeout(1500)
    })

    await test.step('Sicherungskopie, löschen, zurückholen', async () => {
      await page.getByRole('button', { name: 'Zurück' }).first().click()
      await page.waitForTimeout(1500)
      await einfuehrungWeg(page)

      const download = page.waitForEvent('download')
      await page.getByRole('button', { name: /Sicherungskopie von .* speichern/ }).click()
      const datei = await download
      const pfad = await datei.path()
      expect(pfad).toBeTruthy()

      // Löschen bestätigt der Browser-Dialog; hier wird er angenommen.
      page.once('dialog', (d) => void d.accept())
      await page.getByRole('button', { name: new RegExp(`${wahrheit.titel} löschen`) }).click()
      await page.waitForTimeout(1500)
      await expect(page.getByText(wahrheit.titel)).toHaveCount(0)

      await page.locator('input[type=file]').first().setInputFiles(pfad!)
      await page.waitForTimeout(4000)
      await expect(page.getByText(wahrheit.titel).first()).toBeVisible({ timeout: 30000 })

      await page.getByRole('button', { name: 'Öffnen', exact: true }).click()
      await page.waitForTimeout(4000)
      await einfuehrungWeg(page)

      const zurueck = await page.evaluate(async (id) => {
        const root = await navigator.storage.getDirectory()
        const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(id)
        const datei = await (await dir.getFileHandle('blocks.json')).getFile()
        return (JSON.parse(await datei.text()) as unknown[]).length
      }, projektId)
      // Alles wieder da – Sprechtext, Regie und die aufgeteilten Einschübe.
      expect(zurueck).toBe(wahrheit.repliken + wahrheit.regie + 2 * wahrheit.einschuebe)
    })

    await test.step('das Protokoll hat mitgeschrieben', async () => {
      const zeilen = await protokoll(page)
      expect(zeilen.some((z) => z.includes('Hörfassung gestartet'))).toBe(true)
      expect(zeilen.some((z) => z.includes('Hörfassung fertig'))).toBe(true)
      expect(zeilen.some((z) => z.includes('Lernmodus gestartet'))).toBe(true)
      testInfo.annotations.push({ type: 'Protokoll', description: `${zeilen.length} Zeilen` })
    })

    expect(await fangnetzZugeschlagen(page)).toBe('')
    expect(fehler, fehler.join(' | ')).toEqual([])
  })

  /*
   * Das andere Satzbild.
   *
   * Die App kennt zwei Arten, ein Textbuch zu lesen: fette Namen mit
   * Doppelpunkt mitten im Absatz – oben geprüft – und Namen in einer eigenen
   * Spalte links, mit eingerücktem Sprechtext. Welche gilt, entscheidet
   * `chooseProfile`, und diese Entscheidung ist eine der wenigen Stellen, an
   * denen ein falscher Griff das ganze Stück unbrauchbar macht.
   */
  test('erkennt auch ein Stück mit Sprecherspalte', async ({ page }, testInfo) => {
    const fehler = achteAufFehler(page)
    const { wahrheit, projektId } = await stueckAnlegen(page, 'spalten', 4)

    await page.getByRole('button', { name: 'Automatisch erkennen' }).first().click()
    await page.waitForTimeout(4000)
    await page.getByText(/Alle \d+ Seiten/).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Durchsuchen' }).click()

    const uebernehmen = page.getByRole('button', { name: /Blöcke übernehmen/ })
    await expect(uebernehmen).toBeVisible({ timeout: 60000 })
    testInfo.annotations.push({ type: 'Spaltensatz', description: await uebernehmen.innerText() })
    await uebernehmen.click()
    await page.waitForTimeout(2500)

    const bloecke = await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory()
      const dir = await (await root.getDirectoryHandle('projects')).getDirectoryHandle(id)
      const datei = await (await dir.getFileHandle('blocks.json')).getFile()
      return JSON.parse(await datei.text()) as { type: string; speaker: string | null; text: string }[]
    }, projektId)

    // Jede Rolle ist erkannt, und jede spricht ungefähr so oft wie im Buch.
    const proRolle: Record<string, number> = {}
    for (const b of bloecke) {
      if (b.type === 'line') proRolle[b.speaker ?? '?'] = (proRolle[b.speaker ?? '?'] ?? 0) + 1
    }
    for (const [rolle, wie] of Object.entries(wahrheit.einsaetze)) {
      expect(proRolle[rolle] ?? 0, rolle).toBeGreaterThanOrEqual(wie - 1)
    }
    expect(proRolle['?'] ?? 0, 'keine Replik ohne Sprecher').toBe(0)

    // Und der Sprechername steht nicht im Sprechtext.
    for (const b of bloecke.filter((x) => x.type === 'line').slice(0, 10)) {
      expect(b.text.startsWith(`${b.speaker}`), b.text.slice(0, 40)).toBe(false)
    }

    expect(await fangnetzZugeschlagen(page)).toBe('')
    expect(fehler, fehler.join(' | ')).toEqual([])
  })
})
