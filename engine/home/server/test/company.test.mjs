// The Company page (CONTRACTS 9.5): agents with their state and current work, pause and resume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeed, IDS } from "../../../test/stubs/seed.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}

test("lists every agent with state, current work and boss", async () => {
  const seed = boardSeed();
  seed.agents.find((a) => a.id === IDS.agents.sales).status = "paused";
  seed.agents.find((a) => a.id === IDS.agents.support).status = "error";
  seed.agents.find((a) => a.id === IDS.agents.people).status = "pending_approval";
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/company");
    assert.equal(r.status, 200);
    const d = r.json;
    assert.equal(d.connected, true);
    assert.equal(d.company.name, "Sthyra");
    assert.equal(d.agents.length, 9);
    const by = Object.fromEntries(d.agents.map((a) => [a.slug, a]));
    for (const a of d.agents) {
      for (const k of ["id", "slug", "name", "title", "tool", "reportsTo", "state", "plainState", "doingNow", "lastActiveAt", "problem"]) assert.ok(k in a, `${a.slug} ${k}`);
    }
    assert.deepEqual(by.builder.doingNow, { title: "Draft the price list", goalId: IDS.issues["STH-1"] });
    assert.equal(by.builder.state, "working");
    assert.equal(by.builder.reportsTo, "Chief of staff");
    assert.equal(by["chief-of-staff"].reportsTo, null);
    assert.equal(by["chief-of-staff"].state, "free");
    assert.equal(by["chief-of-staff"].doingNow, null);
    assert.equal(by.checker.tool, "codex");
    assert.equal(by.sales.state, "paused");
    assert.equal(by.support.state, "problem");
    assert.equal(typeof by.support.problem, "string");
    assert.equal(by.people.state, "waiting_for_you");
    assert.equal(by.drafter.problem, null);
    for (const a of d.agents) assert.ok(a.plainState && !/_/.test(a.plainState));
  }, { boardSeed: seed });
});

test("pause and resume call the board and answer with the agent", async () => {
  await withHome(async (h) => {
    const id = IDS.agents.marketer;
    const p = await call(h.url, "POST", `/api/company/agents/${id}/pause`, { body: {} });
    assert.equal(p.status, 200);
    assert.equal(p.json.ok, true);
    assert.equal(p.json.agent.state, "paused");
    let w = h.board.requests.filter((x) => x.method !== "GET").at(-1);
    assert.equal(`${w.method} ${w.path}`, `POST /api/agents/${id}/pause`);
    const r = await call(h.url, "POST", `/api/company/agents/${id}/resume`, { body: {} });
    assert.equal(r.json.agent.state, "free");
    w = h.board.requests.filter((x) => x.method !== "GET").at(-1);
    assert.equal(`${w.method} ${w.path}`, `POST /api/agents/${id}/resume`);
    assert.equal((await call(h.url, "POST", "/api/company/agents/nobody/pause", { body: {} })).status, 404);
    assert.equal((await call(h.url, "POST", `/api/company/agents/${id}/pause`, { bare: true })).status, 403);
  });
});

test("board off: not connected, still 200", async () => {
  await withHome(async (h) => {
    await h.board.close();
    const r = await call(h.url, "GET", "/api/company");
    assert.equal(r.status, 200);
    assert.equal(r.json.connected, false);
    assert.match(r.json.notConnected.reason, /board is not answering/);
    assert.equal(r.json.notConnected.next, "Run: engine start");
    assert.deepEqual(r.json.agents, []);
    assert.equal((await call(h.url, "POST", `/api/company/agents/${IDS.agents.builder}/pause`, { body: {} })).status, 502);
  });
});
