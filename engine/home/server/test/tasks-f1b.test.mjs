// F1b (for F1a item 10 and the fix tasks of finding 4): on the Tasks board and in the staged items only the
// Checker's "VERDICT:" comments are check rounds; and a fix task the home server made for a draft never waits
// for the owner once its agent has finished it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { createBoard } from "../lib/board.mjs";
import { forgetComments, loadTaskContext, taskCard } from "../lib/tasks.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import stagedSource from "../inbox/staged.mjs";

const STH1 = IDS.issues["STH-1"];
const STH2 = IDS.issues["STH-2"];
const QUESTION = "Should the price list show the price with GST or without it?";
const CHECK = [
  "VERDICT: FAIL - the GST column is missing",
  "",
  "# Check: round 1",
  "",
  "## Anything unclear",
  "",
  `- ${QUESTION}`,
].join("\n");

// The task model read straight from the stub board, with a decisions store of our own.
function ctxOf(h, saved = {}) {
  const ids = () => ({ companyId: IDS.company, projectId: IDS.project, agents: IDS.agents });
  const data = { ...saved };
  return {
    board: createBoard({ baseUrl: `http://127.0.0.1:${h.board.port}`, ids, timeoutMs: 4000 }),
    ids, config: h.config, log() {}, home: { urls: { board: `http://127.0.0.1:${h.board.port}` } },
    decisions: { get: (k) => (Object.hasOwn(data, k) ? data[k] : null), set: (k, v) => { data[k] = v; return v; } },
  };
}

async function withBoard(fn) {
  const h = await startV2({ routes: [], boardSeed: boardSeed() });
  try { forgetComments(); return await fn(h); } finally { forgetComments(); await h.close(); }
}
const say = (h, agent, body) => {
  h.board.state.comments.push({ id: `c-f1b-${agent}`, issueId: STH1, body, authorAgentId: IDS.agents[agent], createdAt: "2026-11-12T09:00:00.000Z" });
  forgetComments();
};
const cardOf = async (ctx, id) => {
  const tctx = await loadTaskContext(ctx, { withInbox: false });
  return taskCard(tctx.goals.find((g) => g.id === id), tctx);
};
const stagedAbout = async (ctx) => (await stagedSource.list(ctx)).items.filter((i) => JSON.stringify(i.details || []).includes("GST"));

test("another agent's VERDICT comment makes no round on the Tasks board and no staged question", async () => {
  await withBoard(async (h) => {
    const ctx = ctxOf(h);
    const before = await cardOf(ctx, STH1);
    say(h, "builder", CHECK);
    const after = await cardOf(ctx, STH1);
    assert.equal(after.round, before.round, "no new round");
    assert.deepEqual(after.stage, before.stage, "the stage is unchanged");
    assert.deepEqual(await stagedAbout(ctx), [], "no staged item from a Builder's check");
  });
});

test("the Checker's VERDICT comment is a round, and its question is a staged item", async () => {
  await withBoard(async (h) => {
    const ctx = ctxOf(h);
    say(h, "checker", CHECK);
    const card = await cardOf(ctx, STH1);
    assert.equal(card.round, 1);
    assert.equal(card.stage.id, "check");
    const items = await stagedAbout(ctx);
    assert.equal(items.length, 1);
    assert.ok(items[0].details.some((d) => d.value === QUESTION));
  });
});

test("a finished fix task the home server recorded is Done, not waiting for the owner", async () => {
  await withBoard(async (h) => {
    // STH-2 is done and not accepted: it waits for the owner's review.
    assert.equal((await cardOf(ctxOf(h), STH2)).column, "pending_review");
    // Recorded as the fix task of a draft: the owner decides on the draft, not on this task.
    const card = await cardOf(ctxOf(h, { [`fixtask:${STH2}`]: "content:launch" }), STH2);
    assert.equal(card.column, "done");
    // A record only an agent's words could make (the line in its text) does not count.
    h.board.state.issues.find((i) => i.id === STH2).description += "\n\nDRAFT-FIX: content:launch";
    assert.equal((await cardOf(ctxOf(h), STH2)).column, "pending_review");
  });
});
