// The brain door (PLAN-BRAIN B9): how an agent asks the company brain's index a question, or
// reads the brain notes the home server made for its task. It runs unfenced and trusts nothing a
// request carries (docs/adr/0007). It opens nothing but its secret, ids.json, the switches file,
// the index (read-only, through openIndex) and the notes folder (no-follow); it writes only its
// status file and brain-asks.jsonl. Checks, in B9's order: upgrades and CONNECT, the token (this
// door's own secret; an agent of `doors.brain.agents`, never the Researcher, never an app; or the
// owner's test token), the switch, the path, the agent's rate, the body, the index, the notes. The rate
// comes before the body is read, so every call of an agent counts, a bad body too (T18's finding 2).
// Books records (record passages and the links between them) reach only the owner and the agents of
// `doors.brain.records` (the owner's answer 2); every other agent gets the owner's files only, in an
// answer and in notes alike.
// Log lines never hold a header, a body, a token or a question.
import http from "node:http";
import {
  chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync,
  renameSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCaller, ensureSecret, readBody, readDoorsState, sendJson, statusFile, wantsUpgrade } from "../doors/common.mjs";
import { NOTICE, ask, openIndex } from "./retrieve.mjs";

export { NOTICE };
export const BODY_BYTES = 2 * 1024;
export const NOTES_BYTES = 64 * 1024;
export const PER_HOUR = 120;
export const PER_DAY = 600;
export const ASKS_MAX = 2500;
export const ASKS_KEEP = 2000;
export const TASK_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const ASK_LIMIT = 8;
const ASK_CHARS = 8000;
const NOTES_RESULTS = 8;
const NOTES_CHARS = 6000;
const TEXT_MAX = 900;
const LINKS_MAX = 20;
const NOT_FOUND_MAX = 12;
// The Researcher is refused here whatever the config's list says (PLAN-BRAIN D5).
const NEVER = new Set(["researcher"]);

// Every refusal: [status, sentence], as B9 gives them.
export const CODES = Object.freeze({
  brain_bad_request: [400, "The brain door takes plain requests only."],
  brain_no_token: [401, "The brain door needs an agent's token."],
  brain_off: [403, "The brain door is switched off."],
  brain_bad_path: [404, "The brain door has no such address."],
  brain_bad_body: [400, "The brain door could not read this."],
  brain_too_many: [429, "That is too many questions for now. Try again later."],
  brain_no_index: [503, "The brain has no index yet."],
  brain_no_notes: [404, "There are no notes for this task. Ask a question instead."],
});

// The two addresses that take a token, by the raw target: no decoding, no query string.
const ROUTES = { "/brain/ask": "ask", "/brain/notes": "notes" };

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const oneLine = (s, max) => String(s).replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));

// The body as exactly the route's one key of the right kind; null otherwise.
function parseBody(name, buf) {
  let v;
  try { v = JSON.parse(buf.toString("utf8")); } catch { return null; }
  if (!isObject(v)) return null;
  const keys = Object.keys(v);
  const key = name === "ask" ? "q" : "task";
  if (keys.length !== 1 || keys[0] !== key || typeof v[key] !== "string") return null;
  if (name === "ask") {
    const q = v.q.trim();
    return q.length >= 2 && q.length <= 400 ? { q } : null;
  }
  return TASK_RE.test(v.task) ? { task: v.task } : null;
}

// The config's paths the door uses; each one is needed.
function doorPaths(cfg) {
  const p = (cfg && cfg.paths) || {};
  const out = {
    state: p.doorsState, ids: p.ids, secret: p.brainSecret, status: p.brainStatus, asks: p.brainAsks,
    dir: p.brainDir, index: p.brainIndex, notes: p.brainNotes,
  };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== "string" || v === "") throw new Error(`createBrainDoor: the config has no path for ${k}`);
  }
  return out;
}

// A folder of the engine's own: a real folder, not a link, this user's, no write bit for others.
function ownDir(path) {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

// A file's text when it is a regular file of this user's with no write bit for others and at
// most `max` bytes, opened without following a link; null otherwise. Checked on the open handle.
function readOwnFile(path, max) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
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

const str = (v) => typeof v === "string";
const strOrNull = (v) => v === null || typeof v === "string";

// A notes file as B8 gives it, checked field by field and capped again; null for any other shape.
export function checkNotes(data, taskId) {
  if (!isObject(data) || data.version !== 1 || data.taskId !== taskId || !str(data.at) || data.at.length > 40) return null;
  if (!Array.isArray(data.results) || !Array.isArray(data.links) || !Array.isArray(data.notFound)) return null;
  const results = [];
  let used = 0;
  for (const r of data.results) {
    if (!isObject(r) || !Number.isInteger(r.n) || !["file", "record"].includes(r.kind)) return null;
    if (!str(r.source) || !str(r.title) || !str(r.locator) || !str(r.text) || !strOrNull(r.at)) return null;
    if (results.length >= NOTES_RESULTS || used >= NOTES_CHARS) break;
    const text = r.text.slice(0, Math.min(TEXT_MAX, NOTES_CHARS - used));
    used += text.length;
    results.push({
      n: results.length + 1, kind: r.kind, source: r.source.slice(0, 300), title: r.title.slice(0, 200),
      locator: r.locator.slice(0, 200), text, at: r.at === null ? null : r.at.slice(0, 40),
    });
  }
  const links = [];
  const end = (e) => isObject(e) && str(e.type) && str(e.name);
  for (const l of data.links) {
    if (!isObject(l) || !end(l.from) || !end(l.to) || !str(l.type)) return null;
    if (links.length >= LINKS_MAX) break;
    links.push({
      from: { type: l.from.type.slice(0, 20), name: l.from.name.slice(0, 120) },
      type: l.type.slice(0, 20),
      to: { type: l.to.type.slice(0, 20), name: l.to.name.slice(0, 120) },
    });
  }
  if (!data.notFound.every(str)) return null;
  const notFound = data.notFound.slice(0, NOT_FOUND_MAX).map((t) => t.slice(0, 80));
  return { version: 1, taskId, at: data.at, notice: NOTICE, results, links, notFound };
}

// The notes for an agent who may not see books records: the notes builder's `plain` part (asked
// with the owner's files only) when it is there and well formed; else the notes with every record
// passage and every link left out. Either way no record passage and no link comes back.
export function notesWithoutRecords(data, taskId) {
  const plain = isObject(data) && isObject(data.plain)
    ? checkNotes({ version: data.version, taskId: data.taskId, at: data.at, ...data.plain }, taskId) : null;
  const base = plain || checkNotes(data, taskId);
  if (!base) return null;
  const results = base.results.filter((r) => r.kind === "file").map((r, i) => ({ ...r, n: i + 1 }));
  return { ...base, results, links: [] };
}

// Calls per agent in the last day, in memory. Only the agents on the list are ever keys.
function rateTable() {
  const calls = new Map(); // slug -> [ms, ...], oldest first
  const told = new Map(); // slug -> ms of the last asks line for a call over the limit
  return {
    // While an agent is over its limit, true at most once an hour: the asks file gets that one line, so refusals
    // cannot push real questions out of it.
    tell(slug, now) {
      const last = told.get(slug);
      if (last !== undefined && now - last < HOUR_MS) return false;
      told.set(slug, now);
      return true;
    },
    admit(slug, now) {
      const list = (calls.get(slug) || []).filter((t) => t > now - DAY_MS);
      const inHour = list.filter((t) => t > now - HOUR_MS).length;
      if (inHour >= PER_HOUR || list.length >= PER_DAY) {
        calls.set(slug, list);
        return false;
      }
      list.push(now);
      calls.set(slug, list);
      return true;
    },
  };
}

// brain-asks.jsonl: one line a call, appended without following a link; when it reaches
// ASKS_MAX lines it is cut to the newest ASKS_KEEP, by temp file and rename.
function asksFile(path) {
  let lines = null;
  const count = () => {
    const text = readOwnFile(path, 8 * 1024 * 1024);
    return text === null ? 0 : text.split("\n").filter(Boolean).length;
  };
  function cut() {
    const text = readOwnFile(path, 8 * 1024 * 1024);
    const keep = text === null ? [] : text.split("\n").filter(Boolean).slice(-ASKS_KEEP);
    const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      writeFileSync(tmp, keep.length ? `${keep.join("\n")}\n` : "", { mode: 0o600, flag: "wx" });
      renameSync(tmp, path);
      lines = keep.length;
    } catch {
      try { unlinkSync(tmp); } catch { /* nothing was left */ }
    }
  }
  return {
    add(entry) {
      try {
        if (lines === null) lines = count();
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        try {
          const st = fstatSync(fd);
          if (!st.isFile() || st.uid !== process.getuid()) return;
          writeSync(fd, `${JSON.stringify(entry)}\n`);
        } finally {
          closeSync(fd);
        }
        lines += 1;
        if (lines >= ASKS_MAX) cut();
      } catch {
        // A failed line changes no answer.
      }
    },
  };
}

export function createBrainDoor({ config, log, now } = {}) {
  const P = doorPaths(config);
  const doors = config && config.doors && config.doors.brain;
  const agents = doors && Array.isArray(doors.agents)
    ? doors.agents.filter((s) => typeof s === "string" && !NEVER.has(s)) : [];
  // Who may see books records: on both lists. None when the config has no `records`.
  const records = new Set(doors && Array.isArray(doors.records)
    ? doors.records.filter((s) => typeof s === "string" && agents.includes(s)) : []);
  const seesRecords = (who) => who.kind === "t" || (who.kind === "a" && records.has(who.slug));
  const clock = typeof now === "function" ? now : typeof now === "number" ? () => now : () => Date.now();
  const iso = () => new Date(clock()).toISOString();
  const say = (line) => {
    try { if (typeof log === "function") log(line); } catch { /* a log failure changes nothing */ }
  };
  const rate = rateTable();
  const asks = asksFile(P.asks);

  // ---- the status file
  const status = { startedAt: null, on: false, today: { day: null, asks: 0, notes: 0, refused: 0 }, lastAt: null };
  const statusOut = statusFile(P.status);
  const bump = (what) => {
    const day = dayOf(clock());
    if (status.today.day !== day) status.today = { day, asks: 0, notes: 0, refused: 0 };
    status.today[what] += 1;
    status.lastAt = iso();
    statusOut.save(status);
  };
  const switchOn = () => {
    const ws = readDoorsState(P.state);
    return ws.ok === true && ws.brain && ws.brain.on === true;
  };
  // The owner's own Test question from Settings (an `ask` with the owner's test token) is let through while the
  // switch is off, as the web door's Test is. Nothing else: no agent, no notes, and not a switches file that
  // cannot be trusted.
  const ownerTestWhileOff = (who, name) => isObject(who) && who.kind === "t" && who.subject === "owner" && name === "ask"
    && readDoorsState(P.state).ok === true;

  // ---- the index: one read-only handle, opened again when the file changes
  let cached = null; // { handle, ino, dev, mtimeMs, ctimeMs, size }
  const statOf = (path) => {
    try { return lstatSync(path); } catch { return null; }
  };
  const same = (a, b) => a && b && a.ino === b.ino && a.dev === b.dev && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size;
  function dropIndex() {
    if (!cached) return;
    try { cached.handle.db.close(); } catch { /* already closed */ }
    cached = null;
  }
  function currentIndex() {
    if (!ownDir(P.dir)) { dropIndex(); return null; }
    const before = statOf(P.index);
    if (!before) { dropIndex(); return null; }
    if (cached && same(cached, before)) return cached.handle;
    dropIndex();
    const handle = openIndex(P.index);
    if (!handle) return null;
    const after = statOf(P.index);
    if (!same(before, after)) {
      try { handle.db.close(); } catch { /* already closed */ }
      return null;
    }
    cached = { handle, ino: after.ino, dev: after.dev, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, size: after.size };
    return handle;
  }
  function indexFacts() {
    const h = currentIndex();
    if (!h) return null;
    let passages = null;
    try {
      const row = h.db.prepare("SELECT value FROM meta WHERE key = ?").get("passages");
      const n = Number(row && row.value);
      passages = Number.isSafeInteger(n) && n >= 0 ? n : null;
      if (passages === null) passages = Number(h.db.prepare("SELECT count(*) AS n FROM passages").get().n) || 0;
    } catch {
      passages = null;
    }
    return { builtAt: h.builtAt, passages };
  }

  // ---- notes
  function readNotes(task, withRecords) {
    if (!TASK_RE.test(task) || !ownDir(P.dir) || !ownDir(P.notes)) return null;
    const text = readOwnFile(join(P.notes, `${task}.json`), NOTES_BYTES);
    if (text === null) return null;
    try {
      const data = JSON.parse(text);
      return withRecords ? checkNotes(data, task) : notesWithoutRecords(data, task);
    } catch { return null; }
  }

  // ---- answers
  function no(res, code) {
    bump("refused");
    say(`${iso()} refused ${code}`);
    const [st, sentence] = CODES[code];
    if (res.headersSent) return void res.destroy();
    return sendJson(res, st, { error: sentence, code });
  }
  const caller = (req) => checkCaller({
    rawHeaders: req.rawHeaders, secretPath: P.secret, idsPath: P.ids, agents, apps: [], now: clock(),
  });
  const whoOf = (who) => (who.kind === "t" ? "owner" : who.slug);
  const record = (agent, kind, q, st, results) => asks.add({
    at: iso(), agent, kind, q: q === null ? null : oneLine(q, 200), status: st, results,
  });

  async function onRequest(req, res) {
    // 1. Upgrades are never let through (CONNECT and upgrades also land in onRaw).
    if (wantsUpgrade(req.rawHeaders) || req.method === "CONNECT") return no(res, "brain_bad_request");
    const target = req.url;
    // Health: no token, only B9's fields.
    if (req.method === "GET" && target === "/brain/health") {
      const index = indexFacts();
      status.on = switchOn();
      return sendJson(res, 200, { part: "brain", ok: true, on: status.on, index });
    }
    // 2. The token.
    let who = caller(req);
    if (!isObject(who) || !(who.kind === "a" || (who.kind === "t" && who.subject === "owner"))) return no(res, "brain_no_token");
    // 3. The switch (the owner's Test is let through while it is off).
    const name = req.method === "POST" && Object.hasOwn(ROUTES, target) ? ROUTES[target] : null;
    status.on = switchOn();
    if (!status.on && !ownerTestWhileOff(who, name)) return no(res, "brain_off");
    // 4. The path, as sent.
    if (name === null) return no(res, "brain_bad_path");
    const agent = whoOf(who);
    // 5. The agent's rate, before the body is read: every call counts. Over the limit, one asks line an hour.
    if (who.kind === "a" && !rate.admit(who.slug, clock())) {
      if (rate.tell(who.slug, clock())) record(agent, name, null, "brain_too_many", 0);
      return no(res, "brain_too_many");
    }
    // 6. The body.
    const raw = await readBody(req, BODY_BYTES);
    if (raw === null) return undefined;
    const body = raw === "too-big" ? null : parseBody(name, raw);
    if (body === null) {
      record(agent, name, null, "brain_bad_body", 0);
      return no(res, "brain_bad_body");
    }
    const q = name === "ask" ? body.q : null;
    // 2 and 3 again: the owner may have switched off, or the token run out, while the body arrived.
    who = caller(req);
    if (!isObject(who) || whoOf(who) !== agent) return no(res, "brain_no_token");
    if (!switchOn() && !ownerTestWhileOff(who, name)) {
      record(agent, name, q, "brain_off", 0);
      return no(res, "brain_off");
    }
    if (name === "ask") {
      // 7. The index.
      const h = currentIndex();
      if (!h) {
        record(agent, name, q, "brain_no_index", 0);
        return no(res, "brain_no_index");
      }
      const out = ask(h.db, q, { limit: ASK_LIMIT, maxChars: ASK_CHARS, records: seesRecords(who) });
      record(agent, name, q, 200, out.results.length);
      bump("asks");
      say(`${iso()} ask ${agent} ${out.results.length}`);
      return sendJson(res, 200, { notice: NOTICE, results: out.results, links: out.links, notFound: out.notFound, builtAt: h.builtAt });
    }
    // 8. The notes.
    const notes = readNotes(body.task, seesRecords(who));
    if (notes === null) {
      record(agent, name, null, "brain_no_notes", 0);
      return no(res, "brain_no_notes");
    }
    record(agent, name, null, 200, notes.results.length);
    bump("notes");
    say(`${iso()} notes ${agent} ${notes.results.length}`);
    return sendJson(res, 200, notes);
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res).catch(() => {
      if (!res.headersSent) no(res, "brain_bad_body");
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  // Upgrades and CONNECT: one refusal on the raw socket, then it is closed.
  const onRaw = (_req, socket) => {
    bump("refused");
    say(`${iso()} refused brain_bad_request`);
    const text = JSON.stringify({ error: CODES.brain_bad_request[1], code: "brain_bad_request" });
    socket.pause();
    socket.removeAllListeners("data");
    socket.on("error", () => {});
    if (!socket.writable) return void socket.destroy();
    socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n` +
      `Cache-Control: no-store\r\nConnection: close\r\n\r\n${text}`, () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  };
  server.on("upgrade", onRaw);
  server.on("connect", onRaw);

  return {
    server,
    get url() {
      const a = server.address();
      return a && typeof a === "object" ? `http://127.0.0.1:${a.port}` : null;
    },
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          status.startedAt = iso();
          status.on = switchOn();
          statusOut.save(status);
          statusOut.flush();
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        const done = () => {
          dropIndex();
          if (status.startedAt) statusOut.flush();
          resolve();
        };
        if (!server.listening) return void done();
        server.close(done);
        server.closeAllConnections();
      });
    },
  };
}

function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

const describe = (err) => (err && (err.code || err.name)) || "error";

async function main() {
  const lastResort = (err) => console.log(`${new Date().toISOString()} brain door caught an error it did not expect: ${describe(err)}`);
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { loadConfig } = await import("../lib/config.mjs");
  const cfg = loadConfig();
  ownFolder(cfg.paths.doors);
  ensureSecret(cfg.paths.brainSecret);
  const door = createBrainDoor({ config: cfg, log: (line) => console.log(line) });
  try {
    await door.listen(cfg.ports.brain);
  } catch (err) {
    console.log(`${new Date().toISOString()} brain door could not start on 127.0.0.1:${cfg.ports.brain}: ${describe(err)}`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} brain door started on 127.0.0.1:${cfg.ports.brain}`);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    await door.close();
    console.log(`${new Date().toISOString()} brain door stopped (${signal})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

const self = fileURLToPath(import.meta.url);
let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = "";
}
if (invoked === realpathSync(self)) {
  main().catch((err) => {
    console.log(`${new Date().toISOString()} brain door failed: ${describe(err)}`);
    process.exit(1);
  });
}
