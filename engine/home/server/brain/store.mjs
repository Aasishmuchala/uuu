// The company brain's store (CONTRACTS-V3 32.1, 32.2, 33.6): the owner's files under state/knowledge/docs,
// in the root (`loose`) or directly in one of the nine folders, and their own search index.
// Every agent reads this folder before it works, so what lands here is checked before it is written:
//   - a name is cleaned to one plain file name (nothing before a slash is kept, no leading dot, no NUL);
//   - a short list of endings, and the first bytes must agree with the ending (no SVG, no HTML, no script);
//   - size limits per kind, 500 files and 200 MB in all, and a floor of free disk;
//   - a new file is written to a temp name with `wx` and mode 0644 (never executable), then put in place
//     without ever replacing a file that is there; only a form's file is replaced, and only at its version;
//   - a folder that is a link is refused; files are listed with lstat (links, dot files and odd names left
//     out) and read only through readChecked and openChecked of lib/taskfiles.mjs.
// A token is the base64url of a path inside the root and is accepted only when it names a listed file.
// The store never runs, converts, resizes or opens a file with another program. The index
// (node:sqlite, FTS5, state/home/brain.sqlite) is a cache, rebuilt when a file's size or time differs.
import { DatabaseSync } from "node:sqlite";
import {
  closeSync, constants as fsConstants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, opendirSync,
  openSync, realpathSync, renameSync, rmSync, statfsSync, unlinkSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { HomeError } from "../lib/errors.mjs";
import { snippet } from "../lib/format.mjs";
import { readChecked } from "../lib/taskfiles.mjs";
import { BASICS, FOLDERS } from "../lib/brainfiles.mjs";
import { sniff } from "../routes/_images.mjs";

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 500;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_NAME = 100;
export const MAX_VIEW_TEXT = 262144;
export const ENDINGS = [".md", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];
// The nine folders of 32.1 and `loose` (the root itself), with what belongs in each.
export const FOLDER_IDS = FOLDERS.map((f) => f.id);
const SUB_FOLDERS = FOLDER_IDS.filter((f) => f !== "loose");
const ABOUT = {
  company: "What the company does, for whom, where.",
  brand: "How the company looks and sounds, and what it never says.",
  pricing: "What is sold, at what price, on what terms.",
  policies: "Refunds, warranty, support hours, how things are done.",
  people: "Who is who.",
  customers: "Who the company sells to.",
  calls: "Notes and transcripts you add.",
  references: "Examples and pictures you collect.",
  packs: "One page per kind of output: its shape, length and rules.",
  loose: "Files kept directly in the knowledge folder.",
};

const KIND_OF = { md: "text", txt: "text", csv: "table", png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", pdf: "pdf" };
const SNIFF_OF = { png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp", gif: "gif" };
export const IMAGE_TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(md|txt|csv|png|jpg|jpeg|webp|gif|pdf)$/i;
const SCAN_ENTRIES = 5000;     // entries looked at in one folder while listing
const SCHEMA = 1;
const GB = 1024 * 1024 * 1024;

// One SQL statement, run through a prepared statement (one statement at a time, nothing else is run).
const sqlRun = (db, sql) => db.prepare(sql).run();

export class BrainError extends Error {
  constructor(status, message, next, code) {
    super(message);
    this.status = status;
    this.next = next;
    this.code = code;
  }
}

const ERR = {
  nameMissing: () => new BrainError(400, "Give the file a name.", "Type a short name, such as price list.", "name_missing"),
  nameEmpty: () => new BrainError(400, "That name has no letters or numbers in it.", "Use a name such as price list or site visit.", "name_empty"),
  nameType: () => new BrainError(400, "Only text, tables, pictures and PDF files can be added.", "Save it as text, a table, a picture or a PDF, then add it again.", "name_type"),
  kindMismatch: () => new BrainError(400, "That file is not what its name says.", "Check the file and its name, then add it again.", "kind_mismatch"),
  empty: () => new BrainError(400, "There is nothing in that file.", "Paste or pick something with content, then add it again.", "text_missing"),
  badBody: () => new BrainError(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request"),
  tooLarge: (kind) => new BrainError(413, "That file is too large to add.",
    kind === "image" || kind === "pdf" ? "Pictures and PDF files can be up to 10 MB." : "Text and tables can be up to 2 MB. Split it in two.", "too_large"),
  exists: () => new BrainError(409, "A file with that name is already there.", "Pick another name, or remove the old file first.", "file_exists"),
  full: () => new BrainError(409, "The company brain is full.", "Remove files you no longer need, then add this again.", "brain_full"),
  diskLow: () => new BrainError(409, "This Mac is low on disk space, so nothing more can be added.", "Free some space, then try again.", "disk_low"),
  folderNotFound: () => new BrainError(404, "That folder is not in the company brain.", "Pick one of the folders from the list.", "folder_not_found"),
  fileNotFound: () => new BrainError(404, "That file is not in the company brain.", "Go back to the list and pick one from there.", "file_not_found"),
  changed: () => new BrainError(409, "That file changed since you opened it.", "Open it again to see the newest version, then try again.", "changed_since_seen"),
};

const endingOf = (name) => {
  const dot = String(name).lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};
export const kindOfName = (name) => KIND_OF[endingOf(name)] || null;
export const brainToken = (rel) => Buffer.from(String(rel), "utf8").toString("base64url");
const versionOf = (mtimeMs) => String(Math.trunc(mtimeMs));
const FORM_OF = new Map(BASICS.map((b) => [b.file, b.form]));

// A name typed by the owner -> the one safe file name it becomes, or a BrainError (400). The knowledge
// store's cleanName, widened to the endings of 32.2. Only the last part counts: anything before a slash is
// dropped, never followed; characters outside letters, digits, space, dot, dash and underscore (a NUL
// among them) are dropped; leading dots, spaces, dashes and underscores are dropped; a missing ending becomes .md.
export function cleanName(input) {
  if (typeof input !== "string") throw ERR.nameMissing();
  let n = input.split(/[\\/]/).pop();
  n = n.normalize("NFC").replace(/[^A-Za-z0-9 ._-]/g, "");
  n = n.replace(/^[ ._-]+/, "").replace(/ +$/, "").replace(/\.{2,}/g, ".");
  const ext = n.match(/\.([A-Za-z0-9]+)$/);
  const known = ext && KIND_OF[ext[1].toLowerCase()];
  if (ext && /[A-Za-z]/.test(ext[1]) && !known) throw ERR.nameType();
  if (known) n = `${n.slice(0, -ext[1].length)}${ext[1].toLowerCase()}`;
  else n = `${n.replace(/\.+$/, "")}.md`;
  if (n.length > MAX_NAME) {
    const e = `.${endingOf(n)}`;
    n = `${n.slice(0, MAX_NAME - e.length).replace(/[ .]+$/, "")}${e}`;
  }
  if (!VALID_NAME.test(n)) throw ERR.nameEmpty();
  return n;
}

// The words of a search -> an FTS5 query where every word must match and nothing typed acts as syntax.
function ftsQuery(q) {
  const words = String(q || "").slice(0, 400).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 20);
  return { words, match: words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ") };
}

const isUtf8Text = (bytes) => {
  if (bytes.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
};

// The bytes agree with the ending of `name`, or a BrainError. Sizes are checked here too.
function checkBytes(name, bytes) {
  const ext = endingOf(name);
  const kind = KIND_OF[ext];
  if (!kind) throw ERR.nameType();
  if (!bytes.length) throw ERR.empty();
  const limit = kind === "image" ? MAX_IMAGE_BYTES : kind === "pdf" ? MAX_PDF_BYTES : MAX_TEXT_BYTES;
  if (bytes.length > limit) throw ERR.tooLarge(kind);
  if (kind === "text" || kind === "table") { if (!isUtf8Text(bytes)) throw ERR.kindMismatch(); }
  else if (kind === "image") { if (sniff(bytes) !== SNIFF_OF[ext]) throw ERR.kindMismatch(); }
  else if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw ERR.kindMismatch();
  return kind;
}

// Free bytes on the disk holding `dir`, or null when it cannot be told.
function diskFree(dir) {
  try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// options.freeBytes(dir) -> number | null: for tests; the default asks the file system.
export function createBrain(config, options = {}) {
  const root = config.paths.knowledgeDocs;
  const dbFile = join(config.paths.homeData, "brain.sqlite");
  const freeBytes = options.freeBytes || diskFree;

  const ensureRoot = () => mkdirSync(root, { recursive: true });

  // The real folder for a folder id, created when missing; refused when it is a link or not a folder.
  function folderDir(folder, { create = false } = {}) {
    if (typeof folder !== "string" || !FOLDER_IDS.includes(folder)) throw ERR.folderNotFound();
    ensureRoot();
    if (folder === "loose") return root;
    const dir = join(root, folder);
    let st = null;
    try { st = lstatSync(dir); } catch { st = null; }
    if (!st && create) {
      try { mkdirSync(dir, { mode: 0o755 }); } catch (e) { if (e?.code !== "EEXIST") throw e; }
      try { st = lstatSync(dir); } catch { st = null; }
    }
    if (!st || !st.isDirectory()) throw ERR.folderNotFound();       // lstat: a link is never a directory
    let real;
    try { real = realpathSync(dir); } catch { throw ERR.folderNotFound(); }
    if (real !== join(realpathSync(root), folder)) throw ERR.folderNotFound();
    return dir;
  }

  // Regular files directly in one folder with a valid name: [{ path, folder, name, size, mtimeMs, birthMs }].
  function scanFolder(folder) {
    let dir;
    try { dir = folderDir(folder); } catch { return []; }
    const out = [];
    let d;
    try { d = opendirSync(dir); } catch { return []; }
    try {
      let e;
      let seen = 0;
      while (seen < SCAN_ENTRIES && (e = d.readSync()) !== null) {
        seen += 1;
        if (!e.isFile() || e.name.length > MAX_NAME || !VALID_NAME.test(e.name)) continue;
        let st;
        try { st = lstatSync(join(dir, e.name)); } catch { continue; }
        if (!st.isFile()) continue;
        out.push({
          path: folder === "loose" ? e.name : `${folder}/${e.name}`, folder, name: e.name, size: st.size,
          mtimeMs: st.mtimeMs, birthMs: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs, dev: st.dev, ino: st.ino,
        });
      }
    } finally {
      try { d.closeSync(); } catch { /* already closed */ }
    }
    return out;
  }

  // Every listed file, newest first.
  function scan() {
    const out = [];
    for (const f of FOLDER_IDS) out.push(...scanFolder(f));
    out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
  }

  function toFile(f) {
    const token = brainToken(f.path);
    const kind = kindOfName(f.name);
    return {
      token, path: f.path, folder: f.folder, name: f.name, kind, size: f.size,
      addedAt: new Date(f.birthMs).toISOString(), changedAt: new Date(f.mtimeMs).toISOString(), version: versionOf(f.mtimeMs),
      form: FORM_OF.get(f.path) || null,
      viewUrl: `/api/brain/file/${token}`,
      rawUrl: kind === "image" ? `/api/brain/raw/${token}` : null,
      downloadUrl: `/api/brain/raw/${token}?download=1`,
    };
  }

  // The listed entry a token names, or a 404. The token must be the exact token of a listed path.
  function entryOf(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,400}$/.test(token)) throw ERR.fileNotFound();
    const rel = Buffer.from(token, "base64url").toString("utf8");
    if (brainToken(rel) !== token) throw ERR.fileNotFound();
    const parts = rel.split("/");
    if (parts.length > 2 || parts.some((p) => !p || p === "." || p === "..")) throw ERR.fileNotFound();
    const folder = parts.length === 2 ? parts[0] : "loose";
    if (!FOLDER_IDS.includes(folder) || (parts.length === 2 && folder === "loose")) throw ERR.fileNotFound();
    const f = scanFolder(folder).find((x) => x.path === rel);
    if (!f) throw ERR.fileNotFound();
    return f;
  }

  const fullPath = (f) => (f.folder === "loose" ? join(root, f.name) : join(root, f.folder, f.name));

  // The entry is still the very file listed (same inode), a regular file and not a link.
  function stillThere(f) {
    try { const st = lstatSync(fullPath(f)); return st.isFile() && st.dev === f.dev && st.ino === f.ino; } catch { return false; }
  }

  function checkVersion(f, version) {
    if (typeof version !== "string" && typeof version !== "number") throw ERR.changed();
    if (String(version) !== versionOf(f.mtimeMs) || !stillThere(f)) throw ERR.changed();
  }

  // Writes bytes to a new temp file beside `dest` (wx, no link followed, 0644, synced) and returns
  // { tmp, dev, ino }: its path and the identity of the file the descriptor wrote.
  function writeTemp(dir, bytes) {
    const tmp = join(dir, `.brain-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
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
    return { tmp, dev: st.dev, ino: st.ino };
  }

  // Node has no linkat or openat, so a folder (or a file) swapped for a link between the check and the write
  // cannot be stopped before the write. It is caught after: the folder must still be the very folder checked
  // (same device and inode, not a link, its real path the brain's own) and the name must hold the very file
  // meant (same device and inode, not a link). Otherwise what was written is undone and the change refused.
  const idOf = (path) => { try { const st = lstatSync(path); return { st, dev: st.dev, ino: st.ino }; } catch { return null; } };
  function landedSafely(folder, dirId, dest, want) {
    const nowDir = idOf(folder === "loose" ? root : join(root, folder));
    if (!nowDir || !nowDir.st.isDirectory() || nowDir.dev !== dirId.dev || nowDir.ino !== dirId.ino) return false;
    try { folderDir(folder); } catch { return false; }
    const got = idOf(dest);
    return !!got && got.st.isFile() && got.dev === want.dev && got.ino === want.ino;
  }

  // ---- the index
  function openDb() {
    const db = new DatabaseSync(dbFile);
    try {
      const v = db.prepare("PRAGMA user_version").get().user_version;
      if (v !== SCHEMA) {
        for (const sql of [
          "DROP TABLE IF EXISTS brain_fts", "DROP TABLE IF EXISTS brain_meta",
          "CREATE TABLE brain_meta (id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL)",
          "CREATE VIRTUAL TABLE brain_fts USING fts5(name, text)", `PRAGMA user_version = ${SCHEMA}`,
        ]) sqlRun(db, sql);
      }
      db.prepare("SELECT count(*) FROM brain_meta").get();
      return db;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  // The index is a cache: if its file is damaged, throw it away and start again.
  function withDb(fn) {
    mkdirSync(config.paths.homeData, { recursive: true });
    let db;
    try {
      db = openDb();
    } catch {
      for (const s of ["", "-wal", "-shm", "-journal"]) rmSync(dbFile + s, { force: true });
      db = openDb();
    }
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  // The text of a text or table file for the index, or "" (a picture or a PDF is found by its name only).
  function indexText(f) {
    const kind = kindOfName(f.name);
    if (kind !== "text" && kind !== "table") return "";
    const read = readChecked(fullPath(f), root, { maxBytes: MAX_TEXT_BYTES });
    if (!read || read.truncated) return "";
    return read.bytes.toString("utf8").replace(/\0/g, "");
  }

  function sync(db) {
    const files = scan();
    const rows = new Map(db.prepare("SELECT id, path, size, mtime FROM brain_meta").all().map((r) => [r.path, r]));
    const seen = new Set();
    sqlRun(db, "BEGIN");
    try {
      for (const f of files) {
        seen.add(f.path);
        const row = rows.get(f.path);
        if (row && row.size === f.size && row.mtime === f.mtimeMs) continue;
        if (row) {
          db.prepare("DELETE FROM brain_fts WHERE rowid = ?").run(row.id);
          db.prepare("DELETE FROM brain_meta WHERE id = ?").run(row.id);
        }
        const id = Number(db.prepare("INSERT INTO brain_meta (path, size, mtime) VALUES (?, ?, ?)").run(f.path, f.size, f.mtimeMs).lastInsertRowid);
        db.prepare("INSERT INTO brain_fts (rowid, name, text) VALUES (?, ?, ?)").run(id, f.name.replace(/[._-]+/g, " "), indexText(f));
      }
      for (const [path, row] of rows) {
        if (seen.has(path)) continue;
        db.prepare("DELETE FROM brain_fts WHERE rowid = ?").run(row.id);
        db.prepare("DELETE FROM brain_meta WHERE id = ?").run(row.id);
      }
      sqlRun(db, "COMMIT");
    } catch (e) {
      try { sqlRun(db, "ROLLBACK"); } catch { /* already closed */ }
      throw e;
    }
    return files;
  }

  // Room for `size` more bytes in one more file, or a BrainError.
  function checkRoom(size, { replacing = null } = {}) {
    const files = scan();
    const others = replacing ? files.filter((x) => x.path !== replacing) : files;
    if (others.length >= MAX_FILES) throw ERR.full();
    const total = others.reduce((s, x) => s + x.size, 0);
    if (total + size > MAX_TOTAL_BYTES) throw ERR.full();
    const floor = Number(config.minFreeDiskGb);
    const free = freeBytes(root);
    if (Number.isFinite(floor) && typeof free === "number" && Number.isFinite(free) && free - size < floor * GB) throw ERR.diskLow();
  }

  function contentOf(input) {
    const hasText = input.text !== undefined && input.text !== null;
    const hasBytes = input.bytes !== undefined && input.bytes !== null;
    if (hasText === hasBytes) throw ERR.badBody();
    if (hasText) {
      if (typeof input.text !== "string") throw ERR.badBody();
      return { bytes: Buffer.from(input.text, "utf8"), pasted: true };
    }
    if (!Buffer.isBuffer(input.bytes) && !(input.bytes instanceof Uint8Array)) throw ERR.badBody();
    return { bytes: Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength), pasted: false };
  }

  return {
    folders: () => FOLDERS.map((f) => ({ id: f.id, title: f.title, about: ABOUT[f.id] })),

    // Every listed file as shape brain-file, newest first.
    list() {
      return scan().map(toFile);
    },

    // The brain-file at a path inside the root, or null.
    find(path) {
      try { return toFile(entryOf(brainToken(path))); } catch { return null; }
    },

    // { file, text, truncated }: text for text and table files (at most 262144 bytes), else null.
    get(token) {
      const f = entryOf(token);
      const file = toFile(f);
      if (file.kind !== "text" && file.kind !== "table") return { file, text: null, truncated: false };
      const read = readChecked(fullPath(f), root, { maxBytes: MAX_VIEW_TEXT });
      if (!read) throw ERR.fileNotFound();
      // Bytes that are not UTF-8 become U+FFFD; a character cut by the cap is dropped, not mangled.
      const text = new TextDecoder("utf-8").decode(read.bytes, { stream: read.truncated });
      return { file, text, truncated: read.truncated };
    },

    // { file, bytes, type } for GET /api/brain/raw: `type` is an image's real type from its first bytes
    // when they agree with its ending, else null (sent as a download). A file over its kind's limit is 413.
    raw(token) {
      const f = entryOf(token);
      const file = toFile(f);
      const limit = file.kind === "image" ? MAX_IMAGE_BYTES : file.kind === "pdf" ? MAX_PDF_BYTES : MAX_TEXT_BYTES;
      const read = readChecked(fullPath(f), root, { maxBytes: limit });
      if (!read) throw ERR.fileNotFound();
      if (read.truncated) throw new BrainError(413, "That file is too large to open here.", "Open the knowledge folder in Finder instead.", "too_large");
      let type = null;
      if (file.kind === "image") {
        const s = sniff(read.bytes);
        if (s && s === SNIFF_OF[endingOf(f.name)]) type = IMAGE_TYPES[s];
      }
      return { file, bytes: read.bytes, type };
    },

    // add({ folder, name, text | bytes }) -> brain-file. Never replaces a file that is there.
    add(input) {
      if (!input || typeof input !== "object") throw ERR.badBody();
      const name = cleanName(input.name);
      if (typeof input.folder !== "string" || !FOLDER_IDS.includes(input.folder)) throw ERR.folderNotFound();
      const { bytes, pasted } = contentOf(input);
      const kind = kindOfName(name);
      if (pasted && kind !== "text" && kind !== "table") throw ERR.kindMismatch();
      if (pasted && !input.text.trim()) throw ERR.empty();
      checkBytes(name, bytes);
      const dir = folderDir(input.folder, { create: true });
      const dirId = idOf(dir);
      if (!dirId) throw ERR.folderNotFound();
      checkRoom(bytes.length);
      const dest = join(dir, name);
      try { lstatSync(dest); throw ERR.exists(); } catch (e) { if (e instanceof BrainError) throw e; }
      const written = writeTemp(dir, bytes);
      const { tmp } = written;
      try {
        // A hard link fails when the name is taken, so nothing there is ever replaced (a rename would).
        linkSync(tmp, dest);
      } catch (e) {
        rmSync(tmp, { force: true });
        if (e?.code === "EEXIST") throw ERR.exists();
        throw e;
      }
      if (!landedSafely(input.folder, dirId, dest, written)) {
        rmSync(dest, { force: true });
        rmSync(tmp, { force: true });
        throw ERR.folderNotFound();
      }
      unlinkSync(tmp);
      const f = scanFolder(input.folder).find((x) => x.name === name);
      if (!f) throw ERR.fileNotFound();
      return toFile(f);
    },

    // replace(path, text, version) -> brain-file: for the forms only (M32). A Markdown file directly in one of
    // the nine folders, replaced only when `version` equals its version; with `version` null it must not exist.
    replace(path, text, version) {
      const parts = typeof path === "string" ? path.split("/") : [];
      if (parts.length !== 2 || !SUB_FOLDERS.includes(parts[0])) throw ERR.folderNotFound();
      const name = parts[1];
      if (name.length > MAX_NAME || !VALID_NAME.test(name) || endingOf(name) !== "md" || cleanName(name) !== name) throw ERR.nameEmpty();
      if (typeof text !== "string") throw ERR.badBody();
      const bytes = Buffer.from(text, "utf8");
      if (bytes.length > MAX_TEXT_BYTES) throw ERR.tooLarge("text");
      if (!isUtf8Text(bytes)) throw ERR.kindMismatch();
      const dir = folderDir(parts[0], { create: true });
      const dirId = idOf(dir);
      if (!dirId) throw ERR.folderNotFound();
      const dest = join(dir, name);
      const current = scanFolder(parts[0]).find((x) => x.name === name);
      let destSt = null;
      try { destSt = lstatSync(dest); } catch { destSt = null; }
      if (current) checkVersion(current, version);
      else if (destSt || (version !== null && version !== undefined)) throw ERR.changed();
      checkRoom(bytes.length, { replacing: current ? current.path : null });
      const written = writeTemp(dir, bytes);
      const { tmp } = written;
      try {
        if (current && !stillThere(current)) throw ERR.changed();
        if (current) renameSync(tmp, dest);
        else linkSync(tmp, dest);
      } catch (e) {
        rmSync(tmp, { force: true });
        if (e?.code === "EEXIST") throw ERR.changed();
        throw e;
      }
      if (!landedSafely(parts[0], dirId, dest, written)) {
        rmSync(dest, { force: true });
        rmSync(tmp, { force: true });
        throw ERR.changed();
      }
      if (!current) unlinkSync(tmp);
      const f = scanFolder(parts[0]).find((x) => x.name === name);
      if (!f) throw ERR.fileNotFound();
      return toFile(f);
    },

    // move(token, folder, version) -> brain-file in its new folder. Never replaces a file that is there.
    move(token, folder, version) {
      const f = entryOf(token);
      checkVersion(f, version);
      const dir = folderDir(folder, { create: true });
      if (folder === f.folder) return toFile(f);
      const dirId = idOf(dir);
      if (!dirId || !stillThere(f)) throw ERR.changed();
      const dest = join(dir, f.name);
      try {
        // link() follows a link at the source on this Mac, so what landed is checked right after.
        linkSync(fullPath(f), dest);
      } catch (e) {
        if (e?.code === "EEXIST") throw ERR.exists();
        throw e;
      }
      if (!landedSafely(folder, dirId, dest, f)) {
        rmSync(dest, { force: true });
        throw ERR.changed();
      }
      // The old name goes only while it still names the very file moved.
      if (stillThere(f)) unlinkSync(fullPath(f));
      const moved = scanFolder(folder).find((x) => x.name === f.name);
      if (!moved) throw ERR.fileNotFound();
      return toFile(moved);
    },

    // remove(token, version) -> { ok: true }.
    remove(token, version) {
      const f = entryOf(token);
      checkVersion(f, version);
      unlinkSync(fullPath(f));
      return { ok: true };
    },

    // [{ token, path, name, snippet }], at most `limit` (20). Text and tables by their words; every file by its name.
    search(q, limit = 20) {
      const { words, match } = ftsQuery(q);
      if (!words.length) return [];
      const cap = Math.max(1, Math.min(20, Number(limit) || 20));
      return withDb((db) => {
        const files = new Map(sync(db).map((f) => [f.path, f]));
        let rows;
        try {
          rows = db.prepare(
            "SELECT m.path AS path, f.text AS text FROM brain_fts f JOIN brain_meta m ON m.id = f.rowid WHERE brain_fts MATCH ? ORDER BY rank LIMIT ?",
          ).all(match, cap);
        } catch {
          return [];
        }
        const lower = words.map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
        return rows.filter((r) => files.has(r.path)).map((r) => {
          const f = files.get(r.path);
          return { token: brainToken(f.path), path: f.path, name: f.name, snippet: r.text ? snippet(r.text, lower) : "" };
        });
      });
    },
  };
}

// One store per config (each test home has its own).
const stores = new WeakMap();
export function brainFor(config) {
  if (!stores.has(config)) stores.set(config, createBrain(config));
  return stores.get(config);
}

// Turns a store error into the plain-sentence error the core sends; anything else becomes a 500 there.
export function brainRun(ctx, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BrainError) throw ctx.fail(e.status, e.message, e.next, e.code);
    if (e instanceof HomeError) throw e;
    ctx.log(`brain: ${String(e?.message || e).split("\n")[0]}`);
    throw ctx.fail(500, "The company brain could not be read just now.", "Try again in a moment.", "brain_unavailable");
  }
}
