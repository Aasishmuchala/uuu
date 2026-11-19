// The home server core (CONTRACTS 9): safety rules, the error shape, static files, module discovery,
// and the `ctx` every handler gets. It holds the owner's rights, so every request is treated as hostile:
// it binds 127.0.0.1 only, checks Host, needs the same-origin headers on anything that changes state,
// caps bodies (2 MB, or a route's own limit up to 16 MB), never reflects an answer from the board or the bench, and never logs a key.
// The seats (PLAN-DESKTOP T7, lib/seats.mjs): the same server on five more 127.0.0.1 ports, one per PC the owner allowed
// through the remote door. A request's seat is known only from the port it arrived on; its Host must be the Mac's own
// address as the PC's browser sends it (127.0.0.1:3200), and a seat with no `allowed` record is refused everything.
// A change from a seat is refused, its body unread, unless the seat is `desk` and the route is in DESK_MAY.
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readManifests } from "../../../apps/manifest.mjs";
import { headerOverflow } from "../../../lib/overflow.mjs";
import { closeFinishedBatches } from "./batches.mjs";
import { createBoard } from "./board.mjs";
import { createBench } from "./bench.mjs";
import { createDecisions } from "./decisions.mjs";
import { HomeError, fail, internalError } from "./errors.mjs";
import { loadModules } from "./loader.mjs";
import { createRouter, MAX_ROUTE_BODY } from "./router.mjs";
import { macOnly, seatFor, seatMayChange, seatMayRead, seatPorts, seatUnknown } from "./seats.mjs";
import { FILE_RESPONSE, PLACEHOLDER_HTML, parseRangeHeader, resolveStatic, streamFile } from "./static.mjs";
import { createUnstick } from "./unstick.mjs";

export const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MAX_BODY = 2 * 1024 * 1024;

const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
};
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:";
// The loft's photographs on the Map and Needs you (assets/office/v<digits>/) and the room headers' glimpses cut from
// them (assets/glimpse/v<digits>/) are kept by the browser for a year instead of `no-store`: they would otherwise be
// read and decoded again on every visit. A file in these folders is never edited in place: a changed set is a new
// folder (v2), and each set's manifest test pins every file's SHA-256. The 3D world's folders (assets/world/, three.js)
// left this rule with the dead 3D assets, removed after the owner chose photographs, 18 Nov 2026. Every page, every
// other file and every API answer stays `no-store`.
const KEPT_FOLDERS = /^\/assets\/office\/v\d+\/|^\/assets\/glimpse\/v\d+\//;
const KEPT_HEADERS = { ...BASE_HEADERS, "cache-control": "private, max-age=31536000, immutable" };
const SAFE_METHODS = new Set(["GET", "HEAD"]);
// A route may send the browser on to one of the home screen's own pages (a 303 with `location`, as the Higgsfield
// sign-in's return does, T79): only a path of this server's own, never another address.
const OWN_PAGE = /^\/#\/[A-Za-z0-9/?=&_-]{0,200}$/;
const seeOther = (out) => (out.status === 303 && typeof out.location === "string" && OWN_PAGE.test(out.location) ? { location: out.location } : {});

// "2 MB", "3 MB", "2.5 MB", "512 KB": the limit as the owner reads it.
function sizeWords(bytes) {
  const MB = 1024 * 1024;
  if (bytes >= MB) return `${Number((bytes / MB).toFixed(1))} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

// The home page's content policy (PLAN-V5 K17, T78): the core's, and when App Studio has apps, `frame-src` naming
// each good manifest's own address (127.0.0.1 and localhost) and nothing else, so the home screen may frame its apps
// and no other page. Worked out once at start; a manifest added later is framed after the next start.
export function contentPolicy(config) {
  let ports = [];
  try {
    ports = [...new Set(readManifests(config).filter((e) => e.ok).map((e) => e.app.port))].sort((a, b) => a - b);
  } catch { ports = []; }
  if (!ports.length) return CSP;
  return `${CSP}; frame-src ${ports.map((p) => `http://127.0.0.1:${p} http://localhost:${p}`).join(" ")}`;
}

function defaultLog(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function readIds(file) {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

// options: config (from loadConfig), port (0 = any), urls ({ board, gate, bench }; gate may be null),
// publicDir, moduleDirs (folders holding routes/ inbox/ search/), proveCommand ([cmd, ...args]), log,
// seats (true: also listen on the seat ports; false: never; unset: only when the home listens on its own config port).
export async function createHome(options) {
  const config = options.config;
  const log = options.log || defaultLog;
  const urls = { ...config.urls, ...(options.urls || {}) };
  const publicDir = options.publicDir || join(config.engineDir, "home", "public");
  const ids = () => readIds(config.paths.ids);
  const htmlPolicy = contentPolicy(config);
  let listenPort = null;

  const board = createBoard({ baseUrl: urls.board, ids, companyName: config.paperclip.companyName, log });
  const bench = createBench({
    baseUrl: urls.bench, site: config.bench.site, keyFile: config.paths.benchOwnerKey, booksDir: config.paths.books, log,
  });
  const decisions = createDecisions(join(config.paths.homeData, "decisions.json"), { log });

  const proveCommand = options.proveCommand || [join(config.engineDir, "bin", "engine"), "prove"];
  const prove = {
    running: false,
    start() {
      if (this.running) throw new HomeError(409, "The proof is already running.", "Wait a minute, then look at Health again.", "prove_running");
      if (!existsSync(proveCommand[0])) throw new HomeError(409, "The proof is not installed yet.", "Finish setting up the engine, then try again.", "prove_missing");
      const child = spawn(proveCommand[0], proveCommand.slice(1), { cwd: config.engineDir, detached: true, stdio: "ignore" });
      this.running = true;
      child.on("exit", (code) => { this.running = false; log(`proof finished with exit ${code}`); });
      child.on("error", () => { this.running = false; log("proof could not start"); });
      child.unref();
    },
  };

  const router = createRouter();
  const moduleDirs = options.moduleDirs || [SERVER_DIR];
  const loaded = await loadModules({ dirs: moduleDirs, router, log });

  // The hold sweep (lib/unstick.mjs): made here, started only by main.mjs (or a test that asks). Each sweep also
  // closes the generation batches of tasks the board shows cancelled (lib/batches.mjs, T48 F4; not done, T49f N1).
  const unstick = createUnstick({ board, ids, decisions, log, onIssues: (issues) => closeFinishedBatches(config, issues, { log }) });
  const home = {
    urls, prove, inboxSources: loaded.inbox, searchSources: loaded.search, modulesFailed: loaded.failed,
    port: () => listenPort, publicDir, unstick,
  };

  function send(res, status, payload, extra = {}) {
    const text = JSON.stringify(payload);
    res.writeHead(status, { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), ...extra });
    res.end(text);
  }
  function sendError(res, e, extra) {
    send(res, e.status, e.toBody(), extra);
  }

  function tooLarge(limit) {
    return new HomeError(413, "That is too large to send.", `Keep what you send under ${sizeWords(limit)}.`, "too_large");
  }

  // limit: the matched route's own body limit (C3 33.1), or MAX_BODY.
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers["content-length"]);
      if (Number.isFinite(declared) && declared > limit) {
        reject(tooLarge(limit));
        return;
      }
      const chunks = [];
      let size = 0;
      let done = false;
      req.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > limit) {
          done = true;
          reject(tooLarge(limit));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString("utf8")); } });
      req.on("error", () => { if (!done) { done = true; reject(new HomeError(400, "The request was cut off.", "Try again.", "bad_request")); } });
    });
  }

  // Refuse a request whose body is never read: the body is dropped as it comes (never kept), and the answer
  // goes out when it ends, or when the client stops sending to wait for an answer, or at a cap past which the
  // connection is closed. Answering while the client is still sending would close the connection under it,
  // and the client would lose the answer.
  function refuseUnread(req, res, e) {
    if (req.readableEnded) return sendError(res, e, { connection: "close" });
    let dropped = 0;
    let idle = null;
    const answer = () => { clearTimeout(idle); clearTimeout(timer); if (!res.headersSent) sendError(res, e, { connection: "close" }); };
    const timer = setTimeout(() => { answer(); req.destroy(); }, 10000);
    const waitIdle = () => { clearTimeout(idle); idle = setTimeout(answer, 500); };
    req.on("data", (c) => {
      dropped += c.length;
      if (dropped > 2 * MAX_ROUTE_BODY) { answer(); req.destroy(); return; }
      waitIdle();
    });
    req.on("end", answer);
    req.on("error", () => { clearTimeout(idle); clearTimeout(timer); });
    waitIdle();
    req.resume();
  }

  // On a seat port the browser is the PC's, which reaches the Mac's home through its own 127.0.0.1:<home port>.
  function hostAllowed(hostHeader, onSeat) {
    const p = onSeat ? config.ports.home : listenPort;
    return hostHeader === `127.0.0.1:${p}` || hostHeader === `localhost:${p}`;
  }

  function sameOrigin(req) {
    const ct = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (ct !== "application/json") return false;
    if (req.headers["x-engine"] !== "1") return false;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${req.headers.host}`) return false;
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") return false;
    return true;
  }

  // onSeat: the request came in on one of the seat listeners; which seat comes from its local port alone.
  async function handle(req, res, onSeat = false) {
    const raw = req.url || "/";
    if (!raw.startsWith("/")) return sendError(res, new HomeError(400, "The home screen could not read this address.", "Open the home screen again.", "bad_path"));
    const qAt = raw.indexOf("?");
    const pathname = qAt === -1 ? raw : raw.slice(0, qAt);
    const qs = qAt === -1 ? "" : raw.slice(qAt + 1);

    if (!hostAllowed(req.headers.host, onSeat)) {
      return sendError(res, new HomeError(421, "This address is not the home screen.",
        `Open http://127.0.0.1:${onSeat ? config.ports.home : listenPort} instead.`, "wrong_host"), { connection: "close" });
    }
    const method = req.method;
    let seat = null;
    if (onSeat) {
      const found = seatFor(req.socket.localPort, config);
      if (!found || !found.role) return SAFE_METHODS.has(method) ? sendError(res, seatUnknown()) : refuseUnread(req, res, seatUnknown());
      seat = { n: found.n, role: found.role };
    }
    if (!SAFE_METHODS.has(method) && !sameOrigin(req)) {
      // Its body is never read: dropped as it comes, then answered (refuseUnread), so a large one still sees the 403.
      return refuseUnread(req, res, new HomeError(403, "This request did not come from the home screen, so it was refused.",
        "Use the home screen itself to do this.", "not_same_origin"));
    }

    // The route is found before any body is read: an unknown address is answered 404 at once.
    const notFound = () => new HomeError(404, "There is nothing here.", "Go back to the inbox.", "not_found");
    const isApi = pathname === "/healthz" || pathname.startsWith("/api/");
    if (seat) {
      // A seat's change is refused before its body is read, and before an unknown address is answered 404.
      const sm = isApi ? router.match(method, pathname) : null;
      const route = sm && sm.handler ? `${method} ${sm.pattern}` : null;
      if (!SAFE_METHODS.has(method)) {
        if (!seatMayChange(seat, route)) return refuseUnread(req, res, macOnly());
      } else if (!seatMayRead(seat, route)) {
        return sendError(res, macOnly());
      }
    }
    if (!isApi) {
      if (!SAFE_METHODS.has(method)) return refuseUnread(req, res, notFound());
      const found = await resolveStatic(publicDir, pathname);
      const isHtml = (t) => t.startsWith("text/html");
      if (found) {
        const headers = isHtml(found.type) ? { ...BASE_HEADERS, "content-security-policy": htmlPolicy }
          : KEPT_FOLDERS.test(pathname) ? KEPT_HEADERS : BASE_HEADERS;
        return streamFile(res, found, headers, method === "HEAD");
      }
      if (pathname === "/" || pathname === "/index.html") {
        const body = Buffer.from(PLACEHOLDER_HTML);
        res.writeHead(200, { ...BASE_HEADERS, "content-security-policy": htmlPolicy, "content-type": "text/html; charset=utf-8", "content-length": body.length });
        return res.end(method === "HEAD" ? undefined : body);
      }
      return sendError(res, notFound());
    }

    const m = router.match(method, pathname);
    if (!m || !m.handler) {
      if (SAFE_METHODS.has(method)) return sendError(res, notFound());
      return refuseUnread(req, res, notFound());
    }

    let rawBody = "";
    if (!SAFE_METHODS.has(method)) {
      try {
        rawBody = await readBody(req, m.maxBody ?? MAX_BODY);
      } catch (e) {
        // Read and drop the rest (up to a cap) so the client sees the answer, then close.
        const answer = () => { if (!res.headersSent) sendError(res, e, { connection: "close" }); };
        let dropped = 0;
        const timer = setTimeout(() => { answer(); req.destroy(); }, 10000);
        req.on("data", (c) => { dropped += c.length; if (dropped > 8 * MAX_BODY) { clearTimeout(timer); answer(); req.destroy(); } });
        req.on("end", () => { clearTimeout(timer); answer(); });
        req.on("error", () => clearTimeout(timer));
        if (req.readableEnded) { clearTimeout(timer); answer(); }
        req.resume();
        return;
      }
    }

    let body = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return sendError(res, new HomeError(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_json"));
      }
    }
    const query = {};
    for (const [k, v] of new URLSearchParams(qs)) if (!(k in query)) query[k] = v;

    // One byte range, parsed here (null when there is none or it is not one plain range); the raw header is never passed on.
    const range = parseRangeHeader(req.headers.range);
    const ctx = { params: m.params, query, body, range, config, board, bench, decisions, ids, log, fail, home, seat };
    try {
      const out = await m.handler(ctx);
      if (out && typeof out === "object" && typeof out.status === "number" && "body" in out) return send(res, out.status, out.body, seeOther(out));
      if (out && typeof out === "object" && out[FILE_RESPONSE]) return streamFile(res, out[FILE_RESPONSE], { ...BASE_HEADERS, ...(out.headers || {}) }, false);
      return send(res, 200, out ?? {});
    } catch (e) {
      if (e instanceof HomeError) {
        if (e.status >= 500) log(`${method} ${pathname} -> ${e.status} ${e.code}`);
        return sendError(res, e);
      }
      log(`${method} ${pathname} failed: ${String(e?.stack || e).split("\n").slice(0, 3).join(" | ")}`);
      return sendError(res, internalError());
    }
  }

  function makeServer(onSeat) {
    const s = http.createServer((req, res) => {
      handle(req, res, onSeat).catch((e) => {
        log(`request failed: ${String(e?.message || e).split("\n")[0]}`);
        if (!res.headersSent) sendError(res, internalError());
        else res.destroy();
      });
    });
    s.headersTimeout = 20000;
    s.requestTimeout = 60000;
    // Headers over Node's limit (huge cookies a page left for 127.0.0.1) are answered 431 with the cookies cleared (T58d).
    s.on("clientError", headerOverflow);
    return s;
  }
  const server = makeServer(false);
  const seatServers = [];

  // One listener per seat port, on 127.0.0.1 only. A port that will not open is logged and left closed: the
  // Mac's own port is never held back by a seat's.
  async function listenSeats() {
    for (const { n, port } of seatPorts(config)) {
      if (port === listenPort) continue;
      const s = makeServer(true);
      try {
        await new Promise((resolve, reject) => {
          s.once("error", reject);
          s.listen(port, "127.0.0.1", () => { s.off("error", reject); resolve(); });
        });
      } catch (e) {
        log(`seat ${n}: port ${port} could not open (${e?.code || "error"})`);
        continue;
      }
      if (s.address()?.address !== "127.0.0.1") { s.close(); log(`seat ${n}: port ${port} was not on 127.0.0.1, so it was closed`); continue; }
      seatServers.push(s);
    }
  }

  return {
    server, home, config, seatServers,
    get port() { return listenPort; },
    get url() { return `http://127.0.0.1:${listenPort}`; },
    async listen(port = options.port ?? config.ports.home) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          listenPort = server.address().port;
          resolve(listenPort);
        });
      });
      if (options.seats ?? (port === config.ports.home)) await listenSeats();
      return listenPort;
    },
    close() {
      unstick.stop();
      const shut = (s) => new Promise((resolve) => { s.closeAllConnections?.(); s.close(() => resolve()); });
      return Promise.all([shut(server), ...seatServers.splice(0).map(shut)]).then(() => undefined);
    },
  };
}
