import { test } from "node:test";
import assert from "node:assert/strict";

const { splitSections, itemFor } = await import("../../pages/department.js");

const page = { sections: [
  { id: "drafts", rows: [{ name: "A", inboxId: "x" }] },
  { id: "lead_stages", rows: [{ stage: "New", count: 2 }] },
  { id: "leads", rows: [] },
  { id: "draft_replies", rows: [] },
] };

test("splitSections separates drafts, lead stages and tables", () => {
  const s = splitSections(page);
  assert.deepEqual(s.drafts.map((x) => x.id), ["drafts", "draft_replies"]);
  assert.equal(s.stages.id, "lead_stages");
  assert.deepEqual(s.tables.map((x) => x.id), ["leads"]);
  assert.deepEqual(splitSections(null), { drafts: [], stages: null, tables: [] });
});

test("itemFor finds the inbox item or returns null", () => {
  const inbox = { items: [{ id: "x", title: "T" }] };
  assert.equal(itemFor({ inboxId: "x" }, inbox).title, "T");
  assert.equal(itemFor({ inboxId: "y" }, inbox), null);
  assert.equal(itemFor({ name: "n" }, inbox), null);
  assert.equal(itemFor({ inboxId: "x" }, [{ id: "x" }]).id, "x");
  assert.equal(itemFor({ inboxId: "x" }, null), null);
});
