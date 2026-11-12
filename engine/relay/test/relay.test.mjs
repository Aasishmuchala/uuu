// The model relay against the stand-in provider (engine/test/stubs/provider.mjs). Made-up
// key, secret and ids in a temp state folder; nothing leaves 127.0.0.1.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelay } from "../relay.mjs";
import { mintToken } from "../token.mjs";
import { startProvider, STUB_USAGE } from "../../test/stubs/provider.mjs";

const SECRET = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const KEY = "sk-omega-MADEUP-real-key-0123456789";
const BUILDER = "11111111-2222-4333-8444-555555555555";
const CHECKER = "22222222-3333-4444-8555-666666666666";
const SALES = "33333333-4444-4555-8666-777777777777";   // in the company, no pick
const STRANGER = "44444444-5555-4666-8777-888888888888"; // not in the company
const PICKS = { builder: "claude-fable-5-1", checker: "claude-gpt-6-1-sol" };
const MARKER = "PROMPT-MARKER-7f3a9c";
const MB = 1024 * 1024;

let provider;
let relay;
let port;
let dir;
let paths;
let lines = [];

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const agentToken = (id = BUILDER, e = exp()) => mintToken(SECRET, "a", id, e);
const testToken = (slug = "checker") => mintToken(SECRET, "t", slug, exp());
const auth = (token = agentToken()) => ({ Authorization: `Bearer ${token}` });
const jsonAuth = (token) => ({ ...auth(token), "Content-Type": "application/json" });

function put(path, text, mode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}
function setState(mode = "provider", picks = PICKS) {
  const p = {};
  for (const [slug, model] of Object.entries(picks)) p[slug] = { model, source: "ranked" };
  put(paths.state, JSON.stringify({ version: 1, mode, picks: p, overrides: {}, catalogue: null, key: { state: "unknown" } }));
}

function request(method, path, { headers = {}, body, port: p = port } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: p, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, buf, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const post = (path, bodyObj, headers = jsonAuth()) => request("POST", path, { headers, body: JSON.stringify(bodyObj) });

// Writes raw bytes and collects everything until the relay closes the socket (or 1.5 s).
function raw(text) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
    const timer = setTimeout(() => { sock.destroy(); done(); }, 1500);
    sock.on("data", (c) => chunks.push(c));
    sock.on("close", () => { clearTimeout(timer); done(); });
    sock.on("error", () => {});
    sock.write(text);
  });
}
const statusOf = (rawText) => Number((rawText.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]);
const modelCalls = () => provider.seen.filter((s) => s.method === "POST");
const header = (rawHeaders, name) => {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) if (rawHeaders[i].toLowerCase() === name) out.push(rawHeaders[i + 1]);
  return out;
};
const readStatus = () => JSON.parse(readFileSync(paths.status, "utf8"));
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function assertRefusal(r, status, code) {
  assert.equal(r.status, status, r.text);
  assert.equal(r.json?.code, code, r.text);
  assert.equal(r.json.type, "error");
  assert.equal(typeof r.json.error.type, "string");
  assert.equal(typeof r.json.error.message, "string");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers.connection, "close");
}

function makeRelay(extra = {}) {
  return createRelay({
    listenPort: 0, upstream: provider.url, paths, log: (l) => lines.push(l),
    limits: { statusEveryMs: 20, ...(extra.limits || {}) }, ...extra,
  });
}

before(async () => {
  provider = await startProvider();
  dir = mkdtempSync(join(tmpdir(), "relay-test-"));
  mkdirSync(join(dir, "models"), { mode: 0o700 });
  mkdirSync(join(dir, "secrets"), { mode: 0o700 });
  paths = {
    state: join(dir, "models", "state.json"),
    ids: join(dir, "ids.json"),
    key: join(dir, "secrets", "omega-key"),
    secret: join(dir, "secrets", "relay-secret"),
    status: join(dir, "models", "relay-status.json"),
  };
  relay = makeRelay();
  port = await relay.listen();
});

after(async () => {
  await relay.close();
  await provider.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  provider.seen.length = 0;
  for (const k of Object.keys(provider.behaviour)) delete provider.behaviour[k];
  lines = [];
  put(paths.secret, `${SECRET}\n`);
  put(paths.key, `${KEY}\n`);
  put(paths.ids, JSON.stringify({ agents: { builder: BUILDER, checker: CHECKER, sales: SALES } }));
  setState("provider");
});

// ---- health ------------------------------------------------------------------
test("health tells only the mode and whether a key is saved", async () => {
  let r = await request("GET", "/relay/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: "ok", part: "relay", mode: "provider", key: true });
  assert.ok(!r.text.includes(KEY) && !r.text.includes("claude-"), "no key and no pick in health");
  rmSync(paths.key);
  setState("plans");
  r = await request("GET", "/relay/health");
  assert.deepEqual(r.json, { status: "ok", part: "relay", mode: "plans", key: false });
  put(paths.state, "{broken");
  r = await request("GET", "/relay/health");
  assert.deepEqual(r.json, { status: "ok", part: "relay", mode: "unreadable", key: false });
  assert.equal(provider.seen.length, 0);
});

// ---- tokens --------------------------------------------------------------------
test("no token, two Authorization headers, not a bearer, wrong mac, expired, too far ahead → 401 and the upstream sees nothing", async () => {
  const now = Math.floor(Date.now() / 1000);
  const good = agentToken();
  const cases = [
    {},
    { "Content-Type": "application/json" },
    { Authorization: `Basic ${good}` },
    { Authorization: good },
    { Authorization: `Bearer ${good.slice(0, -1)}${good.endsWith("0") ? "1" : "0"}` },
    { Authorization: `Bearer ${agentToken(BUILDER, now - 1)}` },
    { Authorization: `Bearer ${agentToken(BUILDER, now + 7 * 3600 + 60)}` },
    { Authorization: `Bearer ${mintToken("f".repeat(64), "a", BUILDER, exp())}` },
    { Authorization: `Bearer ${good.replace(BUILDER, CHECKER)}` },
    { Authorization: `Bearer ${good} extra` },
    { Authorization: "Bearer " },
  ];
  for (const h of cases) {
    const r = await request("POST", "/v1/messages", { headers: { "Content-Type": "application/json", ...h }, body: "{}" });
    assertRefusal(r, 401, "relay_no_token");
  }
  const two = await raw(`POST /v1/messages HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${good}\r\nAuthorization: Bearer ${good}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`);
  assert.equal(statusOf(two), 401);
  assert.match(two, /relay_no_token/);
  assert.equal(provider.seen.length, 0);
});

test("a missing, untrusted or malformed secret refuses every token", async () => {
  for (const setup of [
    () => rmSync(paths.secret, { force: true }),
    () => put(paths.secret, `${SECRET}\n`, 0o620),
    () => put(paths.secret, `${SECRET.toUpperCase()}\n`),
    () => { rmSync(paths.secret, { force: true }); symlinkSync(join(dir, "elsewhere"), paths.secret); put(join(dir, "elsewhere"), `${SECRET}\n`); },
  ]) {
    setup();
    assertRefusal(await post("/v1/messages", { max_tokens: 1 }), 401, "relay_no_token");
    rmSync(paths.secret, { force: true });
  }
  assert.equal(provider.seen.length, 0);
});

// ---- mode, key, pick -------------------------------------------------------------
test("an agent token in plans mode → relay_off; a test token in plans mode is forwarded", async () => {
  setState("plans");
  assertRefusal(await post("/v1/messages", { max_tokens: 1 }), 403, "relay_off");
  assert.equal(provider.seen.length, 0);
  const r = await post("/v1/responses", { input: "hi" }, jsonAuth(testToken("checker")));
  assert.equal(r.status, 200);
  assert.equal(modelCalls().length, 1);
  assert.equal(JSON.parse(modelCalls()[0].body).model, "claude-gpt-6-1-sol");
});

test("no state file → plans mode: agents are turned away, a test token works", async () => {
  rmSync(paths.state);
  assertRefusal(await post("/v1/messages", {}), 403, "relay_off");
  // With no file there are no picks either, so the test token has none.
  assertRefusal(await post("/v1/messages", {}, jsonAuth(testToken("builder"))), 403, "relay_no_pick");
  assert.equal(provider.seen.length, 0);
});

test("an untrusted, broken or unknown-mode state.json → relay_off for every token", async () => {
  const good = JSON.stringify({ mode: "provider", picks: { builder: { model: "claude-fable-5-1" } } });
  for (const setup of [
    () => put(paths.state, good, 0o660),
    () => put(paths.state, good, 0o606),
    () => { rmSync(paths.state, { force: true }); put(join(dir, "other.json"), good); symlinkSync(join(dir, "other.json"), paths.state); },
    () => put(paths.state, "{not json"),
    () => put(paths.state, "[1,2]"),
    () => put(paths.state, JSON.stringify({ mode: "on", picks: {} })),
    () => put(paths.state, `{"mode":"provider","pad":"${"x".repeat(MB)}"}`),
  ]) {
    setup();
    assertRefusal(await post("/v1/messages", {}), 403, "relay_off");
    assertRefusal(await post("/v1/messages", {}, jsonAuth(testToken("builder"))), 403, "relay_off");
    rmSync(paths.state, { force: true });
  }
  assert.equal(provider.seen.length, 0);
});

test("no key file, or an untrusted or malformed one → relay_no_key", async () => {
  for (const setup of [
    () => rmSync(paths.key),
    () => put(paths.key, `${KEY}\n`, 0o664),
    () => put(paths.key, "short\n"),
    () => put(paths.key, `${KEY}\n${KEY}\n`),
  ]) {
    setup();
    assertRefusal(await post("/v1/messages", {}), 403, "relay_no_key");
  }
  assert.equal(provider.seen.length, 0);
});

test("a key removed between two calls refuses the second", async () => {
  assert.equal((await post("/v1/messages", { max_tokens: 1 })).status, 200);
  rmSync(paths.key);
  assertRefusal(await post("/v1/messages", { max_tokens: 1 }), 403, "relay_no_key");
  assert.equal(modelCalls().length, 1);
});

test("an unknown agent, an agent with no pick, or untrusted ids.json → relay_no_pick", async () => {
  assertRefusal(await post("/v1/messages", {}, jsonAuth(agentToken(STRANGER))), 403, "relay_no_pick");
  assertRefusal(await post("/v1/messages", {}, jsonAuth(agentToken(SALES))), 403, "relay_no_pick");
  assertRefusal(await post("/v1/messages", {}, jsonAuth(testToken("sales"))), 403, "relay_no_pick");
  assertRefusal(await post("/v1/messages", {}, jsonAuth(testToken("nobody"))), 403, "relay_no_pick");
  put(paths.ids, JSON.stringify({ agents: { builder: BUILDER } }), 0o666);
  assertRefusal(await post("/v1/messages", {}), 403, "relay_no_pick");
  // One id under two slugs is ambiguous: refused.
  put(paths.ids, JSON.stringify({ agents: { builder: BUILDER, checker: BUILDER } }));
  assertRefusal(await post("/v1/messages", {}), 403, "relay_no_pick");
  rmSync(paths.ids);
  assertRefusal(await post("/v1/messages", {}), 403, "relay_no_pick");
  assert.equal(provider.seen.length, 0);
});

// ---- what changes in a request -----------------------------------------------------
test("the model is forced to the pick on all three paths: another model, an alias, or none", async () => {
  for (const path of ["/v1/messages", "/v1/messages/count_tokens", "/v1/responses"]) {
    for (const asked of ["claude-quantum-lite-1", "sonnet", "claude-haiku-4-5", undefined, null, 7, { id: "x" }]) {
      provider.seen.length = 0;
      const body = { max_tokens: 1, messages: [{ role: "user", content: "hi" }] };
      if (asked !== undefined) body.model = asked;
      const r = await post(path, body);
      assert.equal(r.status, 200, `${path} ${asked}`);
      const sent = JSON.parse(modelCalls()[0].body);
      assert.equal(sent.model, "claude-fable-5-1", `${path} ${JSON.stringify(asked)}`);
      assert.deepEqual(sent.messages, body.messages);
    }
  }
  // A body with the model twice: the parser keeps one, and the pick replaces it.
  provider.seen.length = 0;
  await request("POST", "/v1/messages", { headers: jsonAuth(), body: '{"model":"claude-fable-5-1","max_tokens":1,"model":"claude-omega-ultra"}' });
  assert.equal(modelCalls()[0].body.match(/"model"/g).length, 1);
  assert.equal(JSON.parse(modelCalls()[0].body).model, "claude-fable-5-1");
  // The Checker's own token lands on its own pick.
  provider.seen.length = 0;
  await post("/v1/responses", { model: "claude-fable-5-1", input: "hi" }, jsonAuth(agentToken(CHECKER)));
  assert.equal(JSON.parse(modelCalls()[0].body).model, "claude-gpt-6-1-sol");
});

test("an agent's credential headers never reach the upstream; the real key arrives once, in the right header", async () => {
  const hostile = {
    Authorization: `Bearer ${agentToken()}`, "Content-Type": "application/json",
    "X-Api-Key": "agent-chosen-key", Cookie: "session=agent", "Proxy-Authorization": "Basic YWdlbnQ=",
    "ChatGPT-Account-Id": "acct-agent", "X-Goog-Api-Key": "goog-agent", "X-Auth-Token": "tok-agent",
    "X-Access-Token": "acc-agent", "X-Client-Secret": "sec-agent", Apikey: "plain-agent",
  };
  for (const [path, keyHeader] of [["/v1/messages", "x-api-key"], ["/v1/messages/count_tokens", "x-api-key"], ["/v1/responses", "authorization"]]) {
    provider.seen.length = 0;
    const r = await request("POST", path, { headers: hostile, body: JSON.stringify({ model: "x", input: "hi" }) });
    assert.equal(r.status, 200);
    const h = modelCalls()[0].rawHeaders;
    const names = [];
    for (let i = 0; i < h.length; i += 2) names.push(h[i].toLowerCase());
    for (const gone of ["cookie", "proxy-authorization", "chatgpt-account-id", "x-goog-api-key", "x-auth-token", "x-access-token", "x-client-secret", "apikey"]) {
      assert.ok(!names.includes(gone), `${gone} reached the upstream on ${path}`);
    }
    const flat = h.join("\n");
    for (const v of ["agent-chosen-key", "session=agent", "acct-agent", "goog-agent", "tok-agent", "acc-agent", "sec-agent", "plain-agent", agentToken().slice(0, 20)]) {
      assert.ok(!flat.includes(v), `${v} reached the upstream`);
    }
    const expected = keyHeader === "x-api-key" ? [KEY] : [`Bearer ${KEY}`];
    assert.deepEqual(header(h, keyHeader), expected, path);
    assert.deepEqual(header(h, keyHeader === "x-api-key" ? "authorization" : "x-api-key"), [], path);
    assert.equal(flat.split(KEY).length - 1, 1, "the key appears exactly once");
    assert.deepEqual(header(h, "host"), [`127.0.0.1:${provider.port}`]);
  }
});

test("anthropic-version, anthropic-beta, user-agent, x-stainless-lang and ?beta=true pass as sent", async () => {
  const r = await request("POST", "/v1/messages?beta=true", {
    headers: {
      ...jsonAuth(), "anthropic-version": "2023-06-01", "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained",
      "User-Agent": "claude-cli/9.9.9 (external, cli)", "x-stainless-lang": "js", "Accept-Encoding": "gzip, br", Connection: "keep-alive",
    },
    body: JSON.stringify({ model: "x", max_tokens: 1, thinking: { type: "adaptive" }, cache_control: { type: "ephemeral" }, metadata: { user_id: "u" } }),
  });
  assert.equal(r.status, 200);
  const seen = modelCalls()[0];
  assert.equal(seen.path, "/v1/messages?beta=true");
  assert.deepEqual(header(seen.rawHeaders, "anthropic-version"), ["2023-06-01"]);
  assert.deepEqual(header(seen.rawHeaders, "anthropic-beta"), ["interleaved-thinking-2025-05-14,fine-grained"]);
  assert.deepEqual(header(seen.rawHeaders, "user-agent"), ["claude-cli/9.9.9 (external, cli)"]);
  assert.deepEqual(header(seen.rawHeaders, "x-stainless-lang"), ["js"]);
  // The one request header the relay sets besides the key: an uncompressed answer, so it can be scanned.
  assert.deepEqual(header(seen.rawHeaders, "accept-encoding"), ["identity"]);
  assert.deepEqual(header(seen.rawHeaders, "content-length"), [String(Buffer.byteLength(seen.body))]);
  const body = JSON.parse(seen.body);
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
  assert.deepEqual(body.metadata, { user_id: "u" });
});

// ---- what changes in an answer: nothing -------------------------------------------
test("a stream passes byte for byte, and its first chunk arrives before the last is sent", async () => {
  provider.behaviour.eventDelayMs = 120;
  const body = { model: "claude-fable-5-1", max_tokens: 5, stream: true };
  // The stand-in's own bytes for the same call, asked directly.
  const direct = await request("POST", "/v1/messages", { port: provider.port, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const arrivals = [];
  const viaRelay = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/messages", headers: jsonAuth(), agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => { arrivals.push(Date.now()); chunks.push(c); });
      res.on("end", () => resolve({ res, buf: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(JSON.stringify({ ...body, model: "sonnet" }));
  });
  assert.equal(viaRelay.res.statusCode, 200);
  assert.match(viaRelay.res.headers["content-type"], /^text\/event-stream/);
  assert.ok(viaRelay.buf.equals(direct.buf), "the stream's bytes are the stand-in's bytes");
  assert.ok(viaRelay.buf.toString().includes("event: ping"), "ping events are kept");
  assert.ok(arrivals.length >= 4, `chunks arrive one by one (${arrivals.length})`);
  assert.ok(arrivals[arrivals.length - 1] - arrivals[0] >= 500, "the first chunk came well before the last");
});

test("400, 401, 429, 500 and 529 bodies pass untouched, and the status file says refused or limited", async () => {
  for (const [code, state] of [[400, "ok"], [401, "refused"], [403, "refused"], [429, "limited"], [500, "limited"], [529, "limited"]]) {
    if (code === 400) {
      provider.behaviour.status = undefined;
      await post("/v1/messages", {}); // provider state back to ok
    }
    provider.behaviour.status = code;
    provider.behaviour.retryAfter = "37";
    const direct = await request("POST", "/v1/messages", { port: provider.port, headers: { "Content-Type": "application/json" }, body: "{}" });
    const r = await post("/v1/messages", { max_tokens: 1 });
    assert.equal(r.status, code);
    assert.ok(r.buf.equals(direct.buf), `${code} body untouched`);
    assert.equal(r.headers["content-type"], direct.headers["content-type"]);
    await settle();
    const st = readStatus();
    // 400, 500 and 529 do not change what is known about the key: the state stays as it was.
    assert.equal(st.provider.state, state, `after ${code}`);
    if (code === 429) {
      assert.equal(r.headers["retry-after"], "37");
      assert.equal(st.provider.retryAfterSec, 37);
    }
  }
  assert.equal(readStatus().agents.builder.lastStatus, 529);
});

test("a 302 is passed back untouched and the address it names sees nothing", async () => {
  let hits = 0;
  const elsewhere = http.createServer((_q, s) => { hits += 1; s.end("no"); });
  elsewhere.on("connection", () => { hits += 1; });
  await new Promise((r) => elsewhere.listen(0, "127.0.0.1", r));
  provider.behaviour.status = 302;
  provider.behaviour.location = `http://127.0.0.1:${elsewhere.address().port}/v1/messages`;
  const r = await post("/v1/messages", {});
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, provider.behaviour.location);
  await settle(200);
  assert.equal(hits, 0);
  assert.equal(modelCalls().length, 1);
  await new Promise((r2) => elsewhere.close(r2));
});

test("upstream down → relay_upstream_down after one attempt only, and the status says unreachable", async () => {
  let connections = 0;
  const dropper = net.createServer((s) => { connections += 1; s.destroy(); });
  await new Promise((r) => dropper.listen(0, "127.0.0.1", r));
  const lone = makeRelay({ upstream: `http://127.0.0.1:${dropper.address().port}` });
  const lonePort = await lone.listen();
  const r = await request("POST", "/v1/messages", { port: lonePort, headers: jsonAuth(), body: "{}" });
  assertRefusal(r, 502, "relay_upstream_down");
  await settle(300);
  assert.equal(connections, 1, "no retry");
  await lone.close();
  assert.equal(readStatus().provider.state, "unreachable");
  await new Promise((r2) => dropper.close(r2));
  // A closed port too.
  const closed = makeRelay({ upstream: `http://127.0.0.1:${dropper.address()?.port || 9}` });
  const closedPort = await closed.listen();
  assertRefusal(await request("POST", "/v1/messages", { port: closedPort, headers: jsonAuth(), body: "{}" }), 502, "relay_upstream_down");
  await closed.close();
});

test("an upstream that never answers → relay_upstream_down when the first-byte time runs out", async () => {
  provider.behaviour.hang = true;
  const slow = makeRelay({ limits: { firstByteMs: 300, statusEveryMs: 20 } });
  const slowPort = await slow.listen();
  const t0 = Date.now();
  assertRefusal(await request("POST", "/v1/responses", { port: slowPort, headers: jsonAuth(), body: "{}" }), 502, "relay_upstream_down");
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(modelCalls().length, 1);
  await slow.close();
});

// ---- paths and methods ------------------------------------------------------------
test("other paths and methods → 404 relay_not_found, before any token check", async () => {
  const cases = [
    ["GET", "/v1/models"], ["GET", "/v1/messages"], ["PUT", "/v1/messages"], ["DELETE", "/v1/responses"],
    ["POST", "/v1/chat/completions"], ["POST", "/api/v1/chat/completions"], ["POST", "/api/v1/responses"],
    ["POST", "/v1/messages/../x"], ["POST", "/v1/messages/../messages"], ["POST", "//v1/messages"], ["POST", "/v1/messages%2f"],
    ["POST", "/v1/Messages"], ["POST", "/v1/messages/"], ["POST", "/v1/usage"], ["POST", "/v1/billing"], ["GET", "/relay/health/"],
    ["POST", "/relay/health"], ["POST", "/v1/messages?beta=true&x=%2e%2e"], ["POST", `/v1/messages?${"a".repeat(201)}`],
    ["POST", "/v1/messages?a=b#frag"], ["POST", "/v1/messages?a=b/c"],
  ];
  for (const [method, path] of cases) {
    const r = await request(method, path, { headers: jsonAuth(), body: method === "GET" ? undefined : "{}" });
    assertRefusal(r, 404, "relay_not_found");
  }
  const absolute = await raw(`POST http://127.0.0.1:${port}/v1/messages HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${agentToken()}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}`);
  assert.equal(statusOf(absolute), 404);
  assert.match(absolute, /relay_not_found/);
  assert.equal(provider.seen.length, 0);
});

test("CONNECT → 400 and an upgrade → 403 relay_refused, and nothing is forwarded", async () => {
  const connect = await raw(`CONNECT api.omegaplusapi.com:443 HTTP/1.1\r\nHost: api.omegaplusapi.com:443\r\nAuthorization: Bearer ${agentToken()}\r\n\r\n`);
  assert.equal(statusOf(connect), 400);
  assert.match(connect, /relay_refused/);
  const upgrade = await raw(`GET /v1/responses HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nAuthorization: Bearer ${agentToken()}\r\n\r\n`);
  assert.equal(statusOf(upgrade), 403);
  assert.match(upgrade, /relay_refused/);
  const half = await request("POST", "/v1/messages", { headers: { ...jsonAuth(), Upgrade: "h2c" }, body: "{}" });
  assertRefusal(half, 403, "relay_refused");
  assert.equal(provider.seen.length, 0);
});

// ---- body rules ---------------------------------------------------------------
test("a body that is not JSON, not one object, or has the wrong content type → relay_bad_body", async () => {
  for (const [type, body] of [
    ["application/json", "{not json"], ["application/json", "[1,2]"], ["application/json", "null"], ["application/json", '"text"'],
    ["application/json", ""], ["text/plain", "{}"], ["application/x-www-form-urlencoded", "{}"], ["application/jsonp", "{}"], [null, "{}"],
  ]) {
    const headers = { ...auth() };
    if (type) headers["Content-Type"] = type;
    assertRefusal(await request("POST", "/v1/messages", { headers, body }), 400, "relay_bad_body");
  }
  const twoTypes = await raw(`POST /v1/messages HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${agentToken()}\r\nContent-Type: application/json\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\n{}`);
  assert.equal(statusOf(twoTypes), 400);
  assert.match(twoTypes, /relay_bad_body/);
  assert.equal(provider.seen.length, 0);
  assert.equal((await request("POST", "/v1/messages", { headers: { ...auth(), "Content-Type": "application/json; charset=utf-8" }, body: "{}" })).status, 200);
});

test("a body over 32 MB, declared or streamed → 413 relay_too_big", async () => {
  const declared = await raw(`POST /v1/messages HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${agentToken()}\r\nContent-Type: application/json\r\nContent-Length: ${32 * MB + 1}\r\n\r\n{`);
  assert.equal(statusOf(declared), 413);
  assert.match(declared, /relay_too_big/);
  const streamed = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/messages", headers: { ...jsonAuth(), "Transfer-Encoding": "chunked" }, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.on("error", () => resolve({ status: "reset" }));
    const piece = Buffer.alloc(MB, 0x20);
    req.write("{\"pad\":\"");
    for (let i = 0; i < 33; i += 1) req.write(piece);
    req.end("\"}");
  });
  assert.equal(streamed.status, 413);
  assert.match(streamed.text, /relay_too_big/);
  assert.equal(provider.seen.length, 0);
});

// ---- counts and the status file -----------------------------------------------------
test("tokens are counted from a JSON answer and from a stream; a compressed answer counts the request only", async () => {
  const fresh = makeRelay();
  const p = await fresh.listen();
  const call = (path, body, token) => request("POST", path, { port: p, headers: jsonAuth(token), body: JSON.stringify(body) });
  assert.equal((await call("/v1/messages", { max_tokens: 1 })).status, 200);
  assert.equal((await call("/v1/messages", { max_tokens: 1, stream: true })).status, 200);
  assert.equal((await call("/v1/responses", { input: "hi", stream: true }, agentToken(CHECKER))).status, 200);
  provider.behaviour.gzip = true;
  const gz = await call("/v1/messages", { max_tokens: 1 });
  assert.equal(gz.headers["content-encoding"], "gzip");
  // An owner's test call is not counted as the agent's work.
  provider.behaviour.gzip = false;
  await call("/v1/messages", { max_tokens: 1 }, testToken("builder"));
  await fresh.close();
  const st = readStatus();
  assert.ok(st.startedAt);
  assert.deepEqual({ ...st.agents.builder, lastAt: null }, {
    requests: 3, inputTokens: 2 * STUB_USAGE.input, outputTokens: 2 * STUB_USAGE.output, lastStatus: 200, lastAt: null,
  });
  assert.deepEqual({ ...st.agents.checker, lastAt: null }, {
    requests: 1, inputTokens: STUB_USAGE.input, outputTokens: STUB_USAGE.output, lastStatus: 200, lastAt: null,
  });
  assert.equal(st.provider.state, "ok");
  assert.equal(statSync(paths.status).mode & 0o777, 0o600);
});

test("the status file is written by temp file and rename, and replaces a planted link instead of following it", async () => {
  const target = join(dir, "planted-target");
  put(target, "keep me");
  rmSync(paths.status, { force: true });
  symlinkSync(target, paths.status);
  const r = makeRelay();
  await r.listen();
  await r.close();
  assert.equal(readFileSync(target, "utf8"), "keep me");
  assert.ok(statSync(paths.status).isFile());
  assert.ok(readStatus().startedAt);
  assert.deepEqual(readdirSync(join(dir, "models")).filter((f) => f.endsWith(".tmp")), [], "no temp file left");
});

// ---- the log --------------------------------------------------------------------------
test("no log line holds the key, a token, a header, a query string or a marker from a body", async () => {
  const token = agentToken();
  await request("POST", "/v1/messages?beta=true", { headers: { ...jsonAuth(token), "X-Api-Key": "agent-key-123", "x-trace": MARKER }, body: JSON.stringify({ messages: [{ role: "user", content: MARKER }] }) });
  await request("POST", "/v1/messages", { headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" }, body: MARKER });
  await request("POST", "/v1/messages", { headers: { Authorization: `Bearer ${token}x`, "Content-Type": "application/json" }, body: MARKER });
  await request("POST", `/v1/nope?${MARKER}`, { headers: jsonAuth(token), body: MARKER });
  provider.behaviour.status = 401;
  await post("/v1/responses", { input: MARKER }, jsonAuth(token));
  const all = lines.join("\n");
  for (const bad of [KEY, token, token.split(".")[4], SECRET, MARKER, "agent-key-123", "beta=true", "Bearer"]) {
    assert.ok(!all.includes(bad), `the log holds ${bad.slice(0, 12)}`);
  }
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z call builder \/v1\/messages 200 \d+ms model=claude-fable-5-1$/);
  assert.match(lines[1], / refused relay_bad_body$/);
  assert.match(lines[2], / refused relay_no_token$/);
  assert.match(lines[3], / refused relay_not_found$/);
  assert.match(lines[4], / call builder \/v1\/responses 401 \d+ms model=claude-fable-5-1$/);
  assert.equal(lines.length, 5);
});

// ---- construction ----------------------------------------------------------------------
test("createRelay throws on any other upstream, and without every path", () => {
  for (const upstream of [undefined, "", "https://evil.test", "http://api.omegaplusapi.com", "https://api.omegaplusapi.com/",
    "http://localhost:4567", "http://10.0.0.1:80", "https://127.0.0.1:443"]) {
    assert.throws(() => createRelay({ listenPort: 0, upstream, paths }), /upstream must be/, String(upstream));
  }
  assert.doesNotThrow(() => createRelay({ listenPort: 0, upstream: "https://api.omegaplusapi.com", paths }));
  assert.throws(() => createRelay({ listenPort: 0, upstream: provider.url, paths: { ...paths, key: undefined } }), /paths\.key/);
});

test("a stream that goes quiet longer than the idle time is ended on both sides", async () => {
  provider.behaviour.eventDelayMs = 400;
  const quiet = makeRelay({ limits: { idleMs: 150, statusEveryMs: 20 } });
  const quietPort = await quiet.listen();
  const t0 = Date.now();
  const outcome = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: quietPort, method: "POST", path: "/v1/messages", headers: jsonAuth(), agent: false }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve("end"));
      res.on("error", () => resolve("cut"));
      res.on("aborted", () => resolve("cut"));
    });
    req.on("error", () => resolve("cut"));
    req.end(JSON.stringify({ stream: true }));
  });
  assert.equal(outcome, "cut");
  assert.ok(Date.now() - t0 < 2500, "cut long before the stream would have ended");
  await quiet.close();
});

// ---- what the final review found -------------------------------------------------------
// A stand-in that answers each connection with the next raw answer of `answers`.
async function rawUpstream(answers) {
  let n = 0;
  const socks = new Set();
  const server = net.createServer((sock) => {
    socks.add(sock);
    const answer = answers[Math.min(n, answers.length - 1)];
    n += 1;
    sock.on("error", () => {});
    sock.once("data", () => { if (answer !== null) sock.write(answer); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, count: () => n, close: () => new Promise((r) => { for (const k of socks) k.destroy(); server.close(r); }) };
}
const GOOD_ANSWER = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}';

test("a malformed status line or reason text from the provider → 502, and the relay keeps serving", async () => {
  for (const bad of [
    "HTTP/1.1 099 Weird\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    "HTTP/1.1 000 Zero\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
    "HTTP/1.1 200 O\x01K\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
  ]) {
    const stub = await rawUpstream([bad, GOOD_ANSWER]);
    const r1 = makeRelay({ upstream: stub.url });
    const p = await r1.listen();
    lines = [];
    assertRefusal(await request("POST", "/v1/messages", { port: p, headers: jsonAuth(), body: "{}" }), 502, "relay_upstream_down");
    const again = await request("POST", "/v1/messages", { port: p, headers: jsonAuth(), body: "{}" });
    assert.equal(again.status, 200, "a normal call afterwards still works");
    assert.equal(again.text, "{}");
    assert.match(lines[0], / refused relay_upstream_down$/);
    await r1.close();
    await stub.close();
  }
});

test("a 101 answer from the provider → 502 relay_upstream_down at once, with a log line", async () => {
  const stub = await rawUpstream(["HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", GOOD_ANSWER]);
  const r1 = makeRelay({ upstream: stub.url });
  const p = await r1.listen();
  lines = [];
  const t0 = Date.now();
  assertRefusal(await request("POST", "/v1/responses", { port: p, headers: jsonAuth(), body: "{}" }), 502, "relay_upstream_down");
  assert.ok(Date.now() - t0 < 2000, "not left hanging");
  assert.deepEqual(lines.map((l) => l.replace(/^\S+ /, "")), ["refused relay_upstream_down"]);
  assert.equal((await request("POST", "/v1/responses", { port: p, headers: jsonAuth(), body: "{}" })).status, 200);
  await r1.close();
  await stub.close();
});

test("an upstream that accepts the call and says nothing is ended by the first-byte timer", async () => {
  const stub = await rawUpstream([null]);
  const r1 = makeRelay({ upstream: stub.url, limits: { firstByteMs: 250, statusEveryMs: 20 } });
  const p = await r1.listen();
  const t0 = Date.now();
  assertRefusal(await request("POST", "/v1/messages", { port: p, headers: jsonAuth(), body: "{}" }), 502, "relay_upstream_down");
  assert.ok(Date.now() - t0 < 2000);
  await r1.close();
  await stub.close();
});

// Sends the head, waits, runs `between`, then sends the body.
function headThenBody(token, between) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ max_tokens: 1 });
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/messages", agent: false,
      headers: { ...jsonAuth(token), "Content-Length": Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on("error", reject);
    req.flushHeaders();
    setTimeout(() => { between(); req.end(body); }, 200);
  });
}

test("switched off and the key removed between the head and the body → nothing reaches the upstream", async () => {
  const r = await headThenBody(agentToken(), () => { setState("plans"); rmSync(paths.key); });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "relay_off");
  assert.equal(provider.seen.length, 0);
});

test("the key removed between the head and the body of a test call → relay_no_key, nothing sent", async () => {
  const r = await headThenBody(testToken("builder"), () => rmSync(paths.key));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "relay_no_key");
  assert.equal(provider.seen.length, 0);
});

test("a pick changed while the body arrives: the new pick is sent and logged", async () => {
  const r = await headThenBody(agentToken(), () => setState("provider", { ...PICKS, builder: "claude-opus-5-5" }));
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(modelCalls()[0].body).model, "claude-opus-5-5");
  assert.match(lines.at(-1), / model=claude-opus-5-5$/);
});

test("the logged model is always the model in the body the upstream received", async () => {
  for (const [path, token] of [["/v1/messages", agentToken()], ["/v1/messages/count_tokens", agentToken()],
    ["/v1/responses", agentToken(CHECKER)], ["/v1/messages", testToken("checker")]]) {
    for (const asked of ["claude-quantum-lite-1", "sonnet", undefined]) {
      provider.seen.length = 0;
      lines = [];
      await post(path, asked === undefined ? { max_tokens: 1 } : { model: asked, max_tokens: 1 }, jsonAuth(token));
      const sent = JSON.parse(modelCalls()[0].body).model;
      const logged = lines.at(-1).match(/ model=(\S+)$/)[1];
      assert.equal(logged, sent, `${path} ${asked}`);
      assert.notEqual(logged, asked);
    }
  }
});

// Sends a call and returns every byte the caller received (head and body), until the relay closes.
const rawCall = (path = "/v1/messages", token = agentToken()) => {
  const body = JSON.stringify({ max_tokens: 1, stream: true });
  return raw(`POST ${path} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
};

test("the key in a 401 body, a 200 body or an answer header → withheld whole: 502 relay_key_in_answer", async () => {
  for (const where of ["body401", "body200", "header"]) {
    provider.behaviour.echoKey = where;
    lines = [];
    const got = await rawCall();
    assert.equal(modelCalls().length > 0, true);
    assert.ok(!got.includes(KEY), `the key reached the caller (${where})`);
    assert.ok(!got.includes(KEY.slice(0, 20)), `part of the key reached the caller (${where})`);
    assert.equal(statusOf(got), 502, where);
    assert.match(got, /relay_key_in_answer/);
    assert.match(got, /The provider's answer was withheld because it held the provider key\./);
    assert.deepEqual(lines.map((l) => l.replace(/^\S+ /, "")), ["refused relay_key_in_answer"]);
  }
});

test("the key in the middle of a stream, or split across two chunks → the stream is cut before it", async () => {
  for (const where of ["stream", "split"]) {
    provider.behaviour.echoKey = where;
    lines = [];
    const got = await rawCall();
    assert.equal(statusOf(got), 200, where);
    assert.match(got, /first part, no secret here/, "what came before the key passed");
    assert.ok(!got.includes(KEY), `the key reached the caller (${where})`);
    assert.ok(!got.includes(KEY.slice(Math.floor(KEY.length / 2))), `the key's second half reached the caller (${where})`);
    assert.ok(!got.includes("after"), "nothing after the key is passed");
    assert.deepEqual(lines.map((l) => l.replace(/^\S+ /, "")), ["refused relay_key_in_answer"]);
  }
});
