// The Studio's videos and its room (C3 37.3, 37.4).
//   GET /api/studio/videos   every video the Artist made with the video helper, newest first, found at
//                            tasks/company-work/<goal>/video/<name>/manifest.json, and the broken folders
//   GET /api/studio/room     the files the owner dropped in state/media/room/, names only
//
// The habits of routes/studio-art.mjs and routes/studio-slides.mjs: everything in a goal's folder is
// untrusted; links are never used; a manifest is read up to 256 KB and only its pinned keys are used; the
// names it gives must be plain file names in the same folder; `checks` come from bytes read here (`ftyp`
// at byte 4 of the video, its size, the poster's PNG header), and the manifest's numbers are shown only
// when they are whole numbers inside the helper's limits (37.2). The room's files are never opened.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { roomFiles } from "../lib/brainfiles.mjs";
import { fileEntry } from "../lib/taskfiles.mjs";
import { isMp4, readGoalBytes } from "./_images.mjs";
import {
  broken, dateText, goalTaskIds, lstatOrNull, plainName, plainText, pngSizeOf, readJson, regularFile, scanFolders, whole,
} from "./studio-slides.mjs";

const MAX_VIDEO = 300 * 1024 * 1024;
const CLIP_BYTES = 1024 * 1024 * 1024;
const STILLS = ["frame-01.png", "frame-02.png", "frame-03.png", "frame-04.png", "frame-05.png", "frame-06.png"];

// A number of the manifest, when it is a whole number inside the helper's limits; else null.
const even = (v, hi) => whole(v, 2, hi) && v % 2 === 0;
function numbers(m) {
  return {
    width: even(m.width, 1920) ? m.width : null,
    height: even(m.height, 1080) ? m.height : null,
    fps: whole(m.fps, 1, 30) ? m.fps : null,
    seconds: whole(m.seconds, 1, 120) ? m.seconds : null,
  };
}

// One video folder: { at, row }; Broken on a problem.
function readVideo(config, goal, goalDir, name) {
  const dir = join(goalDir, "video", name);
  const rel = (file) => `video/${name}/${file}`;
  const { data: manifest, mtimeMs: madeMs } = readJson(config, goal, rel("manifest.json"), "manifest");
  if (manifest.kind !== "video") throw broken("The manifest does not say this is a video.");
  const title = plainText(manifest.title, 120) || name;
  const video = plainName(manifest.video, /\.mp4$/i, "video");
  const poster = plainName(manifest.poster, /\.png$/i, "poster");

  const videoSt = regularFile(dir, video);
  if (!videoSt) throw broken("The video is missing.");
  const posterSt = regularFile(dir, poster);
  if (!posterSt) throw broken("The poster is missing.");

  const stills = [];
  const review = lstatOrNull(join(dir, "review"));
  if (review && review.isDirectory()) {
    for (const file of STILLS) {
      const st = regularFile(join(dir, "review"), file);
      if (st) stills.push(fileEntry(goal, rel(`review/${file}`), st.size));
    }
  }

  const n = numbers(manifest);
  const head = readGoalBytes(config, goal, rel(video), { maxBytes: 12, readOver: true });
  const isMp4Now = !!head && isMp4(head.bytes);
  const underLimit = !!head && head.size <= MAX_VIDEO;
  const got = pngSizeOf(config, goal, rel(poster));
  const posterMatches = !!got && n.width !== null && n.height !== null && got.w === n.width && got.h === n.height;

  const at = Math.max(madeMs, videoSt.mtimeMs, posterSt.mtimeMs);
  const row = {
    id: `${goal}/${name}`, goal, taskId: null, name, title,
    ...n,
    video: fileEntry(goal, rel(video), videoSt.size),
    poster: fileEntry(goal, rel(poster), posterSt.size),
    stills,
    checks: { isMp4: isMp4Now, underLimit, posterMatches, ok: isMp4Now && underLimit && posterMatches },
    changed: dateText(at),
  };
  return { at, row };
}

export function scanVideos(config) {
  return scanFolders(config, "video", (goal, goalDir, name) => readVideo(config, goal, goalDir, name));
}

// The speech model is in place: a regular file ending .bin in state/media/models/.
function speechInPlace(state) {
  try {
    const dir = join(state, "media", "models");
    return readdirSync(dir).some((f) => f.endsWith(".bin") && !f.startsWith(".") && !!regularFile(dir, f));
  } catch {
    return false;
  }
}

export default function register(app) {
  app.get("/api/studio/videos", async (ctx) => {
    const state = ctx.config.paths.state;
    const installed = existsSync(join(state, "art", "tools", "video.py"));
    const { rows, problems } = scanVideos(ctx.config);
    const taskIds = await goalTaskIds(ctx);
    return {
      installed,
      notConnected: installed ? null : {
        reason: "The Artist's video helper is not installed yet.",
        next: "Run: engine/art/install.sh",
      },
      speech: speechInPlace(state),
      videos: rows.map(({ row }) => ({ ...row, taskId: taskIds.get(row.goal) ?? null })),
      problems,
    };
  });

  app.get("/api/studio/room", async (ctx) => ({
    files: roomFiles(ctx.config),
    path: join(ctx.config.paths.state, "media", "room"),
    limits: { clipBytes: CLIP_BYTES },
  }));
}
