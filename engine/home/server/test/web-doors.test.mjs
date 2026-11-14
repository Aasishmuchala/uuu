// lib/doors.mjs (PLAN-V5 K1, K3, T32): the switches file, the two keys, owner tokens and callDoor. A temp state
// folder with a made-up config; every secret and key is made up; nothing calls a live door or the internet.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkCaller, DOORS_DEFAULTS, readDoorsState } from "../../../doors/common.mjs";
import { loadConfig } from "../../../lib/config.mjs";
import { checkToken } from "../../../relay/token.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import {
  callDoor, checkDoors, doorKeySaved, freshDoors, ownerToken, readDoors, removeDoorKey, saveDoorKey, updateDoors, validDoorKey,
} from "../lib/doors.mjs";
import { forgetNeeds, needsState } from "../lib/jobs.mjs";

const ENGINE_DIR = join(SERVER_DIR, "..", "..");
const mode = (p) => statSync(p).mode & 0o777;
const madeUpSearchKey = () => `test${randomBytes(12).toString("hex")}`;
const madeUpRunwayKey = () => `key_${randomBytes(64).toString("hex")}`;

// A config whose state folder is a new temp folder.
function tempConfig() {
  const root = mkdtempSync(join(tmpdir(), "uuu-doors-lib-"));
  const state = join(root, "state");
  mkdirSync(state, { mode: 0o700 });
  const raw = JSON.parse(readFileSync(join(ENGINE_DIR, "config.json"), "utf8"));
  raw.stateRoot = state;
  writeFileSync(join(root, "config.json"), JSON.stringify(raw));
  const config = loadConfig({ path: join(root, "config.json") });
  return { config, root, done: () => rmSync(root, { recursive: true, force: true }) };
}

function writeState(config, text, fileMode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.doorsState, { force: true });
  writeFileSync(config.paths.doorsState, text);
  chmodSync(config.paths.doorsState, fileMode);
}

function writeSecret(config, name) {
  mkdirSync(config.paths.doorSecrets, { recursive: true, mode: 0o700 });
  const secret = randomBytes(32).toString("hex");
  writeFileSync(config.paths[`${name}Secret`], `${secret}\n`, { mode: 0o600 });
  return secret;
}

test("no switches file: every door off, no problem, and nothing is written by reading", () => {
  const t = tempConfig();
  try {
    const r = readDoors(t.config);
    assert.equal(r.problem, null);
    assert.equal(r.missing, true);
    assert.deepEqual(r.state, freshDoors());
    assert.equal(r.state.web.on, false);
    assert.equal(r.state.generate.on, false);
    assert.equal(r.state.viewer.on, false);
    assert.deepEqual(r.state.web.watchHosts, DOORS_DEFAULTS.web.watchHosts);
    assert.equal(existsSync(t.config.paths.doors), false);
  } finally { t.done(); }
});

test("updateDoors writes the file 0600 in a 0700 folder, by temp file and rename, in the shape the doors read", () => {
  const t = tempConfig();
  try {
    const written = updateDoors(t.config, (s) => { s.web.on = true; s.web.allow = ["example.com"]; });
    assert.equal(mode(t.config.paths.doors), 0o700);
    assert.equal(mode(t.config.paths.doorsState), 0o600);
    assert.deepEqual(readdirSync(t.config.paths.doors), ["state.json"], "no temp file is left");
    const file = JSON.parse(readFileSync(t.config.paths.doorsState, "utf8"));
    assert.equal(file.version, 1);
    assert.ok(Date.parse(file.changedAt));
    assert.deepEqual(Object.keys(file).sort(), ["changedAt", "generate", "version", "viewer", "web"]);
    assert.deepEqual(file.web, { ...DOORS_DEFAULTS.web, on: true, allow: ["example.com"] });
    // T79: the owner's Higgsfield block is always written (off, 5 cents a credit, until the owner changes it).
    assert.deepEqual(file.generate, { ...DOORS_DEFAULTS.generate, higgsfield: { on: false, centsPerCredit: 5 } });
    assert.deepEqual(file.viewer, { on: false });
    assert.deepEqual(written, file);
    // The doors' own reader takes it.
    const d = readDoorsState(t.config.paths.doorsState);
    assert.equal(d.ok, true);
    assert.equal(d.web.on, true);
    assert.deepEqual(d.web.allow, ["example.com"]);
    assert.equal(readDoors(t.config).problem, null);
  } finally { t.done(); }
});

test("the owner's Start again (generate.resumedAt) is kept by every later save; nothing else unknown is", () => {
  const t = tempConfig();
  try {
    const at = "2026-11-12T09:00:00.000Z";
    updateDoors(t.config, (s) => { s.generate.resumedAt = at; });
    updateDoors(t.config, (s) => { s.web.on = true; });
    const file = JSON.parse(readFileSync(t.config.paths.doorsState, "utf8"));
    assert.equal(file.generate.resumedAt, at);
    writeState(t.config, JSON.stringify({ ...file, extra: 1, web: { ...file.web, sneaky: true } }));
    updateDoors(t.config, (s) => { s.viewer.on = false; });
    const again = JSON.parse(readFileSync(t.config.paths.doorsState, "utf8"));
    assert.equal(again.extra, undefined);
    assert.equal(again.web.sneaky, undefined);
    assert.equal(again.generate.resumedAt, at);
  } finally { t.done(); }
});

test("a damaged or planted switches file is every door off and a problem; the next save writes a fresh all-off file", () => {
  const t = tempConfig();
  try {
    const on = JSON.stringify({ version: 1, web: { on: true }, generate: { on: true }, viewer: { on: true } });
    const cases = [
      ["not JSON", "{ not json", 0o600],
      ["others may write it", on, 0o666],
      ["a field of the wrong kind", JSON.stringify({ web: { on: "yes" } }), 0o600],
      ["a list entry that is not a site", JSON.stringify({ web: { on: true, allow: ["not a host"] } }), 0o600],
      ["a search the door does not know", JSON.stringify({ web: { on: true, search: "other" } }), 0o600],
      ["a cap that is not whole", JSON.stringify({ web: { on: true, perHour: 1.5 } }), 0o600],
      ["an array", "[]", 0o600],
    ];
    for (const [why, text, m] of cases) {
      writeState(t.config, text, m);
      const r = readDoors(t.config);
      assert.equal(r.problem, "state_unreadable", why);
      assert.deepEqual(r.state, freshDoors(), why);
      updateDoors(t.config, (s) => { s.viewer.on = false; });
      const fresh = JSON.parse(readFileSync(t.config.paths.doorsState, "utf8"));
      assert.equal(fresh.web.on, false, why);
      assert.equal(fresh.generate.on, false, why);
      assert.equal(fresh.viewer.on, false, why);
      assert.equal(mode(t.config.paths.doorsState), 0o600, why);
      assert.equal(readDoors(t.config).problem, null, why);
    }
    // A link in the file's place: a problem; the save replaces the link itself, never its target.
    const target = join(t.root, "elsewhere.json");
    writeFileSync(target, on, { mode: 0o600 });
    rmSync(t.config.paths.doorsState);
    symlinkSync(target, t.config.paths.doorsState);
    assert.equal(readDoors(t.config).problem, "state_unreadable");
    assert.equal(readDoorsState(t.config.paths.doorsState).ok, false, "the doors refuse it too");
    updateDoors(t.config, (s) => { s.viewer.on = false; });
    assert.equal(lstatSync(t.config.paths.doorsState).isFile(), true, "the link itself was replaced");
    assert.equal(JSON.parse(readFileSync(t.config.paths.doorsState, "utf8")).web.on, false);
    assert.equal(readFileSync(target, "utf8"), on, "the link's target is untouched");
    // A folder in the file's place is refused.
    rmSync(t.config.paths.doorsState);
    mkdirSync(t.config.paths.doorsState);
    assert.throws(() => updateDoors(t.config, (s) => { s.web.on = false; }), (e) => e.code === "folder_unsafe");
  } finally { t.done(); }
});

test("a doors folder that is a link is refused and nothing is written through it", () => {
  const t = tempConfig();
  try {
    const elsewhere = join(t.root, "elsewhere");
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, t.config.paths.doors);
    assert.throws(() => updateDoors(t.config, (s) => { s.web.on = true; }), (e) => e.code === "folder_unsafe" && e.status === 409);
    assert.deepEqual(readdirSync(elsewhere), []);
  } finally { t.done(); }
});

test("a change the home server would never write is refused before anything is written", () => {
  const t = tempConfig();
  try {
    updateDoors(t.config, (s) => { s.web.block = ["example.org"]; });
    const before = readFileSync(t.config.paths.doorsState, "utf8");
    for (const bad of [
      (s) => { s.web.on = "yes"; },
      (s) => { s.web.allow = ["127.0.0.1"]; },
      (s) => { s.web.allow = Array.from({ length: 201 }, (_, i) => `site${i}.com`); },
      (s) => { s.generate.dailyCredits = -1; },
      (s) => { s.generate.models.video = "../x"; },
      (s) => { s.viewer = null; },
    ]) {
      assert.throws(() => updateDoors(t.config, bad));
      assert.equal(readFileSync(t.config.paths.doorsState, "utf8"), before);
    }
    assert.equal(checkDoors(null), null);
    // A pause that cannot be kept as it is stays a pause, never lifted.
    assert.equal(checkDoors({ ...freshDoors(), generate: { ...freshDoors().generate, paused: { big: "x".repeat(5000) } } }).generate.paused, "paused");
  } finally { t.done(); }
});

test("a switch change is seen by a job's readiness at once (forgetNeeds)", async () => {
  const t = tempConfig();
  const door = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", part: "web", on: true }));
  });
  await new Promise((r) => door.listen(0, "127.0.0.1", r));
  try {
    const ctx = { config: t.config, home: { urls: { ...t.config.urls, web: `http://127.0.0.1:${door.address().port}`, generate: null, viewer: null } } };
    forgetNeeds();
    assert.equal((await needsState(ctx)).internet, false);
    updateDoors(t.config, (s) => { s.web.on = true; });
    assert.equal((await needsState(ctx)).internet, true, "not the cached answer of a minute");
    updateDoors(t.config, (s) => { s.web.on = false; });
    assert.equal((await needsState(ctx)).internet, false);
  } finally {
    forgetNeeds();
    door.closeAllConnections();
    await new Promise((r) => door.close(r));
    t.done();
  }
});

test("keys: saved 0600 in 0700 folders by their fixed names, never in an error, and removed", () => {
  const t = tempConfig();
  try {
    const key = madeUpSearchKey();
    assert.equal(doorKeySaved(t.config, "search"), false);
    saveDoorKey(t.config, "search", `  ${key}\n`);
    assert.equal(readFileSync(t.config.paths.searchKey, "utf8"), `${key}\n`);
    assert.equal(mode(t.config.paths.searchKey), 0o600);
    assert.equal(mode(t.config.paths.doorSecrets), 0o700);
    assert.equal(mode(t.config.paths.secrets), 0o700);
    assert.equal(doorKeySaved(t.config, "search"), true);
    assert.deepEqual(readdirSync(t.config.paths.doorSecrets), ["search-key"]);

    const runway = madeUpRunwayKey();
    assert.equal(validDoorKey("runway", key), null, "a search key is not a Runway key");
    saveDoorKey(t.config, "runway", runway);
    assert.equal(doorKeySaved(t.config, "runway"), true);
    assert.equal(readFileSync(t.config.paths.runwayKey, "utf8"), `${runway}\n`);

    const bad = `bad key ${randomBytes(6).toString("hex")}`;
    let caught = null;
    try { saveDoorKey(t.config, "search", bad); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.ok(!String(caught.message).includes(bad) && !String(caught.stack).includes(bad));
    assert.throws(() => saveDoorKey(t.config, "../provider/omega", key), /unknown name/);
    assert.throws(() => doorKeySaved(t.config, "relay"), /unknown name/);

    removeDoorKey(t.config, "search");
    removeDoorKey(t.config, "search");
    assert.equal(existsSync(t.config.paths.searchKey), false);
    assert.equal(doorKeySaved(t.config, "search"), false);
    assert.equal(doorKeySaved(t.config, "runway"), true);
  } finally { t.done(); }
});

test("a secrets folder that is a link is refused for a key", () => {
  const t = tempConfig();
  try {
    const elsewhere = join(t.root, "elsewhere");
    mkdirSync(join(t.config.paths.state, "secrets"), { mode: 0o700 });
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, t.config.paths.doorSecrets);
    assert.throws(() => saveDoorKey(t.config, "search", madeUpSearchKey()), (e) => e.code === "folder_unsafe");
    assert.deepEqual(readdirSync(elsewhere), []);
  } finally { t.done(); }
});

test("owner tokens: kind t, subject owner, two minutes, made with that door's own secret only", () => {
  const t = tempConfig();
  try {
    assert.equal(ownerToken(t.config, "web"), null, "no secret yet");
    const web = writeSecret(t.config, "web");
    const gen = writeSecret(t.config, "generate");
    const viewer = writeSecret(t.config, "viewer");
    const token = ownerToken(t.config, "web");
    const who = checkToken(web, token);
    assert.equal(who.kind, "t");
    assert.equal(who.subject, "owner");
    assert.ok(who.exp <= Math.floor(Date.now() / 1000) + 120 && who.exp > Math.floor(Date.now() / 1000) + 100);
    assert.equal(checkToken(gen, token), null, "a web token is nothing at the generation door");
    const rawHeaders = (tk) => ["Authorization", `Bearer ${tk}`];
    assert.deepEqual(checkCaller({ rawHeaders: rawHeaders(token), secretPath: t.config.paths.webSecret, idsPath: t.config.paths.ids, agents: [] }), { kind: "t", slug: null, subject: "owner" });
    assert.equal(checkCaller({ rawHeaders: rawHeaders(token), secretPath: t.config.paths.generateSecret, idsPath: t.config.paths.ids, agents: [] }), "bad_token");
    assert.ok(checkToken(viewer, ownerToken(t.config, "preview")), "the preview takes the viewer's owner token");
    assert.equal(ownerToken(t.config, "relay"), null);
  } finally { t.done(); }
});

// ---- callDoor ------------------------------------------------------------------------------------------------

// Records every outgoing connection made in this process while `fn` runs.
async function connectionsDuring(fn) {
  const seen = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    seen.push(o && typeof o === "object" ? { host: o.host, port: Number(o.port), path: o.path } : { port: Number(o) });
    return original.apply(this, args);
  };
  try { await fn(); } finally { net.Socket.prototype.connect = original; }
  return seen;
}

test("callDoor never calls a null or non-local address, nor a path outside the door's own", async () => {
  const t = tempConfig();
  try {
    writeSecret(t.config, "web");
    const seen = await connectionsDuring(async () => {
      for (const web of [null, undefined, "", "http://example.com", "http://localhost:3130", "https://127.0.0.1:3130", "http://127.0.0.1:3130/x", "http://127.0.0.2:3130", "http://127.0.0.1:99999"]) {
        const ctx = { config: t.config, home: { urls: { web } } };
        assert.deepEqual(await callDoor(ctx, "web", "/web/health", null), { ok: false, reason: "no_address" }, String(web));
      }
      const ctx = { config: t.config, home: { urls: { web: "http://127.0.0.1:9" } } };
      for (const path of ["/gen/health", "/web/../relay", "web/health", "/web/x?y=1", "/web/ x", `/web/${"a".repeat(300)}`]) {
        assert.deepEqual(await callDoor(ctx, "web", path, null), { ok: false, reason: "bad_path" }, path);
      }
      assert.deepEqual(await callDoor(ctx, "relay", "/relay/health", null), { ok: false, reason: "no_address" });
    });
    assert.deepEqual(seen, []);
  } finally { t.done(); }
});

test("callDoor sends the owner token of that door, a JSON body, and stops at its time and size caps", async () => {
  const t = tempConfig();
  const web = writeSecret(t.config, "web");
  let mode = "echo";
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (mode === "stall") return;
      if (mode === "big") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(Buffer.alloc(4096, 0x61));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ method: req.method, path: req.url, auth: req.headers.authorization || null, type: req.headers["content-type"] || null, body: Buffer.concat(chunks).toString("utf8") }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const ctx = { config: t.config, home: { urls: { web: `http://127.0.0.1:${server.address().port}`, generate: `http://127.0.0.1:${server.address().port}` } } };
    const r = await callDoor(ctx, "web", "/web/owner/test", {});
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.json.method, "POST");
    assert.equal(r.json.path, "/web/owner/test");
    assert.equal(r.json.type, "application/json");
    assert.equal(r.json.body, "{}");
    const who = checkToken(web, r.json.auth.replace(/^Bearer /, ""));
    assert.deepEqual([who.kind, who.subject], ["t", "owner"]);
    const g = await callDoor(ctx, "web", "/web/health", null, { auth: false });
    assert.equal(g.json.method, "GET");
    assert.equal(g.json.auth, null);
    assert.deepEqual(await callDoor(ctx, "generate", "/gen/owner/balance", {}), { ok: false, reason: "no_secret" }, "no generation secret: nothing is sent");
    mode = "big";
    assert.deepEqual(await callDoor(ctx, "web", "/web/health", null, { maxBytes: 1024 }), { ok: false, reason: "cut" });
    mode = "stall";
    const started = Date.now();
    assert.deepEqual(await callDoor(ctx, "web", "/web/health", null, { timeoutMs: 300 }), { ok: false, reason: "nothing" });
    assert.ok(Date.now() - started < 3000);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    t.done();
  }
});

test("callDoor to a closed port is no_connection", async () => {
  const t = tempConfig();
  try {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const port = s.address().port;
    await new Promise((r) => s.close(r));
    const ctx = { config: t.config, home: { urls: { viewer: `http://127.0.0.1:${port}` } } };
    assert.deepEqual(await callDoor(ctx, "viewer", "/view/health", null, { auth: false }), { ok: false, reason: "no_connection" });
    assert.ok(existsSync(dirname(t.config.paths.doors)));
    assert.equal(lstatSync(t.config.paths.state).isDirectory(), true);
  } finally { t.done(); }
});

test("callDoor's query (C23): only for the viewer, only pages= with one to three plain page names; anything else is bad_path", async () => {
  const t = tempConfig();
  writeSecret(t.config, "web");
  writeSecret(t.config, "viewer");
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const at = `http://127.0.0.1:${server.address().port}`;
    const ctx = { config: t.config, home: { urls: { web: at, generate: at, viewer: at, preview: at } } };
    const tar = Buffer.from("x");
    const seen = await connectionsDuring(async () => {
      for (const door of ["web", "generate", "preview"]) {
        const path = { web: "/web/fetch", generate: "/gen/jobs", preview: "/preview/load" }[door];
        assert.deepEqual(await callDoor(ctx, door, path, tar, { query: "pages=index.html" }), { ok: false, reason: "bad_path" }, door);
      }
      for (const query of [
        "pages=../x.html", "pages=a/../x.html", "pages=./x.html", "pages=/x.html", "pages=a//x.html",
        "pages=a.html,b.html,c.html,d.html", "pages=a.html,a.html", "pages=a.html,", "pages=", "pages=a.htm", "pages=A.HTML",
        "pages=a.html&x=1", "pages=a%2E.html", "x=1", "pages=a.html#x", `pages=${"a".repeat(201)}.html`, "", " pages=a.html", 7, {}, ["pages=a.html"],
      ]) {
        assert.deepEqual(await callDoor(ctx, "viewer", "/view/shots", tar, { type: "application/x-tar", query }), { ok: false, reason: "bad_path" }, JSON.stringify(query));
      }
    });
    assert.deepEqual(seen, [], "nothing was sent");
    const one = await callDoor(ctx, "viewer", "/view/shots", tar, { type: "application/x-tar", query: "pages=index.html" });
    assert.equal(one.json.path, "/view/shots?pages=index.html");
    const three = await callDoor(ctx, "viewer", "/view/shots", tar, { type: "application/x-tar", query: "pages=index.html,about-us.html,work/one_2.html" });
    assert.equal(three.json.path, "/view/shots?pages=index.html,about-us.html,work/one_2.html");
    for (const query of [undefined, null]) {
      assert.equal((await callDoor(ctx, "viewer", "/view/health", null, { auth: false, query })).json.path, "/view/health", String(query));
    }
    assert.equal((await callDoor(ctx, "web", "/web/health", null, { query: undefined })).json.path, "/web/health");
    assert.deepEqual(paths, ["/view/shots?pages=index.html", "/view/shots?pages=index.html,about-us.html,work/one_2.html", "/view/health", "/view/health", "/web/health"]);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    t.done();
  }
});
