// PLAN-V5 T41c, routes/films.mjs: a film's shots for Studio (K14 steps 4 and 5, C11, C12), through a stub home on a
// stub board and a temp state. The ledger lines are written with the generation door's own appendLine, its job
// records and kept inputs with its own workStore, the batches with the home server's own writeBatch. Money and takes
// come from the ledger only; the picture sent from the door's own kept copy, for a day; clips, stills and boards
// from the Artist's files by exact names, never through a link; verdicts from the Art director's comments only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { REFUSALS_TO_FREEZE } from "../../../generate/door.mjs";
import { appendLine } from "../../../generate/ledger.mjs";
import { workStore } from "../../../generate/state.mjs";
import { writeBatch } from "../lib/batches.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { shotsHash } from "../lib/shotlist.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { FREEZE_AT, FROZEN } from "../routes/films.mjs";

const JOB = "studio/a-film-from-your-renders";
const GOAL = "e0000000-0000-4000-8000-000000000041";
const OTHER = "e0000000-0000-4000-8000-000000000042";
const STEP = "e0000000-0000-4000-8000-000000000141";
const KEY = "STH-41";
const KEY2 = "STH-42";
const AD = "aaaaaaaa-0000-4000-8000-0000000000ad";
const ARTIST = IDS_V2.agents.artist || "aaaaaaaa-0000-4000-8000-0000000000a1";
const B1 = `b${"1".repeat(20)}`;
const B2 = `b${"2".repeat(20)}`;
const B3 = `b${"3".repeat(20)}`;
const HOUR = 3600_000;
const NOW = Date.now();
const T1 = NOW - 48 * HOUR;          // the first approval: two days ago
const T2 = NOW - 2 * HOUR;           // the second, after the first batch froze
const at = (ms) => new Date(ms).toISOString();

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(52)]);
// A picture the door's own reader takes: a PNG header with its size, 600 bytes in all.
function inputPng(seed) {
  const b = Buffer.alloc(600, seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(1280, 16);
  b.writeUInt32BE(720, 20);
  return b;
}

const shot = (n, extra = {}) => ({
  id: `s0${n}`, render: n === 2 ? "lobby.png" : "tower.png", seconds: 5, move: `Move ${n}: a slow push towards the door.`,
  prompt: `Shot ${n}: the camera moves slowly towards the front door in soft morning light.`, kind: "image_to_video", best: n === 2, ...extra,
});
const SHOTLIST = { title: "Details first", seconds: 15, ratio: "1280:720", shots: [shot(1), shot(2), shot(3)], cards: { title: "The lake house", end: "Sthyra" } };
// The shots as the owner approved them: s02 is best (gen4.5), the others gen4_turbo; 110 credits, 220 with retakes.
const PRICED = [
  { id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5, credits: 25 },
  { id: "s02", kind: "image_to_video", model: "gen4.5", seconds: 5, credits: 60 },
  { id: "s03", kind: "image_to_video", model: "gen4_turbo", seconds: 5, credits: 25 },
];
const approval = (batch, ms, budget = 220, base = 110, shots = PRICED) => ({ round: 1, variant: "b", direction: "detail-to-whole", batch, budget, base, shots: shotsHash(shots), at: at(ms) });

const ROUND1_OLD = [
  "CLIPS: RETAKE - the first try",
  "# Clip review: round 1",
  "## Clips",
  "s01-t1: retake; an old verdict from before the second approval",
  "## Seen",
  "- clips/s01-t1/frame-01.png: nothing",
  "Clips: RETAKE",
].join("\n");
const ROUND1 = [
  "CLIPS: RETAKE - the tower in s03 bends as the camera rises",
  "# Clip review: round 1",
  "## Clips",
  "s01-t1: keep; the approach is steady and the windows hold their light",
  "s02-t1: keep; the pan follows the board",
  "s03-t1: retake; the tower's edge bends in the last two stills",
  "## Seen",
  "- clips/s01-t1/frame-06.png: the front door stays square",
  "- clips/s02-t1/frame-03.png: the paving keeps its lines",
  "- clips/s03-t1/frame-04.png: the tower's edge bends",
  "Clips: RETAKE",
].join("\n");
const FORGED = ROUND1.replace("s03-t1: retake; the tower's edge bends in the last two stills", "s03-t1: keep; forged by another agent").replace(/RETAKE/g, "KEEP");

function seed({ status = "in_progress", otherStatus = "in_progress" } = {}) {
  const s = boardSeedV2();
  const issue = (id, key, n, title, st, parentId = null) => ({
    id, companyId: IDS_V2.company, projectId: IDS_V2.project, goalId: null, parentId, title,
    description: `FOR: Artist\nMake a film.\n\nReview: art\nJOB: ${JOB}`, status: st, priority: "medium",
    assigneeAgentId: IDS_V2.agents["chief-of-staff"], assigneeUserId: null, identifier: key, issueNumber: n,
    createdByUserId: "local-board", createdByAgentId: null, createdAt: at(T1 - HOUR), updatedAt: at(NOW - HOUR),
  });
  s.issues.push(issue(GOAL, KEY, 41, "A film of the lake house", status));
  s.issues.push(issue(OTHER, KEY2, 42, "A film of the courtyard", otherStatus));
  s.issues.push(issue(STEP, "STH-141", 141, "Review the clips", "done", GOAL));
  const c = (n, issueId, body, author, ms) => ({ id: `cf000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, issueId, body, authorAgentId: author, authorUserId: author ? null : "local-board", createdAt: at(ms) });
  s.comments.push(c(1, GOAL, `SHOTLIST ACCEPTED: b batch ${B1}`, null, T1));
  s.comments.push(c(2, STEP, ROUND1_OLD, AD, T1 + HOUR));
  s.comments.push(c(3, GOAL, `SHOTLIST ACCEPTED: b batch ${B2}`, null, T2));
  s.comments.push(c(4, STEP, ROUND1, AD, T2 + 30 * 60_000));
  s.comments.push(c(5, STEP, FORGED, ARTIST, T2 + 40 * 60_000));
  return s;
}

// One ledger job: its reservation and, unless `end` is null, its end line.
function job(h, { id, batch, shot: s, at: ms, model = "gen4_turbo", seconds = 5, estimate = 25, end = "done", credits = estimate, kind = "image_to_video" }) {
  const line = { job: id, batch, shot: s, slug: "artist", kind, model, seconds, estimate, runwayTask: null };
  appendLine(h.config.paths.ledger, { ...line, at: at(ms), state: "reserved", credits: estimate, verdict: null });
  if (end === null) return;
  const released = end.startsWith("not_started_");
  appendLine(h.config.paths.ledger, { ...line, at: at(ms + 60_000), state: released ? "released" : "spent", credits: released ? 0 : credits, verdict: end });
}

// The door's own job record, with the input it kept (made `inputAge` ms ago), or none.
function record(h, { id, batch, shot: s, input = null, kind = "image_to_video" }) {
  const store = workStore(h.config.paths.doorWork);
  let inputs = [];
  if (input) {
    const rec = store.saveInput("artist", { type: "image/png", width: 1280, height: 720 }, input.bytes, NOW - input.age);
    inputs = [rec.id];
  }
  store.saveJob({ job: id, slug: "artist", kind, model: "gen4_turbo", seconds: 5, batch, shot: s, estimate: 25, fingerprint: null,
    state: "done", progress: 1, credits: 25, reason: null, runwayTask: null, output: null, startedAt: at(NOW - HOUR), endedAt: at(NOW - HOUR), inputs });
  return inputs[0] || null;
}

// A stub home with the film STH-41: treatment b approved twice (the first batch froze after two refusals), the
// second batch with a refusal-free run: s01 and s02 made, s03 made and retaken (the retake still running), and a
// job the door released (not started). STH-42 is another film with its own batch and a kept input.
async function withFilm(opts, fn) {
  const { status, otherStatus } = opts;
  const h = await startV2({
    routes: ["films", "view"], boardSeed: seed({ status, otherStatus }),
    decisions: {
      [`template:${GOAL}`]: JOB, [`asked:${GOAL}`]: { answers: { fromwords: "No" } },
      [`shotlist:${GOAL}`]: opts.approvals || [approval(B1, T1), approval(B2, T2)],
      [`template:${OTHER}`]: JOB,
      [`shotlist:${OTHER}`]: [approval(B3, NOW - HOUR)],
    },
  });
  const outside = mkdtempSync(join(tmpdir(), "uuu-films-outside-"));
  try {
    const idsFile = join(h.state, "ids.json");
    const ids = JSON.parse(readFileSync(idsFile, "utf8"));
    ids.agents["art-director"] = AD;
    writeFileSync(idsFile, JSON.stringify(ids));
    const room = join(h.state, "media", "room");
    mkdirSync(room, { recursive: true });
    writeFileSync(join(room, "tower.png"), PNG);
    writeFileSync(join(room, "lobby.png"), PNG);

    const goal = join(h.state, "tasks", "company-work", KEY);
    const tb = join(goal, "film", "lake-b");
    mkdirSync(join(tb, "board"), { recursive: true });
    mkdirSync(join(goal, "film", "lake-a"), { recursive: true });
    writeFileSync(join(goal, "variants.json"), JSON.stringify({ kind: "film", name: "lake", round: 1, variants: [{ id: "a", direction: "slow-approach" }, { id: "b", direction: "detail-to-whole" }] }));
    writeFileSync(join(tb, "shotlist.json"), JSON.stringify(SHOTLIST));
    for (const n of [1, 2, 3]) writeFileSync(join(tb, "board", `shot-0${n}.png`), PNG);
    const clips = join(tb, "clips");
    mkdirSync(clips, { recursive: true });
    // s01-t1: a clip, its six stills, and the Artist's own notes claiming another price.
    writeFileSync(join(clips, "s01-t1.mp4"), MP4);
    mkdirSync(join(clips, "s01-t1"));
    for (let n = 1; n <= 6; n += 1) writeFileSync(join(clips, "s01-t1", `frame-0${n}.png`), PNG);
    writeFileSync(join(clips, "s01-t1.json"), JSON.stringify({ prompt: "x", render: "tower.png", model: "gen4_turbo", seconds: 5, credits: 1, job: "gforged", input: "iforged" }));
    // s02-t1: the clip is there only in another letter case; its stills folder holds a frame in another case.
    writeFileSync(join(clips, "S02-T1.mp4"), MP4);
    mkdirSync(join(clips, "s02-t1"));
    writeFileSync(join(clips, "s02-t1", "FRAME-01.png"), PNG);
    writeFileSync(join(clips, "s02-t1", "frame-02.png"), PNG);
    // s03-t1: the clip is a link to a real MP4 outside; its stills folder is a link to a real folder of stills.
    writeFileSync(join(outside, "real.mp4"), MP4);
    symlinkSync(join(outside, "real.mp4"), join(clips, "s03-t1.mp4"));
    mkdirSync(join(outside, "stills"));
    for (let n = 1; n <= 6; n += 1) writeFileSync(join(outside, "stills", `frame-0${n}.png`), PNG);
    symlinkSync(join(outside, "stills"), join(clips, "s03-t1"));
    // The edit of this treatment, and one of the other treatment.
    mkdirSync(join(goal, "video", "lake-film"), { recursive: true });
    writeFileSync(join(goal, "video", "lake-film", "manifest.json"), JSON.stringify({ name: "lake-film", kind: "video", made_by: "film", film: "lake-b", seconds: 14.5, clips: [{ clip: "s01-t1" }, { clip: "s02-t1" }, { clip: "s03-t1" }, { clip: "s01-t1" }] }));
    mkdirSync(join(goal, "video", "other-film"), { recursive: true });
    writeFileSync(join(goal, "video", "other-film", "manifest.json"), JSON.stringify({ name: "other-film", kind: "video", made_by: "film", film: "lake-a", seconds: 9, clips: [{ clip: "s01-t1" }] }));

    // The approvals' batches, written by the home server's own writer at their approval times.
    const shots = PRICED.map(({ id, kind, model, seconds }) => ({ id, kind, model, seconds }));
    writeBatch(h.config, { id: B1, task: GOAL, shots, takes: 2, now: T1 });
    writeBatch(h.config, { id: B2, task: GOAL, shots, takes: 2, now: T2 });
    writeBatch(h.config, { id: B3, task: OTHER, shots, takes: 2, now: NOW - HOUR });

    // The door's ledger: batch 1 froze (two refusals); batch 2 runs.
    job(h, { id: "ga0000000000000000001", batch: B1, shot: "s01", at: T1 + 10 * 60_000, end: "refused" });
    job(h, { id: "ga0000000000000000002", batch: B1, shot: "s02", at: T1 + 20 * 60_000, model: "gen4.5", estimate: 60, end: "refused" });
    job(h, { id: "gb0000000000000000000", batch: B2, shot: "s01", at: T2 + 60_000, end: "not_started_400" });
    job(h, { id: "gb0000000000000000001", batch: B2, shot: "s01", at: T2 + 2 * 60_000 });
    job(h, { id: "gb0000000000000000002", batch: B2, shot: "s02", at: T2 + 3 * 60_000, model: "gen4.5", estimate: 60 });
    job(h, { id: "gb0000000000000000003", batch: B2, shot: "s03", at: T2 + 4 * 60_000 });
    job(h, { id: "gb0000000000000000004", batch: B2, shot: "s03", at: T2 + 50 * 60_000, end: null });
    job(h, { id: "gc0000000000000000001", batch: B3, shot: "s01", at: NOW - 30 * 60_000 });
    // The door's records: a kept input for s01-t1 (an hour old), one older than a day for s03-t1, none for s02-t1.
    const kept = inputPng(7);
    record(h, { id: "gb0000000000000000001", batch: B2, shot: "s01", input: { bytes: kept, age: HOUR } });
    record(h, { id: "gb0000000000000000003", batch: B2, shot: "s03", input: { bytes: inputPng(9), age: 25 * HOUR } });
    record(h, { id: "gb0000000000000000004", batch: B2, shot: "s03", input: { bytes: inputPng(9), age: 25 * HOUR } });
    record(h, { id: "gc0000000000000000001", batch: B3, shot: "s01", input: { bytes: inputPng(11), age: HOUR } });
    forgetComments();
    return await fn(h, { goal, tb, clips, kept });
  } finally {
    await h.close();
    rmSync(outside, { recursive: true, force: true });
  }
}

const film = async (h, id = GOAL) => call(h.url, "GET", `/api/studio/films/${id}`);
const films = async (h) => (await call(h.url, "GET", "/api/studio/films")).json;
const takesOf = (f) => Object.fromEntries(f.shots.map((s) => [s.id, s.takes.map((t) => [t.batch === B1 ? "B1" : t.batch === B2 ? "B2" : t.batch, t.take, t.state, t.credits])]));

// ---- the film

test("the film view fits films.json: two batches, a refusal, a retake, a running job, money from the ledger", async () => {
  await withFilm({}, async (h) => {
    const r = await film(h);
    assert.equal(r.status, 200, r.text);
    const f = r.json;
    assert.deepEqual(sameShape(readShape("films").film, f), []);
    assert.deepEqual(f.task, { id: GOAL, identifier: KEY, title: "A film of the lake house" });
    assert.deepEqual(f.treatment, { variant: "b", direction: { id: "detail-to-whole", title: "Detail to whole" }, name: "lake" });
    assert.deepEqual(f.batches.map((b) => [b.id, b.approvedAt, b.budget, b.spent, b.refused, b.frozen]), [
      [B1, at(T1), 220, 85, 2, true],
      [B2, at(T2), 220, 135, 0, false],
    ]);
    assert.equal(f.batches[1].expiresAt, at(T2 + 7 * 24 * HOUR));
    assert.deepEqual(takesOf(f), {
      s01: [["B1", "t1", "refused", 25], ["B2", "t1", "made", 25]],
      s02: [["B1", "t1", "refused", 60], ["B2", "t1", "made", 60]],
      s03: [["B2", "t1", "made", 25], ["B2", "t2", "making", 25]],
    });
    assert.deepEqual(f.shots.map((s) => [s.id, s.credits, s.seconds, s.kind, s.render]), [
      ["s01", 50, 5, "image_to_video", "tower.png"], ["s02", 120, 5, "image_to_video", "lobby.png"], ["s03", 50, 5, "image_to_video", "tower.png"],
    ]);
    const s03 = f.shots[2];
    assert.deepEqual(s03.takes.map((t) => t.result), ["Made", "Running, counted until it ends"]);
    assert.equal(f.shots[0].takes[0].result, "Refused by Runway");
    assert.equal(f.shots[0].move, "Move 1: a slow push towards the door.");
    assert.equal(f.shots[0].prompt, SHOTLIST.shots[0].prompt);
    assert.deepEqual(f.total, { spent: 220, budget: 440, words: "220 of 440 credits spent ($2.20 of $4.40)." });
    assert.deepEqual(f.edit, { identifier: KEY, name: "lake-film" });
    assert.equal(f.changedAfterApproval, false);
    assert.equal(f.problem, null);
    assert.equal(REFUSALS_TO_FREEZE, FREEZE_AT, "the film freezes where the door does");
  });
});

test("credits come from the ledger even when the Artist's s01-t1.json claims others; a released job is no take", async () => {
  await withFilm({}, async (h) => {
    const f = (await film(h)).json;
    const t = f.shots[0].takes[1];
    assert.equal(t.job, "gb0000000000000000001");
    assert.equal(t.credits, 25);
    assert.ok(!JSON.stringify(f).includes("gforged") && !JSON.stringify(f).includes("iforged"));
    assert.ok(!f.shots.flatMap((s) => s.takes).some((x) => x.job === "gb0000000000000000000"), "the door released it: no take");
    // The ledger is the only truth: a later end line with Runway's higher price is what the film shows.
    appendLine(h.config.paths.ledger, { at: at(NOW), job: "gb0000000000000000004", batch: B2, shot: "s03", slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25, state: "spent", credits: 30, runwayTask: null, verdict: "failed" });
    const g = (await film(h)).json;
    assert.deepEqual(g.shots[2].takes[1].state, "failed");
    assert.equal(g.shots[2].takes[1].credits, 30);
    assert.equal(g.total.spent, 225);
  });
});

test("clips, stills and boards: exact names only, never a link, never another letter case; every address is /api/view", async () => {
  await withFilm({}, async (h) => {
    const f = (await film(h)).json;
    const [s01, s02, s03] = f.shots;
    const made = s01.takes[1];
    assert.match(made.clip, /^\/api\/view\/[A-Za-z0-9_-]+$/);
    assert.equal(made.stills.length, 6);
    for (const u of [made.clip, ...made.stills, s01.board]) {
      assert.match(u, /^\/api\/view\/[A-Za-z0-9_-]+$/);
      assert.equal((await call(h.url, "GET", u)).status, 200, u);
    }
    assert.equal(Buffer.from(made.clip.slice(10), "base64url").toString(), `${KEY}/film/lake-b/clips/s01-t1.mp4`);
    assert.equal(Buffer.from(made.stills[5].slice(10), "base64url").toString(), `${KEY}/film/lake-b/clips/s01-t1/frame-06.png`);
    assert.equal(s01.takes[0].clip, null, "the refused take of the first batch has no clip");
    assert.equal(s02.takes[1].clip, null, "S02-T1.mp4 is another letter case");
    assert.equal(s02.takes[1].stills.length, 1, "FRAME-01.png is another letter case");
    assert.equal(s03.takes[0].clip, null, "a clip that is a link");
    assert.deepEqual(s03.takes[0].stills, [], "a stills folder that is a link");
    assert.deepEqual([s01.board, s02.board, s03.board].map((b) => typeof b), ["string", "string", "string"]);
  });
});

test("two batches' made takes of one name in one treatment: the clip file is the newest's, never shown twice", async () => {
  await withFilm({}, async (h, { clips }) => {
    rmSync(join(clips, "s03-t1.mp4"));
    writeFileSync(join(clips, "s03-t1.mp4"), MP4);
    job(h, { id: "ga0000000000000000003", batch: B1, shot: "s03", at: T1 + 30 * 60_000 });
    const s03 = (await film(h)).json.shots[2];
    assert.deepEqual(s03.takes.map((t) => [t.batch === B1 ? "B1" : "B2", t.take, t.state, t.clip === null]), [
      ["B1", "t1", "made", true], ["B2", "t1", "made", false], ["B2", "t2", "making", true],
    ]);
    assert.equal(s03.credits, 75);
  });
});

test("a clip that is not an MP4 by its first bytes, a board that is not a PNG, a treatment folder that is a link: not shown", async () => {
  await withFilm({}, async (h, { tb, clips }) => {
    writeFileSync(join(clips, "s01-t1.mp4"), PNG);
    writeFileSync(join(tb, "board", "shot-02.png"), MP4);
    let f = (await film(h)).json;
    assert.equal(f.shots[0].takes[1].clip, null);
    assert.equal(f.shots[1].board, null);
    // The whole treatment swapped for a link to a copy: nothing of it is shown, and the film says why.
    const copy = mkdtempSync(join(tmpdir(), "uuu-films-copy-"));
    try {
      rmSync(tb, { recursive: true, force: true });
      mkdirSync(join(copy, "clips"), { recursive: true });
      writeFileSync(join(copy, "clips", "s01-t1.mp4"), MP4);
      writeFileSync(join(copy, "shotlist.json"), JSON.stringify(SHOTLIST));
      symlinkSync(copy, tb);
      f = (await film(h)).json;
      assert.ok(f.shots.flatMap((s) => s.takes).every((t) => t.clip === null && t.stills.length === 0));
      assert.ok(f.shots.every((s) => s.board === null && s.render === null));
      assert.equal(f.problem, "shotlist.json is not a plain file (it may be a link), so it cannot be read.");
      assert.equal(f.total.spent, 220, "the money stands: it is the ledger's");
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

test("verdicts: the newest clip review naming the clip, after its batch's approval, by the Art director only", async () => {
  await withFilm({}, async (h) => {
    const f = (await film(h)).json;
    const v = (s, k) => f.shots[s].takes[k].verdict;
    assert.deepEqual(v(0, 0), { verdict: "retake", reason: "an old verdict from before the second approval", round: 1 }, "the first batch's take");
    assert.deepEqual(v(0, 1), { verdict: "keep", reason: "the approach is steady and the windows hold their light", round: 1 });
    assert.deepEqual(v(2, 0), { verdict: "retake", reason: "the tower's edge bends in the last two stills", round: 1 }, "another agent's KEEP does not count");
    assert.equal(v(2, 1), null, "not looked at yet");
    // A second round from the Art director keeps the earlier take: that is the newest verdict naming it.
    h.board.state.comments.push({ id: "cf000000-0000-4000-8000-000000000099", issueId: STEP, authorAgentId: AD, authorUserId: null, createdAt: at(NOW - 60_000),
      body: "CLIPS: KEEP - s03 kept\n# Clip review: round 2\n## Clips\ns03-t1: keep; the smaller fault\n## Seen\n- clips/s03-t1/frame-01.png: fine\nClips: KEEP" });
    forgetComments();
    const g = (await film(h)).json;
    assert.deepEqual(g.shots[2].takes[0].verdict, { verdict: "keep", reason: "the smaller fault", round: 2 });
  });
});

test("sent: the door's own kept picture for a day, under a policy that runs nothing; then \"gone\"", async () => {
  await withFilm({}, async (h, { kept }) => {
    const f = (await film(h)).json;
    const [s01, s02, s03] = f.shots;
    assert.equal(s01.takes[1].sent, `/api/studio/films/${GOAL}/sent/gb0000000000000000001`);
    assert.equal(s02.takes[1].sent, "gone", "no job record any more");
    assert.equal(s03.takes[0].sent, "gone", "a kept input older than a day");
    const r = await call(h.url, "GET", s01.takes[1].sent);
    assert.equal(r.status, 200);
    assert.ok(r.buffer.equals(kept));
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal(r.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["cache-control"], "no-store");
    const gone = await call(h.url, "GET", `/api/studio/films/${GOAL}/sent/gb0000000000000000003`);
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, "sent_gone");
    // By the identifier too.
    assert.equal((await call(h.url, "GET", `/api/studio/films/${KEY}/sent/gb0000000000000000001`)).status, 200);
  });
});

test("sent for a job of another film, a job not in the ledger, a malformed id or a task with no film: 404", async () => {
  await withFilm({}, async (h) => {
    const other = await call(h.url, "GET", `/api/studio/films/${GOAL}/sent/gc0000000000000000001`);
    assert.equal(other.status, 404);
    assert.equal(other.json.error.code, "sent_not_found");
    assert.equal((await call(h.url, "GET", `/api/studio/films/${OTHER}/sent/gc0000000000000000001`)).status, 200, "its own film shows it");
    for (const path of [
      `/api/studio/films/${GOAL}/sent/gnot000000000000000000`,
      `/api/studio/films/${GOAL}/sent/..%2F..%2Fsecrets`,
      `/api/studio/films/${GOAL}/sent/${"g".repeat(65)}`,
      `/api/studio/films/${IDS_V2.issues?.["STH-1"] || "e0000000-0000-4000-8000-000000000001"}/sent/gb0000000000000000001`,
      `/api/studio/films/nobody/sent/gb0000000000000000001`,
    ]) {
      const r = await call(h.url, "GET", path);
      assert.equal(r.status, 404, path);
      assert.ok(!r.headers["content-type"].startsWith("image/"), path);
    }
  });
});

test("a kept input whose bytes no longer are a picture, or a record for another batch: never served", async () => {
  await withFilm({}, async (h) => {
    const store = workStore(h.config.paths.doorWork);
    const rec = store.readJob("gb0000000000000000001");
    writeFileSync(join(h.config.paths.doorWork, "gen", "inputs", `${rec.inputs[0]}.bin`), Buffer.alloc(600, 1), { mode: 0o600 });
    let r = await call(h.url, "GET", `/api/studio/films/${GOAL}/sent/gb0000000000000000001`);
    assert.equal(r.status, 404);
    assert.equal((await film(h)).json.shots[0].takes[1].sent, "gone");
    store.saveJob({ ...store.readJob("gc0000000000000000001"), job: "gb0000000000000000002", batch: B3 });
    r = await call(h.url, "GET", `/api/studio/films/${GOAL}/sent/gb0000000000000000002`);
    assert.equal(r.status, 404);
  });
});

test("a changed shotlist after the approval: changedAfterApproval; a model chosen later in Settings or a new prompt is no change", async () => {
  await withFilm({}, async (h, { tb }) => {
    updateDoors(h.config, (st) => { st.generate.models.video = "gen4.5"; });
    const reworded = { ...SHOTLIST, shots: SHOTLIST.shots.map((s) => ({ ...s, prompt: `${s.prompt} Again.` })) };
    writeFileSync(join(tb, "shotlist.json"), JSON.stringify(reworded));
    let f = (await film(h)).json;
    assert.equal(f.changedAfterApproval, false);
    assert.equal(f.shots[0].prompt, reworded.shots[0].prompt);
    for (const changed of [
      { ...SHOTLIST, shots: [shot(1), shot(2), shot(3, { seconds: 10 })] },
      { ...SHOTLIST, shots: [shot(1, { best: true }), shot(2), shot(3)] },
      { ...SHOTLIST, shots: [shot(1), shot(2)] },
    ]) {
      writeFileSync(join(tb, "shotlist.json"), JSON.stringify(changed));
      f = (await film(h)).json;
      assert.equal(f.changedAfterApproval, true, JSON.stringify(changed.shots.map((s) => [s.seconds, s.best])));
      assert.deepEqual(f.shots.map((s) => [s.id, s.seconds]), [["s01", 5], ["s02", 5], ["s03", 5]], "the shots stay what was approved");
    }
  });
});

test("the ledger unreadable: no takes, nothing spent shown, and the film says why; no batch file: shots from the ledger", async () => {
  await withFilm({}, async (h) => {
    writeFileSync(h.config.paths.ledger, "{torn", { flag: "a" });
    const f = (await film(h)).json;
    assert.equal(f.problem, "The spending ledger cannot be read, so nothing will be made. Health shows what to do.");
    assert.deepEqual(f.shots.map((s) => s.takes.length), [0, 0, 0]);
    assert.equal(f.total.spent, null);
    assert.equal(f.total.words, "What was spent cannot be read; 440 credits ($4.40) were approved.");
    assert.ok(f.batches.every((b) => b.spent === null && b.refused === null && b.frozen === false));
  });
  await withFilm({}, async (h) => {
    rmSync(join(h.config.paths.batches, `${B2}.json`));
    const f = (await film(h)).json;
    assert.equal(f.problem, "The approval's own file is no longer kept, so the shots are listed from what was spent.");
    assert.deepEqual(f.shots.map((s) => s.id), ["s01", "s02", "s03"]);
    assert.equal(f.total.spent, 220);
  });
});

test("a task with no film, an unknown task, a malformed id: 404 film_not_found", async () => {
  await withFilm({}, async (h) => {
    for (const id of ["e0000000-0000-4000-8000-000000000141", "nobody", "STH-1", "a%2Fb", "x".repeat(65)]) {
      const r = await film(h, id);
      assert.equal(r.status, 404, id);
      assert.equal(r.json.error.code, "film_not_found", id);
    }
    assert.equal((await film(h, KEY)).status, 200, "by its identifier");
  });
});

// ---- the list

test("the Films list fits films.json: making, needs you after two refusals, with clips made and kept", async () => {
  await withFilm({}, async (h) => {
    job(h, { id: "gc0000000000000000002", batch: B3, shot: "s02", at: NOW - 20 * 60_000, end: "refused" });
    job(h, { id: "gc0000000000000000003", batch: B3, shot: "s03", at: NOW - 10 * 60_000, end: "refused" });
    const d = await films(h);
    assert.deepEqual(sameShape(readShape("films").list, d), []);
    assert.deepEqual(d.films.map((x) => [x.task.identifier, x.state, x.budget, x.spent, x.clips, x.kept, x.problem]), [
      [KEY2, "needs you", 220, 75, 1, 0, FROZEN],
      [KEY, "making", 440, 220, 3, 2, null],
    ]);
    assert.equal(d.films[1].approvedAt, at(T2));
  });
});

test("the list's states: done, stopped for a cancelled goal, ended when the approval ran out first", async () => {
  await withFilm({ status: "done", otherStatus: "cancelled" }, async (h) => {
    const d = await films(h);
    assert.deepEqual(d.films.map((x) => [x.task.identifier, x.state]), [[KEY2, "stopped"], [KEY, "done"]]);
  });
  const old = NOW - 9 * 24 * HOUR;
  await withFilm({ approvals: [approval(B2, old)] }, async (h) => {
    rmSync(join(h.config.paths.batches, `${B2}.json`));
    const d = await films(h);
    const row = d.films.find((x) => x.task.identifier === KEY);
    assert.equal(row.state, "ended");
    assert.match(row.problem, /^The approval of its cost ended on \d{1,2} [A-Z][a-z]{2} \d{4}, so nothing more can be made with Runway for it\.$/);
    assert.equal(row.spent, 135, "only its own batch's jobs");
  });
  // Two refusals in the newest batch come first: the film needs the owner, whether or not its approval ran out.
  await withFilm({ approvals: [approval(B1, old)] }, async (h) => {
    const row = (await films(h)).films.find((x) => x.task.identifier === KEY);
    assert.deepEqual([row.state, row.problem, row.spent], ["needs you", FROZEN, 85]);
  });
});
