// The model relay: the only way from fenced agents to the model provider (CONTRACTS C4).
// It runs unfenced and trusts nothing an agent sends (docs/adr/0007). It forwards a call only
// when it is a POST on one of three model paths, carries exactly one valid relay token, the
// mode and the files of the state folder allow it, and the body is one JSON object. In a
// request it changes only the credential headers, the `model` field and `accept-encoding`
// (always `identity`, so the answer can be scanned); in an answer it changes nothing, except
// that an answer holding the provider key is withheld or cut before the key is passed on.
// It never logs a header, a body, a query string, a key or a token.
// An app (a test token whose subject is `app-<slug>`, minted only by App Studio's host) is counted
// as carefully as an agent, under its own name, and is refused while Models is set to plans: an
// app's thinking is never spent on a saved key the owner did not switch on (docs/adr/0016).
import http from "node:http";
import https from "node:https";
import { appendFileSync, chmodSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { checkToken } from "./token.mjs";
import { MODEL_RE, readIds, readKey, readModelState, readSecret } from "./state.mjs";
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
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const APP_TIMES = 1000;   // an app's call times kept, the newest, all within a day
const APP_LINES = 20;     // apps with a line in the status file, the most recently heard
const isApp = (who) => who.kind === "t" && who.subject.startsWith("app-");
// Request headers that never reach the provider; the relay sets host, content-length and
// the real key itself.
const DROP = new Set(["authorization", "x-api-key", "proxy-authorization", "cookie", "chatgpt-account-id",
  "host", "content-length", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te",
  "upgrade", "expect", "accept-encoding"]);
const DROP_RE = /(api-?key|auth-token|access-token|secret)/i;

const REFUSALS = {
  relay_refused: ["permission_error", "The model relay does not take this kind of request."],
  relay_not_found: ["not_found_error", "The model relay has no such address."],
  relay_no_token: ["authentication_error", "The model relay needs a valid agent token."],
  relay_off: ["permission_error", "The model relay is off for agents: the provider is not switched on."],
  relay_app_plans: ["permission_error", "Models is set to plans, so an app's thinking is not sent. Switch Models to your own key in Settings to let apps think."],
  relay_no_key: ["permission_error", "No provider key is saved. Paste it in Settings on the home screen."],
  relay_no_pick: ["permission_error", "No model is picked for this agent. Open Settings on the home screen."],
  relay_bad_body: ["invalid_request_error", "The model relay takes only one JSON object with the type application/json."],
  relay_too_big: ["request_too_large", "This request is too big for the model relay."],
  relay_upstream_down: ["api_error", "The model provider is not answering."],
  relay_key_in_answer: ["api_error", "The provider's answer was withheld because it held the provider key."],
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

// True when this answer's head may be written as it came: a final status from 200 to 999 (a
// 1xx is never a model answer) and a reason without control characters (the header lines
// were already checked by the parser).
function writableHead(a) {
  return Number.isInteger(a.statusCode) && a.statusCode >= 200 && a.statusCode <= 999 &&
    (a.statusMessage === undefined || !/[^\t\x20-\x7e\x80-\xff]/.test(a.statusMessage));
}

// The spellings of the key the answer is scanned for: as written, escaped inside a JSON
// string (with and without `/` escaped as `\/`), and percent-encoded. Each distinct one once.
export function keyForms(key) {
  const json = JSON.stringify(key).slice(1, -1);
  return [...new Set([key, json, json.replaceAll("/", "\\/"), encodeURIComponent(key)])];
}

// True when any of the texts holds any of the key's forms.
function holdsKey(texts, forms) {
  return texts.some((t) => typeof t === "string" && forms.some((f) => t.includes(f)));
}

// The length of the longest tail of `buf` that is the start of `key` (at most key length - 1).
function keyPrefixTail(buf, key) {
  for (let n = Math.min(key.length - 1, buf.length); n > 0; n -= 1) {
    const at = buf.length - n;
    if (buf[at] === key[0] && buf.compare(key, 0, n, at, buf.length) === 0) return n;
  }
  return 0;
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
  const status = { startedAt: null, provider: { state: "unknown", at: null, retryAfterSec: null }, agents: Object.create(null), apps: Object.create(null) };
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

  // An app's line: its counts as an agent's, the times (whole seconds) of its calls in the last day,
  // and its last refusal (a code of the relay's own, and when). Nothing it sent is kept.
  function appLine(name) {
    const now = clock();
    for (const line of Object.values(status.apps)) {
      while (line.times.length && line.times[0] * 1000 <= now - DAY_MS) line.times.shift();
    }
    if (!Object.hasOwn(status.apps, name)) {
      const names = Object.keys(status.apps);
      if (names.length >= APP_LINES) {
        const heard = (n) => Math.max(Date.parse(status.apps[n].lastAt || "") || 0, Date.parse(status.apps[n].refused?.at || "") || 0);
        delete status.apps[names.reduce((a, b) => (heard(b) < heard(a) ? b : a))];
      }
      status.apps[name] = { requests: 0, inputTokens: 0, outputTokens: 0, lastStatus: null, lastAt: null, times: [], refused: null };
    }
    return status.apps[name];
  }
  function noteApp(name, code, usage) {
    const a = appLine(name);
    a.requests += 1;
    if (usage && usage.input !== null) a.inputTokens += usage.input;
    if (usage && usage.output !== null) a.outputTokens += usage.output;
    a.lastStatus = code;
    a.lastAt = iso();
    a.times.push(Math.floor(clock() / 1000));
    if (a.times.length > APP_TIMES) a.times.splice(0, a.times.length - APP_TIMES);
    statusChanged();
  }
  function noteAppRefused(name, code) {
    const a = appLine(name);
    a.refused = { code, at: iso(), count: (a.refused ? a.refused.count : 0) + 1 };
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

  // Sends the call once and passes the answer back as it comes. No retry, ever. `model` is
  // read from the object that was serialised into `body`, so the log says what was sent.
  function forward(req, res, { path, slug, model, key, body, kind, app }) {
    const started = Date.now();
    const headers = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (DROP.has(name) || DROP_RE.test(name)) continue;
      headers.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    // The relay sets host, content-length, the real key, and asks for an uncompressed answer
    // so it can make sure the key never comes back to the agent.
    headers.push("host", hostHeader, "content-length", String(body.length), "accept-encoding", "identity");
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
    const forms = keyForms(key);
    const formBytes = forms.map((f) => Buffer.from(f, "utf8"));
    let ans = null;        // the provider's answer, once it started
    let watcher = null;
    let over = false;
    let clientGone = false;
    let idleTimer = null;

    // Ends the call once. `how`: "done" (the answer passed whole), "cut" (stopped part way),
    // "none" (nothing usable came back), "withheld" (the answer held the key).
    function close(how) {
      if (over) return;
      over = true;
      calls.delete(call);
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (how !== "done") {
        call.destroy();
        if (ans) ans.destroy();
      }
      if (how === "none") {
        if (clientGone || closing) return void res.destroy();
        noteProvider(null);
        if (app) noteAppRefused(app, "relay_upstream_down");
        try {
          if (!res.headersSent && !res.destroyed) refuse(res, 502, "relay_upstream_down");
          else res.destroy();
        } catch {
          res.destroy();
        }
        return;
      }
      if (how === "withheld") {
        say(`${iso()} refused relay_key_in_answer`);
        if (app) noteAppRefused(app, "relay_key_in_answer");
        try {
          if (!res.headersSent && !res.destroyed) sendJson(res, 502, refusalBody("relay_key_in_answer"));
          else res.destroy();
        } catch {
          res.destroy();
        }
        return;
      }
      if (how === "cut") res.destroy();
      const usage = watcher ? watcher.result() : null;
      if (kind === "a") noteAgent(slug, ans.statusCode, usage);
      else if (app) noteApp(app, ans.statusCode, usage);
      say(`${iso()} call ${slug} ${path} ${ans.statusCode} ${Date.now() - started}ms model=${typeof model === "string" && MODEL_RE.test(model) ? model : "?"}`);
    }
    // Whatever the reason, a call with no answer by now ends.
    const firstTimer = setTimeout(() => { if (!ans) close("none"); }, lim.firstByteMs);
    const totalTimer = setTimeout(() => close(ans ? "cut" : "none"), lim.totalMs);
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => close("cut"), lim.idleMs);
    };

    call.on("response", (a) => {
      if (over) return void a.destroy();
      clearTimeout(firstTimer);
      ans = a;
      // A head that holds the key is withheld whole, before anything is written.
      if (holdsKey([a.statusMessage, ...a.rawHeaders], forms)) return close("withheld");
      noteProvider(a.statusCode, a.headers["retry-after"]);
      watcher = usageWatcher(a.headers, lim.countJsonBytes);
      // The head is written with the first bytes passed on (or at the end), so a short
      // answer that holds the key can still be withheld with a clean 502. A head Node will
      // not write (a status like 099, a control character in the reason) is no answer.
      let headDone = false;
      const head = () => {
        if (headDone) return true;
        try {
          if (!writableHead(a)) throw new Error("bad head");
          res.writeHead(a.statusCode, a.statusMessage, a.rawHeaders);
        } catch {
          // writeHead may have kept part of the bad head: clear it before the 502 is written.
          res.statusCode = 200;
          res.statusMessage = undefined;
          for (const name of res.getHeaderNames()) res.removeHeader(name);
          ans = null;
          close("none");
          return false;
        }
        headDone = true;
        return true;
      };
      const emit = (buf) => {
        if (!head() || buf.length === 0) return;
        if (!res.write(buf)) {
          a.pause();
          res.once("drain", () => a.resume());
        }
      };
      // Every answer is scanned, whatever its content-encoding says, for the key as written,
      // JSON-escaped and percent-encoded. Not caught: a key inside a really compressed answer
      // (the provider ignored accept-encoding: identity), or any other re-encoding of it
      // (base64, split by markup, another letter case).
      let carry = Buffer.alloc(0);
      touch();
      a.on("data", (c) => {
        if (over) return;
        touch();
        if (watcher) {
          try { watcher.feed(c); } catch { watcher = null; }
        }
        const all = carry.length ? Buffer.concat([carry, c]) : c;
        if (formBytes.some((f) => all.indexOf(f) !== -1)) return close("withheld");
        // Hold back only the tail that could be the start of a form of the key (at most the
        // longest form's length - 1).
        let keep = 0;
        for (const f of formBytes) keep = Math.max(keep, keyPrefixTail(all, f));
        carry = Buffer.from(all.subarray(all.length - keep));
        emit(all.subarray(0, all.length - keep));
      });
      a.on("end", () => {
        if (over) return;
        if (!head()) return;
        if (carry.length) res.write(carry);
        res.end();
        close("done");
      });
      a.on("error", () => close("cut"));
      a.on("close", () => { if (!a.complete) close("cut"); });
    });
    // A 101 is never a model answer, and Node gives it no `response`: refuse it.
    call.on("upgrade", (_a, socket) => {
      socket.destroy();
      close("none");
    });
    call.on("error", () => close(ans ? "cut" : "none"));
    call.on("close", () => { if (!ans) close("none"); });
    res.on("close", () => {
      if (!res.writableFinished) {
        clientGone = true;
        close(ans ? "cut" : "none");
      }
    });
    call.end(body);
  }

  // Steps 5 to 7: the mode, the key and the pick, read from the files now.
  function decide(who) {
    const st = readModelState(paths.state);
    if (!st.ok || (who.kind === "a" && st.mode !== "provider")) return { status: 403, code: "relay_off" };
    if (isApp(who) && st.mode !== "provider") return { status: 403, code: "relay_app_plans" };
    const key = readKey(paths.key);
    if (key === null) return { status: 403, code: "relay_no_key" };
    let slug = null;
    if (who.kind === "t") {
      slug = who.subject;
    } else {
      const ids = readIds(paths.ids);
      const slugs = ids ? Object.keys(ids).filter((s) => ids[s] === who.subject) : [];
      if (slugs.length === 1) slug = slugs[0];
    }
    const pick = slug === null ? undefined : st.picks[slug];
    if (pick === undefined) return { status: 403, code: "relay_no_pick" };
    return { key, slug, pick };
  }

  function tokenOf(req) {
    const token = bearerOf(req.rawHeaders);
    const secret = token === null ? null : readSecret(paths.secret);
    return secret === null ? null : checkToken(secret, token, clock());
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
    const who = tokenOf(req);
    if (!who) return refuse(res, 401, "relay_no_token");
    // From here an app's refusal is noted on its line too.
    const app = isApp(who) ? who.subject : null;
    const no = (status_, code) => {
      if (app) noteAppRefused(app, code);
      return refuse(res, status_, code);
    };
    // 5 to 7, early: refuse before reading a body that could not be sent anyway.
    const early = decide(who);
    if (early.code) return no(early.status, early.code);
    // 8 and 9. One JSON object, within the size limit.
    const types = headerValues(req.rawHeaders, "content-type");
    if (types.length !== 1 || !JSON_TYPE.test(types[0])) return no(400, "relay_bad_body");
    const raw = await readBody(req, lim.bodyBytes);
    if (raw === null) return undefined;
    if (raw === "too-big") return no(413, "relay_too_big");
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { body = null; }
    if (body === null || typeof body !== "object" || Array.isArray(body)) return no(400, "relay_bad_body");
    // 4 to 7 again, now that the body is in: the owner may have switched off, removed the
    // key or changed a pick while it was arriving. Only these answers decide.
    const whoNow = tokenOf(req);
    if (!whoNow) return refuse(res, 401, "relay_no_token");
    const now_ = decide(whoNow);
    if (now_.code) return no(now_.status, now_.code);
    // 10 and 11. The model is the pick, whatever the body asked for; then forward once.
    body.model = now_.pick;
    const bytes = Buffer.from(JSON.stringify(body), "utf8");
    return forward(req, res, { path, slug: now_.slug, model: body.model, key: now_.key, body: bytes, kind: whoNow.kind, app });
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

const ENGINE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// Describes an error nothing else caught by its name, its code and the first stack frame in
// the engine as `<file base name>:<line>`; never its message, a path or a value.
export function describeError(err) {
  const isObj = err !== null && typeof err === "object";
  const name = isObj && typeof err.name === "string" && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : "unknown";
  const code = isObj && typeof err.code === "string" && /^[A-Z0-9_]{1,64}$/.test(err.code) ? err.code : null;
  let place = "no engine frame";
  if (isObj && typeof err.stack === "string") {
    // The stack starts with the name and the message; frames follow the message's lines.
    const skip = typeof err.message === "string" ? err.message.split("\n").length : 1;
    for (const line of err.stack.split("\n").slice(skip)) {
      const m = /^\s+at (?:.*\()?(?:file:\/\/)?(\/[^():]+):(\d+):\d+\)?$/.exec(line);
      if (!m) continue;
      let file;
      try { file = decodeURIComponent(m[1]); } catch { continue; }
      if (!file.startsWith(`${ENGINE_ROOT}/`)) continue;
      const base = basename(file);
      if (/^[A-Za-z0-9._-]{1,80}$/.test(base)) place = `${base}:${m[2]}`;
      break;
    }
  }
  return [name, code, `at ${place}`].filter(Boolean).join(" ");
}

// The last resort: an error nothing else caught is logged as describeError says (never its
// message, a header or a body), and the relay keeps serving.
function lastResort(err) {
  console.log(`${new Date().toISOString()} relay caught an error it did not expect: ${describeError(err)}`);
}

async function main() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
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
