// The four shared tests every page must pass (CONTRACTS-V2 section 23, CONTRACTS-V3 section 39), for each
// page id of the route table (26.1), each of its EXTRA_MODULES and each page another page hands its address to. A page's tests skip until its module
// exists; the task that builds it shows them passing with none skipped.
//   page <id>: loads in Node and exports a component
//   page <id>: imports stay inside public and use the kit through kit/index.js
//   page <id>: its stylesheet follows the class and token rules        (CONTRACTS-V2 11.2 and V3 27.3)
//   page <id>: no other host and no tool name                           (health and settings may name tools)
// An extra module's id is its file name without the ending. Its stylesheet test is made only when it has a
// stylesheet of its own name (brain.css counts for new-file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const KIT_INDEX = join(KIT, "index.js");
const routes = await import(pathToFileURL(join(PUBLIC, "routes.js")).href);

const PAGE_IDS = ["map", "needs-you", "tasks", "task", "dashboards", "dashboard", "marketing", "studio", "files", "jobs", "job", "dept", "team", "agent", "routines", "health", "settings", "search", "apps", "app"];
const EXTRA_IDS = ["sprite-player", "layout", "map-view", "map-list", "new-file", "readiness"];
// Pages reached through another page's address (the Files page hands #/files/brand-kit over), so the route table
// stays as it is: each is a page module with a default component and a stylesheet of its own name.
const SUB_PAGES = ["brand-kit"];
const MAY_NAME_TOOLS = new Set(["health", "settings"]);
const TOOLS = ["paperclip", "Frappe", "ERPNext", "MariaDB", "sandbox-runtime", "Claude", "Codex", "CadQuery", "Pillow", "Ollama", "Kestra", "Aseprite", "Piskel", "ffmpeg", "whisper", "Blender"];

// The stylesheet that goes with an extra module, when it has one.
const EXTRA_SHEETS = { "sprite-player": "sprite-player", "new-file": "brain" };
// The export each extra module is known by; the others need at least one exported function.
const EXTRA_EXPORTS = { "sprite-player": "SpritePlayer", layout: "layoutOverview" };

const extraFile = (id) => {
  const spec = routes.EXTRA_MODULES.find((m) => basename(m, ".js") === id);
  return spec ? resolve(PUBLIC, spec) : null;
};
const ENTRIES = [
  ...PAGE_IDS.map((id) => ({ id, file: resolve(PUBLIC, routes.routeById(id)?.file || `./pages/${id}.js`), exportName: "default", sheet: id })),
  ...EXTRA_IDS.map((id) => ({ id, file: extraFile(id) || join(PUBLIC, "missing", `${id}.js`), exportName: EXTRA_EXPORTS[id] || null, sheet: EXTRA_SHEETS[id] || null })),
  ...SUB_PAGES.map((id) => ({ id, file: join(PUBLIC, "pages", `${id}.js`), exportName: "default", sheet: id })),
];

const sheetPath = (name) => join(PUBLIC, "styles", "pages", `${name}.css`);
const inside = (p) => p === PUBLIC || p.startsWith(PUBLIC + sep);

// Removes comments from a module's text (strings that contain "//", such as "a//b", are left alone
// as long as the "//" follows a character that cannot start a comment).
export function stripJsComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
}

// Every import of a module: static (`from "x"`, `import "x"`) and dynamic with a literal (`import("x")`).
export function importsOf(src) {
  const code = stripJsComments(src);
  const out = [];
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g]) {
    for (const m of code.matchAll(re)) out.push(m[1]);
  }
  return out;
}

// The rules of a stylesheet, flattened: [{ kind: "rule", selector, body } | { kind: "keyframes", name, body } | { kind: "at", name, body }].
export function cssRules(css) {
  const text = String(css).replace(/\/\*[\s\S]*?\*\//g, " ");
  const out = [];
  const walk = (s) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf("{", i);
      if (open === -1) break;
      const head = s.slice(i, open).trim().replace(/^[;\s]+/, "");
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth) {
        if (s[j] === "{") depth += 1;
        else if (s[j] === "}") depth -= 1;
        j += 1;
      }
      const body = s.slice(open + 1, j - 1);
      if (/^@(-webkit-)?keyframes\b/.test(head)) out.push({ kind: "keyframes", name: head.replace(/^@(-webkit-)?keyframes\s+/, "").trim(), body });
      else if (/^@(media|supports|container|layer)\b/.test(head)) walk(body);
      else if (head.startsWith("@")) out.push({ kind: "at", name: head, body });
      else out.push({ kind: "rule", selector: head, body });
      i = j;
    }
  };
  walk(text);
  return out;
}

// Splits a selector list (or a value list) at its top-level commas (not those inside (...) or [...]).
export function selectorsOf(list) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of String(list)) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// The declarations of a rule's body: [{ prop, value }], props in lower case.
export function declarationsOf(body) {
  const out = [];
  for (const part of String(body).split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (prop && !prop.includes("{") && !prop.includes("}")) out.push({ prop, value });
  }
  return out;
}

// Colours may move by a transition of at most --t-med; everything else that moves is transform or opacity.
const MOVES = new Set(["transform", "opacity"]);
const COLOURS = new Set(["color", "background-color", "border-color", "outline-color", "fill", "stroke", "text-decoration-color", "border-top-color", "border-bottom-color", "border-left-color", "border-right-color"]);
const QUICK = (d) => {
  const v = String(d || "").trim();
  if (v === "var(--t-fast)" || v === "var(--t-med)") return true;
  const ms = /^([\d.]+)ms$/.exec(v);
  if (ms) return Number(ms[1]) <= 200;
  const s = /^([\d.]+)s$/.exec(v);
  return s ? Number(s[1]) <= 0.2 : false;
};
const isTime = (t) => /^(var\(--t-[a-z]+\)|[\d.]+m?s)$/.test(t);

// The problems of one transition value, as sentences.
export function transitionProblems(value) {
  const out = [];
  const v = String(value).trim();
  if (v === "none" || v === "inherit" || v === "initial" || v === "unset") return out;
  for (const item of selectorsOf(v)) {
    const words = item.split(/\s+(?![^(]*\))/).filter(Boolean);
    const prop = words[0] && !isTime(words[0]) ? words[0].toLowerCase() : "all";
    const duration = words.find(isTime);
    if (MOVES.has(prop)) continue;
    if (COLOURS.has(prop)) {
      if (!QUICK(duration)) out.push(`the transition of ${prop} is longer than --t-med`);
      continue;
    }
    out.push(`a transition moves "${prop}", not transform or opacity`);
  }
  return out;
}

// The problems of a page stylesheet under the rules of CONTRACTS-V2 11.2 and CONTRACTS-V3 27.3, as plain
// sentences; empty when it is fine.
export function sheetProblems(id, css) {
  const root = `.p-${id}`;
  const problems = [];
  const starts = (sel) => sel === root || (sel.startsWith(root) && !/[\w-]/.test(sel[root.length]));
  const rules = cssRules(css);
  const frames = new Map();
  for (const r of rules) {
    if (r.kind === "keyframes") {
      frames.set(r.name, r.body);
      if (!r.name.startsWith(`p-${id}-`)) problems.push(`keyframes "${r.name}" is not named p-${id}-...`);
      for (const step of cssRules(r.body)) {
        for (const d of declarationsOf(step.body)) {
          if (!MOVES.has(d.prop)) problems.push(`keyframes "${r.name}" animate "${d.prop}", not transform or opacity`);
        }
      }
    } else if (r.kind === "at") {
      problems.push(`"${r.name}" is not allowed in a page stylesheet`);
    } else {
      for (const sel of selectorsOf(r.selector)) {
        if (!starts(sel)) problems.push(`selector "${sel}" does not start with ${root}`);
      }
    }
  }
  const body = rules.filter((r) => r.kind === "rule").map((r) => r.body || "").join(";\n");
  const all = rules.map((r) => r.body || "").join(";\n");
  if (/#[0-9a-fA-F]{3,8}(?![\w-])/.test(all)) problems.push("uses a hex colour");
  if (/\brgba?\(|\bhsla?\(/.test(all)) problems.push("uses rgb( or hsl( instead of a token");
  for (const m of body.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    const v = m[1].replace(/!important/, "").trim();
    if (!/^var\(--font-(sans|mono|serif)\)$/.test(v) && v !== "inherit") problems.push(`font-family "${v}" is not a token`);
  }
  if (/font-size\s*:\s*[\d.]+px/.test(body)) problems.push("sets a font-size in px");
  if (/(^|[\s;{])font\s*:[^;}]*\d+px/.test(body)) problems.push("sets a font size in px through font:");
  for (const m of body.matchAll(/z-index\s*:\s*(-?\d+)/g)) {
    if (Number(m[1]) > 50) problems.push(`z-index ${m[1]} is above 50`);
  }
  for (const r of rules.filter((x) => x.kind === "rule")) {
    for (const d of declarationsOf(r.body)) {
      if (d.prop === "backdrop-filter" || d.prop === "-webkit-backdrop-filter") problems.push("uses backdrop-filter (only the chrome may blur)");
      if (d.prop === "filter" && /blur/i.test(d.value)) problems.push("uses filter: blur");
      if (d.prop === "will-change") problems.push("uses will-change");
      if (d.prop === "transition") problems.push(...transitionProblems(d.value));
      if (d.prop === "transition-property") {
        for (const p of selectorsOf(d.value)) if (!MOVES.has(p) && !COLOURS.has(p) && p !== "none") problems.push(`a transition moves "${p}", not transform or opacity`);
      }
      if (d.prop === "animation" || d.prop === "animation-iteration-count") {
        for (const item of selectorsOf(d.value)) {
          if (!/\binfinite\b/.test(item)) continue;
          // An endless animation is allowed only as a live mark: one that breathes in opacity alone.
          const name = [...frames.keys()].find((k) => new RegExp(`(^|\\s)${k.replace(/[-]/g, "\\-")}(\\s|$)`).test(item));
          const props = name ? cssRules(frames.get(name)).flatMap((s) => declarationsOf(s.body).map((x) => x.prop)) : ["?"];
          if (!props.length || props.some((p) => p !== "opacity")) problems.push(`an animation never ends ("${item}") and is not a live mark in opacity`);
        }
      }
    }
  }
  return problems;
}

// Another host: an http(s) address, or a protocol-relative "//host" in a string. The SVG and XML
// namespaces of the W3C are names, not addresses, and are allowed.
export function hostsIn(text) {
  const found = [];
  for (const m of String(text).matchAll(/\b(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,}|localhost|\d+\.\d+\.\d+\.\d+)(?::\d+)?/gi)) {
    if (/^www\.w3\.org$/i.test(m[1])) continue;
    found.push(m[0]);
  }
  return found;
}

export function toolsIn(text) {
  return TOOLS.filter((t) => new RegExp(`(^|[^\\w-])${t.replace(/[-]/g, "\\-")}(?![\\w-])`, "i").test(text));
}

test("the ids checked here are the route table's pages and its extra modules", () => {
  assert.deepEqual([...new Set(routes.ROUTES.map((r) => r.id))].sort(), [...PAGE_IDS].sort());
  assert.deepEqual(routes.EXTRA_MODULES.map((m) => basename(m, ".js")), EXTRA_IDS);
});

test("the stylesheet rules catch what CONTRACTS-V3 27.3 forbids", () => {
  const p = (css) => sheetProblems("x", css);
  assert.deepEqual(p(".p-x { color: var(--text); transition: opacity var(--t-slow) var(--ease), color var(--t-fast); }"), []);
  assert.deepEqual(p(".p-x { animation: p-x-breathe 2.4s ease-in-out infinite; } @keyframes p-x-breathe { 50% { opacity: .4; } }"), []);
  assert.ok(p(".p-x { backdrop-filter: blur(4px); }").length);
  assert.ok(p(".p-x { filter: blur(4px); }").length);
  assert.ok(p(".p-x { will-change: transform; }").length);
  assert.ok(p(".p-x { transition: width .2s; }").length);
  assert.ok(p(".p-x { transition: all .2s; }").length);
  assert.ok(p(".p-x { transition: color var(--t-slow); }").length);
  assert.ok(p(".p-x { animation: p-x-spin 1s linear infinite; } @keyframes p-x-spin { to { transform: rotate(1turn); } }").length);
  assert.ok(p("@keyframes p-x-grow { to { width: 10px; } }").length);
  assert.ok(p(".p-x { color: #fff; }").length);
  assert.ok(p(".k-card { color: var(--text); }").length);
  assert.ok(p(".p-x { font-family: Arial; }").length);
  assert.deepEqual(p(".p-x { font-family: var(--font-serif); }"), []);
});

for (const e of ENTRIES) {
  const where = relative(PUBLIC, e.file);
  const skip = existsSync(e.file) ? false : `${where} is not built yet`;

  test(`page ${e.id}: loads in Node and exports a component`, { skip }, async () => {
    const m = await import(pathToFileURL(e.file).href);
    if (e.exportName) {
      assert.equal(typeof m[e.exportName], "function", `${where} exports ${e.exportName === "default" ? "a default" : e.exportName} component`);
    } else {
      assert.ok(Object.values(m).some((v) => typeof v === "function"), `${where} exports at least one function`);
    }
  });

  test(`page ${e.id}: imports stay inside public and use the kit through kit/index.js`, { skip }, () => {
    for (const spec of importsOf(readFileSync(e.file, "utf8"))) {
      assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${where} imports "${spec}" by a relative path only`);
      const target = resolve(dirname(e.file), spec);
      assert.ok(inside(target), `${where} imports "${spec}" from inside public/`);
      assert.ok(existsSync(target), `${where} imports "${spec}", which exists`);
      if (target.startsWith(KIT + sep)) assert.equal(target, KIT_INDEX, `${where} imports the kit through kit/index.js, not "${spec}"`);
      assert.ok(!target.startsWith(join(PUBLIC, "shell") + sep), `${where} does not import the shell ("${spec}"); use lib/context.js`);
    }
  });

  if (e.sheet) {
    test(`page ${e.id}: its stylesheet follows the class and token rules`, { skip }, () => {
      const sheet = sheetPath(e.sheet);
      assert.ok(existsSync(sheet), `styles/pages/${e.sheet}.css exists`);
      assert.deepEqual(sheetProblems(e.sheet, readFileSync(sheet, "utf8")), [], `styles/pages/${e.sheet}.css`);
      assert.match(readFileSync(e.file, "utf8"), new RegExp(`["'\` ]p-${e.sheet}(?![\\w-])`), `${where} puts the class p-${e.sheet} on its root`);
    });
  }

  test(`page ${e.id}: no other host and no tool name`, { skip }, () => {
    const code = stripJsComments(readFileSync(e.file, "utf8"));
    const css = e.sheet && existsSync(sheetPath(e.sheet)) ? readFileSync(sheetPath(e.sheet), "utf8") : "";
    assert.deepEqual(hostsIn(code), [], `${where} names no other host`);
    assert.deepEqual(hostsIn(css), [], `styles/pages/${e.sheet}.css names no other host`);
    assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i, `styles/pages/${e.sheet}.css loads nothing from elsewhere`);
    if (!MAY_NAME_TOOLS.has(e.id)) assert.deepEqual(toolsIn(code), [], `${where} names no tool on screen`);
  });
}
