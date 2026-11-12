// The Studio's videos and room (C3 37.3, 37.4): GET /api/studio/videos and GET /api/studio/room. The checks
// come from the files' own bytes; the manifest's numbers are shown only inside the helper's limits; broken
// or hostile folders land in `problems` or fail a check, and never break the list. The room lists names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readShape, sameShape } from "../lib/shape.mjs";
import { lengthOf } from "../routes/studio-video.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call, writes } from "../lib/testing.mjs";
import { boardSeedV2, copyStateSeedV2, IDS_V3 } from "../../../test/stubs/seed.mjs";

const work = (h, ...parts) => join(h.state, "tasks", "company-work", ...parts);
const title = (h, ...parts) => work(h, "STH-25", "video", "title", ...parts);
const room = (h, ...parts) => join(h.state, "media", "room", ...parts);

async function withHome(fn) {
  const h = await startV2({ routes: ["studio-video"], boardSeed: boardSeedV2() });
  copyStateSeedV2(h.state);
  try { return await fn(h); } finally { await h.close(); }
}

const videos = async (h) => {
  const r = await call(h.url, "GET", "/api/studio/videos");
  assert.equal(r.status, 200);
  assert.deepEqual(sameShape(readShape("studio-videos"), r.json), []);
  return r.json;
};
const roomOf = async (h) => {
  const r = await call(h.url, "GET", "/api/studio/room");
  assert.equal(r.status, 200);
  return r.json;
};

// The first bytes of a PNG of w x h: the signature and the IHDR chunk, then filler.
function pngHeader(w, h) {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

// A copy of the seed's title video under another name, with its manifest changed by `edit`.
function copyTitle(h, name, edit = (m) => m) {
  const dir = work(h, "STH-25", "video", name);
  cpSync(title(h), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(edit({ ...manifest, name })));
  return dir;
}
const videoOf = (a, id) => a.videos.find((v) => v.id === id);

test("videos: the seed fits shape studio-videos; the title card's numbers, poster, six stills and checks", async () => {
  await withHome(async (h) => {
    const a = await videos(h);
    assert.equal(a.installed, true);
    assert.equal(a.notConnected, null);
    assert.equal(a.speech, true);
    assert.deepEqual(a.problems, []);
    const v = videoOf(a, "STH-25/title");
    assert.ok(v);
    assert.equal(v.goal, "STH-25");
    assert.equal(v.taskId, IDS_V3.issues["STH-25"]);
    assert.equal(v.title, "Opening title");
    assert.deepEqual([v.width, v.height, v.fps, v.seconds], [320, 180, 30, 1]);
    assert.equal(v.video.name, "video/title/title.mp4");
    assert.equal(v.video.kind, "video");
    assert.match(v.video.viewUrl, /^\/api\/view\//);
    assert.equal(v.poster.name, "video/title/poster.png");
    assert.equal(v.poster.kind, "image");
    assert.deepEqual(v.stills.map((s) => s.name), [1, 2, 3, 4, 5, 6].map((n) => `video/title/review/frame-0${n}.png`));
    assert.deepEqual(v.checks, { isMp4: true, underLimit: true, posterMatches: true, ok: true });
    assert.match(v.changed, /^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    assert.deepEqual(writes(h.board), []);
  });
});

test("videos: without the helper or the speech model the answer says so, and still lists the videos", async () => {
  await withHome(async (h) => {
    rmSync(join(h.state, "art", "tools", "video.py"));
    rmSync(join(h.state, "media", "models", "ggml-small.en.bin"));
    const a = await videos(h);
    assert.equal(a.installed, false);
    assert.equal(a.notConnected.reason, "The Artist's video helper is not installed yet.");
    assert.equal(a.speech, false);
    assert.ok(videoOf(a, "STH-25/title"));
  });
});

test("videos: a speech model that is a link is not in place", async () => {
  await withHome(async (h) => {
    const model = join(h.state, "media", "models", "ggml-small.en.bin");
    rmSync(model);
    writeFileSync(join(h.state, "elsewhere.bin"), "");
    symlinkSync(join(h.state, "elsewhere.bin"), model);
    assert.equal((await videos(h)).speech, false);
  });
});

test("videos: a manifest naming ../x lands in problems, and the others still list", async () => {
  await withHome(async (h) => {
    copyTitle(h, "escape", (m) => ({ ...m, video: "../x.mp4" }));
    copyTitle(h, "poster-escape", (m) => ({ ...m, poster: "../../../poster.png" }));
    const a = await videos(h);
    for (const name of ["escape", "poster-escape"]) {
      assert.ok(!videoOf(a, `STH-25/${name}`), name);
      assert.match(a.problems.find((x) => x.name === name)?.problem || "", /outside its folder/, name);
    }
    assert.ok(videoOf(a, "STH-25/title"));
  });
});

test("videos: a poster of the wrong size, or one that is not a PNG, fails posterMatches", async () => {
  await withHome(async (h) => {
    writeFileSync(join(copyTitle(h, "wide"), "poster.png"), pngHeader(640, 360));
    writeFileSync(join(copyTitle(h, "fake"), "poster.png"), "<svg onload=alert(1)>");
    const a = await videos(h);
    for (const id of ["STH-25/wide", "STH-25/fake"]) {
      const v = videoOf(a, id);
      assert.equal(v.checks.posterMatches, false, id);
      assert.equal(v.checks.isMp4, true, id);
      assert.equal(v.checks.ok, false, id);
    }
  });
});

test("videos: a video that is not an MP4 by its bytes fails isMp4", async () => {
  await withHome(async (h) => {
    writeFileSync(join(copyTitle(h, "html"), "title.mp4"), "<!doctype html><script>alert(1)</script>");
    const v = videoOf(await videos(h), "STH-25/html");
    assert.equal(v.checks.isMp4, false);
    assert.equal(v.checks.ok, false);
  });
});

test("videos: a video over 300 MB fails underLimit without being read", async () => {
  await withHome(async (h) => {
    const file = join(copyTitle(h, "heavy"), "title.mp4");
    truncateSync(file, 300 * 1024 * 1024 + 1);
    const v = videoOf(await videos(h), "STH-25/heavy");
    assert.equal(v.checks.underLimit, false);
    assert.equal(v.checks.isMp4, true);
    assert.equal(v.checks.ok, false);
    assert.equal(v.video.size, 300 * 1024 * 1024 + 1);
  });
});

test("videos: a manifest of 5 MB, a missing poster and a video that is a link land in problems", async () => {
  await withHome(async (h) => {
    writeFileSync(join(copyTitle(h, "huge"), "manifest.json"), `{"kind":"video","pad":"${"x".repeat(5 * 1024 * 1024)}"}`);
    rmSync(join(copyTitle(h, "no-poster"), "poster.png"));
    const linked = copyTitle(h, "linked");
    rmSync(join(linked, "title.mp4"));
    symlinkSync(title(h, "title.mp4"), join(linked, "title.mp4"));
    const a = await videos(h);
    const problem = (name) => a.problems.find((x) => x.name === name)?.problem;
    assert.equal(problem("huge"), "The manifest is too large.");
    assert.equal(problem("no-poster"), "The poster is missing.");
    assert.equal(problem("linked"), "The video is missing.");
    assert.deepEqual(a.videos.map((v) => v.id), ["STH-25/title"]);
  });
});

test("videos: numbers outside the helper's limits are not shown; the list still fits its shape", async () => {
  await withHome(async (h) => {
    copyTitle(h, "wild", (m) => ({ ...m, width: 1921, height: 181, fps: 31, seconds: 121 }));
    copyTitle(h, "strings", (m) => ({ ...m, width: "320", height: 2.5, fps: -1, seconds: 1e9 }));
    const a = await videos(h);
    for (const id of ["STH-25/wild", "STH-25/strings"]) {
      const v = videoOf(a, id);
      assert.deepEqual([v.width, v.height, v.fps, v.seconds], [null, null, null, null], id);
      assert.equal(v.checks.posterMatches, false, id);
    }
  });
});

test("videos: the length has at most one decimal (M63 38); a manifest edited by hand in the trial reads right", async () => {
  assert.deepEqual([11.5, 12, 0.1, 120, 19.9, 2.0].map(lengthOf), [11.5, 12, 0.1, 120, 19.9, 2]);
  for (const bad of [11.55, 0.05, 0, -1, 120.1, 121, 1e9, NaN, Infinity, "11.5", null, undefined, [11.5], { s: 1 }, true]) {
    assert.equal(lengthOf(bad), null, String(bad));
  }
  await withHome(async (h) => {
    // The slow reveal's manifest as the Artist left it in the trial: `seconds` edited by hand to 11.5.
    copyTitle(h, "reveal", (m) => ({ ...m, seconds: 11.5 }));
    // The captions' manifest with the extra keys the Artist added by hand: they are ignored.
    copyTitle(h, "captions", (m) => ({ ...m, seconds: 19.9, seconds_exact: 19.9, seconds_note: "added by hand" }));
    copyTitle(h, "two-decimals", (m) => ({ ...m, seconds: 11.55 }));
    copyTitle(h, "text", (m) => ({ ...m, seconds: "11.5" }));
    const a = await videos(h);
    assert.equal(videoOf(a, "STH-25/reveal").seconds, 11.5);
    assert.equal(videoOf(a, "STH-25/captions").seconds, 19.9);
    assert.equal(videoOf(a, "STH-25/two-decimals").seconds, null);
    assert.equal(videoOf(a, "STH-25/text").seconds, null);
    assert.ok(!("seconds_exact" in videoOf(a, "STH-25/captions")), "only the pinned keys are used");
  });
});

test("videos: a review folder that is a link gives no stills; a still that is a link is left out", async () => {
  await withHome(async (h) => {
    const dir = copyTitle(h, "stills");
    rmSync(join(dir, "review", "frame-03.png"));
    symlinkSync(title(h, "review", "frame-01.png"), join(dir, "review", "frame-03.png"));
    const linkedDir = copyTitle(h, "linked-review");
    rmSync(join(linkedDir, "review"), { recursive: true });
    symlinkSync(title(h, "review"), join(linkedDir, "review"));
    const a = await videos(h);
    assert.deepEqual(videoOf(a, "STH-25/stills").stills.map((s) => s.name.slice(-12)),
      ["frame-01.png", "frame-02.png", "frame-04.png", "frame-05.png", "frame-06.png"]);
    assert.deepEqual(videoOf(a, "STH-25/linked-review").stills, []);
  });
});

test("room: lists only the pinned endings, as names, with the folder and the clip limit", async () => {
  await withHome(async (h) => {
    for (const n of ["talk.mov", "voice.m4a", "intro.MP3", "shot.jpeg", "notes.txt", "page.html", "run.sh", ".hidden.mp4"]) {
      writeFileSync(room(h, n), "x");
    }
    mkdirSync(room(h, "folder.mp4"));
    const r = await roomOf(h);
    assert.deepEqual(r.path, room(h));
    assert.deepEqual(r.limits, { clipBytes: 1073741824 });
    assert.deepEqual(r.files.map((f) => f.name).sort(), ["intro.MP3", "shot.jpeg", "site-visit.mp4", "talk.mov", "voice.m4a"]);
    for (const f of r.files) {
      assert.deepEqual(Object.keys(f).sort(), ["changed", "name", "size"]);
      assert.equal(typeof f.size, "number");
    }
  });
});

test("room: a file that is a link is not listed, and a room that is a link lists nothing", async () => {
  await withHome(async (h) => {
    writeFileSync(join(h.state, "secret.mp4"), "x");
    symlinkSync(join(h.state, "secret.mp4"), room(h, "link.mp4"));
    assert.deepEqual((await roomOf(h)).files.map((f) => f.name), ["site-visit.mp4"]);
    rmSync(room(h), { recursive: true });
    mkdirSync(join(h.state, "other-room"));
    writeFileSync(join(h.state, "other-room", "clip.mp4"), "x");
    symlinkSync(join(h.state, "other-room"), room(h));
    assert.deepEqual((await roomOf(h)).files, []);
  });
});

test("room: no room folder gives an empty list", async () => {
  await withHome(async (h) => {
    rmSync(join(h.state, "media"), { recursive: true });
    const r = await roomOf(h);
    assert.deepEqual(r.files, []);
    assert.equal(r.limits.clipBytes, 1073741824);
  });
});
