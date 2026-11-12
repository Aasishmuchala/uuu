// The home server's outside client (CONTRACTS-V4 C8, lib/provider.mjs) and the plan rows of the test.
// Only stand-ins on 127.0.0.1 are called; the real provider never is.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_DIR } from "../lib/app.mjs";
import { planRows } from "../lib/models.mjs";
import { PROVIDER_PATHS, providerGet, providerOrigin } from "../lib/provider.mjs";
import { PROVIDER_ORIGIN } from "../../../relay/upstream.mjs";

// A listener that answers with `handler` and counts connections.
async function stand(handler) {
  const server = http.createServer(handler);
  server.hits = 0;
  server.on("connection", () => { server.hits += 1; });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.url = `http://127.0.0.1:${server.address().port}`;
  server.stop = () => new Promise((r) => { server.closeAllConnections(); server.close(r); });
  return server;
}

test("the origin is urls.provider when that key exists (null means never call out), else the provider's", () => {
  assert.equal(providerOrigin({ board: "x" }), PROVIDER_ORIGIN);
  assert.equal(providerOrigin({ provider: null }), null);
  assert.equal(providerOrigin({ provider: "http://127.0.0.1:9" }), "http://127.0.0.1:9");
  assert.deepEqual([...PROVIDER_PATHS], ["/v1/models", "/v1/usage", "/v1/billing"]);
});

test("any other origin or path is refused before a socket is opened", async () => {
  const s = await stand((req, res) => res.end("{}"));
  try {
    const port = s.address().port;
    for (const origin of [null, undefined, `http://localhost:${port}`, `${s.url}/`, `http://127.0.0.1:${port}/v1`, "https://example.com",
      "http://api.omegaplusapi.com", "https://api.omegaplusapi.com.evil.example", `https://127.0.0.1:${port}`]) {
      await assert.rejects(providerGet(origin, "/v1/models"), (e) => e.unreachable === true, String(origin));
    }
    for (const path of ["/v1/messages", "/v1/models?x=1", "/v1/../v1/models", "//v1/models", "/"]) {
      await assert.rejects(providerGet(s.url, path), (e) => e.unreachable === true, path);
    }
    assert.equal(s.hits, 0);
  } finally {
    await s.stop();
  }
});

test("GET only, the key only as x-api-key, no proxy honoured", async () => {
  const seen = [];
  const s = await stand((req, res) => { seen.push({ method: req.method, url: req.url, headers: req.headers }); res.setHeader("content-type", "application/json"); res.end('{"ok":true}'); });
  const before = process.env.HTTP_PROXY;
  process.env.HTTP_PROXY = "http://127.0.0.1:9";
  try {
    const r = await providerGet(s.url, "/v1/usage", { key: "made-up-key-0123456789" });
    assert.deepEqual(r, { status: 200, json: { ok: true } });
    const plain = await providerGet(s.url, "/v1/models");
    assert.equal(plain.status, 200);
    assert.equal(seen[0].method, "GET");
    assert.equal(seen[0].url, "/v1/usage");
    assert.equal(seen[0].headers["x-api-key"], "made-up-key-0123456789");
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[1].headers["x-api-key"], undefined);
  } finally {
    if (before === undefined) delete process.env.HTTP_PROXY; else process.env.HTTP_PROXY = before;
    await s.stop();
  }
});

test("a redirect is not followed: its status comes back and the address it names sees nothing", async () => {
  const other = await stand((req, res) => res.end("{}"));
  const s = await stand((req, res) => { res.writeHead(302, { location: `${other.url}/v1/models` }); res.end(); });
  try {
    const r = await providerGet(s.url, "/v1/models");
    assert.equal(r.status, 302);
    assert.equal(other.hits, 0);
  } finally {
    await s.stop();
    await other.stop();
  }
});

test("an answer over 1 MB and an answer that never comes are both 'unreachable', and the error holds no key", async () => {
  const big = await stand((req, res) => { res.write("x".repeat(600 * 1024)); res.end("y".repeat(600 * 1024)); });
  const hang = await stand(() => {});
  try {
    await assert.rejects(providerGet(big.url, "/v1/models"), (e) => e.unreachable === true);
    await assert.rejects(providerGet(hang.url, "/v1/usage", { key: "made-up-key-0123456789", timeoutMs: 200 }),
      (e) => e.unreachable === true && !String(e.message).includes("made-up-key") && !String(e.stack).includes("made-up-key"));
    await hang.stop();
    await assert.rejects(providerGet(hang.url, "/v1/usage", { key: "made-up-key-0123456789" }), (e) => e.unreachable === true && !String(e.message).includes("made-up-key"));
  } finally {
    await big.stop();
  }
});

test("plan rows: plain values, at most 12, no row whose name holds key, token, secret, email or id", () => {
  const rows = planRows([
    { plan: "Pro", period: "daily", used_tokens: 5, api_key: "k", account_id: "a", owner_email: "e", client_secret: "s", window: { hours: 5, requests_left: 40 }, tiers: ["a", "b"] },
    { plan: "Pro", status: "active" },
    null,
  ]);
  assert.deepEqual(rows, [
    { label: "plan", value: "Pro" }, { label: "period", value: "daily" }, { label: "window hours", value: "5" },
    { label: "window requests left", value: "40" }, { label: "tiers 1", value: "a" }, { label: "tiers 2", value: "b" },
    { label: "status", value: "active" },
  ]);
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field_${i}`, i]));
  assert.equal(planRows([many]).length, 12);
  assert.deepEqual(planRows([undefined, undefined]), []);
});

test("the provider's address lives in the relay's upstream module, not in the home server's code", () => {
  for (const f of ["lib/provider.mjs", "lib/models.mjs", "routes/models.mjs", "lib/health.mjs"]) {
    assert.doesNotMatch(readFileSync(join(SERVER_DIR, f), "utf8"), /omegaplusapi/, f);
  }
});
