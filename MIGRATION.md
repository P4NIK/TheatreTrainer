# Vom Backend in den Browser

Piper und Whisper laufen im Browser. Das Ziel ist eine statische Seite ohne
Backend und ohne Betriebskosten, die auch jemand bedienen kann, der nichts
installieren will. Dieses Dokument hält fest, was gemessen wurde, was daraus
folgt und in welcher Reihenfolge gebaut wird.

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
| `frontend/src/lib/piper.ts` | `synth/piper.go` (Prozessaufruf) | sample-genau wie `python -m piper` |
| `frontend/src/lib/storage.ts` | `synth/cache.go` (Ablage) | echtes OPFS in Chromium geprüft |
| `frontend/src/lib/synth.ts` | `synth/job.go` + Cache-Hälfte von `pipeline.go` | ganzer Durchlauf im Browser, zweiter Lauf sample-gleich |
| `frontend/src/lib/voices.ts` | `voices/` samt README-Anleitung | 63 201 294 Bytes über CORS erreichbar |
| `frontend/src/lib/engine.ts` + `useSynthesis.ts` | `synth/job.go`, Polling, `/api/.../synthesize` | „Audio erzeugen" läuft im Browser |

Dazu zwei Prüfstände, die beide Fassungen gegeneinander fahren, solange sie
nebeneinander leben: `tools/audio-parity/` und `tools/cache-key-parity/`.

## Das Ziel

**Eine statische Seite, die jemand aufruft und benutzt.** Kein Server, keine
Betriebskosten, keine Installation – und bedienbar von jemandem, der nicht
weiß, was ein Terminal ist.

Das ist erreichbar, und fast alles Gemessene stützt es: keine
Cross-Origin-Isolation nötig (also GitHub Pages), kein WebGPU nötig (also auch
Firefox und Safari), OPFS schnell und groß genug. Piper und Whisper laufen
ohnehin im Browser.

Die Lizenzfrage ist entschieden: **espeak-ng kommt mit, das Projekt wird
GPL-3.** Beiträge gibt es nur vom Autor, der Wechsel ist also seine allein.

Das Backend verschwindet damit ganz. Es bleibt als Zwischenschritt bestehen,
solange der Umbau läuft, bekommt aber keine neue Arbeit mehr.

### Was dieses Ziel neu aufwirft

Zwei Probleme, die vorher keine waren, weil eine Festplatte dahinterstand.

**1. Der erste Aufruf lädt viel.** Vollständig wären es rund 290 MB: 29 MB
WASM, 63 MB Stimme, ~200 MB Whisper. Für jemanden, der die Seite zum ersten
Mal öffnet, ist das ein sehr langer weißer Bildschirm.

Die Antwort ist **stufenweises Laden**, und sie ergibt sich aus dem, was wann
gebraucht wird:

| Stufe | Größe | wofür |
|---|---|---|
| Anwendung + onnxruntime | ~12 MB | PDF öffnen, Blöcke markieren, Sprecher zuordnen |
| espeak-ng-Daten | 18 MB → **2–3 MB** | erst beim ersten Vorlesen |
| eine Stimme | 63 MB (`medium`) / ~20 MB (`low`) | erst beim ersten Vorlesen |
| Whisper `base` | ~200 MB | **nur wenn der Lernmodus eingeschaltet wird** |

Der Lernmodus ist optional – ihn nicht auf Verdacht zu laden, halbiert den
ersten Besuch. Und der espeak-Datensatz enthält *alle* Sprachen; ein eigener
Emscripten-Build mit nur `de` drückt 18 MB auf wenige. Das war bisher als
„lohnt sich später" notiert und ist jetzt eine Aufgabe des ersten Eindrucks.

Dazu ein Service Worker: nach dem ersten Besuch läuft die Seite offline und
lässt sich auf Telefon oder Tablet als App ablegen. Kostet nichts und ist für
Laien der Unterschied zwischen „Webseite" und „Programm".

**2. Ohne Festplatte ist OPFS auch für Unersetzliches zuständig.** Die frühere
Begründung – „der Cache ist abgeleitet, ein Verlust kostet 3,5 Minuten" – galt,
solange PDF, Blöcke und Karteikarten im Backend lagen. Jetzt liegt alles im
Browser, und Safaris Räumung nicht-persistierter Herkünfte nach sieben Tagen
wäre **Datenverlust**, nicht Unbequemlichkeit.

Drei Maßnahmen, aufsteigend nach Verlässlichkeit:

- `navigator.storage.persist()` gleich beim ersten Projekt anfordern, mit einem
  Satz Erklärung statt eines nackten Browser-Dialogs.
- **Export als eine Datei** – Projekt, Blöcke, Sprecher, Karteikarten, ohne
  Cache. Das sind ein paar hundert Kilobyte. „Sicherungskopie speichern"
  versteht jeder, und es löst zugleich den Wechsel auf ein anderes Gerät.
- Die fertige Hörfassung ist ohnehin ein Download – also auch eine Sicherung.

Export/Import gibt es heute nicht, weil das Backend die Daten hielt. Ohne
Backend ist es keine Zusatzfunktion, sondern Teil des Fundaments.

### Der Schnitt

Alles läuft im Browser. Nichts bleibt im Backend.

- Synthese (Piper als WASM) und Erkennung (Whisper als WASM)
- Planung, Nachbearbeitung, Zusammensetzen (`pipeline.ts`, `audio.ts`)
- Zwischenspeicher **und** Projektdaten in OPFS
- Stimm- und Whisper-Modelle von HuggingFace, danach in OPFS
- MP3-Export: fällt weg oder wandert in den Browser. Die Hörfassung als WAV
  anzubieten reicht zunächst – MP3 ist Bequemlichkeit, kein Muss.

## Reihenfolge

Die ersten drei Schritte lassen das Backend unangetastet. Es kann jederzeit
abgebrochen werden, ohne dass etwas kaputt ist.

**1. Piper-Engine herausschälen — erledigt.** `spike-wasm/app.js` enthält den fertigen
Weg – Phonemisierung, ID-Bildung, ONNX, Skalen – aber in einer Wegwerf-Seite.
Er wird zu `frontend/src/lib/piper.ts` plus einem Worker. Der Prüfstein ist
hart und schon da: die Ausgabe muss weiter sample-genau der Kommandozeile
entsprechen.

**2. OPFS-Cache hinter `cacheKey()` — erledigt.** `storage.ts` hat beides:
`BlockCache` legt Blöcke als WAV ab und liest sie streng zurück – was nicht wie
ein selbst geschriebenes WAV aussieht, gilt als Fehltreffer und wird neu
erzeugt –, und `ModelStore` holt eine Datei einmal aus dem Netz und behält sie.
Dahinter steckt `BlobStore`, damit alles darüber ohne Browser prüfbar bleibt.

**3. Beides verdrahten — der Durchlauf läuft im Browser.** `synth.ts`
legt den Zwischenspeicher vor Piper und schiebt Piper auf einen eigenen Thread
(`synthWorker.ts`) – nicht wegen Tempo, sondern damit die Seite während der
dreieinhalb Minuten bedienbar bleibt. Gemessen in Chromium: drei Blöcke, 6,6 s
Audio, 4,7 s beim ersten Lauf mitsamt Laden der Stimme, **45 ms beim zweiten**
aus dem Zwischenspeicher, Sample für Sample dasselbe. Die Oberfläche hängt vollständig
daran: „Audio erzeugen" (`useSynthesis` statt Job-Registry und Polling, die
fertige WAV als Objekt-URL im Tab), die Einzelblöcke in Blockliste und
Lernmodus (`useBlockAudio`) und die Hörprobe in `SpeakerConfig`. Alle vier
teilen sich eine Engine je Projekt (`engine.ts`) – also einen Worker, eine
geladene Stimme, einen Zwischenspeicher. Was im Lernmodus gehört wurde, ist im
Durchlauf schon da, und umgekehrt.

Damit ruft das Frontend keinen Synthese-Endpunkt mehr auf; die zugehörigen
Methoden in `api/client.ts` und die Typen `Job`, `VoicesResponse`,
`SynthOptions` sind gelöscht. `backend/internal/synth/` ist arbeitslos –
gelöscht wird es erst in Schritt 8, wenn auch die Projektdaten umgezogen sind.

**Wer bisher eine andere Stimme zugewiesen hatte** (etwa `de_DE-mls-medium`),
sieht in der Sprecher-Verwaltung einen roten Hinweis und wählt Thorsten neu;
die Sprecher-ID-Spalte ist weg, weil sie bei einer Einzelsprecher-Stimme nichts
tut.

**4. Stimmen aus dem Netz — erledigt, samt Liste.** `voices.ts` holt Modell und
Beschreibung von HuggingFace und legt beides in OPFS; der zweite Besuch braucht
kein Netz. Aus einer fremden Herkunft heraus gegengeprüft: CORS ist offen,
Bereichsanfragen gehen, die Datei ist 63 201 294 Bytes groß. Die Liste führt
**nur Thorsten** – von den freien deutschen Stimmen trägt allein diese ein
ganzes Stück, und mehrere Rollen entstehen ohnehin über Tonhöhe und Tempo
(`audio.ts`). Damit entfallen der README-Abschnitt „Stimmen herunterladen" und
der Ordner `voices/`.

**5. Projektdaten nach OPFS — erledigt.** `store.ts` ist die Portierung von
`project/store.go`, Datei für Datei: `projects/<id>/project.json`,
`blocks.json`, `speakers.json`, `cards.json`, `source.pdf`. Auch die Regeln,
die der Go-Speicher beim Schreiben durchsetzte, gelten weiter – eine
Regieanweisung verliert ihren Sprechernamen, Blöcke liegen in Lesereihenfolge,
ein unbekanntes Stück ist ein Fehler und kein leeres. Gegengeprüft in Chromium:
anlegen, listen, exportieren, importieren, löschen samt Zwischenspeicher.

Dazu zwei Dinge, die es vorher nicht geben musste:

- **Sicherungskopie.** Ein Klick je Stück schreibt `<id>.theater.json` – Projekt,
  Blöcke, Sprecher, Karteikarten und das PDF, nur der nachrechenbare
  Zwischenspeicher bleibt draußen. Zurückgelesen wird sie *neben* das
  vorhandene Stück, nie darüber: ein Import daneben ist zurückzunehmen, ein
  Import darüber nicht.
- **Übernahme aus dem alten Backend** (`legacyImport.ts`). Solange der Go-Server
  noch läuft, holt ein Knopf die dort liegenden Stücke mitsamt PDF in den
  Browser. Die Datei ist ausdrücklich vorläufig und verschwindet mit Schritt 8.

Damit ruft das Frontend vom Backend nur noch die Spracherkennung ab. Aus
`api/client.ts` sind fünfzehn Methoden verschwunden; übrig sind `sttInfo` und
`transcribe`.

**6. Whisper nachziehen.** Der Lernmodus ist unabhängig vom Rest. Wichtig ist
nur, dass sein Modell **erst beim Einschalten** geladen wird.

**7. Erster Eindruck.** Stufenweises Laden mit sichtbarem Fortschritt, ein
eigener espeak-Build nur mit Deutsch, Service Worker fürs Offline-Arbeiten.
Für Laien ist dieser Schritt kein Beiwerk, sondern der, der über Benutzen oder
Weggehen entscheidet.

**8. Backend löschen.** `backend/` fällt komplett weg, die README schrumpft auf
„Seite aufrufen". Das ist der eigentliche Gewinn: kein Go, kein Python, kein
`piper-tts`, kein `openai-whisper`, keine Stimmen von Hand – und keine
Betriebskosten.

## Was offen ist

**Die Integration ins Frontend ist geklärt.** Die WASM-Dateien liegen in
`frontend/public/wasm/`, stehen in `.gitignore` und werden von `npm run wasm`
(`fetch-wasm.mjs`, plattformneutral in Node) aus `node_modules` geholt. Vite
reicht den Ordner unverändert nach `dist/` durch, legt onnxruntime in ein
nachgeladenes Bündel und baut aus `synthWorker.ts` von selbst einen eigenen
Chunk; der Build dauert unter einer Sekunde.

Eine Stelle hat es doch gekostet, und sie ist der Grund für die
`generatedUrl()`-Hilfe in `piper.ts`: **eine `.mjs` aus `public/` lässt sich
nicht als Modul importieren.** Der Dev-Server verweigert es ausdrücklich
(„this file is in /public … should not be imported from source code"), und
onnxruntime lädt sein Glue-Modul selbst nach – im Build sucht es dabei neben
dem Bündel, wo die Datei nicht liegt. Zeigt man auf den Ordner, läuft der
Build und der Dev-Server nicht; zeigt man nur auf die `.wasm`, läuft der
Dev-Server und der Build nicht. Was in beiden läuft: die Datei holen und als
Blob importieren – für `piper_phonemize.mjs` selbst, und als `mjs`-Pfad für
onnxruntime. Gegengeprüft in Chromium, einmal gegen `vite dev` und einmal
gegen den Build.

Die espeak-ng-Daten enthalten *alle* Sprachen. Ein eigener Emscripten-Build
mit nur `de` würde die 18 MB erheblich drücken. Lohnt sich erst, wenn alles
läuft.

**Safari ist das größte offene Risiko.** Kein Safari unter Windows, also
ungemessen – und beim jetzigen Zielbild wiegt das schwerer als vorher: engeres
OPFS-Kontingent und Räumung nicht-persistierter Herkünfte nach sieben Tagen
träfen dann auch das PDF und den Lernstand. Der Export als Datei ist die
Antwort darauf, und deshalb steht er nicht am Ende der Liste, sondern gehört zu
Schritt 5. Wer ein iPad zur Hand hat, sollte den Speicher-Spike dort einmal
laufen lassen; er braucht nichts als einen Browser.

**Die Bedienung ist noch auf Bastler zugeschnitten.** Wer heute eine Stimme
zuordnet, sieht `de_DE-mls-medium`, eine Sprecher-ID zwischen 0 und 235 und
Regler für `length_scale`. Das ist für den Autor gebaut, nicht für jemanden,
der ein Stück lernen will. Der Umbau ist die Gelegenheit, das hinter Namen und
Vorgaben zu verstecken – keine Migrationsfrage, aber eine, die über
Nutzerfreundlichkeit entscheidet.

## Was am Ende wegfällt

```
backend/                   komplett
voices/                    die Modelle kommen aus dem Netz
docker/                    nichts mehr zu betreiben
README.md                  "Voraussetzungen", "Piper installieren",
                           "Stimmen herunterladen", "Spracherkennung
                           installieren", "Starten", "Konfiguration"
```

Übrig bleibt ein Frontend auf einem statischen Hoster. Aus einer Anleitung mit
sechs Installationsabschnitten wird ein Link.
