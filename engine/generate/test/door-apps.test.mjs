// The generation door's app routes (PLAN-V5 K19, K20, K22; T73) against the stand-in Runway and the
// stand-in Higgsfield: an app's token, its own routes, its allowance, one ledger in cents and the caps
// shared with the Artist. Made-up secrets, ids, a made-up key and made-up tokens in a temp state
// folder; every socket lands on 127.0.0.1.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { CODES, createGenerateDoor } from "../door.mjs";
import { readLedger } from "../ledger.mjs";
import { readAllowance, readGenState } from "../state.mjs";
import { mp4Bytes, pngBytes, startRunway } from "../../test/stubs/runway.mjs";
import { startHiggsfield } from "../../test/stubs/higgsfield.mjs";

const GEN_SECRET = "2".repeat(64);
const WEB_SECRET = "1".repeat(64);
const KEY = `key_${"0123456789abcdef".repeat(8)}`;
const ARTIST = "99999999-2222-4333-8444-555555555555";
const SCOUT = "88888888-2222-4333-8444-555555555555";
const APP = "render-to-film";
const OTHER = "other-app";
const ALLOWANCE = `a${"1".repeat(20)}`;
const REDIRECT = "http://127.0.0.1:41999/api/generation/higgsfield/back";
const PROMPT = "the stair at dawn, secret-prompt-words";

let rw;
let hf;
let door;
let port;
let dir;
let paths;
let lines;

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const agent = (id = ARTIST) => mintToken(GEN_SECRET, "a", id, exp());
const owner = () => mintToken(GEN_SECRET, "t", "owner", exp());
const app = (name = APP, secret = GEN_SECRET) => mintToken(secret, "t", `app-${name}`, exp());

function put(path, text, mode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, typeof text === "string" || Buffer.isBuffer(text) ? text : JSON.stringify(text));
  chmodSync(path, mode);
}
function setGen(gen = {}, mode = 0o600) {
  put(paths.doorsState, { version: 1, generate: { on: true, dailyCredits: 3000, monthlyCredits: 10000, autoUnderCredits: 0, ...gen },
    changedAt: "2026-11-14T10:00:00.000Z" }, mode);
}
const hfOn = (extra = {}) => setGen({ higgsfield: { on: true, centsPerCredit: 5, ...extra.higgsfield }, ...extra.gen });
function allow(fields = {}, name = APP, mode = 0o600) {
  const now = Date.now();
  put(join(paths.allowances, `${name}.json`), {
    version: 1, id: ALLOWANCE, app: name, approvedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 6 * 3600_000).toISOString(),
    budgetCents: 500, ...fields,
  }, mode);
}
function seed(lines2) {
  put(paths.ledger, lines2.map((l) => JSON.stringify({
    at: new Date().toISOString(), job: `g${Math.random().toString(16).slice(2, 12)}`, batch: null, shot: null, slug: "artist", kind: "image_to_video",
    model: "gen4_turbo", seconds: 5, estimate: 25, state: "spent", credits: 25, runwayTask: null, verdict: "done", ...l,
  })).join("\n") + "\n");
}

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString("utf8"), json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const call = (path, body, token = app()) => request("POST", path, {
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const get = (path, token = app()) => request("GET", path, { headers: { Authorization: `Bearer ${token}` } });
const upload = (bytes, token = app(), path = "/gen/app/inputs") => request("POST", path, {
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, body: bytes,
});
let pictures = 0;
async function input(token = app(), bytes = pngBytes(1280, 720, 2048 + (pictures += 1)), path = "/gen/app/inputs") {
  const r = await upload(bytes, token, path);
  assert.equal(r.status, 201, r.text);
  return r.json.input;
}
const clipJob = (id, extra = {}) => ({ model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: id, role: "first" }], prompt: PROMPT, seconds: 5, ratio: "1280:720", ...extra });
const fluxJob = (id, extra = {}) => ({ model: "hf.flux_2", kind: "still_variation", inputs: [{ input: id, role: "ref" }], prompt: PROMPT, ratio: "16:9", resolution: "2k", ...extra });
async function settled(job, token = app(), ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await get(`/gen/app/jobs/${job}`, token);
    if (r.json && ["done", "failed", "refused"].includes(r.json.state)) return r.json;
    if (Date.now() > end) throw new Error(`job ${job} did not end: ${r.text}`);
    await new Promise((res) => setTimeout(res, 15));
  }
}
const ledger = () => (existsSync(paths.ledger) ? readFileSync(paths.ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const creates = () => rw.seen.api.filter((r) => r.method === "POST");
const hfTool = (name) => hf.calls.filter((c) => c.rpc === "tools/call" && c.tool === name);
function behave(b = {}) {
  for (const k of Object.keys(rw.behaviour)) delete rw.behaviour[k];
  Object.assign(rw.behaviour, b);
}
async function signIn() {
  const b = await call("/gen/owner/higgsfield/begin", "", owner());
  assert.equal(b.status, 200, b.text);
  const back = new URL((await fetch(b.json.url, { redirect: "manual" })).headers.get("location"));
  const f = await call("/gen/owner/higgsfield/finish", { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, owner());
  assert.deepEqual(f.json, { connected: true });
}
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("the condition did not hold in time");
    await new Promise((res) => setTimeout(res, 10));
  }
}

async function startDoor(extra = {}) {
  if (door) await door.close();
  door = createGenerateDoor({
    listenPort: 0, upstream: rw.url, paths,
    config: { doors: { generate: { agents: ["artist", "scout"], apps: [APP, OTHER] } } },
    log: (l) => lines.push(l), net: rw.net,
    limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000, pollErrors: 3 },
    higgsfield: { origin: hf.url, redirectUri: REDIRECT, net: hf.net, uploadSuffixes: ["higgsfield.test"], limits: { downloadMs: 3000 }, mcpLimits: { callMs: 3000 } },
    ...extra,
  });
  port = await door.listen();
  await door.settled();
}

before(async () => { rw = await startRunway({ key: KEY }); });
after(async () => { if (door) await door.close(); await rw.close(); });
beforeEach(async () => {
  hf = await startHiggsfield();
  dir = mkdtempSync(join(tmpdir(), "gen-apps-"));
  mkdirSync(join(dir, "doors", "batches"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "doors", "allowances"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "secrets", "doors"), { recursive: true, mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"),
    generateSecret: join(dir, "secrets", "doors", "generate-secret"), generateStatus: join(dir, "doors", "generate-status.json"),
    runwayKey: join(dir, "secrets", "doors", "runway-key"), ledger: join(dir, "doors", "generate-ledger.jsonl"),
    batches: join(dir, "doors", "batches"), doorWork: join(dir, "doors", "work"),
    allowances: join(dir, "doors", "allowances"), higgsfieldAuth: join(dir, "secrets", "doors", "higgsfield-oauth.json"),
  };
  put(paths.ids, { agents: { artist: ARTIST, scout: SCOUT } }, 0o644);
  put(paths.generateSecret, `${GEN_SECRET}\n`);
  put(paths.runwayKey, `${KEY}\n`);
  setGen();
  allow();
  behave();
  rw.seen.api.length = 0;
  rw.seen.outputs.length = 0;
  lines = [];
  await startDoor();
});
afterEach(async () => {
  if (door) { await door.close(); door = null; }
  await hf.close();
  // No log line ever holds the key, a token or a prompt.
  for (const l of lines) {
    assert.ok(!l.includes(KEY) && !l.includes(KEY.slice(-12)), `key in log: ${l}`);
    assert.ok(!/v1\.[at]\./.test(l), `token in log: ${l}`);
    assert.ok(!l.includes("secret-prompt-words"), `prompt in log: ${l}`);
    for (const t of [hf.tokens.access, hf.tokens.refresh]) if (t) assert.ok(!l.includes(t), `higgsfield token in log: ${l}`);
  }
});

// ---- who may come in --------------------------------------------------------------------------------
test("an app token is nothing at the Artist's routes or the owner's", async () => {
  const id = await input(agent(), undefined, "/gen/inputs");
  for (const r of [
    await call("/gen/jobs", { batch: null, kind: "image_to_video", input: id, promptText: "p", seconds: 5, ratio: "1280:720" }),
    await upload(pngBytes(1280, 720, 4000), app(), "/gen/inputs"),
    await call("/gen/estimate", { items: [{ kind: "image_to_video", seconds: 5 }] }),
    await get(`/gen/jobs/gx`),
    await call("/gen/owner/balance", {}),
    await call("/gen/owner/higgsfield/begin", ""),
    await call("/gen/owner/higgsfield/balance", ""),
  ]) {
    assert.equal(r.status, 401, r.text);
    assert.equal(r.json.code, "gen_no_token");
  }
  assert.equal(creates().length, 0);
});

test("an agent token and the owner's token are nothing at an app's routes", async () => {
  for (const token of [agent(), owner()]) {
    for (const r of [await get("/gen/app/models", token), await get("/gen/app/allowance", token), await call("/gen/app/estimate", { items: [] }, token),
      await upload(pngBytes(1280, 720, 4100), token), await call("/gen/app/jobs", {}, token)]) {
      assert.equal(r.status, 401, r.text);
      assert.equal(r.json.code, "gen_no_token");
    }
  }
});

test("an app not listed, another door's key and no token are refused", async () => {
  for (const r of [await get("/gen/app/models", app("not-listed")), await get("/gen/app/models", app(APP, WEB_SECRET)),
    await request("GET", "/gen/app/models"), await get("/gen/app/models", mintToken(GEN_SECRET, "t", "apps-render-to-film", exp()))]) {
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "gen_no_token");
  }
  assert.equal((await get("/gen/app/models", app(OTHER))).status, 200);
});

// ---- A1: the state and the pause ------------------------------------------------------------------------
test("A1: the Artist's switch off does not stop an app; an unreadable state and a pause do", async () => {
  setGen({ on: false });
  assert.equal((await get("/gen/app/models")).status, 200);
  const r = await call("/gen/app/jobs", clipJob(await input()));
  assert.equal(r.status, 202, r.text);
  setGen({}, 0o666);
  assert.equal((await get("/gen/app/models")).json.code, "gen_off");
  put(paths.doorsState, "{ not json");
  assert.equal((await call("/gen/app/jobs", clipJob("i0"))).json.code, "gen_off");
  setGen();
  const id = await input();
  setGen({ paused: "owner" });
  assert.equal((await call("/gen/app/jobs", clipJob(id))).json.code, "gen_paused");
  assert.equal((await upload(pngBytes(1280, 720, 4200))).json.code, "gen_paused");
});

// ---- the models and prices ---------------------------------------------------------------------------------
test("models: every row with its price in cents at the owner's rate and whether it is ready now", async () => {
  const m = (await get("/gen/app/models")).json.models;
  const by = (id) => m.find((x) => x.id === id);
  assert.deepEqual([by("gen4_turbo").ready, by("gen4_turbo").price.per, by("gen4_turbo").price.cents], [true, "second", 5]);
  assert.deepEqual([by("hf.flux_2").ready, by("hf.flux_2").why], [false, "Needs Higgsfield. Switch it on and sign in from Settings on the home screen."]);
  assert.equal(by("hf.flux_2").price.cents, 20);
  rmSync(paths.runwayKey);
  hfOn({ higgsfield: { centsPerCredit: 7 } });
  await signIn();
  const n = (await get("/gen/app/models")).json.models;
  assert.deepEqual([n.find((x) => x.id === "gen4_turbo").ready, n.find((x) => x.id === "gen4_turbo").why], [false, "Needs a Runway key. Add it in Settings on the home screen."]);
  assert.deepEqual([n.find((x) => x.id === "hf.flux_2").ready, n.find((x) => x.id === "hf.flux_2").price.cents], [true, 28]);
  assert.equal(n.find((x) => x.id === "hf.wan2_6").ready, false, "a row with no price is never ready");
});

test("estimate: 1 to 20 items from the table only, at the owner's rate; no price is null", async () => {
  hfOn({ higgsfield: { centsPerCredit: 7 } });
  const r = await call("/gen/app/estimate", { items: [
    { model: "gen4_turbo", kind: "image_to_video", seconds: 5 }, { model: "hf.flux_2", kind: "still_variation", resolution: "2k" },
    { model: "magnific_precision_upscaler_v2", kind: "still_upscale", scale: 4 }] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { items: [{ model: "gen4_turbo", cents: 25 }, { model: "hf.flux_2", cents: 28 }, { model: "magnific_precision_upscaler_v2", cents: 25 }], total: 78 });
  const n = await call("/gen/app/estimate", { items: [{ model: "hf.wan2_6", kind: "image_to_video", seconds: 5, resolution: "720p" }, { model: "nope", kind: "still_variation" }] });
  assert.deepEqual(n.json, { items: [{ model: "hf.wan2_6", cents: null }, { model: "nope", cents: null }], total: null });
  for (const body of [{ items: [] }, { items: Array.from({ length: 21 }, () => ({ model: "gen4_turbo", kind: "image_to_video", seconds: 5 })) },
    { items: [{ model: "gen4_turbo", kind: "image_to_video", seconds: 5, cents: 1 }] }, { items: [{ model: "gen4_turbo", kind: "teleport" }] },
    { items: [{ model: "gen4_turbo", kind: "image_to_video", seconds: "5" }] }, { items: [], more: 1 }, "[]"]) {
    assert.equal((await call("/gen/app/estimate", body)).json.code, "gen_bad_request", JSON.stringify(body).slice(0, 60));
  }
  assert.equal(rw.seen.api.length, 0);
  assert.equal(hf.calls.length, 0);
});

// ---- inputs ------------------------------------------------------------------------------------------------
test("inputs: as an agent's, at most 200 kept a day for an app, its own count", async () => {
  for (let i = 0; i < 200; i += 1) assert.equal((await upload(pngBytes(640, 360, 600 + i))).status, 201);
  const r = await upload(pngBytes(640, 360, 900));
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "gen_bad_input");
  assert.match(r.json.error.message, /200 pictures/);
  assert.equal((await upload(pngBytes(640, 360, 901), app(OTHER))).status, 201);
  assert.equal((await upload(Buffer.from("<html>".padEnd(2000, "x")))).json.code, "gen_bad_input");
});

// ---- whole jobs ----------------------------------------------------------------------------------------------
test("a Runway job for an app: input, job, done, output bytes; the ledger reserved then spent, with its service and app", async () => {
  const id = await input();
  const r = await call("/gen/app/jobs", clipJob(id));
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ["cents", "job"]);
  assert.equal(r.json.cents, 25);
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits, end.output], ["done", 25, { type: "video/mp4", bytes: 4096 }]);
  const out = await get(`/gen/app/jobs/${r.json.job}/output`);
  assert.equal(out.status, 200);
  assert.ok(out.buf.equals(mp4Bytes()));
  const l = ledger();
  assert.deepEqual(l.map((x) => x.state), ["reserved", "reserved", "spent"]);
  for (const x of l) {
    assert.deepEqual([x.provider, x.app, x.batch, x.shot, x.slug], ["runway", APP, ALLOWANCE, null, `app-${APP}`]);
    assert.equal(x.units, undefined);
  }
  assert.equal(l.at(-1).credits, 25);
  const sent = creates()[0];
  assert.deepEqual([sent.path, sent.body.model, sent.body.duration, sent.body.ratio], ["/v1/image_to_video", "gen4_turbo", 5, "1280:720"]);
  assert.match(sent.body.promptImage, /^data:image\/png;base64,/);
});

test("a Higgsfield job for an app: uploaded, priced, made, waited on and fetched; the ledger in cents with units and rate", async () => {
  hfOn();
  await signIn();
  const id = await input();
  const r = await call("/gen/app/jobs", fluxJob(id));
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.cents, 20);
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits, end.output], ["done", 20, { type: "image/png", bytes: pngBytes().length }]);
  const out = await get(`/gen/app/jobs/${r.json.job}/output`);
  assert.ok(out.buf.equals(pngBytes()));
  const l = ledger();
  assert.deepEqual(l.map((x) => x.state), ["reserved", "reserved", "spent"]);
  for (const x of l) assert.deepEqual([x.provider, x.units, x.rate, x.app, x.batch, x.slug], ["higgsfield", 4, 5, APP, ALLOWANCE, `app-${APP}`]);
  assert.match(l.at(-1).runwayTask, /^job_[0-9a-f]{16}$/);
  // The price was asked first, with the same arguments; never a free or unlimited run.
  const gen = hfTool("generate_image").map((c) => c.arguments.params);
  assert.equal(gen.length, 2);
  assert.equal(gen[0].get_cost, true);
  assert.deepEqual({ ...gen[0], get_cost: undefined }, { ...gen[1], get_cost: undefined });
  assert.deepEqual([gen[1].model, gen[1].aspect_ratio, gen[1].resolution, gen[1].use_unlim, gen[1].use_free_gens], ["flux_2", "16:9", "2k", false, false]);
  const puts = hf.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].hasAuth, false);
  assert.equal(rw.seen.api.length, 0, "nothing went to Runway");
});

// ---- A3: the body ---------------------------------------------------------------------------------------------------
test("A3: a key not listed, a model not in the table, a kind, role, ratio, size or seconds not the model's, a long prompt, a control character", async () => {
  const id = await input();
  for (const body of [clipJob(id, { credits: 1 }), clipJob(id, { model: "veo9" }), clipJob(id, { kind: "still_variation" }),
    clipJob(id, { inputs: [{ input: id, role: "ref" }] }), clipJob(id, { ratio: "1:1" }), clipJob(id, { seconds: 11 }), clipJob(id, { resolution: "4K" }),
    clipJob(id, { prompt: "x".repeat(1001) }), clipJob(id, { prompt: "a\u0000b" }), clipJob(id, { inputs: [{ input: id, role: "first" }, { input: "i2", role: "last" }] }),
    fluxJob(id, { inputs: Array.from({ length: 9 }, (_, i) => ({ input: `i${i}`, role: "ref" })) }), { model: "gen4_turbo" }, "[]", "not json"]) {
    const r = await call("/gen/app/jobs", body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 90));
    assert.equal(r.json.code, "gen_bad_request");
  }
  const big = await call("/gen/app/jobs", clipJob(id, { prompt: "x".repeat(300 * 1024) }));
  assert.equal(big.json.code, "gen_bad_request");
  assert.equal(creates().length, 0);
  assert.equal(ledger().length, 0);
});

test("A3: a picture another app or an agent sent, or one never sent, is refused", async () => {
  const theirs = await input(app(OTHER));
  const agents = await input(agent(), undefined, "/gen/inputs");
  for (const id of [theirs, agents, "i0000000000000000000"]) {
    const r = await call("/gen/app/jobs", clipJob(id));
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "gen_bad_request");
    assert.match(r.json.error.message, /this app sent/);
  }
  assert.equal(creates().length, 0);
});

test("an upscale is checked with the picture's real size: past 4096 px it is refused, within it is 25 cents", async () => {
  const wide = await input(app(), pngBytes(2100, 1000, 3000));
  const r = await call("/gen/app/jobs", { model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: wide, role: "image" }], prompt: "", scale: 2 });
  assert.equal(r.json.code, "gen_bad_request");
  const ok = await input(app(), pngBytes(2000, 1000, 3001));
  const o = await call("/gen/app/jobs", { model: "magnific_precision_upscaler_v2", kind: "still_upscale", inputs: [{ input: ok, role: "image" }], prompt: "", scale: 2 });
  assert.equal(o.status, 202, o.text);
  assert.equal(o.json.cents, 25);
  await settled(o.json.job);
  assert.deepEqual([creates()[0].path, creates()[0].body.scaleFactor], ["/v1/image_upscale", 2]);
});

// ---- A2: the service --------------------------------------------------------------------------------------------------
test("A2: a Runway model with no key; a Higgsfield model off, signed out, or asked to sign in again", async () => {
  const id = await input();
  rmSync(paths.runwayKey);
  assert.equal((await call("/gen/app/jobs", clipJob(id))).json.code, "gen_no_key");
  assert.equal((await call("/gen/app/jobs", fluxJob(id))).json.code, "gen_hf_off");
  hfOn();
  assert.equal((await call("/gen/app/jobs", fluxJob(id))).json.code, "gen_hf_signed_out");
  await signIn();
  const file = JSON.parse(readFileSync(paths.higgsfieldAuth, "utf8"));
  put(paths.higgsfieldAuth, { ...file, refused: true });
  const r = await call("/gen/app/jobs", fluxJob(id));
  assert.deepEqual([r.status, r.json.code], [403, "gen_hf_refused"]);
  assert.equal(r.json.error.message, CODES.gen_hf_refused[1]);
  assert.equal(ledger().length, 0);
  assert.equal(hfTool("generate_image").length, 0);
});

// ---- A4: the allowance --------------------------------------------------------------------------------------------------
test("A4: no allowance, an expired one, another app's, an untrusted one, one of the wrong shape", async () => {
  const id = await input();
  const cases = [
    () => rmSync(join(paths.allowances, `${APP}.json`)),
    () => allow({ approvedAt: new Date(Date.now() - 7 * 3600_000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }),
    () => allow({ app: OTHER }),
    () => allow({}, APP, 0o664),
    () => allow({ budgetCents: 12.5 }),
    () => allow({ id: "b0123456789abcdef0123" }),
    () => allow({ extra: true }),
    () => allow({ expiresAt: new Date(Date.now() + 30 * 3600_000).toISOString() }),
  ];
  for (const [i, make] of cases.entries()) {
    make();
    const r = await call("/gen/app/jobs", clipJob(id));
    assert.deepEqual([r.status, r.json.code], [403, "gen_no_allowance"], String(i));
  }
  assert.equal(creates().length, 0);
  assert.equal(ledger().length, 0);
});

test("A5: an allowance spent to its budget refuses the next job; the allowance route says what is left", async () => {
  allow({ budgetCents: 30 });
  assert.deepEqual((await get("/gen/app/allowance")).json, { open: true, budget: 30, spent: 0, left: 30, expiresAt: JSON.parse(readFileSync(join(paths.allowances, `${APP}.json`))).expiresAt });
  const r = await call("/gen/app/jobs", clipJob(await input()));
  assert.equal(r.status, 202);
  await settled(r.json.job);
  const a = (await get("/gen/app/allowance")).json;
  assert.deepEqual([a.open, a.budget, a.spent, a.left], [true, 30, 25, 5]);
  const n = await call("/gen/app/jobs", clipJob(await input()));
  assert.deepEqual([n.status, n.json.code], [403, "gen_over_allowance"]);
  assert.equal(n.json.error.message, "This would go over what the owner allowed this app today.");
  assert.equal(creates().length, 1);
  // A new yes is a new allowance, with its own spend.
  allow({ id: `a${"2".repeat(20)}`, budgetCents: 30 });
  assert.equal((await call("/gen/app/jobs", clipJob(await input()))).status, 202);
});

test("the allowance route: closed when there is none; what is left is held to today's cap too", async () => {
  rmSync(join(paths.allowances, `${APP}.json`));
  assert.deepEqual((await get("/gen/app/allowance")).json, { open: false, budget: 0, spent: 0, left: 0, expiresAt: null });
  allow({ budgetCents: 500 });
  setGen({ dailyCredits: 300 });
  seed([{ credits: 250 }]);
  const a = (await get("/gen/app/allowance")).json;
  assert.deepEqual([a.open, a.spent, a.left], [true, 0, 50]);
  // Another app's allowance is that app's alone.
  assert.equal((await get("/gen/app/allowance", app(OTHER))).json.open, false);
});

test("A5: the caps: a cap of 0, today's, this month's; a damaged ledger spends nothing", async () => {
  const id = await input();
  setGen({ dailyCredits: 0 });
  assert.equal((await call("/gen/app/jobs", clipJob(id))).json.code, "gen_cap_zero");
  setGen({ dailyCredits: 24 });
  assert.equal((await call("/gen/app/jobs", clipJob(id))).json.code, "gen_over_daily");
  setGen({ monthlyCredits: 24 });
  assert.equal((await call("/gen/app/jobs", clipJob(id))).json.code, "gen_over_monthly");
  setGen();
  put(paths.ledger, "{ torn");
  assert.equal((await call("/gen/app/jobs", clipJob(id))).json.code, "gen_ledger");
  assert.equal(creates().length, 0);
});

test("caps shared: the Artist's Runway job of 250 and an app's Higgsfield job of 100 against a daily cap of 300: the second is refused", async () => {
  hfOn({ higgsfield: { centsPerCredit: 25 }, gen: { dailyCredits: 300 } });
  await signIn();
  seed([{ credits: 250, estimate: 250, seconds: 10, model: "gen4.5" }]);
  const r = await call("/gen/app/jobs", fluxJob(await input()));
  assert.deepEqual([r.status, r.json.code], [403, "gen_over_daily"]);
  assert.equal(hfTool("generate_image").length, 0, "not even a price question");
  assert.equal(hf.calls.filter((c) => c.method === "PUT").length, 0);
  setGen({ dailyCredits: 350, higgsfield: { on: true, centsPerCredit: 25 } });
  const ok = await call("/gen/app/jobs", fluxJob(await input()));
  assert.deepEqual([ok.status, ok.json.cents], [202, 100]);
});

// ---- A6, A7, A8 ---------------------------------------------------------------------------------------------------
test("A6: Higgsfield's live price above the table's: refused, nothing reserved, nothing made", async () => {
  hfOn();
  await signIn();
  hf.behaviour.priceHigher = true;
  const r = await call("/gen/app/jobs", fluxJob(await input()));
  assert.deepEqual([r.status, r.json.code], [403, "gen_price_changed"]);
  assert.equal(r.json.error.message, "Higgsfield's price for this is higher than the door's table, so nothing was spent.");
  assert.equal(ledger().length, 0);
  const gen = hfTool("generate_image");
  assert.equal(gen.length, 1);
  assert.equal(gen[0].arguments.params.get_cost, true);
});

test("A7: two jobs running for one app, or four in all, is busy with retryAfterSec 30", async () => {
  behave({ steps: "never" });
  allow({ budgetCents: 1000 });
  allow({ budgetCents: 1000, app: OTHER }, OTHER);
  assert.equal((await call("/gen/app/jobs", clipJob(await input(), { prompt: "a" }))).status, 202);
  assert.equal((await call("/gen/app/jobs", clipJob(await input(), { prompt: "b" }))).status, 202);
  const third = await call("/gen/app/jobs", clipJob(await input(), { prompt: "c" }));
  assert.deepEqual([third.status, third.json.code, third.json.retryAfterSec], [403, "gen_busy", 30]);
  const o = app(OTHER);
  assert.equal((await call("/gen/app/jobs", clipJob(await input(o), { prompt: "d" }), o)).status, 202);
  assert.equal((await call("/gen/app/jobs", clipJob(await input(o), { prompt: "e" }), o)).status, 202);
  // Four in all: an agent with none of its own running is busy too.
  const id = await input(agent(), undefined, "/gen/inputs");
  setGen({ autoUnderCredits: 1000 });
  const a = await call("/gen/jobs", { batch: null, kind: "image_to_video", input: id, promptText: "f", seconds: 5, ratio: "1280:720" }, agent());
  assert.deepEqual([a.json.code, a.json.retryAfterSec], ["gen_busy", 30]);
  assert.match(a.json.error.message, /Four jobs/);
  assert.equal(creates().length, 4);
});

test("A8: Runway refuses the key, says too many, or does not start it", async () => {
  const id = await input();
  behave({ create: 401 });
  assert.equal((await call("/gen/app/jobs", clipJob(id, { prompt: "a" }))).json.code, "gen_key_refused");
  behave({ create: 429, retryAfter: 7 });
  const l = await call("/gen/app/jobs", clipJob(id, { prompt: "b" }));
  assert.deepEqual([l.status, l.json.code, l.json.retryAfterSec], [403, "gen_limited", 7]);
  behave();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal((await call("/gen/app/jobs", clipJob(id, { prompt: "c" }))).json.code, "gen_limited", "the wait is kept at the door");
  assert.equal(ledger().filter((x) => x.state === "released").length, 2, "a clear refusal costs nothing but is counted");
});

test("A8: a 5xx is 'could not start' and its estimate stays counted", async () => {
  behave({ create: 500 });
  const r = await call("/gen/app/jobs", clipJob(await input()));
  assert.equal(r.json.code, "gen_could_not_start");
  const l = ledger();
  assert.deepEqual([l.at(-1).state, l.at(-1).credits, l.at(-1).app], ["spent", 25, APP]);
});

// ---- the app's own, and the Artist's own ------------------------------------------------------------------------------
test("an app sees only its own jobs; an agent's jobs are not an app's and an app's are not an agent's", async () => {
  const r = await call("/gen/app/jobs", clipJob(await input()));
  await settled(r.json.job);
  for (const [path, token] of [[`/gen/app/jobs/${r.json.job}`, app(OTHER)], [`/gen/app/jobs/${r.json.job}/output`, app(OTHER)], [`/gen/jobs/${r.json.job}`, agent()]]) {
    assert.equal((await get(path, token)).json.code, "gen_not_found", path);
  }
  setGen({ autoUnderCredits: 1000 });
  const a = await call("/gen/jobs", { batch: null, kind: "image_to_video", input: await input(agent(), undefined, "/gen/inputs"), promptText: "p", seconds: 5, ratio: "1280:720" }, agent());
  assert.equal(a.status, 202, a.text);
  assert.equal((await get(`/gen/app/jobs/${a.json.job}`)).json.code, "gen_not_found");
});

test("an agent job naming an allowance id is refused: the Artist never draws on an app's allowance", async () => {
  const id = await input(agent(), undefined, "/gen/inputs");
  const r = await call("/gen/jobs", { batch: ALLOWANCE, shot: "s01", kind: "image_to_video", input: id, promptText: "p", seconds: 5, ratio: "1280:720" }, agent());
  assert.deepEqual([r.status, r.json.code], [403, "gen_not_approved"]);
  assert.match(r.json.error.message, /allowance/);
  assert.equal(creates().length, 0);
});

test("a refused picture is not sent again for the app either", async () => {
  behave({ steps: ["FAILED"], failureCode: "SAFETY.INPUT.IMAGE" });
  const id = await input();
  const r = await call("/gen/app/jobs", clipJob(id));
  assert.equal((await settled(r.json.job)).state, "refused");
  behave();
  const again = await call("/gen/app/jobs", clipJob(id, { prompt: "another" }));
  assert.equal(again.json.code, "gen_not_approved");
  assert.equal(creates().length, 1);
});

test("the status file: the Higgsfield sign-in and today's jobs and cents for each app", async () => {
  hfOn();
  await signIn();
  const a = await call("/gen/app/jobs", clipJob(await input()));
  await settled(a.json.job);
  const b = await call("/gen/app/jobs", fluxJob(await input()));
  await settled(b.json.job);
  await door.close();
  door = null;
  const st = JSON.parse(readFileSync(paths.generateStatus, "utf8"));
  assert.deepEqual(st.higgsfield, { signedIn: true, refused: false });
  assert.deepEqual(st.apps, { [APP]: { jobs: 2, cents: 45 } });
  assert.equal(st.today.credits, 45);
  const text = readFileSync(paths.generateStatus, "utf8");
  for (const t of [hf.tokens.access, hf.tokens.refresh, KEY]) assert.ok(!text.includes(t));
});

// ---- the readers ----------------------------------------------------------------------------------------------------
test("the ledger reads K20's optional fields when they are of their kind and fails closed otherwise; old lines still read", () => {
  const base = { at: new Date().toISOString(), job: "g1", batch: null, shot: null, slug: "artist", kind: "image_to_video", model: "gen4_turbo",
    seconds: 5, estimate: 25, state: "spent", credits: 25, runwayTask: null, verdict: "done" };
  const file = join(dir, "l.jsonl");
  const check = (extra) => { put(file, `${JSON.stringify({ ...base, ...extra })}\n`); return readLedger(file).ok; };
  assert.equal(check({}), true);
  assert.equal(check({ provider: "runway", app: APP }), true);
  assert.equal(check({ provider: "higgsfield", units: 4.5, rate: 50 }), true);
  for (const bad of [{ provider: "openai" }, { provider: null }, { units: -1 }, { units: "4" }, { rate: 0 }, { rate: 51 }, { rate: 2.5 }, { app: "Bad" }, { app: null }, { app: "a".repeat(25) }]) {
    assert.equal(check(bad), false, JSON.stringify(bad));
  }
});

test("readAllowance: K22's rules", () => {
  const now = Date.now();
  const okOne = { version: 1, id: ALLOWANCE, app: APP, approvedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600_000).toISOString(), budgetCents: 500 };
  const at = (v, mode = 0o600) => { put(join(paths.allowances, `${APP}.json`), v, mode); return readAllowance(paths.allowances, APP, now); };
  assert.deepEqual(at(okOne), { ok: true, allowance: { id: ALLOWANCE, app: APP, approvedAt: okOne.approvedAt, expiresAt: okOne.expiresAt, budgetCents: 500 } });
  assert.deepEqual(at({ ...okOne, app: OTHER }), { ok: false, why: "other_app" });
  assert.deepEqual(at({ ...okOne, expiresAt: new Date(now).toISOString() }), { ok: false, why: "expired" });
  assert.deepEqual(at({ ...okOne, budgetCents: 10_001 }), { ok: false, why: "shape" });
  assert.deepEqual(at({ ...okOne, version: 2 }), { ok: false, why: "shape" });
  assert.deepEqual(at(okOne, 0o620), { ok: false, why: "untrusted" });
  assert.deepEqual(at(`${JSON.stringify(okOne)}${" ".repeat(5000)}`), { ok: false, why: "untrusted" });
  assert.deepEqual(readAllowance(paths.allowances, "../x", now), { ok: false, why: "missing" });
  assert.deepEqual(readAllowance(join(dir, "nowhere"), APP, now).ok, false);
  assert.deepEqual(readAllowance(paths.allowances, OTHER, now), { ok: false, why: "missing" });
});

test("readGenState: Higgsfield off at 5 cents by default; a block of the wrong shape makes the state unreadable", () => {
  setGen();
  assert.deepEqual(readGenState(paths.doorsState).higgsfield, { on: false, centsPerCredit: 5 });
  setGen({ higgsfield: { on: true, centsPerCredit: 7 } });
  assert.deepEqual(readGenState(paths.doorsState).higgsfield, { on: true, centsPerCredit: 7 });
  setGen({ higgsfield: { on: true } });
  assert.deepEqual(readGenState(paths.doorsState).higgsfield, { on: true, centsPerCredit: 5 });
  for (const bad of [{ on: "yes" }, { centsPerCredit: 0 }, { centsPerCredit: 51 }, { centsPerCredit: 4.9 }, { on: true, extra: 1 }, [], "on"]) {
    setGen({ higgsfield: bad });
    assert.equal(readGenState(paths.doorsState).ok, false, JSON.stringify(bad));
  }
});

test("the job records hold no token; the door's work folder holds no Higgsfield token", async () => {
  hfOn();
  await signIn();
  const r = await call("/gen/app/jobs", fluxJob(await input()));
  await settled(r.json.job);
  const jobs = join(paths.doorWork, "gen", "jobs");
  const text = readdirSync(jobs).filter((n) => n.endsWith(".json")).map((n) => readFileSync(join(jobs, n), "utf8")).join("\n");
  assert.ok(text.includes('"provider":"higgsfield"'));
  for (const t of [hf.tokens.access, hf.tokens.refresh]) assert.ok(!text.includes(t) && !text.includes(t.slice(-12)));
  assert.ok(!readFileSync(paths.ledger, "utf8").includes(hf.tokens.access));
  await until(() => true);
});
