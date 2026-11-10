// Writes apply's files in the engine's state folder. Every helper first looks, then writes
// only what differs, and in check mode writes nothing. Each returns "created", "updated"
// or "unchanged".
import { chmodSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function look(path) {
  try { return lstatSync(path); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

export function ensureDir(path, { check, mode = 0o755 }) {
  const st = look(path);
  if (st && st.isDirectory() && !st.isSymbolicLink()) return "unchanged";
  if (st) throw new Error(`${path} is in the way: it should be a folder`);
  if (!check) mkdirSync(path, { recursive: true, mode });
  return "created";
}

// Creates an empty file when missing; never changes one that exists.
export function ensureFile(path, { check, mode = 0o644 }) {
  const st = look(path);
  if (st && st.isFile()) return "unchanged";
  if (st) throw new Error(`${path} is in the way: it should be a file`);
  if (!check) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    closeSync(openSync(path, "wx", mode));
    chmodSync(path, mode);
  }
  return "created";
}

// Writes the whole file when its text or mode differs. The new text goes to a temp file
// first and is renamed over, so a reader never sees half a file and a link is replaced.
export function writeIfChanged(path, text, { check, mode = 0o644 }) {
  const st = look(path);
  if (st && st.isFile()) {
    const same = readFileSync(path, "utf8") === text;
    if (same && (st.mode & 0o7777) === mode) return "unchanged";
    if (same) {
      if (!check) chmodSync(path, mode);
      return "updated";
    }
  }
  if (!check) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, text, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  }
  return st ? "updated" : "created";
}
