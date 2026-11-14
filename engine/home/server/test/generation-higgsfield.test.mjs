// Generation with Higgsfield (PLAN-V5 K20, K21, K23; T79) on a stub home: the view's Higgsfield block, its switch,
// the owner's rate, the sign-in passed along to a real generation door (createGenerateDoor on port 0) on the
// stand-in Higgsfield and the stand-in Runway, the return address, sign-out and Test; Higgsfield's models only while
// it is on and signed in; the ledger's rows naming their service and app. Every secret, key, code and id is made up;
// nothing leaves 127.0.0.1 and nothing calls a live door or the real Higgsfield.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSecret } from "../../../doors/common.mjs";
import { createGenerateDoor } from "../../../generate/door.mjs";
import { HF_ORIGIN } from "../../../generate/higgsfield.mjs";
import { estimateCents } from "../../../generate/registry.mjs";
import { readGenState } from "../../../generate/state.mjs";
import { startRunway } from "../../../test/stubs/runway.mjs";
import { startHiggsfield } from "../../../test/stubs/higgsfield.mjs";
import { checkDoors, freshDoors, readDoors, updateDoors } from "../lib/doors.mjs";
import { appJobWords, modelChoices, priceCents, priceWords, resultWords } from "../lib/generation.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { HF_BACK_CONNECTED, HF_BACK_FAILED, HF_NOT_READY_MODEL, HF_SWITCH_REFUSED } from "../routes/generation.mjs";

const KEY = `key_${randomBytes(64).toString("hex")}`;
const iso = (ms) => new Date(ms).toISOString();
const STATE_HEX = "ab".repeat(32);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>\n';

// A stub home with the Generation routes; unless door is false, a real generation door on port 0 against the stand-in
// Runway and the stand-in Higgsfield, its return address the home's own.
async function withHf(fn, { door = true, behaviour = {} } = {}) {
  const rw = await startRunway({ key: KEY });
  const hf = await startHiggsfield({ behaviour });
  const logs = [];
  const doorLogs = [];
  const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  let d = null;
  try {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    ensureSecret(h.config.paths.generateSecret);
    h.app.home.higgsfieldOrigin = hf.url;
    if (door) {
      d = createGenerateDoor({
        listenPort: 0, upstream: rw.url, paths: h.config.paths, config: h.config, log: (l) => doorLogs.push(l), net: rw.net,
        limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000 },
        higgsfield: { origin: hf.url, redirectUri: `${h.url}/api/generation/higgsfield/back`, net: hf.net, mcpLimits: { callMs: 3000 } },
      });
      await d.listen();
      await d.settled();
      h.app.home.urls.generate = `http://127.0.0.1:${d.port}`;
    }
    return await fn({ h, hf, door: d, logs, doorLogs });
  } finally {
    if (d) await d.close();
    await h.close();
    await hf.close();
    await rw.close();
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/generation")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const fileGen = (h) => JSON.parse(readFileSync(h.config.paths.doorsState, "utf8")).generate;

// The owner's whole sign-in, as the browser makes it: begin, Higgsfield's page (the stand-in says yes at once), then
// the return address on the home screen. -> { begin, back, query }.
async function signIn(h) {
  const begin = await post(h, "/api/generation/higgsfield/begin");
  assert.equal(begin.status, 200, begin.text);
  const there = await fetch(begin.json.url, { redirect: "manual" });
  const to = new URL(there.headers.get("location"));
  assert.equal(`${to.protocol}//${to.host}${to.pathname}`, `${h.url}/api/generation/higgsfield/back`);
  const back = await call(h.url, "GET", `${to.pathname}${to.search}`);
  return { begin, back, query: to.search };
}

// A made-up door on 127.0.0.1 that answers as `answers` says (by path), and keeps what it saw.
async function fakeDoor(answers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      const a = answers[req.url] || { status: 404, body: { code: "gen_not_found" } };
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

function writeStatus(config, higgsfield) {
  rmSync(config.paths.generateStatus, { force: true });
  writeFileSync(config.paths.generateStatus, JSON.stringify({ higgsfield, apps: {} }), { mode: 0o600 });
}

// ---- the switches file keeps the block ---------------------------------------------------------------------------

test("checkDoors keeps generate.higgsfield { on, centsPerCredit }: missing is off at 5; any other key or kind is refused", () => {
  const base = freshDoors();
  assert.deepEqual(base.generate.higgsfield, { on: false, centsPerCredit: 5 });
  const without = structuredClone(base);
  delete without.generate.higgsfield;
  assert.deepEqual(checkDoors(without).generate.higgsfield, { on: false, centsPerCredit: 5 });
  const set = (h) => { const s = structuredClone(base); s.generate.higgsfield = h; return checkDoors(s); };
  assert.deepEqual(set({ on: true, centsPerCredit: 7 }).generate.higgsfield, { on: true, centsPerCredit: 7 });
  assert.deepEqual(set({ on: true }).generate.higgsfield, { on: true, centsPerCredit: 5 });
  assert.deepEqual(set(null).generate.higgsfield, { on: false, centsPerCredit: 5 });
  for (const bad of [{ on: "yes" }, { centsPerCredit: 0 }, { centsPerCredit: 51 }, { centsPerCredit: 5.5 }, { centsPerCredit: "5" },
    { on: true, centsPerCredit: 5, token: "x" }, [], "on"]) {
    assert.equal(set(bad), null, JSON.stringify(bad));
  }
});

test("every save keeps the Higgsfield block (today's checkDoors dropped it), and the door reads what was saved", async () => {
  await withHf(async ({ h }) => {
    updateDoors(h.config, (s) => { s.generate.higgsfield = { on: true, centsPerCredit: 9 }; });
    let r = await post(h, "/api/generation/caps", { daily: 500 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(fileGen(h).higgsfield, { on: true, centsPerCredit: 9 }, "a caps save keeps it");
    updateDoors(h.config, (s) => { s.web.on = false; });
    assert.deepEqual(fileGen(h).higgsfield, { on: true, centsPerCredit: 9 }, "another door's save keeps it");
    const gs = readGenState(h.config.paths.doorsState);
    assert.deepEqual([gs.ok, gs.higgsfield], [true, { on: true, centsPerCredit: 9 }], "the door's own reader takes it");
    // A block the door would refuse is a damaged file here too: everything off, and the next save writes a fresh one.
    const raw = JSON.parse(readFileSync(h.config.paths.doorsState, "utf8"));
    raw.generate.higgsfield.extra = 1;
    rmSync(h.config.paths.doorsState);
    writeFileSync(h.config.paths.doorsState, JSON.stringify(raw), { mode: 0o600 });
    assert.equal(readDoors(h.config).problem, "state_unreadable");
    const v = await view(h);
    assert.equal(v.problem, "state_unreadable");
    assert.equal(v.higgsfield.on, false);
    r = await post(h, "/api/generation/higgsfield/switch", { on: false });
    assert.equal(r.status, 200);
    assert.deepEqual(fileGen(h).higgsfield, { on: false, centsPerCredit: 5 });
  }, { door: false });
});

// ---- the view ------------------------------------------------------------------------------------------------------

test("the view: Higgsfield off and signed out, its models left out of the choices, the shape kept", async () => {
  await withHf(async ({ h }) => {
    const v = await view(h);
    assert.deepEqual(sameShape(readShape("generation"), v), []);
    assert.deepEqual(v.higgsfield, { on: false, signedIn: false, refused: false, centsPerCredit: 5, sentence: "Not signed in." });
    for (const list of Object.values(v.choices)) assert.ok(list.every((c) => c.provider === "runway" && !c.model.startsWith("hf.")));
  });
});

test("the view: signed in through the door, then on: hf.flux_2 a still choice with its service and a dollar price at the rate", async () => {
  await withHf(async ({ h }) => {
    const { back } = await signIn(h);
    assert.equal(back.status, 303);
    assert.equal(back.headers.location, HF_BACK_CONNECTED);
    let v = await view(h);
    assert.deepEqual(v.higgsfield, { on: false, signedIn: true, refused: false, centsPerCredit: 5, sentence: "Signed in." });
    assert.ok(!v.choices.still.some((c) => c.model === "hf.flux_2"), "signed in but off: not a choice");
    const r = await post(h, "/api/generation/higgsfield/switch", { on: true });
    assert.equal(r.status, 200, r.text);
    v = r.json;
    assert.equal(v.higgsfield.on, true);
    const flux = v.choices.still.find((c) => c.model === "hf.flux_2");
    assert.deepEqual(flux, { model: "hf.flux_2", provider: "higgsfield", words: "FLUX.2 Max on Higgsfield: about $0.20 a picture" });
    assert.ok(!v.choices.video.some((c) => c.model.startsWith("hf.")), "no Higgsfield clip model has a price yet");
    v = (await post(h, "/api/generation/higgsfield/rate", { centsPerCredit: 7 })).json;
    assert.equal(v.choices.still.find((c) => c.model === "hf.flux_2").words, "FLUX.2 Max on Higgsfield: about $0.28 a picture");
    assert.deepEqual(sameShape(readShape("generation"), v), []);
  });
});

test("the view: Higgsfield asked for a new sign-in (the door's status file): refused, not signed in, no Higgsfield choices", async () => {
  await withHf(async ({ h }) => {
    updateDoors(h.config, (s) => { s.generate.higgsfield = { on: true, centsPerCredit: 5 }; });
    writeStatus(h.config, { signedIn: false, refused: true });
    const v = await view(h);
    assert.deepEqual(v.higgsfield, { on: true, signedIn: false, refused: true, centsPerCredit: 5, sentence: "Higgsfield asked you to sign in again." });
    assert.ok(!v.choices.still.some((c) => c.model.startsWith("hf.")));
    writeStatus(h.config, { signedIn: true, refused: false });
    const w = await view(h);
    assert.deepEqual([w.higgsfield.signedIn, w.higgsfield.refused, w.higgsfield.sentence], [true, false, "Signed in."], "the door off: its status file says");
    assert.ok(w.choices.still.some((c) => c.model === "hf.flux_2"));
  }, { door: false });
});

// ---- the switch and the rate ---------------------------------------------------------------------------------------

test("the switch: on is refused while signed out (409 cannot_switch_on), nothing written; off is always taken", async () => {
  await withHf(async ({ h }) => {
    const r = await post(h, "/api/generation/higgsfield/switch", { on: true });
    assert.equal(r.status, 409);
    assert.deepEqual([r.json.error.code, r.json.error.message], ["cannot_switch_on", HF_SWITCH_REFUSED]);
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    writeStatus(h.config, { signedIn: false, refused: true });
    assert.equal((await post(h, "/api/generation/higgsfield/switch", { on: true })).status, 409, "refused by Higgsfield is not signed in");
    for (const bad of [{ on: "yes" }, {}, { on: 1 }, { on: true, extra: 1 }]) {
      const b = await post(h, "/api/generation/higgsfield/switch", bad);
      assert.deepEqual([b.status, b.json.error.code], [400, "bad_switch"], JSON.stringify(bad));
    }
    const off = await post(h, "/api/generation/higgsfield/switch", { on: false });
    assert.equal(off.status, 200);
    assert.deepEqual(fileGen(h).higgsfield, { on: false, centsPerCredit: 5 });
  });
});

test("the rate: whole cents from 1 to 50 are saved and read by the door; anything else is 400 bad_rate and nothing is written", async () => {
  await withHf(async ({ h }) => {
    for (const bad of [{ centsPerCredit: 0 }, { centsPerCredit: 51 }, { centsPerCredit: 4.9 }, { centsPerCredit: "5" }, { centsPerCredit: null }, {},
      { centsPerCredit: 5, on: true }]) {
      const r = await post(h, "/api/generation/higgsfield/rate", bad);
      assert.deepEqual([r.status, r.json.error.code], [400, "bad_rate"], JSON.stringify(bad));
      assert.equal(r.json.error.message, "One Higgsfield credit must count as a whole number of cents from 1 to 50.");
    }
    assert.equal(existsSync(h.config.paths.doorsState), false);
    for (const rate of [1, 50, 7]) {
      const r = await post(h, "/api/generation/higgsfield/rate", { centsPerCredit: rate });
      assert.equal(r.status, 200);
      assert.equal(r.json.higgsfield.centsPerCredit, rate);
      assert.equal(readGenState(h.config.paths.doorsState).higgsfield.centsPerCredit, rate);
    }
    assert.deepEqual(fileGen(h).higgsfield, { on: false, centsPerCredit: 7 }, "the switch stays as it was");
  }, { door: false });
});

// ---- models -----------------------------------------------------------------------------------------------------

test("models: a Higgsfield model is refused while Higgsfield is off or signed out, and taken once it is on and signed in", async () => {
  await withHf(async ({ h }) => {
    let r = await post(h, "/api/generation/models", { still: "hf.flux_2" });
    assert.deepEqual([r.status, r.json.error.code, r.json.error.message, r.json.field], [400, "bad_model", HF_NOT_READY_MODEL, "still"]);
    await signIn(h);
    r = await post(h, "/api/generation/models", { still: "hf.flux_2" });
    assert.equal(r.status, 400, "signed in but off");
    assert.equal(existsSync(h.config.paths.doorsState) ? fileGen(h).models.still : "gen4_image", "gen4_image");
    await post(h, "/api/generation/higgsfield/switch", { on: true });
    r = await post(h, "/api/generation/models", { still: "hf.flux_2" });
    assert.equal(r.status, 200, r.text);
    assert.equal(fileGen(h).models.still, "hf.flux_2");
    r = await post(h, "/api/generation/models", { video: "hf.wan2_6" });
    assert.deepEqual([r.status, r.json.error.message], [400, "The door has no price for this model."], "a Higgsfield row without a price");
    r = await post(h, "/api/generation/models", { video: "veo3.1" });
    assert.equal(r.status, 400, "a Runway row the door does not price for the Artist");
  });
});

// ---- the sign-in -------------------------------------------------------------------------------------------------

test("begin: the door's authorize address on the stand-in; an address on another host or path is refused; the door off", async () => {
  await withHf(async ({ h, hf }) => {
    const r = await post(h, "/api/generation/higgsfield/begin");
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.url.startsWith(`${hf.url}/oauth2/authorize?`));
    assert.deepEqual(Object.keys(r.json), ["url"]);
    const q = new URL(r.json.url).searchParams;
    assert.equal(q.get("redirect_uri"), `${h.url}/api/generation/higgsfield/back`);
    assert.equal(q.get("code_challenge_method"), "S256");
  });
  for (const url of ["https://evil.example/oauth2/authorize?x=1", `${HF_ORIGIN}/oauth2/authorize?x=1`, "http://127.0.0.1:1/oauth2/token?x=1", 42]) {
    const fake = await fakeDoor({ "/gen/owner/higgsfield/begin": { status: 200, body: { url } } });
    const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0 });
    try {
      mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
      ensureSecret(h.config.paths.generateSecret);
      h.app.home.urls.generate = fake.url;
      h.app.home.higgsfieldOrigin = "http://127.0.0.1:9";
      const r = await post(h, "/api/generation/higgsfield/begin");
      assert.deepEqual([r.status, r.json.error.code], [502, "higgsfield_failed"], String(url));
      assert.ok(!r.text.includes("evil"), "the address is never sent back");
    } finally { await h.close(); await fake.close(); }
  }
  await withHf(async ({ h }) => {
    const r = await post(h, "/api/generation/higgsfield/begin");
    assert.deepEqual([r.status, r.json.error.code, r.json.error.message], [409, "door_off", "The generation door is off. Run: engine start"]);
  }, { door: false });
});

test("the real Higgsfield address is the only one taken without a test origin", async () => {
  const good = `${HF_ORIGIN}/oauth2/authorize?response_type=code`;
  const fake = await fakeDoor({ "/gen/owner/higgsfield/begin": { status: 200, body: { url: good } } });
  const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0 });
  try {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    ensureSecret(h.config.paths.generateSecret);
    h.app.home.urls.generate = fake.url;
    for (const origin of [undefined, "https://evil.example", "http://localhost:9"]) {
      h.app.home.higgsfieldOrigin = origin;
      const r = await post(h, "/api/generation/higgsfield/begin");
      assert.deepEqual([r.status, r.json.url], [200, good], String(origin));
    }
  } finally { await h.close(); await fake.close(); }
});

test("back: connected with the door's finish; the token file is the door's; the query is in no log line of the home or the door", async () => {
  await withHf(async ({ h, logs, doorLogs }) => {
    const { back, query } = await signIn(h);
    assert.equal(back.status, 303);
    assert.equal(back.headers.location, "/#/settings?generation=connected");
    assert.equal(back.headers["referrer-policy"], "no-referrer");
    assert.equal(back.headers["cache-control"], "no-store");
    assert.ok(existsSync(h.config.paths.higgsfieldAuth), "the door kept its sign-in");
    const params = new URLSearchParams(query);
    const all = [...logs, ...doorLogs].join("\n");
    for (const v of [params.get("code"), params.get("state")]) {
      assert.ok(v && v.length >= 16);
      assert.ok(!all.includes(v), "a code or state in a log line");
    }
    assert.ok(logs.some((l) => l === "generation: the Higgsfield sign-in came back (connected)"));
    const v = await view(h);
    assert.ok(!JSON.stringify(v).includes(params.get("code")));
    // The same return again: the door's pending sign-in is gone, so it fails and changes nothing.
    const again = await call(h.url, "GET", `/api/generation/higgsfield/back${query}`);
    assert.equal(again.headers.location, HF_BACK_FAILED);
  });
});

test("back: a bad or missing code or state calls nothing and writes nothing; a state the door did not make fails", async () => {
  const fake = await fakeDoor({ "/gen/owner/higgsfield/finish": { status: 200, body: { connected: true } } });
  const logs = [];
  const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  try {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    ensureSecret(h.config.paths.generateSecret);
    h.app.home.urls.generate = fake.url;
    const bad = [
      "", `?code=abc`, `?state=${STATE_HEX}`, `?code=abc&state=${STATE_HEX.slice(2)}`, `?code=abc&state=${STATE_HEX.toUpperCase()}`,
      `?code=a%20b&state=${STATE_HEX}`, `?code=${"a".repeat(513)}&state=${STATE_HEX}`, `?code=a/b&state=${STATE_HEX}`,
      `?error=access_denied&state=${STATE_HEX}`,
    ];
    for (const q of bad) {
      const r = await call(h.url, "GET", `/api/generation/higgsfield/back${q}`);
      assert.deepEqual([r.status, r.headers.location], [303, HF_BACK_FAILED], q);
    }
    assert.equal(fake.seen.length, 0, "nothing was called");
    assert.equal(existsSync(h.config.paths.higgsfieldAuth), false);
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    // A good-looking pair goes to the door's finish with exactly code and state; the door's yes is the only yes.
    const ok = await call(h.url, "GET", `/api/generation/higgsfield/back?code=Xy_9.~-&state=${STATE_HEX}&iss=x`);
    assert.equal(ok.headers.location, HF_BACK_CONNECTED);
    assert.equal(fake.seen.length, 1);
    assert.deepEqual([fake.seen[0].method, fake.seen[0].url, JSON.parse(fake.seen[0].body)], ["POST", "/gen/owner/higgsfield/finish", { code: "Xy_9.~-", state: STATE_HEX }]);
    for (const l of logs) assert.ok(!l.includes(STATE_HEX) && !l.includes("Xy_9"), l);
  } finally { await h.close(); await fake.close(); }
  await withHf(async ({ h }) => {
    await post(h, "/api/generation/higgsfield/begin");
    const r = await call(h.url, "GET", `/api/generation/higgsfield/back?code=madeup&state=${STATE_HEX}`);
    assert.equal(r.headers.location, HF_BACK_FAILED, "a state the door did not make");
    assert.equal(existsSync(h.config.paths.higgsfieldAuth), false, "nothing written");
    assert.equal((await view(h)).higgsfield.signedIn, false);
  });
});

test("back with no door: failed, nothing called", async () => {
  await withHf(async ({ h }) => {
    const r = await call(h.url, "GET", `/api/generation/higgsfield/back?code=abc&state=${STATE_HEX}`);
    assert.deepEqual([r.status, r.headers.location], [303, HF_BACK_FAILED]);
  }, { door: false });
});

test("forget: the door removes its sign-in and the view says signed out; with the door off it is refused", async () => {
  await withHf(async ({ h }) => {
    await signIn(h);
    await post(h, "/api/generation/higgsfield/switch", { on: true });
    const r = await post(h, "/api/generation/higgsfield/forget");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.higgsfield.signedIn, r.json.higgsfield.refused, r.json.higgsfield.sentence], [false, false, "Not signed in."]);
    assert.equal(existsSync(h.config.paths.higgsfieldAuth), false);
    assert.ok(!r.json.choices.still.some((c) => c.model.startsWith("hf.")));
  });
  await withHf(async ({ h }) => {
    const r = await post(h, "/api/generation/higgsfield/forget");
    assert.deepEqual([r.status, r.json.error.code], [409, "door_off"]);
  }, { door: false });
});

// ---- Test ------------------------------------------------------------------------------------------------------------

test("Test: signed out, then the balance in words; the door off; Higgsfield's refusal and other answers in plain words", async () => {
  await withHf(async ({ h }) => {
    let r = await post(h, "/api/generation/higgsfield/test");
    assert.deepEqual(r.json, { ok: false, credits: null, plan: null, sentence: "Not signed in to Higgsfield." });
    await signIn(h);
    r = await post(h, "/api/generation/higgsfield/test");
    assert.equal(r.json.ok, true);
    assert.equal(r.json.credits, 3896);
    assert.equal(r.json.sentence, "Higgsfield says you have 3896 credits.");
  });
  await withHf(async ({ h }) => {
    const r = await post(h, "/api/generation/higgsfield/test");
    assert.deepEqual(r.json, { ok: false, credits: null, plan: null, sentence: "The generation door is off. Run: engine start" });
  }, { door: false });
  const answers = [
    [{ status: 403, body: { code: "gen_hf_refused" } }, "Higgsfield asked you to sign in again."],
    [{ status: 403, body: { code: "gen_hf_signed_out" } }, "Not signed in to Higgsfield."],
    [{ status: 403, body: { code: "gen_could_not_start", error: { message: "secret words" } } }, "Higgsfield did not answer. Try again in a minute."],
    [{ status: 200, body: { credits: "lots" } }, "Higgsfield did not answer. Try again in a minute."],
    [{ status: 200, body: { credits: 1, plan: "max" } }, "Higgsfield says you have 1 credit."],
  ];
  for (const [a, sentence] of answers) {
    const fake = await fakeDoor({ "/gen/owner/higgsfield/balance": a });
    const h = await startV2({ routes: ["generation"], inbox: [], search: [], port: 0 });
    try {
      mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
      ensureSecret(h.config.paths.generateSecret);
      h.app.home.urls.generate = fake.url;
      const r = await post(h, "/api/generation/higgsfield/test");
      assert.equal(r.json.sentence, sentence);
      assert.ok(!r.text.includes("secret words"));
    } finally { await h.close(); await fake.close(); }
  }
});

// ---- prices and the ledger ------------------------------------------------------------------------------------

test("prices in cents as the door prices the Artist's work: step 3's Runway rows, Higgsfield at its largest size and the rate", () => {
  assert.equal(priceCents({ kind: "image_to_video", model: "gen4_turbo", seconds: 5 }), 25);
  assert.equal(priceCents({ kind: "still_variation", model: "gen4_image" }), 8);
  assert.equal(priceCents({ kind: "still_variation", model: "hf.flux_2" }), 20);
  assert.equal(priceCents({ kind: "still_variation", model: "hf.flux_2" }, { centsPerCredit: 7 }), 28);
  assert.equal(priceCents({ kind: "still_variation", model: "hf.flux_2" }, { centsPerCredit: 7 }),
    estimateCents({ kind: "still_variation", model: "hf.flux_2", resolution: "2k" }, { centsPerCredit: 7 }), "the door's own sum");
  assert.equal(priceCents({ kind: "image_to_video", model: "veo3.1", seconds: 5 }), null, "not a model the door prices for the Artist");
  assert.equal(priceCents({ kind: "image_to_video", model: "hf.wan2_6", seconds: 5 }), null, "no price yet");
  assert.equal(priceCents({ kind: "still_variation", model: "hf.flux_2" }, { centsPerCredit: 51 }), null);
  assert.equal(priceWords("hf.flux_2", { centsPerCredit: 5 }), "FLUX.2 Max on Higgsfield: about $0.20 a picture");
  assert.deepEqual(modelChoices({ higgsfield: true }).still.map((c) => c.model), ["gen4_image", "gen4_image_turbo", "hf.flux_2"]);
  assert.deepEqual(modelChoices().still.map((c) => c.model), ["gen4_image", "gen4_image_turbo"]);
});

test("ledger rows name their service and an app by its name; Higgsfield's refusals say Higgsfield; old lines stay Runway's", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "uuu-gen-hf-apps-"));
  try {
    const dir = join(tmp, "apps", "render-to-film");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), JSON.stringify({
      version: 1, slug: "render-to-film", name: "Render to Film", about: "Turn a render into a film.", port: 3171, entry: ".build/index.mjs",
      client: "dist", engine: ["generate", "relay"], tools: [], icon: "icon.svg", memoryMb: 512,
    }), { mode: 0o644 });
    writeFileSync(join(dir, "icon.svg"), SVG, { mode: 0o644 });
    await withHf(async ({ h }) => {
      h.config.paths.appsCode = join(tmp, "apps");
      const now = Date.now() - 60_000;
      const line = (f) => JSON.stringify({ at: iso(now), job: null, batch: null, shot: null, slug: "artist", kind: "still_variation", model: "gen4_image",
        seconds: null, estimate: 8, state: "reserved", credits: 8, runwayTask: null, verdict: null, ...f });
      const lines = [
        line({ job: "j1", batch: "a11111111111111111111", slug: "app-render-to-film", model: "gemini_image3_pro", estimate: 40, credits: 40, provider: "runway", app: "render-to-film" }),
        line({ at: iso(now + 1000), job: "j1", batch: "a11111111111111111111", slug: "app-render-to-film", model: "gemini_image3_pro", estimate: 40, state: "spent", credits: 40, verdict: "done", provider: "runway", app: "render-to-film" }),
        line({ at: iso(now + 2000), job: "j2", batch: "b22222222222222222222", model: "hf.flux_2", estimate: 20, credits: 20, provider: "higgsfield", units: 4, rate: 5 }),
        line({ at: iso(now + 3000), job: "j2", batch: "b22222222222222222222", model: "hf.flux_2", estimate: 20, state: "spent", credits: 20, verdict: "refused", provider: "higgsfield", units: 4, rate: 5 }),
        line({ at: iso(now + 4000), job: "j3" }),
        line({ at: iso(now + 5000), job: "j4", slug: "app-other-app", kind: "image_to_video", seconds: 5, model: "gen4_turbo", estimate: 25, credits: 25 }),
      ];
      writeFileSync(h.config.paths.ledger, `${lines.join("\n")}\n`, { mode: 0o600 });
      chmodSync(h.config.paths.ledger, 0o600);
      const p = (await call(h.url, "GET", "/api/generation/ledger")).json;
      assert.equal(p.ok, true, JSON.stringify(p));
      const rows = new Map(p.days[0].rows.map((r) => [r.model + r.at, r]));
      const by = (job) => [...rows.values()].find((r) => r.at === iso(now + { j1: 0, j2: 2000, j3: 4000, j4: 5000 }[job]));
      assert.deepEqual([by("j1").provider, by("j1").app, by("j1").words], ["runway", { slug: "render-to-film", name: "Render to Film" }, "Render to Film: picture, Nano Banana Pro"]);
      assert.equal(by("j1").task, null, "an app's job has no task");
      assert.deepEqual([by("j2").provider, by("j2").app, by("j2").result, by("j2").credits], ["higgsfield", null, "Refused by Higgsfield", 20]);
      assert.deepEqual([by("j3").provider, by("j3").app, by("j3").words], ["runway", null, "Variation"]);
      assert.deepEqual([by("j4").app, by("j4").words], [{ slug: "other-app", name: "other-app" }, "other-app: clip, 5 s, Gen-4 Turbo"], "an app with no manifest by its slug");
    }, { door: false });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(appJobWords("Render to Film", "still_upscale", null, "magnific_precision_upscaler_v2"), "Render to Film: larger picture, Magnific Precision upscale");
  assert.equal(resultWords({ end: { state: "spent", verdict: "bad_input" } }, "higgsfield"), "Higgsfield could not use the picture");
  assert.equal(resultWords({ end: { state: "spent", verdict: "bad_input" } }), "Runway could not use the picture");
});
