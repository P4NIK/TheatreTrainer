/**
 * Manual smoke test for the browser UI. Not part of the build – run it with a
 * started backend (`node e2e-smoke.mjs`) when you want to verify the editor
 * end to end without clicking through it by hand.
 *
 *   node e2e-smoke.mjs [baseUrl] [pdfPath]
 */
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:8080'
const pdfPath = process.argv[3] ?? '/tmp/stueck.pdf'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const step = (s) => console.log('▶ ' + s)

step('Projektliste öffnen')
await page.goto(base, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /Erstes Projekt anlegen|Neues Projekt/ }).first().click()

step('Projekt anlegen')
await page.getByRole('textbox', { name: 'Name des Stücks' }).fill('Portwein-Probe')
await page.setInputFiles('input[type=file]', pdfPath)
await page.getByRole('button', { name: 'Anlegen', exact: true }).click()

step('PDF rendern')
await page.waitForSelector('.pdf-stage canvas', { timeout: 20000 })
await page.waitForTimeout(1200)

const stage = await page.locator('.pdf-stage').boundingBox()
console.log('   Canvas:', Math.round(stage.width), '×', Math.round(stage.height))

async function drawRect(x0, y0, x1, y1) {
  await page.mouse.move(stage.x + stage.width * x0, stage.y + stage.height * y0)
  await page.mouse.down()
  await page.mouse.move(stage.x + stage.width * x1, stage.y + stage.height * y1, { steps: 8 })
  await page.mouse.up()
}

step('Rechteck über die erste Replik ziehen')
await drawRect(0.08, 0.112, 0.92, 0.15)
await page.waitForSelector('.mantine-Modal-content', { timeout: 5000 })
const speaker1 = await page.getByRole('combobox', { name: 'Sprecher' }).inputValue()
const text1 = await page.getByRole('textbox', { name: 'Text' }).inputValue()
console.log('   Sprecher:', JSON.stringify(speaker1))
console.log('   Text:    ', JSON.stringify(text1))
await page.getByRole('button', { name: 'Hinzufügen' }).click()

await page.waitForSelector('.mantine-Modal-content', { state: 'detached' })

step('Regieanweisung markieren')
await drawRect(0.08, 0.155, 0.92, 0.19)
await page.waitForSelector('.mantine-Modal-content')
console.log('   Text:    ', JSON.stringify(await page.getByRole('textbox', { name: 'Text' }).inputValue()))
await page.locator('label[for$="-direction"]').click()
await page.getByRole('button', { name: 'Hinzufügen' }).click()
await page.waitForSelector('.mantine-Modal-content', { state: 'detached' })

step('Dritte Replik markieren')
await drawRect(0.08, 0.193, 0.92, 0.228)
await page.waitForSelector('.mantine-Modal-content')
console.log('   Sprecher:', JSON.stringify(await page.getByRole('combobox', { name: 'Sprecher' }).inputValue()))
console.log('   Text:    ', JSON.stringify(await page.getByRole('textbox', { name: 'Text' }).inputValue()))
await page.getByRole('button', { name: 'Hinzufügen' }).click()
await page.waitForSelector('.mantine-Modal-content', { state: 'detached' })

await page.waitForTimeout(1800) // autosave
await page.screenshot({ path: '/tmp/shot-editor.png' })

step('Sprecher-Tab: Stimmen zuweisen')
await page.getByRole('tab', { name: 'Sprecher' }).click()
await page.waitForSelector('table')
const selects = page.locator('table tbody tr td:nth-child(2) input[role=combobox]')
const rowCount = await selects.count()
console.log('   Sprecher-Zeilen:', rowCount)
for (let i = 0; i < rowCount; i++) {
  await selects.nth(i).click()
  await page.locator('[role=option]:visible').first().click()
  await page.waitForTimeout(150)
}
await page.locator('table tbody tr input[type=radio]').first().check()
await page.waitForTimeout(1800)
await page.screenshot({ path: '/tmp/shot-speakers.png' })

step('Hörfassung erzeugen')
await page.getByRole('tab', { name: 'Hörfassung' }).click()
await page.getByRole('button', { name: 'Audio erzeugen' }).click()
await page.waitForSelector('audio', { timeout: 60000 })
const src = await page.locator('audio').getAttribute('src')
console.log('   Audio:', src)
await page.screenshot({ path: '/tmp/shot-audio.png' })

step('Ausschnitt wählen und daraus erzeugen')
await page.getByText('Seitenbereich').click()
await page.getByLabel('Von Seite').fill('1')
await page.getByLabel('Bis Seite').fill('1')
await page.waitForTimeout(300)
console.log('   Seiten 1–1:', await page.getByText(/von \d+ Blöcken/).textContent())
const roleTab = page.getByText(/^Auftritte von /)
if (await roleTab.count()) {
  await roleTab.click()
  await page.waitForTimeout(300)
  console.log('   Auftritte: ', await page.getByText(/von \d+ Blöcken/).textContent())
}
const posted = []
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().includes('/synthesize')) posted.push(r.postData())
})
await page.getByRole('button', { name: 'Audio erzeugen' }).click()
await page.waitForSelector('text=Fertig –', { timeout: 120000 })
const sent = JSON.parse(posted.at(-1) ?? '{}')
console.log('   gesendet:', (sent.selection ?? []).length, 'Einträge')
console.log('   Dateiname:', await page.getByRole('link', { name: /Herunterladen/ }).getAttribute('download'))
await page.getByText('Ganzes Stück').click()

step('Automatisch erkennen – auch von einem anderen Tab aus')
// Regression: der Knopf sitzt in der Kopfzeile und ist auf allen Tabs sichtbar,
// während der PDF-Editor dort ausgehängt ist. Ein von dort geliehenes
// pdf.js-Dokument wäre längst zerstört ("sendWithPromise of null").
await page.getByRole('tab', { name: 'Sprecher' }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Automatisch erkennen' }).click()
await page.waitForSelector('.mantine-Modal-content')
await page.waitForFunction(() => /gelernt|geraten/.test(document.body.innerText), null, { timeout: 30000 })
await page.getByRole('button', { name: 'Durchsuchen' }).click()
await page.waitForFunction(() => /Sprechtext|fehlgeschlagen/i.test(document.body.innerText), null, { timeout: 60000 })
const detectText = await page.locator('.mantine-Modal-content').innerText()
if (detectText.includes('fehlgeschlagen')) {
  errors.push('Automatische Erkennung: ' + detectText.split('\n').find((l) => l.includes('Cannot') || l.includes('fehlgeschlagen')))
} else {
  console.log('   ' + detectText.split('\n').filter((l) => /Sprechtext|Regie$/.test(l)).join(' · '))
}
await page.getByRole('button', { name: 'Abbrechen' }).click()
await page.getByRole('tab', { name: 'Editor' }).click()
await page.waitForTimeout(800)

step('Neu laden – bleiben die Blöcke erhalten?')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.pdf-stage canvas')
await page.waitForTimeout(800)
const badge = await page.getByText(/Blöcke auf dieser Seite/).textContent()
console.log('  ', badge)

console.log(errors.length ? '\n❌ Konsolenfehler:\n' + errors.join('\n') : '\n✅ keine Konsolenfehler')
await browser.close()
