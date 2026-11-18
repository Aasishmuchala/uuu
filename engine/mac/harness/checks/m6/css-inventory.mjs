// The CSS the home screen's style sheets use (PLAN-MAC-2 M6 (c)): every property, at-rule, pseudo-class and
// pseudo-element and the functions worth asking about, from every file under engine/home/public/styles, with the
// files that use each and one declaration as written. Read only; nothing in PUB is changed.
// usage: node css-inventory.mjs [--json out.json]   (also imported by run-m6.mjs: inventory(pubDir))
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PUB = resolve(HERE, "..", "..", "..", "..", "home", "public");

function cssFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...cssFiles(p));
    else if (e.name.endsWith(".css")) out.push(p);
  }
  return out.sort();
}

// The functions and units a value may hold that some engines lack; each is tested as one declaration.
const FUNCTIONS = ["color-mix(", "light-dark(", "oklch(", "oklab(", "lab(", "lch(", "hwb(", "clamp(", "min(", "max(",
  "env(", "anchor(", "anchor-size(", "calc-size(", "round(", "mod(", "rem(", "sin(", "cos(", "attr(", "image-set(",
  "-webkit-image-set(", "conic-gradient(", "repeating-conic-gradient(", "linear-gradient(", "radial-gradient(",
  "cubic-bezier(", "steps(", "linear(", "drop-shadow(", "blur(", "fit-content(", "minmax(", "repeat(", "var(",
  "rgb(from", "hsl(from", "scroll(", "view(", "counter(", "symbols(", "url("];
const UNITS = ["dvh", "svh", "lvh", "dvw", "svw", "lvw", "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax", "lh", "rlh", "ic", "cap", "rex"];

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ");

export function inventory(pub = PUB) {
  const dir = join(pub, "styles");
  const props = {}; const atRules = {}; const media = {}; const pseudos = {}; const functions = {}; const units = {};
  const add = (map, key, file, sample) => {
    const m = map[key] || (map[key] = { files: [], sample: sample ?? null });
    if (!m.files.includes(file)) m.files.push(file);
    if (m.sample === null && sample != null) m.sample = sample;
  };
  for (const path of cssFiles(dir)) {
    const file = relative(pub, path);
    const text = strip(readFileSync(path, "utf8"));
    for (const m of text.matchAll(/@([a-z-]+)\b([^{;]*)/g)) {
      add(atRules, m[1], file, `@${m[1]}${m[2].trimEnd()}`.slice(0, 160));
      if (m[1] === "media" || m[1] === "container") {
        for (const f of m[2].matchAll(/\(\s*([a-z-]+)\s*(?:[:<>=]\s*([^)]*))?\)/g)) add(media, `${m[1]}:${f[1]}`, file, `(${f[1]}${f[2] ? `: ${f[2].trim()}` : ""})`);
      }
    }
    // Selectors: the text before each "{" that is not an at-rule's prelude.
    for (const m of text.matchAll(/(^|[};])\s*([^{}@;][^{};]*)\{/g)) {
      const sel = m[2].trim();
      if (/^(from|to|\d+%)/.test(sel)) continue;
      for (const p of sel.matchAll(/(::?-?[a-z][a-z-]*)(\()?/g)) {
        const name = p[1];
        if (/^:(\d|[a-f]{3,6}$)/.test(name)) continue;
        add(pseudos, name + (p[2] ? "()" : ""), file, sel.slice(0, 160));
      }
    }
    // Declarations: inside braces, name: value; (custom properties left out: they are always supported).
    for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
      for (const d of block[1].split(";")) {
        const i = d.indexOf(":");
        if (i < 1) continue;
        const name = d.slice(0, i).trim().toLowerCase();
        const value = d.slice(i + 1).replace(/!important/i, "").trim();
        if (!/^-?[a-z][a-z-]*$/.test(name) || name.startsWith("--") || !value) continue;
        add(props, name, file, `${name}: ${value}`.slice(0, 300));
        for (const f of FUNCTIONS) if (value.toLowerCase().includes(f)) add(functions, f.replace("(", "()").replace("()from", "() from"), file, `${name}: ${value}`.slice(0, 300));
        for (const u of UNITS) if (new RegExp(`\\d${u}\\b`).test(value)) add(units, u, file, `${name}: ${value}`.slice(0, 300));
      }
    }
  }
  return { props, atRules, media, pseudos, functions, units, files: cssFiles(dir).map((p) => relative(pub, p)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inv = inventory();
  const j = process.argv.indexOf("--json");
  const text = `${JSON.stringify(inv, null, 1)}\n`;
  if (j > 0) writeFileSync(process.argv[j + 1], text);
  console.log(`files ${inv.files.length}, properties ${Object.keys(inv.props).length}, at-rules ${Object.keys(inv.atRules).length}, media features ${Object.keys(inv.media).length}, pseudo ${Object.keys(inv.pseudos).length}, functions ${Object.keys(inv.functions).length}, units ${Object.keys(inv.units).length}`);
}
