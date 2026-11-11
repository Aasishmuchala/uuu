// The four shared tests every page must pass (CONTRACTS-V2 section 23). A page's tests skip until its
// module exists; the task that builds it shows them passing with none skipped.
//   page <id>: loads in Node and exports a component
//   page <id>: imports stay inside public and use the kit through kit/index.js
//   page <id>: its stylesheet follows the class and token rules        (CONTRACTS-V2 11.2)
//   page <id>: no other host and no tool name                           (health and settings may name tools)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PUBLIC, "kit");
const KIT_INDEX = join(KIT, "index.js");

const IDS = ["home", "tasks", "task", "team", "agent", "department", "marketing", "studio", "docs", "routines", "gallery", "health", "settings", "search", "sprite-player"];
const MAY_NAME_TOOLS = new Set(["health", "settings"]);
const TOOLS = ["paperclip", "Frappe", "ERPNext", "MariaDB", "sandbox-runtime", "Claude", "Codex", "CadQuery", "Pillow", "Ollama", "Kestra", "Aseprite", "Piskel"];

const moduleOf = (id) => (id === "sprite-player" ? join(PUBLIC, "studio", "sprite-player.js") : join(PUBLIC, "pages", `${id}.js`));
const exportOf = (id) => (id === "sprite-player" ? "SpritePlayer" : "default");
const sheetOf = (id) => join(PUBLIC, "styles", "pages", `${id}.css`);
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

// The rules of a stylesheet, flattened: [{ kind: "rule", selector, body } | { kind: "keyframes", name }].
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

// Splits a selector list at its top-level commas (not those inside :is(...) or [attr="a,b"]).
export function selectorsOf(list) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of list) {
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

// The problems of a page stylesheet under the rules of 11.2, as plain sentences; empty when it is fine.
export function sheetProblems(id, css) {
  const root = `.p-${id}`;
  const problems = [];
  const starts = (sel) => sel === root || (sel.startsWith(root) && !/[\w-]/.test(sel[root.length]));
  for (const r of cssRules(css)) {
    if (r.kind === "keyframes") {
      if (!r.name.startsWith(`p-${id}-`)) problems.push(`keyframes "${r.name}" is not named p-${id}-...`);
    } else if (r.kind === "at") {
      problems.push(`"${r.name}" is not allowed in a page stylesheet`);
    } else {
      for (const sel of selectorsOf(r.selector)) {
        if (!starts(sel)) problems.push(`selector "${sel}" does not start with ${root}`);
      }
    }
  }
  const body = cssRules(css).map((r) => r.body || "").join("\n");
  if (/#[0-9a-fA-F]{3,8}(?![\w-])/.test(body)) problems.push("uses a hex colour");
  if (/\brgba?\(|\bhsla?\(/.test(body)) problems.push("uses rgb( or hsl( instead of a token");
  for (const m of body.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    const v = m[1].replace(/!important/, "").trim();
    if (!/^var\(--font-(sans|mono)\)$/.test(v) && v !== "inherit") problems.push(`font-family "${v}" is not a token`);
  }
  if (/font-size\s*:\s*[\d.]+px/.test(body)) problems.push("sets a font-size in px");
  if (/(^|[\s;{])font\s*:[^;}]*\d+px/.test(body)) problems.push("sets a font size in px through font:");
  for (const m of body.matchAll(/z-index\s*:\s*(-?\d+)/g)) {
    if (Number(m[1]) > 50) problems.push(`z-index ${m[1]} is above 50`);
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

for (const id of IDS) {
  const file = moduleOf(id);
  const where = relative(PUBLIC, file);
  const skip = existsSync(file) ? false : `${where} is not built yet`;

  test(`page ${id}: loads in Node and exports a component`, { skip }, async () => {
    const m = await import(pathToFileURL(file).href);
    assert.equal(typeof m[exportOf(id)], "function", `${where} exports ${exportOf(id) === "default" ? "a default" : exportOf(id)} component`);
  });

  test(`page ${id}: imports stay inside public and use the kit through kit/index.js`, { skip }, () => {
    for (const spec of importsOf(readFileSync(file, "utf8"))) {
      assert.ok(spec.startsWith("./") || spec.startsWith("../"), `${where} imports "${spec}" by a relative path only`);
      const target = resolve(dirname(file), spec);
      assert.ok(inside(target), `${where} imports "${spec}" from inside public/`);
      assert.ok(existsSync(target), `${where} imports "${spec}", which exists`);
      if (target.startsWith(KIT + sep)) assert.equal(target, KIT_INDEX, `${where} imports the kit through kit/index.js, not "${spec}"`);
      assert.ok(!target.startsWith(join(PUBLIC, "shell") + sep), `${where} does not import the shell ("${spec}"); use lib/context.js`);
    }
  });

  test(`page ${id}: its stylesheet follows the class and token rules`, { skip }, () => {
    const sheet = sheetOf(id);
    assert.ok(existsSync(sheet), `styles/pages/${id}.css exists`);
    assert.deepEqual(sheetProblems(id, readFileSync(sheet, "utf8")), [], `styles/pages/${id}.css`);
    assert.match(readFileSync(file, "utf8"), new RegExp(`["'\` ]p-${id}(?![\\w-])`), `${where} puts the class p-${id} on its root`);
  });

  test(`page ${id}: no other host and no tool name`, { skip }, () => {
    const code = stripJsComments(readFileSync(file, "utf8"));
    const css = existsSync(sheetOf(id)) ? readFileSync(sheetOf(id), "utf8") : "";
    assert.deepEqual(hostsIn(code), [], `${where} names no other host`);
    assert.deepEqual(hostsIn(css), [], `styles/pages/${id}.css names no other host`);
    assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i, `styles/pages/${id}.css loads nothing from elsewhere`);
    if (!MAY_NAME_TOOLS.has(id)) assert.deepEqual(toolsIn(code), [], `${where} names no tool on screen`);
  });
}
