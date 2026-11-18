// Runway by sign-in, the home side (PLAN-ONBOARD R2): the view's `runwayAccount` block in its four states, the switch's
// new rule (a saved key or a sign-in), the owner's rate, and the four routes that pass the sign-in along to the
// generation door (begin, the return address, forget, Test). The door is a made-up one on 127.0.0.1 port 0 that
// answers as each test says and keeps what it saw: nothing here reaches Runway or a live door. Every key, code and
// state is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RW_ACCOUNT_DEFAULTS, ensureSecret, runwayAccountBlock } from "../../../doors/common.mjs";
import { checkDoors, freshDoors, readDoors, saveDoorKey, updateDoors } from "../lib/doors.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import {
  BLOCKER_SENTENCES, RW_BACK_CONNECTED, RW_BACK_FAILED, RW_NO_WAY_IN, RW_ORIGIN, RW_SENTENCES, RW_TEST_SENTENCES,
} from "../routes/generation.mjs";

const KEY = `key_${randomBytes(64).toString("hex")}`;
const STATE_HEX = "cd".repeat(32);
const CODE = `rw_${randomBytes(24).toString("hex")}`;
const HEALTH = { status: "ok", part: "generate", on: false, key: false, higgsfield: false };

// A made-up door on 127.0.0.1 that answers as `answers` says (by path; a function is called with the body), and keeps
// what it saw, with whether it carried a token.
async function fakeDoor(answers = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      let a = answers[req.url] || { status: 404, body: { code: "gen_not_found" } };
      if (typeof a === "function") a = a(body ? JSON.parse(body) : null);
      res.writeHead(a.status, { "content-type": "application/json" });
      res.end(JSON.stringify(a.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, seen,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

// A stub home with the Generation routes and, unless `answers` is null, the made-up door as its generation door.
async function withHome(fn, { answers = {}, origin } = {}) {
  const logs = [];
  const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  const door = answers === null ? null : await fakeDoor(answers);
  try {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    ensureSecret(h.config.paths.generateSecret);
    if (door) h.app.home.urls.generate = door.url;
    if (origin !== undefined) h.app.home.runwayOrigin = origin;
    return await fn({ h, door, logs });
  } finally {
    await h.close();
    if (door) await door.close();
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/generation")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const fileGen = (h) => JSON.parse(readFileSync(h.config.paths.doorsState, "utf8")).generate;

function writeStatus(config, status) {
  mkdirSync(dirname(config.paths.generateStatus), { recursive: true, mode: 0o700 });
  rmSync(config.paths.generateStatus, { force: true });
  writeFileSync(config.paths.generateStatus, JSON.stringify({ higgsfield: { signedIn: false, refused: false }, apps: {}, ...status }), { mode: 0o600 });
}

// ---- the switches file keeps the rate -------------------------------------------------------------------------

test("runwayAccount: only { centsPerCredit } whole from 1 to 50; missing is 3 and is not written; any other key or kind is refused", () => {
  assert.deepEqual(RW_ACCOUNT_DEFAULTS, { centsPerCredit: 3 });
  assert.deepEqual(runwayAccountBlock(undefined), { centsPerCredit: 3 });
  assert.deepEqual(runwayAccountBlock({}), { centsPerCredit: 3 });
  assert.deepEqual(runwayAccountBlock({ centsPerCredit: 50 }), { centsPerCredit: 50 });
  const base = freshDoors();
  assert.equal(Object.hasOwn(base.generate, "runwayAccount"), false, "a fresh file has no block");
  assert.equal(Object.hasOwn(checkDoors(base).generate, "runwayAccount"), false, "nor does a checked one without it");
  const set = (v) => { const s = structuredClone(base); s.generate.runwayAccount = v; return checkDoors(s); };
  assert.deepEqual(set({ centsPerCredit: 7 }).generate.runwayAccount, { centsPerCredit: 7 });
  assert.deepEqual(set({}).generate.runwayAccount, { centsPerCredit: 3 });
  assert.equal(Object.hasOwn(set(null).generate, "runwayAccount"), false);
  for (const bad of [{ centsPerCredit: 0 }, { centsPerCredit: 51 }, { centsPerCredit: 2.5 }, { centsPerCredit: "3" }, { centsPerCredit: 3, on: true },
    { token: "x" }, [], "3", 3]) {
    assert.equal(set(bad), null, JSON.stringify(bad));
  }
});

test("a damaged runwayAccount block in the file is the whole file unreadable: every door off; the next save writes a fresh one", async () => {
  await withHome(async ({ h }) => {
    updateDoors(h.config, (s) => { s.generate.runwayAccount = { centsPerCredit: 4 }; s.generate.higgsfield = { on: true, centsPerCredit: 9 }; });
    assert.deepEqual(fileGen(h).runwayAccount, { centsPerCredit: 4 });
    let r = await post(h, "/api/generation/caps", { daily: 500 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(fileGen(h).runwayAccount, { centsPerCredit: 4 }, "another save keeps it");
    assert.equal(r.json.runwayAccount.centsPerCredit, 4);
    const raw = JSON.parse(readFileSync(h.config.paths.doorsState, "utf8"));
    raw.generate.runwayAccount.extra = 1;
    rmSync(h.config.paths.doorsState);
    writeFileSync(h.config.paths.doorsState, JSON.stringify(raw), { mode: 0o600 });
    assert.equal(readDoors(h.config).problem, "state_unreadable");
    const v = await view(h);
    assert.deepEqual([v.problem, v.on, v.runwayAccount.centsPerCredit], ["state_unreadable", false, 3]);
    r = await post(h, "/api/generation/runway/rate", { centsPerCredit: 5 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(fileGen(h).runwayAccount, { centsPerCredit: 5 });
    assert.deepEqual(fileGen(h).higgsfield, { on: false, centsPerCredit: 5 }, "the fresh file: Higgsfield back to off");
  }, { answers: null });
});

// ---- the view ------------------------------------------------------------------------------------------------------

test("the view: the four states of the sign-in, in the plan's words; `used` only with a sign-in and no key; the shape kept", async () => {
  await withHome(async ({ h }) => {
    // A door from before the sign-in: its status names no `runway`. The key is the only way in, said as today.
    let v = await view(h);
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    assert.deepEqual(v.runwayAccount, { signedIn: false, refused: false, centsPerCredit: 3, sentence: "Not signed in to Runway.", used: false });
    assert.deepEqual([v.blockers[0], v.whyNot], ["no_key", BLOCKER_SENTENCES.no_key]);
    assert.equal(BLOCKER_SENTENCES.no_key, "Paste your Runway key first.");
    // The door says it is not signed in: the refusal names both ways in.
    writeStatus(h.config, { runway: { signedIn: false, refused: false } });
    v = await view(h);
    assert.deepEqual([v.runwayAccount.sentence, v.runwayAccount.used, v.blockers[0], v.whyNot],
      ["Not signed in to Runway.", false, "no_key", "Save a Runway key or sign in to Runway first."]);
    assert.equal(RW_NO_WAY_IN, "Save a Runway key or sign in to Runway first.");
    // Signed in, no key: the sign-in is the way in, and no_key is no longer a blocker.
    writeStatus(h.config, { runway: { signedIn: true, refused: false } });
    v = await view(h);
    assert.deepEqual(v.runwayAccount, { signedIn: true, refused: false, centsPerCredit: 3, sentence: "Signed in to Runway.", used: true });
    assert.ok(!v.blockers.includes("no_key"), JSON.stringify(v.blockers));
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    // Signed in and a key saved: the key is used.
    saveDoorKey(h.config, "runway", KEY);
    v = await view(h);
    assert.deepEqual([v.runwayAccount.signedIn, v.runwayAccount.used, v.key.saved], [true, false, true]);
    assert.ok(!JSON.stringify(v).includes(KEY.slice(4, 30)));
    // Runway asked to sign in again.
    rmSync(h.config.paths.runwayKey);
    writeStatus(h.config, { runway: { signedIn: false, refused: true } });
    v = await view(h);
    assert.deepEqual(v.runwayAccount, { signedIn: false, refused: true, centsPerCredit: 3, sentence: "Runway asked you to sign in again.", used: false });
    assert.equal(v.whyNot, RW_NO_WAY_IN);
    assert.deepEqual(RW_SENTENCES, { signedOut: "Not signed in to Runway.", signedIn: "Signed in to Runway.", refused: "Runway asked you to sign in again." });
  }, { answers: null });
});

test("the view: the door's health says now whether it is signed in; a refused status file is never signed in", async () => {
  await withHome(async ({ h, door }) => {
    let v = await view(h);
    assert.deepEqual([v.door.state, v.runwayAccount.signedIn, v.runwayAccount.used], ["on", true, true]);
    assert.equal(door.seen.filter((s) => s.url === "/gen/health").every((s) => s.auth === null), true, "health is asked without a token");
    writeStatus(h.config, { runway: { signedIn: false, refused: true } });
    v = await view(h);
    assert.deepEqual([v.runwayAccount.signedIn, v.runwayAccount.refused], [false, true]);
  }, { answers: { "/gen/health": { status: 200, body: { ...HEALTH, runway: true } } } });
});

// ---- the switch's new rule -------------------------------------------------------------------------------------

test("the switch: no key and signed in may be switched on; neither is refused with the new sentence and nothing is written", async () => {
  await withHome(async ({ h }) => {
    writeStatus(h.config, { runway: { signedIn: false, refused: false } });
    let r = await post(h, "/api/generation/switch", { on: true });
    assert.equal(r.status, 409);
    assert.deepEqual([r.json.error.code, r.json.error.next, r.json.error.blockers], ["cannot_switch_on", RW_NO_WAY_IN, ["no_key"]]);
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    writeStatus(h.config, { runway: { signedIn: true, refused: false } });
    r = await post(h, "/api/generation/switch", { on: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.on, r.json.runwayAccount.used, r.json.key.saved], [true, true, false]);
    assert.equal(fileGen(h).on, true);
    assert.equal(fileGen(h).autoUnderCredits, 0);
  }, { answers: { "/gen/health": { status: 200, body: { ...HEALTH } } } });
});

// ---- the rate ----------------------------------------------------------------------------------------------------

test("the rate: whole cents from 1 to 50 are saved; 0, 51, 2.5, \"3\" and anything else are 400 bad_rate and nothing is written", async () => {
  await withHome(async ({ h, logs }) => {
    for (const bad of [{ centsPerCredit: 0 }, { centsPerCredit: 51 }, { centsPerCredit: 2.5 }, { centsPerCredit: "3" }, { centsPerCredit: null }, {},
      { centsPerCredit: 3, on: true }, { rate: 3 }]) {
      const r = await post(h, "/api/generation/runway/rate", bad);
      assert.deepEqual([r.status, r.json.error.code], [400, "bad_rate"], JSON.stringify(bad));
      assert.equal(r.json.error.message, "One Runway account credit must count as a whole number of cents from 1 to 50.");
    }
    assert.equal(existsSync(h.config.paths.doorsState), false);
    for (const rate of [1, 50, 3]) {
      const r = await post(h, "/api/generation/runway/rate", { centsPerCredit: rate });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.runwayAccount.centsPerCredit, rate);
      assert.deepEqual(fileGen(h).runwayAccount, { centsPerCredit: rate });
    }
    assert.deepEqual([fileGen(h).on, fileGen(h).higgsfield], [false, { on: false, centsPerCredit: 5 }], "nothing else changed");
    assert.ok(logs.includes("generation: one Runway account credit now counts as 3 cents"));
  }, { answers: null });
});

// ---- the sign-in -------------------------------------------------------------------------------------------------

test("begin: the door's address on Runway's sign-in page is passed on whole; any other address is refused and not sent back", async () => {
  const S = `http:${"/"}${"/"}`;
  await withHome(async ({ h, door }) => {
    const r = await post(h, "/api/generation/runway/begin");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json), ["url"]);
    assert.ok(r.json.url.startsWith(`${S}127.0.0.1:9/authorize?`));
    const begun = door.seen.filter((s) => s.url === "/gen/owner/runway/begin");
    assert.equal(begun.length, 1);
    assert.match(begun[0].auth, /^Bearer \S+$/, "the owner's token");
    assert.equal(begun[0].method, "POST");
  }, { origin: `${S}127.0.0.1:9`, answers: { "/gen/owner/runway/begin": { status: 200, body: { url: `${S}127.0.0.1:9/authorize?response_type=code&state=${STATE_HEX}` } } } });
  const T = `https:${"/"}${"/"}`;
  for (const url of [`${T}evil.example/authorize?x=1`, `${RW_ORIGIN}.evil.example/authorize?x=1`, `${RW_ORIGIN}/token?x=1`, `${RW_ORIGIN}/authorize`,
    `${RW_ORIGIN}@evil.example/authorize?x=1`, `${S}127.0.0.1:1/authorize?x=1`, `${RW_ORIGIN}/authorize?${"a".repeat(5000)}`, 42, null]) {
    await withHome(async ({ h }) => {
      const r = await post(h, "/api/generation/runway/begin");
      assert.deepEqual([r.status, r.json.error.code], [502, "runway_failed"], String(url).slice(0, 80));
      assert.equal(r.json.url, undefined);
      assert.ok(!r.text.includes("evil") && !r.text.includes("127.0.0.1:1"), "the address is never sent back");
    }, { origin: `${S}127.0.0.1:9`, answers: { "/gen/owner/runway/begin": { status: 200, body: { url } } } });
  }
  // Without a test origin (or with one that is not a loopback address), only Runway's own sign-in page passes.
  const good = `${RW_ORIGIN}/authorize?response_type=code`;
  for (const origin of [undefined, `${T}evil.example`, `${S}localhost:9`]) {
    await withHome(async ({ h }) => {
      const r = await post(h, "/api/generation/runway/begin");
      assert.deepEqual([r.status, r.json.url], [200, good], String(origin));
    }, { origin, answers: { "/gen/owner/runway/begin": { status: 200, body: { url: good } } } });
  }
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/generation/runway/begin");
    assert.deepEqual([r.status, r.json.error.code, r.json.error.message], [409, "door_off", "The generation door is off. Run: engine start"]);
  }, { answers: null });
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/generation/runway/begin");
    assert.deepEqual([r.status, r.json.error.code], [502, "runway_failed"]);
  }, { answers: { "/gen/owner/runway/begin": { status: 403, body: { code: "gen_not_owner" } } } });
});

test("back: a good pair goes to the door's finish at once with exactly code and state; the door's yes is the only yes; nothing logs either", async () => {
  await withHome(async ({ h, door, logs }) => {
    const r = await call(h.url, "GET", `/api/generation/runway/back?code=${CODE}&state=${STATE_HEX}&iss=x`);
    assert.deepEqual([r.status, r.headers.location], [303, RW_BACK_CONNECTED]);
    assert.equal(RW_BACK_CONNECTED, "/#/settings?s=generation&generation=runway-connected");
    assert.equal(r.headers["cache-control"], "no-store");
    const fin = door.seen.filter((s) => s.url === "/gen/owner/runway/finish");
    assert.equal(fin.length, 1);
    assert.deepEqual([fin[0].method, JSON.parse(fin[0].body)], ["POST", { code: CODE, state: STATE_HEX }]);
    assert.match(fin[0].auth, /^Bearer \S+$/);
    for (const l of logs) assert.ok(!l.includes(CODE) && !l.includes(STATE_HEX), l);
    assert.ok(logs.includes("generation: the Runway sign-in came back (connected)"));
    assert.ok(!r.text.includes(CODE) && !r.text.includes(STATE_HEX));
    // A long code (Runway's length is not published) is still taken.
    const long = "A".repeat(1500);
    const l2 = await call(h.url, "GET", `/api/generation/runway/back?code=${long}&state=${STATE_HEX}`);
    assert.equal(l2.headers.location, RW_BACK_CONNECTED);
  }, { answers: { "/gen/owner/runway/finish": { status: 200, body: { connected: true } } } });
});

test("back: a wrong state is the door's no, asked once; a bad, missing or refused pair calls nothing; with no door it fails", async () => {
  await withHome(async ({ h, door }) => {
    const r = await call(h.url, "GET", `/api/generation/runway/back?code=madeup&state=${STATE_HEX}`, { headers: { "sec-fetch-site": "cross-site" } });
    assert.deepEqual([r.status, r.headers.location], [303, RW_BACK_FAILED]);
    assert.equal(RW_BACK_FAILED, "/#/settings?s=generation&generation=runway-failed");
    assert.equal(door.seen.filter((s) => s.url === "/gen/owner/runway/finish").length, 1, "the door is asked once");
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
  }, { answers: { "/gen/owner/runway/finish": { status: 400, body: { connected: false, code: "gen_rw_bad_state" } } } });
  await withHome(async ({ h, door }) => {
    const bad = [
      "", "?code=abc", `?state=${STATE_HEX}`, `?code=abc&state=${STATE_HEX.slice(2)}`, `?code=abc&state=${STATE_HEX.toUpperCase()}`,
      `?code=a%20b&state=${STATE_HEX}`, `?code=${"a".repeat(2049)}&state=${STATE_HEX}`, `?code=a/b&state=${STATE_HEX}`, `?code=a+b&state=${STATE_HEX}`,
      `?error=access_denied&state=${STATE_HEX}`,
    ];
    for (const q of bad) {
      const r = await call(h.url, "GET", `/api/generation/runway/back${q}`);
      assert.deepEqual([r.status, r.headers.location], [303, RW_BACK_FAILED], q);
    }
    assert.equal(door.seen.filter((s) => s.url !== "/gen/health").length, 0, "nothing was called");
  }, { answers: { "/gen/owner/runway/finish": { status: 200, body: { connected: true } } } });
  // The door answering yes in some other way is not a yes.
  await withHome(async ({ h }) => {
    const r = await call(h.url, "GET", `/api/generation/runway/back?code=abc&state=${STATE_HEX}`);
    assert.equal(r.headers.location, RW_BACK_FAILED);
  }, { answers: { "/gen/owner/runway/finish": { status: 200, body: { connected: "yes" } } } });
  await withHome(async ({ h }) => {
    const r = await call(h.url, "GET", `/api/generation/runway/back?code=abc&state=${STATE_HEX}`);
    assert.deepEqual([r.status, r.headers.location], [303, RW_BACK_FAILED]);
  }, { answers: null });
});

test("forget: the door's no-longer-connected answer gives the view; any other answer or the door off is refused", async () => {
  await withHome(async ({ h, door }) => {
    writeStatus(h.config, { runway: { signedIn: false, refused: false } });
    const r = await post(h, "/api/generation/runway/forget");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.runwayAccount.signedIn, r.json.runwayAccount.sentence], [false, "Not signed in to Runway."]);
    assert.equal(door.seen.filter((s) => s.url === "/gen/owner/runway/forget").length, 1);
  }, { answers: { "/gen/owner/runway/forget": { status: 200, body: { connected: false } } } });
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/generation/runway/forget");
    assert.deepEqual([r.status, r.json.error.code, r.json.error.message], [502, "runway_failed", "Runway did not forget the sign-in. Try again in a minute."]);
  }, { answers: { "/gen/owner/runway/forget": { status: 200, body: { connected: true } } } });
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/generation/runway/forget");
    assert.deepEqual([r.status, r.json.error.code], [409, "door_off"]);
  }, { answers: null });
});

test("Test: the account's credits in words; a plan with no number; signed out, refused, odd answers and the door off in plain words", async () => {
  const answers = [
    [{ status: 200, body: { credits: 120, plan: "Max" } }, { ok: true, credits: 120, sentence: "Runway says your account has 120 credits." }],
    [{ status: 200, body: { credits: 1 } }, { ok: true, credits: 1, sentence: "Runway says your account has 1 credit." }],
    [{ status: 200, body: { credits: null, plan: "Max" } }, { ok: true, credits: null, sentence: RW_TEST_SENTENCES.no_count }],
    [{ status: 403, body: { code: "gen_rw_signed_out" } }, { ok: false, credits: null, sentence: "Not signed in to Runway." }],
    [{ status: 403, body: { code: "gen_rw_refused" } }, { ok: false, credits: null, sentence: "Runway asked you to sign in again." }],
    [{ status: 403, body: { code: "gen_could_not_start", error: { message: "secret words" } } }, { ok: false, credits: null, sentence: "Runway did not answer. Try again in a minute." }],
    [{ status: 200, body: { credits: "lots" } }, { ok: false, credits: null, sentence: "Runway did not answer. Try again in a minute." }],
    [{ status: 200, body: { credits: -1 } }, { ok: false, credits: null, sentence: "Runway did not answer. Try again in a minute." }],
  ];
  for (const [a, want] of answers) {
    await withHome(async ({ h, door }) => {
      const r = await post(h, "/api/generation/runway/test");
      assert.equal(r.status, 200);
      assert.deepEqual(r.json, want, JSON.stringify(a));
      assert.ok(!r.text.includes("secret words") && !r.text.includes("Max"));
      const asked = door.seen.filter((s) => s.url === "/gen/owner/runway/balance");
      assert.deepEqual([asked.length, asked[0].method], [1, "POST"]);
    }, { answers: { "/gen/owner/runway/balance": a } });
  }
  // It works while the switch is off (the switch is never read for it), and says when the door is off.
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/generation/runway/test");
    assert.deepEqual(r.json, { ok: false, credits: null, sentence: "The generation door is off. Run: engine start" });
  }, { answers: null });
});

// ---- what the home server never touches ---------------------------------------------------------------------------

test("the door's token file is never opened here: its marker is in no answer, its mode and time are kept; only owner routes are called", async () => {
  await withHome(async ({ h, door, logs }) => {
    const file = join(h.config.paths.doorSecrets, "runway-oauth.json");
    mkdirSync(h.config.paths.doorSecrets, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ access_token: "rwtok_SECRETMARKER", refresh_token: "rwref_SECRETMARKER" }), { mode: 0o600 });
    chmodSync(file, 0o000);
    const before = statSync(file);
    try {
      const texts = [];
      texts.push((await call(h.url, "GET", "/api/generation")).text);
      for (const p of ["begin", "forget", "test"]) texts.push((await post(h, `/api/generation/runway/${p}`)).text);
      texts.push((await post(h, "/api/generation/runway/rate", { centsPerCredit: 4 })).text);
      texts.push(JSON.stringify((await call(h.url, "GET", `/api/generation/runway/back?code=${CODE}&state=${STATE_HEX}`)).headers));
      for (const t of [...texts, ...logs]) assert.ok(!t.includes("SECRETMARKER"), t.slice(0, 120));
      const after = statSync(file);
      assert.deepEqual([after.mode & 0o777, after.mtimeMs, after.size], [0, before.mtimeMs, before.size]);
      for (const s of door.seen) {
        assert.ok(s.url === "/gen/health" || /^\/gen\/owner\/runway\/(begin|finish|forget|balance)$/.test(s.url), s.url);
        assert.ok(!s.body.includes("SECRETMARKER"));
      }
    } finally { chmodSync(file, 0o600); }
  }, {
    answers: {
      "/gen/owner/runway/begin": { status: 200, body: { url: `${RW_ORIGIN}/authorize?x=1` } },
      "/gen/owner/runway/finish": { status: 200, body: { connected: true } },
      "/gen/owner/runway/forget": { status: 200, body: { connected: false } },
      "/gen/owner/runway/balance": { status: 200, body: { credits: 5 } },
    },
  });
  // The routes' source names neither the token file nor the config's path to it.
  const src = readFileSync(join(SERVER_DIR, "routes", "generation.mjs"), "utf8").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(src, /runway-oauth|runwayAuth|access_token|refresh_token/);
});
