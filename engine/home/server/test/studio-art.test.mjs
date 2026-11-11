// The Studio's art (CONTRACTS-V2 17.8, 20.2): GET /api/studio/art and GET /api/studio/art/sprite?id=.
// The checks come from the files themselves; broken or hostile folders land in `problems`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call, writes } from "../lib/testing.mjs";
import { boardSeedV2, copyStateSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";

const work = (h, ...parts) => join(h.state, "tasks", "company-work", ...parts);
const walker = (h, ...parts) => work(h, "STH-8", "art", "walker", ...parts);

async function withHome(fn) {
  const h = await startV2({ routes: ["studio-art"], boardSeed: boardSeedV2() });
  copyStateSeedV2(h.state);
  try { return await fn(h); } finally { await h.close(); }
}

const art = async (h) => {
  const r = await call(h.url, "GET", "/api/studio/art");
  assert.equal(r.status, 200);
  return r.json;
};
const sprite = (h, id) => call(h.url, "GET", `/api/studio/art/sprite?id=${encodeURIComponent(id)}`);

// A copy of the seed's walker under another name, with its data file changed by `edit`.
function copyWalker(h, name, edit = (d) => d, manifestEdit = (m) => m) {
  const dir = work(h, "STH-8", "art", name);
  cpSync(walker(h), dir, { recursive: true });
  const data = JSON.parse(readFileSync(join(dir, "walker.json"), "utf8"));
  writeFileSync(join(dir, "walker.json"), JSON.stringify(edit(data)));
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestEdit({ ...manifest, name })));
  return dir;
}

test("art: the seed fits shape studio-art; walker has 4 frames, its checks pass and its GIF has 4 frames", async () => {
  await withHome(async (h) => {
    const a = await art(h);
    assert.deepEqual(sameShape(readShape("studio-art"), a), []);
    assert.equal(a.installed, true);
    assert.equal(a.notConnected, null);
    assert.deepEqual(a.agent, { name: "Artist", state: "free", plainState: "Free" });
    const w = a.sprites.find((s) => s.id === "STH-8/walker");
    assert.ok(w);
    assert.equal(w.frames, 4);
    assert.deepEqual(w.frameSize, { w: 16, h: 16 });
    assert.equal(w.title, "Mascot walk cycle");
    assert.equal(w.taskId, IDS_V2.issues["STH-8"]);
    assert.deepEqual(w.tags, [{ name: "walk", from: 0, to: 3, direction: "forward" }]);
    assert.deepEqual(w.checks, { framesMatchSheet: true, tagsValid: true, gifFrames: 4, ok: true });
    assert.equal(w.sheet.name, "art/walker/walker-sheet.png");
    assert.equal(w.sheet.kind, "image");
    assert.match(w.sheet.viewUrl, /^\/api\/view\//);
    assert.equal(w.data.kind, "text");
    assert.deepEqual(a.problems, []);
    assert.deepEqual(writes(h.board), []);
  });
});

test("sprite: the seed's walker fits shape sprite with four frames of 16 x 16", async () => {
  await withHome(async (h) => {
    const r = await sprite(h, "STH-8/walker");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("sprite"), r.json), []);
    assert.equal(r.json.frames.length, 4);
    for (const [i, f] of r.json.frames.entries()) assert.deepEqual(f, { x: 16 * i, y: 0, w: 16, h: 16, duration: 120 });
    assert.deepEqual(r.json.tags, [{ name: "walk", from: 0, to: 3, direction: "forward" }]);
    assert.equal(r.json.sprite.checks.ok, true);
  });
});

test("art: a tag that runs to frame 4 of four gives tagsValid false and ok false", async () => {
  await withHome(async (h) => {
    copyWalker(h, "runner", (d) => { d.meta.frameTags[0].to = 4; return d; });
    const a = await art(h);
    const s = a.sprites.find((x) => x.id === "STH-8/runner");
    assert.ok(s);
    assert.equal(s.checks.tagsValid, false);
    assert.equal(s.checks.ok, false);
    assert.equal(s.checks.framesMatchSheet, true);
    const r = await sprite(h, "STH-8/runner");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.tags, []);                      // the player gets only tags it can play
  });
});

test("art: a sheet whose header disagrees with meta.size gives framesMatchSheet false", async () => {
  await withHome(async (h) => {
    copyWalker(h, "wide", (d) => { d.meta.size = { w: 80, h: 16 }; return d; });
    copyWalker(h, "outside", (d) => { d.frames[3].frame.x = 60; return d; });
    const a = await art(h);
    for (const id of ["STH-8/wide", "STH-8/outside"]) {
      const s = a.sprites.find((x) => x.id === id);
      assert.equal(s.checks.framesMatchSheet, false, id);
      assert.equal(s.checks.ok, false, id);
    }
  });
});

test("art: a GIF whose frame count differs gives ok false", async () => {
  await withHome(async (h) => {
    const dir = copyWalker(h, "short");
    const gif = readFileSync(join(dir, "walker.gif"));
    writeFileSync(join(dir, "walker.gif"), gif.subarray(0, 30));
    const s = (await art(h)).sprites.find((x) => x.id === "STH-8/short");
    assert.equal(s.checks.gifFrames, 0);
    assert.equal(s.checks.ok, false);
  });
});

test("art: a manifest naming ../../x.png lands in problems, and the others still list", async () => {
  await withHome(async (h) => {
    copyWalker(h, "escape", (d) => d, (m) => ({ ...m, sheet: "../../x.png" }));
    const a = await art(h);
    assert.ok(!a.sprites.some((s) => s.id === "STH-8/escape"));
    const p = a.problems.find((x) => x.name === "escape");
    assert.ok(p);
    assert.equal(p.goal, "STH-8");
    assert.match(p.problem, /outside its folder/);
    assert.ok(a.sprites.some((s) => s.id === "STH-8/walker"));
  });
});

test("art: a data file that lists no frames is a problem, in a plain sentence", async () => {
  await withHome(async (h) => {
    copyWalker(h, "broken", (d) => ({ ...d, frames: [] }));
    const a = await art(h);
    assert.deepEqual(a.problems, [{ goal: "STH-8", name: "broken", problem: "The data file lists no frames." }]);
    const r = await sprite(h, "STH-8/broken");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "sprite_broken");
  });
});

test("sprite: a data file with 5000 frames is 409 sprite_broken", async () => {
  await withHome(async (h) => {
    const frame = { frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 100 };
    copyWalker(h, "huge", (d) => ({ ...d, frames: Array.from({ length: 5000 }, () => frame) }));
    const r = await sprite(h, "STH-8/huge");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "sprite_broken");
    assert.match(r.json.error.message, /more than 1024 frames/);
    assert.ok(!/\d{3}|stack|Error/.test(r.json.error.next));
    assert.ok((await art(h)).problems.some((p) => p.name === "huge"));
  });
});

test("sprite: numbers out of range, a wrong type, and a data file over 256 KB are broken", async () => {
  await withHome(async (h) => {
    copyWalker(h, "neg", (d) => { d.frames[0].frame.x = -1; return d; });
    copyWalker(h, "big-number", (d) => { d.frames[0].frame.w = 16385; return d; });
    copyWalker(h, "fast", (d) => { d.frames[0].duration = 5; return d; });
    copyWalker(h, "text-number", (d) => { d.frames[0].frame.y = "0"; return d; });
    const dir = copyWalker(h, "padded");
    writeFileSync(join(dir, "walker.json"), `${" ".repeat(270000)}${readFileSync(walker(h, "walker.json"), "utf8")}`);
    for (const name of ["neg", "big-number", "fast", "text-number", "padded"]) {
      const r = await sprite(h, `STH-8/${name}`);
      assert.equal(r.status, 409, name);
      assert.equal(r.json.error.code, "sprite_broken", name);
    }
  });
});

test("sprite: an unknown id, a bad id and an image are sprite_not_found", async () => {
  await withHome(async (h) => {
    const img = work(h, "STH-8", "art", "badge");
    mkdirSync(img);
    writeFileSync(join(img, "badge.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    writeFileSync(join(img, "manifest.json"), JSON.stringify({ name: "badge", title: "Round badge", kind: "image", image: "badge.svg", script: "badge.py", made_at: "2026-11-11T08:05:00Z" }));
    for (const id of ["STH-8/nobody", "STH-99/walker", "../STH-8/walker", "STH-8/Walker", "STH-8", "STH-8/badge"]) {
      const r = await sprite(h, id);
      assert.equal(r.status, 404, id);
      assert.equal(r.json.error.code, "sprite_not_found", id);
    }
    const a = await art(h);
    const b = a.images.find((x) => x.id === "STH-8/badge");
    assert.equal(b.title, "Round badge");
    assert.equal(b.file.name, "art/badge/badge.svg");
    assert.equal(b.file.kind, "image");
  });
});

test("art: a linked art folder and a linked manifest are never read", async () => {
  await withHome(async (h) => {
    const outside = join(h.state, "outside-art");
    cpSync(walker(h), outside, { recursive: true });
    symlinkSync(outside, work(h, "STH-8", "art", "linked"));
    const dir = work(h, "STH-8", "art", "linked-manifest");
    cpSync(walker(h), dir, { recursive: true });
    rmSync(join(dir, "manifest.json"));
    symlinkSync(join(outside, "manifest.json"), join(dir, "manifest.json"));
    const a = await art(h);
    const ids = [...a.sprites, ...a.images].map((s) => s.id);
    assert.deepEqual(ids, ["STH-8/walker"]);
    assert.ok(!a.problems.some((p) => p.name === "linked"));
  });
});

test("art: without the tool marker, installed is false with the pinned notice and the sprite still lists", async () => {
  await withHome(async (h) => {
    rmSync(join(h.state, "art", "venv", "bin", "python"));
    const a = await art(h);
    assert.equal(a.installed, false);
    assert.deepEqual(a.notConnected, { reason: "The Artist's tools are not installed yet.", next: "Run: engine/art/install.sh" });
    assert.ok(a.sprites.some((s) => s.id === "STH-8/walker"));
    assert.deepEqual(sameShape(readShape("studio-art"), a), []);
  });
});

test("art: hostile text in a manifest is made plain and capped", async () => {
  await withHome(async (h) => {
    copyWalker(h, "noisy", (d) => d, (m) => ({ ...m, title: `‮evil\u0000${"x".repeat(500)}`, palette: ["#ABCDEF", "red", "#12", 7] }));
    const s = (await art(h)).sprites.find((x) => x.id === "STH-8/noisy");
    assert.ok(s.title.length <= 120);
    assert.ok(!/[\u0000‮]/.test(s.title));
    assert.deepEqual(s.palette, ["#abcdef"]);
  });
});
