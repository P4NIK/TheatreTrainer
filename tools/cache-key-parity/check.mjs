// Vergleicht die Cache-Schluessel der TypeScript-Portierung mit denen aus Go.
import fs from 'node:fs';
import { cacheKey, normalizeText, formatFloat } from './pipeline.mjs';

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let keyBad = 0, normBad = 0;
const beispiele = [];

for (const r of rows) {
  const req = {
    text: r.req.Text, model: r.req.Model, speakerId: r.req.SpeakerID,
    lengthScale: r.req.LengthScale, volume: r.req.Volume, pitch: r.req.Pitch,
  };
  const mine = await cacheKey(req);
  if (mine !== r.key) {
    keyBad++;
    if (beispiele.length < 5) beispiele.push(`  Go ${r.key} / TS ${mine}  scale=${r.req.LengthScale} text=${JSON.stringify(r.req.Text.slice(0,28))}`);
  }
  const norm = normalizeText(r.req.Text);
  if (norm !== r.norm) {
    normBad++;
    if (beispiele.length < 5) beispiele.push(`  normalizeText: Go ${JSON.stringify(r.norm)} / TS ${JSON.stringify(norm)}`);
  }
}

console.log(`${rows.length} Anfragen: ${rows.length - keyBad} Schluessel gleich, ${keyBad} verschieden`);
console.log(`normalizeText: ${rows.length - normBad} gleich, ${normBad} verschieden`);
if (beispiele.length) console.log(beispiele.join('\n'));

// formatFloat gegen Gos strconv.FormatFloat(f,'f',-1,64)
const floats = [1, 0.9, 1.1, 1.25, 0.85, 2, 0.5, 1/3, 0.1+0.2, 1e-7, 1e21, 123456789.123456];
console.log('\nformatFloat:', floats.map((f) => `${f} -> ${formatFloat(f)}`).join(', '));

process.exitCode = keyBad + normBad ? 1 : 0;
console.log(keyBad + normBad === 0 ? '\nBESTANDEN - Schluessel identisch, der vorhandene Zwischenspeicher bleibt gueltig.' : '\nDURCHGEFALLEN');
