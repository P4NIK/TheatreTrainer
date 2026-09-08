# Speicher-Spike

Dritter Wegwerf-Prototyp, nach `../spike-wasm/` (Piper) und `../spike-whisper/`.
Er beantwortet die letzte offene Frage der Migration:

**Gehört der Block-Zwischenspeicher in den Browser (OPFS) oder ans Backend?**

## Warum der Vergleich schief ist – und sein soll

Ein fairer Wettlauf wäre die falsche Messung. Das Backend hat eine Festplatte;
dort ist Kapazität keine Frage, sondern gegeben, und 250 MB je Stück sind
niemandem ein Problem. Zu klären ist deshalb nur, ob **OPFS reicht**:

1. **schnell genug** für 1400 Blöcke,
2. **groß genug** für ein halbes Jahr Proben,
3. **verlässlich genug**, dass nichts still verschwindet.

Fällt eine dieser drei Antworten aus, gewinnt das Backend kampflos. Fallen alle
drei gut aus, gewinnt OPFS über die Einfachheit: kein Upload von 250 MB durch
localhost, kein neuer Endpunkt, und der Weg zur backendlosen App bleibt offen.

Der HTTP-Abschnitt liefert dazu nur eine Größenordnung. Der Messserver ist
`serve.py`, also Python; das echte Backend wäre Go und schneller. Gemessen wird
die Größenordnung des Round-Trips, nicht die Festplatte.

## Starten

```bash
python spike-wasm/serve.py
# http://localhost:8081/spike-storage/
```

Der Server hat dafür einen kleinen Ablage-Endpunkt bekommen
(`PUT`/`GET`/`DELETE` auf `/spike-api/blobs/…`). Er schreibt ins
Temp-Verzeichnis, nicht ins Repo, und räumt am Ende jedes Laufs auf.

Drei Messungen, in dieser Reihenfolge:

1. **Durchsatz** – schreiben, zurücklesen, auf Unversehrtheit prüfen, aufräumen.
2. **Belastungstest** – in Schüben weiterschreiben, bis das Ziel steht oder der
   Browser abbricht. Daran hängt die Entscheidung.
3. **Zum Vergleich: über den Server** – dieselben Blöcke per HTTP.

Vorher lohnt **Dauerhafte Speicherung anfordern**: ohne `persist()` darf der
Browser den Zwischenspeicher bei Platznot wegräumen.

## Was gemessen wird

Ein Block der App ist rund 180 kB – gut vier Sekunden bei 22,05 kHz, 16 Bit,
mono. Ein abendfüllendes Stück sind ~1400 davon, also ~250 MB. Die Nutzdaten
sind Pseudozufallsbytes, damit keine Kompression die Zahlen schönt.

Zwei OPFS-Wege stehen nebeneinander: `createSyncAccessHandle` im Worker (der
schnelle Weg, den es nur dort gibt) und `createWritable` im Hauptthread (der
einzige, den es dort gibt).

Die Rücklesekontrolle ist eine Stichprobe: Größe plus erstes, mittleres und
letztes Byte. Kein Beweis, aber genug, um einen stillen Datenverlust zu
bemerken – und der wäre schlimmer als gar kein Zwischenspeicher.

## Ergebnis (Arbeitsrechner, Chrome)

Ein voller Satz: 1400 Blöcke, also genau ein abendfüllendes Stück.

```
Schreiben   246,1 MB in 4,91 s  =  50 MB/s,  3,5 ms je Block (Median, 6,1 ms schlimmster)
Lesen       246,1 MB in 2,39 s  = 103 MB/s,  0 beschädigt
Aufräumen   1400 Dateien: 83 ms auflisten, 659 ms löschen
Hauptthread 2,3 ms je Block – schneller als der Worker
Füllen      4007,8 MB in 79,7 s, Ziel erreicht
```

**OPFS ist schnell genug, und zwar mit weitem Abstand.** Der Zwischenspeicher
eines ganzen Stücks ist in **4,9 s** geschrieben – neben den ~3,5 min Synthese
sind das zwei Prozent. Zurückgelesen wird mit 103 MB/s, kein Block beschädigt.

### Das gemeldete Kontingent bindet nicht

Die auffälligste Zahl steht im Belastungstest:

> 4007,8 MB geschrieben, Browser meldet **5114,0 MB belegt von 2048,0 MB**

Chrome nennt 2 GB Kontingent und nimmt trotzdem 4 GB an. `estimate().quota` ist
ein **Hinweis, keine Grenze** – die Anzeige „reicht für n Stück" ist damit
wertlos, in beide Richtungen. Gut ist: der praktische Deckel liegt weit über
dem, was die App braucht (16 Stücke am Stück, ohne Murren). Unangenehm ist:
man kann nicht vorhersagen, wann er doch greift.

Nebenbei erklärt die Zahl sich selbst: alle drei Spikes liegen auf derselben
Herkunft `localhost:8081`, das Belegte enthält also auch die Whisper-Modelle im
Browser-Cache (~880 MB). Ein Kontingent gilt pro Herkunft, nicht pro Seite.

### Eine Erwartung, die sich zweimal nicht bestätigt hat

`createWritable` im Hauptthread war **schneller** als `createSyncAccessHandle`
im Worker: 2,3 gegen 3,5 ms je Block. Im Container war es Gleichstand, hier
liegt der einfache Weg vorn. Die verbreitete Regel „sync access handles sind
der einzig gangbare Weg" gilt für viele kleine Schreibvorgänge, nicht für
180-kB-Blöcke am Stück. **Der Worker ist damit keine Pflicht** – eine Sorge
weniger für den Umbau.

### Was der HTTP-Vergleich sagt

Im Container: 22–25 ms je Block hoch, gegen 3,5 ms in OPFS. Auf dem
Arbeitsrechner brach der Lauf mit „Failed to fetch" ab, ohne dass sich das hier
reproduzieren ließ (50 Blöcke laufen sauber durch). Die Ablage antwortet
seither ohne Keep-alive, und die Fehlermeldung nennt jetzt Blocknummer und
Serverantwort statt nur „Failed to fetch". Für die Entscheidung ist das
folgenlos: der Abstand von Faktor sechs steht nicht in Frage.

## Was daraus folgt

Der Zwischenspeicher gehört **in den Browser**, die Projektdaten bleiben im
Backend. Der Schnitt läuft entlang der Frage, was verloren gehen darf:

- **Der Block-Cache ist abgeleitet.** Geht er verloren, kostet das 3,5 Minuten
  Rechenzeit. Genau dafür ist OPFS gemacht, und 250 MB durch localhost zu
  schieben, nur um sie später wieder abzuholen, wäre Arbeit ohne Gegenwert.
- **PDF, Blöcke, Sprecher, Karteikarten und fertige Hörfassungen sind es
  nicht.** Die gehören auf eine Platte, die der Nutzer sichern kann und die
  kein Browser räumt.

Damit ist auch die Kontingent-Unsicherheit entschärft: Was der Browser im
schlimmsten Fall wegräumt, ist das, was sich nachrechnen lässt.

## Was der Spike nicht beantworten kann

- **Safari.** Kein Safari unter Windows. Dort gilt weiterhin: engeres
  Kontingent und Räumung nicht-persistierter Origins nach sieben Tagen. Für
  eine App, in der ein halbes Jahr lang geprobt wird, ist das der Punkt, an dem
  OPFS kippen kann – und der einzige, der sich hier nicht messen lässt.
- **Räumung überhaupt.** Ob der Browser bei echter Platznot wirklich
  aufräumt, zeigt kein einzelner Lauf. `persist()` ist die Gegenmaßnahme, und
  ob es gewährt wird, sagt die Umgebungsanzeige.
- **Das Kontingent unter Druck.** Chrome meldet es dynamisch nach freiem
  Plattenplatz; im Container wuchs es während des Laufs. Die Zahl ist eine
  Momentaufnahme, keine Zusage.

## Dateien

```
index.html      Oberfläche
app.js          Messungen, Hochrechnung, HTTP-Vergleich
opfs-worker.js  der schnelle Weg über createSyncAccessHandle
```

Kein `vendor/`, keine Abhängigkeiten – der Spike braucht nichts als den Browser.
