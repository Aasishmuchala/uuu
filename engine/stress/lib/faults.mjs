// The stage's parts table and the fault server (PLAN-STRESS, pinned interfaces). A fault replaces a part with a
// small server on the part's own port(s):
//   off         nothing listens (no server is started at all)
//   slow3/30    the part's health shape, after 3 s / 30 s, on any path
//   500         status 500 with a JSON error
//   badjson     200 with `{"oops`
//   cut         half a body, then the socket is closed
//   wrongshape  200 `{}`
//   html        200 `<html>`
//   reset       the socket is destroyed at once
// Built-in modules only.
import http from "node:http";

export const BASES = Object.freeze([4300, 4400, 4500, 4600, 4700, 4800]);
export const MODES = Object.freeze(["off", "slow3", "slow30", "500", "badjson", "cut", "wrongshape", "html", "reset"]);

// Offsets from the stage's base port. `seats` is seat 1's port (five in a row, base+2 to base+6) and `remote` the
// Windows door's, both held free and bound only if the stage turns them on. Fakes (provider, runway, runway-mcp, higgsfield, internet) take port 0.
export const OFFSETS = Object.freeze({
  board: 1, seats: 2, gate: 10, gateNarrow: 11, remote: 15, relay: 20, web: 30, generate: 40, viewer: 50, preview: 60,
  apps: 70, brain: 90, benchWeb: 91, benchSocketio: 92, benchRedisQueue: 93, benchRedisCache: 94, benchDb: 95, home: 99,
});
export const PREVIEW_SITES = Object.freeze({ first: 61, last: 69 });
export const APP_PORTS = Object.freeze({ first: 71, last: 89 });

// The eleven parts, in start order. `ports`: the port keys the part holds; `health`: [port key, path];
// `shape`: what a healthy answer looks like (for the slow faults). The gate and the narrow gate are one process,
// as on the live engine (engine/gate/gate.mjs main), so `shares` names the other.
export const PARTS = Object.freeze({
  board: { ports: ["board"], health: ["board", "/api/health"], shape: { status: "ok", version: "stub", deploymentMode: "local_trusted" } },
  books: { ports: ["benchWeb"], health: ["benchWeb", "/api/method/ping"], shape: { message: "pong" } },
  gate: { ports: ["gate", "gateNarrow"], health: ["gate", "/gate/health"], shape: { status: "ok", part: "gate", board: "ok" }, shares: "gateNarrow" },
  gateNarrow: { ports: ["gate", "gateNarrow"], health: ["gateNarrow", "/gate/health"], shape: { status: "ok", part: "gate", narrow: true, board: "ok" }, shares: "gate" },
  relay: { ports: ["relay"], health: ["relay", "/relay/health"], shape: { status: "ok", part: "relay", mode: "default", key: true } },
  web: { ports: ["web"], health: ["web", "/web/health"], shape: { status: "ok", part: "web", on: false } },
  generate: { ports: ["generate"], health: ["generate", "/gen/health"], shape: { status: "ok", part: "generate", on: false, key: true, higgsfield: false } },
  viewer: { ports: ["viewer", "preview"], health: ["viewer", "/view/health"], shape: { status: "ok", part: "viewer", on: false, chrome: true } },
  apps: { ports: ["apps"], health: ["apps", "/apps/health"], shape: { status: "ok", part: "apps", apps: [] } },
  brain: { ports: ["brain"], health: ["brain", "/brain/health"], shape: { part: "brain", ok: true, on: false } },
  home: { ports: ["home"], health: ["home", "/healthz"], shape: { ok: true } },
});
export const PART_NAMES = Object.freeze(Object.keys(PARTS));

// Every port a stage of this base binds or may bind (benchDb is never bound, but is kept free too).
export function portsOf(base) {
  const out = {};
  for (const [k, off] of Object.entries(OFFSETS)) out[k] = base + off;
  return out;
}

// startFaultServer({ ports: [n...], mode, shape }) -> { close() }. Listens on 127.0.0.1 only.
export async function startFaultServer({ ports, mode, shape = { status: "ok" } }) {
  if (!MODES.includes(mode)) throw new Error(`stage: fault ${mode} is not one of ${MODES.join(", ")}`);
  if (mode === "off") return { close: async () => {} };
  const timers = new Set();
  const sockets = new Set();
  const handler = (req, res) => {
    req.resume();
    const json = (status, body) => {
      const text = typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
      res.end(text);
    };
    switch (mode) {
      case "slow3":
      case "slow30": {
        const t = setTimeout(() => { timers.delete(t); if (!res.destroyed) json(200, shape); }, mode === "slow3" ? 3000 : 30000);
        timers.add(t);
        return;
      }
      case "500": return json(500, { error: { message: "The stage's fault server answers 500." }, code: "stress_fault" });
      case "badjson": {
        res.writeHead(200, { "content-type": "application/json", "content-length": 6 });
        return res.end('{"oops');
      }
      case "cut": {
        const whole = JSON.stringify(shape);
        res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(whole) });
        res.write(whole.slice(0, Math.max(1, Math.floor(whole.length / 2))));
        return void setTimeout(() => res.socket && res.socket.destroy(), 20);
      }
      case "wrongshape": return json(200, {});
      case "html": {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": 6 });
        return res.end("<html>");
      }
      case "reset": return void (req.socket && req.socket.destroy());
      default: return json(500, {});
    }
  };
  const servers = [];
  try {
    for (const port of ports) {
      const s = http.createServer(handler);
      s.on("connection", (sock) => {
        sockets.add(sock);
        sock.on("close", () => sockets.delete(sock));
        if (mode === "reset") sock.destroy();
      });
      await new Promise((resolve, reject) => { s.once("error", reject); s.listen(port, "127.0.0.1", resolve); });
      servers.push(s);
    }
  } catch (e) {
    for (const s of servers) s.close();
    throw e;
  }
  return {
    async close() {
      for (const t of timers) clearTimeout(t);
      for (const sock of sockets) sock.destroy();
      await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r()))));
    },
  };
}
