// The ledger's tidy at the door's own start (PLAN-V5 C3, T41): only a file over 8 MB that reads whole; the two
// newest months (Asia/Kolkata), every open job and every pause line stay; the rest moves, in order, to a dated
// file beside it; the totals of now are the same before and after. Made-up lines in temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGenerateDoor } from "../door.mjs";
import { ROTATE_OVER_BYTES, monthOf, readLedger, rotateLedger, totalsOf } from "../ledger.mjs";
import { startRunway } from "../../test/stubs/runway.mjs";

const MB = 1024 * 1024;
const DAY = 24 * 3600_000;
const HOUR = 3600_000;
const NOW = Date.parse("2026-11-13T06:00:00.000Z");   // 11:30 on 13 November 2026 in Kolkata
const DATED = "generate-ledger-2026-11-13.jsonl";
const iso = (ms) => new Date(ms).toISOString();
const folder = () => mkdtempSync(join(tmpdir(), "gen-rotate-"));
const mode = (p) => statSync(p).mode & 0o777;

const line = (f) => JSON.stringify({
  at: null, job: null, batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5,
  estimate: 25, state: "reserved", credits: 25, runwayTask: "17f20503-6c24-4c16-946b-35dbbce2af2f", verdict: null, ...f,
});
const reserved = (job, at, f = {}) => ({ at, text: line({ at: iso(at), job, ...f }) });
const ended = (job, at, f = {}) => ({ at, text: line({ at: iso(at), job, state: "spent", verdict: "done", ...f }) });
const paused = (at) => ({ at, text: line({ at: iso(at), job: null, state: "paused", credits: 0, estimate: 0, slug: null, kind: null, model: null, seconds: null, runwayTask: null, verdict: "three_refusals" }) });

// A ledger of September, October and November 2026 (Kolkata) of at least `bytes`, in time order: finished jobs
// through the three months; a job reserved on 30 September at 23:50 and ended on 1 October; two open jobs with no
// task id (September, November); this month a film batch b1 (s01 made, s01 refused in the last day, s02 not
// started, s02 still running) and a job of today; pause lines in September and two hours ago.
function bigLedger({ bytes = 9 * MB, from = Date.parse("2026-08-31T18:30:00Z") } = {}) {
  const events = [
    reserved("gopen1", Date.parse("2026-09-10T06:00:00Z"), { runwayTask: null }),
    paused(Date.parse("2026-09-12T06:00:00Z")),
    reserved("gstraddle", Date.parse("2026-09-30T18:20:00Z")), ended("gstraddle", Date.parse("2026-09-30T18:40:00Z"), { credits: 30 }),
    reserved("goct", Date.parse("2026-10-02T06:00:00Z")), ended("goct", Date.parse("2026-10-02T06:05:00Z")),
    reserved("gopen2", Date.parse("2026-11-05T06:00:00Z"), { runwayTask: null, estimate: 50, credits: 50, seconds: 10 }),
    reserved("gb1", NOW - 30 * HOUR, { batch: "b1", shot: "s01" }), ended("gb1", NOW - 30 * HOUR + 60_000, { batch: "b1", shot: "s01", credits: 25 }),
    reserved("gb2", NOW - 20 * HOUR, { batch: "b1", shot: "s01" }), ended("gb2", NOW - 20 * HOUR + 60_000, { batch: "b1", shot: "s01", verdict: "refused" }),
    reserved("gb3", NOW - 10 * HOUR, { batch: "b1", shot: "s02" }),
    ended("gb3", NOW - 10 * HOUR + 1000, { batch: "b1", shot: "s02", state: "released", credits: 0, verdict: "not_started_400" }),
    reserved("gb4", NOW - 3 * HOUR, { batch: "b1", shot: "s02", estimate: 50, credits: 50, seconds: 10 }),
    paused(NOW - 2 * HOUR),
    reserved("gtoday", NOW - HOUR), ended("gtoday", NOW - HOUR + 60_000, { credits: 40 }),
  ];
  let size = events.reduce((s, e) => s + e.text.length + 1, 0);
  const span = NOW - 2 * DAY - from;
  const fill = [];
  for (let i = 0; size < bytes; i += 1) fill.push(i), size += 2 * (line({ at: iso(from), job: `gf${i}` }).length + 1);
  fill.forEach((i) => {
    const at = from + Math.floor((span * i) / fill.length);
    events.push(reserved(`gf${i}`, at), ended(`gf${i}`, at + 1000));
  });
  events.sort((a, b) => a.at - b.at);
  return events.map((e) => e.text);
}
let cached = null;
const nineMb = () => (cached ||= bigLedger());

function writeLines(path, lines, fileMode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  chmodSync(path, fileMode);
}
const textLines = (path) => readFileSync(path, "utf8").slice(0, -1).split("\n");

// The totals the door asks of its ledger as of NOW, as plain values.
function totalsNow(lines, opts) {
  const t = totalsOf(lines, NOW, opts);
  return {
    day: t.day, month: t.month, batch: t.batch, unasked: t.unasked, batchRefused: t.batchRefused, refusedRecent: t.refusedRecent,
    paused: t.paused, open: t.open.map((j) => j.job).sort(), s01: t.takes("s01"), s02: t.takes("s02"),
    notStartedRecent: t.notStartedRecent, ns01: t.notStarted("s01"), ns02: t.notStarted("s02"),
  };
}
const ALL_OPTS = [
  {}, { batch: "b1" }, { batch: "b1", resumedAt: NOW - 3 * HOUR }, { resumedAt: NOW - HOUR }, { batch: "b1", resumedAt: Date.parse("2026-09-20T00:00:00Z") },
];

test("a 9 MB ledger over three months keeps the two newest months, the open jobs and the pause lines; the totals of now are the same", () => {
  const dir = folder();
  const p = join(dir, "generate-ledger.jsonl");
  const original = nineMb();
  writeLines(p, original);
  assert.ok(statSync(p).size > 8.9 * MB && statSync(p).size > ROTATE_OVER_BYTES, String(statSync(p).size));
  const before = readLedger(p);
  assert.equal(before.ok, true);

  const r = rotateLedger(p, NOW);
  assert.ok(r.moved > 1000 && r.kept > 1000, JSON.stringify(r));
  assert.equal(r.moved + r.kept, original.length);
  const kept = textLines(p);
  const moved = textLines(join(dir, DATED));
  assert.deepEqual([kept.length, moved.length], [r.kept, r.moved]);
  assert.deepEqual([mode(p), mode(join(dir, DATED))], [0o600, 0o600]);
  assert.deepEqual(readdirSync(dir).sort(), [DATED, "generate-ledger.jsonl"], "no temp file is left");

  // Both are the original's lines in their order, byte for byte, and together they are all of them.
  let k = 0;
  let m = 0;
  for (const text of original) {
    if (k < kept.length && kept[k] === text) k += 1;
    else if (m < moved.length && moved[m] === text) m += 1;
    else assert.fail(`a line out of order or lost: ${text.slice(0, 80)}`);
  }
  assert.deepEqual([k, m], [kept.length, moved.length]);

  // Which lines stayed.
  const job = (text) => JSON.parse(text).job;
  const keptJobs = new Set(kept.map(job));
  const movedJobs = new Set(moved.map(job));
  for (const j of ["gopen1", "gopen2", "goct", "gb1", "gb2", "gb3", "gb4", "gtoday"]) assert.ok(keptJobs.has(j) && !movedJobs.has(j), j);
  assert.ok(movedJobs.has("gstraddle") && !keptJobs.has("gstraddle"), "a job belongs to the month of its first line");
  assert.equal(kept.filter((t) => JSON.parse(t).state === "paused").length, 2, "both pause lines stay, September's too");
  for (const t of moved) {
    const v = JSON.parse(t);
    assert.equal(monthOf(Date.parse(v.at)), Date.parse(v.at) < Date.parse("2026-09-30T18:30:00Z") ? "2026-09" : "2026-10");
    assert.notEqual(v.state, "paused");
  }
  for (const t of kept) {
    const v = JSON.parse(t);
    if (v.state !== "paused" && v.job !== "gopen1") assert.ok(["2026-10", "2026-11"].includes(monthOf(Date.parse(v.at))), t.slice(0, 80));
  }

  const after = readLedger(p);
  assert.equal(after.ok, true);
  for (const opts of ALL_OPTS) assert.deepEqual(totalsNow(after.lines, opts), totalsNow(before.lines, opts), JSON.stringify(opts));
  const t = totalsNow(after.lines, { batch: "b1" });
  assert.deepEqual([t.day, t.batch, t.s01, t.s02, t.batchRefused, t.paused], [40 + 50, 25 + 25 + 0 + 50, 2, 1, 1, true], "the case is what it says");
  assert.deepEqual(t.open, ["gb4", "gopen1", "gopen2"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a second tidy on the same day writes -2, then -3, and never writes over an earlier file", () => {
  const dir = folder();
  const p = join(dir, "generate-ledger.jsonl");
  writeFileSync(join(dir, DATED), "kept from this morning\n", { mode: 0o600 });
  writeLines(p, nineMb());
  const first = rotateLedger(p, NOW);
  assert.ok(first.moved > 0);
  assert.equal(readFileSync(join(dir, DATED), "utf8"), "kept from this morning\n");
  assert.equal(textLines(join(dir, "generate-ledger-2026-11-13-2.jsonl")).length, first.moved);
  writeLines(p, nineMb());
  const second = rotateLedger(p, NOW);
  assert.equal(second.moved, first.moved);
  assert.deepEqual(textLines(join(dir, "generate-ledger-2026-11-13-3.jsonl")), textLines(join(dir, "generate-ledger-2026-11-13-2.jsonl")));
  assert.equal(mode(join(dir, "generate-ledger-2026-11-13-3.jsonl")), 0o600);
  rmSync(dir, { recursive: true, force: true });
});

test("a file under 8 MB, one the ledger's rule cannot read, a link, a missing file or one with nothing old is not touched", () => {
  const dir = folder();
  const p = join(dir, "generate-ledger.jsonl");
  const big = nineMb();
  const untouched = (label) => {
    const st = lstatSync(p, { throwIfNoEntry: false });
    const text = st && st.isFile() ? readFileSync(p) : null;
    const r = rotateLedger(p, NOW);
    assert.equal(r.moved, 0, label);
    const after = lstatSync(p, { throwIfNoEntry: false });
    if (text) assert.ok(readFileSync(p).equals(text), label);
    assert.equal(!!after, !!st, label);
    assert.ok(!readdirSync(dir).some((n) => n.startsWith("generate-ledger-")), `${label}: no dated file`);
  };

  untouched("missing");
  const small = [];
  for (let i = 0, size = 0; size < 7.5 * MB; i += 1) { const t = big[i]; small.push(t); size += t.length + 1; }
  writeLines(p, small);
  assert.ok(statSync(p).size < ROTATE_OVER_BYTES);
  untouched("under 8 MB, all of it September");
  writeLines(p, big, 0o666);
  untouched("others can write it");
  chmodSync(p, 0o600);
  writeFileSync(p, `${big.join("\n")}\n{"at":"2026`);
  untouched("a torn last line");
  writeLines(p, [...big.slice(0, 100), "not json", ...big.slice(100)]);
  untouched("a bad line in the middle");
  const real = join(dir, "elsewhere.jsonl");
  writeLines(real, big);
  rmSync(p);
  symlinkSync(real, p);
  untouched("a link");
  assert.equal(lstatSync(p).isSymbolicLink(), true);
  assert.equal(statSync(real).size, Buffer.byteLength(`${big.join("\n")}\n`), "its target too");
  rmSync(p);
  const recent = [];
  for (let i = 0, size = 0; size < 8.5 * MB; i += 1) {
    const t = line({ at: iso(Date.parse("2026-10-05T00:00:00Z") + i * 1000), job: `gr${i}`, state: i % 2 ? "spent" : "reserved" });
    recent.push(t);
    size += t.length + 1;
  }
  writeLines(p, recent);
  const r = rotateLedger(p, NOW);
  assert.deepEqual(r, { moved: 0, kept: recent.length, folded: 0 }, "nothing old: nothing moves");
  assert.ok(!readdirSync(dir).some((n) => n.startsWith("generate-ledger-")));
  rmSync(dir, { recursive: true, force: true });
});

test("this month's requests Runway did not start, more than a day old, are folded into one line; the totals of now are the same", () => {
  const dir = folder();
  const p = join(dir, "generate-ledger.jsonl");
  const free = (job, at, status, f = {}) => [reserved(job, at, { runwayTask: null, ...f }),
    ended(job, at + 1000, { runwayTask: null, state: "released", credits: 0, verdict: `not_started_${status}`, ...f })];
  const b1 = (shot) => ({ batch: "b1", shot });
  const events = [
    // A folded line of September: it moves with its month.
    paused(Date.parse("2026-09-12T06:00:00Z")),
    { at: Date.parse("2026-09-13T06:00:00Z"), text: line({ at: "2026-09-13T06:00:00.000Z", job: null, state: "folded", credits: 0, estimate: 0, slug: null, kind: null, model: null, seconds: null, runwayTask: null, verdict: "not_started", count: 7 }) },
    // This month: a spent take, a refusal that cost nothing (it freezes the batch, so it stays), one free attempt
    // just over a day old (folded) and two within the day (kept: they count toward the shot and the pause).
    reserved("gspent", Date.parse("2026-11-02T06:00:00Z"), b1("s01")), ended("gspent", Date.parse("2026-11-02T06:01:00Z"), b1("s01")),
    reserved("grefused", Date.parse("2026-11-03T06:00:00Z"), b1("s02")),
    ended("grefused", Date.parse("2026-11-03T06:01:00Z"), { ...b1("s02"), state: "released", credits: 0, verdict: "refused" }),
    ...free("gedge", NOW - 25 * HOUR, 400, b1("s01")),
    ...free("gfresh1", NOW - 23 * HOUR, 429, b1("s01")),
    ...free("gfresh2", NOW - 3 * HOUR, 404, b1("s02")),
  ];
  // Free attempts through this month (Kolkata, from 1 November) to two days ago, past 8 MB.
  const from = Date.parse("2026-10-31T18:30:00Z");
  const span = NOW - 2 * DAY - from;
  let size = events.reduce((s, e) => s + e.text.length + 1, 0);
  const fill = [];
  for (let i = 0; size < 8.5 * MB; i += 1) {
    const pair = free(`gn${i}`, from, [400, 404, 429][i % 3]);
    fill.push(i);
    size += pair.reduce((s, e) => s + e.text.length + 1, 0);
  }
  fill.forEach((i) => events.push(...free(`gn${i}`, from + Math.floor((span * i) / fill.length), [400, 404, 429][i % 3], i % 2 ? b1("s03") : {})));
  events.sort((a, b) => a.at - b.at);
  const original = events.map((e) => e.text);
  writeLines(p, original);
  assert.ok(statSync(p).size > ROTATE_OVER_BYTES);
  const before = readLedger(p);
  assert.equal(before.ok, true);

  const r = rotateLedger(p, NOW);
  assert.equal(r.folded, fill.length + 1);
  assert.equal(r.moved, 2 * (fill.length + 1) + 1, "every line of the folded jobs, and September's folded line");
  assert.equal(r.moved + r.kept, original.length + 1, "one folded line was added");
  assert.ok(statSync(p).size < 64 * 1024, String(statSync(p).size));
  const kept = textLines(p);
  const moved = textLines(join(dir, DATED));
  // The moved file holds the original's lines in order, byte for byte; the kept file the rest, plus the one line.
  const summary = kept.map((t) => JSON.parse(t)).filter((v) => v.state === "folded");
  assert.equal(summary.length, 1);
  assert.deepEqual([summary[0].count, summary[0].verdict, summary[0].job, summary[0].credits, monthOf(Date.parse(summary[0].at))], [fill.length + 1, "not_started", null, 0, "2026-11"]);
  assert.equal(summary[0].at, iso(from));
  const keptOriginal = kept.filter((t) => JSON.parse(t).state !== "folded");
  let k = 0;
  let m = 0;
  for (const text of original) {
    if (k < keptOriginal.length && keptOriginal[k] === text) k += 1;
    else if (m < moved.length && moved[m] === text) m += 1;
    else assert.fail(`a line out of order or lost: ${text.slice(0, 80)}`);
  }
  assert.deepEqual([k, m], [keptOriginal.length, moved.length]);
  const keptJobs = new Set(keptOriginal.map((t) => JSON.parse(t).job));
  for (const j of ["gspent", "grefused", "gfresh1", "gfresh2"]) assert.ok(keptJobs.has(j), j);
  assert.ok(!keptJobs.has("gedge") && !keptJobs.has("gn0"));
  assert.equal(moved.filter((t) => JSON.parse(t).state === "folded").length, 1, "September's folded line moved");

  // The totals of now, and of later, are as before; a folded line is no job.
  const after = readLedger(p);
  assert.equal(after.ok, true);
  for (const opts of [...ALL_OPTS, { batch: "b1", resumedAt: NOW - 20 * HOUR }]) assert.deepEqual(totalsNow(after.lines, opts), totalsNow(before.lines, opts), JSON.stringify(opts));
  const t = totalsNow(after.lines, { batch: "b1" });
  assert.deepEqual([t.notStartedRecent, t.ns01, t.ns02, t.batchRefused, t.s01, t.s02], [2, 1, 1, 1, 1, 0], "the case is what it says");
  for (const later of [NOW + 2 * DAY, NOW + 40 * DAY]) {
    assert.deepEqual({ ...totalsOf(after.lines, later, { batch: "b1" }), takes: null, notStarted: null, shots: null },
      { ...totalsOf(before.lines, later, { batch: "b1" }), takes: null, notStarted: null, shots: null });
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a tidy that cannot write leaves the ledger as it was and throws", { skip: process.getuid() === 0 }, () => {
  const dir = folder();
  const sub = join(dir, "doors");
  mkdirSync(sub, { mode: 0o700 });
  const p = join(sub, "generate-ledger.jsonl");
  writeLines(p, nineMb());
  const text = readFileSync(p);
  chmodSync(sub, 0o500);
  try {
    assert.throws(() => rotateLedger(p, NOW));
    assert.ok(readFileSync(p).equals(text));
    assert.deepEqual(readdirSync(sub), ["generate-ledger.jsonl"]);
  } finally {
    chmodSync(sub, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- inside the door --------------------------------------------------------------------------------------------

function doorPaths(dir) {
  mkdirSync(join(dir, "doors", "batches"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "secrets", "doors"), { recursive: true, mode: 0o700 });
  const paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"),
    generateSecret: join(dir, "secrets", "doors", "generate-secret"), generateStatus: join(dir, "doors", "generate-status.json"),
    runwayKey: join(dir, "secrets", "doors", "runway-key"), ledger: join(dir, "doors", "generate-ledger.jsonl"),
    batches: join(dir, "doors", "batches"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.ids, JSON.stringify({ agents: { artist: "99999999-2222-4333-8444-555555555555" } }), { mode: 0o600 });
  writeFileSync(paths.generateSecret, `${"2".repeat(64)}\n`, { mode: 0o600 });
  return paths;
}
async function startDoor(rw, paths, logs) {
  const door = createGenerateDoor({
    listenPort: 0, upstream: rw.url, paths, config: { doors: { generate: { agents: ["artist"] } } }, log: (l) => logs.push(l),
    net: rw.net, now: NOW, limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000 },
  });
  await door.listen();
  await door.settled();
  return door;
}

test("a door started over a 9 MB ledger tidies it once, before it settles what an earlier run left open", async () => {
  const rw = await startRunway({});
  const dir = folder();
  const paths = doorPaths(dir);
  const original = nineMb();
  writeLines(paths.ledger, original);
  const before = readLedger(paths.ledger).lines;
  const logs = [];
  let door = await startDoor(rw, paths, logs);
  try {
    const dated = () => readdirSync(join(dir, "doors")).filter((n) => n.startsWith("generate-ledger-"));
    assert.deepEqual(dated(), [DATED]);
    assert.ok(logs.some((l) => / ledger tidied: \d+ old lines moved, \d+ kept$/.test(l)), logs.join("\n"));
    const moved = textLines(join(dir, "doors", DATED));
    const kept = textLines(paths.ledger);
    assert.ok(!moved.some((t) => /"job":"gopen[12]"/.test(t)), "open jobs never move");
    // The two open jobs were settled after the tidy: their end lines are the last two of the new ledger.
    const tail = kept.slice(-2).map((t) => JSON.parse(t));
    assert.deepEqual(tail.map((v) => [v.job, v.state, v.verdict, v.credits]).sort(), [["gopen1", "spent", "unknown", 25], ["gopen2", "spent", "unknown", 50]]);
    assert.equal(kept.length + moved.length, original.length + 2);
    assert.deepEqual(rw.seen.api, [], "nothing was asked of Runway");
    // What the door counts as of now is unchanged: the open jobs stay counted at what they held.
    const after = readLedger(paths.ledger).lines;
    for (const opts of ALL_OPTS) {
      const [a, b] = [totalsNow(after, opts), totalsNow(before, opts)];
      assert.deepEqual({ ...a, open: null }, { ...b, open: null }, JSON.stringify(opts));
    }
    // A second start the same day finds a smaller ledger and leaves it alone.
    const size = statSync(paths.ledger).size;
    await door.close();
    door = await startDoor(rw, paths, logs);
    assert.deepEqual(dated(), [DATED], "tidied once");
    assert.equal(statSync(paths.ledger).size, size);
    const health = await fetch(`http://127.0.0.1:${door.port}/gen/health`);
    assert.equal(health.status, 200);
  } finally {
    await door.close();
    await rw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tidy that fails at the door's start is logged and ignored; the door runs and the ledger is as it was", { skip: process.getuid() === 0 }, async () => {
  const rw = await startRunway({});
  const dir = folder();
  const paths = doorPaths(dir);
  writeLines(paths.ledger, nineMb());
  const text = readFileSync(paths.ledger);
  const logs = [];
  chmodSync(join(dir, "doors"), 0o500);
  let door = null;
  try {
    door = await startDoor(rw, paths, logs);
    assert.ok(logs.some((l) => / ledger not tidied: /.test(l)), logs.join("\n"));
    assert.ok(!logs.some((l) => l.includes(dir)), "no path in the log line");
    const now = readFileSync(paths.ledger);
    assert.ok(now.subarray(0, text.length).equals(text), "the old lines are as they were; settling appended after them");
    assert.ok(!existsSync(join(dir, "doors", DATED)));
    assert.equal((await fetch(`http://127.0.0.1:${door.port}/gen/health`)).status, 200);
  } finally {
    chmodSync(join(dir, "doors"), 0o700);
    if (door) await door.close();
    await rw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
