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
- Regieanweisungen als eigener Blocktyp (eigene Stimme, eigenes Tempo)
- Vorlese-Reihenfolge per Drag & Drop änderbar – wichtig bei mehrspaltigem
  Layout
- Pro Sprecher: Stimm-Modell, Sprecher-ID (bei Multi-Speaker-Modellen), Tempo,
  Lautstärke, Farbe, Hörprobe
- Eigene Rolle markieren und beim Erzeugen als 2,5-Sekunden-Pause aussparen
- Ausgabe als MP3 (wenn ffmpeg vorhanden) oder WAV

## Voraussetzungen

| Werkzeug | Version | Zweck |
|---|---|---|
| [Go](https://go.dev/dl/) | 1.22 oder neuer | Backend |
| [Node.js](https://nodejs.org/) | 20 oder neuer (empfohlen 22) | Frontend |
| [Piper](https://github.com/OHF-Voice/piper1-gpl) | aktuell | Sprachsynthese |
| ffmpeg | optional | MP3-Export (ohne ffmpeg wird WAV ausgeliefert) |

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

Für ein Stück mit mehreren Rollen lohnen sich mehrere Stimmen, z. B.
`de_DE-thorsten-medium`, `de_DE-karlsson-low`, `de_DE-eva_k-x_low`,
`de_DE-ramona-low`. Es gehen auch Multi-Speaker-Modelle wie
`de_DE-thorsten_emotional-medium` – dort wählst du pro Rolle zusätzlich eine
Sprecher-ID.

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
3. **Sprecher** – jeder Rolle ein Stimm-Modell zuweisen, Tempo und Lautstärke
   einstellen, mit dem Play-Knopf eine Hörprobe abspielen und die eigene Rolle
   markieren.
4. **Hörfassung** – Schalter für „eigene Rolle aussparen“ und
   „Regieanweisungen mitlesen“ setzen, „Audio erzeugen“ drücken, danach direkt
   im Browser anhören oder herunterladen.

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
| `THEATER_SKIP_PAUSE_MS` | `2500` | Pause statt der eigenen Rolle |

## Datenablage

```
data/projects/<projekt-id>/
  project.json    # Name, PDF, Seitenzahl, eigene Rolle
  blocks.json     # markierte Blöcke mit relativen Koordinaten und Text
  speakers.json   # Stimme, Tempo, Lautstärke und Farbe je Sprecher
  source.pdf      # das importierte Stück
  audio/          # erzeugte Hörfassungen
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
  internal/httpapi/   # HTTP-Router und Handler
frontend/
  src/api/            # typisierter API-Client
  src/components/     # PdfCanvasEditor, BlockList, SpeakerConfig, SynthesizePanel
  src/lib/            # Textextraktion aus dem PDF, Block-Hilfsfunktionen
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
| `GET` | `/api/projects/{id}/pdf` | Original-PDF ausliefern |
| `GET`/`PUT` | `/api/projects/{id}/blocks` | Blöcke laden/ersetzen |
| `GET`/`PUT` | `/api/projects/{id}/speakers` | Sprecher-Konfiguration |
| `GET` | `/api/voices` | installierte Piper-Modelle |
| `POST` | `/api/voices/preview` | Hörprobe synthetisieren (WAV) |
| `POST` | `/api/projects/{id}/synthesize` | Job starten, liefert `jobId` |
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

**Beim Rechteckziehen kommt kein Text** – das PDF ist vermutlich ein Scan ohne
Textebene. Der Text lässt sich im Dialog trotzdem von Hand eintippen; für
größere Stücke hilft vorher eine OCR-Behandlung (z. B. `ocrmypdf`).

**Die Reihenfolge stimmt nicht** – bei zweispaltigem Satz ist „oben nach unten“
nicht die Lesereihenfolge. Blöcke in der rechten Liste per Drag & Drop
sortieren; die Nummer am Rahmen zeigt die Vorlese-Position.

## Tests

Backend bauen und prüfen:

```bash
cd backend && go vet ./... && go build ./...
```

Frontend typprüfen und bauen:

```bash
cd frontend && npm run build
```

Optionaler Durchklick-Test im Browser (Backend muss laufen, Frontend gebaut
sein):

```bash
cd frontend && npm install -D playwright && node e2e-smoke.mjs
```

## Lizenz

Der Code steht unter der MIT-Lizenz. Piper und die Stimm-Modelle haben eigene
Lizenzen – bitte dort nachsehen, bevor du erzeugte Audiodateien
weiterverbreitest.
