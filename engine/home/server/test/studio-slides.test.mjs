// The Studio's slides (C3 36.2): GET /api/studio/slides. The checks come from the files themselves;
// broken or hostile folders land in `problems` or fail a check, and never break the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call, writes } from "../lib/testing.mjs";
import { boardSeedV2, copyStateSeedV2, IDS_V3 } from "../../../test/stubs/seed.mjs";

const work = (h, ...parts) => join(h.state, "tasks", "company-work", ...parts);
const launch = (h, ...parts) => work(h, "STH-24", "slides", "launch", ...parts);

async function withHome(fn) {
  const h = await startV2({ routes: ["studio-slides"], boardSeed: boardSeedV2() });
  copyStateSeedV2(h.state);
  try { return await fn(h); } finally { await h.close(); }
}

const slides = async (h) => {
  const r = await call(h.url, "GET", "/api/studio/slides");
  assert.equal(r.status, 200);
  assert.deepEqual(sameShape(readShape("studio-slides"), r.json), []);
  return r.json;
};

// The first bytes of a PNG of w x h: the signature and the IHDR chunk, then filler.
function pngHeader(w, h, pad = 32) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8; b[25] = 6;
  return b;
}

// A copy of the seed's launch set under another name, with its manifest and word list changed.
function copyLaunch(h, name, manifestEdit = (m) => m, dataEdit = (d) => d) {
  const dir = work(h, "STH-24", "slides", name);
  cpSync(launch(h), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestEdit({ ...manifest, name })));
  const data = JSON.parse(readFileSync(join(dir, "slides.json"), "utf8"));
  writeFileSync(join(dir, "slides.json"), JSON.stringify(dataEdit(data)));
  return dir;
}
const setOf = (a, id) => a.sets.find((s) => s.id === id);

test("slides: the seed fits shape studio-slides; launch has three slides of 1080 x 1350 and its checks pass", async () => {
  await withHome(async (h) => {
    const a = await slides(h);
    assert.equal(a.installed, true);
    assert.equal(a.notConnected, null);
    assert.deepEqual(a.problems, []);
    const s = setOf(a, "STH-24/launch");
    assert.ok(s);
    assert.equal(s.goal, "STH-24");
    assert.equal(s.taskId, IDS_V3.issues["STH-24"]);
    assert.equal(s.name, "launch");
    assert.equal(s.title, "Launch carousel");
    assert.equal(s.count, 3);
    assert.deepEqual(s.size, { w: 1080, h: 1350 });
    assert.deepEqual(s.slides.map((f) => f.name), ["slide-01.png", "slide-02.png", "slide-03.png"].map((f) => `slides/launch/${f}`));
    for (const f of [...s.slides, s.contact]) {
      assert.equal(f.kind, "image");
      assert.match(f.viewUrl, /^\/api\/view\//);
    }
    assert.equal(s.contact.name, "slides/launch/contact.png");
    assert.deepEqual(s.texts, [
      "A new kitchen before the lamps are lit",
      "Order by 30 November and we fit it before Diwali",
      "Book a visit to the Whitefield studio",
    ]);
    assert.deepEqual(s.checks, { sizesMatch: true, countMatches: true, ok: true });
    assert.match(s.changed, /^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    assert.deepEqual(writes(h.board), []);
  });
});

test("slides: without the slide tool the answer says it is not installed, and still lists the sets", async () => {
  await withHome(async (h) => {
    rmSync(join(h.state, "art", "tools", "slides.py"));
    const a = await slides(h);
    assert.equal(a.installed, false);
    assert.equal(a.notConnected.reason, "The Artist's slide tool is not installed yet.");
    assert.ok(setOf(a, "STH-24/launch"));
  });
});

test("slides: a manifest naming ../x lands in problems, and the others still list", async () => {
  await withHome(async (h) => {
    copyLaunch(h, "escape", (m) => ({ ...m, slides: ["../x.png", "slide-02.png"] }));
    copyLaunch(h, "contact", (m) => ({ ...m, contact: "../../contact.png" }));
    const a = await slides(h);
    for (const name of ["escape", "contact"]) {
      assert.ok(!setOf(a, `STH-24/${name}`), name);
      const p = a.problems.find((x) => x.name === name);
      assert.ok(p, name);
      assert.equal(p.goal, "STH-24");
      assert.match(p.problem, /outside its folder/);
    }
    assert.ok(setOf(a, "STH-24/launch"));
  });
});

test("slides: a slide that is not a PNG fails sizesMatch", async () => {
  await withHome(async (h) => {
    const dir = copyLaunch(h, "fake");
    writeFileSync(join(dir, "slide-02.png"), "<!doctype html><script>alert(1)</script>");
    const s = setOf(await slides(h), "STH-24/fake");
    assert.ok(s);
    assert.equal(s.checks.sizesMatch, false);
    assert.equal(s.checks.ok, false);
    assert.equal(s.checks.countMatches, true);
  });
});

test("slides: a slide of the wrong size, and a size the slide tool does not make, fail sizesMatch", async () => {
  await withHome(async (h) => {
    const dir = copyLaunch(h, "odd");
    writeFileSync(join(dir, "slide-03.png"), pngHeader(1080, 1080));
    copyLaunch(h, "square-claim", (m) => ({ ...m, size: { w: 1080, h: 1080 } }));
    const a = await slides(h);
    assert.equal(setOf(a, "STH-24/odd").checks.sizesMatch, false);
    assert.equal(setOf(a, "STH-24/square-claim").checks.sizesMatch, false);
    // Every slide 1000 x 1000 and the manifest saying so: the sizes agree, but the tool never makes it.
    const big = copyLaunch(h, "big", (m) => ({ ...m, size: { w: 1000, h: 1000 } }));
    for (const f of ["slide-01.png", "slide-02.png", "slide-03.png"]) writeFileSync(join(big, f), pngHeader(1000, 1000));
    assert.equal(setOf(await slides(h), "STH-24/big").checks.ok, false);
  });
});

test("slides: a slide over 20 MB fails sizesMatch without being read", async () => {
  await withHome(async (h) => {
    const dir = copyLaunch(h, "heavy");
    writeFileSync(join(dir, "slide-01.png"), pngHeader(1080, 1350));
    truncateSync(join(dir, "slide-01.png"), 20 * 1024 * 1024 + 1);
    const s = setOf(await slides(h), "STH-24/heavy");
    assert.equal(s.checks.sizesMatch, false);
    assert.equal(s.slides[0].size, 20 * 1024 * 1024 + 1);
  });
});

test("slides: a manifest of 5 MB, a missing slide and a slide that is a link land in problems", async () => {
  await withHome(async (h) => {
    const big = copyLaunch(h, "huge");
    writeFileSync(join(big, "manifest.json"), `{"kind":"slides","pad":"${"x".repeat(5 * 1024 * 1024)}"}`);
    const gone = copyLaunch(h, "gone");
    rmSync(join(gone, "slide-02.png"));
    const linked = copyLaunch(h, "linked");
    rmSync(join(linked, "slide-01.png"));
    writeFileSync(join(h.state, "outside.png"), pngHeader(1080, 1350));
    symlinkSync(join(h.state, "outside.png"), join(linked, "slide-01.png"));
    const a = await slides(h);
    const problem = (name) => a.problems.find((x) => x.name === name)?.problem;
    assert.equal(problem("huge"), "The manifest is too large.");
    assert.equal(problem("gone"), "A slide is missing.");
    assert.equal(problem("linked"), "A slide is missing.");
    assert.ok(setOf(a, "STH-24/launch"));
    assert.equal(a.sets.length, 1);
  });
});

test("slides: a folder that is a link, and a slides folder that is a link, are not listed", async () => {
  await withHome(async (h) => {
    symlinkSync(launch(h), work(h, "STH-24", "slides", "mirror"));
    symlinkSync(work(h, "STH-24", "slides"), work(h, "STH-25", "slides"));
    const a = await slides(h);
    assert.deepEqual(a.sets.map((s) => s.id), ["STH-24/launch"]);
    assert.deepEqual(a.problems, []);
  });
});

test("slides: one slide, or a list of words that does not match the slides, fails countMatches", async () => {
  await withHome(async (h) => {
    copyLaunch(h, "single", (m) => ({ ...m, slides: ["slide-01.png"] }), (d) => ({ slides: d.slides.slice(0, 1) }));
    copyLaunch(h, "short", (m) => m, (d) => ({ slides: d.slides.slice(0, 2) }));
    copyLaunch(h, "order", (m) => m, (d) => ({ slides: [d.slides[1], d.slides[0], d.slides[2]] }));
    const a = await slides(h);
    for (const id of ["STH-24/single", "STH-24/short", "STH-24/order"]) {
      const s = setOf(a, id);
      assert.equal(s.checks.countMatches, false, id);
      assert.equal(s.checks.ok, false, id);
    }
    assert.equal(setOf(a, "STH-24/single").count, 1);
  });
});

test("slides: the words are plain text, capped at 600 characters; a title is plain and capped", async () => {
  await withHome(async (h) => {
    copyLaunch(h, "words", (m) => ({ ...m, title: `<b>Bold</b>\u0000‮${"t".repeat(300)}` }), (d) => ({
      slides: d.slides.map((s, i) => ({ ...s, text: i === 0 ? `line one\n\u0007line two ${"w".repeat(900)}` : i === 1 ? 42 : s.text })),
    }));
    const s = setOf(await slides(h), "STH-24/words");
    assert.ok(s.texts[0].startsWith("line one line two "));
    assert.equal(s.texts[0].length, 600);
    assert.equal(s.texts[1], "");
    assert.ok(!/[\u0000-\u001f‮]/.test(s.title));
    assert.equal(s.title.length, 120);
  });
});

test("slides: a manifest of another kind lands in problems", async () => {
  await withHome(async (h) => {
    copyLaunch(h, "sprite", (m) => ({ ...m, kind: "sprite" }));
    const p = (await slides(h)).problems.find((x) => x.name === "sprite");
    assert.equal(p.problem, "The manifest does not say these are slides.");
  });
});
