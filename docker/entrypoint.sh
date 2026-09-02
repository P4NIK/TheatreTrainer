#!/bin/sh
# Startet den Server – und lädt vorher auf Wunsch fehlende Stimmen nach.
#
# Die Stimm-Modelle liegen bewusst nicht im Image: sie sind mehrere hundert MB
# groß und haben eigene Lizenzen. Ohne Stimme startet die App trotzdem, man
# kann nur nichts erzeugen – deshalb wird hier höchstens nachgeholfen, nie
# abgebrochen.
set -eu

VOICES_DIR="${THEATER_VOICES_DIR:-/app/voices}"
DATA_DIR="${THEATER_DATA_DIR:-/app/data}"

for dir in "$VOICES_DIR" "$DATA_DIR"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir" 2>/dev/null || true
    fi
    if [ ! -w "$dir" ]; then
        echo "Achtung: $dir ist nicht beschreibbar." >&2
        echo "         Der Ordner auf dem Host gehört einem anderen Benutzer." >&2
        echo "         Entweder PUID/PGID in der .env passend setzen oder" >&2
        echo "         'chown -R \$(id -u):\$(id -g) data voices' ausführen." >&2
    fi
done

# THEATER_VOICES="de_DE-thorsten-medium de_DE-kerstin-low" lädt beim ersten
# Start, was noch fehlt. Leer lassen, wenn die Modelle von Hand kommen.
for voice in ${THEATER_VOICES:-}; do
    if [ -f "$VOICES_DIR/$voice.onnx" ]; then
        continue
    fi
    echo "Stimme $voice wird geladen …"
    if ! out=$(python -m piper.download_voices "$voice" --data-dir "$VOICES_DIR" 2>&1); then
        echo "Achtung: $voice konnte nicht geladen werden. Die App startet trotzdem." >&2
        # Nur die letzte Zeile: der Rückverfolgungsstapel von Python sagt in
        # der Regel genau eine nützliche Sache, und die steht unten.
        echo "         $(printf '%s' "$out" | tail -n 1)" >&2
    fi
done

exec "$@"
