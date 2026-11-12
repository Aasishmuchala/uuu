// The web door's files (PLAN-V5 K1, K11): its block of the switches file, read on every
// call; the owner's list of visits (`web-visits.jsonl`, newest last, cut to 5,000 lines);
// and the per-agent rate window. Zero dependencies.
import {
  closeSync, constants, fstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { readDoorsState } from "../doors/common.mjs";
import { HOST_RE } from "./address.mjs";

export const MAX_VISITS = 5000;
const VISITS_READ_BYTES = 8 * 1024 * 1024;
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

// An address as the owner's list shows it: control and invisible characters removed, at
// most 1024 characters.
export function visitUrl(text) {
  return String(text === undefined || text === null ? "" : text)
    .replace(/[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩﻿]/g, "")
    .slice(0, 1024);
}

// The visits file's lines (whole lines only), read without following a link; [] when it is
// missing, not a regular file of this user, or too big to be ours.
export function readVisitLines(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return [];
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || st.size > VISITS_READ_BYTES) return [];
    const buf = Buffer.alloc(st.size);
    let size = 0;
    while (size < st.size) {
      const n = readSync(fd, buf, size, st.size - size, null);
      if (n === 0) break;
      size += n;
    }
    return buf.subarray(0, size).toString("utf8").split("\n").filter((l) => l !== "");
  } catch {
    return [];
  } finally {
    closeSync(fd);
  }
}

// The owner's list. `add(entry)` appends one line (0600, folder 0700, never through a link)
// and, past 5,000 lines, rewrites the file with the newest 5,000 (temp file and rename).
// A failure to write changes nothing for the caller.
export function visitsFile(path, { max = MAX_VISITS } = {}) {
  let lines = null;
  const write = (line) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      if (!fstatSync(fd).isFile()) return;
      writeSync(fd, `${line}\n`);
    } finally {
      closeSync(fd);
    }
  };
  const trim = () => {
    const all = readVisitLines(path);
    if (all.length <= max) {
      lines = all.length;
      return;
    }
    const keep = all.slice(all.length - max);
    const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, `${keep.join("\n")}\n`, { mode: 0o600, flag: "wx" });
      renameSync(tmp, path);
      lines = keep.length;
    } catch {
      try { unlinkSync(tmp); } catch { /* nothing was left */ }
    }
  };
  return {
    add(entry) {
      try {
        if (lines === null) lines = readVisitLines(path).length;
        write(JSON.stringify(entry));
        lines += 1;
        if (lines > max) trim();
      } catch {
        lines = null;
      }
    },
  };
}

// Calls per agent in the last hour and day. `seed(lines, now)` counts calls already in the
// owner's list (so a restart does not reset the caps); `admit(slug, now, perHour, perDay)`
// returns null and counts the call, or the seconds to wait.
export function rateWindow() {
  const calls = new Map(); // slug -> sorted times (ms), newest last, at most one day
  const prune = (list, now) => {
    let k = 0;
    while (k < list.length && list[k] <= now - DAY) k += 1;
    if (k > 0) list.splice(0, k);
  };
  return {
    seed(lines, now) {
      for (const line of lines) {
        let v;
        try { v = JSON.parse(line); } catch { continue; }
        if (!v || typeof v.slug !== "string" || !["fetch", "search", "watch"].includes(v.kind)) continue;
        const t = Date.parse(v.at);
        if (!Number.isFinite(t) || t <= now - DAY || t > now) continue;
        if (!calls.has(v.slug)) calls.set(v.slug, []);
        calls.get(v.slug).push(t);
      }
      for (const list of calls.values()) list.sort((a, b) => a - b);
    },
    admit(slug, now, perHour, perDay) {
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
