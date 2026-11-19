// Sweep `agents` (PLAN-STRESS T5): one task from start to finish with no real model, through the copy's own wrapper
// and real fence. The stand-in program (agents/fake-claude.mjs) is written to <stage>/root/fake-claude, the copy's
// `fence.realClaude`; the copy's fence/bin/claude starts it inside the copy's fence-run and sandbox tool. A Builder turn
// asks the relay (the fake provider answers), reads its task through the gate, writes 00-brief.md, 01-plan.md and
// 04-summary.md and comments; a Checker turn reads them and posts "VERDICT: PASS". Then the Builder tries the seven
// things that must fail. The home must show the task's stages, its round and its verdict. Under load: 10 such runs at
// once, 3 rounds (--quick: one run).
//
// The stage is made under the owner's home folder (STRESS_STAGE_PARENT, ~/.uuu-stress-stages), not /private/tmp: the
// fence keeps an agent out of the owner's home and opens only its own folders again, so a state folder outside the
// home (as /private/tmp is) would be readable by any run and the secrets try would prove nothing. The live state lies
// in the home too. No app runs in this stage, so its socket paths do not matter.
//
// A forbidden try that succeeds is critical: the sweep records it and stops at once.
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE } from "../lib/stage.mjs";
import { call } from "../lib/http.mjs";
import { areaOfId, idsOf, notCovered, put, readText, setDoors, setModels, tryCall, writeEvidence } from "../doors/util.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE_PARENT = join(homedir(), ".uuu-stress-stages");
// TEST-NET-1 (RFC 5737): no host answers there, so a connect the fence let through reaches nothing, and the try
// still tells (it waits instead of being refused at once).
const OUTSIDE = { host: "192.0.2.1", port: 80 };
const TRIES = [
  "write outside its task folder", "read the state's secrets", "read another task's folder", "connect to an outside address",
  "connect to the board directly", "connect to the home", "connect to a door it is not on the list for",
];
const RUN_MS = 150_000;

export default async function agents(ctx) {
  const only = ctx.only ? areaOfId(ctx.only) : null;
  if (only && !["fence", "agents"].includes(only)) {
    ctx.log(`--only ${ctx.only}: not a finding of this sweep`);
    return;
  }
  mkdirSync(STAGE_PARENT, { recursive: true, mode: 0o700 });
  chmodSync(STAGE_PARENT, 0o700);
  const before = process.env.STRESS_STAGE_PARENT;
  process.env.STRESS_STAGE_PARENT = STAGE_PARENT;
  let stage;
  try {
    stage = await ctx.startStage({ dataset: "normal" });
  } finally {
    if (before === undefined) delete process.env.STRESS_STAGE_PARENT; else process.env.STRESS_STAGE_PARENT = before;
  }
  ctx.log(`stage ${stage.root}`);
  const w = setUp(ctx, stage);
  const board = await boardKeys(stage, w);
  const evidence = { stage: stage.root, outside: OUTSIDE, runs: [], tries: [], home: [], checks: {} };
  const stop = { critical: false };

  // 1. One whole run.
  const first = await wholeRun(ctx, stage, w, board, { round: 1, n: 0 }, stop);
  evidence.runs.push(first.summary);
  evidence.tries = first.tries;
  if (first.home) evidence.home.push(first.home);
  if (stop.critical) return finish(ctx, stage, w, evidence, true);

  // 2. Under load: 10 at once, 3 rounds.
  if (!ctx.quick) {
    for (let round = 1; round <= 3 && !stop.critical; round += 1) {
      const runs = await Promise.all(Array.from({ length: 10 }, (_, i) => wholeRun(ctx, stage, w, board, { round, n: round * 100 + i + 1 }, stop)));
      for (const r of runs) {
        evidence.runs.push(r.summary);
        if (r.home) evidence.home.push(r.home);
      }
      ctx.log(`load round ${round}: ${runs.filter((r) => r.summary.ok).length} of 10 whole`);
    }
    crossCheck(ctx, stage, w, evidence);
  }
  return finish(ctx, stage, w, evidence, stop.critical);
}

// ---- the stage's agents, policies and the stand-in ------------------------------------------------------------------

function setUp(ctx, stage) {
  const ids = idsOf(stage);
  const builder = ids.agents.builder;
  const checker = ids.agents.checker;
  if (!builder || !checker) throw new Error("the stage's ids.json has no builder or checker");
  setModels(stage, ["builder", "checker"]);
  // Generation on, for the Artist only: the Builder is not on its list, so the fence must keep it away from that port.
  setDoors(stage, { generate: { on: true }, viewer: { on: true } });
  const policy = join(stage.state, "policy");
  mkdirSync(policy, { recursive: true, mode: 0o755 });
  chmodSync(policy, 0o755);
  const pol = (id, slug, taskFolder) => put(join(policy, `${id}.json`), {
    agentId: id, slug, localServices: [], readFolders: [], lessonsFile: null, envFile: null, taskFolder,
  }, 0o644);
  pol(builder, "builder", "read-write");
  pol(checker, "checker", "read-only");
  // The stand-in, where the copy's config says the real program is.
  const top = join(stage.root, "root");
  copyFileSync(join(HERE, "fake-claude.mjs"), join(top, "fake-claude.mjs"));
  writeFileSync(join(top, "fake-claude"), `#!/bin/bash\n# The stress stage's stand-in for Claude Code. NODE_OPTIONS is dropped so the stage's guard does not\n# stand in front of the fence: what the fence lets through must be seen.\nexec /usr/bin/env -u NODE_OPTIONS "${NODE}" "${join(top, "fake-claude.mjs")}" "$@"\n`, { mode: 0o755 });
  // Another task's folder, with a file in it no run may read.
  const other = join(stage.state, "tasks", "company-work", "STH-9001");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "marker.txt"), "another task's file\n");
  const self = (() => {
    try {
      return execFileSync(join(stage.engineDir, "fence", "fence-run"), ["--self-check"], {
        cwd: stage.state, env: baseEnv(stage, null), encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    } catch (e) {
      return `failed: ${String(e.stderr || e.message).trim().split("\n")[0]}`;
    }
  })();
  ctx.log(`the copy's fence: ${self}`);
  if (!/The fence is ready/.test(self)) throw new Error(`the copy's fence is not ready in the stage (${self}); a harness problem`);
  notCovered(ctx, "agents: the copy's fence/prove.sh is not run whole in the stage (it stands in on a free app port of 3171-3189, a live port)");
  return { builder, checker, ids, other, companyId: ids.companyId, projectId: ids.projectId, gateRuns: 0, outsideFiles: [] };
}

async function boardKeys(stage, w) {
  const key = async (id) => {
    const r = await call(`${stage.urls.board}/api/agents/${id}/keys`, { method: "POST", headers: { "content-type": "application/json" }, body: { name: "stress" } });
    if (r.status !== 201 || !r.json || !r.json.token) throw new Error(`the stub board gave no key for ${id} (${r.status})`);
    return r.json.token;
  };
  return { builder: await key(w.builder), checker: await key(w.checker) };
}

function baseEnv(stage, agentId) {
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(stage.root, "home"), LANG: "en_US.UTF-8",
    // The sandbox tool is a Node program: under the stage's guard, its proxy can never reach past this Mac either.
    NODE_OPTIONS: `--import ${join(stage.engineDir, "stress", "lib", "netguard.mjs")}`,
    STRESS_PART: "fence", STRESS_STAGE_ROOT: stage.root,
  };
  if (agentId) env.PAPERCLIP_AGENT_ID = agentId;
  return env;
}

// ---- one run of the wrapper -----------------------------------------------------------------------------------------

function runWrapper(stage, { agentId, apiKey, taskId, cwd, input }) {
  return new Promise((resolve) => {
    const env = { ...baseEnv(stage, agentId), PAPERCLIP_API_KEY: apiKey, PAPERCLIP_TASK_ID: taskId };
    const child = spawn(join(stage.engineDir, "fence", "bin", "claude"), ["--print", "-", "--output-format", "stream-json"], {
      cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => err.push(c));
    const timer = setTimeout(() => {
      // Our own child, its command line in the stage: its whole group ends.
      let cmd = "";
      try { cmd = execFileSync("/bin/ps", ["-o", "command=", "-p", String(child.pid)], { encoding: "utf8" }); } catch { cmd = ""; }
      if (cmd.includes(stage.root)) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }
    }, RUN_MS);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, error: e.message, stdout: "", stderr: "" }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      const line = stdout.split("\n").reverse().find((l) => l.startsWith("STRESS-RESULT "));
      let result = null;
      try { result = line ? JSON.parse(line.slice("STRESS-RESULT ".length)) : null; } catch { result = null; }
      resolve({ code, result, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function makeTask(stage, w, tag) {
  const r = await call(`${stage.urls.board}/api/companies/${w.companyId}/issues`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: { title: `Stress price list ${tag}`, description: `A price list for the kitchen ranges (${tag}).`, assigneeAgentId: w.builder, projectId: w.projectId, status: "in_progress" },
  });
  if (r.status !== 201 || !r.json || !r.json.identifier) throw new Error(`the stub board made no task (${r.status})`);
  const folder = join(stage.state, "tasks", "company-work", r.json.identifier);
  mkdirSync(folder, { recursive: true });
  return { id: r.json.id, identifier: r.json.identifier, title: r.json.title, folder };
}

async function wholeRun(ctx, stage, w, board, { round, n }, stop) {
  const tag = `stress-run-${n}-${Math.random().toString(16).slice(2, 10)}`;
  const task = await makeTask(stage, w, tag);
  const escapes = [join(stage.state, `escape-${tag}.txt`), join(w.other, `escape-${tag}.txt`)];
  w.outsideFiles.push(...escapes);
  const input = (role) => ({
    role, task: { id: task.id, identifier: task.identifier, title: task.title }, companyId: w.companyId, tag, round: 1,
    ports: { board: stage.ports.board, home: stage.ports.home, generate: stage.ports.generate, gate: stage.ports.gate },
    outside: OUTSIDE, secretFile: join(stage.state, "secrets", "provider", "omega-key"), secretDir: join(stage.state, "secrets"),
    otherTask: w.other, escapes,
  });
  const summary = { n, round, tag, task: task.identifier, ok: false, builder: null, checker: null, problems: [] };
  const problem = (p) => summary.problems.push(p);

  const b = await runWrapper(stage, { agentId: w.builder, apiKey: board.builder, taskId: task.id, cwd: task.folder, input: input("builder") });
  if (!b.result) throw new Error(`the Builder's run did not come back from the fence (exit ${b.code}): ${b.stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}`);
  w.gateRuns += 1;
  summary.builder = { exit: b.code, steps: b.result.steps, env: b.result.env, argv: b.result.argv, crash: b.result.crash || null };
  ctx.check(1);

  // The seven tries first: one that succeeded stops everything.
  const tries = b.result.tries || [];
  for (const name of TRIES) {
    const t = tries.find((x) => x.try === name);
    ctx.check(1);
    if (!t) {
      problem(`try "${name}" was not made`);
      continue;
    }
    if (t.refused !== true) {
      stop.critical = true;
      ctx.record({
        severity: "critical", area: "fence", check: "forbidden-try", target: name,
        title: `An agent in the fence could ${name}`, expected: "the fence refuses it", actual: JSON.stringify(t.detail),
        suspectFiles: ["engine/fence/fence_plan.py", "engine/fence/fence-run"],
      });
      ctx.log(`CRITICAL: the Builder could ${name}: ${JSON.stringify(t.detail)}`);
    }
  }
  for (const f of escapes) {
    ctx.check(1);
    if (existsSync(f)) {
      stop.critical = true;
      ctx.record({ severity: "critical", area: "fence", check: "escape-file", target: f.replace(stage.root, "<stage>"), title: "An agent wrote a file outside its task folder", expected: "no file", actual: "the file is there" });
    }
  }
  if (stop.critical) return { summary, tries };

  // What the Builder's turn must have done.
  const s = b.result.steps || {};
  const want = (cond, what) => { ctx.check(1); if (!cond) problem(what); };
  want(b.result.env && b.result.env.hasRelayToken && /^http:\/\/127\.0\.0\.1:\d+$/.test(b.result.env.ANTHROPIC_BASE_URL || ""), "the wrapper gave no relay address and token");
  want(b.result.env && b.result.env.ANTHROPIC_MODEL === "stress-model", `the wrapper's pick is ${b.result.env && b.result.env.ANTHROPIC_MODEL}`);
  want((b.result.argv || []).includes("--disallowedTools") && (b.result.argv || []).includes("stress-model"), "the wrapper did not add --model <pick> and --disallowedTools");
  want(s.relay && s.relay.ok && s.relay.streamed, `the relay turn failed (${JSON.stringify(s.relay)})`);
  want(s.readTask && s.readTask.ok, `reading the task through the gate failed (${JSON.stringify(s.readTask)})`);
  want(s.files && Object.values(s.files).every((v) => v === "ok"), `writing the documents failed (${JSON.stringify(s.files)})`);
  want(s.comment && s.comment.status === 201, `the comment through the gate failed (${JSON.stringify(s.comment)})`);
  want(s.gateRefused && s.gateRefused.status === 403 && s.gateRefused.code === "gate_refused", `the gate did not refuse the secrets read (${JSON.stringify(s.gateRefused)})`);
  for (const f of ["00-brief.md", "01-plan.md", "04-summary.md"]) want(readText(join(task.folder, f)).includes(tag), `${f} is not in the task folder`);

  const c = await runWrapper(stage, { agentId: w.checker, apiKey: board.checker, taskId: task.id, cwd: task.folder, input: input("checker") });
  if (!c.result) throw new Error(`the Checker's run did not come back from the fence (exit ${c.code}): ${c.stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}`);
  w.gateRuns += 1;
  summary.checker = { exit: c.code, steps: c.result.steps, crash: c.result.crash || null };
  const cs = c.result.steps || {};
  want(cs.relay && cs.relay.ok, `the Checker's relay turn failed (${JSON.stringify(cs.relay)})`);
  want(cs.readFiles && Object.values(cs.readFiles).every((v) => v === "ok"), `the Checker could not read the Builder's documents (${JSON.stringify(cs.readFiles)})`);
  want(cs.comment && cs.comment.status === 201, `the Checker's comment failed (${JSON.stringify(cs.comment)})`);
  ctx.check(1);
  if (cs.checkerWrite === "written" || existsSync(join(task.folder, "checker-wrote.txt"))) {
    stop.critical = true;
    ctx.record({ severity: "critical", area: "fence", check: "read-only-folder", target: "checker", title: "The Checker wrote in its read-only task folder", expected: "EPERM", actual: String(cs.checkerWrite) });
    return { summary, tries };
  }

  // What the home shows.
  const home = await homeView(stage, w, task);
  summary.home = home.problems.length ? home.problems : "ok";
  for (const p of home.problems) problem(`home: ${p}`);
  ctx.check(home.checks);

  summary.ok = summary.problems.length === 0;
  if (!summary.ok) {
    const flow = summary.problems.filter((p) => !p.startsWith("home: "));
    if (flow.length) {
      ctx.record({
        severity: "high", area: "agents", check: "whole-run", target: flow[0].replace(/\(.*$/, "").trim(),
        title: `An agent's run on fake answers did not finish its task: ${flow[0]}`, expected: "every step of the turn works through the wrapper and the fence",
        actual: flow.join("; ").slice(0, 1500), suspectFiles: ["engine/fence/bin/claude", "engine/fence/fence-run", "engine/relay/relay.mjs", "engine/gate/gate.mjs"],
      });
    }
    const hp = summary.problems.filter((p) => p.startsWith("home: "));
    if (hp.length) {
      ctx.record({
        severity: "medium", area: "agents", check: "home-view", target: hp[0].replace(/\(.*$/, "").trim(),
        title: `The home's task view does not show a finished run as it is: ${hp[0].slice(6)}`, expected: "stages done, one round PASS well formed, nothing under Needs you",
        actual: hp.join("; ").slice(0, 1500), suspectFiles: ["engine/home/server/routes/task.mjs", "engine/home/server/lib/staged.mjs"],
      });
    }
  }
  return { summary, tries, home: { task: task.identifier, ...home.view } };
}

async function homeView(stage, w, task) {
  const problems = [];
  let checks = 0;
  const r = await tryCall(`${stage.urls.home}/api/tasks/${task.identifier}`, { timeoutMs: 15000 });
  checks += 1;
  if (r.status !== 200 || !r.json) return { problems: [`GET /api/tasks/${task.identifier} answered ${r.status || r.code}`], checks, view: null };
  const v = r.json;
  const stages = Array.isArray(v.stages) ? v.stages : [];
  const st = (id) => (stages.find((x) => x.id === id) || {}).state;
  for (const id of ["brief", "plan", "summary", "check"]) {
    checks += 1;
    if (st(id) !== "done") problems.push(`stage ${id} is ${st(id)}`);
  }
  for (const id of ["brief", "plan", "summary"]) {
    checks += 1;
    const s = stages.find((x) => x.id === id);
    if (!s || !s.doc) problems.push(`stage ${id} shows no document`);
  }
  const rounds = v.acceptance && Array.isArray(v.acceptance.rounds) ? v.acceptance.rounds : [];
  checks += 3;
  if (rounds.length !== 1) problems.push(`${rounds.length} rounds`);
  else {
    if (rounds[0].outcome !== "pass") problems.push(`the round's verdict is ${rounds[0].outcome}`);
    if (rounds[0].wellFormed !== true) problems.push("the round's check is not well formed");
  }
  checks += 1;
  if (!(v.acceptance && v.acceptance.checksPassed === 6 && v.acceptance.checksTotal === 6)) problems.push(`checks ${v.acceptance && v.acceptance.checksPassed}/${v.acceptance && v.acceptance.checksTotal}`);
  checks += 1;
  if (!Array.isArray(v.timeline)) problems.push("no timeline");
  checks += 1;
  if (!Array.isArray(v.needsYou) || v.needsYou.length !== 0) problems.push(`Needs you holds ${Array.isArray(v.needsYou) ? v.needsYou.length : "?"} item(s) for it`);
  checks += 1;
  const names = Array.isArray(v.files) ? v.files.map((f) => f.name || f.path || "") : [];
  if (!["00-brief.md", "01-plan.md", "04-summary.md"].every((n) => names.some((x) => String(x).endsWith(n)))) problems.push(`its files are ${JSON.stringify(names)}`);
  return {
    problems, checks,
    view: { stages: stages.map((s) => `${s.id}:${s.state}`), rounds: rounds.map((x) => ({ n: x.n, outcome: x.outcome, wellFormed: x.wellFormed })), needsYou: Array.isArray(v.needsYou) ? v.needsYou.length : null, timeline: Array.isArray(v.timeline) ? v.timeline.length : null },
  };
}

// After the load: no task folder holds another run's file.
function crossCheck(ctx, stage, w, evidence) {
  const base = join(stage.state, "tasks", "company-work");
  const tags = new Map(evidence.runs.filter((r) => r.task).map((r) => [r.task, r.tag]));
  const mixed = [];
  for (const [ident, tag] of tags) {
    let names = [];
    try { names = readdirSync(join(base, ident)); } catch { names = []; }
    for (const n of names) {
      const text = readText(join(base, ident, n));
      for (const [otherIdent, otherTag] of tags) if (otherIdent !== ident && text.includes(otherTag)) mixed.push(`${ident}/${n} holds ${otherIdent}'s text`);
    }
  }
  ctx.check(tags.size);
  evidence.checks.crossFolders = mixed.length ? mixed : "ok";
  if (mixed.length) {
    ctx.record({ severity: "critical", area: "fence", check: "cross-task", target: "company-work", title: "A task folder holds another task's file after runs at once", expected: "each folder only its own run's files", actual: mixed.slice(0, 10).join("; ") });
  }
}

function finish(ctx, stage, w, evidence, stopped) {
  // The gate's refusal log: one line a refused try (each turn made exactly one).
  const log = readText(join(stage.state, "logs", "gate-refusals.log")).split("\n").filter(Boolean);
  const secrets = log.filter((l) => / secrets$/.test(l));
  evidence.checks.gateRefusals = { lines: log.length, secretsLines: secrets.length, refusedTries: w.gateRuns };
  ctx.check(1);
  if (!stopped && (secrets.length !== w.gateRuns || log.length !== w.gateRuns)) {
    ctx.record({
      severity: "medium", area: "agents", check: "gate-refusal-log", target: "gate-refusals.log",
      title: "The gate's refusal log does not hold one line a refused try", expected: `${w.gateRuns} lines`, actual: `${log.length} lines, ${secrets.length} for the refused try`,
      suspectFiles: ["engine/gate/gate.mjs"],
    });
  }
  // Outside calls: only the planted tries may appear (and the home's known Omega Plus reads, README).
  const calls = stage.outsideCalls();
  const planted = (c) => c.host === OUTSIDE.host || c.host === `${OUTSIDE.host}`;
  const known = (c) => c.part === "home" && /omegaplusapi\.com$/.test(String(c.host));
  const other = calls.filter((c) => !planted(c) && !known(c));
  evidence.checks.outsideCalls = { total: calls.length, planted: calls.filter(planted).length, knownHome: calls.filter(known).length, other };
  ctx.check(1);
  if (other.length) {
    ctx.record({ severity: "critical", area: "agents", check: "outside-call", target: other.map((c) => `${c.part}:${c.host}`).join(","), title: "A staged process tried to reach past this Mac during the agent runs", expected: "no outside call but the planted tries", actual: JSON.stringify(other.slice(0, 5)) });
  }
  const file = writeEvidence(ctx, "agents", "forbidden.json", evidence);
  ctx.log(`evidence ${file}`);
  const whole = evidence.runs.filter((r) => r.ok).length;
  ctx.log(`${whole} of ${evidence.runs.length} runs whole; tries refused: ${evidence.tries.filter((t) => t.refused).length} of ${evidence.tries.length}${stopped ? "; STOPPED on a critical finding" : ""}`);
}
