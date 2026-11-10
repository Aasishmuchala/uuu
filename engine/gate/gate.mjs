// The gate: the only door from fenced agents to the board (CONTRACTS section 6).
// It forwards a request only when it carries exactly one bearer token and is not on the
// refusal list. It never logs a header, a body or a query string.
import http from "node:http";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalisePath, refusal } from "./rules.mjs";

const BEARER = /^bearer +\S+$/i;
const OVERRIDE_HEADERS = new Set(["x-http-method-override", "x-http-method", "x-method-override"]);

const BODIES = {
  badPath: { error: "The gate could not read this address.", code: "gate_bad_path" },
  noToken: { error: "The gate needs an agent token.", code: "gate_no_token" },
  boardDown: { error: "The board is not answering.", code: "gate_board_down" },
};
const refusedBody = (rule) => ({ error: "The gate does not let agents do this.", code: "gate_refused", rule });

// Header names and values from rawHeaders, so duplicates are seen (req.headers drops them).
function headerValues(rawHeaders, name) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === name) out.push(rawHeaders[i + 1]);
  }
  return out;
}

function hasOneBearer(rawHeaders) {
  const values = headerValues(rawHeaders, "authorization");
  return values.length === 1 && BEARER.test(values[0]);
}

function wantsUpgrade(rawHeaders) {
  if (headerValues(rawHeaders, "upgrade").length > 0) return true;
  return headerValues(rawHeaders, "connection").some((v) => /(^|,)\s*upgrade\s*(,|$)/i.test(v));
}

// The request's own method plus any method-override header value. A request is refused
// when any of them is refused, so an override cannot turn a refused write into a read.
function methodsOf(req) {
  const methods = [req.method];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (OVERRIDE_HEADERS.has(req.rawHeaders[i].toLowerCase())) {
      for (const m of req.rawHeaders[i + 1].split(",")) methods.push(m.trim().toUpperCase() || "UNKNOWN");
    }
  }
  return methods;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    Connection: "close",
  });
  res.end(text);
}

function socketJson(socket, status, reason, body) {
  const text = JSON.stringify(body);
  const head = `HTTP/1.1 ${status} ${reason}\r\nContent-Type: application/json; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(text)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`;
  // Stop reading at once: bytes the client sends after this never get parsed or forwarded.
  socket.pause();
  socket.removeAllListeners("data");
  if (socket.writable) {
    socket.end(head + text, () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  } else {
    socket.destroy();
  }
}

function checkBoard(boardHost, boardPort) {
  return new Promise((resolve) => {
    const req = http.get({ host: boardHost, port: boardPort, path: "/api/health", agent: false, timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? "up" : "down");
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve("down"));
  });
}

export function createGate({ listenPort, boardPort, boardHost = "127.0.0.1", refusalLog } = {}) {
  function logRefusal(method, path, rule) {
    if (!refusalLog) return;
    try {
      mkdirSync(dirname(refusalLog), { recursive: true });
      appendFileSync(refusalLog, `${new Date().toISOString()} ${method} ${path} ${rule}\n`);
    } catch {
      // A refusal still happens when the log cannot be written.
    }
  }

  function isHealth(req) {
    const q = req.url.indexOf("?");
    const p = q === -1 ? req.url : req.url.slice(0, q);
    return req.method === "GET" && p === "/gate/health";
  }

  function forward(req, res) {
    const upstream = http.request({
      host: boardHost,
      port: boardPort,
      method: req.method,
      path: req.url,
      headers: req.rawHeaders,
      setHost: false,
    });
    upstream.on("response", (up) => {
      res.writeHead(up.statusCode, up.statusMessage, up.rawHeaders);
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      up.pipe(res);
      up.on("error", () => res.destroy());
    });
    upstream.on("error", () => {
      if (!res.headersSent) sendJson(res, 502, BODIES.boardDown);
      else res.destroy();
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  }

  async function onRequest(req, res) {
    // Upgrades are never let through, with or without a token.
    if (wantsUpgrade(req.rawHeaders)) {
      logRefusal(req.method, normalisePath(req.url) ?? "-", "upgrade");
      sendJson(res, 403, refusedBody("upgrade"));
      return;
    }
    // 1. The gate's own health.
    if (isHealth(req)) {
      const board = await checkBoard(boardHost, boardPort);
      sendJson(res, 200, { status: "ok", part: "gate", board });
      return;
    }
    // 2. Path check. CONNECT and any target that is not origin-form are unreadable.
    const path = req.method === "CONNECT" ? null : normalisePath(req.url);
    if (path === null) {
      sendJson(res, 400, BODIES.badPath);
      return;
    }
    // 3. Token check.
    if (!hasOneBearer(req.rawHeaders)) {
      sendJson(res, 401, BODIES.noToken);
      return;
    }
    // 4. Refusal list.
    for (const m of methodsOf(req)) {
      const rule = refusal(m, path);
      if (rule) {
        logRefusal(req.method, path, rule);
        sendJson(res, 403, refusedBody(rule));
        return;
      }
    }
    // 5. Forward.
    forward(req, res);
  }

  const server = http.createServer(onRequest);
  server.on("upgrade", (req, socket) => {
    logRefusal(req.method, normalisePath(req.url) ?? "-", "upgrade");
    socketJson(socket, 403, "Forbidden", refusedBody("upgrade"));
  });
  server.on("connect", (_req, socket) => {
    socketJson(socket, 400, "Bad Request", BODIES.badPath);
  });
  // Requests Node itself cannot parse get Node's own 400 and a closed socket (the default
  // clientError handling), which never writes a second response on the same socket.

  return {
    server,
    get port() {
      const a = server.address();
      return a && typeof a === "object" ? a.port : null;
    },
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", () => {
          server.off("error", reject);
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function main() {
  const { loadConfig } = await import("../lib/config.mjs");
  const cfg = loadConfig();
  const gate = createGate({
    listenPort: cfg.ports.gate,
    boardPort: cfg.ports.board,
    refusalLog: join(cfg.paths.logs, "gate-refusals.log"),
  });
  try {
    await gate.listen();
  } catch (err) {
    console.log(`${new Date().toISOString()} gate could not start on 127.0.0.1:${cfg.ports.gate}: ${err.code || err.message}`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} gate started on 127.0.0.1:${cfg.ports.gate}, forwarding to 127.0.0.1:${cfg.ports.board}`);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    await gate.close();
    console.log(`${new Date().toISOString()} gate stopped (${signal})`);
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
    console.log(`${new Date().toISOString()} gate failed: ${err.message}`);
    process.exit(1);
  });
}
