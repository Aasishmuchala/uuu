// The company knowledge folder and its search index (CONTRACTS 9.7).
// Documents are untrusted text from the owner's browser. A name from the browser is cleaned to a plain
// file name before it touches the disk, and every file this code opens lives directly inside the one
// knowledge folder. The index (node:sqlite, FTS5) lives in the server's own data folder and is only a
// cache: it is rebuilt whenever a file's size or modified time differs from what it recorded.
import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { snippet } from "../lib/format.mjs";
import { readChecked } from "../lib/taskfiles.mjs";

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_NAME = 100;
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(md|txt)$/;
const SCHEMA = 1;

export class KnowledgeError extends Error {
  constructor(status, message, next, code) {
    super(message);
    this.status = status;
    this.next = next;
    this.code = code;
  }
}

// A name typed by the owner -> the one safe file name it becomes, or a KnowledgeError (400).
export function cleanName(input) {
  if (typeof input !== "string") throw new KnowledgeError(400, "Give the document a name.", "Type a short name, such as warranty.", "name_missing");
  // Only the last part counts: anything before a slash is dropped, never followed.
  let n = input.split(/[\\/]/).pop();
  n = n.normalize("NFC").replace(/[^A-Za-z0-9 ._-]/g, "");
  n = n.replace(/^[ .]+/, "").replace(/ +$/, "").replace(/\.{2,}/g, ".");
  const ext = /\.([A-Za-z0-9]+)$/.exec(n);
  if (ext && /[A-Za-z]/.test(ext[1]) && !/^(md|txt)$/i.test(ext[1])) {
    throw new KnowledgeError(400, "Only .md and .txt documents can be added.", "Save the text as a .md or .txt document and add that.", "name_type");
  }
  if (ext && /^(md|txt)$/i.test(ext[1])) n = `${n.slice(0, -ext[1].length)}${ext[1].toLowerCase()}`;
  else n = `${n.replace(/\.+$/, "")}.md`;
  if (n.length > MAX_NAME) {
    const e = n.endsWith(".txt") ? ".txt" : ".md";
    n = `${n.slice(0, MAX_NAME - e.length).replace(/[ .]+$/, "")}${e}`;
  }
  if (!VALID_NAME.test(n)) {
    throw new KnowledgeError(400, "That name has no letters or numbers in it.", "Use a name such as warranty or returns policy.", "name_empty");
  }
  return n;
}

// The words of a search -> an FTS5 query where every word must match and nothing typed can act as syntax.
// Each word is quoted with inner quotes doubled; words with no letter or digit match nothing and are dropped.
export function ftsQuery(q) {
  const words = String(q || "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return { words, match: words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ") };
}


export function createKnowledge(config) {
  const dir = config.paths.knowledgeDocs;
  const dbFile = join(config.paths.homeData, "knowledge.sqlite");

  function ensureDirs() {
    mkdirSync(dir, { recursive: true });
    mkdirSync(config.paths.homeData, { recursive: true });
  }

  function openDb() {
    const db = new DatabaseSync(dbFile);
    try {
      const v = db.prepare("PRAGMA user_version").get().user_version;
      if (v !== SCHEMA) {
        db.exec("DROP TABLE IF EXISTS docs_fts; DROP TABLE IF EXISTS docs_meta;");
        db.exec(`CREATE TABLE docs_meta (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL);
                 CREATE VIRTUAL TABLE docs_fts USING fts5(name, text);
                 PRAGMA user_version = ${SCHEMA};`);
      }
      db.prepare("SELECT count(*) FROM docs_meta").get();
      return db;
    } catch (e) {
      db.close();
      throw e;
    }
  }

  // The index is a cache: if its file is damaged, throw it away and start again.
  function withDb(fn) {
    ensureDirs();
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

  // One document's text, or null. The owner may drop files in by hand: O_NOFOLLOW and O_NONBLOCK (a FIFO
  // cannot hang the server), a regular file still at its place in the folder, at most MAX_TEXT_BYTES.
  function readText(name) {
    const read = readChecked(join(dir, name), dir, { maxBytes: MAX_TEXT_BYTES });
    if (!read || read.truncated) return null;
    return read.bytes.toString("utf8");
  }

  // Regular files directly inside the folder with a valid name. Links and odd names are ignored.
  function scan() {
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!VALID_NAME.test(name) || name.length > MAX_NAME) continue;
      let st;
      try { st = lstatSync(join(dir, name)); } catch { continue; }
      if (!st.isFile() || st.size > MAX_TEXT_BYTES) continue;
      out.push({ name, size: st.size, mtime: st.mtimeMs, addedAt: (st.birthtimeMs > 0 ? st.birthtime : st.mtime).toISOString() });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  function sync(db) {
    const files = scan();
    const rows = new Map(db.prepare("SELECT id, name, size, mtime FROM docs_meta").all().map((r) => [r.name, r]));
    const seen = new Set();
    db.exec("BEGIN");
    try {
      for (const f of files) {
        seen.add(f.name);
        const row = rows.get(f.name);
        if (row && row.size === f.size && row.mtime === f.mtime) continue;
        const text = readText(f.name);
        if (text === null) continue;
        if (row) {
          db.prepare("DELETE FROM docs_fts WHERE rowid = ?").run(row.id);
          db.prepare("DELETE FROM docs_meta WHERE id = ?").run(row.id);
        }
        const id = Number(db.prepare("INSERT INTO docs_meta (name, size, mtime) VALUES (?, ?, ?)").run(f.name, f.size, f.mtime).lastInsertRowid);
        db.prepare("INSERT INTO docs_fts (rowid, name, text) VALUES (?, ?, ?)").run(id, f.name, text);
      }
      for (const [name, row] of rows) {
        if (seen.has(name)) continue;
        db.prepare("DELETE FROM docs_fts WHERE rowid = ?").run(row.id);
        db.prepare("DELETE FROM docs_meta WHERE id = ?").run(row.id);
      }
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already closed */ }
      throw e;
    }
    return files;
  }

  const toDoc = (f) => ({ id: f.name, name: f.name, size: f.size, addedAt: f.addedAt });

  function notFound() {
    return new KnowledgeError(404, "That document is not in the knowledge folder.", "Go back to the list and pick one from there.", "doc_not_found");
  }

  function checkId(id) {
    if (typeof id !== "string" || !VALID_NAME.test(id) || id.length > MAX_NAME) throw notFound();
    return id;
  }

  return {
    list() {
      return withDb((db) => sync(db).map(toDoc));
    },

    add(name, text) {
      const clean = cleanName(name);
      if (typeof text !== "string" || !text.trim()) {
        throw new KnowledgeError(400, "The document has no text in it.", "Paste or type the text, then add it again.", "text_missing");
      }
      if (text.includes("\0")) throw new KnowledgeError(400, "That text is not plain text.", "Add a plain text or Markdown document.", "text_binary");
      if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
        throw new KnowledgeError(413, "That document is too large to add.", "Keep each document under 2 MB, or split it in two.", "too_large");
      }
      ensureDirs();
      try {
        writeFileSync(join(dir, clean), text, { flag: "wx", mode: 0o644 });
      } catch (e) {
        if (e?.code === "EEXIST") {
          throw new KnowledgeError(409, `A document called ${clean} is already there.`, "Pick another name, or delete the old one first.", "doc_exists");
        }
        throw e;
      }
      return withDb((db) => {
        const f = sync(db).find((x) => x.name === clean);
        return toDoc(f || { name: clean, size: Buffer.byteLength(text), addedAt: new Date().toISOString() });
      });
    },

    get(id) {
      checkId(id);
      return withDb((db) => {
        const f = sync(db).find((x) => x.name === id);
        if (!f) throw notFound();
        const text = readText(id);
        if (text === null) throw notFound();
        return { doc: toDoc(f), text };
      });
    },

    remove(id) {
      checkId(id);
      return withDb((db) => {
        const f = sync(db).find((x) => x.name === id);
        if (!f) throw notFound();
        unlinkSync(join(dir, id));
        sync(db);
        return { ok: true };
      });
    },

    search(q, limit = 20) {
      const { words, match } = ftsQuery(q);
      if (!words.length) return [];
      return withDb((db) => {
        sync(db);
        let rows;
        try {
          rows = db.prepare(
            "SELECT name, text FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank LIMIT ?",
          ).all(match, limit);
        } catch {
          return [];
        }
        const lower = words.map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""));
        return rows.map((r) => ({ docId: r.name, name: r.name, snippet: snippet(r.text, lower) }));
      });
    },
  };
}
