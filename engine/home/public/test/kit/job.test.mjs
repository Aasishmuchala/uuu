// The kit's jobs (CONTRACTS-V3 25 and 28, M51, M55, M63, M18): fillPreview, checkAnswers, JobStart's states,
// JobRow, JobChip, HandoffTag and StageMark. Split out of kit-c and kit-m55 (T01 of PLAN-COOK).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KIT, installDom, elements, textOf, withClass, classesOf, byClass, settle, mount, unmount, fire, showNow as show, stubFetchByCount as stubFetch } from "./_dom.mjs";
import { SHAPES, shape, LEAD } from "./_fixtures.mjs";
import { css, src, newSheetTest } from "./_rules.mjs";

const job = await import(pathToFileURL(join(KIT, "job.js")).href);
const kit = { job };

// ---- fillPreview ----

test("fillPreview: the shape's job with a task answer and an empty optional answer", { skip: SHAPES ? false : "no shapes" }, () => {
  // M55: the server no longer puts the short ref in an option's label (it is not shown); it sends it as `ref`.
  const asks = shape("job").asks.map((a) => (a.kind === "task"
    ? { ...a, options: a.options.map((o) => ({ ...o, ref: /^[A-Z]+-\d+/.exec(o.label)?.[0] || "STH-20" })) } : a));
  const job = { ...shape("job"), asks: [...asks, { id: "extra", label: "Anything to add?", kind: "text", required: false, options: null }],
    text: "Write a proposal for the customer of the call write-up in [earlier]. Use our price list. [extra]" };
  assert.equal(
    kit.job.fillPreview(job, { earlier: "e0000000-0000-4000-8000-000000000020" }),
    "Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder. Use our price list.",
  );
  assert.equal(
    kit.job.fillPreview(job, { earlier: "e0000000-0000-4000-8000-000000000020", extra: "They want it by Friday." }),
    "Write a proposal for the customer of the call write-up in the sub-folder STH-20 of your current working folder. Use our price list. They want it by Friday.",
  );
});

test("fillPreview: each kind, a missing required answer stays, and an answer is never read for [ids]", () => {
  const out = kit.job.fillPreview(LEAD, { lead: "Asha [when]", when: "2026-11-10", doc: "calls/asha.md", clip: "talk.mp4", count: "2", tone: "warm" });
  assert.equal(out, "Write to Asha [when], met on 2026-11-10. Use the company file calls/asha.md and the file talk.mp4 in the room. Write 2 versions, warm.");
  assert.equal(kit.job.fillPreview(LEAD, {}), "Write to [lead], met on. Use and. Write versions,.");
  assert.equal(kit.job.fillPreview(null, {}), "");
});

// ---- checkAnswers ----

test("checkAnswers: each kind of a job's question", () => {
  const c = kit.job.checkAnswers;
  assert.deepEqual(c(LEAD, {}).missing, ["Who is the lead?"]);
  assert.equal(c(LEAD, { lead: "Asha" }).ok, true);
  assert.match(c(LEAD, { lead: "x".repeat(201) }).errors.lead, /200/);
  assert.match(c(LEAD, { lead: "a", when: "2026-02-30" }).errors.when, /date/);
  assert.equal(c(LEAD, { lead: "a", when: "2026-02-28" }).ok, true);
  assert.match(c(LEAD, { lead: "a", count: "-1" }).errors.count, /whole number/);
  assert.match(c(LEAD, { lead: "a", count: "1000001" }).errors.count, /whole number/);
  assert.equal(c(LEAD, { lead: "a", count: "1000000" }).ok, true);
  assert.match(c(LEAD, { lead: "a", tone: "loud" }).errors.tone, /Pick one/);
  assert.match(c(LEAD, { lead: "a", doc: "../etc/passwd" }).errors.doc, /Pick one/);
  assert.match(c(LEAD, { lead: "a", about: "x".repeat(2001) }).errors.about, /2000/);
});

// ---- JobStart ----

const formOf = (root) => elements(root).find((e) => e.localName === "form");
const inputsOf = (root) => elements(root).filter((e) => ["input", "textarea", "select"].includes(e.localName));

test("JobStart: a job that cannot start says why and its Start is off", async () => {
  installDom();
  const job = { ...LEAD, ready: false, why: { name: "quotations", text: "The books do not let the Bookkeeper draft quotations yet.", link: { page: "health" } } };
  const root = await mount(kit.job.JobStart, { job });
  assert.match(textOf(root), /The books do not let the Bookkeeper draft quotations yet\./);
  const start = elements(root).find((e) => e.localName === "button" && /Start/.test(textOf(e)));
  assert.equal(start.getAttribute("disabled"), "true");
  assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/health"));
  unmount(root);
});

// M63 item 13: a job that cannot start yet keeps its questions switched off, with the one sentence that says why.
test("JobStart: a job that cannot start yet cannot be typed into; neither can one that follows work not accepted yet", async () => {
  installDom();
  const dim = { ...LEAD, ready: false, why: { name: "internet", text: "Agents have no internet, and this job needs it.", link: null } };
  let root = await mount(kit.job.JobStart, { job: dim });
  const fields = inputsOf(root);
  assert.equal(fields.length, LEAD.asks.length);
  for (const f of fields) assert.equal(f.getAttribute("disabled"), "true", `${f.localName} is switched off`);
  assert.ok(byClass(root, "k-job__asks--off").length === 1, "the questions look switched off");
  assert.equal((textOf(root).match(/Agents have no internet, and this job needs it\./g) || []).length, 1, "one sentence says why");
  unmount(root);
  const follows = {
    ...LEAD, asks: [{ id: "earlier", label: "Which call write-up?", kind: "task", required: true, options: [] }, LEAD.asks[0]],
    takes: { from: ["sales/call-write-up"], after: [{ id: "sales/call-write-up", title: "Call write-up" }] },
  };
  root = await mount(kit.job.JobStart, { job: follows });
  for (const f of inputsOf(root)) assert.equal(f.getAttribute("disabled"), "true", `${f.localName} is switched off`);
  assert.match(textOf(root), /This follows "Call write-up"\./);
  unmount(root);
  root = await mount(kit.job.JobStart, { job: LEAD });
  assert.ok(inputsOf(root).every((f) => f.getAttribute("disabled") !== "true"), "a ready job's questions can be typed into");
  unmount(root);
});

test("JobStart: a job with craft (timed off) promises no time under Start; a job without craft keeps today's line", async () => {
  installDom();
  assert.equal(kit.job.underStart(null, false), "It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 2 }, false), "2 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  let root = await mount(kit.job.JobStart, { job: LEAD, timed: false });
  assert.match(textOf(root), /It is checked before it reaches you\./);
  assert.doesNotMatch(textOf(root), /few minutes/);
  unmount(root);
  root = await mount(kit.job.JobStart, { job: LEAD, timed: false, queue: { ahead: 2 } });
  assert.match(textOf(root), /2 tasks are ahead, so it waits its turn\. It is checked before it reaches you\./);
  unmount(root);
  root = await mount(kit.job.JobStart, { job: LEAD });
  assert.match(textOf(root), /Takes a few minutes\. It is checked before it reaches you\./);
  unmount(root);
});

// M63 items 15 and 21: when other work is ahead in the Chief of staff's line, no time is promised.
test("JobStart: the line under Start names the work ahead, from the server's count only", async () => {
  installDom();
  assert.equal(kit.job.underStart(null), "Takes a few minutes. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 0 }), "Takes a few minutes. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 1 }), "1 task is ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: 3 }), "3 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(kit.job.underStart({ ahead: "3" }), "Takes a few minutes. It is checked before it reaches you.", "not a number the server sent");
  const root = await mount(kit.job.JobStart, { job: LEAD, queue: { ahead: 2 } });
  assert.match(textOf(root), /2 tasks are ahead, so it waits its turn\. It is checked before it reaches you\./);
  assert.doesNotMatch(textOf(root), /few minutes/);
  unmount(root);
});

test("JobStart: a required answer missing sends nothing; then it sends the answers and shows the started line", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 201, body: { goal: { id: "g1", identifier: "STH-31" }, message: "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you." } }));
  let started = null;
  try {
    const root = await mount(kit.job.JobStart, { job: LEAD, onStarted: (r) => { started = r; } });
    assert.match(textOf(root), /Takes a few minutes\. It is checked before it reaches you\./);
    assert.match(textOf(root), /What will be asked/);
    fire(formOf(root), "submit");
    await settle();
    assert.equal(f.calls.length, 0, "nothing was sent");
    assert.match(textOf(root), /Fill in: Who is the lead\?/);
    const lead = inputsOf(root)[0];
    fire(lead, "input", { target: { value: "Asha Kitchens" } });
    await settle();
    fire(formOf(root), "submit");
    await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].path, "/api/jobs/sales/first-message-to-a-lead/start");
    assert.equal(f.calls[0].method, "POST");
    assert.equal(f.calls[0].headers["X-Engine"], "1");
    assert.deepEqual(f.calls[0].body, { answers: { lead: "Asha Kitchens" } });
    assert.match(textOf(root), /Started\. The Chief of staff has it\./);
    assert.ok(elements(root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/tasks/STH-31"));
    assert.equal(started.goal.identifier, "STH-31");
    unmount(root);
  } finally {
    f.restore();
  }
});

test("JobStart: with `from` the task question is answered by the server; a refusal shows the server's sentence", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 409, body: { error: { code: "from_not_accepted", message: "That earlier task is not accepted yet.", next: "Accept it first, then start this one." } } }));
  try {
    const job = { ...LEAD, asks: [{ id: "earlier", label: "Which call write-up?", kind: "task", required: true, options: [{ value: "t20", label: "STH-20 · Call write-up: Asha" }] }], text: "Write from [earlier]." };
    const root = await mount(kit.job.JobStart, { job, from: "t20" });
    // M55 (M51 F8, F9): the answered question is one quiet line, the task's name first and its ref after.
    assert.match(textOf(root), /Already answered: from the earlier task, Call write-up: Asha STH-20\./);
    assert.match(textOf(root), /Write from the sub-folder STH-20 of your current working folder\./);
    fire(formOf(root), "submit");
    await settle();
    assert.deepEqual(f.calls[0].body, { answers: {}, from: "t20" });
    assert.match(textOf(root), /That earlier task is not accepted yet\./);
    assert.match(textOf(root), /Accept it first/);
    unmount(root);
  } finally {
    f.restore();
  }
});

test("JobStart: the board off is shown as not connected, with the next step", async () => {
  installDom();
  const f = stubFetch(() => ({ status: 502, body: { error: { code: "board_off", message: "The board is not answering.", next: "Run: engine start" } } }));
  try {
    const root = await mount(kit.job.JobStart, { job: { ...LEAD, asks: [], text: "Write a short first message to the lead." } });
    fire(formOf(root), "submit");
    await settle();
    assert.match(textOf(root), /Not connected yet/);
    assert.match(textOf(root), /The board is not answering\./);
    assert.match(textOf(root), /engine start/);
    unmount(root);
  } finally {
    f.restore();
  }
});

test("JobRow, JobChip, HandoffTag, StageMark: the words of section 25, dim when not ready, a link to the job", async () => {
  installDom();
  let root = await mount(kit.job.JobRow, { job: { ...LEAD, ready: false, why: "Agents have no internet, and this job needs it." } });
  const a = root.firstChild;
  assert.equal(a.localName, "a");
  assert.equal(a.getAttribute("href"), "#/jobs/sales/first-message-to-a-lead");
  assert.equal(a.getAttribute("data-dept"), "sales");
  assert.ok(classesOf(a).includes("k-job--dim"));
  assert.match(textOf(root), /You lead/);
  assert.match(textOf(root), /Make/);
  assert.match(textOf(root), /Cannot start yet: Agents have no internet/);
  unmount(root);
  root = await mount(kit.job.JobChip, { job: { ...LEAD, id: "../x" } });
  assert.equal(root.firstChild.localName, "span", "an odd id gives no link");
  unmount(root);
  assert.equal(kit.job.HandoffTag({ id: "nope" }), null);
  assert.equal(kit.job.StageMark({ n: 9 }), null);
  for (const [id, words] of [["you-lead", "You lead"], ["you-approve", "You approve"], ["on-its-own", "On its own"]]) {
    root = await mount(kit.job.HandoffTag, { id });
    assert.match(textOf(root), new RegExp(words));
    unmount(root);
  }
  for (const [n, words] of [[1, "Foundations"], [2, "Take in"], [3, "Make"], [4, "Hand on"]]) {
    root = await mount(kit.job.StageMark, { n });
    assert.match(textOf(root), new RegExp(`Stage ${n}: ${words}`));
    unmount(root);
  }
});

test("a job: why-not link words, optional reads, blanks in the preview, a job that follows another (M51 F6, F7, F22, F26)", () => {
  const why = show(job.WhyNot, { why: { text: 'Fill in "Terms" first.', link: { page: "files", id: "x" } } });
  assert.match(textOf(why), /Fill it in/);
  const files = show(job.WhyNot, { why: { text: "The brain has no price list.", link: { page: "files", id: "x" } } });
  assert.match(textOf(files), /Open Files/);

  const lead = { id: "sales/call-write-up", title: "Call write-up", text: "Write up the call with [who] from [notes]. [extra]",
    asks: [{ id: "who", label: "Who was the call with?", kind: "line", required: true }, { id: "notes", label: "Which notes?", kind: "line", required: true },
      { id: "extra", label: "Anything else?", kind: "text", required: false }] };
  assert.deepEqual(job.previewParts(lead, { notes: "the [who] file" }), [
    { text: "Write up the call with " }, { blank: "Who was the call with" }, { text: " from the [who] file." },
  ], "an answer is never read for blanks");
  assert.equal(job.fillPreview(lead, {}), "Write up the call with [who] from [notes].", "what is sent keeps its ids");

  assert.deepEqual(job.nameAndRef("STH-20 · Call write-up: Asha"), { name: "Call write-up: Asha", ref: "STH-20" });
  assert.deepEqual(job.nameAndRef("Call write-up: Asha · 11 Nov 2026"), { name: "Call write-up: Asha · 11 Nov 2026", ref: "" });

  const after = job.followsOf({ takes: { from: ["marketing/five-concepts"], after: [{ id: "marketing/five-concepts", title: "Five concepts before any design" }], waiting: { taskId: "t23", title: "Five concepts" } } });
  assert.equal(after.sentence, 'This follows "Five concepts before any design". Accept the task that waits from it first.');
  assert.equal(after.href, "#/jobs/marketing/five-concepts");
  assert.equal(after.waiting.href, "#/tasks/t23");
  const bare = job.followsOf({ takes: { from: ["sales/call-write-up"] } });
  assert.equal(bare.sentence, "This follows an earlier job. Run that job and accept what it makes first.");
  assert.equal(bare.waiting, null);

  const reads = show(job.JobStart, { job: { id: "sales/proposal-from-a-call", title: "Proposal", ready: true, asks: [],
    reads: [{ file: "packs/proposal.md", title: "The proposal pack", state: "missing", need: "may" }, { file: "pricing/terms.md", title: "Terms", state: "empty", need: "must" }] } });
  assert.match(textOf(reads), /The proposal packNot added yet\. Optional\./);
  assert.match(textOf(reads), /TermsNot filled in yet\. Needed\./);
  assert.equal(withClass(reads, "k-job__read-dot").length, 1, "only the needed file carries the warning mark");

  const blocked = show(job.JobStart, { job: { id: "marketing/carousel-from-a-concept", title: "A carousel", ready: true,
    asks: [{ id: "earlier", label: "Which set of concepts?", kind: "task", required: true, options: [] }],
    takes: { from: ["marketing/five-concepts"], after: [{ id: "marketing/five-concepts", title: "Five concepts before any design" }], waiting: null } } });
  assert.match(textOf(blocked), /This follows "Five concepts before any design"\./);
  assert.doesNotMatch(textOf(blocked), /Start/, "no Start that could only be refused");
});

test("fold-outs use the kit's chevron, not the browser's triangle (M18-26)", () => {
  assert.match(css("kit/job.css"), /\.k-job__preview-head::-webkit-details-marker\s*\{\s*display: none;/);
  assert.match(css("kit/answer.css"), /\.k-answer__sources-head::-webkit-details-marker\s*\{\s*display: none;/);
  assert.match(src("kit/job.js"), /class="k-job__fold"/);
  assert.match(src("kit/answer.js"), /class="k-answer__fold"/);
});

test("job rows on a phone: two lines for the name, the stage kept, bullets in the text colour (M18-03, M18-10, M18-16, M51 F11)", () => {
  const j = css("kit/job.css");
  assert.doesNotMatch(j, /\.k-job__marks \.k-job--stage\s*\{\s*display: none;/);
  assert.match(j, /\.k-job--row > \.k-job__title\s*\{[^}]*-webkit-line-clamp: 2;/);
  assert.match(j, /\.k-job--row\s*\{\s*--k-job-dot: var\(--text\);/);
  assert.match(j, /grid-template-columns: 104px 112px;/);
});

newSheetTest("job");
