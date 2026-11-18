// Brain notes (PLAN-BRAIN B8): for a task the home server made (routes/ask.mjs, goals.mjs, jobs.mjs), what the
// brain's index holds about it, written to <state>/brain/notes/<task id>.json for the brain door to serve.
//   - Built only with the brain switch on (`brainOn`), after the board has taken the task, never awaited in the
//     response path. The query is the task's title and the owner's own words for it, at most 2,000 characters;
//     never the task's text and never anything read back from the board.
//   - Nothing is added to the task's text. Any failure is one log line and `false`; buildNotes never rejects.
//   - The file is written to a new temp name (wx, 0600) in the notes folder and renamed. The folder must be a
//     plain 0700 folder of this user inside a plain <state>/brain; a link or anything else there is refused.
//   - Each build removes notes older than 30 days and, above 2,000 files, the oldest.
import { randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync,
  renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ask, NOTICE } from "../../../brain/retrieve.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { readDoors } from "../lib/doors.mjs";
import { indexFor } from "./indexer.mjs";

export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
export const NOTES_VERSION = 1;
export const QUERY_MAX = 2000;
export const RESULTS_MAX = 8;
export const CHARS_MAX = 6000;
export const KEEP_DAYS = 30;
export const KEEP_FILES = 2000;
export const NOTES_BYTES = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.json$/;
const TMP_NAME = /^\.[0-9a-f]{12}\.tmp$/;

const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const realOrNull = (p) => { try { return realpathSync(p); } catch { return null; } };
const firstLine = (e) => String(e?.message || e).split("\n")[0].slice(0, 200);
const logOf = (ctx) => (typeof ctx?.log === "function" ? ctx.log : () => {});
const mine = (st) => typeof process.getuid !== "function" || st.uid === process.getuid();

// The brain switch, as the home server reads it (lib/doors.mjs). Never throws: anything wrong is off.
export function brainOn(config) {
  try {
    return readDoors(config)?.state?.brain?.on === true;
  } catch {
    return false;
  }
}

// The query: the title, a line break, the owner's words; at most 2,000 characters.
function queryOf(title, text) {
  const t = typeof title === "string" ? title.trim() : "";
  const w = typeof text === "string" ? text.trim() : "";
  return (w && w !== t ? `${t}\n${w}` : t).slice(0, QUERY_MAX).trim();
}

// A plain 0700 folder of this user, made when missing; null when it is a link or anything else.
function ownFolder(path) {
  if (!lstatOrNull(path)) {
    try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e?.code !== "EEXIST") return null; }
  }
  const st = lstatOrNull(path);
  if (!st || !st.isDirectory() || !mine(st)) return null; // lstat: a link is never a directory
  if ((st.mode & 0o777) !== 0o700) { try { chmodSync(path, 0o700); } catch { return null; } }
  return path;
}

// <state>/brain/notes, inside the state folder's own `brain`; null when anything on the way is not ours.
function notesDir(config) {
  const { state, brainDir, brainNotes } = config?.paths || {};
  if (typeof state !== "string" || typeof brainDir !== "string" || typeof brainNotes !== "string") return null;
  if (!ownFolder(brainDir) || !ownFolder(brainNotes)) return null;
  const stateReal = realOrNull(state);
  if (!stateReal || realOrNull(brainNotes) !== join(stateReal, "brain", "notes")) return null;
  return brainNotes;
}

// Notes older than 30 days go; above 2,000 files the oldest go. Stale temp files of this module's naming go.
function prune(dir, nowMs) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  const kept = [];
  for (const n of names) {
    const isNote = NOTE_NAME.test(n);
    if (!isNote && !TMP_NAME.test(n)) continue;
    const st = lstatOrNull(join(dir, n));
    if (!st || !(st.isFile() || st.isSymbolicLink())) continue;
    const old = nowMs - st.mtimeMs > KEEP_DAYS * DAY_MS;
    if (!isNote ? nowMs - st.mtimeMs > 60 * 1000 : old || st.isSymbolicLink()) {
      try { unlinkSync(join(dir, n)); } catch { /* gone */ }
      continue;
    }
    if (isNote) kept.push({ n, t: st.mtimeMs });
  }
  if (kept.length <= KEEP_FILES) return;
  kept.sort((a, b) => a.t - b.t || (a.n < b.n ? -1 : 1));
  for (const { n } of kept.slice(0, kept.length - KEEP_FILES)) { try { unlinkSync(join(dir, n)); } catch { /* gone */ } }
}

function writeNotes(dir, taskId, body) {
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, body, { mode: 0o600, flag: "wx" });
    chmodSync(tmp, 0o600);
    renameSync(tmp, join(dir, `${taskId}.json`));
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    throw e;
  }
}

// buildNotes(ctx, { taskId, title, text }) -> Promise<boolean>; never rejects.
export async function buildNotes(ctx, { taskId, title, text } = {}) {
  const log = logOf(ctx);
  try {
    // The route's answer goes first: nothing below runs in the turn that made the task.
    await new Promise((resolve) => setImmediate(resolve));
    if (typeof taskId !== "string" || !TASK_ID.test(taskId)) {
      log("brain notes: the task's id is not one the notes can be named by, so none were made.");
      return false;
    }
    const query = queryOf(title, text);
    if (!query) return false;
    const config = ctx.config;
    const indexer = indexFor(config);
    try { indexer.ensureFresh(ctx); } catch { /* the index as it is */ }
    let ix = indexer.open();
    if (!ix) {
      await indexer.rebuild(ctx);
      ix = indexer.open();
    }
    if (!ix) {
      log(`brain notes: there is no index yet, so no notes were made for ${taskId}.`);
      return false;
    }
    let found;
    try {
      found = ask(ix.db, query, { limit: RESULTS_MAX, maxChars: CHARS_MAX, basics: BASICS.map((b) => b.file) });
    } finally {
      try { ix.db.close(); } catch { /* closed */ }
    }
    const dir = notesDir(config);
    if (!dir) {
      log("brain notes: <state>/brain/notes is not a plain folder of the state folder, so no notes were written.");
      return false;
    }
    const nowMs = Date.now();
    const notes = {
      version: NOTES_VERSION, taskId, at: new Date(nowMs).toISOString(), notice: NOTICE,
      results: found.results.slice(0, RESULTS_MAX), links: found.links, notFound: found.notFound,
    };
    writeNotes(dir, taskId, `${JSON.stringify(notes)}\n`);
    prune(dir, nowMs);
    return true;
  } catch (e) {
    try { log(`brain notes: ${firstLine(e)}`); } catch { /* nothing more to do */ }
    return false;
  }
}

const isStr = (v) => typeof v === "string";
const resultOk = (r) => r && typeof r === "object" && Number.isInteger(r.n) && (r.kind === "file" || r.kind === "record")
  && isStr(r.source) && isStr(r.title) && isStr(r.locator) && isStr(r.text) && (r.at === null || isStr(r.at));

// readNotes(config, taskId) -> the notes object, or null: a plain file of this user (opened no-follow), at most
// 64 KB, of B8's shape for this task.
export function readNotes(config, taskId) {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) return null;
  const dir = config?.paths?.brainNotes;
  if (typeof dir !== "string") return null;
  let fd = null;
  try {
    fd = openSync(join(dir, `${taskId}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK || 0));
    const st = fstatSync(fd);
    if (!st.isFile() || !mine(st) || st.size > NOTES_BYTES || (st.mode & 0o022)) return null;
    const buf = Buffer.alloc(NOTES_BYTES + 1);
    let got = 0;
    for (;;) {
      const n = readSync(fd, buf, got, buf.length - got, null);
      if (n <= 0) break;
      got += n;
      if (got > NOTES_BYTES) return null;
    }
    const v = JSON.parse(buf.subarray(0, got).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    if (v.version !== NOTES_VERSION || v.taskId !== taskId || !isStr(v.at) || v.notice !== NOTICE) return null;
    if (!Array.isArray(v.results) || !Array.isArray(v.links) || !Array.isArray(v.notFound)) return null;
    if (v.results.length > RESULTS_MAX || !v.results.every(resultOk) || !v.notFound.every(isStr)) return null;
    let chars = 0;
    for (const r of v.results) chars += r.text.length;
    if (chars > CHARS_MAX) return null;
    return v;
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* closed */ } }
  }
}
