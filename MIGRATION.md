# Vom Backend in den Browser

Piper und Whisper laufen im Browser. Was das Backend bleibt, ist ein
Speicher. Dieses Dokument hält fest, was gemessen wurde, was daraus folgt und
in welcher Reihenfolge gebaut wird.

Es ist das Ergebnis von drei Wegwerf-Prototypen (`spike-wasm/`,
`spike-whisper/`, `spike-storage/`) und zwei Portierungen. Nichts darin ist
geschätzt; wo eine Zahl steht, ist sie gemessen, und wo etwas offen ist, steht
das auch.

## Wo wir stehen

| Frage | Antwort | belegt durch |
|---|---|---|
| Läuft Piper im Browser? | **Ja, sample-genau wie die Kommandozeile** | `spike-wasm/` |
| Wie schnell? | **28–30× Echtzeit, 0,15 s je Block** | 1400 Blöcke ≈ 3,5 min |
| Braucht es Threads / COOP/COEP? | **Nein** – 1 Thread ist so schnell wie 12 | Messreihe 1/4/12 |
| WebGPU für TTS? | **Sackgasse** (`int64` im Duration-Predictor) | ORT-Issue 15952 |
| Welches Whisper-Modell? | **`base`, wasm, hybrid** – 200 MB, 0,95 s je Replik | 77 % gegen 65 % (`tiny`) und 78 % (`small`) |
| Wohin der Block-Cache? | **OPFS** – 3,5 ms je Block gegen ~22 ms über HTTP | `spike-storage/` |
| Passt ein halbes Jahr Proben hinein? | **Ja** – 4 GB ohne Murren geschrieben | Belastungstest |

Zum Vergleich: das heutige Backend braucht **1–3 s je Block**, weil
`synth/piper.go` für jeden einzelnen einen Python-Prozess startet und die 60 MB
neu lädt. Der Browser ist nicht knapp schneller, sondern Faktor 7 bis 20.

### Schon portiert und geprüft

| Datei | ersetzt | Prüfung |
|---|---|---|
| `frontend/src/lib/audio.ts` | `synth/audio.go` (354 Z.) | 91 Fälle, 75 sample-genau, Rest ≤ 1 LSB |
| `frontend/src/lib/pipeline.ts` | `synth/pipeline.go` (516 Z.) | 1296 Cache-Schlüssel identisch |
| `frontend/src/lib/numbers.ts` | *neu* | schließt die Zahlwort-Lücke im Vergleich |

Dazu zwei Prüfstände, die beide Fassungen gegeneinander fahren, solange sie
nebeneinander leben: `tools/audio-parity/` und `tools/cache-key-parity/`.

## Der Schnitt

Er läuft entlang der Frage, **was verloren gehen darf**.

**In den Browser** – alles, was sich nachrechnen lässt:

- Synthese (Piper als WASM) und Erkennung (Whisper als WASM)
- Planung, Nachbearbeitung, Zusammensetzen (`pipeline.ts`, `audio.ts`)
- der Block-Zwischenspeicher (OPFS)
- die Stimm-Modelle (einmal geladen, in OPFS)

**Im Backend** – alles, was unersetzlich ist:

- PDF, Blöcke, Sprecher, Karteikarten, gemerkte Stelle
- die fertigen Hörfassungen
- der MP3-Export (ffmpeg bleibt, wo es ist – der Browser lädt die fertige WAV
  hoch, das Backend konvertiert)

Damit ist die Unsicherheit über das OPFS-Kontingent entschärft: Was der Browser
im schlimmsten Fall wegräumt, kostet 3,5 Minuten Rechenzeit, keine Daten.

## Reihenfolge

Die ersten drei Schritte lassen das Backend unangetastet. Es kann jederzeit
abgebrochen werden, ohne dass etwas kaputt ist.

**1. Piper-Engine herausschälen.** `spike-wasm/app.js` enthält den fertigen
Weg – Phonemisierung, ID-Bildung, ONNX, Skalen – aber in einer Wegwerf-Seite.
Er wird zu `frontend/src/lib/piper.ts` plus einem Worker. Der Prüfstein ist
hart und schon da: die Ausgabe muss weiter sample-genau der Kommandozeile
entsprechen.

**2. OPFS-Cache hinter `cacheKey()`.** `get`/`put`/`keepOnly`, wie `cache.go`.
Der Schlüssel ist bereits gegengeprüft, die Semantik von `referencedKeys()`
steht in `pipeline.ts`. Klein und für sich testbar.

**3. Beides verdrahten.** Worker + `renderPlan()` + Cache ergeben den
Hörfassungs-Lauf im Browser. Ab hier ist `synth/` im Backend arbeitslos –
zunächst nur unbenutzt, nicht gelöscht.

**4. Stimmen ausliefern.** Das Backend listet heute `voices/`, gibt die
`.onnx` aber nicht heraus. Ein Endpunkt mehr, dann holt der Browser das Modell
einmal und legt es in OPFS.

**5. Hörfassung zurückgeben.** Die fertige WAV geht ans Backend, das sie
ablegt und optional nach MP3 wandelt. Erst danach kann `synth/` weg.

**6. Whisper nachziehen.** Der Lernmodus ist unabhängig vom Rest; er kann
vorher oder nachher umgestellt werden. `stt/` fällt damit weg.

**7. Aufräumen.** `synth/`, `stt/` und die zugehörigen Endpunkte löschen, die
Installationsabschnitte aus der README streichen. Das ist der eigentliche
Gewinn: Wer die App künftig benutzt, installiert kein Python, kein `piper-tts`
und kein `openai-whisper` mehr.

## Was offen ist

**Die Integration ins Frontend ist die einzige ungemessene Stelle.** Rund
29 MB WASM (onnxruntime, `piper_phonemize` samt 18 MB espeak-ng-Daten) müssen
durch Vite. Der naheliegende Weg ist `frontend/public/wasm/`, in `.gitignore`
und über ein Skript geholt wie in den Spikes. Ob Dev-Server und Build damit
anstandslos umgehen, weiß ich nicht – das ist die Art Frage, die einen halben
Tag frisst, und sie gehört als erstes in Schritt 1 geprüft, nicht als letztes.

Die espeak-ng-Daten enthalten *alle* Sprachen. Ein eigener Emscripten-Build
mit nur `de` würde die 18 MB erheblich drücken. Lohnt sich erst, wenn alles
läuft.

**Safari bleibt unbelegt.** Kein Safari unter Windows. Engeres OPFS-Kontingent
und Räumung nicht-persistierter Herkünfte nach sieben Tagen sind dort real. Für
den gewählten Schnitt ist das verkraftbar – der Cache ist abgeleitet –, aber es
ist der Punkt, an dem eine spätere backendlose Fassung kippen könnte.

**Die Lizenzfrage gehört vor Schritt 1 entschieden.** espeak-ng steht unter
GPL-3. Heute ruft das Backend Piper als eigenen Prozess auf, sauber getrennt.
Sobald espeak-ng als WASM im Frontend mitgeliefert wird, wird ein GPL-Artefakt
ausgeliefert, während das Repo MIT ist. Kein Blocker, aber das Einzige in
dieser Liste, das sich später nicht billig korrigieren lässt.

## Was am Ende wegfällt

```
backend/internal/synth/    piper.go, audio.go, pipeline.go, cache.go, job.go
backend/internal/stt/      stt.go
README.md                  "Piper installieren", "Spracherkennung installieren"
Voraussetzungen            Python, piper-tts, openai-whisper
```

Übrig bleibt ein Go-Server, der Projektdateien verwaltet, Stimmen ausliefert
und ffmpeg anwirft. Das ist ungefähr die Hälfte des heutigen Backends – und
der ganze Installationsschmerz ist weg.
