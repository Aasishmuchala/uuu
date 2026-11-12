// CONTRACTS-V3 26.4 and 33.4: the keys added on /api/tasks/:id, /api/tasks, /api/shell and /api/settings,
// on the version 3 seed. The `answer` key of the task route is M33's and is not tested here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { forgetNeeds } from "../lib/jobs.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call, writes } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const OPTIONS = { routes: ["task", "tasks", "shell", "settings"], inbox: ["board", "goals"] };
const SEVEN = ["operations", "sales", "marketing", "studio", "support", "people", "books"];

let h;
before(async () => { h = await startV2(OPTIONS); });
after(async () => { await h?.close(); });

const get = (path) => call(h.url, "GET", path);

test("a task answer fits its shape and carries job, follows and next", async () => {
  forgetNeeds();
  const r = await get("/api/tasks/STH-21");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(sameShape(readShape("task"), r.json), []);
  assert.deepEqual(r.json.job, { id: "sales/proposal-from-a-call", title: r.json.task.job.title, department: "sales" });
  assert.equal(r.json.follows.identifier, "STH-20");
  assert.equal(typeof r.json.follows.title, "string");
  assert.deepEqual(r.json.next.map((n) => n.jobId).every((x) => typeof x === "string"), true);
});

test("STH-20 (accepted) offers the proposal and the quotation under next, with ready and why", async () => {
  forgetNeeds();
  const r = await get("/api/tasks/STH-20");
  assert.equal(r.status, 200, r.text);
  const ids = r.json.next.map((n) => n.jobId);
  assert.ok(ids.includes("sales/proposal-from-a-call"), ids.join());
  assert.ok(ids.includes("books/quotation-from-a-call"), ids.join());
  for (const n of r.json.next) {
    assert.deepEqual(Object.keys(n).sort(), ["jobId", "label", "ready", "title", "why"]);
    assert.equal(typeof n.ready, "boolean");
    assert.equal(n.ready, n.why === null);
    assert.ok(n.title && n.label);
  }
  assert.equal(r.json.job.id, "sales/call-write-up");
  assert.equal(r.json.follows, null);
});

test("STH-23 (not accepted) offers nothing under next", async () => {
  const r = await get("/api/tasks/STH-23");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.next, []);
  const plain = await get("/api/tasks/STH-8");
  assert.deepEqual(plain.json.next, []);
  assert.equal(plain.json.follows, null);
});

test("/api/tasks?d=sales keeps only that department's tasks; ?d=nope is 400", async () => {
  const all = await get("/api/tasks");
  const sales = await get("/api/tasks?d=sales");
  assert.equal(sales.status, 200, sales.text);
  const cards = sales.json.columns.flatMap((c) => c.tasks);
  assert.ok(cards.length > 0 && cards.length < all.json.total);
  assert.ok(cards.every((c) => c.department === "sales"));
  assert.ok(cards.some((c) => c.identifier === "STH-20"));
  assert.equal(sales.json.total, cards.length);
  const bad = await get("/api/tasks?d=nope");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "bad_department");
  assert.deepEqual(writes(h.board), []);
});

test("/api/shell carries the dock: eight entries, the brain first, then the seven in file order", async () => {
  const r = await get("/api/shell");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(sameShape(readShape("shell"), r.json), []);
  assert.deepEqual(r.json.dock.map((d) => d.id), ["brain", ...SEVEN]);
  for (const d of r.json.dock) {
    assert.deepEqual(Object.keys(d), ["id", "title", "creature", "colour", "working", "needsYou"]);
    assert.ok(Number.isInteger(d.working) && Number.isInteger(d.needsYou));
  }
  assert.equal(r.json.dock[0].title, "Company brain");
  assert.equal(r.json.dock.find((d) => d.id === "sales").working >= 1, true, "Sales is working");
});

test("/api/shell's dock counts a waiting task under the department that did it, not under the Chief of staff (M51 F4)", async () => {
  const r = await get("/api/shell");
  const by = Object.fromEntries(r.json.dock.map((d) => [d.id, d.needsYou]));
  const sum = Object.values(by).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.json.counts.needsYou, "every item is counted once, on one entry");
  assert.ok(by.studio >= 1, `the Artist's sprite waits on Studio (${JSON.stringify(by)})`);
  assert.ok(by.operations < r.json.counts.needsYou - by.brain, "Operations does not collect every task's item");
  assert.equal(r.json.engine.gate, "off", "no gate in the test home, and the shell says so (M52 F4)");
});

test("settings: the new values, their lists, and dark when nothing was saved", async () => {
  const home = await startV2({ routes: ["settings"], inbox: [], search: [] });
  try {
    const r = await call(home.url, "GET", "/api/settings");
    assert.deepEqual(r.json.appearance, { theme: "dark", accent: "graphite", backdrop: "aurora", motion: "on" });
    assert.deepEqual(r.json.backdrops.map((b) => b.id), ["aurora", "stars", "plain"]);
    assert.deepEqual(sameShape(readShape("settings"), r.json), []);
    const p = await call(home.url, "POST", "/api/settings", { body: { backdrop: "stars", motion: "off" } });
    assert.equal(p.status, 200);
    assert.deepEqual(p.json.appearance, { theme: "dark", accent: "graphite", backdrop: "stars", motion: "off" });
    assert.deepEqual((await call(home.url, "GET", "/api/settings")).json.appearance.backdrop, "stars");
    const bad = await call(home.url, "POST", "/api/settings", { body: { backdrop: "neon" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "bad_setting");
    const badMotion = await call(home.url, "POST", "/api/settings", { body: { motion: "sometimes" } });
    assert.equal(badMotion.status, 400);
    assert.equal((await call(home.url, "GET", "/api/settings")).json.appearance.backdrop, "stars");
  } finally { await home.close(); }
});
