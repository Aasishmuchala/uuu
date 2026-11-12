// The narrow gate (PLAN-V5 K10) against a stand-in board that knows agents, tokens and
// issues with their parents, as paperclip answers GET /api/agents/me and GET /api/issues/:id.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGate } from "../gate.mjs";
import { normalisePath } from "../rules.mjs";
import {
  narrowRoute, narrowBodyRefusal, ownership, createCache, NARROW_READS, NARROW_WRITES,
  AGENT_TTL_MS, ISSUE_TTL_MS, MAX_TOKENS,
} from "../narrow.mjs";
import { PROOF, READS, ALLOWED, GOOD_BODIES, NOT_NEEDED, HOSTILE, SAME_ROUTE } from "./vectors.mjs";

// ---- the stand-in board -------------------------------------------------------
const RESEARCHER = randomUUID();
const OTHER = randomUUID();
const tokens = new Map();   // token -> agent id
const issues = new Map();   // uuid -> { id, identifier, assigneeAgentId, parentId, title }
const seen = [];            // every request: { method, url, auth, sha, size }
let boardSockets = 0;
let meStatus = 200;         // what GET /api/agents/me answers (to stand in for a sick board)
let forcedStatus = null;    // a status every other answer takes, when set

function addIssue(identifier, assigneeAgentId, parentId = null) {
  const id = randomUUID();
  issues.set(id, { id, identifier, assigneeAgentId, parentId, title: `Task ${identifier}` });
  return issues.get(id);
}
function findIssue(raw) {
  for (const i of issues.values()) {
    if (i.id === raw.toLowerCase() || i.identifier === raw.toUpperCase()) return i;
  }
  return null;
}
function ancestorsOf(issue) {
  const out = [];
  let p = issue.parentId;
  while (p && out.length < 50) {
    const a = issues.get(p);
    if (!a) break;
    out.push({ id: a.id, identifier: a.identifier, title: a.title, assigneeAgentId: a.assigneeAgentId });
    p = a.parentId;
  }
  return out;
}
function newToken(agentId) {
  const t = `pcp_run_${randomUUID().replace(/-/g, "")}`;
  tokens.set(t, agentId);
  return t;
}

function startBoard() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const sha = createHash("sha256").update(body).digest("hex");
        const auth = req.headers.authorization ?? null;
        // The gate's own questions never carry X-Test-Client; forwarded requests keep it.
        seen.push({ method: req.method, url: req.url, auth, sha, size: body.length, fromGate: !req.headers["x-test-client"] });
        const send = (status, value) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        };
        if (req.url === "/api/health") return send(200, { status: "ok" });
        const token = auth ? auth.replace(/^bearer +/i, "") : null;
        const agentId = token ? tokens.get(token) : undefined;
        if (!agentId) return send(401, { error: "Agent authentication required" });
        if (req.method === "GET" && req.url === "/api/agents/me") {
          if (meStatus !== 200) return send(meStatus, { error: "no" });
          return send(200, { id: agentId, name: "Researcher" });
        }
        if (forcedStatus) return send(forcedStatus, { error: "forced" });
        const m = /^\/api\/issues\/([^/?]+)$/.exec(req.url);
        if (req.method === "GET" && m) {
          const issue = findIssue(m[1]);
          // Unknown to the gate's question; a forwarded read of the ordinary vectors is echoed.
          if (!issue && !req.headers["x-test-client"]) return send(404, { error: "Issue not found" });
          if (!issue) return send(200, { method: req.method, url: req.url, sha, size: body.length });
          return send(200, { ...issue, ancestors: ancestorsOf(issue) });
        }
        send(200, { method: req.method, url: req.url, sha, size: body.length });
      });
    });
    s.on("connection", () => { boardSockets += 1; });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// ---- helpers -------------------------------------------------------------------
let board;
let boardPort;
let narrow;
let narrowPort;
let ordinary;
let ordinaryPort;
let logDir;
let logFile;

function request(method, path, { headers = {}, body, port = narrowPort } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
function raw(text, port = narrowPort) {
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
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const jsonAuth = (token) => ({ ...auth(token), "Content-Type": "application/json" });
const logLines = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean) : []);
const OWNERSHIP = /^\/api\/(agents\/me|issues\/[^/?]+)$/;
const nonHealth = () => seen.filter((r) => r.url !== "/api/health");
// Requests the board saw that were not the gate's own ownership questions.
const forwarded = () => nonHealth().filter((r) => !(r.method === "GET" && OWNERSHIP.test(r.url) && r.fromGate));
const REFUSED = (rule) => ({ error: "The gate does not let agents do this.", code: "gate_refused", rule });

before(async () => {
  board = await startBoard();
  boardPort = board.address().port;
  logDir = mkdtempSync(join(tmpdir(), "narrow-gate-test-"));
  logFile = join(logDir, "logs", "gate-refusals.log");
  narrow = createGate({ listenPort: 0, boardPort, refusalLog: logFile, narrow: true });
  narrowPort = await narrow.listen();
  ordinary = createGate({ listenPort: 0, boardPort, refusalLog: logFile, narrowPort });
  ordinaryPort = await ordinary.listen();
});

after(async () => {
  await narrow.close();
  await ordinary.close();
  board.closeAllConnections();
  await new Promise((r) => board.close(r));
  rmSync(logDir, { recursive: true, force: true });
});

beforeEach(() => {
  seen.length = 0;
  meStatus = 200;
  forcedStatus = null;
  rmSync(logFile, { force: true });
});

// Every test request carries X-Test-Client, so the board can tell it from the gate's own.
function req(method, path, token, { body, type = "application/json", extra = {}, port } = {}) {
  const headers = { "X-Test-Client": "1", ...(token ? auth(token) : {}), ...extra };
  if (body !== undefined && type) headers["Content-Type"] = type;
  return request(method, path, { headers, body, port });
}

// A small world: the Researcher's task five levels deep, and another agent's task.
function world() {
  const top = addIssue(`TOP-${issues.size + 1}`, OTHER);
  const a3 = addIssue(`ANC-${issues.size + 1}`, OTHER, top.id);
  const a2 = addIssue(`ANC-${issues.size + 1}`, OTHER, a3.id);
  const a1 = addIssue(`ANC-${issues.size + 1}`, OTHER, a2.id);
  const parent = addIssue(`PAR-${issues.size + 1}`, OTHER, a1.id);
  const own = addIssue(`STH-${issues.size + 1}`, RESEARCHER, parent.id);
  const theirs = addIssue(`OTH-${issues.size + 1}`, OTHER, parent.id);
  // own -> parent (1) -> a1 (2) -> a2 (3) -> a3 (4) -> top (5)
  return { own, parent, a1, a2, a3, top, theirs, token: newToken(RESEARCHER) };
}

const ownReads = (id) => [`/api/issues/${id}`, `/api/issues/${id}/comments`, `/api/issues/${id}/comments/c1`,
  `/api/issues/${id}/heartbeat-context`];
const ownWrites = (id) => [
  ["POST", `/api/issues/${id}/checkout`, JSON.stringify({ agentId: RESEARCHER, expectedStatuses: ["todo", "in_progress"] })],
  ["POST", `/api/issues/${id}/comments`, JSON.stringify({ body: "Notes are in research/notes.md." })],
  ["PATCH", `/api/issues/${id}`, JSON.stringify({ status: "done", comment: "Done, with sources." })],
  ["POST", `/api/issues/${id}/release`, ""],
];

// ---- health ---------------------------------------------------------------------
test("narrow health says narrow; the ordinary health names the narrow port only when given", async () => {
  const n = await request("GET", "/gate/health");
  assert.equal(n.status, 200);
  assert.deepEqual(n.json, { status: "ok", part: "gate", narrow: true, board: "up" });
  assert.match(n.text, /"part":"gate","narrow":true/);
  const o = await request("GET", "/gate/health", { port: ordinaryPort });
  assert.deepEqual(o.json, { status: "ok", part: "gate", board: "up", narrowPort });
  assert.match(o.text, new RegExp(`"narrowPort":${narrowPort}`));
  assert.deepEqual(nonHealth(), []);
});

// ---- what passes ------------------------------------------------------------------
test("each allowed read and write passes for the caller's own issue, by id and by identifier", async () => {
  const w = world();
  for (const id of [w.own.id, w.own.identifier, w.own.identifier.toLowerCase()]) {
    for (const p of ["/api/agents/me", "/api/agents/me/inbox-lite", ...ownReads(id)]) {
      const r = await req("GET", p, w.token);
      assert.equal(r.status, 200, p);
    }
    for (const [m, p, body] of ownWrites(id)) {
      const r = await req(m, p, w.token, { body, type: body ? "application/json" : null });
      assert.equal(r.status, 200, `${m} ${p}`);
      assert.equal(r.json.sha, createHash("sha256").update(body).digest("hex"), `${m} ${p} byte-identical`);
    }
  }
  assert.deepEqual(logLines(), []);
  // The token went to the board as sent, and the agent's own requests all arrived.
  assert.ok(seen.every((s) => s.url === "/api/health" || s.auth === `Bearer ${w.token}`));
  assert.equal(forwarded().length, 3 * (6 + 4));
});

test("the ownership questions are asked once and then remembered", async () => {
  const w = world();
  for (let i = 0; i < 3; i += 1) await req("GET", `/api/issues/${w.own.id}/comments`, w.token);
  const questions = nonHealth().filter((s) => s.fromGate);
  assert.deepEqual(questions.map((s) => s.url), ["/api/agents/me", `/api/issues/${w.own.id}`]);
});

test("an ancestor four steps up passes once the caller has read its own task; five steps does not", async () => {
  const w = world();
  // Before the caller touches its own task, its ancestors are not known to be its own.
  const early = await req("GET", `/api/issues/${w.parent.id}`, w.token);
  assert.equal(early.status, 403);
  assert.deepEqual(early.json, REFUSED("narrow-not-yours"));
  assert.equal((await req("GET", `/api/issues/${w.own.identifier}/heartbeat-context`, w.token)).status, 200);
  for (const a of [w.parent, w.a1, w.a2, w.a3]) {
    for (const id of [a.id, a.identifier, a.identifier.toLowerCase()]) {
      const r = await req("GET", `/api/issues/${id}/comments`, w.token);
      assert.equal(r.status, 200, a.identifier);
    }
  }
  seen.length = 0;
  for (const p of [`/api/issues/${w.top.id}`, `/api/issues/${w.top.identifier}/comments`]) {
    const r = await req("GET", p, w.token);
    assert.equal(r.status, 403, p);
    assert.equal(r.json.rule, "narrow-not-yours");
  }
  assert.deepEqual(forwarded(), []);
});

test("a task assigned after a refusal passes at once (refusals are never remembered)", async () => {
  const w = world();
  assert.equal((await req("GET", `/api/issues/${w.theirs.id}`, w.token)).status, 403);
  w.theirs.assigneeAgentId = RESEARCHER;
  assert.equal((await req("GET", `/api/issues/${w.theirs.id}`, w.token)).status, 200);
});

// ---- another agent's work ---------------------------------------------------------
test("another agent's issue, by every narrow route → narrow-not-yours; the board sees only the two questions", async () => {
  const w = world();
  for (const id of [w.theirs.id, w.theirs.identifier, w.theirs.identifier.toLowerCase(), w.top.id]) {
    for (const p of ownReads(id)) {
      seen.length = 0;
      rmSync(logFile, { force: true });
      const r = await req("GET", p, w.token);
      assert.equal(r.status, 403, p);
      assert.deepEqual(r.json, REFUSED("narrow-not-yours"));
      assert.deepEqual(forwarded(), [], p);
      assert.ok(nonHealth().every((s) => s.method === "GET" && (s.url === "/api/agents/me" || s.url === `/api/issues/${id}`)));
      assert.ok(logLines()[0].endsWith(` GET ${normalisePath(p)} narrow-not-yours`));
    }
    for (const [m, p, body] of ownWrites(id)) {
      seen.length = 0;
      const r = await req(m, p, w.token, { body, type: body ? "application/json" : null });
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.deepEqual(r.json, REFUSED("narrow-not-yours"));
      assert.deepEqual(forwarded(), [], `${m} ${p}`);
      assert.ok(nonHealth().every((s) => s.method === "GET" && (s.url === "/api/agents/me" || s.url === `/api/issues/${id}`)));
    }
  }
  // A fresh token: exactly the two ownership questions, nothing else.
  seen.length = 0;
  const fresh = newToken(RESEARCHER);
  assert.equal((await req("GET", `/api/issues/${w.theirs.id}/comments`, fresh)).status, 403);
  assert.deepEqual(nonHealth().map((s) => `${s.method} ${s.url}`), ["GET /api/agents/me", `GET /api/issues/${w.theirs.id}`]);
});

test("an issue that does not exist, and a comment of another task under the caller's own, are refused or left to the board", async () => {
  const w = world();
  const r = await req("GET", "/api/issues/NOPE-999", w.token);
  assert.equal(r.status, 403);
  assert.equal(r.json.rule, "narrow-not-yours");
  // The board itself checks that a comment belongs to the issue in the path (paperclip:
  // comment.issueId !== id → 404); the gate forwards the read under the caller's own issue.
  assert.equal((await req("GET", `/api/issues/${w.own.id}/comments/someone-elses`, w.token)).status, 200);
});

// ---- refused before the board is asked -----------------------------------------------
test("routes outside the narrow lists, any query string, odd spellings → refused; the board sees nothing", async () => {
  const w = world();
  const own = w.own.id;
  const cases = [
    ["GET", "/api/companies/co/issues", "narrow-read"],
    ["GET", "/api/companies/co/issues?assigneeAgentId=x", "narrow-read"],
    ["GET", `/api/companies/co/issues?q=${own}`, "narrow-read"],
    ["GET", "/api/agents/me?x=1", "narrow-read"],
    ["GET", "/api/agents/me?", "narrow-read"],
    ["GET", `/api/issues/${own}?x=1`, "narrow-read"],
    ["GET", `/api/issues/${own}/comments?after=c1&order=asc`, "narrow-read"],
    ["GET", `/api/issues/${own}/documents`, "narrow-read"],
    ["GET", `/api/issues/${own}/documents/plan`, "narrow-read"],
    ["GET", `/api/issues/${own}/attachments`, "narrow-read"],
    ["GET", `/api/issues/${own}/activity`, "narrow-read"],
    ["GET", `/api/issues/${own}/interactions`, "narrow-read"],
    ["GET", `/api/issues/${own}/work-products`, "narrow-read"],
    ["GET", `/api/issues/${own}/approvals`, "narrow-read"],
    ["GET", `/api/issues/${own}/diagnostics/subtree`, "narrow-read"],
    ["GET", "/api/attachments/a1/content", "narrow-read"],
    ["GET", "/api/approvals/a1", "narrow-read"],
    ["GET", "/api/companies/co/agents", "narrow-read"],
    ["GET", "/api/companies/co/dashboard", "narrow-read"],
    ["GET", "/api/companies/co/search?q=x", "narrow-read"],
    ["GET", "/api/heartbeat-runs/r1", "narrow-read"],
    ["GET", "/api/agents/other-agent", "narrow-read"],
    ["GET", "/api/agents/me/inbox/mine", "narrow-read"],
    ["GET", "/api/issues", "narrow-read"],
    ["GET", `/API/issues/${own}`, "narrow-read"],
    ["GET", `/api/Issues/${own}/comments`, "narrow-read"],
    ["GET", `/api/issues/${own}/`, "narrow-read"],
    ["GET", `/api//issues/${own}`, "narrow-read"],
    ["GET", `/api/issues/${own}/comments/`, "narrow-read"],
    ["GET", `/api/issues/%53TH-1`, "narrow-read"],
    ["GET", `/api/issues/${own}%2Fcomments`, "narrow-read"],
    ["HEAD", `/api/issues/${own}`, "narrow-read"],
    ["OPTIONS", `/api/issues/${own}/comments`, "narrow-read"],
    ["POST", "/api/companies/co/issues", "narrow-write"],
    ["POST", `/api/companies/co/issues/${own}/attachments`, "narrow-write"],
    ["PUT", `/api/issues/${own}/documents/plan`, "narrow-write"],
    ["PUT", `/api/issues/${own}/title`, "narrow-write"],
    ["POST", `/api/issues/${own}/work-products`, "narrow-write"],
    ["POST", `/api/issues/${own}/interactions`, "narrow-write"],
    ["POST", `/api/issues/${own}/interactions/n1/accept`, "narrow-write"],
    ["POST", "/api/companies/co/approvals", "narrow-write"],
    ["POST", "/api/approvals/a1/comments", "narrow-write"],
    ["POST", `/api/issues/${own}/comments?x=1`, "narrow-write"],
    ["PATCH", `/api/issues/${own}?x=1`, "narrow-write"],
    ["POST", `/API/Issues/${own}/Comments`, "narrow-write"],
    ["POST", `/api/issues/${own}/comments/`, "narrow-write"],
    ["PATCH", `/api/issues/${own}/`, "narrow-write"],
  ];
  const bodies = {
    "/api/companies/co/issues": JSON.stringify({ title: "x", assigneeAgentId: RESEARCHER }),
    "/api/companies/co/approvals": JSON.stringify({ type: "request_board_approval", payload: {} }),
  };
  const before = boardSockets;
  for (const [m, p, rule] of cases) {
    rmSync(logFile, { force: true });
    const body = m === "GET" || m === "HEAD" || m === "OPTIONS" ? undefined : (bodies[p] ?? "{}");
    const r = await req(m, p, w.token, { body });
    assert.equal(r.status, 403, `${m} ${p}`);
    if (m !== "HEAD") assert.equal(r.json.rule, rule, `${m} ${p}`);
    const lines = logLines();
    assert.equal(lines.length, 1, `${m} ${p}`);
    assert.ok(!lines[0].includes("?") && !lines[0].includes(w.token), lines[0]);
  }
  assert.equal(boardSockets, before, "the board was never contacted");
  assert.deepEqual(nonHealth(), []);
});

test("a method override, or a read with a body, is refused on the narrow listener", async () => {
  const w = world();
  for (const name of ["X-HTTP-Method-Override", "X-HTTP-Method", "X-Method-Override"]) {
    const r = await req("GET", `/api/issues/${w.own.id}`, w.token, { extra: { [name]: "GET" } });
    assert.equal(r.status, 403, name);
    assert.equal(r.json.rule, "narrow-read");
    const r2 = await req("POST", `/api/issues/${w.own.id}/comments`, w.token, { body: '{"body":"x"}', extra: { [name]: "POST" } });
    assert.equal(r2.status, 403, name);
    assert.equal(r2.json.rule, "narrow-write");
  }
  const r3 = await req("GET", `/api/issues/${w.own.id}`, w.token, { body: '{"a":1}', extra: { "Content-Length": "7" } });
  assert.equal(r3.status, 403);
  assert.equal(r3.json.rule, "narrow-read");
  const r4 = await raw(`GET /api/issues/${w.own.id} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${w.token}\r\n` +
    "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n");
  assert.equal(statusOf(r4.text), 403);
  assert.deepEqual(nonHealth(), []);
});

test("write bodies: only the narrow keys; a checkout only for the caller itself", async () => {
  const w = world();
  const own = w.own.id;
  const cases = [
    ["POST", `/api/issues/${own}/comments`, { body: "x", attachmentIds: [randomUUID()] }],
    ["PATCH", `/api/issues/${own}`, { status: "blocked", blockedByIssueIds: [w.theirs.id] }],
    ["PATCH", `/api/issues/${own}`, { parentId: w.theirs.id }],
    ["PATCH", `/api/issues/${own}`, { assigneeAgentId: OTHER }],
    ["PATCH", `/api/issues/${own}`, { title: "renamed" }],
    ["PATCH", `/api/issues/${own}`, { description: "x" }],
    ["POST", `/api/issues/${own}/release`, { reason: "x" }],
  ];
  for (const [m, p, value] of cases) {
    const r = await req(m, p, w.token, { body: JSON.stringify(value) });
    assert.equal(r.status, 403, `${m} ${p} ${Object.keys(value)}`);
    assert.ok(["narrow-write", "task-fields", "not-allowed-field"].includes(r.json.rule), r.json.rule);
  }
  assert.deepEqual(nonHealth(), [], "key refusals happen before the board is asked");
  const r = await req("POST", `/api/issues/${own}/checkout`, w.token, { body: JSON.stringify({ agentId: OTHER, expectedStatuses: ["todo"] }) });
  assert.equal(r.status, 403);
  assert.equal(r.json.rule, "narrow-write");
  const ok = await req("PATCH", `/api/issues/${own}`, w.token, { body: JSON.stringify({ status: "blocked", unblockDescriptor: { owner: { agentId: RESEARCHER }, action: "wait" } }) });
  assert.equal(ok.status, 200);
  const empty = await req("POST", `/api/issues/${own}/release`, w.token, { body: "{}" });
  assert.equal(empty.status, 200);
  assert.deepEqual(forwarded().map((s) => s.method), ["PATCH", "POST"]);
});

test("a body rule of today still refuses a bad comment, and the board sees nothing", async () => {
  const w = world();
  const own = w.own.id;
  const cases = [
    ['{"body":"x","adapterConfig":{"command":"sh"}}', "application/json", "task-launch-settings"],
    ['{"body":"x","body":"y"}', "application/json", "bad-body"],
    ['{"body":"x"', "application/json", "bad-body"],
    ['{"body":"x"}', "text/plain", "bad-body"],
    ['["x"]', "application/json", "bad-body"],
    ['{"body":"x","__proto__":{}}', "application/json", "not-allowed-field"],
  ];
  for (const [body, type, rule] of cases) {
    const r = await req("POST", `/api/issues/${own}/comments`, w.token, { body, type });
    assert.equal(r.status, 403, body);
    assert.equal(r.json.rule, rule, body);
  }
  const p = await req("PATCH", `/api/issues/${own}`, w.token, { body: '{"status":"done","assigneeAdapterOverrides":{}}' });
  assert.equal(p.json.rule, "task-launch-settings");
  assert.deepEqual(nonHealth(), []);
});

// ---- tokens and the board ------------------------------------------------------------
test("no token, two tokens, an upgrade → refused as on the ordinary gate", async () => {
  const w = world();
  assert.equal((await req("GET", `/api/issues/${w.own.id}`, null)).status, 401);
  const two = await raw(`GET /api/agents/me HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer a\r\nAuthorization: Bearer b\r\nConnection: close\r\n\r\n`);
  assert.equal(statusOf(two.text), 401);
  const up = await raw(`GET /api/agents/me HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${w.token}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  assert.equal(statusOf(up.text), 403);
  assert.ok(up.text.includes('"rule":"upgrade"'));
  assert.deepEqual(nonHealth(), []);
});

test("a token the board does not know → 401, and nothing about it is remembered", async () => {
  const stranger = "pcp_not_a_real_token_123";
  const r = await req("GET", "/api/issues/STH-1", stranger);
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "gate_no_token");
  assert.equal(narrow.cache.has(stranger), false);
  assert.deepEqual(nonHealth().map((s) => s.url), ["/api/agents/me"]);
});

test("a 401 from the board on a forwarded request drops the token's entry", async () => {
  const w = world();
  assert.equal((await req("GET", `/api/issues/${w.own.id}`, w.token)).status, 200);
  assert.equal(narrow.cache.has(w.token), true);
  tokens.delete(w.token);
  assert.equal((await req("GET", `/api/issues/${w.own.id}`, w.token)).status, 401);
  assert.equal(narrow.cache.has(w.token), false);
  assert.equal((await req("GET", `/api/issues/${w.own.id}`, w.token)).status, 401);
});

test("a caller that is not an agent, or a board that errs, is never let through", async () => {
  const w = world();
  meStatus = 403;
  const r = await req("GET", `/api/issues/${w.own.id}`, w.token);
  assert.equal(r.status, 403);
  assert.equal(r.json.rule, "narrow-not-yours");
  meStatus = 500;
  const r2 = await req("GET", `/api/issues/${w.own.id}`, newToken(RESEARCHER));
  assert.equal(r2.status, 502);
  assert.deepEqual(r2.json, { error: "The board is not answering.", code: "gate_board_down" });
  meStatus = 200;
  forcedStatus = 503;
  const r3 = await req("GET", `/api/issues/${w.own.id}`, newToken(RESEARCHER));
  assert.equal(r3.status, 502);
  assert.deepEqual(forwarded(), []);
});

test("the board down → 502 gate_board_down, and narrow health says down", async () => {
  const free = await new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const g = createGate({ listenPort: 0, boardPort: free, refusalLog: logFile, narrow: true });
  const port = await g.listen();
  try {
    const w = world();
    const r = await request("GET", `/api/issues/${w.own.id}`, { headers: auth(w.token), port });
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { error: "The board is not answering.", code: "gate_board_down" });
    const me = await request("GET", "/api/agents/me", { headers: auth(w.token), port });
    assert.equal(me.status, 502);
    const h = await request("GET", "/gate/health", { port });
    assert.deepEqual(h.json, { status: "ok", part: "gate", narrow: true, board: "down" });
  } finally {
    await g.close();
  }
});

test("fifty-one tokens keep the cache at fifty, keyed by SHA-256, never by the token", async () => {
  const g = createGate({ listenPort: 0, boardPort, refusalLog: logFile, narrow: true });
  const port = await g.listen();
  try {
    const w = world();
    const all = [];
    for (let i = 0; i < MAX_TOKENS + 1; i += 1) {
      const t = newToken(RESEARCHER);
      all.push(t);
      assert.equal((await request("GET", `/api/issues/${w.own.id}`, { headers: auth(t), port })).status, 200);
    }
    assert.equal(g.cache.size, MAX_TOKENS);
    assert.equal(g.cache.has(all[0]), false, "the least recently used went first");
    assert.equal(g.cache.has(all[MAX_TOKENS]), true);
    assert.equal(g.cache.keyOf(all[1]), createHash("sha256").update(all[1]).digest("hex"));
  } finally {
    await g.close();
  }
});

// ---- the ordinary gate's vectors ----------------------------------------------------------
test("the ordinary listener's vectors all still pass on it beside a narrow one", async () => {
  const T = "pcp_testtoken_abcdefghijklmnop";
  tokens.set(T, OTHER);
  const auth = (t) => ({ Authorization: `Bearer ${t}`, "X-Test-Client": "1" });
  const jsonAuth = (t) => ({ ...auth(t), "Content-Type": "application/json" });
  for (const [m, p] of READS) {
    const r = await request(m, p, { headers: auth(T), port: ordinaryPort });
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  for (let i = 0; i < ALLOWED.length; i += 1) {
    const [m, p] = ALLOWED[i];
    const [type, body] = GOOD_BODIES[i];
    const r = await request(m, p, { headers: type ? { ...auth(T), "Content-Type": type } : auth(T), body: body || undefined, port: ordinaryPort });
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  for (const [m, p] of SAME_ROUTE) {
    const r = await request(m, p, { headers: jsonAuth(T), body: "{}", port: ordinaryPort });
    assert.equal(r.status, 200, `${m} ${p}`);
  }
  for (const [m, p, id] of PROOF) {
    const r = await request(m, p, { headers: auth(T), body: m === "GET" ? undefined : '{"x":1}', port: ordinaryPort });
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.rule, id);
  }
});

test("every request the ordinary gate refuses is refused on the narrow listener too, before the board", async () => {
  const w = world();
  const T = w.token;
  const all = [
    ...PROOF.map(([m, p]) => [m, p]),
    ...NOT_NEEDED.flatMap(([m, raws]) => raws.map((p) => [m, p])),
    ...HOSTILE,
    ["GET", "/api/agents/1/../../companies"], ["PATCH", "/api/%2561gents/1"], ["PATCH", "/api/agents/%ZZ"],
    ["POST", "/mcp/runtime-tools"], ["GET", "/runtime-tools/connections/search"],
  ];
  // Rewrite the vectors' sample issue id to the caller's own task, so a refusal here is
  // the gate's rule and never just "not yours".
  const own = (p) => p.replace(/\/issues\/i1(?=\/|$|%|;|\.)/i, `/issues/${w.own.id}`);
  const before = boardSockets;
  for (const [m, p0] of all) {
    const p = own(p0);
    const ordinaryAnswer = await request(m, p, { headers: { ...jsonAuth(T), "X-Test-Client": "1" }, body: m === "GET" ? undefined : '{"x":1}', port: ordinaryPort });
    assert.ok(ordinaryAnswer.status === 403 || ordinaryAnswer.status === 400, `ordinary ${m} ${p}`);
    const n = await request(m, p, { headers: { ...jsonAuth(T), "X-Test-Client": "1" }, body: m === "GET" ? undefined : '{"x":1}' });
    assert.equal(n.status, ordinaryAnswer.status, `narrow ${m} ${p}`);
    if (n.status === 403) assert.equal(n.json.rule, ordinaryAnswer.json.rule, `${m} ${p}`);
  }
  assert.equal(boardSockets, before);
  assert.deepEqual(nonHealth(), []);
});

// ---- the pure parts --------------------------------------------------------------------
test("narrowRoute: the lists, read and write", () => {
  assert.equal(NARROW_READS.length, 6);
  assert.equal(NARROW_WRITES.length, 4);
  assert.deepEqual(narrowRoute("GET", "/api/agents/me"), { kind: "identity", issueId: null, write: false });
  assert.deepEqual(narrowRoute("GET", "/api/issues/STH-12/comments/abc"), { kind: "comment", issueId: "STH-12", write: false });
  assert.deepEqual(narrowRoute("PATCH", "/api/issues/STH-12"), { kind: "task-update", issueId: "STH-12", write: true });
  assert.deepEqual(narrowRoute("DELETE", "/api/issues/STH-12"), { rule: "narrow-write" });
  assert.deepEqual(narrowRoute("GET", "/api/issues/-x"), { rule: "narrow-read" });
  assert.deepEqual(narrowRoute("GET", `/api/issues/${"a".repeat(65)}`), { rule: "narrow-read" });
  assert.deepEqual(narrowRoute("GET", "/api/agents/me", { overrides: true }), { rule: "narrow-read" });
  assert.deepEqual(narrowRoute("GET", "/api/agents/me", { hasBody: true }), { rule: "narrow-read" });
  assert.equal(narrowBodyRefusal("release", null), null);
  assert.equal(narrowBodyRefusal("comment", null), "narrow-write");
  assert.equal(narrowBodyRefusal("comment", { body: "x" }), null);
  assert.equal(narrowBodyRefusal("document", { body: "x" }), "narrow-write");
});

test("ownership: the agent is remembered 5 minutes, its issues 10, a 401 forgets, a refusal is never kept", async () => {
  let clock = 1_000_000;
  const cache = createCache({ now: () => clock });
  const asked = [];
  let mine = new Set(["I1"]);
  const ask = async (token, path) => {
    asked.push(path);
    if (token === "bad") return { status: 401, json: null };
    if (path === "/api/agents/me") return { status: 200, json: { id: "agent-1" } };
    const id = path.slice("/api/issues/".length);
    return { status: 200, json: { id, identifier: null, assigneeAgentId: mine.has(id) ? "agent-1" : "agent-2",
      ancestors: [{ id: "P1" }, { id: "P2" }, { id: "P3" }, { id: "P4" }, { id: "P5" }] } };
  };
  assert.equal((await ownership(cache, "t", "I1", ask)).result, "yours");
  assert.deepEqual(asked, ["/api/agents/me", "/api/issues/I1"]);
  assert.equal((await ownership(cache, "t", "p4", ask)).result, "yours", "four steps up, any letter case");
  assert.equal((await ownership(cache, "t", "P5", ask)).result, "not-yours");
  asked.length = 0;
  clock += AGENT_TTL_MS - 1;
  assert.equal((await ownership(cache, "t", "I1", ask)).result, "yours");
  assert.deepEqual(asked, []);
  clock += 2;
  assert.equal((await ownership(cache, "t", "I1", ask)).result, "yours");
  assert.deepEqual(asked, ["/api/agents/me"]);
  asked.length = 0;
  clock += ISSUE_TTL_MS - AGENT_TTL_MS + 1;
  mine = new Set();
  assert.equal((await ownership(cache, "t", "I1", ask)).result, "not-yours", "after 10 minutes the board is asked again");
  assert.ok(asked.includes("/api/issues/I1"));
  assert.equal((await ownership(cache, "bad", "I1", ask)).result, "no-token");
  assert.equal(cache.has("bad"), false);
  assert.equal((await ownership(cache, "t", "../agents/x", ask)).result, "not-yours");
  assert.equal((await ownership(createCache(), "t", "I1", async () => ({ error: "down" }))).result, "board-down");
  assert.equal((await ownership(createCache(), "t", "I1", async () => ({ status: 200, json: "x" }))).result, "board-down");
});
