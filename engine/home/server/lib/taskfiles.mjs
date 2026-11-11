// Reading what agents wrote, safely (CONTRACTS-V2 16.1). Every file in a goal's folder
// (tasks/company-work/<identifier>/) was written by an agent, so it is untrusted: a link is never
// followed (no folder on the way and no file may be a link, and real paths must stay inside the goal's
// folder), files are opened with O_NOFOLLOW and O_NONBLOCK (a FIFO cannot hang the server), sizes and
// counts are capped, and what is read comes back as text, never as anything that runs.
// After a file is opened, the file opened must still be the one at that place (device and inode), and
// that place must still be inside the allowed folder, so a link swapped in between the checks and the
// open is refused. `openChecked` and `readChecked` are the one way the home server reads any file an
// agent can write (task folders, lessons) or the owner drops in by hand (knowledge).
// Feature tasks import this module; they never edit it.
import {
  closeSync, constants, fstatSync, lstatSync, opendirSync, openSync, readSync, realpathSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REL = 1024;                 // characters in a path inside the goal's folder
const MAX_READ = 16 * 1024 * 1024;    // the most readTaskText reads, whatever maxBytes asks for
const MAX_LIST = 10000;               // the most listTaskFiles returns, whatever max asks for
const SCAN_ENTRIES = 20000;           // entries looked at while listing one goal's folder
const SCAN_DEPTH = 16;                // folders deep while listing

const KINDS = {
  image: new Set(["png", "gif", "jpg", "jpeg", "webp", "svg"]),
  text: new Set(["md", "txt", "json", "py", "csv", "log"]),
  cad: new Set(["step", "stp"]),
};

function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

function projectRoot(config) {
  const folder = config?.paths?.projectFolder;
  if (typeof folder !== "string" || !folder) return null;
  try { return realpathSync(folder); } catch { return null; }
}

// The real path of tasks/company-work/<identifier>, or null.
export function goalFolder(config, identifier) {
  if (typeof identifier !== "string" || !IDENTIFIER.test(identifier)) return null;
  const root = projectRoot(config);
  if (!root) return null;
  const p = join(root, identifier);
  const st = lstatOrNull(p);
  if (!st || !st.isDirectory()) return null;          // lstat: a link is never a directory here
  let real;
  try { real = realpathSync(p); } catch { return null; }
  return real.startsWith(root + sep) ? real : null;
}

// The parts of a path inside a goal's folder, or null when it is not a plain relative path.
function partsOf(rel) {
  if (typeof rel !== "string" || !rel || rel.length > MAX_REL) return null;
  if (rel.includes("\\") || rel.includes("\0") || rel.startsWith("/")) return null;
  const parts = rel.split("/");
  if (parts.some((s) => !s || s === "." || s === "..")) return null;
  return parts;
}

const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK || 0);

// For tests only: called with the path just before and just after a checked open, so a test can swap a
// link in (and back out) around the open.
export const testHooks = { beforeOpen: null, afterOpen: null };

const within = (p, root) => p === root || p.startsWith(root + sep);

// Opens one file that must lie inside `root` (a folder; links in `root` itself are resolved once).
// The file is opened with O_NOFOLLOW and O_NONBLOCK (a FIFO or a device cannot hang the server), must be
// a regular file, and after the open: the path's real folder is unchanged and inside root, and the file
// at that path is the very file opened (same device and inode).
// -> { fd, st, real } (the caller reads from fd and closes it), or null with nothing left open.
export function openChecked(file, root) {
  if (typeof file !== "string" || typeof root !== "string" || !file || !root || file.includes("\0")) return null;
  const name = basename(file);
  if (!name || name === "." || name === "..") return null;
  let realRoot;
  let realParent;
  try {
    realRoot = realpathSync(root);
    realParent = realpathSync(dirname(file));
  } catch { return null; }
  if (!within(realParent, realRoot)) return null;
  const path = join(realParent, name);
  if (typeof testHooks.beforeOpen === "function") testHooks.beforeOpen(path);
  let fd;
  try {
    fd = openSync(path, OPEN_FLAGS);
    if (typeof testHooks.afterOpen === "function") testHooks.afterOpen(path);
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("not a regular file");
    if (realpathSync(dirname(path)) !== realParent) throw new Error("the folder moved");
    const now = lstatSync(path);
    if (!now.isFile() || now.dev !== st.dev || now.ino !== st.ino) throw new Error("another file is there now");
    return { fd, st, real: path };
  } catch {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
    return null;
  }
}

// openChecked, then at most maxBytes read from the opened descriptor.
// -> { bytes, size, mtimeMs, truncated, real, dev, ino } or null.
export function readChecked(file, root, { maxBytes = 262144 } = {}) {
  const cap = Number.isInteger(maxBytes) && maxBytes >= 0 ? Math.min(maxBytes, MAX_READ) : 262144;
  const opened = openChecked(file, root);
  if (!opened) return null;
  const { fd, st, real } = opened;
  try {
    const bytes = readAll(fd, Math.min(st.size, cap));
    return { bytes, size: st.size, mtimeMs: st.mtimeMs, truncated: st.size > cap, real, dev: st.dev, ino: st.ino };
  } catch {
    return null;
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
  }
}

function readAll(fd, length) {
  const buf = Buffer.alloc(length);
  let got = 0;
  while (got < length) {
    const n = readSync(fd, buf, got, length - got, got);
    if (n <= 0) break;
    got += n;
  }
  return buf.subarray(0, got);
}

// One text file of a goal: { text, size, mtimeMs, truncated } or null when it may not be read.
export function readTaskText(config, identifier, rel, { maxBytes = 262144 } = {}) {
  const base = goalFolder(config, identifier);
  const parts = partsOf(rel);
  if (!base || !parts) return null;
  const cap = Number.isInteger(maxBytes) && maxBytes >= 0 ? Math.min(maxBytes, MAX_READ) : 262144;
  let dir = base;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    const st = lstatOrNull(dir);
    if (!st || !st.isDirectory()) return null;          // a link or a file on the way is refused
  }
  const read = readChecked(join(dir, parts[parts.length - 1]), base, { maxBytes: cap });
  if (!read) return null;
  // Bytes that are not UTF-8 become U+FFFD; a character cut by the cap is dropped, not mangled.
  const text = new TextDecoder("utf-8").decode(read.bytes, { stream: read.truncated });
  return { text, size: read.size, mtimeMs: read.mtimeMs, truncated: read.truncated };
}

// Regular files of a goal's folder, at any depth: [{ name, size, mtimeMs }], sorted by name.
// Links (to files or folders) and names starting with "." are left out.
export function listTaskFiles(config, identifier, { max = 200 } = {}) {
  const base = goalFolder(config, identifier);
  if (!base) return [];
  const limit = Number.isInteger(max) && max >= 0 ? Math.min(max, MAX_LIST) : 200;
  const out = [];
  let seen = 0;
  const walk = (dir, rel, depth) => {
    let d;
    try { d = opendirSync(dir); } catch { return; }
    try {
      let e;
      while (seen < SCAN_ENTRIES && (e = d.readSync()) !== null) {
        seen += 1;
        if (e.name.startsWith(".")) continue;
        const full = join(dir, e.name);
        const name = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (depth < SCAN_DEPTH) walk(full, name, depth + 1);
          continue;
        }
        if (!e.isFile()) continue;                       // links, FIFOs, sockets, devices
        const st = lstatOrNull(full);
        if (!st || !st.isFile()) continue;
        out.push({ name, size: st.size, mtimeMs: st.mtimeMs });
      }
    } finally {
      try { d.closeSync(); } catch { /* already closed */ }
    }
  };
  walk(base, "", 0);
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out.slice(0, limit);
}

// The token of /api/files and /api/view: base64url of "<identifier>/<path>".
export function fileToken(rel) {
  return Buffer.from(String(rel), "utf8").toString("base64url");
}

export function kindOf(name) {
  const base = String(name).split("/").pop();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "file";
  const ext = base.slice(dot + 1).toLowerCase();
  for (const [kind, exts] of Object.entries(KINDS)) if (exts.has(ext)) return kind;
  return "file";
}

// Shape file-entry (CONTRACTS-V2 17.1).
export function fileEntry(identifier, name, size) {
  const token = fileToken(`${identifier}/${name}`);
  const kind = kindOf(name);
  return {
    name, size, kind,
    url: `/api/files/${token}`,
    viewUrl: kind === "image" || kind === "text" ? `/api/view/${token}` : null,
  };
}
