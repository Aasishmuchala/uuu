// Reads the ready-made goal files, engine/company/goals/<department>.json (CONTRACTS-V2
// section 19), and checks every rule. A missing folder is an empty list. A file whose shape is
// wrong is left out; a goal that breaks a rule is left out of its file. Each problem is one
// plain sentence, with the file it is in. Nothing here touches the board.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { badText, plainList } from "./routine-files.mjs";

// In the order the gallery shows them; `general` shows as Company.
export const DEPARTMENTS = [
  { id: "general", title: "Company" }, { id: "books", title: "Books" }, { id: "customers", title: "Customers" },
  { id: "support", title: "Support" }, { id: "people", title: "People" }, { id: "marketing", title: "Marketing" },
  { id: "studio", title: "Studio" },
];
export const SIZES = ["XS", "S", "M", "L", "XL"];
const FILE_KEYS = ["department", "title", "goals"];
const GOAL_KEYS = ["id", "title", "summary", "text", "to", "planFirst", "size"];
const ID = /^[a-z][a-z0-9-]{1,40}$/;
// A thing to fill in: `[a few lower-case words]`.
const BLANK = /^[a-z][a-z'-]*( [a-z][a-z'-]*){0,5}$/;
const MAX_BYTES = 128 * 1024;

// The texts inside [ ], in order, without repeats.
export function blanksOf(text) {
  const out = [];
  for (const m of String(text).matchAll(/\[([^\[\]]*)\]/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Every problem of one goal (n counts from 1), as plain sentences.
export function goalProblems(g, n, roles) {
  const out = [];
  const label = `Goal ${n}`;
  if (g === null || typeof g !== "object" || Array.isArray(g)) return [`${label} is not a goal.`];
  const missing = GOAL_KEYS.filter((k) => !(k in g));
  const extra = Object.keys(g).filter((k) => !GOAL_KEYS.includes(k));
  if (missing.length) out.push(`${label} has no ${plainList(missing)}.`);
  if (extra.length) out.push(`${label} has keys a goal does not take: ${plainList(extra, "and")}.`);
  if ("id" in g && (typeof g.id !== "string" || !ID.test(g.id))) out.push(`${label} needs an id of lower-case letters, digits and dashes, starting with a letter.`);
  if ("title" in g && (typeof g.title !== "string" || g.title.trim().length < 1 || g.title.length > 60)) out.push(`${label} needs a title of 1 to 60 characters.`);
  if ("summary" in g && (typeof g.summary !== "string" || g.summary.trim().length < 1 || g.summary.length > 140)) out.push(`${label} needs a summary of 1 to 140 characters.`);
  if ("text" in g) {
    const t = g.text;
    if (typeof t !== "string" || t.trim().length < 20 || t.length > 1500) out.push(`${label} needs a text of 20 to 1500 characters.`);
    else {
      const bad = badText(t);
      if (bad) out.push(`${label}'s text ${bad}.`);
      const stray = t.replace(/\[[^\[\]]*\]/g, "");
      if (/[\[\]]/.test(stray)) out.push(`${label}'s text has a [ or ] that does not close.`);
      else if (!blanksOf(t).every((b) => BLANK.test(b))) out.push(`${label}'s text has something to fill in that is not a few lower-case words in [ ].`);
    }
  }
  if ("to" in g && g.to !== null && !(typeof g.to === "string" && roles.some((r) => r.slug === g.to))) {
    out.push(`${label} goes to an agent that is not in the company file.`);
  }
  if ("planFirst" in g && typeof g.planFirst !== "boolean") out.push(`${label} needs planFirst as true or false.`);
  if ("size" in g && !SIZES.includes(g.size)) out.push(`${label} needs a size of XS, S, M, L or XL.`);
  return out;
}

export function loadGoalFiles(dir, roles = []) {
  const departments = [];
  const problems = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { departments, problems };
    throw e;
  }
  const files = new Set(names.filter((n) => n.endsWith(".json") && !n.startsWith(".")));
  for (const file of [...files].sort()) {
    if (!DEPARTMENTS.some((d) => `${d.id}.json` === file)) problems.push({ file, problem: "It is not named after a department." });
  }
  for (const dep of DEPARTMENTS) {
    const file = `${dep.id}.json`;
    if (!files.has(file)) continue;
    const say = (problem) => problems.push({ file, problem });
    const path = join(dir, file);
    const st = lstatSync(path);
    if (!st.isFile()) { say("It is not a plain file."); continue; }
    if (st.size > MAX_BYTES) { say("It is too large for a ready-made goal file."); continue; }
    let doc;
    try { doc = JSON.parse(readFileSync(path, "utf8")); } catch { say("It is not valid JSON."); continue; }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) { say("It should be one object with a department, a title and goals."); continue; }
    const before = problems.length;
    const missing = FILE_KEYS.filter((k) => !(k in doc));
    const extra = Object.keys(doc).filter((k) => !FILE_KEYS.includes(k));
    if (missing.length) say(`It has no ${plainList(missing)}.`);
    if (extra.length) say(`It has keys a goal file does not take: ${plainList(extra, "and")}.`);
    if ("department" in doc && doc.department !== dep.id) say(`Its department must be ${dep.id}, as the file name says.`);
    if ("title" in doc && doc.title !== dep.title) say(`Its title must be ${dep.title}.`);
    if ("goals" in doc && (!Array.isArray(doc.goals) || doc.goals.length < 4 || doc.goals.length > 8)) say("It must have 4 to 8 goals.");
    if (problems.length > before) continue;

    const goals = [];
    const ids = new Set();
    doc.goals.forEach((g, i) => {
      const found = goalProblems(g, i + 1, roles);
      if (!found.length && ids.has(g.id)) found.push(`Goal ${i + 1} has the same id as another goal in the file.`);
      if (found.length) { for (const p of found) say(p); return; }
      ids.add(g.id);
      goals.push({ id: g.id, title: g.title, summary: g.summary, text: g.text, to: g.to, planFirst: g.planFirst, size: g.size });
    });
    departments.push({ id: dep.id, title: dep.title, file, goals });
  }
  return { departments, problems };
}
