// The search sources team and routines (CONTRACTS 9.1 and 9.10). The gallery source went at the switch (CONTRACTS-V3 24.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

async function withSearch(fn) {
  const h = await startV2({ routes: ["search"], inbox: [], search: ["team", "routines"], port: 0, boardSeed: boardSeedV2() });
  try { return await fn(h); } finally { await h.close(); }
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

test("a word nobody has gives no group from these sources", async () => {
  await withSearch(async (h) => {
    const r = await call(h.url, "GET", "/api/search?q=zzzqqqxx");
    for (const s of ["team", "routines"]) assert.equal(find(r, s), undefined);
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
