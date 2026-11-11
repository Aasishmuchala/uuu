// CONTRACTS-V2 17.5 (V28): the owner adds, rewrites and removes an agent's lessons.
// Agents read state/lessons/<slug>.md at the start of every run and may append to it at any moment, so:
// the path is built only from a slug found in the company file, a link is refused, the file is rewritten
// through a temp file and a rename, lines that are not lessons stay as they are, and when the file changed
// on disk between the read and the rename the edit is tried once more from the new content, then refused.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeSync, fsyncSync, fchmodSync } from "node:fs";
import { join } from "node:path";
import { loadRoles } from "../lib/team.mjs";

const MAX_FILE = 1024 * 1024;
const MAX_TEXT = 500;
const SLUG_RE = /^[a-z][a-z0-9-]{0,40}$/;
const DATED_RE = /^- (\d{4}-\d{2}-\d{2}): (.*)$/;
// Line breaks (including the Unicode ones) and every control character.
const BAD_CHAR_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

// Tests set testHooks.beforeRename(file) to change the file between the read and the rename.
export const testHooks = { beforeRename: null };

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const hashOf = (line) => createHash("sha256").update(line, "utf8").digest("hex").slice(0, 8);

// A file's text as lines; `\r` is kept apart so a rewritten file keeps its line endings.
function splitLines(text) {
  const lines = text.split("\n").map((raw) => (raw.endsWith("\r") ? { line: raw.slice(0, -1), cr: true } : { line: raw, cr: false }));
  const trailing = lines.length > 0 && lines[lines.length - 1].line === "" && !lines[lines.length - 1].cr;
  if (trailing) lines.pop();
  return { lines, trailing };
}

function joinLines({ lines, trailing }) {
  if (lines.length === 0) return "";
  return lines.map((l) => l.line + (l.cr ? "\r" : "")).join("\n") + (trailing ? "\n" : "");
}

function lessonOf(line, n) {
  const m = DATED_RE.exec(line);
  return m ? { n, date: m[1], text: m[2], hash: hashOf(line) } : { n, date: null, text: line.slice(2), hash: hashOf(line) };
}

// The index into `lines` of lesson n (counting from 1), or -1.
function indexOfLesson(lines, n) {
  let k = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].line.startsWith("- ") && ++k === n) return i;
  }
  return -1;
}

function cleanText(ctx, value) {
  const bad = () => ctx.fail(400, "A lesson is one line of 1 to 500 characters.", "Write the lesson again as one short line.", "bad_lesson");
  if (typeof value !== "string" || BAD_CHAR_RE.test(value)) throw bad();
  const text = value.trim();
  if (text.length === 0 || [...text].length > MAX_TEXT) throw bad();
  return text;
}

function lessonNumber(ctx) {
  const raw = String(ctx.params.n || "");
  const n = /^[1-9][0-9]{0,5}$/.test(raw) ? Number(raw) : 0;
  if (!n) throw notFoundLesson(ctx);
  return n;
}

const notFoundLesson = (ctx) => ctx.fail(404, "That lesson is not there any more.", "Refresh the page to see the lessons as they are now.", "lesson_not_found");
const changed = (ctx) => ctx.fail(409, "This lesson changed while you were editing.", "Refresh the page and try again.", "lesson_changed");
const busy = (ctx) => ctx.fail(409, "The lessons were being changed by an agent at the same moment, so nothing was saved.", "Wait a moment, refresh the page and try again.", "lessons_busy");
const refusedLink = (ctx) => ctx.fail(409, "This agent's lessons are not a plain file, so the home screen will not change them.", "Ask whoever set up the engine to replace it with a plain file.", "lessons_not_a_file");

// The role for the address's slug, looked up in the company file. The address is never used to build a path.
function roleFor(ctx) {
  const slug = String(ctx.params.slug || "");
  const role = loadRoles(ctx.config).find((r) => r.slug === slug);
  if (!role || typeof role.slug !== "string" || !SLUG_RE.test(role.slug)) {
    throw ctx.fail(404, "There is no agent with that name.", "Open the Team page and pick an agent from the list.", "agent_not_found");
  }
  return role;
}

// The lessons folder, made when it is missing. Refuses a folder that is a link or not a folder.
function lessonsDir(ctx) {
  const dir = ctx.config.paths.lessons;
  try {
    const st = lstatSync(dir);
    if (!st.isDirectory()) throw refusedLink(ctx);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    if (!lstatSync(dir).isDirectory()) throw refusedLink(ctx);
  }
  return dir;
}

// -> { exists, text, mode }. Opens with O_NOFOLLOW, so a link is refused rather than followed.
function readLessons(ctx, file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK || 0));
  } catch (e) {
    if (e?.code === "ENOENT") return { exists: false, text: "", mode: 0o644 };
    if (e?.code === "ELOOP" || e?.code === "EMLINK") throw refusedLink(ctx);
    throw e;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw refusedLink(ctx);
    if (st.size > MAX_FILE) {
      throw ctx.fail(409, "This agent's lessons file is too large for the home screen to change.", "Ask whoever set up the engine to shorten it.", "lessons_too_large");
    }
    const buf = Buffer.alloc(st.size + 1);
    let got = 0;
    while (got < buf.length) {
      const k = readSync(fd, buf, got, buf.length - got, got);
      if (k === 0) break;
      got += k;
    }
    if (got > st.size) return readLessons(ctx, file); // grew while reading: read again
    return { exists: true, text: buf.subarray(0, got).toString("utf8"), mode: st.mode & 0o777 };
  } finally {
    closeSync(fd);
  }
}

// What is on disk now, compared with what the edit was made from. A link here counts as changed.
function sameOnDisk(ctx, file, before) {
  try {
    const now = readLessons(ctx, file);
    return now.exists === before.exists && now.text === before.text;
  } catch {
    return false;
  }
}

function writeAtomically(dir, file, text, mode) {
  const tmp = join(dir, `.lessons-${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    fchmodSync(fd, mode);
    const buf = Buffer.from(text, "utf8");
    let done = 0;
    while (done < buf.length) done += writeSync(fd, buf, done, buf.length - done);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  return tmp;
}

// edit(parsed) -> { result } changes `parsed.lines` in place, or throws a failure.
function editLessons(ctx, edit) {
  const role = roleFor(ctx);
  const dir = lessonsDir(ctx);
  const file = join(dir, `${role.slug}.md`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = readLessons(ctx, file);
    const parsed = splitLines(before.text);
    const result = edit(parsed);
    const tmp = writeAtomically(dir, file, joinLines(parsed), before.exists ? (before.mode | 0o600) : 0o644);
    try {
      if (typeof testHooks.beforeRename === "function") testHooks.beforeRename(file, attempt);
      if (!sameOnDisk(ctx, file, before)) {
        rmSync(tmp, { force: true });
        continue;
      }
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    return result;
  }
  throw busy(ctx);
}

function bodyOf(ctx) {
  return ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
}

export default function register(app) {
  app.post("/api/team/:slug/lessons", (ctx) => {
    roleFor(ctx);
    const text = cleanText(ctx, bodyOf(ctx).text);
    const lesson = editLessons(ctx, (parsed) => {
      parsed.lines.push({ line: `- ${todayIst()}: ${text}`, cr: false });
      parsed.trailing = true;
      const n = parsed.lines.filter((l) => l.line.startsWith("- ")).length;
      return lessonOf(parsed.lines[parsed.lines.length - 1].line, n);
    });
    return { status: 201, body: { lesson } };
  });

  app.post("/api/team/:slug/lessons/:n", (ctx) => {
    const b = bodyOf(ctx);
    roleFor(ctx);
    const n = lessonNumber(ctx);
    const text = cleanText(ctx, b.text);
    const hash = typeof b.hash === "string" ? b.hash : "";
    const lesson = editLessons(ctx, (parsed) => {
      const i = indexOfLesson(parsed.lines, n);
      if (i < 0) throw notFoundLesson(ctx);
      const old = parsed.lines[i].line;
      if (hashOf(old) !== hash) throw changed(ctx);
      const m = DATED_RE.exec(old);
      parsed.lines[i] = { line: m ? `- ${m[1]}: ${text}` : `- ${text}`, cr: parsed.lines[i].cr };
      return lessonOf(parsed.lines[i].line, n);
    });
    return { lesson };
  });

  app.delete("/api/team/:slug/lessons/:n", (ctx) => {
    roleFor(ctx);
    const n = lessonNumber(ctx);
    const hash = typeof ctx.query.hash === "string" ? ctx.query.hash : "";
    editLessons(ctx, (parsed) => {
      const i = indexOfLesson(parsed.lines, n);
      if (i < 0) throw notFoundLesson(ctx);
      if (hashOf(parsed.lines[i].line) !== hash) throw changed(ctx);
      parsed.lines.splice(i, 1);
      return null;
    });
    return { ok: true };
  });
}
