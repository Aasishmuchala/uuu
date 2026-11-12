// The doors' shared module (PLAN-V5, K1 and K3). Temp folders and made-up secrets only.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import {
  DOORS_DEFAULTS, checkCaller, ensureSecret, readBody, readDoorsState, refuse, statusFile,
} from "../common.mjs";

const SECRET = "a".repeat(64);          // the relay's vector secret
const DOOR_SECRET = "c".repeat(64);     // this door's own
const RESEARCHER = "11111111-2222-4333-8444-555555555555";
const ARTIST = "99999999-2222-4333-8444-555555555555";
const GOLDEN_A = "v1.a.11111111-2222-4333-8444-555555555555.1800000000.f9e21b44fbf14fa08d3eb8407a21a75d9731bbd485b3988694859b691e777c91";
const NOW = 1800000000 - 3600;

function folder() {
  return mkdtempSync(join(tmpdir(), "doors-common-"));
}
function write(path, body, mode = 0o600) {
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  chmodSync(path, mode);
  return path;
}
function setup(secret = DOOR_SECRET) {
  const dir = folder();
  return {
    dir,
    secretPath: write(join(dir, "web-secret"), `${secret}\n`),
    idsPath: write(join(dir, "ids.json"), { agents: { researcher: RESEARCHER, artist: ARTIST } }, 0o644),
  };
}
const bearer = (t) => ["Authorization", `Bearer ${t}`];
function caller(s, rawHeaders, { agents = ["researcher"], now = NOW } = {}) {
  return checkCaller({ rawHeaders, secretPath: s.secretPath, idsPath: s.idsPath, agents, now });
}

// ---- the switches file -----------------------------------------------------

test("no state file: every door off, with K1's defaults", () => {
  const st = readDoorsState(join(folder(), "state.json"));
  assert.equal(st.ok, true);
  assert.deepEqual({ web: st.web, generate: st.generate, viewer: st.viewer }, JSON.parse(JSON.stringify(DOORS_DEFAULTS)));
  assert.equal(st.web.on || st.generate.on || st.viewer.on, false);
});

test("missing fields take K1's defaults; present ones are kept", () => {
  const p = write(join(folder(), "state.json"), {
    version: 1, web: { on: true, perDay: 10, allow: ["example.com"] }, generate: { models: { video: "gen4.5" }, paused: "2026-11-12" },
  });
  const st = readDoorsState(p);
  assert.equal(st.ok, true);
  assert.equal(st.web.on, true);
  assert.equal(st.web.perDay, 10);
  assert.equal(st.web.perHour, 60);
  assert.deepEqual(st.web.allow, ["example.com"]);
  assert.equal(st.web.search, "keyless");
  assert.equal(st.generate.on, false);
  assert.equal(st.generate.paused, "2026-11-12");
  assert.deepEqual(st.generate.models, { ...DOORS_DEFAULTS.generate.models, video: "gen4.5" });
  assert.deepEqual(st.viewer, { on: false });
  // the defaults are never changed by a read
  assert.equal(DOORS_DEFAULTS.generate.models.video, "gen4_turbo");
});

test("an untrusted, unreadable or malformed state file is { ok: false }", () => {
  const dir = folder();
  const p = join(dir, "state.json");
  for (const body of ["{nope", "[]", "", "null", JSON.stringify({ web: true }), JSON.stringify({ web: { on: "yes" } }),
    JSON.stringify({ web: { on: true, perDay: -1 } }), JSON.stringify({ web: { allow: "x" } }),
    JSON.stringify({ web: { allow: [1] } }), JSON.stringify({ generate: { paused: 5 } }),
    JSON.stringify({ generate: { models: { video: 5 } } })]) {
    write(p, body);
    assert.deepEqual(readDoorsState(p), { ok: false }, body);
  }
  for (const mode of [0o620, 0o602, 0o666]) {
    write(p, { web: { on: true } }, mode);
    assert.deepEqual(readDoorsState(p), { ok: false });
  }
  write(p, { web: { on: true }, pad: "x".repeat(1024 * 1024) });
  assert.deepEqual(readDoorsState(p), { ok: false }, "over 1 MB");
  const real = write(join(dir, "elsewhere.json"), { web: { on: true } });
  const link = join(dir, "link.json");
  symlinkSync(real, link);
  assert.deepEqual(readDoorsState(link), { ok: false }, "a link");
  assert.deepEqual(readDoorsState(dir), { ok: false }, "a folder");
});

// ---- the caller --------------------------------------------------------------

test("an agent the door serves, with a token from this door's secret, is let in", () => {
  const s = setup();
  const t = mintToken(DOOR_SECRET, "a", RESEARCHER, NOW + 7200);
  assert.deepEqual(caller(s, bearer(t)), { kind: "a", slug: "researcher", subject: RESEARCHER });
  assert.deepEqual(caller(s, ["authorization", `bearer ${t}`]), { kind: "a", slug: "researcher", subject: RESEARCHER });
});

test("the owner's test token is let in, and only with subject owner", () => {
  const s = setup();
  assert.deepEqual(caller(s, bearer(mintToken(DOOR_SECRET, "t", "owner", NOW + 120))),
    { kind: "t", slug: null, subject: "owner" });
  assert.equal(caller(s, bearer(mintToken(DOOR_SECRET, "t", "researcher", NOW + 120))), "not_owner");
  assert.equal(caller(s, bearer(mintToken(DOOR_SECRET, "t", "checker", NOW + 120))), "not_owner");
});

test("no header, two headers, not a bearer", () => {
  const s = setup();
  const t = mintToken(DOOR_SECRET, "a", RESEARCHER, NOW + 7200);
  assert.equal(caller(s, []), "no_token");
  assert.equal(caller(s, ["Host", "127.0.0.1"]), "no_token");
  assert.equal(caller(s, [...bearer(t), ...bearer(t)]), "two_tokens");
  assert.equal(caller(s, [...bearer(t), "authorization", "Bearer x"]), "two_tokens");
  assert.equal(caller(s, ["Authorization", t]), "not_bearer");
  assert.equal(caller(s, ["Authorization", `Basic ${t}`]), "not_bearer");
  assert.equal(caller(s, ["Authorization", `Bearer ${t} more`]), "not_bearer");
});

test("a token minted with the relay's vector secret is refused by a door whose secret differs", () => {
  const s = setup();
  assert.equal(mintToken(SECRET, "a", RESEARCHER, 1800000000), GOLDEN_A);
  assert.equal(caller(s, bearer(GOLDEN_A)), "bad_token");
  // the same token at a door keyed with that secret is accepted
  assert.deepEqual(caller(setup(SECRET), bearer(GOLDEN_A)), { kind: "a", slug: "researcher", subject: RESEARCHER });
});

test("expired, too far ahead, a wrong mac", () => {
  const s = setup();
  assert.equal(caller(s, bearer(mintToken(DOOR_SECRET, "a", RESEARCHER, NOW))), "bad_token");
  assert.equal(caller(s, bearer(mintToken(DOOR_SECRET, "a", RESEARCHER, NOW - 1))), "bad_token");
  assert.equal(caller(s, bearer(mintToken(DOOR_SECRET, "a", RESEARCHER, NOW + 8 * 3600))), "bad_token");
  const t = mintToken(DOOR_SECRET, "a", RESEARCHER, NOW + 7200);
  assert.equal(caller(s, bearer(t.slice(0, -1) + (t.endsWith("0") ? "1" : "0"))), "bad_token");
  // in milliseconds too
  assert.equal(caller(s, bearer(t), { now: (NOW + 7200) * 1000 }), "bad_token");
  assert.equal(typeof caller(s, bearer(t), { now: NOW * 1000 }), "object");
});

test("kind a not in the door's agents, or not in ids.json", () => {
  const s = setup();
  const artist = mintToken(DOOR_SECRET, "a", ARTIST, NOW + 7200);
  assert.equal(caller(s, bearer(artist)), "not_listed");
  assert.equal(caller(s, bearer(artist), { agents: [] }), "not_listed");
  assert.equal(caller(s, bearer(artist), { agents: "artist" }), "not_listed");
  assert.deepEqual(caller(s, bearer(artist), { agents: ["artist"] }), { kind: "a", slug: "artist", subject: ARTIST });
  const stranger = mintToken(DOOR_SECRET, "a", "00000000-0000-4000-8000-000000000000", NOW + 7200);
  assert.equal(caller(s, bearer(stranger)), "unknown_agent");
  write(s.idsPath, { agents: { researcher: RESEARCHER, sales: RESEARCHER } }, 0o644);
  assert.equal(caller(s, bearer(mintToken(DOOR_SECRET, "a", RESEARCHER, NOW + 7200))), "unknown_agent");
});

test("an untrusted ids.json or secret refuses every agent token", () => {
  const s = setup();
  const t = mintToken(DOOR_SECRET, "a", RESEARCHER, NOW + 7200);
  chmodSync(s.idsPath, 0o666);
  assert.equal(caller(s, bearer(t)), "no_ids");
  chmodSync(s.idsPath, 0o644);
  const real = join(s.dir, "ids-elsewhere.json");
  renameSync(s.idsPath, real);
  symlinkSync(real, s.idsPath);
  assert.equal(caller(s, bearer(t)), "no_ids");
  const s2 = setup();
  chmodSync(s2.secretPath, 0o644 | 0o020);
  assert.equal(caller(s2, bearer(t)), "no_secret");
  write(s2.secretPath, "C".repeat(64) + "\n");
  assert.equal(caller(s2, bearer(t)), "no_secret");
  assert.equal(caller({ ...s2, secretPath: join(s2.dir, "none") }, bearer(t)), "no_secret");
});

// ---- refusals over HTTP ------------------------------------------------------

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

test("refuse sends the pinned JSON and headers, and never 429 or 5xx", async () => {
  const statuses = [401, 403, 404, 400, 413, 429, 500, 502, 503, 529, 200, 302, 99, "401", null];
  let i = 0;
  const srv = await serve((req, res) => {
    const st = statuses[i++];
    refuse(res, st, "web_no_token", "This door does not know you.", st === 403 ? { retryAfterSec: 30 } : undefined);
  });
  try {
    const got = [];
    for (const st of statuses) {
      const r = await fetch(srv.url);
      const body = await r.json();
      got.push(r.status);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.equal(r.headers.get("connection"), "close");
      assert.match(r.headers.get("content-type"), /^application\/json/);
      assert.equal(body.code, "web_no_token");
      assert.deepEqual(body.error, { message: "This door does not know you." });
      if (st === 403) assert.equal(body.retryAfterSec, 30);
      assert.ok(r.status >= 400 && r.status < 500 && r.status !== 429, String(st));
    }
    assert.deepEqual(got, [401, 403, 404, 400, 413, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403]);
  } finally {
    await srv.close();
  }
});

test("readBody gives the bytes, too-big past the limit, declared or sent", async () => {
  const seen = [];
  const srv = await serve(async (req, res) => {
    const b = await readBody(req, 16);
    seen.push(Buffer.isBuffer(b) ? b.toString() : b);
    res.end("ok");
  });
  try {
    await fetch(srv.url, { method: "POST", body: "hello" });
    await fetch(srv.url, { method: "POST", body: "x".repeat(17) });
    await new Promise((resolve, reject) => {
      const req = http.request(`${srv.url}/`, { method: "POST", headers: { "Transfer-Encoding": "chunked" } }, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.write("x".repeat(10));
      req.end("y".repeat(10));
    });
    assert.deepEqual(seen, ["hello", "too-big", "too-big"]);
  } finally {
    await srv.close();
  }
});

// ---- the status file and the secret --------------------------------------------

test("statusFile writes by rename, 0600 in a 0700 folder, at most once every 2 seconds", async () => {
  const dir = join(folder(), "doors");
  const p = join(dir, "web-status.json");
  const st = statusFile(p, { everyMs: 200 });
  st.save({ n: 1 });
  st.flush();
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { n: 1 });
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  st.save({ n: 2 });
  st.save({ n: 3 });
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { n: 1 }, "not yet: the wait is not over");
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(JSON.parse(readFileSync(p, "utf8")), { n: 3 });
  assert.deepEqual(readdirSync(dir), ["web-status.json"], "no temp file is left");
});

test("ensureSecret makes 64 hex and a newline, 0600 in a 0700 folder, once", () => {
  const dir = join(folder(), "secrets", "doors");
  const p = join(dir, "web-secret");
  assert.equal(ensureSecret(p), true);
  const first = readFileSync(p, "utf8");
  assert.match(first, /^[0-9a-f]{64}\n$/);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(ensureSecret(p), false);
  assert.equal(readFileSync(p, "utf8"), first, "an existing secret is kept");
  assert.equal(existsSync(p), true);
});
