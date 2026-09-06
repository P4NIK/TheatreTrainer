# Theater-Vorleser

Eine lokale Web-App zum Proben von Theaterstücken: PDF importieren,
Sprecher-Blöcke per Rechteck markieren, jeder Rolle eine Piper-Stimme zuweisen
und daraus eine durchgehende Hörfassung erzeugen – wahlweise mit der eigenen
Rolle als Sprechpause.

Alles läuft offline auf dem eigenen Rechner. Es werden keine Daten ins Netz
geschickt, es gibt keine Datenbank und keinen Account.

```
PDF  ──▶  Blöcke markieren  ──▶  Stimmen zuweisen  ──▶  MP3/WAV zum Üben
```

## Funktionen

- PDF-Import pro Projekt, Seitenansicht mit Zoom
- Rechteck-Auswahl auf der Seite; der Text wird aus der PDF-Textebene
  übernommen und ist frei korrigierbar
- Sprechername wird aus Mustern wie `HUGO: …` automatisch vorgeschlagen
- Automatische Blockerkennung für das ganze Stück: Das Spaltenraster wird aus
  den von Hand gezeichneten Blöcken gelernt
- Regieanweisungen als eigener Blocktyp (eigene Stimme, eigenes Tempo) –
  eingeklammerte Einschübe im Sprechtext lassen sich entfernen oder in eigene
  Blöcke auftrennen
- Vorlese-Reihenfolge per Drag & Drop änderbar – wichtig bei mehrspaltigem
  Layout
- Pro Sprecher: Stimm-Modell, Sprecher-ID (bei Multi-Speaker-Modellen),
  Tonhöhe, Tempo, Lautstärke, Farbe, Hörprobe – über die Tonhöhe lassen sich
  mehrere Rollen aus einer einzigen guten Stimme besetzen
- Eigene Rolle markieren und beim Erzeugen durch eine Pause **in Originallänge**
  ersetzen – der Einsatz kommt dadurch zeitlich richtig
- Nur einen Ausschnitt erzeugen: ein Seitenbereich (z. B. Akt 1), alle Stellen,
  an denen die eigene Rolle auf der Bühne steht – samt Stichwort davor – oder
  eine von Hand angehakte Auswahl einzelner Blöcke
- **Lernmodus**: interaktiv proben – alles wird vorgelesen, bei der eigenen
  Rolle hält der Durchlauf an, danach kommt die Auflösung. Optional mit
  Mitschnitt und Wort-für-Wort-Vergleich per lokaler Spracherkennung
- Der Lernmodus merkt sich, wo du aufgehört hast, und bietet beim nächsten Mal
  Weitermachen oder Von-vorne an; mit „Ab Seite“ steigst du an jeder Stelle ein
- Jeder Block wird einzeln zwischengespeichert: Nach einer Textänderung wird
  nur dieser eine Block neu erzeugt, und einzelne Repliken lassen sich direkt
  in der Blockliste anhören
- Ausgabe als MP3 (wenn ffmpeg vorhanden) oder WAV

## Voraussetzungen

| Werkzeug | Version | Zweck |
|---|---|---|
| [Go](https://go.dev/dl/) | 1.22 oder neuer | Backend |
| [Node.js](https://nodejs.org/) | 20 oder neuer (empfohlen 22) | Frontend |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | aktuell | Sprachsynthese |
| ffmpeg | optional | MP3-Export (ohne ffmpeg wird WAV ausgeliefert) |
| [Whisper](https://github.com/openai/whisper) | optional | Auswertung des Gesagten im Lernmodus |

### Piper installieren

Am einfachsten über Python (funktioniert unter Windows, macOS und Linux):

```bash
pip install piper-tts
```

**Wichtig:** `pip` legt zwar ein `piper`-Programm an, aber häufig in einem
Ordner, der nicht im `PATH` steht – unter Windows ist das eher die Regel als
die Ausnahme. Der Aufruf lautet dann `python -m piper` statt `piper`.

Die App sucht Piper deshalb selbst und probiert der Reihe nach:

```
piper · python -m piper · python3 -m piper · py -m piper
```

Du musst also nichts konfigurieren. Beim Start schreibt das Backend in die
Konsole, welchen Aufruf es gefunden hat, z. B.:

```
Piper:   python -m piper
```

Selbst prüfen kannst du es so (im selben Terminal, in dem du auch das Backend
startest):

```bash
python -m piper --help
```

Kommt eine Hilfeseite, ist alles in Ordnung. Kommt `No module named piper`,
ist das Paket in einem anderen Python installiert – dann `pip install
piper-tts` mit genau diesem Python wiederholen:

```bash
python -m pip install piper-tts
```

Ein vollständiger Test mit einer Stimme (nachdem du unten Modelle geladen
hast):

```bash
# Linux/macOS
echo "Guten Abend." | python3 -m piper -m voices/de_DE-thorsten-medium.onnx -c voices/de_DE-thorsten-medium.onnx.json -f test.wav
```

```powershell
# Windows (PowerShell)
"Guten Abend." | python -m piper -m voices\de_DE-thorsten-medium.onnx -c voices\de_DE-thorsten-medium.onnx.json -f test.wav
```

Nur falls die automatische Suche daneben liegt (etwa bei einem selbst
gebauten Binary oder einem venv), kannst du den Aufruf fest vorgeben:

```bash
# Linux/macOS
export PIPER_BIN="/pfad/zu/meinem/piper"
```

```powershell
# Windows (PowerShell) – gilt nur für dieses Fenster
$env:PIPER_BIN = "C:\tools\piper\piper.exe"
```

Ist `PIPER_BIN` gesetzt, wird **ausschließlich** dieser Befehl geprüft.

### Stimmen herunterladen

Die Modelle sind mehrere hundert MB groß und liegen deshalb nicht im Repo. Lege
sie in den Ordner `voices/` im Projektstamm. Jede Stimme besteht aus **zwei**
Dateien:

```
voices/
  de_DE-thorsten-medium.onnx
  de_DE-thorsten-medium.onnx.json
```

Herunterladen zum Beispiel so:

```bash
python -m piper.download_voices de_DE-thorsten-medium --data-dir voices
```

Oder direkt von Hugging Face:
<https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE>

### Welche deutsche Stimme? Und wie besetze ich mehrere Rollen?

Die Auswahl an deutschen Piper-Stimmen ist überschaubar. Das ist der komplette
Bestand:

| Stimme | Stufe | Sprecher | Anmerkung |
|---|---|---|---|
| `de_DE-thorsten-high` | high | 1 | **beste deutsche Stimme**, Studioaufnahmen |
| `de_DE-thorsten-medium` | medium | 1 | fast so gut, deutlich schneller |
| `de_DE-thorsten_emotional-medium` | medium | 8 | derselbe Sprecher in acht Stimmungen |
| `de_DE-mls-medium` | medium | 236 | aus Hörbuchaufnahmen, sehr schwankend |
| `de_DE-kerstin-low`, `-karlsson-low`, `-pavoque-low`, `-ramona-low` | low | 1 | 16 kHz, rau |
| `de_DE-eva_k-x_low` | x_low | 1 | 16 kHz, blechern |

Das Naheliegende – für jede Rolle eine andere Stimme – geht damit nicht gut
aus: Es gibt genau **eine** wirklich gute deutsche Stimme. `mls-medium` klingt
trotz „medium“ mäßig, weil es aus Laien-Hörbuchaufnahmen unterschiedlichster
Aufnahmequalität trainiert wurde; daran ändert auch die Wahl des Sprechers
wenig.

Der Weg, der funktioniert: **eine gute Stimme für alle Rollen, unterschieden
über die Tonhöhe.**

```bash
python -m piper.download_voices de_DE-thorsten-high --data-dir voices
```

In der Sprecher-Tabelle gibt es dafür den Regler *Tonhöhe*. Er verschiebt
Grundton und Formanten gemeinsam – anders als eine reine Abspielgeschwindigkeit
klingt das nach einer anderen Person und nicht nach schnellerem Band. Das Tempo
bleibt davon unberührt, beide Regler sind unabhängig. Neue Rollen bekommen
automatisch verschiedene Werte, die du nach Gehör nachziehst.

Als Anhaltspunkt: ±10 % sind eine andere Person gleichen Geschlechts, ±20 %
verschieben deutlich Richtung jünger/älter. Über etwa ±25 % hinaus wird es
karikaturhaft, deshalb ist dort Schluss. Wer mehr Abwechslung will, kombiniert
Tonhöhe mit leicht unterschiedlichem Tempo oder nimmt für einzelne Rollen
zusätzlich `thorsten_emotional-medium` mit seinen acht Stimmungen.

## Starten

Zwei Terminals, ein Befehl pro Terminal.

**1. Backend**

```bash
cd backend
go run ./cmd/server
```

Läuft auf <http://localhost:8080> und legt `data/` und `voices/` an, falls sie
fehlen.

**2. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Läuft auf <http://localhost:5173> und leitet `/api` an das Backend weiter.
Diese Adresse im Browser öffnen.

### Einzelne Anwendung ohne Node

Wenn du das Frontend einmal baust, liefert das Go-Backend es selbst aus –
danach reicht ein einziger Prozess:

```bash
cd frontend && npm install && npm run build
cd ../backend && go run ./cmd/server
# App läuft komplett auf http://localhost:8080
```

## Bedienung

1. **Projekt anlegen** – Name eingeben, PDF hochladen.
2. **Editor** – mit der Maus ein Rechteck um eine Textzeile ziehen. Der Text
   erscheint im Dialog, Sprecher und Typ prüfen, „Hinzufügen“.
   Über den Chip links oben an jedem Rahmen lässt sich ein Block auswählen; in
   der rechten Liste bearbeitest, löschst und sortierst du sie.
   Gespeichert wird automatisch (ca. 1 s nach der letzten Änderung).
3. **Automatisch erkennen** – wenn ein paar Blöcke stehen, füllt der Knopf
   oben rechts den Rest des Stücks (siehe unten).
4. **Sprecher** – jeder Rolle ein Stimm-Modell zuweisen, Tonhöhe, Tempo und
   Lautstärke einstellen, mit dem Play-Knopf eine Hörprobe abspielen und die
   eigene Rolle markieren. Zum Besetzen mehrerer Rollen siehe „Welche deutsche
   Stimme?“.
5. **Hörfassung** – oben auswählen, welcher Teil des Stücks erzeugt werden soll
   (siehe unten), darunter die Schalter für „eigene Rolle aussparen“ und
   „Regieanweisungen mitlesen“ setzen, „Audio erzeugen“ drücken, danach direkt
   im Browser anhören oder herunterladen.
6. **Lernmodus** – Rolle und Ausschnitt wählen, „Probe starten“, und der
   Rechner spielt dir die Szene vor, bis du dran bist (siehe unten).

### Blöcke automatisch erkennen

Ein Theaterstück ist in Spalten gesetzt: Sprechername und Regieanweisungen am
linken Rand, der Sprechtext eingerückt. Wo genau diese beiden Spalten liegen,
macht jeder Verlag anders – deshalb ist nichts fest verdrahtet, sondern die App
liest es aus deinen eigenen Blöcken ab.

**Vorgehen:** zwei, drei Blöcke von Hand ziehen – eine Sprechzeile und eine
Regieanweisung genügen –, dann oben rechts auf „Automatisch erkennen“. Der
Dialog zeigt, was er gelernt hat („Sprechernamen beginnen bei 6,0 % der
Seitenbreite, der Sprechtext bei 24,2 %“), du wählst den Bereich und bekommst
eine Vorschau, bevor etwas übernommen wird.

Ohne gezeichnete Blöcke rät die App die Spalten aus dem Seitenaufbau. Das
funktioniert oft, aber das Lernen ist deutlich zuverlässiger.

Was dabei automatisch passiert:

- Sprechername und Sprechtext werden getrennt, mehrzeilige Repliken
  zusammengefasst.
- Eine Replik, die auf der nächsten Seite weiterläuft, behält ihren Sprecher.
- Seitenzahlen und zentrierte Überschriften („Erster Akt“) werden ignoriert.
- Seiten ohne Dialog – Titelei, Rechtehinweise, Personenverzeichnis – werden
  übersprungen (abschaltbar).
- Eingeklammerte Einschübe wie „(kostet)“ fliegen aus dem Sprechtext. Zur
  Auswahl stehen außerdem „als eigene Blöcke“ – dann liest sie die
  Regie-Stimme – und „im Text lassen“ (siehe unten).
- Bereiche, auf denen schon ein Block liegt, bleiben unangetastet. Ein zweiter
  Durchlauf ändert also nichts, und ein halb bearbeitetes Stück lässt sich
  auffüllen.

Anschließend wird die Vorlese-Reihenfolge nach Seite und Position neu vergeben.
Bei mehrspaltigem Satz kann das falsch sein – dann in der Blockliste per
Drag & Drop korrigieren.

**Der Text kommt unverändert aus dem PDF.** Ist das PDF fehlerhaft, ist es der
Block auch. In der Vorlage zu diesem Projekt steht an mehreren Stellen
tatsächlich „LandPortion“ statt „Landwein“ – offenbar eine verunglückte
Suchen-und-Ersetzen-Aktion beim Verlag. Solche Stellen korrigierst du in der
Blockliste.

### Regieanweisungen mitten im Sprechtext

Ein Stück schreibt beides in dieselbe Zeile:

> HUGO Wer ist das? *(Er tritt ans Fenster.)* Nur der junge Warrender.

Vorgelesen sind das zwei verschiedene Dinge: die Replik gehört der Rolle, der
Einschub der Regie. Ein Block hat aber genau einen Typ und genau eine Stimme –
der Umschalter „Wie wird dieser Block gelesen?“ im Bearbeiten-Dialog stellt
den ganzen Block um, er ist kein zweites Textfeld.

Damit trotzdem beides richtig klingt, bietet der Dialog bei einem Block mit
Klammern zwei Wege an, mit einer Vorschau der Teile:

- **In N Blöcke aufteilen** – aus einem Block werden mehrere: Sprechtext,
  Regieanweisung, Sprechtext. Der erste behält seine Nummer, die anderen rücken
  direkt dahinter ein. Jeder bekommt damit die Stimme, die zu ihm gehört.
- **Klammerteile entfernen** – die Einschübe fallen weg, der Rest bleibt eine
  Replik.

Fürs ganze Stück auf einmal steht dieselbe Wahl im Dialog „Automatisch
erkennen“ unter „Eingeklammerte Regieanweisungen im Sprechtext“:
*entfernen* (Vorgabe), *als eigene Blöcke*, *im Text lassen*.

## Konfiguration

Alle Pfade sind relativ zum Projektstamm; nichts ist fest verdrahtet. Über
Umgebungsvariablen lässt sich alles überschreiben:

| Variable | Standard | Bedeutung |
|---|---|---|
| `THEATER_ADDR` | `:8080` | Adresse des Servers |
| `THEATER_DATA_DIR` | `<repo>/data` | Projekte, PDFs, Audio |
| `THEATER_VOICES_DIR` | `<repo>/voices` | Piper-Modelle |
| `PIPER_BIN` | automatisch gesucht | Piper-Kommando fest vorgeben, z. B. `python3 -m piper` |
| `PIPER_LENGTH_SCALE_FLAG` | `--length-scale` | ältere Piper-Builds nutzen `--length_scale` |
| `FFMPEG_BIN` | `ffmpeg` | für den MP3-Export |
| `THEATER_SAMPLE_RATE` | `22050` | Abtastrate der Ausgabedatei |
| `THEATER_GAP_MS` | `450` | Pause zwischen zwei Blöcken |
| `THEATER_SKIP_PAUSE_MS` | `2500` | Ersatzpause, wenn die eigene Rolle keine Stimme hat |
| `THEATER_LOG_PIPER` | aus | mit `1` jeden Piper-Aufruf samt Text ins Server-Log schreiben |

### Was die App an Piper übergibt

Bewusst so wenig wie möglich – für eine Einzelstimme mit unveränderten Reglern
ist der Aufruf derselbe, den du auch von Hand tippen würdest:

```
piper -m voices/<modell>.onnx -c voices/<modell>.onnx.json -f <temp>.wav
```

Dazu kommt nur, was wirklich nötig ist:

- `-s <id>` **nur** bei Multi-Speaker-Modellen (`num_speakers > 1`)
- `--length-scale <wert>` **nur**, wenn der Tempo-Regler nicht auf 1,0 steht

Lautstärke und Tonhöhe kennt Pipers Kommandozeile gar nicht; beide werden
nachträglich auf die Samples gerechnet. Der Text geht über die Standardeingabe.

Wer das nachprüfen will, startet das Backend mit `THEATER_LOG_PIPER=1`; dann
steht jeder Aufruf mitsamt Text in der Konsole und lässt sich direkt mit einem
Kommando aus der Shell vergleichen.

### Zwischenspeicher und einzelne Blöcke

Das Erzeugen eines Blocks dauert je nach Länge ein bis drei Sekunden – bei
einem ganzen Stück summiert sich das. Deshalb wird jeder Block einzeln unter
`data/projects/<id>/cache/` abgelegt, benannt nach einem Hash aus genau dem,
was Piper zu sehen bekommt:

```
Text (normalisiert) · Stimm-Modell · Sprecher-ID · Tempo · Renderer-Version
```

Änderst du den Text eines Blocks, ändert sich sein Hash und nur dieser Block
wird neu erzeugt. Alles andere kommt aus dem Zwischenspeicher.

**Tonhöhe und Lautstärke stehen bewusst nicht im Hash.** Beide werden erst nach
Piper auf die Samples gerechnet, also kostet das Verschieben dieser Regler
keine neue Synthese – der Zwischenspeicher bleibt gültig.

In der Blockliste hat jeder Block einen Play-Knopf. Beim ersten Mal wird der
Block erzeugt, danach startet er sofort – und beim späteren Erzeugen des ganzen
Stücks ist er schon fertig. Umgekehrt gilt genauso: Was beim Gesamtdurchlauf
entstanden ist, spielt in der Liste ohne Wartezeit.

Nach jedem Durchlauf werden Einträge entfernt, auf die kein Block mehr
verweist. Der Hörfassungs-Tab zeigt Anzahl und Größe und hat einen Knopf zum
Leeren. Als Größenordnung: Ein abendfüllendes Stück mit rund 1400 Blöcken
belegt etwa 250 MB. Der Ordner liegt unter `data/` und damit in `.gitignore`.

### Nur einen Teil des Stücks erzeugen

Ein ganzes Stück dauert schnell eine Stunde. Für die Probe von morgen reicht
meist ein Ausschnitt, deshalb hat der Hörfassungs-Tab vier Betriebsarten:

| Auswahl | Wofür |
|---|---|
| **Ganzes Stück** | alle Blöcke in Vorlese-Reihenfolge |
| **Seitenbereich** | „von Seite … bis Seite …“ – so schneidest du einen Akt oder eine Szene heraus |
| **Auftritte von \<Rolle\>** | nur die Stellen, an denen deine Rolle spricht, jeweils mit ein paar Blöcken davor und danach |
| **Einzelne Blöcke** | genau die Blöcke, die du von Hand angehakt hast |

Bei „Auftritte“ steuern drei Zahlen den Zuschnitt:

- **Blöcke davor** – dein Stichwort. Zwei Repliken Vorlauf reichen meist, um
  den Einsatz zu erkennen.
- **Blöcke danach** – wie viel nach deiner letzten Replik noch mitläuft.
- **Lücke überbrücken** – liegen zwei Auftritte weniger als so viele Blöcke
  auseinander, wird nicht geschnitten, sondern durchgelesen. Das verhindert,
  dass ein dichter Dialog in ein Dutzend Schnipsel zerfällt.

Wo etwas übersprungen wurde, spricht die App auf Wunsch eine kurze Sprungmarke
(„Weiter auf Seite 31.“) ein – mit der Stimme für Regieanweisungen, damit sie
sich klar vom Stück abhebt. Ist dafür keine Stimme eingestellt, entfällt die
Ansage ersatzlos; sie ist eine Orientierungshilfe, kein Inhalt.

Die Auswahl ändert nichts an den gespeicherten Blöcken – sie legt nur fest,
was in diesen einen Durchlauf kommt. Zusammen mit dem Zwischenspeicher heißt
das: Ist das ganze Stück einmal erzeugt, kostet ein Ausschnitt daraus nur noch
das Zusammenfügen. Der Dateiname des Downloads nennt den Ausschnitt
(`<projekt>-seiten-12-18.mp3`, `<projekt>-auftritte.mp3`,
`<projekt>-auswahl.mp3`), damit mehrere Fassungen nebeneinander liegen können.

#### Einzelne Blöcke von Hand wählen

Wenn weder eine Seitenspanne noch „meine Auftritte“ passt – die halbe Szene,
die drei Repliken vor dem Monolog – hakst du die Blöcke direkt an. „Blöcke
auswählen“ öffnet die Liste des Stücks in Vorlese-Reihenfolge, nach Seiten
gruppiert und mit Sprecher-Chip; deine eigene Rolle ist grün hervorgehoben.

- **Suchen**, **Sprecher** und **Seite von/bis** blenden ein, worum es gerade
  geht. „Sichtbare wählen“ und „Sichtbare abwählen“ wirken genau auf das
  Eingeblendete – erst nach Sprecher filtern, dann alles wählen, ist der
  schnellste Weg zu „alle Repliken von Jeremy“.
- **Umschalt-Klick** wählt vom letzten Klick bis hierher. Eine Szene ist damit
  zwei Klicks weit weg statt dreißig.
- „Abbrechen“ verwirft die Änderungen, „Übernehmen“ setzt sie.

Praktischster Einstieg: erst grob mit „Seitenbereich“ oder „Auftritte“ wählen,
dann auf **einzeln nachjustieren** klicken. Die grobe Auswahl wandert in die
Einzelauswahl, und du entfernst oder ergänzt nur noch, was fehlt.

Berechnet wird die Auswahl im Frontend (`frontend/src/lib/selection.ts`); an
den Server geht nur die fertige Liste aus Block-IDs und Sprungmarken. Der
Server rendert, was in der Liste steht, in genau dieser Reihenfolge.

## Lernmodus

Die Hörfassung ist eine Datei zum Mitlaufen. Der Lernmodus ist eine Probe: Du
wählst deine Rolle, und der Durchlauf spielt Replik für Replik ab – bis deine
kommt. Dann hält er an und wartet. Du sprichst. Anschließend liest er vor, was
im Buch steht, und du hörst sofort, wo du daneben lagst.

Vor dem Start stellst du ein:

| Einstellung | Wirkung |
|---|---|
| **Deine Rolle** | Bei ihr hält der Durchlauf an. Muss nicht die im Projekt hinterlegte Rolle sein – so übst du auch eine Zweitbesetzung |
| **Welcher Teil** | dieselbe Auswahl wie bei der Hörfassung: ganzes Stück, Seitenbereich, deine Auftritte, einzelne Blöcke |
| **Ab Seite** | wo der Durchlauf einsetzt – unabhängig von der Auswahl, siehe unten |
| **Regieanweisungen mitlesen** | aus überspringt sie – dann läuft nur der Dialog |
| **Text der anderen mitlesen** | aus heißt: nur zuhören, näher an der echten Probe |
| **Eigenen Text während der Pause zeigen** | für den ersten Durchgang; sonst deckst du ihn bei Bedarf auf |
| **Pause automatisch beenden** | nach n Sekunden weiter, statt selbst zu klicken |
| **Mitschneiden** | nimmt deine Repliken auf, direkt nach der Auflösung anhörbar; der Durchlauf wartet dann auf „Weiter“ |
| **Gesagtes auswerten** | schickt den Mitschnitt an die lokale Spracherkennung und vergleicht Wort für Wort (siehe unten) |

Im Durchlauf: <kbd>Leertaste</kbd> weiter (beendet die Pause und löst auf),
<kbd>R</kbd> Replik wiederholen, <kbd>T</kbd> eigenen Text aufdecken,
<kbd>P</kbd> anhalten, <kbd>←</kbd>/<kbd>→</kbd> eine Replik zurück und vor.
Über der aktuellen Zeile stehen die beiden vorherigen – genug, um zu wissen,
wo man ist.

**Die Aufnahme bleibt im Browser.** Sie wird nicht hochgeladen und nicht
gespeichert; mit dem Schließen des Durchlaufs ist sie weg. Der Browser fragt
beim ersten Mal nach dem Mikrofon; ohne Erlaubnis läuft die Probe trotzdem,
nur eben ohne Mitschnitt.

**Wartezeit beim ersten Mal.** Jede Replik wird beim ersten Abspielen einmal
mit Piper erzeugt (ein paar Sekunden) und liegt danach im selben
Zwischenspeicher, den auch die Hörfassung nutzt. Während eine Replik läuft,
werden die nächsten vier im Hintergrund geladen; „Vorbereiten“ erledigt vorab
den ganzen Ausschnitt, dann läuft der Durchlauf ohne Stocken.

### Wo der Durchlauf beginnt

Ein Stück übt man selten am Stück. Zwei Wege führen mitten hinein.

**Ab Seite.** Über dem Startknopf steht ein Feld „Ab Seite“. Es gilt
unabhängig davon, welchen Teil du gewählt hast: Die Auswahl bleibt, wie sie
ist – der Durchlauf setzt nur an der ersten Replik ab dieser Seite ein.
Daneben steht, welche Replik das ist, damit du vor dem Start siehst, ob du
richtig gelandet bist. Liegt auf der Seite nichts aus der Auswahl, wird die
nächste genommen, auf der etwas liegt; hinter der letzten sagt die App es und
beginnt vorn. „Vorbereiten“ erzeugt dann ebenfalls erst ab dieser Stelle –
Repliken davor wird dieser Durchlauf nie erreichen.

**Weitermachen.** Der Lernmodus merkt sich, wo du aufgehört hast: im Durchlauf
etwa alle anderthalb Sekunden und noch einmal beim Beenden. Beim nächsten Mal
steht oben eine Karte:

> **Weitermachen** · ILL · Seite 12 · Schritt 42 von 120 · vor 2 Tagen
> [ Weiter ab Seite 12 ] [ Von vorne ] [ vergessen ]

„Weiter“ stellt Rolle und Auswahl wieder her, mit denen du geübt hast, und
setzt an der gemerkten Replik an – eine Stelle ohne den Zuschnitt, aus dem sie
stammt, zeigt sonst woandershin. „Von vorne“ ist der Netflix-Knopf: derselbe
Ausschnitt, aber wieder ab der ersten Replik. „Vergessen“ räumt die Karte weg,
ohne etwas zu starten. Nach einem vollständigen Durchlauf heißt die Karte
„Zuletzt durchgelaufen“ und bietet nur noch „Von vorne“ an – an einem Ende
kann man nicht weiterlaufen.

Gemerkt wird die **Replik**, nicht die Schrittnummer. Blöcke werden ja weiter
korrigiert, umsortiert und neu zugeschnitten, und eine bloße Nummer würde
still auf eine andere Zeile rutschen. Fehlt die gemerkte Replik – gelöscht,
oder von der Auswahl nicht erfasst –, wird über die Lesereihenfolge und
notfalls über die Seite die nächstgelegene Stelle genommen, und die App sagt
dazu, dass sie das getan hat. Liegt eine Sprungmarke („Weiter auf Seite 12.“)
direkt davor, beginnt der Durchlauf auf ihr: Sie ist der Satz, der sagt, wo
man ist.

Die Stelle steht in `project.json`, nicht im Browser. Sie überlebt damit einen
anderen Browser und einen geleerten Zwischenspeicher und liegt in derselben
Sicherung wie das übrige Projekt.

### Gesagtes auswerten

Ist der Schalter an, wandert der Mitschnitt nach jeder Replik an eine **lokal
installierte Spracherkennung** und das Ergebnis wird Wort für Wort mit dem
Buch verglichen:

> 29er <span title="verstanden: Romane">Romanée</span> Conti. *(bitte)*
> — 83 % getroffen, 2 von 3 Wörtern wörtlich, 1 fast

Fünf Zustände, farbig: *sitzt*, *fast*, *anders gesagt*, *nicht gehört*,
*zusätzlich*. Darunter steht immer, was die Erkennung tatsächlich verstanden
hat – damit nachvollziehbar bleibt, wer sich verhört hat.

**Das ist eine Gedächtnisstütze, kein Urteil.** Whisper liegt für Deutsch bei
rund 4–7 % Wortfehlerrate unter guten Bedingungen; für „fehlt mir die halbe
Replik?“ reicht das locker. Ausgerechnet die Wörter, auf die es im Theater
ankommt, trifft die Erkennung aber am schlechtesten: Eigennamen, Dialekt,
leises oder gespieltes Sprechen, kurze Einwürfe. Deshalb:

- Verglichen wird **unscharf**: normalisiert (Kleinschreibung, Satzzeichen und
  Akzente weg), dann per Levenshtein-Abstand und **Kölner Phonetik** – dem
  deutschen Gegenstück zu Soundex. „Romane Conti“ zählt damit als *fast*,
  „Meyer“ und „Mayr“ als dasselbe Wort. Kurze Wörter bekommen keine Toleranz,
  „der“ und „den“ bleiben verschieden.
- Der erwartete Satz geht **nicht** an die Erkennung. Whisper folgt einem
  `--initial_prompt` sehr willig; bekäme es die Replik vorgesagt, schriebe es
  sie auf, egal was gesagt wurde – ein Vergleich, der immer zustimmt, ist
  schlechter als keiner. Übergeben werden nur die **Rollennamen** des Stücks,
  die kein Erkenner erraten kann.
- Stimmt der Text im Block nicht, korrigierst du ihn direkt in der Auflösung
  („Text korrigieren“). Der Vergleich färbt sich sofort neu, ohne die
  Erkennung noch einmal zu bemühen.

#### Spracherkennung installieren

Optional. Fehlt sie, bleibt der Schalter grau und alles andere funktioniert.

```bash
pip install openai-whisper
```

Gesucht wird wie bei Piper der Reihe nach `whisper`, `python -m whisper`,
`python3 -m whisper`, `py -m whisper`. Das Modell steuert `WHISPER_MODEL`
(Vorgabe `small`; `medium` ist genauer und langsamer, `base` umgekehrt). Beim
ersten Lauf lädt Whisper das Modell herunter.

Rechenzeit auf der CPU: ein paar Sekunden je Replik. Sie läuft, während die
Auflösung abgespielt wird.

| Variable | Zweck |
|---|---|
| `WHISPER_BIN` | fester Aufruf statt der automatischen Suche |
| `WHISPER_MODEL` | Modellgröße (`tiny`…`large`), Vorgabe `small` |
| `STT_CMD` | komplette Befehlszeile für andere Engines. Platzhalter `{audio}`, `{model}`, `{out}`; der Text wird von der Standardausgabe gelesen. Für whisper.cpp etwa: `STT_CMD='whisper-cli -m ggml-small.bin -f {audio} -l de -nt'` |
| `THEATER_LOG_STT` | jeden Aufruf ins Server-Log schreiben |

### Die eigene Rolle als Pause

Ist „eigene Rolle aussparen“ aktiv, wird deine Rolle trotzdem synthetisiert –
nur landet statt des Tons eine **gleich lange Stille** in der Datei. Das ist
der Punkt: Die Aufnahme läuft im Takt des Stücks weiter, dein Einsatz kommt an
der richtigen Stelle und ist so lang, wie er sein muss.

Weil das Audio dabei im Zwischenspeicher landet, kostet das Umschalten zwischen
„mit meiner Rolle“ und „ohne“ danach nichts mehr. Hat deine Rolle keine Stimme
zugewiesen, ist die Länge unbekannt; dann gibt es die feste Pause aus
`THEATER_SKIP_PAUSE_MS`.

## Datenablage

```
data/projects/<projekt-id>/
  project.json    # Name, PDF, Seitenzahl, eigene Rolle, zuletzt geübte Stelle
  blocks.json     # markierte Blöcke mit relativen Koordinaten und Text
  speakers.json   # Stimme, Tonhöhe, Tempo, Lautstärke und Farbe je Sprecher
  source.pdf      # das importierte Stück
  audio/          # erzeugte Hörfassungen
  cache/          # Audio je Block, benannt nach dem Hash seiner Einstellungen
```

Die Rechteck-Koordinaten sind relativ zur Seitengröße (0–1) gespeichert und
damit unabhängig von Zoomstufe und Auflösung. Alle Dateien sind lesbares JSON
und lassen sich notfalls von Hand korrigieren.

`data/` und `voices/` stehen in `.gitignore` – PDFs können urheberrechtlich
geschützt sein und Stimm-Modelle sind zu groß fürs Repository.

## Projektstruktur

```
backend/
  cmd/server/         # Einstiegspunkt
  internal/config/    # Pfade und externe Werkzeuge
  internal/project/   # Projekte, Blöcke, Sprecher (JSON-Persistenz)
  internal/voices/    # Scan des voices/-Ordners
  internal/synth/     # Piper-Aufruf, Audio-Konkatenation, Jobs
  internal/stt/       # optionale Spracherkennung für den Lernmodus
  internal/httpapi/   # HTTP-Router und Handler
frontend/
  src/api/            # typisierter API-Client
  src/components/     # PdfCanvasEditor, BlockList, SpeakerConfig,
                      # AutoDetect, SynthesizePanel, Rehearsal
  src/lib/            # Textextraktion, Blockerkennung, Auswahl, Probenablauf,
                      # Wortvergleich (Levenshtein + Kölner Phonetik)
  src/pages/          # Projektliste und Editor
```

## HTTP-API

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/projects` | Projekt anlegen (multipart: `name`, `pdf`) |
| `GET` | `/api/projects` | Projekte auflisten |
| `GET` | `/api/projects/{id}` | Projektdetails |
| `PUT` | `/api/projects/{id}` | Name, eigene Rolle, Seitenzahl ändern |
| `DELETE` | `/api/projects/{id}` | Projekt löschen |
| `PUT` | `/api/projects/{id}/progress` | zuletzt geübte Stelle merken (Block, Seite, Rolle, Auswahl) |
| `DELETE` | `/api/projects/{id}/progress` | gemerkte Stelle vergessen |
| `GET` | `/api/projects/{id}/pdf` | Original-PDF ausliefern |
| `GET`/`PUT` | `/api/projects/{id}/blocks` | Blöcke laden/ersetzen |
| `GET` | `/api/projects/{id}/blocks/{blockId}/audio` | einzelnen Block erzeugen/abspielen |
| `POST` | `/api/projects/{id}/blocks/{blockId}/transcribe` | Mitschnitt (multipart `audio`) in Text verwandeln |
| `GET`/`DELETE` | `/api/projects/{id}/cache` | Zwischenspeicher abfragen/leeren |
| `GET`/`PUT` | `/api/projects/{id}/speakers` | Sprecher-Konfiguration |
| `GET` | `/api/stt` | ob eine Spracherkennung gefunden wurde |
| `GET` | `/api/voices` | installierte Piper-Modelle |
| `POST` | `/api/voices/preview` | Hörprobe synthetisieren (WAV) |
| `POST` | `/api/projects/{id}/synthesize` | Job starten, liefert `jobId`; Body: `skipMyRole`, `includeDirections`, optional `selection` |
| `GET` | `/api/projects/{id}/synthesize/{jobId}` | Job-Status |
| `DELETE` | `/api/projects/{id}/synthesize/{jobId}` | Job abbrechen |
| `GET` | `/api/projects/{id}/audio/{jobId}` | fertige Datei streamen |

## Fehlersuche

**„Piper nicht gefunden“** – der Sprecher-Tab listet auf, welche Befehle
probiert wurden und woran sie gescheitert sind; dieselbe Information steht beim
Start in der Backend-Konsole. Häufigste Ursache: `pip install piper-tts` lief
in einem anderen Python als dem, das im `PATH` steht. Test:
`python -m piper --help`. Nach einer Neuinstallation reicht „Stimmen neu
einlesen“ im Sprecher-Tab, das Backend sucht dann erneut.

**„Keine Stimm-Modelle gefunden“** – liegen `*.onnx` **und** `*.onnx.json` im
Ordner `voices/`? Der Pfad steht in der Warnung im Sprecher-Tab.

**Synthese bricht mit einem Piper-Fehler ab** – ältere Piper-Versionen kennen
`--length-scale` nicht. Dann `PIPER_LENGTH_SCALE_FLAG=--length_scale` setzen.

**Umlaute werden als Zeichen vorgelesen („A Tilde“, „Absatz“)** – das war ein
Encoding-Fehler und ist behoben. Zum Verständnis, falls es irgendwo wieder
auftaucht: Der Text geht als UTF-8 an Piper, Pipers Python-Variante decodiert
die Standardeingabe aber mit der Zeichentabelle des Systems – unter deutschem
Windows cp1252. Aus `Hörprobe` wird dann `HÃ¶rprobe`, und espeak spricht
unbekannte Zeichen mit Namen aus: `Ã` → „A Tilde“, `¶` → „Absatz“. Das Backend
setzt für den Piper-Prozess deshalb `PYTHONUTF8=1` und
`PYTHONIOENCODING=utf-8`. Ein Satz ohne Umlaute ist übrigens unauffällig –
darum fällt der Fehler beim Testen leicht durchs Raster.

**Beim Rechteckziehen kommt kein Text** – das PDF ist vermutlich ein Scan ohne
Textebene. Der Text lässt sich im Dialog trotzdem von Hand eintippen; für
größere Stücke hilft vorher eine OCR-Behandlung (z. B. `ocrmypdf`).

**Die Reihenfolge stimmt nicht** – bei zweispaltigem Satz ist „oben nach unten“
nicht die Lesereihenfolge. Blöcke in der rechten Liste per Drag & Drop
sortieren; die Nummer am Rahmen zeigt die Vorlese-Position.

## Tests

Backend bauen und prüfen:

```bash
cd backend && go vet ./... && go test ./... && go build ./...
```

`go test` prüft die Audio-Bausteine (Resampling, Zeitdehnung, Tonhöhe), den
Zwischenspeicher, die Zusammenstellung eines Durchlaufs (Reihenfolge der
Auswahl, Sprungmarken, ausgesparte eigene Repliken, fehlende Stimmen) und die
Anbindung der Spracherkennung.

Frontend typprüfen, testen und bauen:

```bash
cd frontend && npm test && npm run build
```

`npm test` prüft die automatische Blockerkennung – Sprechernamen, die als zwei
Textstücke gesetzt sind, das Auftrennen eingeklammerter Einschübe,
Regieanweisungen, die mit einem Rollennamen beginnen,
Repliken über Seitengrenzen, Seitenzahlen –, die Auswahl eines Ausschnitts –
Seitenbereiche, Vor- und Nachlauf um die eigene Rolle, das Zusammenfassen naher
Auftritte, die Einzelauswahl und die Sprungmarken – und den Ablauf des
Lernmodus: welche Schritte gehört und welche gesprochen werden, was beim
Überspringen der Regieanweisungen übrig bleibt, und den Wortvergleich –
Kölner Phonetik gegen die dokumentierten Beispiele, Levenshtein, und was bei
fehlenden, zusätzlichen und anders gesagten Wörtern herauskommt.

Optionaler Durchklick-Test im Browser (Backend muss laufen, Frontend gebaut
sein):

```bash
cd frontend && npm install -D playwright && node e2e-smoke.mjs
```

## Lizenz

Der Code steht unter der MIT-Lizenz. Piper und die Stimm-Modelle haben eigene
Lizenzen – bitte dort nachsehen, bevor du erzeugte Audiodateien
weiterverbreitest.
