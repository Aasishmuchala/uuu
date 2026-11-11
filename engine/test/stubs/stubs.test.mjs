import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStubBoard } from "./board.mjs";
import { startStubBench } from "./bench.mjs";
import { boardSeed, benchSeed, IDS, BENCH_KEYS } from "./seed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

async function call(base, method, p, { body, headers = {} } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json };
}

const bearer = (t) => ({ authorization: `Bearer ${t}` });
const benchAuth = (k) => ({ authorization: `token ${k}` });
const C = IDS.company;

test("board: owner, agent and bad bearer", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    assert.equal((await call(b.url, "GET", "/api/health")).json.status, "ok");
    assert.equal((await call(b.url, "GET", "/api/agents/me")).status, 401); // the owner is not an agent
    const me = await call(b.url, "GET", "/api/agents/me", { headers: bearer(IDS.tokens.builder) });
    assert.equal(me.status, 200);
    assert.equal(me.json.name, "Builder");
    const bad = await call(b.url, "GET", "/api/health", { headers: bearer("garbage") });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.json, { error: "Unauthorized" });
    assert.equal((await call(b.url, "GET", "/api/nothing")).status, 404);
    assert.deepEqual((await call(b.url, "GET", "/api/nothing")).json, { error: "Not found" });
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/attention`, { headers: bearer(IDS.tokens.builder) })).status, 403);
    assert.equal(b.requests.length, 7);
    assert.equal(b.requests[0].method, "GET");
    assert.equal(b.requests[2].headers.authorization, `Bearer ${IDS.tokens.builder}`);
  } finally { await b.close(); }
});

test("board: seed has nine agents, a project, three goals and four attention items", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const agents = (await call(b.url, "GET", `/api/companies/${C}/agents`)).json;
    assert.equal(agents.length, 9);
    for (const k of ["id", "companyId", "name", "role", "title", "status", "reportsTo", "adapterType", "adapterConfig", "runtimeConfig", "permissions", "pauseReason", "lastHeartbeatAt"]) assert.ok(k in agents[0], k);
    assert.ok(!("access" in agents[0]));
    const one = (await call(b.url, "GET", `/api/agents/${IDS.agents.builder}`)).json;
    assert.ok(one.access.membership.id);
    assert.ok(one.access.grants.every((g) => "permissionKey" in g && "scope" in g));
    const top = (await call(b.url, "GET", `/api/companies/${C}/issues?projectId=${IDS.project}`)).json.filter((i) => !i.parentId);
    assert.deepEqual(top.map((i) => i.status).sort(), ["blocked", "done", "in_progress"]);
    const att = (await call(b.url, "GET", `/api/companies/${C}/attention`)).json;
    assert.deepEqual(att.items.map((i) => i.sourceKind).sort(), ["approval", "budget_alert", "failed_run", "issue_thread_interaction"]);
    assert.equal(att.totalCount, 4);
    for (const k of ["id", "sourceKind", "subject", "whyNow", "decisionVerbs", "severity", "originAgentName", "relatedIssue", "dismissalKey", "activityAt"]) assert.ok(k in att.items[0], k);
    const badges = (await call(b.url, "GET", `/api/companies/${C}/sidebar-badges`)).json;
    assert.deepEqual(badges, { inbox: 4, approvals: 1, failedRuns: 1, joinRequests: 0 });
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/live-runs`)).json.length, 1);
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/heartbeat-runs?agentId=${IDS.agents.checker}`)).json.length, 0);
  } finally { await b.close(); }
});

test("board: the instructions PUT checks the revision", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const url = `/api/agents/${IDS.agents.builder}/instructions-bundle/file?path=AGENTS.md`;
    const got = (await call(b.url, "GET", url)).json;
    assert.match(got.content, /Paperclip company/);
    const wrong = await call(b.url, "PUT", url, { body: { content: "x", baseRevisionId: "nope" } });
    assert.equal(wrong.status, 409);
    const none = await call(b.url, "PUT", url, { body: { content: "x" } });
    assert.equal(none.status, 409);
    const ok = await call(b.url, "PUT", url, { body: { content: "New text\n", baseRevisionId: got.revision.id } });
    assert.equal(ok.status, 200);
    assert.notEqual(ok.json.revision.id, got.revision.id);
    assert.equal((await call(b.url, "GET", url)).json.content, "New text\n");
    // stale revision again
    assert.equal((await call(b.url, "PUT", url, { body: { content: "y", baseRevisionId: got.revision.id } })).status, 409);
    // a new agent has no custom file but starts with the default
    const fresh = (await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Extra" } })).json;
    assert.equal((await call(b.url, "GET", `/api/agents/${fresh.id}/instructions-bundle/file?path=OTHER.md`)).status, 404);
  } finally { await b.close(); }
});

const FOURTEEN = [
  "agents:configure", "agents:suggest-changes", "audit:view_agent_actions", "inbox:manage", "skills:create",
  "skills:suggest-changes", "tasks:assign", "tasks:assign_scope", "tasks:manage_active_checkouts",
  "tools:manage_connections", "tools:manage_profiles", "tools:manage_runtime", "tools:use", "tools:view_audit",
];
const keysOf = (agent) => agent.access.grants.map((g) => g.permissionKey).sort();

test("board: a new agent gets the fourteen default grants, tasks:assign included, whatever it asked for", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    b.state.companies[0].requireBoardApprovalForNewAgents = false;
    const made = await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Worker", permissions: { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false } } });
    assert.equal(made.status, 201);
    assert.equal(made.json.status, "idle");
    const full = (await call(b.url, "GET", `/api/agents/${made.json.id}`)).json;
    assert.deepEqual(keysOf(full), FOURTEEN);
    assert.deepEqual(full.permissions, { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false });
    const scopes = Object.fromEntries(full.access.grants.map((g) => [g.permissionKey, g.scope]));
    assert.deepEqual(scopes["tasks:assign_scope"], { subtreeRootAgentId: made.json.id });
    assert.deepEqual(scopes["inbox:manage"], { responsibleUserOnly: true });
    assert.equal(scopes["tasks:assign"], null);
    // Rights not given default to the create-time values of the real board.
    const bare = (await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Bare" } })).json;
    assert.equal(bare.permissions.canCreateAgents, true);
    assert.equal(bare.permissions.canCreateSkills, true);
  } finally { await b.close(); }
});

test("board: a hire waiting for approval has no grants until the owner approves it", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const made = (await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Waiter", permissions: { canAssignTasks: false, canCreateAgents: false } } })).json;
    assert.equal(made.status, "pending_approval");
    assert.deepEqual(keysOf((await call(b.url, "GET", `/api/agents/${made.id}`)).json), []);
    const frozen = await call(b.url, "PATCH", `/api/agents/${made.id}/permissions`, { body: { canAssignTasks: false, canCreateAgents: false } });
    assert.equal(frozen.status, 409);
    assert.equal((await call(b.url, "POST", `/api/agents/${made.id}/approve`)).status, 200);
    assert.deepEqual(keysOf((await call(b.url, "GET", `/api/agents/${made.id}`)).json), FOURTEEN);
  } finally { await b.close(); }
});

test("board: the member-permission routes refuse an agent as the real board does", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const builder = (await call(b.url, "GET", `/api/agents/${IDS.agents.builder}`)).json;
    const memberId = builder.access.membership.id;
    const before = keysOf(builder);
    for (const [method, suffix, body] of [
      ["PATCH", "/permissions", { grants: [{ permissionKey: "tools:use" }] }],
      ["PATCH", "/role-and-grants", { grants: [] }],
      ["PATCH", "", { status: "active" }],
      ["POST", "/archive", {}],
    ]) {
      const r = await call(b.url, method, `/api/companies/${C}/members/${memberId}${suffix}`, { body });
      assert.equal(r.status, 403, `${method} ${suffix}`);
      assert.deepEqual(r.json, { error: "Only human company members can be removed." });
    }
    assert.deepEqual(keysOf((await call(b.url, "GET", `/api/agents/${IDS.agents.builder}`)).json), before);
    assert.equal((await call(b.url, "PATCH", `/api/companies/${C}/members/nobody/permissions`, { body: { grants: [] } })).status, 404);
    assert.equal((await call(b.url, "PATCH", `/api/companies/${C}/members/${memberId}/permissions`, { body: { grants: "all" } })).status, 400);
  } finally { await b.close(); }
});

test("board: PATCH /permissions adds or removes only tasks:assign and answers with the agent's access", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    b.state.companies[0].requireBoardApprovalForNewAgents = false;
    const id = (await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Lead", permissions: { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false } } })).json.id;
    const url = `/api/agents/${id}/permissions`;
    assert.equal((await call(b.url, "PATCH", url, { body: { canAssignTasks: false } })).status, 400, "canCreateAgents is required");
    assert.equal((await call(b.url, "PATCH", url, { body: { canCreateAgents: false } })).status, 400, "canAssignTasks is required");
    const off = await call(b.url, "PATCH", url, { body: { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false } });
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.permissions, { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false });
    assert.deepEqual(keysOf(off.json), FOURTEEN.filter((k) => k !== "tasks:assign"));
    // Every active member counts as able to assign here; only the grant shows the right.
    assert.equal(off.json.access.canAssignTasks, true);
    assert.equal(off.json.access.taskAssignSource, "simple_default");
    const on = await call(b.url, "PATCH", url, { body: { canAssignTasks: true, canCreateAgents: false } });
    assert.deepEqual(keysOf(on.json), FOURTEEN);
    assert.equal(on.json.access.taskAssignSource, "explicit_grant");
    assert.equal(on.json.permissions.canAssignTasks, true);
    // An agent allowed to create agents keeps tasks:assign whatever is asked.
    const creator = await call(b.url, "PATCH", url, { body: { canAssignTasks: false, canCreateAgents: true } });
    assert.ok(keysOf(creator.json).includes("tasks:assign"));
    assert.equal(creator.json.access.taskAssignSource, "agent_creator");
    // An agent that is not the CEO may not change rights.
    const r = await call(b.url, "PATCH", url, { body: { canAssignTasks: true, canCreateAgents: false }, headers: bearer(IDS.tokens.builder) });
    assert.equal(r.status, 403);
  } finally { await b.close(); }
});

test("board: company switch makes new agents wait for approval; owner approves", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const made = (await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Waiter" } })).json;
    assert.equal(made.status, "pending_approval");
    const ok = await call(b.url, "POST", `/api/agents/${made.id}/approve`);
    assert.equal(ok.json.status, "idle");
    assert.equal((await call(b.url, "POST", `/api/agents/${made.id}/approve`)).status, 409);
    const p = await call(b.url, "POST", `/api/agents/${made.id}/pause`);
    assert.equal(p.json.status, "paused");
    assert.equal((await call(b.url, "POST", `/api/agents/${made.id}/resume`)).json.status, "idle");
    const patched = await call(b.url, "PATCH", `/api/agents/${made.id}`, { body: { adapterConfig: { model: "opus" }, reportsTo: IDS.agents["chief-of-staff"] } });
    assert.equal(patched.json.adapterConfig.model, "opus");
    assert.equal(patched.json.reportsTo, IDS.agents["chief-of-staff"]);
    const perm = await call(b.url, "PATCH", `/api/agents/${made.id}/permissions`, { body: { canAssignTasks: true, canCreateAgents: false } });
    assert.equal(perm.json.permissions.canAssignTasks, true);
    const co = await call(b.url, "PATCH", `/api/companies/${C}`, { body: { requireBoardApprovalForNewAgents: false } });
    assert.equal(co.json.requireBoardApprovalForNewAgents, false);
  } finally { await b.close(); }
});

test("board: adapter settings are stored whole, merged or replaced as the real board does", async () => {
  const b = await startStubBoard({ seed: boardSeed(), instanceRoot: "/pc" });
  try {
    await call(b.url, "PATCH", `/api/companies/${C}`, { body: { requireBoardApprovalForNewAgents: false } });
    const made = (await call(b.url, "POST", `/api/companies/${C}/agents`, {
      body: { name: "Coder", adapterType: "codex_local", adapterConfig: { cwd: "/w", command: "codex", env: { K: "v" } } },
    })).json;
    const root = `/pc/companies/${C}/agents/${made.id}/instructions`;
    assert.deepEqual(made.adapterConfig, {
      cwd: "/w", command: "codex", env: { K: "v" }, dangerouslyBypassApprovalsAndSandbox: true,
      instructionsBundleMode: "managed", instructionsRootPath: root, instructionsEntryFile: "AGENTS.md", instructionsFilePath: `${root}/AGENTS.md`,
    });
    const url = `/api/agents/${made.id}`;
    // Merged by default: extra settings stay.
    let r = (await call(b.url, "PATCH", url, { body: { adapterConfig: { extraArgs: ["-x"] } } })).json;
    assert.deepEqual(r.adapterConfig.env, { K: "v" });
    assert.deepEqual(r.adapterConfig.extraArgs, ["-x"]);
    // Replaced with replaceAdapterConfig: only what is sent, plus the codex default; the
    // instructions settings go when not sent.
    r = (await call(b.url, "PATCH", url, { body: { adapterConfig: { cwd: "/w", command: "codex" }, replaceAdapterConfig: true } })).json;
    assert.deepEqual(r.adapterConfig, { cwd: "/w", command: "codex", dangerouslyBypassApprovalsAndSandbox: true });
    // An instructions file outside the managed folder is "external".
    r = (await call(b.url, "PATCH", url, { body: { adapterConfig: { instructionsFilePath: "/x/A.md" } } })).json;
    assert.equal(r.adapterConfig.instructionsBundleMode, "external");
    assert.equal(r.adapterConfig.instructionsRootPath, "/x");
    // A new adapter keeps the adapter-agnostic settings the request leaves out.
    b.state.agents.find((a) => a.id === made.id).adapterConfig.env = { K: "v" };
    r = (await call(b.url, "PATCH", url, { body: { adapterType: "claude_local", adapterConfig: { command: "claude" }, replaceAdapterConfig: true } })).json;
    assert.equal(r.adapterType, "claude_local");
    assert.deepEqual(r.adapterConfig.env, { K: "v" });
    assert.equal(r.adapterConfig.cwd, "/w");
    assert.equal("dangerouslyBypassApprovalsAndSandbox" in r.adapterConfig, false);
    // runtimeConfig is replaced whole; the run environment can be cleared.
    b.state.agents.find((a) => a.id === made.id).defaultEnvironmentId = "e1";
    r = (await call(b.url, "PATCH", url, { body: { runtimeConfig: { heartbeat: { enabled: false } }, defaultEnvironmentId: null } })).json;
    assert.deepEqual(r.runtimeConfig, { heartbeat: { enabled: false } });
    assert.equal(r.defaultEnvironmentId, null);
    assert.equal((await call(b.url, "PATCH", url, { body: { adapterConfig: "x" } })).status, 422);
  } finally { await b.close(); }
});

test("board: issues, filters, comments and wakes", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const chief = IDS.agents["chief-of-staff"];
    const made = await call(b.url, "POST", `/api/companies/${C}/issues`, { body: { title: "New goal", description: "d", assigneeAgentId: chief, projectId: IDS.project, status: "todo", priority: "medium" } });
    assert.equal(made.status, 201);
    assert.equal(made.json.identifier, "STH-7");
    assert.equal(made.json.createdByUserId, "local-board");
    assert.deepEqual(b.state.wakes.map((w) => w.agentId), [chief]);
    const kids = (await call(b.url, "GET", `/api/companies/${C}/issues?parentId=${IDS.issues["STH-1"]}`)).json;
    assert.deepEqual(kids.map((i) => i.identifier).sort(), ["STH-4", "STH-5"]);
    const done = (await call(b.url, "GET", `/api/companies/${C}/issues?status=done&limit=1`)).json;
    assert.equal(done.length, 1);
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/issues?status=done`)).json.length, 2);
    assert.equal((await call(b.url, "GET", `/api/companies/${C}/issues?assigneeAgentId=${IDS.agents.checker}`)).json.length, 2);
    // an agent comments and patches
    const h = bearer(IDS.tokens.builder);
    const c = await call(b.url, "POST", `/api/issues/${IDS.issues["STH-4"]}/comments`, { body: { body: "Done." }, headers: h });
    assert.equal(c.json.authorAgentId, IDS.agents.builder);
    assert.equal((await call(b.url, "POST", `/api/issues/${IDS.issues["STH-4"]}/comments`, { body: {} })).status, 400);
    const p = await call(b.url, "PATCH", `/api/issues/${IDS.issues["STH-4"]}`, { body: { status: "done", comment: "All finished" }, headers: h });
    assert.equal(p.json.status, "done");
    const list = (await call(b.url, "GET", `/api/issues/STH-4/comments`)).json;
    assert.deepEqual(list.map((x) => x.body), ["Done.", "All finished"]);
    // reassign wakes the new assignee
    await call(b.url, "PATCH", `/api/issues/${IDS.issues["STH-5"]}`, { body: { assigneeAgentId: IDS.agents.builder } });
    assert.equal(b.state.wakes.at(-1).agentId, IDS.agents.builder);
    assert.equal((await call(b.url, "POST", `/api/companies/${C}/issues`, { body: "{nope" })).status, 400);
  } finally { await b.close(); }
});

test("board: owner decisions remove their attention items", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const pending = (await call(b.url, "GET", `/api/companies/${C}/approvals?status=pending`)).json;
    assert.equal(pending.length, 1);
    const ok = await call(b.url, "POST", `/api/approvals/${IDS.approval}/approve`, { body: { decisionNote: "fine" } });
    assert.equal(ok.json.status, "approved");
    assert.equal((await call(b.url, "POST", `/api/approvals/${IDS.approval}/reject`)).status, 409);
    assert.equal(b.state.attention.length, 3);
    await call(b.url, "POST", `/api/issues/${IDS.issues["STH-3"]}/retry`);
    assert.equal(b.state.attention.some((i) => i.sourceKind === "failed_run"), false);
    assert.ok(b.state.wakes.some((w) => w.reason === "retry"));
    // The seed's question offers Accept and Reject (a confirmation): the board will not take an answer for it.
    const base = `/api/issues/${IDS.issues["STH-1"]}/interactions/${IDS.interaction}`;
    assert.equal((await call(b.url, "POST", `${base}/respond`, { body: { answers: [] } })).status, 422);
    const r = await call(b.url, "POST", `${base}/accept`, { body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "accepted");
    assert.equal(b.state.interactions[0].action, "accept");
    assert.equal((await call(b.url, "POST", `${base}/reject`, { body: {} })).status, 409);
    assert.equal(b.state.attention.map((i) => i.sourceKind).join(), "budget_alert");
    const d = await call(b.url, "POST", `/api/issues/${IDS.issues["STH-1"]}/stalled-review-decision`, { body: { action: "approve", note: "good" } });
    assert.equal(d.json.status, "done");
    assert.equal((await call(b.url, "POST", `/api/issues/${IDS.issues["STH-1"]}/stalled-review-decision`, { body: { action: "x" } })).status, 400);
  } finally { await b.close(); }
});

test("board: keys give a working agent token and deleting revokes it", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    const k = await call(b.url, "POST", `/api/agents/${IDS.agents.checker}/keys`, { body: { name: "engine-proof" } });
    assert.equal(k.status, 201);
    assert.match(k.json.token, /^pcp_/);
    assert.equal((await call(b.url, "GET", "/api/agents/me", { headers: bearer(k.json.token) })).json.name, "Checker");
    assert.equal((await call(b.url, "POST", `/api/agents/${IDS.agents.checker}/keys`, { body: {}, headers: bearer(k.json.token) })).status, 403);
    assert.equal((await call(b.url, "DELETE", `/api/agents/${IDS.agents.checker}/keys/${k.json.id}`)).status, 200);
    assert.equal((await call(b.url, "GET", "/api/agents/me", { headers: bearer(k.json.token) })).status, 401);
  } finally { await b.close(); }
});

test("board: companies and projects can be created; starts empty without a seed", async () => {
  const b = await startStubBoard();
  try {
    assert.deepEqual((await call(b.url, "GET", "/api/companies")).json, []);
    const co = (await call(b.url, "POST", "/api/companies", { body: { name: "Sthyra" } })).json;
    assert.equal(co.issuePrefix, "STH");
    const pr = await call(b.url, "POST", `/api/companies/${co.id}/projects`, { body: { name: "Company work", workspace: { sourceType: "local_path", cwd: "/x", isPrimary: true } } });
    assert.equal(pr.status, 201);
    assert.equal(pr.json.primaryWorkspace.cwd, "/x");
    assert.equal((await call(b.url, "GET", `/api/companies/${co.id}/projects`)).json.length, 1);
    assert.equal((await call(b.url, "GET", "/api/companies/nope")).status, 404);
  } finally { await b.close(); }
});

test("bench: authentication, create, filters and delete", async () => {
  const b = await startStubBench({ seed: benchSeed() });
  try {
    assert.deepEqual((await call(b.url, "GET", "/api/method/ping")).json, { message: "pong" });
    assert.equal((await call(b.url, "GET", "/api/resource/Customer")).status, 401);
    assert.equal((await call(b.url, "GET", "/api/resource/Customer", { headers: benchAuth("a:b") })).status, 401);
    const bk = benchAuth(BENCH_KEYS.bookkeeper);
    const made = await call(b.url, "POST", "/api/resource/Sales%20Invoice", { body: { customer: "Acme Interiors", grand_total: 100 }, headers: bk });
    assert.equal(made.status, 200);
    assert.equal(made.json.data.docstatus, 0);
    assert.equal(made.json.data.owner, "bookkeeper@engine.localhost");
    assert.equal(made.json.data.name, "ACC-SINV-2026-00006");
    assert.ok(made.json.data.creation && made.json.data.modified);
    const f = (filters, extra = "") => `/api/resource/Sales%20Invoice?fields=${encodeURIComponent('["name","grand_total"]')}&filters=${encodeURIComponent(JSON.stringify(filters))}${extra}`;
    const drafts = (await call(b.url, "GET", f([["docstatus", "=", 0]]), { headers: bk })).json.data;
    assert.equal(drafts.length, 3);
    assert.deepEqual(Object.keys(drafts[0]), ["name", "grand_total"]);
    assert.equal((await call(b.url, "GET", f([["docstatus", "=", 1], ["grand_total", ">", 30000]]), { headers: bk })).json.data.length, 2); // 50000 and 118000
    assert.equal((await call(b.url, "GET", f([["grand_total", "<", 12000]]), { headers: bk })).json.data.length, 2);
    assert.equal((await call(b.url, "GET", f([["grand_total", ">=", 118000]]), { headers: bk })).json.data.length, 1);
    assert.equal((await call(b.url, "GET", f([["grand_total", "<=", 11800]]), { headers: bk })).json.data.length, 2);
    assert.equal((await call(b.url, "GET", f([["customer", "!=", "Acme Interiors"]]), { headers: bk })).json.data.length, 2);
    assert.equal((await call(b.url, "GET", f([["customer", "in", ["Northwind Traders"]]]), { headers: bk })).json.data.length, 2);
    assert.equal((await call(b.url, "GET", f([["customer", "not in", ["Northwind Traders"]]]), { headers: bk })).json.data.length, 4);
    assert.equal((await call(b.url, "GET", f([["customer", "like", "%north%"]]), { headers: bk })).json.data.length, 2);
    assert.equal((await call(b.url, "GET", f([], "&limit_page_length=2"), { headers: bk })).json.data.length, 2);
    const ordered = (await call(b.url, "GET", f([], "&order_by=" + encodeURIComponent("grand_total desc")), { headers: bk })).json.data;
    assert.equal(ordered[0].grand_total, 118000);
    // bookkeeper cannot reach other doctypes
    assert.equal((await call(b.url, "GET", "/api/resource/CRM%20Lead", { headers: bk })).status, 403);
    // one, update, delete
    const name = made.json.data.name;
    const one = await call(b.url, "GET", `/api/resource/Sales%20Invoice/${name}`, { headers: bk });
    assert.equal(one.json.data.grand_total, 100);
    assert.equal((await call(b.url, "PUT", `/api/resource/Sales%20Invoice/${name}`, { body: { grand_total: 200 }, headers: bk })).json.data.grand_total, 200);
    assert.equal((await call(b.url, "DELETE", `/api/resource/Sales%20Invoice/${name}`, { headers: bk })).status, 403);
    assert.equal((await call(b.url, "DELETE", `/api/resource/Sales%20Invoice/${name}`, { headers: benchAuth(BENCH_KEYS.owner) })).status, 200);
    const gone = await call(b.url, "GET", `/api/resource/Sales%20Invoice/${name}`, { headers: bk });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.exc_type, "DoesNotExistError");
  } finally { await b.close(); }
});

test("bench: submit is refused for an agent user and allowed for the owner", async () => {
  const b = await startStubBench({ seed: benchSeed() });
  try {
    const owner = benchAuth(BENCH_KEYS.owner);
    const doc = (await call(b.url, "GET", "/api/resource/Sales%20Invoice/ACC-SINV-2026-00001", { headers: owner })).json.data;
    const refused = await call(b.url, "POST", "/api/method/frappe.client.submit", { body: { doc }, headers: benchAuth(BENCH_KEYS.bookkeeper) });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.exc_type, "PermissionError");
    assert.equal(b.state.docs["Sales Invoice"][0].docstatus, 0);
    const ok = await call(b.url, "POST", "/api/method/frappe.client.submit", { body: { doc }, headers: owner });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.message.docstatus, 1);
    assert.equal(b.state.docs["Sales Invoice"][0].docstatus, 1);
    assert.equal((await call(b.url, "POST", "/api/method/frappe.client.submit", { body: { doc }, headers: owner })).status, 417);
  } finally { await b.close(); }
});

test("bench: comments, missing doctypes and recorded requests", async () => {
  const b = await startStubBench({ seed: { ...benchSeed(), missingDoctypes: ["CRM Lead"] } });
  try {
    const owner = benchAuth(BENCH_KEYS.owner);
    const c = await call(b.url, "POST", "/api/method/frappe.desk.form.utils.add_comment", {
      body: { reference_doctype: "Sales Invoice", reference_name: "ACC-SINV-2026-00001", content: "Please fix the tax", comment_email: "Administrator", comment_by: "Administrator" }, headers: owner,
    });
    assert.equal(c.status, 200);
    assert.equal(b.state.comments.length, 1);
    assert.equal(b.state.comments[0].content, "Please fix the tax");
    assert.equal((await call(b.url, "POST", "/api/method/frappe.desk.form.utils.add_comment", { body: {}, headers: owner })).status, 400);
    const miss = await call(b.url, "GET", "/api/resource/CRM%20Lead?limit_page_length=1", { headers: owner });
    assert.equal(miss.status, 404);
    assert.equal(miss.json.exc_type, "DoesNotExistError");
    assert.equal((await call(b.url, "GET", "/api/resource/CRM%20Deal?limit_page_length=1", { headers: owner })).status, 200);
    const last = b.requests.at(-1);
    assert.equal(last.method, "GET");
    assert.equal(last.path, "/api/resource/CRM%20Deal");
    assert.equal(last.query.limit_page_length, "1");
    assert.equal(last.headers.authorization, `token ${BENCH_KEYS.owner}`);
    assert.equal(b.requests[0].body.reference_name, "ACC-SINV-2026-00001");
  } finally { await b.close(); }
});

test("seed: bench counts match the contract", () => {
  const s = benchSeed({ now: new Date("2026-11-11T05:00:00Z") });
  const n = (dt, ds) => s.docs[dt].filter((d) => ds === undefined || d.docstatus === ds).length;
  assert.equal(n("Sales Invoice", 0), 2);
  assert.equal(n("Sales Invoice", 1), 3);
  assert.equal(s.docs["Sales Invoice"].filter((d) => d.docstatus === 1 && d.outstanding_amount > 0).length, 1);
  assert.equal(n("Purchase Invoice", 0), 1);
  assert.equal(n("Purchase Invoice", 1), 2);
  assert.equal(n("CRM Lead"), 4);
  assert.equal(new Set(s.docs["CRM Lead"].map((d) => d.status)).size, 3);
  assert.equal(n("CRM Deal"), 2);
  assert.equal(n("HD Ticket"), 3);
  assert.equal(s.docs["HD Ticket Comment"].filter((d) => d.content.startsWith("DRAFT REPLY:")).length, 1);
  assert.equal(n("Employee"), 3);
  assert.equal(n("Leave Application", 0), 1);
  assert.equal(s.users[BENCH_KEYS.owner].canSubmit, true);
  assert.equal(Object.values(s.users).filter((u) => u.email.endsWith("@engine.localhost") && !u.canSubmit && !u.canDelete).length, 4);
  assert.equal(s.docs["Sales Invoice"][0].posting_date, "2026-11-11");
});

test("seed: state-seed files are in the pinned formats and agree with the board seed", () => {
  const root = path.join(here, "state-seed");
  const ids = JSON.parse(fs.readFileSync(path.join(root, "ids.json"), "utf8"));
  assert.equal(ids.companyId, IDS.company);
  assert.equal(ids.projectId, IDS.project);
  assert.deepEqual(ids.agents, IDS.agents);
  assert.equal(fs.readdirSync(path.join(root, "knowledge/docs")).length, 2);
  const lessons = fs.readFileSync(path.join(root, "lessons/builder.md"), "utf8").trim().split("\n");
  assert.equal(lessons.length, 2);
  for (const l of lessons) assert.match(l, /^- \d{4}-\d{2}-\d{2}: .+/);
  const content = path.join(root, "tasks/company-work/STH-2/content");
  const valid = [], bad = [];
  for (const f of fs.readdirSync(content)) {
    const m = /^---\ntitle: (.+)\nchannel: (.+)\n(?:planned: (.+)\n)?---\n/.exec(fs.readFileSync(path.join(content, f), "utf8"));
    const ok = m && ["post", "newsletter"].includes(m[2]) && /^\d{4}-\d{2}-\d{2}$/.test(m[3] || "");
    (ok ? valid : bad).push(f);
  }
  assert.equal(valid.length, 2);
  assert.equal(bad.length, 1);
  const cad = path.join(root, "tasks/company-work/STH-2/cad");
  assert.ok(fs.statSync(path.join(cad, "bracket.step")).size > 0);
  assert.ok(fs.existsSync(path.join(cad, "bracket.py")));
  const j = JSON.parse(fs.readFileSync(path.join(cad, "bracket.json"), "utf8"));
  assert.deepEqual(Object.keys(j).sort(), ["bbox", "made_at", "name", "script", "units", "volume_mm3"]);
  assert.equal(j.units, "mm");
  const proof = JSON.parse(fs.readFileSync(path.join(root, "proof/last.json"), "utf8"));
  assert.equal(proof.result, "holds");
  assert.equal(proof.lines.length, proof.passed + proof.failed + proof.skipped);
  const seed = boardSeed();
  assert.ok(seed.issues.find((i) => i.identifier === "STH-2").status === "done");
  assert.ok(seed.comments.some((c) => c.body.startsWith("RESULT:")));
  assert.ok(seed.comments.some((c) => /^VERDICT: PASS - /.test(c.body)));
});

// V60a: the question Sales raised on the live board (fixture read from it), moved into the seed's company and
// STH-1. The stub takes and refuses what the real board does; the bodies are also run through the board's own
// validators when they are installed, so the stub cannot drift from them unnoticed.
function liveQuestionSeed() {
  const fx = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "home", "server", "test", "fixtures-v60a", "sales-question.json"), "utf8"));
  const moved = JSON.parse(JSON.stringify({ a: fx.attentionItem, r: fx.interaction })
    .replaceAll(fx.interaction.companyId, IDS.company).replaceAll(fx.interaction.issueId, IDS.issues["STH-1"]));
  const s = boardSeed();
  s.attention.push(moved.a);
  s.threadInteractions = [moved.r];
  return { seed: s, iid: fx.interaction.id, qid: fx.interaction.payload.questions[0].id };
}

const PAPERCLIP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "@paperclipai");
async function realCheck(record, body) {
  const v = path.join(PAPERCLIP, "shared", "dist", "validators", "issue.js");
  const q = path.join(PAPERCLIP, "server", "dist", "vendor", "paperclip-runner", "contracts", "question-set.js");
  if (!fs.existsSync(v) || !fs.existsSync(q)) return null;
  const { respondIssueThreadInteractionSchema } = await import(v);
  const { parsePaperclipQuestionResponse } = await import(q);
  if (!respondIssueThreadInteractionSchema.safeParse(body).success) return false;
  const answers = {};
  for (const c of record.payload.questionSet.questions) {
    const a = body.answers.find((x) => x.questionId === c.id);
    if (a) answers[c.id] = c.answerMode === "text" ? (a.otherText != null ? { text: a.otherText } : {}) : { selectedOptionIds: a.optionIds };
  }
  try { parsePaperclipQuestionResponse(record.payload.questionSet, { schema: "paperclip.question_response.v1", answers }); return true; } catch { return false; }
}

test("board: a question set is answered only as the real board takes it", async () => {
  const { seed, iid, qid } = liveQuestionSeed();
  const record = seed.threadInteractions[0];
  const b = await startStubBoard({ seed });
  try {
    const base = `/api/issues/${IDS.issues["STH-1"]}/interactions/${iid}`;
    const listed = (await call(b.url, "GET", `/api/issues/${IDS.issues["STH-1"]}/interactions`)).json;
    assert.ok(listed.some((r) => r.id === iid && r.kind === "ask_user_questions"));
    assert.equal((await call(b.url, "POST", `${base}/accept`, { body: {} })).status, 422, "no Accept for a question");
    assert.equal((await call(b.url, "POST", `${base}/reject`, { body: {} })).status, 422, "no Decline for a question");
    const empty = { answers: [], summaryMarkdown: "I set it myself." };
    assert.equal((await call(b.url, "POST", `${base}/respond`, { body: empty })).status, 422, "what the home screen sent before");
    assert.notEqual(await realCheck(record, empty), true);
    const unknown = { answers: [{ questionId: "nope", optionIds: [], otherText: "x" }] };
    assert.equal((await call(b.url, "POST", `${base}/respond`, { body: unknown })).status, 422);
    const good = { answers: [{ questionId: qid, optionIds: [], otherText: "I set the status to Qualified myself." }] };
    const real = await realCheck(record, good);
    if (real !== null) assert.equal(real, true, "the board's own validators take it");
    const r = await call(b.url, "POST", `${base}/respond`, { body: good });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "answered");
    assert.equal(b.state.attention.some((i) => i.subject?.id === iid), false);
    assert.equal((await call(b.url, "POST", `${base}/respond`, { body: good })).status, 409, "a second answer is refused");
  } finally { await b.close(); }
});

test("board: an execution hold is shown, and cleared only by a resolve the real board would take", async () => {
  const seed = boardSeed();
  const issueId = IDS.issues["STH-1"];
  const agentId = seed.issues.find((i) => i.id === issueId).assigneeAgentId;
  const runId = "06b3d41e-2974-4a89-b233-a2e290b0266e";
  const actionId = "26db09b0-ee43-428c-8b27-eaef5fdebdcb";
  seed.heartbeatRuns.push({ id: runId, companyId: C, agentId, issueId, status: "cancelled", processPid: null, logBytes: null,
    errorCode: "legacy_disposition_repair_suppressed", startedAt: "2026-11-11T02:25:42.883Z", finishedAt: "2026-11-11T02:25:43.360Z", createdAt: "2026-11-11T02:25:42.750Z" });
  seed.recoveryActions = [{ id: actionId, companyId: C, sourceIssueId: issueId, kind: "active_run_watchdog", status: "resolved", ownerType: "board",
    returnOwnerAgentId: agentId, cause: "legacy_execution_requires_reconciliation", outcome: "blocked", nextAction: "Automatic recovery stopped.",
    evidence: { runId, automaticRecovery: { runId, policy: "preserve_without_replay_v1", replay: "blocked", actionOutcome: "unknown" } },
    updatedAt: "2026-11-11T02:25:53.844Z" }];
  const b = await startStubBoard({ seed });
  try {
    assert.equal((await call(b.url, "GET", `/api/issues/${IDS.issues["STH-2"]}/execution`)).json, null, "no run, no execution");
    let exec = (await call(b.url, "GET", `/api/issues/${issueId}/execution`)).json;
    assert.deepEqual([exec.runId, exec.recoveryAction, exec.execution.phase, exec.execution.label], [runId, null, "recovery_needed", "Stopped"]);
    const listed = (await call(b.url, "GET", `/api/issues/${issueId}/recovery-actions`)).json;
    assert.deepEqual([listed.active, listed.actions.map((a) => a.id)], [null, [actionId]]);
    assert.equal((await call(b.url, "GET", `/api/heartbeat-runs/${runId}`)).json.errorCode, "legacy_disposition_repair_suppressed");
    assert.equal((await call(b.url, "GET", `/api/heartbeat-runs/${IDS.issues["STH-2"]}`)).status, 404);
    const path = `/api/issues/${issueId}/recovery-actions/resolve`;
    const good = { actionId, outcome: "restored", sourceIssueStatus: "todo",
      executionReconciliation: { runId, providerStopped: true, actionOutcome: "not_performed", outcomeEvidence: "No process, no output and no log; nothing was performed." } };
    assert.equal((await call(b.url, "POST", path, { body: { ...good, sourceIssueStatus: "in_progress" } })).status, 400);
    assert.equal((await call(b.url, "POST", path, { body: { ...good, executionReconciliation: { ...good.executionReconciliation, runId: actionId } } })).status, 409);
    const t = Object.keys(b.state.tokens)[0];
    if (t) assert.equal((await call(b.url, "POST", path, { body: good, headers: bearer(t) })).status, 403, "only the owner");
    const r = await call(b.url, "POST", path, { body: good });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.issue.status, r.json.recoveryAction.status, r.json.recoveryAction.outcome], ["todo", "resolved", "handed_back"]);
    assert.ok(b.state.wakes.some((w) => w.issueId === issueId && w.reason === "issue_recovery_action_restored"));
    exec = (await call(b.url, "GET", `/api/issues/${issueId}/execution`)).json;
    assert.equal(exec.execution.phase, "queued");
    assert.deepEqual((await call(b.url, "GET", `/api/issues/${issueId}/recovery-actions`)).json.actions, []);
    assert.equal(b.state.resolves.length, 1);
  } finally { await b.close(); }
});
