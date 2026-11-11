// GET /api/tasks (CONTRACTS-V2 17.2): six columns, the seed's tasks in their columns, order, the 20 cap,
// the who filter, and the board being off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeedV2, IDS_V2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const OPTS = { routes: ["tasks", "inbox"], inbox: ["board", "goals", "staged"], search: [] };

async function withHome(fn, seed = boardSeedV2()) {
  const h = await startV2({ ...OPTS, port: 0, boardSeed: seed });
  try { return await fn(h); } finally { await h.close(); }
}
const get = (h, q = "") => call(h.url, "GET", `/api/tasks${q}`);
const col = (j, id) => j.columns.find((c) => c.id === id);
const idsOf = (c) => c.tasks.map((t) => t.identifier);

test("the answer fits the tasks shape, with six columns in the pinned order and labels", async () => {
  await withHome(async (h) => {
    const r = await get(h);
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("tasks"), r.json), []);
    assert.deepEqual(r.json.columns.map((c) => c.id), ["backlog", "in_progress", "pending_review", "done", "failed", "canceled"]);
    assert.deepEqual(r.json.columns.map((c) => c.label), ["Backlog", "In progress", "Pending review", "Done", "Failed", "Canceled"]);
    assert.equal(r.json.total, r.json.columns.reduce((n, c) => n + c.count, 0));
  });
});

test("in progress holds STH-1 and STH-15", async () => {
  await withHome(async (h) => {
    const ids = idsOf(col((await get(h)).json, "in_progress"));
    assert.ok(ids.includes("STH-1") && ids.includes("STH-15"), ids.join());
  });
});

test("pending review holds STH-2, 7, 8, 13 and 18, each waiting for you", async () => {
  await withHome(async (h) => {
    const c = col((await get(h)).json, "pending_review");
    for (const n of [2, 7, 8, 13, 18]) {
      const t = c.tasks.find((x) => x.identifier === `STH-${n}`);
      assert.ok(t, `STH-${n} missing`);
      assert.equal(t.waitingForYou, true, `STH-${n}`);
    }
  });
});

test("STH-14 is done with its schedule label; STH-3 failed; STH-17 canceled", async () => {
  await withHome(async (h) => {
    const j = (await get(h)).json;
    const t14 = col(j, "done").tasks.find((t) => t.identifier === "STH-14");
    assert.ok(t14);
    assert.equal(t14.schedule.label, "Daily at 09:00");
    assert.ok(idsOf(col(j, "failed")).includes("STH-3"));
    assert.ok(idsOf(col(j, "canceled")).includes("STH-17"));
  });
});

test("newest first inside a column", async () => {
  await withHome(async (h) => {
    for (const c of (await get(h)).json.columns) {
      const times = c.tasks.map((t) => Date.parse(t.createdAt));
      assert.deepEqual(times, [...times].sort((a, b) => b - a), c.id);
    }
  });
});

test("?who=marketer gives STH-15 only", async () => {
  await withHome(async (h) => {
    const j = (await get(h, "?who=marketer")).json;
    const all = j.columns.flatMap(idsOf);
    assert.deepEqual(all, ["STH-15"]);
    assert.equal(j.total, 1);
  });
});

test("an unknown who is a 400", async () => {
  await withHome(async (h) => {
    const r = await get(h, "?who=nobody");
    assert.equal(r.status, 400);
    assert.ok(r.json.error.message && r.json.error.next && r.json.error.code);
  });
});

test("done holds the newest 20 while count is the full number", async () => {
  const seed = boardSeedV2();
  const base = Date.parse("2026-11-11T09:00:00.000Z");
  for (let n = 0; n < 25; n++) {
    const id = `ee000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
    const t = new Date(base - 3000 * 60000 - n * 60000).toISOString();
    seed.issues.push({
      id, companyId: seed.issues[0].companyId, projectId: seed.issues[0].projectId, identifier: `STH-${100 + n}`,
      title: `Extra accepted task ${n}`, description: "An accepted task.", status: "done", priority: "medium",
      parentId: null, assigneeAgentId: null, createdByUserId: null, originKind: "manual", originId: null,
      createdAt: t, startedAt: t, completedAt: t, updatedAt: t,
    });
  }
  await withHome(async (h) => {
    const before = col((await get(h)).json, "done").count;
    for (let n = 0; n < 25; n++) {
      const a = await call(h.url, "POST", "/api/inbox/act", { body: { id: `goal:ee000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`, action: "acknowledge" } });
      assert.equal(a.status, 200, a.text);
    }
    const c = col((await get(h)).json, "done");
    assert.equal(c.tasks.length, 20);
    assert.equal(c.count, before + 25);
  }, seed);
});

test("with the board off the answer is a 502 in the pinned error shape", async () => {
  await withHome(async (h) => {
    await h.board.close();
    const r = await get(h);
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "board_off");
    assert.ok(r.json.error.message && r.json.error.next);
  });
});
