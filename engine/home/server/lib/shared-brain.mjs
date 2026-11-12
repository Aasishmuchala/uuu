// What the owner shares with the Researcher (PLAN-V5 K10): `<state>/knowledge/shared/`, the only company files
// the walled Researcher can read. The brand kit writes `brand-public.md` there (brain/kit.mjs); this module copies
// the owner's own text and table files of the company brain there when the owner marks them as fine to share,
// and removes the copy when they are unmarked, deleted from the brain or no longer text.
//   - a file is named only by its brain token, and only a file the brain store lists is copied: never a path
//     from a request, never a task's file, never anything an agent wrote (the brain is the owner's folder);
//   - text and tables only (`.md`, `.txt`, `.csv`, and the bytes must be UTF-8 text): never a picture or a PDF;
//   - the copy has its own clean name (lower case, plain characters, `-2` and on when the name is taken);
//   - at most 50 files and 5 MB in the folder, `brand-public.md` included;
//   - written through a temp file (0644) and renamed into a plain folder (0755) whose real path is the state
//     folder's own `knowledge/shared`, never through a link; what is replaced must be a regular file.
// Which brain file each copy came from is kept in `<state>/home/shared-brain.json` (0600), which the Researcher
// cannot read. syncShared (run by listShared) puts the folder right: a copy whose brain file was deleted or is no
// longer text is removed; one whose brain file changed is copied again.
import {
  closeSync, constants as fsConstants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, opendirSync, openSync,
  realpathSync, renameSync, rmSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { BrainError, brainFor, brainToken } from "../brain/store.mjs";
import { HomeError } from "./errors.mjs";
import { readTrustedText } from "./doors.mjs";

export const SHARE_MAX_FILES = 50;
export const SHARE_MAX_BYTES = 5 * 1024 * 1024;
export const BRAND_PUBLIC = "brand-public.md";
const MANIFEST_MAX = 256 * 1024;
const SCAN_ENTRIES = 1000;
const SHOWN_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;
const COPY_NAME = /^[a-z0-9][a-z0-9._-]{0,99}\.(md|txt|csv)$/;
const BRAIN_PATH = /^([a-z]{1,20}\/)?[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}\.(md|txt|csv)$/i;
const SHAREABLE = new Set(["text", "table"]);

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const realOrNull = (p) => { try { return realpathSync(p); } catch { return null; } };

export class ShareError extends HomeError {}
const ERR = {
  notShareable: () => new ShareError(400, "Only text and table files can be shared with the Researcher.", "Pictures and PDF files stay private.", "not_shareable"),
  notText: () => new ShareError(400, "That file is not plain text, so it was not shared.", "Save it again as text or a table, then share it.", "not_shareable"),
  tooLarge: () => new ShareError(413, "That file is too large to share.", "Text and tables can be shared up to 5 MB in all.", "share_too_large"),
  full: () => new ShareError(409, "The Researcher already has as much as it can be given.", "Stop sharing a file you no longer need, then try again.", "share_full"),
  unsafe: () => new ShareError(409, "The shared folder is not safe to write to.", "Run engine setup again, then try again.", "folder_unsafe"),
  notFound: () => new ShareError(404, "That file is not in the company brain.", "Go back to the list and pick one from there.", "file_not_found"),
};

const paths = (config) => ({
  knowledge: join(config.paths.state, "knowledge"),
  shared: config.paths.sharedBrain,
  manifest: join(config.paths.homeData, "shared-brain.json"),
});

// The shared folder's place, checked: a plain folder (not a link) whose real path is the state folder's own
// `knowledge/shared`. -> { dir, dev, ino } or null. With `create`, made 0755 when missing.
function sharedDir(config, { create = false } = {}) {
  const p = paths(config);
  const stateReal = realOrNull(config.paths.state);
  if (!stateReal) return null;
  const k = lstatOrNull(p.knowledge);
  if (!k && create) { try { mkdirSync(p.knowledge, { mode: 0o755 }); } catch (e) { if (e?.code !== "EEXIST") return null; } }
  const kst = lstatOrNull(p.knowledge);
  if (!kst || !kst.isDirectory() || realOrNull(p.knowledge) !== join(stateReal, "knowledge")) return null;
  if (!lstatOrNull(p.shared) && create) { try { mkdirSync(p.shared, { mode: 0o755 }); } catch (e) { if (e?.code !== "EEXIST") return null; } }
  const st = lstatOrNull(p.shared);
  if (!st || !st.isDirectory() || realOrNull(p.shared) !== join(stateReal, "knowledge", "shared")) return null;
  return { dir: p.shared, dev: st.dev, ino: st.ino };
}

// The regular files in the shared folder (lstat, no dot files, plain names): [{ name, size }], at most 200.
function folderFiles(config) {
  const d = sharedDir(config);
  if (!d) return [];
  const out = [];
  let dir;
  try { dir = opendirSync(d.dir); } catch { return []; }
  try {
    let e;
    let seen = 0;
    while (seen < SCAN_ENTRIES && out.length < 200 && (e = dir.readSync()) !== null) {
      seen += 1;
      if (!SHOWN_NAME.test(e.name)) continue;
      const st = lstatOrNull(join(d.dir, e.name));
      if (st && st.isFile()) out.push({ name: e.name, size: st.size });
    }
  } finally {
    try { dir.closeSync(); } catch { /* already closed */ }
  }
  return out;
}

// ---- the manifest ------------------------------------------------------------------------------------------

function readManifest(config) {
  const text = readTrustedText(paths(config).manifest, MANIFEST_MAX);
  if (text === "missing" || text === null) return [];
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!obj(data) || !Array.isArray(data.files)) return [];
  const out = [];
  const names = new Set();
  for (const f of data.files.slice(0, SHARE_MAX_FILES)) {
    if (!obj(f) || typeof f.path !== "string" || !BRAIN_PATH.test(f.path) || typeof f.name !== "string" || !COPY_NAME.test(f.name)) continue;
    if (f.name === BRAND_PUBLIC || names.has(f.name) || out.some((x) => x.path === f.path)) continue;
    names.add(f.name);
    out.push({
      path: f.path, name: f.name,
      size: Number.isInteger(f.size) && f.size >= 0 ? f.size : -1,
      mtimeMs: typeof f.mtimeMs === "number" && Number.isFinite(f.mtimeMs) ? f.mtimeMs : -1,
      sharedAt: typeof f.sharedAt === "string" ? f.sharedAt.slice(0, 40) : null,
    });
  }
  return out;
}

function writeManifest(config, files) {
  const file = paths(config).manifest;
  const dir = dirname(file);
  if (!lstatOrNull(dir)) mkdirSync(dir, { mode: 0o700 });
  const dst = lstatOrNull(dir);
  if (!dst || !dst.isDirectory()) throw ERR.unsafe();
  const cur = lstatOrNull(file);
  if (cur && !cur.isFile()) throw ERR.unsafe();
  const tmp = join(dir, `.shared-brain-${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify({ version: 1, files }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// ---- copies ------------------------------------------------------------------------------------------------

// A brain file's name as the copy's own clean name: lower case, spaces as dashes, plain characters only.
export function copyName(name) {
  const m = /^(.*)\.(md|txt|csv)$/i.exec(String(name));
  if (!m) return null;
  let base = m[1].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").replace(/-{2,}/g, "-");
  base = base.replace(/^[._-]+/, "").replace(/[._-]+$/, "").slice(0, 90).replace(/[._-]+$/, "");
  if (!base) base = "file";
  const out = `${base}.${m[2].toLowerCase()}`;
  return COPY_NAME.test(out) ? out : null;
}

// `name`, or `<base>-2.<ending>` and on, whichever is not in `taken`.
function freeName(name, taken) {
  if (!taken.has(name) && name !== BRAND_PUBLIC) return name;
  const dot = name.lastIndexOf(".");
  for (let i = 2; i < 1000; i += 1) {
    const n = `${name.slice(0, dot).slice(0, 90)}-${i}${name.slice(dot)}`;
    if (!taken.has(n) && n !== BRAND_PUBLIC) return n;
  }
  throw ERR.full();
}

const isText = (bytes) => {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
};

// Writes the copy (temp file wx, no link followed, 0644, synced, then renamed in). After, the folder must still be
// the very folder checked and the name must hold the very file written, else it is undone and refused.
function putCopy(config, name, bytes) {
  const d = sharedDir(config, { create: true });
  if (!d) throw ERR.unsafe();
  const dest = join(d.dir, name);
  const cur = lstatOrNull(dest);
  if (cur && !cur.isFile()) throw ERR.unsafe();
  const tmp = join(d.dir, `.share-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o644);
  let st;
  try {
    let at = 0;
    while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
    fchmodSync(fd, 0o644);
    fsyncSync(fd);
    st = fstatSync(fd);
  } catch (e) {
    try { closeSync(fd); } catch { /* already closed */ }
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try { renameSync(tmp, dest); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  const now = sharedDir(config);
  const got = lstatOrNull(dest);
  if (!now || now.dev !== d.dev || now.ino !== d.ino || !got || !got.isFile() || got.dev !== st.dev || got.ino !== st.ino) {
    rmSync(dest, { force: true });
    throw ERR.unsafe();
  }
}

// Removes a copy by its name: only a regular file directly in the checked folder.
function dropCopy(config, name) {
  if (!COPY_NAME.test(name) || name === BRAND_PUBLIC) return;
  const d = sharedDir(config);
  if (!d) return;
  const st = lstatOrNull(join(d.dir, name));
  if (st && st.isFile()) { try { unlinkSync(join(d.dir, name)); } catch { /* already gone */ } }
}

// The listed brain file a token names, as the store lists it (shape brain-file), or null.
function listedFile(config, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,400}$/.test(token)) return null;
  return brainFor(config).list().find((f) => f.token === token) || null;
}

// The file's bytes through the store (its own checks: listed, no link, a regular file, inside the brain, capped).
function bytesOf(config, file) {
  let got;
  try {
    got = brainFor(config).raw(file.token);
  } catch (e) {
    if (e instanceof BrainError && e.code === "too_large") throw ERR.tooLarge();
    if (e instanceof BrainError) throw ERR.notFound();
    throw e;
  }
  if (!isText(got.bytes)) throw ERR.notText();
  return got.bytes;
}

// Copies `file` (a listed brain file) in as `entry.name` or a new free name, inside the caps. -> the entry.
function copyIn(config, file, list, previous) {
  if (!SHAREABLE.has(file.kind)) throw ERR.notShareable();
  const bytes = bytesOf(config, file);
  if (bytes.length > SHARE_MAX_BYTES) throw ERR.tooLarge();
  const inFolder = folderFiles(config);
  const others = inFolder.filter((f) => !previous || f.name !== previous.name);
  if (others.length + 1 > SHARE_MAX_FILES) throw ERR.full();
  if (others.reduce((s, f) => s + f.size, 0) + bytes.length > SHARE_MAX_BYTES) throw ERR.full();
  let name = previous ? previous.name : null;
  if (!name) {
    const base = copyName(file.name);
    if (!base) throw ERR.notShareable();
    const taken = new Set([...inFolder.map((f) => f.name.toLowerCase()), ...list.map((x) => x.name)]);
    name = freeName(base, taken);
  }
  putCopy(config, name, bytes);
  return {
    path: file.path, name, size: file.size, mtimeMs: Date.parse(file.changedAt),
    sharedAt: previous?.sharedAt || new Date().toISOString(),
  };
}

// ---- what the routes use -----------------------------------------------------------------------------------

// share(config, token, on): `on` copies the listed text or table file the token names (again, when it is shared
// already); otherwise unshare. Throws a ShareError (a HomeError with a plain sentence) when refused.
export function share(config, token, on) {
  if (!on) return unshare(config, token);
  const file = listedFile(config, token);
  if (!file) throw ERR.notFound();
  if (!SHAREABLE.has(file.kind)) throw ERR.notShareable();
  const list = readManifest(config);
  const previous = list.find((x) => x.path === file.path) || null;
  const entry = copyIn(config, file, list.filter((x) => x !== previous), previous);
  writeManifest(config, [...list.filter((x) => x !== previous), entry]);
  return entry;
}

// unshare(config, token): removes the copy of the brain file the token names, whether or not that file is still
// in the brain. Nothing to remove is not an error.
export function unshare(config, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,400}$/.test(token)) throw ERR.notFound();
  const path = Buffer.from(token, "base64url").toString("utf8");
  if (brainToken(path) !== token) throw ERR.notFound();
  const list = readManifest(config);
  const entry = list.find((x) => x.path === path);
  if (!entry) return null;
  dropCopy(config, entry.name);
  writeManifest(config, list.filter((x) => x !== entry));
  return entry;
}

// Puts the folder right against the brain (see the top). -> problem code or null. Never throws.
export function syncShared(config) {
  try {
    const list = readManifest(config);
    if (!list.length) return null;
    const files = new Map(brainFor(config).list().map((f) => [f.path, f]));
    const keep = [];
    let changed = false;
    for (const entry of list) {
      const file = files.get(entry.path);
      const copy = folderFiles(config).find((f) => f.name === entry.name);
      if (!file || !SHAREABLE.has(file.kind)) { dropCopy(config, entry.name); changed = true; continue; }
      if (copy && file.size === entry.size && Date.parse(file.changedAt) === entry.mtimeMs) { keep.push(entry); continue; }
      changed = true;
      try {
        keep.push(copyIn(config, file, keep, copy ? entry : null));
      } catch {
        dropCopy(config, entry.name);
      }
    }
    if (changed) writeManifest(config, keep);
    return null;
  } catch {
    return "shared_unreadable";
  }
}

// listShared(config) -> { files: [{ name, size, source, path, token, title }], totals: { files, bytes }, limits,
// problem }. Every file the Researcher can read in the shared folder: `source` is "brand-kit" (brand-public.md),
// "brain" (a copy of a brain file the owner shared; `path` and `token` name it) or "other" (put there another
// way). The brand kit's file first, then by name.
export function listShared(config) {
  const problem = syncShared(config) || (lstatOrNull(paths(config).shared) && !sharedDir(config) ? "folder_unsafe" : null);
  const byName = new Map(readManifest(config).map((x) => [x.name, x]));
  const files = folderFiles(config).map((f) => {
    const m = byName.get(f.name);
    if (f.name === BRAND_PUBLIC) return { name: f.name, size: f.size, source: "brand-kit", path: null, token: null, title: "The brand's public summary" };
    if (m) return { name: f.name, size: f.size, source: "brain", path: m.path, token: brainToken(m.path), title: m.path.split("/").pop() };
    return { name: f.name, size: f.size, source: "other", path: null, token: null, title: f.name };
  });
  const rank = (f) => (f.source === "brand-kit" ? 0 : 1);
  files.sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    files,
    totals: { files: files.length, bytes: files.reduce((s, f) => s + f.size, 0) },
    limits: { files: SHARE_MAX_FILES, bytes: SHARE_MAX_BYTES },
    problem,
  };
}
