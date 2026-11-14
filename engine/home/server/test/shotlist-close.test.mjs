// T48 F4 (T49b), lib/batches.mjs closeBatches and closeFinishedBatches: the owner's yes taken back when its film or
// still job ends sooner than the batch's seven days. A closed batch is written again whole with `expiresAt` now, so
// the generation door's own readBatch answers "expired", while the file stays for Studio and Settings. Closed when
// the owner stops the task (lib/stop.mjs, before anything is sent to the board), accepts it (inbox/goals.mjs), when
// the board shows it cancelled (the minute sweep, lib/unstick.mjs onIssues, wired in lib/app.mjs), and when a newer
// approval replaces it (inbox/staged.mjs; shotlist-card.test.mjs). A task the board shows done keeps its batch (T49f
// N1): the owner may send a finished film back for a retake inside it. Temp folders, stub boards, made-up ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { readBatch } from "../../../generate/state.mjs";
import goalsSource from "../inbox/goals.mjs";
import { closeBatches, closeFinishedBatches, writeBatch } from "../lib/batches.mjs";
import { HomeError } from "../lib/errors.mjs";
import { readBatchFile } from "../lib/generation.mjs";
import { stopTask } from "../lib/stop.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { createUnstick } from "../lib/unstick.mjs";

const I = IDS.issues;
const FILM = "e0000000-0000-4000-8000-000000000026";
const OTHER = "e0000000-0000-4000-8000-000000000027";
const HOUR = 3600_000;
const SHOTS = [{ id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5 }];
const STILL = [{ id: "v1", kind: "still_variation", model: "gen4_image" }];

function withState(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-close-"));
  try {
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    const config = { paths: { state, doors: join(state, "doors"), batches: join(state, "doors", "batches") } };
    return fn({ config });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The same, for a body that awaits: the folder is removed only once it has finished.
async function withStateAsync(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-close-"));
  try {
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    const config = { paths: { state, doors: join(state, "doors"), batches: join(state, "doors", "batches") } };
    return await fn({ config });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fileOf = (config, id) => join(config.paths.batches, `${id}.json`);
const docOf = (config, id) => JSON.parse(readFileSync(fileOf(config, id), "utf8"));
const doorSays = (config, id, now = Date.now()) => {
  const r = readBatch(config.paths.batches, id, { slug: "artist", now });
  return r.ok ? "open" : r.why;
};
const film = (config, task, now = Date.now() - HOUR) => writeBatch(config, { task, shots: SHOTS, takes: 2, now }).id;

// ---- closing itself

test("closeBatches closes every open batch of the tasks named but the one kept: the door says expired, the file stays", () => {
  withState(({ config }) => {
    const a = film(config, FILM);
    const b = film(config, FILM);
    const other = film(config, OTHER);
    const still = writeBatch(config, { task: FILM, shots: STILL, takes: 1, now: Date.now() - HOUR }).id;
    const old = film(config, FILM, Date.now() - 8 * 24 * HOUR);          // ran out a day ago
    const oldBytes = readFileSync(fileOf(config, old), "utf8");
    const before = docOf(config, a);
    const now = Date.now();
    const log = [];
    assert.deepEqual(closeBatches(config, [FILM], { keep: b, now, log: (l) => log.push(l) }).sort(), [a, still].sort());
    assert.equal(doorSays(config, a), "expired");
    assert.equal(doorSays(config, still), "expired");
    assert.equal(doorSays(config, b), "open", "the batch kept");
    assert.equal(doorSays(config, other), "open", "another task's batch");
    assert.equal(readFileSync(fileOf(config, old), "utf8"), oldBytes, "one that had already ended is left as it is");
    // Written again whole: the approval as it was, its end now, and when it was closed; still this user's 0600 file.
    const after = docOf(config, a);
    assert.deepEqual(after, { ...before, expiresAt: new Date(now).toISOString(), closedAt: new Date(now).toISOString() });
    assert.equal(statSync(fileOf(config, a)).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(config.paths.batches).filter((n) => n.startsWith(".")), [], "no temp file left");
    // Studio and Settings still read it, as closed.
    const kept = readBatchFile(config.paths.batches, a);
    assert.equal(kept.expiresAt, now);
    assert.equal(kept.task, FILM);
    assert.equal(log.filter((l) => /^batches: closed b[0-9a-f]{20}:/.test(l)).length, 2, log.join("\n"));
    // Once closed, closing again does nothing.
    assert.deepEqual(closeBatches(config, [FILM], { now: now + 1000 }), [b]);
    assert.deepEqual(closeBatches(config, [FILM], { now: now + 2000 }), []);
  });
});

test("closeBatches: a clock set back is removed, not left open; files the door refuses anyway are left; bad arguments close nothing", () => {
  withState(({ config }) => {
    const ahead = film(config, FILM, Date.now() + 10 * 60_000);          // approved "later" than the close
    const now = Date.now();
    assert.deepEqual(closeBatches(config, [FILM], { now }), [ahead]);
    assert.equal(existsSync(fileOf(config, ahead)), false, "it cannot end before it began, so it goes");
    // A file the trust rule refuses, a file that is not JSON, a name not of the home server's form: left as they are.
    const loose = film(config, FILM);
    chmodSync(fileOf(config, loose), 0o666);
    writeFileSync(fileOf(config, "b0000000000000000000a"), "{torn", { mode: 0o600 });
    writeFileSync(join(config.paths.batches, "notes.json"), JSON.stringify({ task: FILM }), { mode: 0o600 });
    assert.deepEqual(closeBatches(config, [FILM], { now }), []);
    assert.equal(doorSays(config, loose), "untrusted", "the door refuses it too");
    // Nothing to close, or nothing to close with.
    const open = film(config, OTHER);
    for (const tasks of [[], null, "e0000000-0000-4000-8000-000000000027", [5], ["../x"]]) assert.deepEqual(closeBatches(config, tasks, { now }), []);
    assert.deepEqual(closeBatches({}, [OTHER], { now }), []);
    assert.deepEqual(closeBatches(null, [OTHER], { now }), []);
    assert.deepEqual(closeBatches({ paths: { batches: join(config.paths.state, "nowhere") } }, [OTHER], { now }), []);
    assert.equal(doorSays(config, open), "open");
  });
});

test("closeFinishedBatches closes the batches of tasks the board shows cancelled, and no others: done alone leaves it open", () => {
  withState(({ config }) => {
    const ids = { done: "e0000000-0000-4000-8000-0000000000d1", cancelled: "e0000000-0000-4000-8000-0000000000d2", blocked: "e0000000-0000-4000-8000-0000000000d3", todo: "e0000000-0000-4000-8000-0000000000d4" };
    const batch = Object.fromEntries(Object.entries(ids).map(([status, task]) => [status, film(config, task)]));
    const missing = film(config, "e0000000-0000-4000-8000-0000000000d5");
    const issues = Object.entries(ids).map(([status, id]) => ({ id, status }));
    assert.deepEqual(closeFinishedBatches(config, [...issues, null, { status: "done" }]), [batch.cancelled]);
    assert.deepEqual(Object.fromEntries(Object.entries(batch).map(([s, id]) => [s, doorSays(config, id)])),
      { done: "open", cancelled: "expired", blocked: "open", todo: "open" });
    assert.equal(doorSays(config, missing), "open", "a task the board does not list is left: the list may be cut");
    assert.deepEqual(closeFinishedBatches(config, null), []);
  });
});

// ---- Stop: the money first

test("stopTask closes the goal's batches and its steps' before it asks the board, so even a stop the board refuses spends nothing more", async () => {
  await withStateAsync(async ({ config }) => {
    const goal = film(config, "G0000000-0000-4000-8000-000000000001");
    const step = writeBatch(config, { task: "S0000000-0000-4000-8000-000000000001", shots: STILL, takes: 1, now: Date.now() - HOUR }).id;
    const other = film(config, OTHER);
    const issues = [
      { id: "G0000000-0000-4000-8000-000000000001", status: "in_progress" },
      { id: "S0000000-0000-4000-8000-000000000001", parentId: "G0000000-0000-4000-8000-000000000001", status: "todo", createdByAgentId: "a" },
    ];
    const seen = [];
    const board = { async get() { throw new Error("not read"); }, async patch(path) { seen.push([path, doorSays(config, goal), doorSays(config, step)]); throw new HomeError(409, "no", "no", "conflict"); } };
    await assert.rejects(stopTask({ config, board, log() {}, ids: () => ({}) }, "G0000000-0000-4000-8000-000000000001", { issues }), (e) => e.status === 409);
    assert.deepEqual(seen, [["/api/issues/G0000000-0000-4000-8000-000000000001", "expired", "expired"]], "closed before the board was asked");
    assert.equal(doorSays(config, other), "open");
  });
});

test("Stop on the Tasks page closes the goal's batches and its steps', and leaves another task's open", async () => {
  const h = await startV2({ routes: ["goals"], boardSeed: boardSeed() });
  try {
    const goal = film(h.config, I["STH-1"]);
    const step = film(h.config, I["STH-4"]);
    const other = film(h.config, I["STH-3"]);
    const r = await call(h.url, "POST", `/api/goals/${I["STH-1"]}/stop`, { body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(h.board.state.issues.find((i) => i.id === I["STH-1"]).status, "cancelled");
    assert.deepEqual([goal, step, other].map((id) => doorSays(h.config, id)), ["expired", "expired", "open"]);
    assert.deepEqual([goal, step, other].map((id) => doorSays(h.config, id, Date.now() + 6 * 24 * HOUR)), ["expired", "expired", "open"], "not good for the rest of the seven days");
  } finally { await h.close(); }
});

// ---- Accept

test("Accept on a finished task closes its batches; Send back does not", async () => {
  await withStateAsync(async ({ config }) => {
    const data = {};
    const decisions = { get: (k) => (k in data ? data[k] : null), set: (k, v) => { data[k] = v; return v; } };
    const ctxOf = (goalId) => {
      const item = { id: `goal:${goalId}`, kind: "result" };
      Object.defineProperty(item, "_goalId", { value: goalId });
      return { config, decisions, item, log() {}, board: { post: async () => ({}), patch: async () => ({}) }, fail: (s, m, n, c) => new HomeError(s, m, n, c) };
    };
    const accepted = film(config, FILM);
    const sentBack = film(config, OTHER);
    assert.equal((await goalsSource.act(ctxOf(FILM), `goal:${FILM}`, "acknowledge", null)).message, "Accepted.");
    await goalsSource.act(ctxOf(OTHER), `goal:${OTHER}`, "reopen", "One more take of the door, please.");
    assert.equal(doorSays(config, accepted), "expired");
    assert.equal(doorSays(config, sentBack), "open", "sent back: the work goes on inside what was approved");
  });
});

// ---- the minute sweep

test("the hold sweep hands the board's whole list to onIssues once a sweep; a failure there is logged and the sweep goes on", async () => {
  const list = [{ id: "e1", status: "done", parentId: null, projectId: "p1" }];
  const asked = [];
  const board = { async get(path) { asked.push(path); if (path.includes("/issues?")) return list; return { execution: null }; } };
  const got = [];
  const log = [];
  const u = createUnstick({ board, ids: () => ({ companyId: "c1", projectId: "p1" }), log: (l) => log.push(l), onIssues: (issues) => got.push(issues) });
  await u.sweep();
  assert.deepEqual(got, [list]);
  const v = createUnstick({ board, ids: () => ({ companyId: "c1", projectId: "p1" }), log: (l) => log.push(l), onIssues: () => { throw new Error("broken"); } });
  await v.sweep();
  assert.ok(log.some((l) => /^unstick: the after-sweep step failed: broken$/.test(l)), log.join("\n"));
  // The board not answering: no list, so nothing is closed and nothing is called.
  const w = createUnstick({ board: { async get() { throw new HomeError(502, "off", "off", "board_off"); } }, ids: () => ({ companyId: "c1", projectId: "p1" }), onIssues: () => got.push("called") });
  await w.sweep();
  assert.equal(got.length, 1);
});

test("the home server's own sweep closes the batches of a task the board shows cancelled, whoever cancelled it; done alone leaves it open", async () => {
  const h = await startV2({ routes: [], boardSeed: boardSeed() });
  try {
    const done = film(h.config, I["STH-2"]);                  // done on the board
    const working = film(h.config, I["STH-1"]);
    const blocked = film(h.config, I["STH-3"]);
    const still = writeBatch(h.config, { task: I["STH-3"], shots: STILL, takes: 1, now: Date.now() - HOUR }).id;
    await h.app.home.unstick.sweep();
    assert.deepEqual([done, working, blocked, still].map((id) => doorSays(h.config, id)), ["open", "open", "open", "open"]);
    // Someone on the board cancels the still job's task: the next sweep closes its batch.
    h.board.state.issues.find((i) => i.id === I["STH-3"]).status = "cancelled";
    await h.app.home.unstick.sweep();
    assert.deepEqual([done, working, blocked, still].map((id) => doorSays(h.config, id)), ["open", "open", "expired", "expired"]);
  } finally { await h.close(); }
});
