#!/usr/bin/env python3
"""Winziger statischer Server fuer die Spikes.

Zwei Dinge kann `python -m http.server` nicht, die hier gebraucht werden:

1. COOP/COEP-Header. Ohne Cross-Origin-Isolation gibt es keinen
   SharedArrayBuffer und damit kein multithreaded WASM - onnxruntime-web
   faellt dann still auf einen Thread zurueck. Genau der Unterschied soll
   hier ja gemessen werden.
2. Eine Liste der vorhandenen Stimmen samt num_speakers, damit die Seite
   nichts hartkodieren muss.

Ausgeliefert wird der Repo-Stamm, damit /voices/... direkt erreichbar ist.

    python spike-wasm/serve.py            # http://localhost:8081/spike-wasm/
    python spike-wasm/serve.py --port 9000 --no-coi
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICES_DIR = os.environ.get("THEATER_VOICES_DIR") or os.path.join(ROOT, "voices")

# Ablage fuer den Speicher-Spike: bewusst im Temp-Verzeichnis und nicht im
# Repo, damit ein Messlauf nichts hinterlaesst, was jemand aufraeumen muss.
BLOB_DIR = os.path.join(tempfile.gettempdir(), "theater-spike-blobs")

EXTRA_TYPES = {
    ".wasm": "application/wasm",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".data": "application/octet-stream",
    ".onnx": "application/octet-stream",
    ".json": "application/json",
}


class Handler(SimpleHTTPRequestHandler):
    coi = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        if self.coi:
            # Cross-Origin-Isolation: Voraussetzung fuer SharedArrayBuffer
            # und damit fuer WASM-Threads.
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        return super().guess_type(path)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/spike-api/voices":
            return self.send_voices()
        if path.startswith("/spike-api/blobs/"):
            return self.send_blob(path)
        return super().do_GET()

    # --- Ablage fuer den Speicher-Spike ------------------------------------
    #
    # Steht hier nur, um die Kosten eines Round-Trips zu messen. Ein echtes
    # Backend waere Go statt Python; die Zahlen taugen also als Groessen-
    # ordnung, nicht als fairer Wettlauf.

    def blob_path(self, path):
        name = os.path.basename(path)
        if not name or name != os.path.basename(name) or name.startswith("."):
            return None
        return os.path.join(BLOB_DIR, name)

    def do_PUT(self):
        if not self.path.startswith("/spike-api/blobs/"):
            return self.send_error(404)
        target = self.blob_path(self.path)
        if target is None:
            return self.send_error(400)
        os.makedirs(BLOB_DIR, exist_ok=True)
        length = int(self.headers.get("Content-Length") or 0)
        with open(target, "wb") as fh:
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(1 << 16, remaining))
                if not chunk:
                    break
                fh.write(chunk)
                remaining -= len(chunk)
        return self.send_json({"ok": True, "bytes": length}, close=True)

    def do_DELETE(self):
        if self.path.split("?")[0] == "/spike-api/blobs":
            shutil.rmtree(BLOB_DIR, ignore_errors=True)
            return self.send_json({"ok": True, "cleared": True}, close=True)
        if not self.path.startswith("/spike-api/blobs/"):
            return self.send_error(404)
        target = self.blob_path(self.path)
        if target and os.path.exists(target):
            os.remove(target)
        return self.send_json({"ok": True}, close=True)

    def send_blob(self, path):
        target = self.blob_path(path)
        if target is None or not os.path.exists(target):
            return self.send_error(404)
        with open(target, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.close_connection = True
        self.end_headers()
        self.wfile.write(body)

    def send_voices(self):
        out = []
        try:
            names = sorted(os.listdir(VOICES_DIR))
        except OSError as exc:
            return self.send_json({"error": str(exc), "dir": VOICES_DIR}, status=500)

        for name in names:
            if not name.endswith(".onnx"):
                continue
            cfg_path = os.path.join(VOICES_DIR, name + ".json")
            if not os.path.exists(cfg_path):
                continue
            try:
                with open(cfg_path, encoding="utf-8") as fh:
                    cfg = json.load(fh)
            except (OSError, ValueError):
                continue
            out.append({
                "id": name[:-5],
                "onnx": "/voices/" + name,
                "config": "/voices/" + name + ".json",
                "bytes": os.path.getsize(os.path.join(VOICES_DIR, name)),
                "numSpeakers": int(cfg.get("num_speakers") or 1),
                "sampleRate": int(cfg.get("audio", {}).get("sample_rate") or 22050),
                "espeakVoice": (cfg.get("espeak") or {}).get("voice", "de"),
            })
        return self.send_json({"voices": out, "dir": VOICES_DIR})

    def send_json(self, payload, status=200, close=False):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if close:
            # Die Ablage laeuft ohne Keep-alive. Bei den grossen vendor-Dateien
            # spart es Verbindungen, hier bringt es nichts und hat sich als
            # Fehlerquelle gezeigt - ein haengender PUT sieht im Browser aus
            # wie "Failed to fetch" und sagt nichts.
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Die grossen Dateien fluten sonst die Konsole.
        if "/vendor/" in self.path or "/voices/" in self.path or "/spike-api/blobs" in self.path:
            return
        super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8081)
    ap.add_argument("--no-coi", action="store_true",
                    help="ohne COOP/COEP starten - zum Vergleich single-threaded")
    args = ap.parse_args()

    Handler.coi = not args.no_coi
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    mode = "mit COOP/COEP (Threads moeglich)" if Handler.coi else "OHNE COOP/COEP (nur 1 Thread)"
    print(f"Wurzel:  {ROOT}")
    print(f"Stimmen: {VOICES_DIR}")
    print(f"Modus:   {mode}")
    print(f"Piper:   http://localhost:{args.port}/spike-wasm/")
    print(f"Whisper: http://localhost:{args.port}/spike-whisper/")
    print(f"Speicher:http://localhost:{args.port}/spike-storage/   (Ablage: {BLOB_DIR})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nEnde.")
        sys.exit(0)


if __name__ == "__main__":
    main()
