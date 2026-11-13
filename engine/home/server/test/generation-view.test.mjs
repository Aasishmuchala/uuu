// The Generation view (PLAN-V5 K13, T41): money from the door's own ledger, the owner's batches, the ledger's
// pages and their words, on a stub home with a real generation door (createGenerateDoor on port 0) on the stand-in
// Runway. Every secret, key and id is made up; nothing leaves 127.0.0.1 and nothing calls a live door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSecret } from "../../../doors/common.mjs";
import { createGenerateDoor } from "../../../generate/door.mjs";
import { createLedger, dayOf, readLedger, totalsOf } from "../../../generate/ledger.mjs";
import { estimate } from "../../../generate/runway.mjs";
import { readBatch } from "../../../generate/state.mjs";
import { startRunway } from "../../../test/stubs/runway.mjs";
import {
  LEDGER_SENTENCES, NOT_STARTED_WORDS, PAUSED_SENTENCE, RESULT_WORDS, RUNNING_WORDS, dollars, exampleSentence, kindWords, modelChoices,
  moneyOf, priceWords, readBatchFile, resultWords,
} from "../lib/generation.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const KEY = `key_${randomBytes(64).toString("hex")}`;
const DAY = 24 * 3600_000;
const STH1 = "e0000000-0000-4000-8000-000000000001";
const STH2 = "e0000000-0000-4000-8000-000000000002";
const MODELS = { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" };
const iso = (ms) => new Date(ms).toISOString();

// A stub home with the Generation routes; unless door is false, a real generation door on port 0 against the
// stand-in Runway, its doors folder made as `engine start` makes it.
async function withGen(fn, { door = true } = {}) {
  const rw = await startRunway({ key: KEY });
  const logs = [];
  const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  let d = null;
  try {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    ensureSecret(h.config.paths.generateSecret);
    if (door) {
      d = createGenerateDoor({
        listenPort: 0, upstream: rw.url, paths: h.config.paths, config: h.config, log: () => {}, net: rw.net,
        limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000 },
      });
      await d.listen();
      await d.settled();
      h.app.home.urls.generate = `http://127.0.0.1:${d.port}`;
    }
    return await fn({ h, door: d, rw, logs });
  } finally {
    if (d) await d.close();
    await h.close();
    await rw.close();
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/generation")).json;
const page = async (h, before) => (await call(h.url, "GET", `/api/generation/ledger${before ? `?before=${before}` : ""}`)).json;

// Ledger lines as the door writes them (engine/generate/ledger.mjs's shape), for files too large to append one by one.
const line = (f) => JSON.stringify({
  at: null, job: null, batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5,
  estimate: 25, state: "reserved", credits: 25, runwayTask: null, verdict: null, ...f,
});
// One job's lines: its reservation, and its end unless `end` is null.
function jobLines(job, at, { end = "spent", credits = 25, verdict = "done", ...f } = {}) {
  const out = [line({ at: iso(at), job, credits: f.estimate ?? 25, ...f })];
  if (end) out.push(line({ at: iso(at + 1000), job, state: end, credits: end === "released" ? 0 : credits, verdict, ...f }));
  return out;
}
function writeLedger(config, lines, mode = 0o600) {
  rmSync(config.paths.ledger, { force: true });
  writeFileSync(config.paths.ledger, lines.length ? `${lines.join("\n")}\n` : "");
  chmodSync(config.paths.ledger, mode);
}
function writeBatch(config, id, fields = {}, mode = 0o600) {
  mkdirSync(config.paths.batches, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const path = join(config.paths.batches, `${id}.json`);
  rmSync(path, { force: true });
  writeFileSync(path, JSON.stringify({
    id, task: STH1, slug: "artist", approvedAt: iso(now - 3600_000), expiresAt: iso(now + 6 * DAY), budgetCredits: 300, textToVideo: false,
    shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 }, s02: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 } },
    ...fields,
  }));
  chmodSync(path, mode);
  return path;
}
const batchId = () => `b${randomBytes(10).toString("hex")}`;

// ---- the view ---------------------------------------------------------------------------------------------------

test("the view fits shapes/generation.json with no switches file, no key and no ledger, and reading writes nothing", async () => {
  await withGen(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/generation");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("generation"), r.json), []);
    const v = r.json;
    assert.equal(v.on, false);
    assert.deepEqual(v.key, { saved: false });
    assert.deepEqual(v.door, { state: "on", sentence: "The generation door is running." });
    assert.deepEqual([v.canSwitchOn, v.blockers, v.whyNot], [false, ["no_key"], "Paste your Runway key first."]);
    assert.deepEqual(v.caps, { daily: 300, monthly: 1000 });
    assert.deepEqual(v.models, MODELS);
    assert.deepEqual(v.spent, { ok: true, day: 0, month: 0, dayLeft: 300, monthLeft: 1000, running: 0 });
    assert.equal(v.paused, null);
    assert.equal(v.example, "A 30-second film of six clips costs about 150 credits ($1.50), up to 300 with one retake each.");
    assert.deepEqual(v.ledger, { ok: true, bytes: 0, nearlyFull: false, sentence: null });
    assert.deepEqual(v.batches, []);
    assert.deepEqual([v.problem, v.problemSentence], [null, null]);
    assert.ok(!("autoUnderCredits" in v) && !JSON.stringify(v).includes("autoUnder"), "the automatic allowance is not shown (C5)");
    assert.equal(existsSync(h.config.paths.doorsState), false, "reading writes nothing");
    assert.equal(existsSync(h.config.paths.ledger), false, "the home server never writes the ledger");
  });
});

test("a damaged switches file: generation off and a plain problem; the next save writes a fresh file", async () => {
  await withGen(async ({ h }) => {
    writeFileSync(h.config.paths.doorsState, JSON.stringify({ version: 1, generate: { on: true, dailyCredits: "lots" } }));
    let v = await view(h);
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    assert.equal(v.on, false);
    assert.equal(v.problem, "state_unreadable");
    assert.match(v.problemSentence, /every door is off/);
    assert.deepEqual(v.caps, { daily: 300, monthly: 1000 }, "the defaults, never the damaged values");
    const r = await call(h.url, "POST", "/api/generation/switch", { body: { on: false } });
    assert.equal(r.status, 200);
    assert.equal(statSync(h.config.paths.doorsState).mode & 0o777, 0o600);
    v = await view(h);
    assert.equal(v.problem, null);
    assert.equal(JSON.parse(readFileSync(h.config.paths.doorsState, "utf8")).generate.on, false);
  });
});

test("the choices are the door's priced models for each kind, in words; the example prices six clips with the clip model", async () => {
  const c = modelChoices();
  assert.deepEqual(c.video.map((x) => x.model), ["gen4_turbo", "gen4.5"]);
  assert.deepEqual(c.videoBest.map((x) => x.model), ["gen4.5"]);
  assert.deepEqual(c.still.map((x) => x.model), ["gen4_image", "gen4_image_turbo"]);
  assert.deepEqual(c.upscale.map((x) => x.model), ["magnific_precision_upscaler_v2"]);
  assert.equal(c.video[0].words, "gen4_turbo: 5 credits a second");
  assert.equal(c.still[0].words, "gen4_image: 8 credits a picture");
  assert.equal(priceWords("magnific_precision_upscaler_v2"), "magnific_precision_upscaler_v2: 25 credits a picture");
  assert.equal(exampleSentence(MODELS), "A 30-second film of six clips costs about 150 credits ($1.50), up to 300 with one retake each.");
  assert.equal(exampleSentence({ ...MODELS, video: "veo3.1" }), "The door has no price for veo3.1, the model chosen in Settings.");
  await withGen(async ({ h }) => {
    const r = await call(h.url, "POST", "/api/generation/models", { body: { video: "gen4.5" } });
    assert.equal(r.status, 200);
    assert.equal(r.json.example, "A 30-second film of six clips costs about 360 credits ($3.60), up to 720 with one retake each.");
    assert.equal(r.json.example.includes(String(6 * estimate({ kind: "image_to_video", model: "gen4.5", seconds: 5 }))), true);
  }, { door: false });
});

test("money at 23:59 and at 00:01 in Kolkata: today, this month and what is left change at India's midnight", () => {
  // 30 November 2026, 23:59 IST is 18:29 UTC; 1 December, 00:01 IST is 18:31 UTC.
  const lines = readLedgerLines([
    ...jobLines("g1", Date.parse("2026-11-30T18:20:00Z"), { credits: 25 }),                     // 23:50 IST, 30 Nov
    ...jobLines("g2", Date.parse("2026-11-30T18:30:30Z"), { end: null, estimate: 50, credits: 50 }), // 00:00:30 IST, 1 Dec, still running
    ...jobLines("g3", Date.parse("2026-11-15T06:00:00Z"), { end: "released", verdict: "not_started_400" }),
    ...jobLines("g4", Date.parse("2026-11-20T06:00:00Z"), { credits: 25, verdict: "refused" }),
  ]);
  const caps = { daily: 300, monthly: 1000 };
  const before = Date.parse("2026-11-30T18:29:00Z");
  let m = moneyOf(lines, before, caps);
  assert.deepEqual(m.spent, { ok: true, day: 25, month: 50, dayLeft: 275, monthLeft: 950, running: 1 });
  const after = Date.parse("2026-11-30T18:31:00Z");
  m = moneyOf(lines, after, caps);
  assert.deepEqual(m.spent, { ok: true, day: 50, month: 50, dayLeft: 250, monthLeft: 950, running: 1 });
  m = moneyOf(lines, after, { daily: 40, monthly: 45 });
  assert.deepEqual([m.spent.dayLeft, m.spent.monthLeft], [0, 0], "never below 0");
  assert.equal(m.paused, null);
});

// The lines as readLedger gives them, through a temp file of the door's own shape.
function readLedgerLines(lines) {
  const dir = mkdtempSync(join(tmpdir(), "gen-lines-"));
  const p = join(dir, "l.jsonl");
  writeFileSync(p, `${lines.join("\n")}\n`, { mode: 0o600 });
  const r = readLedger(p);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.ok, true);
  return r.lines;
}

test("the view's money is the door's ledger: reserved, spent, released, refused and paused lines", async () => {
  await withGen(async ({ h }) => {
    const l = createLedger(h.config.paths.ledger);
    const now = Date.now();
    const at = iso(now - 2000);
    const reserve = (job, est, extra = {}) => l.reserve(at, { job, batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: est, ...extra });
    reserve("g1", 25);
    l.settle(at, l.job("g1"), { state: "spent", credits: 30, verdict: "done" });
    reserve("g2", 25);
    l.settle(at, l.job("g2"), { state: "released", credits: 0, verdict: "not_started_400" });
    reserve("g3", 25);
    l.settle(at, l.job("g3"), { state: "spent", credits: 25, verdict: "refused" });
    reserve("g4", 50, { seconds: 10 });
    l.reserve(iso(now - 40 * DAY), { job: "g5", batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25 });
    l.settle(iso(now - 40 * DAY), l.job("g5"), { state: "spent", credits: 25, verdict: "done" });
    const pausedAt = iso(now - 1000);
    l.pause(pausedAt, "three_refusals");

    const v = await view(h);
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    const t = totalsOf(readLedger(h.config.paths.ledger).lines, Date.now());
    assert.deepEqual([t.day, t.month], [105, 105], "the door's own totals");
    assert.deepEqual(v.spent, { ok: true, day: 105, month: 105, dayLeft: 195, monthLeft: 895, running: 1 });
    assert.deepEqual(v.paused, { at: pausedAt, sentence: PAUSED_SENTENCE });
    assert.equal(v.ledger.ok, true);
    assert.equal(v.ledger.bytes, statSync(h.config.paths.ledger).size);
    const lowered = await call(h.url, "POST", "/api/generation/caps", { body: { daily: 100 } });
    assert.deepEqual([lowered.json.spent.dayLeft, lowered.json.caps.daily], [0, 100], "over the cap: nothing left, never below 0");
  }, { door: false });
});

test("a ledger that cannot be read: nothing known, nothing left, the plain sentence, and the page says so", async () => {
  await withGen(async ({ h }) => {
    const good = jobLines("g1", Date.now() - 1000);
    for (const [label, write] of [
      ["others can write it", () => writeLedger(h.config, good, 0o666)],
      ["a torn last line", () => { writeLedger(h.config, good); writeFileSync(h.config.paths.ledger, `${good.join("\n")}\n{"at":"20`); }],
      ["a field of the wrong kind", () => writeLedger(h.config, [line({ at: iso(Date.now()), job: "g1", credits: -5 })])],
      ["a link", () => {
        const real = join(h.config.paths.doors, "elsewhere.jsonl");
        writeFileSync(real, `${good.join("\n")}\n`, { mode: 0o600 });
        rmSync(h.config.paths.ledger, { force: true });
        symlinkSync(real, h.config.paths.ledger);
      }],
    ]) {
      write();
      const v = await view(h);
      assert.deepEqual(sameShape(readShape("generation"), v), [], label);
      assert.deepEqual(v.spent, { ok: false, day: null, month: null, dayLeft: 0, monthLeft: 0, running: null }, label);
      assert.equal(v.ledger.ok, false, label);
      assert.equal(v.ledger.sentence, "The spending ledger cannot be read, so nothing will be made. Health shows what to do.", label);
      assert.deepEqual(v.batches, [], label);
      const p = await page(h);
      assert.deepEqual(p, { ok: false, sentence: LEDGER_SENTENCES.unreadable, days: [], more: false }, label);
    }
    assert.equal((await view(h)).ledger.bytes, 0, "a link is not the ledger's size");
  }, { door: false });
});

test("a ledger over 24 MB is nearly full, with the sentence that says how it is tidied", async () => {
  await withGen(async ({ h }) => {
    const lines = [];
    const old = Date.now() - 50 * DAY;
    let size = 0;
    for (let i = 0; size <= 24.2 * 1024 * 1024; i += 1) {
      for (const l of jobLines(`g${i}`, old + i, { runwayTask: "17f20503-6c24-4c16-946b-35dbbce2af2f" })) {
        lines.push(l);
        size += l.length + 1;
      }
    }
    writeLedger(h.config, lines);
    const v = await view(h);
    assert.equal(v.ledger.ok, true);
    assert.ok(v.ledger.bytes > 24 * 1024 * 1024);
    assert.equal(v.ledger.nearlyFull, true);
    assert.equal(v.ledger.sentence, "The spending ledger is nearly full. It is tidied when the engine starts: engine stop, then engine start.");
    assert.equal(v.spent.ok, true);
  }, { door: false });
});

// ---- the ledger's pages ----------------------------------------------------------------------------------------

test("the ledger pages by before: 14 days a page, newest first, each job in words with its result", async () => {
  await withGen(async ({ h }) => {
    const now = Date.now() - 5000;
    const ends = [
      { verdict: "done", result: "Made" }, { verdict: "refused", result: "Refused by Runway" }, { verdict: "failed", result: "Failed" },
      { verdict: "bad_input", result: "Runway could not use the picture" }, { verdict: "cancelled", result: "Cancelled" },
      { verdict: "unknown", result: "Unclear, counted as spent" }, { verdict: "stopped", result: "Stopped: over a limit" },
      { verdict: "not_started_401", end: "released", result: "Not started, nothing spent" }, { end: null, result: "Running, counted until it ends" },
    ];
    const kinds = [
      { kind: "image_to_video", seconds: 5, model: "gen4_turbo", words: "Clip, 5 s" },
      { kind: "text_to_video", seconds: 10, model: "gen4.5", words: "Clip from words, 10 s" },
      { kind: "still_variation", seconds: null, model: "gen4_image", words: "Variation" },
      { kind: "still_upscale", seconds: null, model: "magnific_precision_upscaler_v2", words: "Larger still" },
    ];
    const lines = [];
    const expect = new Map();
    for (let k = 0; k < 20; k += 1) {
      const e = ends[k % ends.length];
      const kd = kinds[k % kinds.length];
      lines.push(...jobLines(`g${k}`, now - k * DAY, { end: e.end === undefined ? "spent" : e.end, verdict: e.verdict ?? null, kind: kd.kind, seconds: kd.seconds, model: kd.model }));
      expect.set(dayOf(now - k * DAY), { ...e, ...kd });
    }
    writeLedger(h.config, lines);
    const p1 = await page(h);
    assert.equal(p1.ok, true);
    assert.equal(p1.days.length, 14);
    assert.equal(p1.more, true);
    assert.equal(p1.days[0].day, dayOf(now));
    for (let i = 1; i < p1.days.length; i += 1) assert.ok(p1.days[i - 1].day > p1.days[i].day, "newest first");
    const p2 = await page(h, p1.days[13].day);
    assert.equal(p2.days.length, 6);
    assert.equal(p2.more, false);
    assert.ok(p2.days[0].day < p1.days[13].day);
    const all = [...p1.days, ...p2.days];
    assert.equal(new Set(all.map((d) => d.day)).size, 20);
    for (const d of all) {
      const e = expect.get(d.day);
      assert.equal(d.jobs, 1);
      assert.equal(d.rows.length, 1);
      const row = d.rows[0];
      assert.deepEqual(Object.keys(row), ["at", "kind", "words", "model", "seconds", "credits", "result", "shot", "task"]);
      assert.equal(row.result, e.result, d.day);
      assert.equal(row.words, e.words, d.day);
      assert.equal(row.model, e.model);
      assert.equal(row.seconds, e.seconds);
      assert.equal(row.credits, e.end === "released" ? 0 : 25);
      assert.equal(d.credits, row.credits);
      assert.equal(d.refused, e.verdict === "refused" ? 1 : 0);
      assert.equal(row.task, null, "a job of batch null has no task");
    }
  }, { door: false });
});

test("a day lists at most 200 jobs, newest first, and its totals count every job", async () => {
  await withGen(async ({ h }) => {
    const now = Date.now() - 1000;
    const lines = [];
    for (let i = 0; i < 205; i += 1) lines.push(...jobLines(`g${i}`, now - 205 + i, { credits: 25 }));
    writeLedger(h.config, lines);
    const p = await page(h);
    assert.equal(p.days.length, 1);
    const d = p.days[0];
    assert.deepEqual([d.jobs, d.credits, d.rows.length], [205, 205 * 25, 200]);
    assert.equal(d.rows[0].at, iso(now - 1));
    for (let i = 1; i < d.rows.length; i += 1) assert.ok(d.rows[i - 1].at > d.rows[i].at);
  }, { door: false });
});

test("a before that is not a day is refused; an empty ledger is an empty page", async () => {
  await withGen(async ({ h }) => {
    for (const bad of ["yesterday", "2026-13-01", "2026-02-30", "2026-11-1", "2026-11-12T00:00:00Z", ""]) {
      const r = await call(h.url, "GET", `/api/generation/ledger?before=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400, bad);
      assert.equal(r.json.error.code, "bad_before");
    }
    assert.deepEqual(await page(h), { ok: true, sentence: null, days: [], more: false });
    assert.deepEqual(await page(h, "2026-11-12"), { ok: true, sentence: null, days: [], more: false });
  }, { door: false });
});

test("a job's task is its batch's goal as the board names it; none for no batch, a batch file gone, or a goal the board lacks", async () => {
  await withGen(async ({ h }) => {
    const known = batchId();
    const unknownGoal = batchId();
    const gone = batchId();
    writeBatch(h.config, known, { task: STH1 });
    writeBatch(h.config, unknownGoal, { task: "e0000000-0000-4000-8000-00000000ffff" });
    const now = Date.now() - 1000;
    writeLedger(h.config, [
      ...jobLines("g1", now - 4, { batch: known, shot: "s01" }),
      ...jobLines("g2", now - 3, { batch: unknownGoal, shot: "s01" }),
      ...jobLines("g3", now - 2, { batch: gone, shot: "s02" }),
      ...jobLines("g4", now - 1),
    ]);
    const rows = (await page(h)).days[0].rows;
    assert.deepEqual(rows.map((r) => r.task), [null, null, null, { id: STH1, identifier: "STH-1" }]);
    assert.deepEqual(rows.map((r) => r.shot), [null, "s02", "s01", "s01"]);
  }, { door: false });
});

test("values from a door file stay plain capped text in the page and the view", async () => {
  await withGen(async ({ h }) => {
    const b = batchId();
    writeBatch(h.config, b, { task: STH2 });
    const issue = h.board.state.issues.find((i) => i.id === STH2);
    issue.title = `<img src=x onerror=alert(1)>\u0007 Plan\u202e it${"x".repeat(300)}`;
    writeLedger(h.config, jobLines("g1", Date.now() - 1000, { shot: `<b>s01</b>\u0000\u202e${"y".repeat(100)}`, model: "gen4_turbo\u0007", batch: b }));
    const row = (await page(h)).days[0].rows[0];
    assert.equal(row.shot, `<b>s01</b>${"y".repeat(100)}`.slice(0, 32));
    assert.equal(row.model, "gen4_turbo");
    assert.deepEqual(row.task, { id: STH2, identifier: "STH-2" });
    const v = await view(h);
    assert.equal(v.batches[0].task.title, `<img src=x onerror=alert(1)> Plan it${"x".repeat(300)}`.slice(0, 200));
    assert.equal(v.batches[0].task.title.length, 200);
  }, { door: false });
});

// ---- the owner's batches ----------------------------------------------------------------------------------------

test("batches: the newest 20 by approval, kept 30 days past expiry, spent from the ledger, the task from the board", async () => {
  await withGen(async ({ h }) => {
    const now = Date.now();
    const ids = [];
    for (let i = 0; i < 22; i += 1) {
      const id = batchId();
      ids.push(id);
      writeBatch(h.config, id, { approvedAt: iso(now - (i + 1) * 3600_000), expiresAt: iso(now - (i + 1) * 3600_000 + 7 * DAY) });
    }
    const lapsed = batchId();
    writeBatch(h.config, lapsed, { approvedAt: iso(now - 36 * DAY), expiresAt: iso(now - 29 * DAY), task: STH2, budgetCredits: 50 });
    const gone = batchId();
    writeBatch(h.config, gone, { approvedAt: iso(now - 38 * DAY), expiresAt: iso(now - 31 * DAY) });
    const noTask = batchId();
    writeBatch(h.config, noTask, { approvedAt: iso(now - 30 * 60_000), task: undefined });
    writeLedger(h.config, [
      ...jobLines("g1", now - 5000, { batch: ids[0], shot: "s01", credits: 25 }),
      ...jobLines("g2", now - 4000, { batch: ids[0], shot: "s01", end: "released", verdict: "not_started_400" }),
      ...jobLines("g3", now - 3000, { batch: ids[0], shot: "s02", end: null, estimate: 50, credits: 50 }),
      ...jobLines("g4", now - 2000, { batch: lapsed, shot: "s01", credits: 30 }),
    ]);
    const v = await view(h);
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    assert.equal(v.batches.length, 20);
    assert.equal(v.batches[0].id, noTask, "newest approval first");
    assert.equal(v.batches[0].task, null, "a batch that names no goal");
    assert.deepEqual(v.batches.slice(1).map((b) => b.id), ids.slice(0, 19));
    const first = v.batches[1];
    assert.deepEqual(first.task, { id: STH1, identifier: "STH-1", title: "Write the price list" });
    assert.deepEqual([first.budget, first.spent, first.shots, first.open], [300, 75, 2, true]);
    assert.equal(first.approvedAt, iso(now - 3600_000));
    assert.ok(!v.batches.some((b) => b.id === gone || b.id === lapsed), "only the newest 20");

    // With fewer batches, one 29 days past its expiry is listed, closed; one 31 days past it is not.
    for (const id of [...ids, noTask]) rmSync(join(h.config.paths.batches, `${id}.json`));
    const left = (await view(h)).batches;
    assert.deepEqual(left.map((b) => b.id), [lapsed]);
    assert.deepEqual([left[0].open, left[0].spent, left[0].task.identifier], [false, 30, "STH-2"]);
  }, { door: false });
});

test("a batch file that is a link, 20 KB, others' to write, of another shape, or in a folder that is a link is left out", async () => {
  await withGen(async ({ h }) => {
    const good = batchId();
    writeBatch(h.config, good);
    const dir = h.config.paths.batches;
    const linked = batchId();
    const real = writeBatch(h.config, batchId());
    symlinkSync(real, join(dir, `${linked}.json`));
    const big = batchId();
    writeBatch(h.config, big, { padding: "x".repeat(20 * 1024) });
    const loose = batchId();
    writeBatch(h.config, loose, {}, 0o666);
    const shapes = [
      { id: "someone-else" }, { approvedAt: "yesterday" }, { budgetCredits: -1 }, { budgetCredits: "300" }, { textToVideo: "yes" },
      { frozen: 1 }, { shots: [] }, { shots: { "s 01": { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 } } },
      { shots: { s01: { kind: "video_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 } } },
      { shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 11, takes: 2 } } },
      { shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 6 } } },
      { expiresAt: new Date(Date.now() + 9 * DAY).toISOString() }, { slug: 7 },
    ];
    const odd = shapes.map((fields) => {
      const id = batchId();
      writeBatch(h.config, id, fields);
      // The door's own reader refuses the same file (at a time inside its dates).
      assert.equal(readBatch(dir, id, { slug: "artist", now: Date.now() }).ok, false, JSON.stringify(fields));
      assert.equal(readBatchFile(dir, id), null, JSON.stringify(fields));
      return id;
    });
    assert.equal(readBatch(dir, good, { slug: "artist", now: Date.now() }).ok, true);
    let v = await view(h);
    const listed = v.batches.map((b) => b.id).sort();
    assert.ok(listed.includes(good));
    for (const id of [linked, big, loose, ...odd]) assert.ok(!listed.includes(id), id);

    // The whole folder as a link: nothing is listed.
    const moved = `${dir}-real`;
    renameSync(dir, moved);
    symlinkSync(moved, dir);
    v = await view(h);
    assert.deepEqual(v.batches, []);
  }, { door: false });
});

// ---- words ------------------------------------------------------------------------------------------------------

test("words: dollars, a job's kind, and a result for every verdict the door writes", () => {
  assert.deepEqual([dollars(150), dollars(0), dollars(5), dollars(300), dollars(100000)], ["$1.50", "$0.00", "$0.05", "$3.00", "$1000.00"]);
  assert.deepEqual([kindWords("image_to_video", 5), kindWords("text_to_video", 10), kindWords("still_variation", null), kindWords("still_upscale", null)],
    ["Clip, 5 s", "Clip from words, 10 s", "Variation", "Larger still"]);
  const ended = (verdict, state = "spent") => ({ end: { state, credits: 1, verdict, at: 0 } });
  for (const [verdict, words] of Object.entries(RESULT_WORDS)) assert.equal(resultWords(ended(verdict)), words);
  assert.equal(resultWords(ended("not_started_400", "released")), NOT_STARTED_WORDS);
  assert.equal(resultWords(ended("not_started_429", "released")), "Not started, nothing spent");
  assert.equal(resultWords({ end: null }), RUNNING_WORDS);
  assert.equal(RUNNING_WORDS, "Running, counted until it ends");
  assert.equal(resultWords(ended("something_new")), "Unclear, counted as spent", "an unknown verdict that spent is never called free");
  assert.equal(resultWords(ended("something_new", "released")), "Not started, nothing spent");
});
