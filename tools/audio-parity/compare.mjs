// Vergleicht Go-Referenz und TypeScript-Portierung Sample fuer Sample.
import fs from 'node:fs';
import path from 'node:path';

const [goDir, tsDir] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(path.join(goDir, 'cases.json'), 'utf8'));

const read = (dir, name) => {
  const raw = fs.readFileSync(path.join(dir, name + '.pcm'));
  const out = new Int16Array(raw.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = raw.readInt16LE(i * 2);
  return out;
};

let identisch = 0, laengeAnders = 0;
const abweichend = [];
for (const c of cases) {
  const a = read(goDir, c.name), b = read(tsDir, c.name);
  if (a.length !== b.length) { laengeAnders++; abweichend.push({ name: c.name, note: `Laenge ${a.length} vs ${b.length}` }); continue; }
  let diffs = 0, max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d) { diffs++; if (d > max) max = d; }
  }
  if (!diffs) { identisch++; continue; }
  abweichend.push({ name: c.name, n: a.length, diffs, max, promille: (diffs / a.length * 1000) });
}

// Bit-genau ist nicht erreichbar: Go und V8 liefern fuer math.Sin auf rund
// einem Fuenftel der Argumente verschiedene Werte (bis 10 ULP), fuer cos auf
// einem Viertel (1 ULP). Keine der beiden Sprachen garantiert korrekt
// gerundete Winkelfunktionen. Uebrig bleibt gelegentlich ein Sample, das auf
// der Rundungsgrenze kippt - 1 LSB, also 90 dB unter Vollausschlag.
const TOLERANZ = 1;
const ueberToleranz = abweichend.filter((d) => d.note || d.max > TOLERANZ);

console.log(`${cases.length} Faelle: ${identisch} sample-genau identisch, ${abweichend.length} mit Abweichung, ${laengeAnders} mit anderer Laenge\n`);
if (abweichend.length) {
  console.log('Fall'.padEnd(30), 'Samples'.padStart(9), 'abweichend'.padStart(11), 'max'.padStart(5), 'Promille'.padStart(9));
  for (const d of abweichend.sort((x, y) => (y.max ?? 0) - (x.max ?? 0)).slice(0, 25)) {
    if (d.note) console.log(d.name.padEnd(30), d.note);
    else console.log(d.name.padEnd(30), String(d.n).padStart(9), String(d.diffs).padStart(11), String(d.max).padStart(5), d.promille.toFixed(3).padStart(9));
  }
}

console.log();
if (ueberToleranz.length === 0) {
  console.log(`BESTANDEN - alle Laengen gleich, keine Abweichung groesser als ${TOLERANZ} LSB.`);
} else {
  console.log(`DURCHGEFALLEN - ${ueberToleranz.length} Fall/Faelle ueber der Toleranz von ${TOLERANZ} LSB:`);
  for (const d of ueberToleranz) console.log('  ' + d.name + (d.note ? ' - ' + d.note : ` - max ${d.max} LSB`));
  process.exitCode = 1;
}
