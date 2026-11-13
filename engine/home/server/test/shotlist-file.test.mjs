// PLAN-V5 T41b, lib/shotlist.mjs: a film's shotlist read as untrusted text (C8), its cost worked out by the home
// server alone from the generation door's prices (C10), the cost and time words, the storyboard stills, and the
// owner's approval records. A broken file is one plain sentence, never a throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimate, PRICES } from "../../../generate/runway.mjs";
import {
  approvalsOf, boardsOf, checkShotlist, costWords, dollars, exactlyThere, MAX_SHOTLIST, priceShotlist, RATIOS, readShotlist,
  recordApproval, shotsHash, timeWords,
} from "../lib/shotlist.mjs";

const MODELS = { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);
const REL = "film/launch-a";

const shot = (n, extra = {}) => ({
  id: `s${String(n).padStart(2, "0")}`, render: "tower.png", seconds: 5, move: "A slow push towards the door.",
  prompt: "The camera moves slowly towards the front door in soft morning light.", kind: "image_to_video", best: false, ...extra,
});
const film = (extra = {}, shots = [1, 2, 3, 4, 5, 6].map((n) => shot(n))) => ({
  title: "The lake house at dawn", seconds: 30, ratio: "1280:720", shots,
  cards: { title: "The lake house", end: "Sthyra" }, captions: ["Morning", "Evening"], ...extra,
});

// A temp state with a goal folder STH-26 and a room holding tower.png and Lobby View (2).png.
function withState(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-shotlist-"));
  try {
    const state = join(root, "state");
    const goal = join(state, "tasks", "company-work", "STH-26");
    const room = join(state, "media", "room");
    mkdirSync(join(goal, REL), { recursive: true });
    mkdirSync(room, { recursive: true });
    writeFileSync(join(room, "tower.png"), PNG);
    writeFileSync(join(room, "Lobby View (2).png"), PNG);
    const config = { paths: { state, projectFolder: join(state, "tasks", "company-work"), research: join(state, "tasks", "research") } };
    const write = (doc, rel = REL) => writeFileSync(join(goal, rel, "shotlist.json"), typeof doc === "string" ? doc : JSON.stringify(doc));
    return fn({ config, goal, room, write, read: (opts, rel = REL) => readShotlist(config, "STH-26", rel, opts) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- reading

test("a good shotlist is read with only its own keys, each checked; other keys are dropped", () => {
  withState(({ write, read }) => {
    write({ ...film(), extra: "ignored", shots: film().shots.map((s, i) => (i ? s : { ...s, note: "dropped" })) });
    const r = read();
    assert.equal(r.ok, true, r.problem);
    assert.equal(r.problem, null);
    assert.deepEqual(Object.keys(r.shotlist), ["title", "seconds", "ratio", "shots", "cards", "captions"]);
    assert.equal(r.shotlist.shots.length, 6);
    assert.deepEqual(r.shotlist.shots[0], {
      id: "s01", render: "tower.png", seconds: 5, move: "A slow push towards the door.",
      prompt: "The camera moves slowly towards the front door in soft morning light.", kind: "image_to_video", best: false,
    });
    assert.deepEqual(r.shotlist.cards, { title: "The lake house", end: "Sthyra" });
    assert.deepEqual(r.shotlist.captions, ["Morning", "Evening"]);
  });
});

test("best absent is false; cards and captions are optional; a render with spaces and brackets is found by its exact name", () => {
  withState(({ write, read }) => {
    const { cards, captions, ...bare } = film();
    write({ ...bare, shots: [{ ...shot(1, { render: "Lobby View (2).png" }), best: undefined }] });
    const r = read();
    assert.equal(r.ok, true, r.problem);
    assert.equal(r.shotlist.shots[0].best, false);
    assert.equal(r.shotlist.cards, null);
    assert.deepEqual(r.shotlist.captions, []);
  });
});

test("a render not in the room, in another letter case, or a folder in the room: a plain problem naming the shot", () => {
  withState(({ write, read, room }) => {
    write(film({}, [shot(1), shot(2, { render: "pool.png" })]));
    assert.deepEqual(read(), { ok: false, shotlist: null, problem: 'Shot s02 in shotlist.json: the render "pool.png" is not in the room under exactly that name.' });
    write(film({}, [shot(1, { render: "Tower.png" })]));
    assert.match(read().problem, /^Shot s01 in shotlist\.json: the render "Tower\.png" is not in the room/);
    mkdirSync(join(room, "dir.png"));
    write(film({}, [shot(1, { render: "dir.png" })]));
    assert.match(read().problem, /"dir\.png" is not in the room/);
    symlinkSync(join(room, "tower.png"), join(room, "linked.png"));
    write(film({}, [shot(1, { render: "linked.png" })]));
    assert.match(read().problem, /"linked\.png" is not in the room/);
  });
});

test("a render name that is a path or has odd characters is refused without echoing it", () => {
  withState(({ write, read }) => {
    for (const render of ["../tower.png", "room/tower.png", ".hidden.png", "tower.png\n", "<b>x</b>.png", "a".repeat(101), "", 7]) {
      write(film({}, [shot(1, { render })]));
      const r = read();
      assert.equal(r.ok, false, String(render));
      assert.equal(r.problem, "Shot s01 in shotlist.json: the render must be the bare name of a file in the room (letters, digits, spaces, dots, dashes, underscores and brackets).");
    }
  });
});

test("shotlist.json as a link, a link on the way, 40 KB, missing, not JSON, not UTF-8, not an object: one plain sentence each", () => {
  withState(({ config, goal, write, read }) => {
    const outside = join(goal, "..", "outside.json");
    writeFileSync(outside, JSON.stringify(film()));
    symlinkSync(outside, join(goal, REL, "shotlist.json"));
    assert.equal(read().problem, "shotlist.json is not a plain file (it may be a link), so it cannot be read.");
    rmSync(join(goal, REL, "shotlist.json"));
    assert.equal(read().problem, "This treatment has no shotlist.json.");
    write(JSON.stringify({ ...film(), pad: "x".repeat(40 * 1024) }));
    assert.equal(read().problem, "shotlist.json is larger than 32 KB, so it cannot be read.");
    assert.equal(MAX_SHOTLIST, 32 * 1024);
    write("{ not json");
    assert.equal(read().problem, "shotlist.json is not valid JSON.");
    writeFileSync(join(goal, REL, "shotlist.json"), Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
    assert.equal(read().problem, "shotlist.json is not valid JSON.");
    write("[1, 2]");
    assert.equal(read().problem, "shotlist.json does not hold one JSON object.");
    // A treatment folder that is a link.
    mkdirSync(join(goal, "elsewhere"), { recursive: true });
    writeFileSync(join(goal, "elsewhere", "shotlist.json"), JSON.stringify(film()));
    symlinkSync(join(goal, "elsewhere"), join(goal, "film", "launch-b"));
    assert.equal(readShotlist(config, "STH-26", "film/launch-b").problem, "shotlist.json is not a plain file (it may be a link), so it cannot be read.");
    // A place that is not a plain path, or a goal that is not there.
    for (const rel of ["../STH-26/film/launch-a", "/etc", "film/../film/launch-a", "", null]) {
      assert.equal(readShotlist(config, "STH-26", rel).ok, false);
    }
    assert.equal(readShotlist(config, "STH-99", REL).problem, "This treatment has no shotlist.json.");
  });
});

test("a 13th shot, no shot, seconds 11 or 1.5, an id s1 or out of order: a plain problem, no throw", () => {
  withState(({ write, read }) => {
    write(film({}, Array.from({ length: 13 }, (_, i) => shot(i + 1, { seconds: 2 }))));
    assert.equal(read().problem, "The shotlist must have 1 to 12 shots.");
    write(film({}, []));
    assert.equal(read().problem, "The shotlist must have 1 to 12 shots.");
    write(film({}, [shot(1), shot(2, { seconds: 11 })]));
    assert.equal(read().problem, "Shot s02 in shotlist.json: seconds must be a whole number from 2 to 10.");
    write(film({}, [shot(1, { seconds: 1.5 })]));
    assert.equal(read().problem, "Shot s01 in shotlist.json: seconds must be a whole number from 2 to 10.");
    write(film({}, [{ ...shot(1), id: "s1" }]));
    assert.equal(read().problem, "Shot number 1 in shotlist.json must have the id s01; shots are numbered s01, s02 and on, in order.");
    write(film({}, [shot(1), shot(3)]));
    assert.equal(read().problem, "Shot number 2 in shotlist.json must have the id s02; shots are numbered s01, s02 and on, in order.");
    write(film({}, [shot(1), "s02"]));
    assert.equal(read().problem, "Shot number 2 in shotlist.json is not a list of its fields.");
  });
});

test("a 1001-character prompt, a prompt with a control character or only spaces is refused; a line break is allowed", () => {
  withState(({ write, read }) => {
    const bad = "Shot s01 in shotlist.json: the prompt must be 1 to 1000 characters with no control characters but line breaks.";
    for (const prompt of ["x".repeat(1001), "Slow push\u0007 in", "Tab\there", "CR\rhere", "   ", "", null, "Line sep"]) {
      write(film({}, [shot(1, { prompt })]));
      assert.equal(read().problem, bad, JSON.stringify(prompt));
    }
    write(film({}, [shot(1, { prompt: `${"x".repeat(980)}\nSoft light` })]));
    assert.equal(read().ok, true);
    write(film({}, [shot(1, { prompt: "x".repeat(1000) })]));
    assert.equal(read().ok, true);
  });
});

test("text_to_video only with allowWords, and then it needs no render in the room", () => {
  withState(({ write, read }) => {
    write(film({}, [shot(1), shot(2, { kind: "text_to_video", render: undefined })]));
    assert.equal(read().problem, "Shot s02 in shotlist.json: it is made from words alone, and this task does not allow shots from words alone.");
    assert.equal(read({ allowWords: "Yes" }).ok, false, "only the value true allows it");
    const r = read({ allowWords: true });
    assert.equal(r.ok, true, r.problem);
    assert.equal(r.shotlist.shots[1].render, null);
    write(film({}, [shot(1, { kind: "text_to_video", render: "not-in-room.png" })]));
    assert.equal(read({ allowWords: true }).ok, true, "a named render is not looked for in a shot from words");
    write(film({}, [shot(1, { kind: "video_to_video" })]));
    assert.equal(read({ allowWords: true }).problem, "Shot s01 in shotlist.json: the kind must be image_to_video or text_to_video.");
  });
});

test("the film's title, seconds, ratio, total, move, best, cards and captions are each checked", () => {
  const no = (doc) => checkShotlist(doc, { inRoom: () => true }).problem;
  assert.equal(no(film({ title: "" })), "The shotlist's title must be 1 to 120 characters on one line.");
  assert.equal(no(film({ title: "a\nb" })), "The shotlist's title must be 1 to 120 characters on one line.");
  assert.equal(no(film({ title: "x".repeat(121) })), "The shotlist's title must be 1 to 120 characters on one line.");
  assert.equal(no(film({ seconds: 4 })), "The shotlist's seconds must be a whole number from 5 to 120.");
  assert.equal(no(film({ seconds: 121 })), "The shotlist's seconds must be a whole number from 5 to 120.");
  assert.equal(no(film({ ratio: "16:9" })), "The shotlist's ratio must be one of 1280:720, 720:1280, 1104:832, 832:1104, 960:960 and 1584:672.");
  assert.equal(no(film({ seconds: 120 }, Array.from({ length: 12 }, (_, i) => shot(i + 1, { seconds: 10 })))), null, "twelve shots of 10 seconds, 120 in all");
  assert.equal(no(film({}, [shot(1, { move: "" })])), null, "a shot may have no move");
  assert.equal(no(film({}, [shot(1, { move: undefined })])), "Shot s01 in shotlist.json: the move must be one line of at most 200 characters.");
  assert.equal(no(film({}, [shot(1, { move: "a\nb" })])), "Shot s01 in shotlist.json: the move must be one line of at most 200 characters.");
  assert.equal(no(film({}, [shot(1, { move: "x".repeat(201) })])), "Shot s01 in shotlist.json: the move must be one line of at most 200 characters.");
  assert.equal(no(film({}, [shot(1, { best: "yes" })])), "Shot s01 in shotlist.json: best must be true or false.");
  assert.equal(no(film({ cards: { title: "x".repeat(121) } })), "The shotlist's cards must be a title and an end of at most 120 characters each, on one line.");
  assert.equal(no(film({ cards: "Sthyra" })), "The shotlist's cards must be a title and an end of at most 120 characters each, on one line.");
  assert.equal(no(film({ captions: Array(25).fill("a") })), "The shotlist's captions must be at most 24, each of at most 120 characters on one line.");
  assert.equal(no(film({ captions: ["x".repeat(121)] })), "The shotlist's captions must be at most 24, each of at most 120 characters on one line.");
  assert.deepEqual(RATIOS, ["1280:720", "720:1280", "1104:832", "832:1104", "960:960", "1584:672"]);
});

test("the shots' seconds and the film's own seconds are checked apart: a short film of long shots reads as written", () => {
  // The rule "at most 120 in all" is met by any twelve shots of at most 10 seconds; what the owner sees is the
  // shots' own sum, never the film's `seconds` field.
  const r = checkShotlist(film({ seconds: 5 }, [shot(1, { seconds: 10 }), shot(2, { seconds: 10 })]), { inRoom: () => true });
  assert.equal(r.ok, true);
  assert.equal(costWords(priceShotlist(r.shotlist, MODELS), { daily: 300 }),
    "2 clips, 20 seconds: about 100 credits ($1.00), up to 200 with one retake each. Today's limit: 300.");
});

test("hostile values never throw", () => {
  withState(({ write, read }) => {
    for (const doc of ["null", "true", "1", '"x"', "{}", '{"shots":{}}', '{"title":"a","seconds":30,"ratio":"1280:720","shots":[null]}',
      '{"title":"a","seconds":30,"ratio":"1280:720","shots":[{"id":"s01","kind":"image_to_video","render":{"toString":1}}]}',
      `{"__proto__":{"title":"x"},"title":"a"}`]) {
      write(doc);
      assert.doesNotThrow(() => read());
      assert.equal(read().ok, false, doc);
      assert.equal(typeof read().problem, "string");
    }
  });
  for (const v of [undefined, null, 1, "x", [], {}, { shots: "x" }]) {
    assert.doesNotThrow(() => checkShotlist(v));
    assert.doesNotThrow(() => priceShotlist(v, MODELS));
    assert.doesNotThrow(() => costWords(v));
  }
});

// ---- the price

test("priced with the door's own estimate: gen4_turbo for plain shots, the best model for best and for words alone", () => {
  const p = priceShotlist(film(), MODELS);
  assert.equal(p.ok, true);
  assert.deepEqual(p.shots[0], { id: "s01", kind: "image_to_video", model: "gen4_turbo", seconds: 5, credits: 25 });
  assert.equal(p.base, 150);
  assert.equal(p.most, 300);
  assert.equal(p.base, film().shots.reduce((n, s) => n + estimate({ kind: s.kind, model: "gen4_turbo", seconds: s.seconds }), 0));
  const mixed = priceShotlist(film({}, [shot(1, { best: true }), shot(2, { kind: "text_to_video" }), shot(3, { seconds: 10 })]), MODELS);
  assert.deepEqual(mixed.shots.map((s) => [s.id, s.model, s.credits]), [["s01", "gen4.5", 60], ["s02", "gen4.5", 60], ["s03", "gen4_turbo", 50]]);
  assert.equal(PRICES["gen4.5"].perSecond * 5, 60);
});

test("a number the agent wrote is never the price", () => {
  const p = priceShotlist(film({ credits: 1, cost: 1, budget: 1 }, [shot(1, { credits: 1, estimate: 1 })]), MODELS);
  assert.equal(p.base, 25);
  assert.equal(p.most, 50);
});

test("no price for the model chosen in Settings: a plain problem naming the model", () => {
  assert.equal(priceShotlist(film(), { ...MODELS, video: "gen9_dream" }).problem, "The door has no price for gen9_dream, the model chosen in Settings.");
  assert.equal(priceShotlist(film({}, [shot(1, { best: true })]), { ...MODELS, videoBest: "gen4_image" }).problem,
    "The door has no price for gen4_image, the model chosen in Settings.");
  // Words alone on a model that only makes clips from a picture.
  assert.equal(priceShotlist(film({}, [shot(1, { kind: "text_to_video" })]), { ...MODELS, videoBest: "gen4_turbo" }).problem,
    "The door has no price for gen4_turbo, the model chosen in Settings.");
  assert.equal(priceShotlist(film(), { ...MODELS, video: "<script>" }).problem, "The door has no price for no model, the model chosen in Settings.");
  assert.equal(priceShotlist(film(), null).ok, false);
});

test("cost words: the three vectors of the plan", () => {
  const six = priceShotlist(film(), MODELS);
  assert.equal(costWords(six, { daily: 300 }), "6 clips, 30 seconds: about 150 credits ($1.50), up to 300 with one retake each. Today's limit: 300.");
  const three = priceShotlist(film({}, [shot(1, { best: true }), shot(2, { best: true }), shot(3, { seconds: 10 })]), MODELS);
  assert.equal(three.base, 170);
  assert.equal(three.most, 340);
  assert.equal(costWords(three, { daily: 300 }), "3 clips, 20 seconds: about 170 credits ($1.70), up to 340 with one retake each. Today's limit: 300.");
  const one = priceShotlist(film({}, [shot(1, { seconds: 2 })]), MODELS);
  assert.equal(costWords(one, { daily: 300 }), "1 clip, 2 seconds: about 10 credits ($0.10), up to 20 with one retake. Today's limit: 300.");
});

test("cost words: when only the retakes pass what is left today, or this month, it says so", () => {
  const six = priceShotlist(film(), MODELS);
  assert.equal(costWords(six, { daily: 300, dayLeft: 260, monthLeft: 960 }),
    "6 clips, 30 seconds: about 150 credits ($1.50), up to 300 with one retake each. Today's limit: 300. Retakes may stop at today's limit.");
  assert.equal(costWords(six, { daily: 300, dayLeft: 300, monthLeft: 200 }),
    "6 clips, 30 seconds: about 150 credits ($1.50), up to 300 with one retake each. Today's limit: 300. Retakes may stop at this month's limit.");
  assert.equal(costWords(six, { daily: 300, dayLeft: 300, monthLeft: 300 }),
    "6 clips, 30 seconds: about 150 credits ($1.50), up to 300 with one retake each. Today's limit: 300.");
  assert.equal(costWords(six, { daily: 300, dayLeft: 100 }), "6 clips, 30 seconds: about 150 credits ($1.50), up to 300 with one retake each. Today's limit: 300.",
    "over even without retakes: the card says so in its own place");
});

test("time words: two to five minutes a clip, each end rounded to 5, the low end at least 5", () => {
  assert.equal(timeWords(6), "Runway takes a few minutes a clip: about 10 to 30 minutes for 6 clips, then the edit and the checks.");
  assert.equal(timeWords(3), "Runway takes a few minutes a clip: about 5 to 15 minutes for 3 clips, then the edit and the checks.");
  assert.equal(timeWords(12), "Runway takes a few minutes a clip: about 25 to 60 minutes for 12 clips, then the edit and the checks.");
  assert.equal(timeWords(1), "Runway takes a few minutes a clip: about 5 minutes for 1 clip, then the edit and the checks.");
});

test("dollars: one credit is one US cent", () => {
  assert.equal(dollars(150), "$1.50");
  assert.equal(dollars(0), "$0.00");
  assert.equal(dollars(8), "$0.08");
  assert.equal(dollars(100000), "$1000.00");
  assert.equal(dollars(-5), "$0.00");
  assert.equal(dollars(NaN), "$0.00");
});

test("the priced shots' hash changes with any shot's model, seconds or credits, and not with anything else", () => {
  const a = priceShotlist(film(), MODELS).shots;
  assert.match(shotsHash(a), /^[0-9a-f]{64}$/);
  assert.equal(shotsHash(a), shotsHash(a.map((s) => ({ credits: s.credits, seconds: s.seconds, model: s.model, kind: s.kind, id: s.id }))));
  assert.notEqual(shotsHash(a), shotsHash(a.map((s, i) => (i ? s : { ...s, seconds: 6, credits: 30 }))));
  assert.notEqual(shotsHash(a), shotsHash(a.map((s, i) => (i ? s : { ...s, model: "gen4.5" }))));
  assert.notEqual(shotsHash(a), shotsHash(a.slice(1)));
});

// ---- the storyboard stills

test("boards: shot-NN.png in exactly that letter case and starting as a PNG, for the shots named, through /api/view", () => {
  withState(({ config, goal }) => {
    const board = join(goal, REL, "board");
    mkdirSync(board, { recursive: true });
    writeFileSync(join(board, "shot-01.png"), PNG);
    writeFileSync(join(board, "shot-02.png"), Buffer.from("not a picture at all, just words in a file"));
    writeFileSync(join(board, "SHOT-03.png"), PNG);
    writeFileSync(join(goal, "elsewhere.png"), PNG);
    symlinkSync(join(goal, "elsewhere.png"), join(board, "shot-04.png"));
    writeFileSync(join(board, "shot-05.png"), PNG);
    writeFileSync(join(board, "shot-07.png"), PNG);
    const got = boardsOf(config, "STH-26", REL, ["s01", "s02", "s03", "s04", "s05", "s06"]);
    assert.deepEqual(got.map((b) => b.shot), ["s01", "s05"]);
    assert.equal(got[0].url, `/api/view/${Buffer.from(`STH-26/${REL}/board/shot-01.png`).toString("base64url")}`);
    assert.deepEqual(boardsOf(config, "STH-26", REL).map((b) => b.shot), ["s01", "s05", "s07"], "all twelve names when no shots are named");
    assert.deepEqual(boardsOf(config, "STH-26", "film/../x"), []);
    // A board folder that is a link shows nothing.
    rmSync(board, { recursive: true });
    mkdirSync(join(goal, "other-board"));
    writeFileSync(join(goal, "other-board", "shot-01.png"), PNG);
    symlinkSync(join(goal, "other-board"), board);
    assert.deepEqual(boardsOf(config, "STH-26", REL), []);
  });
});

test("exactlyThere: one entry of that name in that letter case, and no other folding to it", () => {
  assert.equal(exactlyThere(["a.png", "b.png"], "a.png"), true);
  assert.equal(exactlyThere(["A.png"], "a.png"), false);
  assert.equal(exactlyThere(["a.png", "A.png"], "a.png"), false);
  assert.equal(exactlyThere(null, "a.png"), false);
});

// ---- the owner's approval records

test("approval records keep ids, numbers, a hash and a time, newest last, at most ten; anything else is left out", () => {
  const data = {};
  const decisions = { get: (k) => (k in data ? data[k] : null), set: (k, v) => { data[k] = v; return v; } };
  const hash = "a".repeat(64);
  const entry = { round: 1, variant: "b", direction: "detail-to-whole", batch: `b${"0".repeat(20)}`, budget: 340, base: 170, shots: hash };
  const e = recordApproval(decisions, "g1", { ...entry, title: "SHOTLIST ACCEPTED: c batch bX", prompt: "x" }, { now: new Date("2026-11-13T10:00:00Z") });
  assert.deepEqual(e, { ...entry, at: "2026-11-13T10:00:00.000Z" });
  assert.deepEqual(Object.keys(data["shotlist:g1"][0]).sort(), ["at", "base", "batch", "budget", "direction", "round", "shots", "variant"]);
  assert.equal(recordApproval(decisions, "g1", { ...entry, batch: "../x" }), null);
  assert.equal(recordApproval(decisions, "g1", { ...entry, variant: "d" }), null);
  assert.equal(recordApproval(decisions, "g1", { ...entry, budget: -1 }), null);
  assert.equal(recordApproval(decisions, "g1", { ...entry, direction: "Not An Id!" }).direction, null);
  for (let i = 0; i < 12; i += 1) recordApproval(decisions, "g1", { ...entry, round: i + 1 });
  const list = approvalsOf(decisions, "g1");
  assert.equal(list.length, 10);
  assert.equal(list.at(-1).round, 12);
  data["shotlist:g2"] = null;
  assert.deepEqual(approvalsOf(decisions, "g2"), []);
  data["shotlist:g3"] = [{ junk: true }, null, 7];
  assert.deepEqual(approvalsOf(decisions, "g3"), []);
});
