// The company brain's files as the map and the jobs see them (CONTRACTS-V3 32.1, 32.4, 37.3): whether a
// file is filled, the nine basics, the files of one folder, and the Studio room's files. Read-only.
// The brain is the owner's folder (state/knowledge/docs), but a file can be dropped there by hand, so every
// file is read through readChecked (no link followed, a regular file, still inside the root) and capped.
// Shared by routes/map.mjs and the jobs, brain and Studio features; they never edit it.
import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadBrainForms } from "../../../company/lib/brain-files.mjs";
import { BRAIN_FOLDERS, isBrainPath } from "../../../company/lib/job-files.mjs";
import { readChecked } from "./taskfiles.mjs";

// The nine basics of 32.3: form id, file, title. Pinned here so nothing waits for the form files.
export const BASICS = [
  { form: "about", file: "company/about.md", title: "About the company" },
  { form: "brand", file: "brand/brand.md", title: "Brand" },
  { form: "cant-say", file: "brand/cant-say.md", title: "What we never say" },
  { form: "services", file: "pricing/services.md", title: "What we sell" },
  { form: "terms", file: "pricing/terms.md", title: "Terms" },
  { form: "refunds", file: "policies/refunds.md", title: "Refunds" },
  { form: "support-promise", file: "policies/support-promise.md", title: "Our support promise" },
  { form: "team", file: "people/team.md", title: "Team" },
  { form: "ideal-customer", file: "customers/ideal-customer.md", title: "Ideal customer" },
];

// The folders of 32.1, with their titles; `loose` is the files directly in the root.
export const FOLDERS = [
  { id: "company", title: "Company basics" }, { id: "brand", title: "Brand" }, { id: "pricing", title: "Prices and services" },
  { id: "policies", title: "Policies" }, { id: "people", title: "People" }, { id: "customers", title: "Customers" },
  { id: "calls", title: "Calls and meetings" }, { id: "references", title: "References" }, { id: "packs", title: "Packs" },
  { id: "loose", title: "Loose files" },
];

const PLACEHOLDER = "(not filled in yet)";
const FILLED_BYTES = 40;
const READ_MAX = 262144;
const NAME_OK = /^[^./\0\n\r][^/\0\n\r]{0,199}$/;
const ROOM_ENDINGS = [".mp4", ".mov", ".m4v", ".mp3", ".m4a", ".wav", ".png", ".jpg", ".jpeg"];
const ROOM_MAX = 200;
const COUNT_MAX = 5000;

// A file's token in the brain (32.2): base64url of its path inside the root.
export const brainToken = (rel) => Buffer.from(String(rel), "utf8").toString("base64url");

// The title of a path for the owner: a basic's form title, a folder's title, else the file's name.
export function brainTitle(rel) {
  const basic = BASICS.find((b) => b.file === rel);
  if (basic) return basic.title;
  if (typeof rel === "string" && rel.endsWith("/")) return FOLDERS.find((f) => f.id === rel.slice(0, -1))?.title || rel.slice(0, -1);
  return String(rel || "").split("/").pop();
}

// ---- the required headings of the forms, read from engine/company/brain/forms (cached by modified time)
let formsCache = { key: null, required: null };

function requiredHeadings(config) {
  const dir = join(config.engineDir, "company", "brain", "forms");
  let key = dir;
  try {
    for (const n of readdirSync(dir).sort()) {
      try { const s = statSync(join(dir, n)); key += `|${n}:${s.mtimeMs}:${s.size}`; } catch { key += `|${n}:-`; }
    }
  } catch { key += "|none"; }
  if (formsCache.key === key) return formsCache.required;
  let required = null;
  try {
    const { forms } = loadBrainForms(dir);
    if (forms.length) {
      required = new Map(forms.map((f) => [`${f.folder}/${f.file}`, new Set(f.fields.filter((x) => x.required).map((x) => x.label))]));
    }
  } catch { required = null; }
  formsCache = { key, required };
  return required;
}

// The `## ` sections of a Markdown text: [{ heading, lines }].
function sectionsOf(text) {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) { cur = { heading: line.slice(3).trim(), lines: [] }; out.push(cur); } else if (cur) cur.lines.push(line.trim());
  }
  return out;
}

const isPlaceholder = (sec) => sec.lines.includes(PLACEHOLDER);

// A file that came from a form is not filled when a required heading holds the placeholder line, or when
// every one of its sections does (nothing at all was filled in, whatever the headings say).
function formFileFilled(text, rel, config) {
  const secs = sectionsOf(text);
  if (secs.length && secs.every((s) => isPlaceholder(s) && s.lines.filter(Boolean).length === 1)) return false;
  const req = requiredHeadings(config);
  if (!req) return !text.split("\n").some((l) => l.trim() === PLACEHOLDER);
  const want = req.get(rel);
  if (!want) return !text.split("\n").some((l) => l.trim() === PLACEHOLDER);
  return !secs.some((s) => want.has(s.heading) && isPlaceholder(s));
}

// Regular files directly in a folder of the brain (or its root), with no dot and no link: [{ name, size, mtimeMs }].
function filesIn(dir, max) {
  let names;
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory()) return [];
    names = readdirSync(dir);
  } catch { return []; }
  const out = [];
  for (const name of names) {
    if (out.length >= max) break;
    if (!NAME_OK.test(name)) continue;
    try {
      const st = lstatSync(join(dir, name));
      if (st.isFile()) out.push({ name, size: st.size, mtimeMs: st.mtimeMs });
    } catch { /* gone */ }
  }
  return out;
}

// brainFileState(config, rel) -> "filled" | "empty" | "missing" (32.4). `rel` is a path inside the brain: a
// file, or a folder ending "/" (filled when it holds at least one file).
export function brainFileState(config, rel) {
  const root = config?.paths?.knowledgeDocs;
  if (!root || !isBrainPath(rel)) return "missing";
  if (rel.endsWith("/")) {
    const dir = join(root, rel.slice(0, -1));
    try { if (!lstatSync(dir).isDirectory()) return "missing"; } catch { return "missing"; }
    return filesIn(dir, 1).length ? "filled" : "empty";
  }
  const got = readChecked(join(root, rel), root, { maxBytes: READ_MAX });
  if (!got) return "missing";
  if (got.size < FILLED_BYTES) return "empty";
  if (!BASICS.some((b) => b.file === rel)) return "filled";
  const text = got.bytes.toString("utf8").replace(/\r\n?/g, "\n");
  return formFileFilled(text, rel, config) ? "filled" : "empty";
}

// basics(config) -> [{ form, file, title, state }] for the nine basics, in the order of 32.3.
export function basics(config) {
  return BASICS.map((b) => ({ ...b, state: brainFileState(config, b.file) }));
}

// The files of one folder of the brain (an id of 32.1, `loose` or `any` for all), newest first, at most `max`:
// [{ path, name, size, changedAt }].
export function brainFiles(config, folder, { max = 100 } = {}) {
  const root = config?.paths?.knowledgeDocs;
  if (!root) return [];
  const folders = folder === "any" ? ["loose", ...BRAIN_FOLDERS] : [folder];
  const out = [];
  for (const f of folders) {
    if (f !== "loose" && !BRAIN_FOLDERS.includes(f)) continue;
    for (const x of filesIn(f === "loose" ? root : join(root, f), COUNT_MAX)) {
      out.push({ path: f === "loose" ? x.name : `${f}/${x.name}`, name: x.name, size: x.size, mtimeMs: x.mtimeMs });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : 1));
  return out.slice(0, max).map((x) => ({ path: x.path, name: x.name, size: x.size, changedAt: new Date(x.mtimeMs).toISOString() }));
}

// The number of files in the brain: the root and the nine folders.
export function brainFileCount(config) {
  const root = config?.paths?.knowledgeDocs;
  if (!root) return 0;
  let n = filesIn(root, COUNT_MAX).length;
  for (const f of BRAIN_FOLDERS) n += filesIn(join(root, f), COUNT_MAX).length;
  return n;
}

// roomFiles(config) -> [{ name, size, changed }]: the Studio room's files (37.3), names only, at most 200,
// newest first; [] when the folder is not there. The server never opens them.
export function roomFiles(config) {
  const dir = join(config?.paths?.state || "", "media", "room");
  if (!config?.paths?.state) return [];
  const list = filesIn(dir, COUNT_MAX).filter((x) => ROOM_ENDINGS.some((e) => x.name.toLowerCase().endsWith(e)));
  list.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : 1));
  return list.slice(0, ROOM_MAX).map((x) => ({ name: x.name, size: x.size, changed: new Date(x.mtimeMs).toISOString() }));
}
