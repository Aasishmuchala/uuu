// The Studio's slides (C3 36.2): the carousels the Artist laid out with the slide tool, found where it
// wrote them, tasks/company-work/<goal>/slides/<name>/manifest.json, and checked here from the files
// themselves, so "every slide is the size it says" does not rest on the Artist's word.
//   GET /api/studio/slides   every set of slides, newest first, and the folders that are broken
//
// Everything in those folders is untrusted, as in routes/studio-art.mjs: folders and files that are links
// are never used, files are read with O_NOFOLLOW and a size cap (lib/taskfiles.mjs, _images.mjs), a
// manifest and a list of words are read up to 256 KB and only the pinned keys are used, each checked for
// type and range, and the names a manifest gives must be plain file names in the same folder. Nothing
// here runs or renders what it reads. The helpers below are shared with routes/studio-video.mjs.
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { HomeError } from "../lib/errors.mjs";
import { isGoal, loadIssues } from "../lib/goals.mjs";
import { fileEntry, goalFolder, readTaskText } from "../lib/taskfiles.mjs";
import { pngSize, readGoalBytes } from "./_images.mjs";

const MAX_GOALS = 1000;
const MAX_ROWS = 200;
const MAX_JSON = 262144;
const MAX_LISTED = 20;                // slides a manifest may name before it is called broken
const MAX_SLIDE = 20 * 1024 * 1024;   // the most /api/view shows of one image
const MAX_TEXT = 600;                 // characters of words on one slide (36.2)
const MAX_NUMBER = 16384;
const GOAL = /^[A-Za-z0-9_-]{1,64}$/;
export const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLAIN_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// The two slide sizes the slide tool makes (36.2).
const SIZES = [{ w: 1080, h: 1350 }, { w: 1080, h: 1080 }];

// A problem found in one folder: shown to the owner as one plain sentence.
export class Broken extends Error {}
export const broken = (sentence) => new Broken(sentence);

export function dateText(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function lstatOrNull(p) {
  try { return lstatSync(p); } catch { return null; }
}

// Child folders of dir that are real folders (a link is not a directory entry here), sorted by name.
function folders(dir, pattern) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && pattern.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// Plain text an agent wrote, made safe to show: no control or format characters, trimmed, capped.
export function plainText(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

export const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A small JSON file of a goal's folder, as an object; Broken when it cannot be read.
export function readJson(config, goal, rel, what) {
  const read = readTaskText(config, goal, rel, { maxBytes: MAX_JSON });
  if (!read) throw broken(`The ${what} is missing.`);
  if (read.truncated) throw broken(`The ${what} is too large.`);
  let data;
  try { data = JSON.parse(read.text); } catch { throw broken(`The ${what} could not be read.`); }
  if (!isObject(data)) throw broken(`The ${what} could not be read.`);
  return { data, mtimeMs: read.mtimeMs };
}

// A file name from the manifest: a plain name in the same folder, or Broken.
export function plainName(v, ext, what) {
  if (typeof v !== "string" || !PLAIN_FILE.test(v) || v.includes("..")) {
    throw broken(`The manifest names a ${what} outside its folder.`);
  }
  if (ext && !ext.test(v)) throw broken(`The manifest names a ${what} of the wrong kind.`);
  return v;
}

// A regular file (not a link) at dir/file: { size, mtimeMs } or null.
export function regularFile(dir, file) {
  const st = lstatOrNull(join(dir, file));
  return st && st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
}

// The size in a PNG's header, read from the file itself; null when it is not a PNG.
export function pngSizeOf(config, goal, rel) {
  const head = readGoalBytes(config, goal, rel, { maxBytes: 64, readOver: true });
  return head ? pngSize(head.bytes) : null;
}

// Every folder <goal>/<sub>/<name>/ holding a manifest.json, under the project folder.
// read(goal, goalDir, name) -> a row (with `at` and `row`); a Broken becomes a problem.
// -> { rows: [...], problems: [{ goal, name, problem }] }, rows newest first, both capped.
export function scanFolders(config, sub, read) {
  const rows = [];
  const problems = [];
  let root;
  try { root = realpathSync(config.paths.projectFolder); } catch { return { rows, problems }; }
  let goals = 0;
  for (const goal of folders(root, GOAL)) {
    if (++goals > MAX_GOALS) break;
    const goalDir = goalFolder(config, goal);
    if (!goalDir) continue;
    const subDir = join(goalDir, sub);
    const st = lstatOrNull(subDir);
    if (!st || !st.isDirectory()) continue;
    for (const name of folders(subDir, NAME)) {
      if (rows.length + problems.length >= MAX_ROWS * 15) break;
      const dir = join(subDir, name);
      const dst = lstatOrNull(dir);
      if (!dst || !dst.isDirectory() || !regularFile(dir, "manifest.json")) continue;
      try {
        rows.push(read(goal, goalDir, name));
      } catch (e) {
        problems.push({ goal, name, problem: e instanceof Broken ? e.message : "This folder could not be read." });
      }
    }
  }
  rows.sort((a, b) => b.at - a.at || a.row.id.localeCompare(b.row.id));
  return { rows: rows.slice(0, MAX_ROWS), problems: problems.slice(0, MAX_ROWS) };
}

// The goals' task ids by identifier, from the board. Empty when the board is off.
export async function goalTaskIds(ctx) {
  try {
    const ids = ctx.ids();
    if (!ids?.companyId) return new Map();
    const issues = await loadIssues(ctx, ids.companyId).catch(() => []);
    const out = new Map();
    for (const i of issues) {
      if (ids.projectId && isGoal(i, ids) && typeof i.identifier === "string") out.set(i.identifier, i.id);
    }
    return out;
  } catch (e) {
    if (e instanceof HomeError) return new Map();
    throw e;
  }
}

// One set of slides: { at, row }; Broken on a problem.
function readSlides(config, goal, goalDir, name) {
  const dir = join(goalDir, "slides", name);
  const rel = (file) => `slides/${name}/${file}`;
  const { data: manifest, mtimeMs: madeMs } = readJson(config, goal, rel("manifest.json"), "manifest");
  if (manifest.kind !== "slides") throw broken("The manifest does not say these are slides.");
  const title = plainText(manifest.title, 120) || name;

  const listed = manifest.slides;
  if (!Array.isArray(listed) || listed.length === 0) throw broken("The manifest lists no slides.");
  if (listed.length > MAX_LISTED) throw broken(`The manifest lists more than ${MAX_LISTED} slides.`);
  const names = listed.map((v) => plainName(v, /\.png$/i, "slide"));
  const size = isObject(manifest.size) ? manifest.size : null;
  if (!size || !whole(size.w, 1, MAX_NUMBER) || !whole(size.h, 1, MAX_NUMBER)) {
    throw broken("The manifest does not give the slides' size.");
  }
  const contact = plainName(manifest.contact, /\.png$/i, "contact sheet");
  const dataName = plainName(manifest.data, /\.json$/i, "list of words");

  let at = madeMs;
  const slides = names.map((file) => {
    const st = regularFile(dir, file);
    if (!st) throw broken("A slide is missing.");
    at = Math.max(at, st.mtimeMs);
    return { file, st };
  });
  const contactSt = regularFile(dir, contact);
  if (!contactSt) throw broken("The contact sheet is missing.");
  const { data, mtimeMs: dataMs } = readJson(config, goal, rel(dataName), "list of words");
  at = Math.max(at, contactSt.mtimeMs, dataMs);
  const words = Array.isArray(data.slides) ? data.slides.slice(0, MAX_LISTED + 1) : [];

  // The checks, from the files' own bytes: every slide a PNG of the size the manifest gives, that size one
  // the slide tool makes, and each small enough to be shown; 2 to 10 slides, listed alike in both files.
  const allowed = SIZES.some((s) => s.w === size.w && s.h === size.h);
  const sizesMatch = allowed && slides.every(({ file, st }) => {
    if (st.size > MAX_SLIDE) return false;
    const got = pngSizeOf(config, goal, rel(file));
    return !!got && got.w === size.w && got.h === size.h;
  });
  const countMatches = whole(slides.length, 2, 10)
    && words.length === slides.length
    && words.every((w, i) => isObject(w) && w.file === names[i]);

  const row = {
    id: `${goal}/${name}`, goal, taskId: null, name, title,
    count: slides.length,
    size: { w: size.w, h: size.h },
    slides: slides.map(({ file, st }) => fileEntry(goal, rel(file), st.size)),
    contact: fileEntry(goal, rel(contact), contactSt.size),
    texts: words.map((w) => (isObject(w) && plainText(w.text, MAX_TEXT)) || ""),
    checks: { sizesMatch, countMatches, ok: sizesMatch && countMatches },
    changed: dateText(at),
  };
  return { at, row };
}

export function scanSlides(config) {
  return scanFolders(config, "slides", (goal, goalDir, name) => readSlides(config, goal, goalDir, name));
}

export default function register(app) {
  app.get("/api/studio/slides", async (ctx) => {
    const installed = existsSync(join(ctx.config.paths.state, "art", "tools", "slides.py"));
    const { rows, problems } = scanSlides(ctx.config);
    const taskIds = await goalTaskIds(ctx);
    return {
      installed,
      notConnected: installed ? null : {
        reason: "The Artist's slide tool is not installed yet.",
        next: "Run: engine/art/install.sh",
      },
      sets: rows.map(({ row }) => ({ ...row, taskId: taskIds.get(row.goal) ?? null })),
      problems,
    };
  });
}
