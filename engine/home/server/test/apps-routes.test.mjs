// App Studio's routes (PLAN-V5 K17, K23, T78) on a stub home: the list, the switch, the app's model and its icon,
// with made-up apps in a temp folder and a made-up host on 127.0.0.1 that answers its health as each test says.
// Nothing calls a live host or door, and no app is ever started.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAppsState } from "../../../apps/host.mjs";
import { SERVER_DIR } from "../lib/app.mjs";
import { APP_SENTENCES, HOST_SENTENCES, PROBLEM_SENTENCES, appPickName } from "../lib/apps.mjs";
import { readAgents, readState, recompute, updateState } from "../lib/models.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const ENGINE_DIR = join(SERVER_DIR, "..", "..");
const HOST_INSTALLED = existsSync(join(ENGINE_DIR, "apps", "READY"));
const mode = (p) => statSync(p).mode & 0o777;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12"/></svg>\n';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 1)]);
const MODELS = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
];

function manifest(slug, extra = {}) {
  return {
    version: 1, slug, name: `App ${slug}`, about: `What ${slug} does.`, port: 3171, entry: ".build/index.mjs", client: "dist",
    engine: ["generate", "relay"], tools: [], icon: "icon.svg", memoryMb: 512, ...extra,
  };
}

// Four apps: film (makes pictures and thinks; installed), still (makes pictures only; installed; a PNG icon), plain
// (neither; not installed) and broken (its description is not JSON).
function makeApps(root) {
  const put = (slug, m, { ready = false, icon = ["icon.svg", SVG] } = {}) => {
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "app.json"), typeof m === "string" ? m : JSON.stringify(m), { mode: 0o644 });
    if (icon) writeFileSync(join(dir, icon[0]), icon[1], { mode: 0o644 });
    if (ready) writeFileSync(join(dir, "READY"), "ready\n");
  };
  put("film", manifest("film", { name: "Film Maker", about: "Turns a render into a film." }), { ready: true });
  put("still", manifest("still", { port: 3172, engine: ["generate"], icon: "icon.png" }), { ready: true, icon: ["icon.png", PNG] });
  put("plain", manifest("plain", { port: 3173, engine: [] }));
  put("broken", "{ not json");
}

// A made-up host: GET /apps/health answers as `answer()` says ({ status, body } or "hang" or "headers-only"); every
// request it saw is kept with its Host and Authorization headers.
async function fakeHost(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, host: req.headers.host, auth: req.headers.authorization || null });
    const a = answer(req);
    if (a === "hang") return;
    if (a === "headers-only") { res.writeHead(200, { "content-type": "application/json" }); res.write("{"); return; }
    res.writeHead(a.status, { "content-type": "application/json" });
    res.end(typeof a.body === "string" ? a.body : JSON.stringify(a.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, seen,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
const healthy = (apps = []) => ({ status: 200, body: { status: "ok", part: "apps", apps } });

// A stub home with App Studio's routes (and `routes`), the made-up apps, and the made-up host unless host is false.
// `apps()` is what the host says of each app (a function, so a test can change it).
async function withApps(fn, { host = true, routes = ["apps"] } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "uuu-apps-routes-"));
  const appsDir = join(tmp, "apps");
  makeApps(appsDir);
  const logs = [];
  const h = await startV2({ routes, inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  const said = { apps: [], answer: null };
  const fake = host ? await fakeHost(() => said.answer || healthy(said.apps)) : null;
  try {
    h.config.paths.appsCode = appsDir;
    if (fake) h.app.home.urls.apps = fake.url;
    return await fn({ h, fake, said, logs, tmp, appsDir });
  } finally {
    if (fake) await fake.close();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/apps")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const appIn = (v, slug) => v.apps.find((a) => a.slug === slug);
function seedModels(config, { art = "claude-opus-5-5" } = {}) {
  updateState(config, (s) => {
    s.catalogue = { readAt: new Date().toISOString(), models: MODELS.map((m) => ({ ...m, owner: null, context: null, maxOutput: null })) };
    if (art) s.picks["art-director"] = { model: art, source: "ranked" };
  });
}
function writeSwitchesFile(config, text, fileMode = 0o600) {
  mkdirSync(config.paths.apps, { recursive: true, mode: 0o700 });
  rmSync(config.paths.appsState, { force: true });
  writeFileSync(config.paths.appsState, text);
  chmodSync(config.paths.appsState, fileMode);
}

// ---- the list ----------------------------------------------------------------------------------------------------

test("the list fits shapes/apps.json: every app in its folder's order, off with no switches file, sites empty", async () => {
  await withApps(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/apps");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("apps"), r.json), []);
    assert.deepEqual(r.json.host, { state: "on", sentence: "App Studio is on." });
    assert.deepEqual(r.json.apps.map((a) => a.slug), ["broken", "film", "plain", "still"]);
    assert.deepEqual(r.json.sites, []);
    assert.equal(r.json.problem, null);
    const film = appIn(r.json, "film");
    assert.deepEqual(
      { name: film.name, about: film.about, icon: film.icon, state: film.state, sentence: film.sentence, on: film.on, port: film.port },
      { name: "Film Maker", about: "Turns a render into a film.", icon: "/api/apps/film/icon", state: "off", sentence: "Off", on: false, port: 3171 },
    );
    assert.equal(existsSync(h.config.paths.appsState), false, "reading writes nothing");
  });
});

test("each app's state and K23's words: damaged, not installed, and the host's own word for the good ones", async () => {
  await withApps(async ({ h, said }) => {
    for (const state of ["off", "starting", "on", "failed"]) {
      said.apps = [{ slug: "film", state, since: new Date().toISOString(), restarts: 0 }, { slug: "plain", state: "on" }];
      const v = await view(h);
      assert.deepEqual([appIn(v, "film").state, appIn(v, "film").sentence], [state, APP_SENTENCES[state]], state);
      assert.deepEqual([appIn(v, "plain").state, appIn(v, "plain").sentence], ["not_installed", "Not ready yet."], "not installed wins");
      assert.deepEqual([appIn(v, "broken").state, appIn(v, "broken").sentence], ["damaged", "This app's description is damaged."]);
      assert.equal(appIn(v, "broken").port, null);
      assert.equal(appIn(v, "still").state, "off", "an app the host does not list is off");
    }
    assert.deepEqual(APP_SENTENCES, {
      off: "Off", starting: "Starting…", on: "On", failed: "Stopped. It could not start.", not_installed: "Not ready yet.",
      damaged: "This app's description is damaged.",
    });
  });
});

test("the host's status file fills in an app its health does not list; a status file others may change is not read", async () => {
  await withApps(async ({ h, said }) => {
    said.apps = [];
    mkdirSync(h.config.paths.apps, { recursive: true, mode: 0o700 });
    writeFileSync(h.config.paths.appsStatus, JSON.stringify({ version: 1, apps: [{ slug: "still", state: "starting", why: null }] }), { mode: 0o600 });
    assert.equal(appIn(await view(h), "still").state, "starting");
    chmodSync(h.config.paths.appsStatus, 0o666);
    assert.equal(appIn(await view(h), "still").state, "off");
  });
});

test("the host's own state: off with no address, unhealthy when it answers oddly or too slowly, off or not installed when closed", async () => {
  await withApps(async ({ h, fake, said }) => {
    said.answer = { status: 500, body: {} };
    assert.deepEqual((await view(h)).host, { state: "unhealthy", sentence: HOST_SENTENCES.unhealthy });
    said.answer = { status: 200, body: { status: "ok", part: "generate", apps: [] } };
    assert.equal((await view(h)).host.state, "unhealthy", "another part on its port");
    said.answer = "headers-only";
    const t0 = Date.now();
    assert.equal((await view(h)).host.state, "unhealthy", "an answer begun and never finished");
    assert.ok(Date.now() - t0 < 3000, "one second at most");
    said.answer = null;
    said.apps = [{ slug: "film", state: "on" }];
    assert.equal(appIn(await view(h), "film").state, "on");
    await fake.close();
    const v = await view(h);
    assert.deepEqual(v.host, HOST_INSTALLED
      ? { state: "off", sentence: "App Studio is off. Run: engine start" }
      : { state: "not_installed", sentence: "App Studio is not installed yet." });
    assert.equal(appIn(v, "film").state, "off", "nothing runs while the host is not on");
    h.app.home.urls.apps = null;
    assert.deepEqual((await view(h)).host, { state: "off", sentence: "App Studio is off. Run: engine start" });
  });
});

test("the host is asked with Host 127.0.0.1:<its port>, by GET /apps/health only, with no token", async () => {
  await withApps(async ({ h, fake }) => {
    await view(h);
    assert.ok(fake.seen.length >= 1);
    for (const s of fake.seen) {
      assert.deepEqual([s.method, s.url, s.host, s.auth], ["GET", "/apps/health", `127.0.0.1:${new URL(fake.url).port}`, null]);
    }
  });
});

test("a damaged switches file: every app off, a plain problem, the shape kept; the next save writes a fresh file", async () => {
  await withApps(async ({ h, said }) => {
    said.apps = [{ slug: "film", state: "on" }];
    for (const [text, fileMode] of [["{ not json", 0o600], [JSON.stringify({ version: 1, apps: { film: { on: "yes" } } }), 0o600],
      [JSON.stringify({ version: 1, apps: { film: { on: true } } }), 0o666]]) {
      writeSwitchesFile(h.config, text, fileMode);
      const v = await view(h);
      assert.equal(v.problem, "apps_state_unreadable", text);
      assert.equal(v.problemSentence, PROBLEM_SENTENCES.apps_state_unreadable);
      assert.deepEqual(sameShape(readShape("apps"), v), []);
      assert.ok(v.apps.every((a) => a.on === false));
    }
    assert.equal((await post(h, "/api/apps/still/switch", { on: true })).status, 200);
    const saved = JSON.parse(readFileSync(h.config.paths.appsState, "utf8"));
    assert.deepEqual(saved.apps, { still: { on: true } });
    assert.equal(mode(h.config.paths.appsState), 0o600);
    assert.equal((await view(h)).problem, null);
  });
});

// ---- the switch ----------------------------------------------------------------------------------------------------

test("on: K17's file, 0600 in a 0700 folder, read by the host's own reader; changedAt new at every save", async () => {
  await withApps(async ({ h, logs }) => {
    const r = await post(h, "/api/apps/film/switch", { on: true });
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("apps"), r.json), []);
    assert.equal(appIn(r.json, "film").on, true);
    const first = JSON.parse(readFileSync(h.config.paths.appsState, "utf8"));
    assert.deepEqual(Object.keys(first), ["version", "apps", "changedAt"]);
    assert.deepEqual([first.version, first.apps], [1, { film: { on: true } }]);
    assert.ok(Number.isFinite(Date.parse(first.changedAt)));
    assert.equal(mode(h.config.paths.appsState), 0o600);
    assert.equal(mode(h.config.paths.apps), 0o700);
    assert.deepEqual(readAppsState(h.config.paths.appsState), { ok: true, on: { film: true }, changedAt: first.changedAt });
    await new Promise((r2) => setTimeout(r2, 5));
    assert.equal((await post(h, "/api/apps/film/switch", { on: true })).status, 200);
    const again = JSON.parse(readFileSync(h.config.paths.appsState, "utf8"));
    assert.notEqual(again.changedAt, first.changedAt, "the host starts a failed app again only when changedAt moves");
    assert.equal((await post(h, "/api/apps/still/switch", { on: true })).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(h.config.paths.appsState, "utf8")).apps, { film: { on: true }, still: { on: true } });
    assert.ok(logs.some((l) => l === "apps: film switched on"));
  });
});

test("off is always taken: a damaged app, an app not installed, and with the host off", async () => {
  await withApps(async ({ h }) => {
    for (const slug of ["broken", "plain", "film"]) {
      const r = await post(h, `/api/apps/${slug}/switch`, { on: false });
      assert.equal(r.status, 200, slug);
    }
    writeSwitchesFile(h.config, JSON.stringify({ version: 1, apps: { film: { on: true }, still: { on: true } }, changedAt: null }));
    assert.equal((await post(h, "/api/apps/film/switch", { on: false })).status, 200);
    assert.deepEqual(readAppsState(h.config.paths.appsState).on, { still: true }, "the other switches are kept");
  }, { host: false });
});

test("on is refused 409 cannot_switch_on with K23's words: damaged, not ready, App Studio off; nothing is written", async () => {
  await withApps(async ({ h }) => {
    const cases = [["broken", "damaged", "This app's description is damaged."], ["plain", "not_installed", "Not ready yet."]];
    for (const [slug, why, next] of cases) {
      const r = await post(h, `/api/apps/${slug}/switch`, { on: true });
      assert.equal(r.status, 409, slug);
      assert.deepEqual([r.json.error.code, r.json.error.why, r.json.error.next], ["cannot_switch_on", why, next]);
    }
    h.app.home.urls.apps = null;
    const off = await post(h, "/api/apps/film/switch", { on: true });
    assert.equal(off.status, 409);
    assert.deepEqual([off.json.error.code, off.json.error.why, off.json.error.next], ["cannot_switch_on", "host_off", "App Studio is off. Run: engine start"]);
    assert.equal(off.json.error.message, "Film Maker cannot be turned on yet.");
    assert.equal(existsSync(h.config.paths.appsState), false);
  });
});

test("a switch that is not true or false is refused 400 bad_switch", async () => {
  await withApps(async ({ h }) => {
    for (const body of [{}, { on: "true" }, { on: 1 }, { on: null }, []]) {
      const r = await post(h, "/api/apps/film/switch", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "bad_switch");
    }
    assert.equal(existsSync(h.config.paths.appsState), false);
  });
});

test("switching on an app that thinks copies the Art director's pick once; recompute and the owner's next choice keep it", async () => {
  await withApps(async ({ h }) => {
    seedModels(h.config);
    assert.equal((await post(h, "/api/apps/film/switch", { on: true })).status, 200);
    let { state } = readState(h.config);
    assert.deepEqual(state.picks[appPickName("film")], { model: "claude-opus-5-5", source: "ranked" });
    // The Art director's pick changes: the app's stays (copied once).
    updateState(h.config, (s) => { s.picks["art-director"] = { model: "claude-sonnet-5-5", source: "owner" }; });
    assert.equal((await post(h, "/api/apps/film/switch", { on: false })).status, 200);
    assert.equal((await post(h, "/api/apps/film/switch", { on: true })).status, 200);
    assert.equal(readState(h.config).state.picks["app-film"].model, "claude-opus-5-5");
    // Picks computed again for the agents (a refresh, an owner's pick in Models): the app's pick is kept as it is.
    const { agents } = readAgents(h.config);
    updateState(h.config, (s) => { recompute(h.config, s, agents); });
    state = readState(h.config).state;
    assert.deepEqual(state.picks["app-film"], { model: "claude-opus-5-5", source: "ranked" });
    assert.ok(Object.keys(state.picks).some((k) => agents.some((a) => a.slug === k)), "the agents' picks are made too");
    // The app that does not think gets no pick.
    assert.equal((await post(h, "/api/apps/still/switch", { on: true })).status, 200);
    assert.equal(readState(h.config).state.picks["app-still"], undefined);
  });
});

test("with no Art director's pick, switching on saves no pick and still works; a refused switch copies nothing", async () => {
  await withApps(async ({ h }) => {
    seedModels(h.config, { art: null });
    assert.equal((await post(h, "/api/apps/film/switch", { on: true })).status, 200);
    assert.equal(readState(h.config).state.picks["app-film"], undefined);
    seedModels(h.config);
    h.app.home.urls.apps = null;
    assert.equal((await post(h, "/api/apps/film/switch", { on: true })).status, 409);
    assert.equal(readState(h.config).state.picks["app-film"], undefined);
  });
});

// ---- the app's model ------------------------------------------------------------------------------------------------

test("thinks: the pick and the provider's saved list for an app that thinks; null for one that does not", async () => {
  await withApps(async ({ h }) => {
    let v = await view(h);
    assert.deepEqual(appIn(v, "film").thinks, { model: null, name: null, choices: [] });
    assert.equal(appIn(v, "still").thinks, null);
    assert.equal(appIn(v, "broken").thinks, null);
    seedModels(h.config);
    updateState(h.config, (s) => { s.picks["app-film"] = { model: "claude-fable-5-1", source: "owner" }; });
    v = await view(h);
    assert.deepEqual(appIn(v, "film").thinks, { model: "claude-fable-5-1", name: "Claude Fable 5.1", choices: MODELS });
  });
});

test("the owner's choice of model: one of the saved list, saved as the owner's; anything else 400 bad_model", async () => {
  await withApps(async ({ h }) => {
    seedModels(h.config);
    const r = await post(h, "/api/apps/film/thinks", { model: "claude-sonnet-5-5" });
    assert.equal(r.status, 200);
    assert.equal(appIn(r.json, "film").thinks.model, "claude-sonnet-5-5");
    assert.deepEqual(readState(h.config).state.picks["app-film"], { model: "claude-sonnet-5-5", source: "owner" });
    for (const body of [{ model: "gpt-unknown" }, { model: null }, {}, { model: 5 }]) {
      const bad = await post(h, "/api/apps/film/thinks", body);
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.equal(bad.json.error.code, "bad_model");
    }
    const notThinking = await post(h, "/api/apps/still/thinks", { model: "claude-sonnet-5-5" });
    assert.equal(notThinking.status, 400);
    assert.equal(notThinking.json.error.code, "bad_model");
    assert.equal(readState(h.config).state.picks["app-still"], undefined);
    assert.equal(readState(h.config).state.picks["app-film"].model, "claude-sonnet-5-5");
  });
});

// ---- the slug and the icon ----------------------------------------------------------------------------------------

test("a :slug is matched only against the manifests' list: ../x, an unknown name, capitals and escapes are 404", async () => {
  await withApps(async ({ h }) => {
    for (const s of ["..%2Fx", "..%2F..%2Fconfig", "nope", "Film", "film%00", "%2e%2e", "fi%2Flm"]) {
      for (const [m, p, body] of [["POST", "switch", { on: false }], ["POST", "allowance", { cents: 500 }], ["POST", "allowance/stop", {}],
        ["POST", "thinks", { model: "x" }], ["GET", "icon", undefined]]) {
        const r = await call(h.url, m, `/api/apps/${s}/${p}`, body === undefined ? {} : { body });
        assert.equal(r.status, 404, `${m} ${s}/${p}`);
      }
    }
    assert.equal(existsSync(h.config.paths.appsState), false);
    assert.equal(existsSync(h.config.paths.allowances), false);
  });
});

test("the icon: the manifest's own file, its type, and headers that let nothing run", async () => {
  await withApps(async ({ h }) => {
    const svg = await call(h.url, "GET", "/api/apps/film/icon");
    assert.equal(svg.status, 200);
    assert.equal(svg.headers["content-type"], "image/svg+xml");
    assert.equal(svg.headers["content-security-policy"], "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    assert.equal(svg.headers["x-content-type-options"], "nosniff");
    assert.equal(svg.text, SVG);
    const png = await call(h.url, "GET", "/api/apps/still/icon");
    assert.equal(png.status, 200);
    assert.equal(png.headers["content-type"], "image/png");
    assert.ok(png.buffer.equals(PNG));
    assert.equal((await call(h.url, "GET", "/api/apps/broken/icon")).status, 404, "a damaged app has no icon");
  });
});

test("the icon is refused when it became a link, a folder, too large or not a PNG after all", async () => {
  await withApps(async ({ h, appsDir, tmp }) => {
    const icon = join(appsDir, "film", "icon.svg");
    writeFileSync(join(tmp, "elsewhere.svg"), SVG);
    rmSync(icon);
    symlinkSync(join(tmp, "elsewhere.svg"), icon);
    assert.equal((await call(h.url, "GET", "/api/apps/film/icon")).status, 404, "a link");
    // The manifest reader damages the app for a link; the route is refused either way.
    rmSync(icon);
    mkdirSync(icon);
    assert.equal((await call(h.url, "GET", "/api/apps/film/icon")).status, 404, "a folder");
    rmSync(icon, { recursive: true });
    writeFileSync(icon, Buffer.alloc(256 * 1024 + 1, 0x20));
    assert.equal((await call(h.url, "GET", "/api/apps/film/icon")).status, 404, "over 256 KB");
    writeFileSync(join(appsDir, "still", "icon.png"), "<svg/> not a png");
    assert.equal((await call(h.url, "GET", "/api/apps/still/icon")).status, 404, "not a PNG");
  });
});

test("every POST without the home screen's own headers is refused by the core and writes nothing", async () => {
  await withApps(async ({ h }) => {
    for (const p of ["/api/apps/film/switch", "/api/apps/film/allowance", "/api/apps/film/allowance/stop", "/api/apps/film/thinks"]) {
      const bare = await call(h.url, "POST", p, { bare: true, body: { on: true, cents: 500 } });
      assert.equal(bare.status, 403, p);
      const cross = await call(h.url, "POST", p, { body: { on: true, cents: 500 }, headers: { origin: "http://evil.test", "sec-fetch-site": "cross-site" } });
      assert.equal(cross.status, 403, p);
    }
    assert.equal(existsSync(h.config.paths.appsState), false);
    assert.equal(existsSync(h.config.paths.allowances), false);
  });
});

// ---- a stub home ----------------------------------------------------------------------------------------------------

async function connectionsDuring(fn) {
  const seen = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    seen.push(o && typeof o === "object" && o.path ? `pipe ${o.path}` : Number(o && typeof o === "object" ? o.port : o));
    return original.apply(this, args);
  };
  try { await fn(); } finally { net.Socket.prototype.connect = original; }
  return seen;
}

test("a stub home has no host address and opens no socket to App Studio or any app", async () => {
  for (const start of [
    () => startV2({ routes: ["apps", "health"], inbox: [], search: [], port: 0 }),
    () => startStubsHome({ port: 0 }),
  ]) {
    const h = await start();
    try {
      assert.equal(h.app.home.urls.apps, null);
      const seen = await connectionsDuring(async () => {
        const v = await view(h);
        assert.deepEqual(v.host, { state: "off", sentence: "App Studio is off. Run: engine start" });
        const part = (await call(h.url, "GET", "/api/health")).json.parts.find((p) => p.id === "apps");
        assert.equal(part.state, "off");
        assert.match(part.technical, /none in stubs mode/);
        assert.equal((await post(h, "/api/apps/render-to-film/switch", { on: false })).status, 200);
      });
      assert.ok(seen.length > 0);
      const allowed = new Set([h.port, h.board.port, h.bench.port]);
      for (const port of seen) assert.ok(allowed.has(port), `a socket to ${port}`);
    } finally {
      await h.close();
    }
  }
});
