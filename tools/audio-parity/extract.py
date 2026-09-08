#!/usr/bin/env python3
"""Schneidet aus audio.go die reinen DSP-Funktionen heraus.

readWAVMono, writeWAV und encodeWAV haengen an github.com/go-audio; ohne
Netzzugang zum Modulproxy laesst sich das Paket nicht uebersetzen. Alles
andere in audio.go kommt mit der Standardbibliothek aus. Der Schnitt passiert
mechanisch, damit die Kopie nicht von Hand nachgezogen werden muss.
"""
import re, sys

SKIP = {"readWAVMono", "writeWAV", "encodeWAV"}

src = open(sys.argv[1], encoding="utf-8").read()
lines = src.split("\n")

out, i, dropped = [], 0, []
while i < len(lines):
    line = lines[i]
    m = re.match(r"^func (?:\([^)]*\) )?(\w+)\(", line)
    if m and m.group(1) in SKIP:
        # Den zugehoerigen Kommentarblock oberhalb mitnehmen.
        while out and (out[-1].startswith("//") or out[-1] == ""):
            out.pop()
        depth = 0
        while i < len(lines):
            depth += lines[i].count("{") - lines[i].count("}")
            i += 1
            if depth == 0:
                break
        dropped.append(m.group(1))
        continue
    out.append(line)
    i += 1

body = "\n".join(out)
body = body.replace("package synth", "package main", 1)
# Importblock auf das reduzieren, was uebrig bleibt.
body = re.sub(r"import \(.*?\)", 'import (\n\t"math"\n)', body, count=1, flags=re.S)
open(sys.argv[2], "w", encoding="utf-8").write(body)
print("entfernt:", ", ".join(dropped))
