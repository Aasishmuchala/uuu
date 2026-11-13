// The generation door's MCP client for Higgsfield (PLAN-V5 K21): streamable HTTP, JSON-RPC 2.0,
// zero dependencies. `initialize` once (the session id from `Mcp-Session-Id`), then
// `notifications/initialized`, then `tools/call` for the door's few tools only. An answer is one
// JSON message, or an event stream read only until the event carrying our request's id; at most
// 2 MB and 60 seconds a call; a 401 asks the sign-in for a fresh token once, a 404 on a session
// opens one new session once; no redirect is ever followed (`hfRequest`). A tool's result is its
// `structuredContent`, else its first text block read as JSON; `isError: true` is a refusal
// whose text is scrubbed of both tokens and cut to 300 characters; a result that holds a token
// is refused. The token never appears in what this returns or logs.
import { StringDecoder } from "node:string_decoder";
import { HF_LIMITS, HF_PATHS, NO_SECRETS, TEXT_MAX, checkHfOrigin, hfRequest } from "./higgsfield.mjs";

export const PROTOCOL_VERSION = "2025-06-18";
export const CLIENT_INFO = Object.freeze({ name: "uuu-generation-door", version: "1" });
// The only tools the door may call (K21). Never execute_preset, show_*, a widget tool,
// transactions or models_explore.
export const MCP_TOOLS = Object.freeze(["balance", "generate_image", "generate_video", "upscale_image", "media_upload", "media_confirm", "jobs_wait"]);
const SESSION_RE = /^[\x21-\x7e]{1,200}$/;
const VERSION_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function rawValues(rawHeaders, name) {
  const out = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) if (String(rawHeaders[i]).toLowerCase() === name) out.push(String(rawHeaders[i + 1]));
  return out;
}

// The JSON-RPC answer to request `wantId` in a parsed message (or a batch of them).
function matching(v, wantId) {
  for (const m of Array.isArray(v) ? v : [v]) {
    if (isObj(m) && m.id === wantId && (Object.hasOwn(m, "result") || Object.hasOwn(m, "error"))) return m;
  }
  return undefined;
}
function parsed(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

// Reads an event stream piece by piece and gives back the message answering `wantId` as soon as
// it arrives; other events (pings, notifications, the server's own requests) are passed over.
function sseReader(wantId) {
  const dec = new StringDecoder("utf8");
  let buf = "";
  const scan = (final) => {
    for (;;) {
      const m = /\r\n\r\n|\n\n|\r\r/.exec(buf);
      let block;
      if (m) {
        block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
      } else if (final && buf.trim() !== "") {
        block = buf;
        buf = "";
      } else {
        return undefined;
      }
      const data = block.split(/\r\n|\n|\r/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data === "") continue;
      const hit = matching(parsed(data), wantId);
      if (hit) return hit;
    }
  };
  return {
    push: (chunk) => { buf += dec.write(chunk); return scan(false); },
    end: () => { buf += dec.end(); return scan(true); },
  };
}

const asksForFree = (a) => [a, isObj(a) ? a.params : null].some((o) => isObj(o) && (o.use_unlim === true || o.use_free_gens === true));
function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content.slice(0, 20).filter((b) => isObj(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text.slice(0, 4000)).join(" ");
}
function firstText(content) {
  if (!Array.isArray(content)) return null;
  const b = content.find((x) => isObj(x) && x.type === "text" && typeof x.text === "string");
  return b ? b.text : null;
}

// `token(opts)` is the sign-in's (`createHfAuth(...).token`): it resolves to { ok: true, access,
// guard } or { ok: false, why } and, given { stale }, refreshes when the token it has is still
// that one. `call(name, args)` resolves to { ok: true, result } or { ok: false, why, text, sent,
// status }: `sent` says the tool call itself went out (its effect is then unknown unless
// Higgsfield refused it clearly); `status` is the HTTP status when there was one.
export function createMcpClient({ origin, token, net, limits, log } = {}) {
  const up = checkHfOrigin(origin);
  if (typeof token !== "function") throw new Error("createMcpClient: token must be a function");
  const lim = { answerBytes: HF_LIMITS.answerBytes, callMs: HF_LIMITS.callMs, ...(limits || {}) };
  let session = null;      // { id (null when the server keeps none), version }
  let opening = null;      // the one initialize under way, shared
  let rpcId = 0;
  let guard = NO_SECRETS;  // the newest token guard seen, for texts
  const say = (line) => {
    try { if (typeof log === "function") log(`${new Date().toISOString()} ${line}`); } catch { /* a log failure changes nothing */ }
  };
  const fail = (why, extra) => ({ ok: false, why, text: "", sent: false, status: null, ...(extra || {}) });

  // One POST of a JSON-RPC message to /mcp. For a request, waits for the message answering its
  // id. { ok: true, status, rawHeaders, message (null for a notification or a status not 200) }
  // or { ok: false, why, status? }.
  async function post(message, access, s, deadline, signal) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${access}` };
    if (s && s.id) headers["Mcp-Session-Id"] = s.id;
    if (s) headers["MCP-Protocol-Version"] = s.version;
    const wantId = Object.hasOwn(message, "id") ? message.id : undefined;
    const sse = wantId === undefined ? null : sseReader(wantId);
    const r = await hfRequest(up, {
      net, method: "POST", path: HF_PATHS.mcp, headers, body, maxBytes: lim.answerBytes, ms: Math.max(0, deadline - Date.now()), signal,
      onChunk: sse ? (chunk, info) => (info.status === 200 && info.type === "text/event-stream" ? sse.push(chunk) : undefined) : undefined,
    });
    if (!r.ok) return r;
    if (r.status >= 300 && r.status < 400) return { ok: false, why: "redirect", status: r.status };
    if (wantId === undefined || r.status !== 200) return { ok: true, status: r.status, rawHeaders: r.rawHeaders, message: null };
    let m = r.early;
    if (m === undefined) {
      if (r.type === "text/event-stream") m = sse.end();
      else {
        const v = parsed(r.body.toString("utf8"));
        if (v === undefined) return { ok: false, why: "not_json", status: 200 };
        m = matching(v, wantId);
      }
    }
    if (m === undefined) return { ok: false, why: "no_answer", status: 200 };
    return { ok: true, status: 200, rawHeaders: r.rawHeaders, message: m };
  }

  async function open(access, deadline, signal) {
    const id = ++rpcId;
    const r = await post({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } },
      access, null, deadline, signal);
    if (!r.ok) return r;
    if (r.status !== 200) return { ok: false, why: r.status === 401 ? "unauthorized" : "status", status: r.status };
    if (!isObj(r.message.result)) return { ok: false, why: "rpc_error", status: 200 };
    const ids = rawValues(r.rawHeaders, "mcp-session-id");
    if (ids.length > 1 || (ids.length === 1 && !SESSION_RE.test(ids[0]))) return { ok: false, why: "bad_session", status: 200 };
    const v = r.message.result.protocolVersion;
    const s = { id: ids.length === 1 ? ids[0] : null, version: typeof v === "string" && VERSION_RE.test(v) ? v : PROTOCOL_VERSION };
    const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, access, s, deadline, signal);
    if (!n.ok) return n;
    if (n.status < 200 || n.status > 299) return { ok: false, why: n.status === 401 ? "unauthorized" : "status", status: n.status };
    session = s;
    say("higgsfield session opened");
    return { ok: true, session: s };
  }

  function sessionFor(access, deadline, signal) {
    if (session) return Promise.resolve({ ok: true, session });
    if (!opening) opening = open(access, deadline, signal).finally(() => { opening = null; });
    return opening;
  }

  async function freshToken(opts) {
    let a;
    try { a = await token(opts); } catch { a = null; }
    if (!a || a.ok !== true || typeof a.access !== "string") return { ok: false, why: a && typeof a.why === "string" ? a.why : "signed_out" };
    if (a.guard && typeof a.guard.scrub === "function" && typeof a.guard.holds === "function") guard = a.guard;
    return a;
  }

  function readResult(message) {
    if (isObj(message.error)) {
      return fail("rpc_error", { sent: true, status: 200, text: guard.scrub(typeof message.error.message === "string" ? message.error.message : "", TEXT_MAX) });
    }
    const res = message.result;
    if (!isObj(res)) return fail("no_result", { sent: true, status: 200 });
    if (res.isError === true) return fail("tool_error", { sent: true, status: 200, text: guard.scrub(textOf(res.content), TEXT_MAX) });
    let out;
    if (isObj(res.structuredContent)) out = res.structuredContent;
    else {
      const t = firstText(res.content);
      const v = t === null ? undefined : parsed(t);
      if (v !== null && typeof v === "object") out = v;
    }
    if (out === undefined) return fail("no_result", { sent: true, status: 200 });
    if (guard.holds(JSON.stringify(out))) return fail("token_in_answer", { sent: true, status: 200 });
    return { ok: true, result: out };
  }

  return {
    async call(name, args, { signal } = {}) {
      if (!MCP_TOOLS.includes(name)) return fail("tool_not_allowed");
      if (!isObj(args) || asksForFree(args)) return fail("bad_arguments");
      const deadline = Date.now() + lim.callMs;
      let auth = await freshToken();
      if (!auth.ok) return fail(auth.why);
      let refreshed = false;
      let reopened = false;
      for (;;) {
        const s = await sessionFor(auth.access, deadline, signal);
        if (!s.ok) {
          if (s.status === 401 && !refreshed) {
            refreshed = true;
            auth = await freshToken({ stale: auth.access });
            if (!auth.ok) return fail(auth.why);
            continue;
          }
          return fail(s.why, { status: s.status === undefined ? null : s.status });
        }
        const r = await post({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, auth.access, s.session, deadline, signal);
        if (!r.ok) return fail(r.why, { sent: true, status: r.status === undefined ? null : r.status });
        if (r.status === 401 && !refreshed) {
          refreshed = true;
          auth = await freshToken({ stale: auth.access });
          if (!auth.ok) return fail(auth.why, { sent: true, status: 401 });
          continue;
        }
        if (r.status === 404 && s.session.id !== null && !reopened) {
          reopened = true;
          if (session === s.session) session = null;
          say("higgsfield session lost; opening a new one");
          continue;
        }
        if (r.status !== 200) {
          const why = r.status === 401 ? "unauthorized" : r.status === 404 ? "session_lost" : r.status === 429 ? "limited" : "status";
          return fail(why, { sent: true, status: r.status });
        }
        return readResult(r.message);
      }
    },
    // Higgsfield's text without either token, control characters, and over `max` characters.
    scrub: (text, max = TEXT_MAX) => guard.scrub(text, max),
    // Forgets the session (after a sign-out); the next call opens a new one.
    reset() { session = null; },
  };
}
