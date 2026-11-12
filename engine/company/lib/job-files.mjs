// Reads the job files, engine/company/jobs/<department>/<id>.json (CONTRACTS-V3 31.2), and
// checks every rule. A missing folder is an empty list. A job that breaks a rule is left out,
// never thrown; each problem is one plain sentence, with the file it is in
// (`<department>/<id>.json`). Nothing here touches the board.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { badText, plainList } from "./routine-files.mjs";

export const KEYS = ["id", "department", "cluster", "title", "summary", "handoff", "stage", "who", "size", "planFirst",
  "reads", "asks", "needs", "takes", "text", "produces"];
export const HANDOFFS = ["you-lead", "you-approve", "on-its-own"];
export const STAGES = [1, 2, 3, 4];
export const SIZES = ["XS", "S", "M", "L", "XL"];
// The names of 31.4, in the order a job's reason is chosen.
export const NEEDS = ["internet", "account", "cad-tools", "artist-tools", "slides", "video", "speech", "books", "quotations"];
export const ASK_KINDS = ["line", "text", "date", "number", "choice", "file", "media", "task"];
// The company brain's folders (32.1); `loose` is the files directly in its root.
export const BRAIN_FOLDERS = ["company", "brand", "pricing", "policies", "people", "customers", "calls", "references", "packs"];
const ASK_KEYS = ["id", "label", "kind", "required"];
const ASK_EXTRA = { choice: "options", file: "folder" };
const TAKES_KEYS = ["from", "ask", "label"];
const ID = /^[a-z][a-z0-9-]{1,50}$/;
const ASK_ID = /^[a-z][a-z0-9-]{0,30}$/;
const JOB_REF = /^[a-z][a-z0-9-]{1,30}\/[a-z][a-z0-9-]{1,50}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._'()-]{0,99}$/;
// Control characters, line and paragraph separators, and the invisible and direction-changing format characters.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
const MAX_BYTES = 64 * 1024;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, least, most) => typeof v === "string" && v.trim().length >= least && v.length <= most;

// The ids inside [ ] in a job's text, in order, without repeats.
export function asksIn(t) {
  const out = [];
  for (const m of String(t).matchAll(/\[([^\[\]]*)\]/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// A path inside the company brain: `<folder>/<file>`, `<folder>/` (at least one file in it),
// or a file directly in its root. Never absolute, never stepping out.
export function isBrainPath(p) {
  if (typeof p !== "string" || p.length < 1 || p.length > 120 || /[\0\n\r\\]/.test(p)) return false;
  const parts = p.split("/");
  if (parts.includes("..") || parts.includes(".")) return false;
  if (parts.length === 1) return NAME.test(p);
  if (parts.length !== 2 || !BRAIN_FOLDERS.includes(parts[0])) return false;
  return parts[1] === "" || NAME.test(parts[1]);
}

const isProduct = (x) => typeof x === "string" && x.length > 0 && x.length <= 120 && !x.startsWith("/") && !x.startsWith("~")
  && !x.includes("\\") && !x.split("/").includes("..") && !/[\0\n\r]/.test(x);

function askProblems(a, n) {
  const out = [];
  const label = `Its question ${n}`;
  if (!obj(a)) return [`${label} is not a question.`];
  const known = ASK_KINDS.includes(a.kind);
  const allowed = ASK_EXTRA[a.kind] ? [...ASK_KEYS, ASK_EXTRA[a.kind]] : known ? ASK_KEYS : [...ASK_KEYS, ...Object.values(ASK_EXTRA)];
  const missing = (known ? allowed : ASK_KEYS).filter((k) => !(k in a));
  const extra = Object.keys(a).filter((k) => !allowed.includes(k));
  if (missing.length) out.push(`${label} has no ${plainList(missing)}.`);
  if (extra.length) out.push(`${label} has keys a question of this kind does not take: ${plainList(extra, "and")}.`);
  if ("id" in a && (typeof a.id !== "string" || !ASK_ID.test(a.id))) out.push(`${label} needs an id of up to 31 lower-case letters, digits and dashes, starting with a letter.`);
  if ("label" in a && (!text(a.label, 1, 80) || !/[?:]$/.test(a.label))) out.push(`${label} needs a label of 1 to 80 characters that ends with ? or :.`);
  if ("kind" in a && !ASK_KINDS.includes(a.kind)) out.push(`${label} needs a kind of ${plainList(ASK_KINDS)}.`);
  if ("required" in a && typeof a.required !== "boolean") out.push(`${label} needs required as true or false.`);
  if (a.kind === "choice" && "options" in a) {
    const o = a.options;
    if (!Array.isArray(o) || o.length < 2 || o.length > 8 || !o.every((x) => text(x, 1, 60)) || new Set(o).size !== o.length) {
      out.push(`${label} needs 2 to 8 different options of 1 to 60 characters.`);
    }
  }
  if (a.kind === "file" && "folder" in a && !(a.folder === "any" || a.folder === "loose" || BRAIN_FOLDERS.includes(a.folder))) {
    out.push(`${label} needs a folder of the company brain, or any.`);
  }
  return out;
}

// Every problem of one job, as plain sentences. folder: the department folder it is in.
// roles: the agents of the company file ({ slug, name }); departments: as loadDepartmentFile gives them.
export function jobProblems(doc, file, folder, roles, departments) {
  const out = [];
  if (!obj(doc)) return ["It is not a job: it should be one object with an id, a title and the rest."];
  const missing = KEYS.filter((k) => !(k in doc));
  const extra = Object.keys(doc).filter((k) => !KEYS.includes(k));
  if (missing.length) out.push(`It has no ${plainList(missing)}.`);
  if (extra.length) out.push(`It has keys a job does not take: ${plainList(extra, "and")}.`);

  if ("id" in doc) {
    if (typeof doc.id !== "string" || !ID.test(doc.id)) out.push("Its id must be lower-case letters, digits and dashes, starting with a letter.");
    else if (`${doc.id}.json` !== file) out.push(`Its id must match the file name (${doc.id}.json).`);
  }
  const dep = departments.find((d) => d.id === folder) || null;
  if (!dep) out.push(`It is in the folder ${folder}, which is not a department.`);
  if ("department" in doc && doc.department !== folder) out.push(`Its department must be ${folder}, as its folder says.`);
  if ("cluster" in doc && dep && !dep.clusters.some((c) => c.id === doc.cluster)) {
    out.push(`Its cluster must be one of ${plainList(dep.clusters.map((c) => c.id))}.`);
  }
  // The title and the summary go into the Chief of staff's instructions as one {{JOBS}} line each, so neither
  // may hold a line break or a control character that could start a line of its own there.
  if ("title" in doc && (!text(doc.title, 1, 60) || CONTROL.test(doc.title))) out.push("Its title must be 1 to 60 characters on one line.");
  if ("summary" in doc && (!text(doc.summary, 1, 140) || /[.?!]\s+\S/.test(doc.summary.trim()) || CONTROL.test(doc.summary))) {
    out.push("Its summary must be one sentence of 1 to 140 characters.");
  }
  if ("handoff" in doc && !HANDOFFS.includes(doc.handoff)) out.push(`Its hand-off must be ${plainList(HANDOFFS)}.`);
  if ("stage" in doc && !STAGES.includes(doc.stage)) out.push("Its stage must be 1, 2, 3 or 4.");
  if ("size" in doc && !SIZES.includes(doc.size)) out.push("Its size must be XS, S, M, L or XL.");
  if ("planFirst" in doc && typeof doc.planFirst !== "boolean") out.push("Its planFirst must be true or false.");

  let who = null;
  if ("who" in doc) {
    const w = doc.who;
    if (!Array.isArray(w) || w.length > 3 || !w.every((s) => typeof s === "string")) out.push("Its who must list 0 to 3 agents of the company file.");
    else if (!w.every((s) => roles.some((r) => r.slug === s))) out.push("Its who names an agent that is not in the company file.");
    else if (new Set(w).size !== w.length) out.push("Its who names the same agent twice.");
    else who = w;
  }

  if ("reads" in doc) {
    const r = doc.reads;
    if (!Array.isArray(r) || r.length > 8) out.push("It must list 0 to 8 files it reads.");
    else {
      r.forEach((x, i) => {
        const keys = obj(x) ? Object.keys(x) : [];
        if (!obj(x) || keys.length !== 2 || !("file" in x) || !("need" in x)) out.push(`Its read ${i + 1} must have a file and a need, and nothing else.`);
        else if (typeof x.file === "string" && (x.file.startsWith("/") || x.file.startsWith("~") || x.file.split("/").includes(".."))) {
          out.push(`Its read ${i + 1} must be a path inside the company brain that does not step out of it.`);
        } else if (!isBrainPath(x.file)) out.push(`Its read ${i + 1} must be a file or a folder of the company brain.`);
        else if (!["must", "helps"].includes(x.need)) out.push(`Its read ${i + 1} needs a need of must or helps.`);
      });
      const files = r.filter(obj).map((x) => x.file);
      if (new Set(files).size !== files.length) out.push("It reads the same file twice.");
    }
  }

  let asks = null;
  if ("asks" in doc) {
    const a = doc.asks;
    if (!Array.isArray(a) || a.length > 8) out.push("It must have 0 to 8 questions.");
    else {
      const before = out.length;
      a.forEach((x, i) => out.push(...askProblems(x, i + 1)));
      const ids = a.filter(obj).map((x) => x.id);
      if (new Set(ids).size !== ids.length) out.push("Two of its questions have the same id.");
      if (out.length === before) asks = a;
    }
  }

  if ("text" in doc) {
    const t = doc.text;
    if (!text(t, 20, 1500)) out.push("Its text must be 20 to 1500 characters.");
    else {
      const bad = badText(t);
      if (bad) out.push(`Its text ${bad}.`);
      if (/[\[\]]/.test(t.replace(/\[[^\[\]]*\]/g, ""))) out.push("Its text has a [ or ] that does not close.");
      else if (asks) {
        const used = asksIn(t);
        const unknown = used.filter((u) => !asks.some((x) => x.id === u));
        const unused = asks.filter((x) => !used.includes(x.id)).map((x) => x.id);
        if (unknown.length) out.push(`Its text has [${unknown[0]}], which is not one of its questions.`);
        if (unused.length) out.push(`Its question ${unused[0]} is not used in its text as [${unused[0]}].`);
      }
      if (who && who.length > 1) {
        const names = who.map((s) => roles.find((r) => r.slug === s)).filter((r) => r && typeof r.name === "string").map((r) => r.name);
        const absent = names.filter((n) => !t.toLowerCase().includes(n.toLowerCase()));
        if (absent.length) out.push(`Its text must say what each agent does; it does not name ${plainList(absent, "and")}.`);
      }
    }
  }

  if ("needs" in doc) {
    const n = doc.needs;
    if (!Array.isArray(n) || n.length > 4) out.push("It must list 0 to 4 needs.");
    else if (!n.every((x) => NEEDS.includes(x))) out.push(`Its needs must be names from ${plainList(NEEDS)}.`);
    else if (new Set(n).size !== n.length) out.push("It lists the same need twice.");
  }

  if ("takes" in doc && doc.takes !== null) {
    const k = doc.takes;
    if (!obj(k)) out.push("Its takes must be none, or say which jobs it follows, which question gets the earlier task and the button's words.");
    else {
      const kMissing = TAKES_KEYS.filter((x) => !(x in k));
      const kExtra = Object.keys(k).filter((x) => !TAKES_KEYS.includes(x));
      if (kMissing.length) out.push(`Its takes has no ${plainList(kMissing)}.`);
      if (kExtra.length) out.push(`Its takes has keys it does not take: ${plainList(kExtra, "and")}.`);
      if ("from" in k && (!Array.isArray(k.from) || k.from.length < 1 || k.from.length > 5 || !k.from.every((f) => typeof f === "string" && JOB_REF.test(f))
        || new Set(k.from).size !== k.from.length || k.from.includes(`${folder}/${doc.id}`))) {
        out.push("Its takes must follow 1 to 5 other jobs, each named as department/id.");
      }
      if ("ask" in k && asks && !asks.some((x) => x.id === k.ask && x.kind === "task")) out.push("Its takes must name one of its questions of the kind task.");
      if ("label" in k && !text(k.label, 1, 60)) out.push("Its takes needs a label of 1 to 60 characters.");
    }
  }
  if (asks && "takes" in doc && asks.some((x) => x.kind === "task") && !(obj(doc.takes) && asks.some((x) => x.kind === "task" && x.id === doc.takes.ask))) {
    out.push("It asks for an earlier task, so its takes must name that question.");
  }

  if ("produces" in doc) {
    const p = doc.produces;
    if (!Array.isArray(p) || p.length < 1 || p.length > 5) out.push("It must list 1 to 5 files it produces.");
    else if (!p.every(isProduct)) out.push("Each file it produces must be a relative path inside the goal's folder that does not step out of it.");
  }
  return out;
}

// dir: the jobs folder. roles: the agents of the company file. departments: as loadDepartmentFile
// gives them. Jobs come out in the order of the departments, then by file name.
export function loadJobFiles(dir, roles = [], departments = []) {
  const jobs = [];
  const problems = [];
  let folders;
  try {
    folders = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { jobs, problems };
    throw e;
  }
  folders = folders.filter((n) => !n.startsWith("."));
  const order = (f) => { const i = departments.findIndex((d) => d.id === f); return i < 0 ? departments.length : i; };
  folders.sort((a, b) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0));
  for (const folder of folders) {
    const path = join(dir, folder);
    if (!lstatSync(path).isDirectory()) { problems.push({ file: folder, problem: "It is not a department folder." }); continue; }
    if (!departments.some((d) => d.id === folder)) { problems.push({ file: `${folder}/`, problem: "It is not named after a department." }); continue; }
    const titles = new Map();
    for (const name of readdirSync(path).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
      const file = `${folder}/${name}`;
      const say = (problem) => problems.push({ file, problem });
      const st = lstatSync(join(path, name));
      if (!st.isFile()) { say("It is not a plain file."); continue; }
      if (st.size > MAX_BYTES) { say("It is too large for a job file."); continue; }
      let doc;
      try { doc = JSON.parse(readFileSync(join(path, name), "utf8")); } catch { say("It is not valid JSON."); continue; }
      const found = jobProblems(doc, name, folder, roles, departments);
      if (!found.length && titles.has(doc.title)) found.push(`Its title is already used by ${titles.get(doc.title)}.`);
      if (found.length) { for (const p of found) say(p); continue; }
      titles.set(doc.title, file);
      jobs.push({ ...structuredClone(doc), file });
    }
  }
  return { jobs, problems };
}
