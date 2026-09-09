# Whisper-Spike

Zweiter Wegwerf-Prototyp, nach `../spike-wasm/` (Piper). Die Frage ist diesmal
nicht, *ob* Whisper im Browser Deutsch erkennt – das tut es –, sondern:

**Welches Modell reicht für den Lernmodus, und was kostet es?**

Das ist eine andere Frage als „wie gut transkribiert es". Im Lernmodus wird
nicht transkribiert, sondern verglichen, ob die Replik saß. Deshalb misst der
Spike nicht die Wortfehlerrate, sondern **genau die Metrik der App**:
`compare.js` ist mit esbuild aus `frontend/src/lib/compare.ts` erzeugt, und die
17 vorhandenen Tests aus `compare.test.ts` laufen gegen die erzeugte Datei
unverändert durch.

## Starten

Der Spike benutzt denselben kleinen Server wie der Piper-Spike:

```bash
python spike-wasm/serve.py
# http://localhost:8081/spike-whisper/
```

Dann einfach **Erkennen** oder **Durchlauf starten** drücken – ist noch kein
Modell da, wird es dabei nachgeladen. Neben den Knöpfen steht, welches gerade
aktiv ist. **Laden** braucht man nur, um gezielt zu wechseln oder die Ladezeit
allein zu messen.

Vorher lohnt ein Klick auf **onnxruntime prüfen**: meldet er `[11,22]`, ist die
WASM-Seite in Ordnung, und jeder spätere Fehler liegt am Modell.

Beim ersten Laden holt der Browser das Modell von huggingface.co (je nach Größe
40 MB bis 1 GB) und legt es in seinen Cache. Alles andere – transformers.js und
onnxruntime – liegt lokal in `vendor/`.

## Was zu messen ist

Die Seite gibt für jede Kombination aus Modell, Backend und dtype aus:

- **ø Trefferquote** nach `compareSpoken` – „sitzt" zählt ganz, „fast" halb
- je Zeile, ob die Aufnahme von **Piper oder von dir** stammt – gemischte
  Durchläufe sind sonst nicht zu lesen
- **wörtlich getroffene Wörter** von allen Wörtern im Buch
- **Rechenzeit je Replik** und Realtime-Faktor
- **Downloadgröße** und Ladezeit beim ersten Mal

Zum Vergleich das heutige Backend: „ein paar Sekunden je Replik" auf der CPU,
und die Erkennung läuft, während die Auflösung abgespielt wird. Der Browser muss
also gar nicht schnell sein – er muss nur in dieses Zeitfenster passen.

Interessant sind vor allem drei Vergleiche:

1. **tiny → base → small → large-v3-turbo.** Gemessen (siehe unten):
   `base` gewinnt, `tiny` fällt durch, `small` lohnt nicht. Offen ist nur noch
   `large-v3-turbo` auf WebGPU.
2. **wasm gegen webgpu.** Beim Piper-Spike war WebGPU eine Sackgasse (`int64`
   im Duration-Predictor). Hier sollte es das Gegenteil sein: Whisper ist groß
   genug, dass die GPU sich lohnt, und die üblichen Demos laufen genau so.
3. **dtype.** Vorgabe ist *hybrid*: Encoder in `fp32`, Decoder in `q4`. Ein
   q8-Encoder spart Platz, verschluckt aber bei leisem oder gespieltem Sprechen
   Silben – und leise und gespielt ist im Theater der Normalfall.

## Die Repliken

Sieben Stück, in `samples/`, **mit Piper erzeugt**:

| # | Replik | Wörter |
|---|---|---|
| 1 | Ja. | 1 |
| 2 | Was soll das heißen? | 4 |
| 3 | Guten Abend, Frau Nachbarin. Sie sehen bezaubernd aus heute. | 9 |
| 4 | Ich habe Ihnen doch gesagt, dass ich damit nichts zu tun haben will! | 13 |
| 5 | Bring mir den neunundzwanziger Romanée Conti, Jean-Baptiste. | 7 |
| 6 | Nein! Niemals! Eher gehe ich zugrunde, als dass ich diesem Menschen … | 17 |
| 7 | Es war im Herbst, die Blätter fielen schon, und der alte Garten … | 21 |

Kurze Einwürfe, Eigennamen, eine lange Erzählpassage – das Spektrum, das im
Lernmodus vorkommt.

> **Diese Zahlen sind eine Obergrenze, kein Probenalltag.** Piper spricht
> sauber, laut, gleichmäßig und ohne Raum. Ein Mensch, der eine halb gelernte
> Replik im Stehen aufsagt, klingt anders. Mit **●** in der Repliken-Liste
> sprichst du eine Replik selbst ein, danach rechnet der Durchlauf damit. Erst
> diese Zahlen zählen wirklich – die Piper-Werte taugen nur zum Vergleich
> *zwischen* Modellen.

## Was schon geprüft ist

Auf einem Container ohne Zugang zu huggingface.co, also ohne Modell:

- Die Seite lädt fehlerfrei, transformers.js 4.2.0 wird gefunden.
- **onnxruntime startet und rechnet.** Der Knopf *onnxruntime prüfen* lädt ein
  85 Byte grosses ONNX-Modell aus `samples/` und rechnet `[1,2] + [10,20]`;
  kommt `[11,22]` heraus, ist die WASM-Seite in Ordnung. Zwei Sekunden, kein
  Modell-Download nötig.
- Die Audio-Aufbereitung stimmt: alle sieben WAVs werden zu `Float32Array` bei
  16 kHz Mono, Länge auf zwei Nachkommastellen genau wie die Quelle
  (0,48 s … 5,60 s), Pegel plausibel.
- Eigene Aufnahmen überleben das Neuladen (IndexedDB) und werden danach korrekt
  dekodiert.
- Die Vergleichsmetrik rechnet in der Seite dasselbe wie in der App. Probe:
  Buch „Bring mir den neunundzwanziger Romanée Conti, Jean-Baptiste.",
  verstanden „Bring mir den 29er Romane Konti, Jean Baptist." → 57 %,
  3 Wörter wörtlich, 2 als *fast* – „Romane"/„Konti" fallen über die Kölner
  Phonetik hinein, „29er" nicht.
- Die Fehlermeldungen trennen die beiden Fälle, die sich zum Verwechseln
  ähnlich sehen (siehe unten).

**Nicht geprüft ist die Erkennung selbst** – dafür fehlte der Netzzugang zu
huggingface.co. Aus demselben Grund sind die Modell-IDs ein freies Textfeld und
nicht nur eine Auswahlliste: sollte `onnx-community/whisper-base` nicht
stimmen, tippst du den richtigen Namen ein, ohne dass etwas angepasst werden
muss. Die Liste enthält zusätzlich die älteren `Xenova/*`-Varianten.

## Erste Messreihe

Arbeitsrechner, Chrome, `wasm`, dtype *hybrid*, alle sieben Repliken **selbst
eingesprochen**:

| Modell | Download | ø Trefferquote | wörtlich | je Replik |
|---|---|---|---|---|
| whisper-tiny | 116,7 MB | 65 % | 37/72 | 0,49 s |
| whisper-base | 199,2 MB | **77 %** | – | 0,95 s |
| whisper-small | 561,5 MB | 78 % | – | 3,36 s |

**`base` ist die Wahl, und zwar von beiden Seiten eingekesselt.** Nach oben
kostet `small` das 2,8-fache an Download und das 3,5-fache an Rechenzeit für
*einen* Prozentpunkt. Nach unten spart `tiny` die Hälfte der Rechenzeit und
83 MB – und verliert zwölf Punkte.

Mit 0,95 s je Replik passt `base` bequem in das Zeitfenster, in dem die
Auflösung abgespielt wird. Ohne GPU.

(Die Ladezeiten sind nicht vergleichbar: `tiny` brauchte 9,1 s für einen echten
Download, `base` und `small` kamen mit 1,2 bzw. 1,6 s aus dem Browser-Cache.)

### Warum `tiny` nicht nur schlechter ist, sondern unbrauchbar

Der Mittelwert untertreibt. `tiny` degradiert nicht sanft, es **erfindet**:

> Buch: „Nein! Niemals! Eher gehe ich zugrunde, als dass ich diesem Menschen
> noch einmal unter die Augen trete."
> `tiny`: „Nein, immer als Ihr Geld zu gut, das das nicht ist, das ist
> natürlich noch einmal mit den Open-Fetern." — **18 %**

Für eine Gedächtnisstütze ist das schlimmer als eine niedrige Zahl: Wer so
etwas neben seiner Replik stehen sieht, glaubt der Auswertung beim nächsten Mal
nicht mehr. Das Fehlerbild zeigt es auch in der Verteilung – bei `tiny` sind
32 % der Wörter *anders gesagt*, also aktiv falsch, und nur 6 % *nicht gehört*.
Es schweigt nicht, es redet daneben.

Aufgefallen sind dabei auch die Klassiker: `Ich` viermal als „sich"/„das"
verstanden, `Ihnen` als „Bein" – reine Funktionswörter, an denen ein größeres
Modell nicht scheitert.

### Die Kosten je Replik sind fast konstant

| Replik | Ton | Rechenzeit | RTF |
|---|---|---|---|
| „Ja." | 1,20 s | 385 ms | 3,1× |
| Replik 4 | 3,72 s | 483 ms | 7,7× |
| Replik 7 | 6,84 s | 577 ms | 11,9× |

Whisper verarbeitet immer ein 30-Sekunden-Fenster, egal wie kurz die Aufnahme
ist. Der Realtime-Faktor sieht deshalb bei langen Repliken viel besser aus, ist
aber irreführend: **was zählt, ist die nahezu feste halbe Sekunde je Replik.**
Für die Planung im Lernmodus ist das die bequemere Zahl – sie hängt nicht davon
ab, wie lang die Rolle spricht.

### Zahlwörter sind ein blinder Fleck – und kein Modellproblem

Whisper schreibt Ziffern, das Buch schreibt Wörter. Die Metrik der App kann das
nicht überbrücken, nachgerechnet mit `compare.js`:

| Buch / verstanden | Levenshtein | Kölner Codes | gilt als gleich |
|---|---|---|---|
| neunundzwanziger / 29er | 14 | `666836847` / `07` | nein |
| neunzehnhundertachtzehn / 1918 | 23 | `66866272486` / – | nein |
| drei / 3 | 4 | `27` / – | nein |

`cologne()` wirft Ziffern weg, Levenshtein ist chancenlos: solche Paare können
gar nicht zusammenfinden. Ein größeres Modell hilft hier nichts – ein
Zahl-Normalisierer vor dem Vergleich schon.

Die gute Nachricht daneben: **Eigennamen sind kein Problem**, obwohl ich genau
davor gewarnt hatte. Die Kölner Phonetik fängt sie ab:

| Buch / verstanden | Levenshtein | Kölner Codes | gilt als gleich |
|---|---|---|---|
| Conti / Konti | 1 | `462` / `462` | ja |
| Romanée / Romane | 1 | `766` / `766` | ja |
| Baptiste / Baptist | 1 | `11282` / `11282` | ja |

### dtype-Varianten sind nicht frei wählbar

`q8`, `fp16` und `fp32` scheiterten bei `whisper-tiny` alle drei mit derselben
nichtssagenden Meldung:

```
Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE: qdq_actions.cc:137
TransposeDQWeightsForMatMulNBits Missing required scale: …weight_merged_0_scale
```

`MatMulNBits` ist der 4-Bit-Matmul – geladen wurde also weiter eine
q4-Datei, obwohl etwas anderes verlangt war. Welche Varianten es gibt,
entscheidet allein das Repository, und Raten kostet drei Ladeversuche mit
identischem Fehlertext. Deshalb hat die Seite jetzt **„Varianten anzeigen"**:
sie fragt die Dateiliste bei HuggingFace ab und zeigt, welche dtypes für
`encoder_model` und `decoder_model_merged` wirklich vorliegen.

Zwei kleinere Dinge kamen aus demselben Anlass dazu: Die Fehlermeldung trennt
jetzt einen Sitzungsfehler von einem Netzfehler, und ein fehlgeschlagener
Wechsel reisst das laufende Modell nicht mehr mit – es bleibt geladen, statt
den Nutzer mit nichts zurückzulassen.

## Was schon feststeht

- **`initial_prompt` gibt es in transformers.js nicht.** In
  `generation_whisper.js` ist `prompt_ids` zwar als Feld deklariert, in
  `modeling_whisper.js` ist die Zeile aber auskommentiert. Das Backend übergibt
  heute die Rollennamen des Stücks so; im Browser fiele das weg. Machbar wäre
  es über selbst gebaute `decoder_input_ids` (`<|startofprev|>` + Namen +
  `<|startoftranscript|><|de|><|transcribe|><|notimestamps|>`) – die Pipeline
  reicht einen Tensor an dieser Stelle durch. Der Verlust ist aber klein: der
  Vergleich fängt Namen ohnehin über die Kölner Phonetik ab.
- **transformers.js importiert onnxruntime unter nackten Namen**
  (`onnxruntime-common`, `onnxruntime-web/webgpu`) und liefert es nicht mit.
  Ohne Bundler braucht die Seite eine Import-Map. Beide Namen zeigen hier auf
  *dieselbe* Datei `ort.webgpu.min.mjs` – die exportiert `Tensor` mit, und so
  gibt es nur eine Tensor-Klasse im Speicher. Zwei Kopien wären ein Fehler, den
  man erst weit später an einem seltsamen `instanceof` merkt.
- **„no available backend found" heisst fast nie, was es sagt.** Der erste
  echte Lauf scheiterte daran, dass onnxruntime
  `ort-wasm-simd-threaded.asyncify.mjs` suchte – `vendor/` enthielt nur die
  jsep-Variante, weil transformers.js genau die in seinem `dist/` mitliefert.
  Welche Variante gebraucht wird, entscheidet aber nicht transformers.js,
  sondern `ort.webgpu.min.mjs`, und dort steht der Dateiname fest verdrahtet.
  `fetch-vendor.sh` kopiert deshalb inzwischen *alle* Varianten – der Browser
  lädt ohnehin nur die eine, die er braucht. Die Fehlermeldung der Seite nennt
  jetzt die fehlende Datei beim Namen, statt einen Modell-Download zu
  vermuten.
- Die `ort`-Version ist **nicht** frei wählbar: sie muss die sein, die
  `@huggingface/transformers` in seiner `package.json` führt (hier ein
  Dev-Build, `1.26.0-dev.20260416-b7804b056c`), sonst passen die mitgelieferte
  `ort-wasm-simd-threaded.jsep.mjs` und die `.wasm`-Datei nicht zueinander.

## Dateien

```
index.html      Oberfläche, inklusive Import-Map
app.js          Audio-Aufbereitung, Pipeline, Vergleich, Durchlauf
compare.js      ERZEUGT aus frontend/src/lib/compare.ts (esbuild) - nicht von Hand ändern
samples/        sieben Repliken als WAV + index.json, mit Piper erzeugt
                _ort-selftest.onnx: 85 Byte, nur fuer den Selbsttest
fetch-vendor.sh lädt vendor/ neu (npm pack, keine CDN nötig)
vendor/         nicht im Repo:
                  transformers.web.min.js               432 KB   @huggingface/transformers 4.2.0
                  ort.webgpu.min.mjs                     67 KB   onnxruntime-web (Dev-Build)
                  ort-wasm-simd-threaded.*         alle Varianten – gebraucht wird
                                                   derzeit .asyncify (23,6 MB)
```

`compare.js` neu erzeugen:

```bash
npx esbuild frontend/src/lib/compare.ts --format=esm --target=es2022 \
  --outfile=spike-whisper/compare.js
```

## Was der Spike nicht beantwortet

- Wie gut es mit **echtem Raumhall, Nebengeräusch und mehreren Sprechern**
  läuft – dafür muss selbst eingesprochen werden.
- **Safari**: kein WebGPU, also nur WASM, und der Modell-Cache unterliegt
  dort der 7-Tage-Räumung.
- Ob die Erkennung in einen **Worker** gehört. Hier läuft sie im Haupt-Thread.
  In der App liefe sie ohnehin parallel zur Auflösung, also gegen die Uhr des
  Abspielens – dort wäre ein Worker Pflicht.
- **Streaming**: hier wird immer die ganze Aufnahme am Stück erkannt. Für
  Repliken unter 30 s ist das richtig; länger wird im Lernmodus nichts.
