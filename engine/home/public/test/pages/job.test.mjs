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
  const branch = src.slice(src.indexOf("if (!craft) {"), src.indexOf("const chosen"));
  assert.match(branch, /return html`<\$\{JobStart\} job=\$\{seen\} from=\$\{from\} onStarted=\$\{onStarted\} queue=\$\{queue\}/, "no craft: today's line");
  assert.doesNotMatch(src.slice(src.indexOf("if (!craft)"), src.indexOf("const chosen")), /timed=/);
});

// PLAN-V5 C9, T45: the money words of a job that needs the generation door.
const NONE = { ...shape("job"), generation: null };
const FILM_JOB = { ...shape("job"), generation: { kind: "film", words: "A film takes long and costs money. First the Artist writes the shotlist, at no cost.", unit: 5, model: "gen4_turbo", ok: true } };
const VARIATIONS_JOB = { ...shape("job"), generation: { kind: "variations", words: "Each variation costs $0.08 with gen4_image; three cost $0.24. Pressing Start approves the cost of the number you choose; nothing else is spent.", unit: 8, model: "gen4_image", ok: true } };
const NO_PRICE = { ...shape("job"), generation: { kind: "variations", words: "The model chosen in Settings has no price, so this job cannot start.", unit: null, model: null, ok: false } };

test("job: the money words are the server's, and a job without `generation` shows nothing", () => {
  assert.equal(page.generationOf(NONE), null);
  assert.equal(page.generationOf({ ...shape("job"), generation: null }), null);
  assert.equal(page.moneyWords(NONE), null);
  assert.equal(page.generationOf(FILM_JOB).words, FILM_JOB.generation.words);
  assert.equal(page.moneyWords(VARIATIONS_JOB).words, VARIATIONS_JOB.generation.words);
  assert.equal(page.generationOf({ generation: { kind: "film", words: "", ok: true } }), null);
});

test("job: a film's estimate is labelled The shotlist:, no other job's is", () => {
  assert.equal(page.estimateLabel(FILM_JOB), "The shotlist:");
  assert.equal(page.estimateLabel(VARIATIONS_JOB), "");
  assert.equal(page.estimateLabel(NONE), "");
});

test("job: with no price Start is off and the server's words stand in its place; otherwise the job is as it was", () => {
  const gated = page.gatedJob(NO_PRICE);
  assert.equal(gated.ready, false);
  assert.equal(gated.why.text, NO_PRICE.generation.words);
  assert.deepEqual(gated.why.link, { page: "settings", id: null });
  assert.equal(page.startState(gated).canStart, false);
  assert.equal(page.moneyWords(NO_PRICE), null, "said once, in place of Start");
  assert.equal(page.gatedJob(FILM_JOB), FILM_JOB);
  assert.equal(page.gatedJob(NONE), NONE);
  const off = { ...NO_PRICE, ready: false, why: { text: "Generation is off or has no key yet. Open Settings.", link: null } };
  assert.equal(page.gatedJob(off), off, "an earlier reason is kept");
});

// PLAN-V5 K16, T54: a job that makes a page says, under its estimate, what the page viewer adds.
test("job: a page's job says the viewer opens each version and must be on; no other kind says it", () => {
  assert.equal(page.PAGE_WORDS, "Each version is opened in the page viewer and fixed up to three times, which adds a few minutes a version. The page viewer must be on.");
  assert.equal(page.pageLine({ kind: "page", review: "art", versions: [1, 3] }), page.PAGE_WORDS);
  for (const kind of ["carousel", "post", "film", "", undefined]) assert.equal(page.pageLine({ kind }), "", String(kind));
  assert.equal(page.pageLine(null), "");
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "job.js"), "utf8");
  const estimate = src.slice(src.indexOf('<div class="p-job__estimate"'), src.indexOf("</fieldset>"));
  assert.ok(estimate.indexOf("${money ?") < estimate.indexOf("${page ?") && estimate.indexOf("${page ?") < estimate.indexOf("p-job__promise"),
    "the line stands under the estimate and its money, before the promise");
});

// PLAN-COOK T62: the column layout, the crumbs Jobs / <name>, the kit's money block, the preview beside from 1100 px.
test("job: the words the page adds are pinned (T62)", () => {
  assert.deepEqual({ ...page.JOB_WORDS }, {
    needs: "What it needs",
    needsLine: "Answer these questions, then start it.",
    facts: "About this job",
    allJobs: "Jobs",
    handoff: "Hand-off",
    stage: "Stage",
    who: "Done by",
  });
  assert.equal(page.BESIDE, "(min-width: 1100px)");
});

test("job: the crumbs are Jobs / <the job's name>; no chip and no creature (T62, O2)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "job.js"), "utf8");
  assert.match(src, /const crumbs = \[\{ label: JOB_WORDS\.allJobs, href: "#\/jobs" \}, \{ label: text\(job\.title\) \}\];/);
  assert.match(src, /crumbs=\$\{crumbs\}/);
  assert.doesNotMatch(src, /creature=|chip=/);
});

test("job: the money sentence is the kit's money block in its words-only form; the shotlist's classes are not used (T62)", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "job.js"), "utf8");
  assert.match(src, /<\$\{MoneyBlock\} words=\$\{generation\.words\} \/>/);
  assert.doesNotMatch(src, /k-sl__|k-site__/);
});

test("job: from 1100 px the preview stands in a 340 px column at the right, its top level with the title; the questions fill to 32 px from it with Start's bar their width (T62, TB3, R6-F)", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "pages", "job.css"), "utf8");
  const wide = css.slice(css.indexOf("@media (min-width: 1100px)"));
  assert.match(wide, /\.p-job:has\(\.k-job__preview\) \{\s*position: relative;\s*padding-right: calc\(340px \+ var\(--s-8\)\);/);
  assert.match(wide, /\.k-job--start > \.k-job__preview \{\s*position: absolute;\s*top: 0;\s*right: 0;\s*width: 340px;/);
  assert.match(wide, /\.k-job__asks \.k-input,\s*\.p-job \.k-job__asks \.k-textarea \{\s*max-width: none;/);
  assert.match(wide, /\.k-job--start > \.k-job__actions \{\s*position: sticky;/);
  assert.doesNotMatch(css, /var\(--glass|--highlight|--hairline/);
});

// PLAN-COOK TB3: the head's facts are label and value rows; no label is left without a value.
test("job: the head's facts are label and value rows, a row without a value left out (TB3)", () => {
  assert.deepEqual(page.factRows({ handoff: "you-approve", stage: 3, who: ["Artist"] }), [
    { label: "Hand-off", value: "You approve", about: "The agent does the work. It counts only when you approve it." },
    { label: "Stage", value: "3. Make", about: "Jobs that produce work." },
    { label: "Done by", value: "Artist", about: "" },
  ]);
  assert.deepEqual(page.factRows({ handoff: "nope", stage: 9, who: [{ name: "Sales" }, { name: "Artist" }] }), [
    { label: "Done by", value: "Sales and Artist", about: "The Chief of staff plans it." },
  ]);
  assert.deepEqual(page.whoFact({ who: [] }), { value: "The Chief of staff", about: "It plans the work." });
  assert.ok(page.factRows({}).every((f) => f.value), "every row has its value");
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "job.js"), "utf8");
  assert.doesNotMatch(src, /\$\{whoLine\(job\)\}/, "the 'Done by Artist.' line with no value is gone");
});

// PLAN-COOK R5-F: a fact's value on its own line with its explanation under it in the second ink; the fields no
// wider than what they hold (a choice about 240 px, a line about 560 px).
test("job: a fact's value over its explanation; the fields capped (R5-F)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pageCss = readFileSync(join(here, "..", "..", "styles", "pages", "job.css"), "utf8");
  assert.match(pageCss, /\.p-job \.p-job__fact dd \{[^}]*flex-direction: column;/, "the value, then its explanation under it");
  assert.match(pageCss, /\.p-job \.p-job__about \{[^}]*color: var\(--ink-2\);/);
  const kitCss = readFileSync(join(here, "..", "..", "styles", "kit", "job.css"), "utf8");
  assert.match(kitCss, /\.k-job__asks \.k-select \{[^}]*min-width: 240px;[^}]*max-width: min\(100%, 560px\);/);
  assert.match(kitCss, /\.k-job__asks \.k-input,\s*\.k-job__asks \.k-textarea \{\s*max-width: 560px;/);
});

// PLAN-COOK R7-F: the sticky Start bar is a solid band of the page's ground (a 1 px rule above, 16 px inside), so the
// form never shows sliced through it; the page ends with room as tall as the bar, so the last block clears it.
test("job: the Start bar is a solid band with a rule above and 16 px inside; the page leaves the bar's height under it (R7-F)", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "pages", "job.css"), "utf8");
  const wide = css.slice(css.indexOf("@media (min-width: 1100px)"));
  assert.match(wide, /\.k-job--start > \.k-job__actions \{\s*position: sticky;\s*bottom: 0;\s*z-index: 1;\s*padding: var\(--s-4\) 0;\s*border-top: 1px solid var\(--line\);\s*background: var\(--bg\);/);
  assert.match(wide, /\.p-job:has\(\.k-job__actions\) \{\s*padding-bottom: calc\(var\(--h-md\) \+ 2 \* var\(--s-4\) \+ 1px\);/);
});

// ---- Mounted in the test DOM with a fake fetch (PLAN-3D-ALL U11). No request leaves the test: the fake answers
// every one, so Start's request is recorded and nothing is spent. ----
const { FakeElement, html, render, installDom, elements, classesOf, walkDom } = await import("../kit/_dom.mjs");
const { AppContext } = await import("../../lib/context.js");
const JOB = () => shape("job");

// The home as the page reads it: the job (404 for "missing"), an earlier task, and what Start and the starters
// route answer.
async function mountJob(job, { addr = job ? job.id : "sales/missing", query = "", status = 200, recent = [], queue = null } = {}) {
  installDom();
  // Hidden, so the page's 10 s refresh never ticks during a mount: on a busy machine a mount can outlast it, and the
  // wire list is what the page sends on its own, not what the clock adds. The first load does not wait for it.
  globalThis.document.visibilityState = "hidden";
  const hash = `#/jobs/${addr}${query ? `?${query}` : ""}`;
  globalThis.location = { hash, href: `/${hash}`, search: "", pathname: "/" };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const calls = [];
  const real = globalThis.fetch;
  const answer = (code, body) => ({ ok: code < 400, status: code, json: async () => body });
  globalThis.fetch = async (path, opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}${opts.body === undefined ? "" : ` ${opts.body}`}`);
    const p = String(path);
    if (/\/start$/.test(p)) return answer(201, { ok: true, message: "Started.", goal: { id: "e0000000-0000-4000-8000-000000000099", identifier: "STH-99" } });
    if (p === "/api/brain/starters") return answer(200, { added: ["captions"], skipped: [] });
    if (p.startsWith("/api/tasks/")) return answer(200, { task: { id: "e0000000-0000-4000-8000-000000000020", identifier: "STH-20", title: "Call write-up: Asha Kitchens" } });
    if (p.startsWith("/api/jobs/")) return job && status === 200 ? answer(200, { job, recent, queue }) : answer(status === 200 ? 404 : status, { error: { code: "job_not_found", message: "That job is not here." } });
    return answer(404, { error: { code: "not_found", message: "Not found." } });
  };
  const tops = [];
  const ctx = { shell: { company: { name: "Sthyra" } }, setTop: (t) => tops.push(t), announce() {}, refreshShell() {}, openPanel() {}, closePanel() {}, settings: { motion: "off", theme: "dark" } };
  const root = new FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${page.default} /><//>`, root);
  await new Promise((r) => setTimeout(r, 300));
  return { root, calls, tops, done: () => { render(null, root); root.remove(); globalThis.fetch = real; delete globalThis.location; delete globalThis.window; } };
}
const fire = async (el, type, event = {}) => {
  const key = [type, type[0].toUpperCase() + type.slice(1)].find((k) => (el.listeners[k] || []).length);
  assert.ok(key, `${el.localName} listens for ${type}`);
  el.listeners[key][0].call(el, { type: key, preventDefault() {}, stopPropagation() {}, currentTarget: el, target: el, ...event });
  await new Promise((r) => setTimeout(r, 300));
};
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
const byText = (root, tag, words) => elements(root).find((e) => e.localName === tag && textNodes(e).join("").trim() === words);
const byCls = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
// The jobs the page is read on: the shape (versions and money), money with no versions, no price, a job that cannot
// start, one that follows earlier work with nothing to pick, one with a starter pack, and one that spends nothing.
const MONEY_ONLY = () => ({ ...JOB(), craft: null });
const NO_PRICE_JOB = () => ({ ...JOB(), craft: null, generation: { kind: "variations", words: "The model chosen in Settings has no price, so this job cannot start.", unit: null, model: null, ok: false } });
const NOT_READY = () => ({ ...JOB(), craft: null, generation: null, ready: false, why: { text: "The books are switched off.", link: { page: "health" } } });
const FOLLOWS = () => ({ ...JOB(), craft: null, generation: null, asks: [{ ...JOB().asks[0], options: [] }],
  takes: { ...JOB().takes, waiting: { taskId: "e0000000-0000-4000-8000-000000000023", title: "Call write-up: Diwali offer" } } });
const STARTER = () => ({ ...JOB(), craft: null, generation: null, reads: [...JOB().reads, { file: "packs/captions.md", title: "The captions pack", need: "helps", state: "missing", starter: "captions" }] });
const PLAIN = () => ({ ...JOB(), craft: null, generation: null });
const FILM = () => ({ ...JOB(), generation: { kind: "film", words: "A film takes long and costs money. First the Artist writes the shotlist, at no cost.", unit: 5, model: "gen4_turbo", ok: true } });

// Picks the first earlier task and presses Start (the form's submit).
const pickAndStart = async (m) => {
  const sel = elements(m.root).find((e) => e.localName === "select" && !e.getAttribute("disabled"));
  if (sel) await fire(sel, "change", { target: { value: JOB().asks[0].options[0].value } });
  await fire(elements(m.root).find((e) => e.localName === "form"), "submit");
};

test("job: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  const run = async (job, opts, act) => {
    const m = await mountJob(job, opts);
    try { if (act) await act(m); seen.push(...m.calls); } finally { m.done(); }
  };
  for (const j of [JOB(), MONEY_ONLY(), NO_PRICE_JOB(), NOT_READY(), FOLLOWS(), STARTER(), PLAIN(), FILM()]) await run(j);
  await run(JOB(), { query: "from=STH-20" });
  await run(null, { addr: "sales/missing" });
  await run(null, { addr: "sales/missing", status: 503 });
  await run(null, { addr: "../x/y" });
  // Start pressed with nothing answered: refused in the page, nothing sent.
  await run(MONEY_ONLY(), {}, async (m) => { await fire(elements(m.root).find((e) => e.localName === "form"), "submit"); });
  // Start on each spending path (the fake answers; nothing is spent): money with no versions, three versions, one.
  await run(MONEY_ONLY(), {}, pickAndStart);
  await run(JOB(), {}, pickAndStart);
  await run(JOB(), {}, async (m) => { await fire(byText(m.root, "button", "One (fastest)"), "click"); await pickAndStart(m); });
  await run(FILM(), { query: "from=STH-20" }, async (m) => { await fire(elements(m.root).find((e) => e.localName === "form"), "submit"); });
  // No price: Start is off; a submit sends nothing.
  await run(NO_PRICE_JOB(), {}, async (m) => { await fire(elements(m.root).find((e) => e.localName === "form"), "submit"); });
  await run(PLAIN(), {}, pickAndStart);
  await run(STARTER(), {}, async (m) => { await fire(byText(m.root, "button", "Add the starter pack"), "click"); });
  // Recorded on the page before PLAN-3D-ALL U11 changed it.
  const RECORDED = [
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/tasks/STH-20', 'GET /api/jobs/sales/missing',
    'GET /api/jobs/sales/missing', 'GET /api/jobs/sales/proposal-from-a-call',
    'GET /api/jobs/sales/proposal-from-a-call',
    'POST /api/jobs/sales/proposal-from-a-call/start {"answers":{"earlier":"e0000000-0000-4000-8000-000000000020"}}',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'POST /api/jobs/sales/proposal-from-a-call/start {"answers":{"earlier":"e0000000-0000-4000-8000-000000000020"},"versions":3}',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'POST /api/jobs/sales/proposal-from-a-call/start {"answers":{"earlier":"e0000000-0000-4000-8000-000000000020"},"versions":1}',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/tasks/STH-20',
    'POST /api/jobs/sales/proposal-from-a-call/start {"answers":{},"from":"STH-20","versions":3}',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'GET /api/jobs/sales/proposal-from-a-call',
    'POST /api/jobs/sales/proposal-from-a-call/start {"answers":{"earlier":"e0000000-0000-4000-8000-000000000020"}}',
    'GET /api/jobs/sales/proposal-from-a-call', 'GET /api/jobs/sales/proposal-from-a-call',
    'POST /api/brain/starters {"ids":["captions"]}', 'GET /api/jobs/sales/proposal-from-a-call',
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const bands = (root) => elements(root).filter((e) => e.localName === "header" && classesOf(e).includes("k-room"));
const inside = (outer, el) => { for (let x = el; x; x = x.parentNode) if (x === outer) return true; return false; };
const paperOf = (el) => { for (let x = el; x; x = x.parentNode) if (x.getAttribute && x.getAttribute("data-surface") === "paper") return x; return null; };
const phone = async (fn) => {
  globalThis.matchMedia = (q) => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {} });
  try { await fn(); } finally { delete globalThis.matchMedia; }
};

test("job: the overline, title and sentence stand in the room header of the job's department's room; one h1, crumbs as before (PLAN-3D-ALL U11)", async () => {
  for (const [dept, key] of [["sales", "room-sales"], ["studio", "room-studio"], ["brain", "table"]]) {
    const m = await mountJob({ ...JOB(), department: { id: dept, title: dept } });
    try {
      const band = bands(m.root);
      assert.equal(band.length, 1, dept);
      assert.equal(band[0].getAttribute("data-glimpse"), key);
      const h1 = elements(m.root).filter((e) => e.localName === "h1");
      assert.equal(h1.length, 1);
      assert.equal(h1[0].getAttribute("id"), "page-title");
      assert.ok(inside(band[0], h1[0]), "the title is in the band");
      assert.equal(textNodes(h1[0]).join(""), JOB().title);
      const img = elements(m.root).filter((e) => e.localName === "img");
      assert.equal(img.length, 1, "one picture: the band's");
      assert.equal(img[0].getAttribute("src"), glimpseSrc(key, { theme: "dark", width: 1280 }));
      assert.equal(img[0].getAttribute("alt"), "");
      assert.equal(img[0].getAttribute("aria-hidden"), "true");
      assert.equal(elements(m.root).filter((e) => e.localName === "canvas").length, 0, "a surface screen has no canvas");
      assert.equal(byCls(m.root, "k-page-header").length, 0, "PageHeader is replaced");
      assert.deepEqual(m.tops.at(-1).crumbs, [{ label: "Jobs", href: "#/jobs" }, { label: JOB().title }]);
      // The form, Start and the money words are under the band, never in it, and nothing is on paper.
      const form = elements(m.root).find((e) => e.localName === "form");
      assert.ok(form && !inside(band[0], form), "the form is not in the band");
      assert.ok(!inside(band[0], byText(m.root, "button", "Start")));
      assert.equal(elements(m.root).filter((e) => e.getAttribute("data-surface")).length, 0, "nothing on paper or over");
    } finally { m.done(); }
  }
  // A job not here: the Studio's table. While the job is read: the band alone, no picture asked for.
  const lost = await mountJob(null, { addr: "sales/missing" });
  try { assert.equal(bands(lost.root)[0].getAttribute("data-glimpse"), "table"); } finally { lost.done(); }
  const off = await mountJob(JOB(), { query: "glimpse=off" });
  try {
    assert.equal(elements(off.root).filter((e) => e.localName === "img").length, 0, "glimpse=off: the band alone");
    assert.equal(byCls(off.root, "k-room--bare").length, 1);
  } finally { off.done(); }
});

test("job: below 860 px the band is a title strip with no picture, and the page asks for none (PLAN-3D-ALL U11)", async () => {
  await phone(async () => {
    const m = await mountJob(JOB());
    try {
      assert.equal(bands(m.root)[0].getAttribute("data-glimpse"), "none");
      assert.equal(elements(m.root).filter((e) => e.localName === "img").length, 0);
      assert.ok(!m.calls.some((c) => /\/assets\/glimpse\//.test(c)));
    } finally { m.done(); }
  });
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "pages", "job.css"), "utf8");
  const top = css.slice(0, css.indexOf("@media"));
  assert.match(/\.p-job > \.k-room \{([^}]*)\}/.exec(top)[1], /z-index: 1;\s*min-height: 96px;\s*margin-top: calc\(-1 \* var\(--s-6\)\);/, "96 px, up into the pane's margin");
  const small = css.slice(css.indexOf("@media (max-width: 859px)"));
  assert.match(/\.p-job > \.k-room \{([^}]*)\}/.exec(small)[1], /min-height: 56px;/, "a 56 px strip on a phone");
  assert.ok(!/paper/.test(css), "no paper on this page");
});

// S1: each money and safety sentence the page shows is one text node, exactly as the server sent it, in the column
// under the band, and no sheet of this page cuts its box.
test("job: the money words, the no-price words and the page viewer's line are whole, as sent, one text node each, never in the band (PLAN-3D-ALL U11, S1)", async () => {
  const PAGE_JOB = { ...JOB(), craft: { ...JOB().craft, kind: "page" } };
  for (const [j, words] of [[JOB(), JOB().generation.words], [MONEY_ONLY(), JOB().generation.words], [FILM(), FILM().generation.words],
    [NO_PRICE_JOB(), NO_PRICE_JOB().generation.words], [NOT_READY(), "The books are switched off."], [PAGE_JOB, page.PAGE_WORDS]]) {
    for (const narrow of [false, true]) {
      const draw = async () => {
        const m = await mountJob(j);
        try {
          const nodes = [...walkDom(m.root)].filter((n) => n.nodeType === 3 && n.data === words);
          assert.equal(nodes.length, 1, words);
          assert.ok(!inside(bands(m.root)[0], nodes[0]), "not over the picture");
          assert.equal(paperOf(nodes[0]), null);
        } finally { m.done(); }
      };
      if (narrow) await phone(draw); else await draw();
    }
  }
  // Start stays: its words, its bar after the money words.
  const m = await mountJob(MONEY_ONLY());
  try {
    const all = [...walkDom(m.root)];
    const money = all.findIndex((n) => n.nodeType === 3 && n.data === JOB().generation.words);
    const start = all.indexOf(byText(m.root, "button", "Start"));
    assert.ok(money > 0 && start > money, "the money words stand above Start");
  } finally { m.done(); }
  const here = dirname(fileURLToPath(import.meta.url));
  for (const sheet of [join(here, "..", "..", "styles", "pages", "job.css"), join(here, "..", "..", "styles", "kit", "forms.css")]) {
    const css = readFileSync(sheet, "utf8");
    assert.doesNotMatch(css, /text-overflow|line-clamp|overflow:\s*hidden/, sheet);
  }
  // In the kit's job sheet, the only cut boxes are a job's name and summary in a list, never the money, the notice or Start's bar.
  const kit = readFileSync(join(here, "..", "..", "styles", "kit", "job.css"), "utf8");
  for (const m2 of kit.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/text-overflow|line-clamp|overflow:\s*hidden|(^|[^-])height:/.test(m2[2])) continue;
    assert.doesNotMatch(m2[1], /k-money|k-job__notice|k-job__why|k-job__actions|k-job__under|p-job/, m2[1].trim());
  }
});

test("job: hostile server text stays text: no script, img, iframe or object beyond the band's; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const KEEP = new Set(["id", "kind", "handoff", "state", "need", "file", "page", "value", "ref", "taskId", "model", "review", "starter"]);
  const hostile = (v, n = { i: 0 }, key = "") => {
    if (typeof v === "string") return KEEP.has(key) ? v : HOSTILE[n.i++ % HOSTILE.length];
    if (Array.isArray(v)) return v.map((x) => hostile(x, n, key === "playbooks" ? "" : key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hostile(x, n, k)]));
    return v;
  };
  const tags = (root) => ["script", "img", "iframe", "object", "embed"].map((t) => elements(root).filter((e) => e.localName === t).length);
  for (const j of [JOB(), NO_PRICE_JOB(), NOT_READY(), FOLLOWS(), STARTER()]) {
    const s = await mountJob(j);
    let base;
    try { base = tags(s.root); } finally { s.done(); }
    const bad = hostile(j);
    const m = await mountJob(bad, { addr: j.id, query: "from=STH-20", recent: [hostile(shape("task-card"))] });
    try {
      assert.deepEqual(tags(m.root), base);
      for (const e of elements(m.root)) {
        for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
        for (const h of HOSTILE) for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
        if (e.localName === "img") {
          assert.ok(GLIMPSES.some((k) => ["dark", "light"].some((theme) => [1280, 390].some((w) => glimpseSrc(k, { theme, width: w }) === e.getAttribute("src")))), "the band's picture is a table key's");
        }
      }
      const nodes = textNodes(m.root);
      assert.ok(nodes.includes(bad.title), "a hostile title is a text node");
      if (bad.generation && bad.generation.words) assert.ok(nodes.includes(bad.generation.words.trim().slice(0, 800)), "hostile money words are a text node");
    } finally { m.done(); }
  }
});
