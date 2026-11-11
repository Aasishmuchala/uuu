// Reads the company brain's form files, engine/company/brain/forms/<id>.json (CONTRACTS-V3
// 32.3), and its starter packs, engine/company/brain/starters/<folder>/<id>.md (32.5; today
// only the folder `packs`). A file that breaks a rule is left out; each problem is one plain
// sentence, with the file it is in. Nothing here touches the board or writes a file.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { badText, plainList } from "./routine-files.mjs";
import { BRAIN_FOLDERS } from "./job-files.mjs";

const FORM_KEYS = ["id", "folder", "file", "title", "lead", "fields"];
const FIELD_KEYS = ["id", "label", "kind", "required"];
// The keys a field may have beyond the four, by kind; `hint` is allowed on every kind.
const FIELD_EXTRA = { line: [], text: [], list: ["max"], rows: ["columns"], colour: ["max"], choice: ["options"] };
export const FIELD_KINDS = Object.keys(FIELD_EXTRA);
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const FIELD_ID = /^[a-z][a-z0-9-]{0,30}$/;
const FILE = /^[a-z0-9][a-z0-9-]{0,60}\.md$/;
const MAX_FORM_BYTES = 32 * 1024;
// One page: at most this many bytes and lines.
export const PACK_MAX_BYTES = 6 * 1024;
export const PACK_MAX_LINES = 80;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, least, most) => typeof v === "string" && v.trim().length >= least && v.length <= most;

// A sentence a starter pack may not hold, because it would state a fact about the company: a
// price in rupees or a percentage. Returns the end of a sentence, or null.
export function statesAFact(t) {
  if (t.includes("₹")) return "names a price in rupees";
  if (/[0-9]\s*%/.test(t)) return "names a percentage";
  return null;
}

function fieldProblems(f, n) {
  const out = [];
  const label = `Its field ${n}`;
  if (!obj(f)) return [`${label} is not a field.`];
  // With a kind it does not know, only the kind is reported.
  const allowed = [...FIELD_KEYS, "hint", ...(FIELD_EXTRA[f.kind] || ["max", "columns", "options"])];
  const missing = [...FIELD_KEYS, ...(FIELD_EXTRA[f.kind] || [])].filter((k) => !(k in f));
  const extra = Object.keys(f).filter((k) => !allowed.includes(k));
  if (missing.length) out.push(`${label} has no ${plainList(missing)}.`);
  if (extra.length) out.push(`${label} has keys a field of this kind does not take: ${plainList(extra, "and")}.`);
  if ("id" in f && (typeof f.id !== "string" || !FIELD_ID.test(f.id))) out.push(`${label} needs an id of up to 31 lower-case letters, digits and dashes, starting with a letter.`);
  if ("label" in f && !text(f.label, 1, 80)) out.push(`${label} needs a label of 1 to 80 characters.`);
  if ("kind" in f && !FIELD_KINDS.includes(f.kind)) out.push(`${label} needs a kind of ${plainList(FIELD_KINDS)}.`);
  if ("required" in f && typeof f.required !== "boolean") out.push(`${label} needs required as true or false.`);
  if ("hint" in f && (!text(f.hint, 1, 140) || !/such as|for example/i.test(f.hint))) {
    out.push(`${label} has a hint that is not 1 to 140 characters saying it is an example (such as, for example).`);
  }
  if ("max" in f && (!Number.isInteger(f.max) || f.max < 1 || f.max > 40)) out.push(`${label} needs a max of 1 to 40.`);
  if (f.kind === "choice" && "options" in f) {
    const o = f.options;
    if (!Array.isArray(o) || o.length < 2 || o.length > 12 || !o.every((x) => text(x, 1, 60)) || new Set(o).size !== o.length) {
      out.push(`${label} needs 2 to 12 different options of 1 to 60 characters.`);
    }
  }
  if (f.kind === "rows" && "columns" in f) {
    const c = f.columns;
    const ok = Array.isArray(c) && c.length >= 1 && c.length <= 8 && c.every((x) => obj(x) && Object.keys(x).length === 2
      && typeof x.id === "string" && FIELD_ID.test(x.id) && text(x.label, 1, 40));
    if (!ok) out.push(`${label} needs 1 to 8 columns, each with an id and a label.`);
    else if (new Set(c.map((x) => x.id)).size !== c.length) out.push(`${label} has two columns with the same id.`);
  }
  return out;
}

// Every problem of one form, as plain sentences.
export function formProblems(doc, file) {
  const out = [];
  if (!obj(doc)) return ["It is not a form: it should be one object with an id, a folder, a file and the rest."];
  const missing = FORM_KEYS.filter((k) => !(k in doc));
  const extra = Object.keys(doc).filter((k) => !FORM_KEYS.includes(k));
  if (missing.length) out.push(`It has no ${plainList(missing)}.`);
  if (extra.length) out.push(`It has keys a form does not take: ${plainList(extra, "and")}.`);
  if ("id" in doc) {
    if (typeof doc.id !== "string" || !ID.test(doc.id)) out.push("Its id must be lower-case letters, digits and dashes, starting with a letter.");
    else if (`${doc.id}.json` !== file) out.push(`Its id must match the file name (${doc.id}.json).`);
  }
  if ("folder" in doc && !BRAIN_FOLDERS.includes(doc.folder)) out.push(`Its folder must be one of ${plainList(BRAIN_FOLDERS)}.`);
  if ("file" in doc && (typeof doc.file !== "string" || !FILE.test(doc.file))) out.push("Its file must be a name of lower-case letters, digits and dashes ending in .md.");
  if ("title" in doc && !text(doc.title, 1, 60)) out.push("Its title must be 1 to 60 characters.");
  if ("lead" in doc) {
    if (!text(doc.lead, 1, 200)) out.push("Its lead must be 1 to 200 characters.");
    else if (badText(doc.lead)) out.push(`Its lead ${badText(doc.lead)}.`);
  }
  if ("fields" in doc) {
    const fs = doc.fields;
    if (!Array.isArray(fs) || fs.length < 1 || fs.length > 20) out.push("It must have 1 to 20 fields.");
    else {
      fs.forEach((f, i) => out.push(...fieldProblems(f, i + 1)));
      const ids = fs.filter(obj).map((f) => f.id);
      if (new Set(ids).size !== ids.length) out.push("Two of its fields have the same id.");
      const labels = fs.filter(obj).map((f) => f.label);
      if (new Set(labels).size !== labels.length) out.push("Two of its fields have the same label, so they cannot be read back.");
      if (!fs.some((f) => obj(f) && f.required === true)) out.push("It must have at least one required field.");
    }
  }
  return out;
}

function listOf(dir) {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
}

// dir: the forms folder. Forms come out by file name.
export function loadBrainForms(dir) {
  const forms = [];
  const problems = [];
  const names = listOf(dir);
  if (!names) return { forms, problems };
  const targets = new Map();
  for (const file of names.filter((n) => n.endsWith(".json"))) {
    const say = (problem) => problems.push({ file, problem });
    const st = lstatSync(join(dir, file));
    if (!st.isFile()) { say("It is not a plain file."); continue; }
    if (st.size > MAX_FORM_BYTES) { say("It is too large for a form file."); continue; }
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { say("It is not valid JSON."); continue; }
    const found = formProblems(doc, file);
    const target = found.length ? null : `${doc.folder}/${doc.file}`;
    if (target && targets.has(target)) found.push(`Its file ${target} is already filled by ${targets.get(target)}.`);
    if (found.length) { for (const p of found) say(p); continue; }
    targets.set(target, file);
    forms.push(structuredClone(doc));
  }
  return { forms, problems };
}

// dir: the starters folder, holding one folder per brain folder that offers starters (`packs`).
// Each starter: { id, folder, file, title, text }. The title is the page's `# ` line.
export function loadStarters(dir) {
  const starters = [];
  const problems = [];
  const folders = listOf(dir);
  if (!folders) return { starters, problems };
  for (const folder of folders) {
    const path = join(dir, folder);
    if (!lstatSync(path).isDirectory() || !BRAIN_FOLDERS.includes(folder)) {
      problems.push({ file: folder, problem: "It is not a folder named after a folder of the company brain." });
      continue;
    }
    for (const name of listOf(path).filter((n) => n.endsWith(".md"))) {
      const file = `${folder}/${name}`;
      const say = (problem) => problems.push({ file, problem });
      if (!FILE.test(name)) { say("Its name must be lower-case letters, digits and dashes ending in .md."); continue; }
      const st = lstatSync(join(path, name));
      if (!st.isFile()) { say("It is not a plain file."); continue; }
      if (st.size > PACK_MAX_BYTES) { say("It is longer than one page."); continue; }
      const t = readFileSync(join(path, name), "utf8");
      const lines = t.replace(/\n$/, "").split("\n");
      const found = [];
      if (t.includes("\0") || Buffer.byteLength(t) !== st.size) found.push("It is not plain text.");
      if (lines.length > PACK_MAX_LINES) found.push("It is longer than one page.");
      if (!/^# \S/.test(lines[0]) || lines[0].length > 80) found.push("It must start with its title on one line after # and a space, of at most 80 characters.");
      const bad = badText(t);
      if (bad) found.push(`It ${bad}.`);
      const fact = statesAFact(t);
      if (fact) found.push(`It ${fact}, which is a fact about a company; a starter page states none.`);
      if (found.length) { for (const p of found) say(p); continue; }
      starters.push({ id: name.slice(0, -3), folder, file: name, title: lines[0].slice(2).trim(), text: t });
    }
  }
  return { starters, problems };
}
