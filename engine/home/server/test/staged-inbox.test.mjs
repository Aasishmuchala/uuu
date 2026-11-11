// The staged Needs-you items (CONTRACTS-V2 17.4) and the finished-task item of the goals source, on the
// version 2 seed: a plan to accept (STH-7), a question (STH-13), a task stopped at the cap (STH-18), and
// the delivery of STH-8. Every write is checked on the stub board's requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const DAY = 24 * 60 * 60 * 1000;
const I = IDS_V2.issues;

// The seed's clock is set a few hours ahead of a real morning; move every seeded time a week back so a
// comment the owner posts now is newer than what the agents wrote.
function pastSeed() {
  const s = boardSeedV2();
  const back = (v) => (typeof v === "string" && Date.parse(v) ? new Date(Date.parse(v) - 7 * DAY).toISOString() : v);
  for (const list of [s.issues, s.comments]) {
    for (const x of list) for (const k of ["createdAt", "updatedAt", "startedAt", "completedAt"]) if (k in x) x[k] = back(x[k]);
  }
  return s;
}

async function withHome(fn) {
  const h = await startV2({ routes: ["inbox"], inbox: ["goals", "staged"], boardSeed: pastSeed() });
  try { return await fn(h); } finally { await h.close(); }
}

const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const actOn = (h, id, action, note) => call(h.url, "POST", "/api/inbox/act", { body: note === undefined ? { id, action } : { id, action, note } });
const writesSince = (h, n) => h.board.requests.slice(n).filter((r) => r.method !== "GET").map((r) => ({ call: `${r.method} ${r.path}`, body: r.body }));
const doc = (h, key, name) => join(h.state, "tasks", "company-work", key, name);

// needs-you-item without the three keys the task model adds (decorateInbox); /api/inbox lists raw items.
const ITEM_SHAPE = (() => { const s = readShape("needs-you-item"); delete s.taskId; delete s.identifier; delete s.agent; return s; })();

const PLAN_ID = `staged:plan:${I["STH-7"]}`;
const STOPPED_ID = `staged:stopped:${I["STH-18"]}`;
const QUESTIONS = [
  "How much discount can the kitchen range take, in rupees or in percent?",
  "Is the offer for new customers only, or for repeat customers too?",
];
const hash8 = (qs) => createHash("sha256").update(qs.join("\n")).digest("hex").slice(0, 8);
const UNCLEAR_ID = `staged:unclear:${I["STH-13"]}:${hash8(QUESTIONS)}`;

test("the seed lists the three staged items, each fitting the needs-you-item shape", async () => {
  await withHome(async (h) => {
    const d = await inbox(h);
    const staged = d.items.filter((i) => i.id.startsWith("staged:"));
    assert.deepEqual(staged.map((i) => i.id).sort(), [PLAN_ID, STOPPED_ID, UNCLEAR_ID].sort());
    for (const item of staged) {
      assert.deepEqual(sameShape(ITEM_SHAPE, item), [], item.id);
      assert.equal(item.source, "goal");
      assert.equal(item.raisedBy, "Chief of staff");
      assert.equal(item.link.page, "tasks");
      assert.ok(!("_goalId" in item));
    }
    assert.ok(!d.notConnected.length, JSON.stringify(d.notConnected));
  });
});

test("plan to accept: STH-7 with its approach and three steps; accept posts PLAN ACCEPTED, then todo, and it is gone", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === PLAN_ID);
    assert.equal(item.kind, "approval");
    assert.equal(item.severity, "normal");
    assert.equal(item.title, "Plan ready: Open a second showroom page on the website");
    assert.deepEqual(item.link, { page: "tasks", id: I["STH-7"] });
    assert.equal(item.details[0].label, "Approach");
    assert.ok(item.details[0].value.length <= 200);
    assert.match(item.details[0].value, /^Copy the structure of the first showroom page/);
    assert.deepEqual(item.details.slice(1).map((x) => x.label), ["Step 1", "Step 2", "Step 3"]);
    assert.equal(item.details[1].value, "Write the page copy and three photo captions (Marketer)");
    assert.equal(item.details[2].value, "Draw a banner for the top of the page (Artist)");
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]),
      [["accept", "Accept the plan", "primary", false], ["send_back", "Send back", "plain", true]]);

    const n = h.board.requests.length;
    const r = await actOn(h, PLAN_ID, "accept");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(writesSince(h, n), [
      { call: `POST /api/issues/${I["STH-7"]}/comments`, body: { body: "PLAN ACCEPTED" } },
      { call: `PATCH /api/issues/${I["STH-7"]}`, body: { status: "todo" } },
    ]);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === PLAN_ID));
  });
});

test("plan send back: needs a note, then posts the note as typed and sets todo", async () => {
  await withHome(async (h) => {
    const n = h.board.requests.length;
    for (const note of [undefined, "", "   "]) {
      const r = await actOn(h, PLAN_ID, "send_back", note);
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, "needs_note");
    }
    assert.deepEqual(writesSince(h, n), []);
    const r = await actOn(h, PLAN_ID, "send_back", "  Use the Whitefield photos, not the old ones.  ");
    assert.equal(r.status, 200);
    assert.deepEqual(writesSince(h, n), [
      { call: `POST /api/issues/${I["STH-7"]}/comments`, body: { body: "Use the Whitefield photos, not the old ones." } },
      { call: `PATCH /api/issues/${I["STH-7"]}`, body: { status: "todo" } },
    ]);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === PLAN_ID));
  });
});

test("a new PLAN READY after the owner's note brings the plan back", async () => {
  await withHome(async (h) => {
    await actOn(h, PLAN_ID, "send_back", "Shorter, please.");
    assert.ok(!(await inbox(h)).items.some((i) => i.id === PLAN_ID));
    h.board.state.comments.push({
      id: "c-ready-2", issueId: I["STH-7"], body: "PLAN READY: shorter now.", authorAgentId: IDS_V2.agents["chief-of-staff"],
      authorUserId: null, createdAt: new Date(Date.now() + 60000).toISOString(),
    });
    forgetComments();
    const back = (await inbox(h)).items.find((i) => i.id === PLAN_ID);
    assert.equal(back.summary, "shorter now.");
  });
});

test("a question: STH-13 lists two questions; answer posts ANSWER:, sets todo, and it is gone though the file still asks", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id.startsWith(`staged:unclear:${I["STH-13"]}:`));
    assert.equal(item.id, UNCLEAR_ID);
    assert.match(item.id, /:[0-9a-f]{8}$/);
    assert.equal(item.kind, "question");
    assert.equal(item.severity, "normal");
    assert.equal(item.title, "A question before work goes on: Plan the Diwali offer");
    assert.deepEqual(item.details, [{ label: "Question 1", value: QUESTIONS[0] }, { label: "Question 2", value: QUESTIONS[1] }]);
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]),
      [["answer", "Answer", "primary", true], ["stop", "Stop this task", "danger", false]]);

    const n = h.board.requests.length;
    assert.equal((await actOn(h, UNCLEAR_ID, "answer")).status, 400);
    assert.deepEqual(writesSince(h, n), []);
    const r = await actOn(h, UNCLEAR_ID, "answer", " Ten percent, and repeat customers too. ");
    assert.equal(r.status, 200);
    assert.deepEqual(writesSince(h, n), [
      { call: `POST /api/issues/${I["STH-13"]}/comments`, body: { body: "ANSWER: Ten percent, and repeat customers too." } },
      { call: `PATCH /api/issues/${I["STH-13"]}`, body: { status: "todo" } },
    ]);
    assert.match(readFileSync(doc(h, "STH-13", "00-brief.md"), "utf8"), /How much discount/);
    assert.ok(!(await inbox(h)).items.some((i) => i.id.startsWith(`staged:unclear:${I["STH-13"]}`)));
    const saved = JSON.parse(readFileSync(join(h.state, "home", "decisions.json"), "utf8"));
    assert.ok(saved[`answered:${UNCLEAR_ID}`]);

    // a changed question is a new item with a new id
    const file = doc(h, "STH-13", "00-brief.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("in rupees or in percent?", "in rupees?"));
    const again = (await inbox(h)).items.find((i) => i.id.startsWith(`staged:unclear:${I["STH-13"]}:`));
    assert.ok(again);
    assert.notEqual(again.id, UNCLEAR_ID);
    assert.equal(again.details[0].value, "How much discount can the kitchen range take, in rupees?");
  });
});

test("a question: stop cancels the task", async () => {
  await withHome(async (h) => {
    const n = h.board.requests.length;
    assert.equal((await actOn(h, UNCLEAR_ID, "stop")).status, 200);
    assert.deepEqual(writesSince(h, n), [{ call: `PATCH /api/issues/${I["STH-13"]}`, body: { status: "cancelled" } }]);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === UNCLEAR_ID));
  });
});

test("stopped at the cap: STH-18 is high with Why and Rounds 5 of 5; stop cancels it", async () => {
  await withHome(async (h) => {
    const item = (await inbox(h)).items.find((i) => i.id === STOPPED_ID);
    assert.equal(item.kind, "problem");
    assert.equal(item.severity, "high");
    assert.equal(item.title, "Stopped: Reprice the kitchen range");
    const det = Object.fromEntries(item.details.map((x) => [x.label, x.value]));
    assert.deepEqual(Object.keys(det), ["Why", "Rounds"]);
    assert.match(det.Why, /^five check rounds did not pass/);
    assert.ok(!det.Why.includes("STOPPED:"));
    assert.equal(det.Rounds, "5 of 5");
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]),
      [["answer", "Try again with a note", "primary", true], ["stop", "Stop this task", "danger", false]]);
    const n = h.board.requests.length;
    assert.equal((await actOn(h, STOPPED_ID, "stop")).status, 200);
    assert.deepEqual(writesSince(h, n), [{ call: `PATCH /api/issues/${I["STH-18"]}`, body: { status: "cancelled" } }]);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === STOPPED_ID));
  });
});

test("stopped at the cap: try again posts the note as typed and sets todo", async () => {
  await withHome(async (h) => {
    const n = h.board.requests.length;
    assert.equal((await actOn(h, STOPPED_ID, "answer")).status, 400);
    const r = await actOn(h, STOPPED_ID, "answer", "Trust the October timber bill.");
    assert.equal(r.status, 200);
    assert.deepEqual(writesSince(h, n), [
      { call: `POST /api/issues/${I["STH-18"]}/comments`, body: { body: "Trust the October timber bill." } },
      { call: `PATCH /api/issues/${I["STH-18"]}`, body: { status: "todo" } },
    ]);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === STOPPED_ID));
  });
});

test("nothing an agent wrote is sent back to the board", async () => {
  await withHome(async (h) => {
    const n = h.board.requests.length;
    await actOn(h, PLAN_ID, "accept");
    await actOn(h, UNCLEAR_ID, "answer", "Yes.");
    await actOn(h, STOPPED_ID, "answer", "Again.");
    const bodies = writesSince(h, n).filter((w) => w.call.endsWith("/comments")).map((w) => w.body.body);
    assert.deepEqual(bodies, ["PLAN ACCEPTED", "ANSWER: Yes.", "Again."]);
  });
});

test("a finished or stopped task shows no staged item", async () => {
  await withHome(async (h) => {
    for (const key of ["STH-7", "STH-13"]) h.board.state.issues.find((i) => i.id === I[key]).status = "done";
    h.board.state.issues.find((i) => i.id === I["STH-18"]).status = "cancelled";
    const d = await inbox(h);
    assert.deepEqual(d.items.filter((i) => i.id.startsWith("staged:")), []);
    assert.deepEqual(d.notConnected, []);
  });
});

test("a brief that is a link gives no item and no error", async () => {
  await withHome(async (h) => {
    const outside = join(h.state, "outside-brief.md");
    writeFileSync(outside, readFileSync(doc(h, "STH-13", "00-brief.md"), "utf8"));
    rmSync(doc(h, "STH-13", "00-brief.md"));
    symlinkSync(outside, doc(h, "STH-13", "00-brief.md"));
    const d = await inbox(h);
    assert.ok(!d.items.some((i) => i.id.startsWith(`staged:unclear:${I["STH-13"]}`)));
    assert.deepEqual(d.notConnected, []);
    assert.ok(d.items.some((i) => i.id === PLAN_ID));
    assert.ok(readFileSync(outside, "utf8").includes("How much discount"));
  });
});

test("an open question in the newest check is asked; an owner note after STOPPED: hides the stopped item", async () => {
  await withHome(async (h) => {
    const later = (m) => new Date(Date.now() + m * 60000).toISOString();
    h.board.state.comments.push({
      id: "c-check-q", issueId: I["STH-18"], authorAgentId: IDS_V2.agents.checker, authorUserId: null, createdAt: later(1),
      body: "VERDICT: FAIL - unclear which bill\n# Check: round 6\n## Questions\n## Actions\nNone.\n## Anything unclear\n- Which timber bill is the right one?\nVerdict: FAIL",
    });
    h.board.state.comments.push({ id: "c-owner", issueId: I["STH-18"], body: "Looking.", authorAgentId: null, authorUserId: "local-board", createdAt: later(2) });
    const d = await inbox(h);
    const q = d.items.find((i) => i.id.startsWith(`staged:unclear:${I["STH-18"]}:`));
    assert.deepEqual(q.details, [{ label: "Question 1", value: "Which timber bill is the right one?" }]);
    assert.ok(!d.items.some((i) => i.id === STOPPED_ID));
  });
});

test("the delivery of STH-8: Accept, Passed in round 2, files, linked to tasks; Accept keeps the board untouched", async () => {
  await withHome(async (h) => {
    const id = `goal:${I["STH-8"]}`;
    const item = (await inbox(h)).items.find((i) => i.id === id);
    assert.deepEqual(sameShape(ITEM_SHAPE, item), []);
    assert.equal(item.kind, "result");
    assert.deepEqual(item.link, { page: "tasks", id: I["STH-8"] });
    assert.deepEqual(item.details[0], { label: "Checked", value: "Passed in round 2" });
    assert.equal(item.details[1].label, "Files");
    assert.match(item.details[1].value, /^\d+ files?$/);
    assert.ok(Number(item.details[1].value.split(" ")[0]) >= 3);
    assert.deepEqual(item.actions.map((a) => [a.id, a.label, a.style, a.needsNote]),
      [["acknowledge", "Accept", "primary", false], ["reopen", "Send back", "plain", true]]);
    const n = h.board.requests.length;
    const r = await actOn(h, id, "acknowledge");
    assert.equal(r.status, 200);
    assert.equal(r.json.message, "Accepted.");
    assert.deepEqual(writesSince(h, n), []);
    assert.ok(!(await inbox(h)).items.some((i) => i.id === id));
  });
});
