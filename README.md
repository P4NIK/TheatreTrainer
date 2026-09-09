# Theater-Vorleser

Eine Web-App zum Proben von Theaterstücken: PDF importieren, Sprecher-Blöcke
per Rechteck markieren, jeder Rolle eine Stimme zuweisen und daraus eine
durchgehende Hörfassung erzeugen – wahlweise mit der eigenen Rolle als
Sprechpause.

**Alles läuft im Browser.** Kein Server, kein Account, keine Installation.
Sprachsynthese und Spracherkennung rechnen auf deinem Rechner, deine Stücke
liegen in deinem Browser, und es wird nichts hochgeladen.

```
PDF  ──▶  Blöcke markieren  ──▶  Stimmen zuweisen  ──▶  WAV zum Üben
```

## Loslegen

Als Benutzer: die Seite aufrufen, „Neues Projekt“, PDF hochladen. Beim ersten
Vorlesen lädt der Browser einmal die Stimme (63 MB) und behält sie – danach
geht es auch ohne Netz.

Selbst hosten oder entwickeln:

```bash
cd frontend
npm install          # holt dabei auch die WASM-Dateien nach public/wasm/
npm run dev          # http://localhost:5173
npm run build        # fertige Seite in frontend/dist/
npm run preview      # dist/ ausliefern, so wie ein Hoster es täte
```

`dist/` ist eine statische Seite: hochladen reicht, egal wohin – GitHub Pages,
ein beliebiger Webspace, ein USB-Stick mit lokalem Server. Liegt sie nicht
unter der Wurzel einer Domain, sondern in einem Unterordner (auf GitHub Pages
der Normalfall), muss der Build das wissen:

```bash
npm run build -- --base=/name-des-repos/
```

Zwei Dinge braucht der Hoster: **HTTPS** (sonst gibt es kein Mikrofon und
keinen Service Worker) und die üblichen MIME-Typen für `.wasm` und
`.webmanifest`. Cross-Origin-Isolation (COOP/COEP) ist *nicht* nötig – die
Synthese läuft absichtlich einthreadig, weil ein zweiter Thread nichts bringt.

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
- Pro Sprecher: Tonhöhe, Tempo, Lautstärke, Farbe, Hörprobe – über die Tonhöhe
  lassen sich mehrere Rollen aus einer einzigen guten Stimme besetzen
- Eigene Rolle markieren und beim Erzeugen durch eine Pause **in Originallänge**
  ersetzen – der Einsatz kommt dadurch zeitlich richtig
- Nur einen Ausschnitt erzeugen: ein Seitenbereich (z. B. Akt 1), alle Stellen,
  an denen die eigene Rolle auf der Bühne steht – samt Stichwort davor – oder
  eine von Hand angehakte Auswahl einzelner Blöcke
- **Lernmodus**: interaktiv proben – alles wird vorgelesen, bei der eigenen
  Rolle hält der Durchlauf an, danach kommt die Auflösung. Optional mit
  Mitschnitt und Wort-für-Wort-Vergleich per Spracherkennung im Browser
- Der Lernmodus merkt sich, wo du aufgehört hast, und bietet beim nächsten Mal
  Weitermachen oder Von-vorne an; mit „Ab Seite“ steigst du an jeder Stelle ein
- **Karteikarten**: Jede Replik deiner Rolle ist eine Karte mit Stichwort. Nach
  jeder sagst *du*, ob sie saß – was sitzt, kommt seltener, was danebengeht,
  noch in derselben Sitzung wieder. Die Abstände springen nie über die Premiere
- Jeder Block wird einzeln zwischengespeichert: Nach einer Textänderung wird
  nur dieser eine Block neu erzeugt, und einzelne Repliken lassen sich direkt
  in der Blockliste anhören
- Nach dem ersten Besuch offline benutzbar und auf Telefon oder Tablet als App
  ablegbar
- Sicherungskopie je Stück als eine Datei – Projekt, Blöcke, Sprecher,
  Lernstand und PDF

## Bedienung

1. **Projekt anlegen** – Name eingeben, PDF hochladen.
2. **Editor** – mit der Maus ein Rechteck um eine Textzeile ziehen. Der Text
   erscheint im Dialog, Sprecher und Typ prüfen, „Hinzufügen“.
   Über den Chip links oben an jedem Rahmen lässt sich ein Block auswählen; in
   der rechten Liste bearbeitest, löschst und sortierst du sie.
   Gespeichert wird automatisch (ca. 1 s nach der letzten Änderung).
3. **Automatisch erkennen** – wenn ein paar Blöcke stehen, füllt der Knopf
   oben rechts den Rest des Stücks (siehe unten).
4. **Sprecher** – jeder Rolle eine Stimme zuweisen, Tonhöhe, Tempo und
   Lautstärke einstellen, mit dem Play-Knopf eine Hörprobe abspielen und die
   eigene Rolle markieren.
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

### Die eigene Rolle als Pause

Ist „eigene Rolle aussparen“ aktiv, wird deine Rolle trotzdem synthetisiert –
nur landet statt des Tons eine **gleich lange Stille** in der Datei. Das ist
der Punkt: Die Aufnahme läuft im Takt des Stücks weiter, dein Einsatz kommt an
der richtigen Stelle und ist so lang, wie er sein muss.

Weil das Audio dabei im Zwischenspeicher landet, kostet das Umschalten zwischen
„mit meiner Rolle“ und „ohne“ danach nichts mehr. Hat deine Rolle keine Stimme
zugewiesen, ist die Länge unbekannt; dann gibt es eine feste Pause von 2,5 s.

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
(`<projekt>-seiten-12-18.wav`, `<projekt>-auftritte.wav`,
`<projekt>-auswahl.wav`), damit mehrere Fassungen nebeneinander liegen können.

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
| **Gesagtes auswerten** | verwandelt den Mitschnitt im Browser in Text und vergleicht Wort für Wort (siehe unten) |

Im Durchlauf: <kbd>Leertaste</kbd> weiter (beendet die Pause und löst auf),
<kbd>R</kbd> Replik wiederholen, <kbd>T</kbd> eigenen Text aufdecken,
<kbd>P</kbd> anhalten, <kbd>←</kbd>/<kbd>→</kbd> eine Replik zurück und vor.
Über der aktuellen Zeile stehen die beiden vorherigen – genug, um zu wissen,
wo man ist.

Ein Schritt zurück auf die eigene Replik heißt „noch einmal“: Mitschnitt und
Auswertung des vorigen Versuchs werden verworfen, sonst zeigte die Auflösung
weiterhin den ersten Anlauf.

**Die Aufnahme bleibt im Browser.** Sie wird nicht hochgeladen und nicht
gespeichert; mit dem Schließen des Durchlaufs ist sie weg. Der Browser fragt
beim ersten Mal nach dem Mikrofon; ohne Erlaubnis läuft die Probe trotzdem,
nur eben ohne Mitschnitt.

**Wartezeit beim ersten Mal.** Jede Replik wird beim ersten Abspielen einmal
erzeugt (ein bis zwei Sekunden) und liegt danach im selben Zwischenspeicher,
den auch die Hörfassung nutzt. Während eine Replik läuft, werden die nächsten
vier im Hintergrund geladen; „Vorbereiten“ erledigt vorab den ganzen
Ausschnitt, dann läuft der Durchlauf ohne Stocken.

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

Die Stelle steht in `project.json` neben dem Stück, nicht in einem eigenen
Browser-Winkel. Sie liegt damit in derselben Sicherungskopie wie das übrige
Projekt und wandert mit ihr auf ein anderes Gerät.

### Gesagtes auswerten

Ist der Schalter an, wird der Mitschnitt nach jeder Replik **im Browser** in
Text verwandelt und Wort für Wort mit dem Buch verglichen:

> 29er <span title="verstanden: Romane">Romanée</span> Conti. *(bitte)*
> — 83 % getroffen, 2 von 3 Wörtern wörtlich, 1 fast

Fünf Zustände, farbig: *sitzt*, *fast*, *anders gesagt*, *nicht gehört*,
*zusätzlich*. Darunter steht immer, was die Erkennung tatsächlich verstanden
hat – damit nachvollziehbar bleibt, wer sich verhört hat.

Erkannt wird mit **Whisper (`base`)**, das beim ersten Einschalten einmal
geladen wird (rund 200 MB) und danach im Browser bleibt. Eine Replik dauert
etwa eine Sekunde – und das reicht, weil die Erkennung läuft, während die
Auflösung abgespielt wird.

**Das ist eine Gedächtnisstütze, kein Urteil.** Für „fehlt mir die halbe
Replik?“ reicht die Erkennung locker. Ausgerechnet die Wörter, auf die es im
Theater ankommt, trifft sie aber am schlechtesten: Eigennamen, Dialekt, leises
oder gespieltes Sprechen, kurze Einwürfe. Gemessen an genau der Metrik dieser
App – „saß die Replik?“ – kommt `base` auf 77 %; das kleinere `tiny` fällt mit
65 % durch, das dreimal so große `small` bringt einen Punkt. Deshalb:

- Verglichen wird **unscharf**: normalisiert (Kleinschreibung, Satzzeichen und
  Akzente weg), dann per Levenshtein-Abstand und **Kölner Phonetik** – dem
  deutschen Gegenstück zu Soundex. „Romane Conti“ zählt damit als *fast*,
  „Meyer“ und „Mayr“ als dasselbe Wort. Kurze Wörter bekommen keine Toleranz,
  „der“ und „den“ bleiben verschieden. Zahlwörter werden ausgerechnet, damit
  „29er“ und „neunundzwanziger“ dasselbe sind.
- Der erwartete Satz geht **nicht** an die Erkennung. Whisper folgt einem
  vorgegebenen Text sehr willig; bekäme es die Replik vorgesagt, schriebe es
  sie auf, egal was gesagt wurde – ein Vergleich, der immer zustimmt, ist
  schlechter als keiner.
- Stimmt der Text im Block nicht, korrigierst du ihn direkt in der Auflösung
  („Text korrigieren“). Der Vergleich färbt sich sofort neu, ohne die
  Erkennung noch einmal zu bemühen.

## Karteikarten

Der Lernmodus geht das Stück der Reihe nach durch. Die Karteikarten gehen
danach, was noch nicht sitzt.

Jede Replik deiner Rolle ist eine Karte, und eine Karte läuft wie eine Replik im
Lernmodus: Du hörst das Stichwort, es wird still, du sprichst, dann kommt die
Auflösung. Nur endet sie mit drei Knöpfen.

| Knopf | Taste | Was passiert |
|---|---|---|
| **Daneben** | <kbd>1</kbd> | zurück ins erste Fach – und drei Karten später noch einmal |
| **Wackelig** | <kbd>2</kbd> | bleibt im Fach, kommt zehn Karten später noch einmal |
| **Saß** | <kbd>3</kbd> | ein Fach weiter, für heute erledigt |

**Entscheiden tust du, nicht die Spracherkennung.** Ist „Gesagtes auswerten“
eingeschaltet, wird einer der drei Knöpfe vorgewählt – mehr nicht. Whisper
verschluckt Endungen, erfindet Wörter und stolpert über Namen; ein Stapel, der
sich selbst bewertet, schöbe genau die Repliken nach hinten, an denen sich die
Erkennung verhört, statt der, an denen du hängst.

### Wann eine Replik wiederkommt

Sechs Leitner-Fächer mit festen Abständen:

| Fach | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Tage | 0 | 1 | 3 | 7 | 16 | 35 |

Das gilt auch für eine Wiederholung innerhalb derselben Sitzung: Wer eine Replik
erst im zweiten Anlauf hinbekommt, landet in Fach 2 statt dort, wo er vorher
stand – die ehrliche Lesart des Abends.

Fällig ist, was heute oder früher dran wäre, dazu alles noch nie Geübte. Die
Sitzung nimmt die schwächsten Karten zuerst: erst nach Fach, dann nach
Überfälligkeit, zuletzt nach Stückreihenfolge.

### Die zwei Uhren

Die Fächer sind die langsame Uhr, die Sitzung die schnelle. Eine
danebengegangene Replik kommt drei Karten später noch einmal, eine wackelige
zehn – so wird ein langer Abend von selbst zur Wiederholung, ohne dass die
Tagesabstände etwas davon mitbekommen müssten. Sofort danach wäre nur das Echo
geprüft; drei Karten weiter muss die Replik wiedergefunden werden.

Eine Karte, die immer wieder danebengeht, kommt immer wieder – dafür ist der
Modus da. Beendet wird die Sitzung mit „Beenden“, jederzeit.

### Premiere

Steht ein Termin im Feld **Premiere**, geht kein Abstand darüber hinaus: Der
Vortag ist der späteste Tag, an dem eine Replik wiederkommt. Neun Tage vor der
Premiere heißt Fach 6 also acht Tage statt fünfunddreißig, und am Premierentag
ist alles fällig. Ist der Termin vorbei, gelten wieder die vollen Abstände – das
Stück läuft ja.

### Einrichtung

| Einstellung | Wirkung |
|---|---|
| **Deine Rolle** | Aus ihren Repliken besteht der Stapel |
| **Welcher Teil** | dieselbe Auswahl wie sonst – „heute nur Akt 2“, ohne den Lernstand zu verlieren |
| **Nur Fälliges / Alles** | ob die ruhenden Karten mitkommen |
| **Höchstens** | Obergrenze für die Sitzung; leer heißt: alles Fällige |
| **Stichwort** | wie viele Repliken vor deiner vorgelesen werden; 0 lässt den Einsatz weg |
| **Regieanweisungen als Stichwort** | aus überspringt sie – der Einsatz ist dann die letzte gesprochene Replik |

Übersprungene Regieanweisungen werden dabei überstiegen, nicht abgezogen: Die
Suche läuft weiter rückwärts, bis die gewünschte Zahl an Stichworten zusammen
ist. Der Einsatz wird also nicht kürzer, nur gesprochen.

Dazu dieselben Hilfen wie im Lernmodus: Stichwort mitlesen, eigenen Text
aufdecken, mitschneiden, auswerten.

Der Balken über der Einrichtung zeigt, wie sich der Stapel auf die Fächer
verteilt – links, was noch nicht sitzt. „Lernstand zurücksetzen“ leert ihn
wieder; die Repliken bleiben selbstverständlich stehen.

## Was der Browser wann lädt

Nichts wird auf Verdacht geholt. Wer nur ein PDF öffnet und Blöcke markiert,
lädt die Anwendung und sonst nichts.

| Wann | Was | Größe |
|---|---|---|
| beim Aufrufen | die Anwendung selbst | ein paar hundert kB |
| beim ersten Vorlesen | onnxruntime + espeak-ng (nur Deutsch) | 12 MB |
| beim ersten Vorlesen | die Stimme *Thorsten* | 63 MB |
| beim ersten „Gesagtes auswerten“ | onnxruntime für Whisper | 23 MB |
| beim ersten „Gesagtes auswerten“ | das Modell `whisper-base` | ~200 MB |

Alles davon bleibt im Browser. Der zweite Besuch lädt nichts nach, und nach dem
ersten Besuch läuft die Seite auch ohne Netz.

Die Stimme kommt vom
[piper-voices-Repository](https://huggingface.co/rhasspy/piper-voices) auf
Hugging Face, das Whisper-Modell von
[onnx-community](https://huggingface.co/onnx-community/whisper-base). Beides
sind die einzigen fremden Adressen, die die Seite überhaupt anspricht.

## Wo die Stücke liegen

Im Browser, in dessen eigenem Dateisystem (OPFS) – ein Ordner je Stück, in
derselben Aufteilung, die früher auf der Festplatte lag:

```
projects/<projekt-id>/
  project.json    # Name, Seitenzahl, eigene Rolle, zuletzt geübte Stelle,
                  # Premierentermin
  blocks.json     # markierte Blöcke mit relativen Koordinaten und Text
  speakers.json   # Stimme, Tonhöhe, Tempo, Lautstärke und Farbe je Sprecher
  cards.json      # Karteikarten: Fach, fällig ab, Zähler – je geübter Replik
  source.pdf      # das importierte Stück
  cache/          # Audio je Block, benannt nach dem Hash seiner Einstellungen
```

Die Rechteck-Koordinaten sind relativ zur Seitengröße (0–1) gespeichert und
damit unabhängig von Zoomstufe und Auflösung.

**Mach Sicherungskopien.** Ein Browser, der seinen Speicher aufräumt, nimmt die
Stücke mit – und niemand außer dir hat eine Kopie. Der Knopf neben jedem Stück
schreibt eine Datei `<projekt>.theater.json` mit allem, was sich nicht
nachrechnen lässt: Projekt, Blöcke, Sprecher, Lernstand und das PDF. Der
Zwischenspeicher bleibt draußen, er ist in dreieinhalb Minuten wieder da.
Dieselbe Datei bringt ein Stück auf ein zweites Gerät; eingelesen wird sie
**neben** das vorhandene, nie darüber.

Beim ersten großen Download fragt die App den Browser, ob er diesen Speicher
verschonen möge (`navigator.storage.persist()`). Chrome gewährt das meist
stillschweigend, Safari ist strenger – verlassen sollte man sich darauf nicht,
und genau deshalb gibt es die Sicherungskopie.

## Projektstruktur

```
frontend/
  public/wasm/        # espeak-ng, onnxruntime – von npm run wasm gefüllt
  public/sw.js        # Service Worker: nach dem ersten Besuch offline
  src/components/     # PdfCanvasEditor, BlockList, SpeakerConfig,
                      # AutoDetect, SynthesizePanel, Rehearsal
  src/lib/            # Textextraktion, Blockerkennung, Auswahl, Probenablauf,
                      # Karteikarten (Leitner + Sitzungsqueue),
                      # Wortvergleich (Levenshtein + Kölner Phonetik),
                      # Synthese (piper, synth, audio, storage, store),
                      # Spracherkennung (stt)
  src/pages/          # Projektliste und Editor
spike-wasm/           # Wegwerf-Prototypen aus der Umstellung, mit Messwerten
spike-whisper/
spike-storage/
tools/                # Prüfstände, die Go und TypeScript gegeneinander fuhren
MIGRATION.md          # wie aus der Server-App eine Browser-App wurde
```

Die Spikes und `tools/` sind Zeitdokumente: Sie halten fest, was gemessen wurde
und warum es so gebaut ist. Die Prüfstände brauchen den Go-Quelltext, den es
nur noch in der Versionsgeschichte gibt.

## Fehlersuche

**Die erste Hörprobe dauert ewig** – beim allerersten Mal lädt der Browser die
Stimme (63 MB). Der Fortschritt steht über der Tabelle. Danach kommt sie aus
dem eigenen Speicher.

**„… gibt es nicht mehr – bitte neu wählen“** im Sprecher-Tab – das Stück steht
noch auf einer Stimme aus der Zeit, als die Modelle von Hand installiert
wurden. Einfach *Thorsten* wählen; mehrere Rollen unterscheidest du über
Tonhöhe und Tempo.

**Die Auswertung lädt und lädt** – das Whisper-Modell sind rund 200 MB. Bricht
der Download ab, sagt es der Satz unter dem Schalter; ein zweiter Klick nimmt
den Faden wieder auf.

**Kein Mikrofon** – der Browser gibt es nur über HTTPS frei (oder auf
`localhost`). Ohne Erlaubnis läuft die Probe weiter, nur ohne Mitschnitt.

**Beim Rechteckziehen kommt kein Text** – das PDF ist vermutlich ein Scan ohne
Textebene. Der Text lässt sich im Dialog trotzdem von Hand eintippen; für
größere Stücke hilft vorher eine OCR-Behandlung (z. B. `ocrmypdf`).

**Die Reihenfolge stimmt nicht** – bei zweispaltigem Satz ist „oben nach unten“
nicht die Lesereihenfolge. Blöcke in der rechten Liste per Drag & Drop
sortieren; die Nummer am Rahmen zeigt die Vorlese-Position.

**Ein Stück ist verschwunden** – hat der Browser aufgeräumt (Verlauf gelöscht,
„Website-Daten entfernen“, privates Fenster), sind die Stücke weg. Dann hilft
nur die Sicherungskopie. Deshalb: siehe oben.

## Tests

```bash
cd frontend
npm test             # Vitest
npm run build        # Typprüfung und Build
npm run lint
```

`npm test` prüft die automatische Blockerkennung – Sprechernamen, die als zwei
Textstücke gesetzt sind, das Auftrennen eingeklammerter Einschübe,
Regieanweisungen, die mit einem Rollennamen beginnen, Repliken über
Seitengrenzen, Seitenzahlen –, die Auswahl eines Ausschnitts – Seitenbereiche,
Vor- und Nachlauf um die eigene Rolle, das Zusammenfassen naher Auftritte, die
Einzelauswahl und die Sprungmarken –, den Ablauf des Lernmodus, den
Wortvergleich (Kölner Phonetik gegen die dokumentierten Beispiele, Levenshtein,
Zahlwörter), die Audio-Bausteine (Resampling, Zeitdehnung, Tonhöhe), die
Planung eines Durchlaufs samt Zwischenspeicher und die Ablage der Stücke.

Die Bausteine, die aus dem früheren Go-Backend portiert wurden, sind gegen ihr
Vorbild geprüft worden: `tools/audio-parity` fuhr beide Fassungen der
Audio-Kette über dieselben Eingaben (91 Fälle, 75 sample-genau, der Rest
≤ 1 LSB – die Differenz stammt aus `sin`/`cos` von Go gegen V8), und
`tools/cache-key-parity` verglich 1296 Zwischenspeicher-Schlüssel. Beide
laufen nur noch mit dem Go-Quelltext aus der Versionsgeschichte; was sie
gezeigt haben, steht in `MIGRATION.md`.

## Lizenz

**GPL-3.** Die Seite liefert espeak-ng als WASM mit – das ist der Teil, der aus
Text Phoneme macht –, und espeak-ng steht unter der GPL-3. Damit steht das
Ganze unter der GPL-3; der volle Text liegt in `LICENSE`.

Die Stimme *Thorsten* und das Whisper-Modell haben eigene Lizenzen und werden
nicht mitgeliefert, sondern beim ersten Gebrauch geladen – bitte dort
nachsehen, bevor du erzeugte Audiodateien weiterverbreitest.
