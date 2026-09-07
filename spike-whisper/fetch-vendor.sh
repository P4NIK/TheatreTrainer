#!/usr/bin/env sh
# Laedt die Abhaengigkeiten des Whisper-Spikes nach vendor/.
# Bewusst ueber npm pack statt CDN: Version festgenagelt, danach laeuft der
# Spike ohne Netz - bis auf das Modell selbst, das von huggingface.co kommt.
set -e
TJS=4.2.0
# Muss zu der Version passen, die @huggingface/transformers in package.json
# als Abhaengigkeit fuehrt - sonst passen Tensor-Klasse und wasm-Datei nicht
# zueinander.
ORT=1.26.0-dev.20260416-b7804b056c

DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DIR/vendor"

cd "$TMP"
npm pack "@huggingface/transformers@$TJS" "onnxruntime-web@$ORT" >/dev/null
for t in *.tgz; do mkdir -p "${t%.tgz}"; tar xzf "$t" -C "${t%.tgz}"; done

TJ=huggingface-transformers-$TJS/package/dist
OW=onnxruntime-web-$ORT/package/dist

cp "$TJ/transformers.web.min.js" "$DIR/vendor/"
cp "$OW/ort.webgpu.min.mjs"      "$DIR/vendor/"

# Alle WASM-Varianten, nicht nur die vermutete. Welche gebraucht wird, steht
# fest verdrahtet in ort.webgpu.min.mjs (derzeit .asyncify) und kann sich mit
# jeder ort-Version aendern. Faellt sie, meldet onnxruntime "no available
# backend found" - eine Fehlermeldung, die nach einem Modell-Problem aussieht
# und keines ist. Der Browser laedt ohnehin nur die eine, die er braucht.
cp "$OW"/ort-wasm-simd-threaded.* "$DIR/vendor/"

echo "vendor/ gefuellt:"
ls -la "$DIR/vendor"
