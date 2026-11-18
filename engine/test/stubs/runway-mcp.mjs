// A stand-in for Runway's MCP server, the owner's Runway account (PLAN-ONBOARD R1), for the
// generation door's tests: its sign-in (OAuth 2.1, PKCE S256, dynamic client registration, at
// /register, /authorize and /token as `.router/RUNWAY-MCP-FACTS.md` names them) and its MCP
// server at /mcp, one listener on 127.0.0.1. Tool names and arguments follow
// `.router/RUNWAY-MCP-SCHEMAS.json`; what R0 did not see (the quote's shape, a task's answer, the
// upload and result hosts) is this file's guess, and the door's readers must stay tolerant.
//
//   const rm = await startRunwayMcp({ behaviour: { credits: 12 } });
//   rm.url                         http://127.0.0.1:<port>
//   rm.net                         resolves upload.runway-account.test and cdn.runway-account.test to this listener
//   rm.calls                       every request: { method, path, hasAuth, rpc, tool, approved, ... }, never a token,
//                                  a code, a verifier or an approval string
//   rm.tokens                      the access and refresh token now valid (for tests only)
//   rm.secrets                     every code, state and verifier the stand-in saw (for tests only)
// `behaviour` is read on every request:
//   credits        the quote's credits (default 12)
//   quoteShape     "plain" (default: structuredContent { status, credits, costApproval }) | "error" (the
//                  quote as an isError result whose text is JSON) | "nested" ({ result: { code, quote: { ... } } })
//                  | "noCredits" (a marked answer with no credit count) | "prose" (isError, plain words with the mark)
//                  | "price" (the count under `price`, a name with no unit)
//   startNoQuote   an unapproved request starts a task at once (what the door must never accept)
//   unclear        an unapproved request answers {} (neither a quote nor a task)
//   quoteAgain     the approved request answers a new quote
//   refuse         every generation answers isError "The model is not available."
//   failed | flagged | slow     a task ends FAILED | FAILED with a SAFETY code | never ends
//   taskCost       the finished task's stated cost (omitted when undefined)
//   expire         the access token dies after one tools/call
//   refuseRefresh  the refresh_token grant answers invalid_grant
//   uploadHost     the host of init_upload's address (default upload.runway-account.test)
//   balance        whoami's credits.total (default 14463)
//   onQuote()      called when a quote is made, before it is answered
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { connect as tcpConnect } from "node:net";
import { mp4Bytes, pngBytes } from "./runway.mjs";

export { mp4Bytes, pngBytes };

export const UPLOAD_HOST = "upload.runway-account.test";
export const CDN_HOST = "cdn.runway-account.test";
const ADDRESSES = { [UPLOAD_HOST]: "13.32.0.21", [CDN_HOST]: "13.32.0.22", "upload.runway-account.test.evil.example": "13.32.0.23" };
export const MARK = "cost_confirmation_required";
export const ACCESS_SECONDS = 2591983;
const GENERATE = new Set(["generate_image", "generate_video", "upscale_image"]);

const hex = (n) => randomBytes(n).toString("hex");
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}
function readAll(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });
}

export async function startRunwayMcp({ behaviour = {} } = {}) {
  const b = behaviour;
  const calls = [];
  const sockets = new Set();
  const clients = new Map();
  const codes = new Map();
  const access = new Map();
  const refresh = new Map();
  const sessions = new Set();
  const approvals = new Map();   // approval -> the request it covers
  const tasks = new Map();       // task id -> { ext, polls }
  const uploads = new Map();     // upload id -> { bytes }
  const tokens = { access: null, refresh: null };
  const secrets = { codes: [], states: [], verifiers: [], approvals: [] };
  let port = 0;

  const mintTokens = (clientId) => {
    const a = `rwat_${hex(40)}`;
    const r = `rwrt_${hex(40)}`;
    access.set(a, { clientId, expiresAt: Date.now() + ACCESS_SECONDS * 1000 });
    refresh.set(r, { clientId });
    tokens.access = a;
    tokens.refresh = r;
    return { access_token: a, refresh_token: r, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: "openid api:read_write" };
  };
  const record = (req, extra = {}) => {
    const entry = { method: req.method, path: req.url.split("?")[0], host: req.headers.host, hasAuth: typeof req.headers.authorization === "string", ...extra };
    calls.push(entry);
    return entry;
  };

  async function register(req, res) {
    let body = null;
    try { body = JSON.parse((await readAll(req)).toString("utf8")); } catch { body = null; }
    record(req, { scope: body && body.scope, name: body && body.client_name });
    const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris : null;
    if (!uris || !uris.every((u) => typeof u === "string" && /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/[^\s]*$/.test(u))) return send(res, 400, { error: "invalid_redirect_uri" });
    // Runway's client id is long (487 characters were seen).
    const clientId = `rwc_${hex(240)}`;
    clients.set(clientId, { redirectUris: uris });
    return send(res, 200, { client_id: clientId, redirect_uris: uris, token_endpoint_auth_method: "none" });
  }

  function authorize(req, res) {
    const q = new URL(req.url, "http://x").searchParams;
    record(req, { scope: q.get("scope"), resource: q.get("resource") });
    const client = clients.get(q.get("client_id") || "");
    if (!client) return send(res, 400, { error: "invalid_client" });
    const redirect = q.get("redirect_uri") || "";
    if (!client.redirectUris.includes(redirect)) return send(res, 400, { error: "invalid_request" });
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get("code_challenge") || "")) return send(res, 400, { error: "invalid_request" });
    const state = q.get("state") || "";
    const code = `rwcode_${hex(32)}`;
    secrets.codes.push(code);
    secrets.states.push(state);
    codes.set(code, { clientId: q.get("client_id"), redirectUri: redirect, challenge: q.get("code_challenge"), used: false });
    const to = new URL(redirect);
    to.searchParams.set("code", code);
    to.searchParams.set("state", state);
    res.writeHead(302, { Location: to.toString(), "Content-Length": 0 });
    return res.end();
  }

  async function token(req, res) {
    const form = new URLSearchParams((await readAll(req)).toString("utf8"));
    record(req, { grant: form.get("grant_type"), fields: [...form.keys()].sort(), resource: form.get("resource") });
    const grant = form.get("grant_type");
    const bad = (error) => send(res, 400, { error }, { "Cache-Control": "no-store" });
    if (!clients.has(form.get("client_id") || "")) return send(res, 401, { error: "invalid_client" });
    if (grant === "authorization_code") {
      const c = codes.get(form.get("code") || "");
      if (!c || c.used) return bad("invalid_grant");
      c.used = true;
      const v = form.get("code_verifier") || "";
      secrets.verifiers.push(v);
      if (c.redirectUri !== form.get("redirect_uri") || s256(v) !== c.challenge) return bad("invalid_grant");
      return send(res, 200, mintTokens(c.clientId), { "Cache-Control": "no-store" });
    }
    if (grant === "refresh_token") {
      if (b.refuseRefresh) return bad("invalid_grant");
      const r = refresh.get(form.get("refresh_token") || "");
      if (!r) return bad("invalid_grant");
      refresh.delete(form.get("refresh_token"));
      return send(res, 200, mintTokens(r.clientId), { "Cache-Control": "no-store" });
    }
    return bad("unsupported_grant_type");
  }

  function startTask(name) {
    const id = randomUUIDish();
    tasks.set(id, { ext: name === "generate_video" ? "mp4" : "png", polls: 0 });
    return id;
  }
  const randomUUIDish = () => `${hex(4)}-${hex(2)}-${hex(2)}-${hex(2)}-${hex(6)}`;

  function quoteOf(credits, approval) {
    const plain = { status: MARK, credits, costApproval: approval, message: `This will use ${credits} credits.` };
    if (b.quoteShape === "nested") return { ok: { result: { code: MARK, quote: { creditCost: credits, costApproval: approval } } } };
    if (b.quoteShape === "noCredits") return { ok: { status: MARK, costApproval: approval } };
    if (b.quoteShape === "price") return { ok: { status: MARK, price: credits, costApproval: approval } };
    if (b.quoteShape === "error") return { error: JSON.stringify(plain) };
    if (b.quoteShape === "prose") return { error: `${MARK}: this will use ${credits} credits. Send costApproval ${approval} to go on.`, prose: true };
    return { ok: plain };
  }

  function callTool(name, args) {
    const ok = (data) => ({ structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] });
    const refuse = (text) => ({ isError: true, content: [{ type: "text", text }] });
    switch (name) {
      case "whoami":
        return ok({ authenticated: true, team: { id: 1, name: "Owner", isPersonal: true }, credits: { unlimited: false, plan: 0, purchased: b.balance === undefined ? 14463 : b.balance, total: b.balance === undefined ? 14463 : b.balance } });
      case "generate_image":
      case "generate_video":
      case "upscale_image": {
        if (b.refuse) return refuse("The model is not available.");
        const { costApproval, ...rest } = args;
        const key = JSON.stringify(rest);
        if (typeof costApproval !== "string") {
          if (b.startNoQuote) return ok({ taskId: startTask(name), status: "PENDING" });
          if (b.unclear) return ok({});
          const approval = `ca_${hex(20)}`;
          secrets.approvals.push(approval);
          approvals.set(approval, key);
          if (typeof b.onQuote === "function") b.onQuote();
          const q = quoteOf(b.credits === undefined ? 12 : b.credits, approval);
          if (q.ok) return ok(q.ok);
          return refuse(q.error);
        }
        if (approvals.get(costApproval) !== key) return refuse("The costApproval does not match this request.");
        approvals.delete(costApproval);
        if (b.quoteAgain) {
          const approval = `ca_${hex(20)}`;
          approvals.set(approval, key);
          return ok({ status: MARK, credits: (b.credits || 12) * 2, costApproval: approval });
        }
        return ok({ taskId: startTask(name), status: "PENDING" });
      }
      case "get_task": {
        const t = tasks.get(args.id);
        if (!t) return refuse("Unknown task.");
        t.polls += 1;
        const base = { id: args.id };
        if (b.slow || t.polls < 2) return ok({ ...base, status: t.polls < 2 ? "PENDING" : "RUNNING", ...(b.taskCost === undefined ? {} : { credits: b.taskCost }) });
        if (b.failed) return ok({ ...base, status: "FAILED", failure: "The generation failed.", failureCode: "INTERNAL" });
        if (b.flagged) return ok({ ...base, status: "FAILED", failure: "Flagged.", failureCode: "SAFETY.INPUT.TEXT" });
        return ok({ ...base, status: "SUCCEEDED", output: [`https://${CDN_HOST}/out/${args.id}.${t.ext}`], ...(b.taskCost === undefined ? {} : { credits: b.taskCost }) });
      }
      case "init_upload": {
        const id = `up_${hex(8)}`;
        uploads.set(id, { bytes: null });
        const host = b.uploadHost || UPLOAD_HOST;
        return ok({ uploadId: id, uploadUrls: [`https://${host}/uploads/${id}/part-1?partNumber=1&uploadId=${id}&X-Amz-Signature=${"0a".repeat(32)}`] });
      }
      case "complete_upload": {
        const u = uploads.get(args.uploadId);
        if (!u || !u.bytes) return refuse("Nothing was uploaded.");
        const etag = createHash("md5").update(u.bytes).digest("hex");
        const parts = Array.isArray(args.parts) ? args.parts : [];
        if (parts.length !== 1 || parts[0].etag !== etag) return refuse("The ETag does not match.");
        return ok({ assetUrl: `https://${CDN_HOST}/assets/${args.uploadId}.png`, assetId: args.uploadId });
      }
      default: return refuse(`Unknown tool ${name}.`);
    }
  }

  async function mcp(req, res) {
    const raw = (await readAll(req)).toString("utf8");
    let msg = null;
    try { msg = JSON.parse(raw); } catch { msg = null; }
    const a = msg && msg.params && msg.params.arguments;
    const entry = record(req, { rpc: msg && msg.method, tool: msg && msg.params && msg.params.name,
      approved: !!(a && typeof a.costApproval === "string"), arguments: a && typeof a === "object" ? { ...a, ...(a.costApproval ? { costApproval: "(given)" } : {}) } : a });
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
    const t = m && access.get(m[1]);
    if (!t || t.expiresAt <= Date.now()) {
      entry.status = 401;
      return send(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": 'Bearer error="missing_bearer", realm="runway-mcp"' });
    }
    if (!msg || msg.jsonrpc !== "2.0") return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    if (msg.method === "initialize") {
      const session = `rws_${hex(12)}`;
      sessions.add(session);
      return send(res, 200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Runway", version: "0.1.0" } } },
        { "mcp-session-id": session });
    }
    const sid = req.headers["mcp-session-id"];
    if (!sid || !sessions.has(sid)) return send(res, 404, { error: "Unknown session." });
    if (msg.method === "notifications/initialized") { res.writeHead(202, { "Content-Length": 0 }); return res.end(); }
    if (msg.method === "tools/call") {
      const result = callTool(msg.params.name, msg.params.arguments || {});
      if (b.expire) access.delete(m[1]);
      return send(res, 200, { jsonrpc: "2.0", id: msg.id, result });
    }
    return send(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }

  const server = http.createServer(async (req, res) => {
    const p = req.url.split("?")[0];
    if (req.method === "POST" && p === "/register") return register(req, res);
    if (req.method === "GET" && p === "/authorize") return authorize(req, res);
    if (req.method === "POST" && p === "/token") return token(req, res);
    if (req.method === "POST" && p === "/mcp") return mcp(req, res);
    const up = /^\/uploads\/(up_[0-9a-f]+)\/part-1$/.exec(p);
    if (req.method === "PUT" && up) {
      const bytes = await readAll(req);
      record(req, { size: bytes.length, contentType: req.headers["content-type"], auth: req.headers.authorization || null });
      const u = uploads.get(up[1]);
      if (!u) return send(res, 404, { error: "Unknown upload." });
      u.bytes = bytes;
      res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"`, "Content-Length": 0 });
      return res.end();
    }
    const out = /^\/out\/([A-Za-z0-9_-]+)\.(png|mp4)$/.exec(p);
    if (req.method === "GET" && out) {
      record(req);
      req.resume();
      const bytes = out[2] === "png" ? pngBytes() : mp4Bytes();
      res.writeHead(200, { "Content-Type": out[2] === "png" ? "image/png" : "video/mp4", "Content-Length": bytes.length });
      return res.end(bytes);
    }
    record(req);
    req.resume();
    return send(res, 404, { error: "Not found." });
  });
  server.on("connection", (sock) => { sockets.add(sock); sock.on("close", () => sockets.delete(sock)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;

  const net = {
    async resolve(host) {
      if (ADDRESSES[host]) return [{ address: ADDRESSES[host], family: 4 }];
      const err = new Error("not found");
      err.code = "ENOTFOUND";
      throw err;
    },
    connect({ address }) {
      return tcpConnect({ host: "127.0.0.1", port: Object.values(ADDRESSES).includes(address) ? port : 1 });
    },
  };

  return {
    url: `http://127.0.0.1:${port}`,
    net,
    calls,
    tokens,
    secrets,
    behaviour: b,
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
