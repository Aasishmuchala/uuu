// The generation door with Higgsfield (PLAN-V5 K20, K21, K22; T73) against the stand-in Higgsfield
// (T67) and the stand-in Runway: the owner's sign-in routes, the Artist's batches naming a Higgsfield
// model, refusals, the pause and the running limit shared across both services, and a job left open
// by a stopped door. Made-up secrets, ids, a made-up key and made-up tokens in a temp state folder;
// every socket lands on 127.0.0.1.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { CODES, HF_RETURN_PATH, MAX_RUNNING, MAX_RUNNING_ALL, createGenerateDoor, generateDoorOptions } from "../door.mjs";
import { HF_ORIGIN } from "../higgsfield.mjs";
import { REAL_NET } from "../../web/fetch.mjs";
import { startRunway } from "../../test/stubs/runway.mjs";
import { pngBytes, startHiggsfield } from "../../test/stubs/higgsfield.mjs";

const GEN_SECRET = "2".repeat(64);
const KEY = `key_${"0123456789abcdef".repeat(8)}`;
const ARTIST = "99999999-2222-4333-8444-555555555555";
const SCOUT = "88888888-2222-4333-8444-555555555555";
const APP = "render-to-film";
const ALLOWANCE = `a${"3".repeat(20)}`;
const BATCH = `b${"4".repeat(20)}`;
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
const app = () => mintToken(GEN_SECRET, "t", `app-${APP}`, exp());

function put(path, text, mode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, typeof text === "string" || Buffer.isBuffer(text) ? text : JSON.stringify(text));
  chmodSync(path, mode);
}
// The Artist's switch on, Higgsfield as asked, FLUX.2 on Higgsfield the still model.
function setGen(gen = {}, hfBlock = { on: true, centsPerCredit: 5 }) {
  put(paths.doorsState, { version: 1, generate: {
    on: true, dailyCredits: 3000, monthlyCredits: 10000, autoUnderCredits: 0,
    models: { video: "gen4_turbo", videoBest: "gen4.5", still: "hf.flux_2", upscale: "magnific_precision_upscaler_v2" }, higgsfield: hfBlock, ...gen,
  }, changedAt: "2026-11-14T10:00:00.000Z" });
}
function batch(id = BATCH, fields = {}) {
  const now = Date.now();
  put(join(paths.batches, `${id}.json`), {
    id, task: "task-1", slug: "artist", approvedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 6 * 86400_000).toISOString(),
    budgetCredits: 1000, textToVideo: false,
    shots: { s01: { kind: "still_variation", model: "hf.flux_2", takes: 5 }, s02: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 3 } },
    ...fields,
  });
}
function allow(fields = {}) {
  const now = Date.now();
  put(join(paths.allowances, `${APP}.json`), { version: 1, id: ALLOWANCE, app: APP, approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 6 * 3600_000).toISOString(), budgetCents: 1000, ...fields });
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
const call = (path, body, token = agent()) => request("POST", path, {
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const get = (path, token = agent()) => request("GET", path, { headers: { Authorization: `Bearer ${token}` } });
let pictures = 0;
async function input(token = agent(), path = "/gen/inputs") {
  const r = await request("POST", path, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, body: pngBytes(1280, 720, 2048 + (pictures += 1)) });
  assert.equal(r.status, 201, r.text);
  return r.json.input;
}
const still = (id, extra = {}) => ({ batch: BATCH, shot: "s01", kind: "still_variation", inputs: [id], promptText: PROMPT, ratio: "1920:1080", ...extra });
const appStill = (id, extra = {}) => ({ model: "hf.flux_2", kind: "still_variation", inputs: [{ input: id, role: "ref" }], prompt: PROMPT, ratio: "16:9", resolution: "2k", ...extra });
async function settled(job, token = agent(), path = "/gen/jobs", ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await get(`${path}/${job}`, token);
    if (r.json && ["done", "failed", "refused"].includes(r.json.state)) return r.json;
    if (Date.now() > end) throw new Error(`job ${job} did not end: ${r.text}`);
    await new Promise((res) => setTimeout(res, 15));
  }
}
const ledger = () => (existsSync(paths.ledger) ? readFileSync(paths.ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const hfTool = (name) => hf.calls.filter((c) => c.rpc === "tools/call" && c.tool === name);
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("the condition did not hold in time");
    await new Promise((res) => setTimeout(res, 10));
  }
}
async function signIn() {
  const b = await call("/gen/owner/higgsfield/begin", "", owner());
  assert.equal(b.status, 200, b.text);
  const back = new URL((await fetch(b.json.url, { redirect: "manual" })).headers.get("location"));
  const f = await call("/gen/owner/higgsfield/finish", { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, owner());
  assert.deepEqual(f.json, { connected: true });
}

function doorOptions(extra = {}) {
  return {
    listenPort: 0, upstream: rw.url, paths,
    config: { doors: { generate: { agents: ["artist", "scout"], apps: [APP] } } },
    log: (l) => lines.push(l), net: rw.net,
    limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000, pollErrors: 3 },
    higgsfield: { origin: hf.url, redirectUri: REDIRECT, net: hf.net, uploadSuffixes: ["higgsfield.test"], limits: { downloadMs: 3000 }, mcpLimits: { callMs: 3000 } },
    ...extra,
  };
}
async function startDoor(extra = {}) {
  if (door) await door.close();
  door = createGenerateDoor(doorOptions(extra));
  port = await door.listen();
  await door.settled();
}

before(async () => { rw = await startRunway({ key: KEY }); });
after(async () => { if (door) await door.close(); await rw.close(); });
beforeEach(async () => {
  hf = await startHiggsfield();
  dir = mkdtempSync(join(tmpdir(), "gen-hf-"));
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
  batch();
  allow();
  for (const k of Object.keys(rw.behaviour)) delete rw.behaviour[k];
  rw.seen.api.length = 0;
  lines = [];
  await startDoor();
});
afterEach(async () => {
  if (door) { await door.close(); door = null; }
  await hf.close();
  for (const l of lines) {
    assert.ok(!l.includes(KEY), `key in log: ${l}`);
    assert.ok(!/v1\.[at]\./.test(l), `token in log: ${l}`);
    assert.ok(!l.includes("secret-prompt-words"), `prompt in log: ${l}`);
    for (const t of [hf.tokens.access, hf.tokens.refresh]) if (t) assert.ok(!l.includes(t) && !l.includes(t.slice(-12)), `higgsfield token in log: ${l}`);
  }
});

// ---- the owner's sign-in (K21) --------------------------------------------------------------------------------
test("begin, finish, forget and balance take the owner's token only", async () => {
  for (const token of [agent(), app()]) {
    for (const name of ["begin", "finish", "forget", "balance"]) {
      const r = await call(`/gen/owner/higgsfield/${name}`, "", token);
      assert.deepEqual([r.status, r.json.code], [401, "gen_no_token"], name);
    }
  }
  assert.equal(hf.calls.length, 0);
});

test("begin answers Higgsfield's sign-in address: PKCE S256, a fresh state, our return address; with the switch off and no Runway key", async () => {
  setGen({ on: false }, { on: false, centsPerCredit: 5 });
  rmSync(paths.runwayKey);
  const r = await call("/gen/owner/higgsfield/begin", "", owner());
  assert.equal(r.status, 200, r.text);
  const u = new URL(r.json.url);
  assert.equal(`${u.origin}${u.pathname}`, `${hf.url}/oauth2/authorize`);
  const q = u.searchParams;
  assert.deepEqual([q.get("response_type"), q.get("code_challenge_method"), q.get("redirect_uri"), q.get("resource")], ["code", "S256", REDIRECT, `${hf.url}/mcp`]);
  assert.match(q.get("state"), /^[0-9a-f]{64}$/);
  assert.match(q.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await call("/gen/owner/higgsfield/begin", "{}", owner())).status, 200);
  assert.equal((await call("/gen/owner/higgsfield/begin", { x: 1 }, owner())).json.code, "gen_bad_request");
});

test("finish signs in once: health, the status file and Settings' Test see it", async () => {
  assert.equal((await request("GET", "/gen/health")).json.higgsfield, false);
  await signIn();
  assert.equal((await request("GET", "/gen/health")).json.higgsfield, true);
  const b = await call("/gen/owner/higgsfield/balance", "", owner());
  assert.deepEqual(b.json, { credits: 3896, plan: "max" });
  const file = readFileSync(paths.higgsfieldAuth, "utf8");
  assert.ok(file.includes(hf.tokens.access));
  assert.equal((await import("node:fs")).statSync(paths.higgsfieldAuth).mode & 0o777, 0o600);
  await door.close();
  door = null;
  assert.deepEqual(JSON.parse(readFileSync(paths.generateStatus, "utf8")).higgsfield, { signedIn: true, refused: false });
  assert.ok(!readFileSync(paths.generateStatus, "utf8").includes(hf.tokens.access));
});

test("finish with another state, or a body of the wrong shape, is refused and leaves the sign-in under way for the real return (T85 finding 7)", async () => {
  const b = await call("/gen/owner/higgsfield/begin", "", owner());
  const back = new URL((await fetch(b.json.url, { redirect: "manual" })).headers.get("location"));
  const wrong = await call("/gen/owner/higgsfield/finish", { code: back.searchParams.get("code"), state: "0".repeat(64) }, owner());
  assert.deepEqual([wrong.status, wrong.json.code], [403, "gen_hf_sign_in"]);
  assert.equal(wrong.json.error.message, "The Higgsfield sign-in did not finish. Try again.");
  assert.equal((await call("/gen/owner/higgsfield/finish", { code: back.searchParams.get("code"), state: back.searchParams.get("state"), x: 1 }, owner())).json.code, "gen_bad_request");
  assert.equal(existsSync(paths.higgsfieldAuth), false);
  const real = await call("/gen/owner/higgsfield/finish", { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, owner());
  assert.deepEqual(real.json, { connected: true }, "the real return still signs in");
  const again = await call("/gen/owner/higgsfield/finish", { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, owner());
  assert.equal(again.json.code, "gen_hf_sign_in", "used once");
  assert.equal(existsSync(paths.higgsfieldAuth), true);
});

test("forget signs out: the file is gone, health says so, and Higgsfield jobs are refused", async () => {
  await signIn();
  const r = await call("/gen/owner/higgsfield/forget", "", owner());
  assert.deepEqual(r.json, { connected: false });
  assert.equal(existsSync(paths.higgsfieldAuth), false);
  assert.equal((await request("GET", "/gen/health")).json.higgsfield, false);
  assert.equal((await call("/gen/owner/higgsfield/balance", "", owner())).json.code, "gen_hf_signed_out");
  assert.equal((await call("/gen/jobs", still(await input()))).json.code, "gen_hf_signed_out");
});

test("a refused refresh: Higgsfield asked for a new sign-in, for the balance, the Artist and the apps", async () => {
  await signIn();
  hf.behaviour.expire = true;
  hf.behaviour.refuseRefresh = true;
  assert.equal((await call("/gen/owner/higgsfield/balance", "", owner())).status, 200);   // the token dies after this call
  const b = await call("/gen/owner/higgsfield/balance", "", owner());
  assert.deepEqual([b.status, b.json.code], [403, "gen_hf_refused"]);
  assert.equal((await call("/gen/jobs", still(await input()))).json.code, "gen_hf_refused");
  assert.equal((await call("/gen/app/jobs", appStill(await input(app(), "/gen/app/inputs")), app())).json.code, "gen_hf_refused");
  assert.equal((await request("GET", "/gen/health")).json.higgsfield, false);
  assert.equal(ledger().length, 0);
});

test("a tool's error text reaches the owner without the token", async () => {
  await signIn();
  hf.behaviour.toolError = true;
  const b = await call("/gen/owner/higgsfield/balance", "", owner());
  assert.equal(b.json.code, "gen_could_not_start");
  for (const t of [hf.tokens.access, hf.tokens.access.slice(-12)]) assert.ok(!b.text.includes(t));
});

// ---- the Artist with a Higgsfield model (K22) -------------------------------------------------------------------
test("an Artist batch naming a Higgsfield model: off is gen_hf_off, signed out gen_hf_signed_out, on and signed in it is made", async () => {
  const id = await input();
  setGen({}, { on: false, centsPerCredit: 5 });
  assert.deepEqual([(await call("/gen/jobs", still(id))).json.code], ["gen_hf_off"]);
  setGen();
  assert.equal((await call("/gen/jobs", still(id))).json.code, "gen_hf_signed_out");
  assert.equal(hf.calls.length, 0);
  await signIn();
  const r = await call("/gen/jobs", still(id));
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(Object.keys(r.json).sort(), ["estimate", "job"]);
  assert.equal(r.json.estimate, 20);
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits, end.output.type], ["done", 20, "image/png"]);
  const out = await get(`/gen/jobs/${r.json.job}/output`);
  assert.ok(out.buf.equals(pngBytes()));
  const l = ledger();
  assert.deepEqual(l.map((x) => x.state), ["reserved", "reserved", "spent"]);
  for (const x of l) assert.deepEqual([x.provider, x.units, x.rate, x.batch, x.shot, x.slug, x.app], ["higgsfield", 4, 5, BATCH, "s01", "artist", undefined]);
  // The Artist's shape, in the row's own words: 1920:1080 is 16:9; the largest size; the door's own pins.
  const p = hfTool("generate_image")[1].arguments.params;
  assert.deepEqual([p.model, p.aspect_ratio, p.resolution, p.variant, p.prompt, p.use_unlim, p.use_free_gens], ["flux_2", "16:9", "2k", "max", PROMPT, false, false]);
  assert.equal(p.medias.length, 1);
  assert.equal(rw.seen.api.length, 0);
});

test("the rate is the owner's: 7 cents a credit makes FLUX.2 28 cents, in the estimate and the reservation", async () => {
  setGen({}, { on: true, centsPerCredit: 7 });
  await signIn();
  const e = await call("/gen/estimate", { items: [{ kind: "still_variation", model: "hf.flux_2" }, { kind: "still_variation" }] });
  assert.deepEqual(e.json.items.map((i) => i.credits), [28, 28]);
  const r = await call("/gen/jobs", still(await input()));
  assert.equal(r.json.estimate, 28);
  await settled(r.json.job);
  assert.deepEqual([ledger().at(-1).credits, ledger().at(-1).rate, ledger().at(-1).units], [28, 7, 4]);
});

test("the Artist's Higgsfield work stays inside a batch, its shot, and the model chosen in Settings", async () => {
  await signIn();
  const id = await input();
  setGen({ autoUnderCredits: 1000 });
  const none = await call("/gen/jobs", { batch: null, kind: "still_variation", inputs: [id], promptText: PROMPT, ratio: "1920:1080" });
  assert.deepEqual([none.json.code, none.json.error.message], ["gen_not_approved", "Higgsfield is used only inside a batch the owner approved."]);
  setGen({ models: { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" } });
  assert.equal((await call("/gen/jobs", still(id))).json.code, "gen_not_approved", "not the model chosen in Settings");
  setGen();
  assert.equal((await call("/gen/jobs", still(id, { ratio: "1080:1920" }))).status, 202, "9:16 is FLUX.2's");
  assert.equal((await call("/gen/jobs", still(id, { ratio: "2112:912", promptText: "b" }))).json.code, "gen_bad_request", "a shape FLUX.2 does not make");
  batch(BATCH, { shots: { s01: { kind: "still_variation", model: "hf.flux_2", takes: 1 } } });
  await until(() => ledger().some((x) => x.state === "spent"));
  assert.equal((await call("/gen/jobs", still(id, { promptText: "c" }))).json.code, "gen_not_approved", "every take used");
  assert.equal(hfTool("generate_image").length, 2);
});

test("with Higgsfield on, the Artist needs no Runway key for a Higgsfield shot; a Runway shot still does", async () => {
  rmSync(paths.runwayKey);
  await signIn();
  const id = await input();
  const r = await call("/gen/jobs", still(id));
  assert.equal(r.status, 202, r.text);
  await settled(r.json.job);
  const clip = await call("/gen/jobs", { batch: BATCH, shot: "s02", kind: "image_to_video", input: id, promptText: "p", seconds: 5, ratio: "1280:720" });
  assert.equal(clip.json.code, "gen_no_key");
  setGen({}, { on: false, centsPerCredit: 5 });
  assert.equal((await call("/gen/jobs", still(id))).json.code, "gen_no_key", "with Higgsfield off, step 3's rule");
});

test("Higgsfield's live price above the table's: gen_price_changed, nothing reserved", async () => {
  await signIn();
  hf.behaviour.priceHigher = true;
  const r = await call("/gen/jobs", still(await input()));
  assert.deepEqual([r.status, r.json.code], [403, "gen_price_changed"]);
  assert.equal(r.json.error.message, CODES.gen_price_changed[1]);
  assert.equal(ledger().length, 0);
  assert.equal(hfTool("generate_image").filter((c) => c.arguments.params.get_cost !== true).length, 0);
});

test("no upload host known (the door's own setting): nothing is uploaded, nothing reserved", async () => {
  await startDoor({ higgsfield: { origin: hf.url, redirectUri: REDIRECT, net: hf.net } });
  await signIn();
  const r = await call("/gen/jobs", still(await input()));
  assert.equal(r.json.code, "gen_could_not_start");
  assert.match(r.json.error.message, /upload address/);
  assert.equal(hfTool("media_upload").length, 0);
  assert.equal(hf.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(ledger().length, 0);
});

// ---- refusals, the freeze and the pause, across both services ----------------------------------------------------------
test("nsfw twice in one batch freezes it; a flagged picture is never sent again", async () => {
  await signIn();
  hf.behaviour.nsfw = true;
  const a = await input();
  const r1 = await call("/gen/jobs", still(a));
  const e1 = await settled(r1.json.job);
  assert.deepEqual([e1.state, e1.credits], ["refused", 20]);
  assert.match(e1.reason, /^Higgsfield refused this picture or prompt\. It will not be sent again\./);
  assert.equal(ledger().at(-1).verdict, "refused");
  const again = await call("/gen/jobs", still(a, { promptText: "another" }));
  assert.equal(again.json.code, "gen_not_approved");
  const r2 = await call("/gen/jobs", still(await input(), { promptText: "two" }));
  assert.equal((await settled(r2.json.job)).state, "refused");
  hf.behaviour.nsfw = false;
  const third = await call("/gen/jobs", still(await input(), { promptText: "three" }));
  assert.equal(third.json.code, "gen_not_approved");
  assert.match(third.json.error.message, /It needs you/);
  assert.equal(hfTool("generate_image").filter((c) => c.arguments.params.get_cost !== true).length, 2);
});

test("three refusals across both services pause the door for the Artist and for apps", async () => {
  await signIn();
  const ready = await input();
  // One from Runway (the Artist's clip), one from Higgsfield for the Artist, one from Higgsfield for an app.
  rw.behaviour.steps = ["FAILED"];
  rw.behaviour.failureCode = "SAFETY.INPUT.IMAGE";
  const c = await call("/gen/jobs", { batch: BATCH, shot: "s02", kind: "image_to_video", input: await input(), promptText: "p", seconds: 5, ratio: "1280:720" });
  assert.equal((await settled(c.json.job)).state, "refused");
  hf.behaviour.nsfw = true;
  const s = await call("/gen/jobs", still(await input()));
  assert.equal((await settled(s.json.job)).state, "refused");
  const ai = await input(app(), "/gen/app/inputs");
  const a = await call("/gen/app/jobs", appStill(ai), app());
  assert.equal((await settled(a.json.job, app(), "/gen/app/jobs")).state, "refused");
  assert.equal(ledger().at(-1).state, "paused");
  hf.behaviour.nsfw = false;
  delete rw.behaviour.steps;
  assert.equal((await call("/gen/jobs", still(ready, { promptText: "x" }))).json.code, "gen_paused");
  assert.equal((await call("/gen/app/jobs", appStill(ai, { prompt: "y" }), app())).json.code, "gen_paused");
  assert.equal((await upload(app())).json.code, "gen_paused");
});
const upload = (token) => request("POST", "/gen/app/inputs", { headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, body: pngBytes(800, 600, 3333) });

test("a failed Higgsfield job counts as spent unless Higgsfield says it cost 0", async () => {
  await signIn();
  hf.behaviour.failed = true;
  const r = await call("/gen/jobs", still(await input()));
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits], ["failed", 20]);
  assert.match(end.reason, /^Higgsfield could not make this\./);
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits, ledger().at(-1).verdict], ["spent", 20, "failed"]);
});

test("an output that redirects is not fetched: the job failed, and it is paid for", async () => {
  await signIn();
  hf.behaviour.outputRedirect = true;
  const r = await call("/gen/jobs", still(await input()));
  const end = await settled(r.json.job);
  assert.equal(end.state, "failed");
  assert.match(end.reason, /paid for/);
  assert.equal(ledger().at(-1).state, "spent");
  assert.equal((await get(`/gen/jobs/${r.json.job}/output`)).json.code, "gen_not_ready");
});

test("a job that never ends is given up at its time and counted", async () => {
  await startDoor({ limits: { pollMs: 10, jobMs: 300, downloadMs: 3000, apiMs: 2000, pollErrors: 3 } });
  await signIn();
  hf.behaviour.slow = true;
  const r = await call("/gen/jobs", still(await input()));
  const end = await settled(r.json.job);
  assert.equal(end.state, "failed");
  assert.match(end.reason, /20 minutes/);
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits], ["spent", 20]);
});

// ---- the running limit, shared ------------------------------------------------------------------------------------------
test("busy: two at once for the Artist across both services, four in all with an app", async () => {
  assert.deepEqual([MAX_RUNNING, MAX_RUNNING_ALL], [2, 4]);
  await signIn();
  hf.behaviour.slow = true;
  rw.behaviour.steps = "never";
  assert.equal((await call("/gen/jobs", still(await input(), { promptText: "a" }))).status, 202);
  assert.equal((await call("/gen/jobs", { batch: BATCH, shot: "s02", kind: "image_to_video", input: await input(), promptText: "b", seconds: 5, ratio: "1280:720" })).status, 202);
  const third = await call("/gen/jobs", still(await input(), { promptText: "c" }));
  assert.deepEqual([third.json.code, third.json.retryAfterSec], ["gen_busy", 30]);
  assert.match(third.json.error.message, /^Two jobs/);
  const ai = await input(app(), "/gen/app/inputs");
  assert.equal((await call("/gen/app/jobs", appStill(ai, { prompt: "d" }), app())).status, 202);
  assert.equal((await call("/gen/app/jobs", appStill(ai, { prompt: "e" }), app())).status, 202);
  batch(`b${"5".repeat(20)}`, { slug: "scout" });
  const scout = await call("/gen/jobs", still(await input(agent(SCOUT)), { batch: `b${"5".repeat(20)}`, promptText: "f" }), agent(SCOUT));
  assert.deepEqual([scout.json.code, scout.json.retryAfterSec], ["gen_busy", 30]);
  assert.match(scout.json.error.message, /^Four jobs/);
});

test("two Higgsfield jobs racing for the last place: only one passes", async () => {
  await signIn();
  hf.behaviour.slow = true;
  assert.equal((await call("/gen/jobs", still(await input(), { promptText: "a" }))).status, 202);
  const [x, y] = await Promise.all([call("/gen/jobs", still(await input(), { promptText: "b" })), call("/gen/jobs", still(await input(), { promptText: "c" }))]);
  assert.deepEqual([x.status, y.status].sort(), [202, 403]);
  assert.equal([x, y].find((r) => r.status === 403).json.code, "gen_busy");
});

// ---- a stopped door -------------------------------------------------------------------------------------------------------
test("the door closed in the middle of a Higgsfield job: settled at the next start by one question", async () => {
  await startDoor({ limits: { pollMs: 60_000, jobMs: 600_000, downloadMs: 3000, apiMs: 2000 } });
  await signIn();
  hf.behaviour.slow = true;
  const r = await call("/gen/jobs", still(await input()));
  assert.equal(r.status, 202, r.text);
  await until(() => ledger().at(-1).runwayTask !== null);
  await door.close();
  door = null;
  assert.equal(ledger().at(-1).state, "reserved");
  hf.behaviour.slow = false;
  const before = hfTool("jobs_wait").length;
  await startDoor();
  assert.ok(hfTool("jobs_wait").length - before >= 1);
  assert.equal(hfTool("jobs_wait")[before].arguments.timeout_seconds, 0);
  const end = await settled(r.json.job);
  assert.equal(end.state, "done");
  const last = ledger().at(-1);
  assert.deepEqual([last.state, last.credits, last.provider, last.units, last.rate], ["spent", 20, "higgsfield", 4, 5]);
});

test("a Higgsfield reservation with no job id stays counted at its estimate after a restart, with no question asked", async () => {
  await door.close();
  door = null;
  put(paths.ledger, `${JSON.stringify({ at: new Date().toISOString(), job: "ghfdead", batch: BATCH, shot: "s01", slug: "artist", kind: "still_variation",
    model: "hf.flux_2", seconds: null, estimate: 20, state: "reserved", credits: 20, runwayTask: null, verdict: null, provider: "higgsfield", units: 4, rate: 5 })}\n`);
  await startDoor();
  const last = ledger().at(-1);
  assert.deepEqual([last.state, last.credits, last.verdict, last.provider, last.units], ["spent", 20, "unknown", "higgsfield", 4]);
  assert.equal(hf.calls.length, 0);
});

test("an open Higgsfield job Higgsfield cannot place at the next start is spent", async () => {
  await door.close();
  door = null;
  await (async () => {
    // Signed in, then a job id the stand-in never made.
    await startDoor();
    await signIn();
    await door.close();
    door = null;
  })();
  put(paths.ledger, `${JSON.stringify({ at: new Date().toISOString(), job: "ghflost", batch: BATCH, shot: "s01", slug: "artist", kind: "still_variation",
    model: "hf.flux_2", seconds: null, estimate: 20, state: "reserved", credits: 20, runwayTask: "job_0000000000000000", verdict: null, provider: "higgsfield", units: 4, rate: 5 })}\n`);
  await startDoor();
  const last = ledger().at(-1);
  assert.deepEqual([last.state, last.credits, last.verdict], ["spent", 20, "unknown"]);
  assert.equal(hfTool("jobs_wait").length, 1);
});

// ---- main's options ----------------------------------------------------------------------------------------------------------
test("main pins Higgsfield's one origin and the home server's return address; Higgsfield needs its token file's path", () => {
  const o = generateDoorOptions({ ports: { generate: 3140, home: 3100 }, paths });
  assert.deepEqual(o.higgsfield, { origin: HF_ORIGIN, redirectUri: `http://127.0.0.1:3100${HF_RETURN_PATH}`, net: REAL_NET });
  assert.equal(HF_RETURN_PATH, "/api/generation/higgsfield/back");
  assert.equal(generateDoorOptions({ ports: { generate: 3140 }, paths }).higgsfield, undefined);
  const { higgsfieldAuth: _gone, ...without } = paths;
  assert.throws(() => createGenerateDoor({ ...doorOptions(), paths: without }), /higgsfieldAuth/);
  assert.throws(() => createGenerateDoor({ ...doorOptions(), higgsfield: { origin: "https://evil.example", redirectUri: REDIRECT } }), /origin/);
  assert.throws(() => createGenerateDoor({ ...doorOptions(), higgsfield: { origin: hf.url, redirectUri: "http://evil.example/back" } }), /redirectUri/);
});

test("a door given no Higgsfield refuses every Higgsfield job and route, and still serves Runway", async () => {
  await startDoor({ higgsfield: undefined });
  assert.equal((await call("/gen/owner/higgsfield/begin", "", owner())).json.code, "gen_hf_signed_out");
  assert.equal((await call("/gen/jobs", still(await input()))).json.code, "gen_hf_signed_out");
  const r = await call("/gen/jobs", { batch: BATCH, shot: "s02", kind: "image_to_video", input: await input(), promptText: "p", seconds: 5, ratio: "1280:720" });
  assert.equal(r.status, 202, r.text);
  assert.equal(hf.calls.length, 0);
});

test("no refusal of the door's own is a 429 or a 5xx, the new ones included", () => {
  for (const code of ["gen_hf_off", "gen_hf_signed_out", "gen_hf_refused", "gen_hf_sign_in", "gen_no_allowance", "gen_over_allowance", "gen_price_changed"]) {
    assert.ok(Object.hasOwn(CODES, code), code);
    assert.equal(CODES[code][0], 403, code);
  }
});
