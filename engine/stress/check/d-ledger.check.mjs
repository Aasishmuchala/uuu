// The ledger on two made-up passes: record, render, set, add, diff, checklist; nothing written outside a temp folder.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { findingId, load, record } from "../lib/ledger.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "ledger.mjs");
const dir = mkdtempSync(join(tmpdir(), "uuu-stress-ledger-check-"));
const env = { ...process.env, STRESS_OUT: join(dir, "out"), STRESS_LEDGER: join(dir, "LEDGER.md"), STRESS_LAUNCH: join(dir, "LAUNCH.md") };
const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8" });
describe("the ledger", () => {
  after(() => rmSync(dir, { recursive: true, force: true }));

  const base = { area: "browser", repro: "$N engine/stress/run.mjs browser --only x", expected: "no exception", actual: "TypeError" };

  test("findings get stable ids, one line each, and a second record of an id replaces the first", () => {
    const out = env.STRESS_OUT;
    const a = record({ ...base, severity: "high", check: "exception", target: "#/map", title: "The Map throws" }, { pass: 1, out });
    assert.equal(a.id, findingId("browser", "exception", "#/map"));
    assert.match(a.id, /^S-browser-[0-9a-f]{8}$/);
    record({ ...base, severity: "medium", check: "csp", target: "#/tasks", title: "A CSP report on Tasks" }, { pass: 1, out });
    record({ ...base, severity: "low", check: "longtask", target: "#/jobs", title: "A long task on Jobs" }, { pass: 1, out });
    record({ ...base, severity: "high", check: "exception", target: "#/map", title: "The Map throws (again)" }, { pass: 1, out });
    const one = load(1, { out });
    assert.equal(one.length, 3);
    assert.equal(one.find((r) => r.id === a.id).title, "The Map throws (again)");
    assert.equal(readFileSync(join(out, "pass-1", "findings.jsonl"), "utf8").trim().split("\n").length, 3);
    // pass 2: the Map is fixed (gone), CSP still there, one new
    record({ ...base, severity: "medium", check: "csp", target: "#/tasks", title: "A CSP report on Tasks" }, { pass: 2, out });
    record({ ...base, area: "routes", severity: "high", check: "5xx", target: "POST /api/x", title: "POST /api/x answers 500" }, { pass: 2, out });
    assert.throws(() => record({ ...base, severity: "urgent", check: "x" }, { pass: 2, out }), /severity urgent/);
  });

  test("render writes the ledger table; set and add change it", () => {
    run("set", findingId("browser", "csp", "#/tasks"), "--status", "fixed", "--fix", "Name the style in the CSP.", "--batch", "A", "--risky", "false");
    run("add", "--severity", "medium", "--area", "copy", "--title", "An unclear sentence on Health", "--repro", "open #/health", "--fix", "Say what to do next.", "--pass", "2");
    const said = run("render");
    assert.match(said, /findings written/);
    const md = readFileSync(env.STRESS_LEDGER, "utf8");
    assert.match(md, /^# Stress ledger/m);
    assert.match(md, /\| id \| severity \| area \| title \| repro \| fix \| status \|/);
    assert.match(md, /POST \/api\/x answers 500/);
    assert.match(md, /Name the style in the CSP\. \| fixed \(A\)/);
    assert.match(md, /An unclear sentence on Health/);
  });

  test("diff 1 2 lists what was cleared, what stays and what is new", () => {
    const text = run("diff", "1", "2");
    assert.match(text, /^DIFF pass 1 -> pass 2/m);
    assert.match(text, /cleared 3/);
    assert.match(text, /still open 0/);
    assert.match(text, /new in pass 2 2/);
    assert.match(text, /POST \/api\/x answers 500/);
    assert.match(text, /open of medium or higher in pass 2: 2/);
  });

  test("checklist writes the launch file from the last pass", () => {
    writeFileSync(join(env.STRESS_OUT, "pass-2", "not-covered.txt"), "apps: real apps not started in the stage\n");
    run("checklist");
    assert.ok(existsSync(env.STRESS_LAUNCH));
    const md = readFileSync(env.STRESS_LAUNCH, "utf8");
    assert.match(md, /from pass 2/);
    assert.match(md, /apps: real apps not started in the stage/);
  });
});
