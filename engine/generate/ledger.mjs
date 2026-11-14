// The generation door's ledger (PLAN-V5 K13): the owner's money, one JSON line per event in
// `<state>/doors/generate-ledger.jsonl`, appended and synced to disk before anything is sent.
// It fails closed: a file that is not this user's plain file, a torn or unreadable line, a
// field of the wrong kind, and the whole ledger is unreadable, and the door spends nothing.
// Nothing is cached: every question reads the file again. Zero dependencies.
//
// Lines: { at, job, batch, shot, slug, kind, model, seconds, estimate, state, credits,
// runwayTask, verdict }, and four fields a line may carry (K20; missing means what step 3
// meant): `provider` ("runway" | "higgsfield"; missing is Runway), `units` (Higgsfield's own
// credits), `rate` (the cents a Higgsfield credit counted as, whole 1 to 50) and `app` (an app's
// name). Money is in US cents everywhere (`credits`, `estimate`): a Runway credit is one cent.
// A Higgsfield job keeps its job id in `runwayTask` (the old name, kept so old readers read).
// `state`:
//   reserved  before the call leaves (credits = the door's estimate); written again, same job,
//             when Runway's task id or a higher price is known
//   spent     the job ended and cost `credits` (the highest of what is known)
//   released  the job cost nothing: Runway refused to start it (verdict `not_started_<4xx>`), or
//             said its cost was 0
//   paused    (job null) three refusals, or three requests Runway did not start, in a day: the
//             door stops until the owner starts it again
//   folded    (job null) `count` jobs Runway did not start, more than a day old, whose lines the
//             tidy moved to the dated file; they cost nothing and no total counts them
// A job counts what its end line says; a job with no end counts its highest reservation.
// Days and months are Asia/Kolkata's, and a job belongs to the day it was reserved.
// The door tidies the file at its own start (rotateLedger, PLAN-V5 C3): old finished jobs move,
// in order, to a dated file beside it, this month's free attempts are folded into one line, and
// nothing the totals of now depend on ever moves.
import { randomBytes } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const MAX_LEDGER_BYTES = 32 * 1024 * 1024;
export const ROTATE_OVER_BYTES = 8 * 1024 * 1024;
export const JOB_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATES = new Set(["reserved", "spent", "released", "paused", "folded"]);
const DAY_MS = 24 * 3600_000;
// The verdict of a job Runway answered with a 4xx and did not start (T48 F1).
export const NOT_STARTED_RE = /^not_started_4[0-9]{2}$/;
const MAX_FOLDED = 1_000_000_000;

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
export const dayOf = (ms) => dayFmt.format(new Date(ms));
export const monthOf = (ms) => dayOf(ms).slice(0, 7);

const str = (v) => typeof v === "string" && v.length <= 200;
const strOrNull = (v) => v === null || str(v);
const amount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
export const PROVIDERS = Object.freeze(["runway", "higgsfield"]);
export const APP_NAME_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const OPTIONAL = ["provider", "units", "rate", "app"];
// K20's optional fields: each, when present, of its own kind; anything else makes the line unreadable.
const optionalOk = (v) => (v.provider === undefined || PROVIDERS.includes(v.provider))
  && (v.units === undefined || amount(v.units))
  && (v.rate === undefined || (Number.isInteger(v.rate) && v.rate >= 1 && v.rate <= 50))
  && (v.app === undefined || (typeof v.app === "string" && APP_NAME_RE.test(v.app)));
// The optional fields a job in memory carries, for its later lines.
const extrasOf = (j) => Object.fromEntries(OPTIONAL.filter((k) => j[k] !== undefined && j[k] !== null).map((k) => [k, j[k]]));

// One line, checked; null when anything is off.
function readLine(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  if (!str(v.at) || !Number.isFinite(Date.parse(v.at)) || !STATES.has(v.state)) return null;
  if (!amount(v.credits) || !amount(v.estimate)) return null;
  if (!optionalOk(v)) return null;
  if (v.state === "paused") return v.job === null ? v : null;
  if (v.state === "folded") return v.job === null && v.credits === 0 && Number.isInteger(v.count) && v.count >= 1 && v.count <= MAX_FOLDED ? v : null;
  if (!str(v.job) || !JOB_RE.test(v.job)) return null;
  for (const k of ["batch", "shot", "slug", "kind", "model", "runwayTask", "verdict"]) if (!strOrNull(v[k])) return null;
  if (!(v.seconds === null || amount(v.seconds))) return null;
  return v;
}

// The whole file: { ok: true, lines, raws (each line's own text), size } (no file: no lines)
// or { ok: false }.
function readWhole(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return err && err.code === "ENOENT" ? { ok: true, lines: [], raws: [], size: 0 } : { ok: false };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0 || st.size > MAX_LEDGER_BYTES) return { ok: false };
    const buf = Buffer.alloc(st.size);
    let size = 0;
    while (size < st.size) {
      const n = readSync(fd, buf, size, st.size - size, null);
      if (n === 0) break;
      size += n;
    }
    if (size !== st.size) return { ok: false };
    const text = buf.toString("utf8");
    if (text === "") return { ok: true, lines: [], raws: [], size };
    if (!text.endsWith("\n")) return { ok: false };        // a torn last line
    const lines = [];
    const raws = text.slice(0, -1).split("\n");
    for (const raw of raws) {
      const line = readLine(raw);
      if (line === null) return { ok: false };
      lines.push(line);
    }
    return { ok: true, lines, raws, size };
  } catch {
    return { ok: false };
  } finally {
    closeSync(fd);
  }
}

// For each job, the optional fields its lines carry (the last line's word wins): Map(job ->
// { provider, units, rate, app }, each only when present). Old lines carry none.
export function extrasByJob(lines) {
  const out = new Map();
  for (const l of lines) {
    if (typeof l.job !== "string") continue;
    const e = extrasOf(l);
    if (Object.keys(e).length) out.set(l.job, { ...(out.get(l.job) || {}), ...e });
  }
  return out;
}

// The file's lines: { ok: true, lines } (no file: no lines) or { ok: false }.
export function readLedger(path) {
  const r = readWhole(path);
  return r.ok ? { ok: true, lines: r.lines } : { ok: false };
}

// Appends one line and syncs it to disk; throws when it could not (the caller then refuses).
export function appendLine(path, line) {
  if (readLine(JSON.stringify(line)) === null) throw new Error("ledger: a line of the wrong shape");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0) throw new Error("ledger: not the door's file");
    const buf = Buffer.from(`${JSON.stringify(line)}\n`, "utf8");
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// The jobs of a ledger's lines: Map(job -> { job, at (ms, first reservation), batch, shot,
// slug, kind, model, seconds, estimate, reserved (highest reservation), runwayTask, end (the
// last spent or released line, or null), charge }), and the times the door paused itself.
// A folded line is no job and counts nothing.
export function summarize(lines) {
  const jobs = new Map();
  const pauses = [];
  for (const l of lines) {
    const at = Date.parse(l.at);
    if (l.state === "paused") { pauses.push(at); continue; }
    if (l.state === "folded") continue;
    let j = jobs.get(l.job);
    if (!j) {
      j = { job: l.job, at, batch: l.batch, shot: l.shot, slug: l.slug, kind: l.kind, model: l.model, seconds: l.seconds,
        estimate: l.estimate, reserved: 0, runwayTask: null, end: null, charge: 0 };
      jobs.set(l.job, j);
    }
    if (l.runwayTask) j.runwayTask = l.runwayTask;
    if (l.state === "reserved") j.reserved = Math.max(j.reserved, l.credits);
    else j.end = { state: l.state, credits: l.credits, verdict: l.verdict, at: Date.parse(l.at) };
  }
  for (const j of jobs.values()) {
    j.charge = j.end === null ? j.reserved : j.end.state === "released" ? 0 : j.end.credits;
  }
  return { jobs, pauses };
}

// True when Runway answered this job of summarize() with a 4xx and did not start it.
export const notStarted = (j) => !!(j && j.end && j.end.state === "released" && typeof j.end.verdict === "string" && NOT_STARTED_RE.test(j.end.verdict));

// What has been spent or is held, as of `now`: { day, month, batch (for `batch`), unasked
// (today, with no batch), takes(shot) (jobs of `batch` and that shot that were sent), batchRefused,
// refusedRecent (moderation refusals in the last 24 hours, after `resumedAt`), notStartedRecent
// (requests Runway did not start, in the same window), notStarted(shot) (those of `batch` and that
// shot, in the same window), paused (a pause line newer than `resumedAt`), open (jobs with no end) }.
export function totalsOf(lines, now, { batch = null, resumedAt = null } = {}) {
  const { jobs, pauses } = summarize(lines);
  const day = dayOf(now);
  const month = day.slice(0, 7);
  const since = Math.max(now - DAY_MS, resumedAt === null ? -Infinity : resumedAt);
  const out = { day: 0, month: 0, batch: 0, unasked: 0, batchRefused: 0, refusedRecent: 0, notStartedRecent: 0, open: [], shots: new Map() };
  const tries = new Map();
  for (const j of jobs.values()) {
    const d = dayOf(j.at);
    if (d === day) out.day += j.charge;
    if (d.slice(0, 7) === month) out.month += j.charge;
    if (d === day && j.batch === null) out.unasked += j.charge;
    const refused = j.end && j.end.verdict === "refused";
    if (refused && j.end.at > since) out.refusedRecent += 1;
    const recentTry = notStarted(j) && j.end.at > since;
    if (recentTry) out.notStartedRecent += 1;
    if (batch !== null && j.batch === batch) {
      out.batch += j.charge;
      if (refused) out.batchRefused += 1;
      if (!(j.end && j.end.state === "released") && typeof j.shot === "string") out.shots.set(j.shot, (out.shots.get(j.shot) || 0) + 1);
      if (recentTry && typeof j.shot === "string") tries.set(j.shot, (tries.get(j.shot) || 0) + 1);
    }
    if (j.end === null) out.open.push(j);
  }
  out.takes = (shot) => out.shots.get(shot) || 0;
  out.notStarted = (shot) => tries.get(shot) || 0;
  out.paused = pauses.some((t) => resumedAt === null || t > resumedAt);
  return out;
}

// The ledger at one path. Every method reads the file again; `totals` is { ok: false } when
// the file cannot be read, and the writing methods throw when they cannot write.
export function createLedger(path) {
  const base = (fields) => ({
    at: null, job: null, batch: null, shot: null, slug: null, kind: null, model: null, seconds: null,
    estimate: 0, state: null, credits: 0, runwayTask: null, verdict: null, ...fields,
  });
  return {
    path,
    read: () => readLedger(path),
    totals(now, opts) {
      const r = readLedger(path);
      return r.ok ? { ok: true, ...totalsOf(r.lines, now, opts) } : { ok: false };
    },
    job(job) {
      const r = readLedger(path);
      return r.ok ? summarize(r.lines).jobs.get(job) || null : null;
    },
    reserve(at, fields) {
      appendLine(path, base({ ...fields, at, state: "reserved", credits: fields.estimate }));
    },
    // A later reservation for the same job: the task id, or a higher price.
    note(at, j, { credits, runwayTask }) {
      appendLine(path, base({ at, job: j.job, batch: j.batch, shot: j.shot, slug: j.slug, kind: j.kind, model: j.model,
        seconds: j.seconds, estimate: j.estimate, state: "reserved", credits, runwayTask: runwayTask || j.runwayTask || null, ...extrasOf(j) }));
    },
    settle(at, j, { state, credits, verdict, runwayTask }) {
      appendLine(path, base({ at, job: j.job, batch: j.batch, shot: j.shot, slug: j.slug, kind: j.kind, model: j.model,
        seconds: j.seconds, estimate: j.estimate, state, credits: state === "released" ? 0 : credits, runwayTask: runwayTask || j.runwayTask || null, verdict,
        ...extrasOf(j) }));
    },
    pause(at, verdict) {
      appendLine(path, base({ at, state: "paused", verdict }));
    },
  };
}

// ---- the tidy at the door's start -----------------------------------------------------------

const monthBefore = (month) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// Writes `text` to a new file (0600, never over anything, never through a link) and syncs it.
function writeNewSynced(path, text) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const buf = Buffer.from(text, "utf8");
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// The dated file the moved lines go to, beside the ledger: `<name>-<YYYY-MM-DD>.jsonl`, then
// `-2`, `-3` for a second tidy that day. Returns its path once written.
function writeMoved(path, now, text) {
  const stem = basename(path).replace(/\.jsonl$/, "");
  for (let n = 1; n <= 99; n += 1) {
    const out = join(dirname(path), `${stem}-${dayOf(now)}${n === 1 ? "" : `-${n}`}.jsonl`);
    try {
      writeNewSynced(out, text);
      return out;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }
  }
  throw new Error("ledger: no free name for the moved lines today");
}

// rotateLedger(path, now) -> { moved, kept, folded } (lines, lines, jobs). Only when the file is
// over 8 MB and is read whole by the rule of readLedger; otherwise nothing changes and all are
// 0. Keeps every line of a job whose first line is in this month or the one before
// (Asia/Kolkata), every line of a job with no end line, and every pause line, so nothing the
// door totals as of now moves; moves the rest, in order and byte for byte, to the dated file.
// Of the jobs it keeps, those Runway did not start (released, `not_started_<4xx>`) whose end is
// more than a day old count in no total of now or later: their lines move too, and one
// `folded` line with their number takes the place of the first. The dated file is written and
// synced first, then the kept lines go to a temp file in the same folder, synced and renamed
// over the ledger. Synchronous: the door calls it before any request or settling can append.
// On a failure the dated file is removed again and the ledger is as it was; the error is thrown.
export function rotateLedger(path, now) {
  const none = { moved: 0, kept: 0, folded: 0 };
  let st;
  try { st = lstatSync(path); } catch { return none; }
  if (!st.isFile() || st.size <= ROTATE_OVER_BYTES) return none;
  const r = readWhole(path);
  if (!r.ok || r.size <= ROTATE_OVER_BYTES) return none;
  const month = monthOf(now);
  const recent = new Set([month, monthBefore(month)]);
  const { jobs } = summarize(r.lines);
  const free = (j) => notStarted(j) && j.end.at <= now - DAY_MS;
  const keep = [];
  const move = [];
  const folded = new Set();
  let foldAt = -1;
  let foldFrom = null;
  r.lines.forEach((line, i) => {
    if (line.state === "paused") return void keep.push(r.raws[i]);
    if (line.state === "folded") return void (recent.has(monthOf(Date.parse(line.at))) ? keep : move).push(r.raws[i]);
    const j = jobs.get(line.job);
    if (j.end === null || recent.has(monthOf(j.at))) {
      if (!free(j)) return void keep.push(r.raws[i]);
      if (foldAt < 0) { foldAt = keep.length; foldFrom = j.at; }
      folded.add(j.job);
      move.push(r.raws[i]);
    } else move.push(r.raws[i]);
  });
  if (move.length === 0) return { moved: 0, kept: keep.length, folded: 0 };
  if (folded.size > 0) {
    const summary = {
      at: new Date(foldFrom).toISOString(), job: null, batch: null, shot: null, slug: null, kind: null, model: null, seconds: null,
      estimate: 0, state: "folded", credits: 0, runwayTask: null, verdict: "not_started", count: folded.size,
    };
    if (readLine(JSON.stringify(summary)) === null) throw new Error("ledger: a folded line of the wrong shape");
    keep.splice(foldAt, 0, JSON.stringify(summary));
  }
  const dir = dirname(path);
  const moved = writeMoved(path, now, `${move.join("\n")}\n`);
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeNewSynced(tmp, keep.length ? `${keep.join("\n")}\n` : "");
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    try { unlinkSync(moved); } catch { /* nothing was left */ }
    throw err;
  }
  try {
    const dfd = openSync(dir, constants.O_RDONLY);
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch {
    // The rename is done; syncing the folder is a courtesy some systems refuse.
  }
  return { moved: move.length, kept: keep.length, folded: folded.size };
}
