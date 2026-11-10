import test from "node:test";
import assert from "node:assert/strict";
import { normalisePath, refusal, RULES } from "../rules.mjs";
import { PROOF, MUST_PASS } from "./vectors.mjs";

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
});
