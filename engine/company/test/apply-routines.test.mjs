// Tests for apply's routine step (CONTRACTS-V2 section 18) against the stub board, a temp state
// and fixture routines. Never runs against the live board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStubBoard } from "../../test/stubs/board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..", "..");
const APPLY = join(HERE, "..", "apply.mjs");
const FIX = join(HERE, "fixtures");

const MORNING = "Write a short note for the owner about what happened since yesterday.\n\n"
  + "Produce: note.md in the goal's folder inside your current working folder.\nROUTINE: morning-note";
const SUMS = "FOR: Bookkeeper\nAdd up last week's draft invoices and list any that look wrong.\n\n"
  + "Produce: sums.md, sheets/*.csv in the goal's folder inside your current working folder.\nROUTINE: weekly-sums";

// A temp folder with the fixture company, its roles, the valid fixture routines and a config
// that points at a temp state and the stub board.
function makeEnv(boardPort) {
  const dir = mkdtempSync(join(tmpdir(), "apply-routines-"));
  const company = join(dir, "company");
  mkdirSync(join(company, "routines"), { recursive: true });
  cpSync(join(FIX, "company.json"), join(company, "company.json"));
  cpSync(join(FIX, "roles"), join(company, "roles"), { recursive: true });
  for (const f of ["morning-note.json", "weekly-sums.json"]) cpSync(join(FIX, "routines", "valid", f), join(company, "routines", f));
  const cfg = JSON.parse(readFileSync(join(ENGINE, "config.json"), "utf8"));
  cfg.stateRoot = join(dir, "state");
  cfg.ports.board = boardPort;
  const cfgPath = join(dir, "config.json");
  writeFileSync(cfgPath, JSON.stringify(cfg));
  const routineFile = (id) => join(company, "routines", `${id}.json`);
  return {
    dir, state: cfg.stateRoot, cfgPath, file: join(company, "company.json"), routineFile,
    editRoutine: (id, change) => {
      const doc = JSON.parse(readFileSync(routineFile(id), "utf8"));
      change(doc);
      writeFileSync(routineFile(id), JSON.stringify(doc, null, 2));
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function runApply(env, args = []) {
  const childEnv = { ...process.env, ENGINE_CONFIG: env.cfgPath };
  delete childEnv.PAPERCLIP_API_URL;
  return new Promise((resolve) => {
    execFile(process.execPath, [APPLY, "--file", env.file, ...args], { env: childEnv }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr, lines: stdout.trim().split("\n").filter(Boolean) });
    });
  });
}

const writesSince = (stub, from) => stub.requests.slice(from).filter((r) => r.method !== "GET");
const routineNamed = (stub, title) => stub.state.routines.find((r) => r.title === title);
const triggersOf = (stub, r) => stub.state.routineTriggers.filter((t) => t.routineId === r.id);
const readIds = (env) => JSON.parse(readFileSync(join(env.state, "ids.json"), "utf8"));

async function withApplied(fn) {
  const stub = await startStubBoard();
  const env = makeEnv(stub.port);
  try {
    const r = await runApply(env);
    assert.equal(r.code, 0, r.stderr);
    await fn(stub, env, r);
  } finally { await stub.close(); env.cleanup(); }
}

test("the first run creates each routine paused, for the Chief of staff, with one schedule and the pinned description", () => withApplied(async (stub, env, r) => {
  assert.ok(r.lines.includes("created routine Morning note (paused)"), r.stdout);
  assert.ok(r.lines.includes("created routine Weekly sums (paused)"), r.stdout);
  assert.match(r.lines.at(-1), /^Applied: \d+ created, \d+ updated, \d+ unchanged\.$/);
  const chief = stub.state.agents.find((a) => a.name === "Chief of staff");
  const project = stub.state.projects[0];
  assert.equal(stub.state.routines.length, 2);
  for (const [title, description] of [["Morning note", MORNING], ["Weekly sums", SUMS]]) {
    const rt = routineNamed(stub, title);
    assert.equal(rt.status, "paused", title);
    assert.equal(rt.assigneeAgentId, chief.id, title);
    assert.equal(rt.projectId, project.id, title);
    assert.equal(rt.priority, "medium");
    assert.equal(rt.concurrencyPolicy, "skip_if_active");
    assert.equal(rt.catchUpPolicy, "skip_missed");
    assert.equal(rt.description, description, title);
    assert.equal(rt.description.split("\n").at(-1), `ROUTINE: ${title === "Morning note" ? "morning-note" : "weekly-sums"}`);
  }
  const create = stub.requests.find((q) => q.method === "POST" && /\/routines$/.test(q.path));
  assert.deepEqual(Object.keys(create.body).sort(),
    ["assigneeAgentId", "catchUpPolicy", "concurrencyPolicy", "description", "priority", "projectId", "status", "title"]);
  const sums = routineNamed(stub, "Weekly sums");
  const t = triggersOf(stub, sums);
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, "schedule");
  assert.equal(t[0].cronExpression, "30 10 * * 1");
  assert.equal(t[0].timezone, "Asia/Kolkata");
  assert.equal(t[0].label, "Mondays at 10:30");
  assert.equal(t[0].enabled, true);
  assert.equal(triggersOf(stub, routineNamed(stub, "Morning note")).length, 1);
  assert.deepEqual(readIds(env).routines, { "morning-note": routineNamed(stub, "Morning note").id, "weekly-sums": sums.id });
}));

test("the second run sends no write and says each routine is unchanged", () => withApplied(async (stub, env) => {
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(writesSince(stub, from), []);
  assert.ok(r.lines.includes("unchanged routine Morning note"));
  assert.ok(r.lines.includes("unchanged routine Weekly sums"));
  for (const l of r.lines.slice(0, -1)) assert.match(l, /^unchanged /);
  const c = await runApply(env, ["--check"]);
  assert.equal(c.code, 0, c.stdout);
}));

test("a changed schedule patches the trigger only", () => withApplied(async (stub, env) => {
  env.editRoutine("weekly-sums", (d) => { d.when.cron = "0 11 * * 2"; d.when.plain = "Tuesdays at 11:00"; });
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  const w = writesSince(stub, from);
  assert.equal(w.length, 1, JSON.stringify(w.map((q) => `${q.method} ${q.path}`)));
  const trig = triggersOf(stub, routineNamed(stub, "Weekly sums"))[0];
  assert.equal(w[0].method, "PATCH");
  assert.equal(w[0].path, `/api/routine-triggers/${trig.id}`);
  assert.deepEqual(w[0].body, { cronExpression: "0 11 * * 2", label: "Tuesdays at 11:00" });
  assert.equal(trig.cronExpression, "0 11 * * 2");
  assert.ok(r.lines.includes("updated routine Weekly sums: schedule"), r.stdout);
  assert.equal(r.lines.filter((l) => l.startsWith("updated ")).length, 1);
}));

test("a changed ask patches the description only", () => withApplied(async (stub, env) => {
  env.editRoutine("morning-note", (d) => { d.ask = "Write a short note for the owner about what was finished since yesterday."; });
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  const w = writesSince(stub, from);
  const rt = routineNamed(stub, "Morning note");
  assert.equal(w.length, 1, JSON.stringify(w.map((q) => `${q.method} ${q.path}`)));
  assert.equal(w[0].method, "PATCH");
  assert.equal(w[0].path, `/api/routines/${rt.id}`);
  assert.deepEqual(Object.keys(w[0].body), ["description"]);
  assert.match(rt.description, /^Write a short note for the owner about what was finished since yesterday\.\n\nProduce: note\.md/);
  assert.ok(r.lines.includes("updated routine Morning note: ask"), r.stdout);
}));

test("a routine the owner switched on is still on after apply, and apply never sends a status after creating", () => withApplied(async (stub, env) => {
  const rt = routineNamed(stub, "Morning note");
  const res = await fetch(`${stub.url}/api/routines/${rt.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) });
  assert.equal(res.status, 200);
  env.editRoutine("morning-note", (d) => { d.title = "Morning letter"; d.when.timezone = "Europe/London"; });
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(rt.status, "active");
  assert.equal(rt.title, "Morning letter");
  assert.ok(r.lines.includes("updated routine Morning letter: title, schedule"), r.stdout);
  for (const q of writesSince(stub, from)) assert.ok(!(q.body && "status" in q.body), `${q.method} ${q.path} sends no status`);
  const again = await runApply(env);
  assert.equal(again.code, 0);
  assert.equal(rt.status, "active");
  assert.equal(stub.state.routines.length, 2, "nothing made twice");
}));

test("a board routine with no file is left alone, never deleted or changed", () => withApplied(async (stub, env) => {
  const co = stub.state.companies[0];
  const res = await fetch(`${stub.url}/api/companies/${co.id}/routines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Owner's own reminder", status: "active" }) });
  assert.equal(res.status, 201);
  const from = stub.requests.length;
  const r = await runApply(env);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.lines.includes("left alone routine Owner's own reminder: no routine file"), r.stdout);
  assert.deepEqual(writesSince(stub, from), []);
  assert.equal(routineNamed(stub, "Owner's own reminder").status, "active");
  assert.ok(!stub.requests.some((q) => q.method === "DELETE"));
}));

test("a routine on the board with the same title is adopted when ids.json does not know it", async () => {
  const stub = await startStubBoard();
  const env = makeEnv(stub.port);
  try {
    // A first run without routine files makes the company; then the owner makes one by hand.
    const keep = readFileSync(env.routineFile("morning-note"), "utf8");
    rmSync(join(dirname(env.file), "routines"), { recursive: true });
    assert.equal((await runApply(env)).code, 0);
    assert.equal("routines" in readIds(env), false, "no routines key without routine files");
    const co = stub.state.companies[0];
    await fetch(`${stub.url}/api/companies/${co.id}/routines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Morning note", status: "paused" }) });
    mkdirSync(join(dirname(env.file), "routines"));
    writeFileSync(env.routineFile("morning-note"), keep);
    const r = await runApply(env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(stub.state.routines.length, 1, "not made again");
    const rt = stub.state.routines[0];
    assert.equal(rt.description, MORNING);
    assert.equal(triggersOf(stub, rt).length, 1);
    assert.ok(r.lines.includes("updated routine Morning note: ask, assigned to the Chief of staff, schedule"), r.stdout);
    assert.deepEqual(readIds(env).routines, { "morning-note": rt.id });
  } finally { await stub.close(); env.cleanup(); }
});

test("a broken routine file stops apply with exit 1 before any write", async () => {
  const stub = await startStubBoard();
  const env = makeEnv(stub.port);
  try {
    env.editRoutine("weekly-sums", (d) => { delete d.title; });
    const r = await runApply(env);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, "The routine file weekly-sums.json is not usable: it has no title.\n");
    assert.equal(r.stdout, "");
    assert.equal(stub.requests.length, 0, "the board is not asked anything");
    assert.equal(existsSync(env.state), false, "no folder or file is written");
  } finally { await stub.close(); env.cleanup(); }
});

test("--check exits 3 when a routine would be created, and writes nothing", () => withApplied(async (stub, env) => {
  const doc = JSON.parse(readFileSync(env.routineFile("morning-note"), "utf8"));
  writeFileSync(env.routineFile("evening-note"), JSON.stringify({ ...doc, id: "evening-note", title: "Evening note" }));
  const before = readFileSync(join(env.state, "ids.json"), "utf8");
  const from = stub.requests.length;
  const r = await runApply(env, ["--check"]);
  assert.equal(r.code, 3, r.stdout);
  assert.ok(r.lines.includes("would create routine Evening note (paused)"), r.stdout);
  assert.deepEqual(writesSince(stub, from), []);
  assert.equal(stub.state.routines.length, 2);
  assert.equal(readFileSync(join(env.state, "ids.json"), "utf8"), before);
}));

test("no request to the board carries an Authorization header", () => withApplied(async (stub, env) => {
  env.editRoutine("weekly-sums", (d) => { d.when.cron = "0 12 * * 1"; d.ask = "Add up last week's draft invoices and list every one that looks wrong."; });
  assert.equal((await runApply(env)).code, 0);
  await runApply(env, ["--check"]);
  assert.ok(stub.requests.some((q) => /routine/.test(q.path) && q.method !== "GET"));
  for (const q of stub.requests) assert.equal(q.headers.authorization, undefined, `${q.method} ${q.path}`);
}));

test("with the stub board stopped, apply says so and makes no routine", async () => {
  const stub = await startStubBoard();
  const env = makeEnv(stub.port);
  await stub.close();
  try {
    const r = await runApply(env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^The board is not answering on port \d+\. Run: engine start\n$/);
    assert.equal(existsSync(join(env.state, "ids.json")), false);
    assert.deepEqual(existsSync(join(env.state, "policy")) ? readdirSync(join(env.state, "policy")) : [], []);
  } finally { env.cleanup(); }
});
