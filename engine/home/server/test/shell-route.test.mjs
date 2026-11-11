// GET /api/shell (CONTRACTS-V2 17.9), on the stub board and the stub bench.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startStubsHome } from "../lib/stubs.mjs";
import { loadCompanyFile } from "../../../company/lib/company-file.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const get = async (h, path = "/api/shell") => {
  const r = await fetch(h.url + path);
  return { status: r.status, json: await r.json() };
};
const withHome = async (fn) => {
  const h = await startStubsHome({ port: 0 });
  try { return await fn(h); } finally { await h.close(); }
};

test("shell: every key of the example in 17.9, key by key", async () => {
  const example = JSON.parse(readFileSync(join(HERE, "shapes", "shell.json"), "utf8"));
  await withHome(async (h) => {
    const r = await get(h);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), Object.keys(example).sort());
    for (const k of ["company", "counts", "engine"]) assert.deepEqual(Object.keys(r.json[k]).sort(), Object.keys(example[k]).sort(), k);
    assert.deepEqual(Object.keys(r.json.team[0]).sort(), Object.keys(example.team[0]).sort());
    assert.deepEqual(Object.keys(r.json.departments[0]).sort(), Object.keys(example.departments[0]).sort());
    assert.equal(r.json.company.name, "Sthyra");
    assert.ok(!Number.isNaN(Date.parse(r.json.generatedAt)));
  });
});

test("shell: one team row per agent of the company file, in order, the Builder working", async () => {
  await withHome(async (h) => {
    const file = loadCompanyFile(join(h.config.engineDir, "company", "company.json"), h.config);
    const r = await get(h);
    assert.deepEqual(r.json.team.map((t) => t.slug), file.agents.map((a) => a.slug));
    assert.deepEqual(r.json.team.map((t) => t.name), file.agents.map((a) => a.name));
    const builder = r.json.team.find((t) => t.slug === "builder");
    assert.equal(builder.state, "working");
    assert.equal(builder.plainState, "Working");
    assert.equal(typeof builder.waitingForYou, "boolean");
  });
});

test("shell: six departments in the pinned order, all connected with the bench on", async () => {
  await withHome(async (h) => {
    const r = await get(h);
    assert.deepEqual(r.json.departments.map((d) => d.id), ["books", "customers", "support", "people", "marketing", "studio"]);
    assert.deepEqual(r.json.departments.map((d) => d.title), ["Books", "Customers", "Support", "People", "Marketing", "Studio"]);
    assert.deepEqual(r.json.engine, { board: "on", books: "on" });
    assert.ok(r.json.departments.every((d) => d.connected === true));
  });
});

test("shell: counts.needsYou equals the inbox's total", async () => {
  await withHome(async (h) => {
    const inbox = await get(h, "/api/inbox");
    const r = await get(h);
    assert.equal(r.json.counts.needsYou, inbox.json.counts.total);
    assert.ok(r.json.counts.needsYou > 0);
    assert.equal(typeof r.json.counts.running, "number");
    assert.ok(r.json.counts.tasksOpen >= r.json.counts.running);
  });
});

test("shell: with the board stopped it is still 200, board off, every row free", async () => {
  await withHome(async (h) => {
    await h.board.close();
    const r = await get(h);
    assert.equal(r.status, 200);
    assert.equal(r.json.engine.board, "off");
    assert.ok(r.json.team.length > 0);
    assert.ok(r.json.team.every((t) => t.state === "free"));
    assert.equal(r.json.counts.running, 0);
    assert.equal(r.json.counts.tasksOpen, 0);
  });
});

test("shell: a second request within a second makes no more than four board calls", async () => {
  await withHome(async (h) => {
    await get(h);
    const from = h.board.requests.length;
    assert.equal((await get(h)).status, 200);
    assert.ok(h.board.requests.length - from <= 4, `${h.board.requests.length - from} board calls`);
  });
});

test("shell: reads only, never writes to the board", async () => {
  await withHome(async (h) => {
    const from = h.board.requests.length;
    await get(h);
    assert.ok(h.board.requests.slice(from).every((x) => x.method === "GET"));
  });
});
