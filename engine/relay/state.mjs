// Reading the model files of the state folder (CONTRACTS C2) with one trust rule, the same as
// the Python one: a regular file (not a link), owned by this user, no write bit for group or
// others, at most 1 MB. Anything else is "untrusted" and is never read. Nothing is cached:
// callers read again on every use.
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { AGENT_ID_RE, SECRET_RE, SLUG_RE } from "./token.mjs";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MODEL_RE = /^[a-z0-9.-]{1,80}$/;
export const KEY_RE = /^[\x21-\x7e]{16,512}$/;
const MODES = new Set(["plans", "provider"]);

function fits(st) {
  return st.isFile() && st.uid === process.getuid() && (st.mode & 0o022) === 0 && st.size <= MAX_FILE_BYTES;
}

export function trusted(path) {
  try {
    return fits(lstatSync(path));
  } catch {
    return false;
  }
}

// The file's text when it exists and is trusted; "missing" when it does not exist; null
// otherwise. The file is opened without following a link and checked on the open handle, so
// a swap between the check and the read changes nothing.
function readTrusted(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return err && err.code === "ENOENT" ? "missing" : null;
  }
  try {
    const st = fstatSync(fd);
    if (!fits(st)) return null;
    const buf = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    for (;;) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
      if (size > MAX_FILE_BYTES) return null;
    }
    return buf.subarray(0, size).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function parseObject(text) {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// { ok: true, missing, mode, picks, data } or { ok: false, problem }.
// No file is plans mode. `picks` maps a slug to its model and holds only well-formed pairs;
// `data` is the whole file for the home server (null when missing).
export function readModelState(path) {
  const text = readTrusted(path);
  if (text === "missing") return { ok: true, missing: true, mode: "plans", picks: Object.create(null), data: null };
  if (text === null) return { ok: false, problem: "untrusted" };
  const data = parseObject(text);
  if (data === null) return { ok: false, problem: "not_json" };
  if (!MODES.has(data.mode)) return { ok: false, problem: "bad_mode" };
  const picks = Object.create(null);
  const raw = data.picks;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const slug of Object.keys(raw)) {
      const entry = raw[slug];
      const model = entry !== null && typeof entry === "object" ? entry.model : undefined;
      if (SLUG_RE.test(slug) && typeof model === "string" && MODEL_RE.test(model)) picks[slug] = model;
    }
  }
  return { ok: true, missing: false, mode: data.mode, picks, data };
}

// `<state>/ids.json` `agents: { slug: id }` as a map, keeping only well-formed pairs; null
// when the file is missing, untrusted or not an object with `agents`.
export function readIds(path) {
  const text = readTrusted(path);
  if (text === null || text === "missing") return null;
  const data = parseObject(text);
  const agents = data && data.agents;
  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) return null;
  const out = Object.create(null);
  for (const slug of Object.keys(agents)) {
    const id = agents[slug];
    if (SLUG_RE.test(slug) && typeof id === "string" && AGENT_ID_RE.test(id)) out[slug] = id;
  }
  return out;
}

// The relay's secret: 64 hex characters, then an optional newline. Null otherwise.
export function readSecret(path) {
  const text = readTrusted(path);
  if (text === null || text === "missing") return null;
  const s = text.endsWith("\n") ? text.slice(0, -1) : text;
  return SECRET_RE.test(s) ? s : null;
}

// The provider key: one line of printable characters. Null when missing, untrusted or malformed.
export function readKey(path) {
  const text = readTrusted(path);
  if (text === null || text === "missing") return null;
  const k = text.trim();
  return KEY_RE.test(k) ? k : null;
}
