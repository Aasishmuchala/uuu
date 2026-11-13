// The web door's files (engine/web/state.mjs): whatever an agent sends, the owner's list of
// visits stays small and readable from its end, and a list that cannot be read whole never
// resets a cap (it counts as used up). Made-up lines in a temp folder; no network.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_VISITS, VISITS_KEEP_BYTES, VISITS_READ_BYTES, VISITS_SLACK, VISIT_URL_BYTES, rateWindow, readVisits, visitCalls, visitUrl,
  visitsFile,
} from "../state.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;
const NOW = Date.parse("2026-11-13T06:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const line = (at, extra = {}) => JSON.stringify({ at: iso(at), slug: "researcher", kind: "fetch", url: "https://site.test/", status: 200, bytes: 1, ...extra });
// A line as the door before this fix could write it: an address of lone surrogates is six bytes a character.
const fat = (at, i = 0) => line(at, { url: `${"\ud800".repeat(1000)}${i}`, status: "web_too_many", bytes: 0 });

let dir;
let file;
const put = (text, mode = 0o600) => {
  rmSync(file, { force: true, recursive: true });
  writeFileSync(file, text);
  chmodSync(file, mode);
};
const fileLines = () => readFileSync(file, "utf8").split("\n").filter(Boolean);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "web-state-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  file = join(dir, "doors", "web-visits.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ---- the address as written ---------------------------------------------------------------

test("an address is written as at most 1,024 bytes of JSON, with no lone half of a character pair", () => {
  const hostile = [
    "\ud800".repeat(1024), "\udfff\ud800".repeat(600), "\\".repeat(1024), "\"".repeat(1024), "é".repeat(1100),
    "語".repeat(1100), "😀".repeat(600), `https://a.test/${"a".repeat(5000)}`, "\u0000\u001f​‮x".repeat(300),
  ];
  for (const text of hostile) {
    const u = visitUrl(text);
    const json = JSON.stringify(u);
    assert.ok(Buffer.byteLength(json) - 2 <= VISIT_URL_BYTES, `${Buffer.byteLength(json)} bytes for ${JSON.stringify(text.slice(0, 4))}`);
    assert.equal(u, u.toWellFormed());
    assert.doesNotMatch(json, /\\u[dD][89a-fA-F]/, "JSON needs no six-byte escape for it");
  }
  assert.equal(visitUrl("\ud800abc"), "�abc");
  assert.equal(visitUrl("\\".repeat(1024)).length, 512, "a backslash counts two");
  assert.equal(visitUrl("😀".repeat(600)).length, 512, "256 characters of four bytes");
  const address = `https://a.test/${"p".repeat(1024 - 15)}`;
  assert.equal(address.length, 1024);
  assert.equal(visitUrl(address), address, "an ordinary address of 1,024 characters is kept whole");
  assert.equal(visitUrl("x\u0007y‮z﻿"), "xyz", "control and invisible characters removed");
  assert.equal(visitUrl(undefined), "");
});

// ---- reading the list ---------------------------------------------------------------------

test("the list is read whole when small, from its end when large, and not at all when it is not a plain file of ours", () => {
  assert.deepEqual(readVisits(file), { ok: true, whole: true, lines: [] }, "a missing file is an empty list");
  put("aaaa\nbbbb\ncccc\n");
  assert.deepEqual(readVisits(file), { ok: true, whole: true, lines: ["aaaa", "bbbb", "cccc"] });
  assert.deepEqual(readVisits(file, { maxBytes: 7 }), { ok: true, whole: false, lines: ["cccc"] }, "its partial first line dropped");
  assert.deepEqual(readVisits(file, { maxBytes: 3 }), { ok: true, whole: false, lines: [] });
  chmodSync(file, 0o666);
  assert.equal(readVisits(file).ok, true, "the door's own rule");
  assert.deepEqual(readVisits(file, { strict: true }), { ok: false, whole: false, lines: [] }, "the home screen's rule: others may write it");
  put("aaaa\n");
  const elsewhere = join(dir, "elsewhere.jsonl");
  writeFileSync(elsewhere, `${line(NOW)}\n`);
  rmSync(file);
  symlinkSync(elsewhere, file);
  assert.deepEqual(readVisits(file), { ok: false, whole: false, lines: [] }, "a link is never followed");
  rmSync(file);
  mkdirSync(file);
  assert.deepEqual(readVisits(file), { ok: false, whole: false, lines: [] }, "a folder is not a list");
});

test("a list larger than 8 MB still gives its newest lines", () => {
  const old = Array.from({ length: 1500 }, (_, i) => fat(NOW - 3 * DAY, i));
  put(`${[...old, line(NOW - 2000), line(NOW - 1000, { url: "https://site.test/newest" })].join("\n")}\n`);
  assert.ok(statSync(file).size > VISITS_READ_BYTES);
  const r = readVisits(file);
  assert.equal(r.ok, true);
  assert.equal(r.whole, false);
  assert.ok(r.lines.length > 1000 && r.lines.length < 1500);
  assert.equal(JSON.parse(r.lines.at(-1)).url, "https://site.test/newest");
  assert.ok(r.lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), "whole lines only");
});

// ---- what a read says about the calls (fail closed) --------------------------------------------

test("a whole list counts its calls; one that could not be read, or only its end, says what may be missing", () => {
  const lines = [line(NOW - 2 * DAY), line(NOW - HOUR), line(NOW - 60_000, { kind: "watch", status: 202 }), "not json", line(NOW + HOUR)];
  const whole = visitCalls({ ok: true, whole: true, lines }, NOW - DAY, NOW);
  assert.deepEqual(whole.calls.map((c) => [c.kind, c.t]), [["fetch", NOW - HOUR], ["watch", NOW - 60_000]], "the last day only, nothing in the future");
  assert.equal(whole.gone, null);
  assert.equal(visitCalls({ ok: false, whole: false, lines: [] }, NOW - DAY, NOW).gone, NOW, "a file that could not be read: everything up to now");
  assert.equal(visitCalls({ ok: true, whole: false, lines: lines.slice(1) }, NOW - DAY, NOW).gone, NOW - HOUR, "only its end: up to the oldest line read");
  assert.equal(visitCalls({ ok: true, whole: false, lines }, NOW - DAY, NOW).gone, null, "its end reaches back more than the day");
  assert.equal(visitCalls({ ok: true, whole: false, lines: ["not json"] }, NOW - DAY, NOW).gone, NOW, "an end with no time in it");
  const cut = (at) => JSON.stringify({ cut: typeof at === "number" ? iso(at) : at });
  assert.equal(visitCalls({ ok: true, whole: true, lines: [cut(NOW - 2 * HOUR), ...lines.slice(1)] }, NOW - DAY, NOW).gone, NOW - 2 * HOUR, "a cut today");
  assert.equal(visitCalls({ ok: true, whole: true, lines: [cut(NOW - 2 * DAY), ...lines.slice(1)] }, NOW - DAY, NOW).gone, null, "a cut before the day");
  assert.equal(visitCalls({ ok: true, whole: true, lines: [cut("soon")] }, NOW - DAY, NOW).gone, NOW, "a cut with no time it gives");
});

test("the caps are never seeded open: a list that may be missing calls of the day refuses until that day has passed", () => {
  const admitWith = (read, now = NOW) => {
    const r = rateWindow();
    r.seed(read, now);
    return r.admit("researcher", now, 60, 300);
  };
  assert.equal(admitWith({ ok: true, whole: true, lines: [line(NOW - HOUR)] }), null, "a whole list: counted, and under the caps");
  const unreadable = admitWith({ ok: false, whole: false, lines: [] });
  assert.ok(unreadable > 86_000 && unreadable <= 86_400, `${unreadable}`);
  const end = admitWith({ ok: true, whole: false, lines: [fat(NOW - 2 * HOUR), fat(NOW - HOUR)] });
  assert.ok(end > 22 * 3600 - 10 && end <= 22 * 3600, `refused until a day after the oldest line read: ${end}`);
  assert.equal(admitWith({ ok: true, whole: false, lines: [fat(NOW - 2 * DAY), fat(NOW - HOUR)] }), null, "its end reaches back a day");
  // A day after the part it could not see, calls are let through again.
  const r = rateWindow();
  r.seed({ ok: false, whole: false, lines: [] }, NOW);
  assert.notEqual(r.admit("researcher", NOW + DAY - 1000, 60, 300), null);
  assert.equal(r.admit("researcher", NOW + DAY, 60, 300), null);
  // A whole list still counts as before: one call of a cap of one.
  const w = rateWindow();
  w.seed({ ok: true, whole: true, lines: [line(NOW - 60_000)] }, NOW);
  assert.ok(w.admit("researcher", NOW, 1, 300) > 3500);
  assert.equal(w.admit("scout", NOW, 1, 300), null, "another agent has its own count");
});

// ---- writing the list -----------------------------------------------------------------------

test("the list is cut back to 5,000 lines only at 5,500, after a line giving the newest time dropped", () => {
  const v = visitsFile(file);
  put(`${Array.from({ length: MAX_VISITS + VISITS_SLACK - 2 }, (_, i) => line(NOW - 3 * DAY + i)).join("\n")}\n`);
  v.add(JSON.parse(line(NOW)));
  assert.equal(fileLines().length, MAX_VISITS + VISITS_SLACK - 1, "under 5,500: appended, nothing rewritten");
  v.add(JSON.parse(line(NOW + 1)));
  const after = fileLines();
  assert.equal(after.length, MAX_VISITS + 1);
  assert.deepEqual(JSON.parse(after[0]), { cut: iso(NOW - 3 * DAY + VISITS_SLACK - 1) }, "the newest line dropped");
  assert.equal(JSON.parse(after[1]).at, iso(NOW - 3 * DAY + VISITS_SLACK));
  assert.equal(JSON.parse(after.at(-1)).at, iso(NOW + 1));
  const ino = statSync(file).ino;
  for (let i = 2; i < 50; i += 1) v.add(JSON.parse(line(NOW + i)));
  assert.equal(statSync(file).ino, ino, "the next calls append; the file is not rewritten on each");
  assert.equal(fileLines().length, MAX_VISITS + 49);
  assert.equal(visitCalls(readVisits(file), NOW - DAY, NOW + 100).gone, null, "lines cut more than a day ago leave the day whole");
});

test("a list too big to read whole is cut back at the next line, and the cut says up to when", () => {
  const old = Array.from({ length: 1500 }, (_, i) => fat(NOW - 2 * HOUR + i));
  put(`${old.join("\n")}\n`);
  assert.ok(statSync(file).size > VISITS_READ_BYTES);
  visitsFile(file).add(JSON.parse(line(NOW, { url: "https://site.test/newest" })));
  const size = statSync(file).size;
  assert.ok(size <= VISITS_KEEP_BYTES + 4096, `${size} bytes`);
  const after = fileLines();
  const cut = Date.parse(JSON.parse(after[0]).cut);
  assert.ok(cut >= NOW - 2 * HOUR && cut < NOW - 2 * HOUR + 1500, "the newest line dropped, from the fat lines");
  assert.equal(JSON.parse(after.at(-1)).url, "https://site.test/newest");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  // The cut was within the day: a restart cannot know those calls, so the caps count as used up until a day after.
  const r = rateWindow();
  r.seed(readVisits(file), NOW);
  const wait = r.admit("researcher", NOW, 60, 300);
  assert.equal(wait, Math.ceil((cut + DAY - NOW) / 1000), `${wait}`);
  assert.ok(wait > 22 * 3600 - 10 && wait <= 22 * 3600 + 2, `${wait}`);
});

test("a list that is not a plain file is never written through, and nothing throws", () => {
  const elsewhere = join(dir, "elsewhere.jsonl");
  writeFileSync(elsewhere, "");
  symlinkSync(elsewhere, file);
  const v = visitsFile(file);
  v.add(JSON.parse(line(NOW)));
  v.add(JSON.parse(line(NOW + 1)));
  assert.equal(readFileSync(elsewhere, "utf8"), "");
  rmSync(file);
  mkdirSync(file);
  v.add(JSON.parse(line(NOW + 2)));
  assert.ok(statSync(file).isDirectory());
});

test("a line of the list stays under 1.3 KB whatever the address, so 5,500 lines fit in what is read", () => {
  const v = visitsFile(file);
  for (const url of ["\ud800".repeat(1024), "\\".repeat(4096), "語".repeat(4096), "😀".repeat(2048)]) {
    v.add({ at: iso(NOW), slug: "a".repeat(64), kind: "search", url: visitUrl(url), status: "web_private_address", bytes: 5 * MB, calls: 1e9 });
  }
  for (const l of fileLines()) assert.ok(Buffer.byteLength(l) + 1 < 1300, `${Buffer.byteLength(l)} bytes`);
  assert.ok((MAX_VISITS + VISITS_SLACK) * 1300 < VISITS_READ_BYTES);
});

test("a cut marker dated in the future counts only up to now, so it cannot shut the door for a year", () => {
  const lines = [JSON.stringify({ cut: iso(NOW + 365 * DAY) }), line(NOW - HOUR)];
  const r = visitCalls({ ok: true, whole: true, lines }, NOW - DAY, NOW);
  assert.equal(r.gone, NOW, "limited to now");
  assert.ok(r.gone <= NOW);
  assert.equal(visitCalls({ ok: true, whole: true, lines: [JSON.stringify({ cut: iso(NOW - HOUR) })] }, NOW - DAY, NOW).gone, NOW - HOUR, "a past cut is unchanged");
  assert.equal(visitCalls({ ok: true, whole: true, lines: [JSON.stringify({ cut: iso(NOW + 365 * DAY) })] }, NOW, NOW).gone, null, "nothing after now is unknown");
});
