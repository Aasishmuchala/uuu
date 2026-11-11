// F1a item 10: only the Checker's "VERDICT:" comment is a check. Anyone else's is an ordinary comment: it makes
// no round, lists no content draft and never reads "Checked: Passed".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { roundsOf } from "../lib/staged.mjs";
import { forgetComments } from "../lib/tasks.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const STH2 = IDS.issues["STH-2"];
const inbox = async (h) => (await call(h.url, "GET", "/api/inbox")).json;
const contentDir = (h, key) => join(h.state, "tasks", "company-work", key, "content");

test("roundsOf: only the Checker's comments count; with no Checker id none do", () => {
  const mine = { body: "VERDICT: PASS - ok", authorAgentId: "chk" };
  const theirs = { body: "VERDICT: PASS - looks fine", authorAgentId: "mkt" };
  const owner = { body: "VERDICT: PASS - fine", authorAgentId: null };
  assert.deepEqual(roundsOf([theirs, mine, owner], "chk").map((r) => r.comment), [mine]);
  assert.equal(roundsOf([theirs, mine, owner], null).length, 0);
  assert.equal(roundsOf(["VERDICT: PASS - a string"], "chk").length, 0);
});

// STH-2 with the seeded check taken out and a draft in its folder; `status` for the goal.
async function start(status) {
  const h = await startV2({ routes: ["inbox", "task"], inbox: ["goals", "content"], boardSeed: boardSeed() });
  h.board.state.comments = h.board.state.comments.filter((c) => !/^\s*VERDICT:/i.test(c.body));
  h.board.state.issues.find((i) => i.id === STH2).status = status;
  mkdirSync(contentDir(h, "STH-2"), { recursive: true });
  writeFileSync(join(contentDir(h, "STH-2"), "launch.md"), "---\ntitle: Launch\nchannel: post\nplanned: 2026-12-01\n---\nSome words.\n");
  forgetComments();
  return h;
}
const say = (h, agent, body) => {
  h.board.state.comments.push({ id: `c-${agent}`, issueId: STH2, body, authorAgentId: IDS.agents[agent], createdAt: "2026-11-12T09:00:00.000Z" });
  forgetComments();
};
const launchListed = async (h) => (await inbox(h)).items.some((i) => i.id.startsWith("content:") && i.title.endsWith("Launch"));

test("a Marketer's VERDICT: PASS is an ordinary comment: no round, no draft listed, not checked", async () => {
  let h = await start("in_progress");
  try {
    say(h, "marketer", "VERDICT: PASS - looks fine");
    assert.equal(await launchListed(h), false);
    const page = (await call(h.url, "GET", `/api/tasks/${STH2}`)).json;
    assert.equal(page.acceptance.rounds.length, 0);
    const c = page.conversation.find((x) => /looks fine/.test(x.text));
    assert.equal(c.kind, "comment");
    assert.equal(c.text, "VERDICT: PASS - looks fine");
  } finally { await h.close(); }
  h = await start("done");
  try {
    say(h, "marketer", "VERDICT: PASS - looks fine");
    const item = (await inbox(h)).items.find((i) => i.id === `goal:${STH2}`);
    assert.equal(item.details.find((d) => d.label === "Checked").value, "Not checked");
  } finally { await h.close(); }
});

test("the Checker's VERDICT: PASS makes a round, lists the draft and reads Passed", async () => {
  let h = await start("in_progress");
  try {
    say(h, "checker", "VERDICT: PASS - looks fine");
    assert.equal(await launchListed(h), true);
    const page = (await call(h.url, "GET", `/api/tasks/${STH2}`)).json;
    assert.equal(page.acceptance.rounds.length, 1);
    const c = page.conversation.find((x) => /looks fine/.test(x.text));
    assert.equal(c.kind, "verdict");
    assert.equal(c.text, "Passed: looks fine");
  } finally { await h.close(); }
  h = await start("done");
  try {
    say(h, "checker", "VERDICT: PASS - looks fine");
    const item = (await inbox(h)).items.find((i) => i.id === `goal:${STH2}`);
    assert.equal(item.details.find((d) => d.label === "Checked").value, "Passed in round 1");
  } finally { await h.close(); }
});
