# Piper-WASM-Spike

Ein Wegwerf-Prototyp mit einer Frage: **Läuft Piper unverändert im Browser,
ohne Backend?** Kein Framework, kein Build-Schritt, nichts, was in die App
zurückwandern muss.

Beantwortet werden sollten drei Dinge:

1. Läuft `de_DE-thorsten-medium.onnx` aus `voices/` unverändert im Browser?
2. Lassen sich Sprecher-ID und Tempo dabei steuern – also das, was das Backend
   heute über `-s` und `--length-scale` an die Kommandozeile gibt?
3. Wie schnell ist das, verglichen mit den 1–3 s je Block des Go-Backends?

## Starten

```bash
python spike-wasm/serve.py
# http://localhost:8081/spike-wasm/
```

`serve.py` liefert den Repo-Stamm aus, damit `/voices/…` direkt erreichbar ist,
und setzt COOP/COEP – ohne diese beiden Header gibt es keinen
`SharedArrayBuffer` und damit keine WASM-Threads. Für Piper ist das nach der
Messung unten allerdings **egal**; die Header stehen nur noch da, damit der
Vergleich reproduzierbar bleibt:

```bash
python spike-wasm/serve.py --no-coi     # erzwingt den Einthread-Fall
```

Auf der Seite: Stimme wählen → **Laden** → **Sprechen** oder **Benchmark**.

## Ergebnis

### 1. Ja, und zwar exakt

Die Ausgabe des Browsers ist mit der von `python -m piper` *sample-genau
identisch* – nicht nur ähnlich. Gegengeprüft mit ausgeschaltetem Rauschen
(`--noise-scale 0 --noise-w-scale 0`), damit VITS deterministisch wird:

| | Samples | Dauer | Peak | Korrelation | max. Abweichung |
|---|---|---|---|---|---|
| Ein Satz, thorsten | 36 608 = 36 608 | 1,660 s | 11 536 | 1,0000 | 1 |
| Drei Sätze, thorsten, normalisiert | 143 988 = 143 988 | 6,530 s | 32 767 | 1,0000 | 2 |
| Ein Satz, mls, `sid 7` | 59 648 = 59 648 | 2,705 s | 4 709 | 1,0000 | 1 |

Die Abweichung von 1–2 (bei Vollausschlag 32 768) ist Rundung beim
Float→Int16-Schritt, mehr nicht.

### 2. Sprecher-ID und Tempo funktionieren

`-s` und `--length-scale` sind keine Eigenheiten der Kommandozeile, sondern
Tensoren des Modells: `sid` und der mittlere Wert von `scales`.
`de_DE-mls-medium` meldet im Browser die Eingänge
`input, input_lengths, scales, sid`, und `sid 0 / 7 / 200` liefern hörbar
verschiedene Sprecher. `length_scale` 1,5 macht denselben Satz von 1,77 s auf
2,47 s lang (nicht exakt Faktor 1,5, weil die Stille an den Rändern nicht
mitskaliert – bei der Kommandozeile ist es genauso).

### 3. Schneller als das Backend, das ersetzt werden soll

Gemessen auf einem Arbeitsrechner mit 12 Threads, Chrome, `wasm`-Backend:

```
Realtime-Faktor    28–30×
je Block           0,15 s
hochgerechnet      1400 Blöcke ≈ 3,5 min
Modell laden       ~80–440 ms
Session bereit     ~0,7–1,0 s
Phonemisierung     5 ms je Block
```

Zum Vergleich das Go-Backend: 1–3 s je Block, also **23–70 min** für dasselbe
Stück. Der Browser ist Faktor 7–20 schneller.

Das ist kein Wunder, sondern Buchhaltung: `synth/piper.go` startet für *jeden
Block* einen eigenen Prozess (`exec.CommandContext`), und jeder dieser Prozesse
zahlt Python-Start, Import und das Laden der 60 MB noch einmal. Im Browser wird
das Modell einmal geladen, danach kostet ein Block nur noch Inferenz.

Zweite Messreihe im Container mit nur 2 vCPUs, als untere Schranke: 5,4×
Echtzeit, 0,78 s je Block, 1400 Blöcke ≈ 18 min. Also selbst auf schwacher
Hardware noch schneller als heute.

**Threads bringen nichts. Gar nichts.** Gemessen auf demselben Rechner:

| Threads | Realtime-Faktor | je Block |
|---|---|---|
| 1 | 28,2× | 0,15 s |
| 4 | 28,2× | 0,15 s |
| 12 | 28,4–29,8× | 0,15 s |

Der Graph ist so klein, dass Intra-Op-Parallelität nichts mehr hergibt. Damit
ist die wichtigste Bereitstellungs-Frage beantwortet: **Piper im Browser
braucht kein COOP/COEP.** Kein `SharedArrayBuffer`, keine
Cross-Origin-Isolation, kein `coi-serviceworker`-Trick – die App liefe von
jedem beliebigen statischen Hoster, GitHub Pages eingeschlossen.

### WebGPU: geht nicht, wird aber auch nicht gebraucht

```
[WebGPU] Kernel "[GatherND] /dp/flows.7/GatherND" failed.
Error: Unsupported data type: 7
```

Datentyp 7 ist `int64`. WGSL kennt keine 64-Bit-Integer; onnxruntime unterstützt
sie in WebGPU-Kerneln nur, wenn das Gerät die passende Erweiterung meldet, und
`GatherND` fehlt im
[Operator-Tracking der WebGPU-Portierung](https://github.com/microsoft/onnxruntime/issues/15952)
ganz. Pipers Duration-Predictor benutzt beides.

Die Sache ist damit entschieden: **TTS läuft auf der CPU**, und mit 28× Echtzeit
ist das kein Verzicht. Der Spike lädt seither nur noch das reine WASM-Bundle
(`ort.wasm.min.js`, 48 KB) statt des Standard-Bundles mit jsep – das spart 22 MB
in `vendor/` (50 → 29 MB) und ist sogar minimal schneller, weil die
jsep-Schicht wegfällt. Wer WebGPU trotzdem selbst nachmessen will: in
`fetch-vendor.sh` `ort.min.js` samt der beiden `*.jsep.*`-Dateien wieder
aufnehmen und in `index.html` einbinden. Nebeneffekt: Safari und Firefox, die kein oder
nur experimentelles WebGPU haben, sind für die Sprachausgabe damit kein Thema
mehr. (Für Whisper sehr wohl.)

## Was dabei aufgefallen ist

- **Der erste Block einer frischen Session ist langsamer**, weil onnxruntime
  seine Speicherarena anlegt: im 2-Kern-Container 0,8× statt 5,4× Echtzeit, auf
  dem Arbeitsrechner 23,5× statt 29×. Mit einem kurzen Satz aufzuwärmen reicht
  nicht; der Effekt zieht sich sonst über die ersten drei, vier Blöcke. Für die
  App heißt das: nach dem Laden einmal im Hintergrund einen längeren Block
  synthetisieren.
- **`ort.env.wasm.wasmPaths` braucht eine absolute URL.** onnxruntime importiert
  die `.mjs` dynamisch, und `'vendor/'` ist kein gültiger Modul-Specifier – der
  Fehler lautet dann `no available backend found`, was in eine ganz falsche
  Richtung zeigt.
- **Jede Stimme bringt eigene Standardwerte mit.** `de_DE-mls-medium` steht auf
  `noise_scale 0.333, noise_w 0.333`, thorsten auf `0.667 / 0.8`. Wer die aus
  `inference` ignoriert und feste Werte nimmt, bekommt bei mls Sätze, die
  doppelt so lang sind und ins Lallen kippen.
- **Piper normalisiert jeden Satz einzeln** auf Vollausschlag, solange
  `--no-normalize` fehlt – das Backend ruft es ohne dieses Flag auf. Wer die
  gleiche Lautheit will, muss das im Browser nachbauen (Häkchen auf der Seite).
- **Die Satzaufteilung muss stimmen.** Das WASM-Kommando gibt für einen
  mehrsätzigen Text *eine* Zeile zurück, synthetisiert also alles am Stück;
  Piper teilt in Sätze, synthetisiert einzeln und legt 0,2 s Stille dazwischen.
  Erst mit `Intl.Segmenter('de')` plus dieser Stille kam die sample-genaue
  Übereinstimmung zustande.
- Die verbreitete Bibliothek `@diffusionstudio/vits-web` (und der Fork
  `@mintplex-labs/piper-tts-web`) taugt als Vorlage, aber nicht zum
  Übernehmen: sie verdrahtet `sid = 0` fest, nimmt `length_scale` nur aus der
  Konfiguration, löst ihr Ergebnis-Promise bei der ersten ausgegebenen Zeile
  auf (verliert also alles nach dem ersten Satz) und lädt Modelle ausschließlich
  von HuggingFace. Der direkte Weg über `onnxruntime-web` +
  `piper_phonemize.wasm` ist hier kürzer als der Umweg über einen Fork.

## Was der Spike *nicht* beantwortet

- Wie sich das auf **Safari** verhält (engere OPFS-Grenzen, Räumung nach
  7 Tagen ohne `navigator.storage.persist()`).
- Ob die Inferenz in einem **Worker** laufen sollte. Hier läuft sie im
  Haupt-Thread und blockiert die Oberfläche; für die App wäre
  `ort.env.wasm.proxy = true` oder ein eigener Worker Pflicht.
- Alles rund um **Speicherung** (OPFS statt `data/`) und **MP3**.

## Dateien

```
index.html      Oberfläche
app.js          die eigentliche Logik: Phonemisierung, IDs, ONNX, WAV
serve.py        statischer Server mit COOP/COEP + /spike-api/voices
fetch-vendor.sh lädt vendor/ neu (npm pack, keine CDN nötig)
vendor/         ~29 MB, nicht im Repo:
                  ort.wasm.min.js                        48 KB   onnxruntime-web 1.22.0
                  ort-wasm-simd-threaded.{mjs,wasm}    11,2 MB
                  piper_phonemize.{js,wasm,data}       18,8 MB   @diffusionstudio/piper-wasm 1.0.0
```

In `vendor/_unused/` liegen die abgewaehlten jsep-Dateien (22 MB) – kann weg,
oder einfach `vendor/` loeschen und `fetch-vendor.sh` laufen lassen.

`piper_phonemize.data` sind 18 MB espeak-ng-Daten für *alle* Sprachen. Für eine
deutsche App ließe sich das mit einem eigenen Emscripten-Build (`--preload-file`
nur mit `de`) erheblich kürzen.

**Lizenz-Notiz:** espeak-ng steht unter GPL-3. Heute ruft das Backend Piper als
eigenen Prozess auf – sauber getrennt. Ein WASM-Bündel mit einkompiliertem
espeak-ng ist ein anderes Kaliber und will bewusst entschieden sein, solange das
Repo MIT ist.
