// Reads the routine files, engine/company/routines/<id>.json (CONTRACTS-V2 section 18), and
// checks every rule. A missing folder is an empty list. A file that breaks a rule is left out
// and named in `problems` with one plain sentence. Nothing here touches the board.
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KEYS = ["id", "title", "agent", "when", "ask", "produces", "runMinutes"];
const WHEN_KEYS = ["cron", "timezone", "plain"];
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const CRON_FIELD = /^[0-9*/,-]+$/;
const TIMEZONE = /^[A-Za-z_]+\/[A-Za-z_]+$/;
const MAX_BYTES = 64 * 1024;

// Tool names the owner never reads outside Health and Settings (CONTRACTS-V2, rules at the top).
export const TOOL_NAMES = ["paperclip", "Frappe", "ERPNext", "MariaDB", "sandbox-runtime", "Claude", "Codex",
  "CadQuery", "Pillow", "Ollama", "Kestra", "Aseprite", "Piskel"];
const ABSOLUTE = ["/Users/", "~/", "/private/", "/tmp/"];

export const isWhole = (v) => Number.isInteger(v);
export const plainList = (keys, and = "or") => keys.length < 2 ? keys.join("") : `${keys.slice(0, -1).join(", ")} ${and} ${keys.at(-1)}`;

// What is wrong with a text the owner and the agents read, as the end of a sentence, or null.
export function badText(text) {
  const path = ABSOLUTE.find((a) => text.includes(a));
  if (path) return "names a full path on this Mac";
  const tool = TOOL_NAMES.find((t) => new RegExp(`(^|[^A-Za-z])${t.replace(/[-]/g, "\\-")}([^A-Za-z]|$)`, "i").test(text));
  if (tool) return "names a tool by name";
  return null;
}

// roles: the agents of the company file, as loadCompanyFile gives them ({ slug, limits }),
// or plain { slug, runMinutes }.
const runMinutesOf = (role) => role.limits?.runMinutes ?? role.runMinutes;

// Every problem of one routine, as plain sentences. An empty list means the routine is usable.
export function routineProblems(doc, file, roles) {
  const out = [];
  const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!obj(doc)) return ["It is not a routine: it should be one object with an id, a title and the rest."];
  const extra = Object.keys(doc).filter((k) => !KEYS.includes(k));
  const missing = KEYS.filter((k) => !(k in doc));
  if (missing.length) out.push(`It has no ${plainList(missing)}.`);
  if (extra.length) out.push(`It has keys a routine does not take: ${plainList(extra, "and")}.`);

  if ("id" in doc) {
    if (typeof doc.id !== "string" || !ID.test(doc.id)) out.push("Its id must be lower-case letters, digits and dashes, starting with a letter.");
    else if (`${doc.id}.json` !== file) out.push(`Its id must match the file name (${doc.id}.json).`);
  }
  if ("title" in doc && (typeof doc.title !== "string" || doc.title.trim().length < 1 || doc.title.length > 80)) {
    out.push("Its title must be 1 to 80 characters.");
  }
  let role = null;
  if ("agent" in doc) {
    role = typeof doc.agent === "string" ? roles.find((r) => r.slug === doc.agent) || null : null;
    if (!role) out.push("It names an agent that is not in the company file.");
  }
  if ("when" in doc) {
    const w = doc.when;
    if (!obj(w)) out.push("Its when must have a cron line, a timezone and a plain sentence.");
    else {
      const wMissing = WHEN_KEYS.filter((k) => !(k in w));
      const wExtra = Object.keys(w).filter((k) => !WHEN_KEYS.includes(k));
      if (wMissing.length) out.push(`Its when has no ${plainList(wMissing)}.`);
      if (wExtra.length) out.push(`Its when has keys it does not take: ${plainList(wExtra, "and")}.`);
      if ("cron" in w) {
        const fields = typeof w.cron === "string" ? w.cron.trim().split(/\s+/) : [];
        if (fields.length !== 5 || !fields.every((f) => CRON_FIELD.test(f))) out.push("Its schedule must be five cron fields of digits, *, /, commas and dashes.");
      }
      if ("timezone" in w && (typeof w.timezone !== "string" || !TIMEZONE.test(w.timezone))) {
        out.push("Its timezone must look like Asia/Kolkata.");
      }
      if ("plain" in w && (typeof w.plain !== "string" || w.plain.trim().length < 1 || w.plain.length > 40)) {
        out.push("Its plain schedule must be 1 to 40 characters.");
      }
    }
  }
  if ("ask" in doc) {
    if (typeof doc.ask !== "string" || doc.ask.trim().length < 20 || doc.ask.length > 2000) out.push("Its ask must be 20 to 2000 characters.");
    else {
      const bad = badText(doc.ask);
      if (bad) out.push(`Its ask ${bad}.`);
    }
  }
  if ("produces" in doc) {
    const p = doc.produces;
    if (!Array.isArray(p) || p.length < 1 || p.length > 5) out.push("It must list 1 to 5 files it produces.");
    else if (!p.every((x) => typeof x === "string" && x.length > 0 && x.length <= 120 && !x.startsWith("/") && !x.startsWith("~")
      && !x.includes("\\") && !x.split("/").includes("..") && !/[\0\n\r]/.test(x))) {
      out.push("Each file it produces must be a relative path inside the goal's folder that does not step out of it.");
    }
  }
  if ("runMinutes" in doc) {
    const most = role ? runMinutesOf(role) : null;
    if (!isWhole(doc.runMinutes) || doc.runMinutes < 1) out.push("Its run time must be a whole number of minutes from 1.");
    else if (Number.isInteger(most) && doc.runMinutes > most) out.push(`Its run time is longer than the agent's limit of ${most} minutes.`);
  }
  return out;
}

export function loadRoutineFiles(dir, roles = []) {
  const routines = [];
  const problems = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return { routines, problems };
    throw e;
  }
  const titles = new Map();
  for (const file of names.filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort()) {
    const path = join(dir, file);
    const st = lstatSync(path);
    if (!st.isFile()) { problems.push({ file, problem: "It is not a plain file." }); continue; }
    if (st.size > MAX_BYTES) { problems.push({ file, problem: "It is too large for a routine file." }); continue; }
    let doc;
    try { doc = JSON.parse(readFileSync(path, "utf8")); } catch { problems.push({ file, problem: "It is not valid JSON." }); continue; }
    const found = routineProblems(doc, file, roles);
    if (!found.length && titles.has(doc.title)) found.push(`Its title is already used by ${titles.get(doc.title)}.`);
    if (found.length) { for (const problem of found) problems.push({ file, problem }); continue; }
    titles.set(doc.title, file);
    routines.push({ ...doc, when: { ...doc.when }, produces: [...doc.produces], file });
  }
  return { routines, problems };
}
