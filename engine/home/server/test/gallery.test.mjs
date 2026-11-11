// GET /api/gallery (CONTRACTS-V2 17.7), with fixture goal files in a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const INVOICE = "Draft an invoice for [customer] for [what was sold] at [amount] plus GST.";

function goal(n, over = {}) {
  return {
    id: `goal-number-${n}`, title: `Goal ${n}`, summary: `Summary of goal ${n}.`,
    text: `Please do the number ${n} thing for [someone] with care.`, to: "bookkeeper", planFirst: false, size: "S", ...over,
  };
}
const fileOf = (department, title, goals) => JSON.stringify({ department, title, goals }, null, 2);

function fixtures(files) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-gallery-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

async function withGallery(files, fn) {
  const dir = fixtures(files);
  const h = await startV2({ routes: ["gallery"], inbox: [], search: [], port: 0, boardSeed: boardSeedV2() });
  h.config.goalsDir = dir;
  try { return await fn(h); } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
}

const goodBooks = () => fileOf("books", "Books", [
  goal(1, { id: "draft-an-invoice", title: "Draft an invoice", text: INVOICE }), goal(2), goal(3), goal(4),
]);
const goodSupport = () => fileOf("support", "Support", [goal(1), goal(2), goal(3), goal(4, { to: null })]);

test("the gallery fits its shape and the blanks of the invoice goal are the three names", async () => {
  await withGallery({ "books.json": goodBooks() }, async (h) => {
    const r = await call(h.url, "GET", "/api/gallery");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("gallery"), r.json), []);
    const g = r.json.departments[0].goals[0];
    assert.equal(g.id, "books/draft-an-invoice");
    assert.deepEqual(g.blanks, ["customer", "what was sold", "amount"]);
    assert.equal(g.to, "bookkeeper");
    assert.equal(g.toName, "Bookkeeper");
  });
});

test("departments come in the pinned order and a goal with no agent has no name", async () => {
  await withGallery({ "support.json": goodSupport(), "books.json": goodBooks() }, async (h) => {
    const r = await call(h.url, "GET", "/api/gallery");
    assert.deepEqual(r.json.departments.map((d) => d.id), ["books", "support"]);
    const last = r.json.departments[1].goals[3];
    assert.equal(last.to, null);
    assert.equal(last.toName, null);
  });
});

test("a broken file is listed under problems and the others still list", async () => {
  await withGallery({ "books.json": goodBooks(), "people.json": fileOf("people", "People", [goal(1, { text: "" })]) }, async (h) => {
    const r = await call(h.url, "GET", "/api/gallery");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.departments.map((d) => d.id), ["books"]);
    assert.equal(r.json.problems.length, 1);
    assert.equal(r.json.problems[0].file, "people.json");
    assert.ok(r.json.problems[0].problem.length > 0);
  });
});

test("a missing folder gives an empty list", async () => {
  const h = await startV2({ routes: ["gallery"], inbox: [], search: [], port: 0, boardSeed: boardSeedV2() });
  h.config.goalsDir = join(tmpdir(), "uuu-gallery-does-not-exist");
  try {
    const r = await call(h.url, "GET", "/api/gallery");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.departments, []);
    assert.ok(Array.isArray(r.json.problems));
  } finally { await h.close(); }
});
