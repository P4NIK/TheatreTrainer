#!/usr/bin/env sh
# Laedt die WASM-Abhaengigkeiten des Spikes nach vendor/.
# Bewusst ueber npm pack statt CDN: so ist die Version festgenagelt und der
# Spike laeuft danach ohne Netz.
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DIR/vendor"

cd "$TMP"
npm pack @diffusionstudio/piper-wasm@1.0.0 onnxruntime-web@1.22.0 >/dev/null
for t in *.tgz; do mkdir -p "${t%.tgz}"; tar xzf "$t" -C "${t%.tgz}"; done

cp diffusionstudio-piper-wasm-1.0.0/package/build/piper_phonemize.js   "$DIR/vendor/"
cp diffusionstudio-piper-wasm-1.0.0/package/build/piper_phonemize.wasm "$DIR/vendor/"
cp diffusionstudio-piper-wasm-1.0.0/package/build/piper_phonemize.data "$DIR/vendor/"
# Nur das WASM-Bundle. Die jsep-Variante (WebGPU) waere 22 MB gross und
# scheitert bei Piper ohnehin an int64 - siehe README.
cp onnxruntime-web-1.22.0/package/dist/ort.wasm.min.js             "$DIR/vendor/"
cp onnxruntime-web-1.22.0/package/dist/ort-wasm-simd-threaded.mjs  "$DIR/vendor/"
cp onnxruntime-web-1.22.0/package/dist/ort-wasm-simd-threaded.wasm "$DIR/vendor/"

echo "vendor/ gefuellt:"
ls -la "$DIR/vendor"
