// The brain's index (PLAN-BRAIN D1, B1, B2): built whole from the owner's files and the books' records, into a
// temp file in <state>/brain, then published by rename as index.sqlite. Readers (the home server, the brain
// door) open it read-only.
//   - Files are listed and read only through the store (`brainFor(config).list()` and `get(token)`); the
//     indexer never makes a path into the knowledge folder of its own.
//   - Records come from `pullRecords` (the trust rule of B3). With the books off, the records of the last good
//     pull of this run are kept, else there are none.
//   - <state>/brain must be a plain folder (not a link) whose real path is the state folder's own `brain`;
//     otherwise nothing is written and one line is logged.
//   - The temp file is made with `wx` and mode 0600, written in one transaction with journal DELETE, closed,
//     chmod 0600, renamed into place. Stale temp files of its own naming are removed.
//   - One build at a time: a second call while one runs gets the same promise.
//
// indexFor(config) -> { ensureFresh(ctx), rebuild(ctx, { books }), status(), open() }, one per config.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { DDL } from "../../../brain/schema.mjs";
import { openIndex } from "../../../brain/retrieve.mjs";
import { BASICS } from "../lib/brainfiles.mjs";
import { brainFor } from "./store.mjs";
import { cutFile } from "./passages.mjs";
import { pullRecords } from "./records.mjs";
import { aliasesOf, findMentions } from "./links.mjs";

export const MAX_PASSAGES_TOTAL = 20000;
export const MAX_TEXT_BYTES_TOTAL = 20 * 1024 * 1024;
export const CHECK_EVERY_MS = 5000;
export const BOOKS_EVERY_MS = 15 * 60 * 1000;
const MAX_TRUNCATED = 500;
const FILE_PASSAGE_CAP = 400;
const TMP_NAME = /^index\.[0-9a-f]{16}\.tmp(-journal)?$/;
const BOOKS_STATES = new Set(["ok", "off", "not_installed"]);
const ENTITY_TYPES = new Set(["customer", "person", "deal", "invoice", "project", "ticket"]);
const LINK_TYPES = new Set(["invoice_of", "deal_of", "project_of", "ticket_of", "contact_of"]);

const lstatOrNull = (p) => { try { return lstatSync(p); } catch { return null; } };
const realOrNull = (p) => { try { return realpathSync(p); } catch { return null; } };
const firstLine = (e) => String(e?.message || e).split("\n")[0].slice(0, 200);
const logOf = (ctx) => (typeof ctx?.log === "function" ? ctx.log : () => {});
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// The listing as the fingerprint sees it: path, size and time of each file, in path order.
function listingOf(store) {
  const files = store.list();
  const rows = files.map((f) => `${f.path}\u0000${f.size}\u0000${f.changedAt}`).sort();
  return { files, key: sha256(rows.join("\n")) };
}

// <state>/brain, made 0700 when missing; null when it is a link, not a folder, or not the state's own `brain`.
function brainDir(config) {
  const dir = config.paths.brainDir;
  const state = config.paths.state;
  if (typeof dir !== "string" || typeof state !== "string") return null;
  if (!lstatOrNull(dir)) {
    try { mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e?.code !== "EEXIST") return null; }
  }
  const st = lstatOrNull(dir);
  if (!st || !st.isDirectory()) return null; // lstat: a link is never a directory
  const stateReal = realOrNull(state);
  if (!stateReal || realOrNull(dir) !== join(stateReal, "brain")) return null;
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) return null;
  if ((st.mode & 0o777) !== 0o700) { try { chmodSync(dir, 0o700); } catch { return null; } }
  return dir;
}

function removeStaleTemps(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!TMP_NAME.test(n)) continue;
    const st = lstatOrNull(join(dir, n));
    if (st && (st.isFile() || st.isSymbolicLink())) { try { unlinkSync(join(dir, n)); } catch { /* gone */ } }
  }
}

// Reads every listed file through the store and cuts it. -> { passages, files, truncated }
function filePassages(store, files) {
  const out = [];
  const truncated = new Set();
  let count = 0;
  for (const f of files) {
    let text = null;
    let cutByStore = false;
    if (f.kind === "text" || f.kind === "table") {
      let got;
      try { got = store.get(f.token); } catch { continue; } // gone since the listing
      text = typeof got?.text === "string" ? got.text : null;
      cutByStore = Boolean(got?.truncated);
      if (text === null) continue;
    } else if (f.kind !== "image" && f.kind !== "pdf") continue;
    const cut = cutFile({ path: f.path, name: f.name, kind: f.kind, text });
    if (cutByStore || cut.length >= FILE_PASSAGE_CAP) truncated.add(f.path);
    count += 1;
    for (const p of cut) out.push({ ...p, source: f.path, at: f.changedAt || null });
  }
  return { passages: out, files: count, truncated };
}

// Writes the whole index into `tmp` (an empty file made 0600 with wx). Returns the counts.
function writeIndex(tmp, { filePs, records, meta }) {
  const db = new DatabaseSync(tmp);
  const truncated = meta.truncatedSet;
  let passages = 0;
  let recordsIn = 0;
  let bytes = 0;
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    for (const s of DDL) db.exec(s);
    db.exec("BEGIN");
    const insP = db.prepare("INSERT INTO passages (kind, trust, source, title, locator, ord, text, at, entity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insF = db.prepare("INSERT INTO fts (rowid, title, text) VALUES (?, ?, ?)");
    const insE = db.prepare("INSERT INTO entities (type, key, name) VALUES (?, ?, ?)");
    const insA = db.prepare("INSERT INTO aliases (entity, alias) VALUES (?, ?)");
    const insL = db.prepare("INSERT OR IGNORE INTO links (src, dst, type) VALUES (?, ?, ?)");
    const insM = db.prepare("INSERT OR IGNORE INTO mentions (passage, entity) VALUES (?, ?)");
    const room = (text) => passages < MAX_PASSAGES_TOTAL && bytes + Buffer.byteLength(text, "utf8") <= MAX_TEXT_BYTES_TOTAL;
    const put = (kind, trust, p, entity) => {
      const id = Number(insP.run(kind, trust, p.source, p.title, p.locator ?? "", p.ord ?? 0, p.text, p.at ?? null, entity ?? null).lastInsertRowid);
      insF.run(id, p.title, p.text);
      passages += 1;
      bytes += Buffer.byteLength(p.text, "utf8");
      return id;
    };

    // Entities and aliases of the records (a key seen twice keeps the first).
    const entityId = new Map();
    const forAliases = [];
    for (const r of records) {
      const e = r?.entity;
      if (!e || !ENTITY_TYPES.has(e.type) || typeof e.key !== "string" || entityId.has(e.key)) continue;
      const id = Number(insE.run(e.type, e.key, String(e.name ?? "")).lastInsertRowid);
      entityId.set(e.key, id);
      const as = aliasesOf([{ id, aliases: (e.type === "customer" || e.type === "person") && Array.isArray(e.aliases) ? e.aliases : [] }]);
      for (const a of as) insA.run(id, a.alias);
      forAliases.push(...as);
    }
    const aliases = aliasesOf(forAliases.map((a) => ({ id: a.entity, aliases: [a.alias] })));

    // The owner's files first, then the records, under the caps.
    for (const p of filePs) {
      if (!room(p.text)) { if (truncated.size < MAX_TRUNCATED) truncated.add(p.source); continue; }
      const id = put("file", "owner", p, null);
      for (const ent of findMentions(`${p.title}\n${p.text}`, aliases)) insM.run(id, ent);
    }
    for (const r of records) {
      const p = r?.passage;
      if (!p || typeof p.source !== "string" || typeof p.text !== "string" || !room(p.text)) continue;
      const own = r.entity && entityId.has(r.entity.key) ? entityId.get(r.entity.key) : null;
      put("record", "books", { ...p, locator: "", ord: 0 }, own);
      recordsIn += 1;
      if (own === null) continue;
      for (const l of Array.isArray(r.links) ? r.links : []) {
        if (!LINK_TYPES.has(l?.type) || !entityId.has(l.toKey)) continue;
        insL.run(own, entityId.get(l.toKey), l.type);
      }
    }

    const rows = {
      builtAt: meta.builtAt, fingerprint: meta.fingerprint, books: meta.books, booksAt: meta.booksAt,
      files: String(meta.files), records: String(recordsIn), passages: String(passages), leftOut: String(meta.leftOut),
      truncated: JSON.stringify([...truncated].slice(0, MAX_TRUNCATED)), basics: JSON.stringify(BASICS.map((b) => b.file)),
    };
    const insMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const [k, v] of Object.entries(rows)) insMeta.run(k, v);
    db.exec("COMMIT");
    return rows;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* not in a transaction */ }
    throw e;
  } finally {
    db.close();
  }
}

// The B10 shape from meta rows; all null before the first build.
function statusOf(rows, building) {
  if (!rows) {
    return { builtAt: null, files: null, records: null, passages: null, books: null, booksAt: null, leftOut: null, truncated: null, building };
  }
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  let truncated = [];
  try { const t = JSON.parse(rows.truncated ?? "[]"); truncated = Array.isArray(t) ? t.filter((x) => typeof x === "string") : []; } catch { truncated = []; }
  return {
    builtAt: rows.builtAt ?? null, files: n(rows.files), records: n(rows.records), passages: n(rows.passages),
    books: BOOKS_STATES.has(rows.books) ? rows.books : null, booksAt: typeof rows.booksAt === "string" ? rows.booksAt : null,
    leftOut: n(rows.leftOut), truncated, building,
  };
}

export function createIndexer(config, { now = Date.now, checkEveryMs = CHECK_EVERY_MS, booksEveryMs = BOOKS_EVERY_MS } = {}) {
  let running = null;      // the promise of the build in progress
  let built = null;        // meta rows of the last build published by this run
  let lastPull = null;     // { records, leftOut, at } of the last good pull of this run
  let pulledAt = null;     // time (ms) of the last pull tried
  let checkedAt = null;    // time (ms) of the last listing check
  let triedListing = null; // listing key of the last build tried, published or not
  let booksNow = null;     // what the last pull tried found: ok | off | not_installed

  const open = () => openIndex(config.paths.brainIndex);

  function readMetaFromDisk() {
    const ix = open();
    if (!ix) return null;
    try {
      const rows = {};
      for (const r of ix.db.prepare("SELECT key, value FROM meta").all()) rows[r.key] = r.value;
      return rows;
    } catch {
      return null;
    } finally {
      try { ix.db.close(); } catch { /* closed */ }
    }
  }

  function status() {
    if (!built) built = readMetaFromDisk();
    return statusOf(built, running !== null);
  }

  async function build(ctx, books) {
    const log = logOf(ctx);
    // Books first (the only wait), then the files as they are now.
    let booksState;
    if (books) {
      pulledAt = now();
      let got;
      try {
        got = await pullRecords(ctx);
      } catch (e) {
        log(`brain index: the books could not be read: ${firstLine(e)}`);
        got = { state: "off", records: [], leftOut: 0 };
      }
      booksState = BOOKS_STATES.has(got.state) ? got.state : "off";
      booksNow = booksState;
      if (got.state === "ok") lastPull = { records: got.records, leftOut: got.leftOut, at: new Date(now()).toISOString() };
      else if (got.state === "not_installed") lastPull = null;
    } else {
      booksState = booksNow ?? "off";
    }
    const records = lastPull ? lastPull.records : [];
    const leftOut = lastPull ? lastPull.leftOut : 0;
    const booksAt = lastPull ? lastPull.at : "";

    const store = brainFor(config);
    const listing = listingOf(store);
    triedListing = listing.key;
    checkedAt = now();

    const dir = brainDir(config);
    if (!dir) {
      log("brain index: <state>/brain is not a plain folder of the state folder, so no index was written.");
      return status();
    }
    removeStaleTemps(dir);
    const { passages: filePs, files, truncated } = filePassages(store, listing.files);

    const tmp = join(dir, `index.${randomBytes(8).toString("hex")}.tmp`);
    try {
      closeSync(openSync(tmp, "wx", 0o600));
      const rows = writeIndex(tmp, {
        filePs, records,
        meta: {
          builtAt: new Date(now()).toISOString(), fingerprint: sha256(`${listing.key}\n${booksAt}`), books: booksState, booksAt,
          files, leftOut, truncatedSet: truncated,
        },
      });
      chmodSync(tmp, 0o600);
      renameSync(tmp, config.paths.brainIndex);
      built = rows;
    } catch (e) {
      log(`brain index: the index could not be written: ${firstLine(e)}`);
      for (const p of [tmp, `${tmp}-journal`]) { try { unlinkSync(p); } catch { /* not there */ } }
    }
    return status();
  }

  function rebuild(ctx, { books = true } = {}) {
    if (running) return running;
    running = (async () => {
      try {
        return await build(ctx, books);
      } catch (e) {
        logOf(ctx)(`brain index: ${firstLine(e)}`);
        return null;
      } finally {
        running = null;
      }
    })().then(() => status());
    return running;
  }

  function ensureFresh(ctx) {
    try {
      if (running) return status();
      const t = now();
      if (checkedAt !== null && t - checkedAt < checkEveryMs) return status();
      checkedAt = t;
      const booksDue = pulledAt === null || t - pulledAt >= booksEveryMs;
      let changed = booksDue || triedListing === null;
      if (!changed) changed = listingOf(brainFor(config)).key !== triedListing;
      if (changed) rebuild(ctx, { books: booksDue }).catch(() => {});
      return status();
    } catch (e) {
      try { logOf(ctx)(`brain index: ${firstLine(e)}`); } catch { /* nothing more to do */ }
      try { return status(); } catch { return statusOf(null, false); }
    }
  }

  return { ensureFresh, rebuild, status, open };
}

// One indexer per config (each test home has its own), as brainFor.
const indexers = new WeakMap();
export function indexFor(config) {
  if (!indexers.has(config)) indexers.set(config, createIndexer(config));
  return indexers.get(config);
}
