// The Models routes (CONTRACTS-V4 C8) against the stand-in provider and a real relay on port 0.
// Every key here is made up; nothing calls the real provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRelay } from "../../../relay/relay.mjs";
import { OMEGA_MODELS, startProvider } from "../../../test/stubs/provider.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const SLUGS = ["chief-of-staff", "builder", "checker", "bookkeeper", "sales", "support", "people", "marketer", "drafter", "artist"];
const madeUpKey = () => `test-key-${randomBytes(12).toString("hex")}`;
const madeUpSecret = () => randomBytes(32).toString("hex");

function writeSecret(config) {
  mkdirSync(config.paths.providerSecrets, { recursive: true, mode: 0o700 });
  chmodSync(dirname(config.paths.providerSecrets), 0o700);
  writeFileSync(config.paths.relaySecret, `${madeUpSecret()}\n`, { mode: 0o600 });
}

// A stub home with the Models routes, the stand-in provider as its origin, and (unless relay: false)
// a real relay on port 0 against the stand-in, with the relay's secret made up.
async function withModels(fn, { relay = true, behaviour = {}, models, routes = ["models"], relayLimits } = {}) {
  const provider = await startProvider({ behaviour, ...(models ? { models } : {}) });
  const logs = [];
  const h = await startV2({ routes, inbox: [], search: [], port: 0, urls: { provider: provider.url }, log: (l) => logs.push(l) });
  let r = null;
  try {
    writeSecret(h.config);
    if (relay) {
      const p = h.config.paths;
      r = createRelay({
        listenPort: 0, upstream: provider.url, log: (l) => logs.push(l), limits: { statusEveryMs: 0, ...(relayLimits || {}) },
        paths: { state: p.modelsState, ids: p.ids, key: p.providerKey, secret: p.relaySecret, status: p.relayStatus },
      });
      await r.listen();
      // The relay's paths are the stub state's, so it starts after the home and its address is set here.
      h.app.home.urls.relay = `http://127.0.0.1:${r.port}`;
    }
    return await fn({ h, provider, logs, relay: r });
  } finally {
    if (r) await r.close();
    await h.close();
    await provider.close();
  }
}

const view = async (h) => (await call(h.url, "GET", "/api/models")).json;
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });

async function ready(h, key = madeUpKey()) {
  assert.equal((await post(h, "/api/models/refresh")).status, 200);
  assert.equal((await post(h, "/api/models/key", { key })).status, 200);
  return key;
}

test("the view fits its shape and starts with nothing switched on", async () => {
  await withModels(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/models");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("models"), r.json), []);
    const v = r.json;
    assert.deepEqual(v.provider, { name: "Omega Plus", host: "api.omegaplusapi.com" });
    assert.equal(v.mode, "plans");
    assert.deepEqual(v.key, { saved: false, savedAt: null, state: "none" });
    assert.deepEqual(v.relay, { state: "on", sentence: "The model relay is on." });
    assert.deepEqual(v.catalogue, { readAt: null, count: 0 });
    assert.deepEqual(v.agents.map((a) => a.slug), SLUGS);
    const checker = v.agents.find((a) => a.slug === "checker");
    assert.equal(checker.program, "codex");
    assert.equal(checker.needs, "checking");
    assert.equal(v.agents.find((a) => a.slug === "chief-of-staff").plansModel, "opus");
    assert.deepEqual(v.missing, SLUGS);
    assert.deepEqual(v.blockers, ["no_key", "no_catalogue", "pick_missing"]);
    assert.equal(v.canSwitchOn, false);
    assert.equal(v.lastTest, null);
    assert.equal(v.problem, null);
    assert.equal(existsSync(h.config.paths.modelsState), false, "a GET writes nothing");
  });
});

test("refresh with the 19 models gives the C7 picks and fits the shape", async () => {
  await withModels(async ({ h, provider }) => {
    const r = await post(h, "/api/models/refresh");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("models"), r.json), []);
    assert.equal(r.json.catalogue.count, 19);
    for (const a of r.json.agents) {
      assert.equal(a.pick, a.slug === "checker" ? "claude-gpt-6-1-sol" : "claude-fable-5-1", a.slug);
      assert.equal(a.source, "ranked");
      assert.equal(a.options.length, 19);
    }
    assert.equal(r.json.agents.find((a) => a.slug === "builder").pickName, "Fable 5.1");
    assert.deepEqual(r.json.missing, []);
    assert.deepEqual(r.json.blockers, ["no_key"]);
    const saved = JSON.parse(readFileSync(h.config.paths.modelsState, "utf8"));
    assert.equal(saved.mode, "plans");
    assert.equal(saved.catalogue.models.length, 19);
    const fable = saved.catalogue.models.find((m) => m.id === "claude-fable-5-1");
    const src = OMEGA_MODELS.data.find((m) => m.id === "claude-fable-5-1");
    assert.deepEqual(fable, { id: src.id, name: src.display_name, owner: src.owned_by, context: src.context_window, maxOutput: src.max_output_tokens });
    assert.equal(statSync(h.config.paths.modelsState).mode & 0o777, 0o600);
    assert.equal(statSync(h.config.paths.models).mode & 0o777, 0o700);
    const read = provider.seen.filter((s) => s.path === "/v1/models");
    assert.equal(read.length, 1);
    assert.ok(!read[0].rawHeaders.some((x) => /^(x-api-key|authorization)$/i.test(x)), "the list is read with no key");
  });
});

test("refresh keeps only well-formed ids, at most 200", async () => {
  const models = [
    { id: "claude-fable-5-1", display_name: "Fable 5.1" }, { id: "Bad Id" }, { id: "x/../y" }, { nope: 1 },
    ...Array.from({ length: 250 }, (_, i) => ({ id: `extra-${i}` })),
  ];
  await withModels(async ({ h }) => {
    const r = await post(h, "/api/models/refresh");
    assert.equal(r.status, 200);
    assert.equal(r.json.catalogue.count, 200);
    const saved = JSON.parse(readFileSync(h.config.paths.modelsState, "utf8"));
    assert.equal(saved.catalogue.models[0].id, "claude-fable-5-1");
    assert.equal(saved.catalogue.models[1].id, "extra-0");
    assert.equal(saved.catalogue.models[1].name, "extra-0");
  }, { models, relay: false });
});

test("refresh with the provider down answers 502 and changes nothing", async () => {
  await withModels(async ({ h, provider }) => {
    await post(h, "/api/models/refresh");
    const before = readFileSync(h.config.paths.modelsState);
    await provider.close();
    const r = await post(h, "/api/models/refresh");
    assert.equal(r.status, 502);
    assert.equal(r.json.error.code, "provider_unreachable");
    assert.equal(r.json.error.message, "Omega Plus is not answering. Nothing was changed.");
    assert.deepEqual(readFileSync(h.config.paths.modelsState), before);
  }, { relay: false });
});

test("a saved key is in no answer of any route, no log line and no file but its own; modes 0600 and 0700", async () => {
  const provider = await startProvider();
  const logs = [];
  const h = await startStubsHome({ port: 0, urls: { provider: provider.url }, log: (l) => logs.push(l) });
  let relay = null;
  try {
    writeSecret(h.config);
    const p = h.config.paths;
    relay = createRelay({
      listenPort: 0, upstream: provider.url, log: (l) => logs.push(l), limits: { statusEveryMs: 0 },
      paths: { state: p.modelsState, ids: p.ids, key: p.providerKey, secret: p.relaySecret, status: p.relayStatus },
    });
    await relay.listen();
    h.app.home.urls.relay = `http://127.0.0.1:${relay.port}`;
    const key = madeUpKey();
    provider.behaviour.key = key;
    const answers = [];
    const keep = (r) => { answers.push(r.text); return r; };
    keep(await post(h, "/api/models/refresh"));
    const saved = keep(await post(h, "/api/models/key", { key: `  ${key}\n` }));
    assert.equal(saved.status, 200);
    assert.equal(saved.json.key.saved, true);
    assert.equal(saved.json.key.state, "unknown");
    assert.ok(Date.parse(saved.json.key.savedAt));
    assert.equal(readFileSync(p.providerKey, "utf8"), `${key}\n`);
    assert.equal(statSync(p.providerKey).mode & 0o777, 0o600);
    assert.equal(statSync(p.providerSecrets).mode & 0o777, 0o700);
    assert.equal(statSync(dirname(p.providerSecrets)).mode & 0o777, 0o700);
    const tested = keep(await post(h, "/api/models/test"));
    assert.equal(tested.status, 200);
    assert.equal(tested.json.lastTest.key, "ok");
    keep(await post(h, "/api/models/pick", { agent: "sales", model: "claude-opus-5-5" }));
    keep(await post(h, "/api/models/mode", { mode: "provider" }));
    keep(await post(h, "/api/models/mode", { mode: "plans" }));
    keep(await post(h, "/api/models/key", { key: "short" }));
    for (const path of ["/api/models", "/api/health", "/api/settings", "/api/state", "/api/shell", "/api/team", "/api/home", "/api/inbox", "/api/map", "/healthz"]) {
      keep(await call(h.url, "GET", path));
    }
    keep(await post(h, "/api/models/key/remove"));
    for (const t of answers) assert.ok(!t.includes(key), "an answer holds the key");
    for (const l of logs) assert.ok(!l.includes(key), `a log line holds the key: ${l.slice(0, 60)}`);
    assert.ok(!readFileSync(p.modelsState, "utf8").includes(key), "state.json holds the key");
    assert.ok(!readFileSync(p.relayStatus, "utf8").includes(key), "relay-status.json holds the key");
    assert.equal(existsSync(p.providerKey), false);
    // The key reached the provider only as x-api-key, on usage, billing and the model paths.
    for (const s of provider.seen) {
      for (let i = 0; i < s.rawHeaders.length; i += 2) {
        if (s.rawHeaders[i + 1].includes(key)) assert.match(s.rawHeaders[i].toLowerCase(), /^(x-api-key|authorization)$/);
      }
      assert.ok(!s.body.includes(key));
    }
  } finally {
    if (relay) await relay.close();
    await h.close();
    await provider.close();
  }
});

test("a key that is too short, too long, has a space or is not text is refused as bad_key", async () => {
  await withModels(async ({ h }) => {
    for (const key of ["short", "x".repeat(513), "has a space in the middle", 12345678901234567890, null, ["a".repeat(20)], "ключ-ключ-ключ-ключ"]) {
      const r = await post(h, "/api/models/key", { key });
      assert.equal(r.status, 400, String(key));
      assert.equal(r.json.error.code, "bad_key");
    }
    assert.equal((await post(h, "/api/models/key", {})).json.error.code, "bad_key");
    assert.equal(existsSync(h.config.paths.providerKey), false);
    assert.equal(existsSync(h.config.paths.modelsState), false);
  }, { relay: false });
});

test("remove deletes the key file and leaves plans mode", async () => {
  await withModels(async ({ h }) => {
    await ready(h);
    const r = await post(h, "/api/models/key/remove");
    assert.equal(r.status, 200);
    assert.equal(existsSync(h.config.paths.providerKey), false);
    assert.equal(r.json.mode, "plans");
    assert.deepEqual(r.json.key, { saved: false, savedAt: null, state: "none" });
    assert.ok(r.json.blockers.includes("no_key"));
    assert.equal((await post(h, "/api/models/key/remove")).status, 200, "removing twice is fine");
  });
});

test("removing the key while on switches to plans first", async () => {
  await withModels(async ({ h }) => {
    await ready(h);
    assert.equal((await post(h, "/api/models/mode", { mode: "provider" })).json.mode, "provider");
    const r = await post(h, "/api/models/key/remove");
    assert.equal(r.json.mode, "plans");
    assert.equal(JSON.parse(readFileSync(h.config.paths.modelsState, "utf8")).mode, "plans");
    assert.equal(existsSync(h.config.paths.providerKey), false);
  });
});

test("a pick for an unknown agent or a model not in the list is refused as bad_pick; null clears the override", async () => {
  await withModels(async ({ h }) => {
    assert.equal((await post(h, "/api/models/pick", { agent: "sales", model: "claude-kimi-k3" })).json.error.code, "bad_pick", "no list yet");
    await post(h, "/api/models/refresh");
    for (const body of [{ agent: "nobody", model: "claude-kimi-k3" }, { agent: "sales", model: "claude-made-up" }, { agent: "sales" }, { agent: "sales", model: 3 }, { model: "claude-kimi-k3" }]) {
      const r = await post(h, "/api/models/pick", body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.code, "bad_pick");
    }
    const r = await post(h, "/api/models/pick", { agent: "sales", model: "claude-kimi-k3" });
    assert.equal(r.status, 200);
    const sales = r.json.agents.find((a) => a.slug === "sales");
    assert.equal(sales.pick, "claude-kimi-k3");
    assert.equal(sales.source, "owner");
    assert.equal(sales.options.find((o) => o.id === "claude-kimi-k3").ranked, false);
    const back = await post(h, "/api/models/pick", { agent: "sales", model: null });
    assert.equal(back.json.agents.find((a) => a.slug === "sales").pick, "claude-fable-5-1");
    assert.equal(back.json.agents.find((a) => a.slug === "sales").source, "ranked");
  }, { relay: false });
});

test("an override survives a refresh and is dropped when its id leaves the list", async () => {
  await withModels(async ({ h }) => {
    await post(h, "/api/models/refresh");
    await post(h, "/api/models/pick", { agent: "sales", model: "claude-kimi-k3" });
    const again = await post(h, "/api/models/refresh");
    assert.equal(again.json.agents.find((a) => a.slug === "sales").pick, "claude-kimi-k3");
    const fewer = await startProvider({ models: OMEGA_MODELS.data.filter((m) => m.id !== "claude-kimi-k3") });
    try {
      h.app.home.urls.provider = fewer.url;
      const r = await post(h, "/api/models/refresh");
      const sales = r.json.agents.find((a) => a.slug === "sales");
      assert.equal(sales.pick, "claude-fable-5-1");
      assert.equal(sales.source, "ranked");
      assert.deepEqual(JSON.parse(readFileSync(h.config.paths.modelsState, "utf8")).overrides, {});
    } finally {
      await fewer.close();
    }
  }, { relay: false });
});

test("switching on is refused with each blocker and works with none; switching off needs nothing", async () => {
  const blockedBy = async (h, want) => {
    const r = await post(h, "/api/models/mode", { mode: "provider" });
    assert.equal(r.status, 409, want);
    assert.equal(r.json.error.code, "cannot_switch_on");
    assert.ok(r.json.error.blockers.includes(want), `${want} in ${r.json.error.blockers}`);
  };
  await withModels(async ({ h, provider }) => {
    await blockedBy(h, "no_key");
    await blockedBy(h, "no_catalogue");
    await blockedBy(h, "pick_missing");
    assert.equal(existsSync(h.config.paths.modelsState), false, "a refused switch writes nothing");
    const key = await ready(h);
    provider.behaviour.key = `${key}-other`;
    const t = await post(h, "/api/models/test");
    assert.equal(t.json.key.state, "refused");
    await blockedBy(h, "key_refused");
    provider.behaviour.key = key;
    assert.equal((await post(h, "/api/models/test")).json.key.state, "ok");
    const on = await post(h, "/api/models/mode", { mode: "provider" });
    assert.equal(on.status, 200);
    assert.equal(on.json.mode, "provider");
    assert.equal(JSON.parse(readFileSync(h.config.paths.modelsState, "utf8")).mode, "provider");
    const off = await post(h, "/api/models/mode", { mode: "plans" });
    assert.equal(off.json.mode, "plans");
    assert.equal((await post(h, "/api/models/mode", { mode: "on" })).json.error.code, "bad_mode");
  });
  await withModels(async ({ h }) => {
    await ready(h);
    await blockedBy(h, "relay_off");
    assert.equal((await post(h, "/api/models/mode", { mode: "plans" })).status, 200, "off works with the relay off");
  }, { relay: false });
  await withModels(async ({ h }) => {
    await post(h, "/api/models/refresh");
    await blockedBy(h, "pick_missing");
    const v = await view(h);
    assert.deepEqual(v.missing, ["checker"]);
  }, { relay: false, models: OMEGA_MODELS.data.filter((m) => !m.id.startsWith("claude-gpt-")) });
});

test("the test reports ok, the plan rows and each picked model's answer through the relay", async () => {
  await withModels(async ({ h, provider, relay }) => {
    const key = await ready(h);
    provider.behaviour.key = key;
    await post(h, "/api/models/pick", { agent: "sales", model: "claude-opus-5-5" });
    const r = await post(h, "/api/models/test");
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("models"), r.json), []);
    const t = r.json.lastTest;
    assert.equal(t.key, "ok");
    assert.equal(r.json.key.state, "ok");
    assert.deepEqual(t.models.map((m) => m.model).sort(), ["claude-fable-5-1", "claude-gpt-6-1-sol", "claude-opus-5-5"]);
    for (const m of t.models) { assert.equal(m.answered, true, m.model); assert.equal(m.reason, null); }
    assert.deepEqual(t.models.find((m) => m.model === "claude-opus-5-5").agents, ["Sales"]);
    assert.deepEqual(t.models.find((m) => m.model === "claude-gpt-6-1-sol").agents, ["Checker"]);
    assert.ok(t.models.find((m) => m.model === "claude-fable-5-1").agents.includes("Builder"));
    assert.ok(t.plan.length > 0 && t.plan.length <= 12);
    assert.ok(t.plan.some((p) => p.label === "plan" && p.value === "Stand-in Pro"));
    assert.ok(!t.plan.some((p) => /token|key|secret|email|id/i.test(p.label)));
    const calls = provider.seen.filter((s) => s.method === "POST");
    assert.equal(calls.length, 3);
    const msg = calls.filter((c) => c.path === "/v1/messages").map((c) => JSON.parse(c.body));
    const resp = calls.filter((c) => c.path === "/v1/responses").map((c) => JSON.parse(c.body));
    assert.equal(msg.length, 2);
    assert.ok(msg.every((b) => b.max_tokens === 16 && b.messages[0].content === "Reply with exactly: OK"));
    assert.deepEqual(resp.map((b) => [b.model, b.max_output_tokens, b.input]), [["claude-gpt-6-1-sol", 16, "Reply with exactly: OK"]]);
    // The owner's test is not an agent's use: the relay counts only agent tokens.
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual((await view(h)).agents.find((a) => a.slug === "sales").usage, { requests: 0, inputTokens: 0, outputTokens: 0 });
    assert.ok(relay);
  });
});

test("the test reports a refused key (401) and a reached limit (429)", async () => {
  await withModels(async ({ h, provider }) => {
    const key = await ready(h);
    provider.behaviour.key = `${key}-other`;
    const r = await post(h, "/api/models/test");
    assert.equal(r.json.lastTest.key, "refused");
    assert.ok(r.json.lastTest.models.every((m) => !m.answered && m.reason === "refused"));
    assert.deepEqual(r.json.lastTest.plan, []);
    assert.ok(r.json.blockers.includes("key_refused"));
    provider.behaviour.key = key;
    provider.behaviour.status = 429;
    provider.behaviour.retryAfter = "30";
    const l = await post(h, "/api/models/test");
    assert.equal(l.json.lastTest.key, "limited");
    assert.equal(l.json.key.state, "limited");
    assert.ok(l.json.lastTest.models.every((m) => !m.answered && m.reason === "limited"));
    assert.ok(!l.json.blockers.includes("key_refused"));
  });
});

test("a model that does not answer is said so: an error answer, an unreachable provider, the relay off", async () => {
  await withModels(async ({ h, provider }) => {
    await ready(h);
    provider.behaviour.status = 500;
    let r = await post(h, "/api/models/test");
    assert.equal(r.json.lastTest.key, "ok", "usage and billing answered");
    assert.ok(r.json.lastTest.models.every((m) => m.answered === false && m.reason === "no_answer"));
    provider.behaviour.status = undefined;
    provider.behaviour.hang = true;
    r = await post(h, "/api/models/test");
    assert.ok(r.json.lastTest.models.every((m) => m.answered === false && m.reason === "unreachable"));
  }, { relayLimits: { firstByteMs: 300 } });
  await withModels(async ({ h }) => {
    await ready(h);
    const r = await post(h, "/api/models/test");
    assert.ok(r.json.lastTest.models.length > 0);
    assert.ok(r.json.lastTest.models.every((m) => m.answered === false && m.reason === "relay_off"));
  }, { relay: false });
  await withModels(async ({ h, provider }) => {
    await ready(h);
    await provider.close();
    const r = await post(h, "/api/models/test");
    assert.equal(r.json.lastTest.key, "unreachable");
    assert.equal(r.json.key.state, "unreachable");
    assert.ok(r.json.lastTest.models.every((m) => m.reason === "unreachable"));
  });
});

test("an answer the relay withholds because it quotes the key is no_answer, and the key is kept nowhere", async () => {
  await withModels(async ({ h, provider }) => {
    const key = await ready(h);
    const texts = [];
    for (const where of ["body200", "body401", "header", "stream", "split"]) {
      provider.behaviour.echoKey = where;
      const r = await post(h, "/api/models/test");
      texts.push(r.text, (await call(h.url, "GET", "/api/models")).text);
      assert.equal(r.status, 200, where);
      assert.ok(r.json.lastTest.models.length > 0);
      for (const m of r.json.lastTest.models) assert.deepEqual([m.answered, m.reason], [false, "no_answer"], `${where} ${m.model}`);
    }
    for (const t of texts) assert.ok(!t.includes(key), "an answer holds the key");
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
    for (const f of walk(h.state)) {
      if (f === h.config.paths.providerKey) continue;
      assert.ok(!readFileSync(f).includes(key), `${f} holds the key`);
    }
  });
});

test("test without a key is refused as no_key", async () => {
  await withModels(async ({ h }) => {
    const r = await post(h, "/api/models/test");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "no_key");
  }, { relay: false });
});

test("the relay's newer answer from the provider changes the key's state in the view", async () => {
  await withModels(async ({ h }) => {
    await ready(h);
    const later = new Date(Date.now() + 60000).toISOString();
    writeFileSync(h.config.paths.relayStatus, JSON.stringify({ startedAt: later, provider: { state: "limited", at: later, retryAfterSec: 30 }, agents: { builder: { requests: 4, inputTokens: 40, outputTokens: 8 } } }), { mode: 0o600 });
    const v = await view(h);
    assert.equal(v.key.state, "limited");
    assert.deepEqual(v.agents.find((a) => a.slug === "builder").usage, { requests: 4, inputTokens: 40, outputTokens: 8 });
    const earlier = new Date(Date.now() - 3600000).toISOString();
    writeFileSync(h.config.paths.relayStatus, JSON.stringify({ provider: { state: "refused", at: earlier } }), { mode: 0o600 });
    assert.equal((await view(h)).key.state, "unknown", "an answer older than the key's save does not count");
  }, { relay: false });
});

test("a broken state.json gives a problem and the next save repairs it in plans mode", async () => {
  await withModels(async ({ h }) => {
    mkdirSync(h.config.paths.models, { recursive: true, mode: 0o700 });
    for (const [content, mode] of [["{not json", 0o600], [JSON.stringify({ mode: "sideways" }), 0o600], [JSON.stringify({ mode: "provider" }), 0o666]]) {
      writeFileSync(h.config.paths.modelsState, content, { mode });
      chmodSync(h.config.paths.modelsState, mode);
      const v = await view(h);
      assert.equal(v.problem, "state_unreadable");
      assert.equal(v.mode, "plans");
      assert.equal(v.canSwitchOn, false);
    }
    const r = await post(h, "/api/models/refresh");
    assert.equal(r.status, 200);
    assert.equal(r.json.problem, null);
    assert.equal(r.json.mode, "plans");
    const saved = JSON.parse(readFileSync(h.config.paths.modelsState, "utf8"));
    assert.equal(saved.mode, "plans");
    assert.equal(statSync(h.config.paths.modelsState).mode & 0o777, 0o600);
  }, { relay: false });
});

test("every POST without the same-origin headers is refused by the core", async () => {
  await withModels(async ({ h }) => {
    for (const path of ["/api/models/key", "/api/models/key/remove", "/api/models/refresh", "/api/models/pick", "/api/models/test", "/api/models/mode"]) {
      const bare = await call(h.url, "POST", path, { bare: true, body: { key: madeUpKey(), mode: "provider" } });
      assert.equal(bare.status, 403, path);
      assert.equal(bare.json.error.code, "not_same_origin");
      const cross = await call(h.url, "POST", path, { body: {}, headers: { origin: "http://evil.example" } });
      assert.equal(cross.status, 403, path);
    }
    assert.equal(existsSync(h.config.paths.providerKey), false);
    assert.equal(existsSync(h.config.paths.modelsState), false);
  }, { relay: false });
});

test("a stub home with the defaults opens no socket but to its own stubs", async () => {
  const listener = net.createServer((s) => { listener.hits += 1; s.destroy(); });
  listener.hits = 0;
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const ports = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    // Node passes either (options | port, ...) or its own normalised [options, callback].
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (o && typeof o === "object" && o.path) ports.push(`pipe ${o.path}`);
    else ports.push(o && typeof o === "object" ? Number(o.port) : Number(o));
    return original.apply(this, args);
  };
  let h = null;
  try {
    h = await startV2({ routes: ["models", "health"], inbox: [], search: [], port: 0 });
    writeSecret(h.config);
    assert.equal(h.app.home.urls.provider, null);
    assert.equal(h.app.home.urls.relay, null);
    const key = madeUpKey();
    assert.equal((await call(h.url, "GET", "/api/models")).json.relay.state, "off");
    assert.equal((await post(h, "/api/models/refresh")).status, 502);
    assert.equal((await post(h, "/api/models/key", { key })).status, 200);
    const t = await post(h, "/api/models/test");
    assert.equal(t.json.lastTest.key, "unreachable");
    assert.ok((await post(h, "/api/models/mode", { mode: "provider" })).json.error.blockers.includes("relay_off"));
    const health = await call(h.url, "GET", "/api/health");
    const relayPart = health.json.parts.find((p) => p.id === "relay");
    assert.equal(relayPart.state, "off");
    assert.match(relayPart.technical, /none in stubs mode/);
    const allowed = new Set([h.port, h.board.port, h.bench.port]);
    const others = ports.filter((p) => !allowed.has(p));
    assert.deepEqual(others, [], "a socket was opened to something other than the stubs");
    assert.ok(!ports.includes(h.config.ports.relay), "the live relay's port was probed");
    assert.equal(listener.hits, 0);
  } finally {
    net.Socket.prototype.connect = original;
    if (h) await h.close();
    await new Promise((r) => listener.close(r));
  }
});
