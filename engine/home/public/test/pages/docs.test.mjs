import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../pages/docs.js");

test("docs: cleanName keeps allowed characters and adds .md", () => {
  assert.equal(mod.cleanName("Refund policy"), "Refund policy.md");
  assert.equal(mod.cleanName("notes.txt"), "notes.txt");
  assert.equal(mod.cleanName("a/b\\c<>:*?.md"), "abc.md");
  assert.equal(mod.cleanName("My_doc-1"), "My_doc-1.md");
  assert.equal(mod.cleanName("  "), "");
  assert.equal(mod.cleanName(null), "");
});

test("docs: canRead accepts .txt and .md under 2 MB only", () => {
  assert.equal(mod.canRead({ name: "a.md", size: 10 }), true);
  assert.equal(mod.canRead({ name: "A.TXT", size: 2 * 1024 * 1024 - 1 }), true);
  assert.equal(mod.canRead({ name: "a.md", size: 2 * 1024 * 1024 }), false);
  assert.equal(mod.canRead({ name: "a.pdf", size: 10 }), false);
  assert.equal(mod.canRead(null), false);
});

test("docs: the page is a component", () => {
  assert.equal(typeof mod.default, "function");
});

test("splitLesson: a dated lesson line reads as words and a plain date", () => {
  assert.deepEqual(mod.splitLesson("2026-11-09: Keep files in the goal folder."), { date: "9 Nov 2026", text: "Keep files in the goal folder." });
  assert.deepEqual(mod.splitLesson("No date here"), { date: "", text: "No date here" });
  assert.deepEqual(mod.splitLesson("2026-13-01: odd"), { date: "", text: "2026-13-01: odd" });
});
