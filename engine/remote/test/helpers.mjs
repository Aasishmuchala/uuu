// Shared by the remote door's tests. Everything here follows PLAN-DESKTOP rule 3: 127.0.0.1 only, ports from
// 47000 up, a temporary state folder and keys made for the test and deleted after. The door is run with
// ENGINE_REMOTE_LOOPBACK=1, so it listens on 127.0.0.1 and lets in 127.0.0.0/8 only.
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer, connect } from "node:net";
import { request as httpRequest, createServer as httpServer } from "node:http";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintOf, remotePaths, writeKeys, writeSeats } from "../state.mjs";

export const REMOTE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_DIR = join(REMOTE_DIR, "..");
export const PART = join(ENGINE_DIR, "parts", "41-remote.sh");
export const CLI = join(REMOTE_DIR, "remote.mjs");
export const OWNER = userInfo().username;
const SSH = "/usr/bin/ssh";
const realConfig = JSON.parse(readFileSync(join(ENGINE_DIR, "config.json"), "utf8"));

// True when nothing listens on 127.0.0.1:<port> and it can be bound.
function bindable(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

const taken = new Set();
// <count> consecutive free ports from 47000 up (never 3100 to 3299, never live's).
export async function freeBlock(count) {
  for (let tries = 0; tries < 400; tries++) {
    const base = 47000 + Math.floor(Math.random() * 2900);
    let ok = true;
    for (let p = base; p < base + count && ok; p++) ok = !taken.has(p) && (await bindable(p));
    if (ok) {
      for (let p = base; p < base + count; p++) taken.add(p);
      return base;
    }
  }
  throw new Error("no free ports");
}

// A temporary state and config: every port a stand-in from 47000 up, the door's included.
export async function makeWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "remote-test-")));
  const state = join(root, "state");
  mkdirSync(state, { mode: 0o700 });
  const cfg = JSON.parse(JSON.stringify(realConfig));
  cfg.stateRoot = state;
  cfg.node24 = dirname(dirname(process.execPath));
  for (const k of Object.keys(cfg.ports)) cfg.ports[k] = await freeBlock(1);
  cfg.ports.preview = await freeBlock(10);
  cfg.ports.seats = await freeBlock(5);
  cfg.ports.remote = await freeBlock(1);
  const cfgPath = join(root, "config.json");
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const keys = join(root, "keys");
  mkdirSync(keys, { mode: 0o700 });
  const env = { ...process.env, ENGINE_CONFIG: cfgPath, ENGINE_REMOTE_LOOPBACK: "1" };
  const world = {
    root, state, cfg, cfgPath, keys, env,
    seatPort: (n) => cfg.ports.seats + n - 1,
    remoteDir: join(state, "remote"),
    // Runs `engine remote <args>` (the command's own program) with stdin not a terminal.
    cli: (args, input = "") => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env, input, timeout: 60000 }),
    // The same at a terminal: a pseudo-terminal answers `answer` once the command asks.
    tty: (args, answer = "yes") => onTerminal([process.execPath, CLI, ...args], answer, env),
    part: (sub) => spawnSync("/bin/bash", [PART, sub], { encoding: "utf8", env, timeout: 60000 }),
    key: (name, type = "ed25519") => newKey(keys, name, type),
    cleanup: () => {
      spawnSync("/bin/bash", [PART, "stop"], { encoding: "utf8", env, timeout: 60000 });
      rmSync(root, { recursive: true, force: true });
    },
  };
  return world;
}

// A client key made for the test (deleted with the world). Returns its private path and its base64 public key.
export function newKey(dir, name, type = "ed25519") {
  const path = join(dir, name);
  const args = type === "rsa" ? ["-t", "rsa", "-b", "2048"] : ["-t", "ed25519"];
  const r = spawnSync("/usr/bin/ssh-keygen", ["-q", ...args, "-N", "", "-C", "test", "-f", path], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  const pub = readFileSync(path + ".pub", "utf8").trim().split(" ");
  return { path, type: pub[0], key: pub[1], line: `${pub[0]} ${pub[1]}` };
}

// Runs a command on a pseudo-terminal; types `answer` after the first line that asks for yes.
const PTY = `
import os, sys, pty, select
answer = sys.argv[1].encode() + b"\\n"
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[2], sys.argv[2:])
buf = b""
sent = False
while True:
    r, _, _ = select.select([fd], [], [], 60)
    if not r:
        break
    try:
        d = os.read(fd, 4096)
    except OSError:
        break
    if not d:
        break
    buf += d
    if not sent and b"Type yes" in buf:
        os.write(fd, answer)
        sent = True
sys.stdout.buffer.write(buf)
_, st = os.waitpid(pid, 0)
sys.exit(os.WEXITSTATUS(st) if os.WIFEXITED(st) else 1)
`;
export function onTerminal(argv, answer, env) {
  const r = spawnSync("/usr/bin/python3", ["-I", "-c", PTY, answer, ...argv], { encoding: "utf8", env, timeout: 120000 });
  // the terminal echoes what was typed and ends lines with CR LF
  return { status: r.status, stdout: (r.stdout || "").replace(/\r\n/g, "\n") };
}

// Snapshot of every file under a folder: name -> bytes (as base64), to prove nothing changed.
export function snapshot(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[p] = readFileSync(p).toString("base64") + ":" + (statSync(p).mode & 0o777).toString(8);
      else out[p] = "other";
    }
  };
  walk(dir);
  return out;
}

// HTTP stubs on stand-in ports; each records the ports it was reached on.
export async function stubs(ports) {
  const hits = [];
  const servers = await Promise.all(ports.map((p) => new Promise((resolve, reject) => {
    const s = httpServer((req, res) => { hits.push(p); res.end(`ok ${p}`); });
    s.once("error", reject);
    s.listen(p, "127.0.0.1", () => resolve(s));
  })));
  return { hits, close: () => Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }))) };
}

// GET http://127.0.0.1:<port>/ ; resolves to the status code, or 0 when the connection fails or closes.
export function httpCode(port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("timeout", () => { req.destroy(); resolve(0); });
    req.on("error", () => resolve(0));
    req.end();
  });
}

export function listening(port) {
  return new Promise((resolve) => {
    const c = connect(port, "127.0.0.1");
    c.on("connect", () => { c.destroy(); resolve(true); });
    c.on("error", () => resolve(false));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(150);
  }
  return Boolean(await fn());
}

// The PC's argument list, read from the kit's ssh-args.txt and filled in as open.ps1 fills it, with this Mac's
// stand-ins: the PC's own listening ports (3200, 3160 to 3189) become free ports here, and the preview's ports
// on the far side become the world's stand-in preview ports. Returns { args, local } where local maps each of
// the PC's ports to the port the test listens on.
export async function pcArgs(world, { kitFiles, key, seat, known, extra = [] }) {
  const empty = join(world.root, "empty");
  writeFileSync(empty, "");
  const lines = readFileSync(join(kitFiles, "ssh-args.txt"), "utf8").split("\n").filter((l) => l !== "");
  const local = {};
  const base = await freeBlock(31);
  let next = base;
  const fill = (s) => s.replaceAll("{KEY}", key).replaceAll("{KNOWN}", known || join(kitFiles, "known_hosts"))
    .replaceAll("{EMPTY}", empty).replaceAll("{SEATPORT}", String(world.seatPort(seat)))
    .replaceAll("{USER}", OWNER).replaceAll("{HOST}", "127.0.0.1");
  const args = [];
  for (const raw of lines) {
    const line = fill(raw);
    const m = /^-L 127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)$/.exec(line);
    if (m) {
      const pc = Number(m[1]);
      let far = Number(m[2]);
      if (far >= 3160 && far <= 3169) far = world.cfg.ports.preview + (far - 3160);
      local[pc] = next++;
      args.push("-L", `127.0.0.1:${local[pc]}:127.0.0.1:${far}`);
      continue;
    }
    const sp = line.indexOf(" ");
    if (sp > 0 && line.startsWith("-")) {
      // as open.ps1 does: ssh splits an -o value at spaces unless it is quoted
      let value = line.slice(sp + 1);
      const o = /^([A-Za-z]+)=(.+)$/.exec(value);
      if (o && value.includes(" ")) value = `${o[1]}="${o[2]}"`;
      args.push(line.slice(0, sp), value);
    } else {
      args.push(line);
    }
  }
  for (const [farPort, name] of extra) {
    local[name] = next++;
    args.splice(args.length - 1, 0, "-L", `127.0.0.1:${local[name]}:127.0.0.1:${farPort}`);
  }
  return { args, local };
}

// Starts ssh in the background; returns { proc, out(), done }.
export function startSsh(args) {
  const proc = spawn(SSH, args, { stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  proc.stdout.on("data", (d) => { text += d; });
  proc.stderr.on("data", (d) => { text += d; });
  const done = new Promise((r) => proc.on("exit", (code) => r(code)));
  return { proc, out: () => text, done };
}

export function runSsh(args, bin = SSH) {
  return spawnSync(bin, args, { encoding: "utf8", timeout: 30000 });
}

// Seats written straight into the state, as `engine remote kit` and `allow` write them.
//   seed(world, [{ n, role, key (base64) or null }])
export function seed(world, list) {
  const paths = remotePaths(world.cfg);
  const seats = [];
  const keys = {};
  for (const { n, role = "desk", key = null } of list) {
    seats.push({ n, name: "Windows PC", role, state: key ? "allowed" : "waiting", fingerprint: key ? fingerprintOf(key) : null,
      added: new Date().toISOString() });
    if (key) keys[n] = key;
  }
  writeSeats(paths, seats);
  writeKeys(paths, keys);
  return paths;
}
