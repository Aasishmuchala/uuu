// lib/doors.mjs and the brain door's switch (PLAN-BRAIN B1, T7): a `brain` block in the switches file, off by
// default; a file with no `brain` block is valid and means off; a block that is not exactly { on: <boolean> } is not
// one the home server writes. A temp state folder with a made-up config and made-up secrets; the one call made goes to
// a server of this test on an ephemeral port.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCaller, DOORS_DEFAULTS, readDoorsState } from "../../../doors/common.mjs";
import { loadConfig } from "../../../lib/config.mjs";
import { checkToken } from "../../../relay/token.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { DOOR_NAMES, callDoor, checkDoors, freshDoors, ownerToken, readDoors, updateDoors } from "../lib/doors.mjs";

const ENGINE_DIR = join(SERVER_DIR, "..", "..");

function tempConfig() {
  const root = mkdtempSync(join(tmpdir(), "uuu-doors-brain-"));
  const state = join(root, "state");
  mkdirSync(state, { mode: 0o700 });
  const raw = JSON.parse(readFileSync(join(ENGINE_DIR, "config.json"), "utf8"));
  raw.stateRoot = state;
  writeFileSync(join(root, "config.json"), JSON.stringify(raw));
  const config = loadConfig({ path: join(root, "config.json") });
  return { config, root, done: () => rmSync(root, { recursive: true, force: true }) };
}

function writeState(config, body, fileMode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.doorsState, { force: true });
  writeFileSync(config.paths.doorsState, typeof body === "string" ? body : JSON.stringify(body));
  chmodSync(config.paths.doorsState, fileMode);
}

function writeSecret(config, name) {
  mkdirSync(config.paths.doorSecrets, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(config.paths[`${name}Secret`], `${secret}\n`, { mode: 0o600 });
  return secret;
}

const fileOf = (config) => JSON.parse(readFileSync(config.paths.doorsState, "utf8"));

// What freshDoors() wrote before the brain door, written out by hand: no `brain` block.
const BEFORE_BRAIN = {
  version: 1,
  web: {
    on: false, allow: [], block: [],
    watchHosts: ["youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "vimeo.com", "vimeocdn.com"],
    search: "keyless", perHour: 60, perDay: 300,
  },
  generate: {
    on: false, dailyCredits: 300, monthlyCredits: 1000, autoUnderCredits: 0, paused: null,
    models: { video: "gen4_turbo", videoBest: "gen4.5", still: "gen4_image", upscale: "magnific_precision_upscaler_v2" },
    higgsfield: { on: false, centsPerCredit: 5 },
  },
  viewer: { on: false },
  changedAt: null,
};

test("freshDoors writes brain { on: false }, and brain is one of the door names", () => {
  assert.deepEqual(freshDoors().brain, { on: false });
  assert.deepEqual(DOORS_DEFAULTS.brain, { on: false });
  assert.ok(DOOR_NAMES.includes("brain"));
  const { brain, ...rest } = freshDoors();
  assert.deepEqual(rest, BEFORE_BRAIN, "every other field is what it was before the brain door");
});

test("a file written before the brain door reads exactly as before: trusted, no problem, the brain door off", () => {
  const t = tempConfig();
  try {
    writeState(t.config, BEFORE_BRAIN);
    const r = readDoors(t.config);
    assert.equal(r.problem, null);
    assert.equal(r.missing, false);
    assert.deepEqual(r.state, freshDoors());
    assert.deepEqual(r.state.brain, { on: false });
    // the same with the other doors on and a time: each kept as it was
    const at = "2026-11-12T10:00:00.000Z";
    writeState(t.config, { ...BEFORE_BRAIN, web: { ...BEFORE_BRAIN.web, on: true }, viewer: { on: true }, changedAt: at });
    const r2 = readDoors(t.config);
    assert.equal(r2.problem, null);
    assert.deepEqual([r2.state.web.on, r2.state.generate.on, r2.state.viewer.on, r2.state.brain.on], [true, false, true, false]);
    assert.equal(r2.state.changedAt, at);
  } finally { t.done(); }
});

test("updateDoors keeps the brain block on every save, and the doors' reader sees what was saved", () => {
  const t = tempConfig();
  try {
    writeState(t.config, BEFORE_BRAIN);
    updateDoors(t.config, (s) => { s.web.on = true; });
    assert.deepEqual(fileOf(t.config).brain, { on: false }, "an old file gains the block on its next save");
    updateDoors(t.config, (s) => { s.brain.on = true; });
    assert.deepEqual(fileOf(t.config).brain, { on: true });
    assert.deepEqual(readDoorsState(t.config.paths.doorsState).brain, { on: true });
    updateDoors(t.config, (s) => { s.viewer.on = true; });
    assert.deepEqual(fileOf(t.config).brain, { on: true }, "a save of another door keeps the brain switch");
    assert.equal(fileOf(t.config).web.on, true);
    updateDoors(t.config, (s) => { s.brain.on = false; });
    assert.equal(readDoorsState(t.config.paths.doorsState).brain.on, false);
    assert.equal(readDoors(t.config).problem, null);
  } finally { t.done(); }
});

test("a brain block that is not exactly { on: <boolean> } is every door off and a problem; the next save is all off", () => {
  const t = tempConfig();
  try {
    for (const brain of [null, {}, { on: "yes" }, { on: 1 }, { on: true, extra: 1 }, [], true]) {
      writeState(t.config, { ...BEFORE_BRAIN, web: { ...BEFORE_BRAIN.web, on: true }, brain });
      assert.equal(readDoorsState(t.config.paths.doorsState).ok, false, JSON.stringify(brain));
      const r = readDoors(t.config);
      assert.equal(r.problem, "state_unreadable", JSON.stringify(brain));
      assert.deepEqual(r.state, freshDoors());
      updateDoors(t.config, (s) => { s.viewer.on = false; });
      const f = fileOf(t.config);
      assert.deepEqual([f.web.on, f.brain.on], [false, false]);
    }
  } finally { t.done(); }
});

test("checkDoors: brain missing is off; any other shape is refused; a change to a bad shape writes nothing", () => {
  const { brain, ...without } = freshDoors();
  assert.deepEqual(checkDoors(without).brain, { on: false });
  assert.deepEqual(checkDoors({ ...freshDoors(), brain: { on: true } }).brain, { on: true });
  for (const bad of [null, {}, { on: "yes" }, { on: true, x: 1 }, [], "on"]) {
    assert.equal(checkDoors({ ...freshDoors(), brain: bad }), null, JSON.stringify(bad));
  }
  const t = tempConfig();
  try {
    updateDoors(t.config, (s) => { s.brain.on = true; });
    const before = readFileSync(t.config.paths.doorsState, "utf8");
    assert.throws(() => updateDoors(t.config, (s) => { s.brain = { on: true, agents: ["researcher"] }; }));
    assert.throws(() => updateDoors(t.config, (s) => { s.brain.on = "yes"; }));
    assert.equal(readFileSync(t.config.paths.doorsState, "utf8"), before, "nothing was written");
  } finally { t.done(); }
});

test("the brain door's owner token is kind t, subject owner, made with the brain secret only", () => {
  const t = tempConfig();
  try {
    assert.equal(ownerToken(t.config, "brain"), null, "no secret yet");
    const brain = writeSecret(t.config, "brain");
    const web = writeSecret(t.config, "web");
    const token = ownerToken(t.config, "brain");
    const who = checkToken(brain, token);
    assert.deepEqual([who.kind, who.subject], ["t", "owner"]);
    assert.equal(checkToken(web, token), null, "a brain token is nothing at the web door");
    assert.deepEqual(checkCaller({ rawHeaders: ["Authorization", `Bearer ${token}`], secretPath: t.config.paths.brainSecret, idsPath: t.config.paths.ids, agents: [] }),
      { kind: "t", slug: null, subject: "owner" });
  } finally { t.done(); }
});

test("callDoor to the brain door: only paths under /brain/, no query, the brain owner token", async () => {
  const t = tempConfig();
  const secret = writeSecret(t.config, "brain");
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization || null, body: Buffer.concat(chunks).toString("utf8") }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const ctx = { config: t.config, home: { urls: { brain: `http://127.0.0.1:${server.address().port}` } } };
    for (const path of ["/web/health", "/view/x", "/brain/../web", "brain/ask"]) {
      assert.deepEqual(await callDoor(ctx, "brain", path, null), { ok: false, reason: "bad_path" }, path);
    }
    assert.deepEqual(await callDoor(ctx, "brain", "/brain/ask", { q: "x" }, { query: "pages=a.html" }), { ok: false, reason: "bad_path" });
    assert.deepEqual(await callDoor({ config: t.config, home: { urls: { brain: null } } }, "brain", "/brain/health", null), { ok: false, reason: "no_address" });
    const r = await callDoor(ctx, "brain", "/brain/ask", { q: "refunds" });
    assert.equal(r.ok, true);
    assert.equal(r.json.path, "/brain/ask");
    assert.equal(r.json.body, JSON.stringify({ q: "refunds" }));
    const who = checkToken(secret, r.json.auth.replace(/^Bearer /, ""));
    assert.deepEqual([who.kind, who.subject], ["t", "owner"]);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    t.done();
  }
});
