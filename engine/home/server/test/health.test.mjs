// Health (CONTRACTS 9.9): parts, fence, not connected, disk, the proof runner, /api/state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelay } from "../../../relay/relay.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";

// A module folder holding only the core's own modules (symlinked), so a test does not change when feature
// modules are added to routes/, inbox/ or search/. Remove it with rmSync when done.
const CORE_MODULES = {
  routes: ["company", "files", "goals", "health", "inbox", "search", "state"],
  inbox: ["board", "goals"],
  search: ["goals"],
};
function coreModuleDir() {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-core-"));
  for (const [kind, names] of Object.entries(CORE_MODULES)) {
    mkdirSync(join(dir, kind));
    for (const n of names) symlinkSync(join(SERVER_DIR, kind, `${n}.mjs`), join(dir, kind, `${n}.mjs`));
  }
  return dir;
}

async function withHome(fn, opts = {}) {
  const h = await startStubsHome({ port: 0, ...opts });
  try { return await fn(h); } finally { await h.close(); }
}

const TECH = /paperclip|frappe|mariadb|erpnext|sandbox-runtime|127\.0\.0\.1|localhost|\b\d{4,5}\b/i;

test("parts, fence, not connected and disk", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/health");
    assert.equal(r.status, 200);
    const d = r.json;
    assert.deepEqual(d.parts.map((p) => p.id), ["books", "board", "gate", "relay", "home"]);
    const by = Object.fromEntries(d.parts.map((p) => [p.id, p]));
    assert.equal(by.books.state, "on");
    assert.equal(by.board.state, "on");
    assert.equal(by.gate.state, "off");
    assert.equal(by.relay.state, "off");
    assert.equal(by.relay.name, "Model relay");
    assert.equal(by.relay.sentence, "The model relay is off. Run: engine start");
    assert.match(by.relay.technical, /none in stubs mode/);
    assert.equal(by.home.state, "on");
    for (const p of d.parts) {
      assert.ok(p.name && p.sentence && p.technical);
      assert.doesNotMatch(p.sentence, TECH, p.id);
    }
    assert.match(by.board.technical, /paperclip/);
    assert.match(by.books.technical, /Frappe/);
    assert.equal(d.fence.lastProof.result, "holds");
    assert.match(d.fence.sentence, /held/);
    const ncIds = d.notConnected.map((n) => n.id);
    assert.deepEqual(ncIds, ["codex_login", "board_login", "publishing", "email", "whatsapp", "gst_portal", "renderer"]);
    for (const n of d.notConnected) assert.ok(n.label && n.explain && n.how);
    assert.equal(typeof d.disk.freeGb, "number");
    assert.equal(d.disk.floorGb, 8);
    assert.equal(typeof d.disk.ok, "boolean");
    assert.deepEqual(d.modulesFailed, []);
  });
});

test("board off and books not installed: said so, still 200", async () => {
  const core = coreModuleDir();
  await withHome(async (h) => {
    await h.board.close();
    rmSync(join(h.state, "proof", "last.json"));
    writeFileSync(join(h.state, "books", "skipped-apps.txt"), "helpdesk: not enough disk\n\n# comment\nhrms\n");
    const r = await call(h.url, "GET", "/api/health");
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.json.parts.map((p) => [p.id, p]));
    assert.equal(by.board.state, "off");
    assert.match(by.board.sentence, /off/);
    assert.match(by.board.sentence, /engine start/);
    assert.equal(r.json.fence.lastProof, null);
    assert.match(r.json.fence.sentence, /not been checked/);
    const extra = r.json.notConnected.slice(7).map((n) => n.id);
    assert.deepEqual(extra, ["app_helpdesk", "app_hrms"]);
    const s = await call(h.url, "GET", "/api/state");
    assert.equal(s.status, 200);
    assert.equal(s.json.engine.board, "off");
    assert.deepEqual(s.json.counts, { inbox: 0, goalsActive: 0, agentsWorking: 0 });
  }, { moduleDirs: [core] });
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/health");
    const books = r.json.parts.find((p) => p.id === "books");
    assert.equal(books.state, "not_installed");
    assert.doesNotMatch(books.sentence, TECH);
    const s = await call(h.url, "GET", "/api/state");
    assert.equal(s.json.engine.books, "not_installed");
  }, { benchInstalled: false, moduleDirs: [core] });
  rmSync(core, { recursive: true, force: true });
});

test("the proof runs in the background, once at a time", async () => {
  await withHome(async (h) => {
    const r = await call(h.url, "POST", "/api/health/prove", { body: {} });
    assert.equal(r.status, 202);
    assert.deepEqual(r.json, { started: true });
    const again = await call(h.url, "POST", "/api/health/prove", { body: {} });
    assert.equal(again.status, 409);
    assert.equal((await call(h.url, "POST", "/api/health/prove", { bare: true })).status, 403);
  });
});

test("state: company, counts, engine", async () => {
  const core = coreModuleDir();
  await withHome(async (h) => {
    const r = await call(h.url, "GET", "/api/state");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.company, { name: "Sthyra" });
    assert.deepEqual(r.json.counts, { inbox: 5, goalsActive: 2, agentsWorking: 1 });
    assert.deepEqual(r.json.engine, { board: "on", books: "on" });
    assert.ok(Date.parse(r.json.generatedAt));
  }, { moduleDirs: [core] });
  rmSync(core, { recursive: true, force: true });
});

test("the model relay: idle in plans mode, the only way out in provider mode, and off said plainly", async () => {
  await withHome(async (h) => {
    const p = h.config.paths;
    const relay = createRelay({
      listenPort: 0, upstream: "http://127.0.0.1:9", log: () => {},
      paths: { state: p.modelsState, ids: p.ids, key: p.providerKey, secret: p.relaySecret, status: p.relayStatus },
    });
    await relay.listen();
    try {
      h.app.home.urls.relay = `http://127.0.0.1:${relay.port}`;
      const part = async () => (await call(h.url, "GET", "/api/health")).json.parts.find((x) => x.id === "relay");
      let r = await part();
      assert.equal(r.state, "on");
      assert.equal(r.sentence, "The model relay is on. It is idle: your agents use your Claude and Codex plans.");
      assert.match(r.technical, /model relay on http:\/\/127\.0\.0\.1:/);
      assert.doesNotMatch(r.sentence, TECH);
      mkdirSync(p.models, { recursive: true, mode: 0o700 });
      writeFileSync(p.modelsState, JSON.stringify({ version: 1, mode: "provider", picks: {} }), { mode: 0o600 });
      chmodSync(p.modelsState, 0o600);
      r = await part();
      assert.equal(r.sentence, "The model relay is on. Your agents reach Omega Plus only through it.");
      await relay.close();
      r = await part();
      assert.equal(r.state, "off");
      assert.equal(r.sentence, "The model relay is off, so your agents cannot reach their models. Run: engine start");
      assert.doesNotMatch(r.sentence, TECH);
    } finally {
      await relay.close();
    }
  });
});
