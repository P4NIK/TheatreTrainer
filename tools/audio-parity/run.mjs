// Faehrt die TypeScript-Portierung ueber dieselben Faelle wie das Go-Programm
// und schreibt die Ergebnisse als rohes int16-LE in ein zweites Verzeichnis.
import fs from 'node:fs';
import path from 'node:path';
import * as A from './audio.mjs';

const goDir = process.argv[2];
const outDir = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });

const RATE = 22050;
const read = (name) => {
  const raw = fs.readFileSync(path.join(goDir, name + '.pcm'));
  const out = new Int16Array(raw.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = raw.readInt16LE(i * 2);
  return out;
};
const write = (name, samples) => {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2);
  fs.writeFileSync(path.join(outDir, name + '.pcm'), buf);
};

const inputs = {};
for (const f of fs.readdirSync(goDir)) {
  if (f.startsWith('in_')) inputs[f.slice(3, -4)] = read(f.slice(0, -4));
}

const cases = JSON.parse(fs.readFileSync(path.join(goDir, 'cases.json'), 'utf8'));
for (const c of cases) {
  const x = c.in ? inputs[c.in] : null;
  let out;
  switch (c.fn) {
    case 'resample':    out = A.resample(x, c.args[0], c.args[1]); break;
    case 'removeDCOffset': out = A.removeDCOffset(x); break;
    case 'fadeEdges':   out = A.fadeEdges(x, c.args[0], c.args[1]); break;
    case 'applyVolume': out = A.applyVolume(x, c.args[0]); break;
    case 'silence':     out = A.silence(c.args[0], c.args[1]); break;
    case 'timeStretch': out = A.timeStretch(x, c.args[0], c.args[1]); break;
    case 'pitchShift':  out = A.pitchShift(x, c.args[0], c.args[1]); break;
    case 'postProcess': {
      let s = A.applyVolume(x, c.args[0]);
      s = A.pitchShift(s, RATE, c.args[1]);
      out = A.fadeEdges(A.removeDCOffset(s), RATE, 8);
      break;
    }
    default: throw new Error('unbekannte Funktion ' + c.fn);
  }
  write(c.name, out);
}
console.log(cases.length + ' Faelle gerechnet');
