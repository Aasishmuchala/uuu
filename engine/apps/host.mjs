// The App Studio host (PLAN-V5 K17, K19): App Studio's only unfenced code. It runs as the owner
// and trusts nothing an app sends or makes (docs/adr/0007). Every 2 seconds it reads the apps'
// folders (manifest.mjs) and the owner's switches (`<state>/apps/state.json`, trust rule) and
// makes the running apps match: an app runs only when its manifest is good, its READY exists and
// the owner switched it on. For each running app it holds three things:
//   - the app itself: `app-exec <slug> --run` (the app fence, K18), in its own process group,
//     its output kept in `<state>/logs/apps/<slug>.log` (cut to `.1` at 5 MB);
//   - its engine socket `<run>/engine.sock` (K19): the app's only way to the generation door
//     and the model relay. The app is known by the socket it can reach, so it holds no secret:
//     the host adds a fresh token of kind `t`, subject `app-<slug>`, 120 seconds, per call;
//   - its browser listener on 127.0.0.1:<the manifest's port>: the owner's browser reaches the
//     app here, through K17's checks, with the host's content policy on every answer.
// The app's own socket. The app makes `<run>/app.sock`, in a folder it may write, so it could
// put a link to any unix socket on this Mac there and have the host follow it. So the host never
// connects through that name: as soon as it appears it is moved (rename never follows a link)
// into `<state>/run/apps/.host/<slug>`, a folder no app can reach, and checked there (a socket,
// not a link, ours, one name). The fence keeps the app from moving or replacing its run folder
// itself and from linking in another socket (both proved by the tests). Every connection then
// goes to the moved name, which the app can no longer change.
// Log lines hold the time, the app, a route's name and a status; never a header, a body, a
// query string or a token.
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync,
  renameSync, writeSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { headerValues, readBody, statusFile, wantsUpgrade } from "../doors/common.mjs";
import { describeError } from "../relay/relay.mjs";
import { readSecret } from "../relay/state.mjs";
import { mintToken } from "../relay/token.mjs";
import { SLUG_RE, SOCKET_PATH_MAX, TOO_LONG, appPaths, readManifests, realOrGiven } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MB = 1024 * 1024;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const HOST_LIMITS = Object.freeze({
  everyMs: 2_000,             // the loop: manifests and switches read again
  healthMs: 30_000,           // from the start to a 200 on /healthz
  healthTryMs: 2_000,         // one /healthz question
  restartMs: 5_000,           // after an exit, before the app is started again
  exitsToFail: 3,             // exits within exitWindowMs that make it `failed`
  exitWindowMs: 10 * 60_000,
  stopGraceMs: 10_000,        // SIGTERM to SIGKILL
  headersMs: 10_000,          // a browser's request headers
  requestMs: 300_000,         // a browser's whole request, body included
  bodyBytes: 40 * MB,         // a browser's request body
  browserAtOnce: 64,          // requests at once per app, browser side
  browserConnections: 256,
  appIdleMs: 15 * 60_000,     // without a byte from the app on one request
  engineAtOnce: 16,           // engine-socket requests at once per app
  relayAtOnce: 4,             // of those, to the relay
  relayPerHour: 60,
  relayPerDay: 300,
  relayBytes: 32 * MB,
  genJsonBytes: 64 * 1024,    // estimate and jobs (the door takes 8 KB)
  genInputBytes: 4 * MB,      // one picture (the door takes 3.3 MB)
  tokenSec: 120,
  generateIdleMs: 180_000,    // without a byte from the door
  relayIdleMs: 330_000,       // without a byte from the relay (its own limit is 300 s)
  logBytes: 5 * MB,
});

export const STATES = Object.freeze(["off", "starting", "on", "failed", "not_installed", "damaged"]);

// The engine socket's own refusals (K19): 403 JSON { error: { message }, code }, but
// app_not_found, which is 404.
export const ENGINE_CODES = Object.freeze({
  app_not_found: [404, "The engine has no such address for this app."],
  app_refused: [403, "The engine does not take this kind of request from an app."],
  app_too_big: [403, "This request is too big for the engine."],
  app_busy: [403, "This app is asking the engine too much at once. Wait for an answer first."],
  app_limited: [403, "This app has asked to think too often today."],
  app_engine_off: [403, "The engine part this app needs is off."],
  app_no_answer: [403, "The engine part this app needs did not answer."],
});

// The browser side's own refusals (K17), as plain text.
export const BROWSER_CODES = Object.freeze({
  upgrade: [403, "This app does not take this kind of request."],
  wrong_host: [421, "This address is not this app. Open it from App Studio."],
  cross_site: [403, "This request did not come from the app itself, so it was refused."],
  bad_origin: [403, "This request did not come from the app itself, so it was refused."],
  bad_target: [400, "This app could not read this address."],
  too_big: [413, "This is too big to send to the app (40 MB at most)."],
  busy: [503, "The app is answering too many requests at once. Try again in a moment."],
});

// K19's routes, each named for the log. A job id is passed only in the door's own shape.
const JOB = "[A-Za-z0-9_-]{1,80}";
export const ENGINE_ROUTES = Object.freeze([
  { target: "generate", name: "models", method: "GET", re: /^\/gen\/app\/models$/ },
  { target: "generate", name: "estimate", method: "POST", re: /^\/gen\/app\/estimate$/, max: "genJsonBytes" },
  { target: "generate", name: "inputs", method: "POST", re: /^\/gen\/app\/inputs$/, max: "genInputBytes" },
  { target: "generate", name: "jobs", method: "POST", re: /^\/gen\/app\/jobs$/, max: "genJsonBytes" },
  { target: "generate", name: "job", method: "GET", re: new RegExp(`^/gen/app/jobs/${JOB}$`) },
  { target: "generate", name: "output", method: "GET", re: new RegExp(`^/gen/app/jobs/${JOB}/output$`) },
  { target: "generate", name: "allowance", method: "GET", re: /^\/gen\/app\/allowance$/ },
  { target: "relay", name: "messages", method: "POST", re: /^\/v1\/messages$/, max: "relayBytes", json: true, limited: true },
].map((r) => Object.freeze(r)));

// The route for a raw request target, or null. Nothing is decoded: a query string, a second
// slash or an escape is simply not one of these paths.
export function engineRoute(method, target, engine) {
  if (typeof target !== "string" || !Array.isArray(engine)) return null;
  const route = ENGINE_ROUTES.find((r) => r.re.test(target));
  if (!route || route.method !== method || !engine.includes(route.target)) return null;
  return route;
}

export function contentPolicy(homePort) {
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    + "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; "
    + `base-uri 'self'; form-action 'self'; frame-ancestors http://127.0.0.1:${homePort} http://localhost:${homePort}`;
}

// Set over whatever the app sent, on every answer of the browser side.
export function securityHeaders(homePort) {
  return {
    "Content-Security-Policy": contentPolicy(homePort),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}
const OURS = new Set(Object.keys(securityHeaders(0)).map((k) => k.toLowerCase()));

// Hop-by-hop headers (RFC 9110 7.6.1, and the old proxy ones): never passed either way, and
// neither is any header a Connection header names.
const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade",
  "proxy-authenticate", "proxy-authorization"]);
function connectionNamed(rawHeaders) {
  const named = new Set();
  for (const v of headerValues(rawHeaders, "connection")) {
    for (const n of String(v).split(",")) if (n.trim()) named.add(n.trim().toLowerCase());
  }
  return named;
}

// The headers that go in to the app: as the browser sent them, without Cookie, Authorization,
// any Proxy-* header, hop-by-hop headers, Expect (the host answers it), and Content-Length
// (put back by the caller only when the request had exactly one that is a number).
export function inboundHeaders(rawHeaders) {
  const named = connectionNamed(rawHeaders);
  const out = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const n = String(rawHeaders[i]).toLowerCase();
    if (HOP.has(n) || named.has(n) || n.startsWith("proxy-") || n === "cookie" || n === "authorization"
      || n === "expect" || n === "content-length") continue;
    out.push(rawHeaders[i], rawHeaders[i + 1]);
  }
  return out;
}

// The headers that go out to the browser: the app's, without hop-by-hop headers, Set-Cookie and
// the five the host sets, then the host's five.
export function outboundHeaders(rawHeaders, homePort) {
  const named = connectionNamed(rawHeaders);
  const out = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const n = String(rawHeaders[i]).toLowerCase();
    if (HOP.has(n) || named.has(n) || n === "set-cookie" || OURS.has(n)) continue;
    out.push(rawHeaders[i], rawHeaders[i + 1]);
  }
  for (const [k, v] of Object.entries(securityHeaders(homePort))) out.push(k, v);
  return out;
}

const SAFE = new Set(["GET", "HEAD"]);

// K17's checks of one browser request, in its order: an Upgrade or CONNECT; the Host; the
// Sec-Fetch-Site; the Origin of anything but GET and HEAD; a declared body over the limit.
// An Origin, when one is sent on any method, must be this app's own too (a cross-origin read
// always sends one). A request with no Sec-Fetch-Site (not a browser, or a very old one) is
// judged by the other rules alone, as the home screen does. → null, or a BROWSER_CODES name.
export function browserRefusal(req, port, bodyBytes = HOST_LIMITS.bodyBytes) {
  const raw = req.rawHeaders || [];
  const method = req.method;
  if (method === "CONNECT" || wantsUpgrade(raw)) return "upgrade";
  const hosts = headerValues(raw, "host");
  if (hosts.length !== 1 || (hosts[0] !== `127.0.0.1:${port}` && hosts[0] !== `localhost:${port}`)) return "wrong_host";
  const sites = headerValues(raw, "sec-fetch-site");
  if (sites.length > 1) return "cross_site";
  if (sites.length === 1 && sites[0] !== "same-origin" && sites[0] !== "none") {
    const modes = headerValues(raw, "sec-fetch-mode");
    const dests = headerValues(raw, "sec-fetch-dest");
    const opening = sites[0] === "same-site" && SAFE.has(method) && modes.length === 1 && modes[0] === "navigate"
      && dests.length === 1 && (dests[0] === "iframe" || dests[0] === "document");
    if (!opening) return "cross_site";
  }
  const origins = headerValues(raw, "origin");
  const own = `http://${hosts[0]}`;
  if (origins.length > 1 || (origins.length === 1 && origins[0] !== own)) return "bad_origin";
  if (!SAFE.has(method) && origins.length !== 1) return "bad_origin";
  if (typeof req.url !== "string" || !req.url.startsWith("/")) return "bad_target";
  const lengths = headerValues(raw, "content-length");
  if (lengths.length > 1) return "bad_target";
  if (lengths.length === 1 && !(Number(lengths[0]) <= bodyBytes)) return "too_big";
  return null;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

// The page for an app that does not answer: no script, the host's headers.
export function notAnsweringPage(name) {
  const n = escapeHtml(name);
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
    + `<title>${n}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 -apple-system,system-ui,sans-serif;`
    + "color:#3a3a3c;background:#f7f7f8}@media (prefers-color-scheme:dark){body{color:#d1d1d6;background:#141416}}"
    + "p{max-width:32em;margin:24px;text-align:center}</style></head>"
    + `<body><p>${n} is starting or stopped. Open App Studio to see why.</p></body></html>`;
}

// A file by the trust rule (a regular file, not a link, owned by this user, no write bit for
// group or others, at most `max` bytes), checked on the open handle. → text, "missing", or null.
function readTrustedText(path, max) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return err && err.code === "ENOENT" ? "missing" : null;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0 || st.size > max) return null;
    const buf = Buffer.alloc(max + 1);
    let size = 0;
    for (;;) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
      if (size > max) return null;
    }
    return buf.subarray(0, size).toString("utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// `<state>/apps/state.json` (K17) → { ok, on: { slug: true }, changedAt }. No file: every app
// off. Untrusted, not JSON, or not K17's shape: every app off and ok false.
export function readAppsState(path) {
  const text = readTrustedText(path, 64 * 1024);
  if (text === "missing") return { ok: true, on: {}, changedAt: null };
  const broken = { ok: false, on: {}, changedAt: null };
  if (text === null) return broken;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return broken;
  }
  if (!isObject(data) || data.version !== 1 || !isObject(data.apps)) return broken;
  if (!(data.changedAt === null || data.changedAt === undefined || typeof data.changedAt === "string")) return broken;
  const on = {};
  for (const [slug, entry] of Object.entries(data.apps)) {
    if (!SLUG_RE.test(slug) || !isObject(entry) || typeof entry.on !== "boolean") return broken;
    if (entry.on) on[slug] = true;
  }
  return { ok: true, on, changedAt: typeof data.changedAt === "string" ? data.changedAt : null };
}

// The owner's home from the user database, never $HOME.
function ownerHome() {
  return realpathSync(userInfo().homedir);
}

// What app-exec gives the app in --run (K18), for a spawner that does not build it itself.
export function runEnvironment(cfg, app, paths) {
  const node = realOrGiven(cfg.node24);
  const env = {
    APP_SOCKET: paths.appSock, ENGINE_SOCKET: paths.engineSock, APP_DATA: paths.data, APP_TMP: paths.tmp,
    TMPDIR: paths.tmp, HOME: paths.home, NODE_ENV: "production", LANG: "en_US.UTF-8",
    PATH: `${node}/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  if (app.tools.includes("ffmpeg")) env.FFMPEG = "/opt/homebrew/bin/ffmpeg";
  if (app.tools.includes("ffprobe")) env.FFPROBE = "/opt/homebrew/bin/ffprobe";
  return env;
}

// The real way an app starts: app-exec, which builds the fence and the environment from the
// engine's own config.json and the app's app.json. Its own process group, no shell, pipes for
// its output (Node inside the fence cannot start on a file it may not look at).
export function appExecSpawner(execPath = join(HERE, "app-exec")) {
  return (slug) => spawn(execPath, [slug, "--run"], {
    cwd: "/",
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: ownerHome(), LANG: "en_US.UTF-8" },
  });
}

// Every process of this Mac as { pid, ppid, pgid, start }; [] when ps cannot be read.
function processTable() {
  const r = spawnSync("/bin/ps", ["-A", "-o", "pid=,ppid=,pgid=,lstart="], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0 || typeof r.stdout !== "string") return [];
  const out = [];
  for (const line of r.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), start: m[4] });
  }
  return out;
}

// The processes started from a group that left it (an app may start a helper in a session of
// its own): every descendant of the group's members whose group is another.
function strays(pgid, table = processTable()) {
  const kids = new Map();
  for (const p of table) {
    if (!kids.has(p.ppid)) kids.set(p.ppid, []);
    kids.get(p.ppid).push(p);
  }
  const out = [];
  const seen = new Set();
  const queue = table.filter((p) => p.pgid === pgid);
  while (queue.length > 0) {
    const p = queue.shift();
    for (const c of kids.get(p.pid) || []) {
      if (seen.has(c.pid) || c.pid === process.pid) continue;
      seen.add(c.pid);
      if (c.pgid !== pgid) out.push(c);
      queue.push(c);
    }
  }
  return out;
}

const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};
const signal = (target, sig) => {
  try {
    process.kill(target, sig);
  } catch { /* gone already */ }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Milliseconds that do not run while the Mac sleeps (mach_absolute_time), so a start that
// spans a closed lid is not judged to have taken all that time.
const awakeMs = () => Number(process.hrtime.bigint() / 1_000_000n);

// Ends a process group and every process that left it: SIGTERM, then SIGKILL after `graceMs`.
// A stray is killed only while it is still the process it was (same start time).
export async function endGroup(pgid, graceMs = HOST_LIMITS.stopGraceMs) {
  if (!Number.isInteger(pgid) || pgid <= 1) return;
  const away = strays(pgid);
  signal(-pgid, "SIGTERM");
  for (const p of away) signal(p.pid, "SIGTERM");
  const until = Date.now() + graceMs;
  const still = () => {
    const now = processTable();
    const left = away.filter((p) => now.some((q) => q.pid === p.pid && q.start === p.start));
    return { group: groupAlive(pgid), left };
  };
  for (;;) {
    const s = still();
    if (!s.group && s.left.length === 0) return;
    if (Date.now() >= until) {
      signal(-pgid, "SIGKILL");
      for (const p of s.left) signal(p.pid, "SIGKILL");
      break;
    }
    await wait(100);
  }
  const end = Date.now() + 2000;
  while (Date.now() < end && (groupAlive(pgid) || still().left.length > 0)) await wait(50);
}

// Calls per app in the last hour and day (the web door's window), counted when a call goes out.
function relayWindow() {
  const calls = new Map();
  const prune = (list, now) => {
    let k = 0;
    while (k < list.length && list[k] <= now - DAY) k += 1;
    if (k > 0) list.splice(0, k);
  };
  return {
    seed(slug, times, now) {
      if (!Array.isArray(times)) return;
      const list = times.filter((t) => Number.isFinite(t) && t > now - DAY && t <= now).sort((a, b) => a - b).slice(-1000);
      calls.set(slug, list);
    },
    admit(slug, now, perHour, perDay) {
      if (!calls.has(slug)) calls.set(slug, []);
      const list = calls.get(slug);
      prune(list, now);
      if (list.length >= perDay) return false;
      if (list.filter((t) => t > now - HOUR).length >= perHour) return false;
      list.push(now);
      return true;
    },
    times(slug, now) {
      const list = calls.get(slug) || [];
      prune(list, now);
      return [...list];
    },
  };
}

// An app's output file: appended, 0600, never through a link, cut to `.1` at `max` bytes.
function appLog(path, max) {
  let fd = null;
  let size = 0;
  const open = () => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error("the app's log is not a file");
    fchmodSync(fd, 0o600);
    size = st.size;
  };
  const close = () => {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* closed */ }
      fd = null;
    }
  };
  return {
    write(chunk) {
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (fd === null) open();
        if (size > 0 && size + buf.length > max) {
          close();
          renameSync(path, `${path}.1`);
          open();
        }
        writeSync(fd, buf);
        size += buf.length;
      } catch {
        close();
      }
    },
    close,
  };
}

// The listeners' raw refusal for an Upgrade or CONNECT: written to the socket, then closed.
function refuseSocket(socket, head) {
  socket.on("error", () => {});
  if (!socket.writable) return void socket.destroy();
  socket.end(head, () => socket.destroy());
  setTimeout(() => socket.destroy(), 1000).unref();
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return void resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

export function createAppHost({ cfg, now, log, spawnApp, limits } = {}) {
  if (!cfg || !cfg.paths) throw new Error("createAppHost: cfg is needed");
  const lim = { ...HOST_LIMITS, ...(limits || {}) };
  // Node looks for slow headers only this often (30 s unless told), so the limit holds.
  const checkEvery = Math.max(100, Math.min(1000, Math.floor(lim.headersMs / 2)));
  const clock = typeof now === "function" ? now : () => Date.now();
  const iso = () => new Date(clock()).toISOString();
  const spawnOne = typeof spawnApp === "function" ? spawnApp : appExecSpawner();
  const say = (line) => {
    try {
      if (typeof log === "function") log(line);
    } catch { /* a log failure changes nothing */ }
  };
  const P = cfg.paths;
  const homePort = cfg.ports.home;
  const runRoot = realOrGiven(P.appsRun);
  const hostDir = join(runRoot, ".host");
  const upstreamOf = { generate: new URL(cfg.urls.generate), relay: new URL(cfg.urls.relay) };
  const secretOf = { generate: P.generateSecret, relay: P.relaySecret };
  const statusOut = statusFile(P.appsStatus);
  const relay = relayWindow();
  const apps = new Map();          // slug -> its record
  let timer = null;
  let closing = false;
  let startedAt = null;
  let stateReadable = true;
  let healthServer = null;
  let lastChange = null;           // the switches file's changedAt, as last read

  function recordOf(slug) {
    if (!apps.has(slug)) {
      apps.set(slug, {
        slug, name: slug, port: null, manifest: null, state: "off", since: iso(), restarts: 0, why: null, exits: [],
        child: null, pgid: null, engine: null, browser: null, hostSock: null, paths: null, runIno: null, adopted: false,
        gen: 0, op: null, restartTimer: null, failedChange: null, out: null,
        browserAtOnce: 0, engineAtOnce: 0, relayAtOnce: 0, upstreams: new Set(),
      });
    }
    return apps.get(slug);
  }

  function setState(rec, state, why = null) {
    if (rec.state !== state) {
      rec.state = state;
      rec.since = iso();
      // Failed until the owner switches it off and on: the switches as they were now.
      if (state === "failed") rec.failedChange = lastChange;
    }
    rec.why = state === "failed" ? why : null;
    publish();
  }

  function publish() {
    const t = clock();
    statusOut.save({
      version: 1,
      startedAt,
      updatedAt: iso(),
      stateReadable,
      apps: [...apps.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1)).map((r) => ({
        slug: r.slug, name: r.name, port: r.port, state: r.state, since: r.since, restarts: r.restarts, why: r.why,
        pid: r.pgid, relayCalls: relay.times(r.slug, t),
      })),
    });
  }

  // One operation at a time per app, in the order asked; the loop leaves an app alone while
  // one is waiting or running.
  function run(rec, name, fn) {
    rec.op = name;
    const p = (rec.pending || Promise.resolve()).then(fn).catch((err) => {
      say(`${iso()} app ${rec.slug} ${name} failed: ${describeError(err)}`);
    }).finally(() => {
      if (rec.pending === p) {
        rec.pending = null;
        rec.op = null;
      }
    });
    rec.pending = p;
    return p;
  }

  // ---- the engine socket (K19) ----------------------------------------------------------

  function engineRefuse(rec, res, code, routeName) {
    const [status, sentence] = ENGINE_CODES[code];
    say(`${iso()} app ${rec.slug} ${routeName} ${status} ${code}`);
    if (res.headersSent) return void res.destroy();
    const text = JSON.stringify({ error: { message: sentence }, code });
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
    res.end(text);
  }

  async function onEngine(rec, manifest, req, res) {
    req.on("error", () => {});
    res.on("error", () => {});
    if (wantsUpgrade(req.rawHeaders)) return engineRefuse(rec, res, "app_refused", "upgrade");
    const route = engineRoute(req.method, req.url, manifest.engine);
    if (!route) {
      req.resume();
      return engineRefuse(rec, res, "app_not_found", "unknown");
    }
    if (rec.engineAtOnce >= lim.engineAtOnce || (route.target === "relay" && rec.relayAtOnce >= lim.relayAtOnce)) {
      req.resume();
      return engineRefuse(rec, res, "app_busy", route.name);
    }
    rec.engineAtOnce += 1;
    if (route.target === "relay") rec.relayAtOnce += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      rec.engineAtOnce -= 1;
      if (route.target === "relay") rec.relayAtOnce -= 1;
    };
    res.on("close", release);
    try {
      // Refused before a body is read when the part is off anyway.
      if (readSecret(secretOf[route.target]) === null) {
        req.resume();
        return engineRefuse(rec, res, "app_engine_off", route.name);
      }
      const types = headerValues(req.rawHeaders, "content-type");
      const accepts = headerValues(req.rawHeaders, "accept");
      let body = null;
      if (route.method === "POST") {
        if (types.length > 1 || (route.json && (types.length !== 1 || !/^application\/json\s*(;.*)?$/i.test(types[0])))) {
          req.resume();
          return engineRefuse(rec, res, "app_refused", route.name);
        }
        body = await readBody(req, lim[route.max]);
        if (body === null) return undefined;
        if (body === "too-big") return engineRefuse(rec, res, "app_too_big", route.name);
      } else {
        req.resume();
      }
      // The secret is read again now: the part may have been switched off while the body came.
      const secret = readSecret(secretOf[route.target]);
      if (secret === null) return engineRefuse(rec, res, "app_engine_off", route.name);
      if (route.limited) {
        const admitted = relay.admit(rec.slug, clock(), lim.relayPerHour, lim.relayPerDay);
        publish();
        if (!admitted) return engineRefuse(rec, res, "app_limited", route.name);
      }
      const token = mintToken(secret, "t", `app-${rec.slug}`, Math.floor(clock() / 1000) + lim.tokenSec);
      const headers = { authorization: `Bearer ${token}` };
      if (types.length === 1) headers["content-type"] = types[0];
      if (accepts.length === 1) headers.accept = accepts[0];
      if (body !== null) headers["content-length"] = body.length;
      const to = upstreamOf[route.target];
      await new Promise((resolve) => {
        const up = http.request({
          host: "127.0.0.1", port: Number(to.port), method: route.method, path: req.url, headers, agent: false,
        });
        rec.upstreams.add(up);
        let answered = false;
        const done = () => {
          rec.upstreams.delete(up);
          resolve();
        };
        up.on("response", (ans) => {
          answered = true;
          const out = {};
          const ct = headerValues(ans.rawHeaders, "content-type");
          const cl = headerValues(ans.rawHeaders, "content-length");
          if (ct.length === 1) out["Content-Type"] = ct[0];
          if (cl.length === 1 && /^[0-9]{1,12}$/.test(cl[0])) out["Content-Length"] = cl[0];
          say(`${iso()} app ${rec.slug} ${route.name} ${ans.statusCode}`);
          res.writeHead(ans.statusCode, out);
          ans.pipe(res);
          ans.on("error", () => res.destroy());
          ans.on("aborted", () => res.destroy());
          ans.on("end", done);
          ans.on("close", done);
        });
        up.on("error", (err) => {
          if (!answered && !res.headersSent) {
            engineRefuse(rec, res, err && err.code === "ECONNREFUSED" ? "app_engine_off" : "app_no_answer", route.name);
          } else {
            res.destroy();
          }
          done();
        });
        up.setTimeout(route.target === "relay" ? lim.relayIdleMs : lim.generateIdleMs, () => up.destroy(new Error("no answer")));
        res.on("close", () => {
          if (!res.writableFinished) up.destroy();
        });
        up.end(body === null ? undefined : body);
      });
    } finally {
      if (res.writableFinished || res.destroyed) release();
    }
    return undefined;
  }

  function openEngine(rec, manifest, sockPath) {
    return new Promise((resolve, reject) => {
      const server = http.createServer({ connectionsCheckingInterval: checkEvery }, (req, res) => {
        onEngine(rec, manifest, req, res).catch((err) => {
          say(`${iso()} app ${rec.slug} engine request failed: ${describeError(err)}`);
          if (!res.headersSent) engineRefuse(rec, res, "app_refused", "error");
          else res.destroy();
        });
      });
      server.headersTimeout = lim.headersMs;
      server.requestTimeout = lim.requestMs;
      server.on("upgrade", (_req, socket) => refuseSocket(socket, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
      server.on("connect", (_req, socket) => refuseSocket(socket, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
      server.once("error", reject);
      server.listen(sockPath, () => {
        server.off("error", reject);
        server.on("error", (err) => say(`${iso()} app ${rec.slug} engine socket: ${describeError(err)}`));
        try {
          chmodSync(sockPath, 0o600);
        } catch { /* the folder is 0700 anyway */ }
        resolve(server);
      });
    });
  }

  // ---- the browser side (K17) -----------------------------------------------------------

  function ownAnswer(res, status, body, type, extra = {}) {
    if (res.headersSent) return void res.destroy();
    const buf = Buffer.from(body);
    res.writeHead(status, {
      ...securityHeaders(homePort), "Content-Type": type, "Content-Length": buf.length, "Cache-Control": "no-store", ...extra,
    });
    res.end(res.req && res.req.method === "HEAD" ? undefined : buf);
  }

  function browserRefuse(rec, req, res, code) {
    const [status, sentence] = BROWSER_CODES[code];
    say(`${iso()} app ${rec.slug} browser ${status} ${code}`);
    req.resume();
    ownAnswer(res, status, `${sentence}\n`, "text/plain; charset=utf-8", { Connection: "close" });
  }

  function notAnswering(rec, res) {
    ownAnswer(res, 502, notAnsweringPage(rec.name), "text/html; charset=utf-8");
  }

  function onBrowser(rec, req, res) {
    req.on("error", () => {});
    res.on("error", () => {});
    if (rec.browserAtOnce >= lim.browserAtOnce) return browserRefuse(rec, req, res, "busy");
    rec.browserAtOnce += 1;
    let counted = true;
    res.on("close", () => {
      if (counted) {
        counted = false;
        rec.browserAtOnce -= 1;
      }
    });
    const no = browserRefusal(req, rec.port, lim.bodyBytes);
    if (no) return browserRefuse(rec, req, res, no);
    if (rec.state !== "on" || !rec.adopted || !rec.hostSock) {
      req.resume();
      return notAnswering(rec, res);
    }
    const headers = inboundHeaders(req.rawHeaders);
    const lengths = headerValues(req.rawHeaders, "content-length");
    if (lengths.length === 1) headers.push("Content-Length", String(Number(lengths[0])));
    const up = http.request({ socketPath: rec.hostSock, method: req.method, path: req.url, headers, agent: false });
    rec.upstreams.add(up);
    const forget = () => rec.upstreams.delete(up);
    up.on("response", (ans) => {
      res.writeHead(ans.statusCode, outboundHeaders(ans.rawHeaders, homePort));
      ans.pipe(res);
      ans.on("error", () => res.destroy());
      ans.on("aborted", () => res.destroy());
      ans.on("close", forget);
    });
    up.on("information", () => {});
    up.on("error", () => {
      forget();
      if (!res.headersSent) notAnswering(rec, res);
      else res.destroy();
    });
    up.setTimeout(lim.appIdleMs, () => up.destroy(new Error("idle")));
    res.on("close", () => {
      if (!res.writableFinished) up.destroy();
    });
    // The body, cut at the limit whatever its framing.
    let sent = 0;
    req.on("data", (chunk) => {
      sent += chunk.length;
      if (sent > lim.bodyBytes) {
        req.removeAllListeners("data");
        up.destroy();
        forget();
        say(`${iso()} app ${rec.slug} browser 413 too_big`);
        if (!res.headersSent) ownAnswer(res, 413, `${BROWSER_CODES.too_big[1]}\n`, "text/plain; charset=utf-8", { Connection: "close" });
        else res.destroy();
        req.resume();
        setTimeout(() => req.destroy(), 1000).unref();
        return;
      }
      if (!up.write(chunk)) {
        req.pause();
        up.once("drain", () => req.resume());
      }
    });
    req.on("end", () => {
      if (sent <= lim.bodyBytes) up.end();
    });
    return undefined;
  }

  function openBrowser(rec) {
    return new Promise((resolve, reject) => {
      const server = http.createServer({ connectionsCheckingInterval: checkEvery }, (req, res) => onBrowser(rec, req, res));
      server.headersTimeout = lim.headersMs;
      server.requestTimeout = lim.requestMs;
      server.maxConnections = lim.browserConnections;
      const raw = (_req, socket) => {
        say(`${iso()} app ${rec.slug} browser 403 upgrade`);
        const text = `${BROWSER_CODES.upgrade[1]}\n`;
        refuseSocket(socket, `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n`
          + `Connection: close\r\n\r\n${text}`);
      };
      server.on("upgrade", raw);
      server.on("connect", raw);
      server.once("error", reject);
      server.listen(rec.port, "127.0.0.1", () => {
        server.off("error", reject);
        server.on("error", (err) => say(`${iso()} app ${rec.slug} browser listener: ${describeError(err)}`));
        resolve(server);
      });
    });
  }

  // ---- starting and stopping one app ---------------------------------------------------

  // Empties a run folder (the app may have left a tree in it, or folders it closed to
  // itself): links are removed, never followed. Then made again, 0700, and its inode kept.
  async function freshRun(rec) {
    const run = rec.paths.run;
    mkdirSync(runRoot, { recursive: true, mode: 0o700 });
    chmodSync(runRoot, 0o700);
    mkdirSync(hostDir, { recursive: true, mode: 0o700 });
    chmodSync(hostDir, 0o700);
    await removeTree(run);
    await rm(rec.hostSock, { recursive: true, force: true });
    mkdirSync(run, { mode: 0o700 });
    chmodSync(run, 0o700);
    rec.runIno = lstatSync(run).ino;
  }

  async function removeTree(path) {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Folders the app closed to itself: opened again (never through a link), then removed.
      spawnSync("/usr/bin/find", [path, "-type", "d", "!", "-perm", "-u+rwx", "-exec", "/bin/chmod", "u+rwx", "{}", "+"], { timeout: 30000 });
      await rm(path, { recursive: true, force: true });
    }
  }

  // The app's socket, moved where the app cannot reach it, then checked there.
  // → "waiting" (not there yet), "ok", or a reason it is refused.
  function adopt(rec) {
    let rs;
    try {
      rs = lstatSync(rec.paths.run);
    } catch {
      return "run_folder_gone";
    }
    if (!rs.isDirectory() || rs.ino !== rec.runIno) return "run_folder_changed";
    try {
      renameSync(rec.paths.appSock, rec.hostSock);
    } catch (err) {
      return err && err.code === "ENOENT" ? "waiting" : "app_socket_unmovable";
    }
    let st;
    try {
      st = lstatSync(rec.hostSock);
    } catch {
      return "app_socket_gone";
    }
    if (st.isSymbolicLink() || !st.isSocket() || st.uid !== process.getuid() || st.nlink !== 1) {
      rm(rec.hostSock, { recursive: true, force: true }).catch(() => {});
      return "app_socket_not_a_socket";
    }
    return "ok";
  }

  function healthz(rec) {
    return new Promise((resolve) => {
      const req = http.request({
        socketPath: rec.hostSock, method: "GET", path: "/healthz", agent: false, headers: { host: `127.0.0.1:${rec.port}` },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode === 200));
        res.on("error", () => resolve(false));
      });
      req.on("error", () => resolve(false));
      req.setTimeout(lim.healthTryMs, () => req.destroy());
      req.end();
    });
  }

  async function start(rec, manifest) {
    const gen = ++rec.gen;
    rec.manifest = manifest;
    rec.name = manifest.name;
    rec.port = manifest.port;
    if (rec.restartTimer) {
      clearTimeout(rec.restartTimer);
      rec.restartTimer = null;
    }
    setState(rec, "starting");
    try {
      rec.paths = appPaths(cfg, rec.slug);
    } catch (err) {
      say(`${iso()} app ${rec.slug} not started: ${String(err.message)}`);
      return setState(rec, "failed", "path_too_long");
    }
    rec.hostSock = join(hostDir, rec.slug);
    if (Buffer.byteLength(rec.hostSock) >= SOCKET_PATH_MAX) {
      say(`${iso()} app ${rec.slug} not started: ${TOO_LONG}`);
      return setState(rec, "failed", "path_too_long");
    }
    rec.adopted = false;
    try {
      await freshRun(rec);
      rec.engine = await openEngine(rec, manifest, rec.paths.engineSock);
    } catch (err) {
      say(`${iso()} app ${rec.slug} not started: its run folder: ${describeError(err)}`);
      await closeServer(rec.engine);
      rec.engine = null;
      return setState(rec, "failed", "run_folder");
    }
    if (gen !== rec.gen) return undefined;
    if (!rec.out) rec.out = appLog(rec.paths.log, lim.logBytes);
    rec.out.write(`${iso()} App Studio: starting ${rec.slug}\n`);
    let child;
    try {
      child = spawnOne(rec.slug, runEnvironment(cfg, manifest, rec.paths));
    } catch (err) {
      say(`${iso()} app ${rec.slug} could not be started: ${describeError(err)}`);
      await closeServer(rec.engine);
      rec.engine = null;
      return setState(rec, "failed", "spawn");
    }
    if (!Number.isInteger(child.pid) || child.pid <= 1) {
      child.on("error", () => {});
      say(`${iso()} app ${rec.slug} could not be started: no process`);
      await closeServer(rec.engine);
      rec.engine = null;
      return setState(rec, "failed", "spawn");
    }
    rec.child = child;
    rec.pgid = child.pid;
    publish();
    const keep = (chunk) => rec.out && rec.out.write(chunk);
    if (child.stdout) child.stdout.on("data", keep);
    if (child.stderr) child.stderr.on("data", keep);
    child.on("error", (err) => say(`${iso()} app ${rec.slug} process: ${describeError(err)}`));
    child.on("exit", (code, sig) => onExit(rec, child, code, sig));
    say(`${iso()} app ${rec.slug} starting`);
    // Its socket, then a 200 on /healthz, within healthMs of the Mac being awake.
    const until = awakeMs() + lim.healthMs;
    let refusedWhy = null;
    while (awakeMs() < until && gen === rec.gen && rec.child === child && !closing) {
      if (!rec.adopted) {
        const a = adopt(rec);
        if (a === "ok") rec.adopted = true;
        else if (a !== "waiting") {
          refusedWhy = a;
          break;
        }
      }
      if (rec.adopted && await healthz(rec)) break;
      await wait(rec.adopted ? 250 : 100);
    }
    if (gen !== rec.gen || rec.child !== child || closing) return undefined; // stopped, or exited (onExit decides)
    const healthy = rec.adopted && refusedWhy === null && await healthz(rec);
    if (!healthy) {
      const why = refusedWhy || "no_health";
      say(`${iso()} app ${rec.slug} failed to start: ${why}`);
      return halt(rec, "failed", why);
    }
    if (!rec.browser) {
      try {
        rec.browser = await openBrowser(rec);
      } catch (err) {
        say(`${iso()} app ${rec.slug} cannot listen on 127.0.0.1:${rec.port}: ${err && err.code ? err.code : "error"}`);
        return halt(rec, "failed", "port_busy");
      }
    }
    if (gen !== rec.gen || rec.child !== child) return undefined;
    say(`${iso()} app ${rec.slug} on at 127.0.0.1:${rec.port}`);
    return setState(rec, "on");
  }

  // Everything of a running app ended, then the state given. Used by stop and by failures.
  async function halt(rec, state, why = null) {
    const gen = ++rec.gen;
    if (rec.restartTimer) {
      clearTimeout(rec.restartTimer);
      rec.restartTimer = null;
    }
    const browser = rec.browser;
    const pgid = rec.pgid;
    // Forgotten first, so its exit is not taken for a crash.
    rec.browser = null;
    rec.adopted = false;
    rec.child = null;
    rec.pgid = null;
    await closeServer(browser);
    if (pgid) await endGroup(pgid, lim.stopGraceMs);
    for (const up of rec.upstreams) up.destroy();
    rec.upstreams.clear();
    const engine = rec.engine;
    rec.engine = null;
    await closeServer(engine);
    if (rec.paths) {
      await removeTree(rec.paths.run).catch(() => {});
      await rm(rec.hostSock, { recursive: true, force: true }).catch(() => {});
    }
    if (rec.out) rec.out.write(`${iso()} App Studio: ${rec.slug} ${state === "failed" ? `stopped (${why})` : "stopped"}\n`);
    if (gen !== rec.gen) return undefined;
    if (state !== "failed") {
      rec.restarts = 0;
      rec.exits = [];
    }
    setState(rec, state, why);
    return undefined;
  }

  function onExit(rec, child, code, sig) {
    if (rec.child !== child) return;
    rec.child = null;
    say(`${iso()} app ${rec.slug} exited (${sig || `code ${code}`})`);
    if (rec.out) rec.out.write(`${iso()} App Studio: ${rec.slug} exited (${sig || `code ${code}`})\n`);
    const t = clock();
    rec.exits = rec.exits.filter((x) => x > t - lim.exitWindowMs);
    rec.exits.push(t);
    const failing = rec.exits.length >= lim.exitsToFail;
    const pgid = rec.pgid;
    run(rec, "exit", async () => {
      // What it left behind goes, and its engine socket closes; the browser listener stays
      // open (it answers with the not-answering page) unless the app has now failed.
      if (failing) {
        say(`${iso()} app ${rec.slug} stopped ${rec.exits.length} times in ${Math.round(lim.exitWindowMs / 60000)} minutes; failed`);
        return halt(rec, "failed", "exits");
      }
      const gen = ++rec.gen;
      rec.adopted = false;
      setState(rec, "starting");
      if (pgid) await endGroup(pgid, Math.min(lim.stopGraceMs, lim.restartMs));
      rec.pgid = null;
      const engine = rec.engine;
      rec.engine = null;
      await closeServer(engine);
      if (gen !== rec.gen) return undefined;
      rec.restartTimer = setTimeout(() => {
        rec.restartTimer = null;
        if (gen !== rec.gen || closing) return;
        const m = rec.manifest;
        run(rec, "restart", async () => {
          if (gen !== rec.gen || closing) return undefined;
          rec.restarts += 1;
          return start(rec, m);
        });
      }, lim.restartMs);
      return undefined;
    });
  }

  // ---- the loop -------------------------------------------------------------------------

  const sameManifest = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function tick() {
    if (closing) return;
    let list;
    try {
      list = readManifests(cfg);
    } catch (err) {
      say(`${iso()} the apps could not be read: ${describeError(err)}`);
      list = [];
    }
    const st = readAppsState(P.appsState);
    if (st.ok !== stateReadable) say(`${iso()} the owner's app switches ${st.ok ? "can be read again" : "cannot be read; every app is off"}`);
    stateReadable = st.ok;
    lastChange = st.changedAt;
    const seen = new Set();
    for (const e of list) {
      const slug = e.ok ? e.app.slug : e.slug;
      seen.add(slug);
      const rec = recordOf(slug);
      if (e.ok) {
        rec.name = e.app.name;
        if (!isLive(rec)) rec.port = e.app.port;
      }
      decide(rec, e, st.on[slug] === true, st.changedAt);
    }
    for (const rec of [...apps.values()]) {
      if (seen.has(rec.slug)) continue;
      if (isLive(rec)) {
        if (!rec.op) run(rec, "stop", () => halt(rec, "off"));
      } else if (!rec.op) {
        apps.delete(rec.slug);
        publish();
      }
    }
  }

  const isLive = (rec) => Boolean(rec.child || rec.pgid || rec.engine || rec.browser || rec.restartTimer
    || rec.state === "starting" || rec.state === "on");

  function decide(rec, entry, on, changedAt) {
    if (rec.op) return;
    const rest = !entry.ok ? "damaged" : !entry.installed ? "not_installed" : "off";
    const want = rest === "off" && on;
    if (want) {
      if (rec.state === "failed") {
        // Failed until the owner switches it off and on: seen off by the loop, or the
        // switches saved again since it failed (an off and on faster than the loop).
        if (changedAt === null || changedAt === rec.failedChange) return;
        rec.restarts = 0;
        rec.exits = [];
        run(rec, "start", () => start(rec, entry.app));
        return;
      }
      if (isLive(rec)) {
        if (!sameManifest(rec.manifest, entry.app)) {
          say(`${iso()} app ${rec.slug} changed its description; starting it again`);
          run(rec, "stop", () => halt(rec, "off"));
        }
        return;
      }
      run(rec, "start", () => start(rec, entry.app));
      return;
    }
    if (isLive(rec)) {
      run(rec, "stop", () => halt(rec, rest));
      return;
    }
    if (rec.state !== rest) {
      rec.restarts = 0;
      rec.exits = [];
      setState(rec, rest);
    }
  }

  // ---- the host's own address: health only ---------------------------------------------

  function healthBody() {
    return {
      status: "ok",
      part: "apps",
      apps: [...apps.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))
        .map((r) => ({ slug: r.slug, state: r.state, since: r.since, restarts: r.restarts })),
    };
  }

  function openHealth(port) {
    const answer = (res, status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", Connection: "close",
      });
      res.end(text);
    };
    const server = http.createServer({ connectionsCheckingInterval: checkEvery }, (req, res) => {
      req.on("error", () => {});
      req.resume();
      const own = server.address().port;
      const hosts = headerValues(req.rawHeaders, "host");
      if (wantsUpgrade(req.rawHeaders)) return answer(res, 403, { error: { message: "App Studio does not take this kind of request." }, code: "apps_refused" });
      if (hosts.length !== 1 || (hosts[0] !== `127.0.0.1:${own}` && hosts[0] !== `localhost:${own}`)) {
        return answer(res, 421, { error: { message: "This address is not App Studio." }, code: "apps_wrong_host" });
      }
      if (req.method === "GET" && req.url === "/apps/health") return answer(res, 200, healthBody());
      return answer(res, 404, { error: { message: "App Studio has no such address." }, code: "apps_not_found" });
    });
    server.headersTimeout = lim.headersMs;
    server.requestTimeout = 10_000;
    const raw = (_req, socket) => refuseSocket(socket, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    server.on("upgrade", raw);
    server.on("connect", raw);
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve(server);
      });
    });
  }

  // What an earlier host left: apps still running after it was killed are ended (only a
  // group whose first process is still one of ours: the fence's settings or the app's folder
  // in its command), and each app's thinking calls of the last day are counted again.
  async function tidyEarlier() {
    const text = readTrustedText(P.appsStatus, 4 * MB);
    if (typeof text !== "string" || text === "missing") return;
    let old;
    try {
      old = JSON.parse(text);
    } catch {
      return;
    }
    if (!isObject(old) || !Array.isArray(old.apps)) return;
    const t = clock();
    const fences = `${realOrGiven(P.fences || join(P.state, "fences"))}/`;
    for (const a of old.apps) {
      if (!isObject(a) || typeof a.slug !== "string" || !SLUG_RE.test(a.slug)) continue;
      relay.seed(a.slug, a.relayCalls, t);
      if (!Number.isInteger(a.pid) || a.pid <= 1 || !groupAlive(a.pid)) continue;
      const r = spawnSync("/bin/ps", ["-o", "command=", "-p", String(a.pid)], { encoding: "utf8", timeout: 5000 });
      const command = r.status === 0 ? r.stdout : "";
      const code = `${join(realOrGiven(P.appsCode), a.slug)}/`;
      if (command.includes(fences) || command.includes(code)) {
        say(`${iso()} app ${a.slug} was still running from before; ending it`);
        await endGroup(a.pid, lim.stopGraceMs);
      }
    }
  }

  return {
    get port() {
      const a = healthServer && healthServer.address();
      return a && typeof a === "object" ? a.port : null;
    },
    // The record of one app, for tests and the status: { state, since, restarts, why, port }.
    app(slug) {
      const r = apps.get(slug);
      return r ? { slug: r.slug, state: r.state, since: r.since, restarts: r.restarts, why: r.why, port: r.port, pid: r.pgid } : null;
    },
    health: healthBody,
    tick,
    // Resolves when no app has an operation waiting or running.
    async settle() {
      for (;;) {
        const busy = [...apps.values()].map((r) => r.pending).filter(Boolean);
        if (busy.length === 0) return;
        await Promise.allSettled(busy);
      }
    },
    async listen() {
      for (const f of [P.apps, runRoot, hostDir, P.appsLogs]) {
        mkdirSync(f, { recursive: true, mode: 0o700 });
        chmodSync(f, 0o700);
      }
      await tidyEarlier();
      healthServer = await openHealth(cfg.ports.apps);
      startedAt = iso();
      tick();
      timer = setInterval(tick, lim.everyMs);
      timer.unref();
      publish();
      statusOut.flush();
      return this.port;
    },
    async close() {
      closing = true;
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.all([...apps.values()].map(async (rec) => {
        if (rec.pending) await rec.pending.catch(() => {});
        if (isLive(rec)) await halt(rec, "off");
        if (rec.out) rec.out.close();
      }));
      await closeServer(healthServer);
      if (startedAt) {
        publish();
        statusOut.flush();
      }
    },
  };
}

function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function lastResort(err) {
  console.log(`${new Date().toISOString()} App Studio caught an error it did not expect: ${describeError(err)}`);
}

async function main() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { loadConfig } = await import("../lib/config.mjs");
  // The engine's own config.json, the one app-exec reads too: never one named by the
  // environment, so the host and the fence always agree on every folder.
  const cfg = loadConfig({ path: join(HERE, "..", "config.json") });
  for (const f of [cfg.paths.apps, cfg.paths.appsRun, cfg.paths.appsLogs]) ownFolder(f);
  const host = createAppHost({ cfg, log: (line) => console.log(line) });
  try {
    await host.listen();
  } catch (err) {
    console.log(`${new Date().toISOString()} App Studio could not start on 127.0.0.1:${cfg.ports.apps}: ${err && err.code ? err.code : "error"}`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} App Studio started on 127.0.0.1:${cfg.ports.apps}`);
  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    await host.close();
    console.log(`${new Date().toISOString()} App Studio stopped (${sig})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

const self = fileURLToPath(import.meta.url);
let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = "";
}
if (invoked === realpathSync(self)) {
  main().catch((err) => {
    console.log(`${new Date().toISOString()} App Studio failed: ${describeError(err)}`);
    process.exit(1);
  });
}
