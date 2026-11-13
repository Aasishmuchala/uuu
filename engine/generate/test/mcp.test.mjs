// The door's MCP client (PLAN-V5 K21) against the stand-in Higgsfield (T67) and, for answers the
// stand-in cannot give (a huge one, a redirect, a stream that never ends), a hostile server of
// the test's own. Made-up tokens; every socket lands on 127.0.0.1.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_INFO, PROTOCOL_VERSION, createMcpClient } from "../mcp.mjs";
import { HF_ORIGIN, tokenGuard } from "../higgsfield.mjs";
import { createHfAuth } from "../oauth.mjs";
import { startHiggsfield } from "../../test/stubs/higgsfield.mjs";

const REDIRECT = "http://127.0.0.1:41999/api/generation/higgsfield/back";
const HF_HOST = new URL(HF_ORIGIN).hostname;
const ACCESS = `hfat_${"5a".repeat(24)}`;
const REFRESH = `hfrt_${"6b".repeat(24)}`;
const fixedToken = async () => ({ ok: true, access: ACCESS, guard: tokenGuard([ACCESS, REFRESH]) });

// A signed-in door against the stand-in: its sign-in and its MCP client.
async function ready(behaviour = {}, { origin, net } = {}) {
  const hf = await startHiggsfield({ behaviour });
  const file = join(mkdtempSync(join(tmpdir(), "hf-mcp-")), "secrets", "doors", "higgsfield-oauth.json");
  const lines = [];
  const auth = createHfAuth({ origin: hf.url, file, redirectUri: REDIRECT, net: hf.net, log: (l) => lines.push(l) });
  const b = await auth.begin();
  const u = new URL(b.url);
  const res = await fetch(`${hf.url}${u.pathname}${u.search}`, { redirect: "manual" });
  const back = new URL(res.headers.get("location"));
  assert.deepEqual(await auth.finish({ code: back.searchParams.get("code"), state: back.searchParams.get("state") }), { ok: true });
  const mcp = createMcpClient({ origin: origin || hf.url, token: (o) => auth.token(o), net: net || hf.net, log: (l) => lines.push(l) });
  return { hf, auth, mcp, lines };
}
const rpcs = (hf, method) => hf.calls.filter((c) => c.path === "/mcp" && c.rpc === method).length;
const mcpCalls = (hf) => hf.calls.filter((c) => c.path === "/mcp").length;

// A hostile MCP server: initialize and initialized as a real one, then `onCall(msg, req, res)`.
async function hostile(onCall, { sessionId = "s-1" } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let msg = null;
      try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { msg = null; }
      seen.push({ method: msg && msg.method, headers: req.headers });
      if (msg && msg.method === "initialize") {
        res.writeHead(200, { "Content-Type": "application/json", ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: {} } }));
      }
      if (msg && msg.method === "notifications/initialized") { res.writeHead(202, { "Content-Length": 0 }); return res.end(); }
      return onCall(msg, req, res);
    });
  });
  const sockets = new Set();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => { for (const s of sockets) s.destroy(); return new Promise((resolve) => server.close(resolve)); },
  };
}
const answer = (res, msg, result, headers = {}) => {
  res.writeHead(200, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
};

test("a call opens one session (initialize, then initialized) and reuses it; the result is structuredContent", async () => {
  const { hf, mcp, lines } = await ready();
  try {
    assert.deepEqual(await mcp.call("balance", {}), { ok: true, result: { credits: 3896, plan: "max" } });
    assert.deepEqual(await mcp.call("balance", {}), { ok: true, result: { credits: 3896, plan: "max" } });
    assert.equal(rpcs(hf, "initialize"), 1);
    assert.equal(rpcs(hf, "notifications/initialized"), 1);
    assert.equal(rpcs(hf, "tools/call"), 2);
    assert.ok(hf.calls.filter((c) => c.path === "/mcp").every((c) => c.hasAuth));
    assert.ok(lines.some((l) => l.endsWith("higgsfield session opened")));
  } finally { await hf.close(); }
});

test("the headers: both answer types accepted, the session id and protocol version after initialize, the client named", async () => {
  const sent = [];
  const net = (hf) => ({
    resolve: async (host) => (host === HF_HOST ? [{ address: "13.32.0.11", family: 4 }] : hf.net.resolve(host)),
    connect(o) {
      const sock = hf.net.connect(o);
      const write = sock.write.bind(sock);
      sock.write = (chunk, ...rest) => { sent.push(Buffer.from(chunk).toString("latin1")); return write(chunk, ...rest); };
      return sock;
    },
  });
  const hf = await startHiggsfield();
  const file = join(mkdtempSync(join(tmpdir(), "hf-mcp-")), "secrets", "doors", "higgsfield-oauth.json");
  const auth = createHfAuth({ origin: hf.url, file, redirectUri: REDIRECT, net: hf.net });
  try {
    const b = await auth.begin();
    const u = new URL(b.url);
    const back = new URL((await fetch(`${hf.url}${u.pathname}${u.search}`, { redirect: "manual" })).headers.get("location"));
    await auth.finish({ code: back.searchParams.get("code"), state: back.searchParams.get("state") });
    const mcp = createMcpClient({ origin: HF_ORIGIN, token: (o) => auth.token(o), net: net(hf) });
    assert.equal((await mcp.call("balance", {})).ok, true);
    const reqs = sent.join("").split(/(?=POST \/mcp HTTP\/1\.1\r\n)/).filter((r) => r.startsWith("POST"));
    assert.equal(reqs.length, 3);
    const head = (r) => r.slice(0, r.indexOf("\r\n\r\n"));
    const body = (r) => JSON.parse(r.slice(r.indexOf("\r\n\r\n") + 4));
    for (const r of reqs) {
      assert.match(head(r), /\r\nContent-Type: application\/json\r\n/);
      assert.match(head(r), /\r\nAccept: application\/json, text\/event-stream\r\n/);
      assert.match(head(r), new RegExp(`\\r\\nAuthorization: Bearer ${hf.tokens.access}\\r\\n`));
      assert.match(head(r), new RegExp(`\\r\\nHost: ${HF_HOST.replace(/\./g, "\\.")}\\r\\n`));
    }
    assert.deepEqual(body(reqs[0]).params, { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO });
    assert.doesNotMatch(head(reqs[0]), /mcp-session-id/i);
    for (const r of reqs.slice(1)) {
      assert.match(head(r), /\r\nMcp-Session-Id: hfs_[0-9a-f]+\r\n/);
      assert.match(head(r), new RegExp(`\\r\\nMCP-Protocol-Version: ${PROTOCOL_VERSION}\\r\\n`));
    }
    assert.deepEqual(body(reqs[1]), { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.deepEqual(body(reqs[2]).params, { name: "balance", arguments: {} });
  } finally { await hf.close(); }
});

test("an event stream is read until the event carrying our answer", async () => {
  const { hf, mcp } = await ready({ sse: true });
  try {
    assert.deepEqual(await mcp.call("balance", {}), { ok: true, result: { credits: 3896, plan: "max" } });
  } finally { await hf.close(); }
});

test("a result with no structuredContent is read from its first text block", async () => {
  const srv = await hostile((msg, req, res) => answer(res, msg, { content: [{ type: "image", data: "x" }, { type: "text", text: '{"credits": 12, "plan": "plus"}' }] }));
  try {
    const mcp = createMcpClient({ origin: srv.origin, token: fixedToken });
    assert.deepEqual(await mcp.call("balance", {}), { ok: true, result: { credits: 12, plan: "plus" } });
  } finally { await srv.close(); }
});

test("toolError: Higgsfield's text, scrubbed of the tokens and their ends, cut to 300 characters", async () => {
  const { hf, mcp } = await ready({ toolError: true });
  try {
    const token = hf.tokens.access;
    const r = await mcp.call("balance", {});
    assert.equal(r.ok, false);
    assert.equal(r.why, "tool_error");
    assert.match(r.text, /Higgsfield could not run balance/);
    for (const piece of [token, token.slice(0, 12), token.slice(-12)]) assert.ok(!r.text.includes(piece));
  } finally { await hf.close(); }
  const long = `${ACCESS} ${REFRESH} ${encodeURIComponent(ACCESS)} ${REFRESH.slice(0, 12)}\u0007${"y".repeat(1000)}`;
  const srv = await hostile((msg, req, res) => answer(res, msg, { isError: true, content: [{ type: "text", text: long }] }));
  try {
    const r = await createMcpClient({ origin: srv.origin, token: fixedToken }).call("balance", {});
    assert.equal(r.why, "tool_error");
    assert.ok(r.text.length <= 300);
    for (const piece of [ACCESS, REFRESH, ACCESS.slice(0, 12), ACCESS.slice(-12), REFRESH.slice(0, 12), REFRESH.slice(-12), "\u0007"]) assert.ok(!r.text.includes(piece), piece);
  } finally { await srv.close(); }
});

test("a JSON-RPC error is a refusal with its words scrubbed; a result that holds the token is refused", async () => {
  let mode = "error";
  const srv = await hostile((msg, req, res) => {
    if (mode === "error") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `bad arguments for ${ACCESS}` } }));
    }
    return answer(res, msg, { structuredContent: { upload_url: `https://x.test/u?t=${encodeURIComponent(ACCESS)}` } });
  });
  try {
    const mcp = createMcpClient({ origin: srv.origin, token: fixedToken });
    const e = await mcp.call("media_upload", { filename: "input.png", content_type: "image/png" });
    assert.equal(e.why, "rpc_error");
    assert.equal(e.text, "bad arguments for [removed]");
    mode = "echo";
    const t = await mcp.call("media_upload", { filename: "input.png", content_type: "image/png" });
    assert.deepEqual([t.ok, t.why, t.sent], [false, "token_in_answer", true]);
  } finally { await srv.close(); }
});

test("hostile answers are refused: not JSON, 3 MB, a redirect (not followed), a stream that never ends", async () => {
  const { hf, mcp } = await ready({ badJson: true });
  try {
    const r = await mcp.call("balance", {});
    assert.deepEqual([r.ok, r.why], [false, "not_json"]);
  } finally { await hf.close(); }
  let mode = "huge";
  let after = 0;
  const srv = await hostile((msg, req, res) => {
    if (mode === "huge") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { structuredContent: { pad: "x".repeat(3 * 1024 * 1024) } } }));
    }
    if (mode === "redirect") {
      if (req.url !== "/mcp") after += 1;
      res.writeHead(307, { Location: "/elsewhere", "Content-Length": 0 });
      return res.end();
    }
    if (mode === "hugeStream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ping = `event: ping\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{"pad":"${"z".repeat(60_000)}"}}\n\n`;
      const timer = setInterval(() => { if (!res.write(ping)) { /* full */ } }, 1);
      res.on("close", () => clearInterval(timer));
      return undefined;
    }
    // never: a stream that stays open with a ping now and then, never our answer
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": open\n\n");
    const timer = setInterval(() => res.write("event: ping\ndata: {}\n\n"), 50);
    res.on("close", () => clearInterval(timer));
    return undefined;
  });
  try {
    const mcp2 = createMcpClient({ origin: srv.origin, token: fixedToken, limits: { callMs: 1500 } });
    assert.equal((await mcp2.call("balance", {})).why, "too_big");
    mode = "redirect";
    const before = srv.seen.length;
    const r = await mcp2.call("balance", {});
    assert.deepEqual([r.why, r.status], ["redirect", 307]);
    assert.equal(srv.seen.length, before + 1);
    assert.equal(after, 0);
    mode = "hugeStream";
    assert.equal((await mcp2.call("balance", {})).why, "too_big");
    mode = "never";
    const t0 = Date.now();
    assert.equal((await mcp2.call("balance", {})).why, "time");
    assert.ok(Date.now() - t0 < 4000);
  } finally { await srv.close(); }
});

test("a 401 asks the sign-in for a new token once, and the call goes on with it", async () => {
  const { hf, mcp, auth } = await ready({ expire: true });
  try {
    const before = hf.tokens.access;
    assert.equal((await mcp.call("balance", {})).ok, true);       // the token dies after this call
    const r = await mcp.call("balance", {});
    assert.equal(r.ok, true, r.why);
    assert.notEqual(hf.tokens.access, before);
    assert.equal(hf.calls.filter((c) => c.grant === "refresh_token").length, 1);
    assert.equal((await auth.token()).access, hf.tokens.access);
    assert.equal(rpcs(hf, "initialize"), 1);
  } finally { await hf.close(); }
});

test("refuseRefresh: the call is refused as `refused`, and no MCP call is made after", async () => {
  const { hf, mcp, auth } = await ready({ expire: true, refuseRefresh: true });
  try {
    assert.equal((await mcp.call("balance", {})).ok, true);
    const r = await mcp.call("balance", {});
    assert.deepEqual([r.ok, r.why], [false, "refused"]);
    assert.deepEqual(auth.status(), { signedIn: false, refused: true });
    const n = mcpCalls(hf);
    const again = await mcp.call("balance", {});
    assert.deepEqual([again.ok, again.why, again.sent], [false, "refused", false]);
    assert.equal(mcpCalls(hf), n);
  } finally { await hf.close(); }
});

test("sessionLost: one new session, then the call works; a session lost again is not chased", async () => {
  const { hf, mcp } = await ready({ sessionLost: true });
  try {
    assert.equal((await mcp.call("balance", {})).ok, true);
    assert.equal(rpcs(hf, "initialize"), 2);
    assert.equal((await mcp.call("balance", {})).ok, true);
    assert.equal(rpcs(hf, "initialize"), 2);
  } finally { await hf.close(); }
  const srv = await hostile((msg, req, res) => { res.writeHead(404, { "Content-Length": 0 }); res.end(); });
  try {
    const r = await createMcpClient({ origin: srv.origin, token: fixedToken }).call("balance", {});
    assert.deepEqual([r.why, r.status], ["session_lost", 404]);
    assert.equal(srv.seen.filter((s) => s.method === "initialize").length, 2);
  } finally { await srv.close(); }
});

test("a session id that is not one is refused; a server that keeps none is fine", async () => {
  const bad = await hostile((msg, req, res) => answer(res, msg, { structuredContent: { credits: 1 } }), { sessionId: "has space" });
  try {
    assert.equal((await createMcpClient({ origin: bad.origin, token: fixedToken }).call("balance", {})).why, "bad_session");
    assert.equal(bad.seen.filter((s) => s.method === "tools/call").length, 0);
  } finally { await bad.close(); }
  const none = await hostile((msg, req, res) => answer(res, msg, { structuredContent: { credits: 1 } }), { sessionId: null });
  try {
    assert.deepEqual(await createMcpClient({ origin: none.origin, token: fixedToken }).call("balance", {}), { ok: true, result: { credits: 1 } });
    assert.ok(none.seen.every((s) => s.headers["mcp-session-id"] === undefined));
  } finally { await none.close(); }
});

test("only the door's tools, never use_unlim or use_free_gens, and nothing at all while signed out", async () => {
  const { hf, mcp, auth } = await ready();
  try {
    const n = mcpCalls(hf);
    for (const name of ["execute_preset", "show_generation_by_ids", "transactions", "models_explore", "media_upload_widget"]) {
      assert.equal((await mcp.call(name, {})).why, "tool_not_allowed", name);
    }
    assert.equal((await mcp.call("generate_image", { params: { model: "flux_2", use_unlim: true } })).why, "bad_arguments");
    assert.equal((await mcp.call("generate_image", { params: { model: "flux_2", use_free_gens: true } })).why, "bad_arguments");
    assert.equal((await mcp.call("balance", null)).why, "bad_arguments");
    assert.equal(mcpCalls(hf), n);
    auth.forget();
    const r = await mcp.call("balance", {});
    assert.deepEqual([r.ok, r.why, r.sent], [false, "signed_out", false]);
    assert.equal(mcpCalls(hf), n);
  } finally { await hf.close(); }
});

test("Higgsfield's own origin goes through a pinned lookup; a private address is refused before connecting", async () => {
  const hf = await startHiggsfield();
  try {
    const looked = [];
    const priv = { resolve: async (h) => { looked.push(h); return [{ address: "192.168.1.9", family: 4 }]; }, connect: () => { throw new Error("must not connect"); } };
    const r = await createMcpClient({ origin: HF_ORIGIN, token: fixedToken, net: priv }).call("balance", {});
    assert.deepEqual([r.ok, r.why], [false, "private_address"]);
    assert.deepEqual(looked, [HF_HOST]);
    const loop = { resolve: async () => [{ address: "127.0.0.1", family: 4 }], connect: () => { throw new Error("must not connect"); } };
    assert.equal((await createMcpClient({ origin: HF_ORIGIN, token: fixedToken, net: loop }).call("balance", {})).why, "private_address");
    assert.throws(() => createMcpClient({ origin: `${HF_ORIGIN}.evil.test`, token: fixedToken }), /origin must be/);
    assert.throws(() => createMcpClient({ origin: HF_ORIGIN }), /token/);
  } finally { await hf.close(); }
});
