// A task's page: its pure helpers, on the pinned `task` shape and on the seed as the home server sends it
// (CONTRACTS-V2 17.3, CONTRACTS-V3 30 "A task" and 33.4). A stub home on port 0 serves the seed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The server sits beside this tree: found by walking up from this file.
const SERVER = (() => {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const c = join(d, "server");
    if (existsSync(join(c, "test", "shapes", "task.json"))) return c;
    const p = dirname(d);
    if (p === d) throw new Error("the home server was not found");
    d = p;
  }
})();
const shape = (name) => JSON.parse(readFileSync(resolve(SERVER, "test", "shapes", `${name}.json`), "utf8"));

const mod = await import("../../pages/task.js");
const { actArgs, roundsLine, pickRound, pickCheck, stateWord, otherNeeds, address, storyOf, askOf, nextLinks, sideLayout, roundMarker, resultFiles, pickItemOf, piecesStamp, layoutOf, stageKind, scoresByLetter, roundRows, factWords } = mod;

let home = null;
const seed = {};
before(async () => {
  const { startV2 } = await import(pathToFileURL(join(SERVER, "lib", "testing-v2.mjs")).href);
  home = await startV2({ routes: ["task.mjs", "inbox.mjs"], inbox: ["goals.mjs", "staged.mjs"], search: [] });
  for (const n of [7, 8, 13, 18, 19]) {
    const r = await fetch(`${home.url}/api/tasks/STH-${n}`);
    assert.equal(r.status, 200, `STH-${n}`);
    seed[n] = await r.json();
  }
});
after(async () => { if (home) await home.close(); });

const markers = (story) => story.filter((i) => i.kind === "message" && i.message.marker).map((i) => i.message.marker.label);
const kinds = (story) => story.map((i) => (i.kind === "doc" ? `doc:${i.id}` : i.kind === "answer" ? "answer" : i.message.marker && !i.message.text ? `marker:${i.message.marker.label}` : `${i.message.who.slug}:${i.message.kind || "words"}`));

const rounds = [
  { n: 1, outcome: "fail", label: "Round 1 · Repairing", wellFormed: true, checks: [] },
  { n: 2, outcome: "pass", label: "Round 2 · Passed", wellFormed: true, checks: [] },
];

test("task: exports a page component", () => {
  assert.equal(typeof mod.default, "function");
});

// M63 item 4: an answer is never checked, so a question's header says "Not checked", not "Not checked yet".
test("task: a question with no round says Not checked; the waiting words come with askOf", () => {
  assert.equal(roundsLine(0, { ask: true }), "Not checked");
  assert.equal(roundsLine(undefined, { ask: true }), "Not checked");
  assert.equal(roundsLine(0, { ask: false }), "Not checked yet");
  assert.equal(roundsLine(2, { ask: true }), "2 verification rounds");
  const d = { task: { id: "e1", identifier: "STH-40", ask: true, state: "waiting", plainState: "Waiting to start", stepsTotal: 0, queue: { ahead: 2 } }, text: "Do we deliver?" };
  assert.deepEqual(askOf(d).queue, { ahead: 2 }, "the server's count goes to the answer view");
  assert.equal(askOf({ ...d, task: { ...d.task, queue: "2" } }).queue, null);
});

test("task: roundsLine says how many verification rounds in words", () => {
  assert.equal(roundsLine(0), "Not checked yet");
  assert.equal(roundsLine(undefined), "Not checked yet");
  assert.equal(roundsLine(1), "1 verification round");
  assert.equal(roundsLine(3), "3 verification rounds");
});

test("task: pickRound takes the round the address asks for, else the newest", () => {
  assert.equal(pickRound(rounds, null).n, 2);
  assert.equal(pickRound(rounds, "1").n, 1);
  assert.equal(pickRound(rounds, 2).n, 2);
  assert.equal(pickRound(rounds, "9").n, 2);
  assert.equal(pickRound(rounds, "x").n, 2);
  assert.equal(pickRound([rounds[1], rounds[0]], "").n, 2);
  assert.equal(pickRound([], "1"), null);
  assert.equal(pickRound(null), null);
});

test("task: pickCheck takes the asked check, else the first that failed, else the first", () => {
  const round = { checks: [
    { n: 1, answer: "yes" }, { n: 2, answer: "no" }, { n: 3, answer: "no" },
  ] };
  assert.equal(pickCheck(round, "3").n, 3);
  assert.equal(pickCheck(round, null).n, 2);
  assert.equal(pickCheck(round, "7").n, 2);
  assert.equal(pickCheck({ checks: [{ n: 1, answer: "yes" }, { n: 2, answer: "yes" }] }).n, 1);
  assert.equal(pickCheck({ checks: [] }, "1"), null);
  assert.equal(pickCheck(null), null);
});

test("task: stateWord gives a plain word for every acceptance state", () => {
  assert.equal(stateWord({ state: "accepted" }), "Accepted");
  assert.equal(stateWord({ state: "not_ready" }), "Not ready yet");
  assert.equal(stateWord({ state: "sent_back" }), "Sent back");
  assert.equal(stateWord({ state: "stopped" }), "Stopped");
  assert.equal(stateWord({ state: "waiting_for_you" }), "Waiting for you");
  assert.equal(stateWord(null), "Not ready yet");
  assert.equal(stateWord({ state: "something_else" }), "Not ready yet");
});

test("task: otherNeeds leaves out the delivery itself", () => {
  const acceptance = { accept: { inboxId: "goal:a", action: "acknowledge" }, sendBack: { inboxId: "goal:a", action: "reopen" } };
  const items = [
    { id: "goal:a", kind: "result" },
    { id: "staged:plan:a", kind: "approval" },
    { id: "staged:unclear:a:1234abcd", kind: "question" },
  ];
  assert.deepEqual(otherNeeds(items, acceptance).map((i) => i.id), ["staged:plan:a", "staged:unclear:a:1234abcd"]);
  assert.deepEqual(otherNeeds([{ id: "goal:a", kind: "result" }], { accept: null }).length, 0);
  assert.deepEqual(otherNeeds(null, null), []);
});

test("task: address keeps the page state in the address", () => {
  const q = new URLSearchParams("round=1&check=2&files=1");
  assert.equal(address("STH-8", q, { round: 2, check: null }), "#/tasks/STH-8?round=2&files=1");
  assert.equal(address("STH-8", null, {}), "#/tasks/STH-8");
  assert.equal(address("a b", new URLSearchParams(), { check: 3 }), "#/tasks/a%20b?check=3");
  assert.equal(address("STH-8", new URLSearchParams("doc=brief"), { doc: null }), "#/tasks/STH-8");
});

test("task: Accept and Send back send the version they were showing", () => {
  const acceptance = {
    accept: { inboxId: "goal:7", action: "accept", version: "v-a1" },
    sendBack: { inboxId: "goal:7", action: "send_back", version: "v-s2" },
  };
  assert.deepEqual(actArgs(acceptance, "accept"), ["goal:7", "accept", undefined, "v-a1"]);
  assert.deepEqual(actArgs(acceptance, "sendBack", "Fix the total"), ["goal:7", "send_back", "Fix the total", "v-s2"]);
  // On the seed, the delivery's own buttons carry the version the server sent.
  const a = seed[8].acceptance;
  assert.deepEqual(actArgs(a, "accept"), [a.accept.inboxId, a.accept.action, undefined, a.accept.version]);
  assert.ok(a.accept.version);
});

test("task: a refused action says what the server said, in place", async () => {
  const { changedText, isChangedSinceSeen } = await import("../../kit/decision.js");
  const err = { code: "changed_since_seen", message: "This changed after you looked at it. Nothing was done.", next: "Look at it again, then decide." };
  assert.equal(isChangedSinceSeen(err), true);
  assert.deepEqual(changedText(err), { message: err.message, next: err.next });
});

test("task: the story of the pinned shape, in time order with its markers", () => {
  const d = shape("task");
  // In the shape the brief's file entry is the sheet's; a real brief is its own file.
  d.stages[0].doc.file = { ...d.stages[0].doc.file, name: "00-brief.md" };
  const story = storyOf(d);
  assert.deepEqual(kinds(story), ["you:words", "doc:brief", "artist:comment", "marker:Round 1 · Repairing", "chief-of-staff:result"]);
  assert.equal(story[0].message.text, d.text);
  const doc = story[1];
  assert.deepEqual(doc.marker, { label: "Brief written", tone: "neutral" });
  assert.equal(doc.doc, d.stages[0].doc);
  const result = story[story.length - 1].message;
  assert.equal(result.text, d.result.text);
  assert.equal(result.who.name, "Chief of staff");
  assert.ok(result.files.length >= 1, "the result carries its files");
  assert.deepEqual(storyOf(null), []);
  assert.deepEqual(storyOf({}), []);
});

test("task: STH-8 tells two rounds, the documents before the work, and the result last with its files", () => {
  const story = storyOf(seed[8]);
  assert.deepEqual(markers(story), ["Round 1 · Repairing", "Round 2 · Passed"]);
  assert.deepEqual(story.filter((i) => i.kind === "doc").map((i) => i.marker.label), ["Brief written", "Plan ready", "Summary written"]);
  assert.deepEqual(kinds(story), [
    "you:words", "chief-of-staff:comment", "chief-of-staff:comment", "doc:brief", "doc:plan", "artist:comment",
    "checker:verdict", "chief-of-staff:comment", "artist:comment", "doc:summary", "checker:verdict", "chief-of-staff:result",
  ]);
  const verdicts = story.filter((i) => i.kind === "message" && i.message.kind === "verdict").map((i) => i.message.marker);
  assert.deepEqual(verdicts, [{ label: "Round 1 · Repairing", tone: "warn" }, { label: "Round 2 · Passed", tone: "ok" }]);
  const result = story[story.length - 1].message;
  assert.equal(result.text, seed[8].result.text);
  const names = result.files.map((f) => f.name);
  assert.ok(names.includes("art/walker/walker-sheet.png"));
  assert.ok(!names.some((n) => /^0\d-/.test(n)), "the staged documents are not under the result");
  assert.ok(result.files.length <= 6);
  assert.equal(story.filter((i) => i.kind === "message" && i.message.kind === "result").length, 1, "the result is told once");
});

test("task: STH-7 shows the brief and the plan to accept after what was said, and the plan in the panel", () => {
  const d = seed[7];
  const story = storyOf(d);
  assert.deepEqual(kinds(story), ["you:words", "chief-of-staff:comment", "chief-of-staff:comment", "doc:brief", "doc:plan"]);
  assert.equal(story[4].marker.label, "Plan ready");
  assert.equal(story[4].doc.name, "01-plan.md");
  assert.deepEqual(otherNeeds(d.needsYou, d.acceptance).map((i) => i.kind), ["approval"]);
  assert.equal(stateWord(d.acceptance), "Not ready yet");
});

test("task: STH-13 shows the brief with its open questions, and the question in the panel", () => {
  const d = seed[13];
  const story = storyOf(d);
  const brief = story.find((i) => i.kind === "doc");
  assert.equal(brief.id, "brief");
  assert.equal(brief.unclear.length, 2);
  assert.equal(story[story.length - 1], brief, "the brief is the newest thing in the story");
  assert.deepEqual(otherNeeds(d.needsYou, d.acceptance).map((i) => i.kind), ["question"]);
});

test("task: STH-18 tells five failed rounds, the last one stopped at the cap", () => {
  const d = seed[18];
  const story = storyOf(d);
  assert.deepEqual(markers(story), [1, 2, 3, 4, 5].map((n) => `Round ${n} · ${n === 5 ? "Failed" : "Repairing"}`));
  const tones = story.filter((i) => i.kind === "message" && i.message.marker).map((i) => i.message.marker.tone);
  assert.deepEqual(tones, ["warn", "warn", "warn", "warn", "bad"]);
  assert.match(story[story.length - 1].message.text, /^Stopped because five check rounds did not pass/);
  assert.ok(!story.some((i) => i.kind === "doc"), "no documents for a small task");
  assert.deepEqual(otherNeeds(d.needsYou, d.acceptance).map((i) => i.kind), ["problem"]);
  assert.deepEqual(roundMarker({ n: 5, outcome: "fail", label: "Round 5 · Failed" }), { label: "Round 5 · Failed", tone: "bad" });
  assert.deepEqual(roundMarker({ n: 3, outcome: "fail" }), { label: "Round 3", tone: "warn" });
});

test("task: a question task's story is its answer", () => {
  const ask = shape("ask");
  const d = seed[19];
  // As the server sends it once answers are read (33.4 `answer`): the answer of shape ask.
  const answered = { ...d, answer: ask.answer };
  const story = storyOf(answered);
  assert.equal(story.length, 1);
  assert.equal(story[0].kind, "answer");
  assert.equal(story[0].ask.state, "answered");
  assert.equal(story[0].ask.answer, ask.answer);
  assert.equal(story[0].ask.question, d.text);
  // The whole ask is taken as it is.
  assert.equal(askOf({ ...d, answer: ask }), ask);
  // An open question is being read; a stopped one says so.
  const open = { ...d, answer: null, task: { ...d.task, state: "in_progress", column: "in_progress" } };
  assert.equal(askOf(open).state, "reading");
  assert.equal(askOf({ ...open, task: { ...open.task, column: "canceled" } }).state, "stopped");
  assert.equal(askOf({ ...open, task: { ...open.task, state: "needs_you" } }).state, "needs_you");
  // Finished with no answer, or taken as work: the story is told as for any task.
  assert.equal(askOf({ ...d, answer: null }), null);
  assert.ok(storyOf({ ...d, answer: null }).some((i) => i.kind === "message" && i.message.kind === "result"));
  assert.equal(askOf(seed[8]), null);
});

test("task: What can come next links to the job, told which task it follows", () => {
  const d = shape("task");
  const links = nextLinks(d.next, d.task);
  assert.deepEqual(links, [{
    href: "#/jobs/books/quotation-from-a-call?from=STH-8", title: "Quotation from a call write-up",
    label: "Draft the quotation from this", ready: false, why: "The books do not let the Bookkeeper draft quotations yet.",
  }]);
  assert.deepEqual(nextLinks([{ jobId: "../x", title: "Bad" }, { jobId: "sales/proposal-from-a-call", title: "P", ready: true }], { id: "e1" })
    .map((l) => [l.href, l.label, l.ready]), [["#/jobs/sales/proposal-from-a-call?from=e1", "P", true]]);
  assert.deepEqual(nextLinks(null, null), []);
});

test("task: the panel stands beside the story only from 1080 px and with room", () => {
  assert.deepEqual(sideLayout(1280, 1104), { side: true, width: 1084 });
  assert.deepEqual(sideLayout(1080, 904), { side: true, width: 904 });
  assert.deepEqual(sideLayout(1079, 1000), { side: false, width: null });
  assert.deepEqual(sideLayout(1280, 724), { side: false, width: null }, "the work panel is open: no room");
  assert.deepEqual(sideLayout(390, 358), { side: false, width: null });
  assert.deepEqual(sideLayout(undefined, undefined), { side: false, width: null });
});

// PLAN-COOK T104 (critics of round A1 on S15: "the card floats with no anchor"): beside the story the page fills the
// pane, takes a composed width of at most 1100 px centred in it, and the rail runs its whole height on the panel.
test("task: beside the story the page fills the pane to a composed width and the rail runs its height", () => {
  const { bleedOf, COMPOSED, PANEL_WORDS } = mod;
  assert.equal(COMPOSED, 1100);
  assert.deepEqual(bleedOf({ left: 216, right: 1280, width: 1064 }, { left: 248, right: 1248 }, { top: 32, bottom: 48 }),
    { left: 32, right: 32, top: 32, bottom: 48, gutter: 0 });
  assert.deepEqual(bleedOf({ left: 216, right: 1440, width: 1224 }, { left: 304, right: 1352 }, { top: 32, bottom: 48 }),
    { left: 88, right: 88, top: 32, bottom: 48, gutter: 62 });
  assert.deepEqual(bleedOf(null, null, null), { left: 0, right: 0, top: 0, bottom: 0, gutter: 0 });
  assert.deepEqual(PANEL_WORDS, { acceptance: "Acceptance", checks: "The checks", also: "Also waiting on you", how: "How it went", steps: "Every step" });
  const c = readFileSync(new URL("../../styles/pages/task.css", import.meta.url), "utf8");
  const side = /\.p-task\.p-task--side \{([^}]*)\}/.exec(c)[1];
  assert.match(side, /min-height: calc\(100vh - var\(--topbar-h\)\);/, "the page runs the pane's height");
  assert.match(side, /grid-template-columns: minmax\(0, 1fr\) var\(--p-task-panel\);/);
  const rail = /\.p-task\.p-task--side \.p-task__panel \{([^}]*)\}/.exec(c)[1];
  assert.match(rail, /align-self: stretch;/, "the rail runs the page's height");
  assert.match(rail, /border-left: 1px solid var\(--line\);/);
  assert.match(c, /\.p-task \.p-task__panel \{[^}]*background: var\(--panel\);/, "on the panel surface");
  assert.match(c, /--p-task-panel: var\(--rail-w\);/, "320 px");
});

test("task: the result's files leave out the staged documents", () => {
  const d = seed[8];
  const names = resultFiles(d.files, d.stages).map((f) => f.name);
  assert.ok(!names.includes("00-brief.md") && !names.includes("01-plan.md") && !names.includes("04-summary.md"));
  assert.ok(names.includes("art/walker/walker.gif"));
  assert.deepEqual(resultFiles(null, null), []);
});

test("task: headings go from the title to h2, and the line after Accept takes focus (M52 K8, K3)", () => {
  const src = readFileSync(new URL("../../pages/task.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /<h3/);
  assert.match(src, /<h2 class="p-task__h">The six checks<\/h2>/);
  assert.match(src, /saidRef\.current\?\.focus\(\)/);
  assert.match(src, /tabindex="-1" ref=\$\{saidRef\}/);
});

// M63 items 28 and 48.
test("task: an agent's comment is marked to fold; the owner's words, the check and the result are not", () => {
  const d = {
    task: { id: "e1", createdAt: "2026-11-12T08:00:00Z" }, text: "Do it.",
    conversation: [
      { who: { slug: "builder", name: "Builder" }, kind: "comment", text: "A long report", at: "2026-11-12T08:01:00Z" },
      { who: { slug: "you", name: "You" }, kind: "note", text: "Use Nos.", at: "2026-11-12T08:02:00Z" },
      { who: { slug: "checker", name: "Checker" }, kind: "verdict", text: "Passed.", at: "2026-11-12T08:03:00Z" },
      { who: { slug: "chief-of-staff", name: "Chief of staff" }, kind: "result", text: "Done.", at: "2026-11-12T08:04:00Z" },
    ],
  };
  const folds = storyOf(d).filter((i) => i.kind === "message" && i.message.text).map((i) => [i.message.kind || "words", !!i.message.fold]);
  assert.deepEqual(folds, [["words", false], ["comment", true], ["note", false], ["verdict", false], ["result", false]]);
});

test("task: once accepted, what can come next goes at the top of the panel", () => {
  const { nextOnTop } = mod;
  const next = [{ href: "#/jobs/books/x", label: "Draft the quotation", title: "Quotation", ready: true }];
  assert.equal(nextOnTop({ state: "accepted" }, next), true);
  assert.equal(nextOnTop({ state: "accepted" }, []), false);
  assert.equal(nextOnTop({ state: "waiting_for_you" }, next), false);
  assert.equal(nextOnTop(null, next), false);
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "task.js"), "utf8");
  const panel = src.slice(src.indexOf('aria-label="Acceptance"'));
  assert.ok(panel.indexOf("nextOnTop(acceptance, next) ? html`<${NextUp}") < panel.indexOf("<${Rounds}"), "above the checks");
});

// M63, live: a question's acceptance panel said "Not checked yet." under a header that says "Not checked".
test("task: a question's acceptance panel says Not checked, with no promise of a check", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "pages", "task.js"), "utf8");
  assert.ok(!src.includes("<p class=\"u-caption\">Not checked yet.</p>"), "no fixed words in the panel");
  assert.ok(src.includes("roundsLine(0, { ask })"), "the panel's words come from roundsLine");
  assert.ok(src.includes("<${Rounds} id=${id} acceptance=${acceptance} query=${query} ask=${t.ask === true} />"));
});

// PLAN-V5 K9, T20: the versions of a task. While it waits on the owner, its own Needs-you item of kind "pick" is the
// card; without one (every task of the seed, and every task when the pieces route is missing) the page is as today.
const PICK = {
  id: "goal:g1", kind: "pick", version: "v1", title: "Pick one: Launch",
  variants: [{ id: "a", direction: { id: "type-led", title: "Type led" }, preview: [], brand: { result: "pass", lines: [] }, review: null }],
};

test("task: the card of versions is the task's own item of kind pick, and only that", () => {
  const d = { task: { id: "g1" }, acceptance: { accept: { inboxId: "goal:g1" } }, needsYou: [{ id: "goal:g1", kind: "result" }, PICK] };
  assert.equal(pickItemOf(d), PICK);
  assert.equal(pickItemOf({ ...d, needsYou: [{ ...PICK, id: "goal:other" }] }), null);
  assert.equal(pickItemOf({ ...d, needsYou: [{ ...PICK, variants: undefined }] }), null, "no versions: the ordinary Accept");
  assert.equal(pickItemOf({ task: { id: "g1" }, needsYou: [PICK] }), PICK, "found by the task's id when there is no Accept");
  assert.equal(pickItemOf(null), null);
});

test("task: every task of the seed keeps today's Accept and has no card of versions", () => {
  for (const n of [7, 8, 13, 18, 19]) assert.equal(pickItemOf(seed[n]), null, `STH-${n}`);
  assert.ok(seed[8].acceptance, "the acceptance is as the server sends it");
});

test("task: the versions are read again when the task moves, and on each refresh only while a brand check runs", () => {
  const d = { task: { column: "done", updatedAt: "t1" }, acceptance: { state: "accepted", rounds: [] }, generatedAt: "g1" };
  const still = { variants: [{ id: "a", brand: { result: "unknown", lines: ["The brand check is still running. Look again in a minute."] } }] };
  const ready = { variants: [{ id: "a", brand: { result: "pass", lines: [] } }] };
  assert.equal(piecesStamp(d, ready), piecesStamp({ ...d, generatedAt: "g2" }, ready));
  assert.notEqual(piecesStamp(d, still), piecesStamp({ ...d, generatedAt: "g2" }, still));
  assert.notEqual(piecesStamp(d, ready), piecesStamp({ ...d, task: { ...d.task, updatedAt: "t2" } }, ready));
  assert.equal(piecesStamp(null, null), "");
});

test("task: when the pieces route is missing (404) nothing is shown and Accept stays", async () => {
  const r = await fetch(`${home.url}/api/tasks/STH-8/pieces`);
  assert.equal(r.status, 404, "this stub home has no pieces route, as an older home server");
  const { Versions } = await import("../../kit/pick.js");
  assert.equal(Versions({ item: null, pieces: null }), null);
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../pages/task.js"), "utf8");
  assert.match(src, /\.catch\(\(\) => \{ if \(live\) setS\(\{ id, data: null \}\); \}\)/, "a failed read shows nothing");
  assert.match(src, /const barred = layout\.narrow && !!acceptance\.accept && !pickItem;/);
});

// PLAN-V5 K16, T54: a task's site under its versions, from GET /api/tasks/:id/sites (kit/site.js SiteView).
test("task: a site stands between the versions and the story, read again when the task moves", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../pages/task.js"), "utf8");
  const versions = src.indexOf("<${Versions} id=\"p-task-versions\"");
  const sites = src.indexOf("<${SiteView} id=${id} stamp=${piecesStamp(d, null)} htmlId=\"p-task-sites\" />");
  const story = src.indexOf("<${Story} id=${id} items=${story} query=${query} />");
  assert.ok(versions > 0 && sites > versions && story > sites, "versions, then the site, then the story");
});

test("task: with no sites route (an older home server, 404) the site view draws nothing", async () => {
  const r = await fetch(`${home.url}/api/tasks/STH-8/sites`);
  assert.equal(r.status, 404, "this stub home has no sites route");
  const { SiteView } = await import("../../kit/site.js");
  assert.equal(typeof SiteView, "function");
});

// PLAN-COOK T51: a task with a site stands on a stage; versions with pictures take the pick card's stage; anything
// else, and every task on an older home server (no /sites, no /pieces), is the column.
const SHOT = `/api/sites/shot/${"a".repeat(64)}/shot-index-1280-light.png`;
const PICTURED = { ...PICK, variants: [{ ...PICK.variants[0], preview: [{ type: "image", url: "/api/view/abc123" }] }] };

test("task: the layout is the stage for a site, the pick's stage for pictured versions, else the column", () => {
  assert.equal(layoutOf({ site: { ref: "launch-a" } }), "site");
  assert.equal(layoutOf({ site: { ref: "launch-a" }, pick: PICTURED }), "site", "a site wins: its stage shows the versions");
  assert.equal(layoutOf({ pick: PICTURED }), "versions");
  assert.equal(layoutOf({ pieces: { variants: [{ id: "a", preview: [{ type: "image", url: SHOT }] }] } }), "versions");
  assert.equal(layoutOf({ pick: PICK }), "column", "a draft with no picture reads in the column");
  assert.equal(layoutOf({ pick: { ...PICTURED, variants: [{ ...PICTURED.variants[0], preview: [{ type: "image", url: "/files/elsewhere.png" }] }] } }), "column", "an address that is not the server's own is no picture");
  assert.equal(layoutOf({ pieces: { single: true, variants: [{ id: "piece", preview: [{ type: "image", url: "/api/view/abc123" }] }] } }), "column");
  assert.equal(layoutOf({ site: null, pick: null, pieces: null }), "column", "an older home server");
  assert.equal(layoutOf(), "column");
  for (const n of [7, 8, 13, 18, 19]) assert.equal(layoutOf({ site: null, pick: pickItemOf(seed[n]), pieces: null }), "column", `STH-${n}`);
});

test("task: a site's kind line says what it is and the round", () => {
  assert.equal(stageKind({ state: "waiting_for_you" }, 1), "A site to accept · round 1");
  assert.equal(stageKind({ state: "accepted" }, 2), "A site, accepted · round 2");
  assert.equal(stageKind({ state: "sent_back" }, 0), "A site, sent back");
  assert.equal(stageKind({ state: "stopped" }, null), "A site, stopped");
  assert.equal(stageKind(null, "x"), "A site in the works");
});

test("task: the Art director's scores go to the strip by letter, unranked, missing versions left out", () => {
  const item = { kind: "pick", variants: [
    { id: "b", review: { total: 49, meets: false, reason: "strong pictures" } },
    { id: "a", review: { total: 55, meets: true, reason: "the type carries the lake" } },
    { id: "c", review: null },
  ], missing: ["c"] };
  assert.deepEqual(scoresByLetter(item), {
    a: { total: 55, meets: true, reason: "the type carries the lake" },
    b: { total: 49, meets: false, reason: "strong pictures" },
  });
  assert.deepEqual(Object.keys(scoresByLetter(item)), ["a", "b"], "a to c, never by score");
  assert.deepEqual(scoresByLetter({ variants: [{ id: "a", review: { total: "55" } }] }), {});
  assert.deepEqual(scoresByLetter(null), {});
});

test("task: the rail lists each round with its checks; the facts line names who, the size and the job", () => {
  const rows = roundRows(seed[8].acceptance.rounds);
  assert.deepEqual(rows.map((r) => [r.label, r.tone]), [["Round 1 · Repairing", "warn"], ["Round 2 · Passed", "ok"]]);
  assert.ok(rows.every((r) => r.checks === "" || /^\d of \d checks passed$/.test(r.checks)));
  assert.deepEqual(roundRows([{ n: 1, outcome: "pass", label: "Round 1 · Passed", wellFormed: true, checks: [{ n: 1, answer: "yes" }, { n: 2, answer: "no" }] }]),
    [{ n: 1, label: "Round 1 · Passed", tone: "ok", checks: "1 of 2 checks passed" }]);
  assert.deepEqual(roundRows(null), []);
  assert.equal(factWords({ who: { name: "Artist" }, size: "S" }, { title: "A landing page" }), "By Artist · size S · from A landing page");
  assert.equal(factWords(null, null), "");
});

test("task: on a stage the site's pieces and the pick's foot share one version, and the top bar holds only the crumbs", () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../pages/task.js"), "utf8");
  const stage = src.slice(src.indexOf("function SitePage("));
  assert.match(stage, /<\$\{SiteStage\} view=\$\{view\} scores=\$\{byLetter\} \/>/, "the larger picture's line has the version's score");
  assert.match(stage, /<\$\{SiteStrip\} view=\$\{view\} scores=\$\{byLetter\} \/>/);
  assert.match(stage, /<\$\{SiteRail\} view=\$\{view\} \/>/);
  assert.match(stage, /<\$\{PickFoot\} item=\$\{pickItem\} chosen=\$\{letter\}/, "the pick follows the site on the stage");
  assert.match(stage, /const letter = site && typeof site.variant === "string" \? site.variant : null;/);
  assert.match(stage, /id="p-task-sites"/, "the harness and the crop find the stage");
  assert.match(src, /app\.setTop\(\{ crumbs \}\)/);
  assert.doesNotMatch(src, /setTop\(\{[^}]*links/, "Open the preview is not repeated in the top bar");
  assert.doesNotMatch(src, /innerHTML|dangerouslySetInnerHTML/);
  // One filled primary in the foot: Accept (or the pick); Send back is outlined, under the divider.
  const foot = src.slice(src.indexOf("function useAcceptFoot("), src.indexOf("function SitePage("));
  assert.equal((foot.match(/variant="(accept|primary)"/g) || []).length, 1);
});
