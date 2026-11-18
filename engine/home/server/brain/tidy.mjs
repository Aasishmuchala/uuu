// Tidy-up findings (PLAN-BRAIN B11): a pure function over the owner's own file passages. Three fixed rules
// find a repeat, two files that give different figures for the same thing, and a date that has passed.
// No model and no agent is involved, and nothing here reads or changes any file.
import { createHash } from "node:crypto";

export const KINDS = ["repeat", "disagree", "passed"];
export const MAX_PER_KIND = 10;
export const WHY = Object.freeze({
  repeat: "These two files say the same thing.",
  disagree: "These two files give different figures for the same thing.",
  passed: "This file gives a date that has passed.",
});
export const TITLES = Object.freeze({
  repeat: "Two files say the same thing",
  disagree: "Two files disagree",
  passed: "A date has passed",
});

const REPEAT_MIN = 200;
const DISAGREE_FOLDERS = ["company", "pricing", "policies", "brand"];
const PASSED_FOLDERS = ["company", "pricing", "policies"];
const TEXT_FILE = /\.(?:md|txt|csv)$/i;
const MAX_PASSAGES = 20000;

const squeeze = (s) => String(s).replace(/\s+/gu, " ").trim();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const folderOf = (source) => String(source).split("/")[0];

// A line like "Refund window: 14 days": 2 to 6 words, 8 to 40 characters of label, a value holding a digit.
// The label may follow a list mark or Markdown emphasis. Matched by scanning, never by a backtracking pattern.
export function labelLine(raw) {
  const line = String(raw).replace(/^\s*(?:[-*+]\s+|\d{1,3}[.)]\s+)?/u, "").replace(/[*_`]/gu, "");
  const at = line.indexOf(":");
  if (at < 0) return null;
  const label = squeeze(line.slice(0, at)).toLowerCase();
  const value = squeeze(line.slice(at + 1));
  if (label.length < 8 || label.length > 40 || !value || !/\d/u.test(value)) return null;
  const words = label.split(" ");
  if (words.length < 2 || words.length > 6) return null;
  return { label, value };
}

const DATE_AFTER = /\b(until|till|by|before|expires|valid)\b[^\n]{0,20}?(\d{4})-(\d{2})-(\d{2})/giu;

// The first date that follows one of the words within 20 characters on its line and is earlier than `today`.
export function passedDate(text, today) {
  for (const line of String(text).split("\n")) {
    DATE_AFTER.lastIndex = 0;
    for (const m of line.matchAll(DATE_AFTER)) {
      const month = Number(m[3]);
      const day = Number(m[4]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const date = `${m[2]}-${m[3]}-${m[4]}`;
      if (date < today) return date;
    }
  }
  return null;
}

function keyOf(kind, a, b) {
  const h = createHash("sha256");
  for (const part of [kind, a.source, b ? b.source : "", a.locator, b ? b.locator : "", a.text, b ? b.text : ""]) {
    h.update(String(part)).update("\u0000");
  }
  return h.digest("hex").slice(0, 16);
}

const side = (p) => ({ source: p.source, locator: p.locator, text: p.text });

function finding(kind, a, b) {
  return { kind, key: keyOf(kind, side(a), b ? side(b) : null), a: side(a), b: b ? side(b) : null, why: WHY[kind] };
}

// passages: [{ kind, trust, source, locator, text }]; only the owner's text files count.
function ownerFiles(passages) {
  const out = [];
  for (const p of Array.isArray(passages) ? passages : []) {
    if (out.length >= MAX_PASSAGES) break;
    if (!p || p.kind !== "file" || p.trust !== "owner") continue;
    if (typeof p.source !== "string" || typeof p.text !== "string" || !TEXT_FILE.test(p.source)) continue;
    out.push({ source: p.source, locator: typeof p.locator === "string" ? p.locator : "", ord: Number(p.ord) || 0, text: p.text });
  }
  return out.sort((x, y) => cmp(x.source, y.source) || x.ord - y.ord || cmp(x.locator, y.locator));
}

// Each pair of passages from different files, a first by file name, as [a, b].
function pairsOf(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (list[i].source !== list[j].source) out.push([list[i], list[j]]);
      if (out.length > 200) return out;
    }
  }
  return out;
}

function repeats(files) {
  const groups = new Map();
  for (const p of files) {
    const norm = squeeze(p.text).toLowerCase();
    if (norm.length < REPEAT_MIN) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm).push(p);
  }
  const out = [];
  for (const list of groups.values()) {
    const firstOf = new Map();
    for (const p of list) if (!firstOf.has(p.source)) firstOf.set(p.source, p);
    for (const [a, b] of pairsOf([...firstOf.values()])) out.push(finding("repeat", a, b));
  }
  return out;
}

function disagreements(files) {
  const byLabel = new Map();
  for (const p of files) {
    if (!DISAGREE_FOLDERS.includes(folderOf(p.source))) continue;
    for (const line of p.text.split("\n")) {
      const got = labelLine(line);
      if (!got) continue;
      if (!byLabel.has(got.label)) byLabel.set(got.label, []);
      byLabel.get(got.label).push({ ...p, value: got.value });
    }
  }
  const out = [];
  for (const list of byLabel.values()) {
    const firstOf = new Map();
    for (const p of list) {
      const have = firstOf.get(p.source) || [];
      if (!have.some((h) => h.value === p.value)) have.push(p);
      firstOf.set(p.source, have);
    }
    const flat = [...firstOf.values()].flat();
    for (const [a, b] of pairsOf(flat)) if (a.value !== b.value) out.push(finding("disagree", a, b));
  }
  return out;
}

function passedDates(files, today) {
  const out = [];
  for (const p of files) {
    if (!PASSED_FOLDERS.includes(folderOf(p.source))) continue;
    if (passedDate(p.text, today)) out.push(finding("passed", p, null));
  }
  return out;
}

export function findings(passages, { today } = {}) {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(today)) return [];
  const files = ownerFiles(passages);
  const all = { repeat: repeats(files), disagree: disagreements(files), passed: passedDates(files, today) };
  const out = [];
  for (const kind of KINDS) {
    const seen = {};
    const list = all[kind]
      .sort((x, y) => cmp(x.a.source, y.a.source) || cmp(x.b ? x.b.source : "", y.b ? y.b.source : "") || cmp(x.a.locator, y.a.locator))
      .filter((f) => (seen[f.key] ? false : (seen[f.key] = true)));
    out.push(...list.slice(0, MAX_PER_KIND));
  }
  return out;
}
