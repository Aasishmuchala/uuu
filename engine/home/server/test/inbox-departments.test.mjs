// M55 (M50 F1, F2): every Needs-you item that GET /api/inbox lists carries `agent` and `department`, by one rule
// (lib/tasks.mjs decorateInbox): an item about a task counts for the task's department, not for the Chief of
// staff who raised it. The map's count lines add up to the same numbers, so the map, the dock and the Needs you
// filter agree. With the board off the items are still listed, placed by their agent's name and their source.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { inboxView } from "../lib/tasks.mjs";

const issueId = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IDS = ["operations", "sales", "marketing", "studio", "support", "people", "books"];

let h;
before(async () => { h = await startV2({ routes: ["inbox", "map", "shell"], inbox: ["board", "goals", "staged", "bench", "content"] }); });
after(async () => { await h?.close(); });

test("/api/inbox: each item names its agent and its department; a task's result counts for the task's department", async () => {
  const { items } = (await call(h.url, "GET", "/api/inbox")).json;
  assert.ok(items.length > 0, "the seed has items");
  for (const i of items) {
    assert.ok(Object.hasOwn(i, "agent"), `${i.id} has agent`);
    assert.ok(Object.hasOwn(i, "department"), `${i.id} has department`);
    assert.ok(IDS.includes(i.department), `${i.id}: ${i.department}`);
    assert.equal(Object.hasOwn(i, "identifier"), false, "no task reference is added to what the cards show");
  }
  const result = items.find((i) => i.id === `goal:${issueId(25)}`);
  assert.ok(result, "the seed's animated title card waits for the owner");
  assert.equal(result.raisedBy, "Chief of staff");
  assert.equal(result.department, "studio", "the animated title card is the Studio's work");
  const concepts = items.find((i) => i.id === `goal:${issueId(23)}`);
  assert.equal(concepts.department, "marketing", "Marketing's five concepts count for Marketing");
});

test("/api/inbox and /api/map agree: each department's count is the number of its items", async () => {
  const { items } = (await call(h.url, "GET", "/api/inbox")).json;
  const map = (await call(h.url, "GET", "/api/map")).json;
  const shell = (await call(h.url, "GET", "/api/shell")).json;
  const asks = map.brain.unread;
  let total = 0;
  for (const d of map.departments) {
    total += d.counts.needsYou;
    const dock = (shell.dock || []).find((x) => x.id === d.id);
    assert.ok(dock, `${d.id} is on the dock`);
    assert.equal(dock.needsYou, d.counts.needsYou, `${d.id}: the dock and the map agree`);
  }
  assert.equal(total + asks, items.length, "every item counts once: on a department, or on the brain (an answer)");
});

test("inboxView without the board: by the source dashboard, else the agent's name in the role files, else Operations", () => {
  const roles = [{ slug: "bookkeeper", name: "Bookkeeper" }, { slug: "chief-of-staff", name: "Chief of staff" }];
  const out = inboxView([
    { id: "a", source: "books", raisedBy: "Bookkeeper" },
    { id: "b", source: "customers", raisedBy: "Someone" },
    { id: "c", source: "goal", raisedBy: "The Chief of staff" },
    { id: "d", source: "board", raisedBy: "The board" },
  ], null, roles);
  assert.deepEqual(out.map((i) => [i.agent?.slug ?? null, i.department]), [
    ["bookkeeper", "books"], [null, "sales"], ["chief-of-staff", "operations"], [null, "operations"],
  ]);
});
