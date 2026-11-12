// PLAN-V5 K9: GET /api/tasks/:id/pieces through a stub home. The kind comes from the job's craft entry by
// the home server's own `template:` record; the brand result from the home server's own run (a stand-in
// runner here; the stub homes' default never starts a process); the review only from the Art director's
// own comment, newer than the pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readShape, sameShape } from "../lib/shape.mjs";
import { forgetBrandChecks, stubBrandCheckRunner } from "../lib/brandcheck.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call } from "../lib/testing.mjs";
import { boardSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";

// K8's example comment, word for word.
const K8_EXAMPLE = [
  "REVIEW: FAIL - b is off the palette and its last slide has no clear first thing",
  "# Art review: round 1",
  "## Pieces",
  "a: brand 8, hierarchy 7, composition 8, finish 7, idea 7, voice 8, kind 7; calm and exact, the type carries it",
  "b: brand 5, hierarchy 6, composition 7, finish 7, idea 8, voice 7, kind 6; the strongest idea, but the teal is not ours",
  "## Seen",
  "- a: slides/launch-a/contact.png, slide 4: the figure and its label are the same size",
  "## Actions",
  "- b: use ink and sand only; give slide 5 one large line",
  "Review: FAIL",
].join("\n");
const AD = "aaaaaaaa-0000-4000-8000-0000000000ad";
const GOAL = IDS_V2.issues["STH-2"];
const JOB = "marketing/carousel-from-a-concept";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);
const VARIANTS = { kind: "carousel", name: "launch", round: 1, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "picture-led" }, { id: "c", direction: "diagram-led" }] };
const REPORT = {
  version: 1, kit: "present",
  pieces: [
    { kind: "slides", name: "launch-a", result: "pass", hard: [], soft: [], measured: { colours: [], words: 0 } },
    { kind: "slides", name: "launch-b", result: "fail", hard: [{ code: "off_palette", where: "slide-02.png", detail: "12% of the picture is in colours outside the kit" }], soft: [], measured: { colours: [], words: 0 } },
    { kind: "slides", name: "launch-c", result: "pass", hard: [], soft: [], measured: { colours: [], words: 0 } },
  ],
  variants: { result: "pass", hard: [], present: true },
};
const minutesFromNow = (m) => new Date(Date.now() + m * 60000).toISOString();

function review(body, { author = AD, at = minutesFromNow(5), n = 1 } = {}) {
  return { id: `cd000000-0000-4000-8000-${String(n).padStart(12, "0")}`, issueId: GOAL, body, authorAgentId: author, authorUserId: null, createdAt: at };
}

async function withHome({ comments = [], template = JOB, runner, variants = VARIANTS, wait, files = true } = {}, fn) {
  forgetBrandChecks();
  const seed = boardSeedV2();
  seed.comments.push(...comments);
  const h = await startV2({
    routes: ["pieces"], boardSeed: seed, brandCheckRunner: runner,
    decisions: template ? { [`template:${GOAL}`]: template } : {},
  });
  const tmp = mkdtempSync(join(tmpdir(), "uuu-pieces-craft-"));
  try {
    const craft = join(tmp, "craft.json");
    writeFileSync(craft, JSON.stringify({ version: 1, jobs: { [JOB]: { kind: "carousel", review: "art", variants: 3, playbooks: [] } } }));
    h.app.home.craftFile = craft;
    if (wait !== undefined) h.app.home.brandCheckWaitMs = wait;
    const ids = JSON.parse(readFileSync(join(h.state, "ids.json"), "utf8"));
    ids.agents["art-director"] = AD;
    writeFileSync(join(h.state, "ids.json"), JSON.stringify(ids));
    const goal = join(h.state, "tasks", "company-work", "STH-2");
    mkdirSync(goal, { recursive: true });
    if (variants) writeFileSync(join(goal, "variants.json"), typeof variants === "string" ? variants : JSON.stringify(variants));
    if (files) {
      for (const id of ["a", "b", "c"]) {
        mkdirSync(join(goal, "slides", `launch-${id}`), { recursive: true });
        writeFileSync(join(goal, "slides", `launch-${id}`, "contact.png"), PNG);
        if (files !== "contact-only") writeFileSync(join(goal, "slides", `launch-${id}`, "slide-01.png"), PNG);
      }
    }
    return await fn(h, goal);
  } finally {
    forgetBrandChecks();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const pieces = async (h, id = "STH-2") => {
  const r = await call(h.url, "GET", `/api/tasks/${id}/pieces`);
  return r;
};

test("pieces: three versions with previews, the home server's own brand result and the Art director's scores; fits shape pieces", async () => {
  await withHome({ comments: [review(K8_EXAMPLE)], runner: async () => JSON.stringify(REPORT) }, async (h) => {
    const r = await pieces(h);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(sameShape(readShape("pieces"), r.json), []);
    const a = r.json;
    assert.equal(a.kind, "carousel");
    assert.equal(a.round, 1);
    assert.equal(a.single, false);
    assert.equal(a.problem, null);
    assert.deepEqual(a.variants.map((x) => [x.id, x.direction.title]), [["a", "Type led"], ["b", "Picture led"], ["c", "Diagram led"]]);
    assert.equal(Buffer.from(a.variants[0].preview[0].token, "base64url").toString(), "STH-2/slides/launch-a/slide-01.png");
    assert.equal(a.variants[0].preview.at(-1).contact, true);
    assert.deepEqual(a.variants.map((x) => x.brand.result), ["pass", "fail", "pass"]);
    assert.deepEqual(a.variants[1].brand.lines, ["slide-02.png: 12% of the picture is in colours outside the kit"]);
    assert.deepEqual(a.variants.map((x) => x.review && [x.review.total, x.review.of, x.review.meets]), [[52, 70, true], [46, 70, false], null]);
    // The same answer through the task's identifier or its id.
    const byId = await pieces(h, GOAL);
    assert.equal(byId.status, 200);
    assert.deepEqual(byId.json.variants.map((x) => x.id), ["a", "b", "c"]);
  });
});

test("pieces: a review by another author, one older than the files, or one of another round is not shown", async () => {
  const other = review(K8_EXAMPLE, { author: IDS_V2.agents?.checker || "cccccccc-0000-4000-8000-000000000000", n: 1 });
  const older = review(K8_EXAMPLE, { at: minutesFromNow(-60), n: 2 });
  const round2 = review(K8_EXAMPLE.replace("round 1", "round 2"), { n: 3 });
  const noSeen = review(K8_EXAMPLE.split("\n").filter((l) => !l.startsWith("- a: slides")).join("\n"), { n: 4 });
  await withHome({ comments: [other, older, round2, noSeen] }, async (h) => {
    const r = await pieces(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.variants.map((x) => x.review), [null, null, null]);
  });
});

test("pieces: a runner that answers garbage, 1 MB or never gives brand unknown, and the route answers within its time", async () => {
  const runners = [async () => "<html>not a report</html>", async () => "x".repeat(1024 * 1024), () => new Promise(() => {}), async () => ({ kit: "present", pieces: "all fine" })];
  for (const runner of runners) {
    await withHome({ runner, wait: 300 }, async (h) => {
      const t = Date.now();
      const r = await pieces(h);
      assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
      assert.equal(r.status, 200);
      assert.deepEqual(sameShape(readShape("pieces"), r.json), []);
      assert.deepEqual(r.json.variants.map((x) => x.brand.result), ["unknown", "unknown", "unknown"]);
      assert.ok(r.json.variants.every((x) => x.brand.lines.length === 1));
    });
  }
});

test("pieces: the stub homes' runner starts no process and nothing is marked as checked", async () => {
  await withHome({}, async (h) => {
    assert.equal(h.app.home.brandCheckRunner, stubBrandCheckRunner);
    const r = await pieces(h);
    assert.deepEqual(r.json.variants.map((x) => x.brand.result), ["unknown", "unknown", "unknown"]);
  });
  const plain = await startStubsHome({ port: 0, moduleDirs: [] });
  try { assert.equal(plain.app.home.brandCheckRunner, stubBrandCheckRunner); } finally { await plain.close(); }
});

test("pieces: a broken variants.json is a plain problem and no version; a task from no craft job shows none", async () => {
  await withHome({ variants: { ...VARIANTS, variants: [{ id: "a", direction: "type-led" }, { id: "b", direction: "type-led" }] } }, async (h) => {
    const r = await pieces(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.variants, []);
    assert.match(r.json.problem, /same direction/);
  });
  await withHome({ template: null }, async (h) => {
    const r = await pieces(h);
    assert.equal(r.status, 200);
    assert.equal(r.json.kind, null);
    assert.match(r.json.problem, /not started from a job that makes versions/);
  });
  await withHome({ template: null, variants: null }, async (h) => {
    const r = await pieces(h);
    assert.deepEqual(r.json, { kind: null, round: null, variants: [], single: true, missing: [], problem: null, complete: true, note: null });
    assert.equal((await pieces(h, "STH-999")).status, 404);
  });
});

test("pieces: a single piece of a craft job is one entry with the id piece, scored by a review of piece", async () => {
  const body = K8_EXAMPLE.replace(/^a: /m, "piece: ").replace(/^b: .*$/m, "");
  await withHome({ variants: null, comments: [review(body)], runner: async () => REPORT }, async (h) => {
    const r = await pieces(h);
    assert.equal(r.status, 200);
    assert.equal(r.json.single, true);
    assert.deepEqual(r.json.variants.map((x) => [x.id, x.direction, x.review?.total, x.brand.result]), [["piece", null, 52, "fail"]]);
  });
});

test("pieces: a version whose folder holds only contact.png is could-not-check, whatever the runner says", async () => {
  await withHome({ comments: [review(K8_EXAMPLE)], runner: async () => JSON.stringify(REPORT), files: "contact-only" }, async (h, goal) => {
    for (const id of ["a", "c"]) writeFileSync(join(goal, "slides", `launch-${id}`, "slide-01.png"), PNG);
    const r = await pieces(h);
    assert.equal(r.status, 200);
    const b = r.json.variants.find((x) => x.id === "b");
    assert.deepEqual(b.preview, []);
    assert.equal(b.brand.result, "unknown");
    assert.deepEqual(b.brand.lines, ["This version has no slide pictures, so it was not checked."]);
    assert.equal(r.json.variants.find((x) => x.id === "a").brand.result, "pass");
  });
});

test("pieces: junk files and a version changed in place after the review show no scores, with one plain line why", async () => {
  await withHome({ runner: async () => JSON.stringify(REPORT) }, async (h, goal) => {
    mkdirSync(join(goal, "content"), { recursive: true });
    for (let i = 0; i < 3100; i += 1) writeFileSync(join(goal, "content", `junk-${i}.md`), "x");
    await new Promise((r) => setTimeout(r, 50));
    h.board.state.comments.push(review(K8_EXAMPLE, { at: new Date().toISOString(), n: 9 }));
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(goal, "slides", "launch-b", "slide-01.png"), Buffer.concat([PNG, Buffer.alloc(10)]));
    const r = await pieces(h);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.variants.map((x) => x.review), [null, null, null]);
    assert.equal(r.json.complete, false);
    assert.equal(r.json.note, "This task's folder holds too many files to be sure the scores are newer than the versions, so the scores are not shown.");
  });
});
