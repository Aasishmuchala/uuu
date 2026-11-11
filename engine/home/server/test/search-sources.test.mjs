// The search sources team, routines and gallery (CONTRACTS 9.1 and 9.10, CONTRACTS-V2 17.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const goal = (n, over = {}) => ({
  id: `goal-number-${n}`, title: `Goal ${n}`, summary: `Summary of goal ${n}.`,
  text: `Please do the number ${n} thing for [someone] with care.`, to: "bookkeeper", planFirst: false, size: "S", ...over,
});

async function withSearch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-search-goals-"));
  writeFileSync(join(dir, "books.json"), JSON.stringify({
    department: "books", title: "Books",
    goals: [goal(1, { id: "draft-an-invoice", title: "Draft an invoice", text: "Draft an invoice for [customer] for [what was sold] at [amount] plus GST." }), goal(2), goal(3), goal(4)],
  }));
  const h = await startV2({ routes: ["search", "gallery"], inbox: [], search: ["team", "routines", "gallery"], port: 0, boardSeed: boardSeedV2() });
  h.config.goalsDir = dir;
  try { return await fn(h); } finally { await h.close(); rmSync(dir, { recursive: true, force: true }); }
}

const find = (r, source) => r.json.groups.find((g) => g.source === source);

test("artist finds the Artist with a link to the team page", async () => {
  await withSearch(async (h) => {
    const r = await call(h.url, "GET", "/api/search?q=artist");
    assert.equal(r.status, 200);
    const g = find(r, "team");
    assert.ok(g, "a team group");
    assert.equal(g.label, "Team");
    const hit = g.results.find((x) => x.link.id === "artist");
    assert.ok(hit);
    assert.equal(hit.link.page, "team");
    assert.ok(g.results.length <= 8);
  });
});

test("brief finds the daily brief routine", async () => {
  await withSearch(async (h) => {
    const r = await call(h.url, "GET", "/api/search?q=brief");
    const g = find(r, "routines");
    assert.ok(g, "a routines group");
    assert.equal(g.label, "Routines");
    const hit = g.results.find((x) => x.link.id === "daily-brief");
    assert.ok(hit);
    assert.equal(hit.link.page, "routines");
  });
});

test("invoice finds the ready-made goal", async () => {
  await withSearch(async (h) => {
    const r = await call(h.url, "GET", "/api/search?q=invoice");
    const g = find(r, "gallery");
    assert.ok(g, "a gallery group");
    assert.equal(g.label, "Ready-made goals");
    assert.deepEqual(g.results[0].link, { page: "gallery", id: "books/draft-an-invoice" });
  });
});

test("a word nobody has gives no group from these sources", async () => {
  await withSearch(async (h) => {
    const r = await call(h.url, "GET", "/api/search?q=zzzqqqxx");
    for (const s of ["team", "routines", "gallery"]) assert.equal(find(r, s), undefined);
  });
});

test("a routines folder that cannot be read is reported as not searched", async () => {
  await withSearch(async (h) => {
    const file = join(tmpdir(), `uuu-not-a-folder-${process.pid}`);
    writeFileSync(file, "x");
    h.config.routinesDir = file;
    try {
      const r = await call(h.url, "GET", "/api/search?q=brief");
      const n = r.json.notSearched.find((x) => x.source === "routines");
      assert.ok(n && n.reason.length > 0);
    } finally { rmSync(file, { force: true }); }
  });
});
