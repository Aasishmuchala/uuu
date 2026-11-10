// Tests for engine/company/apply.mjs (CONTRACTS 5.2) against the stub board and a temp state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStubBoard } from "../../test/stubs/board.mjs";
import { startStrictBoard } from "./fixtures/strict-board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..", "..");
const APPLY = join(HERE, "..", "apply.mjs");
const FIXTURE = join(HERE, "fixtures", "company.json");

function makeEnv(boardPort) {
  const dir = mkdtempSync(join(tmpdir(), "apply-test-"));
  const cfg = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
  cfg.stateRoot = join(dir, "state");
  cfg.ports.board = boardPort;
  const cfgPath = join(dir, "config.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  return { dir, state: cfg.stateRoot, cfgPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runApply(env, args = []) {
  const childEnv = { ...process.env, ENGINE_CONFIG: env.cfgPath };
  delete childEnv.PAPERCLIP_API_URL;
  return new Promise((resolve) => {
    execFile(process.execPath, [APPLY, "--file", FIXTURE, ...args], { env: childEnv }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr, lines: stdout.trim().split("\n").filter(Boolean) });
    });
  });
}

const writesSince = (stub, from) => stub.requests.slice(from).filter((r) => r.method !== "GET");

function snapshot(root) {
  const out = {};
  if (!existsSync(root)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const st = statSync(p);
      out[p] = { ino: st.ino, mtimeMs: st.mtimeMs, mode: st.mode, text: e.isFile() ? readFileSync(p, "utf8") : null };
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out;
}

const agentByName = (stub, name) => stub.state.agents.find((a) => a.name === name);
const grantKeys = (stub, a) => (stub.state.memberGrants[a.membershipId] || []).map((g) => g.permissionKey).sort();

async function withBoard(fn, { seed } = {}) {
  const stub = await startStubBoard({ seed });
  const env = makeEnv(stub.port);
  try { await fn(stub, env); } finally { await stub.close(); env.cleanup(); }
}

test("first run creates the company, project, agents, rights, grants, instructions and files", () => withBoard(async (stub, env) => {
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.lines.at(-1), /^Applied: \d+ created, \d+ updated, \d+ unchanged\.$/);
  for (const l of r.lines.slice(0, -1)) assert.match(l, /^(created|updated|unchanged|left alone) /);

  assert.equal(stub.state.companies.length, 1);
  const co = stub.state.companies[0];
  assert.equal(co.name, "Sthyra");
  assert.equal(co.requireBoardApprovalForNewAgents, true);
  const project = stub.state.projects[0];
  assert.equal(project.name, "Company work");
  assert.equal(project.primaryWorkspace.cwd, join(env.state, "tasks", "company-work"));
  assert.equal(project.primaryWorkspace.sourceType, "local_path");

  assert.equal(stub.state.agents.length, 3);
  const chief = agentByName(stub, "Chief of staff");
  const checker = agentByName(stub, "Checker");
  const keeper = agentByName(stub, "Bookkeeper");
  for (const a of [chief, checker, keeper]) assert.equal(a.status, "idle", `${a.name} approved`);
  assert.deepEqual(
    { ...chief.adapterConfig },
    { cwd: join(env.state, "tasks", "agents", "chief-of-staff"), engine: "cli", command: "claude", timeoutSec: 900, model: "opus", maxTurnsPerRun: 40 },
  );
  assert.equal(chief.adapterType, "claude_local");
  assert.equal(checker.adapterType, "codex_local");
  assert.equal(checker.adapterConfig.command, "codex");
  assert.equal("model" in checker.adapterConfig, false);
  assert.equal(keeper.adapterConfig.maxTurnsPerRun, 60);
  assert.deepEqual(chief.runtimeConfig, { heartbeat: { enabled: false, maxConcurrentRuns: 1 } });
  assert.equal(chief.reportsTo, null);
  assert.equal(checker.reportsTo, chief.id);
  assert.equal(keeper.reportsTo, chief.id);
  assert.deepEqual(chief.permissions, { canAssignTasks: true, canCreateAgents: false, canCreateSkills: false });
  assert.deepEqual(checker.permissions, { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false });

  const creates = stub.requests.filter((q) => q.method === "POST" && /\/agents$/.test(q.path));
  assert.equal(creates.length, 3);
  for (const c of creates) assert.equal(c.body.runner, "legacy");

  assert.deepEqual(grantKeys(stub, chief), ["inbox:manage", "tasks:assign", "tasks:assign_scope", "tasks:manage_active_checkouts", "tools:use"]);
  assert.deepEqual(grantKeys(stub, checker), ["inbox:manage", "tasks:assign_scope", "tasks:manage_active_checkouts", "tools:use"]);
  const scope = stub.state.memberGrants[checker.membershipId].find((g) => g.permissionKey === "tasks:assign_scope").scope;
  assert.deepEqual(scope, { subtreeRootAgentId: checker.id });

  const text = stub.state.instructions[chief.id]["AGENTS.md"].content;
  assert.ok(text.includes("- Chief of staff: Turns the owner's goals into tasks.\n- Checker: Checks finished work.\n- Bookkeeper: Keeps the books as drafts."));
  assert.ok(!text.includes("{{TEAM}}"));
  const puts = stub.requests.filter((q) => q.method === "PUT");
  assert.equal(puts.length, 3);
  for (const p of puts) { assert.equal(p.body.path, "AGENTS.md"); assert.ok("baseRevisionId" in p.body); }

  const ids = JSON.parse(readFileSync(join(env.state, "ids.json"), "utf8"));
  assert.deepEqual(ids, {
    companyId: co.id, projectId: project.id, projectFolder: join(env.state, "tasks", "company-work"),
    agents: { "chief-of-staff": chief.id, checker: checker.id, bookkeeper: keeper.id },
  });

  const policyOf = (a) => join(env.state, "policy", `${a.id}.json`);
  for (const a of [chief, checker, keeper]) assert.equal(statSync(policyOf(a)).mode & 0o777, 0o644);
  assert.deepEqual(JSON.parse(readFileSync(policyOf(keeper), "utf8")), {
    agentId: keeper.id, slug: "bookkeeper", localServices: ["127.0.0.1:8120"],
    readFolders: [join(env.state, "knowledge", "docs")],
    lessonsFile: join(env.state, "lessons", "bookkeeper.md"),
    envFile: join(env.state, "secrets", "agents", "bookkeeper.env"), taskFolder: "read-write",
  });
  const cp = JSON.parse(readFileSync(policyOf(checker), "utf8"));
  assert.equal(cp.taskFolder, "read-only");
  assert.equal(cp.envFile, null);
  assert.deepEqual(cp.localServices, []);

  for (const s of ["chief-of-staff", "checker", "bookkeeper"]) {
    assert.equal(statSync(join(env.state, "lessons", `${s}.md`)).size, 0);
    assert.ok(statSync(join(env.state, "tasks", "agents", s)).isDirectory());
  }
  assert.ok(statSync(join(env.state, "knowledge", "docs")).isDirectory());
  assert.equal(existsSync(join(env.state, "secrets")), false, "apply never makes key files");

  for (const q of stub.requests) assert.equal(q.headers.authorization, undefined, `${q.method} ${q.path} carried Authorization`);
}));

test("a second run sends no write, rewrites no file and prints only unchanged lines", () => withBoard(async (stub, env) => {
  assert.equal((await runApply(env)).code, 0);
  writeFileSync(join(env.state, "lessons", "checker.md"), "- 2026-11-11: a lesson\n");
  const before = snapshot(env.state);
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(writesSince(stub, from), []);
  for (const l of r.lines.slice(0, -1)) assert.match(l, /^unchanged /);
  assert.match(r.lines.at(-1), /^Applied: 0 created, 0 updated, \d+ unchanged\.$/);
  assert.deepEqual(snapshot(env.state), before);
  assert.equal(readFileSync(join(env.state, "lessons", "checker.md"), "utf8"), "- 2026-11-11: a lesson\n");
}));

test("each drift on the board causes exactly one update", () => withBoard(async (stub, env) => {
  assert.equal((await runApply(env)).code, 0);
  const chief = () => agentByName(stub, "Chief of staff");
  const checker = () => agentByName(stub, "Checker");
  const keeper = () => agentByName(stub, "Bookkeeper");
  const cases = [
    ["model", () => { keeper().adapterConfig.model = "opus"; }, "PATCH", `/api/agents/${keeper().id}`, () => keeper().adapterConfig.model === "sonnet"],
    ["right", () => { checker().permissions.canAssignTasks = true; }, "PATCH", `/api/agents/${checker().id}/permissions`, () => checker().permissions.canAssignTasks === false],
    ["grant", () => { stub.state.memberGrants[checker().membershipId].push({ permissionKey: "agents:configure", scope: null }); },
      "PATCH", `/api/companies/${stub.state.companies[0].id}/members/${checker().membershipId}/permissions`,
      () => !grantKeys(stub, checker()).includes("agents:configure")],
    ["instruction", () => { stub.state.instructions[keeper().id]["AGENTS.md"].content = "changed by hand\n"; },
      "PUT", `/api/agents/${keeper().id}/instructions-bundle/file`, () => stub.state.instructions[keeper().id]["AGENTS.md"].content.startsWith("You are the Bookkeeper")],
    ["reportsTo", () => { keeper().reportsTo = null; }, "PATCH", `/api/agents/${keeper().id}`, () => keeper().reportsTo === chief().id],
  ];
  for (const [name, drift, method, path, fixed] of cases) {
    drift();
    const from = stub.requests.length;
    const r = await runApply(env);
    assert.equal(r.code, 0, `${name}: ${r.stderr}`);
    const w = writesSince(stub, from);
    assert.equal(w.length, 1, `${name}: ${JSON.stringify(w.map((x) => `${x.method} ${x.path}`))}`);
    assert.equal(w[0].method, method, name);
    assert.equal(w[0].path, path, name);
    assert.ok(fixed(), `${name} was put back`);
    assert.equal(r.lines.filter((l) => l.startsWith("updated ")).length, 1, `${name}: one updated line`);
    assert.match(r.lines.at(-1), /^Applied: 0 created, 1 updated, /);
  }
}));

test("an agent on the board that is not in the file is left alone", () => withBoard(async (stub, env) => {
  assert.equal((await runApply(env)).code, 0);
  const co = stub.state.companies[0];
  const res = await fetch(`${stub.url}/api/companies/${co.id}/agents`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Builder", role: "engineer", adapterType: "claude_local", adapterConfig: { cwd: "/somewhere" } }),
  });
  const extra = await res.json();
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.lines.includes("left alone agent Builder: not in the company file"));
  assert.deepEqual(writesSince(stub, from), []);
  assert.ok(!stub.requests.slice(from).some((q) => q.path.includes(extra.id)));
  assert.ok(agentByName(stub, "Builder"));
  assert.equal(existsSync(join(env.state, "policy", `${extra.id}.json`)), false);
}));

test("trial agents are adopted by name and corrected, not created again", () => withBoard(async (stub, env) => {
  const post = async (path, body) => (await fetch(stub.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const co = await post("/api/companies", { name: "Sthyra" });
  const trial = await post(`/api/companies/${co.id}/agents`, {
    name: "Chief of staff", role: "pm", title: "Chief of staff", capabilities: "Old words.",
    adapterType: "claude_local", permissions: { canAssignTasks: true },
    adapterConfig: { cwd: "/old/workspaces/chief-of-staff", model: "opus", engine: "cli", command: "claude", timeoutSec: 900, maxTurnsPerRun: 40, graceSec: 15 },
    runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
  });
  assert.equal(grantKeys(stub, agentByName(stub, "Chief of staff")).length, 14);
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(stub.state.agents.filter((a) => a.name === "Chief of staff").length, 1);
  const chief = agentByName(stub, "Chief of staff");
  assert.equal(chief.id, trial.id);
  assert.equal(chief.adapterConfig.cwd, join(env.state, "tasks", "agents", "chief-of-staff"));
  assert.equal(chief.adapterConfig.graceSec, 15, "settings apply does not own are kept");
  assert.equal(chief.capabilities, "Turns the owner's goals into tasks.");
  assert.ok(r.lines.some((l) => /^updated agent Chief of staff: .*default folder/.test(l)), r.stdout);
  assert.ok(r.lines.some((l) => /^updated grants of Chief of staff: removed .*agents:configure/.test(l)), r.stdout);
  assert.deepEqual(grantKeys(stub, chief), ["inbox:manage", "tasks:assign", "tasks:assign_scope", "tasks:manage_active_checkouts", "tools:use"]);
  assert.equal(stub.state.companies[0].requireBoardApprovalForNewAgents, true);
}));

test("--check writes nothing and exits 3 when something differs, 0 when not", () => withBoard(async (stub, env) => {
  let r = await runApply(env, ["--check"]);
  assert.equal(r.code, 3, r.stderr);
  assert.deepEqual(writesSince(stub, 0), []);
  assert.equal(existsSync(env.state), false, "no folder made");
  assert.ok(r.lines.some((l) => l.startsWith("would create agent Checker")));

  assert.equal((await runApply(env)).code, 0);
  let before = snapshot(env.state);
  let from = stub.requests.length;
  r = await runApply(env, ["--check"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.lines.at(-1), /^Nothing would change/);
  assert.deepEqual(writesSince(stub, from), []);

  agentByName(stub, "Checker").adapterConfig.cwd = "/elsewhere";
  stub.state.memberGrants[agentByName(stub, "Checker").membershipId].push({ permissionKey: "skills:create", scope: null });
  rmSync(join(env.state, "policy", `${agentByName(stub, "Bookkeeper").id}.json`));
  before = snapshot(env.state);
  from = stub.requests.length;
  r = await runApply(env, ["--check"]);
  assert.equal(r.code, 3);
  assert.deepEqual(writesSince(stub, from), []);
  assert.deepEqual(snapshot(env.state), before);
  assert.equal(agentByName(stub, "Checker").adapterConfig.cwd, "/elsewhere");
  assert.ok(r.lines.includes("would create fence policy of Bookkeeper"));
}));

test("board off: exit 1 with the pinned line and nothing written", async () => {
  const stub = await startStubBoard();
  const port = stub.port;
  await stub.close();
  const env = makeEnv(port);
  try {
    const r = await runApply(env);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `The board is not answering on port ${port}. Run: engine start\n`);
    assert.equal(existsSync(env.state), false);
  } finally { env.cleanup(); }
});

test("against a board that takes new agents only as hires, apply hires and approves them", () => withBoard(async (stub) => {
  const strict = await startStrictBoard(stub);
  const env = makeEnv(strict.port);
  try {
    const r = await runApply(env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(strict.seen.filter((q) => q.method === "POST" && q.path.endsWith("/agent-hires")).length, 3);
    assert.equal(strict.seen.filter((q) => q.method === "POST" && q.path.endsWith("/approve")).length, 3);
    for (const a of stub.state.agents) assert.equal(a.status, "idle");
    for (const q of strict.seen) assert.equal(q.headers.authorization, undefined);
    const from = strict.seen.length;
    const again = await runApply(env);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(strict.seen.slice(from).filter((q) => q.method !== "GET"), []);
  } finally { await strict.close(); env.cleanup(); }
}));

test("when the board refuses something, apply stops with one plain sentence", () => withBoard(async (stub) => {
  const strict = await startStrictBoard(stub, {
    refuse: [{ method: "PATCH", pattern: /\/members\/[^/]+\/permissions$/, status: 403, error: "Forbidden; token pcp_abcdefgh1234 not allowed" }],
  });
  const env = makeEnv(strict.port);
  try {
    const r = await runApply(env);
    assert.equal(r.code, 1);
    const lines = r.stderr.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^The board refused to set the grants of Chief of staff: Forbidden; token <hidden> not allowed\.$/);
    assert.ok(!r.stderr.includes("pcp_") && !r.stdout.includes("pcp_"));
    assert.equal(existsSync(join(env.state, "ids.json")), false);
    assert.deepEqual(readdirSync(join(env.state, "policy")), []);
  } finally { await strict.close(); env.cleanup(); }
}));

test("a company file that breaks the fence rules is refused before the board is asked anything", () => withBoard(async (stub, env) => {
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const bad = [
    [(d) => { d.agents[2].fencePolicy.localServices = ["127.0.0.1:3100"]; }, /port 3100/],
    [(d) => { d.agents[2].fencePolicy.localServices = ["example.com:443"]; }, /not 127\.0\.0\.1/],
    [(d) => { d.agents[2].fencePolicy.envFile = "{state}/../.ssh/id"; }, /key file/],
    [(d) => { d.agents[1].fencePolicy.readFolders = ["{state}/secrets"]; }, /read folder outside/],
    [(d) => { d.agents[1].fencePolicy.lessonsFile = "{state}/secrets/x"; }, /lessons file/],
    [(d) => { d.agents[1].grants = ["tools:use", "agents:configure"]; }, /agents:configure/],
    [(d) => { d.agents[1].rights = { canCreateAgents: true }; }, /may not create agents/],
    [(d) => { d.agents[1].slug = "../x"; }, /bad slug/],
  ];
  const dir = join(env.dir, "co");
  cpSync(join(HERE, "fixtures", "roles"), join(dir, "roles"), { recursive: true });
  for (const [change, why] of bad) {
    const d = structuredClone(doc);
    change(d);
    const f = join(dir, "company.json");
    writeFileSync(f, JSON.stringify(d));
    const childEnv = { ...process.env, ENGINE_CONFIG: env.cfgPath };
    const r = await new Promise((resolve) => execFile(process.execPath, [APPLY, "--file", f], { env: childEnv },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
    assert.equal(r.code, 1, String(why));
    assert.match(r.stderr, /^The company file is not usable: /);
    assert.match(r.stderr, why);
  }
  assert.equal(stub.requests.length, 0);
  assert.equal(existsSync(env.state), false);
}));
