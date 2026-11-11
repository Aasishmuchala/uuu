// U2: the page of a held task shows the pill "Stopped" (acceptance.state "stopped"), not "Not ready yet";
// Needs you lists it once; on the Tasks board it is Failed with the stage text "Stopped".
import { test } from "node:test";
import assert from "node:assert/strict";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";

test("STH-3 is held: one Needs-you item, Stopped on its page and on the board", async () => {
  const h = await startStubsHome({ port: 0, boardSeed: boardSeedV2() });
  try {
    await h.app.home.unstick.sweep();
    const inbox = (await call(h.url, "GET", "/api/inbox")).json;
    const mine = inbox.items.filter((i) => i.title === "A task stopped");
    assert.equal(mine.length, 1);
    const goalId = mine[0].link.id;
    assert.deepEqual(inbox.items.filter((i) => i.link?.id === goalId && i.id.startsWith("board:failed_run")), []);
    assert.equal(inbox.counts.total, inbox.items.length);
    const page = (await call(h.url, "GET", `/api/tasks/${goalId}`)).json;
    assert.equal(page.acceptance.state, "stopped");
    const card = (await call(h.url, "GET", "/api/tasks")).json;
    const found = JSON.stringify(card);
    assert.ok(found.includes('"label":"Stopped"'));
  } finally { await h.close(); }
});
