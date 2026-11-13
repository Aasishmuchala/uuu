// The Page viewer routes (PLAN-V5 K15, T52b) on a stub home: the switch and the viewer's state, with a real page
// viewer (createViewer on port 0) whose Chrome is a made-up program in a temp folder (never started: only its file
// and its Info.plist are looked at), and a made-up viewer where its answers must be odd. Every secret and id is made
// up; nothing leaves 127.0.0.1, no Chrome is opened and nothing calls a live door.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSecret, readDoorsState } from "../../../doors/common.mjs";
import { readSecret } from "../../../relay/state.mjs";
import { mintToken } from "../../../relay/token.mjs";
import { createViewer } from "../../../viewer/viewer.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { forgetNeeds, needsState } from "../lib/jobs.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { plainVersion } from "../routes/viewer.mjs";

const BUILDER = "a0000000-0000-4000-8000-000000000002"; // the stub seed's
const ART_DIRECTOR = "a0000000-0000-4000-8000-000000000011";
const VERSION = "142.0.7444.60";
const DOOR_PORTS = [3130, 3140, 3150, 3160];
const ENGINE_DIR = join(SERVER_DIR, "..", "..");
const mode = (p) => statSync(p).mode & 0o777;
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));
const OFF_OR_NOT_INSTALLED = () => (existsSync(join(ENGINE_DIR, "viewer", "READY"))
  ? { state: "off", sentence: "The page viewer is off. Run: engine start" }
  : { state: "not_installed", sentence: "The page viewer is not installed yet." });

function editIds(config, fn) {
  const ids = JSON.parse(readFileSync(config.paths.ids, "utf8"));
  fn(ids.agents);
  rmSync(config.paths.ids);
  writeFileSync(config.paths.ids, JSON.stringify(ids, null, 2), { mode: 0o600 });
}
const addArtDirector = (config) => editIds(config, (a) => { a["art-director"] = ART_DIRECTOR; });

// A made-up Chrome as the viewer looks for it: an executable file in `<app>/Contents/MacOS/` and the app's
// Info.plist beside it. It is never run.
function fakeChrome(root, version = VERSION) {
  const macos = join(root, "Google Chrome.app", "Contents", "MacOS");
  mkdirSync(macos, { recursive: true });
  const program = join(macos, "Google Chrome");
  writeFileSync(program, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  writeFileSync(join(root, "Google Chrome.app", "Contents", "Info.plist"),
    `<?xml version="1.0"?>\n<plist><dict><key>CFBundleShortVersionString</key>\n<string>${version}</string></dict></plist>\n`);
  return program;
}

// A stub home with the Viewer routes and, unless door is false, a real page viewer on port 0 with a made-up Chrome
// (chrome: false gives the viewer no Chrome at all). art: false leaves the Art director out of ids.json.
async function withViewer(fn, { door = true, chrome = true, art = true, routes = ["viewer"] } = {}) {
  const logs = [];
  const doorLogs = [];
  const tmp = mkdtempSync(join(tmpdir(), "uuu-viewer-routes-"));
  const h = await startV2({ routes, inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  let d = null;
  try {
    if (art) addArtDirector(h.config);
    ensureSecret(h.config.paths.viewerSecret);
    if (door) {
      d = createViewer({
        listenPort: 0, paths: h.config.paths, config: h.config, log: (l) => doorLogs.push(l),
        chrome: chrome ? { path: fakeChrome(tmp) } : null,
      });
      await d.listen();
      h.app.home.urls.viewer = `http://127.0.0.1:${d.port}`;
    }
    return await fn({ h, door: d, logs, doorLogs, tmp });
  } finally {
    if (d) await d.close();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/viewer")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const agentToken = (h, id = BUILDER) => mintToken(readSecret(h.config.paths.viewerSecret), "a", id, Math.floor(Date.now() / 1000) + 3600);
// An agent's call to the viewer that stops before any Chrome is started: past the token and the switch, the wrong
// body type is refused as view_bad_site; a switch that is off is refused first as view_off.
function agentShots(door, h, id = BUILDER) {
  return call(`http://127.0.0.1:${door.port}`, "POST", "/view/shots", {
    raw: "not a tar", bare: true, headers: { authorization: `Bearer ${agentToken(h, id)}`, "content-type": "text/plain" },
  });
}

// A made-up viewer on 127.0.0.1 that answers as `answers` says, and keeps what it saw.
async function fakeViewer(answers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
    const a = answers[req.url] || { status: 404, body: "{}" };
    if (a.hang) return;
    res.writeHead(a.status, { "content-type": a.type || "application/json" });
    res.end(typeof a.body === "string" ? a.body : JSON.stringify(a.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, seen,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
const health = (extra) => ({ "/view/health": { status: 200, body: { status: "ok", part: "viewer", on: false, chrome: true, version: VERSION, ...extra } } });

function writeStatus(config, value, fileMode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.viewerStatus, { force: true });
  writeFileSync(config.paths.viewerStatus, typeof value === "string" ? value : JSON.stringify(value));
  chmodSync(config.paths.viewerStatus, fileMode);
}

// ---- the view ----------------------------------------------------------------------------------------------------

test("the view fits shapes/viewer.json with no switches file: off, the viewer running, its Chrome and version", async () => {
  await withViewer(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/viewer");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("viewer"), r.json), []);
    assert.deepEqual(r.json, {
      on: false,
      door: { state: "on", sentence: "The page viewer is running." },
      chrome: { found: true, version: VERSION },
      today: { renders: 0, refused: 0 },
      busy: false,
      canSwitchOn: true,
      blockers: [],
      whyNot: null,
      problem: null,
      problemSentence: null,
    });
    assert.equal(existsSync(h.config.paths.doorsState), false, "reading writes nothing");
  });
});

test("a damaged switches file: every door off, a plain problem, the shape kept; the next save writes a fresh file", async () => {
  await withViewer(async ({ h }) => {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    for (const [text, fileMode] of [
      [JSON.stringify({ version: 1, web: { on: true }, generate: { on: true }, viewer: { on: true } }), 0o666], // others may write it
      [JSON.stringify({ version: 1, viewer: { on: "yes" } }), 0o600],                                        // not what the home writes
      ["{ not json", 0o600],
    ]) {
      rmSync(h.config.paths.doorsState, { force: true });
      writeFileSync(h.config.paths.doorsState, text);
      chmodSync(h.config.paths.doorsState, fileMode);
      const v = await view(h);
      assert.deepEqual(sameShape(readShape("viewer"), v), []);
      assert.equal(v.on, false, text);
      assert.equal(v.problem, "state_unreadable", text);
      assert.match(v.problemSentence, /every door is off/);
      assert.equal(v.door.state, "on");
    }
    const r = await post(h, "/api/viewer/switch", { on: false });
    assert.equal(r.status, 200);
    assert.equal(mode(h.config.paths.doorsState), 0o600);
    const st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.ok, st.web.on, st.generate.on, st.viewer.on], [true, false, false, false]);
    assert.equal((await view(h)).problem, null);
  });
});

// ---- the switch -------------------------------------------------------------------------------------------------

test("switching on and off writes the file with its modes; the viewer and the jobs' needs see it at once", async () => {
  await withViewer(async ({ h, door, logs }) => {
    const needs = () => needsState({ config: h.config, home: h.app.home, bench: null });
    forgetNeeds();
    assert.equal((await needs()).browser, false, "off: no page job may start");
    assert.equal((await agentShots(door, h)).json.code, "view_off");

    let r = await post(h, "/api/viewer/switch", { on: true });
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("viewer"), r.json), []);
    assert.deepEqual([r.json.on, r.json.canSwitchOn, r.json.blockers], [true, true, []]);
    assert.equal(mode(h.config.paths.doors), 0o700);
    assert.equal(mode(h.config.paths.doorsState), 0o600);
    let st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.ok, st.viewer.on, st.web.on, st.generate.on], [true, true, false, false]);
    const hl = await call(`http://127.0.0.1:${door.port}`, "GET", "/view/health");
    assert.equal(hl.json.on, true, "the viewer sees the switch at once");
    assert.equal((await agentShots(door, h)).json.code, "view_bad_site", "the Builder is let past the switch");
    assert.equal((await agentShots(door, h, ART_DIRECTOR)).json.code, "view_bad_site", "and the Art director");
    assert.equal((await needs()).browser, true, "the needs were forgotten, not kept for a minute");
    assert.ok(logs.includes("viewer: switched on"));

    r = await post(h, "/api/viewer/switch", { on: false });
    assert.equal(r.status, 200);
    assert.equal(r.json.on, false);
    st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.ok, st.viewer.on], [true, false]);
    assert.equal(mode(h.config.paths.doorsState), 0o600);
    assert.equal((await agentShots(door, h)).json.code, "view_off");
    assert.equal((await needs()).browser, false);
    assert.ok(logs.includes("viewer: switched off"));

    const saved = readFileSync(h.config.paths.doorsState, "utf8");
    for (const bad of [{ on: "yes" }, {}, { on: 1 }, { on: null }]) {
      const b = await post(h, "/api/viewer/switch", bad);
      assert.equal(b.status, 400, JSON.stringify(bad));
      assert.equal(b.json.error.code, "bad_switch");
    }
    assert.equal(readFileSync(h.config.paths.doorsState, "utf8"), saved, "nothing written");
  });
});

test("the switch keeps the other doors' settings as they are", async () => {
  await withViewer(async ({ h }) => {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    writeFileSync(h.config.paths.doorsState, JSON.stringify({
      version: 1, web: { on: true, allow: ["example.com"], perHour: 7 }, generate: { on: true, dailyCredits: 123 }, viewer: { on: false },
    }), { mode: 0o600 });
    assert.equal((await post(h, "/api/viewer/switch", { on: true })).status, 200);
    const st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.web.on, st.web.allow, st.web.perHour, st.generate.on, st.generate.dailyCredits, st.viewer.on],
      [true, ["example.com"], 7, true, 123, true]);
  });
});

test("on is refused while the viewer does not answer, and nothing is written; off is always taken", async () => {
  await withViewer(async ({ h }) => {
    for (const url of [null, "http://127.0.0.1:1"]) {
      h.app.home.urls.viewer = url;
      const v = await view(h);
      assert.deepEqual(v.door, url === null ? { state: "off", sentence: "The page viewer is off. Run: engine start" } : OFF_OR_NOT_INSTALLED());
      assert.deepEqual(v.chrome, { found: null, version: null }, "Chrome is not known while the viewer is off");
      assert.deepEqual(sameShape(readShape("viewer"), v), []);
      const r = await post(h, "/api/viewer/switch", { on: true });
      assert.equal(r.status, 409);
      assert.equal(r.json.error.code, "cannot_switch_on");
      assert.deepEqual(r.json.error.blockers, ["door_off"]);
      assert.equal(r.json.error.next, "The page viewer is off. Run: engine start");
      assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    }
    const r = await post(h, "/api/viewer/switch", { on: false });
    assert.equal(r.status, 200, "off always works");
    assert.equal(readDoorsState(h.config.paths.doorsState).viewer.on, false);
  }, { door: false });
});

test("on is refused when the viewer found no Chrome", async () => {
  await withViewer(async ({ h }) => {
    const v = await view(h);
    assert.deepEqual(v.door, { state: "on", sentence: "The page viewer is running." });
    assert.deepEqual(v.chrome, { found: false, version: null });
    assert.deepEqual([v.canSwitchOn, v.blockers, v.whyNot], [false, ["no_chrome"], "No Chrome was found on this Mac."]);
    const r = await post(h, "/api/viewer/switch", { on: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "cannot_switch_on");
    assert.deepEqual(r.json.error.blockers, ["no_chrome"]);
    assert.equal(r.json.error.next, "No Chrome was found on this Mac.");
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");
    assert.equal((await post(h, "/api/viewer/switch", { on: false })).status, 200, "off always works");
  }, { chrome: false });
});

test("on is refused while the Builder or the Art director is not set up", async () => {
  await withViewer(async ({ h }) => {
    const refusedWith = async (why) => {
      const r = await post(h, "/api/viewer/switch", { on: true });
      assert.equal(r.status, 409, why);
      assert.equal(r.json.error.code, "cannot_switch_on");
      assert.deepEqual(r.json.error.blockers, ["no_agents"], why);
      assert.equal(r.json.error.next, "Run engine setup first, then try again.");
      assert.equal(existsSync(h.config.paths.doorsState), false, `${why}: nothing written`);
    };
    await refusedWith("no Art director");
    editIds(h.config, (a) => { a["art-director"] = ART_DIRECTOR; delete a.builder; });
    await refusedWith("no Builder");
    editIds(h.config, (a) => { a.builder = "not an id"; });
    await refusedWith("a Builder that is not an id");
    editIds(h.config, (a) => { a.builder = BUILDER; });
    chmodSync(h.config.paths.ids, 0o666);
    await refusedWith("an ids file others can write");
    chmodSync(h.config.paths.ids, 0o600);
    const v = await view(h);
    assert.deepEqual([v.canSwitchOn, v.blockers], [true, []]);
    assert.equal((await post(h, "/api/viewer/switch", { on: true })).status, 200);
  }, { art: false });
  // With no viewer and no Art director, both reasons are listed; the viewer's is said first.
  await withViewer(async ({ h }) => {
    const r = await post(h, "/api/viewer/switch", { on: true });
    assert.deepEqual(r.json.error.blockers, ["door_off", "no_agents"]);
    assert.equal(r.json.error.next, "The page viewer is off. Run: engine start");
  }, { door: false, art: false });
});

// ---- what the viewer said ---------------------------------------------------------------------------------------

test("a health answer with markup in its version comes out plain; odd answers are unhealthy; health has no token", async () => {
  await withViewer(async ({ h }) => {
    const markup = `<img src=x onerror="alert(1)">Chrome\u0007 \u202e${VERSION}<script>x()</script>${"9".repeat(100)}`;
    let fake = await fakeViewer(health({ version: markup }));
    try {
      h.app.home.urls.viewer = fake.url;
      const v = await view(h);
      assert.deepEqual(sameShape(readShape("viewer"), v), []);
      assert.equal(v.chrome.found, true);
      assert.match(v.chrome.version, /^[A-Za-z0-9 ./()-]{1,60}$/);
      assert.equal(v.chrome.version, `img srcx onerroralert(1)Chrome ${VERSION}scriptx()/script999999`.slice(0, 60));
      assert.ok(!/[<>"'=&;\u0000-\u001f\u202e]/.test(v.chrome.version), "no markup or control character survives");
      assert.ok(fake.seen.length >= 1);
      assert.ok(fake.seen.every((s) => s.method === "GET" && s.url === "/view/health" && s.auth === null), "health is asked without a token");
    } finally {
      await fake.close();
    }
    for (const [extra, chrome] of [
      [{ version: "<>\"'&;" }, { found: true, version: null }],
      [{ version: 142 }, { found: true, version: null }],
      [{ version: null }, { found: true, version: null }],
      [{ chrome: "yes" }, { found: false, version: null }],
      [{ chrome: false, version: VERSION }, { found: false, version: null }],
    ]) {
      fake = await fakeViewer(health(extra));
      try {
        h.app.home.urls.viewer = fake.url;
        const v = await view(h);
        assert.deepEqual(v.chrome, chrome, JSON.stringify(extra));
        assert.equal(v.canSwitchOn, chrome.found === true, JSON.stringify(extra));
      } finally {
        await fake.close();
      }
    }
    for (const answers of [
      { "/view/health": { status: 200, body: { status: "ok", part: "web", chrome: true } } },
      { "/view/health": { status: 500, body: { status: "ok", part: "viewer", chrome: true } } },
      { "/view/health": { status: 200, type: "text/html", body: "<h1>viewer</h1>" } },
      { "/view/health": { status: 200, body: "x".repeat(8192) } },
    ]) {
      fake = await fakeViewer(answers);
      try {
        h.app.home.urls.viewer = fake.url;
        const v = await view(h);
        assert.deepEqual(v.door, { state: "unhealthy", sentence: "The page viewer is running but not answering. Run: engine stop, then engine start." });
        assert.deepEqual(v.chrome, { found: null, version: null });
        assert.deepEqual(v.blockers, ["door_off"]);
        assert.equal((await post(h, "/api/viewer/switch", { on: true })).status, 409);
      } finally {
        await fake.close();
      }
    }
    fake = await fakeViewer({ "/view/health": { hang: true } });
    try {
      h.app.home.urls.viewer = fake.url;
      const t0 = Date.now();
      const v = await view(h);
      assert.ok(Date.now() - t0 < 3000, "health is waited for at most a second");
      assert.deepEqual(v.door, OFF_OR_NOT_INSTALLED());
    } finally {
      await fake.close();
    }
    assert.equal(existsSync(h.config.paths.doorsState), false, "no refused switch wrote anything");
  }, { door: false });
});

test("plainVersion keeps only letters, digits and ./()- with spaces, at most 60 characters", () => {
  assert.equal(plainVersion("142.0.7444.60"), "142.0.7444.60");
  assert.equal(plainVersion("Google Chrome 142.0 (Official Build)"), "Google Chrome 142.0 (Official Build)");
  assert.equal(plainVersion("1".repeat(200)).length, 60);
  assert.equal(plainVersion("<b>1</b>"), "b1/b");
  assert.equal(plainVersion("\u202e\u0000"), null);
  for (const v of [undefined, null, 1, {}, ["1"]]) assert.equal(plainVersion(v), null);
});

test("today's counts and busy come from the viewer's status file, read with the trust rule and capped", async () => {
  await withViewer(async ({ h, door }) => {
    // The real viewer counts a refusal in its own file (written a moment later, then at close).
    assert.equal((await agentShots(door, h)).json.code, "view_off");
    const port = door.port;
    await door.close();
    const fake = await fakeViewer(health());
    try {
      h.app.home.urls.viewer = fake.url;
      assert.deepEqual((await view(h)).today, { renders: 0, refused: 1 }, "the viewer's own count");
      const today = dayOf(Date.now());
      writeStatus(h.config, { startedAt: new Date().toISOString(), on: true, busy: true, today: { day: today, renders: 3, refused: 2 } });
      let v = await view(h);
      assert.deepEqual([v.today, v.busy], [{ renders: 3, refused: 2 }, true]);
      assert.deepEqual(sameShape(readShape("viewer"), v), []);
      writeStatus(h.config, { busy: false, today: { day: today, renders: 1e12, refused: -1 } });
      v = await view(h);
      assert.deepEqual([v.today, v.busy], [{ renders: 1e9, refused: 0 }, false]);
      writeStatus(h.config, { busy: "yes", today: { day: today, renders: "9", refused: 1.5 } });
      v = await view(h);
      assert.deepEqual([v.today, v.busy], [{ renders: 0, refused: 0 }, false]);
      writeStatus(h.config, { busy: true, today: { day: "2020-01-01", renders: 3, refused: 2 } });
      v = await view(h);
      assert.deepEqual([v.today, v.busy], [{ renders: 0, refused: 0 }, true], "another day's counts are not today's");
      for (const [value, fileMode, why] of [
        [{ busy: true, today: { day: today, renders: 3, refused: 2 } }, 0o666, "a file others can write"],
        [`{"busy":true,"today":{"day":"${today}","renders":3,"refused":2},"pad":"${"x".repeat(70 * 1024)}"}`, 0o600, "a file over 64 KB"],
        ["not json", 0o600, "not JSON"],
        ["[1,2]", 0o600, "not an object"],
      ]) {
        writeStatus(h.config, value, fileMode);
        v = await view(h);
        assert.deepEqual([v.today, v.busy], [{ renders: 0, refused: 0 }, false], why);
      }
      const elsewhere = join(h.config.paths.doors, "elsewhere.json");
      writeFileSync(elsewhere, JSON.stringify({ busy: true, today: { day: today, renders: 3, refused: 2 } }), { mode: 0o600 });
      rmSync(h.config.paths.viewerStatus, { force: true });
      symlinkSync(elsewhere, h.config.paths.viewerStatus);
      v = await view(h);
      assert.deepEqual([v.today, v.busy], [{ renders: 0, refused: 0 }, false], "never through a link");

      // A viewer that stopped mid-render leaves busy in its file: it is not busy when it does not answer.
      writeStatus(h.config, { busy: true, today: { day: today, renders: 3, refused: 2 } });
      h.app.home.urls.viewer = `http://127.0.0.1:${port}`;
      v = await view(h);
      assert.deepEqual([v.today, v.busy], [{ renders: 3, refused: 2 }, false]);
    } finally {
      await fake.close();
    }
  });
});

// ---- what a stub home and a stranger can do -----------------------------------------------------------------

async function connectionsDuring(fn) {
  const seen = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    seen.push(Number(o && typeof o === "object" ? o.port : o));
    return original.apply(this, args);
  };
  try { await fn(); } finally { net.Socket.prototype.connect = original; }
  return seen;
}

test("a stub home opens no socket to any door", async () => {
  for (const start of [
    () => startV2({ routes: ["viewer", "health"], inbox: [], search: [], port: 0 }),
    () => startStubsHome({ port: 0 }),
  ]) {
    const h = await start();
    try {
      for (const d of ["web", "generate", "viewer", "preview"]) assert.equal(h.app.home.urls[d], null, d);
      addArtDirector(h.config);
      ensureSecret(h.config.paths.viewerSecret);
      const configured = DOOR_PORTS.concat(["web", "generate", "viewer", "preview"].map((d) => h.config.ports[d]));
      const seen = await connectionsDuring(async () => {
        const v = await view(h);
        assert.deepEqual(v.door, { state: "off", sentence: "The page viewer is off. Run: engine start" });
        assert.deepEqual(v.chrome, { found: null, version: null });
        const health = (await call(h.url, "GET", "/api/health")).json;
        const p = health.parts.find((x) => x.id === "viewer");
        assert.equal(p.state, "off");
        assert.match(p.technical, /none in stubs mode/);
        assert.deepEqual((await post(h, "/api/viewer/switch", { on: true })).json.error.blockers, ["door_off"]);
        assert.equal((await post(h, "/api/viewer/switch", { on: false })).status, 200);
      });
      assert.ok(seen.length > 0);
      const allowed = new Set([h.port, h.board.port, h.bench.port]);
      for (const port of seen) {
        assert.ok(!configured.includes(port), `a socket to door port ${port}`);
        assert.ok(allowed.has(port), `a socket to ${port}`);
      }
    } finally {
      await h.close();
    }
  }
});

test("every POST without the same-origin headers is refused by the core, and changes nothing", async () => {
  await withViewer(async ({ h }) => {
    for (const on of [true, false]) {
      for (const headers of [
        { bare: true, headers: { "content-type": "application/json" } },
        { headers: { origin: "http://evil.example" } },
        { headers: { "sec-fetch-site": "cross-site" } },
        { headers: { "content-type": "text/plain" } },
        { headers: { "x-engine": "0" } },
      ]) {
        const r = await call(h.url, "POST", "/api/viewer/switch", { body: { on }, ...headers });
        assert.equal(r.status, 403, `${on} ${JSON.stringify(headers)}`);
        assert.equal(r.json.error.code, "not_same_origin");
      }
    }
    assert.equal(existsSync(h.config.paths.doorsState), false);
  });
});
