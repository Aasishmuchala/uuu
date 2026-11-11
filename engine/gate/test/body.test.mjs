// The gate's body rules (body.mjs), unit and against a local echo server standing in for
// the board.
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGate } from "../gate.mjs";
import { ALLOW } from "../rules.mjs";
import { BODY_LIMIT, BODY_KEYS, MAX_DEPTH, scanJson, bodyRefusal } from "../body.mjs";
import { ALLOWED, GOOD_BODIES } from "./vectors.mjs";

const TOKEN = "pcp_bodytesttoken_abcdefghijklmnop";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const JSON_AUTH = { ...AUTH, "Content-Type": "application/json" };
const sha = (b) => createHash("sha256").update(b).digest("hex");

// Every allowed write whose body is JSON, with its good body: [method, path, kind, contentType, text].
const JSON_ROWS = ALLOWED.map(([m, p], i) => [m, p, ALLOW[i][3], ...GOOD_BODIES[i]]).filter((r) => r[2] !== null);
const ruleFor = (kind) => BODY_KEYS[kind].rule;

// Keys refused at any depth as launch settings, in the spellings an agent might use.
const LAUNCH_KEYS = ["assigneeAdapterOverrides", "adapterConfig", "adapterType", "runner", "command", "env", "extraArgs",
  "cwd", "instructionsFilePath", "homeMode", "executionWorkspaceSettings", "executionWorkspaceId",
  "executionWorkspacePreference", "workspaceSelection", "workspaceRuntime", "workspaceStrategy",
  "inheritExecutionWorkspaceFromIssueId", "projectId", "projectWorkspaceId", "args", "runtimeConfig",
  "COMMAND", "Env", "useProjectWorkspace", "instructionsBundle"];

// ---- the echo board ------------------------------------------------------
let board;
let boardPort;
const seen = [];
let boardSockets = 0;

function startEchoBoard() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({ method: req.method, url: req.url, sha: sha(body), size: body.length, body });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sha: sha(body), size: body.length }));
      });
    });
    s.on("connection", () => { boardSockets += 1; });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

let gate;
let gatePort;
let logDir;
let logFile;

function request(method, path, { headers = {}, body, pieces, gapMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: gatePort, method, path, headers, agent: false }, (res) => {
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
    if (pieces) {
      let i = 0;
      const next = () => {
        if (i >= pieces.length) { req.end(); return; }
        req.write(pieces[i]);
        i += 1;
        if (gapMs) setTimeout(next, gapMs); else setImmediate(next);
      };
      next();
      return;
    }
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

// Writes raw bytes and collects everything until the gate closes the socket (or the timeout).
function raw(data, { waitMs = 2000, endAfter = false } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect(gatePort, "127.0.0.1");
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
    const timer = setTimeout(() => { sock.destroy(); done(); }, waitMs);
    sock.on("data", (c) => {
      chunks.push(c);
      // One full response is enough.
      const text = Buffer.concat(chunks).toString("utf8");
      const m = text.match(/Content-Length: (\d+)\r\n[\s\S]*?\r\n\r\n/i);
      if (m && Buffer.byteLength(text.slice(text.indexOf("\r\n\r\n") + 4)) >= Number(m[1])) {
        clearTimeout(timer);
        sock.destroy();
        done();
      }
    });
    sock.on("close", () => { clearTimeout(timer); done(); });
    sock.on("error", () => {});
    for (const d of Array.isArray(data) ? data : [data]) sock.write(d);
    if (endAfter) sock.end();
  });
}

const statusOf = (rawText) => Number((rawText.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]);
const ruleOf = (rawText) => (rawText.match(/"rule":"([^"]+)"/) || [])[1];
const logLines = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean) : []);

async function expectRefused(method, path, headers, body, rule, label) {
  const before = boardSockets;
  const r = await request(method, path, { headers, body });
  assert.equal(r.status, 403, `${label}: ${r.text}`);
  assert.deepEqual(r.json, { error: "The gate does not let agents do this.", code: "gate_refused", rule }, label);
  assert.equal(boardSockets, before, `${label}: board contacted`);
}

before(async () => {
  board = await startEchoBoard();
  boardPort = board.address().port;
  logDir = mkdtempSync(join(tmpdir(), "gate-body-test-"));
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

// ---- unit: the JSON scan --------------------------------------------------------
test("scanJson accepts what JSON.parse accepts, without duplicate keys", () => {
  for (const t of ['{}', '[]', ' {"a":1} ', '{"a":[1,2,{"b":null}],"c":"\\u0041\\n"}', '"x"', '-0.5e+3', 'true', 'null',
    '{"a":{"a":{"a":1}}}', '{"":1,"a":2}']) {
    assert.doesNotThrow(() => scanJson(t), `scan ${t}`);
    assert.doesNotThrow(() => JSON.parse(t), `parse ${t}`);
  }
});

test("scanJson refuses bad JSON, duplicate keys in any spelling and deep nesting", () => {
  const bad = ['', '{', '{"a":1,}', '{"a" 1}', "{'a':1}", '{"a":01}', '{"a":1}x', '{"a":"\u0001"}', '{"a":"\\x"}',
    '{"a":1,"a":2}', '{"type":"x","t\\u0079pe":"y"}', '{"b":{"c":1,"c":1}}', '[{"a":1,"a":1}]', 'NaN', '{"a":.5}',
    '[' .repeat(MAX_DEPTH + 2) + ']'.repeat(MAX_DEPTH + 2)];
  for (const t of bad) assert.throws(() => scanJson(t), undefined, `scan ${JSON.stringify(t)}`);
  assert.doesNotThrow(() => scanJson('['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH)));
});

test("bodyRefusal: rows, rules and order", () => {
  const h = ["Content-Type", "application/json"];
  const b = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o));
  assert.equal(bodyRefusal("task-update", "/api/issues/x", h, b({ status: "done" })), null);
  assert.equal(bodyRefusal("task-update", "/api/issues/x", h, b({ status: "done", labelIds: [] })), "task-fields");
  assert.equal(bodyRefusal("task-update", "/api/issues/x", h, b({ labelIds: [], projectId: "p" })), "task-launch-settings");
  assert.equal(bodyRefusal("comment", "/api/issues/x/comments", h, b({ body: "x", authorType: "user" })), "not-allowed-field");
  assert.equal(bodyRefusal("approval", "/a", h, b({ type: "hire_agent", payload: {} })), "approval-type");
  assert.equal(bodyRefusal("approval", "/a", h, b({ payload: {} })), "approval-type");
  assert.equal(bodyRefusal("approval", "/a", h, b({ type: ["request_board_approval"], payload: {} })), "approval-type");
  assert.equal(bodyRefusal("release", "/r", [], Buffer.alloc(0)), null);
  assert.equal(bodyRefusal("comment", "/c", [], Buffer.alloc(0)), "bad-body");
  assert.equal(bodyRefusal("no-such-kind", "/c", h, b({})), "bad-body");
  assert.equal(bodyRefusal("interaction-answer", "/api/issues/i/interactions/n/reject", h, b({ reason: "no" })), null);
  assert.equal(bodyRefusal("interaction-answer", "/api/issues/i/interactions/n/accept", h, b({ reason: "no" })), "not-allowed-field");
  assert.equal(bodyRefusal("interaction-answer", "/api/issues/i/interactions/n/accept", h, b({ rememberAction: true })),
    "not-allowed-field");
});

test("every JSON row of the allow-list has body rules, the upload has none", () => {
  for (const [, , , kind] of ALLOW) {
    if (kind === null) continue;
    assert.ok(BODY_KEYS[kind], kind);
  }
  assert.equal(ALLOW.filter((r) => r[3] === null).length, 1);
  assert.ok(BODY_LIMIT >= 1024 * 1024);
});

// ---- good bodies --------------------------------------------------------------------
test("each JSON row: the routine's body passes and reaches the board byte for byte", async () => {
  for (const [m, p, kind, type, text] of JSON_ROWS) {
    seen.length = 0;
    const r = await request(m, p, { headers: type ? { ...AUTH, "Content-Type": type } : AUTH, body: text || undefined });
    assert.equal(r.status, 200, `${kind}: ${r.text}`);
    assert.equal(seen.length, 1, kind);
    assert.equal(seen[0].sha, sha(Buffer.from(text)), kind);
    assert.equal(seen[0].url, p);
  }
  assert.deepEqual(logLines(), []);
});

test("the bytes forwarded are exactly the bytes received (spacing, escapes, non-ASCII, order kept)", async () => {
  const text = ' \r\n{ "status" : "done",\t"comment":"नमस्ते \\u00e9 \\" \\/ 😀",\n"title":"T"  }\n\n';
  const r = await request("PATCH", "/api/issues/i1", { headers: JSON_AUTH, body: text });
  assert.equal(r.status, 200, r.text);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].body.equals(Buffer.from(text)));
  // A UTF-8 charset and a byte-order mark are read as the board reads them.
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"body":"x"}')]);
  const r2 = await request("POST", "/api/issues/i1/comments", { headers: { ...AUTH, "Content-Type": "application/json;charset=UTF-8" }, body: bom });
  assert.equal(r2.status, 200, r2.text);
  assert.ok(seen[1].body.equals(bom));
});

test("release passes with no body, and with an empty object", async () => {
  assert.equal((await request("POST", "/api/issues/i1/release", { headers: AUTH })).status, 200);
  assert.equal((await request("POST", "/api/issues/i1/release", { headers: JSON_AUTH, body: "{}" })).status, 200);
  await expectRefused("POST", "/api/issues/i1/release", JSON_AUTH, '{"status":"todo"}', "not-allowed-field", "release key");
  await expectRefused("POST", "/api/issues/i1/release", AUTH, '{}', "bad-body", "release, no type");
});

test("every interaction answer passes with its own keys only", async () => {
  const good = {
    accept: { selectedOptionIds: ["a"], selectedClientKeys: ["k"] },
    reject: { reason: "Not this one." },
    respond: { answers: [{ questionId: "q", optionIds: [] }], summaryMarkdown: "ok" },
    verdicts: { verdicts: [{ id: "a", verdict: "approve" }] },
    "resolve-from-comment": { commentId: "c", decision: "accept", selectedOptionIds: ["a"] },
    withdraw: { reason: "Answered elsewhere." },
  };
  for (const [answer, body] of Object.entries(good)) {
    const p = `/api/issues/i1/interactions/n1/${answer}`;
    assert.equal((await request("POST", p, { headers: JSON_AUTH, body: JSON.stringify(body) })).status, 200, answer);
    await expectRefused("POST", p, JSON_AUTH, JSON.stringify({ ...body, decisionNote: "x" }), "not-allowed-field", answer);
  }
  await expectRefused("POST", "/api/issues/i1/interactions/n1/accept", JSON_AUTH, '{"rememberAction":true}', "not-allowed-field",
    "rememberAction");
});

// ---- launch settings, at the top and nested ---------------------------------------------
test("each JSON row: every launch-settings key is refused at the top level and nested", async () => {
  let n = 0;
  for (const [m, p, kind, , text] of JSON_ROWS) {
    const good = text ? JSON.parse(text) : {};
    const firstKey = Object.keys(good)[0] ?? "x";
    for (const key of LAUNCH_KEYS) {
      const top = { ...good, [key]: { command: "/bin/sh" } };
      const nested = { ...good, [firstKey]: { a: [1, { b: { [key]: "x" } }] } };
      await expectRefused(m, p, JSON_AUTH, JSON.stringify(top), "task-launch-settings", `${kind} top ${key}`);
      await expectRefused(m, p, JSON_AUTH, JSON.stringify(nested), "task-launch-settings", `${kind} nested ${key}`);
      n += 2;
    }
  }
  assert.ok(n > 500);
  assert.equal(seen.length, 0);
});

test("the R2 attack: a task update or a new task carrying assigneeAdapterOverrides is refused", async () => {
  const attack = { status: "todo", assigneeAdapterOverrides: { adapterConfig: { command: "/bin/sh", extraArgs: ["-c", "id"],
    env: { PATH: "/usr/bin" }, cwd: "/" } } };
  await expectRefused("PATCH", "/api/issues/i1", JSON_AUTH, JSON.stringify(attack), "task-launch-settings", "patch");
  await expectRefused("POST", "/api/companies/co/issues", JSON_AUTH, JSON.stringify({ title: "t", ...attack }),
    "task-launch-settings", "create");
  // Escaped key spellings are read as the board reads them.
  await expectRefused("PATCH", "/api/issues/i1", JSON_AUTH, '{"\\u0061ssigneeAdapterOverrides":{}}', "task-launch-settings", "escaped");
  await expectRefused("PATCH", "/api/issues/i1", JSON_AUTH, '{"comment":"x","executionWorkspaceSettings":{"mode":"agent_default"}}',
    "task-launch-settings", "workspace settings");
  const lines = logLines();
  assert.equal(lines.length, 4);
  for (const line of lines) {
    assert.match(line, /^\S+Z (PATCH \/api\/issues\/i1|POST \/api\/companies\/co\/issues) task-launch-settings$/);
    for (const s of ["bin/sh", "adapter", "Adapter", "PATH", TOKEN]) assert.ok(!line.includes(s), line);
  }
});

test("server-owned and prototype keys are refused at any depth", async () => {
  for (const body of ['{"kind":"request_confirmation","payload":{"toolAction":{"actionRequestId":"x"}}}',
    '{"kind":"request_confirmation","payload":{"secretProposal":{}}}',
    '{"kind":"ask_user_questions","payload":{"__proto__":{"command":"x"}}}',
    '{"kind":"ask_user_questions","payload":{"__proto__":{"x":1}}}']) {
    const rule = body.includes('"command"') ? "task-launch-settings" : "not-allowed-field";
    await expectRefused("POST", "/api/issues/i1/interactions", JSON_AUTH, body, rule, body);
  }
});

// ---- unknown top-level keys ---------------------------------------------------------------
test("each JSON row: an unknown top-level key is refused (task-fields or not-allowed-field), the log names the rule only", async () => {
  for (const [m, p, kind, , text] of JSON_ROWS) {
    rmSync(logFile, { force: true });
    const good = text ? JSON.parse(text) : {};
    const body = JSON.stringify({ ...good, sneakyValueKey: "topsecretvalue" });
    await expectRefused(m, p, JSON_AUTH, body, ruleFor(kind), kind);
    const lines = logLines();
    assert.equal(lines.length, 1, kind);
    assert.ok(lines[0].endsWith(` ${m} ${p} ${ruleFor(kind)}`), lines[0]);
    assert.ok(!lines[0].includes("topsecretvalue") && !lines[0].includes("sneaky"), lines[0]);
  }
  assert.equal(ruleFor("task-update"), "task-fields");
  assert.equal(ruleFor("task-create"), "task-fields");
});

test("fields the routine does not send are refused on the task rows", async () => {
  for (const key of ["assigneeUserId", "executionPolicy", "labelIds", "visibility", "createdByUserId", "onBehalfOfUserId",
    "watchdog", "requestDepth", "hiddenAt", "reopen", "status ", "Status"]) {
    await expectRefused("PATCH", "/api/issues/i1", JSON_AUTH, JSON.stringify({ status: "done", [key]: null }), "task-fields", key);
  }
});

// ---- the approval type ----------------------------------------------------------------------
test("an approval of any type but request_board_approval is refused; hire_agent above all", async () => {
  const p = "/api/companies/co/approvals";
  for (const type of ["hire_agent", "approve_ceo_strategy", "budget_override_required", "Request_board_approval",
    "request_board_approval ", "", null, 1]) {
    await expectRefused("POST", p, JSON_AUTH, JSON.stringify({ type, payload: { name: "Helper", role: "general" } }),
      "approval-type", String(type));
  }
  await expectRefused("POST", p, JSON_AUTH, JSON.stringify({ payload: {} }), "approval-type", "no type");
  // A hire carrying launch settings is refused before its type is even looked at.
  await expectRefused("POST", p, JSON_AUTH, JSON.stringify({ type: "hire_agent", payload: { name: "x", adapterType: "process",
    adapterConfig: { command: "/bin/sh" } } }), "task-launch-settings", "hire with adapter");
  await expectRefused("POST", p, JSON_AUTH, JSON.stringify({ type: "request_board_approval", payload: {}, status: "approved" }),
    "not-allowed-field", "extra key");
});

// ---- duplicate keys -----------------------------------------------------------------------
test("duplicated keys cannot smuggle a value past the gate", async () => {
  const cases = [
    ["POST", "/api/companies/co/approvals", '{"type":"request_board_approval","payload":{},"type":"hire_agent"}'],
    ["POST", "/api/companies/co/approvals", '{"type":"hire_agent","type":"request_board_approval","payload":{}}'],
    ["POST", "/api/companies/co/approvals", '{"type":"request_board_approval","t\\u0079pe":"hire_agent","payload":{}}'],
    ["PATCH", "/api/issues/i1", '{"status":"done","status":"todo"}'],
    ["PATCH", "/api/issues/i1", '{"unblockDescriptor":{"action":"a","action":"b"}}'],
    ["POST", "/api/issues/i1/interactions", '{"kind":"ask_user_questions","payload":{"questions":[{"id":"a","id":"b"}]}}'],
  ];
  for (const [m, p, body] of cases) await expectRefused(m, p, JSON_AUTH, body, "bad-body", body);
});

// ---- bodies the gate cannot read --------------------------------------------------------
test("a body that is not one JSON object in UTF-8 is refused (bad-body)", async () => {
  const p = "/api/issues/i1/comments";
  const bad = ["", "not json", '{"body":"x"', '{"body":"x"} {"body":"y"}', '[{"body":"x"}]', '"x"', "1", "null", "true",
    '{"body":"x",}', "{'body':'x'}"];
  for (const body of bad) await expectRefused("POST", p, JSON_AUTH, body, "bad-body", JSON.stringify(body));
  await expectRefused("POST", p, JSON_AUTH, Buffer.from([0x7b, 0x22, 0x62, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), "bad-body", "bad UTF-8");
  await expectRefused("POST", p, JSON_AUTH, `{"body":${"[".repeat(200)}${"]".repeat(200)}}`, "bad-body", "too deep");
  assert.equal(seen.length, 0);
});

test("a content type other than application/json is refused (bad-body)", async () => {
  const body = '{"body":"x"}';
  for (const type of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x",
    "application/json; charset=latin1", "application/json; charset=utf-16", "application/jsonx", "application/vnd.api+json",
    "text/json", "application/json; x=1"]) {
    const headers = type === undefined ? AUTH : { ...AUTH, "Content-Type": type };
    await expectRefused("POST", "/api/issues/i1/comments", headers, body, "bad-body", String(type));
  }
  await expectRefused("POST", "/api/issues/i1/comments", { ...JSON_AUTH, "Content-Encoding": "gzip" }, body, "bad-body", "gzip");
  const two = await raw("POST /api/issues/i1/comments HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n" +
    "Content-Type: application/json\r\nContent-Type: text/plain\r\nContent-Length: 12\r\nConnection: close\r\n\r\n" + body);
  assert.equal(statusOf(two), 403);
  assert.equal(ruleOf(two), "bad-body");
  assert.equal(seen.length, 0);
});

test("an oversize body is refused, declared or chunked, and never reaches the board", async () => {
  const before = boardSockets;
  // Declared too long: refused at once, before the body arrives.
  const declared = await raw("POST /api/issues/i1/comments HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n" +
    `Content-Type: application/json\r\nContent-Length: ${BODY_LIMIT + 1}\r\n\r\n{"body":"`);
  assert.equal(statusOf(declared), 403);
  assert.equal(ruleOf(declared), "bad-body");
  // Chunked: refused once the received bytes pass the limit.
  const big = Buffer.alloc(BODY_LIMIT + 10, 0x61);
  const chunked = await raw(["POST /api/issues/i1/comments HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n" +
    `Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n${(BODY_LIMIT + 10).toString(16)}\r\n`, big, "\r\n"],
  { waitMs: 5000 });
  assert.equal(statusOf(chunked), 403);
  assert.equal(ruleOf(chunked), "bad-body");
  assert.equal(boardSockets, before);
  assert.equal(seen.length, 0);
  // A body right at the limit passes.
  const fill = BODY_LIMIT - '{"body":""}'.length;
  const atLimit = `{"body":"${"b".repeat(fill)}"}`;
  assert.equal(Buffer.byteLength(atLimit), BODY_LIMIT);
  const r = await request("POST", "/api/issues/i1/comments", { headers: JSON_AUTH, body: atLimit });
  assert.equal(r.status, 200);
  assert.equal(r.json.sha, sha(Buffer.from(atLimit)));
});

test("a chunked body is checked whole: a bad key in a later chunk is refused, a good one is forwarded", async () => {
  const good = JSON.stringify({ status: "done", comment: "x".repeat(70000) });
  const pieces = [good.slice(0, 30000), good.slice(30000)];
  const r = await request("PATCH", "/api/issues/i1", { headers: JSON_AUTH, pieces, gapMs: 30 });
  assert.equal(r.status, 200);
  assert.equal(r.json.sha, sha(Buffer.from(good)));
  const bad = `{"comment":"${"x".repeat(70000)}","assigneeAdapterOverrides":{"adapterConfig":{"command":"/bin/sh"}}}`;
  const before = boardSockets;
  const r2 = await request("PATCH", "/api/issues/i1", { headers: JSON_AUTH, pieces: [bad.slice(0, 40000), bad.slice(40000)], gapMs: 30 });
  assert.equal(r2.status, 403);
  assert.equal(r2.json.rule, "task-launch-settings");
  assert.equal(boardSockets, before);
});

test("a body sent in many small pieces is read whole and checked correctly", async () => {
  const good = GOOD_BODIES[ALLOWED.findIndex(([, p]) => p === "/api/companies/co/approvals")][1];
  const r = await request("POST", "/api/companies/co/approvals", { headers: JSON_AUTH, pieces: [...good].map((c) => c) });
  assert.equal(r.status, 200);
  assert.equal(r.json.sha, sha(Buffer.from(good)));
  // A forbidden key split across one-byte pieces is still seen.
  const bad = '{"type":"request_board_approval","payload":{"adapterConfig":{"cwd":"/"}}}';
  const r2 = await request("POST", "/api/companies/co/approvals", { headers: JSON_AUTH, pieces: [...bad], gapMs: 1 });
  assert.equal(r2.status, 403);
  assert.equal(r2.json.rule, "task-launch-settings");
  const hire = '{"type":"hire_agent","payload":{"name":"x"}}';
  const r3 = await request("POST", "/api/companies/co/approvals", { headers: JSON_AUTH, pieces: [...hire] });
  assert.equal(r3.status, 403);
  assert.equal(r3.json.rule, "approval-type");
  assert.equal(seen.length, 1);
});

test("a method override is checked against the body rules of the row it names", async () => {
  // Node's client frames a GET body only when told its length.
  const bad = '{"assigneeAdapterOverrides":{}}';
  await expectRefused("GET", "/api/issues/i1", { ...JSON_AUTH, "X-HTTP-Method-Override": "PATCH", "Content-Length": bad.length },
    bad, "task-launch-settings", "override to PATCH");
  await expectRefused("GET", "/api/issues/i1", { ...AUTH, "X-HTTP-Method-Override": "PATCH", "Content-Length": 17 },
    '{"status":"done"}', "bad-body", "override, no type");
  const r = await request("GET", "/api/issues/i1", { headers: AUTH });
  assert.equal(r.status, 200);
});

// ---- the file upload ------------------------------------------------------------------------
test("the file upload is a form: it is streamed unchanged, its body not read as JSON", async () => {
  const i = ALLOWED.findIndex(([, p]) => p.endsWith("/attachments"));
  const [type, text] = GOOD_BODIES[i];
  const r = await request("POST", ALLOWED[i][1], { headers: { ...AUTH, "Content-Type": type }, body: text });
  assert.equal(r.status, 200);
  assert.equal(r.json.sha, sha(Buffer.from(text)));
});

test("a refused body leaves nothing behind: the next request on a new connection works", async () => {
  await expectRefused("PATCH", "/api/issues/i1", JSON_AUTH, '{"env":{}}', "task-launch-settings", "env");
  const r = await request("PATCH", "/api/issues/i1", { headers: JSON_AUTH, body: '{"status":"done"}' });
  assert.equal(r.status, 200);
  assert.equal(seen.length, 1);
});

test("random bytes as a JSON body never reach the board", async () => {
  for (let i = 0; i < 50; i += 1) {
    const body = randomBytes(1 + (i * 37) % 400);
    const r = await request("PATCH", "/api/issues/i1", { headers: JSON_AUTH, body });
    assert.equal(r.status, 403);
  }
  assert.equal(seen.length, 0);
});
