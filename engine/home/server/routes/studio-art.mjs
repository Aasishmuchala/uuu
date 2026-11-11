// The Studio's art (CONTRACTS-V2 17.8 and 20.2): the Artist's sprites and simple images, found where it
// wrote them, tasks/company-work/<goal>/art/<name>/manifest.json, and checked here from the files
// themselves, so "the frames equal the tags" does not rest on the Artist's word.
//   GET /api/studio/art              every sprite and image, newest first, and the folders that are broken
//   GET /api/studio/art/sprite?id=   one sprite, with its data file reduced to numbers for the player
//
// Everything in those folders is untrusted: folders and files that are links are never used, files are
// read with O_NOFOLLOW and a size cap (lib/taskfiles.mjs, _images.mjs), a manifest and a data file are read
// up to 256 KB and only the pinned keys are used, each checked for type and range, and the names a
// manifest gives must be plain file names in the same folder. Nothing here runs or renders what it reads.
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { HomeError } from "../lib/errors.mjs";
import { isGoal, loadIssues } from "../lib/goals.mjs";
import { fileEntry, goalFolder, readTaskText } from "../lib/taskfiles.mjs";
import { AGENT_PLAIN, agentState } from "../lib/team.mjs";
import { gifFrameCount, pngSize, readGoalBytes } from "./_images.mjs";

const MAX_GOALS = 1000;
const MAX_ROWS = 200;
const MAX_JSON = 262144;
const MAX_GIF = 20 * 1024 * 1024;
const MAX_FRAMES = 1024;
const MAX_NUMBER = 16384;
const MAX_TAGS = 256;
const GOAL = /^[A-Za-z0-9_-]{1,64}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PLAIN_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const COLOUR = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;
const DIRECTIONS = new Set(["forward", "reverse", "pingpong"]);
const IMAGE_EXT = /\.(?:png|gif|jpe?g|webp|svg)$/i;

// A problem found in one art folder: shown to the owner as one plain sentence.
class Broken extends Error {}
const broken = (sentence) => new Broken(sentence);

function dateText(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function lstatOrNull(p) {
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
function plainText(v, max) {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// A small JSON file of the art folder, as an object; Broken when it cannot be read.
function readJson(config, goal, rel, what) {
  const read = readTaskText(config, goal, rel, { maxBytes: MAX_JSON });
  if (!read) throw broken(`The ${what} is missing.`);
  if (read.truncated) throw broken(`The ${what} is too large.`);
  let data;
  try { data = JSON.parse(read.text); } catch { throw broken(`The ${what} could not be read.`); }
  if (!isObject(data)) throw broken(`The ${what} could not be read.`);
  return { data, mtimeMs: read.mtimeMs };
}

// A file name from the manifest: a plain name in the same folder, or Broken.
function plainName(v, ext, what) {
  if (typeof v !== "string" || !PLAIN_FILE.test(v) || v.includes("..")) {
    throw broken(`The manifest names a ${what} outside its folder.`);
  }
  if (ext && !ext.test(v)) throw broken(`The manifest names a ${what} of the wrong kind.`);
  return v;
}

// A regular file of the art folder (not a link): { size, mtimeMs } or null.
function fileStat(goalDir, name, file) {
  const st = lstatOrNull(join(goalDir, "art", name, file));
  return st && st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
}

// The data file (Aseprite's json-array shape, CONTRACTS-V2 20.2) reduced to numbers.
// -> { frames: [{ x, y, w, h, duration }], size: { w, h }, tags: [{ name, from, to, direction }] }
function readData(data) {
  const list = data.frames;
  if (!Array.isArray(list) || list.length === 0) throw broken("The data file lists no frames.");
  if (list.length > MAX_FRAMES) throw broken(`The data file lists more than ${MAX_FRAMES} frames.`);
  const frames = list.map((f) => {
    const r = isObject(f) && isObject(f.frame) ? f.frame : null;
    if (!r || ![r.x, r.y, r.w, r.h].every((n) => whole(n, 0, MAX_NUMBER)) || r.w < 1 || r.h < 1) {
      throw broken("A frame in the data file has a position or size that is not a whole number in range.");
    }
    const duration = f.duration === undefined ? 100 : f.duration;
    if (!whole(duration, 10, 60000)) throw broken("A frame in the data file has a duration out of range.");
    return { x: r.x, y: r.y, w: r.w, h: r.h, duration };
  });
  const meta = isObject(data.meta) ? data.meta : null;
  const size = meta && isObject(meta.size) ? meta.size : null;
  if (!size || !whole(size.w, 1, MAX_NUMBER) || !whole(size.h, 1, MAX_NUMBER)) {
    throw broken("The data file does not give the sheet's size.");
  }
  const rawTags = meta.frameTags === undefined ? [] : meta.frameTags;
  if (!Array.isArray(rawTags) || rawTags.length > MAX_TAGS) throw broken("The data file's tags could not be read.");
  const tags = rawTags.map((t) => {
    if (!isObject(t) || !whole(t.from, 0, MAX_NUMBER) || !whole(t.to, 0, MAX_NUMBER)) {
      throw broken("A tag in the data file has a frame number that is not a whole number in range.");
    }
    const direction = typeof t.direction === "string" ? t.direction.slice(0, 20) : "forward";
    return { name: plainText(t.name, 64) || "tag", from: t.from, to: t.to, direction };
  });
  return { frames, size: { w: size.w, h: size.h }, tags };
}

const tagValid = (t, count) => t.from <= t.to && t.to < count && DIRECTIONS.has(t.direction);

// One art folder: { kind: "sprite", row, frames, tags } | { kind: "image", row }; Broken on a problem.
function readArt(config, goal, goalDir, name) {
  const { data: manifest, mtimeMs: madeMs } = readJson(config, goal, `art/${name}/manifest.json`, "manifest");
  const title = plainText(manifest.title, 120) || name;
  const id = `${goal}/${name}`;
  const entry = (file, st) => fileEntry(goal, `art/${name}/${file}`, st.size);

  if (manifest.kind === "image") {
    const file = plainName(manifest.image, IMAGE_EXT, "file");
    const st = fileStat(goalDir, name, file);
    if (!st) throw broken("The image file is missing.");
    const at = Math.max(madeMs, st.mtimeMs);
    return { kind: "image", at, row: { id, goal, name, title, file: entry(file, st), changed: dateText(at) } };
  }
  if (manifest.kind !== "sprite") throw broken("The manifest does not say whether this is a sprite or an image.");

  const sheet = plainName(manifest.sheet, /\.png$/i, "sheet");
  const dataName = plainName(manifest.data, /\.json$/i, "data file");
  const gif = manifest.gif === undefined || manifest.gif === null ? null : plainName(manifest.gif, /\.gif$/i, "GIF");
  const sheetSt = fileStat(goalDir, name, sheet);
  if (!sheetSt) throw broken("The sheet is missing.");
  const { data, mtimeMs: dataMs } = readJson(config, goal, `art/${name}/${dataName}`, "data file");
  const dataSt = fileStat(goalDir, name, dataName);
  if (!dataSt) throw broken("The data file is missing.");
  const reduced = readData(data);
  const count = reduced.frames.length;

  const head = readGoalBytes(config, goal, `art/${name}/${sheet}`, { maxBytes: 64, readOver: true });
  const sheetSize = head ? pngSize(head.bytes) : null;
  const framesMatchSheet = !!sheetSize
    && sheetSize.w === reduced.size.w && sheetSize.h === reduced.size.h
    && reduced.frames.every((f) => f.x + f.w <= sheetSize.w && f.y + f.h <= sheetSize.h);
  const tagsValid = reduced.tags.every((t) => tagValid(t, count));

  let gifFrames = null;
  let gifSt = null;
  if (gif) {
    gifSt = fileStat(goalDir, name, gif);
    if (!gifSt) throw broken("The GIF is missing.");
    const read = readGoalBytes(config, goal, `art/${name}/${gif}`, { maxBytes: MAX_GIF });
    gifFrames = read && !read.tooLarge ? (gifFrameCount(read.bytes) ?? 0) : 0;
  }
  const ok = framesMatchSheet && tagsValid && (gifFrames === null || gifFrames === count);

  const palette = (Array.isArray(manifest.palette) ? manifest.palette : [])
    .filter((c) => typeof c === "string" && COLOUR.test(c)).slice(0, 64).map((c) => c.toLowerCase());
  const at = Math.max(madeMs, dataMs, sheetSt.mtimeMs, gifSt ? gifSt.mtimeMs : 0);
  const row = {
    id, goal, taskId: null, name, title,
    frames: count,
    frameSize: { w: reduced.frames[0].w, h: reduced.frames[0].h },
    tags: reduced.tags,
    palette,
    sheet: entry(sheet, sheetSt),
    gif: gifSt ? entry(gif, gifSt) : null,
    data: entry(dataName, dataSt),
    checks: { framesMatchSheet, tagsValid, gifFrames, ok },
    changed: dateText(at),
  };
  // The player gets only the tags it can play.
  return { kind: "sprite", at, row, frames: reduced.frames, tags: reduced.tags.filter((t) => tagValid(t, count)) };
}

// One art folder, or a problem. -> { art } | { problem } | null (not an art folder: no manifest).
function artAt(config, goal, goalDir, name) {
  const st = lstatOrNull(join(goalDir, "art", name));
  if (!st || !st.isDirectory()) return null;
  if (!fileStat(goalDir, name, "manifest.json")) return null;
  try {
    return { art: readArt(config, goal, goalDir, name) };
  } catch (e) {
    if (e instanceof Broken) return { problem: { goal, name, problem: e.message } };
    return { problem: { goal, name, problem: "This folder could not be read." } };
  }
}

// Every art folder under the project folder.
export function scanArt(config) {
  const sprites = [];
  const images = [];
  const problems = [];
  let root;
  try { root = realpathSync(config.paths.projectFolder); } catch { return { sprites, images, problems }; }
  let goals = 0;
  for (const goal of folders(root, GOAL)) {
    if (++goals > MAX_GOALS) break;
    const goalDir = goalFolder(config, goal);
    if (!goalDir) continue;
    const artDir = join(goalDir, "art");
    const st = lstatOrNull(artDir);
    if (!st || !st.isDirectory()) continue;
    for (const name of folders(artDir, NAME)) {
      if (sprites.length + images.length + problems.length >= MAX_ROWS * 15) break;
      const found = artAt(config, goal, goalDir, name);
      if (!found) continue;
      if (found.problem) problems.push(found.problem);
      else if (found.art.kind === "sprite") sprites.push(found.art);
      else images.push(found.art);
    }
  }
  const newest = (a, b) => b.at - a.at || a.row.id.localeCompare(b.row.id);
  return {
    sprites: sprites.sort(newest).slice(0, MAX_ROWS),
    images: images.sort(newest).slice(0, MAX_ROWS),
    problems: problems.slice(0, MAX_ROWS),
  };
}

// What the board knows: the goals' ids by identifier, and the Artist's state. Empty when the board is off.
async function boardFacts(ctx) {
  const empty = { taskIds: new Map(), agent: null };
  try {
    const ids = ctx.ids();
    if (!ids?.companyId) return empty;
    const base = `/api/companies/${encodeURIComponent(ids.companyId)}`;
    const artistId = ids?.agents?.artist;
    const [issues, agents, live] = await Promise.all([
      loadIssues(ctx, ids.companyId).catch(() => []),
      artistId ? ctx.board.get(`${base}/agents`).catch(() => []) : [],
      artistId ? ctx.board.get(`${base}/live-runs`).catch(() => []) : [],
    ]);
    const taskIds = new Map();
    for (const i of issues) {
      if (ids.projectId && isGoal(i, ids) && typeof i.identifier === "string") taskIds.set(i.identifier, i.id);
    }
    let agent = null;
    const a = (Array.isArray(agents) ? agents : []).find((x) => x?.id === artistId);
    if (a) {
      const state = agentState(a, (Array.isArray(live) ? live : []).some((r) => r?.agentId === artistId));
      agent = { name: plainText(a.name, 60) || "Artist", state, plainState: AGENT_PLAIN[state] };
    }
    return { taskIds, agent };
  } catch (e) {
    if (e instanceof HomeError) return empty;
    throw e;
  }
}

const withTask = (row, taskIds) => ({ ...row, taskId: taskIds.get(row.goal) ?? null });

export default function register(app) {
  app.get("/api/studio/art", async (ctx) => {
    const installed = existsSync(join(ctx.config.paths.state, "art", "venv", "bin", "python"));
    const { sprites, images, problems } = scanArt(ctx.config);
    const { taskIds, agent } = await boardFacts(ctx);
    return {
      installed,
      notConnected: installed ? null : {
        reason: "The Artist's tools are not installed yet.",
        next: "Run: engine/art/install.sh",
      },
      agent,
      sprites: sprites.map((s) => withTask(s.row, taskIds)),
      images: images.map((i) => i.row),
      problems,
    };
  });

  app.get("/api/studio/art/sprite", async (ctx) => {
    const notFound = () => ctx.fail(404, "That sprite is not here any more.", "Go back to the Studio and look at its sprites again.", "sprite_not_found");
    const id = typeof ctx.query.id === "string" ? ctx.query.id : "";
    const m = /^([A-Za-z0-9_-]{1,64})\/([a-z0-9][a-z0-9-]{0,39})$/.exec(id);
    if (!m) throw notFound();
    const [, goal, name] = m;
    const goalDir = goalFolder(ctx.config, goal);
    if (!goalDir) throw notFound();
    const artDir = lstatOrNull(join(goalDir, "art"));
    if (!artDir || !artDir.isDirectory()) throw notFound();
    const found = artAt(ctx.config, goal, goalDir, name);
    if (!found) throw notFound();
    if (found.problem) {
      throw ctx.fail(409, `This sprite cannot be played. ${found.problem.problem}`, "Ask the Artist to make it again.", "sprite_broken");
    }
    if (found.art.kind !== "sprite") throw notFound();
    const { taskIds } = await boardFacts(ctx);
    return { sprite: withTask(found.art.row, taskIds), frames: found.art.frames, tags: found.art.tags };
  });
}
