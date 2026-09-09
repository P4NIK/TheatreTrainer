/* ERZEUGT aus frontend/src/lib/compare.ts - nicht von Hand aendern.
 * Neu erzeugen:  npx esbuild frontend/src/lib/compare.ts --format=esm \
 *                  --target=es2022 --outfile=spike-whisper/compare.js
 * Der Spike misst damit genau die Metrik, die auch der Lernmodus benutzt.
 */
function normalizeWord(word) {
  return word.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function tokenize(text) {
  return text.split(/\s+/).map((raw) => ({ raw: raw.trim(), key: normalizeWord(raw) })).filter((t) => t.key !== "");
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}
function cologne(word) {
  const w = word.toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/[^a-z]/g, "");
  if (w === "") return "";
  const has = (set, ch) => ch !== "" && set.includes(ch);
  const codes = [];
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const next = w[i + 1] ?? "";
    const prev = w[i - 1] ?? "";
    switch (c) {
      case "a":
      case "e":
      case "i":
      case "j":
      case "o":
      case "u":
      case "y":
        codes.push("0");
        break;
      case "h":
        break;
      case "b":
        codes.push("1");
        break;
      case "p":
        codes.push(next === "h" ? "3" : "1");
        break;
      case "d":
      case "t":
        codes.push(has("csz", next) ? "8" : "2");
        break;
      case "f":
      case "v":
      case "w":
        codes.push("3");
        break;
      case "g":
      case "k":
      case "q":
        codes.push("4");
        break;
      case "c":
        if (i === 0) codes.push(has("ahklogqrux", next) ? "4" : "8");
        else if (has("sz", prev)) codes.push("8");
        else codes.push(has("ahkoqux", next) ? "4" : "8");
        break;
      case "x":
        if (has("ckq", prev)) codes.push("8");
        else codes.push("4", "8");
        break;
      case "l":
        codes.push("5");
        break;
      case "m":
      case "n":
        codes.push("6");
        break;
      case "r":
        codes.push("7");
        break;
      case "s":
      case "z":
        codes.push("8");
        break;
      default:
        break;
    }
  }
  const collapsed = codes.filter((code, i) => i === 0 || code !== codes[i - 1]);
  return collapsed.filter((code, i) => code !== "0" || i === 0).join("");
}
function related(a, b) {
  if (a === b) return true;
  const shortest = Math.min(a.length, b.length);
  const longest = Math.max(a.length, b.length);
  const limit = shortest <= 3 ? 0 : longest <= 6 ? 1 : 2;
  if (levenshtein(a, b) <= limit) return true;
  const ca = cologne(a);
  return shortest >= 4 && ca !== "" && ca === cologne(b);
}
const COST_EXACT = 0;
const COST_NEAR = 1;
const COST_DIFFERENT = 3;
const COST_GAP = 2;
function compareSpoken(expected, spoken) {
  const want = tokenize(expected);
  const got = tokenize(spoken);
  if (want.length === 0) {
    return {
      words: got.map((t) => ({ state: "extra", spoken: t.raw })),
      hits: 0,
      near: 0,
      expectedCount: 0,
      score: 0
    };
  }
  const n = want.length;
  const m = got.length;
  const cost = (i2, j2) => {
    if (want[i2].key === got[j2].key) return COST_EXACT;
    return related(want[i2].key, got[j2].key) ? COST_NEAR : COST_DIFFERENT;
  };
  const d = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i2 = 1; i2 <= n; i2++) d[i2][0] = i2 * COST_GAP;
  for (let j2 = 1; j2 <= m; j2++) d[0][j2] = j2 * COST_GAP;
  for (let i2 = 1; i2 <= n; i2++) {
    for (let j2 = 1; j2 <= m; j2++) {
      d[i2][j2] = Math.min(
        d[i2 - 1][j2 - 1] + cost(i2 - 1, j2 - 1),
        d[i2 - 1][j2] + COST_GAP,
        d[i2][j2 - 1] + COST_GAP
      );
    }
  }
  const words = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + cost(i - 1, j - 1)) {
      const c = cost(i - 1, j - 1);
      words.unshift({
        state: c === COST_EXACT ? "ok" : c === COST_NEAR ? "near" : "wrong",
        expected: want[i - 1].raw,
        spoken: got[j - 1].raw
      });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + COST_GAP) {
      words.unshift({ state: "missing", expected: want[i - 1].raw });
      i--;
    } else {
      words.unshift({ state: "extra", spoken: got[j - 1].raw });
      j--;
    }
  }
  const hits = words.filter((w) => w.state === "ok").length;
  const near = words.filter((w) => w.state === "near").length;
  return {
    words,
    hits,
    near,
    expectedCount: n,
    score: Math.min(1, (hits + near / 2) / n)
  };
}
export {
  cologne,
  compareSpoken,
  levenshtein,
  normalizeWord,
  related
};
