import { test } from "node:test";
import assert from "node:assert/strict";

const { DASHBOARDS, cardFigures, waitsLine, cardState } = await import("../../pages/dashboards.js");

test("the shelf holds the six dashboards in order, each with its department", () => {
  assert.deepEqual(DASHBOARDS.map((d) => d.id), ["books", "customers", "support", "people", "marketing", "studio"]);
  assert.deepEqual(DASHBOARDS.map((d) => d.dept), ["books", "sales", "support", "people", "marketing", "studio"]);
  for (const d of DASHBOARDS) assert.ok(d.title && d.about, `${d.id} has a title and a line`);
});

test("cardFigures takes the first three figures and caps their text", () => {
  const page = { figures: [
    { id: "a", label: "You are owed", value: "₹ 1,18,000.00", hint: "1 unpaid invoice" },
    { id: "b", label: "You owe", value: "₹ 9,440.00" },
    { id: "c", label: "Sales this month", value: "₹ 1,43,000.00" },
    { id: "d", label: "Spend this month", value: "₹ 12,980.00" },
  ] };
  assert.deepEqual(cardFigures(page).map((f) => f.id), ["a", "b", "c"]);
  assert.deepEqual(cardFigures(page, 2).map((f) => f.label), ["You are owed", "You owe"]);
  assert.equal(cardFigures({ figures: [{ id: "x", label: "L".repeat(500), value: 1 }] })[0].label.length, 80);
  assert.equal(cardFigures({ figures: [{ id: "x", label: "Open", value: 4 }] })[0].value, "4");
  assert.deepEqual(cardFigures(null), []);
  assert.deepEqual(cardFigures({ figures: "no" }), []);
  assert.deepEqual(cardFigures({ figures: [null, { id: "y" }] }), []);
});

test("waitsLine names what waits for the owner, by section", () => {
  const books = { sections: [
    { id: "drafts", rows: [{ inboxId: "a" }, { inboxId: "b" }, { name: "no item" }] },
    { id: "unpaid_invoices", rows: [{ name: "x" }] },
  ] };
  assert.equal(waitsLine(books), "2 drafts wait for you.");
  assert.equal(waitsLine({ sections: [{ id: "draft_replies", rows: [{ inboxId: "a" }] }] }), "1 reply waits for you.");
  assert.equal(waitsLine({ sections: [{ id: "leave", rows: [{ inboxId: "a" }] }, { id: "drafts", rows: [{ inboxId: "b" }] }] }),
    "1 leave request and 1 draft wait for you.");
  assert.equal(waitsLine({ sections: [{ id: "other", rows: [{ inboxId: "a" }, { inboxId: "b" }] }] }), "2 items wait for you.");
});

test("waitsLine adds the tasks being worked on, and says when nothing waits", () => {
  assert.equal(waitsLine({ sections: [], inFlight: [{ goalId: "g" }] }), "1 task is being worked on.");
  assert.equal(waitsLine({ sections: [{ id: "drafts", rows: [{ inboxId: "a" }] }], inFlight: [{}, {}] }),
    "1 draft waits for you. 2 tasks are being worked on.");
  assert.equal(waitsLine({ sections: [{ id: "drafts", rows: [] }] }), "Nothing waits for you.");
  assert.equal(waitsLine({}), "Nothing waits for you.");
  assert.equal(waitsLine({ connected: false, sections: [{ id: "drafts", rows: [{ inboxId: "a" }] }] }), null);
  assert.equal(waitsLine(null), null);
});

test("cardState gives each card its own state", () => {
  assert.equal(cardState({ data: null, error: null, loading: true }), "loading");
  assert.equal(cardState({ data: null, error: new Error("x"), loading: false }), "error");
  assert.equal(cardState({ data: { connected: false, notConnected: { reason: "r" } } }), "off");
  assert.equal(cardState({ data: { connected: true, figures: [] } }), "ready");
  // A quiet refresh that failed keeps the old answer on screen.
  assert.equal(cardState({ data: { connected: true }, error: new Error("x") }), "ready");
  assert.equal(cardState(undefined), "loading");
});

test("the landing reads each card's answer by itself and links to its dashboard", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../pages/dashboards.js", import.meta.url), "utf8");
  assert.match(src, /useResource\(`\/api\/departments\/\$\{encodeURIComponent\(d\.id\)\}`/);
  assert.match(src, /#\/dashboards\/\$\{d\.id\}/);
  assert.match(src, /The figures and records of each department\. They are real: they come from your books\./);
  assert.match(src, /over="DASHBOARDS"/);
});
