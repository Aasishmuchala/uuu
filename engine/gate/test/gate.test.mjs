// The gate against a local echo server standing in for the board.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGate } from "../gate.mjs";
import { normalisePath } from "../rules.mjs";
import { PROOF, READS, ALLOWED, GOOD_BODIES, NOT_NEEDED, HOSTILE, SAME_ROUTE } from "./vectors.mjs";

const TOKEN = "pcp_testtoken_abcdefghijklmnop";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const JSON_AUTH = { ...AUTH, "Content-Type": "application/json" };

// ---- the echo board ------------------------------------------------------
let board;
let boardPort;
const seen = [];       // every request the board received: { method, url, rawHeaders, sha, size }
let boardSockets = 0;  // connections ever opened to the board
let upgradesSeen = 0;

function startEchoBoard() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const sha = createHash("sha256").update(body).digest("hex");
        seen.push({ method: req.method, url: req.url, rawHeaders: req.rawHeaders, sha, size: body.length });
        if (req.url === "/api/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"status":"ok"}');
          return;
        }
        if (req.url === "/stream") {
          res.writeHead(200, { "Content-Type": "text/event-stream", "X-Board": "yes" });
          let n = 0;
          const tick = () => {
            n += 1;
            res.write(`data: chunk${n} ${Date.now()}\n\n`);
            if (n < 3) setTimeout(tick, 200);
            else res.end();
          };
          tick();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", "X-Board": "yes", "Set-Cookie": ["a=1", "b=2"] });
        res.end(JSON.stringify({ method: req.method, url: req.url, sha, size: body.length }));
      });
    });
    s.on("connection", () => { boardSockets += 1; });
    s.on("upgrade", (_req, socket) => { upgradesSeen += 1; socket.destroy(); });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// ---- helpers ---------------------------------------------------------------
let gate;
let gatePort;
let logDir;
let logFile;

function request(method, path, { headers = {}, body, port = gatePort } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, rawHeaders: res.rawHeaders, text, json });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Writes raw bytes and collects everything until the gate closes the socket (or 1.5 s).
function raw(text, port = gatePort) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    const chunks = [];
    let closed = false;
    const done = () => resolve({ text: Buffer.concat(chunks).toString("utf8"), closed });
    const timer = setTimeout(() => { sock.destroy(); done(); }, 1500);
    sock.on("data", (c) => chunks.push(c));
    sock.on("close", () => { closed = true; clearTimeout(timer); done(); });
    sock.on("error", () => {});
    sock.write(text);
  });
}

const statusOf = (rawText) => Number((rawText.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]);
const logLines = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean) : []);
const forwardedPaths = () => seen.filter((r) => r.url !== "/api/health").map((r) => r.url);

before(async () => {
  board = await startEchoBoard();
  boardPort = board.address().port;
  logDir = mkdtempSync(join(tmpdir(), "gate-test-"));
  logFile = join(logDir, "logs", "gate-refusals.log");
  gate = createGate({ listenPort: 0, boardPort, refusalLog: logFile });
  gatePort = await gate.listen();
});

after(async () => {
  await gate.close();
  board.closeAllConnections();
  await new Promise((r) => board.close(r));
  rmSync(logDir, { recursive: true, force: true });
});

beforeEach(() => {
  seen.length = 0;
  rmSync(logFile, { force: true });
});

// ---- 1. health ---------------------------------------------------------------
test("GET /gate/health answers itself and reports the board up", async () => {
  const r = await request("GET", "/gate/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: "ok", part: "gate", board: "up" });
  assert.deepEqual(forwardedPaths(), []);
  // The only board call is the token-free health check.
  assert.ok(seen.every((s) => s.url === "/api/health" && !s.rawHeaders.some((h) => /^authorization$/i.test(h))));
});

// ---- 3. token check ---------------------------------------------------------
test("no Authorization header → 401 gate_no_token", async () => {
  const r = await request("GET", "/api/health");
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { error: "The gate needs an agent token.", code: "gate_no_token" });
  assert.equal(seen.length, 0);
});

test("odd Authorization headers → 401", async () => {
  const bad = ["Basic x", "Bearer", "Bearer ", "Bearer a b", "Bearerabc", "Token abc", "Bearer\tabc", "bearer:abc"];
  for (const value of bad) {
    const r = await raw(`GET /api/agents/me HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: ${value}\r\nConnection: close\r\n\r\n`);
    assert.equal(statusOf(r.text), 401, JSON.stringify(value));
  }
  assert.equal(seen.length, 0);
});

test("two Authorization headers → 401, even when both are bearers", async () => {
  const r = await raw("GET /api/agents/me HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer a\r\n" +
    "authorization: Bearer b\r\nConnection: close\r\n\r\n");
  assert.equal(statusOf(r.text), 401);
  const r2 = await raw("GET /api/agents/me HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer a\r\n" +
    "Authorization:\r\nConnection: close\r\n\r\n");
  assert.equal(statusOf(r2.text), 401);
  assert.equal(seen.length, 0);
});

test("bearer in any letter case and with extra spaces is forwarded", async () => {
  for (const value of ["bearer abc", "BEARER abc", "Bearer   abc", "  Bearer abc  "]) {
    const r = await raw(`GET /api/agents/me HTTP/1.1\r\nHost: 127.0.0.1\r\nauthorization: ${value}\r\nConnection: close\r\n\r\n`);
    assert.equal(statusOf(r.text), 200, JSON.stringify(value));
  }
  assert.equal(forwardedPaths().length, 4);
});

// ---- 5. forwarding ------------------------------------------------------------
test("forwarded request: every header unchanged, X-Paperclip-Run-Id included", async () => {
  const headers = {
    authorization: "bearer abc",
    "X-Paperclip-Run-Id": "run-123",
    "X-Custom": "Keep Me",
    Accept: "application/json",
  };
  const r = await request("GET", "/api/agents/me?limit=5&q=%2Fx", { headers });
  assert.equal(r.status, 200);
  assert.equal(r.headers["x-board"], "yes");
  assert.deepEqual(r.headers["set-cookie"], ["a=1", "b=2"]);
  const got = seen.find((s) => s.url.startsWith("/api/agents/me"));
  assert.equal(got.url, "/api/agents/me?limit=5&q=%2Fx");
  const pairs = [];
  for (let i = 0; i < got.rawHeaders.length; i += 2) pairs.push([got.rawHeaders[i], got.rawHeaders[i + 1]]);
  for (const [k, v] of Object.entries(headers)) {
    assert.ok(pairs.some(([a, b]) => a === k && b === v), `board saw ${k}`);
  }
  assert.ok(pairs.some(([a, b]) => a === "Host" && b === `127.0.0.1:${gatePort}`), "Host unchanged");
});

test("raw path and query bytes are forwarded as sent", async () => {
  const r = await request("GET", "/API//Agents/ME/?x=/secrets&y=%2e%2e", { headers: AUTH });
  assert.equal(r.status, 200);
  assert.deepEqual(forwardedPaths(), ["/API//Agents/ME/?x=/secrets&y=%2e%2e"]);
});

test("a 1 MB body is forwarded byte-identical", async () => {
  const body = Buffer.from(JSON.stringify({ body: randomBytes(768 * 1024).toString("base64").slice(0, 1024 * 1024 - 11) }));
  assert.equal(body.length, 1024 * 1024);
  const sha = createHash("sha256").update(body).digest("hex");
  const r = await request("POST", "/api/issues/1/comments", {
    headers: { ...JSON_AUTH, "Content-Length": body.length },
    body,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.size, body.length);
  assert.equal(r.json.sha, sha);
});

test("a chunked body is forwarded byte-identical", async () => {
  const body = Buffer.from(JSON.stringify({ format: "markdown", body: randomBytes(225 * 1024).toString("base64") }));
  const sha = createHash("sha256").update(body).digest("hex");
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: gatePort, method: "PUT", path: "/api/issues/1/documents/plan",
      headers: JSON_AUTH, agent: false }, (res) => {
      const c = [];
      res.on("data", (d) => c.push(d));
      res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString())));
    });
    req.on("error", reject);
    req.write(body.subarray(0, 100000));
    setTimeout(() => { req.write(body.subarray(100000)); req.end(); }, 50);
  });
  assert.equal(r.sha, sha);
});

test("a streamed response flows unbuffered", async () => {
  const arrivals = [];
  await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: gatePort, path: "/stream", headers: AUTH, agent: false }, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream");
      res.on("data", (c) => arrivals.push({ at: Date.now(), text: c.toString() }));
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.end();
  });
  const all = arrivals.map((a) => a.text).join("");
  assert.match(all, /chunk1[\s\S]*chunk2[\s\S]*chunk3/);
  const first = arrivals.find((a) => a.text.includes("chunk1"));
  const lastSentAt = Number(all.match(/chunk3 (\d+)/)[1]);
  assert.ok(first.at < lastSentAt, "first chunk arrived before the last was sent");
});

test("must-pass requests are forwarded", async () => {
  for (const [m, p] of READS) {
    const r = await request(m, p, { headers: AUTH });
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  for (let i = 0; i < ALLOWED.length; i += 1) {
    const [m, p] = ALLOWED[i];
    const [type, body] = GOOD_BODIES[i];
    const r = await request(m, p, { headers: type ? { ...AUTH, "Content-Type": type } : AUTH, body: body || undefined });
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  assert.equal(forwardedPaths().length, READS.length + ALLOWED.length);
  assert.deepEqual(logLines(), []);
});

test("a query is never matched", async () => {
  const r = await request("GET", "/api/agents/me?x=/secrets", { headers: AUTH });
  assert.equal(r.status, 200);
  const r2 = await request("PATCH", "/api/issues/1?path=/api/agents/1", { headers: JSON_AUTH, body: "{}" });
  assert.equal(r2.status, 200);
});

// ---- 4. refusal list ---------------------------------------------------------
test("every row of the refusal table → 403 with its rule, one log line, board never contacted", async () => {
  for (const [m, p, id] of PROOF) {
    rmSync(logFile, { force: true });
    const before = boardSockets;
    const r = await request(m, p, { headers: AUTH, body: m === "GET" ? undefined : '{"x":1}' });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.deepEqual(r.json, { error: "The gate does not let agents do this.", code: "gate_refused", rule: id });
    const lines = logLines();
    assert.equal(lines.length, 1, `${m} ${p}`);
    assert.match(lines[0], new RegExp(`^\\d{4}-\\d\\d-\\d\\dT\\S+Z ${m} ${p.replace(/[/.]/g, "\\$&")} ${id}$`));
    assert.equal(boardSockets, before);
  }
  assert.deepEqual(forwardedPaths(), []);
});

test("refusal log never holds a token, header value, body or query", async () => {
  const r = await request("PATCH", "/api/agents/1?q=topsecretquery", {
    headers: { ...AUTH, "X-Paperclip-Run-Id": "run-hidden-value" },
    body: '{"runner":"topsecretbody"}',
  });
  assert.equal(r.status, 403);
  const text = readFileSync(logFile, "utf8");
  for (const s of [TOKEN, "topsecretquery", "topsecretbody", "run-hidden-value", "?"]) {
    assert.ok(!text.includes(s), `log holds ${s}`);
  }
});

test("hostile spellings of a refused path are still refused", async () => {
  const cases = [
    ["PATCH", "/API/Agents/1", 403],
    ["PATCH", "/api//agents/1/", 403],
    ["PATCH", "/api/%61gents/1", 403],
    ["PATCH", "/api%2Fagents%2F1", 403],
    ["PATCH", "/api/agents/1/", 403],
    ["PATCH", "/api/agents/1?x=1", 403],
    ["PUT", "/api/issues/1/Workspace/", 403],
    ["POST", "/BOARD/chat/stream", 403],
    ["POST", "/api/companies/co//projects", 403],
    ["PATCH", "/api/%2561gents/1", 400],
    ["GET", "/api/agents/1/../../companies", 400],
    ["PATCH", "/api/./agents/1", 400],
    ["PATCH", "/api/%2e%2e/api/agents/1", 400],
    ["PATCH", "/api%5cagents/1", 400],
    ["PATCH", "/api/agents/%0a1", 400],
    ["PATCH", "/api/agents/%ZZ", 400],
  ];
  for (const [m, p, want] of cases) {
    const r = await request(m, p, { headers: AUTH, body: "{}" });
    assert.equal(r.status, want, `${m} ${p}`);
    if (want === 400) assert.deepEqual(r.json, { error: "The gate could not read this address.", code: "gate_bad_path" });
    if (want === 403) assert.equal(r.json.code, "gate_refused");
  }
  assert.deepEqual(forwardedPaths(), []);
});

// ---- the allow-list -------------------------------------------------------------
const REFUSED = { error: "The gate does not let agents do this.", code: "gate_refused", rule: "not-allowed" };

test("writes the routine does not need → 403 not-allowed in every spelling, one log line, board never contacted", async () => {
  for (const [m, raws] of NOT_NEEDED) {
    for (const p of raws) {
      rmSync(logFile, { force: true });
      const before = boardSockets;
      const r = await request(m, p, { headers: AUTH, body: '{"x":1}' });
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.deepEqual(r.json, REFUSED, `${m} ${p}`);
      const lines = logLines();
      assert.equal(lines.length, 1, `${m} ${p}`);
      assert.ok(lines[0].endsWith(` ${m} ${normalisePath(p)} not-allowed`), lines[0]);
      assert.equal(boardSockets, before);
    }
  }
  assert.deepEqual(forwardedPaths(), []);
});

test("hostile spellings of allowed writes → 403 not-allowed; same-route spellings are forwarded as sent", async () => {
  for (const [m, p] of HOSTILE) {
    const r = await request(m, p, { headers: AUTH, body: "{}" });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.deepEqual(r.json, REFUSED, `${m} ${p}`);
  }
  assert.deepEqual(forwardedPaths(), []);
  for (const [m, p] of SAME_ROUTE) {
    const r = await request(m, p, { headers: JSON_AUTH, body: "{}" });
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  assert.deepEqual(forwardedPaths(), SAME_ROUTE.map(([, p]) => p));
});

test("tools endpoints → 403 tools-endpoint for reads and writes", async () => {
  for (const [m, p] of [["GET", "/runtime-tools/connections/search"], ["POST", "/runtime-tools/connections/request"],
    ["POST", "/mcp/runtime-tools"], ["POST", "/mcp/gateways/gw_0123456789abcdef0123456789abcdef"], ["GET", "/MCP/"],
    ["POST", "/api/mcp/connections"], ["POST", "/api/runtime-tools/connections/request"]]) {
    const r = await request(m, p, { headers: AUTH, body: m === "GET" ? undefined : "{}" });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.rule, "tools-endpoint");
  }
  assert.deepEqual(forwardedPaths(), []);
});

test("a method override cannot turn an allowed path into a write it does not allow", async () => {
  const r = await request("GET", "/api/issues/1/comments", { headers: { ...AUTH, "X-HTTP-Method-Override": "DELETE" } });
  assert.equal(r.status, 403);
  assert.equal(r.json.rule, "not-allowed");
  const r2 = await request("POST", "/api/issues/1/comments", { headers: { ...AUTH, "X-HTTP-Method-Override": "PATCH" }, body: "{}" });
  assert.equal(r2.status, 403);
  assert.equal(r2.json.rule, "not-allowed");
  assert.deepEqual(forwardedPaths(), []);
});

test("a bad path is refused before the token check", async () => {
  const r = await request("GET", "/api/%2561gents/1");
  assert.equal(r.status, 400);
});

test("a method override header cannot turn a refused write into a read", async () => {
  for (const name of ["X-HTTP-Method-Override", "X-HTTP-Method", "X-Method-Override", "x-http-method-override"]) {
    const r = await request("GET", "/api/agents/1", { headers: { ...AUTH, [name]: "PATCH" } });
    assert.equal(r.status, 403, name);
    assert.equal(r.json.rule, "agents-write");
  }
  const r2 = await request("POST", "/api/issues/1/comments", { headers: { ...JSON_AUTH, "X-HTTP-Method-Override": "GET" }, body: "{}" });
  assert.equal(r2.status, 200);
  assert.deepEqual(forwardedPaths(), ["/api/issues/1/comments"]);
});

// ---- request targets that are not origin-form -------------------------------
test("absolute-form, authority-form, * and // targets → 400, board never contacted", async () => {
  const before = boardSockets;
  const targets = [
    `PATCH http://127.0.0.1:${boardPort}/api/agents/1 HTTP/1.1`,
    `GET http://127.0.0.1:${boardPort}/api/agents/me HTTP/1.1`,
    "OPTIONS * HTTP/1.1",
    "PATCH //evil/api/agents/1 HTTP/1.1",
    "PATCH /%2F/api/agents/1 HTTP/1.1",
    "PATCH /api/agents/1#frag HTTP/1.1",
  ];
  for (const line of targets) {
    const r = await raw(`${line}\r\nHost: 127.0.0.1\r\nAuthorization: Bearer abc\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    assert.equal(statusOf(r.text), 400, line);
  }
  assert.equal(boardSockets, before);
  assert.deepEqual(forwardedPaths(), []);
});

test("CONNECT is refused outright", async () => {
  const before = boardSockets;
  const r = await raw(`CONNECT 127.0.0.1:${boardPort} HTTP/1.1\r\nHost: 127.0.0.1:${boardPort}\r\nAuthorization: Bearer abc\r\n\r\n`);
  assert.equal(statusOf(r.text), 400);
  assert.ok(r.text.includes("gate_bad_path"));
  assert.ok(r.closed);
  assert.equal(boardSockets, before);
});

// ---- upgrades ------------------------------------------------------------------
const UPGRADE = (auth) => "GET /api/companies/1/events/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\n" +
  "Upgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
  (auth ? "Authorization: Bearer abc\r\n" : "") + "\r\n";

test("every upgrade is refused, with or without a token; socket closed; board never contacted", async () => {
  for (const auth of [false, true]) {
    rmSync(logFile, { force: true });
    const before = boardSockets;
    const r = await raw(UPGRADE(auth));
    assert.equal(statusOf(r.text), 403);
    assert.ok(r.text.includes('"rule":"upgrade"'));
    assert.ok(r.closed, "socket closed");
    assert.equal(boardSockets, before);
    assert.equal(upgradesSeen, 0);
    const lines = logLines();
    assert.equal(lines.length, 1);
    assert.match(lines[0], / GET \/api\/companies\/1\/events\/ws upgrade$/);
  }
});

test("bytes sent after a refused upgrade never reach the board", async () => {
  const before = boardSockets;
  const smuggled = "PATCH /api/agents/1 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\n\r\n{}" +
    "GET /api/companies/co/secrets HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
  const r = await raw(UPGRADE(true) + smuggled);
  assert.equal(statusOf(r.text), 403);
  assert.equal((r.text.match(/HTTP\/1\.1 /g) || []).length, 1, "only one response");
  assert.ok(r.closed);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(boardSockets, before);
  assert.deepEqual(forwardedPaths(), []);
});

test("Upgrade or Connection: upgrade on a plain request is refused too", async () => {
  const before = boardSockets;
  for (const extra of ["Upgrade: h2c\r\n", "Connection: keep-alive, Upgrade\r\n", "Upgrade: websocket\r\nConnection: close\r\n"]) {
    const r = await raw(`GET /api/agents/me HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer abc\r\n${extra}\r\n`);
    assert.equal(statusOf(r.text), 403, extra);
    assert.ok(r.text.includes('"rule":"upgrade"'));
  }
  assert.equal(boardSockets, before);
});

// ---- board down --------------------------------------------------------------
test("board not answering → 502 gate_board_down, and health says down", async () => {
  const free = await new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const g = createGate({ listenPort: 0, boardPort: free, refusalLog: logFile });
  const port = await g.listen();
  try {
    const r = await request("GET", "/api/agents/me", { headers: AUTH, port });
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { error: "The board is not answering.", code: "gate_board_down" });
    const h = await request("GET", "/gate/health", { port });
    assert.equal(h.status, 200);
    assert.deepEqual(h.json, { status: "ok", part: "gate", board: "down" });
  } finally {
    await g.close();
  }
});
