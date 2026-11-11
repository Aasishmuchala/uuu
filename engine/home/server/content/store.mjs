// Content drafts (CONTRACTS 9.8). Marketers write `<goal folder>/content/<slug>.md` inside the task tree;
// this store finds those files, and keeps one JSON record per file in state/content/drafts/. Files written
// by agents are untrusted: they are read only from tasks/company-work/<goal>/content/, never through a
// link, with a size cap, and their text is kept as text. Nothing here publishes, posts or sends.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

export const MAX_FILE_BYTES = 100 * 1024;
const MAX_FILES = 500;
const MAX_GOAL_FOLDERS = 500;
const CHANNELS = ["post", "newsletter"];
const ID_RE = /^[0-9a-f]{12}$/;

export const isDraftId = (id) => typeof id === "string" && ID_RE.test(id);

const cleanLine = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// -> { ok: true, title, channel, planned, body } | { ok: false, problem }
export function parseDraft(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0].trim() !== "---") return { ok: false, problem: "The file does not start with a header between two --- lines." };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { ok: false, problem: "The header is not closed with a second --- line." };
  const head = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z]+)\s*:(.*)$/.exec(line);
    if (m && !(m[1].toLowerCase() in head)) head[m[1].toLowerCase()] = cleanLine(m[2]);
  }
  if (!head.title) return { ok: false, problem: "The header has no title." };
  if (head.title.length > 200) return { ok: false, problem: "The title is longer than 200 characters." };
  if (!CHANNELS.includes(head.channel)) return { ok: false, problem: "The channel must be post or newsletter." };
  if (!head.planned || !validDate(head.planned)) return { ok: false, problem: "The planned date must look like 2026-11-30." };
  return { ok: true, title: head.title, channel: head.channel, planned: head.planned, body: lines.slice(end + 1).join("\n").trim() };
}

const idOf = (sourcePath) => createHash("sha256").update(sourcePath).digest("hex").slice(0, 12);

function readCapped(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { problem: "It is not a plain file." };
    if (st.size > MAX_FILE_BYTES) return { problem: "The file is larger than 100 KB." };
    return { buffer: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

function realDir(dir) {
  try {
    return lstatSync(dir).isDirectory() ? realpathSync(dir) : null;
  } catch {
    return null;
  }
}

// Every content file found: [{ sourcePath, text } | { sourcePath, problem }], sourcePath relative to `root`.
function scan(root) {
  const found = [];
  const realRoot = realDir(root);
  if (!realRoot) return found;
  let goals;
  try { goals = readdirSync(root).sort().slice(0, MAX_GOAL_FOLDERS); } catch { return found; }
  for (const goal of goals) {
    const contentDir = join(root, goal, "content");
    let real;
    try {
      if (!lstatSync(join(root, goal)).isDirectory()) continue;
      real = realDir(contentDir);
    } catch { continue; }
    if (!real || !real.startsWith(realRoot + sep)) continue;
    let names;
    try { names = readdirSync(contentDir).filter((n) => n.endsWith(".md")).sort(); } catch { continue; }
    for (const name of names) {
      if (found.length >= MAX_FILES) return found;
      const sourcePath = `${goal}/content/${name}`;
      const file = join(contentDir, name);
      try {
        if (!lstatSync(file).isFile()) continue;
        const r = readCapped(file);
        if (r.problem) { found.push({ sourcePath, problem: r.problem }); continue; }
        found.push({ sourcePath, buffer: r.buffer });
      } catch {
        found.push({ sourcePath, problem: "The file could not be read." });
      }
    }
  }
  return found;
}

export function createStore({ root, draftsDir }) {
  const fileFor = (id) => join(draftsDir, `${id}.json`);

  function read(id) {
    if (!isDraftId(id)) return null;
    try {
      const d = JSON.parse(readFileSync(fileFor(id), "utf8"));
      if (!d || typeof d !== "object" || d.id !== id || typeof d.title !== "string" || typeof d.body !== "string") return null;
      if (!["draft", "approved", "sent_back"].includes(d.status)) return null;
      return d;
    } catch {
      return null;
    }
  }

  function write(d) {
    mkdirSync(draftsDir, { recursive: true, mode: 0o700 });
    const tmp = `${fileFor(d.id)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(d, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, fileFor(d.id));
    return d;
  }

  // Apply the rules of 9.8 to what is on disk now. -> { drafts: [...sorted by planned date], problems: [{ file, problem }] }
  function sync() {
    const problems = [];
    const seen = new Set();
    for (const f of scan(root)) {
      const id = idOf(f.sourcePath);
      const label = f.sourcePath.split("/").pop();
      const parsed = f.problem ? { ok: false, problem: f.problem } : parseDraft(f.buffer.toString("utf8"));
      if (!parsed.ok) { problems.push({ file: label, problem: parsed.problem }); continue; }
      seen.add(id);
      const hash = createHash("sha256").update(f.buffer).digest("hex");
      const old = read(id);
      if (!old) {
        write({
          id, title: parsed.title, channel: parsed.channel, planned: parsed.planned, body: parsed.body,
          status: "draft", note: null, raisedBy: "Marketer", sourcePath: f.sourcePath, sourceHash: hash,
          createdAt: new Date().toISOString(), decidedAt: null,
        });
      } else if (old.status !== "approved" && old.sourceHash !== hash) {
        write({ ...old, title: parsed.title, channel: parsed.channel, planned: parsed.planned, body: parsed.body,
          status: "draft", note: null, sourceHash: hash, decidedAt: null });
      }
    }
    let names = [];
    try { names = readdirSync(draftsDir); } catch { names = []; }
    const drafts = names.filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -5))).filter(Boolean)
      .sort((a, b) => a.planned.localeCompare(b.planned) || a.id.localeCompare(b.id));
    return { drafts, problems };
  }

  // Only the status, the note and the decision time ever change from the owner's side.
  function decide(id, status, note) {
    const d = read(id);
    if (!d) return null;
    return write({ ...d, status, note: note ?? d.note, decidedAt: new Date().toISOString() });
  }

  return { sync, read, decide };
}
