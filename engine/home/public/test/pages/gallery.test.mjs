// Ready-made goals page: its helpers are pure and are checked here; the page itself loads in Node.
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../pages/gallery.js");

const DEPS = [
  { id: "general", title: "General", goals: [{ id: "general/a", title: "A" }] },
  { id: "books", title: "Books", goals: [{ id: "books/b", title: "B" }, { id: "books/c", title: "C" }] },
];

test("gallery: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("gallery: pick gives every goal for All and one department's otherwise", () => {
  assert.deepEqual(mod.pick(DEPS, "all").map((g) => g.id), ["general/a", "books/b", "books/c"]);
  assert.deepEqual(mod.pick(DEPS, null).map((g) => g.id), ["general/a", "books/b", "books/c"]);
  assert.deepEqual(mod.pick(DEPS, "books").map((g) => g.id), ["books/b", "books/c"]);
  assert.deepEqual(mod.pick(DEPS, "nope"), []);
  assert.deepEqual(mod.pick(null, "books"), []);
});

test("gallery: find gives one goal by its id or null", () => {
  assert.equal(mod.find(DEPS, "books/c").title, "C");
  assert.equal(mod.find(DEPS, "books/zzz"), null);
  assert.equal(mod.find(DEPS, ""), null);
  assert.equal(mod.find(undefined, "books/c"), null);
});
