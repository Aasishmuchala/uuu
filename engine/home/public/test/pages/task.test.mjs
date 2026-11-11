import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../pages/task.js");
const { actArgs, roundsLine, pickRound, pickCheck, stateWord, otherNeeds, address } = mod;

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
});

test("task: Accept and Send back send the version they were showing", () => {
  const acceptance = {
    accept: { inboxId: "goal:7", action: "accept", version: "v-a1" },
    sendBack: { inboxId: "goal:7", action: "send_back", version: "v-s2" },
  };
  assert.deepEqual(actArgs(acceptance, "accept"), ["goal:7", "accept", undefined, "v-a1"]);
  assert.deepEqual(actArgs(acceptance, "sendBack", "Fix the total"), ["goal:7", "send_back", "Fix the total", "v-s2"]);
});

test("task: a refused action says what the server said, in place", async () => {
  const { changedText, isChangedSinceSeen } = await import("../../kit/decision.js");
  const err = { code: "changed_since_seen", message: "This changed after you looked at it. Nothing was done.", next: "Look at it again, then decide." };
  assert.equal(isChangedSinceSeen(err), true);
  assert.deepEqual(changedText(err), { message: err.message, next: err.next });
});
