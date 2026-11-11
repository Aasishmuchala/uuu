import test from "node:test";
import assert from "node:assert/strict";
import { normalisePath, refusal, isPlainPath, RULES, ALLOW } from "../rules.mjs";
import { PROOF, MUST_PASS, ALLOWED, READS, INTERACTION_ANSWERS, NOT_NEEDED, HOSTILE, SAME_ROUTE } from "./vectors.mjs";

test("normalisePath: matching form", () => {
  const cases = [
    ["/api/agents/me", "/api/agents/me"],
    ["/API/Agents/1", "/api/agents/1"],
    ["/api//agents/1/", "/api/agents/1"],
    ["/api/%61gents/1", "/api/agents/1"],
    ["/api%2Fagents%2F1", "/api/agents/1"],
    ["/api/agents/me?x=/secrets", "/api/agents/me"],
    ["/api/agents///", "/api/agents"],
    ["/", "/"],
    ["/mcp/gateways/gw_ABC", "/mcp/gateways/gw_abc"],
  ];
  for (const [raw, want] of cases) assert.equal(normalisePath(raw), want, raw);
});

test("normalisePath: unreadable targets are null", () => {
  const bad = [
    "/api/%2561gents/1",         // double encoded
    "/api/agents/1/../../companies",
    "/api/./agents/1",
    "/api/%2e%2e/agents",
    "/api/%2E/agents",
    "/api/agents/%ZZ",           // bad escape
    "/api/agents/%",             // bad escape
    "/api\\agents/1",
    "/api/%5cagents",
    "/api/agents/%00",
    "/api/agents/%0a1",
    "/api/agents/%20",
    "/api/agents/%C3%A9",        // non-ASCII
    "/api/agents/1#x",
    "http://127.0.0.1:3100/api/agents/1",
    "HTTP://x/api/agents/1",
    "127.0.0.1:3100",
    "*",
    "//evil/api/agents/1",
    "/%2F/api/agents/1",
    "/%2Fapi/agents/1",
    "",
    "api/agents",
  ];
  for (const raw of bad) assert.equal(normalisePath(raw), null, raw);
  assert.equal(normalisePath(undefined), null);
});

const W = ["POST", "PUT", "PATCH", "DELETE", "PROPFIND"];
const R = ["GET", "HEAD", "OPTIONS"];

test("refusal: every proof request is refused with its rule", () => {
  for (const [m, p, id] of PROOF) assert.equal(refusal(m, p), id, `${m} ${p}`);
});

test("refusal: every must-pass request passes", () => {
  for (const [m, p] of MUST_PASS) assert.equal(refusal(m, p), null, `${m} ${p}`);
});

test("refusal: write-only rules let reads through, all-method rules do not", () => {
  for (const [id, scope] of RULES) {
    const sample = PROOF.find((r) => r[2] === id)[1];
    for (const m of W) assert.equal(refusal(m, sample), id, `${m} ${sample}`);
    for (const m of R) assert.equal(refusal(m, sample), scope === "all" ? id : null, `${m} ${sample}`);
  }
});

test("refusal: lower-case method and edge paths", () => {
  assert.equal(refusal("patch", "/api/agents/1"), "agents-write");
  assert.equal(refusal("POST", "/api/agents"), "agents-write");
  assert.equal(refusal("POST", "/api/agents/me/secret-proposals"), "agents-write");
  assert.equal(refusal("GET", "/api/agents/me/secrets"), "secrets");
  assert.equal(refusal("POST", "/api/companies"), "company-write");
  assert.equal(refusal("GET", "/api/companies/co"), null);
  assert.equal(refusal("POST", "/api/issues/x/workspace/repositories"), "task-folder");
  assert.equal(refusal("GET", "/api/issues/x/workspace"), null);
  assert.equal(refusal("POST", "/api/companies/co/imports/apply"), "export-import");
  assert.equal(refusal("GET", "/board"), "board-chat");
  assert.equal(refusal("GET", "/api/companies/co/members"), "members");
  assert.equal(refusal("GET", "/api/companies/co/issues"), null);
  assert.equal(refusal("post", "/api/issues/x/comments"), null);
  assert.equal(refusal("Post", "/api/companies/co/skills"), "not-allowed");
});

// ---- the allow-list -----------------------------------------------------------
test("allow-list: one vector per row, each passing with its own method only", () => {
  assert.equal(ALLOWED.length, ALLOW.length);
  for (let i = 0; i < ALLOW.length; i += 1) {
    const [method, re] = ALLOW[i];
    const [m, p] = ALLOWED[i];
    assert.equal(m, method, `row ${i}`);
    assert.ok(re.test(p), `row ${i}: ${p}`);
    assert.equal(refusal(m, p), null, `${m} ${p}`);
    assert.equal(refusal(m, p, p), null, `${m} ${p} (raw)`);
    for (const other of [...W, "TRACE", "MERGE", "UNKNOWN"]) {
      if (other === m) continue;
      assert.equal(refusal(other, p), "not-allowed", `${other} ${p}`);
    }
  }
});

test("allow-list: every interaction answer passes, others do not", () => {
  for (const a of INTERACTION_ANSWERS) assert.equal(refusal("POST", `/api/issues/i1/interactions/n1/${a}`), null, a);
  for (const a of ["dismiss", "skip", "cancel", "acceptx", "accept-all", ""]) {
    assert.equal(refusal("POST", `/api/issues/i1/interactions/n1/${a}`.replace(/\/$/, "")), "not-allowed", a);
  }
});

test("allow-list: reads still pass, the refusal list still comes first", () => {
  for (const [m, p] of READS) assert.equal(refusal(m, p), null, `${m} ${p}`);
  // Allowed shapes that an older rule already refuses keep that rule's id.
  assert.equal(refusal("PUT", "/api/issues/x/workspace"), "task-folder");
  assert.equal(refusal("PUT", "/api/issues/x/documents/secrets"), "secrets");
  assert.equal(refusal("POST", "/api/issues/x/comments", "/api/issues/x/comments?y=%2F"), null);
  assert.equal(refusal("PATCH", "/api/agents/1", "/api/%61gents/1"), "agents-write");
});

test("tools endpoints are refused for every method", () => {
  const paths = ["/mcp", "/mcp/runtime-tools", "/mcp/gateways/gw_abc", "/mcp/runner/files/upload",
    "/runtime-tools/connections/search", "/runtime-tools/connections/request", "/runtime-tools/github/credentials",
    "/api/mcp/setup", "/api/mcp/connections/x", "/api/runtime-tools/connections/request", "/api/mcp"];
  for (const p of paths) for (const m of [...R, ...W]) assert.equal(refusal(m, p), "tools-endpoint", `${m} ${p}`);
  assert.equal(refusal("POST", "/api/mcpx"), "not-allowed");
  assert.equal(refusal("GET", "/api/mcpx"), null);
});

test("writes the routine does not need are refused in every spelling", () => {
  let n = 0;
  for (const [m, raws] of NOT_NEEDED) {
    for (const raw of raws) {
      const p = normalisePath(raw);
      assert.notEqual(p, null, raw);
      assert.equal(refusal(m, p, raw), "not-allowed", `${m} ${raw}`);
      n += 1;
    }
  }
  assert.ok(n >= 40);
});

test("hostile spellings of allowed writes that are not the same route are refused", () => {
  for (const [m, raw] of HOSTILE) {
    const p = normalisePath(raw);
    assert.notEqual(p, null, raw);
    assert.equal(refusal(m, p, raw), "not-allowed", `${m} ${raw}`);
  }
  for (const [m, raw] of SAME_ROUTE) assert.equal(refusal(m, normalisePath(raw), raw), null, `${m} ${raw}`);
});

test("isPlainPath: escapes and empty segments before the query", () => {
  assert.equal(isPlainPath("/api/issues/x/comments"), true);
  assert.equal(isPlainPath("/api/issues/x/comments?q=%2F//"), true);
  assert.equal(isPlainPath("/api/issues/x%2Fcomments"), false);
  assert.equal(isPlainPath("/api//issues/x"), false);
});
