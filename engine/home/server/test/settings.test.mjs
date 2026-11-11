// GET and POST /api/settings (CONTRACTS-V2 17.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { boardSeedV2 } from "../../../test/stubs/seed.mjs";
import { call } from "../lib/testing.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

async function withHome(fn) {
  const h = await startV2({ routes: ["settings"], inbox: [], search: [], port: 0, boardSeed: boardSeedV2() });
  try { return await fn(h); } finally { await h.close(); }
}

test("the default is auto and graphite and the answer fits its shape", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/settings");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.appearance, { theme: "auto", accent: "graphite" });
    assert.deepEqual(sameShape(readShape("settings"), r.json), []);
    assert.deepEqual(r.json.accents.map((a) => a.id), ["graphite", "blue", "green", "violet", "orange", "rose"]);
  });
});

test("an accent that is posted is kept and read back", async () => {
  await withHome(async (h) => {
    const p = await call(h.url, "POST", "/api/settings", { body: { accent: "blue" } });
    assert.equal(p.status, 200);
    assert.equal(p.json.ok, true);
    assert.deepEqual(p.json.appearance, { theme: "auto", accent: "blue" });
    const t = await call(h.url, "POST", "/api/settings", { body: { theme: "dark" } });
    assert.deepEqual(t.json.appearance, { theme: "dark", accent: "blue" });
    const r = await call(h.url, "GET", "/api/settings");
    assert.deepEqual(r.json.appearance, { theme: "dark", accent: "blue" });
  });
});

test("an unknown accent or theme is refused as bad_setting and nothing changes", async () => {
  await withHome(async (h) => {
    const a = await call(h.url, "POST", "/api/settings", { body: { accent: "pink" } });
    assert.equal(a.status, 400);
    assert.equal(a.json.error.code, "bad_setting");
    const t = await call(h.url, "POST", "/api/settings", { body: { theme: "neon" } });
    assert.equal(t.status, 400);
    assert.equal(t.json.error.code, "bad_setting");
    const r = await call(h.url, "GET", "/api/settings");
    assert.deepEqual(r.json.appearance, { theme: "auto", accent: "graphite" });
  });
});

test("the five later entries are all off and no route turns one on", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/settings");
    assert.deepEqual(r.json.later.map((l) => l.id), ["local_model", "chat_apps", "workflow_engine", "pixel_editor", "aseprite_files"]);
    assert.ok(r.json.later.every((l) => l.on === false));
    const p = await call(h.url, "POST", "/api/settings", { body: { later: { local_model: true }, local_model: true } });
    assert.equal(p.status, 200);
    const after = await call(h.url, "GET", "/api/settings");
    assert.ok(after.json.later.every((l) => l.on === false));
  });
});
