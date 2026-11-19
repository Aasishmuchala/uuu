// What every part of the route sweep shares (PLAN-STRESS T4): the one call wrapper that counts calls, 5xx answers and
// hangs and looks in every answer for a stack or the planted canary; a raw sender for bodies sent chunked or slowly;
// a small pool; the state folder's digest and its JSON check; and the finding helper. Every address goes through
// lib/http.mjs checkUrl, so nothing here can reach a live port or another machine. Built-in modules only.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { join, relative } from "node:path";
import { call, checkUrl, ownerHeaders } from "../lib/http.mjs";

export const HANG_MS = 10000;
export const METHODS = Object.freeze(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A stack in an answer: Node's "    at fn (/path/file.mjs:12:3)" lines, or its internal module names.
const STACK = /\n\s+at [^\n]*(?:\.m?js|node:)[^\n]*:\d+|\bat (?:async )?[A-Za-z0-9_.<>]+ \((?:file:\/\/)?\/[^)]+:\d+:\d+\)|node:internal\//;
export const hasStack = (text) => STACK.test(String(text || ""));

// The home's error shape (engine/home/server/lib/errors.mjs): { error: { message, next, code } }, all strings.
export function homeErrorShape(json) {
  const e = json && typeof json === "object" ? json.error : null;
  return !!e && typeof e === "object" && typeof e.message === "string" && e.message !== "" && typeof e.next === "string" && typeof e.code === "string";
}

export function percentile(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

// pool(n, items, fn) -> results in order; at most n at once.
export async function pool(n, items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// The sweep's shared counters and the call wrapper.
//   hit(port, method, path, { headers, body, owner, timeoutMs, route }) -> { status, json, text, ms, error, hang, stack, canary }
//   owner (default true for a method that is not GET or HEAD): the home's same-origin headers.
export function makeClient({ canary }) {
  const stats = { calls: 0, fiveXX: 0, hangs: 0, byRoute: new Map() };
  const keep = (route, ms) => {
    if (!route) return;
    const l = stats.byRoute.get(route) || [];
    if (l.length < 5000) l.push(ms);
    stats.byRoute.set(route, l);
  };
  async function hit(port, method, path, { headers = {}, body, owner, timeoutMs = HANG_MS, route = null, raw = false } = {}) {
    const safe = method === "GET" || method === "HEAD";
    const h = (owner ?? !safe) ? { ...ownerHeaders(port), ...headers } : { ...headers };
    stats.calls += 1;
    const started = Date.now();
    try {
      const r = await call(`http://127.0.0.1:${port}${path}`, { method, headers: h, body: raw ? body : body === undefined ? undefined : body, timeoutMs });
      if (r.status >= 500) stats.fiveXX += 1;
      keep(route, r.ms);
      return { ...r, error: null, hang: false, stack: hasStack(r.text), canary: !!canary && r.text.includes(canary) };
    } catch (e) {
      const hang = !!(e && e.hang);
      if (hang) stats.hangs += 1;
      return { status: 0, json: undefined, text: "", headers: {}, ms: Date.now() - started, error: e, hang, stack: false, canary: false };
    }
  }
  return { hit, stats };
}

// One request whose body is sent in chunks: `total` bytes in `size`-byte chunks, `everyMs` apart (0: as fast as the
// socket takes them), with or without a content-length. Stops writing when the answer comes or the socket ends.
//   -> { status, json, text, ms, error, received (an answer arrived), sent (bytes written) }
export function send(url, { method = "POST", headers = {}, total = 0, size = 65536, everyMs = 0, length = true, timeoutMs = 60000, fill = "x" } = {}) {
  const u = checkUrl(url);
  const h = { ...headers };
  // Node sends DELETE and OPTIONS without chunking unless told: say it, or the body would read as a second request.
  if (length) h["content-length"] = String(total);
  else h["transfer-encoding"] = "chunked";
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false;
    let sent = 0;
    let answered = false;
    const chunks = [];
    const out = { status: 0, json: undefined, text: "", ms: 0, error: null, received: false, sent: 0 };
    const finish = (extra = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      Object.assign(out, extra, { ms: Date.now() - started, sent });
      if (out.text) { try { out.json = JSON.parse(out.text); } catch { out.json = undefined; } }
      resolve(out);
    };
    const req = http.request({ host: u.hostname, port: Number(u.port), method, path: `${u.pathname}${u.search}`, headers: h, agent: false }, (res) => {
      answered = true;
      out.status = res.statusCode;
      out.received = true;
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => finish({ text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", (e) => finish({ text: Buffer.concat(chunks).toString("utf8"), error: e }));
      res.on("aborted", () => finish({ text: Buffer.concat(chunks).toString("utf8"), error: new Error("aborted") }));
    });
    const timer = setTimeout(() => { req.destroy(); finish({ error: Object.assign(new Error(`no answer in ${timeoutMs} ms`), { hang: true }) }); }, timeoutMs);
    req.on("error", (e) => { if (!answered) finish({ error: e }); });
    const block = Buffer.alloc(size, fill);
    const pump = () => {
      while (!done && !answered && sent < total) {
        const n = Math.min(size, total - sent);
        sent += n;
        const ok = req.write(n === size ? block : block.subarray(0, n));
        if (everyMs > 0) { setTimeout(pump, everyMs); return; }
        if (!ok) { req.once("drain", pump); return; }
      }
      if (!done && !answered && sent >= total) req.end();
    };
    if (total === 0) req.end();
    else pump();
  });
}

// Every file under the state folder (logs left out): { "<rel>": "<sha1 of the bytes>" }.
export function digest(dir) {
  const out = {};
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const full = join(d, e.name);
      const rel = relative(dir, full);
      if (rel === "logs" || rel.startsWith(`logs/`)) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try { out[rel] = createHash("sha1").update(readFileSync(full)).digest("hex"); } catch { /* gone between the two reads */ }
      }
    }
  };
  walk(dir);
  return out;
}

export function changed(a, b, ignore = new Set()) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k] && !ignore.has(k)).sort();
}

// The state folder's health after a burst or a restart: JSON files that do not parse, and temp files older than
// `tmpAgeMs`. -> { badJson: [rel], oldTmp: [rel], files }
export function stateHealth(dir, { tmpAgeMs = 5000 } = {}) {
  const badJson = [];
  const oldTmp = [];
  let files = 0;
  const now = Date.now();
  const walk = (d) => {
    let names = [];
    try { names = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const full = join(d, e.name);
      const rel = relative(dir, full);
      if (rel === "logs" || rel.startsWith("logs/")) continue;
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      files += 1;
      if (/\.tmp$|\.tmp\.|\.\d+\.tmp/.test(e.name)) {
        try { if (now - statSync(full).mtimeMs > tmpAgeMs) oldTmp.push(rel); } catch { /* gone: fine */ }
        continue;
      }
      if (e.name.endsWith(".json")) {
        try { JSON.parse(readFileSync(full, "utf8")); } catch (err) { if (err && err.code !== "ENOENT") badJson.push(rel); }
      }
    }
  };
  walk(dir);
  return { badJson, oldTmp, files };
}

// The finding helper: area "routes", the sweep's ctx.record underneath; `seen` keeps one record per id per run.
export function makeIssue(ctx) {
  const counted = new Set();
  return function issue(severity, check, target, { title, expected = "", actual = "", files = [], evidence = "" } = {}) {
    const key = `${check}|${target}`;
    if (ctx.only && ctx.onlyTarget && !(ctx.onlyCheck === check && ctx.onlyTarget === target)) {
      // A --only run keeps the one finding it was asked about (and still says what else it saw in the log).
      if (!counted.has(key)) { counted.add(key); ctx.log(`(--only) also seen: ${severity} ${check} ${target}: ${title}`); }
      return null;
    }
    counted.add(key);
    return ctx.record({
      severity, area: "routes", check, target, title: title || `${check} ${target}`,
      expected, actual: String(actual).slice(0, 2000), evidence, suspectFiles: files,
    });
  };
}

export const short = (r) => (r.error ? `${r.hang ? "hang" : "error"}: ${String(r.error.message || r.error).slice(0, 200)}` : `${r.status} ${String(r.text || "").slice(0, 300)}`);
