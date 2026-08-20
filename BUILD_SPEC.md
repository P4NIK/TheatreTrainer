# Theater-Vorleser: Build-Spezifikation

Diese Datei ist als direkte Arbeitsanweisung für einen Coding-Agenten (Claude
Code) gedacht. Sie beschreibt Architektur, Datenmodell, API und eine
empfohlene Bau-Reihenfolge. Am Ende steht ein fertiger Copy-Paste-Prompt.

## 1. Ziel

Eine lokale Single-User-App, mit der man:
1. ein Theaterstück als PDF importiert,
2. auf jeder Seite per Rechteck-Auswahl Sprecher/Text-Blöcke markiert und die
   automatisch extrahierten Texte korrigiert,
3. jedem Sprecher eine Piper-TTS-Stimme zuweist,
4. daraus eine durchgehende Audiodatei zum Proben generiert (inkl. Option,
   die eigene Rolle als Sprechpause auszusparen).

Später soll das Repo auf GitHub öffentlich nutzbar sein → keine
Hardcoded-Pfade, saubere READMEs, Setup muss auf jedem Rechner mit Go + Node
+ installiertem Piper funktionieren.

## 2. Tech-Stack

| Bereich | Wahl | Begründung |
|---|---|---|
| Backend | Go (`net/http` + `chi` Router) | leichtgewichtig, keine Runtime-Abhängigkeiten, gute Prozess-Steuerung für Piper-CLI-Aufrufe |
| Frontend | React + TypeScript + Vite | Standard, schnelles DX |
| UI-Komponenten | Mantine | wie gewünscht |
| PDF-Rendering | `pdfjs-dist` (via `react-pdf`) | rendert Seiten auf Canvas UND liefert Text-Items mit Koordinaten → Text-Extraktion pro Rechteck ohne Backend-Aufwand |
| TTS | Piper (lokal installiertes CLI-Binary), via `os/exec` aus Go | vom Nutzer bereits erprobt, offline, kostenlos |
| Audio-Konkatenation | Go-nativ mit `go-audio/wav` (PCM-Ebene) | keine ffmpeg-Pflicht; ffmpeg optional nur für mp3-Export |
| Storage | lokale JSON-Dateien pro Projekt | wie gewünscht, kein DB-Server nötig |

## 3. Ordnerstruktur (Repo)

```
theater-tts-app/
  backend/
    cmd/server/main.go
    internal/
      project/        # CRUD für Projekte, JSON-Persistenz
      voices/         # Piper-Voice-Scanning & -Verwaltung
      synth/          # Piper-Exec-Wrapper + Audio-Konkatenation
      httpapi/         # HTTP-Handler/Router
    go.mod
  frontend/
    src/
      pages/
      components/
        PdfCanvasEditor/
        SpeakerConfig/
        BlockList/
      api/            # typisierter API-Client
      types/
    package.json
    vite.config.ts
  data/                # .gitignore! enthält Nutzerprojekte + PDFs
    projects/
  voices/              # .gitignore! enthält .onnx Piper-Modelle (groß, nicht ins Repo)
  README.md
  .gitignore
```

`data/` und `voices/` müssen in `.gitignore`, da PDFs urheberrechtlich
geschützt sein können und Voice-Modelle mehrere hundert MB groß sind.

## 4. Datenmodell (JSON pro Projekt)

`data/projects/<slug>/project.json`
```json
{
  "id": "hamlet-2026",
  "name": "Hamlet",
  "pdfFile": "source.pdf",
  "pageCount": 42,
  "createdAt": "2026-08-19T10:00:00Z",
  "myRole": "HAMLET"
}
```

`data/projects/<slug>/blocks.json`
```json
[
  {
    "id": "b1",
    "page": 3,
    "rect": { "x": 0.12, "y": 0.30, "w": 0.55, "h": 0.08 },
    "order": 1,
    "type": "line",
    "speaker": "SIR ROWLAND",
    "text": "(kostet) Ich würde sagen – also – mit Sicherheit – ja, das ist der 42er Dow's."
  },
  {
    "id": "b2",
    "page": 3,
    "rect": { "x": 0.10, "y": 0.40, "w": 0.50, "h": 0.05 },
    "order": 2,
    "type": "direction",
    "speaker": null,
    "text": "HUGO nimmt SIR ROWLAND das Glas ab."
  }
]
```
- `rect`-Koordinaten sind **relativ zur Seitengröße (0–1)**, nicht in Pixeln
  → unabhängig von Zoomstufe/Auflösung.
- `order` bestimmt die Vorlese-Reihenfolge und ist **frei per Drag&Drop
  änderbar** (wichtig bei mehrspaltigem Layout, wo "oben nach unten" nicht
  automatisch stimmt).
- Text in Klammern `(...)` wird im Frontend automatisch kursiv/farbig
  dargestellt (rein visuell, keine separate Datenstruktur nötig) und beim
  Synthetisieren optional mit eigener `length_scale`/`volume` behandelt,
  falls du das später willst.

`data/projects/<slug>/speakers.json`
```json
{
  "SIR ROWLAND": { "model": "de_DE-thorsten-medium", "speakerId": 0, "lengthScale": 1.0, "volume": 1.0, "color": "#4A90D9" },
  "HUGO": { "model": "de_DE-karlsson-low", "speakerId": 0, "lengthScale": 1.0, "volume": 1.0, "color": "#D9784A" },
  "_direction": { "model": "de_DE-thorsten-medium", "speakerId": 0, "lengthScale": 1.15, "volume": 0.7, "color": "#999999" }
}
```

## 5. Backend-API

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/projects` | Neues Projekt anlegen (PDF-Upload, multipart) |
| GET | `/api/projects` | Liste aller Projekte |
| GET | `/api/projects/{id}` | Projekt-Details |
| DELETE | `/api/projects/{id}` | Projekt löschen |
| GET | `/api/projects/{id}/pdf` | Original-PDF ausliefern (fürs Frontend-Rendering) |
| GET | `/api/projects/{id}/blocks` | Blöcke laden |
| PUT | `/api/projects/{id}/blocks` | Blöcke speichern (kompletter Ersatz, Frontend hält State) |
| GET | `/api/projects/{id}/speakers` | Sprecher-Konfiguration laden |
| PUT | `/api/projects/{id}/speakers` | Sprecher-Konfiguration speichern |
| GET | `/api/voices` | Verfügbare Piper-Modelle im `voices/`-Ordner auflisten |
| POST | `/api/voices/preview` | Kurzen Testsatz mit gegebener Voice-Config synthetisieren (Sample-Playback) |
| POST | `/api/projects/{id}/synthesize` | Job starten (Body: `{skipMyRole: bool, includeDirections: bool}`) → gibt `jobId` zurück |
| GET | `/api/projects/{id}/synthesize/{jobId}` | Job-Status pollen (`pending/running/done/error`, Fortschritt) |
| GET | `/api/projects/{id}/audio/{jobId}` | Fertige Audiodatei streamen/downloaden |

Synthese läuft asynchron (eigene Goroutine + In-Memory-Job-Map reicht für
Single-User-Betrieb, kein Redis/Queue nötig). Frontend pollt Status alle
~1s oder nutzt Server-Sent Events, falls das der Agent einfacher findet.

## 6. Frontend: Canvas-Editor (Kernstück)

1. `react-pdf` rendert die aktuelle Seite in ein `<canvas>`.
2. Ein transparentes Overlay-`<div>` (oder zweites Canvas) fängt
   Maus-Events ab: `mousedown` → Startpunkt, `mousemove` → Rechteck live
   zeichnen, `mouseup` → Rechteck fertig, Koordinaten in relative 0–1-Werte
   umrechnen.
3. Nach dem Zeichnen: über `pdf.js`' `getTextContent()` alle Text-Items der
   Seite abfragen, die innerhalb der Bounding-Box liegen, und deren Text
   als Vorschlag in ein neues Block-Formular einsetzen (Sprecher-Dropdown +
   Textarea, editierbar).
4. Farbcodierung analog zum Screenshot des Nutzers, aber pro **Typ**
   konfigurierbar statt hart codiert:
   - `type: "line"` → schwarzer Rahmen um den Block, Sprecher-Name als
     grauer Chip links oben im Block.
   - `type: "direction"` → blauer, kursiver Rahmen/Text, kein Sprecher-Chip.
5. Rechte Seitenleiste: Liste aller Blöcke der aktuellen Seite (+ Filter
   "alle Seiten"), sortierbar per Drag&Drop (bestimmt `order`), mit
   Inline-Edit für Text/Sprecher/Typ, Löschen-Button.
6. Speichern-Button → `PUT /blocks`. Auto-Save (debounced) ist ein
   sinnvoller Nice-to-have, aber kein Muss für v1.

## 7. Frontend: Sprecher-Konfiguration

- Tabelle: Sprechername | Voice-Modell (Dropdown aus `/api/voices`) |
  Speaker-ID (nur relevant bei Multi-Speaker-Modellen) | Geschwindigkeit
  (Slider `lengthScale`) | Lautstärke (Slider) | Testen-Button (ruft
  `/api/voices/preview`, spielt Sample über `<audio>` ab) | Farbe
  (für Canvas-Anzeige, optional).
- Checkbox "Das ist meine Rolle" pro Sprecher (setzt `myRole` im Projekt).
- Neue Sprecher werden automatisch vorgeschlagen, sobald im Editor ein
  neuer Name als Block-Sprecher eingetragen wird (kein manuelles Anlegen
  nötig).

## 8. Synthese-Pipeline (Go)

```
für jeden Block in blocks.json (sortiert nach order):
    Voice-Config = speakers.json[block.speaker] oder speakers.json["_direction"]
    wenn skipMyRole && block.speaker == project.myRole:
        Stille-Segment (2.5s) anhängen, weiter
    Piper per exec.Command aufrufen:
        piper -m <model>.onnx -c <model>.onnx.json -s <speakerId>
              --length-scale <x> --volume <y> -f <tmp>/line_N.wav
        (Text via stdin)
    WAV-Samples einlesen (go-audio/wav) und an Gesamt-Puffer anhängen
    kurze Pause (450ms Stille) anhängen
Gesamt-WAV schreiben, optional via ffmpeg-exec zu mp3 konvertieren
  (nur falls ffmpeg vorhanden ist – sonst wav als Fallback ausliefern)
Job-Status auf "done" setzen, Pfad zur Datei speichern
```

Piper-Modelle liegen unter `voices/<name>.onnx` +
`voices/<name>.onnx.json` (Nutzer lädt sie einmalig selbst herunter, siehe
README, z. B. via `python -m piper.download_voices` oder direktem
Hugging-Face-Download).

## 9. Empfohlene Bau-Reihenfolge

1. **Setup**: `go mod init`, Vite+React+TS+Mantine-Scaffold, Grundlegendes
   `.gitignore`, leeres README mit Platzhaltern.
2. **Backend Grundgerüst**: Projekt-CRUD (JSON-Persistenz), PDF-Upload +
   Auslieferung. Test: Projekt anlegen, PDF hochladen, wieder abrufen.
3. **Frontend PDF-Anzeige**: Projekt anlegen im UI, PDF-Seiten mit
   `react-pdf` durchblättern (noch ohne Editing).
4. **Canvas-Editor**: Rechteck zeichnen, Text-Extraktion aus PDF-Textlayer,
   Block-Formular, Speichern/Laden über die Blocks-API.
5. **Sprecher-Verwaltung**: Voices-Scan-Endpoint, Sprecher-Tabelle im
   Frontend, Preview-Synthese für einzelne Sätze.
6. **Synthese-Pipeline**: Piper-Exec-Wrapper, Audio-Konkatenation, Job-API.
7. **Player & Feintuning**: Ergebnis-Player im Frontend, `skipMyRole`- und
   `includeDirections`-Toggles, Fehleranzeige bei fehlenden Voice-Zuordnungen.
8. **Politur**: Farbcodierung/Styling wie im Screenshot verfeinern,
   Drag-Reorder der Blockliste, leere Zustände, README fürs Public-Repo
   fertigstellen (Setup-Anleitung inkl. Piper-Installation und
   Voice-Download für andere Nutzer).

Jede Phase sollte mit einem kurzen manuellen Durchklick-Test abgeschlossen
werden, bevor die nächste beginnt – bei einem Agenten-Build explizit als
Zwischenschritt einfordern, statt alles auf einmal generieren zu lassen.

## 10. Offene Punkte, die du im Verlauf noch entscheiden kannst

- Soll der Editor mehrere PDFs/Kapitel pro Projekt unterstützen oder ist
  ein PDF = ein Projekt genug? (Spec geht aktuell von 1:1 aus.)
- Sollen Blöcke automatisch anhand von Textmustern vorgeschlagen werden
  (wie der Python-Regex-Parser aus dem ersten Entwurf), bevor man von Hand
  Rechtecke zieht? Das wäre eine sinnvolle spätere Erweiterung (Phase 9),
  aber kein Blocker für v1 – manuelles Zeichnen deckt den Kernbedarf ab.

---

## 11. Copy-Paste-Prompt für den Claude Code Agenten

```
Baue eine lokale Single-User-Web-App "Theater-Vorleser" nach der
Spezifikation in BUILD_SPEC.md in diesem Repo. Halte dich exakt an:
Tech-Stack (Go-Backend mit chi-Router, React+TypeScript+Vite+Mantine
Frontend, pdfjs-dist für PDF-Rendering und Text-Extraktion, Piper-CLI via
os/exec für TTS, go-audio/wav für Audio-Konkatenation), Ordnerstruktur,
Datenmodell und API aus Abschnitt 3–8.

Arbeite die Bau-Reihenfolge aus Abschnitt 9 Phase für Phase ab. Nach jeder
Phase: kurz zusammenfassen was gebaut wurde und wie ich es manuell testen
kann, bevor du zur nächsten Phase übergehst.

Wichtig:
- Keine Hardcoded-Pfade (Home-Verzeichnis, Benutzernamen etc.) – alles über
  Config/relative Pfade, da das Repo öffentlich auf GitHub landen soll.
- data/ und voices/ gehören ins .gitignore.
- Schreibe ein README.md, das ein Fremder ohne Vorwissen befolgen kann:
  Go- und Node-Version, Piper-Installation, Voice-Download, npm/go
  Befehle zum Starten.
- Halte Backend und Frontend klar getrennt (kein gemischtes Monorepo-Tooling
  über das Nötigste hinaus).
```
