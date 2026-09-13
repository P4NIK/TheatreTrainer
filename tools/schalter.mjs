/**
 * Jeden Schalter einmal umlegen – in der Entwicklungsfassung.
 *
 *   cd frontend && npm run dev -- --port 5199
 *   node tools/schalter.mjs                     # braucht playwright
 *
 * Mit APP=… lässt sich eine andere Adresse prüfen (etwa die gebaute Fassung),
 * mit STUECK=… eine andere Sicherungskopie laden.
 *
 * Dort läuft React im StrictMode und ruft jede Zustandsfunktion zweimal auf,
 * die zweite beim Neuzeichnen. Wer dabei noch am Ereignis hängt
 * (`e.currentTarget`), bekommt null – und die Seite wird weiß. Genau das ist
 * in der gebauten Fassung nicht passiert, weshalb es keine Prüfung gefunden
 * hat. Also wird hier gegen den Dev-Server geprüft.
 */
import { chromium, devices } from 'playwright';

const APP = process.env.APP ?? 'http://127.0.0.1:5199/';
const EXPORT = process.env.STUECK ?? './stueck.theater.json';

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] } : {},
);
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
p.setDefaultTimeout(10000);

const fehler = [];
p.on('pageerror', (e) => fehler.push(e.message.split('\n')[0].slice(0, 120)));

const wegklicken = async () => {
  for (let i = 0; i < 12; i++) {
    if (!(await p.locator('[role=dialog]').count())) return;
    await p
      .locator('[role=dialog]')
      .last()
      .getByRole('button', { name: /überspringen|schließen|Fertig/ })
      .click()
      .catch(() => undefined);
    await p.waitForTimeout(250);
  }
};

/** Ist überhaupt noch etwas zu sehen? Eine weiße Seite hat fast keinen Text. */
const lebt = async () => {
  const text = await p.locator('body').innerText().catch(() => '');
  return text.trim().length > 50;
};

/** Hat das Fangnetz zugeschlagen? Dann ist zwar nichts weiß, aber kaputt. */
const gefangen = () => p.getByText(/ist abgestürzt/).count();

await p.goto(APP, { waitUntil: 'load' });
await p.waitForTimeout(2500);
await wegklicken();
await p.locator('input[type=file]').first().setInputFiles(EXPORT);
await p.waitForTimeout(6000);
await p.getByRole('button', { name: 'Öffnen', exact: true }).click();
await p.waitForTimeout(10000);
await wegklicken();

let umgelegt = 0;
for (const reiter of ['Hörfassung', 'Lernmodus', 'Karteikarten', 'Sprecher', 'Editor']) {
  await p.getByRole('tab', { name: reiter }).click();
  await p.waitForTimeout(2000);
  await wegklicken();

  const schalter = p.locator('input[role=switch]');
  const wie = await schalter.count();
  console.log(`\n=== ${reiter}: ${wie} Schalter ===`);

  for (let i = 0; i < wie; i++) {
    const s = schalter.nth(i);
    const name = (await s.getAttribute('aria-label')) ?? (await p.evaluate((el) => {
      const id = el.getAttribute('id');
      const label = id ? document.querySelector(`label[for="${id}"]`) : null;
      return (label?.textContent ?? '(ohne Namen)').slice(0, 44);
    }, await s.elementHandle()));
    if (await s.isDisabled()) {
      console.log(`  – ${name}: gesperrt`);
      continue;
    }
    const vorher = await s.isChecked();
    await s.click({ force: true });
    await p.waitForTimeout(350);
    umgelegt++;
    const nachher = await s.isChecked().catch(() => null);
    const heil = await lebt();
    const kaputt = await gefangen();
    console.log(
      `  ${heil && !kaputt && nachher === !vorher ? 'ok  ' : 'NEIN'} ${name}: ${vorher} → ${nachher}` +
        `${heil ? '' : '  *** SEITE WEISS ***'}${kaputt ? '  *** FANGNETZ HAT ZUGESCHLAGEN ***' : ''}`,
    );
    if (!heil || kaputt) {
      const meldung = await p.getByText(/ist abgestürzt/).first().innerText().catch(() => '');
      const code = await p.locator('code').first().innerText().catch(() => '');
      if (meldung) console.log(`     „${meldung}“ – ${code.slice(0, 90)}`);
      const zeilen = await p.evaluate(() => {
        try { return JSON.parse(localStorage.getItem('theater-protokoll') ?? '[]'); } catch { return []; }
      });
      for (const z of zeilen.slice(-2)) console.log(`     Protokoll: ${String(z.text).slice(0, 120)}`);
      fehler.push('Ansicht abgestürzt');
      break;
    }
    // und wieder zurück
    await s.click({ force: true });
    await p.waitForTimeout(350);
    umgelegt++;
  }
  if (!(await lebt())) break;
}

console.log(`\n${umgelegt} Umschaltungen, ${fehler.length} Fehler in der Konsole`);
for (const f of [...new Set(fehler)]) console.log('  ' + f);
await p.screenshot({ path: 'schalter.png' }).catch(() => undefined);
await browser.close();
process.exit(fehler.length === 0 ? 0 : 1);
