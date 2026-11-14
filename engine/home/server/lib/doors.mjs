// The doors' switches and keys (PLAN-V5 K1, K3, K11, K13): the home server is the only writer of
// `<state>/doors/state.json` and of the two keys under `<state>/secrets/doors/` (`search-key`, `runway-key`).
// A switch changes only through the owner's same-origin POST to a route that calls updateDoors; nothing an
// agent can write is read here as a setting (docs/adr/0007): the switches file is read through the doors' own
// trust rule (engine/doors/common.mjs) and checked strictly again, and a damaged or planted file means every
// door off, `problem: "state_unreadable"`, and a fresh all-off file on the next save.
// A key comes in from the owner's typing and goes out to nobody: it is never put in an answer, an error or a
// log line, and it is never read here (only whether a trusted file is there).
// callDoor calls only the local address in ctx.home.urls.<door> (null means never call, as in stub homes),
// with an owner token of that door's own secret, a time cap and a size cap.
import {
  chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { dirname, join } from "node:path";
import { DOORS_DEFAULTS, readDoorsState } from "../../../doors/common.mjs";
import { readSecret, trusted } from "../../../relay/state.mjs";
import { mintToken } from "../../../relay/token.mjs";
import { HOST_RE } from "../../../web/address.mjs";
import { HomeError } from "./errors.mjs";
import { forgetNeeds } from "./jobs.mjs";

export const DOOR_NAMES = Object.freeze(["web", "generate", "viewer"]);
export const MAX_HOSTS = 200;
export const OWNER_TOKEN_SEC = 120;
export const CALL_TIMEOUT_MS = 30000;
export const CALL_MAX_BYTES = 1024 * 1024;
const CALL_CEILING_MS = 120000;
const CALL_CEILING_BYTES = 64 * 1024 * 1024;
const RAW_MAX = 1024 * 1024;
const MAX_NUMBER = 1e9;
const MODEL_ID = /^[A-Za-z0-9._-]{1,80}$/;
const MODEL_KEYS = ["video", "videoBest", "still", "upscale"];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
// The owner's Higgsfield block (PLAN-V5 K20): its switch, off by default, and what one of its credits counts as in
// cents, whole from 1 to 50, 5 until the owner sets it. The door reads the same block (engine/generate/state.mjs
// readGenState) and refuses a block with any other key, so none is ever written.
export const HF_DEFAULTS = Object.freeze({ on: false, centsPerCredit: 5 });
export const HF_RATE_MIN = 1;
export const HF_RATE_MAX = 50;
export const hfRateOk = (v) => Number.isInteger(v) && v >= HF_RATE_MIN && v <= HF_RATE_MAX;
// Each key by its fixed name: the file it lives in and what a key of that name looks like. The search key is
// what engine/web/search.mjs accepts; the Runway key is what engine/generate/runway.mjs accepts.
const KEYS = Object.freeze({
  search: { path: "searchKey", re: /^[\x21-\x7e]{8,200}$/ },
  runway: { path: "runwayKey", re: /^key_[0-9a-f]{128}$/ },
});
// Each door's local address (in ctx.home.urls), the secret its owner tokens are made with, and the start every
// path to it must have. The preview takes the viewer's owner token (engine/viewer/preview.mjs).
const CALLS = Object.freeze({
  web: { secret: "webSecret", prefix: "/web/" },
  generate: { secret: "generateSecret", prefix: "/gen/" },
  viewer: { secret: "viewerSecret", prefix: "/view/" },
  preview: { secret: "viewerSecret", prefix: "/preview/" },
});
const LOCAL_ADDRESS = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
const DOOR_PATH = /^\/[A-Za-z0-9/_.-]{1,199}$/;
// PLAN-V5 C23: the one query a door call may carry, the viewer's `pages=` with one to three pages, each named by the
// viewer's own rule; a page with an empty or `..` part, or named twice, is refused here before anything is sent.
const QUERY_PAGE = /^[A-Za-z0-9._/-]{1,200}\.html$/;
const MAX_QUERY_PAGES = 3;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const copy = (v) => JSON.parse(JSON.stringify(v));
const whole = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_NUMBER;
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };

const unsafe = () => new HomeError(409, "The engine's private folder for the doors is not safe to write to.",
  "Run engine setup again, then try again.", "folder_unsafe");

// ---- the switches file ------------------------------------------------------------------------------------

// K1's file with every door off.
export function freshDoors() {
  return {
    version: 1,
    web: copy(DOORS_DEFAULTS.web), generate: { ...copy(DOORS_DEFAULTS.generate), higgsfield: { ...HF_DEFAULTS } },
    viewer: copy(DOORS_DEFAULTS.viewer), changedAt: null,
  };
}

// A host name as the owner's lists keep it (lower case, a leading `*.` or `.` dropped), or null when it is not one
// by K11 row 8's pattern.
export function hostName(text) {
  if (typeof text !== "string") return null;
  const h = text.trim().toLowerCase().replace(/^\*?\./, "");
  return HOST_RE.test(h) ? h : null;
}

function hostList(list) {
  if (!Array.isArray(list) || list.length > MAX_HOSTS) return null;
  const out = [];
  for (const entry of list) {
    const h = hostName(entry);
    if (h === null) return null;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

// `paused` as the generation door reads it: null, a short text, or a small object. Anything else that is set
// stays a pause ("paused"), so a damaged value never lifts one.
function pausedValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 200) || "paused";
  if (obj(v)) {
    try { if (JSON.stringify(v).length <= 2048) return copy(v); } catch { /* not plain data */ }
  }
  return "paused";
}

// The whole state, every field checked: a clean copy, or null when any field is not what the home server writes.
// `generate.resumedAt` (the owner's "Start again") is kept when it is a time; the doors' readers ignore it
// except the generation door, which reads it itself. `generate.higgsfield` is kept as { on, centsPerCredit } (missing:
// off at 5 cents a credit); a block with another key or a value of the wrong kind is not one the home server writes.
export function checkDoors(s) {
  if (!obj(s) || !obj(s.web) || !obj(s.generate) || !obj(s.viewer)) return null;
  const w = s.web;
  const g = s.generate;
  const lists = { allow: hostList(w.allow), block: hostList(w.block), watchHosts: hostList(w.watchHosts) };
  if (typeof w.on !== "boolean" || !lists.allow || !lists.block || !lists.watchHosts) return null;
  if (w.search !== "keyless" && w.search !== "brave") return null;
  if (!whole(w.perHour) || !whole(w.perDay)) return null;
  if (typeof g.on !== "boolean" || !whole(g.dailyCredits) || !whole(g.monthlyCredits) || !whole(g.autoUnderCredits)) return null;
  if (!obj(g.models)) return null;
  const models = {};
  for (const k of MODEL_KEYS) {
    const m = g.models[k] === undefined ? DOORS_DEFAULTS.generate.models[k] : g.models[k];
    if (typeof m !== "string" || !MODEL_ID.test(m)) return null;
    models[k] = m;
  }
  if (typeof s.viewer.on !== "boolean") return null;
  const h = g.higgsfield === undefined || g.higgsfield === null ? HF_DEFAULTS : g.higgsfield;
  if (!obj(h) || Object.keys(h).some((k) => k !== "on" && k !== "centsPerCredit")) return null;
  if (h.on !== undefined && typeof h.on !== "boolean") return null;
  if (h.centsPerCredit !== undefined && !hfRateOk(h.centsPerCredit)) return null;
  const generate = {
    on: g.on, dailyCredits: g.dailyCredits, monthlyCredits: g.monthlyCredits, autoUnderCredits: g.autoUnderCredits,
    paused: pausedValue(g.paused), models,
    higgsfield: { on: h.on === true, centsPerCredit: h.centsPerCredit === undefined ? HF_DEFAULTS.centsPerCredit : h.centsPerCredit },
  };
  if (typeof g.resumedAt === "string" && ISO_TIME.test(g.resumedAt) && Number.isFinite(Date.parse(g.resumedAt))) generate.resumedAt = g.resumedAt;
  return {
    version: 1,
    web: { on: w.on, ...lists, search: w.search, perHour: w.perHour, perDay: w.perDay },
    generate,
    viewer: { on: s.viewer.on },
    changedAt: typeof s.changedAt === "string" && ISO_TIME.test(s.changedAt) ? s.changedAt : null,
  };
}

// The text of a file of ours, when it passes the trust rule (a regular file, not a link, this user's, no write
// bit for group or others, at most `max` bytes), checked on the open handle; "missing" when there is none; null
// otherwise.
export function readTrustedText(path, max = RAW_MAX) {
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (e) {
    return e?.code === "ENOENT" ? "missing" : null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0 || st.size > max) return null;
    const buf = Buffer.alloc(max + 1);
    let size = 0;
    for (;;) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
      if (size > max) return null;
    }
    return buf.subarray(0, size).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// readDoors(config) -> { state, problem, missing }. `state` is the file's, checked; a missing file is every door
// off (problem null); a file the doors would not trust, or one holding anything the home server never writes, is
// every door off with problem "state_unreadable" (the next save writes a fresh file).
export function readDoors(config) {
  const path = config.paths.doorsState;
  const st = readDoorsState(path);
  if (!st.ok) return { state: freshDoors(), problem: "state_unreadable", missing: false };
  const text = readTrustedText(path);
  if (text === "missing") return { state: freshDoors(), problem: null, missing: true };
  let raw = null;
  try { raw = text === null ? null : JSON.parse(text); } catch { raw = null; }
  if (!obj(raw)) return { state: freshDoors(), problem: "state_unreadable", missing: false };
  const merged = {
    web: st.web, generate: { ...st.generate }, viewer: st.viewer,
    changedAt: raw.changedAt,
  };
  if (obj(raw.generate) && raw.generate.resumedAt !== undefined) merged.generate.resumedAt = raw.generate.resumedAt;
  if (obj(raw.generate) && raw.generate.higgsfield !== undefined) merged.generate.higgsfield = raw.generate.higgsfield;
  const state = checkDoors(merged);
  if (!state) return { state: freshDoors(), problem: "state_unreadable", missing: false };
  return { state, problem: null, missing: false };
}

// A folder of ours, made 0700 when missing; refused when it is a link, not a folder or not this user's.
function privateFolder(path) {
  if (!lstatOrNull(path)) {
    try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e?.code !== "EEXIST") throw unsafe(); }
  }
  const st = lstatOrNull(path);
  if (!st || !st.isDirectory() || st.uid !== process.getuid()) throw unsafe();
  chmodSync(path, 0o700);
}

// Written whole through a new temp file in the same folder (0600, never through a link), then renamed over the
// old one. A link planted at the name is replaced itself (rename never follows it); a folder there is refused.
function writePrivate(file, content) {
  const cur = lstatOrNull(file);
  if (cur && cur.isDirectory()) throw unsafe();
  const tmp = join(dirname(file), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    throw e;
  }
}

// updateDoors(config, fn) -> the state written. Reads the state (fresh, every door off, when it cannot be used),
// lets fn change it, checks every field, and writes it (temp file and rename, 0600 in a 0700 folder). A job's
// readiness follows at once (forgetNeeds). A change fn makes that the home server would never write is refused
// before anything is written.
export function updateDoors(config, fn) {
  const { state } = readDoors(config);
  fn(state);
  const clean = checkDoors(state);
  if (!clean) throw new Error("updateDoors: the change does not fit the switches file");
  clean.changedAt = new Date().toISOString();
  privateFolder(config.paths.doors);
  writePrivate(config.paths.doorsState, `${JSON.stringify(clean, null, 2)}\n`);
  forgetNeeds();
  return clean;
}

// ---- the keys ----------------------------------------------------------------------------------------------

function keyOf(name) {
  if (!Object.hasOwn(KEYS, name)) throw new Error("door key: unknown name");
  return KEYS[name];
}

// The key the owner typed, trimmed, when it has the form of a key of that name; null otherwise.
export function validDoorKey(name, raw) {
  const k = keyOf(name);
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return k.re.test(t) ? t : null;
}

export function doorKeySaved(config, name) {
  return trusted(config.paths[keyOf(name).path]);
}

// Saves the key as `<state>/secrets/doors/<name>-key` (0600; both folders 0700, neither a link). The key is not
// in the error when it is refused.
export function saveDoorKey(config, name, text) {
  const k = keyOf(name);
  const key = validDoorKey(name, text);
  if (key === null) throw new Error("door key: that is not a key");
  privateFolder(config.paths.secrets);
  privateFolder(config.paths.doorSecrets);
  writePrivate(config.paths[k.path], `${key}\n`);
  forgetNeeds();
}

// Whether a text the owner typed holds a saved key (or its first or last 12 characters, for a key of at least 24),
// so that text is never sent back. The keys are read here only to compare, and never kept.
export function holdsSavedKey(config, value) {
  const t = String(value ?? "");
  if (!t) return false;
  for (const k of Object.values(KEYS)) {
    const text = readTrustedText(config.paths[k.path], 4096);
    if (typeof text !== "string" || text === "missing") continue;
    const key = text.trim();
    if (!key) continue;
    if (t.includes(key) || (key.length >= 24 && (t.includes(key.slice(0, 12)) || t.includes(key.slice(-12))))) return true;
  }
  return false;
}

export function removeDoorKey(config, name) {
  const k = keyOf(name);
  try { unlinkSync(config.paths[k.path]); } catch (e) { if (e.code !== "ENOENT") throw e; }
  forgetNeeds();
}

// ---- owner tokens and calls --------------------------------------------------------------------------------

// A token of kind `t`, subject `owner`, for 120 seconds, made with that door's own secret; null when the secret
// is not there (the door makes it at its first start).
export function ownerToken(config, door) {
  if (!Object.hasOwn(CALLS, door)) return null;
  const secret = readSecret(config.paths[CALLS[door].secret]);
  if (secret === null) return null;
  return mintToken(secret, "t", "owner", Math.floor(Date.now() / 1000) + OWNER_TOKEN_SEC);
}

const bound = (v, def, ceiling) => (Number.isInteger(v) && v > 0 ? Math.min(v, ceiling) : def);

// The query of a call to the viewer: exactly `pages=<page>[,<page>[,<page>]]`; anything else is false.
function viewerQueryOk(query) {
  if (typeof query !== "string" || !query.startsWith("pages=")) return false;
  const pages = query.slice("pages=".length).split(",");
  if (pages.length < 1 || pages.length > MAX_QUERY_PAGES || new Set(pages).size !== pages.length) return false;
  return pages.every((p) => QUERY_PAGE.test(p) && p.split("/").every((part) => part !== "" && part !== "." && part !== ".."));
}

// callDoor(ctx, door, path, body, opts) -> { ok: true, status, type, json, bytes } or { ok: false, reason } with
// reason "no_address" (null in stub homes, or not a local address: nothing is called), "bad_path", "no_secret",
// "no_connection", "nothing" (no answer began in time) or "cut" (too slow or too large once begun).
// `body`: undefined or null for a GET; an object (sent as JSON) or a Buffer (opts.type) for a POST.
// opts: { auth (default true: an owner token), timeoutMs (30 s), maxBytes (1 MB), type, query }. `query` is taken only
// for the viewer and only as `pages=` with one to three page names (C23); for any other door or text it is bad_path.
export function callDoor(ctx, door, path, body, opts = {}) {
  if (!Object.hasOwn(CALLS, door)) return Promise.resolve({ ok: false, reason: "no_address" });
  const base = ctx?.home?.urls?.[door];
  const m = typeof base === "string" ? LOCAL_ADDRESS.exec(base) : null;
  if (!m || Number(m[1]) > 65535) return Promise.resolve({ ok: false, reason: "no_address" });
  if (typeof path !== "string" || !DOOR_PATH.test(path) || !path.startsWith(CALLS[door].prefix) || path.includes("..")) {
    return Promise.resolve({ ok: false, reason: "bad_path" });
  }
  const hasQuery = opts.query !== undefined && opts.query !== null;
  if (hasQuery && (door !== "viewer" || !viewerQueryOk(opts.query))) return Promise.resolve({ ok: false, reason: "bad_path" });
  const target = hasQuery ? `${path}?${opts.query}` : path;
  const headers = { accept: "application/json" };
  if (opts.auth !== false) {
    const token = ownerToken(ctx.config, door);
    if (token === null) return Promise.resolve({ ok: false, reason: "no_secret" });
    headers.authorization = `Bearer ${token}`;
  }
  let data = null;
  if (Buffer.isBuffer(body)) {
    data = body;
    headers["content-type"] = typeof opts.type === "string" && /^[a-z0-9.+/-]{1,80}$/.test(opts.type) ? opts.type : "application/octet-stream";
  } else if (body !== undefined && body !== null) {
    data = Buffer.from(JSON.stringify(body));
    headers["content-type"] = "application/json";
  }
  if (data) headers["content-length"] = data.length;
  const limitMs = bound(opts.timeoutMs, CALL_TIMEOUT_MS, CALL_CEILING_MS);
  const maxBytes = bound(opts.maxBytes, CALL_MAX_BYTES, CALL_CEILING_BYTES);
  return new Promise((resolve) => {
    let done = false;
    let began = false;
    let chunks = [];
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); if (!v.ok) chunks = []; resolve(v); } };
    const req = http.request({
      host: "127.0.0.1", port: Number(m[1]), path: target, method: data ? "POST" : "GET", headers, agent: false,
    }, (res) => {
      began = true;
      let size = 0;
      res.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > maxBytes) { finish({ ok: false, reason: "cut" }); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const type = String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        let json = null;
        if (type === "application/json") { try { json = JSON.parse(bytes.toString("utf8")); } catch { json = null; } }
        finish({ ok: true, status: res.statusCode, type, json, bytes });
      });
      res.on("error", () => finish({ ok: false, reason: "cut" }));
    });
    const timer = setTimeout(() => { finish({ ok: false, reason: began ? "cut" : "nothing" }); req.destroy(); }, limitMs);
    req.on("error", () => finish({ ok: false, reason: began ? "cut" : "no_connection" }));
    req.end(data || undefined);
  });
}
