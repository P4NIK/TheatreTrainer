# cache-key-parity

Prüft, ob `frontend/src/lib/pipeline.ts` denselben Cache-Schlüssel bildet wie
`backend/internal/synth/cache.go`.

Das ist der eine Wert in der Portierung, bei dem ein Fehler wirklich weh tut:
weicht der Schlüssel ab, findet der Browser **keinen einzigen** der bereits
erzeugten Blöcke wieder. Ein abendfüllendes Stück sind rund 250 MB und eine
knappe Stunde Rechenzeit – lautlos weggeworfen, ohne dass etwas kaputt aussieht.

Deshalb wird genau hier mechanisch gegengeprüft und nicht auf Tests vertraut,
die dieselbe Annahme noch einmal aufschreiben.

## Laufen lassen

```bash
cd tools/cache-key-parity
python3 extract.py ../../backend/internal/synth key.go
go run . /tmp/keys.json
npx esbuild ../../frontend/src/lib/pipeline.ts --bundle --format=esm \
  --target=es2022 --outfile=pipeline.mjs
node check.mjs /tmp/keys.json
```

Endet mit `BESTANDEN` oder `DURCHGEFALLEN` und einem Rückgabewert.

`extract.py` holt `renderVersion`, `Key`, `orOne`, `Request`, `NormalizeText`
und `formatFloat` wörtlich aus `cache.go` und `piper.go`. Es wird nichts
abgeschrieben, was verrutschen könnte.

## Was verglichen wird

1296 Anfragen: acht Texte (mit führendem und mehrfachem Leerraum, Umlauten,
Zahlen, Emoji, Tabulator, leer), drei Modelle, drei Sprecher-IDs und 18
Tempowerte – darunter `0` und `-1` für den Standardfall, `1/3` und `0.1+0.2`
für die krummen Nachkommastellen und `1e21`, `1e-320` für die Ränder.

```
1296 Anfragen: 1296 Schluessel gleich, 0 verschieden
normalizeText: 1296 gleich, 0 verschieden
BESTANDEN
```

## Die eine Falle

`formatFloat` ist in Go `strconv.FormatFloat(f, 'f', -1, 64)`: die kürzeste
Dezimalzahl, die sich wieder einliest – und **nie** mit Exponent. JavaScript
gibt genau dieselben Ziffern, schreibt aber ab `1e21` und unterhalb `1e-7` mit
Exponent. `String(1e21)` ist `"1e+21"`, Go schreibt
`"1000000000000000000000"`.

Der erste Anlauf fing das mit `toFixed(20)` ab – was nicht hilft, weil
`toFixed` ab `1e21` selbst wieder auf Exponentialschreibweise umschaltet.
Jetzt wird der Exponent von Hand ausgeschrieben; die Ziffern stimmen ohnehin
schon, nur die Schreibweise nicht.

Erreichbar ist das über einen Tempo-Regler nicht. Über eine von Hand
verbogene `speakers.json` schon – und dann wäre der Zwischenspeicher still
hinüber.
