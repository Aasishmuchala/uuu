// Job page: the pure parts, fed with the contract's shape files as sample data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const shape = (name) => JSON.parse(readFileSync(join(SHAPES, `${name}.json`), "utf8"));
const page = await import("../../pages/job.js");

test("job: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});

test("job: the overline is the department, then the cluster, in capitals", () => {
  const job = shape("job");
  assert.equal(page.overlineOf(job), "SALES · CALLS");
  assert.equal(page.overlineOf({ department: { title: "Marketing" } }), "MARKETING");
  assert.equal(page.overlineOf(null), "");
});

test("job: the address must be jobs, a department and a job", () => {
  assert.deepEqual(page.jobAddress(["jobs", "sales", "proposal-from-a-call"]), { department: "sales", id: "proposal-from-a-call" });
  assert.equal(page.jobAddress(["jobs", "sales"]), null);
  assert.equal(page.jobAddress(["jobs", "..", "x"]), null);
  assert.equal(page.jobAddress(["jobs", "sales", "a/b"]), null);
});

test("job: who does it is said in words", () => {
  assert.equal(page.whoLine({ who: [{ slug: "sales", name: "Sales" }] }), "Done by Sales.");
  assert.equal(page.whoLine({ who: [] }), "The Chief of staff plans it.");
  assert.equal(page.whoLine({ who: [{ name: "Sales" }, { name: "Artist" }] }), "Done by Sales and Artist. The Chief of staff plans it.");
});

test("job: the hand-off and the stage carry their one-liners", () => {
  const a = page.aboutLines(shape("job"));
  assert.equal(a.handoff, "The agent does the work. It counts only when you approve it.");
  assert.equal(a.stage, "Work passed from one agent to the next, with nothing copied by hand.");
  assert.deepEqual(page.aboutLines({ handoff: "x", stage: 9 }), { handoff: "", stage: "" });
});

test("job: a job that cannot start shows its reason, one that can shows none", () => {
  assert.deepEqual(page.startState({ ready: true }), { canStart: true, why: "" });
  assert.deepEqual(page.startState({ ready: false, why: "The books are switched off." }), { canStart: false, why: "The books are switched off." });
  assert.deepEqual(page.startState({ ready: false, why: { text: "Fill in \"Prices\" first.", link: null } }), { canStart: false, why: "Fill in \"Prices\" first." });
  assert.equal(page.startState({ ready: false }).canStart, false);
  assert.ok(page.startState({ ready: false }).why.length > 0);
});

test("job: ?from= is passed on only when it looks like a task", () => {
  assert.equal(page.fromOf(new URLSearchParams("from=STH-20")), "STH-20");
  assert.equal(page.fromOf(new URLSearchParams("from=e0000000-0000-4000-8000-000000000020")), "e0000000-0000-4000-8000-000000000020");
  assert.equal(page.fromOf(new URLSearchParams("from=../x")), null);
  assert.equal(page.fromOf(new URLSearchParams("")), null);
  assert.equal(page.fromOf(null), null);
});

test("job: the earlier task is named above the form", () => {
  const job = shape("job");
  const ask = job.asks.find((a) => a.kind === "task");
  const opt = ask.options[0];
  const ident = opt.label.split(" · ")[0];
  assert.equal(page.fromNote(job, ident), `Following the earlier task ${opt.label}.`);
  assert.equal(page.fromNote(job, opt.value), `Following the earlier task ${opt.label}.`);
  assert.equal(page.fromNote(job, "STH-999"), "Following an earlier task.");
  assert.equal(page.fromNote(job, null), "");
});

test("job: an unknown job is a 404 from the server", () => {
  assert.equal(page.isUnknown({ status: 404 }), true);
  assert.equal(page.isUnknown({ code: "job_not_found" }), true);
  assert.equal(page.isUnknown({ status: 500, code: "error" }), false);
  assert.equal(page.isUnknown(null), false);
});
