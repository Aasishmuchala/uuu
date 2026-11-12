// The Web routes (PLAN-V5 K11, T32) on a stub home, with a real web door (createWebDoor on port 0) on the
// stand-in internet where a call must go through. Every secret, key and agent id is made up; nothing leaves
// 127.0.0.1 and nothing calls a live door.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { ensureSecret, readDoorsState } from "../../../doors/common.mjs";
import { readSecret } from "../../../relay/state.mjs";
import { mintToken } from "../../../relay/token.mjs";
import { ok, startInternet } from "../../../test/stubs/internet.mjs";
import { createWebDoor } from "../../../web/door.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const RESEARCHER = "11111111-2222-4333-8444-555555555555";
const DOOR_PORTS = [3130, 3140, 3150, 3160];
const mode = (p) => statSync(p).mode & 0o777;
const madeUpSearchKey = () => `BSA${randomBytes(14).toString("hex")}`;
const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));

function addResearcher(config) {
  const ids = JSON.parse(readFileSync(config.paths.ids, "utf8"));
  ids.agents.researcher = RESEARCHER;
  rmSync(config.paths.ids);
  writeFileSync(config.paths.ids, JSON.stringify(ids, null, 2), { mode: 0o600 });
}

// A stub home with the Web routes; unless door is false, a real web door on port 0 against the stand-in
// internet (example.com answers; no search provider exists there, so search is down).
async function withWeb(fn, { door = true, researcher = true, routes = ["web"] } = {}) {
  const inet = await startInternet({
    sites: {
      "example.com": { addresses: ["93.184.216.35"], handler: ok("<title>Example Domain</title><p>Example</p>") },
      "site.test": { addresses: ["93.184.216.36"], handler: ok("<title>A site</title><p>Plans and sections.</p>") },
    },
  });
  const logs = [];
  const doorLogs = [];
  const h = await startV2({ routes, inbox: [], search: [], port: 0, log: (l) => logs.push(l) });
  let d = null;
  try {
    if (researcher) addResearcher(h.config);
    ensureSecret(h.config.paths.webSecret);
    if (door) {
      d = createWebDoor({ listenPort: 0, paths: h.config.paths, config: h.config, log: (l) => doorLogs.push(l), net: inet.net, limits: { totalMs: 2000 } });
      await d.listen();
      h.app.home.urls.web = `http://127.0.0.1:${d.port}`;
    }
    return await fn({ h, door: d, inet, logs, doorLogs });
  } finally {
    if (d) await d.close();
    await h.close();
    await inet.close();
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/web")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const agentToken = (h) => mintToken(readSecret(h.config.paths.webSecret), "a", RESEARCHER, Math.floor(Date.now() / 1000) + 3600);
function agentFetch(door, h, url) {
  return call(`http://127.0.0.1:${door.port}`, "POST", "/web/fetch", {
    body: { url }, bare: true, headers: { authorization: `Bearer ${agentToken(h)}`, "content-type": "application/json" },
  });
}

test("the view fits shapes/web.json and starts with the web off", async () => {
  await withWeb(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/web");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("web"), r.json), []);
    const v = r.json;
    assert.equal(v.on, false);
    assert.deepEqual(v.door, { state: "on", sentence: "The web door is running." });
    assert.equal(v.canSwitchOn, false);
    assert.deepEqual(v.blockers, ["no_researcher"]);
    assert.equal(v.whyNot, "Run engine setup first, then try again.");
    assert.equal(v.search, "keyless");
    assert.equal(v.searchKeySaved, false);
    assert.deepEqual([v.allow, v.block], [[], []]);
    assert.deepEqual(v.watchHosts, ["youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "vimeo.com", "vimeocdn.com"]);
    assert.deepEqual(v.caps, { perHour: 60, perDay: 300 });
    assert.deepEqual(v.today, { fetches: 0, searches: 0, watches: 0, refused: 0, lastAt: null });
    assert.deepEqual(v.shared, []);
    assert.deepEqual(v.sharedTotals, { files: 0, bytes: 0, maxFiles: 50, maxBytes: 5 * 1024 * 1024 });
    assert.equal(v.lastTest, null);
    assert.equal(v.problem, null);
    assert.equal(existsSync(h.config.paths.doorsState), false, "reading writes nothing");
    addResearcher(h.config);
    const again = await view(h);
    assert.equal(again.canSwitchOn, true);
    assert.deepEqual(again.blockers, []);
    assert.equal(again.whyNot, null);
  }, { researcher: false });
});

test("the switch writes the file with its modes; on is refused while the door does not answer or the Researcher is not set up", async () => {
  await withWeb(async ({ h, door }) => {
    let r = await post(h, "/api/web/switch", { on: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "cannot_switch_on");
    assert.deepEqual(r.json.error.blockers, ["no_researcher"]);
    assert.equal(r.json.error.next, "Run engine setup first, then try again.");
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing written");

    addResearcher(h.config);
    r = await post(h, "/api/web/switch", { on: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.on, true);
    assert.equal(mode(h.config.paths.doors), 0o700);
    assert.equal(mode(h.config.paths.doorsState), 0o600);
    const st = readDoorsState(h.config.paths.doorsState);
    assert.equal(st.ok, true);
    assert.equal(st.web.on, true);
    assert.equal(st.generate.on, false);
    assert.equal(st.viewer.on, false);
    const health = await call(`http://127.0.0.1:${door.port}`, "GET", "/web/health");
    assert.deepEqual(health.json, { status: "ok", part: "web", on: true }, "the door sees the switch at once");

    assert.equal((await post(h, "/api/web/switch", { on: "yes" })).json.error.code, "bad_switch");
    assert.equal((await post(h, "/api/web/switch", {})).status, 400);

    await door.close();
    r = await post(h, "/api/web/switch", { on: true });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json.error.blockers, ["door_off"]);
    assert.equal(r.json.error.next, "The web door is not installed yet.");
    r = await post(h, "/api/web/switch", { on: false });
    assert.equal(r.status, 200, "off always works");
    assert.equal(r.json.on, false);
    assert.equal(readDoorsState(h.config.paths.doorsState).web.on, false);
    assert.ok(r.json.blockers.includes("door_off"));
    assert.equal(r.json.door.state, "not_installed");
  }, { researcher: false });
});

test("a damaged switches file: every door off and a plain problem; the next save writes a fresh file", async () => {
  await withWeb(async ({ h }) => {
    mkdirSync(h.config.paths.doors, { recursive: true, mode: 0o700 });
    writeFileSync(h.config.paths.doorsState, JSON.stringify({ web: { on: true }, generate: { on: true } }), { mode: 0o666 });
    chmodSync(h.config.paths.doorsState, 0o666);
    let v = await view(h);
    assert.equal(v.on, false);
    assert.equal(v.problem, "state_unreadable");
    assert.match(v.problemSentence, /every door is off/);
    const r = await post(h, "/api/web/switch", { on: false });
    assert.equal(r.status, 200);
    assert.equal(mode(h.config.paths.doorsState), 0o600);
    const st = readDoorsState(h.config.paths.doorsState);
    assert.deepEqual([st.ok, st.web.on, st.generate.on, st.viewer.on], [true, false, false, false]);
    v = await view(h);
    assert.equal(v.problem, null);
  }, { door: false });
});

test("lists: kept clean; a bad host is refused by name and nothing is written; caps are not the owner's lists", async () => {
  await withWeb(async ({ h, door }) => {
    let r = await post(h, "/api/web/lists", { allow: ["Example.com", "*.news.example.org", "example.com"], block: ["site.test"], watchHosts: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.allow, ["example.com", "news.example.org"]);
    assert.deepEqual(r.json.block, ["site.test"]);
    assert.deepEqual(r.json.watchHosts, []);
    const saved = readFileSync(h.config.paths.doorsState, "utf8");
    assert.deepEqual(JSON.parse(saved).web.allow, ["example.com", "news.example.org"]);

    for (const [field, list, index, host] of [
      ["allow", ["ok.com", "exa mple"], 1, "exa mple"],
      ["block", ["127.0.0.1"], 0, "127.0.0.1"],
      ["block", ["localhost"], 0, "localhost"],
      ["watchHosts", ["https://youtube.com/"], 0, "https://youtube.com/"],
      ["allow", ["fine.com", 7], 1, ""],
    ]) {
      r = await post(h, "/api/web/lists", { [field]: list });
      assert.equal(r.status, 400, host);
      assert.equal(r.json.error.code, "bad_host");
      assert.deepEqual([r.json.field, r.json.index, r.json.host], [field, index, host]);
      if (host) assert.equal(r.json.error.message, `"${host}" is not a site name.`);
      assert.equal(readFileSync(h.config.paths.doorsState, "utf8"), saved, "nothing written");
    }
    r = await post(h, "/api/web/lists", { allow: Array.from({ length: 201 }, (_, i) => `site${i}.com`) });
    assert.equal(r.json.error.code, "too_many_hosts");
    assert.equal((await post(h, "/api/web/lists", { allow: Array.from({ length: 200 }, (_, i) => `site${i}.com`) })).status, 200);
    for (const body of [{}, { perHour: 1000 }, { allow: "example.com" }, { allow: [], on: true }]) {
      r = await post(h, "/api/web/lists", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "bad_request");
    }
    assert.equal(JSON.parse(readFileSync(h.config.paths.doorsState, "utf8")).web.perHour, 60);

    // The door applies the owner's block list.
    await post(h, "/api/web/lists", { allow: [], block: ["site.test"] });
    assert.equal((await post(h, "/api/web/switch", { on: true })).status, 200);
    const f = await agentFetch(door, h, "https://site.test/");
    assert.equal(f.json.code, "web_blocked");
  });
});

test("the search key is never in any answer, error or log", async () => {
  await withWeb(async ({ h, logs, doorLogs }) => {
    const key = madeUpSearchKey();
    const texts = [];
    const keep = async (p) => { const r = await p; texts.push(r.text); return r; };

    let r = await keep(post(h, "/api/web/search", { search: "brave" }));
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "no_key");
    r = await keep(post(h, "/api/web/search-key", { key: "short" }));
    assert.equal(r.json.error.code, "bad_key");
    r = await keep(post(h, "/api/web/search-key", { key: `${key} with spaces` }));
    assert.equal(r.status, 400);

    r = await keep(post(h, "/api/web/search-key", { key: `  ${key}\n` }));
    assert.equal(r.status, 200);
    assert.equal(r.json.searchKeySaved, true);
    assert.equal(r.json.search, "brave", "saving a key chooses it");
    assert.equal(readFileSync(h.config.paths.searchKey, "utf8"), `${key}\n`);
    assert.equal(mode(h.config.paths.searchKey), 0o600);
    assert.equal(mode(h.config.paths.doorSecrets), 0o700);
    assert.equal(readDoorsState(h.config.paths.doorsState).web.search, "brave");

    await keep(call(h.url, "GET", "/api/web"));
    await keep(post(h, "/api/web/test"));
    assert.equal((await keep(post(h, "/api/web/search", { search: "keyless" }))).json.search, "keyless");
    assert.equal((await keep(post(h, "/api/web/search", { search: "brave" }))).json.search, "brave");
    assert.equal((await keep(post(h, "/api/web/search", { search: "google" }))).json.error.code, "bad_search");
    await keep(post(h, "/api/web/lists", { allow: [key] }));
    await keep(call(h.url, "GET", "/api/web/visits"));

    r = await keep(post(h, "/api/web/search-key/remove"));
    assert.equal(r.json.searchKeySaved, false);
    assert.equal(r.json.search, "keyless");
    assert.equal(existsSync(h.config.paths.searchKey), false);
    assert.equal(readDoorsState(h.config.paths.doorsState).web.search, "keyless");

    assert.ok(logs.some((l) => l === "web: a search key was saved"));
    for (const t of [...texts, ...logs, ...doorLogs]) {
      assert.ok(!t.includes(key) && !t.includes(key.slice(0, 12)) && !t.includes(key.slice(-12)), t.slice(0, 200));
    }
    // A key pasted into a list is refused without being named back.
    const pasted = JSON.parse(texts[texts.length - 3]);
    assert.deepEqual([pasted.error.code, pasted.error.message, pasted.host], ["bad_host", "That is not a site name.", ""]);
  });
});

test("Test reports a working fetch and a search that is down, in words, with the switch off", async () => {
  await withWeb(async ({ h, door, inet }) => {
    const r = await post(h, "/api/web/test");
    assert.equal(r.status, 200);
    const t = r.json.lastTest;
    assert.equal(r.json.on, false);
    assert.equal(t.fetch.ok, true);
    assert.equal(t.fetch.status, 200);
    assert.equal(t.fetch.sentence, "Reading a page worked.");
    assert.equal(t.search.ok, false);
    assert.equal(t.search.code, "web_search_down");
    assert.equal(t.search.sentence, "Search is not answering. Reading a page by its address still works.");
    assert.equal(t.sentence, "Reading a page worked. Search is not answering. Reading a page by its address still works.");
    assert.ok(Date.parse(t.at));
    assert.ok(inet.seen.requests.some((q) => q.site === "example.com" && q.method === "GET" && q.url === "/"));
    assert.deepEqual((await view(h)).lastTest, t, "kept for the page's next read");

    await door.close();
    const off = await post(h, "/api/web/test");
    assert.equal(off.status, 409);
    assert.equal(off.json.error.code, "door_off");
  });
  await withWeb(async ({ h }) => {
    const r = await post(h, "/api/web/test");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "door_off");
    assert.equal(r.json.error.message, "The web door is off, so nothing could be tested.");
  }, { door: false });
});

// ---- the visits ---------------------------------------------------------------------------------------------

function writeVisits(config, lines, fileMode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.webVisits, { force: true });
  writeFileSync(config.paths.webVisits, `${lines.join("\n")}\n`);
  chmodSync(config.paths.webVisits, fileMode);
}

test("visits are paged newest first, 100 a page, and every address stays plain text", async () => {
  await withWeb(async ({ h }) => {
    const base = Date.parse("2026-11-12T08:00:00.000Z");
    const at = (i) => new Date(base + i * 1000).toISOString();
    const lines = [];
    for (let i = 0; i < 250; i += 1) lines.push(JSON.stringify({ at: at(i), slug: "researcher", kind: "fetch", url: `https://site${i}.test/`, status: 200, bytes: 100 + i }));
    const markup = "https://x.test/?q=<img src=x onerror=alert(1)><script>alert(2)</script>";
    lines.push(JSON.stringify({ at: at(250), slug: "researcher", kind: "fetch", url: markup, status: 404, bytes: 5 }));
    lines.push(JSON.stringify({ at: at(251), slug: "researcher", kind: "search", url: "plans\u0007 and‮ sections", status: "web_search_down", bytes: 0 }));
    lines.push(JSON.stringify({ at: at(252), slug: "researcher", kind: "fetch", url: "https://y.test/", status: "web_unreachable", bytes: 0 }));
    lines.push("not json", JSON.stringify({ at: at(253), slug: "x", kind: "other", url: "u", status: 200 }), JSON.stringify({ at: "yesterday", kind: "fetch", status: 200 }));
    lines.push(JSON.stringify({ at: at(254), slug: "Not A Slug!", kind: "watch", url: "https://youtube.com/watch?v=1", status: "web_blocked", bytes: 0 }));
    writeVisits(h.config, lines);

    const r1 = await call(h.url, "GET", "/api/web/visits");
    assert.equal(r1.status, 200);
    assert.match(r1.headers["content-type"], /^application\/json/);
    assert.equal(r1.headers["x-content-type-options"], "nosniff");
    const p1 = r1.json;
    assert.equal(p1.visits.length, 100);
    assert.equal(p1.more, true);
    assert.deepEqual(p1.visits.slice(0, 4).map((v) => [v.kind, v.result, v.code, v.slug]), [
      ["watch", "refused", "web_blocked", "unknown"], ["fetch", "unreachable", "web_unreachable", "researcher"],
      ["search", "refused", "web_search_down", "researcher"], ["fetch", "site_error", null, "researcher"],
    ]);
    assert.equal(p1.visits[2].url, "plans and sections", "control and invisible characters removed");
    assert.equal(p1.visits[3].url, markup, "markup comes back as the same plain text, never as a page");
    assert.equal(p1.visits[3].status, 404);
    for (let i = 1; i < p1.visits.length; i += 1) assert.ok(p1.visits[i - 1].at > p1.visits[i].at, "newest first");
    assert.equal(p1.next, p1.visits[99].at);

    const p2 = (await call(h.url, "GET", `/api/web/visits?before=${encodeURIComponent(p1.next)}`)).json;
    assert.equal(p2.visits.length, 100);
    assert.ok(p2.visits[0].at < p1.next);
    const p3 = (await call(h.url, "GET", `/api/web/visits?before=${encodeURIComponent(p2.next)}`)).json;
    assert.equal(p3.more, false);
    assert.equal(p3.next, null);
    const all = [...p1.visits, ...p2.visits, ...p3.visits];
    assert.equal(all.length, 254, "every good line once, the four bad ones left out");
    assert.equal(new Set(all.map((v) => v.at)).size, 254);
    assert.equal(all[all.length - 1].url, "https://site0.test/");

    assert.equal((await call(h.url, "GET", "/api/web/visits?before=yesterday")).json.error.code, "bad_before");
    chmodSync(h.config.paths.webVisits, 0o666);
    assert.deepEqual((await call(h.url, "GET", "/api/web/visits")).json, { visits: [], more: false, next: null }, "a file others can write is not read");
  }, { door: false });
});

test("visits of the same moment are never split across pages", async () => {
  await withWeb(async ({ h }) => {
    const base = Date.parse("2026-11-12T08:00:00.000Z");
    const lines = [];
    for (let i = 0; i < 103; i += 1) {
      const t = i <= 3 ? base : base + i * 1000; // the four oldest share one moment: the 100th and the three after it
      lines.push(JSON.stringify({ at: new Date(t).toISOString(), slug: "researcher", kind: "fetch", url: `https://s${i}.test/`, status: 200, bytes: 1 }));
    }
    writeVisits(h.config, lines);
    const p1 = (await call(h.url, "GET", "/api/web/visits")).json;
    assert.equal(p1.visits.length, 103);
    assert.equal(p1.more, false);
  }, { door: false });
});

test("a real fetch through the door is listed, and today's counts come from the door's status file", async () => {
  await withWeb(async ({ h, door }) => {
    assert.equal((await post(h, "/api/web/switch", { on: true })).status, 200);
    const f = await agentFetch(door, h, "https://site.test/");
    assert.equal(f.status, 200);
    const p = (await call(h.url, "GET", "/api/web/visits")).json;
    assert.equal(p.visits[0].url, "https://site.test/");
    assert.deepEqual([p.visits[0].kind, p.visits[0].slug, p.visits[0].result, p.visits[0].status], ["fetch", "researcher", "ok", 200]);

    const writeStatus = (value, m = 0o600) => {
      rmSync(h.config.paths.webStatus, { force: true });
      writeFileSync(h.config.paths.webStatus, JSON.stringify(value));
      chmodSync(h.config.paths.webStatus, m);
    };
    await door.close(); // so its own status writes stop
    const lastAt = new Date().toISOString();
    writeStatus({ startedAt: lastAt, on: true, today: { day: dayOf(Date.now()), fetches: 3, searches: 2, watches: 1, refused: 4 }, lastAt });
    assert.deepEqual((await view(h)).today, { fetches: 3, searches: 2, watches: 1, refused: 4, lastAt });
    writeStatus({ on: true, today: { day: "2020-01-01", fetches: 3 }, lastAt });
    assert.deepEqual((await view(h)).today, { fetches: 0, searches: 0, watches: 0, refused: 0, lastAt }, "another day");
    writeStatus({ on: true, today: { day: dayOf(Date.now()), fetches: -1, searches: "9", watches: 1.5, refused: 2 }, lastAt: "<b>" });
    assert.deepEqual((await view(h)).today, { fetches: 0, searches: 0, watches: 0, refused: 2, lastAt: null });
    writeStatus({ on: true, today: { day: dayOf(Date.now()), fetches: 3 } }, 0o666);
    assert.equal((await view(h)).today.fetches, 0, "a file others can write is not read");
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
    () => startV2({ routes: ["web", "health"], inbox: [], search: [], port: 0 }),
    () => startStubsHome({ port: 0 }),
  ]) {
    const h = await start();
    try {
      for (const d of ["web", "generate", "viewer", "preview"]) assert.equal(h.app.home.urls[d], null, d);
      addResearcher(h.config);
      ensureSecret(h.config.paths.webSecret);
      const configured = DOOR_PORTS.concat(["web", "generate", "viewer", "preview"].map((d) => h.config.ports[d]));
      const seen = await connectionsDuring(async () => {
        assert.equal((await call(h.url, "GET", "/api/web")).json.door.state, "off");
        const health = (await call(h.url, "GET", "/api/health")).json;
        for (const id of ["web", "generate", "viewer"]) {
          const p = health.parts.find((x) => x.id === id);
          assert.equal(p.state, "off");
          assert.match(p.technical, /none in stubs mode/);
        }
        assert.equal((await post(h, "/api/web/test")).json.error.code, "door_off");
        assert.deepEqual((await post(h, "/api/web/switch", { on: true })).json.error.blockers, ["door_off"]);
        assert.equal((await call(h.url, "GET", "/api/web/visits")).status, 200);
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
  await withWeb(async ({ h }) => {
    const key = madeUpSearchKey();
    const posts = [
      ["/api/web/switch", { on: true }], ["/api/web/lists", { allow: ["evil.example"] }], ["/api/web/search", { search: "keyless" }],
      ["/api/web/search-key", { key }], ["/api/web/search-key/remove", {}], ["/api/web/test", {}],
      ["/api/web/share", { token: Buffer.from("pricing/services.md").toString("base64url"), share: true }],
    ];
    for (const [path, body] of posts) {
      for (const headers of [
        { bare: true, headers: { "content-type": "application/json" } },
        { headers: { origin: "http://evil.example" } },
        { headers: { "sec-fetch-site": "cross-site" } },
        { headers: { "content-type": "text/plain" } },
        { headers: { "x-engine": "0" } },
      ]) {
        const r = await call(h.url, "POST", path, { body, ...headers });
        assert.equal(r.status, 403, `${path} ${JSON.stringify(headers)}`);
        assert.equal(r.json.error.code, "not_same_origin");
      }
    }
    assert.equal(existsSync(h.config.paths.doorsState), false);
    assert.equal(existsSync(h.config.paths.searchKey), false);
    assert.equal(existsSync(h.config.paths.sharedBrain), false);
  });
});
