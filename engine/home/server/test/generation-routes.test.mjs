// The Generation routes (PLAN-V5 K13, T41) on a stub home: the switch, the limits, the models, the Runway key,
// Test and "Start again", with a real generation door (createGenerateDoor on port 0) on the stand-in Runway where a
// call must go through, and a made-up door where its answers must be odd. Every secret, key and id is made up;
// nothing leaves 127.0.0.1 and nothing calls a live door.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSecret, readDoorsState } from "../../../doors/common.mjs";
import { createGenerateDoor } from "../../../generate/door.mjs";
import { createLedger, readLedger, totalsOf } from "../../../generate/ledger.mjs";
import { readGenState } from "../../../generate/state.mjs";
import { readSecret } from "../../../relay/state.mjs";
import { mintToken } from "../../../relay/token.mjs";
import { pngBytes, startRunway } from "../../../test/stubs/runway.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { OWN_PAUSE_SENTENCE, PAUSED_SENTENCE } from "../lib/generation.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const madeUpKey = () => `key_${randomBytes(64).toString("hex")}`;
const KEY = madeUpKey();                 // the one the stand-in Runway takes
const ARTIST = "a0000000-0000-4000-8000-000000000010";
const DOOR_PORTS = [3130, 3140, 3150, 3160];
const mode = (p) => statSync(p).mode & 0o777;
const iso = (ms) => new Date(ms).toISOString();
const ENGINE_DIR = join(SERVER_DIR, "..", "..");

function dropArtist(config) {
  const ids = JSON.parse(readFileSync(config.paths.ids, "utf8"));
  delete ids.agents.artist;
  rmSync(config.paths.ids);
  writeFileSync(config.paths.ids, JSON.stringify(ids, null, 2), { mode: 0o600 });
}

// A stub home with the Generation routes; unless door is false, a real generation door on port 0 against the
// stand-in Runway, its doors folder made as `engine start` makes it.
async function withGen(fn, { door = true, artist = true, routes = ["generation"] } = {}) {
  const rw = await startRunway({ key: KEY });
  const logs = [];
  const doorLogs = [];
  const h = await startV2({ routes, inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  let d = null;
  const startDoor = async () => {
    d = createGenerateDoor({
      listenPort: 0, upstream: rw.url, paths: h.config.paths, config: h.config, log: (l) => doorLogs.push(l), net: rw.net,
      limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000 },
    });
    await d.listen();
    await d.settled();
    h.app.home.urls.generate = `http://127.0.0.1:${d.port}`;
    return d;
  };
  try {
    if (!artist) dropArtist(h.config);
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    ensureSecret(h.config.paths.generateSecret);
    if (door) await startDoor();
    return await fn({ h, door: () => d, startDoor, rw, logs, doorLogs });
  } finally {
    if (d) await d.close();
    await h.close();
    await rw.close();
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/generation")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const genState = (h) => JSON.parse(readFileSync(h.config.paths.doorsState, "utf8")).generate;
const agentToken = (h) => mintToken(readSecret(h.config.paths.generateSecret), "a", ARTIST, Math.floor(Date.now() / 1000) + 3600);
function agentUpload(h, port) {
  return call(`http://127.0.0.1:${port}`, "POST", "/gen/inputs", {
    raw: pngBytes(1280, 720), bare: true, headers: { authorization: `Bearer ${agentToken(h)}`, "content-type": "image/png" },
  });
}

// A made-up door on 127.0.0.1 that answers health and the balance question as `answers` says, and keeps what it saw.
async function fakeDoor(answers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: Buffer.concat(chunks).toString("utf8") });
      const a = answers[req.url] || { status: 404, body: "{}" };
      if (a.hang) return;
      res.writeHead(a.status, { "content-type": a.type || "application/json" });
      res.end(typeof a.body === "string" ? a.body : JSON.stringify(a.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, seen,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

// ---- the switch -------------------------------------------------------------------------------------------------

test("the switch writes the file with its modes and the door sees it at once", async () => {
  await withGen(async ({ h, door }) => {
    assert.deepEqual((await post(h, "/api/generation/key", { key: KEY })).json, { saved: true });
    const r = await post(h, "/api/generation/switch", { on: true });
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("generation"), r.json), []);
    assert.deepEqual([r.json.on, r.json.canSwitchOn, r.json.blockers, r.json.whyNot], [true, true, [], null]);
    assert.equal(mode(h.config.paths.doors), 0o700);
    assert.equal(mode(h.config.paths.doorsState), 0o600);
    const st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.ok, st.generate.on, st.web.on, st.viewer.on], [true, true, false, false]);
    const health = await call(`http://127.0.0.1:${door().port}`, "GET", "/gen/health");
    assert.deepEqual(health.json, { status: "ok", part: "generate", on: true, key: true, higgsfield: false }, "the door sees the switch and the key");
    for (const bad of [{ on: "yes" }, {}, { on: 1 }]) {
      const b = await post(h, "/api/generation/switch", bad);
      assert.equal(b.status, 400);
      assert.equal(b.json.error.code, "bad_switch");
    }
    assert.equal(genState(h).on, true, "a bad value changes nothing");
  });
});

test("on is refused with no key, with the door not answering, and with no Artist set up; off is always taken", async () => {
  await withGen(async ({ h, door }) => {
    // No key.
    let r = await post(h, "/api/generation/switch", { on: true });
    assert.equal(r.status, 409);
    assert.deepEqual([r.json.error.code, r.json.error.next, r.json.error.blockers], ["cannot_switch_on", "Paste your Runway key first.", ["no_key"]]);
    assert.equal(r.json.error.message, "Generation cannot be switched on yet.");
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    await post(h, "/api/generation/key", { key: KEY });

    // The door not answering.
    await door().close();
    r = await post(h, "/api/generation/switch", { on: true });
    assert.equal(r.status, 409);
    assert.deepEqual([r.json.error.next, r.json.error.blockers], ["The generation door is off. Run: engine start", ["door_off"]]);
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    r = await post(h, "/api/generation/switch", { on: false });
    assert.equal(r.status, 200, "off is always taken");
    assert.equal(genState(h).on, false);
  });
  // No Artist in ids.json.
  await withGen(async ({ h }) => {
    await post(h, "/api/generation/key", { key: KEY });
    const r = await post(h, "/api/generation/switch", { on: true });
    assert.equal(r.status, 409);
    assert.deepEqual([r.json.error.next, r.json.error.blockers], ["Run engine setup first, then try again.", ["no_artist"]]);
    assert.equal((await view(h)).whyNot, "Run engine setup first, then try again.");
    assert.equal((await post(h, "/api/generation/switch", { on: false })).status, 200);
  }, { artist: false });
});

test("switching off while the door is off and the file damaged writes a fresh all-off file", async () => {
  await withGen(async ({ h }) => {
    writeFileSync(h.config.paths.doorsState, "not json", { mode: 0o600 });
    const r = await post(h, "/api/generation/switch", { on: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.problem, null);
    const st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.ok, st.generate.on, st.web.on, st.viewer.on], [true, false, false, false]);
    assert.equal(r.json.door.state, "off");
  }, { door: false });
});

// ---- the limits and the models ----------------------------------------------------------------------------------

test("limits: whole numbers from 0 to 1,000,000 are saved; anything else is refused at its field and nothing is written", async () => {
  await withGen(async ({ h }) => {
    let r = await post(h, "/api/generation/caps", { daily: 500, monthly: 4000 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.caps, { daily: 500, monthly: 4000 });
    assert.deepEqual([genState(h).dailyCredits, genState(h).monthlyCredits], [500, 4000]);
    r = await post(h, "/api/generation/caps", { monthly: 0 });
    assert.deepEqual(r.json.caps, { daily: 500, monthly: 0 }, "one at a time; 0 is a limit");
    r = await post(h, "/api/generation/caps", { daily: 1_000_000, monthly: 1_000_000 });
    assert.equal(r.status, 200);
    const saved = readFileSync(h.config.paths.doorsState, "utf8");
    for (const [body, field] of [
      [{ daily: -1 }, "daily"], [{ daily: 1.5 }, "daily"], [{ daily: "300" }, "daily"], [{ daily: 1_000_001 }, "daily"],
      [{ daily: 300, monthly: null }, "monthly"], [{ monthly: 1e7 }, "monthly"], [{ daily: true, monthly: 5 }, "daily"],
    ]) {
      r = await post(h, "/api/generation/caps", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "bad_cap");
      assert.equal(r.json.field, field, JSON.stringify(body));
      assert.match(r.json.error.message, field === "daily" ? /^"Most to spend in a day"/ : /^"Most to spend in a month"/);
      assert.equal(readFileSync(h.config.paths.doorsState, "utf8"), saved, "nothing written");
    }
    for (const body of [{}, { autoUnderCredits: 50 }, { daily: 10, autoUnderCredits: 50 }, { perDay: 3 }]) {
      r = await post(h, "/api/generation/caps", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "bad_request");
      assert.equal(readFileSync(h.config.paths.doorsState, "utf8"), saved, "nothing written");
    }
  }, { door: false });
});

test("the automatic allowance is never offered and every save keeps it 0 (C5)", async () => {
  await withGen(async ({ h }) => {
    updateDoors(h.config, (s) => { s.generate.autoUnderCredits = 500; });
    assert.equal(genState(h).autoUnderCredits, 500);
    await post(h, "/api/generation/caps", { daily: 200 });
    assert.equal(genState(h).autoUnderCredits, 0, "the limits");
    for (const [path, body] of [["/api/generation/models", { still: "gen4_image_turbo" }], ["/api/generation/switch", { on: false }]]) {
      updateDoors(h.config, (s) => { s.generate.autoUnderCredits = 500; });
      assert.equal((await post(h, path, body)).status, 200);
      assert.equal(genState(h).autoUnderCredits, 0, path);
    }
  }, { door: false });
});

test("models: each must be one of its choices; a refusal names its field and nothing is written", async () => {
  await withGen(async ({ h }) => {
    let r = await post(h, "/api/generation/models", { video: "gen4.5", videoBest: "gen4.5", still: "gen4_image_turbo", upscale: "magnific_precision_upscaler_v2" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.models, { video: "gen4.5", videoBest: "gen4.5", still: "gen4_image_turbo", upscale: "magnific_precision_upscaler_v2" });
    assert.deepEqual(genState(h).models, r.json.models);
    r = await post(h, "/api/generation/models", { video: "gen4_turbo" });
    assert.equal(r.json.models.video, "gen4_turbo");
    assert.equal(r.json.models.still, "gen4_image_turbo", "the others stay");
    const saved = readFileSync(h.config.paths.doorsState, "utf8");
    for (const [body, field] of [
      [{ video: "veo3.1" }, "video"], [{ videoBest: "gen4_turbo" }, "videoBest"], [{ still: "gen4_turbo" }, "still"],
      [{ upscale: "gen4_image" }, "upscale"], [{ video: 5 }, "video"], [{ still: "gen4_image", upscale: "x" }, "upscale"],
      [{ video: "GEN4_TURBO" }, "video"],
    ]) {
      r = await post(h, "/api/generation/models", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual([r.json.error.code, r.json.error.message, r.json.field], ["bad_model", "The door has no price for this model.", field]);
      assert.equal(readFileSync(h.config.paths.doorsState, "utf8"), saved, "nothing written");
    }
    for (const body of [{}, { audio: "x" }]) assert.equal((await post(h, "/api/generation/models", body)).json.error.code, "bad_request");
  }, { door: false });
});

// ---- the key ----------------------------------------------------------------------------------------------------

test("the key is saved 0600 in a 0700 folder, a text that is not a key is refused without being named, and it can be removed", async () => {
  await withGen(async ({ h }) => {
    const key = madeUpKey();
    for (const bad of [key.slice(0, -1), `${key}0`, key.toUpperCase(), `key ${key.slice(4)}`, "", 7, null]) {
      const r = await post(h, "/api/generation/key", { key: bad });
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, "bad_key");
      assert.equal(r.json.error.message, "That is not a Runway key. A Runway key starts key_ and has 128 more letters and digits.");
      assert.ok(!r.text.includes(key.slice(4, 20)) && !r.text.includes(key.slice(-12)), "never echoed");
    }
    assert.equal(existsSync(h.config.paths.runwayKey), false);
    const r = await post(h, "/api/generation/key", { key: `  ${key}\n` });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { saved: true });
    assert.equal(readFileSync(h.config.paths.runwayKey, "utf8"), `${key}\n`);
    assert.equal(mode(h.config.paths.runwayKey), 0o600);
    assert.equal(mode(h.config.paths.doorSecrets), 0o700);
    assert.equal(mode(h.config.paths.secrets), 0o700);
    assert.deepEqual((await view(h)).key, { saved: true });
    assert.deepEqual((await post(h, "/api/generation/key/remove")).json, { saved: false });
    assert.equal(existsSync(h.config.paths.runwayKey), false);
    assert.deepEqual((await view(h)).key, { saved: false });
    assert.equal((await post(h, "/api/generation/key/remove")).status, 200, "removing twice is fine");
  }, { door: false });
});

// ---- Test -------------------------------------------------------------------------------------------------------

test("Test through a real door on the stand-in Runway: no key, a balance, a key Runway refuses", async () => {
  await withGen(async ({ h, rw }) => {
    let r = await post(h, "/api/generation/test");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: false, balance: null, monthlyMax: null, sentence: "No key yet. Paste the one from your Runway developer account." });
    assert.equal(rw.seen.api.length, 0, "no key: Runway is not asked");

    await post(h, "/api/generation/key", { key: KEY });
    r = await post(h, "/api/generation/test");
    assert.deepEqual(r.json, { ok: true, balance: 1000, monthlyMax: 100000, sentence: "Runway says you have 1000 credits." });
    assert.equal(rw.seen.api.filter((x) => x.path === "/v1/organization").length, 1);
    assert.equal((await view(h)).on, false, "Test works with the switch off");

    await post(h, "/api/generation/key", { key: madeUpKey() });
    r = await post(h, "/api/generation/test");
    assert.deepEqual(r.json, { ok: false, balance: null, monthlyMax: null, sentence: "Runway refused this key." });
  });
});

test("Test: the door's other answers are said in plain words, and only the door's codes are read", async () => {
  await withGen(async ({ h, logs }) => {
    const answers = {};
    const fake = await fakeDoor(answers);
    try {
      h.app.home.urls.generate = fake.url;
      const said = async () => (await post(h, "/api/generation/test")).json;
      answers["/gen/owner/balance"] = { status: 403, body: { error: { message: "Runway says too many requests for now." }, code: "gen_limited", retryAfterSec: 60 } };
      assert.deepEqual(await said(), { ok: false, balance: null, monthlyMax: null, sentence: "Runway says too many requests for now. Try again in a minute." });
      const asked = fake.seen.at(-1);
      assert.deepEqual([asked.method, asked.url, asked.body], ["POST", "/gen/owner/balance", "{}"]);
      assert.match(asked.auth, /^Bearer v1\.t\.owner\.\d+\./, "an owner token of the door's own secret");
      answers["/gen/owner/balance"] = { status: 200, body: { creditBalance: 1, maxMonthlyCreditSpend: null } };
      assert.deepEqual(await said(), { ok: true, balance: 1, monthlyMax: null, sentence: "Runway says you have 1 credit." });
      for (const odd of [
        { status: 200, body: "<html>" , type: "text/html" }, { status: 200, body: { creditBalance: -5 } }, { status: 200, body: { creditBalance: "lots" } },
        { status: 403, body: { error: { message: "<b>Something the door says</b>" }, code: "gen_could_not_start" } }, { status: 500, body: {} },
      ]) {
        answers["/gen/owner/balance"] = odd;
        const out = await said();
        assert.deepEqual(out, { ok: false, balance: null, monthlyMax: null, sentence: "Runway did not answer. Try again in a minute." }, JSON.stringify(odd));
      }
      // No secret yet: the door has never started, so it is off.
      rmSync(h.config.paths.generateSecret);
      assert.equal((await said()).sentence, "The generation door is off. Run: engine start");
      ensureSecret(h.config.paths.generateSecret);
      await fake.close();
      assert.equal((await said()).sentence, "The generation door is off. Run: engine start", "nothing listening");
      h.app.home.urls.generate = null;
      assert.equal((await said()).sentence, "The generation door is off. Run: engine start", "no address");
      assert.ok(logs.includes("generation: tested (limited)") && logs.includes("generation: tested (door_off)"));
      assert.ok(!logs.some((l) => l.includes("Something the door says")));
    } finally {
      await fake.close();
    }
  }, { door: false });
});

test("the door's state: on, unhealthy when another part answers, not installed when nothing listens and there is no marker", async () => {
  await withGen(async ({ h, door }) => {
    assert.deepEqual((await view(h)).door, { state: "on", sentence: "The generation door is running." });
    const fake = await fakeDoor({ "/gen/health": { status: 200, body: { status: "ok", part: "web" } } });
    try {
      h.app.home.urls.generate = fake.url;
      assert.deepEqual((await view(h)).door, { state: "unhealthy", sentence: "The generation door is running but not answering. Run: engine stop, then engine start." });
      assert.equal(fake.seen[0].auth, null, "health is asked without a token");
    } finally {
      await fake.close();
    }
    const port = door().port;
    await door().close();
    h.app.home.urls.generate = `http://127.0.0.1:${port}`;
    const marked = existsSync(join(ENGINE_DIR, "generate", "READY"));
    const v = await view(h);
    assert.deepEqual(v.door, marked
      ? { state: "off", sentence: "The generation door is off. Run: engine start" }
      : { state: "not_installed", sentence: "The generation door is not installed yet." });
    assert.ok(v.blockers.includes("door_off"));
    const slow = await fakeDoor({ "/gen/health": { hang: true } });
    try {
      h.app.home.urls.generate = slow.url;
      const t0 = Date.now();
      await view(h);
      assert.ok(Date.now() - t0 < 3000, "health is waited for at most a second");
    } finally {
      await slow.close();
    }
  });
});

// ---- Start again --------------------------------------------------------------------------------------------------

test("Start again: refused when nothing is paused; after the door paused itself it writes resumedAt, and the door's own totals no longer say paused", async () => {
  await withGen(async ({ h, door }) => {
    await post(h, "/api/generation/key", { key: KEY });
    assert.equal((await post(h, "/api/generation/switch", { on: true })).status, 200);
    let r = await post(h, "/api/generation/resume");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "not_paused");
    assert.equal(genState(h).resumedAt, undefined, "nothing written");

    // Three refusals and the door's own pause line, written with the door's ledger.
    const l = createLedger(h.config.paths.ledger);
    const at = iso(Date.now() - 5000);
    for (const job of ["g1", "g2", "g3"]) {
      l.reserve(at, { job, batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25 });
      l.settle(at, l.job(job), { state: "spent", credits: 25, verdict: "refused" });
    }
    const pausedAt = iso(Date.now() - 4000);
    l.pause(pausedAt, "three_refusals");
    assert.deepEqual((await view(h)).paused, { at: pausedAt, sentence: PAUSED_SENTENCE });
    assert.equal((await agentUpload(h, door().port)).json.code, "gen_paused");

    const before = Date.now();
    r = await post(h, "/api/generation/resume");
    assert.equal(r.status, 200);
    assert.equal(r.json.paused, null);
    assert.deepEqual(sameShape(readShape("generation"), r.json), []);
    const g = genState(h);
    assert.ok(Date.parse(g.resumedAt) >= before && Date.parse(g.resumedAt) <= Date.now());
    assert.equal(g.paused, null);
    assert.equal(g.on, true, "the switch stays as it was");
    const gs = readGenState(h.config.paths.doorsState, Date.now());
    assert.equal(gs.resumedAt, Date.parse(g.resumedAt), "the door reads the same time");
    const t = totalsOf(readLedger(h.config.paths.ledger).lines, Date.now(), { resumedAt: gs.resumedAt });
    assert.deepEqual([t.paused, t.refusedRecent], [false, 0], "the door's own totals");
    const up = await agentUpload(h, door().port);
    assert.equal(up.status, 201, up.text);
    assert.equal((await post(h, "/api/generation/resume")).status, 409, "not paused any more");
  });
});

test("the owner's own pause in the switches file shows as paused, and Start again clears it", async () => {
  await withGen(async ({ h }) => {
    updateDoors(h.config, (s) => { s.generate.paused = "held by hand"; });
    const v = await view(h);
    assert.deepEqual(v.paused, { at: null, sentence: OWN_PAUSE_SENTENCE });
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    const r = await post(h, "/api/generation/resume");
    assert.equal(r.status, 200);
    assert.equal(r.json.paused, null);
    assert.equal(genState(h).paused, null);
    assert.equal(readGenState(h.config.paths.doorsState).paused, null, "the door reads no pause");
  }, { door: false });
});

// ---- what never leaves ------------------------------------------------------------------------------------------

test("the key, its first and its last 12 characters are in no answer, error or log of any route", async () => {
  await withGen(async ({ h, logs, doorLogs, door }) => {
    const texts = [];
    const keep = async (p) => { const r = await p; texts.push(r.text); return r; };
    await keep(post(h, "/api/generation/switch", { on: true }));
    await keep(post(h, "/api/generation/key", { key: `${KEY}x` }));
    await keep(post(h, "/api/generation/key", { key: KEY.slice(0, 100) }));
    await keep(post(h, "/api/generation/key", { key: { key: KEY } }));
    await keep(post(h, "/api/generation/key", { key: KEY }));
    await keep(call(h.url, "GET", "/api/generation"));
    await keep(post(h, "/api/generation/switch", { on: true }));
    await keep(post(h, "/api/generation/caps", { daily: 400 }));
    await keep(post(h, "/api/generation/caps", { daily: KEY }));
    await keep(post(h, "/api/generation/caps", { [KEY]: 1 }));
    await keep(post(h, "/api/generation/models", { video: KEY }));
    await keep(post(h, "/api/generation/models", { [KEY.slice(-12)]: "gen4_turbo" }));
    await keep(post(h, "/api/generation/models", { video: "gen4.5" }));
    await keep(post(h, "/api/generation/test"));
    await keep(post(h, "/api/generation/resume"));
    await keep(call(h.url, "GET", "/api/generation/ledger"));
    await keep(call(h.url, "GET", `/api/generation/ledger?before=${KEY.slice(0, 12)}`));
    await keep(agentUpload(h, door().port));
    await keep(post(h, "/api/generation/switch", { on: false }));
    await keep(post(h, "/api/generation/key/remove"));
    await keep(post(h, "/api/generation/test"));
    assert.equal(texts.length, 21);
    assert.ok(logs.some((l) => l === "generation: a Runway key was saved"));
    for (const t of [...texts, ...logs, ...doorLogs]) {
      assert.ok(!t.includes(KEY) && !t.includes(KEY.slice(0, 12)) && !t.includes(KEY.slice(-12)), t.slice(0, 200));
    }
  });
});

test("a value in a door file that holds a piece of the saved key is emptied before it is sent", async () => {
  await withGen(async ({ h }) => {
    await post(h, "/api/generation/key", { key: KEY });
    const l = createLedger(h.config.paths.ledger);
    const at = iso(Date.now() - 1000);
    l.reserve(at, { job: "g1", batch: null, shot: `s-${KEY.slice(-12)}`, slug: "artist", kind: "image_to_video", model: KEY.slice(0, 12), seconds: 5, estimate: 25 });
    l.reserve(at, { job: "g2", batch: null, shot: "s02", slug: "artist", kind: "image_to_video", model: "gen4_turbo", seconds: 5, estimate: 25 });
    const p = await call(h.url, "GET", "/api/generation/ledger");
    assert.ok(!p.text.includes(KEY.slice(0, 12)) && !p.text.includes(KEY.slice(-12)));
    const rows = p.json.days[0].rows;
    assert.deepEqual(rows.map((r) => [r.shot, r.model]), [["s02", "gen4_turbo"], ["", ""]], "only the values that hold it");
    const v = await call(h.url, "GET", "/api/generation");
    assert.ok(!v.text.includes(KEY.slice(0, 12)) && !v.text.includes(KEY.slice(-12)));
    assert.equal(v.json.spent.day, 50);
  }, { door: false });
});

async function connectionsDuring(fn) {
  const seen = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    seen.push(Number(o && typeof o === "object" ? o.port : o));
    return original.apply(this, args);
  };
  try { await fn(); } finally { net.Socket.prototype.connect = original; }
  return seen;
}

test("a stub home (no door address) opens no socket to any door", async () => {
  for (const start of [
    () => startV2({ routes: ["generation"], inbox: [], search: [], port: 0 }),
    () => startStubsHome({ port: 0 }),
  ]) {
    const h = await start();
    try {
      for (const d of ["web", "generate", "viewer", "preview"]) assert.equal(h.app.home.urls[d], null, d);
      ensureSecret(h.config.paths.generateSecret);
      const configured = DOOR_PORTS.concat(["web", "generate", "viewer", "preview"].map((d) => h.config.ports[d]));
      const seen = await connectionsDuring(async () => {
        const v = (await call(h.url, "GET", "/api/generation")).json;
        assert.deepEqual(v.door, { state: "off", sentence: "The generation door is off. Run: engine start" });
        assert.equal((await post(h, "/api/generation/test")).json.sentence, "The generation door is off. Run: engine start");
        assert.ok((await post(h, "/api/generation/switch", { on: true })).json.error.blockers.includes("door_off"));
        assert.equal((await call(h.url, "GET", "/api/generation/ledger")).status, 200);
      });
      assert.ok(seen.length > 0);
      const allowed = new Set([h.port, h.board.port, h.bench.port]);
      for (const port of seen) {
        assert.ok(!configured.includes(port), `a socket to door port ${port}`);
        assert.ok(allowed.has(port), `a socket to ${port}`);
      }
    } finally {
      await h.close();
    }
  }
});

test("every POST without the home screen's same-origin headers is refused by the core, and changes nothing", async () => {
  await withGen(async ({ h }) => {
    const posts = [
      ["/api/generation/switch", { on: true }], ["/api/generation/caps", { daily: 5 }], ["/api/generation/models", { video: "gen4.5" }],
      ["/api/generation/key", { key: KEY }], ["/api/generation/key/remove", {}], ["/api/generation/test", {}], ["/api/generation/resume", {}],
    ];
    for (const [path, body] of posts) {
      for (const headers of [
        { bare: true, headers: { "content-type": "application/json" } },
        { headers: { origin: "http://evil.example" } },
        { headers: { "sec-fetch-site": "cross-site" } },
        { headers: { "content-type": "text/plain" } },
        { headers: { "x-engine": "0" } },
      ]) {
        const r = await call(h.url, "POST", path, { body, ...headers });
        assert.equal(r.status, 403, `${path} ${JSON.stringify(headers)}`);
        assert.equal(r.json.error.code, "not_same_origin");
      }
    }
    assert.equal(existsSync(h.config.paths.doorsState), false);
    assert.equal(existsSync(h.config.paths.runwayKey), false);
    assert.equal(existsSync(h.config.paths.ledger), false);
    assert.ok(!existsSync(h.config.paths.batches) || lstatSync(h.config.paths.batches).isDirectory());
  });
});
