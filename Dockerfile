# Theater-Vorleser als einzelnes Image.
#
# Nichts hiervon ändert etwas am klassischen Weg (`go run` + `npm run dev`) –
# es ist eine zweite Möglichkeit, dieselbe Anwendung zu starten, gedacht für
# einen Heimserver.
#
# Gebaut wird in drei Schritten, damit im fertigen Image weder Node noch die
# Go-Toolchain landen: Frontend bauen, Backend bauen, beides in ein schlankes
# Python-Image legen – Python, weil Piper dort als Modul lebt.

# --- 1. Frontend ------------------------------------------------------------
# Bewusst das glibc-Image und nicht Alpine: Vite/Rolldown und oxlint bringen
# vorkompilierte Binärdateien je Plattform mit, und die gnu-Varianten sind die,
# die überall funktionieren.
FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend

# Erst die Manifeste kopieren: solange sie sich nicht ändern, bleibt die
# Installationsschicht im Cache und ein Rebuild dauert Sekunden statt Minuten.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- 2. Backend -------------------------------------------------------------
# go.mod verlangt Go 1.24.7 oder neuer.
FROM golang:1.24-alpine AS backend
WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
# Statisch gelinkt, damit das Binary im Python-Image ohne weitere Bibliotheken
# läuft. Der Server nutzt kein cgo.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/theater-tts ./cmd/server

# --- 3. Laufzeit ------------------------------------------------------------
FROM python:3.12-slim AS runtime

# 1 baut die Spracherkennung für den Lernmodus mit ein. Das zieht PyTorch nach
# und macht das Image um mehrere Gigabyte größer, deshalb standardmäßig aus.
ARG INCLUDE_WHISPER=0

# ffmpeg: MP3-Export der Hörfassung und Dekodieren der Mitschnitte.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Das piper-Rad bringt espeak-ng samt Sprachdaten mit; es braucht hier nichts
# weiter aus der Distribution.
RUN pip install --no-cache-dir piper-tts \
 && if [ "$INCLUDE_WHISPER" = "1" ]; then pip install --no-cache-dir openai-whisper; fi

# Läuft nicht als root: die Daten liegen auf dem Host und sollen dort dem
# normalen Benutzer gehören. Die Nummern lassen sich in compose überschreiben.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=backend /out/theater-tts /usr/local/bin/theater-tts
# Das Backend sucht die gebaute Oberfläche unterhalb des Arbeitsverzeichnisses
# in frontend/dist – genau wie im Repository.
COPY --from=frontend /src/frontend/dist /app/frontend/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# chmod 0777 auf den Zwischenspeicher: er muss auch dann beschreibbar sein,
# wenn compose mit einer anderen Benutzernummer startet als der hier
# angelegten (PUID auf einem NAS ist selten 1000).
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/data /app/voices /app/cache \
 && chown -R app:app /app \
 && chmod 0777 /app/cache

# PIPER_BIN fest vorgeben: im Image gibt es genau einen Python, da muss nichts
# gesucht werden. XDG_CACHE_HOME zeigt auf das Volume, in dem Whisper sein
# Modell ablegt – nötig, weil HOME leer bleibt, sobald compose mit einer
# fremden Benutzernummer startet.
ENV THEATER_ADDR=":8080" \
    THEATER_DATA_DIR="/app/data" \
    THEATER_VOICES_DIR="/app/voices" \
    PIPER_BIN="python -m piper" \
    XDG_CACHE_HOME="/app/cache" \
    PYTHONUNBUFFERED=1

USER app
EXPOSE 8080
VOLUME ["/app/data", "/app/voices"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health').read()"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["theater-tts"]
