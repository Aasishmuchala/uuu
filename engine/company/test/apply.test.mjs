// Tests for engine/company/apply.mjs (CONTRACTS 5.2) against the stub board and a temp state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStubBoard } from "../../test/stubs/board.mjs";
import { startStrictBoard } from "./fixtures/strict-board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..", "..");
const APPLY = join(HERE, "..", "apply.mjs");
const FIXTURE = join(HERE, "fixtures", "company.json");
const COMPANY = join(HERE, "..", "company.json");
// The instance folder the stub board (like paperclip) and the copied engine config both name.
const INSTANCE_ROOT = join(homedir(), ".paperclip", "instances", "default");
const DEFAULT_RIGHTS_LINE = "Default rights that paperclip gives every agent remain on the board and are blocked at the gate.";
// The fourteen grants paperclip gives every new agent (server/dist/lib/agent-permissions.js).
const FOURTEEN = [
  "agents:configure", "agents:suggest-changes", "audit:view_agent_actions", "inbox:manage", "skills:create",
  "skills:suggest-changes", "tasks:assign", "tasks:assign_scope", "tasks:manage_active_checkouts",
  "tools:manage_connections", "tools:manage_profiles", "tools:manage_runtime", "tools:use", "tools:view_audit",
];
const WITHOUT_ASSIGN = FOURTEEN.filter((k) => k !== "tasks:assign");

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

test("first run creates the company, project, agents, rights, instructions and files", () => withBoard(async (stub, env) => {
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
  // The four instructions settings are the board's own (its managed AGENTS.md folder).
  const managed = (a) => {
    const root = join(INSTANCE_ROOT, "companies", a.companyId, "agents", a.id, "instructions");
    return { instructionsBundleMode: "managed", instructionsRootPath: root, instructionsEntryFile: "AGENTS.md", instructionsFilePath: join(root, "AGENTS.md") };
  };
  assert.deepEqual(
    { ...chief.adapterConfig },
    { cwd: join(env.state, "tasks", "agents", "chief-of-staff"), engine: "cli", command: "claude", timeoutSec: 900, model: "opus", maxTurnsPerRun: 40, ...managed(chief) },
  );
  assert.deepEqual(
    { ...checker.adapterConfig },
    { cwd: join(env.state, "tasks", "agents", "checker"), engine: "cli", command: "codex", timeoutSec: 900, dangerouslyBypassApprovalsAndSandbox: true, ...managed(checker) },
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

  // The board's default grants stay; only tasks:assign follows canAssignTasks.
  assert.deepEqual(grantKeys(stub, chief), FOURTEEN);
  assert.deepEqual(grantKeys(stub, checker), WITHOUT_ASSIGN);
  assert.deepEqual(grantKeys(stub, keeper), WITHOUT_ASSIGN);
  assert.ok(!stub.requests.some((q) => q.path.includes("/members/")), "no member route is called");
  const rightsCalls = stub.requests.filter((q) => q.method === "PATCH" && q.path.endsWith("/permissions"));
  for (const q of rightsCalls) assert.deepEqual(Object.keys(q.body).sort(), ["canAssignTasks", "canCreateAgents", "canCreateSkills"]);
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
    ["tasks:assign where it should not be", () => { stub.state.memberGrants[checker().membershipId].push({ permissionKey: "tasks:assign", scope: null }); },
      "PATCH", `/api/agents/${checker().id}/permissions`, () => !grantKeys(stub, checker()).includes("tasks:assign")],
    ["tasks:assign missing", () => { const m = chief().membershipId; stub.state.memberGrants[m] = stub.state.memberGrants[m].filter((g) => g.permissionKey !== "tasks:assign"); },
      "PATCH", `/api/agents/${chief().id}/permissions`, () => grantKeys(stub, chief()).includes("tasks:assign")],
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
  assert.equal("graceSec" in chief.adapterConfig, false, "a launch setting the file does not have is removed");
  assert.equal(chief.capabilities, "Turns the owner's goals into tasks.");
  assert.ok(r.lines.some((l) => /^updated agent Chief of staff: .*default folder/.test(l)), r.stdout);
  assert.ok(r.lines.includes("updated agent Chief of staff: removed the setting graceSec"), r.stdout);
  assert.deepEqual(grantKeys(stub, chief), FOURTEEN);
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
  assert.equal(r.lines.at(-2), DEFAULT_RIGHTS_LINE);
  assert.deepEqual(writesSince(stub, from), []);
  assert.ok(grantKeys(stub, agentByName(stub, "Checker")).includes("agents:configure"), "default grants stay and do not fail the check");

  // tasks:assign in the wrong place is something apply controls, so the check fails on it.
  stub.state.memberGrants[agentByName(stub, "Checker").membershipId].push({ permissionKey: "tasks:assign", scope: null });
  r = await runApply(env, ["--check"]);
  assert.equal(r.code, 3);
  assert.ok(r.lines.includes("would update rights of Checker: may not assign tasks"), r.stdout);

  agentByName(stub, "Checker").adapterConfig.cwd = "/elsewhere";
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
    refuse: [{ method: "PATCH", pattern: /^\/api\/agents\/[^/]+\/permissions$/, status: 403, error: "Forbidden; token pcp_abcdefgh1234 not allowed" }],
  });
  const env = makeEnv(strict.port);
  try {
    const r = await runApply(env);
    assert.equal(r.code, 1);
    const lines = r.stderr.trim().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^The board refused to set the rights of Checker: Forbidden; token <hidden> not allowed\.$/);
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
    [(d) => { d.agents[1].grants = ["tools:use"]; }, /grants are not applied \(paperclip does not let the owner trim them; the gate blocks what they would open\), so remove the "grants" key from agent checker\.\n$/],
    [(d) => { d.defaults.grants = ["tools:use"]; }, /grants are not applied .*from defaults\.\n$/],
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

test("if the board still lets an agent assign tasks after the right is switched off, apply stops with one sentence", () => withBoard(async (stub) => {
  // A board that puts tasks:assign back on the Checker after every rights call.
  const after = ({ method, path }) => {
    const checker = agentByName(stub, "Checker");
    if (method === "PATCH" && checker && path === `/api/agents/${checker.id}/permissions`) {
      stub.state.memberGrants[checker.membershipId].push({ permissionKey: "tasks:assign", scope: null });
    }
  };
  const strict = await startStrictBoard(stub, { after });
  const env = makeEnv(strict.port);
  try {
    const r = await runApply(env);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.stderr, "The board still lets Checker assign tasks after that right was switched off, so nothing more was changed; check the agent's role and rights on the board, then run this again.\n");
    assert.equal(existsSync(join(env.state, "ids.json")), false);
    assert.deepEqual(readdirSync(join(env.state, "policy")), []);
  } finally { await strict.close(); env.cleanup(); }
}));

test("from the half-applied live state a run finishes the job without new agents, and the next run changes nothing", () => withBoard(async (stub) => {
  // The trial's three agents, made before the switch-over, with old settings and old instructions.
  const call = async (method, path, body) => (await fetch(stub.url + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const co = await call("POST", "/api/companies", { name: "Sthyra" });
  const trial = {};
  for (const [slug, name, role, adapterType] of [["chief-of-staff", "Chief of staff", "pm", "claude_local"], ["builder", "Builder", "engineer", "claude_local"], ["checker", "Checker", "qa", "codex_local"]]) {
    const made = await call("POST", `/api/companies/${co.id}/agents`, {
      name, role, title: name, capabilities: "Old words.", adapterType,
      permissions: { canAssignTasks: slug === "chief-of-staff", canCreateAgents: false, canCreateSkills: false },
      adapterConfig: { cwd: `/old/workspaces/${slug}`, engine: "cli", command: adapterType === "codex_local" ? "codex" : "claude", timeoutSec: 900 },
      runtimeConfig: { heartbeat: { enabled: false, maxConcurrentRuns: 1 } },
    });
    const cur = await call("GET", `/api/agents/${made.id}/instructions-bundle/file?path=AGENTS.md`);
    await call("PUT", `/api/agents/${made.id}/instructions-bundle/file?path=AGENTS.md`, { path: "AGENTS.md", content: "Trial instructions.\n", baseRevisionId: cur.revision.id });
    trial[slug] = made.id;
  }

  // Every agent of the company file (ten since the Artist joined); the trial made three of them.
  const total = JSON.parse(readFileSync(COMPANY, "utf8")).agents.length;
  // Run 1 stops where the live run stopped: after hiring and approving the new agents,
  // before instructions, bosses, the ids file and the policy files.
  const refuse = [{ method: "PATCH", pattern: /^\/api\/agents\/[^/]+\/permissions$/, status: 403, error: "Only human company members can be removed." }];
  const strict = await startStrictBoard(stub, { refuse });
  const env = makeEnv(strict.port);
  try {
    let r = await runApply(env, ["--file", COMPANY]);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(stub.state.agents.length, total);
    const fresh = stub.state.agents.filter((a) => !Object.values(trial).includes(a.id));
    assert.equal(fresh.length, total - 3);
    for (const a of fresh) {
      assert.equal(a.status, "idle", a.name);
      assert.deepEqual(grantKeys(stub, a), FOURTEEN, `${a.name} holds the default grants and tasks:assign`);
      assert.equal(a.permissions.canAssignTasks, false);
      assert.match(stub.state.instructions[a.id]["AGENTS.md"].content, /Paperclip company/);
    }
    for (const id of Object.values(trial)) assert.equal(stub.state.instructions[id]["AGENTS.md"].content, "Trial instructions.\n");
    assert.equal(existsSync(join(env.state, "ids.json")), false);
    assert.deepEqual(readdirSync(join(env.state, "policy")), []);

    // Run 2 carries on from there.
    refuse.length = 0;
    let from = strict.seen.length;
    r = await runApply(env, ["--file", COMPANY]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!strict.seen.slice(from).some((q) => q.method === "POST" && /\/(agents|agent-hires)$/.test(q.path)), "no agent is made again");
    assert.equal(stub.state.agents.length, total);
    assert.equal(new Set(stub.state.agents.map((a) => a.name)).size, total);
    const ids = JSON.parse(readFileSync(join(env.state, "ids.json"), "utf8"));
    assert.equal(Object.keys(ids.agents).length, total);
    for (const [slug, id] of Object.entries(trial)) assert.equal(ids.agents[slug], id, `${slug} kept its id`);
    const chief = ids.agents["chief-of-staff"];
    for (const [slug, id] of Object.entries(ids.agents)) {
      const a = stub.state.agents.find((x) => x.id === id);
      assert.deepEqual(grantKeys(stub, a), slug === "chief-of-staff" ? FOURTEEN : WITHOUT_ASSIGN, slug);
      assert.equal(a.reportsTo, slug === "chief-of-staff" ? null : chief, slug);
      assert.equal(a.adapterConfig.cwd, join(env.state, "tasks", "agents", slug));
      const text = stub.state.instructions[id]["AGENTS.md"].content;
      const role = readFileSync(join(HERE, "..", "roles", `${slug}.md`), "utf8");
      if (role.includes("{{TEAM}}")) assert.ok(text.includes("- Chief of staff: ") && !text.includes("{{TEAM}}"), slug);
      if (role.includes("{{STAGED}}")) assert.ok(text.includes("`00-brief.md`") && !text.includes("{{STAGED}}"), slug);
      if (!role.includes("{{TEAM}}") && !role.includes("{{STAGED}}")) assert.equal(text, role, slug);
      assert.equal(JSON.parse(readFileSync(join(env.state, "policy", `${id}.json`), "utf8")).slug, slug);
      assert.ok(existsSync(join(env.state, "lessons", `${slug}.md`)));
    }
    assert.ok(!strict.seen.some((q) => q.path.includes("/members/")));

    // Run 3 changes nothing, and the check passes with the one line about default rights.
    const before = snapshot(env.state);
    from = strict.seen.length;
    r = await runApply(env, ["--file", COMPANY]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(strict.seen.slice(from).filter((q) => q.method !== "GET"), []);
    for (const l of r.lines.slice(0, -1)) assert.match(l, /^unchanged /);
    assert.deepEqual(snapshot(env.state), before);
    r = await runApply(env, ["--file", COMPANY, "--check"]);
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.lines.at(-2), DEFAULT_RIGHTS_LINE);
    assert.match(r.lines.at(-1), /^Nothing would change/);
  } finally { await strict.close(); env.cleanup(); }
}));
