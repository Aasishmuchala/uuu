// App Studio's apps as their folders describe them (PLAN-V5 K17): each app is a folder
// `apps/<slug>/` beside `engine/` with an `app.json`. A manifest that breaks any rule makes
// the app `damaged`: listed, never started. Zero dependencies; nothing is cached (callers read
// again on every use).
//
// readManifests(cfg) → [ { ok: true, app, installed } | { ok: false, slug, problem } ], in the
//   order of the folders' names, at most 20 folders. `installed`: READY is a regular file.
//   `problem`: manifest_missing, manifest_untrusted (a link, not a regular file of this user,
//   or one others may change), manifest_too_big (over 16 KB), manifest_not_json,
//   manifest_keys (a key missing or one too many), bad_<key> (the first key that breaks its
//   rule: bad_version, bad_slug, … bad_memoryMb), folder_link (the app's folder is a link),
//   port_shared (another good app has the same port; both are damaged).
// appPaths(cfg, slug) → where one app's code, packages, data and sockets live. The config's
//   folders are taken by their real paths; nothing below them is ever followed through a link
//   (app-exec refuses one). Throws when a socket path would be too long for this Mac.
//
// As a script (app-exec only, run with an environment built from nothing):
//   node manifest.mjs --launch <slug>
// prints eleven `key=value` lines (code, deps, store, data, tmp, home, run, entry, memoryMb,
// tools, installed) for a good app, or one line "app-exec: <why>" and exits 78.
import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const MAX_APPS = 20;
export const MANIFEST_MAX_BYTES = 16 * 1024;
export const ICON_MAX_BYTES = 256 * 1024;
// macOS keeps a unix socket's path in 104 bytes, its last one the ending zero.
export const SOCKET_PATH_MAX = 104;
export const TOO_LONG = "This app's folder path is too long for this Mac.";
const KEYS = ["version", "slug", "name", "about", "port", "entry", "client", "engine", "tools", "icon", "memoryMb"];
const ENGINE_PARTS = ["generate", "relay"];
const TOOLS = ["ffmpeg", "ffprobe"];
const PATH_RE = /^[A-Za-z0-9._/-]{1,80}$/;
const ICON_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,75}\.(svg|png)$/;
const DEFAULT_PORTS = { first: 3171, last: 3189 };
const REFUSED_EXIT = 78;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// Text of one line: 1 to `max` characters (code points), no control character at all.
function oneLine(v, max) {
  if (typeof v !== "string") return false;
  const n = [...v].length;
  return n >= 1 && n <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);
}

// A path inside the app's folder: relative, by K17's pattern, no ".." segment, and never
// read as an option by the program it is handed to.
function relativePath(v) {
  return typeof v === "string" && PATH_RE.test(v) && !v.startsWith("/") && !v.startsWith("-")
    && !v.split("/").includes("..");
}

// A list naming some of `allowed`, each at most once.
function subset(v, allowed) {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && allowed.includes(s)) && new Set(v).size === v.length;
}

// app.json by the trust rule (engine/relay/state.mjs): a regular file, not a link, owned by
// this user, no write bit for group or others, at most 16 KB. Checked on the open handle.
// → { text } | { problem }.
function readManifestFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    return { problem: err && err.code === "ENOENT" ? "manifest_missing" : "manifest_untrusted" };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0) return { problem: "manifest_untrusted" };
    if (st.size > MANIFEST_MAX_BYTES) return { problem: "manifest_too_big" };
    const buf = Buffer.alloc(MANIFEST_MAX_BYTES + 1);
    let size = 0;
    for (;;) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
      if (size > MANIFEST_MAX_BYTES) return { problem: "manifest_too_big" };
    }
    return { text: buf.subarray(0, size).toString("utf8") };
  } catch {
    return { problem: "manifest_untrusted" };
  } finally {
    closeSync(fd);
  }
}

function iconOk(folder, name) {
  if (typeof name !== "string" || !ICON_RE.test(name)) return false;
  try {
    const st = lstatSync(join(folder, name));
    return st.isFile() && st.size <= ICON_MAX_BYTES;
  } catch {
    return false;
  }
}

// One app's folder → { ok: true, app } | { ok: false, problem } (the port is checked against
// the other apps by the caller).
export function checkManifest(folder, slug, ports = DEFAULT_PORTS) {
  const read = readManifestFile(join(folder, "app.json"));
  if (read.problem) return { ok: false, problem: read.problem };
  let m;
  try {
    m = JSON.parse(read.text);
  } catch {
    return { ok: false, problem: "manifest_not_json" };
  }
  if (!isObject(m)) return { ok: false, problem: "manifest_not_json" };
  const keys = Object.keys(m);
  if (keys.length !== KEYS.length || !KEYS.every((k) => Object.hasOwn(m, k))) return { ok: false, problem: "manifest_keys" };
  const checks = {
    version: m.version === 1,
    slug: typeof m.slug === "string" && SLUG_RE.test(m.slug) && m.slug === slug,
    name: oneLine(m.name, 40),
    about: oneLine(m.about, 120),
    port: whole(m.port, ports.first, ports.last),
    entry: relativePath(m.entry),
    client: relativePath(m.client),
    engine: subset(m.engine, ENGINE_PARTS),
    tools: subset(m.tools, TOOLS),
    icon: iconOk(folder, m.icon),
    memoryMb: whole(m.memoryMb, 256, 4096),
  };
  for (const k of KEYS) {
    if (!checks[k]) return { ok: false, problem: `bad_${k}` };
  }
  const app = {};
  for (const k of KEYS) app[k] = Array.isArray(m[k]) ? [...m[k]] : m[k];
  return { ok: true, app };
}

// Every app folder of `cfg.paths.appsCode`: names by the slug rule, sorted, at most 20. A
// name that is a link is listed as damaged; a plain file of that name is not an app.
export function readManifests(cfg) {
  const root = cfg.paths.appsCode;
  const ports = cfg.appPorts || DEFAULT_PORTS;
  let names;
  try {
    names = readdirSync(root).filter((n) => SLUG_RE.test(n)).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const slug of names) {
    if (out.length >= MAX_APPS) break;
    let st;
    try {
      st = lstatSync(join(root, slug));
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push({ ok: false, slug, problem: "folder_link" });
      continue;
    }
    if (!st.isDirectory()) continue;
    const folder = join(root, slug);
    const r = checkManifest(folder, slug, ports);
    if (!r.ok) {
      out.push({ ok: false, slug, problem: r.problem });
      continue;
    }
    let installed = false;
    try {
      installed = lstatSync(join(folder, "READY")).isFile();
    } catch { /* not installed */ }
    out.push({ ok: true, app: r.app, installed });
  }
  // Two apps on one port: neither can be told from the other, so both are damaged.
  const count = new Map();
  for (const e of out) if (e.ok) count.set(e.app.port, (count.get(e.app.port) || 0) + 1);
  return out.map((e) => (e.ok && count.get(e.app.port) > 1 ? { ok: false, slug: e.app.slug, problem: "port_shared" } : e));
}

// A path by its real location when it exists; else its longest existing parent's real path
// with the rest as given. Used for the config's own folders only.
export function realOrGiven(p) {
  let head = p;
  const rest = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...rest);
    } catch {
      const up = dirname(head);
      if (up === head) return p;
      rest.unshift(basename(head));
      head = up;
    }
  }
}

export function appPaths(cfg, slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) throw new Error("App Studio knows no app by that name.");
  const base = join(realOrGiven(cfg.paths.apps), slug);
  const run = join(realOrGiven(cfg.paths.appsRun), slug);
  const out = {
    code: join(realOrGiven(cfg.paths.appsCode), slug),
    deps: join(base, "deps"),
    store: join(base, "store"),
    data: join(base, "data"),
    tmp: join(base, "tmp"),
    home: join(base, "home"),
    run,
    appSock: join(run, "app.sock"),
    engineSock: join(run, "engine.sock"),
    log: join(realOrGiven(cfg.paths.appsLogs), `${slug}.log`),
  };
  for (const s of [out.appSock, out.engineSock]) {
    if (Buffer.byteLength(s) >= SOCKET_PATH_MAX) throw new Error(TOO_LONG);
  }
  return out;
}

// One good app by its slug → { app, installed }, or throws with the reason in words.
export function findApp(cfg, slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) throw new Error("no app is named that");
  const found = readManifests(cfg).find((e) => (e.ok ? e.app.slug : e.slug) === slug);
  if (!found) throw new Error(`no app is named ${slug}`);
  if (!found.ok) throw new Error(`the app ${slug} is damaged (${found.problem}); it is never started`);
  return { app: found.app, installed: found.installed };
}

function launch(argv) {
  if (argv.length !== 2 || argv[0] !== "--launch") throw new Error("usage: manifest.mjs --launch <slug>");
  // engine/config.json beside this folder, never a file named by the environment.
  const cfg = loadConfig({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "config.json") });
  const { app, installed } = findApp(cfg, argv[1]);
  const p = appPaths(cfg, app.slug);
  const lines = [
    ["code", p.code], ["deps", p.deps], ["store", p.store], ["data", p.data], ["tmp", p.tmp],
    ["home", p.home], ["run", p.run], ["entry", app.entry], ["memoryMb", String(app.memoryMb)],
    ["tools", app.tools.join(" ")], ["installed", installed ? "yes" : "no"],
  ];
  for (const [, v] of lines) {
    if (/[\u0000-\u001f\u007f]/.test(v)) throw new Error("an app path holds a control character");
  }
  process.stdout.write(lines.map(([k, v]) => `${k}=${v}\n`).join(""));
}

const self = fileURLToPath(import.meta.url);
let invoked = false;
try {
  invoked = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(self);
} catch { /* imported */ }
if (invoked) {
  try {
    launch(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`app-exec: ${String((err && err.message) || err).split("\n")[0]}\n`);
    process.exit(REFUSED_EXIT);
  }
}
