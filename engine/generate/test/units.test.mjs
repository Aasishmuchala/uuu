// The generation door's parts without a server: Runway's table and answers, the ledger, the
// batches and the bytes. Made-up keys and files in temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_CREDITS, RUNWAY_ORIGIN, buildRequest, checkUpstream, chosen, credits, defaultModel, errorText, estimate, failureKind, pictureFailure,
  holdsKey, readTask, scrub,
} from "../runway.mjs";
import { appendLine, createLedger, dayOf, readLedger, summarize, totalsOf } from "../ledger.mjs";
import { readBatch, readGenState, readRunwayKey, sniffOutput, sniffPicture } from "../state.mjs";
import { mp4Bytes, pngBytes } from "../../test/stubs/runway.mjs";

const KEY = `key_${"ab12".repeat(32)}`;
const MODELS = { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" };
const folder = () => mkdtempSync(join(tmpdir(), "gen-units-"));
const put = (path, text, mode = 0o600) => { writeFileSync(path, typeof text === "string" ? text : JSON.stringify(text)); chmodSync(path, mode); return path; };

// ---- Runway: the origin, the table, the bodies ----------------------------------------
test("only Runway's own origin or a stand-in on 127.0.0.1 is accepted", () => {
  assert.equal(checkUpstream(RUNWAY_ORIGIN).hostname, "api.dev.runwayml.com");
  assert.equal(checkUpstream("http://127.0.0.1:4000").port, 4000);
  for (const bad of ["https://api.runwayml.com", "https://api.dev.runwayml.com/", "http://localhost:4000", "http://127.0.0.1:4000/v1",
    "https://api.dev.runwayml.com.evil.test", "http://127.0.0.2:4000", "http://127.0.0.1:70000", undefined, null]) {
    assert.throws(() => checkUpstream(bad), /upstream must be/, String(bad));
  }
});

test("estimates come from the door's table: per second, per picture, nothing for an unknown model", () => {
  assert.equal(estimate({ kind: "image_to_video", model: "gen4_turbo", seconds: 5 }), 25);
  assert.equal(estimate({ kind: "image_to_video", model: "gen4.5", seconds: 10 }), 120);
  assert.equal(estimate({ kind: "text_to_video", model: "gen4.5", seconds: 4 }), 48);
  assert.equal(estimate({ kind: "still_variation", model: "gen4_image" }), 8);
  assert.equal(estimate({ kind: "still_variation", model: "gen4_image_turbo" }), 2);
  assert.equal(estimate({ kind: "still_upscale", model: "magnific_precision_upscaler_v2" }), 25);
  assert.equal(estimate({ kind: "image_to_video", model: "veo3.1", seconds: 5 }), null);
  assert.equal(estimate({ kind: "text_to_video", model: "gen4_turbo", seconds: 5 }), null);
  assert.equal(estimate({ kind: "image_to_video", model: "gen4_turbo", seconds: 11 }), null);
  assert.equal(estimate({ kind: "image_to_video", model: "toString", seconds: 5 }), null);
  assert.equal(defaultModel("image_to_video", MODELS), "gen4_turbo");
  assert.equal(chosen("image_to_video", "gen4.5", MODELS), true);
  assert.equal(chosen("still_variation", "gen4_image_turbo", MODELS), false);
});

test("request bodies carry pictures as data addresses and nothing else of the agent's", () => {
  const pic = { type: "image/png", bytes: Buffer.from("abc") };
  const v = buildRequest({ kind: "image_to_video", model: "gen4_turbo", promptText: "slow push", seconds: 5, ratio: "1280:720", pictures: [pic] });
  assert.equal(v.path, "/v1/image_to_video");
  assert.deepEqual(v.body, { model: "gen4_turbo", promptImage: "data:image/png;base64,YWJj", ratio: "1280:720", duration: 5, promptText: "slow push" });
  const s = buildRequest({ kind: "still_variation", model: "gen4_image", promptText: "p", ratio: "1920:1080", pictures: [pic, pic] });
  assert.equal(s.path, "/v1/text_to_image");
  assert.deepEqual(s.body.referenceImages.map((r) => r.tag), ["ref1", "ref2"]);
  const u = buildRequest({ kind: "still_upscale", model: "magnific_precision_upscaler_v2", scale: 2, pictures: [pic] });
  assert.deepEqual(Object.keys(u.body).sort(), ["imageUri", "model", "scaleFactor"]);
});

test("a task answer is read field by field; odd costs are not costs", () => {
  const t = readTask({ id: "d2e3d1f4-1b3c-4b5c-8d46-1c1d7ee86892", status: "SUCCEEDED", output: ["https://x.test/a.mp4", 5], cost: { credits: 25 } });
  assert.equal(t.status, "SUCCEEDED");
  assert.deepEqual(t.output, ["https://x.test/a.mp4"]);
  assert.equal(t.cost, 25);
  assert.equal(readTask({ id: "../x", status: "WAT" }).id, null);
  assert.equal(readTask({ status: "WAT" }).status, "UNKNOWN");
  assert.equal(readTask({ cost: { credits: -5 } }).cost, null);
  assert.equal(readTask({ cost: { credits: "25" } }).cost, null);
  assert.equal(readTask({ cost: { credits: 1e15 } }).cost, MAX_CREDITS);
  assert.equal(readTask({ cost: { credits: 0 } }).costZero, true);
  assert.equal(readTask({ progress: 7 }).progress, 1);
  assert.equal(credits(2.2), 3);
  assert.equal(readTask(null).status, "UNKNOWN");
});

test("failure codes: moderation is refused, a bad file is bad input, the rest failed", () => {
  for (const c of ["SAFETY.INPUT.IMAGE", "SAFETY.OUTPUT.VIDEO", "INTERNAL.BAD_OUTPUT.01", "INPUT_PREPROCESSING.SAFETY.TEXT"]) assert.equal(failureKind(c), "refused", c);
  assert.equal(failureKind("ASSET.INVALID"), "bad_input");
  for (const c of ["INPUT_PREPROCESSING.INTERNAL", "THIRD_PARTY.UNAVAILABLE", "INTERNAL", null]) assert.equal(failureKind(c), "failed");
});

test("failure codes about the picture (T49f N4): image safety codes and ASSET.*; never the words or the output", () => {
  for (const c of ["SAFETY.INPUT.IMAGE", "INPUT_PREPROCESSING.SAFETY.IMAGE", "SAFETY.INPUT.IMAGE.01", "ASSET.INVALID", "ASSET.TOO_LARGE", "SAFETY.INPUT"]) {
    assert.equal(pictureFailure(c), true, c);
  }
  for (const c of ["SAFETY.INPUT.TEXT", "INPUT_PREPROCESSING.SAFETY.TEXT", "SAFETY.OUTPUT.VIDEO", "INTERNAL.BAD_OUTPUT.01", "INPUT_PREPROCESSING.INTERNAL",
    "THIRD_PARTY.UNAVAILABLE", "INTERNAL", null, 5]) assert.equal(pictureFailure(c), false, String(c));
});

test("the key and its pieces are scrubbed from Runway's text, in any letter case", () => {
  const text = `bad ${KEY} and ${KEY.toUpperCase()} and ${KEY.slice(0, 12)}… and …${KEY.slice(-12)} and ${encodeURIComponent(KEY)}\n\x07`;
  const out = scrub(text, KEY, 1000);
  assert.equal(holdsKey(out, KEY), false);
  assert.ok(!out.toLowerCase().includes(KEY.slice(4, 16)));
  assert.ok(!/[\x00-\x1f]/.test(out));
  assert.equal(scrub("x".repeat(500), KEY).length, 300);
  assert.equal(errorText({ error: `no ${KEY}`, issues: [{ message: "Assets must use an approved type" }] }, KEY), "no [removed]: Assets must use an approved type");
});

// ---- the ledger -------------------------------------------------------------------------
const reserve = (l, at, job, est, extra = {}) => l.reserve(at, { job, batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: est, ...extra });

test("the ledger appends, reads back in order and totals by job", () => {
  const dir = folder();
  const l = createLedger(join(dir, "doors", "ledger.jsonl"));
  const at = "2026-11-12T10:00:00.000Z";
  reserve(l, at, "g1", 25);
  l.note(at, l.job("g1"), { credits: 40, runwayTask: "t-1" });
  reserve(l, at, "g2", 25);
  l.settle(at, l.job("g2"), { state: "released", credits: 99, verdict: "not_started_401" });
  reserve(l, at, "g3", 10);
  l.settle(at, l.job("g3"), { state: "spent", credits: 12, verdict: "done" });
  const r = readLedger(l.path);
  assert.ok(r.ok);
  assert.deepEqual(r.lines.map((x) => x.state), ["reserved", "reserved", "reserved", "released", "reserved", "spent"]);
  const t = l.totals(Date.parse(at));
  assert.equal(t.day, 40 + 0 + 12);
  assert.equal(t.open.length, 1);
  assert.equal(l.job("g1").runwayTask, "t-1");
});

test("a ledger that cannot be read fails closed: torn line, bad field, link, other's write bit", () => {
  const dir = folder();
  const p = join(dir, "l.jsonl");
  const l = createLedger(p);
  reserve(l, "2026-11-12T10:00:00.000Z", "g1", 25);
  const good = readFileSync(p, "utf8");
  put(p, `${good}{"at":"2026`);
  assert.equal(l.totals(Date.now()).ok, false);
  put(p, `${good}${good.replace('"estimate":25', '"estimate":-1')}`);
  assert.equal(l.totals(Date.now()).ok, false);
  put(p, `${good}not json\n`);
  assert.equal(readLedger(p).ok, false);
  put(p, good, 0o666);
  assert.equal(readLedger(p).ok, false);
  const real = put(join(dir, "real.jsonl"), good);
  const link = join(dir, "link.jsonl");
  symlinkSync(real, link);
  assert.equal(readLedger(link).ok, false);
  assert.throws(() => appendLine(link, { at: "2026-11-12T10:00:00.000Z", job: "g9", state: "reserved", credits: 1, estimate: 1, batch: null, shot: null, slug: null, kind: null, model: null, seconds: null, runwayTask: null, verdict: null }));
  assert.equal(readLedger(join(dir, "none.jsonl")).ok, true);
});

test("days and months are Asia/Kolkata's", () => {
  // 18:29 UTC is 23:59 in Kolkata; 18:31 UTC is the next day there.
  assert.equal(dayOf(Date.parse("2026-11-12T18:29:00Z")), "2026-11-12");
  assert.equal(dayOf(Date.parse("2026-11-12T18:31:00Z")), "2026-11-13");
  const line = (at, job, credits) => ({ at, job, state: "reserved", credits, estimate: credits, batch: null, shot: null, slug: "a", kind: "k", model: "m", seconds: 5, runwayTask: null, verdict: null });
  const lines = [line("2026-11-12T18:29:00Z", "a", 10), line("2026-11-12T18:31:00Z", "b", 20), line("2026-10-31T19:00:00Z", "c", 5)];
  const t = totalsOf(lines, Date.parse("2026-11-12T20:00:00Z"));
  assert.equal(t.day, 20);
  assert.equal(t.month, 35);   // 31 Oct 19:00 UTC is already 1 Nov 00:30 in Kolkata
});

test("refusals, freezes and a self-pause are counted from the ledger", () => {
  const dir = folder();
  const l = createLedger(join(dir, "l.jsonl"));
  const now = Date.parse("2026-11-12T10:00:00Z");
  const at = new Date(now - 1000).toISOString();
  for (const job of ["r1", "r2"]) {
    reserve(l, at, job, 25, { batch: "b1", shot: "s01" });
    l.settle(at, l.job(job), { state: "spent", credits: 25, verdict: "refused" });
  }
  let t = l.totals(now, { batch: "b1" });
  assert.equal(t.batchRefused, 2);
  assert.equal(t.takes("s01"), 2);
  assert.equal(t.refusedRecent, 2);
  assert.equal(t.paused, false);
  l.pause(at, "three_refusals");
  assert.equal(l.totals(now).paused, true);
  assert.equal(l.totals(now, { resumedAt: now - 10 }).paused, false);
  assert.equal(l.totals(now, { resumedAt: now - 10 }).refusedRecent, 0);
});

test("requests Runway did not start are counted by shot and in the day; a folded line is read and counts nothing", () => {
  const dir = folder();
  const p = join(dir, "l.jsonl");
  const l = createLedger(p);
  const now = Date.parse("2026-11-12T10:00:00Z");
  for (const [job, shot, status, ago] of [["n1", "s01", 400, 1000], ["n2", "s01", 429, 2000], ["n3", "s02", 401, 3000], ["n4", "s02", 404, 25 * 3600_000]]) {
    const at = new Date(now - ago).toISOString();
    reserve(l, at, job, 25, { batch: "b1", shot });
    l.settle(at, l.job(job), { state: "released", credits: 0, verdict: `not_started_${status}` });
  }
  // A 5xx is not "not started": the door cannot know, so it is spent at its estimate; a refusal at 0 is a refusal.
  reserve(l, new Date(now - 500).toISOString(), "n5", 25, { batch: "b1", shot: "s03" });
  l.settle(new Date(now - 500).toISOString(), l.job("n5"), { state: "spent", credits: 25, verdict: "unknown" });
  reserve(l, new Date(now - 400).toISOString(), "n6", 25, { batch: "b1", shot: "s03" });
  l.settle(new Date(now - 400).toISOString(), l.job("n6"), { state: "released", credits: 0, verdict: "refused" });
  const counts = (t) => [t.notStartedRecent, t.notStarted("s01"), t.notStarted("s02"), t.notStarted("s03"), t.takes("s01"), t.takes("s03"), t.batch, t.day, t.refusedRecent];
  assert.deepEqual(counts(l.totals(now, { batch: "b1" })), [3, 2, 1, 0, 0, 1, 25, 25, 1]);
  assert.deepEqual(counts(l.totals(now, { batch: "b1", resumedAt: now - 1500 })), [1, 1, 0, 0, 0, 1, 25, 25, 1]);
  assert.equal(l.totals(now, { batch: "b2" }).notStarted("s01"), 0);
  const folded = { at: new Date(now - 9 * 86400_000).toISOString(), job: null, batch: null, shot: null, slug: null, kind: null, model: null, seconds: null,
    estimate: 0, state: "folded", credits: 0, runwayTask: null, verdict: "not_started", count: 12 };
  appendLine(p, folded);
  assert.deepEqual(counts(l.totals(now, { batch: "b1" })), [3, 2, 1, 0, 0, 1, 25, 25, 1]);
  assert.equal(summarize(readLedger(p).lines).jobs.size, 6);
  const good = readFileSync(p, "utf8");
  for (const bad of [{ count: 0 }, { count: 1.5 }, { count: "12" }, { count: undefined }, { job: "g1" }, { credits: 5 }]) {
    put(p, `${good}${JSON.stringify({ ...folded, ...bad })}\n`);
    assert.equal(readLedger(p).ok, false, JSON.stringify(bad));
    assert.throws(() => appendLine(join(dir, "other.jsonl"), { ...folded, ...bad }));
  }
});

// ---- the switches, the key, batches, bytes ----------------------------------------------
test("the switches: defaults, the owner's resumedAt only when not in the future, broken is not ok", () => {
  const dir = folder();
  const p = join(dir, "state.json");
  assert.equal(readGenState(p).on, false);
  const now = Date.parse("2026-11-12T10:00:00Z");
  put(p, { version: 1, generate: { on: true, resumedAt: "2026-11-12T09:00:00Z" } });
  assert.equal(readGenState(p, now).resumedAt, Date.parse("2026-11-12T09:00:00Z"));
  put(p, { version: 1, generate: { on: true, resumedAt: "2027-01-01T00:00:00Z" } });
  assert.equal(readGenState(p, now).resumedAt, null);
  put(p, { version: 1, generate: { on: true, dailyCredits: "lots" } });
  assert.equal(readGenState(p, now).ok, false);
  put(p, { version: 1, generate: { on: true } }, 0o666);
  assert.equal(readGenState(p, now).ok, false);
});

test("the key is read only as key_ and 128 hex from a trusted file", () => {
  const dir = folder();
  const p = put(join(dir, "runway-key"), `${KEY}\n`);
  assert.equal(readRunwayKey(p), KEY);
  put(p, "key_short\n");
  assert.equal(readRunwayKey(p), null);
  put(p, `${KEY}\n`, 0o644);
  assert.equal(readRunwayKey(p), KEY);
  put(p, `${KEY}\n`, 0o620);
  assert.equal(readRunwayKey(p), null);
});

test("a batch is read only for its agent, within its dates, in its shape", () => {
  const dir = folder();
  const b = join(dir, "batches");
  mkdirSync(b, { mode: 0o700 });
  const now = Date.parse("2026-11-12T10:00:00Z");
  const good = { id: "b1", task: "t", slug: "artist", approvedAt: "2026-11-12T09:00:00Z", expiresAt: "2026-11-19T09:00:00Z", budgetCredits: 300,
    textToVideo: false, shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 } } };
  put(join(b, "b1.json"), good);
  assert.equal(readBatch(b, "b1", { slug: "artist", now }).ok, true);
  assert.equal(readBatch(b, "b1", { slug: "scout", now }).why, "other_agent");
  assert.equal(readBatch(b, "b1", { slug: "artist", now: Date.parse("2026-11-20T00:00:00Z") }).why, "expired");
  assert.equal(readBatch(b, "../b1", { slug: "artist", now }).why, "missing");
  assert.equal(readBatch(b, "b2", { slug: "artist", now }).why, "missing");
  put(join(b, "b1.json"), { ...good, expiresAt: "2026-12-30T09:00:00Z" });
  assert.equal(readBatch(b, "b1", { slug: "artist", now }).why, "expired");
  put(join(b, "b1.json"), { ...good, budgetCredits: "300" });
  assert.equal(readBatch(b, "b1", { slug: "artist", now }).why, "shape");
  put(join(b, "b1.json"), good, 0o666);
  assert.equal(readBatch(b, "b1", { slug: "artist", now }).why, "untrusted");
  chmodSync(b, 0o777);
  put(join(b, "b1.json"), good);
  assert.equal(readBatch(b, "b1", { slug: "artist", now }).why, "untrusted");
});

test("pictures and outputs are judged by their first bytes", () => {
  assert.deepEqual(sniffPicture(pngBytes(1280, 720)), { type: "image/png", ext: "png", width: 1280, height: 720 });
  const jpg = Buffer.alloc(600, 0);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(jpg, 0);
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00]).copy(jpg, 20);
  assert.deepEqual(sniffPicture(jpg), { type: "image/jpeg", ext: "jpg", width: 1280, height: 720 });
  assert.equal(sniffPicture(Buffer.from("GIF89a".padEnd(600, "x"))), null);
  assert.equal(sniffPicture(Buffer.from("<html>".padEnd(600, "x"))), null);
  assert.deepEqual(sniffOutput(mp4Bytes(), "video"), { type: "video/mp4", ext: "mp4" });
  assert.equal(sniffOutput(pngBytes(), "video"), null);
  assert.equal(sniffOutput(mp4Bytes(), "picture"), null);
});
