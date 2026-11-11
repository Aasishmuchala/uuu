// Tests that apply sees and puts back every launch setting of an agent (plan revision R2, S4):
// the whole adapter configuration, the tool and runner, the run settings and the run environment.
// Stub board and a temp state only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStubBoard } from "../../test/stubs/board.mjs";
import { startStrictBoard } from "./fixtures/strict-board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..", "..");
const APPLY = join(HERE, "..", "apply.mjs");
const FIXTURE = join(HERE, "fixtures", "company.json");
// A value shaped like a secret. It must never be printed and never be sent back to the board.
const SECRET = "pcp_s3cr3tV4lu3Planted9x7";

function makeEnv(boardPort) {
  const dir = mkdtempSync(join(tmpdir(), "apply-launch-test-"));
  const cfg = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
  cfg.stateRoot = join(dir, "state");
  cfg.ports.board = boardPort;
  const cfgPath = join(dir, "config.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  return { dir, cfgPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runApply(env, args = []) {
  const childEnv = { ...process.env, ENGINE_CONFIG: env.cfgPath };
  delete childEnv.PAPERCLIP_API_URL;
  return new Promise((resolve) => {
    execFile(process.execPath, [APPLY, "--file", FIXTURE, ...args], { env: childEnv }, (err, stdout, stderr) => {
      assert.ok(!stdout.includes(SECRET) && !stderr.includes(SECRET), "a setting's value was printed");
      assert.ok(!/s3cr3t/i.test(stdout + stderr), "part of a setting's value was printed");
      resolve({ code: err ? err.code : 0, stdout, stderr, lines: stdout.trim().split("\n").filter(Boolean) });
    });
  });
}

const writesSince = (stub, from) => stub.requests.slice(from).filter((r) => r.method !== "GET");
const agentByName = (stub, name) => stub.state.agents.find((a) => a.name === name);
const launchOf = (a) => structuredClone({ adapterType: a.adapterType, adapterConfig: a.adapterConfig, runtimeConfig: a.runtimeConfig, env: a.defaultEnvironmentId ?? null });

async function withApplied(fn) {
  const stub = await startStubBoard();
  const env = makeEnv(stub.port);
  try {
    const first = await runApply(env);
    assert.equal(first.code, 0, first.stderr);
    const baseline = Object.fromEntries(stub.state.agents.map((a) => [a.name, launchOf(a)]));
    await fn(stub, env, baseline);
  } finally { await stub.close(); env.cleanup(); }
}

// Reported by --check (exit 3, nothing written), put back by apply, then --check passes and a
// second apply sends nothing. `check` and `fixed` are the lines each run must print.
async function driftAndRepair(stub, env, baseline, { name, agent, drift, check, fixed, writes = 1, after = (b) => b }) {
  drift(agentByName(stub, agent));
  let from = stub.requests.length;
  let r = await runApply(env, ["--check"]);
  assert.equal(r.code, 3, `${name}: ${r.stdout}${r.stderr}`);
  assert.deepEqual(writesSince(stub, from), [], `${name}: --check wrote`);
  for (const l of check) assert.ok(r.lines.includes(l), `${name}: missing "${l}" in\n${r.stdout}`);
  assert.match(r.lines.at(-1), /^Would change: 0 to create, \d+ to update, /);

  from = stub.requests.length;
  r = await runApply(env);
  assert.equal(r.code, 0, `${name}: ${r.stderr}`);
  for (const l of fixed) assert.ok(r.lines.includes(l), `${name}: missing "${l}" in\n${r.stdout}`);
  const w = writesSince(stub, from);
  assert.equal(w.length, writes, `${name}: ${JSON.stringify(w.map((x) => `${x.method} ${x.path}`))}`);
  for (const q of w) {
    assert.equal(q.method, "PATCH", name);
    assert.equal(q.path, `/api/agents/${agentByName(stub, agent).id}`, name);
    assert.ok(!JSON.stringify(q.body).includes(SECRET), `${name}: a planted value was sent back to the board`);
    if (q.body.adapterConfig) assert.equal(q.body.replaceAdapterConfig, true, `${name}: adapter settings are replaced, not merged`);
  }
  // `after` notes a board-managed setting that is now set at its expected value; it stays so.
  baseline[agent] = after(structuredClone(baseline[agent]));
  assert.deepEqual(launchOf(agentByName(stub, agent)), baseline[agent], `${name}: put back to what the company file says`);

  r = await runApply(env, ["--check"]);
  assert.equal(r.code, 0, `${name}: ${r.stdout}`);
  assert.match(r.lines.at(-1), /^Nothing would change/);
  from = stub.requests.length;
  r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(writesSince(stub, from), [], `${name}: the second apply wrote`);
  for (const l of r.lines.slice(0, -1)) assert.match(l, /^unchanged /, name);
}

test("every unexpected launch setting is reported by --check and put back by apply", () => withApplied(async (stub, env, baseline) => {
  const cases = [
    { name: "extra env", agent: "Bookkeeper",
      drift: (a) => { a.adapterConfig.env = { BENCH_KEY: { type: "plain", value: SECRET }, [SECRET]: "x" }; },
      check: ["would update agent Bookkeeper: unexpected setting env"], fixed: ["updated agent Bookkeeper: removed the setting env"] },
    { name: "extra extraArgs", agent: "Chief of staff",
      drift: (a) => { a.adapterConfig.extraArgs = ["--add-dir", "/", `--token=${SECRET}`]; },
      check: ["would update agent Chief of staff: unexpected setting extraArgs"], fixed: ["updated agent Chief of staff: removed the setting extraArgs"] },
    { name: "extra args", agent: "Checker",
      drift: (a) => { a.adapterConfig.args = ["-c", SECRET]; },
      check: ["would update agent Checker: unexpected setting args"], fixed: ["updated agent Checker: removed the setting args"] },
    { name: "changed command", agent: "Checker",
      drift: (a) => { a.adapterConfig.command = `/tmp/${SECRET}/codex`; },
      check: ["would update agent Checker: command"], fixed: ["updated agent Checker: command"] },
    { name: "changed cwd", agent: "Bookkeeper",
      drift: (a) => { a.adapterConfig.cwd = `/Users/someone/${SECRET}`; },
      check: ["would update agent Bookkeeper: default folder"], fixed: ["updated agent Bookkeeper: default folder"] },
    { name: "unknown key", agent: "Chief of staff",
      drift: (a) => { a.adapterConfig.mysteryHook = { run: SECRET }; },
      check: ["would update agent Chief of staff: unexpected setting mysteryHook"], fixed: ["updated agent Chief of staff: removed the setting mysteryHook"] },
    { name: "a key whose name is not plain", agent: "Chief of staff",
      drift: (a) => { a.adapterConfig[`x ${SECRET}`] = 1; },
      check: ["would update agent Chief of staff: unexpected setting a setting with an unusual name"],
      fixed: ["updated agent Chief of staff: removed the setting a setting with an unusual name"] },
    // Paperclip's own runner shows on the board as the adapter type paperclip_runner. Changing it
    // back keeps the adapter-agnostic settings (env among them), so apply replaces a second time.
    { name: "changed runner", agent: "Checker", writes: 2,
      drift: (a) => { a.adapterType = "paperclip_runner"; a.adapterConfig.provider = "codex"; a.adapterConfig.env = { OPENAI_API_KEY: SECRET }; },
      check: ["would update agent Checker: runner", "would update agent Checker: unexpected setting provider", "would update agent Checker: unexpected setting env"],
      fixed: ["updated agent Checker: runner", "updated agent Checker: removed the setting provider", "updated agent Checker: removed the setting env"] },
    { name: "changed tool", agent: "Bookkeeper",
      drift: (a) => { a.adapterType = "process"; a.adapterConfig.command = "/bin/sh"; },
      check: ["would update agent Bookkeeper: tool, command"], fixed: ["updated agent Bookkeeper: tool, command"] },
    { name: "instructions file somewhere else", agent: "Bookkeeper",
      drift: (a) => { a.adapterConfig.instructionsFilePath = `/tmp/${SECRET}/AGENTS.md`; },
      check: ["would update agent Bookkeeper: setting instructionsFilePath differs"], fixed: ["updated agent Bookkeeper: reset the setting instructionsFilePath"] },
    { name: "a legacy instructions path", agent: "Chief of staff",
      drift: (a) => { a.adapterConfig.agentsMdPath = `/tmp/${SECRET}.md`; },
      check: ["would update agent Chief of staff: unexpected setting agentsMdPath"], fixed: ["updated agent Chief of staff: removed the setting agentsMdPath"] },
    { name: "permission prompts switched back on is still a difference", agent: "Chief of staff",
      drift: (a) => { a.adapterConfig.dangerouslySkipPermissions = false; },
      check: ["would update agent Chief of staff: setting dangerouslySkipPermissions differs"], fixed: ["updated agent Chief of staff: reset the setting dangerouslySkipPermissions"],
      after: (b) => { b.adapterConfig.dangerouslySkipPermissions = true; return b; } },
    { name: "codex's flag on a claude agent", agent: "Bookkeeper",
      drift: (a) => { a.adapterConfig.dangerouslyBypassApprovalsAndSandbox = true; },
      check: ["would update agent Bookkeeper: unexpected setting dangerouslyBypassApprovalsAndSandbox"],
      fixed: ["updated agent Bookkeeper: removed the setting dangerouslyBypassApprovalsAndSandbox"] },
    { name: "extra run settings", agent: "Checker",
      drift: (a) => { a.runtimeConfig.heartbeat.intervalSec = 60; a.runtimeConfig.aiConnection = { provider: "openai", secret: SECRET }; },
      check: ["would update agent Checker: unexpected run setting heartbeat.intervalSec", "would update agent Checker: unexpected run setting aiConnection"],
      fixed: ["updated agent Checker: removed the run setting heartbeat.intervalSec", "updated agent Checker: removed the run setting aiConnection"] },
    { name: "runs at once", agent: "Checker",
      drift: (a) => { a.runtimeConfig.heartbeat.maxConcurrentRuns = 5; },
      check: ["would update agent Checker: runs at once"], fixed: ["updated agent Checker: runs at once"] },
    { name: "a run environment", agent: "Chief of staff",
      drift: (a) => { a.defaultEnvironmentId = "11111111-2222-3333-4444-555555555555"; },
      check: ["would update agent Chief of staff: unexpected setting defaultEnvironmentId"], fixed: ["updated agent Chief of staff: removed the setting defaultEnvironmentId"] },
  ];
  for (const c of cases) await driftAndRepair(stub, env, baseline, c);
}));

test("several unexpected settings on one agent: one line each, one replace", () => withApplied(async (stub, env, baseline) => {
  await driftAndRepair(stub, env, baseline, {
    name: "several", agent: "Bookkeeper",
    drift: (a) => { Object.assign(a.adapterConfig, { env: { K: SECRET }, extraArgs: [SECRET], graceSec: 15, model: "opus" }); },
    check: ["would update agent Bookkeeper: model", "would update agent Bookkeeper: unexpected setting env",
      "would update agent Bookkeeper: unexpected setting extraArgs", "would update agent Bookkeeper: unexpected setting graceSec"],
    fixed: ["updated agent Bookkeeper: model", "updated agent Bookkeeper: removed the setting env",
      "updated agent Bookkeeper: removed the setting extraArgs", "updated agent Bookkeeper: removed the setting graceSec"],
  });
}));

test("the keys the board manages itself do not count as differences", () => withApplied(async (stub, env) => {
  const chief = agentByName(stub, "Chief of staff");
  const checker = agentByName(stub, "Checker");
  // What the board wrote by itself: the managed instructions paths on every agent, the bypass flag on codex.
  for (const a of stub.state.agents) {
    const root = join(homedir(), ".paperclip", "instances", "default", "companies", a.companyId, "agents", a.id, "instructions");
    assert.equal(a.adapterConfig.instructionsBundleMode, "managed");
    assert.equal(a.adapterConfig.instructionsRootPath, root);
    assert.equal(a.adapterConfig.instructionsEntryFile, "AGENTS.md");
    assert.equal(a.adapterConfig.instructionsFilePath, join(root, "AGENTS.md"));
  }
  assert.equal(checker.adapterConfig.dangerouslyBypassApprovalsAndSandbox, true);
  // And the claude flag the board persists when it picks a runner, at its default.
  chief.adapterConfig.dangerouslySkipPermissions = true;
  let r = await runApply(env, ["--check"]);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.lines.at(-1), /^Nothing would change/);
  const from = stub.requests.length;
  r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(writesSince(stub, from), []);
  assert.equal(chief.adapterConfig.dangerouslySkipPermissions, true);
}));

test("a correction keeps the agent's managed instructions settings", () => withApplied(async (stub, env, baseline) => {
  const keeper = agentByName(stub, "Bookkeeper");
  keeper.adapterConfig.env = { K: SECRET };
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  const patch = stub.requests.filter((q) => q.method === "PATCH" && q.path === `/api/agents/${keeper.id}`).at(-1);
  assert.equal(patch.body.replaceAdapterConfig, true);
  assert.equal(patch.body.adapterConfig.instructionsFilePath, baseline.Bookkeeper.adapterConfig.instructionsFilePath);
  assert.deepEqual(launchOf(keeper), baseline.Bookkeeper);
}));

test("if the board keeps an unexpected setting, apply stops with one sentence naming it", () => withApplied(async (stub, env) => {
  const keeper = agentByName(stub, "Bookkeeper");
  keeper.adapterConfig.env = { K: SECRET };
  // A board that puts the setting back after every update of the Bookkeeper.
  const after = ({ method, path }) => {
    if (method === "PATCH" && path === `/api/agents/${keeper.id}`) keeper.adapterConfig.env = { K: SECRET };
  };
  const strict = await startStrictBoard(stub, { after });
  const cfg = JSON.parse(readFileSync(env.cfgPath, "utf8"));
  cfg.ports.board = strict.port;
  writeFileSync(env.cfgPath, JSON.stringify(cfg));
  try {
    const r = await runApply(env);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(r.stderr, "The board still launches Bookkeeper with settings the company file does not have (env), so nothing more was changed; check the agent on the board, then run this again.\n");
    assert.equal(strict.seen.filter((q) => q.method === "PATCH" && q.path === `/api/agents/${keeper.id}`).length, 2);
  } finally { await strict.close(); }
}));
