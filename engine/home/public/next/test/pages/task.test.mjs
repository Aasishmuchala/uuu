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
const { actArgs, roundsLine, pickRound, pickCheck, stateWord, otherNeeds, address, storyOf, askOf, nextLinks, sideLayout, roundMarker, resultFiles } = mod;

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

test("task: the result's files leave out the staged documents", () => {
  const d = seed[8];
  const names = resultFiles(d.files, d.stages).map((f) => f.name);
  assert.ok(!names.includes("00-brief.md") && !names.includes("01-plan.md") && !names.includes("04-summary.md"));
  assert.ok(names.includes("art/walker/walker.gif"));
  assert.deepEqual(resultFiles(null, null), []);
});
