# audio-parity

Prüft, ob `frontend/src/lib/audio.ts` dasselbe rechnet wie
`backend/internal/synth/audio.go`.

Solange beide Fassungen nebeneinander leben – das Backend bleibt vorerst der
Speicher, die Tonarbeit wandert in den Browser –, ist das der Sicherheitsnetz
für die Portierung. Es fährt beide über denselben Satz Eingaben und vergleicht
Sample für Sample.

## Laufen lassen

```bash
cd tools/audio-parity
python3 extract.py ../../backend/internal/synth/audio.go dsp.go
go run . /tmp/parity/go ../../spike-whisper/samples/03_abend.wav
npx esbuild ../../frontend/src/lib/audio.ts --format=esm --target=es2022 --outfile=audio.mjs
node run.mjs /tmp/parity/go /tmp/parity/ts
node compare.mjs /tmp/parity/go /tmp/parity/ts
```

Der Vergleich endet mit `BESTANDEN` oder `DURCHGEFALLEN` und einem
Rückgabewert, taugt also auch für eine Pipeline.

`extract.py` schneidet `readWAVMono`, `writeWAV` und `encodeWAV` aus `audio.go`
heraus – nur die drei hängen an `github.com/go-audio`, der Rest kommt mit der
Standardbibliothek aus. Der Schnitt passiert mechanisch, damit die Kopie nicht
von Hand nachgezogen werden muss und nicht auseinanderlaufen kann.

## Was dabei herauskommt

91 Fälle über acht Eingangssignale: reine Töne, eine echte Piper-Aufnahme, ein
Signal mit Gleichspannungsanteil, ein Ton mit Stille am Ende, dazu die
Randfälle leer, sehr kurz und Vollausschlag. Geprüft werden `resample`,
`removeDCOffset`, `fadeEdges`, `applyVolume`, `silence`, `timeStretch`,
`pitchShift` und die vollständige Kette aus `postProcess`.

Stand der Portierung:

```
91 Faelle: 75 sample-genau identisch, 16 mit Abweichung, 0 mit anderer Laenge
BESTANDEN - alle Laengen gleich, keine Abweichung groesser als 1 LSB.
```

Die 16 Abweichungen betreffen 1 bis 7 Samples von jeweils Zehntausenden –
schlimmstenfalls 0,085 ‰ – und immer genau ein Bit.

## Warum es nicht bit-genau ist

Nicht wegen der Portierung. **Go und JavaScript rechnen Winkelfunktionen
verschieden.** Nachgemessen mit denselben Argumenten, die `lanczos()` und das
Hann-Fenster tatsächlich sehen:

| | Werte | verschieden | größter Abstand |
|---|---|---|---|
| `sin` | 40 000 | 8 915 (22,3 %) | 10 ULP |
| `cos` | 882 | 241 (27,3 %) | 1 ULP |

Weder Go noch ECMAScript verlangen korrekt gerundete Winkelfunktionen, beide
dürfen sich um einige ULP irren – und tun es. Gelegentlich landet ein Wert
dadurch auf der anderen Seite einer Rundungsgrenze in `clampInt16`, und heraus
kommt ein Sample, das um eins danebenliegt.

Alle Funktionen **ohne** Winkelfunktionen – `applyVolume`, `removeDCOffset`,
`fadeEdges`, `silence` – stimmen ausnahmslos exakt überein. Betroffen sind
ausschließlich `resample` (Sinus im Lanczos-Kern) und `timeStretch`
(Kosinus im Hann-Fenster) sowie alles, was darauf aufbaut.

1 LSB bei 16 Bit sind 90 dB unter Vollausschlag. Bit-Genauigkeit wäre nur zu
haben, indem man Gos `math.Sin` in JavaScript nachbaut – ein selbstgeschriebener
Sinus als Preis für einen unhörbaren Unterschied. Bewusst nicht getan.

## Fallen, die beim Portieren aufgefallen sind

- **`math.Round` rundet halbe Werte vom Nullpunkt weg, `Math.round` nach
  oben.** `-0,5` wird in Go zu `-1`, in JavaScript zu `-0`. Das betrifft
  `clampInt16`, also jeden einzelnen Sample-Wert. In `audio.ts` steht dafür
  `goRound()`, und `audio.test.ts` hält es fest.
- **Ganzzahldivision.** `sampleRate * ms / 1000` schneidet in Go ab;
  `silence(450, 22050)` sind 9 922 Samples, nicht 9 922,5 gerundet auf 9 923.
- **`int(float64)` schneidet ab, es rundet nicht** – etwa bei `outLen` in
  `resample` und `timeStretch`.
- Die Go-Fassung arbeitet auf ihrer Eingabe, die TypeScript-Fassung nicht.
  Im Browser gehören dieselben Samples oft noch dem Zwischenspeicher oder einer
  Worker-Nachricht; eine unsichtbare Änderung dort fällt erst drei Blöcke
  später als Knacken auf. Ein Test hält das fest.
