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

test("job: the earlier task is named above the form by its title, as a link to it (M51 F9)", () => {
  const job = shape("job");
  const ask = job.asks.find((a) => a.kind === "task");
  const opt = ask.options[0];
  const title = opt.label.split(" · ")[0];
  assert.deepEqual(page.fromNote(job, opt.value), { title, href: `#/tasks/${opt.value}` });
  assert.deepEqual(page.fromNote(job, "STH-20", { id: opt.value, identifier: "STH-20", title: "Call write-up: Asha Kitchens" }),
    { title: "Call write-up: Asha Kitchens", href: "#/tasks/STH-20" }, "the task's own title when it is read");
  const withRef = { ...job, asks: job.asks.map((a) => (a.kind === "task" ? { ...a, options: [{ ...opt, ref: "STH-20" }] } : a)) };
  assert.deepEqual(page.fromNote(withRef, "STH-20"), { title, href: "#/tasks/STH-20" }, "matched by its ref too");
  assert.deepEqual(page.fromNote(job, "STH-999"), { title: "", href: "#/tasks/STH-999" });
  assert.equal(page.fromNote(job, null), null);
});

test("job: a job that follows earlier work, with nothing accepted to pick, says which job to run first (M51 F6)", () => {
  const job = {
    ready: true, asks: [{ id: "earlier", kind: "task", required: true, options: [] }],
    takes: { from: ["marketing/five-concepts"], after: [{ id: "marketing/five-concepts", title: "Five concepts before any design" }],
      waiting: { taskId: "e0000000-0000-4000-8000-000000000023", title: "Five concepts: Diwali offer" } },
  };
  const first = page.followsFirst(job, null);
  assert.equal(page.followsSentence(first), 'This follows "Five concepts before any design". Accept one first.');
  assert.deepEqual(first.after, [{ title: "Five concepts before any design", href: "#/jobs/marketing/five-concepts" }]);
  assert.deepEqual(first.waiting, { title: "Five concepts: Diwali offer", href: "#/tasks/e0000000-0000-4000-8000-000000000023" });
  assert.equal(page.followsFirst(job, "STH-20"), null, "with ?from= the question is answered");
  assert.equal(page.followsFirst({ ...job, asks: [{ ...job.asks[0], options: [{ value: "x", label: "X" }] }] }, null), null);
  assert.equal(page.followsFirst({ ...job, ready: false }, null), null, "a job that cannot start shows its own reason");
  assert.equal(page.followsFirst({ ...job, takes: { ...job.takes, waiting: null } }, null).waiting, null);
});

test("job: an unknown job is a 404 from the server", () => {
  assert.equal(page.isUnknown({ status: 404 }), true);
  assert.equal(page.isUnknown({ code: "job_not_found" }), true);
  assert.equal(page.isUnknown({ status: 500, code: "error" }), false);
  assert.equal(page.isUnknown(null), false);
});

test("job: a starter pack the job reads that is not in the files yet is offered; once added it stays, as present (M63 41)", () => {
  const job = { reads: [
    { file: "packs/captions.md", title: "The captions pack", need: "helps", state: "missing", starter: "captions" },
    { file: "pricing/terms.md", title: "Terms", need: "must", state: "missing", starter: null },
    { file: "packs/own.md", title: "Our own pack", need: "helps", state: "missing" },
    { file: "packs/carousel.md", title: "The carousel pack", need: "helps", state: "filled", starter: null },
    { file: "packs/bad.md", title: "Bad", need: "helps", state: "missing", starter: "../x" },
    { file: "packs/odd.md", title: "Odd", need: "helps", state: "empty", starter: "odd" },
  ] };
  assert.deepEqual(page.startersOf(job, {}), [{ id: "captions", title: "The captions pack", present: false }]);
  // After the add, the job is read again: the server no longer offers it, and the line shows it as present.
  const after = { reads: [{ file: "packs/captions.md", title: "The captions pack", need: "helps", state: "filled", starter: null }] };
  assert.deepEqual(page.startersOf(after, { captions: true }), [{ id: "captions", title: "The captions pack", present: true }]);
  assert.deepEqual(page.startersOf(after, {}), []);
  assert.deepEqual(page.startersOf(shape("job"), {}), []);
  assert.deepEqual(page.startersOf(null, null), []);
});

test("job: the starters route's answer and a failed request, in plain words (M63 41)", () => {
  assert.deepEqual(page.starterAnswer({ added: ["captions"], skipped: [] }, "captions"), { ok: true });
  assert.deepEqual(page.starterAnswer({ added: [], skipped: [{ id: "captions", why: "It is already in Packs." }] }, "captions"), { ok: true });
  assert.deepEqual(page.starterAnswer({ added: [], skipped: [{ id: "captions", why: "That starter page is not there." }] }, "captions"),
    { ok: false, text: "That starter page is not there." });
  assert.equal(page.starterAnswer(null, "captions").ok, false);
  assert.match(page.starterProblem({ offline: true }), /not answering\. Try again/);
  assert.equal(page.starterProblem({ status: 400, message: "That request was not understood." }), "That request was not understood.");
  assert.match(page.starterProblem(null), /could not be added\. Try again\./);
});

test("job: the page offers the starter pack through the Files page's route, with a keyboard-reachable button (M63 41)", () => {
  const src = readFileSync(fileURLToPath(new URL("../../pages/job.js", import.meta.url)), "utf8");
  assert.match(src, /api\.post\("\/api\/brain\/starters", \{ ids: \[id\] \}\)/);
  assert.match(src, /<\$\{Button\}[^>]*onClick=\$\{\(\) => add\(p\.id\)\}>/);
  assert.match(src, /"Add the starter pack"/);
  assert.match(src, /role="alert"/);
});

const CRAFT = () => shape("job").craft;

test("job: no craft, no Versions control and no extra field", () => {
  assert.equal(page.craftOf({}), null);
  assert.equal(page.craftOf({ craft: null }), null);
  assert.equal(page.startExtra(null, 3), null);
});

test("job: the choices follow what the job allows, preset to its default", () => {
  assert.deepEqual(page.versionChoices(CRAFT()), { allowed: [1, 3], preset: 3 });
  assert.deepEqual(page.versionChoices({ ...CRAFT(), versions: [1], default: 3 }), { allowed: [1], preset: 1 });
  assert.deepEqual(page.versionChoices({ ...CRAFT(), default: 1 }), { allowed: [1, 3], preset: 1 });
});

test("job: the estimate words are the server's, for the chosen number", () => {
  assert.equal(page.estimateWords(CRAFT(), 3), "About 55 to 100 minutes");
  assert.equal(page.estimateWords(CRAFT(), 1), "About 30 to 55 minutes");
  assert.equal(page.estimateWords({ ...CRAFT(), estimate: { 1: CRAFT().estimate["1"], 3: null } }, 3), "");
});

test("job: the last runs line needs exactly three; playbooks and review lines", () => {
  assert.equal(page.lastRunsLine(CRAFT()), "Your last runs took 42, 38 and 51 minutes.");
  assert.equal(page.lastRunsLine({ ...CRAFT(), lastRuns: [42, 38] }), "");
  assert.equal(page.lastRunsLine({ ...CRAFT(), lastRuns: [] }), "");
  assert.equal(page.playbooksLine(CRAFT()), "Reads these playbooks: sthyra-copywriting, aasish-design, creative-director.");
  assert.equal(page.playbooksLine({ playbooks: [] }), "");
  assert.match(page.reviewLine(CRAFT()), /art director looks at the result before you do/);
  assert.equal(page.reviewLine({ review: null }), "");
});

test("job: the start request carries versions as a number", () => {
  assert.deepEqual(page.startExtra(CRAFT(), 3), { versions: 3 });
  assert.deepEqual(page.startExtra(CRAFT(), 1), { versions: 1 });
  assert.deepEqual(page.startExtra(CRAFT(), "3"), { versions: 1 });
});

test("job: only the craft path of the start form turns the promised time off", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../pages/job.js"), "utf8");
  assert.equal((src.match(/timed=\$\{false\}/g) || []).length, 1, "one place, next to the Versions control");
  assert.match(src, /if \(!craft\) return html`<\$\{JobStart\}[^`]*queue=\$\{queue\} \/>`/, "no craft: today's line");
});
