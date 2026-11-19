// What the doors and agents sweeps share (PLAN-STRESS T5): the staged secrets and ids, tokens minted as the doors'
// own tests mint them (engine/relay/token.mjs), the doors' switches and model files written the way the home server
// writes them (0600, plain files), a pool that keeps N calls in flight, and the evidence files. Built-in modules only.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { call, checkUrl } from "../lib/http.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const exp = (sec = 3600) => Math.floor(Date.now() / 1000) + sec;

// A file of the state folder as the home server writes it: a plain file of ours, 0600, by temp file and rename.
export function put(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.stress.tmp`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2));
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

export function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export const readText = (path) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };

// The staged secret of a door or the relay (64 hex characters); null when the part has not made it yet.
export function secretOf(stage, which) {
  const files = {
    relay: join(stage.state, "secrets", "provider", "relay-secret"),
    web: join(stage.state, "secrets", "doors", "web-secret"),
    generate: join(stage.state, "secrets", "doors", "generate-secret"),
    viewer: join(stage.state, "secrets", "doors", "viewer-secret"),
    brain: join(stage.state, "secrets", "doors", "brain-secret"),
  };
  const t = readText(files[which]).trim();
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}

export const idsOf = (stage) => readJson(join(stage.state, "ids.json"), { agents: {} });

// Agents the stage's seed lacks but a door's list names: added to ids.json with made-up ids, as `engine setup` would.
export function addAgents(stage, slugs) {
  const file = join(stage.state, "ids.json");
  const ids = readJson(file, { agents: {} });
  let n = 0x500;
  for (const s of slugs) {
    if (!ids.agents[s]) {
      n += 1;
      ids.agents[s] = `a0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
    }
  }
  put(file, ids);
  return ids;
}

// Tokens: an agent's (kind a, its id), the owner's test (kind t, "owner"), an app's (kind t, "app-<name>").
export const agentToken = (secret, id, sec) => mintToken(secret, "a", id, exp(sec));
export const ownerToken = (secret) => mintToken(secret, "t", "owner", exp());
export const appToken = (secret, name) => mintToken(secret, "t", `app-${name}`, exp());
export const bearer = (token) => ({ authorization: `Bearer ${token}` });

// The switches file (engine/doors/common.mjs readDoorsState): every block given whole; the rest at its default.
export function setDoors(stage, blocks) {
  put(join(stage.state, "doors", "state.json"), { version: 1, ...blocks, changedAt: new Date().toISOString() });
}

// The models file (engine/relay/state.mjs readModelState): provider mode with a pick for each slug.
export function setModels(stage, slugs, model = "stress-model") {
  const picks = Object.fromEntries(slugs.map((s) => [s, { model }]));
  put(join(stage.state, "models", "state.json"), { mode: "provider", picks });
}

// Runs `fn(i)` for i in 0..n-1, at most `atOnce` at a time; resolves to the results in order. Never rejects: a
// rejection is kept as { error }.
export async function pool(n, atOnce, fn) {
  const out = new Array(n);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= n) return;
      try { out[i] = await fn(i); } catch (e) { out[i] = { error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(atOnce, n) }, worker));
  return out;
}

// call() that never throws: { status, json, text, ms } or { status: 0, error, code, hang }.
export async function tryCall(url, opts) {
  try {
    return await call(url, opts);
  } catch (e) {
    return { status: 0, error: e && e.message, code: e && e.code, hang: !!(e && e.hang), json: undefined, text: "" };
  }
}

// One request with its target sent exactly as written (no URL parsing: the gate's vectors are spellings), to a
// staged port only (checkUrl refuses a live port or another host before anything is sent). `declare` sends that
// Content-Length with no body at all, for a size limit. Never throws: { status, json, text, ms } or { status: 0, code }.
export function rawCall(port, method, target, { headers = {}, body, timeoutMs = 15000, declare } = {}) {
  checkUrl(`http://127.0.0.1:${port}/`);
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false;
    let req;
    let timer = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (declare !== undefined && req) req.destroy();
      resolve({ ms: Date.now() - started, ...v });
    };
    const payload = body === undefined || body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const h = { ...headers };
    if (declare !== undefined) h["content-length"] = String(declare);
    else if (payload) h["content-length"] = String(payload.length);
    try {
      req = http.request({ host: "127.0.0.1", port, method, path: target, headers: h, agent: false }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          finish({ status: res.statusCode, headers: res.headers, text, json });
        });
        res.on("error", (e) => finish({ status: 0, code: e.code || "error" }));
        res.on("aborted", () => finish({ status: 0, code: "ECONNRESET" }));
      });
    } catch (e) {
      return finish({ status: 0, code: e.code || "bad_request", error: e.message });
    }
    timer = setTimeout(() => { req.destroy(); finish({ status: 0, code: "ETIMEDOUT", hang: true }); }, timeoutMs);
    req.on("error", (e) => finish({ status: 0, code: e.code || "error" }));
    if (payload && declare === undefined) req.write(payload);
    if (declare === undefined) req.end();
    else req.flushHeaders();
  });
}

// Counts of a list of answers by status (and the refusal code when there is one).
export function tally(list) {
  const out = {};
  for (const r of list) {
    const key = r && r.status ? `${r.status}${r.json && r.json.code ? ` ${r.json.code}` : ""}` : `error ${r && (r.code || r.error)}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

export function writeEvidence(ctx, sweep, name, data) {
  const dir = join(ctx.passDir, sweep);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

// A line for OUT/pass-<n>/not-covered.txt (T3 and the checklist read it). Each line once.
export function notCovered(ctx, line) {
  const file = join(ctx.passDir, "not-covered.txt");
  const now = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  if (now.includes(line)) return;
  mkdirSync(ctx.passDir, { recursive: true });
  writeFileSync(file, `${[...now.filter(Boolean), line].join("\n")}\n`);
}

// A part's resident memory in KB, read with one `ps` (never blocks the loop; stage.sample() runs lsof on every part).
export function rssOf(stage, part) {
  const e = stage.pids[part];
  if (!e || !e.pid) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-o", "rss=", "-p", String(e.pid)], { encoding: "utf8" }, (err, out) => resolve(err ? null : Number(String(out).trim()) || null));
  });
}

// The area of a finding id (S-<area>-<hash>), for --only.
export function areaOfId(id) {
  const m = /^S-([a-z][a-z0-9-]{0,31})-[0-9a-f]{8}$/.exec(String(id || ""));
  return m ? m[1] : null;
}

// Every line of a part's log and the state's status files, for the key and token checks.
export function grepFiles(files, needles) {
  const hits = [];
  for (const f of files) {
    const text = readText(f);
    for (const n of needles) if (n && text.includes(n)) hits.push({ file: f, needle: n.slice(0, 12) });
  }
  return hits;
}
