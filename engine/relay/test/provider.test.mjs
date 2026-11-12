// The stand-in provider the relay and the home server are tested against.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startProvider, OMEGA_MODELS } from "../../test/stubs/provider.mjs";

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }));
    }).on("error", reject);
  });
}

test("the stand-in serves the saved list of 19 models without a key, and usage and billing only with its key", async () => {
  const p = await startProvider({ behaviour: { key: "made-up-key-0123456789" } });
  try {
    assert.match(p.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const list = await get(`${p.url}/v1/models`);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 19);
    assert.deepEqual(list.json.data.map((m) => m.id), OMEGA_MODELS.data.map((m) => m.id));
    for (const m of list.json.data) assert.match(m.id, /^[a-z0-9.-]{1,80}$/);
    assert.equal((await get(`${p.url}/v1/usage`)).status, 401);
    assert.equal((await get(`${p.url}/v1/usage`, { "x-api-key": "made-up-key-0123456789" })).status, 200);
    assert.equal((await get(`${p.url}/v1/billing`, { Authorization: "Bearer made-up-key-0123456789" })).status, 200);
    assert.deepEqual(p.seen.map((s) => s.path), ["/v1/models", "/v1/usage", "/v1/usage", "/v1/billing"]);
  } finally {
    await p.close();
  }
});
