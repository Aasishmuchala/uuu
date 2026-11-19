// The second wall against an outside call (PLAN-STRESS, Decisions): every staged Node process is started with
// `--import <copy>/stress/lib/netguard.mjs`. It patches net.Socket.prototype.connect and dns.lookup (callback and
// promise forms) before the part's own code runs. Only 127.0.0.1, ::1, localhost and unix sockets are let through,
// and never a live port (3100-3299, 5000, 5432, 7000, 8120). A refusal appends one JSON line
// { at, pid, part, host, port, stack } to <stage root>/outside-calls.jsonl and throws
// Error("stage: outside call refused: <host>:<port>"). The part's name is env STRESS_PART, the stage root env
// STRESS_STAGE_ROOT. Built-in modules only.
import dns from "node:dns";
import { appendFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

export const LOOPBACK = Object.freeze(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

// A live port: the engine's (3100-3299, its apps 3171-3189 among them), the board's database (5432), the books' web
// page (8120), and two ports other programs on this Mac listen on (5000, 7000).
export function forbiddenPort(port) {
  const p = Number(port);
  return (p >= 3100 && p <= 3299) || p === 5000 || p === 5432 || p === 7000 || p === 8120;
}

export function hostAllowed(host) {
  if (host === undefined || host === null || host === "") return true; // Node's own default is localhost
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK.includes(h);
}

const STAGE_ROOT = process.env.STRESS_STAGE_ROOT || "";
const PART = process.env.STRESS_PART || "unknown";

function refuse(host, port) {
  const err = new Error(`stage: outside call refused: ${host}:${port}`);
  err.code = "ESTAGEREFUSED";
  if (STAGE_ROOT) {
    const line = { at: new Date().toISOString(), pid: process.pid, part: PART, host: String(host), port: port === undefined ? null : port, stack: String(err.stack || "").split("\n").slice(1, 8).map((s) => s.trim()) };
    try { appendFileSync(join(STAGE_ROOT, "outside-calls.jsonl"), `${JSON.stringify(line)}\n`, { mode: 0o600 }); } catch { /* the throw still stands */ }
  }
  throw err;
}

// The arguments of Socket.prototype.connect in each of its forms -> { path } or { host, port }.
function targetOf(args) {
  let a = args;
  // net.connect() passes its normalized arguments as one array: [options, callback].
  if (Array.isArray(a[0])) a = a[0];
  const first = a[0];
  if (first !== null && typeof first === "object") {
    if (typeof first.path === "string" && first.path) return { path: first.path };
    return { host: first.host === undefined ? "localhost" : first.host, port: first.port };
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return { path: first };
  return { host: typeof a[1] === "string" ? a[1] : "localhost", port: first };
}

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const t = targetOf(args);
  if (!t.path) {
    if (!hostAllowed(t.host) || forbiddenPort(t.port)) refuse(t.host, t.port);
  }
  return realConnect.apply(this, args);
};

const realLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  if (!hostAllowed(hostname)) refuse(hostname, undefined);
  return realLookup.call(this, hostname, ...rest);
};
const realPromisesLookup = dns.promises.lookup;
dns.promises.lookup = function guardedPromisesLookup(hostname, ...rest) {
  if (!hostAllowed(hostname)) {
    try { refuse(hostname, undefined); } catch (e) { return Promise.reject(e); }
  }
  return realPromisesLookup.call(this, hostname, ...rest);
};

// For the self-checks: the guard is in place in this process.
globalThis.__stressNetguard = true;
