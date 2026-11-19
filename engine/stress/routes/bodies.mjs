// Valid bodies for the home's POST and DELETE routes, taken from the routes' own tests (PLAN-STRESS T4 (c)): every
// call in engine/home/server/test/*.test.mjs that names an /api/ path as a string and passes an object literal after
// it. The literal is evaluated in an empty context (no globals, 50 ms), so one that names a variable is skipped, never
// guessed. Then each route's candidates in the order the tests use them; the sweep keeps the first one the staged
// home answers 2xx, else the first one. OVERRIDES pins the bodies a route must only ever get (one that could start a
// program or bind a live port), and SKIP the routes the sweep never sends a body that passes the same-origin check.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// Routes whose handler would start something outside the stage's guard: never called with the owner's headers.
export const SKIP = Object.freeze({
  "POST /api/health/prove": "starts `engine prove` (a shell script, outside the guard)",
});

// Bodies a route may get, and nothing else: its handler would start a program on a fixed port when a field is true.
// `valid` replaces the tests' bodies; `fieldsOnly` replaces the values each field is swapped for in (c).
export const OVERRIDES = Object.freeze({
  // on: true starts the app on its manifest port (3171..3189, the live range).
  "POST /api/apps/:slug/switch": { valid: [{ on: false }], fieldsOnly: [null, 0, "", []] },
});

const OPTION_KEYS = new Set(["body", "headers", "method", "timeoutMs", "bare", "raw", "host", "origin"]);

// Bodies for routes no test posts a literal body to (read from each handler's own fields).
export const FALLBACK = Object.freeze({
  "POST /api/brain/files": { folder: "brand", name: "stress-note.md", base64: Buffer.from("A note from the route sweep.\n").toString("base64") },
  "POST /api/knowledge": { name: "stress-note.md", text: "A note from the route sweep." },
  "POST /api/goals/:id/note": { text: "A note from the route sweep." },
  "POST /api/team/:slug/lessons/:n": { text: "A lesson changed by the route sweep." },
  "POST /api/generation/key": { key: "short" },
  "POST /api/brain/move": { token: "YnJhbmQvYnJhbmQubWQ", folder: "company", version: "0" },
});

// [{ path, body }] from one test file's text.
export function bodiesIn(text) {
  const out = [];
  const re = /"(\/api\/[A-Za-z0-9/_.:-]+)"\s*,\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length - 1;
    const lit = balanced(text, start);
    if (!lit) continue;
    let v;
    try {
      v = vm.runInNewContext(`(${lit})`, Object.create(null), { timeout: 50 });
    } catch {
      continue;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    // call(url, "POST", path, { body, headers }) passes the body inside `body`.
    // An options object (`{ bare: true }`, `{ headers }`) is not a body.
    const keys = Object.keys(v);
    if (keys.length && keys.every((k) => OPTION_KEYS.has(k))) {
      if (!keys.includes("body")) continue;
      v = v.body;
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    }
    try {
      v = JSON.parse(JSON.stringify(v));
    } catch {
      continue;
    }
    out.push({ path: m[1], body: v });
  }
  return out;
}

// The object literal that opens at text[i] ("{"), or null; strings and template strings are skipped over.
function balanced(text, i) {
  let depth = 0;
  for (let j = i; j < text.length && j < i + 20000; j += 1) {
    const c = text[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j += 1;
      while (j < text.length && text[j] !== q) { if (text[j] === "\\") j += 1; j += 1; }
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(i, j + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

// Does a concrete path (from a test) fit a pattern's segments?
export function fits(pattern, path) {
  const a = pattern.split("/");
  const b = path.split("?")[0].split("/");
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.startsWith(":") ? b[i] !== "" : s === b[i]);
}

// { "<METHOD> <pattern>": [body, ...] } for every POST and DELETE route in `routes`.
export function testBodies(testDir, routes) {
  const found = [];
  let files = [];
  try { files = readdirSync(testDir).filter((f) => f.endsWith(".test.mjs")).sort(); } catch { files = []; }
  for (const f of files) {
    let text = "";
    try { text = readFileSync(join(testDir, f), "utf8"); } catch { continue; }
    for (const b of bodiesIn(text)) found.push({ ...b, file: f });
  }
  const out = {};
  for (const r of routes) {
    if (r.method === "GET") continue;
    const key = `${r.method} ${r.pattern}`;
    const seen = new Set();
    const list = [];
    for (const b of found) {
      if (!fits(r.pattern, b.path)) continue;
      // A literal path that another, more literal route owns is not this route's (e.g. /api/brain/files vs :token).
      if (routes.some((o) => o !== r && o.method === r.method && fits(o.pattern, b.path) && literalCount(o.pattern) > literalCount(r.pattern))) continue;
      const s = JSON.stringify(b.body);
      if (seen.has(s) || s.length > 200000) continue;
      seen.add(s);
      list.push(b.body);
    }
    if (!list.length && FALLBACK[key]) list.push(FALLBACK[key]);
    out[key] = OVERRIDES[key] ? OVERRIDES[key].valid : list;
  }
  return out;
}

const literalCount = (p) => p.split("/").filter((s) => s && !s.startsWith(":")).length;
