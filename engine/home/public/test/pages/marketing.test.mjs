import test from "node:test";
import assert from "node:assert/strict";
import { groupByWeek, draftIdOf, itemFor } from "../../pages/marketing.js";

const WED = new Date(2026, 10, 11);
const where = (planned) => {
  const g = groupByWeek([{ planned, title: "x" }], WED).find((x) => x.rows.length);
  return g.title;
};

test("groupByWeek: 12 Nov is this week", () => assert.equal(where("2026-11-12"), "This week"));
test("groupByWeek: 16 Nov is next week", () => assert.equal(where("2026-11-16"), "Next week"));
test("groupByWeek: 30 Nov is later", () => assert.equal(where("2026-11-30"), "Later"));
test("groupByWeek: no date and a bad date go under No date", () => {
  assert.equal(where(""), "No date");
  assert.equal(where(undefined), "No date");
  assert.equal(where("soon"), "No date");
});
test("groupByWeek: a past date is this week", () => {
  assert.equal(where("2026-11-03"), "This week");
  assert.equal(where("2025-01-01"), "This week");
});
test("groupByWeek: Monday and Sunday edges, and today as text", () => {
  assert.equal(where("2026-11-09"), "This week");
  assert.equal(where("2026-11-15"), "This week");
  assert.equal(where("2026-11-22"), "Next week");
  assert.equal(where("2026-11-23"), "Later");
  const g = groupByWeek([{ planned: "2026-11-16" }], "2026-11-15");
  assert.equal(g[1].rows.length, 1);
});
test("groupByWeek: always four groups in order, rows sorted by date", () => {
  const g = groupByWeek([{ planned: "2026-11-13" }, { planned: "2026-11-10" }], WED);
  assert.deepEqual(g.map((x) => x.title), ["This week", "Next week", "Later", "No date"]);
  assert.deepEqual(g[0].rows.map((r) => r.planned), ["2026-11-10", "2026-11-13"]);
  assert.deepEqual(groupByWeek(null, WED).map((x) => x.rows.length), [0, 0, 0, 0]);
});
test("draftIdOf and itemFor read the inbox id", () => {
  const row = { inboxId: "content:0123456789ab" };
  assert.equal(draftIdOf(row), "0123456789ab");
  assert.equal(draftIdOf({ inboxId: "content:../x" }), null);
  assert.equal(draftIdOf({}), null);
  const item = { id: "content:0123456789ab" };
  assert.equal(itemFor(row, { items: [item] }), item);
  assert.equal(itemFor(row, { items: [] }), null);
});
