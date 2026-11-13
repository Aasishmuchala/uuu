// PLAN-V5 T41b, lib/batches.mjs: the owner's approved batch, the one file that lets the generation door spend
// (K13, C10). Its budget is the door's prices times the takes, never a number from a file; it is written whole into
// a private folder that is not a link and read back with the door's own readBatch. Temp folders and made-up values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLine } from "../../../generate/ledger.mjs";
import { readBatch } from "../../../generate/state.mjs";
import { BATCH_ID, generationNow, KEEP_DAYS, newBatchId, removeBatch, writeBatch } from "../lib/batches.mjs";
import { saveDoorKey, updateDoors } from "../lib/doors.mjs";
import { HomeError } from "../lib/errors.mjs";

const TASK = "e0000000-0000-4000-8000-000000000026";
const DAY = 24 * 3600_000;
const FILM_SHOTS = [
  { id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5 },
  { id: "s02", kind: "image_to_video", model: "gen4.5", seconds: 5 },
  { id: "s03", kind: "image_to_video", model: "gen4_turbo", seconds: 10 },
];

function withState(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-batches-"));
  try {
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    const s = (...p) => join(state, ...p);
    const config = {
      paths: {
        state, doors: s("doors"), batches: s("doors", "batches"), doorsState: s("doors", "state.json"), ledger: s("doors", "generate-ledger.jsonl"),
        secrets: s("secrets"), doorSecrets: s("secrets", "doors"), runwayKey: s("secrets", "doors", "runway-key"), searchKey: s("secrets", "doors", "search-key"),
      },
    };
    return fn({ config, root, state });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const files = (config) => (existsSync(config.paths.batches) ? readdirSync(config.paths.batches) : []);

test("newBatchId: b and 20 hex characters, a new one each time", () => {
  const a = newBatchId();
  assert.match(a, /^b[0-9a-f]{20}$/);
  assert.match(a, BATCH_ID);
  assert.notEqual(a, newBatchId());
});

test("writeBatch: K13's shape plus the task, budget the door's prices times two takes, read back by the door's own readBatch", () => {
  withState(({ config }) => {
    const now = Date.parse("2026-11-13T10:00:00Z");
    const out = writeBatch(config, { task: TASK, slug: "artist", shots: FILM_SHOTS, takes: 2, textToVideo: false, now });
    assert.match(out.id, BATCH_ID);
    assert.equal(out.budget, 2 * (25 + 60 + 50));
    assert.equal(out.expiresAt, "2026-11-20T10:00:00.000Z");
    const file = join(config.paths.batches, `${out.id}.json`);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(doc, {
      id: out.id, task: TASK, slug: "artist", approvedAt: "2026-11-13T10:00:00.000Z", expiresAt: "2026-11-20T10:00:00.000Z",
      budgetCredits: 270, textToVideo: false,
      shots: {
        s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 },
        s02: { kind: "image_to_video", model: "gen4.5", maxSeconds: 5, takes: 2 },
        s03: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 10, takes: 2 },
      },
    });
    assert.ok(!("frozen" in doc));
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(config.paths.batches).mode & 0o777, 0o700);
    const back = readBatch(config.paths.batches, out.id, { slug: "artist", now: now + 3600_000 });
    assert.equal(back.ok, true, back.why);
    assert.equal(back.batch.budgetCredits, 270);
    assert.deepEqual(Object.keys(back.batch.shots), ["s01", "s02", "s03"]);
    assert.equal(readBatch(config.paths.batches, out.id, { slug: "builder", now }).why, "other_agent");
    assert.equal(readBatch(config.paths.batches, out.id, { slug: "artist", now: now + 8 * DAY }).why, "expired");
    assert.deepEqual(files(config), [`${out.id}.json`], "no temp file is left");
  });
});

test("writeBatch: a still job's one take, a given id, words alone only when allowed", () => {
  withState(({ config }) => {
    const id = newBatchId();
    const still = writeBatch(config, { id, task: TASK, shots: [{ id: "v1", kind: "still_variation", model: "gen4_image" }, { id: "v2", kind: "still_variation", model: "gen4_image" }], takes: 1, now: Date.now() });
    assert.equal(still.id, id);
    assert.equal(still.budget, 16);
    const doc = JSON.parse(readFileSync(join(config.paths.batches, `${id}.json`), "utf8"));
    assert.deepEqual(doc.shots.v1, { kind: "still_variation", model: "gen4_image", takes: 1 });
    assert.equal(readBatch(config.paths.batches, id, { slug: "artist", now: Date.now() }).ok, true);
    // The same id twice is refused; nothing is replaced.
    assert.throws(() => writeBatch(config, { id, task: TASK, shots: FILM_SHOTS, takes: 2 }), (e) => e instanceof HomeError && e.code === "batch_exists");
    assert.equal(JSON.parse(readFileSync(join(config.paths.batches, `${id}.json`), "utf8")).budgetCredits, 16);
    const words = [{ id: "s01", kind: "text_to_video", model: "gen4.5", seconds: 5 }];
    assert.throws(() => writeBatch(config, { task: TASK, shots: words, takes: 2, textToVideo: false }));
    const ok = writeBatch(config, { task: TASK, shots: words, takes: 2, textToVideo: true });
    assert.equal(ok.budget, 120);
    assert.equal(readBatch(config.paths.batches, ok.id, { slug: "artist", now: Date.now() }).batch.textToVideo, true);
  });
});

test("writeBatch: no price, a bad shot, a bad id or task, takes out of range: refused, nothing written", () => {
  withState(({ config }) => {
    const bad = [
      { shots: [{ id: "s01", kind: "image_to_video", model: "gen9_dream", seconds: 5 }], takes: 2 },
      { shots: [{ id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 11 }], takes: 2 },
      { shots: [{ id: "s01", kind: "text_to_video", model: "gen4_turbo", seconds: 5 }], takes: 2, textToVideo: true },
      { shots: [{ id: "__proto__", kind: "image_to_video", model: "gen4_turbo", seconds: 5 }], takes: 2 },
      { shots: [{ id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5 }, { id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5 }], takes: 2 },
      { shots: [{ id: "s01", kind: "video_to_video", model: "gen4_turbo", seconds: 5 }], takes: 2 },
      { shots: [], takes: 2 },
      { shots: FILM_SHOTS, takes: 0 },
      { shots: FILM_SHOTS, takes: 6 },
      { shots: FILM_SHOTS, takes: 2, id: "b123" },
      { shots: FILM_SHOTS, takes: 2, task: "../x" },
      { shots: FILM_SHOTS, takes: 2, slug: "../artist" },
    ];
    for (const b of bad) {
      assert.throws(() => writeBatch(config, { task: TASK, ...b }), JSON.stringify(b));
    }
    assert.deepEqual(files(config), []);
    try { writeBatch(config, { task: TASK, ...bad[0] }); } catch (e) { assert.equal(e.code, "no_price"); assert.equal(e.status, 409); }
  });
});

test("writeBatch: the batches folder as a link, a file, or the doors folder as a link: folder_unsafe, nothing written", () => {
  withState(({ config, root }) => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(config.paths.doors, { mode: 0o700 });
    symlinkSync(elsewhere, config.paths.batches);
    const unsafe = (e) => e instanceof HomeError && e.status === 409 && e.code === "folder_unsafe";
    assert.throws(() => writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2 }), unsafe);
    assert.deepEqual(readdirSync(elsewhere), []);
    unlinkSync(config.paths.batches);
    writeFileSync(config.paths.batches, "x");
    assert.throws(() => writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2 }), unsafe);
    rmSync(config.paths.batches);
    rmSync(config.paths.doors, { recursive: true });
    symlinkSync(elsewhere, config.paths.doors);
    assert.throws(() => writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2 }), unsafe);
    assert.deepEqual(readdirSync(elsewhere), []);
  });
});

test("writeBatch: a folder open to others is made private again before the door would refuse it", () => {
  withState(({ config }) => {
    mkdirSync(config.paths.batches, { recursive: true });
    chmodSync(config.paths.batches, 0o777);
    const out = writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2 });
    assert.equal(statSync(config.paths.batches).mode & 0o777, 0o700);
    assert.equal(readBatch(config.paths.batches, out.id, { slug: "artist", now: Date.now() }).ok, true);
  });
});

test("each write removes batch files more than 30 days past their expiry, and nothing else", () => {
  withState(({ config }) => {
    const now = Date.now();
    const old = writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2, now: now - (KEEP_DAYS + 8) * DAY });
    const recent = writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2, now: now - 20 * DAY });
    writeFileSync(join(config.paths.batches, "notes.json"), JSON.stringify({ expiresAt: "2000-01-01T00:00:00Z" }), { mode: 0o600 });
    writeFileSync(join(config.paths.batches, `b${"f".repeat(20)}.json`), "not json", { mode: 0o600 });
    const fresh = writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2, now });
    const names = files(config).sort();
    assert.ok(!names.includes(`${old.id}.json`), "the old one is gone");
    assert.ok(names.includes(`${recent.id}.json`), "expired 13 days ago: kept");
    assert.ok(names.includes(`${fresh.id}.json`));
    assert.ok(names.includes("notes.json") && names.includes(`b${"f".repeat(20)}.json`), "files not of the home server's own form are left alone");
  });
});

test("removeBatch removes one file of the home server's own form and nothing else", () => {
  withState(({ config }) => {
    const out = writeBatch(config, { task: TASK, shots: FILM_SHOTS, takes: 2 });
    assert.equal(removeBatch(config, "../state"), false);
    assert.equal(removeBatch(config, out.id), true);
    assert.equal(removeBatch(config, out.id), false);
    assert.deepEqual(files(config), []);
  });
});

test("generationNow: off with no file; on with a key; caps, models and what the door's ledger says was spent; an unreadable ledger says null", () => {
  withState(({ config }) => {
    const off = generationNow(config);
    assert.deepEqual([off.on, off.key, off.daily, off.monthly, off.ledgerOk, off.spentDay, off.dayLeft], [false, false, 300, 1000, true, 0, 300]);
    updateDoors(config, (s) => { s.generate.on = true; s.generate.dailyCredits = 200; });
    saveDoorKey(config, "runway", `key_${"0a1b2c3d".repeat(16)}`);
    const now = Date.now();
    const line = (fields) => ({ at: new Date(now).toISOString(), job: "j1", batch: null, shot: null, slug: "artist", kind: "still_variation",
      model: "gen4_image", seconds: null, estimate: 8, state: "reserved", credits: 8, runwayTask: null, verdict: null, ...fields });
    appendLine(config.paths.ledger, line({}));
    appendLine(config.paths.ledger, line({ state: "spent", credits: 40, verdict: "done" }));
    appendLine(config.paths.ledger, line({ job: "j2", credits: 30 }));      // still running: counted
    const g = generationNow(config, now);
    assert.deepEqual([g.on, g.key, g.daily, g.spentDay, g.dayLeft, g.spentMonth, g.monthLeft], [true, true, 200, 70, 130, 70, 930]);
    assert.deepEqual(g.models, { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" });
    assert.ok(!JSON.stringify(g).includes("key_"), "the key is never read");
    writeFileSync(config.paths.ledger, "{torn", { flag: "a" });
    const torn = generationNow(config, now);
    assert.deepEqual([torn.ledgerOk, torn.spentDay, torn.dayLeft, torn.monthLeft], [false, null, null, null]);
    writeFileSync(config.paths.doorsState, "not json", { mode: 0o600 });
    assert.equal(generationNow(config, now).on, false, "a switches file that cannot be used is off");
  });
});
