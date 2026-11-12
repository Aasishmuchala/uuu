// The model relay: the only way from fenced agents to the model provider (CONTRACTS C4).
// It runs unfenced and trusts nothing an agent sends (docs/adr/0007). It forwards a call only
// when it is a POST on one of three model paths, carries exactly one valid relay token, the
// mode and the files of the state folder allow it, and the body is one JSON object. In a
// request it changes only the credential headers and the `model` field; in an answer it
// changes nothing. It never logs a header, a body, a query string, a key or a token.
import http from "node:http";
import https from "node:https";
import { appendFileSync, chmodSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { checkToken } from "./token.mjs";
import { readIds, readKey, readModelState, readSecret } from "./state.mjs";
import { PROVIDER_ORIGIN, checkOrigin } from "./upstream.mjs";

const MB = 1024 * 1024;
export const DEFAULT_LIMITS = {
  bodyBytes: 32 * MB,       // a request body, declared or received
  firstByteMs: 120_000,     // from sending the call to the start of the answer
  idleMs: 300_000,          // without a byte from the provider once the answer has started
  totalMs: 1_800_000,       // one call, end to end
  statusEveryMs: 2_000,     // the status file is written at most this often
  countJsonBytes: 4 * MB,   // a JSON answer is read for its token counts only up to this size
};

const PATHS = new Set(["/v1/messages", "/v1/messages/count_tokens", "/v1/responses"]);
const MESSAGES_PATHS = new Set(["/v1/messages", "/v1/messages/count_tokens"]);
const QUERY_RE = /^[A-Za-z0-9=&_.-]{0,200}$/;
const BEARER = /^bearer +(\S+)$/i;
const JSON_TYPE = /^application\/json\s*(;.*)?$/i;
const NUMBER = /^[0-9]{1,9}$/;
// Request headers that never reach the provider; the relay sets host, content-length and
// the real key itself.
const DROP = new Set(["authorization", "x-api-key", "proxy-authorization", "cookie", "chatgpt-account-id",
  "host", "content-length", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te",
  "upgrade", "expect"]);
const DROP_RE = /(api-?key|auth-token|access-token|secret)/i;

const REFUSALS = {
  relay_refused: ["permission_error", "The model relay does not take this kind of request."],
  relay_not_found: ["not_found_error", "The model relay has no such address."],
  relay_no_token: ["authentication_error", "The model relay needs a valid agent token."],
  relay_off: ["permission_error", "The model relay is off for agents: the provider is not switched on."],
  relay_no_key: ["permission_error", "No provider key is saved. Paste it in Settings on the home screen."],
  relay_no_pick: ["permission_error", "No model is picked for this agent. Open Settings on the home screen."],
  relay_bad_body: ["invalid_request_error", "The model relay takes only one JSON object with the type application/json."],
  relay_too_big: ["request_too_large", "This request is too big for the model relay."],
  relay_upstream_down: ["api_error", "The model provider is not answering."],
};
const refusalBody = (code) => ({ type: "error", error: { type: REFUSALS[code][0], message: REFUSALS[code][1] }, code });

// Header values from rawHeaders, so duplicates are seen (req.headers drops or joins them).
function headerValues(rawHeaders, name) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === name) out.push(rawHeaders[i + 1]);
  }
  return out;
}

function bearerOf(rawHeaders) {
  const values = headerValues(rawHeaders, "authorization");
  if (values.length !== 1) return null;
  const m = BEARER.exec(values[0]);
  return m ? m[1] : null;
}

function wantsUpgrade(rawHeaders) {
  if (headerValues(rawHeaders, "upgrade").length > 0) return true;
  return headerValues(rawHeaders, "connection").some((v) => /(^|,)\s*upgrade\s*(,|$)/i.test(v));
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
  // Stop reading at once: bytes the client sends after this are never parsed or forwarded.
  socket.pause();
  socket.removeAllListeners("data");
  if (socket.writable) {
    socket.end(head + text, () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  } else {
    socket.destroy();
  }
}

// Reads the whole request body. Resolves to a Buffer; to "too-big" once the body (declared
// or received) passes `limit`, after which the rest is read and dropped (a sender that keeps
// going is cut off at twice the limit); or to null when the client went away.
function readBody(req, limit) {
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
          if (dropped > 2 * limit) req.socket.destroy();
        });
        req.resume();
      }
      resolve(value);
    };
    const declared = headerValues(req.rawHeaders, "content-length");
    if (declared.length > 0 && !(Number(declared[0]) <= limit)) return settle("too-big");
    req.on("data", (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) return settle("too-big");
      chunks.push(c);
    });
    req.on("end", () => settle(Buffer.concat(chunks)));
    req.on("error", () => settle(null));
    req.on("close", () => settle(null));
  });
}

const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);

// Watches an answer's bytes for token counts without touching them. Returns null when the
// answer is compressed or neither JSON nor a stream: then only the request is counted.
function usageWatcher(headers, jsonLimit) {
  if (headers["content-encoding"] !== undefined) return null;
  const type = String(headers["content-type"] || "").toLowerCase();
  const found = { input: null, output: null };
  const take = (u) => {
    if (u === null || typeof u !== "object") return;
    if (count(u.input_tokens) !== null) found.input = u.input_tokens;
    if (count(u.output_tokens) !== null) found.output = u.output_tokens;
  };
  if (type.startsWith("text/event-stream")) {
    // The last value of each count seen in a `data:` line, at the top level, under
    // `message` or under `response`.
    const decoder = new StringDecoder("utf8");
    let line = "";
    let skipping = false;
    const onLine = (text) => {
      const t = text.endsWith("\r") ? text.slice(0, -1) : text;
      if (!t.startsWith("data:")) return;
      let ev;
      try { ev = JSON.parse(t.slice(5)); } catch { return; }
      if (ev === null || typeof ev !== "object") return;
      take(ev.usage);
      if (ev.message && typeof ev.message === "object") take(ev.message.usage);
      if (ev.response && typeof ev.response === "object") take(ev.response.usage);
    };
    return {
      feed(chunk) {
        const parts = decoder.write(chunk).split("\n");
        for (let i = 0; i < parts.length - 1; i += 1) {
          if (!skipping) onLine(line + parts[i]);
          line = "";
          skipping = false;
        }
        line += parts[parts.length - 1];
        if (line.length > MB) { line = ""; skipping = true; }
      },
      result() {
        if (!skipping && line) onLine(line + decoder.end());
        return found;
      },
    };
  }
  if (type.startsWith("application/json")) {
    const chunks = [];
    let size = 0;
    return {
      feed(chunk) {
        size += chunk.length;
        if (size <= jsonLimit) chunks.push(chunk);
      },
      result() {
        if (size > jsonLimit) return found;
        try { take(JSON.parse(Buffer.concat(chunks).toString("utf8")).usage); } catch { /* not JSON */ }
        return found;
      },
    };
  }
  return null;
}

export function createRelay({ listenPort, upstream, paths, log, now, limits } = {}) {
  const up = checkOrigin(upstream);
  for (const k of ["state", "ids", "key", "secret", "status"]) {
    if (!paths || typeof paths[k] !== "string" || !paths[k]) throw new Error(`createRelay: paths.${k} is needed`);
  }
  const lim = { ...DEFAULT_LIMITS, ...(limits || {}) };
  const clock = typeof now === "function" ? now : typeof now === "number" ? () => now : () => Date.now();
  const iso = () => new Date(clock()).toISOString();
  // `log` is a function given each line, or a file the lines are appended to.
  const say = (line) => {
    try {
      if (typeof log === "function") log(line);
      else if (typeof log === "string" && log) appendFileSync(log, `${line}\n`);
    } catch {
      // A log failure changes nothing.
    }
  };
  // The relay's own connection pool: proxy variables are never honoured.
  const agent = up.protocol === "https:" ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
  const hostHeader = (up.protocol === "https:" && up.port === 443) ? up.hostname : `${up.hostname}:${up.port}`;
  const calls = new Set();
  let closing = false;

  // ---- the status file ----------------------------------------------------
  const status = { startedAt: null, provider: { state: "unknown", at: null, retryAfterSec: null }, agents: Object.create(null) };
  let statusTimer = null;
  let lastWrite = 0;
  function writeStatus() {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    lastWrite = Date.now();
    const dir = dirname(paths.status);
    const tmp = join(dir, `.relay-status.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(tmp, `${JSON.stringify(status)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(tmp, paths.status);
    } catch {
      try { unlinkSync(tmp); } catch { /* nothing was left */ }
    }
  }
  function statusChanged() {
    if (statusTimer) return;
    const wait = Math.max(0, lastWrite + lim.statusEveryMs - Date.now());
    statusTimer = setTimeout(writeStatus, wait);
    statusTimer.unref();
  }
  function noteProvider(code, retryAfter) {
    let state = null;
    if (code === null) state = "unreachable";
    else if (code >= 200 && code < 300) state = "ok";
    else if (code === 401 || code === 403) state = "refused";
    else if (code === 429) state = "limited";
    if (state === null) return;
    const ra = state === "limited" && typeof retryAfter === "string" && NUMBER.test(retryAfter.trim()) ? Number(retryAfter.trim()) : null;
    status.provider = { state, at: iso(), retryAfterSec: ra };
    statusChanged();
  }
  function noteAgent(slug, code, usage) {
    const a = status.agents[slug] || (status.agents[slug] = { requests: 0, inputTokens: 0, outputTokens: 0, lastStatus: null, lastAt: null });
    a.requests += 1;
    if (usage && usage.input !== null) a.inputTokens += usage.input;
    if (usage && usage.output !== null) a.outputTokens += usage.output;
    a.lastStatus = code;
    a.lastAt = iso();
    statusChanged();
  }

  // ---- answers --------------------------------------------------------------
  function refuse(res, status_, code) {
    say(`${iso()} refused ${code}`);
    sendJson(res, status_, refusalBody(code));
  }

  function health(res) {
    const st = readModelState(paths.state);
    sendJson(res, 200, { status: "ok", part: "relay", mode: st.ok ? st.mode : "unreadable", key: readKey(paths.key) !== null });
  }

  // Sends the call once and passes the answer back as it comes. No retry, ever.
  function forward(req, res, { path, slug, pick, key, body, kind }) {
    const started = Date.now();
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (DROP.has(name) || DROP_RE.test(name)) continue;
      headers.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    headers.push("host", hostHeader, "content-length", String(body.length));
    if (MESSAGES_PATHS.has(path)) headers.push("x-api-key", key);
    else headers.push("authorization", `Bearer ${key}`);

    const mod = up.protocol === "https:" ? https : http;
    const call = mod.request({
      host: up.hostname,
      port: up.port,
      servername: up.protocol === "https:" ? up.hostname : undefined,
      method: "POST",
      path: req.url,
      headers,
      setHost: false,
      agent,
    });
    calls.add(call);
    let answered = null;   // the provider's status once its answer started
    let watcher = null;
    let finished = false;
    let idleTimer = null;
    const firstTimer = setTimeout(() => call.destroy(new Error("no answer")), lim.firstByteMs);
    const totalTimer = setTimeout(() => { call.destroy(); res.destroy(); }, lim.totalMs);
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { call.destroy(); res.destroy(); }, lim.idleMs);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      calls.delete(call);
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (answered === null) return;
      const usage = watcher ? watcher.result() : null;
      if (kind === "a") noteAgent(slug, answered, usage);
      say(`${iso()} call ${slug} ${path} ${answered} ${Date.now() - started}ms model=${pick}`);
    };

    call.on("response", (ans) => {
      clearTimeout(firstTimer);
      answered = ans.statusCode;
      noteProvider(ans.statusCode, ans.headers["retry-after"]);
      watcher = usageWatcher(ans.headers, lim.countJsonBytes);
      res.writeHead(ans.statusCode, ans.statusMessage, ans.rawHeaders);
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      touch();
      ans.on("data", (c) => {
        touch();
        if (watcher) {
          try { watcher.feed(c); } catch { watcher = null; }
        }
      });
      ans.pipe(res);
      ans.on("error", () => res.destroy());
      ans.on("end", finish);
    });
    call.on("error", () => {
      if (answered === null) {
        // A caller that went away says nothing about the provider.
        if (!clientGone && !closing) noteProvider(null);
        if (!res.headersSent) refuse(res, 502, "relay_upstream_down");
        else res.destroy();
        finished = true;
        calls.delete(call);
        clearTimeout(firstTimer);
        clearTimeout(totalTimer);
      } else {
        res.destroy();
      }
    });
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableFinished) {
        clientGone = true;
        call.destroy();
      }
      finish();
    });
    call.end(body);
  }

  async function onRequest(req, res) {
    // 1. Upgrades are never let through, with or without a token.
    if (wantsUpgrade(req.rawHeaders)) return refuse(res, 403, "relay_refused");
    const q = req.url.indexOf("?");
    const path = q === -1 ? req.url : req.url.slice(0, q);
    // 2. The relay's own health: only the mode and whether a key is saved.
    if (req.method === "GET" && path === "/relay/health") return health(res);
    // 3. Only POST on the three model paths, as sent: no decoding, no normalising.
    if (req.method !== "POST" || !PATHS.has(path) || (q !== -1 && !QUERY_RE.test(req.url.slice(q + 1)))) {
      return refuse(res, 404, "relay_not_found");
    }
    // 4. Exactly one bearer token that the secret accepts.
    const token = bearerOf(req.rawHeaders);
    const secret = token === null ? null : readSecret(paths.secret);
    const who = secret === null ? null : checkToken(secret, token, clock());
    if (!who) return refuse(res, 401, "relay_no_token");
    // 5. The mode: a test token works in either mode, an agent token only in provider mode.
    const st = readModelState(paths.state);
    if (!st.ok || (who.kind === "a" && st.mode !== "provider")) return refuse(res, 403, "relay_off");
    // 6. The key, read now and kept only for this call.
    const key = readKey(paths.key);
    if (key === null) return refuse(res, 403, "relay_no_key");
    // 7. Who calls, and the model picked for them.
    let slug = null;
    if (who.kind === "t") {
      slug = who.subject;
    } else {
      const ids = readIds(paths.ids);
      const slugs = ids ? Object.keys(ids).filter((s) => ids[s] === who.subject) : [];
      if (slugs.length === 1) slug = slugs[0];
    }
    const pick = slug === null ? undefined : st.picks[slug];
    if (pick === undefined) return refuse(res, 403, "relay_no_pick");
    // 8 and 9. One JSON object, within the size limit.
    const types = headerValues(req.rawHeaders, "content-type");
    if (types.length !== 1 || !JSON_TYPE.test(types[0])) return refuse(res, 400, "relay_bad_body");
    const raw = await readBody(req, lim.bodyBytes);
    if (raw === null) return undefined;
    if (raw === "too-big") return refuse(res, 413, "relay_too_big");
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { body = null; }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return refuse(res, 400, "relay_bad_body");
    // 10 and 11. The model is the pick, whatever the body asked for; then forward once.
    body.model = pick;
    return forward(req, res, { path, slug, pick, key, body: Buffer.from(JSON.stringify(body), "utf8"), kind: who.kind });
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 400, refusalBody("relay_bad_body"));
      else res.destroy();
    });
  });
  server.on("upgrade", (_req, socket) => {
    say(`${iso()} refused relay_refused`);
    socketJson(socket, 403, "Forbidden", refusalBody("relay_refused"));
  });
  server.on("connect", (_req, socket) => {
    say(`${iso()} refused relay_refused`);
    socketJson(socket, 400, "Bad Request", refusalBody("relay_refused"));
  });
  // Requests Node itself cannot parse get Node's own 400 and a closed socket.

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
          status.startedAt = iso();
          writeStatus();
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        closing = true;
        for (const c of calls) c.destroy();
        agent.destroy();
        const done = () => {
          if (status.startedAt) writeStatus();
          resolve();
        };
        if (!server.listening) return done();
        server.close(done);
        server.closeAllConnections();
      });
    },
  };
}

// Makes a folder with mode 0700, or sets that mode when it is already there.
function ownFolder(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

async function main() {
  const { loadConfig } = await import("../lib/config.mjs");
  const cfg = loadConfig();
  const p = cfg.paths;
  ownFolder(p.models);
  ownFolder(p.providerSecrets);
  try {
    writeFileSync(p.relaySecret, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  const relay = createRelay({
    listenPort: cfg.ports.relay,
    upstream: PROVIDER_ORIGIN,
    paths: { state: p.modelsState, ids: p.ids, key: p.providerKey, secret: p.relaySecret, status: p.relayStatus },
    log: (line) => console.log(line),
  });
  try {
    await relay.listen();
  } catch (err) {
    console.log(`${new Date().toISOString()} relay could not start on 127.0.0.1:${cfg.ports.relay}: ${err.code || err.message}`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} relay started on 127.0.0.1:${cfg.ports.relay}`);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    await relay.close();
    console.log(`${new Date().toISOString()} relay stopped (${signal})`);
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
    console.log(`${new Date().toISOString()} relay failed: ${err.message}`);
    process.exit(1);
  });
}
