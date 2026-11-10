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

test("board: grants are replaced as a whole set; new agents get the default grants", async () => {
  const b = await startStubBoard({ seed: boardSeed() });
  try {
    b.state.companies[0].requireBoardApprovalForNewAgents = false;
    const made = await call(b.url, "POST", `/api/companies/${C}/agents`, { body: { name: "Lead", permissions: { canAssignTasks: true } } });
    assert.equal(made.status, 201);
    assert.equal(made.json.status, "idle");
    const full = (await call(b.url, "GET", `/api/agents/${made.json.id}`)).json;
    const keys = full.access.grants.map((g) => g.permissionKey).sort();
    assert.equal(keys.length, 14);
    assert.ok(keys.includes("tasks:assign") && keys.includes("agents:configure") && keys.includes("tools:use"));
    const memberId = full.access.membership.id;
    const put = await call(b.url, "PATCH", `/api/companies/${C}/members/${memberId}/permissions`, { body: { grants: [{ permissionKey: "tools:use" }, { permissionKey: "tasks:assign", scope: null }] } });
    assert.equal(put.status, 200);
    const after = (await call(b.url, "GET", `/api/agents/${made.json.id}`)).json;
    assert.deepEqual(after.access.grants.map((g) => g.permissionKey).sort(), ["tasks:assign", "tools:use"]);
    assert.equal((await call(b.url, "PATCH", `/api/companies/${C}/members/nobody/permissions`, { body: { grants: [] } })).status, 404);
    assert.equal((await call(b.url, "PATCH", `/api/companies/${C}/members/${memberId}/permissions`, { body: { grants: "all" } })).status, 400);
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
    const perm = await call(b.url, "PATCH", `/api/agents/${made.id}/permissions`, { body: { canAssignTasks: true } });
    assert.equal(perm.json.permissions.canAssignTasks, true);
    const co = await call(b.url, "PATCH", `/api/companies/${C}`, { body: { requireBoardApprovalForNewAgents: false } });
    assert.equal(co.json.requireBoardApprovalForNewAgents, false);
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
    const r = await call(b.url, "POST", `/api/issues/${IDS.issues["STH-1"]}/interactions/${IDS.interaction}/respond`, { body: { text: "blue" } });
    assert.equal(r.status, 200);
    assert.equal(b.state.interactions[0].action, "respond");
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
