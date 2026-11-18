// Brain links (plan B5): known names found in a passage, and the alias list built from entities.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aliasesOf, findMentions } from "../brain/links.mjs";

const ALIASES = [
  { entity: 1, alias: "acme interiors" },
  { entity: 2, alias: "ravi menon" },
  { entity: 3, alias: "acme" },
];

test("white space runs in the text match the spaces of an alias", () => {
  assert.deepEqual(findMentions("We promised Acme  Interiors the drawings.", ALIASES), [1, 3]);
});

test("letter case does not matter", () => {
  assert.deepEqual(findMentions("ACME INTERIORS", ALIASES), [1, 3]);
});

test("only whole words match", () => {
  assert.deepEqual(findMentions("Acmeville Interiors", ALIASES), []);
  assert.deepEqual(findMentions("pacme interiors", ALIASES), []);
});

test("a line break counts as white space", () => {
  assert.deepEqual(findMentions("Ravi\nMenon called.", ALIASES), [2]);
});

test("punctuation next to a name does not hide it", () => {
  assert.deepEqual(findMentions("Call (Ravi Menon), then Acme.", ALIASES), [3, 2].sort((a, b) => ALIASES.findIndex((r) => r.entity === a) - ALIASES.findIndex((r) => r.entity === b)));
});

test("an alias with special characters matches itself and nothing else", () => {
  const a = [{ entity: 9, alias: "a+b (c)" }];
  assert.deepEqual(findMentions("a+b (c)", a), [9]);
  assert.deepEqual(findMentions("aab (c)", a), []);
  assert.deepEqual(findMentions("a+b c", a), []);
});

test("a long run of letters against an alias with a space returns fast", () => {
  const text = "a".repeat(10000) + "!";
  const t0 = process.cpuUsage();
  assert.deepEqual(findMentions(text, [{ entity: 1, alias: "aaaa aaaa" }]), []);
  const used = process.cpuUsage(t0);
  assert.ok((used.user + used.system) / 1000 < 50);
});

test("at most 20 entities a passage, and each once", () => {
  const aliases = [];
  for (let i = 1; i <= 30; i++) aliases.push({ entity: i, alias: `name${i}x` }, { entity: i, alias: `again${i}x` });
  const text = Array.from({ length: 30 }, (_, i) => `name${i + 1}x again${i + 1}x`).join(" ");
  const got = findMentions(text, aliases);
  assert.equal(got.length, 20);
  assert.equal(new Set(got).size, 20);
});

test("no text or no aliases gives nothing", () => {
  assert.deepEqual(findMentions("", ALIASES), []);
  assert.deepEqual(findMentions("Acme", []), []);
});

test("aliasesOf lowers, squeezes, drops short ones and sorts longest first", () => {
  const rows = aliasesOf([
    { id: 1, aliases: ["Acme  Interiors"] },
    { id: 2, aliases: ["Ravi Menon", "Ra"] },
    { id: 3, aliases: ["ACME"] },
  ]);
  assert.deepEqual(rows, [
    { entity: 1, alias: "acme interiors" },
    { entity: 2, alias: "ravi menon" },
    { entity: 3, alias: "acme" },
  ]);
});

test("aliasesOf keeps at most 5,000", () => {
  const entities = Array.from({ length: 6000 }, (_, i) => ({ id: i, aliases: [`name ${i}`] }));
  assert.equal(aliasesOf(entities).length, 5000);
});
