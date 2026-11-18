// The generation door with the owner's Runway account (PLAN-ONBOARD R1) against the stand-in Runway
// MCP server and the stand-in developer Runway: the owner's sign-in routes, which way in a job goes
// (the key first; the sign-in only with no key), the money (the ceiling held, the quote checked
// and approved, the rate), what is never accepted (a job that starts without a quote), and what
// never leaves the door (a token, a code, a verifier, a state, an approval). Made-up secrets in a
// temp state folder. A guard fails the file if any socket is opened to a host other than 127.0.0.1.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import dc from "node:diagnostics_channel";
import http from "node:http";
import net from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { CODES, RW_RETURN_PATH, createGenerateDoor, generateDoorOptions } from "../door.mjs";
import { NEEDS, NO_PRICE } from "../registry.mjs";
import { RW_MCP_ORIGIN } from "../runway-mcp.mjs";
import { readGenState } from "../state.mjs";
import { REAL_NET } from "../../web/fetch.mjs";
import { startRunway } from "../../test/stubs/runway.mjs";
import { UPLOAD_HOST, pngBytes, startRunwayMcp } from "../../test/stubs/runway-mcp.mjs";

// ---- the guard: every socket this file opens lands on 127.0.0.1 ----
const strays = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guarded(...args) {
  const a = args[0];
  const o = Array.isArray(a) ? a[0] : a;
  const host = o !== null && typeof o === "object" ? (o.path ? "127.0.0.1" : o.host) : typeof args[1] === "string" ? args[1] : "localhost";
  if (host !== "127.0.0.1") strays.push(String(host));
  return realConnect.apply(this, args);
};
const onFetch = (m) => { const h = m && m.connectParams && m.connectParams.hostname; if (h !== "127.0.0.1") strays.push(String(h)); };
dc.subscribe("undici:client:beforeConnect", onFetch);

const GEN_SECRET = "2".repeat(64);
const KEY = `key_${"0123456789abcdef".repeat(8)}`;
const ARTIST = "99999999-2222-4333-8444-555555555555";
const APP = "render-to-film";
const ALLOWANCE = `a${"3".repeat(20)}`;
const BATCH = `b${"4".repeat(20)}`;
const REDIRECT = "http://127.0.0.1:41999/api/generation/runway/back";
const PROMPT = "the stair at dawn, secret-prompt-words";

let rw;
let rm;
let door;
let port;
let dir;
let paths;
let lines;
let answers;

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const agent = () => mintToken(GEN_SECRET, "a", ARTIST, exp());
const owner = () => mintToken(GEN_SECRET, "t", "owner", exp());
const app = () => mintToken(GEN_SECRET, "t", `app-${APP}`, exp());

function put(path, text, mode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, typeof text === "string" || Buffer.isBuffer(text) ? text : JSON.stringify(text));
  chmodSync(path, mode);
}
function setGen(gen = {}) {
  put(paths.doorsState, { version: 1, generate: {
    on: true, dailyCredits: 3000, monthlyCredits: 10000, autoUnderCredits: 0,
    models: { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" },
    runwayAccount: { centsPerCredit: 3 }, ...gen,
  }, changedAt: "2026-11-18T10:00:00.000Z" });
}
function batch(fields = {}) {
  const now = Date.now();
  put(join(paths.batches, `${BATCH}.json`), {
    id: BATCH, task: "task-1", slug: "artist", approvedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 6 * 86400_000).toISOString(),
    budgetCredits: 1000, textToVideo: true,
    shots: {
      s01: { kind: "still_variation", model: "gen4_image", takes: 5 },
      s02: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 5 },
      s03: { kind: "text_to_video", model: "gen4.5", maxSeconds: 5, takes: 5 },
      s04: { kind: "still_upscale", model: "magnific_precision_upscaler_v2", takes: 1 },
    },
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
        // The begin answer carries the state by design (the owner's browser takes it to Runway).
        if (path !== "/gen/owner/runway/begin") answers.push(buf.toString("latin1"));
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
const clip = (id, extra = {}) => ({ batch: BATCH, shot: "s02", kind: "image_to_video", input: id, promptText: PROMPT, seconds: 5, ratio: "1280:720", ...extra });
const words = (extra = {}) => ({ batch: BATCH, shot: "s03", kind: "text_to_video", promptText: PROMPT, seconds: 5, ratio: "1280:720", ...extra });
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
const rmTool = (name) => rm.calls.filter((c) => c.rpc === "tools/call" && c.tool === name);
const generations = () => rm.calls.filter((c) => c.rpc === "tools/call" && ["generate_image", "generate_video", "upscale_image"].includes(c.tool));
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("the condition did not hold in time");
    await new Promise((res) => setTimeout(res, 10));
  }
}
async function signIn() {
  const b = await call("/gen/owner/runway/begin", "", owner());
  assert.equal(b.status, 200, b.text);
  const back = new URL((await fetch(b.json.url, { redirect: "manual" })).headers.get("location"));
  const f = await call("/gen/owner/runway/finish", { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, owner());
  assert.deepEqual(f.json, { connected: true });
}

function doorOptions(extra = {}) {
  return {
    listenPort: 0, upstream: rw.url, paths,
    config: { doors: { generate: { agents: ["artist"], apps: [APP] } } },
    log: (l) => lines.push(l), net: rw.net,
    limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000, pollErrors: 3 },
    runwayAccount: { origin: rm.url, redirectUri: REDIRECT, net: rm.net, uploadSuffixes: [UPLOAD_HOST], limits: { downloadMs: 3000 }, mcpLimits: { callMs: 3000 } },
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
after(async () => {
  if (door) await door.close();
  await rw.close();
  net.Socket.prototype.connect = realConnect;
  dc.unsubscribe("undici:client:beforeConnect", onFetch);
  assert.deepEqual(strays, [], "a socket was opened to a host other than 127.0.0.1");
});
beforeEach(async () => {
  rm = await startRunwayMcp();
  dir = mkdtempSync(join(tmpdir(), "gen-rw-"));
  mkdirSync(join(dir, "doors", "batches"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "doors", "allowances"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "secrets", "doors"), { recursive: true, mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"),
    generateSecret: join(dir, "secrets", "doors", "generate-secret"), generateStatus: join(dir, "doors", "generate-status.json"),
    runwayKey: join(dir, "secrets", "doors", "runway-key"), ledger: join(dir, "doors", "generate-ledger.jsonl"),
    batches: join(dir, "doors", "batches"), doorWork: join(dir, "doors", "work"), allowances: join(dir, "doors", "allowances"),
    higgsfieldAuth: join(dir, "secrets", "doors", "higgsfield-oauth.json"), runwayAuth: join(dir, "secrets", "doors", "runway-oauth.json"),
  };
  put(paths.ids, { agents: { artist: ARTIST } }, 0o644);
  put(paths.generateSecret, `${GEN_SECRET}\n`);
  setGen();
  batch();
  allow();
  for (const k of Object.keys(rw.behaviour)) delete rw.behaviour[k];
  rw.seen.api.length = 0;
  lines = [];
  answers = [];
  await startDoor();
});
afterEach(async () => {
  if (door) { await door.close(); door = null; }
  await rm.close();
  // Nothing secret in any log line, any answer, or any file the door wrote but the token file.
  const secrets = [rm.tokens.access, rm.tokens.refresh, ...rm.secrets.codes, ...rm.secrets.states, ...rm.secrets.verifiers, ...rm.secrets.approvals]
    .filter((x) => typeof x === "string" && x.length >= 8);
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else if (p !== paths.runwayAuth && p !== paths.runwayKey) files.push(p); } };
  walk(dir);
  const texts = [...lines.map((l) => ["log", l]), ...answers.map((a) => ["answer", a]), ...files.map((f) => [f, readFileSync(f, "latin1")])];
  for (const [where, text] of texts) {
    for (const x of secrets) assert.ok(!text.includes(x) && !text.includes(x.slice(-12)), `a secret in ${where}`);
    assert.ok(!text.includes(KEY), `the key in ${where}`);
  }
  for (const l of lines) assert.ok(!l.includes("secret-prompt-words"), `prompt in log: ${l}`);
});

// ---- the owner's sign-in ----------------------------------------------------------------------
test("begin, finish, forget and balance take the owner's token only: an agent's or an app's reaches none", async () => {
  for (const token of [agent(), app()]) {
    for (const name of ["begin", "finish", "forget", "balance"]) {
      const r = await call(`/gen/owner/runway/${name}`, "", token);
      assert.deepEqual([r.status, r.json.code], [401, "gen_no_token"], name);
    }
  }
  assert.equal(rm.calls.length, 0);
});

test("begin answers Runway's /authorize address, with the switch off and no key", async () => {
  setGen({ on: false });
  const r = await call("/gen/owner/runway/begin", "", owner());
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.url.startsWith(`${rm.url}/authorize?`));
  const q = new URL(r.json.url).searchParams;
  assert.deepEqual([q.get("response_type"), q.get("code_challenge_method"), q.get("redirect_uri"), q.get("scope"), q.get("resource")],
    ["code", "S256", REDIRECT, "openid api:read_write", `${rm.url}/mcp`]);
  assert.match(q.get("state"), /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(r.json), ["url"]);
  assert.equal((await call("/gen/owner/runway/begin", { x: 1 }, owner())).json.code, "gen_bad_request");
});

test("the whole sign-in: a wrong state changes nothing, the right one once, a second use refused; health, status and the balance see it", async () => {
  assert.equal((await request("GET", "/gen/health")).json.runway, false);
  const b = await call("/gen/owner/runway/begin", "", owner());
  const back = new URL((await fetch(b.json.url, { redirect: "manual" })).headers.get("location"));
  const code = back.searchParams.get("code");
  const state = back.searchParams.get("state");
  const wrong = await call("/gen/owner/runway/finish", { code, state: "0".repeat(64) }, owner());
  assert.deepEqual([wrong.status, wrong.json.code, wrong.json.error.message], [403, "gen_rw_sign_in", "The Runway sign-in did not finish. Try again."]);
  assert.equal(existsSync(paths.runwayAuth), false);
  assert.deepEqual((await call("/gen/owner/runway/finish", { code, state }, owner())).json, { connected: true });
  assert.equal((await call("/gen/owner/runway/finish", { code, state }, owner())).json.code, "gen_rw_sign_in", "used once");
  assert.equal(statSync(paths.runwayAuth).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "secrets", "doors")).mode & 0o777, 0o700);
  const h = (await request("GET", "/gen/health")).json;
  assert.deepEqual([h.runway, h.higgsfield, h.key], [true, false, false]);
  assert.deepEqual((await call("/gen/owner/runway/balance", "", owner())).json, { credits: 14463 });
  assert.deepEqual(rmTool("whoami").length, 1);
  await door.close();
  door = null;
  const st = JSON.parse(readFileSync(paths.generateStatus, "utf8"));
  assert.deepEqual(st.runway, { signedIn: true, refused: false });
  assert.deepEqual(Object.keys(st.runway), ["signedIn", "refused"]);
});

test("forget deletes the token file: health says so, the balance and a job are refused", async () => {
  await signIn();
  assert.deepEqual((await call("/gen/owner/runway/forget", "", owner())).json, { connected: false });
  assert.equal(existsSync(paths.runwayAuth), false);
  assert.equal((await request("GET", "/gen/health")).json.runway, false);
  assert.equal((await call("/gen/owner/runway/balance", "", owner())).json.code, "gen_rw_signed_out");
  assert.equal((await call("/gen/jobs", words())).json.code, "gen_no_key");
});

test("a refused refresh: Runway asked for a new sign-in, for the balance and for a job", async () => {
  await signIn();
  rm.behaviour.expire = true;
  rm.behaviour.refuseRefresh = true;
  assert.equal((await call("/gen/owner/runway/balance", "", owner())).status, 200);
  assert.equal((await call("/gen/owner/runway/balance", "", owner())).json.code, "gen_rw_refused");
  assert.equal((await call("/gen/jobs", words())).json.code, "gen_rw_refused");
  assert.equal(ledger().length, 0);
});

// ---- which way in ---------------------------------------------------------------------------------
test("a key saved: the developer service is called and Runway's MCP server is not, even when signed in", async () => {
  await signIn();
  put(paths.runwayKey, `${KEY}\n`);
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.status, 202, r.text);
  await settled(r.json.job);
  assert.ok(rw.seen.api.some((x) => x.method === "POST"));
  assert.equal(generations().length, 0);
  assert.equal(rmTool("init_upload").length, 0);
  assert.equal(ledger().at(-1).provider, undefined, "step 3's lines, as before");
});

test("no key and signed in: the MCP server makes it; held at the ceiling, quoted, approved; the quote's 12 credits at 3 cents are 36 cents, noted; the ceiling is spent", async () => {
  await signIn();
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(r.json.estimate, 150, "what it counts at: the ceiling, 50 credits at 3 cents");
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits, end.output.type], ["done", 150, "video/mp4"]);
  assert.equal(rw.seen.api.length, 0, "the developer service saw nothing");
  // The upload to the pinned host, then the question, then the one approved call.
  assert.deepEqual(rm.calls.filter((c) => c.method === "PUT").map((c) => [c.host, c.auth]), [[UPLOAD_HOST, null]]);
  const g = rmTool("generate_video");
  assert.deepEqual(g.map((c) => c.approved), [false, true]);
  assert.deepEqual(g[0].arguments, { model: "gen-4-turbo", promptText: PROMPT, ratio: "16:9", duration: 5, startFrame: { url: g[0].arguments.startFrame.url }, confirmRepeat: true });
  assert.ok(g[0].arguments.startFrame.url.startsWith("https://cdn.runway-account.test/assets/"));
  const l = ledger();
  assert.deepEqual(l.map((x) => [x.state, x.credits, x.units, x.rate, x.provider]), [
    ["reserved", 150, 50, 3, "runway-account"],      // the ceiling: 10 credits a second for 5 seconds
    ["reserved", 36, 12, 3, "runway-account"],       // the quote, noted beside the ceiling
    ["reserved", 36, 12, 3, "runway-account"],       // the task
    ["spent", 150, 50, 3, "runway-account"],         // settled at the ceiling until a real quote confirms the reader (R5)
  ]);
  assert.deepEqual([l.at(-1).batch, l.at(-1).shot, l.at(-1).model], [BATCH, "s02", "gen4_turbo"]);
  assert.ok((await get(`/gen/jobs/${r.json.job}/output`)).buf.length > 0);
});

test("neither a key nor a sign-in: gen_no_key, and nothing is sent to either service", async () => {
  const r = await call("/gen/jobs", words());
  assert.deepEqual([r.status, r.json.code], [403, "gen_no_key"]);
  assert.equal(rw.seen.api.length, 0);
  assert.equal(rm.calls.length, 0);
});

test("a model with no ceiling: gen_no_price, and nothing is uploaded or asked", async () => {
  await signIn();
  const r = await call("/gen/jobs", { batch: BATCH, shot: "s04", kind: "still_upscale", input: await input() });
  assert.deepEqual([r.json.code, r.json.error.message], ["gen_no_price", CODES.gen_no_price[1]]);
  assert.equal(rm.calls.filter((c) => c.rpc === "tools/call").length, 0);
  assert.equal(ledger().length, 0);
});

test("a job whose ceiling passes today's limit: gen_over_daily, and nothing is sent", async () => {
  await signIn();
  setGen({ dailyCredits: 100 });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.json.code, "gen_over_daily");
  assert.equal(rm.calls.filter((c) => c.rpc === "tools/call").length, 0);
  assert.equal(ledger().length, 0);
});

test("Generation off: an agent's job is gen_off and nothing is sent to either service", async () => {
  await signIn();
  const before = rm.calls.length;
  setGen({ on: false });
  assert.equal((await call("/gen/jobs", words())).json.code, "gen_off");
  put(paths.runwayKey, `${KEY}\n`);
  assert.equal((await call("/gen/jobs", words())).json.code, "gen_off");
  assert.equal(rm.calls.length, before);
  assert.equal(rw.seen.api.length, 0);
});

test("the rate is the owner's: at 7 cents a credit the same quote is 84 cents, and the ceiling 1,050", async () => {
  setGen({ runwayAccount: { centsPerCredit: 7 } });
  batch({ budgetCredits: 5000 });   // the ceiling held, 150 credits at 7, must fit the batch
  await signIn();
  const r = await call("/gen/jobs", words());
  assert.equal(r.json.estimate, 1050);
  await settled(r.json.job);
  assert.deepEqual(ledger().filter((x) => x.credits === 84).map((x) => [x.units, x.rate]).at(0), [12, 7], "the quote noted");
  assert.deepEqual([ledger().at(-1).credits, ledger().at(-1).units, ledger().at(-1).rate], [1050, 150, 7]);
  const e = await call("/gen/estimate", { items: [{ kind: "text_to_video", model: "gen4.5", seconds: 5 }] });
  assert.equal(e.json.items[0].credits, 1050, "with no key, the estimate is the ceiling: 150 credits at 7");
});

// ---- the money rule: only a plain quote is approved ------------------------------------------------
test("a first answer that starts a job is never approved: Generation paused, and the job followed to its end at the ceiling, its result kept", async () => {
  await signIn();
  rm.behaviour.startNoQuote = true;
  const r = await call("/gen/jobs", words());
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.estimate, 450);
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits, end.output.type], ["done", 450, "video/mp4"]);
  assert.ok((await get(`/gen/jobs/${r.json.job}/output`)).buf.length > 0, "what it made is kept");
  assert.deepEqual(generations().map((c) => c.approved), [false]);
  assert.ok(rmTool("get_task").length > 0, "followed");
  const l = ledger();
  assert.ok(l.some((x) => x.state === "paused"));
  const spent = l.find((x) => x.state === "spent");
  assert.deepEqual([spent.credits, spent.verdict, spent.provider, typeof spent.runwayTask], [450, "done", "runway-account", "string"]);
  rm.behaviour.startNoQuote = false;
  assert.equal((await call("/gen/jobs", words({ promptText: "another" }))).json.code, "gen_paused");
  assert.equal(generations().length, 1);
});

test("an answer that is neither a quote nor a task: the ceiling spent, nothing approved, Generation paused", async () => {
  await signIn();
  rm.behaviour.unclear = true;
  const r = await call("/gen/jobs", words());
  assert.equal(r.json.code, "gen_could_not_start");
  assert.deepEqual(ledger().filter((x) => x.state === "spent").map((x) => [x.credits, x.verdict]), [[450, "started_without_quote"]]);
  assert.equal(ledger().at(-1).state, "paused");
  assert.equal(generations().filter((c) => c.approved).length, 0);
});

test("a quote above the row's ceiling is refused: released, nothing approved", async () => {
  await signIn();
  rm.behaviour.credits = 151;
  const r = await call("/gen/jobs", words());
  assert.deepEqual([r.json.code, r.json.error.message], ["gen_price_changed", "Runway's price for this is more than the door allows for this model, so nothing was spent."]);
  assert.deepEqual(ledger().map((x) => [x.state, x.credits]), [["reserved", 450], ["released", 0]]);
  assert.equal(generations().filter((c) => c.approved).length, 0);
});

test("the quote is checked against the limits again before it is approved", async () => {
  await signIn();
  rm.behaviour.onQuote = () => setGen({ dailyCredits: 20 });
  const r = await call("/gen/jobs", words());
  assert.equal(r.json.code, "gen_over_daily");
  assert.deepEqual(ledger().map((x) => [x.state, x.credits, x.verdict]), [["reserved", 450, null], ["released", 0, "quote_not_approved"]]);
  assert.equal(generations().filter((c) => c.approved).length, 0);
});

test("a quote given as a refusal is read; one with no credit count is not, and nothing is approved", async () => {
  await signIn();
  rm.behaviour.quoteShape = "error";
  const r = await call("/gen/jobs", words());
  assert.equal(r.status, 202, r.text);
  assert.equal((await settled(r.json.job)).credits, 450);
  for (const shape of ["noCredits", "prose"]) {
    rm.behaviour.quoteShape = shape;
    const n = await call("/gen/jobs", words({ promptText: `again ${shape}` }));
    assert.equal(n.json.code, "gen_could_not_start", shape);
    assert.match(n.json.error.message, /price the door can read/);
    assert.equal(ledger().at(-1).state, "released");
  }
  assert.equal(generations().filter((c) => c.approved).length, 1);
});

test("Runway asking about the price again after the approval: nothing made, released", async () => {
  await signIn();
  rm.behaviour.quoteAgain = true;
  const r = await call("/gen/jobs", words());
  assert.equal(r.json.code, "gen_price_changed");
  assert.deepEqual(ledger().map((x) => x.state), ["reserved", "reserved", "released"]);
});

test("a failed job counts as spent at its ceiling; a flagged one too, and its picture is not sent again", async () => {
  await signIn();
  rm.behaviour.failed = true;
  const f = await settled((await call("/gen/jobs", words())).json.job);
  assert.deepEqual([f.state, f.credits], ["failed", 450]);
  rm.behaviour.failed = false;
  rm.behaviour.flagged = true;
  const id = await input();
  const g = await settled((await call("/gen/jobs", clip(id))).json.job);
  assert.deepEqual([g.state, g.credits], ["refused", 150]);
  assert.equal((await call("/gen/jobs", clip(id, { promptText: "other" }))).json.code, "gen_not_approved");
});

test("no upload host pinned: the host is learned in the log, no byte is sent, nothing is held", async () => {
  await startDoor({ runwayAccount: { origin: rm.url, redirectUri: REDIRECT, net: rm.net } });
  await signIn();
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.json.code, "gen_could_not_start");
  assert.match(r.json.error.message, /upload address/);
  assert.equal(rm.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(generations().length, 0);
  assert.equal(ledger().length, 0);
  assert.ok(lines.some((l) => l.endsWith(`runway upload host offered and not pinned: ${UPLOAD_HOST}`)));
});

test("an upload address on a look-alike host is refused before any byte goes", async () => {
  rm.behaviour.uploadHost = `${UPLOAD_HOST}.evil.example`;
  await signIn();
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.json.code, "gen_could_not_start");
  assert.equal(rm.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(ledger().length, 0);
});

// ---- an app ---------------------------------------------------------------------------------------
test("an app's Runway job with no key goes by the sign-in, inside its allowance", async () => {
  await signIn();
  const r = await call("/gen/app/jobs", { model: "gen4.5", kind: "text_to_video", inputs: [], prompt: PROMPT, seconds: 5, ratio: "1280:720" }, app());
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(r.json.cents, 450);
  await settled(r.json.job, app(), "/gen/app/jobs");
  assert.deepEqual([ledger().at(-1).app, ledger().at(-1).credits, ledger().at(-1).batch], [APP, 450, ALLOWANCE]);
  allow({ budgetCents: 100 });
  const over = await call("/gen/app/jobs", { model: "gen4.5", kind: "text_to_video", inputs: [], prompt: "x", seconds: 5, ratio: "1280:720" }, app());
  assert.equal(over.json.code, "gen_over_allowance", "the ceiling, 450 cents, does not fit 100");
  assert.equal(rw.seen.api.length, 0);
});

test("an app's model list on the account path: each Runway row up to its ceiling at the account rate, the price its job holds", async () => {
  const signedOut = (await get("/gen/app/models", app())).json.models.find((m) => m.id === "gen4.5");
  assert.deepEqual([signedOut.ready, signedOut.why], [false, NEEDS.runway]);
  await signIn();
  const m = (await get("/gen/app/models", app())).json.models;
  const by = (id) => m.find((x) => x.id === id);
  const g = by("gen4.5");
  assert.deepEqual([g.ready, g.why, g.provider, g.words], [true, null, "runway", "Gen-4.5 on your Runway account"]);
  assert.deepEqual(g.price, { per: "second", cents: 90, byResolution: null, minimumCents: null, perRefCents: null, upTo: true }, "30 credits a second at 3 cents");
  assert.deepEqual([g.seconds, g.kinds], [{ min: 2, max: 10 }, ["image_to_video", "text_to_video"]]);
  assert.ok(g.ratios.includes("1280:720"));
  assert.deepEqual(by("gen4_turbo").seconds, { list: [5, 10] }, "the account row's seconds");
  assert.deepEqual(by("gen4_image").price.cents, 60);
  assert.deepEqual([by("magnific_precision_upscaler_v2").ready, by("magnific_precision_upscaler_v2").why, by("magnific_precision_upscaler_v2").price], [false, NO_PRICE, null], "no ceiling: not ready");
  assert.deepEqual([by("seedance2").ready, by("seedance2").price], [false, null], "no account row: not ready");
  // The price the app was shown is what its job holds.
  const r = await call("/gen/app/jobs", { model: "gen4.5", kind: "text_to_video", inputs: [], prompt: PROMPT, seconds: 5, ratio: "1280:720" }, app());
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.cents, g.price.cents * 5);
  assert.equal(ledger()[0].credits, g.price.cents * 5, "the ledger holds the price shown");
  await settled(r.json.job, app(), "/gen/app/jobs");
  put(paths.runwayKey, `${KEY}\n`);
  const k = (await get("/gen/app/models", app())).json.models.find((x) => x.id === "gen4.5");
  assert.deepEqual([k.ready, k.price.upTo, k.words], [true, undefined, "Gen-4.5 on Runway"], "a key saved: the table's price");
});

test("a key file that is not a usable key: gen_no_key for an agent and an app, never the sign-in, and nothing sent", async () => {
  await signIn();
  const id = await input();
  const appId = await input(app(), "/gen/app/inputs");
  rm.calls.length = 0;
  put(paths.runwayKey, "not-a-key\n");
  const a = await call("/gen/jobs", clip(id));
  assert.deepEqual([a.status, a.json.code], [403, "gen_no_key"]);
  const p = await call("/gen/app/jobs", { model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: appId, role: "first" }], prompt: PROMPT, seconds: 5, ratio: "1280:720" }, app());
  assert.deepEqual([p.status, p.json.code], [403, "gen_no_key"]);
  const m = (await get("/gen/app/models", app())).json.models.find((x) => x.id === "gen4.5");
  assert.deepEqual([m.ready, m.why, m.price.upTo], [false, NEEDS.runway, undefined], "not listed by the sign-in");
  const e = await call("/gen/app/estimate", { items: [{ model: "gen4.5", kind: "text_to_video", seconds: 5 }] }, app());
  assert.equal(e.json.items[0].upTo, undefined);
  assert.equal(rw.seen.api.length, 0, "the developer service saw nothing");
  assert.equal(rm.calls.length, 0, "Runway's MCP server saw nothing");
  assert.equal(ledger().length, 0);
});

// ---- a stopped door -----------------------------------------------------------------------------------
test("the door closed in the middle of an account job: asked about once at the next start, settled at its ceiling", async () => {
  await startDoor({ limits: { pollMs: 60_000, jobMs: 600_000, downloadMs: 3000, apiMs: 2000 } });
  await signIn();
  rm.behaviour.slow = true;
  const r = await call("/gen/jobs", words());
  assert.equal(r.status, 202, r.text);
  await until(() => ledger().at(-1).runwayTask !== null);
  await door.close();
  door = null;
  rm.behaviour.slow = false;
  const asked = rmTool("get_task").length;
  await startDoor();
  assert.ok(rmTool("get_task").length > asked);
  const end = await settled(r.json.job);
  assert.equal(end.state, "done");
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits, ledger().at(-1).units, ledger().at(-1).provider], ["spent", 450, 150, "runway-account"]);
});

test("an account reservation with no task at the next start stays counted at its ceiling, with no question", async () => {
  await door.close();
  door = null;
  put(paths.ledger, `${JSON.stringify({ at: new Date().toISOString(), job: "grwdead", batch: BATCH, shot: "s03", slug: "artist", kind: "text_to_video",
    model: "gen4.5", seconds: 5, estimate: 450, state: "reserved", credits: 450, runwayTask: null, verdict: null, provider: "runway-account", units: 150, rate: 3 })}\n`);
  await startDoor();
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits, ledger().at(-1).verdict], ["spent", 450, "unknown"]);
  assert.equal(rm.calls.length, 0);
});

// ---- main's options ---------------------------------------------------------------------------------
test("main pins Runway's one MCP origin and the home server's return address; the sign-in needs its token file's path", () => {
  const o = generateDoorOptions({ ports: { generate: 3140, home: 3100 }, paths });
  assert.deepEqual(o.runwayAccount, { origin: RW_MCP_ORIGIN, redirectUri: `http://127.0.0.1:3100${RW_RETURN_PATH}`, net: REAL_NET });
  assert.equal(RW_RETURN_PATH, "/api/generation/runway/back");
  const { runwayAuth: _gone, ...without } = paths;
  assert.throws(() => createGenerateDoor({ ...doorOptions(), paths: without }), /runwayAuth/);
  assert.throws(() => createGenerateDoor({ ...doorOptions(), runwayAccount: { origin: "https://mcp.runwayml.com.evil.example", redirectUri: REDIRECT } }), /origin/);
  assert.throws(() => createGenerateDoor({ ...doorOptions(), runwayAccount: { origin: rm.url, redirectUri: "http://evil.example/back" } }), /redirectUri/);
});

test("the new refusals are 403s", () => {
  for (const code of ["gen_rw_signed_out", "gen_rw_refused", "gen_rw_sign_in"]) assert.equal(CODES[code][0], 403, code);
});

test("readGenState: the account rate is 3 by default, the owner's when whole from 1 to 50; anything else makes the state unreadable", () => {
  setGen({ runwayAccount: undefined });
  assert.deepEqual(readGenState(paths.doorsState).runwayAccount, { centsPerCredit: 3 });
  setGen({ runwayAccount: { centsPerCredit: 50 } });
  assert.deepEqual(readGenState(paths.doorsState).runwayAccount, { centsPerCredit: 50 });
  for (const bad of [{ centsPerCredit: 0 }, { centsPerCredit: 51 }, { centsPerCredit: 2.5 }, { centsPerCredit: "3" }, { centsPerCredit: 3, on: true }, [], "3"]) {
    setGen({ runwayAccount: bad });
    assert.equal(readGenState(paths.doorsState).ok, false, JSON.stringify(bad));
  }
});

// ---- R5: the security review's fixes ----------------------------------------------------------------
// Each in a fresh state: two not started in one shot is that shot's limit (as for Runway's 4xx).
for (const [shape, credits] of [["plain", 0], ["price", 2.5], ["plain", 2.5]]) {
  test(`a quote of ${credits} credits${shape === "price" ? " under \`price\`" : ""} is no quote: gen_could_not_start, nothing approved, released`, async () => {
    await signIn();
    rm.behaviour.quoteShape = shape;
    rm.behaviour.credits = credits;
    const r = await call("/gen/jobs", words());
    assert.equal(r.json.code, "gen_could_not_start");
    assert.match(r.json.error.message, /price the door can read/);
    assert.deepEqual(ledger().map((x) => [x.state, x.credits, x.verdict]), [["reserved", 450, null], ["released", 0, "not_started_400"]]);
    assert.deepEqual(generations().map((c) => c.approved), [false], "no approved call");
  });
}

test("a higher cost Runway states later still raises the charge above the ceiling", async () => {
  await signIn();
  rm.behaviour.taskCost = 200;   // credits; the ceiling for 5 seconds of Gen-4.5 is 150
  const end = await settled((await call("/gen/jobs", words())).json.job);
  assert.deepEqual([end.state, end.credits], ["done", 600]);
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits, ledger().at(-1).units], ["spent", 600, 200]);
});

test("a job Runway started without a quote is followed: a higher cost it states reaches the ledger", async () => {
  await signIn();
  rm.behaviour.startNoQuote = true;
  rm.behaviour.taskCost = 180;
  const r = await call("/gen/jobs", words());
  assert.equal(r.status, 202, r.text);
  const end = await settled(r.json.job);
  assert.deepEqual([end.state, end.credits], ["done", 540]);
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits, ledger().at(-1).units], ["spent", 540, 180]);
  assert.ok(ledger().some((x) => x.state === "paused"), "Generation is paused all the same");
});

test("Gen-4.5 from words alone takes 16:9 only by sign-in; nothing is sent for another shape", async () => {
  await signIn();
  const r = await call("/gen/jobs", words({ ratio: "720:1280" }));
  assert.deepEqual([r.json.code, r.json.error.message], ["gen_bad_request", "This shape of picture is not one this model makes."]);
  assert.equal(generations().length, 0);
  assert.equal(ledger().length, 0);
});

test("an app's estimate on the account path: a Runway row is up to its ceiling at the account rate; with a key, the table's price", async () => {
  const items = [{ model: "gen4.5", kind: "text_to_video", seconds: 5 }, { model: "magnific_precision_upscaler_v2", kind: "still_upscale", scale: 2 }];
  const before = (await call("/gen/app/estimate", { items }, app())).json;
  assert.equal(before.items[0].upTo, undefined, "signed out: the table, as before");
  await signIn();
  setGen({ runwayAccount: { centsPerCredit: 4 } });
  const e = await call("/gen/app/estimate", { items }, app());
  assert.deepEqual(e.json, { items: [{ model: "gen4.5", cents: 600, upTo: true }, { model: "magnific_precision_upscaler_v2", cents: null }], total: null });
  put(paths.runwayKey, `${KEY}\n`);
  assert.deepEqual((await call("/gen/app/estimate", { items }, app())).json, before, "a key saved: the developer prices");
  assert.equal(rm.calls.filter((c) => c.rpc === "tools/call").length, 0, "an estimate asks Runway nothing");
});
