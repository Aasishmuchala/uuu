// What the App Studio host's tests share (engine/apps/test/host-*.test.mjs): a temp state with
// apps copied from this fixture, the host started with an unfenced spawner, a fake generation
// door and a fake model relay on port 0 that check every token, and plain HTTP helpers that
// send exactly the headers a test names. Nothing here reads or writes the live engine's state.
// Short temp folders under /private/tmp keep every socket path under macOS's limit.
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCaller, headerValues } from "../../../doors/common.mjs";
import { checkToken } from "../../../relay/token.mjs";
import { createAppHost } from "../../host.mjs";

export const FIXTURE = dirname(fileURLToPath(import.meta.url));
export const NODE24 = realpathSync(join(userInfo().homedir, ".nvm", "versions", "node", "v24.13.0"));
export const NODE = join(NODE24, "bin", "node");
export const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function waitFor(fn, ms = 5000, every = 50) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await wait(every);
  }
}

// `count` free ports in a row on 127.0.0.1, from a random start.
export async function freePorts(count) {
  const free = (port) => new Promise((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });
  for (let tries = 0; tries < 50; tries += 1) {
    const first = 41000 + Math.floor(Math.random() * 18000);
    let ok = true;
    for (let p = first; p < first + count && ok; p += 1) ok = await free(p);
    if (ok) return first;
  }
  throw new Error("no free ports");
}

const secret = () => randomBytes(32).toString("hex");

// A temp world: state, secrets, and apps from the fixture. Each app: { slug, port, engine,
// tools, ready (default true), manifest (extra keys over the fixture's) }.
export function makeWorld({ prefix = "uuu-h-", apps = [], stateName = "s", portFirst, portLast } = {}) {
  const root = realpathSync(mkdtempSync(`/private/tmp/${prefix}`));
  const S = join(root, stateName);
  const code = join(root, "apps");
  mkdirSync(code, { recursive: true });
  mkdirSync(join(S, "secrets", "doors"), { recursive: true, mode: 0o700 });
  mkdirSync(join(S, "secrets", "provider"), { recursive: true, mode: 0o700 });
  const doorSecret = secret();
  const relaySecret = secret();
  const paths = {
    state: S, appsCode: code, apps: join(S, "apps"), appsState: join(S, "apps", "state.json"),
    appsStatus: join(S, "apps", "host-status.json"), appsRun: join(S, "run", "apps"), appsLogs: join(S, "logs", "apps"),
    generateSecret: join(S, "secrets", "doors", "generate-secret"), relaySecret: join(S, "secrets", "provider", "relay-secret"),
    fences: join(S, "fences"), ids: join(S, "ids.json"),
  };
  writeFileSync(paths.generateSecret, `${doorSecret}\n`, { mode: 0o600 });
  writeFileSync(paths.relaySecret, `${relaySecret}\n`, { mode: 0o600 });
  const world = {
    root, S, code, paths, doorSecret, relaySecret,
    cfg: {
      node24: NODE24, ports: { apps: 0, home: 3200 }, urls: { generate: "http://127.0.0.1:9", relay: "http://127.0.0.1:9" },
      appPorts: { first: portFirst ?? 3171, last: portLast ?? 3189 }, paths, doors: { generate: { apps: [] } },
    },
    addApp(a) {
      const folder = join(code, a.slug);
      mkdirSync(folder, { recursive: true });
      const m = JSON.parse(readFileSync(join(FIXTURE, "app.json"), "utf8"));
      Object.assign(m, { slug: a.slug, name: a.name || `App ${a.slug}`, port: a.port }, a.engine ? { engine: a.engine } : {},
        a.tools ? { tools: a.tools } : {}, a.manifest || {});
      writeFileSync(join(folder, "app.json"), JSON.stringify(m));
      copyFileSync(join(FIXTURE, "icon.svg"), join(folder, "icon.svg"));
      copyFileSync(join(FIXTURE, "server.mjs"), join(folder, "server.mjs"));
      if (a.ready !== false) writeFileSync(join(folder, "READY"), "");
      world.cfg.doors.generate.apps.push(a.slug);
      return folder;
    },
    // The owner's switches, as the home server writes them (K17).
    switches(on, changedAt = new Date().toISOString()) {
      mkdirSync(paths.apps, { recursive: true, mode: 0o700 });
      const apps = {};
      for (const [slug, v] of Object.entries(on)) apps[slug] = { on: v };
      const tmp = `${paths.appsState}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, apps, changedAt }), { mode: 0o600 });
      rmSync(paths.appsState, { force: true });
      copyFileSync(tmp, paths.appsState);
      rmSync(tmp);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  for (const a of apps) world.addApp(a);
  return world;
}

// The fixture run unfenced, as the host's own spawner would run app-exec: its own group, pipes.
// `extra(slug)` adds variables (FIXTURE_MODE, …); `spawned` records each start.
export function fixtureSpawner(world, extra = () => ({})) {
  const spawned = [];
  const fn = (slug, env) => {
    const folder = join(world.code, slug);
    spawned.push({ slug, env });
    return spawn(NODE, [join(folder, "server.mjs")], {
      cwd: folder, detached: true, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...extra(slug) },
    });
  };
  fn.spawned = spawned;
  return fn;
}

// A fake generation door and a fake relay, each checking every token the way the real ones do:
// the door with checkCaller (its own secret, `apps` its list: an app token is kind p), the relay
// with checkToken (its secret; kind t, subject app-<slug>). Each records what reached it.
export async function fakeParts(world, { now = () => Date.now() } = {}) {
  const calls = [];
  const door = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const auth = headerValues(req.rawHeaders, "authorization");
      const token = auth.length === 1 ? auth[0].replace(/^Bearer /, "") : null;
      const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath: world.paths.generateSecret, idsPath: world.paths.ids,
        agents: [], apps: world.cfg.doors.generate.apps, now: now() });
      const body = Buffer.concat(chunks);
      calls.push({ part: "door", method: req.method, url: req.url, headers: req.rawHeaders, token, who, bytes: body.length });
      if (typeof who !== "object" || who.kind !== "p") {
        res.writeHead(401, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ code: "gen_no_token", why: who }));
      }
      if (req.url.endsWith("/output")) {
        const size = Number(process.env.FAKE_OUTPUT_BYTES || 5 * 1024 * 1024);
        res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": size, "Set-Cookie": "door=1", "X-Door": "1" });
        return void res.end(Buffer.alloc(size, 7));
      }
      const text = JSON.stringify({ ok: true, app: who.app, url: req.url, bytes: body.length });
      res.writeHead(req.method === "POST" && req.url === "/gen/app/jobs" ? 202 : 200, {
        "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), "Set-Cookie": "door=1",
        "X-Door": "1", "Cache-Control": "no-store",
      });
      res.end(text);
    });
  });
  const relay = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const auth = headerValues(req.rawHeaders, "authorization");
      const token = auth.length === 1 ? auth[0].replace(/^Bearer /, "") : null;
      const who = token ? checkToken(world.relaySecret, token, now()) : null;
      const body = Buffer.concat(chunks);
      calls.push({ part: "relay", method: req.method, url: req.url, headers: req.rawHeaders, token, who, bytes: body.length });
      if (!who) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return void res.end(JSON.stringify({ code: "relay_no_token" }));
      }
      res.writeHead(200, { "Content-Type": "application/json", "X-Relay": "1", "Set-Cookie": "relay=1" });
      res.end(JSON.stringify({ type: "message", content: [{ type: "text", text: `hello ${who.subject}` }], stop_reason: "end_turn" }));
    });
  });
  await new Promise((ok) => door.listen(0, "127.0.0.1", ok));
  await new Promise((ok) => relay.listen(0, "127.0.0.1", ok));
  world.cfg.urls.generate = `http://127.0.0.1:${door.address().port}`;
  world.cfg.urls.relay = `http://127.0.0.1:${relay.address().port}`;
  return {
    calls, door, relay,
    close: () => Promise.all([door, relay].map((s) => new Promise((ok) => { s.closeAllConnections(); s.close(() => ok()); }))),
  };
}

// The host on a world, with every log line kept.
export async function startHost(world, opts = {}) {
  const lines = [];
  const host = createAppHost({ cfg: world.cfg, log: (l) => lines.push(l), ...opts });
  await host.listen();
  return { host, lines };
}

// One request with exactly these headers (Host included), to a port or a unix socket.
// → { status, headers (raw), body (Buffer) } or { error }.
export function send({ port, socketPath, path = "/", method = "GET", headers = {}, body, timeoutMs = 10000 }) {
  return new Promise((ok) => {
    const flat = [];
    for (const [k, v] of Object.entries(headers)) {
      for (const one of Array.isArray(v) ? v : [v]) flat.push(k, String(one));
    }
    const target = socketPath ? { socketPath } : { host: "127.0.0.1", port };
    const req = http.request({ ...target, method, path, headers: flat, agent: false, setHost: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => ok({ status: res.statusCode, headers: res.rawHeaders, body: Buffer.concat(chunks) }));
      res.on("error", (e) => ok({ error: e.code || "error" }));
    });
    req.on("error", (e) => ok({ error: e.code || "error" }));
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
    req.end(body);
  });
}

// The headers a browser sends for the app's own page asking its own server.
export const own = (port, extra = {}) => ({ Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin", ...extra });

// What the app printed, as the host keeps it.
export function appOutput(world, slug) {
  try {
    return readFileSync(join(world.paths.appsLogs, `${slug}.log`), "utf8");
  } catch {
    return "";
  }
}

export const header = (raw, name) => headerValues(raw, name.toLowerCase());
export const jsonOf = (r) => JSON.parse(r.body.toString("utf8"));
export const exists = (p) => existsSync(p);

// Is a process (by pid) alive?
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
