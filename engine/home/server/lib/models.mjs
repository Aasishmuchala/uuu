// The Models section's state (CONTRACTS-V4 C2, C3, C7, C8): the mode and the picks in
// <state>/models/state.json, the provider key in <state>/secrets/provider/omega-key, the view the
// Settings page reads, and the owner's test through the model relay.
// The key is written here from the owner's typing and read only to send it to the provider or to
// nobody: it is never put in an answer, an error or a log line. Files are read on every use.
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { dirname, join } from "node:path";
import { loadCompanyFile } from "../../../company/lib/company-file.mjs";
import { loadRanking, pickModels } from "../../../company/lib/model-picks.mjs";
import { KEY_RE, MODEL_RE, readKey, readModelState, readSecret, trusted } from "../../../relay/state.mjs";
import { mintToken, SLUG_RE } from "../../../relay/token.mjs";
import { PROVIDER_NAME, PROVIDER_ORIGIN } from "../../../relay/upstream.mjs";
import { httpRequest, parseJson } from "./httpclient.mjs";
import { providerGet, providerOrigin } from "./provider.mjs";

export const MAX_CATALOGUE = 200;
const TEST_TIMEOUT_MS = 30000;
const TEST_MAX_BYTES = 1024 * 1024;
const TEST_TOKEN_SEC = 120;
const KEY_STATES = new Set(["none", "unknown", "ok", "refused", "limited", "unreachable"]);
const PROVIDER_STATES = new Set(["ok", "refused", "limited", "unreachable"]);
const PLAN_ROWS = 12;
const PLAN_HIDDEN = /key|token|secret|email|id/i;
const QUESTION = "Reply with exactly: OK";

const nowIso = () => new Date().toISOString();
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v, max) => (typeof v === "string" && v ? v.slice(0, max) : null);

export function freshState() {
  return {
    version: 1, mode: "plans", picks: {}, overrides: {},
    catalogue: { readAt: null, models: [] },
    key: { savedAt: null, state: "none", checkedAt: null },
    lastTest: null, changedAt: null,
  };
}

// A saved file made safe to use: only well-formed values are kept.
function cleanState(data) {
  const s = freshState();
  s.mode = data.mode === "provider" ? "provider" : "plans";
  if (obj(data.picks)) {
    for (const [slug, p] of Object.entries(data.picks)) {
      if (SLUG_RE.test(slug) && obj(p) && typeof p.model === "string" && MODEL_RE.test(p.model)) {
        s.picks[slug] = { model: p.model, source: p.source === "owner" ? "owner" : "ranked" };
      }
    }
  }
  if (obj(data.overrides)) {
    for (const [slug, id] of Object.entries(data.overrides)) if (SLUG_RE.test(slug) && typeof id === "string" && MODEL_RE.test(id)) s.overrides[slug] = id;
  }
  const c = data.catalogue;
  if (obj(c) && Array.isArray(c.models)) {
    s.catalogue.readAt = text(c.readAt, 40);
    s.catalogue.models = c.models.filter((m) => obj(m) && typeof m.id === "string" && MODEL_RE.test(m.id)).slice(0, MAX_CATALOGUE)
      .map((m) => ({ id: m.id, name: text(m.name, 120) || m.id, owner: text(m.owner, 80), context: num(m.context), maxOutput: num(m.maxOutput) }));
  }
  if (obj(data.key)) {
    s.key = {
      savedAt: text(data.key.savedAt, 40),
      state: KEY_STATES.has(data.key.state) ? data.key.state : "unknown",
      checkedAt: text(data.key.checkedAt, 40),
    };
  }
  s.lastTest = obj(data.lastTest) ? data.lastTest : null;
  s.changedAt = text(data.changedAt, 40);
  return s;
}

// -> { state, problem }. A file that cannot be used gives a fresh state in plans mode and the problem.
export function readState(config) {
  const r = readModelState(config.paths.modelsState);
  if (!r.ok) return { state: freshState(), problem: "state_unreadable" };
  return { state: r.missing ? freshState() : cleanState(r.data), problem: null };
}

// Makes a folder with mode 0700, or sets that mode when it is already there.
function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

// Written whole through a new temp file in the same folder, then renamed over the old one.
function writePrivate(file, content) {
  const tmp = join(dirname(file), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing was left */ }
    throw e;
  }
}

// Before a save: no text that came from the provider may hold the saved key (holdsKey), whichever
// route put it there: catalogue names and owners fall back to the id or null, plan rows are dropped.
function scrubState(config, state) {
  const key = readKey(config.paths.providerKey);
  if (key === null) return;
  state.catalogue.models = state.catalogue.models.filter((m) => !holdsKey(m.id, key)).map((m) => ({
    ...m, name: holdsKey(m.name, key) ? m.id : m.name, owner: holdsKey(m.owner, key) ? null : m.owner,
  }));
  if (state.lastTest && Array.isArray(state.lastTest.plan)) {
    state.lastTest.plan = state.lastTest.plan.filter((r) => !obj(r) || (!holdsKey(r.label, key) && !holdsKey(r.value, key)));
  }
}

export function writeState(config, state) {
  scrubState(config, state);
  ownFolder(config.paths.models);
  state.changedAt = nowIso();
  writePrivate(config.paths.modelsState, `${JSON.stringify(state, null, 2)}\n`);
}

// Reads the state (fresh when it cannot be used: the next save repairs it), applies fn, writes it.
export function updateState(config, fn) {
  const { state } = readState(config);
  fn(state);
  writeState(config, state);
  return state;
}

// ---- the key ----------------------------------------------------------------

export function keySaved(config) {
  return trusted(config.paths.providerKey);
}

export function saveKey(config, key) {
  const secrets = dirname(config.paths.providerSecrets);
  try { lstatSync(secrets); } catch { ownFolder(secrets); }
  ownFolder(config.paths.providerSecrets);
  writePrivate(config.paths.providerKey, `${key}\n`);
}

export function removeKey(config) {
  try { unlinkSync(config.paths.providerKey); } catch (e) { if (e.code !== "ENOENT") throw e; }
}

export function validKey(raw) {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  return KEY_RE.test(k) ? k : null;
}

// ---- the company and the picks -------------------------------------------------

// -> { agents: [{ slug, name, tool, needs, model }], problem }
export function readAgents(config) {
  try {
    const file = loadCompanyFile(join(config.engineDir, "company", "company.json"), config);
    return { agents: file.agents.map((a) => ({ slug: a.slug, name: a.name, tool: a.tool, needs: a.needs ?? null, model: a.model ?? null })), problem: null };
  } catch {
    return { agents: [], problem: "company_unreadable" };
  }
}

function ranking(config) {
  return loadRanking(join(config.engineDir, "company", "models.json"));
}

// Overrides whose id left the list are dropped; the picks are computed again (C7).
export function recompute(config, state, agents) {
  const ids = state.catalogue.models.map((m) => m.id);
  const have = new Set(ids);
  for (const slug of Object.keys(state.overrides)) if (!have.has(state.overrides[slug])) delete state.overrides[slug];
  const r = pickModels({ ranking: ranking(config), agents, catalogue: ids, overrides: state.overrides });
  state.picks = r.picks;
  return r;
}

// Whether a text from the provider holds the key, or its first or last 12 characters when the key
// is at least 24 long. Such a text is never kept or shown, even if the provider quotes the key.
export function holdsKey(value, key) {
  if (typeof key !== "string" || !key || value === null || value === undefined) return false;
  const t = String(value);
  if (t.includes(key)) return true;
  return key.length >= 24 && (t.includes(key.slice(0, 12)) || t.includes(key.slice(-12)));
}

// The keyless read of the list: entries kept as C8 says. -> [model] ; throws { unreachable: true }.
// `key` (the saved key, or null) is used only to drop any text that holds it.
export async function readCatalogue(urls, key = null) {
  const r = await providerGet(providerOrigin(urls), "/v1/models");
  const list = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : null;
  if (r.status !== 200 || !list) throw Object.assign(new Error("the provider's list could not be read"), { unreachable: true });
  const out = [];
  const seen = new Set();
  for (const m of list) {
    if (out.length >= MAX_CATALOGUE) break;
    if (!obj(m) || typeof m.id !== "string" || !MODEL_RE.test(m.id) || seen.has(m.id) || holdsKey(m.id, key)) continue;
    seen.add(m.id);
    const safe = (v) => (holdsKey(v, key) ? null : v);
    out.push({
      id: m.id, name: text(safe(m.display_name), 120) || m.id, owner: text(safe(m.owned_by), 80),
      context: num(m.context_window), maxOutput: num(m.max_output_tokens),
    });
  }
  return out;
}

// ---- the relay -------------------------------------------------------------------

export async function relayProbe(urls) {
  if (!urls.relay) return { state: "off" };
  try {
    const r = await httpRequest(`${urls.relay}/relay/health`, { timeoutMs: 2000, headers: { accept: "application/json" } });
    return r.status === 200 && parseJson(r.text)?.part === "relay" ? { state: "on" } : { state: "unhealthy" };
  } catch {
    return { state: "off" };
  }
}

const RELAY_SENTENCES = {
  on: "The model relay is on.",
  off: "The model relay is off. Run: engine start",
  unhealthy: "The model relay is running but not answering. Run: engine stop, then engine start.",
};

// relay-status.json, written by the relay alone: { provider, agents } or null.
function readRelayStatus(config) {
  const file = config.paths.relayStatus;
  if (!trusted(file)) return null;
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    return obj(d) ? d : null;
  } catch {
    return null;
  }
}

function usageOf(status, slug) {
  const a = obj(status?.agents) && Object.hasOwn(status.agents, slug) && obj(status.agents[slug]) ? status.agents[slug] : {};
  return { requests: num(a.requests) ?? 0, inputTokens: num(a.inputTokens) ?? 0, outputTokens: num(a.outputTokens) ?? 0 };
}

// The key's state: the newer of the last test (or the save) and the relay's last answer from the provider.
function keyState(state, saved, status) {
  if (!saved) return "none";
  let k = state.key.state === "none" ? "unknown" : state.key.state;
  const since = Math.max(Date.parse(state.key.checkedAt || "") || 0, Date.parse(state.key.savedAt || "") || 0);
  const p = obj(status?.provider) ? status.provider : null;
  if (p && PROVIDER_STATES.has(p.state) && (Date.parse(p.at || "") || 0) > since) k = p.state;
  return k;
}

// ---- the view ----------------------------------------------------------------------

export async function buildView(ctx) {
  const config = ctx.config;
  const urls = ctx.home.urls;
  const { state, problem: stateProblem } = readState(config);
  scrubState(config, state); // in memory only: a file saved before the key was never shown with it
  const { agents, problem: companyProblem } = readAgents(config);
  const relay = await relayProbe(urls);
  const status = readRelayStatus(config);
  const saved = keySaved(config);
  const ids = state.catalogue.models.map((m) => m.id);
  const nameOf = new Map(state.catalogue.models.map((m) => [m.id, m.name]));
  let computed = { options: {} };
  let rankingProblem = null;
  try {
    computed = pickModels({ ranking: ranking(config), agents, catalogue: ids, overrides: state.overrides });
  } catch {
    rankingProblem = "ranking_unreadable";
  }
  const missing = agents.filter((a) => !state.picks[a.slug]).map((a) => a.slug);
  const key = keyState(state, saved, status);

  const blockers = [];
  if (!saved) blockers.push("no_key");
  if (key === "refused") blockers.push("key_refused");
  if (relay.state !== "on") blockers.push("relay_off");
  if (!ids.length) blockers.push("no_catalogue");
  if (missing.length) blockers.push("pick_missing");

  const host = new URL(PROVIDER_ORIGIN).host;
  return {
    provider: { name: PROVIDER_NAME, host },
    mode: state.mode,
    key: { saved, savedAt: saved ? state.key.savedAt : null, state: key },
    relay: { state: relay.state, sentence: RELAY_SENTENCES[relay.state] },
    catalogue: { readAt: state.catalogue.readAt, count: ids.length },
    agents: agents.map((a) => {
      const p = state.picks[a.slug] || null;
      return {
        slug: a.slug, name: a.name, program: a.tool, needs: a.needs, plansModel: a.model,
        pick: p ? p.model : null, pickName: p ? nameOf.get(p.model) || p.model : null, source: p ? p.source : null,
        options: (computed.options[a.slug] || []).map((o) => ({ id: o.id, name: nameOf.get(o.id) || o.id, ranked: o.ranked })),
        usage: usageOf(status, a.slug),
      };
    }),
    missing, canSwitchOn: blockers.length === 0, blockers,
    lastTest: state.lastTest, problem: stateProblem || companyProblem || rankingProblem,
  };
}

// ---- the test -------------------------------------------------------------------------

// The provider's own answer as at most 12 rows of plain values; nothing is guessed about a field.
// A row whose name or value holds the key (holdsKey) is dropped.
export function planRows(answers, key = null) {
  const rows = [];
  const walk = (v, label, depth) => {
    if (rows.length >= PLAN_ROWS * 2 || depth > 3) return;
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
      if (holdsKey(label, key) || holdsKey(v, key)) return;
      rows.push({ label: label.slice(0, 80), value: String(v).slice(0, 120) });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${label} ${i + 1}`, depth + 1)); return; }
    if (!obj(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (PLAN_HIDDEN.test(k) || holdsKey(k, key)) continue;
      walk(x, label ? `${label} ${k.replace(/_/g, " ")}` : k.replace(/_/g, " "), depth + 1);
    }
  };
  for (const a of answers) if (obj(a)) walk(a, "", 0);
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.label}\n${r.value}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, PLAN_ROWS);
}

// What a provider status says about the key; null when it says nothing.
function signalOf(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "refused";
  if (status === 429) return "limited";
  return null;
}

function answerText(json) {
  if (!obj(json)) return "";
  if (Array.isArray(json.content)) return json.content.map((c) => (obj(c) && typeof c.text === "string" ? c.text : "")).join("");
  if (typeof json.output_text === "string") return json.output_text;
  if (Array.isArray(json.output)) {
    return json.output.flatMap((o) => (obj(o) && Array.isArray(o.content) ? o.content : []))
      .map((c) => (obj(c) && typeof c.text === "string" ? c.text : "")).join("");
  }
  return "";
}

// One POST to the relay, bounded from start to finish: at most `limitMs` and `maxBytes` of answer.
// Past either the call is destroyed and the answer dropped. -> { status, text } or { failed } where
// failed is "no_connection" (the relay could not be reached), "nothing" (no answer began in time) or
// "cut" (an answer began but was too slow or too large).
export function boundedPost(url, { headers, body, limitMs = TEST_TIMEOUT_MS, maxBytes = TEST_MAX_BYTES }) {
  return new Promise((resolve) => {
    const u = new URL(url);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname)) return resolve({ failed: "no_connection" });
    const data = Buffer.from(JSON.stringify(body));
    let done = false;
    let began = false;
    let chunks = [];
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); chunks = []; resolve(v); } };
    const req = http.request({
      host: u.hostname, port: u.port || 80, path: u.pathname, method: "POST", agent: false,
      headers: { ...headers, "content-length": data.length },
    }, (res) => {
      began = true;
      let size = 0;
      res.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > maxBytes) { finish({ failed: "cut" }); req.destroy(); return; }
        chunks.push(c);
      });
      res.on("end", () => finish({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", () => finish({ failed: "cut" }));
    });
    const timer = setTimeout(() => { finish({ failed: began ? "cut" : "nothing" }); req.destroy(); }, limitMs);
    req.on("error", () => finish({ failed: began ? "cut" : "no_connection" }));
    req.end(data);
  });
}

// One question to one model through the relay with a short-lived test token for `slug`.
// -> { answered, reason, signal }
async function askThroughRelay(relayUrl, secret, slug, program, model, limits) {
  if (!relayUrl || !secret) return { answered: false, reason: "relay_off", signal: null };
  const token = mintToken(secret, "t", slug, Math.floor(Date.now() / 1000) + TEST_TOKEN_SEC);
  const messages = program !== "codex";
  const path = messages ? "/v1/messages" : "/v1/responses";
  const body = messages
    ? { model, max_tokens: 16, messages: [{ role: "user", content: QUESTION }] }
    : { model, input: QUESTION, max_output_tokens: 16 };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  if (messages) headers["anthropic-version"] = "2023-06-01";
  const r = await boundedPost(`${relayUrl}${path}`, { headers, body, ...(limits || {}) });
  if (r.failed === "no_connection") return { answered: false, reason: "relay_off", signal: null };
  if (r.failed === "nothing") return { answered: false, reason: "unreachable", signal: "unreachable" };
  if (r.failed) return { answered: false, reason: "no_answer", signal: null };
  const json = parseJson(r.text);
  const relayCode = obj(json) && typeof json.code === "string" && json.code.startsWith("relay_") ? json.code : null;
  if (relayCode === "relay_upstream_down") return { answered: false, reason: "unreachable", signal: "unreachable" };
  // The relay withheld the provider's answer because it held the key: the model did not answer, and
  // nothing of that answer is kept (only the reason is).
  if (relayCode === "relay_key_in_answer") return { answered: false, reason: "no_answer", signal: null };
  if (relayCode) return { answered: false, reason: "relay_off", signal: null };
  const signal = signalOf(r.status);
  if (signal === "ok") return answerText(json).trim() ? { answered: true, reason: null, signal } : { answered: false, reason: "no_answer", signal };
  if (signal) return { answered: false, reason: signal, signal };
  return { answered: false, reason: "no_answer", signal: null };
}

// Reads usage and billing with the key, then asks each distinct picked model through the relay, all at
// once. -> lastTest, or null when no usable key is saved. The key is passed to the provider client and nowhere else.
// `limits` ({ limitMs, maxBytes } for each model's question) is for tests; the defaults are C8's.
export async function runTest(ctx, limits) {
  const config = ctx.config;
  const urls = ctx.home.urls;
  const key = readKey(config.paths.providerKey);
  if (key === null) return null;
  const { state } = readState(config);
  const { agents } = readAgents(config);
  const nameOf = new Map(state.catalogue.models.map((m) => [m.id, m.name]));
  const byModel = new Map();
  for (const a of agents) {
    const p = state.picks[a.slug];
    if (!p) continue;
    if (!byModel.has(p.model)) byModel.set(p.model, { slug: a.slug, program: a.tool, names: [] });
    byModel.get(p.model).names.push(a.name);
  }
  const secret = readSecret(config.paths.relaySecret);
  const origin = providerOrigin(urls);
  const read = (path) => providerGet(origin, path, { key }).then(
    (r) => ({ signal: signalOf(r.status), json: r.status === 200 ? r.json : undefined }),
    () => ({ signal: "unreachable", json: undefined }));
  const models = [...byModel.entries()];
  const [usage, billing, ...asked] = await Promise.all([
    read("/v1/usage"), read("/v1/billing"),
    ...models.map(([model, m]) => askThroughRelay(urls.relay, secret, m.slug, m.program, model, limits)),
  ]);

  const signals = [usage.signal, billing.signal, ...asked.map((a) => a.signal)];
  let keyResult = "unreachable";
  if (signals.includes("refused")) keyResult = "refused";
  else if (signals.includes("limited")) keyResult = "limited";
  else if (signals.includes("ok")) keyResult = "ok";
  return {
    at: nowIso(),
    key: keyResult,
    plan: planRows([usage.json, billing.json], key),
    models: models.map(([model, m], i) => ({
      model, name: nameOf.get(model) || model, agents: m.names, answered: asked[i].answered, reason: asked[i].reason,
    })),
  };
}
