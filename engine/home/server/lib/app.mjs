// The home server core (CONTRACTS 9): safety rules, the error shape, static files, module discovery,
// and the `ctx` every handler gets. It holds the owner's rights, so every request is treated as hostile:
// it binds 127.0.0.1 only, checks Host, needs the same-origin headers on anything that changes state,
// caps bodies (2 MB, or a route's own limit up to 16 MB), never reflects an answer from the board or the bench, and never logs a key.
import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBoard } from "./board.mjs";
import { createBench } from "./bench.mjs";
import { createDecisions } from "./decisions.mjs";
import { HomeError, fail, internalError } from "./errors.mjs";
import { loadModules } from "./loader.mjs";
import { createRouter, MAX_ROUTE_BODY } from "./router.mjs";
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
const SAFE_METHODS = new Set(["GET", "HEAD"]);

// "2 MB", "3 MB", "2.5 MB", "512 KB": the limit as the owner reads it.
function sizeWords(bytes) {
  const MB = 1024 * 1024;
  if (bytes >= MB) return `${Number((bytes / MB).toFixed(1))} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024)} KB`;
  return `${bytes} bytes`;
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
// publicDir, moduleDirs (folders holding routes/ inbox/ search/), proveCommand ([cmd, ...args]), log.
export async function createHome(options) {
  const config = options.config;
  const log = options.log || defaultLog;
  const urls = { ...config.urls, ...(options.urls || {}) };
  const publicDir = options.publicDir || join(config.engineDir, "home", "public");
  const ids = () => readIds(config.paths.ids);
  let listenPort = null;

  const board = createBoard({ baseUrl: urls.board, ids, companyName: config.paperclip.companyName, log });
  const bench = createBench({
    baseUrl: urls.bench, site: config.bench.site, keyFile: config.paths.benchOwnerKey, booksDir: config.paths.books, log,
  });
  const decisions = createDecisions(join(config.paths.homeData, "decisions.json"));

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

  // The hold sweep (lib/unstick.mjs): made here, started only by main.mjs (or a test that asks).
  const unstick = createUnstick({ board, ids, decisions, log });
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

  function hostAllowed(hostHeader) {
    const p = listenPort;
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

  async function handle(req, res) {
    const raw = req.url || "/";
    if (!raw.startsWith("/")) return sendError(res, new HomeError(400, "The home screen could not read this address.", "Open the home screen again.", "bad_path"));
    const qAt = raw.indexOf("?");
    const pathname = qAt === -1 ? raw : raw.slice(0, qAt);
    const qs = qAt === -1 ? "" : raw.slice(qAt + 1);

    if (!hostAllowed(req.headers.host)) {
      return sendError(res, new HomeError(421, "This address is not the home screen.",
        `Open http://127.0.0.1:${listenPort} instead.`, "wrong_host"), { connection: "close" });
    }
    const method = req.method;
    if (!SAFE_METHODS.has(method) && !sameOrigin(req)) {
      // Its body is never read: dropped as it comes, then answered (refuseUnread), so a large one still sees the 403.
      return refuseUnread(req, res, new HomeError(403, "This request did not come from the home screen, so it was refused.",
        "Use the home screen itself to do this.", "not_same_origin"));
    }

    // The route is found before any body is read: an unknown address is answered 404 at once.
    const notFound = () => new HomeError(404, "There is nothing here.", "Go back to the inbox.", "not_found");
    const isApi = pathname === "/healthz" || pathname.startsWith("/api/");
    if (!isApi) {
      if (!SAFE_METHODS.has(method)) return refuseUnread(req, res, notFound());
      const found = await resolveStatic(publicDir, pathname);
      const isHtml = (t) => t.startsWith("text/html");
      if (found) {
        return streamFile(res, found, isHtml(found.type) ? { ...BASE_HEADERS, "content-security-policy": CSP } : BASE_HEADERS, method === "HEAD");
      }
      if (pathname === "/" || pathname === "/index.html") {
        const body = Buffer.from(PLACEHOLDER_HTML);
        res.writeHead(200, { ...BASE_HEADERS, "content-security-policy": CSP, "content-type": "text/html; charset=utf-8", "content-length": body.length });
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
    const ctx = { params: m.params, query, body, range, config, board, bench, decisions, ids, log, fail, home };
    try {
      const out = await m.handler(ctx);
      if (out && typeof out === "object" && typeof out.status === "number" && "body" in out) return send(res, out.status, out.body);
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

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log(`request failed: ${String(e?.message || e).split("\n")[0]}`);
      if (!res.headersSent) sendError(res, internalError());
      else res.destroy();
    });
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 60000;

  return {
    server, home, config,
    get port() { return listenPort; },
    get url() { return `http://127.0.0.1:${listenPort}`; },
    listen(port = options.port ?? config.ports.home) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          listenPort = server.address().port;
          resolve(listenPort);
        });
      });
    },
    close() {
      unstick.stop();
      return new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
    },
  };
}
