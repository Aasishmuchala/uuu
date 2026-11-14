// The generation door (PLAN-V5 K13) against the stand-in Runway. Made-up secrets, ids and a
// made-up key in a temp state folder; every socket lands on 127.0.0.1.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { CODES, NOT_STARTED_PER_SHOT, NOT_STARTED_TO_PAUSE, createGenerateDoor, generateDoorOptions } from "../door.mjs";
import { readLedger, totalsOf } from "../ledger.mjs";
import { MAX_CREDITS, RUNWAY_ORIGIN } from "../runway.mjs";
import { REAL_NET } from "../../web/fetch.mjs";
import { OUTPUT_HOST, mp4Bytes, pngBytes, startRunway } from "../../test/stubs/runway.mjs";

const GEN_SECRET = "2".repeat(64);
const WEB_SECRET = "1".repeat(64);
const KEY = `key_${"0123456789abcdef".repeat(8)}`;
const ARTIST = "99999999-2222-4333-8444-555555555555";
const SCOUT = "88888888-2222-4333-8444-555555555555";       // listed too
const RESEARCHER = "11111111-2222-4333-8444-555555555555";  // in the company, not listed
const PROMPT = "a slow push towards the stair, morning light, secret-prompt-words";
const MB = 1024 * 1024;

let rw;
let door;
let port;
let dir;
let paths;
let lines;

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const agent = (id = ARTIST, secret = GEN_SECRET) => mintToken(secret, "a", id, exp());
const owner = (secret = GEN_SECRET) => mintToken(secret, "t", "owner", exp());

function put(path, text, mode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, typeof text === "string" || Buffer.isBuffer(text) ? text : JSON.stringify(text));
  chmodSync(path, mode);
}
function setGen(gen = {}, mode = 0o600) {
  put(paths.doorsState, { version: 1, generate: { on: true, dailyCredits: 300, monthlyCredits: 1000, autoUnderCredits: 1000, ...gen }, changedAt: "2026-11-12T10:00:00.000Z" }, mode);
}
function batch(id, fields = {}) {
  const now = Date.now();
  put(join(paths.batches, `${id}.json`), {
    id, task: "task-1", slug: "artist", approvedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 6 * 86400_000).toISOString(),
    budgetCredits: 300, textToVideo: false, shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 } }, ...fields,
  });
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
const upload = (bytes = pngBytes(1280, 720), type = "image/png", token = agent()) => request("POST", "/gen/inputs", {
  headers: { Authorization: `Bearer ${token}`, "Content-Type": type }, body: bytes,
});
// A new picture each time (another length, so other bytes): the door knows a picture by its bytes.
let pictures = 0;
async function input(token, bytes = pngBytes(1280, 720, 2048 + (pictures += 1))) {
  const r = await upload(bytes, "image/png", token);
  assert.equal(r.status, 201, r.text);
  return r.json.input;
}
const clip = (inputId, extra = {}) => ({ batch: null, kind: "image_to_video", input: inputId, promptText: PROMPT, seconds: 5, ratio: "1280:720", ...extra });
async function settled(job, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await get(`/gen/jobs/${job}`);
    if (r.json && ["done", "failed", "refused"].includes(r.json.state)) return r.json;
    if (Date.now() > end) throw new Error(`job ${job} did not end: ${r.text}`);
    await new Promise((res) => setTimeout(res, 15));
  }
}
const ledger = () => (existsSync(paths.ledger) ? readFileSync(paths.ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const jobRecord = (job) => JSON.parse(readFileSync(join(paths.doorWork, "gen", "jobs", `${job}.json`), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Waits until `check()` holds (it may be async), at most `ms`.
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("the condition did not hold in time");
    await new Promise((res) => setTimeout(res, 10));
  }
}
const creates = () => rw.seen.api.filter((r) => r.method === "POST");
const raw = (text) => new Promise((resolve) => {
  const sock = net.connect(port, "127.0.0.1");
  const chunks = [];
  const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
  const timer = setTimeout(() => { sock.destroy(); done(); }, 1500);
  sock.on("data", (c) => chunks.push(c));
  sock.on("close", () => { clearTimeout(timer); done(); });
  sock.on("error", () => {});
  sock.write(text);
});
function behave(b = {}) {
  for (const k of Object.keys(rw.behaviour)) delete rw.behaviour[k];
  Object.assign(rw.behaviour, b);
}

async function startDoor(extra = {}) {
  if (door) await door.close();
  door = createGenerateDoor({
    listenPort: 0, upstream: rw.url, paths,
    config: { doors: { web: { agents: ["researcher"] }, generate: { agents: ["artist", "scout"] }, viewer: { agents: [] } } },
    log: (l) => lines.push(l), net: rw.net,
    limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000, pollErrors: 3 },
    ...extra,
  });
  port = await door.listen();
  await door.settled();
}

before(async () => { rw = await startRunway({ key: KEY }); });
after(async () => { if (door) await door.close(); await rw.close(); });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "gen-door-"));
  mkdirSync(join(dir, "doors", "batches"), { recursive: true, mode: 0o700 });
  mkdirSync(join(dir, "secrets", "doors"), { recursive: true, mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"),
    generateSecret: join(dir, "secrets", "doors", "generate-secret"), generateStatus: join(dir, "doors", "generate-status.json"),
    runwayKey: join(dir, "secrets", "doors", "runway-key"), ledger: join(dir, "doors", "generate-ledger.jsonl"),
    batches: join(dir, "doors", "batches"), doorWork: join(dir, "doors", "work"),
  };
  put(paths.ids, { agents: { artist: ARTIST, scout: SCOUT, researcher: RESEARCHER } }, 0o644);
  put(paths.generateSecret, `${GEN_SECRET}\n`);
  put(paths.runwayKey, `${KEY}\n`);
  setGen();
  behave();
  rw.seen.api.length = 0;
  rw.seen.outputs.length = 0;
  lines = [];
  await startDoor();
});
afterEach(async () => {
  // No log line ever holds the key, a token, or a prompt.
  for (const l of lines) {
    assert.ok(!l.includes(KEY) && !l.includes(KEY.slice(-12)), `key in log: ${l}`);
    assert.ok(!/v1\.[at]\./.test(l), `token in log: ${l}`);
    assert.ok(!l.includes("secret-prompt-words"), `prompt in log: ${l}`);
  }
});

// ---- rows 1 to 4: the door itself -------------------------------------------------------
test("health says only whether it is on, whether a key is saved and whether Higgsfield is signed in", async () => {
  const r = await request("GET", "/gen/health");
  assert.deepEqual(r.json, { status: "ok", part: "generate", on: true, key: true, higgsfield: false });
  rmSync(paths.runwayKey);
  setGen({ on: false });
  assert.deepEqual((await request("GET", "/gen/health")).json, { status: "ok", part: "generate", on: false, key: false, higgsfield: false });
});

test("row 1: upgrades and CONNECT are refused; unknown paths and any query string are 404", async () => {
  assert.match(await raw("GET /gen/health HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"), /403[\s\S]*gen_refused/);
  assert.match(await raw("CONNECT api.dev.example:443 HTTP/1.1\r\nHost: x\r\n\r\n"), /gen_refused/);
  for (const p of ["/gen/jobs?x=1", "/gen/health?x", "/gen/../gen/jobs", "/v1/image_to_video", "/gen/jobs/a/b", "/gen/inputs/"]) {
    const r = await call(p, {});
    assert.equal(r.status, 404, p);
    assert.equal(r.json.code, "gen_not_found");
  }
});

test("row 3: no token, another door's token, an agent not listed, the wrong kind of token", async () => {
  const cases = [
    await request("POST", "/gen/jobs", { body: "{}" }),
    await call("/gen/jobs", {}, agent(ARTIST, WEB_SECRET)),
    await call("/gen/jobs", {}, agent(RESEARCHER)),
    await call("/gen/jobs", {}, owner()),
    await call("/gen/owner/balance", {}, agent()),
    await request("POST", "/gen/jobs", { headers: { Authorization: [`Bearer ${agent()}`, `Bearer ${agent()}`] }, body: "{}" }),
  ];
  for (const r of cases) {
    assert.equal(r.status, 401);
    assert.equal(r.json.code, "gen_no_token");
  }
});

test("row 4: state unreadable, switch off, paused, no key", async () => {
  setGen({}, 0o666);
  assert.equal((await call("/gen/jobs", {})).json.code, "gen_off");
  put(paths.doorsState, "{ not json");
  assert.equal((await call("/gen/jobs", {})).json.code, "gen_off");
  setGen({ on: false });
  assert.equal((await upload()).json.code, "gen_off");
  setGen({ paused: "owner" });
  assert.equal((await call("/gen/jobs", {})).json.code, "gen_paused");
  setGen();
  put(paths.runwayKey, "key_not-a-key\n");
  const r = await call("/gen/jobs", {});
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "gen_no_key");
});

test("the switch is checked again after the body arrived", async () => {
  const id = await input();
  const body = JSON.stringify(clip(id));
  const res = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/gen/jobs", agent: false,
      headers: { Authorization: `Bearer ${agent()}`, "Content-Type": "application/json", "Content-Length": body.length } }, (r) => {
      const c = [];
      r.on("data", (x) => c.push(x));
      r.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString())));
    });
    req.write(body.slice(0, 10));
    setTimeout(() => { setGen({ on: false }); req.end(body.slice(10)); }, 100);
  });
  assert.equal(res.code, "gen_off");
  assert.equal(creates().length, 0);
  assert.equal(ledger().length, 0);
});

// ---- row 5: inputs ------------------------------------------------------------------------
test("row 5: an input must be a PNG, JPEG or WebP by its bytes, its type agreeing, 512 bytes to 3.3 MB", async () => {
  const ok = await upload();
  assert.equal(ok.status, 201);
  assert.deepEqual([ok.json.type, ok.json.width, ok.json.height], ["image/png", 1280, 720]);
  for (const [bytes, type] of [[Buffer.from("<html>".padEnd(2000, "x")), "image/png"], [pngBytes(), "image/jpeg"], [pngBytes(), "text/html"],
    [pngBytes(64, 64, 300), "image/png"], [Buffer.from("GIF89a".padEnd(2000, "x")), "image/gif"], [pngBytes(), "image/png, image/jpeg"]]) {
    const r = await upload(bytes, type);
    assert.equal(r.status, 400, String(type));
    assert.equal(r.json.code, "gen_bad_input");
  }
  const big = await upload(pngBytes(64, 64, 3_400_000));
  assert.equal(big.status, 413);
  assert.equal(big.json.code, "gen_bad_input");
  const none = await request("POST", "/gen/inputs", { headers: { Authorization: `Bearer ${agent()}` }, body: pngBytes() });
  assert.equal(none.json.code, "gen_bad_input");
});

test("row 5: at most 40 inputs are kept for an agent", async () => {
  for (let i = 0; i < 40; i += 1) assert.equal((await upload()).status, 201);
  const r = await upload();
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "gen_bad_input");
  assert.equal((await upload(pngBytes(1280, 720), "image/png", agent(SCOUT))).status, 201);
});

// ---- row 6: the job's body ------------------------------------------------------------------
test("row 6: unknown keys (a model, a claimed cost), long prompts, odd values are refused", async () => {
  const id = await input();
  for (const body of [clip(id, { model: "veo3.1" }), clip(id, { credits: 1 }), clip(id, { estimate: 0 }), clip(id, { promptText: "x".repeat(1001) }),
    clip(id, { kind: "video_to_video" }), clip(id, { seconds: 11 }), clip(id, { seconds: 2.5 }), clip(id, { input: "../../etc/passwd" }),
    clip(id, { batch: undefined }), clip(id, { batch: "b1" }), clip(id, { inputs: [id] }), "[]", "not json", { kind: "still_upscale", batch: null, input: id, scale: 8 }]) {
    const r = await call("/gen/jobs", body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(r.json.code, "gen_bad_request");
  }
  assert.equal(creates().length, 0);
});

test("row 6: an input another agent sent, or one never sent, is refused", async () => {
  const theirs = await input(agent(SCOUT));
  for (const id of [theirs, "i0000000000000000000"]) {
    const r = await call("/gen/jobs", clip(id));
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "gen_bad_request");
  }
  assert.equal(creates().length, 0);
});

// ---- a whole job ----------------------------------------------------------------------------
test("a job from upload to output bytes; reserved before the call leaves, spent after", async () => {
  let atArrival = null;
  behave({ onCreate: () => { atArrival = readFileSync(paths.ledger, "utf8"); } });
  const id = await input();
  const r = await call("/gen/jobs", clip(id));
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.estimate, 25);
  const end = await settled(r.json.job);
  assert.equal(end.state, "done");
  assert.equal(end.credits, 25);
  assert.deepEqual(end.output, { type: "video/mp4", bytes: 4096 });
  const out = await get(`/gen/jobs/${r.json.job}/output`);
  assert.equal(out.status, 200);
  assert.equal(out.headers["content-type"], "video/mp4");
  assert.ok(out.buf.equals(mp4Bytes()));
  // The stand-in saw the reservation already synced when the call arrived.
  assert.match(atArrival, /"state":"reserved"/);
  assert.equal(JSON.parse(atArrival.trim()).credits, 25);
  assert.deepEqual(ledger().map((l) => l.state), ["reserved", "reserved", "spent"]);
  // The task went through its statuses.
  const polls = rw.seen.api.filter((x) => x.method === "GET");
  assert.ok(polls.length >= 4);
  // The body Runway got: a data address of the picture, the state's model, the door's duration.
  const sent = creates()[0];
  assert.equal(sent.path, "/v1/image_to_video");
  assert.equal(sent.body.model, "gen4_turbo");
  assert.match(sent.body.promptImage, /^data:image\/png;base64,/);
  assert.equal(sent.body.duration, 5);
  // Another agent cannot see it.
  assert.equal((await get(`/gen/jobs/${r.json.job}`, agent(SCOUT))).json.code, "gen_not_found");
  assert.equal((await get(`/gen/jobs/${r.json.job}/output`, agent(SCOUT))).json.code, "gen_not_found");
});

test("the model is the state file's choice, whatever else happens", async () => {
  setGen({ models: { video: "gen4.5" } });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.json.estimate, 60);
  await settled(r.json.job);
  assert.equal(creates()[0].body.model, "gen4.5");
  setGen({ models: { video: "veo3.1" } });
  const v = await call("/gen/jobs", clip(await input()));
  assert.equal(v.json.code, "gen_no_price");
});

test("the key goes to the API host only, once per call, in Authorization; never to the outputs host", async () => {
  const r = await call("/gen/jobs", clip(await input()));
  await settled(r.json.job);
  for (const req of rw.seen.api) {
    const auth = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === "authorization") auth.push(req.rawHeaders[i + 1]);
    assert.deepEqual(auth, [`Bearer ${KEY}`]);
    assert.equal(req.rawHeaders.filter((h) => typeof h === "string" && h.includes(KEY)).length, 1);
  }
  assert.equal(rw.seen.outputs.length, 1);
  const o = rw.seen.outputs[0];
  assert.ok(!o.rawHeaders.join("\n").includes(KEY.slice(4, 20)));
  assert.ok(!o.rawHeaders.map((h) => h.toLowerCase()).includes("authorization"));
  assert.ok(!o.url.includes(KEY.slice(4, 20)));
  assert.equal(rw.seen.lookups.at(-1), OUTPUT_HOST);
});

// ---- outputs that are not safe -----------------------------------------------------------------
for (const [kind, extra] of [["ip"], ["private"], ["redirect"], ["huge"], ["hugeStream", { videoBytes: 1 * MB }], ["html"], ["keyed"], ["http"]]) {
  test(`an output address or answer that is ${kind} is refused and nothing is kept`, async () => {
    if (extra) await startDoor({ limits: { pollMs: 10, jobMs: 3000, downloadMs: 3000, apiMs: 2000, ...extra } });
    behave({ output: kind });
    const r = await call("/gen/jobs", clip(await input()));
    const end = await settled(r.json.job);
    assert.equal(end.state, "failed");
    assert.equal(end.output, null);
    assert.equal(end.credits, 25);
    assert.equal(ledger().at(-1).state, "spent");
    assert.equal((await get(`/gen/jobs/${r.json.job}/output`)).json.code, "gen_not_ready");
    const kept = readdirSync(join(paths.doorWork, "gen", "jobs")).filter((n) => !n.endsWith(".json"));
    assert.deepEqual(kept, []);
    if (kind === "keyed") assert.equal(rw.seen.outputs.length, 0);
    if (kind === "ip" || kind === "private" || kind === "http") assert.equal(rw.seen.outputs.length, 0);
    if (kind === "redirect") assert.equal(rw.seen.outputs.length, 1);
  });
}

// ---- row 7: the owner's batch -------------------------------------------------------------
test("row 7: by default nothing is spent without a batch", async () => {
  setGen({ autoUnderCredits: 0 });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "gen_not_approved");
  assert.equal(creates().length, 0);
  assert.equal(ledger().length, 0);
});

test("row 7: autoUnderCredits lets small unasked work through, up to its amount a day", async () => {
  setGen({ autoUnderCredits: 30 });
  const id = await input();
  const a = await call("/gen/jobs", clip(id));
  assert.equal(a.status, 202);
  await settled(a.json.job);
  const b = await call("/gen/jobs", clip(id, { seconds: 2 }));
  assert.equal(b.json.code, "gen_not_approved");
});

test("row 7: a batch that is missing, another agent's, expired, untrusted, or a shot not in it", async () => {
  setGen({ autoUnderCredits: 0 });
  const id = await input();
  const job = (b, s = "s01") => call("/gen/jobs", clip(id, { batch: b, shot: s }));
  assert.equal((await job("nope")).json.code, "gen_not_approved");
  batch("theirs", { slug: "scout" });
  assert.equal((await job("theirs")).json.code, "gen_not_approved");
  batch("old", { approvedAt: new Date(Date.now() - 9 * 86400_000).toISOString(), expiresAt: new Date(Date.now() - 2 * 86400_000).toISOString() });
  assert.equal((await job("old")).json.code, "gen_not_approved");
  batch("loose");
  chmodSync(join(paths.batches, "loose.json"), 0o666);
  assert.equal((await job("loose")).json.code, "gen_not_approved");
  batch("b1");
  assert.equal((await job("b1", "s02")).json.code, "gen_not_approved");
  assert.equal(creates().length, 0);
});

test("row 7: seconds over the approved, a model or kind beyond it, text to video not approved, a third take", async () => {
  setGen({ autoUnderCredits: 0 });
  const id = await input();
  batch("b1", { shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 },
    s02: { kind: "image_to_video", model: "veo3.1", maxSeconds: 5, takes: 2 },
    s03: { kind: "text_to_video", model: "gen4.5", maxSeconds: 5, takes: 1 } } });
  assert.equal((await call("/gen/jobs", clip(id, { batch: "b1", shot: "s01", seconds: 6 }))).json.code, "gen_not_approved");
  assert.equal((await call("/gen/jobs", clip(id, { batch: "b1", shot: "s02" }))).json.code, "gen_no_price");
  assert.equal((await call("/gen/jobs", { batch: "b1", shot: "s03", kind: "text_to_video", promptText: PROMPT, seconds: 5, ratio: "1280:720" })).json.code, "gen_not_approved");
  assert.equal((await call("/gen/jobs", { batch: "b1", shot: "s01", kind: "text_to_video", promptText: PROMPT, seconds: 5, ratio: "1280:720" })).json.code, "gen_not_approved");
  for (let take = 1; take <= 2; take += 1) {
    const r = await call("/gen/jobs", clip(id, { batch: "b1", shot: "s01", promptText: `${PROMPT} ${take}` }));
    assert.equal(r.status, 202, r.text);
    await settled(r.json.job);
  }
  const third = await call("/gen/jobs", clip(id, { batch: "b1", shot: "s01", promptText: `${PROMPT} 3` }));
  assert.equal(third.json.code, "gen_not_approved");
  assert.match(third.json.error.message, /every take/);
});

test("row 7: a model not in the owner's choice is refused even inside a batch", async () => {
  batch("b1", { shots: { s01: { kind: "image_to_video", model: "gen4.5", maxSeconds: 5, takes: 2 } } });
  setGen({ autoUnderCredits: 0, models: { video: "gen4_turbo", videoBest: "gen4_turbo" } });
  const r = await call("/gen/jobs", clip(await input(), { batch: "b1", shot: "s01" }));
  assert.equal(r.json.code, "gen_not_approved");
});

// ---- row 8: money ------------------------------------------------------------------------------
test("row 8: exactly at the daily cap passes, one credit over refuses", async () => {
  setGen({ dailyCredits: 25 });
  const id = await input();
  const a = await call("/gen/jobs", clip(id));
  assert.equal(a.status, 202);
  await settled(a.json.job);
  setGen({ dailyCredits: 34 });
  const b = await call("/gen/jobs", clip(id, { seconds: 2 }));   // 25 + 10 = 35 > 34
  assert.equal(b.status, 403);
  assert.equal(b.json.code, "gen_over_daily");
  setGen({ dailyCredits: 35 });
  assert.equal((await call("/gen/jobs", clip(id, { seconds: 2 }))).status, 202);
});

test("row 8: the monthly cap, a cap of 0, and the batch's budget", async () => {
  const id = await input();
  setGen({ monthlyCredits: 24 });
  assert.equal((await call("/gen/jobs", clip(id))).json.code, "gen_over_monthly");
  setGen({ dailyCredits: 0 });
  assert.equal((await call("/gen/jobs", clip(id))).json.code, "gen_cap_zero");
  setGen({ monthlyCredits: 0 });
  assert.equal((await call("/gen/jobs", clip(id))).json.code, "gen_cap_zero");
  setGen({ autoUnderCredits: 0 });
  batch("b1", { budgetCredits: 24 });
  assert.equal((await call("/gen/jobs", clip(id, { batch: "b1", shot: "s01" }))).json.code, "gen_over_batch");
  assert.equal(creates().length, 0);
});

test("row 8: two jobs racing cannot both pass a cap only one fits", async () => {
  setGen({ dailyCredits: 25 });
  const id = await input();
  const [a, b] = await Promise.all([call("/gen/jobs", clip(id)), call("/gen/jobs", clip(id, { promptText: `${PROMPT} b` }))]);
  assert.deepEqual([a.status, b.status].sort(), [202, 403]);
  assert.equal([a, b].find((x) => x.status === 403).json.code, "gen_over_daily");
  assert.equal(creates().length, 1);
});

test("row 8: a damaged ledger refuses everything and nothing is sent", async () => {
  const id = await input();
  put(paths.ledger, '{"at":"2026-11-12T10:00:00Z","job":"g1","state":"spent","credits":"lots"}\n');
  assert.equal((await call("/gen/jobs", clip(id))).json.code, "gen_ledger");
  put(paths.ledger, "{\"at\":\"2026-11");
  assert.equal((await call("/gen/jobs", clip(id))).json.code, "gen_ledger");
  put(paths.ledger, "", 0o666);
  assert.equal((await call("/gen/jobs", clip(id))).json.code, "gen_ledger");
  assert.equal(creates().length, 0);
});

test("money: the highest of what is known is charged; a negative cost is not a cost; an enormous one is held", async () => {
  const id = await input();
  behave({ estimate: 40, cost: 30 });
  let r = await call("/gen/jobs", clip(id));
  assert.equal((await settled(r.json.job)).credits, 40);
  behave({ cost: -500 });
  r = await call("/gen/jobs", clip(id, { promptText: `${PROMPT} 2` }));
  assert.equal((await settled(r.json.job)).credits, 25);
  setGen({ dailyCredits: MAX_CREDITS * 2, monthlyCredits: MAX_CREDITS * 2, autoUnderCredits: MAX_CREDITS * 2 });
  behave({ cost: 1e18 });
  r = await call("/gen/jobs", clip(id, { promptText: `${PROMPT} 3` }));
  assert.equal((await settled(r.json.job)).credits, MAX_CREDITS);
  assert.deepEqual(ledger().filter((l) => l.state === "spent").map((l) => l.credits), [40, 25, MAX_CREDITS]);
});

test("money: when Runway's own price would pass a cap, the task is stopped at once and still counted", async () => {
  setGen({ dailyCredits: 30 });
  behave({ estimate: 50 });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.json.code, "gen_over_daily");
  assert.ok(rw.seen.api.some((x) => x.method === "DELETE"));
  assert.equal(ledger().at(-1).state, "spent");
  assert.equal(ledger().at(-1).credits, 50);
});

// ---- row 9: Runway's refusals ------------------------------------------------------------------
test("row 9: Runway refuses the key (401): plain, and nothing is counted", async () => {
  behave({ create: 401 });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "gen_key_refused");
  assert.deepEqual(ledger().map((l) => [l.state, l.credits]), [["reserved", 25], ["released", 0]]);
});

test("row 9: Runway's 429 is the door's 403 with retryAfterSec, never a 429", async () => {
  behave({ create: 429, retryAfter: 120 });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "gen_limited");
  assert.equal(r.json.retryAfterSec, 120);
});

test("row 9: a 400 with issues, a 5xx, garbage and a bad id are 'could not start'; only the clear refusal is free", async () => {
  const id = await input();
  behave({ create: 400 });
  let r = await call("/gen/jobs", clip(id));
  assert.equal(r.json.code, "gen_could_not_start");
  assert.match(r.json.error.message, /approved Content-Type/);
  assert.equal(ledger().at(-1).state, "released");
  for (const [n, c] of [[2, 502], [3, "garbage"], [4, "badId"]]) {
    behave({ create: c });
    r = await call("/gen/jobs", clip(id, { promptText: `${PROMPT} ${n}` }));
    assert.equal(r.status, 403, String(c));
    assert.equal(r.json.code, "gen_could_not_start");
    assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits], ["spent", 25]);
  }
});

test("Runway's error text reaches the caller without the key", async () => {
  behave({ create: "keyText" });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.json.code, "gen_could_not_start");
  assert.match(r.json.error.message, /Runway said/);
  for (const piece of [KEY, KEY.slice(0, 12), KEY.slice(-12), KEY.slice(20, 40)]) assert.ok(!r.text.includes(piece));
  behave({ steps: ["FAILED"], failureCode: "INTERNAL", failure: `boom ${KEY} boom` });
  const f = await call("/gen/jobs", clip(await input(), { promptText: `${PROMPT} f` }));
  const end = await settled(f.json.job);
  assert.equal(end.state, "failed");
  assert.match(end.reason, /boom \[removed\] boom/);
  assert.ok(!JSON.stringify(end).includes(KEY.slice(20, 40)));
});

// ---- moderation ----------------------------------------------------------------------------------
test("a safety refusal is 'refused', counted as spent unless Runway says 0, and never sent again", async () => {
  behave({ steps: ["PENDING", "FAILED"], failureCode: "SAFETY.INPUT.IMAGE" });
  const id = await input();
  const r = await call("/gen/jobs", clip(id));
  const end = await settled(r.json.job);
  assert.equal(end.state, "refused");
  assert.equal(end.credits, 25);
  assert.equal(ledger().at(-1).verdict, "refused");
  const again = await call("/gen/jobs", clip(id, { promptText: "another" }));
  assert.equal(again.json.code, "gen_not_approved");
  assert.equal(creates().length, 1);
  behave({ steps: ["FAILED"], failureCode: "INPUT_PREPROCESSING.SAFETY.TEXT", cost: 0 });
  const t = await call("/gen/jobs", clip(await input(), { promptText: "words" }));
  const tEnd = await settled(t.json.job);
  assert.equal(tEnd.credits, 0);
  assert.equal(ledger().at(-1).state, "released");
});

test("two safety refusals freeze the batch; three in a day pause the door until the owner starts it again", async () => {
  setGen({ autoUnderCredits: 0 });
  batch("b1", { shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 3 },
    s02: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 3 } } });
  batch("b2");
  const spare = [await input(), await input(), await input(), await input()];
  behave({ steps: ["FAILED"], failureCode: "SAFETY.OUTPUT.VIDEO" });
  for (const shot of ["s01", "s02"]) {
    const r = await call("/gen/jobs", clip(await input(), { batch: "b1", shot }));
    assert.equal((await settled(r.json.job)).state, "refused");
  }
  const frozen = await call("/gen/jobs", clip(await input(), { batch: "b1", shot: "s01" }));
  assert.equal(frozen.json.code, "gen_not_approved");
  assert.match(frozen.json.error.message, /refused two pictures or prompts in this film/);
  const third = await call("/gen/jobs", clip(await input(), { batch: "b2", shot: "s01" }));
  assert.equal((await settled(third.json.job)).state, "refused");
  assert.equal(ledger().at(-1).state, "paused");
  behave();
  assert.equal((await call("/gen/jobs", clip(spare[0], { batch: "b2", shot: "s01" }))).json.code, "gen_paused");
  assert.equal((await upload()).json.code, "gen_paused");
  await startDoor();   // a restart does not clear it
  assert.equal((await call("/gen/jobs", clip(spare[1], { batch: "b2", shot: "s01" }))).json.code, "gen_paused");
  setGen({ autoUnderCredits: 0, resumedAt: new Date(Date.now() + 3600_000).toISOString() });   // a future time is not a yes
  assert.equal((await call("/gen/jobs", clip(spare[2], { batch: "b2", shot: "s01" }))).json.code, "gen_paused");
  setGen({ autoUnderCredits: 0, resumedAt: new Date().toISOString() });
  const back = await call("/gen/jobs", clip(spare[3], { batch: "b2", shot: "s01" }));
  assert.equal(back.status, 202, back.text);
});

// ---- requests Runway did not start (T48 F1), pictures by their bytes (F5), what was sent (F3) ----------------------
test("a request Runway did not start (a 4xx) is free but counted: the same one is not sent again, two refuse the shot, three in a day pause the door", async () => {
  setGen({ autoUnderCredits: 0 });
  batch("b1", { shots: { s01: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 },
    s02: { kind: "image_to_video", model: "gen4_turbo", maxSeconds: 5, takes: 2 } } });
  const bytes = pngBytes(1280, 720, 4000);
  const pic = () => input(undefined, bytes);
  assert.deepEqual([NOT_STARTED_PER_SHOT, NOT_STARTED_TO_PAUSE], [2, 3]);
  behave({ create: 400 });
  const first = await call("/gen/jobs", clip(await pic(), { batch: "b1", shot: "s01" }));
  assert.equal(first.json.code, "gen_could_not_start", first.text);
  // The same picture sent up again under a new id, with the same prompt: refused at the door, nothing sent.
  const same = await call("/gen/jobs", clip(await pic(), { batch: "b1", shot: "s01" }));
  assert.equal(same.json.code, "gen_not_approved");
  assert.match(same.json.error.message, /did not start this same request before/);
  assert.equal(creates().length, 1);
  // Another prompt is another request: the shot's second goes out, a third does not.
  assert.equal((await call("/gen/jobs", clip(await pic(), { batch: "b1", shot: "s01", promptText: `${PROMPT} 2` }))).json.code, "gen_could_not_start");
  const third = await call("/gen/jobs", clip(await pic(), { batch: "b1", shot: "s01", promptText: `${PROMPT} 3` }));
  assert.equal(third.json.code, "gen_not_approved");
  assert.match(third.json.error.message, /did not start this shot twice/);
  assert.equal(creates().length, 2);
  // A third in the day, of another shot, pauses the whole door.
  const spare = [await input(), await input()];
  behave({ create: 404 });
  assert.equal((await call("/gen/jobs", clip(await input(), { batch: "b1", shot: "s02" }))).json.code, "gen_could_not_start");
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).verdict], ["paused", "three_not_started"]);
  behave();
  assert.equal((await call("/gen/jobs", clip(spare[0], { batch: "b1", shot: "s02", promptText: `${PROMPT} 4` }))).json.code, "gen_paused");
  assert.equal((await upload()).json.code, "gen_paused");
  assert.equal(creates().length, 3);
  // Nothing was charged and no take was used; the ledger counts what was tried.
  const t = totalsOf(readLedger(paths.ledger).lines, Date.now(), { batch: "b1" });
  assert.deepEqual([t.day, t.batch, t.takes("s01"), t.takes("s02"), t.notStarted("s01"), t.notStarted("s02"), t.notStartedRecent], [0, 0, 0, 0, 2, 1, 3]);
  assert.deepEqual(ledger().filter((l) => l.state === "released").map((l) => l.verdict), ["not_started_400", "not_started_400", "not_started_404"]);
  // A restart clears neither the pause nor the mark on the request Runway did not start.
  await startDoor();
  assert.equal((await call("/gen/jobs", clip(spare[1], { batch: "b1", shot: "s02", promptText: `${PROMPT} 5` }))).json.code, "gen_paused");
  setGen({ autoUnderCredits: 0, resumedAt: new Date().toISOString() });
  const again = await call("/gen/jobs", clip(await pic(), { batch: "b1", shot: "s01" }));
  assert.match(again.json.error.message, /did not start this same request before/);
  // After Start again the counts begin again.
  const back = await call("/gen/jobs", clip(await pic(), { batch: "b1", shot: "s01", promptText: `${PROMPT} 6` }));
  assert.equal(back.status, 202, back.text);
  assert.equal((await settled(back.json.job)).state, "done");
  assert.equal(creates().length, 4);
});

test("after Runway's 429 the door says wait without calling out until the wait has passed; a 429 or a 401 is no mark on the request", async () => {
  const id = await input();
  behave({ create: 429, retryAfter: 1 });
  const a = await call("/gen/jobs", clip(id));
  assert.deepEqual([a.status, a.json.code, a.json.retryAfterSec], [403, "gen_limited", 1]);
  const b = await call("/gen/jobs", clip(id, { promptText: "another" }));
  assert.deepEqual([b.status, b.json.code, b.json.retryAfterSec], [403, "gen_limited", 1]);
  assert.equal(creates().length, 1);
  assert.equal(ledger().length, 2, "a refusal at the door writes nothing");
  behave();
  // Once the wait has passed, the same request goes out (the role's one resend after the wait).
  let r;
  await until(async () => {
    r = await call("/gen/jobs", clip(id));
    return r.json.code !== "gen_limited";
  });
  assert.equal(r.status, 202, r.text);
  await settled(r.json.job);
  behave({ create: 401 });
  assert.equal((await call("/gen/jobs", clip(id, { promptText: "with the key" }))).json.code, "gen_key_refused");
  behave();
  const k = await call("/gen/jobs", clip(id, { promptText: "with the key" }));
  assert.equal(k.status, 202, k.text);
  await settled(k.json.job);
  assert.equal(creates().length, 4);
});

test("a refused picture is known by its bytes: sent up again under a new id, with the same prompt or another, it is not sent; its job record keeps what was sent", async () => {
  const bytes = pngBytes(1280, 720, 5000);
  behave({ steps: ["FAILED"], failureCode: "SAFETY.INPUT.IMAGE", cost: 0 });
  const first = await call("/gen/jobs", clip(await input(undefined, bytes)));
  assert.equal((await settled(first.json.job)).state, "refused");
  // What was sent, in the door's own record: the prompt as sent and the hash of each input's bytes.
  const rec = jobRecord(first.json.job);
  assert.deepEqual([rec.prompt, rec.inputSha256, rec.inputs.length, rec.notStarted], [PROMPT, [sha256(bytes)], 1, null]);
  const inRec = JSON.parse(readFileSync(join(paths.doorWork, "gen", "inputs", `${rec.inputs[0]}.json`), "utf8"));
  assert.deepEqual([inRec.sha256, inRec.refused], [sha256(bytes), true]);
  behave();
  const again = await call("/gen/jobs", clip(await input(undefined, bytes)));
  assert.equal(again.json.code, "gen_not_approved");
  assert.match(again.json.error.message, /refused this picture before/);
  const reworded = await call("/gen/jobs", clip(await input(undefined, bytes), { promptText: "the same picture, other words" }));
  assert.equal(reworded.json.code, "gen_not_approved");
  assert.match(reworded.json.error.message, /refused this picture before/);
  // Read back from the door's own records at its next start, never per request.
  await startDoor();
  for (const promptText of [PROMPT, "and once more in other words"]) {
    const r = await call("/gen/jobs", clip(await input(undefined, bytes), { promptText }));
    assert.match(r.json.error.message, /refused this picture before/);
  }
  // Another picture with the same prompt is another request; a still keeps its words too.
  const other = await call("/gen/jobs", clip(await input()));
  assert.equal(other.status, 202, other.text);
  await settled(other.json.job);
  const v = await call("/gen/jobs", { batch: null, kind: "still_variation", inputs: [await input(), await input()], promptText: "@ref1 at dusk", ratio: "1920:1080" });
  await settled(v.json.job);
  const vr = jobRecord(v.json.job);
  assert.equal(vr.prompt, "@ref1 at dusk");
  assert.equal(vr.inputSha256.length, 2);
  assert.ok(vr.inputSha256.every((h) => /^[0-9a-f]{64}$/.test(h)));
  assert.equal(creates().length, 3);
});

// ---- time, restarts, at once ---------------------------------------------------------------------
test("a task that never ends is stopped at the job's limit, cancelled once, and counted", async () => {
  await startDoor({ limits: { pollMs: 10, jobMs: 200, downloadMs: 3000, apiMs: 2000 } });
  behave({ steps: "never" });
  const r = await call("/gen/jobs", clip(await input()));
  const end = await settled(r.json.job);
  assert.equal(end.state, "failed");
  assert.match(end.reason, /did not finish/);
  assert.equal(rw.seen.api.filter((x) => x.method === "DELETE").length, 1);
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits], ["spent", 25]);
});

test("Runway that stops answering clearly (5xx, endless body) ends the job, counted", async () => {
  behave({ poll: "huge" });
  await startDoor({ limits: { pollMs: 10, jobMs: 5000, downloadMs: 3000, apiMs: 500, answerBytes: 64 * 1024, pollErrors: 2 } });
  const r = await call("/gen/jobs", clip(await input()));
  const end = await settled(r.json.job);
  assert.equal(end.state, "failed");
  assert.equal(ledger().at(-1).state, "spent");
});

test("a reservation left by a stopped door is settled at the next start by one question to Runway", async () => {
  // The first door would ask about its task only after a minute: it asks nothing before it stops, so no late
  // question of its own can reach the stand-in once the count below begins, and nothing can end the job early.
  await startDoor({ limits: { pollMs: 60_000, jobMs: 600_000, downloadMs: 3000, apiMs: 2000 } });
  behave({ steps: "never" });
  const r = await call("/gen/jobs", clip(await input()));
  assert.equal(r.status, 202);
  await until(() => ledger().at(-1).runwayTask !== null && jobRecord(r.json.job).runwayTask !== null);
  await door.close();
  door = null;
  assert.equal(ledger().at(-1).state, "reserved");
  const task = ledger().at(-1).runwayTask;
  behave({ steps: ["SUCCEEDED"], cost: 25 });
  rw.seen.api.length = 0;
  await startDoor();
  assert.equal(rw.seen.api.filter((x) => x.path === `/v1/tasks/${task}`).length, 1);
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits], ["spent", 25]);
  assert.equal((await settled(r.json.job)).state, "done");
});

test("a reservation with no task id stays counted at its estimate after a restart", async () => {
  put(paths.ledger, `${JSON.stringify({ at: new Date().toISOString(), job: "gdead", batch: null, shot: null, slug: "artist", kind: "image_to_video",
    model: "gen4_turbo", seconds: 5, estimate: 25, state: "reserved", credits: 25, runwayTask: null, verdict: null })}\n`);
  await startDoor();
  assert.deepEqual([ledger().at(-1).state, ledger().at(-1).credits, ledger().at(-1).verdict], ["spent", 25, "unknown"]);
  assert.equal(rw.seen.api.length, 0);
});

test("two jobs at once at most", async () => {
  behave({ steps: "never" });
  const id = await input();
  assert.equal((await call("/gen/jobs", clip(id, { promptText: "a" }))).status, 202);
  assert.equal((await call("/gen/jobs", clip(id, { promptText: "b" }))).status, 202);
  const c = await call("/gen/jobs", clip(id, { promptText: "c" }));
  assert.equal(c.json.code, "gen_busy");
  assert.equal(c.status, 403);
});

// ---- other kinds, estimate, the owner's balance ----------------------------------------------------
test("a still variation and an upscale go to their endpoints; an upscale past 4096 px is refused", async () => {
  const id = await input();
  const v = await call("/gen/jobs", { batch: null, kind: "still_variation", inputs: [id], promptText: "@ref1 at dusk", ratio: "1920:1080" });
  assert.equal(v.json.estimate, 8);
  const vEnd = await settled(v.json.job);
  assert.equal(vEnd.state, "done");
  assert.equal(vEnd.output.type, "image/png");
  const u = await call("/gen/jobs", { batch: null, kind: "still_upscale", input: id, scale: 2 });
  assert.equal(u.json.estimate, 25);
  await settled(u.json.job);
  assert.deepEqual(creates().map((c) => c.path), ["/v1/text_to_image", "/v1/image_upscale"]);
  const big = await call("/gen/jobs", { batch: null, kind: "still_upscale", input: id, scale: 4 });
  assert.equal(big.json.code, "gen_bad_request");
});

test("estimate prices a list without calling out", async () => {
  const r = await call("/gen/estimate", { items: [{ kind: "image_to_video", seconds: 5 }, { kind: "image_to_video", model: "gen4.5", seconds: 10 }, { kind: "still_upscale" }] });
  assert.deepEqual(r.json.items.map((i) => i.credits), [25, 120, 25]);
  assert.equal(r.json.total, 170);
  assert.equal((await call("/gen/estimate", { items: [{ kind: "image_to_video", model: "veo3.1", seconds: 5 }] })).json.code, "gen_no_price");
  assert.equal((await call("/gen/estimate", { items: [{ kind: "image_to_video", seconds: 5, credits: 1 }] })).json.code, "gen_bad_request");
  assert.equal(rw.seen.api.length, 0);
});

test("the owner's balance: Runway's two numbers only, with the switch off too", async () => {
  setGen({ on: false });
  behave({ organization: { creditBalance: 1234, tier: { maxMonthlyCreditSpend: 100000, models: { x: 1 } }, usage: { models: {} }, secret: KEY } });
  const r = await call("/gen/owner/balance", {}, owner());
  assert.deepEqual(r.json, { creditBalance: 1234, maxMonthlyCreditSpend: 100000 });
  behave({ organization: { creditBalance: -5, tier: "x" } });
  assert.deepEqual((await call("/gen/owner/balance", {}, owner())).json, { creditBalance: null, maxMonthlyCreditSpend: null });
  rmSync(paths.runwayKey);
  assert.equal((await call("/gen/owner/balance", {}, owner())).json.code, "gen_no_key");
});

// ---- the door's own rules -------------------------------------------------------------------------
test("createGenerateDoor throws on any other upstream; main() pins Runway's origin and the real network", () => {
  for (const up of ["https://api.runwayml.com", "http://localhost:1", "https://api.dev.runwayml.com/v1", undefined]) {
    assert.throws(() => createGenerateDoor({ listenPort: 0, upstream: up, paths, config: {}, net: rw.net }), /upstream/);
  }
  const o = generateDoorOptions({ ports: { generate: 3140 }, paths });
  assert.equal(o.upstream, RUNWAY_ORIGIN);
  assert.equal(o.net, REAL_NET);
});

test("no refusal of the door's own is a 429 or a 5xx", () => {
  for (const [code, [status]] of Object.entries(CODES)) assert.ok(status >= 400 && status < 500 && status !== 429, code);
});
