// Home's pure helpers, with the contract's shape files as input (CONTRACTS-V2 17.2, 17.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shape = (name) => JSON.parse(readFileSync(join(here, "../../../server/test/shapes", `${name}.json`), "utf8"));
const page = await import("../../pages/home.js");

const items = (n) => {
  const base = shape("needs-you-item");
  return Array.from({ length: n }, (_, i) => ({ ...base, id: `goal:${i}` }));
};

test("home: visible shows the first five, and every item once expanded", () => {
  const { visible } = page;
  assert.equal(visible(items(12), false).length, 5);
  assert.deepEqual(visible(items(12), false).map((i) => i.id), ["goal:0", "goal:1", "goal:2", "goal:3", "goal:4"]);
  assert.equal(visible(items(12), true).length, 12);
  assert.equal(visible(items(3), false).length, 3);
  assert.deepEqual(visible(shape("home").needsYou.items, false), shape("home").needsYou.items);
  assert.deepEqual(visible(undefined, false), []);
  assert.deepEqual(visible(null, true), []);
});

test("home: runningTitle words", () => {
  const { runningTitle } = page;
  assert.equal(runningTitle(0), "Nothing is running");
  assert.equal(runningTitle(1), "1 task running");
  assert.equal(runningTitle(3), "3 tasks running");
  assert.equal(runningTitle(undefined), "Nothing is running");
  assert.equal(runningTitle(shape("home").running.length), "1 task running");
});

test("home: workingLine counts the agents that are working", () => {
  const { workingLine } = page;
  const team = shape("shell").team;
  assert.equal(workingLine(team), "No agent is working right now.");
  assert.equal(workingLine([...team, { ...team[0], slug: "artist", state: "working" }]), "1 agent is working.");
  assert.equal(workingLine([{ state: "working" }, { state: "working" }, { state: "free" }]), "2 agents are working.");
  assert.equal(workingLine([]), "");
});

test("home: templatesFrom flattens the gallery's goals", () => {
  const { templatesFrom } = page;
  const t = templatesFrom(shape("gallery"));
  assert.equal(t.length, 1);
  assert.equal(t[0].id, "books/draft-an-invoice");
  assert.equal(t[0].department, "books");
  assert.equal(t[0].to, "bookkeeper");
  assert.deepEqual(templatesFrom(null), []);
  assert.deepEqual(templatesFrom({ departments: [{ id: "x", goals: [{ id: "x/a" }, null] }] }), []);
});

test("home: keepHandled keeps a handled item in its place after a refresh drops it", () => {
  const { keepHandled } = page;
  const all = items(4);
  const handled = { "goal:1": { item: all[1], index: 1 } };
  assert.deepEqual(keepHandled([all[0], all[2], all[3]], handled).map((i) => i.id), ["goal:0", "goal:1", "goal:2", "goal:3"]);
  assert.deepEqual(keepHandled(all, handled).map((i) => i.id), ["goal:0", "goal:1", "goal:2", "goal:3"]);
  assert.deepEqual(keepHandled([], handled).map((i) => i.id), ["goal:1"]);
  assert.deepEqual(keepHandled(all, {}).length, 4);
});

test("home: goalBody sends only what POST /api/goals takes", () => {
  const { goalBody } = page;
  assert.deepEqual(goalBody({ text: "  Draft an invoice  " }), { text: "Draft an invoice" });
  assert.deepEqual(goalBody({ text: "x", to: "artist", planFirst: true, template: "studio/walk" }),
    { text: "x", to: "artist", planFirst: true, template: "studio/walk" });
  assert.deepEqual(goalBody({ text: "x", to: "chief-of-staff", planFirst: false }), { text: "x" });
});

test("home: the default export is a component", () => {
  assert.equal(typeof page.default, "function");
});
