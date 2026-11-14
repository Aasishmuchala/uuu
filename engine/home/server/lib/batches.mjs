// The owner's approved batches (PLAN-V5 K13, C10): `<state>/doors/batches/<id>.json`, the only files that let the
// generation door spend. The home server is their only writer, at the moment the owner approves a cost (a film's
// shotlist, inbox/staged.mjs; a still job's Start). What a file holds is worked out here and nowhere else:
//   - the shots, kinds, models and seconds the owner saw priced (the models from the owner's Settings, never from
//     an agent's file);
//   - the budget in US cents: the sum of each shot's price as the door prices it (lib/generation.mjs priceCents, the
//     door's table at the owner's Higgsfield rate from the switches file), times its takes (two for a film: one
//     retake a shot; one for a still), never a number read from a file;
//   - `approvedAt` now and `expiresAt` seven days later; never `frozen` (the door counts refusals itself, C6).
// A file is written whole under a temp name (0600, never through a link) and renamed into place, in a folder of
// this user's (0700) that is not a link, then read back with the door's own readBatch: a file the door would not
// take is removed and the approval fails. Each write also removes files more than 30 days past their expiry.
// The only other write is closing (closeBatches): the owner's yes taken back when its film or job ends sooner.
// generationNow is the money as the owner's cards show it: the switch, the key's presence (never the key), the
// caps and models from the switches file, and what the door's own ledger says was spent today and this month.
import { randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { readLedger, totalsOf } from "../../../generate/ledger.mjs";
import { KINDS, VIDEO_KINDS } from "../../../generate/runway.mjs";
import { BATCH_DAYS, MAX_TAKES, readBatch, readTrustedBytes } from "../../../generate/state.mjs";
import { HF_DEFAULTS, doorKeySaved, hfRateOk, readDoors } from "./doors.mjs";
import { HomeError } from "./errors.mjs";
import { priceCents } from "./generation.mjs";
import { BATCH_ID } from "./staged.mjs";

export { BATCH_ID };
export const KEEP_DAYS = 30;
const DAY_MS = 24 * 3600_000;
const SHOT = /^[a-z][a-z0-9_-]{0,31}$/;   // a shot's key in the file: s01, v1, u1 (the door takes any of these)
const TASK = /^[A-Za-z0-9-]{1,64}$/;
const SLUG = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_SHOTS = 50;
const MAX_FILE = 16 * 1024;
const MAX_LISTED = 5000;
const FILE = /^b[0-9a-f]{20}\.json$/;

const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

const unsafe = () => new HomeError(409, "The engine's private folder for the doors is not safe to write to.",
  "Look at Health, then try again.", "folder_unsafe");
const notWritten = () => new HomeError(500, "The approval could not be written in a form the generation door accepts, so nothing was approved.",
  "Try again. If it keeps happening, look at Health.", "batch_not_written");

// "b" and 20 hex characters.
export const newBatchId = () => `b${randomBytes(10).toString("hex")}`;

// A folder of ours, made 0700 when missing; refused when it is a link, not a folder or not this user's.
function privateFolder(path) {
  if (typeof path !== "string" || !path) throw unsafe();
  if (!lstatOrNull(path)) {
    try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e?.code !== "EEXIST") throw unsafe(); }
  }
  const st = lstatOrNull(path);
  if (!st || !st.isDirectory() || st.uid !== process.getuid()) throw unsafe();
  if ((st.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

// The batches folder, checked (and the doors folder above it): its path.
function batchesFolder(config) {
  const dir = config?.paths?.batches;
  if (typeof dir !== "string" || !dir) throw unsafe();
  privateFolder(typeof config.paths.doors === "string" && config.paths.doors ? config.paths.doors : dirname(dir));
  privateFolder(dir);
  return dir;
}

// The file's shots and budget from the owner's approved shots: { shots, budget }. Throws on anything the door's
// prices or the file's shape do not allow (the caller has checked them; this is the last word).
function shotsOf(list, takes, textToVideo, centsPerCredit) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SHOTS) throw new Error("writeBatch: one to fifty shots");
  const shots = Object.create(null);
  let budget = 0;
  for (const s of list) {
    if (!isObject(s) || typeof s.id !== "string" || !SHOT.test(s.id) || Object.hasOwn(shots, s.id)) throw new Error("writeBatch: a shot's id");
    if (!KINDS.includes(s.kind)) throw new Error("writeBatch: a shot's kind");
    if (s.kind === "text_to_video" && textToVideo !== true) throw new Error("writeBatch: a shot from words alone in a batch that does not allow them");
    const video = VIDEO_KINDS.includes(s.kind);
    const credits = priceCents({ kind: s.kind, model: s.model, seconds: video ? s.seconds : undefined }, { centsPerCredit });
    if (credits === null) {
      throw new HomeError(409, "The generation door has no price for the model chosen in Settings, so nothing was approved.",
        "Choose another model in Settings, then try again.", "no_price");
    }
    shots[s.id] = video ? { kind: s.kind, model: s.model, maxSeconds: s.seconds, takes } : { kind: s.kind, model: s.model, takes };
    budget += credits * takes;
  }
  return { shots, budget };
}

// Removes the files of this folder whose `expiresAt` is more than 30 days past. Only regular files of the home
// server's own names, read with the door's trust rule; anything else is left as it is. Never throws.
function sweep(dir, now) {
  let names = [];
  try { names = readdirSync(dir).slice(0, MAX_LISTED); } catch { return; }
  for (const name of names) {
    if (!FILE.test(name)) continue;
    const path = join(dir, name);
    try {
      const bytes = readTrustedBytes(path, MAX_FILE);
      if (!Buffer.isBuffer(bytes)) continue;
      const v = JSON.parse(bytes.toString("utf8"));
      const expires = isObject(v) && typeof v.expiresAt === "string" && v.expiresAt.length <= 40 ? Date.parse(v.expiresAt) : NaN;
      if (Number.isFinite(expires) && expires < now - KEEP_DAYS * DAY_MS) unlinkSync(path);
    } catch { /* left as it is */ }
  }
}

// Writes `<dir>/<id>.json` whole: a new temp file of this user's (0600, never through a link), synced, then
// renamed into place over whatever was there. -> true, or false with nothing left behind.
function putWhole(dir, id, doc) {
  const tmp = join(dir, `.${id}.${randomBytes(6).toString("hex")}.tmp`);
  let fd;
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const buf = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, "utf8");
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, join(dir, `${id}.json`));
    return true;
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch { /* closed */ }
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    return false;
  }
}

// The owner's Higgsfield rate as the switches file holds it now (5 when it cannot be read: a file the door cannot read
// spends nothing anyway).
export function rateNow(config) {
  try {
    const r = readDoors(config).state.generate.higgsfield.centsPerCredit;
    return hfRateOk(r) ? r : HF_DEFAULTS.centsPerCredit;
  } catch { return HF_DEFAULTS.centsPerCredit; }
}

// writeBatch(config, { id?, task, slug: "artist", shots: [{ id, kind, model, seconds }], takes, textToVideo, now,
// centsPerCredit }) -> { id, budget, expiresAt }. `centsPerCredit` is the rate the owner's price was worked out at (the
// switches file's now when left out). Throws a HomeError (409 folder_unsafe, 409 batch_exists, 409 no_price, 500
// batch_not_written) or, for arguments no caller of the home server sends, an Error; nothing is left behind then.
export function writeBatch(config, { id, task, slug = "artist", shots, takes, textToVideo = false, now = Date.now(), centsPerCredit } = {}) {
  const at = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(at)) throw new Error("writeBatch: now");
  const batchId = id === undefined || id === null ? newBatchId() : id;
  if (typeof batchId !== "string" || !BATCH_ID.test(batchId)) throw new Error("writeBatch: not a batch id");
  if (typeof task !== "string" || !TASK.test(task)) throw new Error("writeBatch: not a task id");
  if (typeof slug !== "string" || !SLUG.test(slug)) throw new Error("writeBatch: not an agent");
  if (!Number.isInteger(takes) || takes < 1 || takes > MAX_TAKES) throw new Error("writeBatch: takes");
  const rate = centsPerCredit === undefined ? rateNow(config) : centsPerCredit;
  if (!hfRateOk(rate)) throw new Error("writeBatch: centsPerCredit");
  const made = shotsOf(shots, takes, textToVideo === true, rate);
  const dir = batchesFolder(config);
  sweep(dir, at);
  const approvedAt = new Date(at).toISOString();
  const expiresAt = new Date(at + BATCH_DAYS * DAY_MS).toISOString();
  const doc = { id: batchId, task, slug, approvedAt, expiresAt, budgetCredits: made.budget, textToVideo: textToVideo === true, shots: made.shots };
  const file = join(dir, `${batchId}.json`);
  if (lstatOrNull(file)) {
    throw new HomeError(409, "An approval with this id is already there, so nothing was approved.", "Try again.", "batch_exists");
  }
  if (!putWhole(dir, batchId, doc)) throw notWritten();
  // The door's own reading of what was written: a file it would not take approves nothing.
  const back = readBatch(dir, batchId, { slug, now: at });
  if (!back.ok || back.batch.budgetCredits !== made.budget || Object.keys(back.batch.shots).length !== Object.keys(made.shots).length) {
    try { unlinkSync(file); } catch { /* already gone */ }
    throw notWritten();
  }
  return { id: batchId, budget: made.budget, expiresAt };
}

// removeBatch(config, id) -> true when a file was removed. Only an id of the home server's own form is touched.
export function removeBatch(config, id) {
  const dir = config?.paths?.batches;
  if (typeof dir !== "string" || !dir || typeof id !== "string" || !BATCH_ID.test(id)) return false;
  try {
    unlinkSync(join(dir, `${id}.json`));
    return true;
  } catch (e) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

// ---- the owner's yes taken back (T48 F4)
// A batch lives seven days, but the film or still job it was approved for may end sooner: the owner accepts or picks
// it, the owner stops it, its task is cancelled, or a newer approval of the same goal replaces it. A task the board
// shows done is not closed by that alone (T49f N1): the owner may still send a finished film back for a retake, and
// the yes for up to two takes a shot holds until the owner accepts or stops it, or the batch expires. Then it is closed: written again
// whole with `expiresAt` now (and `closedAt`), so the door's own readBatch answers "expired" from then on, while
// Studio and Settings still read what was approved. A file that cannot be written again is removed; either way the
// door spends nothing more on it. A file of another form, or one the trust rule refuses, is one the door refuses
// too, and is left as it is.

const timeOf = (v) => (typeof v === "string" && v.length <= 40 ? Date.parse(v) : NaN);

// Closes one file when it is an open batch of one of `tasks`: "closed", "removed" or null (left as it is).
function closeOne(dir, id, tasks, now) {
  const path = join(dir, `${id}.json`);
  const bytes = readTrustedBytes(path, MAX_FILE);
  if (!Buffer.isBuffer(bytes)) return null;
  let v;
  try { v = JSON.parse(bytes.toString("utf8")); } catch { return null; }
  if (!isObject(v) || v.id !== id || typeof v.task !== "string" || !tasks.has(v.task)) return null;
  const approved = timeOf(v.approvedAt);
  const expires = timeOf(v.expiresAt);
  if (Number.isFinite(expires) && expires <= now) return null;               // already closed or ended
  const at = new Date(now).toISOString();
  // A close time that is not after the approval (a clock set back) cannot be written as an end: the file goes.
  if (Number.isFinite(approved) && approved < now && putWhole(dir, id, { ...v, expiresAt: at, closedAt: at })) {
    const back = readBatch(dir, id, { slug: typeof v.slug === "string" ? v.slug : "artist", now });
    if (!back.ok) return "closed";
  }
  try { unlinkSync(path); } catch (e) { if (e?.code !== "ENOENT") throw e; }
  return "removed";
}

// closeBatches(config, tasks, { keep, now, log }) -> the ids closed (or removed). Every open batch whose task is one
// of `tasks` (ids), except the batch `keep`. Never throws: a file that can be neither closed nor removed is logged.
export function closeBatches(config, tasks, { keep = null, now = Date.now(), log = () => {} } = {}) {
  const want = new Set((Array.isArray(tasks) ? tasks : []).filter((t) => typeof t === "string" && TASK.test(t)));
  const dir = config?.paths?.batches;
  const out = [];
  if (!want.size || typeof dir !== "string" || !dir || !Number.isFinite(now)) return out;
  let names = [];
  try { names = readdirSync(dir).slice(0, MAX_LISTED); } catch { return out; }
  for (const name of names) {
    if (!FILE.test(name)) continue;
    const id = name.slice(0, -5);
    if (id === keep) continue;
    try {
      const done = closeOne(dir, id, want, now);
      if (done) {
        out.push(id);
        try { log(`batches: ${done} ${id}: its task was accepted, stopped, cancelled or approved again`); } catch { /* logging never fails a close */ }
      }
    } catch (e) {
      try { log(`batches: ${id} could not be closed: ${String(e?.code || e?.message || e).split("\n")[0]}`); } catch { /* as above */ }
    }
  }
  return out;
}

// The batches of every task the board lists as cancelled, closed (the hold sweep of lib/unstick.mjs calls this with
// the board's list each minute): a film or still job's task cancelled by anyone spends nothing more. A task shown
// done keeps its batch until the owner accepts it (inbox/goals.mjs), stops it, or it expires (T49f N1). -> the ids
// closed. Never throws.
export function closeFinishedBatches(config, issues, opts = {}) {
  const finished = (Array.isArray(issues) ? issues : [])
    .filter((i) => i && typeof i.id === "string" && i.status === "cancelled")
    .map((i) => i.id);
  return closeBatches(config, finished, opts);
}

// generationNow(config, now) -> { on, key, daily, monthly, models, centsPerCredit, ledgerOk, spentDay, spentMonth,
// dayLeft, monthLeft, paused } (money in cents; `centsPerCredit` the owner's Higgsfield rate). `on` is false whenever the switches file cannot be used; the spent and left numbers are null
// when the ledger cannot be read (the door then spends nothing). Never throws.
export function generationNow(config, now = Date.now()) {
  let state;
  let problem = "unread";
  try { ({ state, problem } = readDoors(config)); } catch { state = null; }
  const g = state?.generate || { on: false, dailyCredits: 0, monthlyCredits: 0, models: {}, resumedAt: undefined, higgsfield: HF_DEFAULTS };
  let key = false;
  try { key = doorKeySaved(config, "runway") === true; } catch { key = false; }
  const resumed = typeof g.resumedAt === "string" ? Date.parse(g.resumedAt) : NaN;
  let totals = null;
  try {
    const r = readLedger(config.paths.ledger);
    if (r.ok) totals = totalsOf(r.lines, now, { resumedAt: Number.isFinite(resumed) ? resumed : null });
  } catch { totals = null; }
  const daily = g.dailyCredits;
  const monthly = g.monthlyCredits;
  return {
    on: problem === null && g.on === true,
    key,
    daily, monthly,
    models: { ...(g.models || {}) },
    centsPerCredit: g.higgsfield && hfRateOk(g.higgsfield.centsPerCredit) ? g.higgsfield.centsPerCredit : HF_DEFAULTS.centsPerCredit,
    ledgerOk: totals !== null,
    spentDay: totals ? totals.day : null,
    spentMonth: totals ? totals.month : null,
    dayLeft: totals ? Math.max(0, daily - totals.day) : null,
    monthLeft: totals ? Math.max(0, monthly - totals.month) : null,
    paused: totals ? totals.paused === true : false,
  };
}
