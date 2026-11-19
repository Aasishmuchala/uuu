// The `large` seed through the real home: 500 tasks on the Tasks route and 200 documents on the knowledge list.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { call } from "../lib/http.mjs";
import { startStage } from "../lib/stage.mjs";

const BASE = Number(process.env.STRESS_CHECK_BASE || 4300);
let st = null;

describe("the large seed", () => {
  before(async () => { st = await startStage({ base: BASE, dataset: "large", label: "check-large" }); });
  after(async () => { if (st) await st.close(); });

  test("the large seed gives 500 tasks on GET /api/tasks", async () => {
    const r = await call(`${st.urls.home}/api/tasks`, { timeoutMs: 30000 });
    assert.equal(r.status, 200);
    assert.equal(r.json.total, 500);
  });

  test("the large seed gives 200 files on the knowledge list (GET /api/knowledge)", async () => {
    const r = await call(`${st.urls.home}/api/knowledge`, { timeoutMs: 30000 });
    assert.equal(r.status, 200);
    assert.equal(r.json.docs.length, 200);
  });

  test("the large seed's Needs you, routines and hostile text reach the stub board", async () => {
    const board = (path) => call(`${st.urls.board}${path}`);
    const company = "c0000000-0000-4000-8000-000000000001";
    const routines = await board(`/api/companies/${company}/routines`);
    assert.equal(routines.status, 200);
    assert.equal(routines.json.length, 30);
    const issues = await board(`/api/companies/${company}/issues?limit=1000`);
    assert.ok(issues.json.some((i) => i.title === "<script>alert(1)</script>"));
    assert.ok(issues.json.some((i) => i.title.length === 5000));
    const root = st.root;
    await st.close();
    st = null;
    assert.equal(existsSync(root), false);
  });
});
