// The owner's test is bounded (CONTRACTS-V4 C8: 30 seconds and 1 MB for each model's question), and no
// text from the provider that holds the key is ever kept or shown. Stand-ins only; every key is made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRelay } from "../../../relay/relay.mjs";
import { OMEGA_MODELS } from "../../../test/stubs/provider.mjs";
import { boundedPost, holdsKey, planRows } from "../lib/models.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const madeUpKey = () => `test-key-${randomBytes(12).toString("hex")}`;
const FLOOD = "flood-marker-".repeat(5000);

// A stand-in upstream whose model paths answer as `mode` says: "ok", "trickle" (headers, then one byte
// every 2 seconds, for ever), "flood" (an endless body), "silent" (never a byte). `usage` and `models`
// are the bodies of GET /v1/usage (and billing) and GET /v1/models. It counts the model answers it closed.
async function upstream({ mode = "ok", usage = { plan: "Pro" }, models = OMEGA_MODELS.data } = {}) {
  const s = { mode, usage, models, closed: 0, floodBytes: 0 };
  const timers = new Set();
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      const path = req.url.split("?")[0];
      const json = (body) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.method === "GET" && path === "/v1/models") return json({ object: "list", data: s.models });
      if (req.method === "GET" && (path === "/v1/usage" || path === "/v1/billing")) return json(s.usage);
      res.on("close", () => { s.closed += 1; });
      if (s.mode === "silent") return undefined;
      if (s.mode === "ok") return json({ type: "message", content: [{ type: "text", text: "OK" }], usage: { input_tokens: 1, output_tokens: 1 } });
      res.writeHead(200, { "content-type": "application/json" });
      if (s.mode === "trickle") {
        res.write("{");
        const t = setInterval(() => { if (!res.destroyed) res.write(" "); }, 2000);
        timers.add(t);
        res.on("close", () => clearInterval(t));
        return undefined;
      }
      const pump = () => {
        while (!res.destroyed && res.write(FLOOD)) s.floodBytes += FLOOD.length;
        if (!res.destroyed) res.once("drain", pump);
      };
      pump();
      return undefined;
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  s.url = `http://127.0.0.1:${server.address().port}`;
  s.close = () => new Promise((r) => { for (const t of timers) clearInterval(t); server.closeAllConnections(); server.close(r); });
  return s;
}

async function withHome(up, fn) {
  const h = await startV2({ routes: ["models"], inbox: [], search: [], port: 0, urls: { provider: up.url } });
  let relay = null;
  try {
    const p = h.config.paths;
    mkdirSync(p.providerSecrets, { recursive: true, mode: 0o700 });
    chmodSync(dirname(p.providerSecrets), 0o700);
    writeFileSync(p.relaySecret, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
    relay = createRelay({
      listenPort: 0, upstream: up.url, log: () => {},
      paths: { state: p.modelsState, ids: p.ids, key: p.providerKey, secret: p.relaySecret, status: p.relayStatus },
    });
    await relay.listen();
    h.app.home.urls.relay = `http://127.0.0.1:${relay.port}`;
    return await fn(h);
  } finally {
    if (relay) await relay.close();
    await h.close();
  }
}

const post = (h, path, body = {}) => call(h.url, "POST", path, { body });

// Every file under the stub's state folder but the key file, as text.
function stateFiles(h) {
  const out = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const f = join(dir, n);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (f !== h.config.paths.providerKey && st.size < 8 * 1024 * 1024) out.push([f, readFileSync(f, "utf8")]);
    }
  };
  walk(h.state);
  return out;
}

test("boundedPost: a trickle and a flood are cut in time, a silent answer is 'nothing', a closed port 'no_connection'", async () => {
  const up = await upstream({ mode: "trickle" });
  try {
    const body = { model: "x" };
    let t0 = Date.now();
    assert.deepEqual(await boundedPost(`${up.url}/v1/messages`, { headers: {}, body, limitMs: 600 }), { failed: "cut" });
    assert.ok(Date.now() - t0 < 1500);
    up.mode = "flood";
    t0 = Date.now();
    assert.deepEqual(await boundedPost(`${up.url}/v1/messages`, { headers: {}, body, limitMs: 10000, maxBytes: 256 * 1024 }), { failed: "cut" });
    assert.ok(Date.now() - t0 < 5000);
    up.mode = "silent";
    assert.deepEqual(await boundedPost(`${up.url}/v1/messages`, { headers: {}, body, limitMs: 300 }), { failed: "nothing" });
    up.mode = "ok";
    const ok = await boundedPost(`${up.url}/v1/messages`, { headers: {}, body });
    assert.equal(ok.status, 200);
    assert.match(ok.text, /OK/);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(up.closed >= 3, "every cut call was closed at the stand-in");
  } finally {
    await up.close();
  }
  assert.deepEqual(await boundedPost(up.url + "/v1/messages", { headers: {}, body: {}, limitMs: 300 }), { failed: "no_connection" });
});

test("the test route: a flood through the relay ends at 1 MB as no_answer and the answer is not kept", async () => {
  const up = await upstream({ mode: "flood" });
  try {
    await withHome(up, async (h) => {
      await post(h, "/api/models/refresh");
      await post(h, "/api/models/key", { key: madeUpKey() });
      const t0 = Date.now();
      const r = await post(h, "/api/models/test");
      assert.ok(Date.now() - t0 < 40000);
      assert.equal(r.status, 200);
      assert.ok(r.json.lastTest.models.length > 0);
      for (const m of r.json.lastTest.models) assert.deepEqual([m.answered, m.reason], [false, "no_answer"], m.model);
      assert.ok(!r.text.includes("flood-marker"));
      const saved = readFileSync(h.config.paths.modelsState, "utf8");
      assert.ok(!saved.includes("flood-marker") && saved.length < 64 * 1024);
      await new Promise((res) => setTimeout(res, 200));
      assert.ok(up.closed >= r.json.lastTest.models.length, "the flooding answers were closed");
    });
  } finally {
    await up.close();
  }
});

test("the test route: a trickle through the relay is cut at 30 seconds as no_answer", { timeout: 60000 }, async () => {
  const up = await upstream({ mode: "trickle" });
  try {
    await withHome(up, async (h) => {
      await post(h, "/api/models/refresh");
      await post(h, "/api/models/key", { key: madeUpKey() });
      const t0 = Date.now();
      const r = await post(h, "/api/models/test");
      const took = Date.now() - t0;
      assert.ok(took >= 29000 && took < 40000, `took ${took} ms`);
      assert.equal(r.json.lastTest.key, "ok", "usage and billing answered");
      for (const m of r.json.lastTest.models) assert.deepEqual([m.answered, m.reason], [false, "no_answer"], m.model);
    });
  } finally {
    await up.close();
  }
});

test("the test route: an answer that never starts is cut at 30 seconds as unreachable", { timeout: 60000 }, async () => {
  const up = await upstream({ mode: "silent" });
  try {
    await withHome(up, async (h) => {
      await post(h, "/api/models/refresh");
      await post(h, "/api/models/key", { key: madeUpKey() });
      const t0 = Date.now();
      const r = await post(h, "/api/models/test");
      const took = Date.now() - t0;
      assert.ok(took >= 29000 && took < 40000, `took ${took} ms`);
      for (const m of r.json.lastTest.models) assert.deepEqual([m.answered, m.reason], [false, "unreachable"], m.model);
    });
  } finally {
    await up.close();
  }
});

test("holdsKey: the whole key, or its first or last 12 characters when it is at least 24 long", () => {
  const key = "abcdefghijklmnopqrstuvwxyz0123";
  assert.equal(holdsKey(`x ${key} y`, key), true);
  assert.equal(holdsKey("abcdefghijkl...", key), true);
  assert.equal(holdsKey("...stuvwxyz0123", key), true);
  assert.equal(holdsKey("abcdefghijk", key), false);
  assert.equal(holdsKey(42, key), false);
  assert.equal(holdsKey(null, key), false);
  assert.equal(holdsKey("anything", null), false);
  const short = "short-key-1234567";
  assert.equal(holdsKey("short-key-123", short), false, "a key under 24 is matched whole only");
  assert.equal(holdsKey(`[${short}]`, short), true);
  assert.deepEqual(planRows([{ plan: "Pro", note: `key ${key}`, [key]: "x", nested: { [`${key.slice(0, 12)}_x`]: 1 } }], key), [{ label: "plan", value: "Pro" }]);
});

for (const where of ["a value", "a key name"]) {
  test(`a usage answer that quotes the key in ${where}: no answer and no file but the key file holds it`, async () => {
    const key = madeUpKey();
    const head = key.slice(0, 12);
    const tail = key.slice(-12);
    const usage = where === "a value"
      ? { plan: "Pro", note: `your key is ${key}`, hint: `${head}...`, last: `...${tail}`, window: { left: `ends ${key}` } }
      : { plan: "Pro", [key]: "yours", [`${head}x`]: 1, window: { [`x${tail}`]: 2 } };
    const models = OMEGA_MODELS.data.map((m, i) => (i < 3 ? { ...m, display_name: `${m.display_name} ${key}`, owned_by: `${tail}` } : m));
    const up = await upstream({ mode: "ok", usage, models });
    try {
      await withHome(up, async (h) => {
        const texts = [];
        const keep = (r) => { texts.push(r.text); return r; };
        keep(await post(h, "/api/models/key", { key }));
        keep(await post(h, "/api/models/refresh"));
        const t = keep(await post(h, "/api/models/test"));
        assert.equal(t.status, 200);
        assert.deepEqual(t.json.lastTest.plan, [{ label: "plan", value: "Pro" }]);
        keep(await call(h.url, "GET", "/api/models"));
        keep(await post(h, "/api/models/pick", { agent: "sales", model: OMEGA_MODELS.data[0].id }));
        const names = keep(await call(h.url, "GET", "/api/models")).json.agents[0].options.slice(0, 3);
        assert.deepEqual(names.map((o) => o.name), OMEGA_MODELS.data.slice(0, 3).map((m) => m.id), "a name holding the key falls back to the id");
        for (const s of [key, head, tail]) {
          for (const x of texts) assert.ok(!x.includes(s), "an answer holds the key");
          for (const [f, x] of stateFiles(h)) assert.ok(!x.includes(s), `${f} holds the key`);
        }
      });
    } finally {
      await up.close();
    }
  });
}
