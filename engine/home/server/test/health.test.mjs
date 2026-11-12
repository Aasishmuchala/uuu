// Health (CONTRACTS 9.9): parts, fence, not connected, disk, the proof runner, /api/state; the three doors and the
// playbooks (PLAN-V5 K12).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSecret } from "../../../doors/common.mjs";
import { createRelay } from "../../../relay/relay.mjs";
import { startInternet } from "../../../test/stubs/internet.mjs";
import { createWebDoor } from "../../../web/door.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { doorStates, playbooksState } from "../lib/health.mjs";
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
    assert.deepEqual(d.parts.map((p) => p.id), ["books", "board", "gate", "relay", "web", "generate", "viewer", "playbooks", "home"]);
    const by = Object.fromEntries(d.parts.map((p) => [p.id, p]));
    assert.equal(by.books.state, "on");
    assert.equal(by.board.state, "on");
    assert.equal(by.gate.state, "off");
    assert.equal(by.relay.state, "off");
    assert.equal(by.relay.name, "Model relay");
    assert.equal(by.relay.sentence, "The model relay is off. Run: engine start");
    assert.match(by.relay.technical, /none in stubs mode/);
    // PLAN-V5 K12: a stub home's doors have no address: off, and nothing is called.
    assert.deepEqual([by.web.name, by.generate.name, by.viewer.name], ["Web door", "Generation door", "Page viewer"]);
    assert.equal(by.web.sentence, "The web door is off. Run: engine start");
    assert.equal(by.generate.sentence, "The generation door is off. Run: engine start");
    assert.equal(by.viewer.sentence, "The page viewer is off. Run: engine start");
    for (const id of ["web", "generate", "viewer"]) {
      assert.equal(by[id].state, "off");
      assert.match(by[id].technical, /none in stubs mode/);
    }
    assert.equal(by.playbooks.state, "not_installed");
    assert.equal(by.playbooks.sentence, "Playbooks are not in place. Run: engine/playbooks/install.sh");
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

// ---- PLAN-V5 K12: the three doors and the playbooks --------------------------------------------------------

// A stand-in for the generation door and the page viewer: their health answers, as `answer` says.
async function standInDoors(answer) {
  const server = http.createServer((req, res) => {
    const a = answer(req.url);
    if (!a) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(a));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

function writeSwitches(config, text, mode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.doorsState, { force: true });
  writeFileSync(config.paths.doorsState, text);
  chmodSync(config.paths.doorsState, mode);
}

test("the three doors: idle while their switch is off, who may reach them when on, and plain words when something is wrong", async () => {
  const inet = await startInternet({ sites: {} });
  let chrome = true;
  let genPart = "generate";
  const others = await standInDoors((path) => {
    if (path === "/gen/health") return { status: "ok", part: genPart, on: false, key: true };
    if (path === "/view/health") return { status: "ok", part: "viewer", on: false, chrome, version: "Google Chrome 142.0.7444.60" };
    return null;
  });
  await withHome(async (h) => {
    ensureSecret(h.config.paths.webSecret);
    const door = createWebDoor({ listenPort: 0, paths: h.config.paths, config: h.config, log: () => {}, net: inet.net });
    await door.listen();
    try {
      h.app.home.urls.web = `http://127.0.0.1:${door.port}`;
      h.app.home.urls.generate = others.url;
      h.app.home.urls.viewer = others.url;
      const parts = async () => Object.fromEntries((await call(h.url, "GET", "/api/health")).json.parts.map((p) => [p.id, p]));
      let by = await parts();
      assert.deepEqual([by.web.state, by.generate.state, by.viewer.state], ["on", "on", "on"]);
      assert.equal(by.web.sentence, "The web door is on. It is idle: the switch in Settings is off.");
      assert.equal(by.generate.sentence, "The generation door is on. It is idle: the switch in Settings is off.");
      assert.equal(by.viewer.sentence, "The page viewer is on. It is idle: the switch in Settings is off.");
      assert.match(by.web.technical, /web door on http:\/\/127\.0\.0\.1:/);
      assert.match(by.generate.technical, /a Runway key is saved/);
      assert.match(by.viewer.technical, /Chrome Google Chrome 142\.0\.7444\.60/);
      for (const id of ["web", "generate", "viewer"]) assert.doesNotMatch(by[id].sentence, TECH, id);

      writeSwitches(h.config, JSON.stringify({ version: 1, web: { on: true }, generate: { on: true }, viewer: { on: true } }));
      by = await parts();
      assert.equal(by.web.sentence, "The web door is on. Only the Researcher can reach it.");
      assert.equal(by.generate.sentence, "The generation door is on. Only the Artist can reach it.");
      assert.equal(by.viewer.sentence, "The page viewer is on. Only the Builder and the Art director can reach it.");

      writeSwitches(h.config, JSON.stringify({ version: 1, web: { on: true } }), 0o666);
      by = await parts();
      assert.equal(by.web.state, "on");
      assert.equal(by.web.sentence, "The web door is on. It lets no agent in: its switches could not be read. Open Settings.");

      chrome = false;
      genPart = "web";
      by = await parts();
      assert.equal(by.viewer.state, "unhealthy");
      assert.equal(by.viewer.sentence, "The page viewer is on, but no Chrome was found on this Mac.");
      assert.equal(by.generate.state, "unhealthy", "a door answering as another part");
      assert.equal(by.generate.sentence, "The generation door answers but its check fails. Restart the engine: engine stop, then engine start.");

      await door.close();
      by = await parts();
      assert.ok(["not_installed", "off"].includes(by.web.state));
      for (const id of ["web", "generate", "viewer"]) assert.doesNotMatch(by[id].sentence, TECH, id);
    } finally {
      await door.close();
    }
  });
  await others.close();
  await inet.close();
});

test("a door that does not answer: not installed until its READY marker exists, then off", async () => {
  const root = mkdtempSync(join(tmpdir(), "uuu-health-doors-"));
  try {
    const free = http.createServer();
    await new Promise((r) => free.listen(0, "127.0.0.1", r));
    const closed = `http://127.0.0.1:${free.address().port}`;
    await new Promise((r) => free.close(r));
    const env = { config: { engineDir: root, paths: { doorsState: join(root, "none.json") } }, urls: { web: closed, generate: closed, viewer: null } };
    let [web, gen, viewer] = await doorStates(env);
    assert.deepEqual([web.state, web.sentence], ["not_installed", "The web door is not installed yet."]);
    assert.deepEqual([gen.state, gen.sentence], ["not_installed", "The generation door is not installed yet."]);
    assert.deepEqual([viewer.state, viewer.technical], ["off", "page viewer on (none in stubs mode)"]);
    mkdirSync(join(root, "web"));
    writeFileSync(join(root, "web", "READY"), "2026-11-12\n");
    [web] = await doorStates(env);
    assert.deepEqual([web.state, web.sentence], ["off", "The web door is off. Run: engine start"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the playbooks' line comes from their index, read without following a link", () => {
  const root = mkdtempSync(join(tmpdir(), "uuu-health-playbooks-"));
  try {
    const dir = join(root, "playbooks");
    const env = { config: { paths: { playbooks: dir } } };
    assert.equal(playbooksState(env).sentence, "Playbooks are not in place. Run: engine/playbooks/install.sh");
    mkdirSync(dir);
    const rows = [{ name: "storycraft" }, { name: "hallmark" }, { name: "impeccable" }, { name: "hallmark" }, { name: "Not A Name" }, "x"];
    writeFileSync(join(dir, "index.json"), JSON.stringify({ version: 1, playbooks: rows }));
    const p = playbooksState(env);
    assert.deepEqual([p.id, p.name, p.state, p.sentence], ["playbooks", "Playbooks", "on", "Playbooks: 3 in place."]);
    writeFileSync(join(dir, "index.json"), "not json");
    assert.equal(playbooksState(env).state, "not_installed");
    rmSync(join(dir, "index.json"));
    writeFileSync(join(root, "elsewhere.json"), JSON.stringify({ playbooks: [{ name: "storycraft" }] }));
    symlinkSync(join(root, "elsewhere.json"), join(dir, "index.json"));
    assert.equal(playbooksState(env).state, "not_installed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
