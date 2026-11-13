// A stand-in Higgsfield for the generation door's tests (PLAN-V5 T67): its sign-in
// (OAuth 2.1, PKCE S256, dynamic client registration) and its MCP server, one listener on
// 127.0.0.1. Shapes follow `.router/V5-MODELS.md` (LITERAL) and `.router/V5-HIGGSFIELD.md`;
// what neither records (the `get_cost` answer, job and output shapes) is this file's guess and
// the door's readers must stay tolerant.
//
//   const hf = await startHiggsfield({ behaviour: { sse: true } });
//   hf.url                         http://127.0.0.1:<port> (the MCP at /mcp, the sign-in at /oauth2/*)
//   hf.net                         resolves mcp./upload./cdn.higgsfield.test to this listener
//   hf.calls                       every request: { method, path, hasAuth, ... }, never a token
//   hf.tokens                      the access and refresh token now valid (for tests only)
// `behaviour` is read on every request, so a test may change it between calls:
//   sse            answer MCP calls as an event stream (a ping event first)
//   expire         the access token dies after one tools/call (the next request is a 401)
//   refuseRefresh  the refresh_token grant answers invalid_grant
//   sessionLost    the first tools/call on a live session answers 404 once
//   priceHigher    1.5 x the table's price
//   nsfw | failed  a job ends "nsfw" | "failed"
//   slow           a job is never done
//   uploadRedirect PUT /upload/<id> answers 302
//   outputRedirect GET /out/<id>.* answers 302
//   bigOutput      GET /out/<id>.* claims 300 MB
//   badJson        an MCP answer that is not JSON
//   toolError      every tool answers isError: true, its text holding the access token
//   credits        the balance (default 3896)
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { connect as tcpConnect } from "node:net";
import { mp4Bytes, pngBytes } from "./runway.mjs";

export { mp4Bytes, pngBytes };

export const MCP_HOST = "mcp.higgsfield.test";
export const UPLOAD_HOST = "upload.higgsfield.test";
export const CDN_HOST = "cdn.higgsfield.test";
const ADDRESSES = { [MCP_HOST]: "13.32.0.11", [UPLOAD_HOST]: "13.32.0.12", [CDN_HOST]: "13.32.0.13" };
const MB = 1024 * 1024;
export const PROTOCOL_VERSION = "2025-06-18";
export const PRICES = { image: 4, videoPerSecond: 7, upscale: 8 }; // credits
export const ACCESS_SECONDS = 3600;

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
function streamBig(res, bytes, type) {
  res.writeHead(200, { "Content-Type": type, "Content-Length": bytes });
  const chunk = mp4Bytes(64 * 1024);
  let left = bytes;
  const pump = () => {
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      left -= n;
      if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return void res.once("drain", pump);
    }
    res.end();
  };
  res.on("error", () => {});
  pump();
}

export async function startHiggsfield({ behaviour = {} } = {}) {
  const b = behaviour;
  const calls = [];
  const sockets = new Set();
  const lookups = [];
  const clients = new Map();   // client_id -> { redirectUris }
  const codes = new Map();     // code -> { clientId, redirectUri, challenge, used }
  const access = new Map();    // access token -> { clientId, expiresAt }
  const refresh = new Map();   // refresh token -> { clientId }
  const sessions = new Set();
  const uploads = new Map();   // media id -> { type, bytes | null }
  const jobs = new Map();      // job id -> { ext, polls }
  const tokens = { access: null, refresh: null };
  let sessionLostDone = false;
  let port = 0;

  const mintTokens = (clientId) => {
    const a = `hfat_${hex(24)}`;
    const r = `hfrt_${hex(24)}`;
    access.set(a, { clientId, expiresAt: Date.now() + ACCESS_SECONDS * 1000 });
    refresh.set(r, { clientId });
    tokens.access = a;
    tokens.refresh = r;
    return { access_token: a, refresh_token: r, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: "openid email offline_access" };
  };

  const record = (req, extra = {}) => {
    const entry = { method: req.method, path: req.url.split("?")[0], hasAuth: typeof req.headers.authorization === "string", ...extra };
    calls.push(entry);
    return entry;
  };

  // ---- the sign-in
  function wellKnown(res, which) {
    const base = `http://127.0.0.1:${port}`;
    if (which === "protected") {
      return send(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["openid", "email", "offline_access"], bearer_methods_supported: ["header"] });
    }
    return send(res, 200, {
      issuer: base, authorization_endpoint: `${base}/oauth2/authorize`, token_endpoint: `${base}/oauth2/token`, registration_endpoint: `${base}/oauth2/register`,
      client_id_metadata_document_supported: true, response_types_supported: ["code"], response_modes_supported: ["form_post", "query"],
      grant_types_supported: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:device_code"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "none", "client_secret_post"],
      code_challenge_methods_supported: ["S256"], scopes_supported: ["openid", "email", "offline_access"],
    });
  }

  async function register(req, res) {
    let body = null;
    try { body = JSON.parse((await readAll(req)).toString("utf8")); } catch { body = null; }
    record(req);
    const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris : null;
    if (!uris || !uris.length || !uris.every((u) => typeof u === "string" && /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/[^\s]*$/.test(u))) {
      return send(res, 400, { error: "invalid_redirect_uri", error_description: "Only http://127.0.0.1:<port>/... redirects are accepted." });
    }
    const clientId = `hfc_${hex(10)}`;
    clients.set(clientId, { redirectUris: uris });
    return send(res, 201, {
      client_id: clientId, client_name: body.client_name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none", scope: "openid email offline_access",
    });
  }

  function authorize(req, res) {
    record(req);
    const q = new URL(req.url, "http://x").searchParams;
    const client = clients.get(q.get("client_id") || "");
    if (!client) return send(res, 400, { error: "invalid_client" });
    const redirect = q.get("redirect_uri") || "";
    if (!client.redirectUris.includes(redirect)) return send(res, 400, { error: "invalid_request", error_description: "redirect_uri is not registered." });
    if (q.get("response_type") !== "code") return send(res, 400, { error: "unsupported_response_type" });
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.get("code_challenge") || "")) {
      return send(res, 400, { error: "invalid_request", error_description: "PKCE S256 is required." });
    }
    const state = q.get("state") || "";
    if (!state) return send(res, 400, { error: "invalid_request", error_description: "state is required." });
    const code = `hfcode_${hex(16)}`;
    codes.set(code, { clientId: q.get("client_id"), redirectUri: redirect, challenge: q.get("code_challenge"), used: false });
    const to = new URL(redirect);
    to.searchParams.set("code", code);
    to.searchParams.set("state", state);
    res.writeHead(302, { Location: to.toString(), "Content-Length": 0 });
    return res.end();
  }

  async function token(req, res) {
    const form = new URLSearchParams((await readAll(req)).toString("utf8"));
    // field names only: a code, a verifier or a token is never kept
    record(req, { grant: form.get("grant_type"), fields: [...form.keys()].sort() });
    const grant = form.get("grant_type");
    const bad = (error, description) => send(res, 400, { error, error_description: description }, { "Cache-Control": "no-store" });
    if (!clients.has(form.get("client_id") || "")) return send(res, 401, { error: "invalid_client" });
    if (grant === "authorization_code") {
      const c = codes.get(form.get("code") || "");
      if (!c) return bad("invalid_grant", "Unknown code.");
      if (c.used) return bad("invalid_grant", "The code was already used.");
      c.used = true; // a code works once, right or wrong
      if (c.clientId !== form.get("client_id")) return bad("invalid_grant", "The code belongs to another client.");
      if (c.redirectUri !== form.get("redirect_uri")) return bad("invalid_grant", "redirect_uri differs.");
      const v = form.get("code_verifier") || "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(v) || s256(v) !== c.challenge) return bad("invalid_grant", "PKCE verification failed.");
      return send(res, 200, mintTokens(c.clientId), { "Cache-Control": "no-store" });
    }
    if (grant === "refresh_token") {
      if (b.refuseRefresh) return bad("invalid_grant", "The refresh token was refused.");
      const r = refresh.get(form.get("refresh_token") || "");
      if (!r || r.clientId !== form.get("client_id")) return bad("invalid_grant", "Unknown refresh token.");
      refresh.delete(form.get("refresh_token")); // rotates
      return send(res, 200, mintTokens(r.clientId), { "Cache-Control": "no-store" });
    }
    return bad("unsupported_grant_type", "Only authorization_code and refresh_token.");
  }

  // ---- the MCP server
  function priceOf(tool, args) {
    const p = args && typeof args.params === "object" && args.params ? args.params : args || {};
    let n;
    if (tool === "generate_image") n = PRICES.image * Math.max(1, Math.min(4, Number(p.count) || 1));
    else if (tool === "generate_video") n = PRICES.videoPerSecond * (Number(p.duration) || 5);
    else n = PRICES.upscale;
    return b.priceHigher ? Math.round(n * 1.5) : n;
  }

  function callTool(name, args) {
    const ok = (data) => ({ structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] });
    const refuse = (text) => ({ isError: true, content: [{ type: "text", text }] });
    if (b.toolError) return refuse(`Higgsfield could not run ${name}: token ${tokens.access} was rejected.`);
    const p = args && typeof args.params === "object" && args.params ? args.params : args || {};
    switch (name) {
      case "balance": return ok({ credits: b.credits === undefined ? 3896 : b.credits, plan: "max" });
      case "generate_image":
      case "generate_video":
      case "upscale_image": {
        if (p.use_unlim === true || p.use_free_gens === true) return refuse("Not allowed by this stand-in.");
        const credits = priceOf(name, args);
        if (p.get_cost === true) return ok({ get_cost: true, credits });
        const id = `job_${hex(8)}`;
        jobs.set(id, { ext: name === "generate_video" ? "mp4" : "png", polls: 0 });
        return ok({ job_id: id, status: "queued", credits });
      }
      case "media_upload": {
        const type = typeof args.content_type === "string" ? args.content_type : "image/png";
        if (typeof args.filename !== "string" || !args.filename) return refuse("filename is required.");
        const id = `media_${hex(8)}`;
        uploads.set(id, { type, bytes: null });
        return ok({ media_id: id, upload_url: `https://${UPLOAD_HOST}/upload/${id}`, upload_headers: { "Content-Type": type } });
      }
      case "media_confirm": {
        const u = uploads.get(args.media_id);
        if (!u) return refuse("Unknown media_id.");
        if (!u.bytes) return refuse("Nothing was uploaded for this media_id.");
        return ok({ media_id: args.media_id, status: "ready", size: u.bytes.length });
      }
      case "jobs_wait": {
        const list = Array.isArray(args.jobs) ? args.jobs : [];
        const out = list.map((j) => {
          const job = jobs.get(j && j.job_id);
          if (!job) return { index: j && j.index, job_id: j && j.job_id, status: "not_found" };
          job.polls += 1;
          const base = { index: j.index, job_id: j.job_id };
          if (b.slow || job.polls < 2) return { ...base, status: job.polls < 2 ? "queued" : "in_progress" };
          if (b.failed) return { ...base, status: "failed", error: "The generation failed." };
          if (b.nsfw) return { ...base, status: "nsfw", error: "Flagged by content moderation." };
          return { ...base, status: "completed", result: { url: `https://${CDN_HOST}/out/${j.job_id}.${job.ext}` } };
        });
        return ok({ jobs: out });
      }
      default: return refuse(`Unknown tool ${name}.`);
    }
  }

  async function mcp(req, res) {
    const raw = (await readAll(req)).toString("utf8");
    let msg = null;
    try { msg = JSON.parse(raw); } catch { msg = null; }
    const entry = record(req, { rpc: msg && msg.method, tool: msg && msg.params && msg.params.name, arguments: msg && msg.params && msg.params.arguments });
    const auth = req.headers.authorization || "";
    const m = /^Bearer (\S+)$/.exec(auth);
    const t = m && access.get(m[1]);
    if (!t || t.expiresAt <= Date.now()) {
      entry.status = 401;
      return send(res, 401, { error: "invalid_token" }, {
        "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp", scope="openid email offline_access"`,
      });
    }
    const accept = String(req.headers.accept || "");
    if (!/application\/json/.test(accept) || !/text\/event-stream/.test(accept)) return send(res, 406, { error: "Accept must list application/json and text/event-stream." });
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    const reply = (payload, headers = {}) => {
      if (b.badJson) return send(res, 200, "<html>not json</html>", headers);
      if (b.sse) {
        const text = `event: ping\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"data":"working"}}\n\n` +
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
        res.writeHead(200, { "Content-Type": "text/event-stream", "Content-Length": Buffer.byteLength(text), ...headers });
        return res.end(text);
      }
      return send(res, 200, payload, headers);
    };
    const fail = (code, message) => reply({ jsonrpc: "2.0", id: msg.id, error: { code, message } });

    if (msg.method === "initialize") {
      const session = `hfs_${hex(12)}`;
      sessions.add(session);
      const asked = msg.params && typeof msg.params.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL_VERSION;
      return reply({ jsonrpc: "2.0", id: msg.id, result: {
        protocolVersion: asked, capabilities: { tools: {} }, serverInfo: { name: "higgsfield-stand-in", version: "1" } } }, { "Mcp-Session-Id": session });
    }
    const sid = req.headers["mcp-session-id"];
    if (!sid) return send(res, 400, { error: "Mcp-Session-Id is required." });
    if (!sessions.has(sid)) return send(res, 404, { error: "Unknown session." });
    if (msg.method === "notifications/initialized") {
      res.writeHead(202, { "Content-Length": 0 });
      return res.end();
    }
    if (msg.method === "tools/list") {
      return reply({ jsonrpc: "2.0", id: msg.id, result: { tools: ["balance", "generate_image", "generate_video", "upscale_image", "media_upload", "media_confirm", "jobs_wait"].map((name) => ({ name })) } });
    }
    if (msg.method === "tools/call") {
      if (b.sessionLost && !sessionLostDone) {
        sessionLostDone = true;
        sessions.delete(sid);
        return send(res, 404, { error: "Unknown session." });
      }
      const p = msg.params || {};
      const result = callTool(p.name, p.arguments || {});
      if (b.expire) access.delete(m[1]); // dies after this one call
      return reply({ jsonrpc: "2.0", id: msg.id, result });
    }
    return fail(-32601, "Method not found");
  }

  const server = http.createServer(async (req, res) => {
    const p = req.url.split("?")[0];
    if (req.method === "GET" && p === "/.well-known/oauth-protected-resource") { record(req); return wellKnown(res, "protected"); }
    if (req.method === "GET" && p === "/.well-known/oauth-protected-resource/mcp") { record(req); return wellKnown(res, "protected"); }
    if (req.method === "GET" && p === "/.well-known/oauth-authorization-server") { record(req); return wellKnown(res, "server"); }
    if (req.method === "POST" && p === "/oauth2/register") return register(req, res);
    if (req.method === "GET" && p === "/oauth2/authorize") return authorize(req, res);
    if (req.method === "POST" && p === "/oauth2/token") return token(req, res);
    if (req.method === "POST" && p === "/mcp") return mcp(req, res);
    const up = /^\/upload\/([A-Za-z0-9_]+)$/.exec(p);
    if (req.method === "PUT" && up) {
      const bytes = await readAll(req);
      record(req, { size: bytes.length, contentType: req.headers["content-type"] });
      if (b.uploadRedirect) { res.writeHead(302, { Location: `https://${UPLOAD_HOST}/upload/elsewhere`, "Content-Length": 0 }); return res.end(); }
      const u = uploads.get(up[1]);
      if (!u) return send(res, 404, { error: "Unknown upload." });
      u.bytes = bytes;
      res.writeHead(200, { "Content-Length": 0 });
      return res.end();
    }
    const out = /^\/out\/([A-Za-z0-9_-]+)\.(png|mp4)$/.exec(p);
    if (req.method === "GET" && out) {
      record(req);
      req.resume();
      if (b.outputRedirect) { res.writeHead(302, { Location: `https://${CDN_HOST}/out/x.${out[2]}`, "Content-Length": 0 }); return res.end(); }
      if (b.bigOutput) return streamBig(res, 300 * MB, out[2] === "png" ? "image/png" : "video/mp4");
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
      lookups.push(host);
      if (ADDRESSES[host]) return [{ address: ADDRESSES[host], family: 4 }];
      const err = new Error("not found");
      err.code = "ENOTFOUND";
      throw err;
    },
    connect({ address }) {
      const ours = Object.values(ADDRESSES).includes(address);
      return tcpConnect({ host: "127.0.0.1", port: ours ? port : 1 });
    },
  };

  return {
    url: `http://127.0.0.1:${port}`,
    net,
    calls,
    lookups,
    tokens,
    behaviour: b,
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
