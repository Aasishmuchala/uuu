// The gate: the only door from fenced agents to the board (CONTRACTS section 6).
// It forwards a request only when it carries exactly one bearer token, is not on the
// refusal list, and, for a write, is on the allow-list with a body that passes the row's
// body rules (body.mjs). It never logs a header, a body or a query string.
// With `narrow: true` it is the narrow gate for a walled agent (PLAN-V5 K10, narrow.mjs):
// every rule above, and on top only its own tasks, decided from the board's own records.
import http from "node:http";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalisePath, refusal, allowRow } from "./rules.mjs";
import { BODY_LIMIT, bodyRefusal } from "./body.mjs";
import { narrowRoute, narrowBodyRefusal, ownership, createCache } from "./narrow.mjs";

const BEARER = /^bearer +\S+$/i;
const OVERRIDE_HEADERS = new Set(["x-http-method-override", "x-http-method", "x-method-override"]);
// The narrow gate's questions to the board: 5 seconds each, answers of at most 8 MB.
const ASK_TIMEOUT_MS = 5000;
const ASK_LIMIT = 8 * 1024 * 1024;

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

// Reads the whole request body. Resolves to a Buffer; to "too-big" once the body (declared
// or received) passes BODY_LIMIT, after which the rest is read and dropped (a sender that
// keeps going is cut off at 16 times the limit); or to null when the client went away.
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (value === "too-big") {
        let dropped = size;
        req.removeAllListeners("data");
        req.on("data", (c) => {
          dropped += c.length;
          if (dropped > 16 * BODY_LIMIT) req.socket.destroy();
        });
        req.resume();
      }
      resolve(value);
    };
    const declared = headerValues(req.rawHeaders, "content-length");
    if (declared.length > 0 && !(Number(declared[0]) <= BODY_LIMIT)) return settle("too-big");
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > BODY_LIMIT) return settle("too-big");
      chunks.push(c);
    });
    req.on("end", () => settle(Buffer.concat(chunks)));
    req.on("error", () => settle(null));
    req.on("close", () => settle(null));
  });
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

// For the narrow gate: true when any method-override header is present, and true when a
// request declares a body.
function hasOverride(rawHeaders) {
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (OVERRIDE_HEADERS.has(rawHeaders[i].toLowerCase())) return true;
  }
  return false;
}

function declaresBody(rawHeaders) {
  if (headerValues(rawHeaders, "transfer-encoding").length > 0) return true;
  return headerValues(rawHeaders, "content-length").some((v) => v.trim() !== "0");
}

// The narrow gate asks the board one question with the caller's own token. Resolves to
// { status, json } (json null when the answer is not JSON) or { error }.
function askBoard(boardHost, boardPort, token, path) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const req = http.get({ host: boardHost, port: boardPort, path, agent: false,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > ASK_LIMIT) {
          settle({ error: "too-big" });
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          json = null;
        }
        settle({ status: res.statusCode, json });
      });
      res.on("error", () => settle({ error: "read" }));
    });
    const timer = setTimeout(() => {
      settle({ error: "timeout" });
      req.destroy();
    }, ASK_TIMEOUT_MS);
    req.on("error", () => settle({ error: "down" }));
  });
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

// `narrow: true` builds the narrow listener; `narrowPort`, on the ordinary one, is only
// reported in its health answer so the part script knows to check the narrow one too.
export function createGate({ listenPort, boardPort, boardHost = "127.0.0.1", refusalLog, narrow = false,
  narrowPort = null, now = Date.now } = {}) {
  const cache = narrow ? createCache({ now }) : null;
  const ask = (token, path) => askBoard(boardHost, boardPort, token, path);

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

  // `body`, when given, is the whole body already read; it is sent as it was received.
  // `token`, on the narrow listener, is the caller's: a 401 from the board forgets it.
  function forward(req, res, body, token) {
    const upstream = http.request({
      host: boardHost,
      port: boardPort,
      method: req.method,
      path: req.url,
      headers: req.rawHeaders,
      setHost: false,
    });
    upstream.on("response", (up) => {
      if (cache && token && up.statusCode === 401) cache.drop(token);
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
    if (body) {
      upstream.end(body);
      return;
    }
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  }

  function refuse(req, res, path, rule) {
    logRefusal(req.method, path, rule);
    sendJson(res, 403, refusedBody(rule));
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
      if (narrow) sendJson(res, 200, { status: "ok", part: "gate", narrow: true, board });
      else if (Number.isInteger(narrowPort)) sendJson(res, 200, { status: "ok", part: "gate", board, narrowPort });
      else sendJson(res, 200, { status: "ok", part: "gate", board });
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
    // 4. Refusal list, then the allow-list for writes.
    const methods = methodsOf(req);
    for (const m of methods) {
      const rule = refusal(m, path, req.url);
      if (rule) {
        refuse(req, res, path, rule);
        return;
      }
    }
    // 4b. The narrow listener: only its own routes, spelt one way, no query, no override.
    let route = null;
    if (narrow) {
      route = narrowRoute(req.method, req.url, { overrides: hasOverride(req.rawHeaders), hasBody: declaresBody(req.rawHeaders) });
      if (route.rule) {
        refuse(req, res, path, route.rule);
        return;
      }
    }
    // 5. Body rules, for every allow-list row with a JSON body that any of the methods
    // matches. The file upload (body kind null) and reads are streamed as before.
    const kinds = [];
    for (const m of methods) {
      const row = allowRow(m, path);
      if (row && row[3] !== null && !kinds.includes(row[3])) kinds.push(row[3]);
    }
    if (kinds.length === 0) {
      if (narrow) {
        await forwardIfYours(req, res, path, route, null);
        return;
      }
      forward(req, res);
      return;
    }
    const body = await readBody(req);
    if (body === null) return;
    if (body === "too-big") {
      refuse(req, res, path, "bad-body");
      return;
    }
    for (const kind of kinds) {
      const rule = bodyRefusal(kind, path, req.rawHeaders, body);
      if (rule) {
        refuse(req, res, path, rule);
        return;
      }
    }
    if (narrow) {
      await forwardIfYours(req, res, path, route, body);
      return;
    }
    // 6. Forward: the bytes read are the bytes sent.
    forward(req, res, body);
  }

  // The narrow listener's last checks: the write body's keys, then whether the issue is the
  // caller's (asked of the board only now, so a request refused above never reaches it).
  async function forwardIfYours(req, res, path, route, body) {
    let value = null;
    if (route.write) {
      if (body.length > 0) {
        try {
          // As body.mjs read it: a byte-order mark is dropped.
          value = JSON.parse(new TextDecoder("utf-8").decode(body));
        } catch {
          refuse(req, res, path, "bad-body");
          return;
        }
      }
      const rule = narrowBodyRefusal(route.kind, value);
      if (rule) {
        refuse(req, res, path, rule);
        return;
      }
    }
    const token = headerValues(req.rawHeaders, "authorization")[0].trim().replace(/^bearer +/i, "");
    if (route.issueId !== null) {
      const { result, agentId } = await ownership(cache, token, route.issueId, ask);
      if (result === "no-token") {
        sendJson(res, 401, BODIES.noToken);
        return;
      }
      if (result === "board-down") {
        sendJson(res, 502, BODIES.boardDown);
        return;
      }
      if (result !== "yours") {
        refuse(req, res, path, "narrow-not-yours");
        return;
      }
      // A checkout names the agent taking the task: only the caller itself.
      if (route.kind === "checkout" && value && value.agentId !== undefined && value.agentId !== agentId) {
        refuse(req, res, path, "narrow-write");
        return;
      }
    }
    if (req.socket.destroyed) return;
    // A narrow read carries no body (refused above), so an empty one is sent.
    forward(req, res, route.write ? body : Buffer.alloc(0), token);
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
    cache,
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
  const refusalLog = join(cfg.paths.logs, "gate-refusals.log");
  // The narrow listener for a walled agent, when the config names its port.
  const narrowPort = Number.isInteger(cfg.ports.gateNarrow) ? cfg.ports.gateNarrow : null;
  const gate = createGate({
    listenPort: cfg.ports.gate,
    boardPort: cfg.ports.board,
    refusalLog,
    narrowPort,
  });
  try {
    await gate.listen();
  } catch (err) {
    console.log(`${new Date().toISOString()} gate could not start on 127.0.0.1:${cfg.ports.gate}: ${err.code || err.message}`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} gate started on 127.0.0.1:${cfg.ports.gate}, forwarding to 127.0.0.1:${cfg.ports.board}`);
  // The ordinary gate keeps serving every other agent when the narrow one cannot start;
  // its health then says the narrow door is not answering.
  let narrowGate = null;
  if (narrowPort !== null) {
    const g = createGate({ listenPort: narrowPort, boardPort: cfg.ports.board, refusalLog, narrow: true });
    try {
      await g.listen();
      narrowGate = g;
      console.log(`${new Date().toISOString()} narrow gate started on 127.0.0.1:${narrowPort}, forwarding to 127.0.0.1:${cfg.ports.board}`);
    } catch (err) {
      console.log(`${new Date().toISOString()} narrow gate could not start on 127.0.0.1:${narrowPort}: ${err.code || err.message}`);
    }
  }
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    await Promise.all([gate.close(), narrowGate ? narrowGate.close() : null]);
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
