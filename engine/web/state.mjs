// The web door's files (PLAN-V5 K1, K11): its block of the switches file, read on every
// call; the owner's list of visits (`web-visits.jsonl`, newest last, cut back to 5,000 lines
// when it reaches 5,500 lines or 8 MB); and the per-agent rate window. Zero dependencies.
import {
  closeSync, constants, fstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { readDoorsState } from "../doors/common.mjs";
import { HOST_RE } from "./address.mjs";

export const MAX_VISITS = 5000;
// The list is cut back to MAX_VISITS lines only when it holds this many more, so a call past
// 5,000 does not rewrite the whole file.
export const VISITS_SLACK = 500;
// An address as written in the list (JSON-escaped, UTF-8) is at most this many bytes, so a
// line stays under 1.3 KB and 5,500 lines under 8 MB.
export const VISIT_URL_BYTES = 1024;
// The most of the list anyone reads (its end), and the size at which it is cut back; a cut
// keeps at most VISITS_KEEP_BYTES.
export const VISITS_READ_BYTES = 8 * 1024 * 1024;
export const VISITS_KEEP_BYTES = 6 * 1024 * 1024;
const KINDS = ["fetch", "search", "watch"];
const INVISIBLE = /[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/g;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const hostList = (list) => (Array.isArray(list) ? list : [])
  .map((h) => (typeof h === "string" ? h.trim().toLowerCase().replace(/^\*?\./, "") : ""))
  .filter((h) => HOST_RE.test(h));
const count = (v, def) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : def);

// { ok: true, on, allow, block, watchHosts, search, perHour, perDay } from the switches
// file, now; { ok: false } when it is untrusted or broken (the door then refuses agents).
// List entries that are not host names are dropped. An allow list whose every entry was
// dropped allows nothing (never "any site").
export function readWebState(path) {
  const st = readDoorsState(path);
  if (!st.ok) return { ok: false };
  const w = st.web;
  const allow = hostList(w.allow);
  return {
    ok: true,
    on: w.on === true,
    allow: allow.length === 0 && Array.isArray(w.allow) && w.allow.length > 0 ? [""] : allow,
    block: hostList(w.block),
    watchHosts: hostList(w.watchHosts),
    search: w.search === "brave" ? "brave" : "keyless",
    perHour: count(w.perHour, 60),
    perDay: count(w.perDay, 300),
  };
}

// An address as the owner's list shows it: control and invisible characters removed, a lone
// half of a character pair replaced (JSON would write it as six bytes), at most 1024
// characters and at most VISIT_URL_BYTES once written as JSON (a quote or a backslash
// counts two, any other character its length in UTF-8).
export function visitUrl(text) {
  const s = String(text === undefined || text === null ? "" : text)
    .replace(INVISIBLE, "")
    .slice(0, 1024)
    .toWellFormed();
  let bytes = 0;
  let end = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const n = ch === "\"" || ch === "\\" ? 2 : c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes + n > VISIT_URL_BYTES) break;
    bytes += n;
    end += ch.length;
  }
  return s.slice(0, end);
}

// The visits file's newest lines, read without following a link: { ok, whole, lines }. A
// file larger than `maxBytes` is read from its end, its first (perhaps partial) line dropped,
// and `whole` is false. `ok` is false, with no lines, when the file is there but is not a
// regular file of this user (with `strict`, also one a group or others may write) or could
// not be read. A missing file is ok, whole and empty. Only `visitCalls` may tell a caller
// that counts toward a cap what such a read leaves out.
export function readVisits(path, { strict = false, maxBytes = VISITS_READ_BYTES } = {}) {
  const bad = { ok: false, whole: false, lines: [] };
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return err && err.code === "ENOENT" ? { ok: true, whole: true, lines: [] } : bad;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (strict && (st.mode & 0o022) !== 0)) return bad;
    const from = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(st.size - from);
    let size = 0;
    while (size < buf.length) {
      const n = readSync(fd, buf, size, buf.length - size, from + size);
      if (n === 0) break;
      size += n;
    }
    let start = 0;
    if (from > 0) {
      const nl = buf.subarray(0, size).indexOf(0x0a);
      start = nl === -1 ? size : nl + 1;
    }
    return { ok: true, whole: from === 0, lines: buf.subarray(start, size).toString("utf8").split("\n").filter((l) => l !== "") };
  } catch {
    return bad;
  } finally {
    closeSync(fd);
  }
}

// The lines only, for a reader that counts nothing.
export function readVisitLines(path) {
  return readVisits(path).lines;
}

// A line's time (ms): its `at`, or for the line a cut starts with, the time it gives; NaN if
// it has none.
function lineTime(line) {
  let v;
  try { v = JSON.parse(line); } catch { return NaN; }
  if (!v || typeof v !== "object") return NaN;
  return Date.parse(typeof v.cut === "string" ? v.cut : v.at);
}

// What a read of the visits file (readVisits) says about the calls after `since` (ms), up to
// `now`: { calls: [{ slug, kind, status, t }], gone }. `gone` is null when no line after
// `since` can be missing from the read; otherwise it is the newest time whose lines may be
// missing: `now` when the file could not be read, the oldest time read when only its end
// was, or the time a cut gives (the newest line it dropped). A caller counting toward a cap
// must take the calls up to `gone` as unknown, so as many as the cap: it fails closed.
export function visitCalls(read, since, now) {
  const calls = [];
  let gone = read && read.ok ? -Infinity : now;
  let oldest = Infinity;
  for (const line of read && read.ok ? read.lines : []) {
    let v;
    try { v = JSON.parse(line); } catch { continue; }
    if (!v || typeof v !== "object") continue;
    if (Object.hasOwn(v, "cut")) {
      const c = typeof v.cut === "string" ? Date.parse(v.cut) : NaN;
      gone = Math.max(gone, Number.isFinite(c) ? c : now);
      continue;
    }
    const t = Date.parse(v.at);
    if (!Number.isFinite(t)) continue;
    oldest = Math.min(oldest, t);
    if (typeof v.slug !== "string" || !KINDS.includes(v.kind) || t <= since || t > now) continue;
    calls.push({ slug: v.slug, kind: v.kind, status: v.status, t });
  }
  if (read && read.ok && !read.whole) gone = Math.max(gone, Number.isFinite(oldest) ? oldest : now);
  return { calls, gone: gone > since ? gone : null };
}

// The owner's list. `add(entry)` appends one line (0600, folder 0700, never through a link).
// When the file reaches max + slack lines, or VISITS_READ_BYTES, it is rewritten (temp file
// and rename) with its newest lines, at most `max` and VISITS_KEEP_BYTES, after one line
// { "cut": <the time of the newest line dropped> }, so a reader knows calls up to then are
// gone. A file found too big to read whole is cut at the first add. A failure to write
// changes nothing for the caller.
export function visitsFile(path, { max = MAX_VISITS, slack = VISITS_SLACK } = {}) {
  let lines = null; // lines in the file, as last counted; null: count again
  const write = (line) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      if (!fstatSync(fd).isFile()) return 0;
      writeSync(fd, `${line}\n`);
      return fstatSync(fd).size;
    } finally {
      closeSync(fd);
    }
  };
  const trim = () => {
    const read = readVisits(path);
    if (!read.ok) {
      lines = null;
      return;
    }
    const all = read.lines;
    let k = all.length; // all[k..] are kept
    let bytes = 0;
    while (k > 0 && all.length - k < max) {
      const n = Buffer.byteLength(all[k - 1]) + 1;
      if (bytes + n > VISITS_KEEP_BYTES || /^\{"cut":/.test(all[k - 1])) break;
      bytes += n;
      k -= 1;
    }
    let cut = -Infinity;
    for (let i = 0; i < k; i += 1) {
      const t = lineTime(all[i]);
      if (Number.isFinite(t)) cut = Math.max(cut, t);
    }
    if (!read.whole) {
      // What was not read is older than the first line that was.
      const first = all.map(lineTime).find(Number.isFinite);
      if (first !== undefined) cut = Math.max(cut, first);
    }
    if (!Number.isFinite(cut)) cut = Date.now();
    const keep = [JSON.stringify({ cut: new Date(cut).toISOString() }), ...all.slice(k)];
    const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, `${keep.join("\n")}\n`, { mode: 0o600, flag: "wx" });
      renameSync(tmp, path);
      lines = keep.length;
    } catch {
      lines = null;
      try { unlinkSync(tmp); } catch { /* nothing was left */ }
    }
  };
  return {
    add(entry) {
      try {
        if (lines === null) {
          const read = readVisits(path);
          lines = read.ok && read.whole ? read.lines.length : Infinity;
        }
        const size = write(JSON.stringify(entry));
        lines += 1;
        if (lines >= max + slack || size >= VISITS_READ_BYTES) trim();
      } catch {
        lines = null;
      }
    },
  };
}

// Calls per agent in the last hour and day. `seed(read, now)` counts the calls already in the
// owner's list (readVisits' answer), so a restart does not reset the caps; when that list may
// be missing calls of the last day (visitCalls' `gone`), every call is refused until a day
// after `gone`, as if the daily cap had been used up then. `admit(slug, now, perHour,
// perDay)` returns null and counts the call, or the seconds to wait.
export function rateWindow() {
  const calls = new Map(); // slug -> sorted times (ms), newest last, at most one day
  let blindUntil = -Infinity;
  const prune = (list, now) => {
    let k = 0;
    while (k < list.length && list[k] <= now - DAY) k += 1;
    if (k > 0) list.splice(0, k);
  };
  return {
    seed(read, now) {
      const seen = visitCalls(read, now - DAY, now);
      for (const c of seen.calls) {
        if (!calls.has(c.slug)) calls.set(c.slug, []);
        calls.get(c.slug).push(c.t);
      }
      for (const list of calls.values()) list.sort((a, b) => a - b);
      if (seen.gone !== null) blindUntil = Math.max(blindUntil, seen.gone + DAY);
    },
    admit(slug, now, perHour, perDay) {
      if (now < blindUntil) return Math.max(1, Math.ceil((blindUntil - now) / 1000));
      if (!calls.has(slug)) calls.set(slug, []);
      const list = calls.get(slug);
      prune(list, now);
      let wait = 0;
      if (list.length >= perDay) {
        wait = perDay === 0 ? DAY : list[list.length - perDay] + DAY - now;
      }
      const inHour = list.filter((t) => t > now - HOUR);
      if (inHour.length >= perHour) {
        wait = Math.max(wait, perHour === 0 ? HOUR : inHour[inHour.length - perHour] + HOUR - now);
      }
      if (wait > 0) return Math.max(1, Math.ceil(wait / 1000));
      list.push(now);
      return null;
    },
  };
}
