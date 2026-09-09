#!/usr/bin/env python3
"""Holt die Funktionen, die den Cache-Schluessel bilden, aus cache.go und
piper.go heraus - verbatim, damit die Referenz nicht abdriften kann.

Nur diese wenigen sind es wert, mechanisch gegengeprueft zu werden: stimmt der
Schluessel nicht, faellt der gesamte vorhandene Zwischenspeicher aus.
"""
import re, sys

WANT = {
    "cache.go": ["renderVersion", "Key", "orOne"],
    "piper.go": ["Request", "NormalizeText", "formatFloat"],
}

def blocks(src, names):
    lines = src.split("\n")
    out, i = [], 0
    while i < len(lines):
        m = re.match(r"^(?:func|type|const) (?:\([^)]*\) )?(\w+)", lines[i])
        if m and m.group(1) in names:
            start = i
            # Kommentarkopf mitnehmen.
            j = start - 1
            while j >= 0 and (lines[j].startswith("//")):
                j -= 1
            head = lines[j + 1:start]
            if lines[i].rstrip().endswith(("{", "(")):
                depth = 0
                while i < len(lines):
                    depth += lines[i].count("{") + lines[i].count("(") \
                           - lines[i].count("}") - lines[i].count(")")
                    i += 1
                    if depth <= 0:
                        break
            else:
                i += 1
            out.append("\n".join(head + lines[start:i]))
            continue
        i += 1
    return out

parts = ["package main", "", 'import (', '\t"crypto/sha256"', '\t"encoding/hex"',
         '\t"fmt"', '\t"strconv"', '\t"strings"', ')', ""]
for path, names in WANT.items():
    src = open(sys.argv[1] + "/" + path, encoding="utf-8").read()
    found = blocks(src, names)
    got = [re.match(r"^(?:func|type|const) (?:\([^)]*\) )?(\w+)", b.split("\n")[-1] if b.split("\n")[-1].startswith(("func","type","const")) else [l for l in b.split("\n") if l.startswith(("func","type","const"))][0]).group(1) for b in found]
    missing = set(names) - set(got)
    if missing:
        raise SystemExit(f"nicht gefunden in {path}: {sorted(missing)}")
    parts.extend(found + [""])

open(sys.argv[2], "w", encoding="utf-8").write("\n".join(parts))
print("uebernommen:", ", ".join(n for ns in WANT.values() for n in ns))
