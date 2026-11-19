// The remote door's state (PLAN-DESKTOP, "State"): where its files live, and the one careful reader and writer
// of each. Unfenced code (ADR 0007): a file is read only when it is a real file, the owner's, readable by nobody
// else, in a folder only the owner can open, and under its size cap; otherwise it counts as "no seats".
// Zero dependencies beyond the engine's own config loader and link-free open.
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync,
  renameSync, chmodSync, unlinkSync, writeSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { openNoLinks } from "../lib/nolinks.mjs";

export const SEATS_MAX = 5;
export const SEATS_CAP = 16 * 1024;
export const KEY_RE = /^[A-Za-z0-9+/]{68}$/;
const FINGERPRINT_RE = /^SHA256:[A-Za-z0-9+/]{43}$/;
const NAME_RE = /^[A-Za-z0-9 ._'-]{1,40}$/;
export const ROLES = Object.freeze(["desk", "view"]);

// Every path the door uses, from the config (the state root resolved once, so no link on the way is followed).
export function remotePaths(cfg) {
  let state = cfg.stateRoot;
  try { state = realpathSync(state); } catch { /* not made yet: used as written */ }
  const dir = join(state, "remote");
  const secrets = join(state, "secrets", "remote");
  return {
    state,
    dir,
    seats: join(dir, "seats.json"),
    // The seats' public keys, by seat number. A file of its own beside seats.json, so seats.json keeps the
    // pinned shape the home server reads (T7); both are rebuilt into authorized_keys at every start.
    keys: join(dir, "seat-keys.json"),
    authorizedKeys: join(dir, "authorized_keys"),
    sshdConfig: join(dir, "sshd_config"),
    marker: join(dir, "on"),
    secrets,
    hostKey: join(secrets, "host_ed25519"),
    hostKeyPub: join(secrets, "host_ed25519.pub"),
    pid: join(state, "run", "remote.pid"),
    log: join(state, "logs", "remote.log"),
  };
}

// The ports the door works with. T7 adds `ports.seats` and `ports.remote` to config.json; until then 3201 and 3220.
export function remotePorts(cfg) {
  const p = cfg.ports || {};
  const num = (v, d) => (Number.isInteger(v) && v > 0 && v < 65536 ? v : d);
  const seatsFirst = num(p.seats, 3201);
  const previewFirst = num(p.preview, 3160);
  const appFirst = cfg.appPorts?.first ?? 3171;
  const appLast = cfg.appPorts?.last ?? 3189;
  const apps = [];
  for (let q = previewFirst; q < previewFirst + 10; q++) apps.push(q);
  for (let q = appFirst; q <= appLast; q++) apps.push(q);
  return {
    door: num(p.remote, 3220),
    seat: (n) => seatsFirst + n - 1,
    seatsFirst,
    apps,
    // Never forwarded for anyone (PLAN-DESKTOP, "A seat's line").
    never: [p.home, p.board, p.gate, p.gateNarrow, p.relay, p.web, p.generate, p.viewer, p.apps, p.brain,
      p.benchWeb, num(p.remote, 3220)].filter((v) => Number.isInteger(v)),
  };
}

// How many seats config allows (`remote.seats`, 1 to 5; 5 when absent), as the home server reads it (T7).
export function seatCount(cfg) {
  const n = cfg.remote?.seats;
  return Number.isInteger(n) && n >= 1 && n <= SEATS_MAX ? n : SEATS_MAX;
}

// A folder only the owner can open: a real folder (not a link), the owner's, mode 700.
export function privateFolderOk(path) {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && st.uid === process.getuid() && (st.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

// Reads a door file under rule 6. Returns its text, or null when it is missing or fails any check.
export function readPrivate(path, cap = SEATS_CAP) {
  let fd;
  try {
    fd = openNoLinks(path);
  } catch {
    return null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0 || st.size > cap) return null;
    const buf = Buffer.alloc(cap + 1);
    let got = 0;
    for (;;) {
      const n = readSync(fd, buf, got, buf.length - got, null);
      if (n === 0) break;
      got += n;
      if (got > cap) return null;
    }
    return buf.subarray(0, got).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// Makes a private folder (mode 700) and every missing parent; refuses a link or someone else's folder.
export function ensurePrivateFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const st = lstatSync(path);
  if (!st.isDirectory() || st.uid !== process.getuid()) throw new Error(`not a private folder: ${path}`);
  chmodSync(path, 0o700);
}

// Write-then-rename, mode 600, never through a link.
export function writePrivate(path, text) {
  const dir = path.slice(0, path.lastIndexOf("/"));
  ensurePrivateFolder(dir);
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* gone */ }
    throw e;
  }
}

// The SHA256 fingerprint of an ed25519 public key, as `ssh-keygen -l` prints it.
export function fingerprintOf(key) {
  return "SHA256:" + createHash("sha256").update(Buffer.from(key, "base64")).digest("base64").replace(/=+$/, "");
}

export function nameOk(name) {
  return typeof name === "string" && NAME_RE.test(name) && name.trim() === name;
}

function seatOk(s) {
  return s !== null && typeof s === "object" && !Array.isArray(s)
    && Number.isInteger(s.n) && s.n >= 1 && s.n <= SEATS_MAX
    && nameOk(s.name) && ROLES.includes(s.role)
    && (s.state === "waiting" || s.state === "allowed")
    && (s.fingerprint === null || (typeof s.fingerprint === "string" && FINGERPRINT_RE.test(s.fingerprint)))
    && (s.state === "waiting" || s.fingerprint !== null)
    && typeof s.added === "string" && s.added.length <= 40 && !Number.isNaN(Date.parse(s.added));
}

// The seats, or null when seats.json fails rule 6 or its shape. A missing file is an empty list
// (only when its folder is private, or does not exist yet).
export function readSeats(paths) {
  if (!folderUsable(paths.dir)) return null;
  const text = readPrivate(paths.seats);
  if (text === null) return missing(paths.seats) ? [] : null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data === null || typeof data !== "object" || !Array.isArray(data.seats) || data.seats.length > SEATS_MAX) return null;
  if (!data.seats.every(seatOk)) return null;
  const ns = data.seats.map((s) => s.n);
  if (new Set(ns).size !== ns.length) return null;
  return data.seats.map((s) => ({ n: s.n, name: s.name, role: s.role, state: s.state, fingerprint: s.fingerprint, added: s.added }))
    .sort((a, b) => a.n - b.n);
}

// The seats' keys by number, or null when seat-keys.json fails rule 6 or its shape.
export function readKeys(paths) {
  if (!folderUsable(paths.dir)) return null;
  const text = readPrivate(paths.keys);
  if (text === null) return missing(paths.keys) ? {} : null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data === null || typeof data !== "object" || data.keys === null || typeof data.keys !== "object" || Array.isArray(data.keys)) return null;
  const out = {};
  for (const [k, v] of Object.entries(data.keys)) {
    const n = Number(k);
    if (!/^[1-5]$/.test(k) || typeof v !== "string" || !KEY_RE.test(v)) return null;
    out[n] = v;
  }
  return out;
}

export function writeSeats(paths, seats) {
  writePrivate(paths.seats, JSON.stringify({ seats: seats.slice().sort((a, b) => a.n - b.n) }, null, 2) + "\n");
}

export function writeKeys(paths, keys) {
  const out = {};
  for (const n of Object.keys(keys).sort()) out[n] = keys[n];
  writePrivate(paths.keys, JSON.stringify({ keys: out }, null, 2) + "\n");
}

function missing(path) {
  try { lstatSync(path); return false; } catch (e) { return e.code === "ENOENT"; }
}

function folderUsable(dir) {
  return missing(dir) || privateFolderOk(dir);
}

export function markerOn(paths) {
  try { return lstatSync(paths.marker).isFile(); } catch { return false; }
}
