import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { startHiggsfield, mp4Bytes, pngBytes, PRICES, CDN_HOST, UPLOAD_HOST } from "./higgsfield.mjs";

const REDIRECT = "http://127.0.0.1:41999/api/generation/higgsfield/back";
const challengeOf = (v) => createHash("sha256").update(v).digest("base64url");
const form = (o) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

async function register(hf, redirects = [REDIRECT]) {
  const res = await fetch(`${hf.url}/oauth2/register`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "uuu engine on this Mac", redirect_uris: redirects, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: "openid email offline_access" }) });
  return { status: res.status, json: await res.json() };
}
async function authorize(hf, clientId, over = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challengeOf(verifier),
    code_challenge_method: "S256", state: "st-1", scope: "openid email offline_access", ...over });
  for (const [k, v] of [...q]) if (v === "") q.delete(k);
  const res = await fetch(`${hf.url}/oauth2/authorize?${q}`, { redirect: "manual" });
  return { res, verifier };
}
async function signIn(hf) {
  const { json: c } = await register(hf);
  const { res, verifier } = await authorize(hf, c.client_id);
  const code = new URL(res.headers.get("location")).searchParams.get("code");
  const t = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: c.client_id, code_verifier: verifier }));
  return { clientId: c.client_id, code, verifier, tokens: await t.json() };
}
let rpcId = 0;
async function rpc(hf, token, body, session) {
  const res = await fetch(`${hf.url}/mcp`, { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`,
    ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", ...body }) });
  const text = await res.text();
  return { res, text };
}
async function open(hf, token) {
  const { res, text } = await rpc(hf, token, { id: ++rpcId, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "uuu-generation-door", version: "1" } } });
  const session = res.headers.get("mcp-session-id");
  await rpc(hf, token, { method: "notifications/initialized" }, session);
  return { session, res, text };
}
const parseBody = (text) => {
  const m = /^event: message\ndata: (.*)$/m.exec(text);
  return JSON.parse(m ? m[1] : text);
};
async function tool(hf, token, session, name, args) {
  const { res, text } = await rpc(hf, token, { id: ++rpcId, method: "tools/call", params: { name, arguments: args } }, session);
  return { status: res.status, res, text, msg: res.status === 200 ? (() => { try { return parseBody(text); } catch { return null; } })() : null };
}
async function ready(behaviour) {
  const hf = await startHiggsfield({ behaviour });
  const s = await signIn(hf);
  const { session } = await open(hf, s.tokens.access_token);
  return { hf, s, token: s.tokens.access_token, session };
}

test("the two well-known documents name this listener's own paths", async () => {
  const hf = await startHiggsfield();
  try {
    const a = await (await fetch(`${hf.url}/.well-known/oauth-authorization-server`)).json();
    assert.equal(a.authorization_endpoint, `${hf.url}/oauth2/authorize`);
    assert.equal(a.token_endpoint, `${hf.url}/oauth2/token`);
    assert.equal(a.registration_endpoint, `${hf.url}/oauth2/register`);
    assert.deepEqual(a.code_challenge_methods_supported, ["S256"]);
    const p = await (await fetch(`${hf.url}/.well-known/oauth-protected-resource`)).json();
    assert.equal(p.resource, `${hf.url}/mcp`);
    assert.deepEqual(p.bearer_methods_supported, ["header"]);
  } finally { await hf.close(); }
});

test("register accepts a loopback redirect and refuses any other", async () => {
  const hf = await startHiggsfield();
  try {
    const ok = await register(hf);
    assert.equal(ok.status, 201);
    assert.match(ok.json.client_id, /^[A-Za-z0-9._:-]{1,200}$/);
    for (const bad of ["https://127.0.0.1:41999/x", "http://localhost:41999/x", "http://evil.example/x", "http://127.0.0.1/x"]) {
      const r = await register(hf, [bad]);
      assert.equal(r.status, 400, bad);
      assert.equal(r.json.error, "invalid_redirect_uri");
    }
    assert.equal((await register(hf, [REDIRECT, "http://evil.example/x"])).status, 400);
  } finally { await hf.close(); }
});

test("authorize redirects with code and state; it checks the client, redirect, S256 and state", async () => {
  const hf = await startHiggsfield();
  try {
    const { json: c } = await register(hf);
    const { res } = await authorize(hf, c.client_id);
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, REDIRECT);
    assert.equal(loc.searchParams.get("state"), "st-1");
    assert.match(loc.searchParams.get("code"), /^[A-Za-z0-9._~-]{1,512}$/);
    assert.equal((await authorize(hf, "hfc_unknown")).res.status, 400);
    assert.equal((await authorize(hf, c.client_id, { redirect_uri: "http://127.0.0.1:1/other" })).res.status, 400);
    assert.equal((await authorize(hf, c.client_id, { code_challenge_method: "plain" })).res.status, 400);
    assert.equal((await authorize(hf, c.client_id, { code_challenge_method: "" })).res.status, 400);
    assert.equal((await authorize(hf, c.client_id, { state: "" })).res.status, 400);
    assert.equal((await authorize(hf, c.client_id, { response_type: "token" })).res.status, 400);
  } finally { await hf.close(); }
});

test("token: the right verifier gives tokens with expires_in 3600; a code works once", async () => {
  const hf = await startHiggsfield();
  try {
    const s = await signIn(hf);
    assert.equal(s.tokens.token_type, "Bearer");
    assert.equal(s.tokens.expires_in, 3600);
    assert.ok(s.tokens.access_token && s.tokens.refresh_token);
    const again = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "authorization_code", code: s.code, redirect_uri: REDIRECT, client_id: s.clientId, code_verifier: s.verifier }));
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, "invalid_grant");
  } finally { await hf.close(); }
});

test("token: a wrong verifier is refused and burns the code; a wrong redirect is refused", async () => {
  const hf = await startHiggsfield();
  try {
    const { json: c } = await register(hf);
    const a = await authorize(hf, c.client_id);
    const code = new URL(a.res.headers.get("location")).searchParams.get("code");
    const wrong = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: c.client_id, code_verifier: randomBytes(32).toString("base64url") }));
    assert.equal(wrong.status, 400);
    const retry = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: c.client_id, code_verifier: a.verifier }));
    assert.equal(retry.status, 400);
    const b = await authorize(hf, c.client_id);
    const code2 = new URL(b.res.headers.get("location")).searchParams.get("code");
    const badRedirect = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "authorization_code", code: code2, redirect_uri: "http://127.0.0.1:1/x", client_id: c.client_id, code_verifier: b.verifier }));
    assert.equal(badRedirect.status, 400);
  } finally { await hf.close(); }
});

test("refresh_token rotates: the old one dies; refuseRefresh answers invalid_grant", async () => {
  const hf = await startHiggsfield();
  try {
    const s = await signIn(hf);
    const r1 = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "refresh_token", refresh_token: s.tokens.refresh_token, client_id: s.clientId }));
    assert.equal(r1.status, 200);
    const t2 = await r1.json();
    assert.notEqual(t2.refresh_token, s.tokens.refresh_token);
    assert.equal(t2.expires_in, 3600);
    const old = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "refresh_token", refresh_token: s.tokens.refresh_token, client_id: s.clientId }));
    assert.equal(old.status, 400);
    hf.behaviour.refuseRefresh = true;
    const refused = await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "refresh_token", refresh_token: t2.refresh_token, client_id: s.clientId }));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error, "invalid_grant");
  } finally { await hf.close(); }
});

test("mcp: no token or a wrong token is a 401 with the www-authenticate header", async () => {
  const hf = await startHiggsfield();
  try {
    const none = await fetch(`${hf.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    assert.equal(none.status, 401);
    assert.match(none.headers.get("www-authenticate"), /^Bearer resource_metadata="[^"]+\/mcp", scope="openid email offline_access"$/);
    const wrong = await rpc(hf, "nope", { id: 1, method: "initialize", params: {} });
    assert.equal(wrong.res.status, 401);
    assert.equal(hf.calls.filter((c) => c.path === "/mcp")[0].hasAuth, false);
  } finally { await hf.close(); }
});

test("mcp: initialize gives a session id, a protocol version, and initialized is a 202", async () => {
  const hf = await startHiggsfield();
  try {
    const s = await signIn(hf);
    const o = await open(hf, s.tokens.access_token);
    assert.match(o.session, /^[\x21-\x7e]{1,200}$/);
    assert.equal(parseBody(o.text).result.protocolVersion, "2025-06-18");
    const noSession = await rpc(hf, s.tokens.access_token, { id: 9, method: "tools/call", params: { name: "balance", arguments: {} } });
    assert.equal(noSession.res.status, 400);
    const unknown = await rpc(hf, s.tokens.access_token, { id: 9, method: "tools/call", params: { name: "balance", arguments: {} } }, "nope");
    assert.equal(unknown.res.status, 404);
    const bad = await rpc(hf, s.tokens.access_token, { id: 10, method: "nothing" }, o.session);
    assert.equal(parseBody(bad.text).error.code, -32601);
  } finally { await hf.close(); }
});

test("balance, and get_cost on all three generate tools answers a price only (no job)", async () => {
  const { hf, token, session } = await ready();
  try {
    const bal = await tool(hf, token, session, "balance", {});
    assert.deepEqual(bal.msg.result.structuredContent, { credits: 3896, plan: "max" });
    const img = await tool(hf, token, session, "generate_image", { params: { model: "gpt_image_2_6", prompt: "x", aspect_ratio: "16:9", get_cost: true } });
    assert.equal(img.msg.result.structuredContent.credits, PRICES.image);
    assert.equal(img.msg.result.structuredContent.job_id, undefined);
    const vid = await tool(hf, token, session, "generate_video", { params: { model: "seedance_2_5", prompt: "x", duration: 5, get_cost: true } });
    assert.equal(vid.msg.result.structuredContent.credits, PRICES.videoPerSecond * 5);
    const up = await tool(hf, token, session, "upscale_image", { image_id: "media_x", width: 10, height: 10, get_cost: true });
    assert.equal(up.msg.result.structuredContent.credits, PRICES.upscale);
    assert.equal(up.msg.result.structuredContent.job_id, undefined);
    assert.equal(JSON.parse(up.msg.result.content[0].text).credits, PRICES.upscale);
  } finally { await hf.close(); }
});

test("priceHigher makes every price 1.5 times the table's", async () => {
  const { hf, token, session } = await ready({ priceHigher: true });
  try {
    const vid = await tool(hf, token, session, "generate_video", { params: { model: "m", duration: 5, get_cost: true } });
    assert.equal(vid.msg.result.structuredContent.credits, Math.round(PRICES.videoPerSecond * 5 * 1.5));
  } finally { await hf.close(); }
});

test("a job: pending, then done with an address on the cdn name; the output is served", async () => {
  const { hf, token, session } = await ready();
  try {
    const g = await tool(hf, token, session, "generate_image", { params: { model: "m", prompt: "x" } });
    const id = g.msg.result.structuredContent.job_id;
    assert.match(id, /^[A-Za-z0-9_-]{1,80}$/);
    const w1 = await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: id }], timeout_seconds: 0 });
    assert.equal(w1.msg.result.structuredContent.jobs[0].status, "queued");
    const w2 = await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: id }], timeout_seconds: 0 });
    const done = w2.msg.result.structuredContent.jobs[0];
    assert.equal(done.status, "completed");
    assert.equal(done.result.url, `https://${CDN_HOST}/out/${id}.png`);
    const out = await fetch(`${hf.url}/out/${id}.png`);
    assert.deepEqual(Buffer.from(await out.arrayBuffer()).subarray(0, 8), pngBytes().subarray(0, 8));
    const v = await tool(hf, token, session, "generate_video", { params: { model: "m", prompt: "x", duration: 5 } });
    const vid = v.msg.result.structuredContent.job_id;
    await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: vid }] });
    const wv = await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: vid }] });
    assert.match(wv.msg.result.structuredContent.jobs[0].result.url, /\.mp4$/);
    const mp4 = Buffer.from(await (await fetch(`${hf.url}/out/${vid}.mp4`)).arrayBuffer());
    assert.equal(mp4.toString("latin1", 4, 8), "ftyp");
    assert.deepEqual(mp4.subarray(0, 12), mp4Bytes().subarray(0, 12));
    const missing = await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: "job_nope" }] });
    assert.equal(missing.msg.result.structuredContent.jobs[0].status, "not_found");
  } finally { await hf.close(); }
});

test("job behaviours: nsfw, failed, slow", async () => {
  for (const [name, status] of [["nsfw", "nsfw"], ["failed", "failed"], ["slow", "in_progress"]]) {
    const { hf, token, session } = await ready({ [name]: true });
    try {
      const g = await tool(hf, token, session, "generate_image", { params: { model: "m", prompt: "x" } });
      const id = g.msg.result.structuredContent.job_id;
      await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: id }] });
      const w = await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: id }] });
      const j = w.msg.result.structuredContent.jobs[0];
      assert.equal(j.status, status, name);
      assert.equal(j.result, undefined);
      const w3 = await tool(hf, token, session, "jobs_wait", { jobs: [{ index: 0, job_id: id }] });
      assert.equal(w3.msg.result.structuredContent.jobs[0].status, status, name);
    } finally { await hf.close(); }
  }
});

test("media_upload gives an upload address on the upload name; the PUT then media_confirm", async () => {
  const { hf, token, session } = await ready();
  try {
    const u = await tool(hf, token, session, "media_upload", { filename: "frame.png", content_type: "image/png" });
    const r = u.msg.result.structuredContent;
    assert.match(r.upload_url, new RegExp(`^https://${UPLOAD_HOST.replace(/\./g, "\\.")}/upload/media_`));
    assert.equal(r.upload_headers["Content-Type"], "image/png");
    const early = await tool(hf, token, session, "media_confirm", { type: "image", media_id: r.media_id });
    assert.equal(early.msg.result.isError, true);
    const put = await fetch(`${hf.url}/upload/${r.media_id}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes() });
    assert.equal(put.status, 200);
    const c = await tool(hf, token, session, "media_confirm", { type: "image", media_id: r.media_id });
    assert.equal(c.msg.result.structuredContent.status, "ready");
    assert.equal(hf.calls.find((x) => x.method === "PUT").size, pngBytes().length);
    const unknown = await tool(hf, token, session, "media_confirm", { type: "image", media_id: "media_nope" });
    assert.equal(unknown.msg.result.isError, true);
  } finally { await hf.close(); }
});

test("uploadRedirect and outputRedirect answer 302; bigOutput claims over 200 MB", async () => {
  const { hf, token, session } = await ready();
  try {
    const u = await tool(hf, token, session, "media_upload", { filename: "f.png", content_type: "image/png" });
    hf.behaviour.uploadRedirect = true;
    const put = await fetch(`${hf.url}/upload/${u.msg.result.structuredContent.media_id}`, { method: "PUT", body: "x", redirect: "manual" });
    assert.equal(put.status, 302);
    hf.behaviour.outputRedirect = true;
    const out = await fetch(`${hf.url}/out/job_a.png`, { redirect: "manual" });
    assert.equal(out.status, 302);
    hf.behaviour.outputRedirect = false;
    hf.behaviour.bigOutput = true;
    const big = await fetch(`${hf.url}/out/job_a.mp4`);
    assert.ok(Number(big.headers.get("content-length")) > 200 * 1024 * 1024);
    await big.body.cancel();
  } finally { await hf.close(); }
});

test("sse: the same answer arrives as an event stream with the matching id last", async () => {
  const { hf, token, session } = await ready({ sse: true });
  try {
    const r = await tool(hf, token, session, "balance", {});
    assert.match(r.res.headers.get("content-type"), /^text\/event-stream/);
    assert.match(r.text, /^event: ping/);
    assert.equal(r.msg.result.structuredContent.plan, "max");
  } finally { await hf.close(); }
});

test("expire: the token dies after one call; a refresh gives a working one", async () => {
  const { hf, s, token, session } = await ready({ expire: true });
  try {
    assert.equal((await tool(hf, token, session, "balance", {})).status, 200);
    assert.equal((await tool(hf, token, session, "balance", {})).status, 401);
    const r = await (await fetch(`${hf.url}/oauth2/token`, form({ grant_type: "refresh_token", refresh_token: s.tokens.refresh_token, client_id: s.clientId }))).json();
    assert.equal((await tool(hf, r.access_token, session, "balance", {})).status, 200);
  } finally { await hf.close(); }
});

test("sessionLost: the live session 404s once; a new initialize works", async () => {
  const { hf, token, session } = await ready({ sessionLost: true });
  try {
    assert.equal((await tool(hf, token, session, "balance", {})).status, 404);
    const again = await open(hf, token);
    assert.notEqual(again.session, session);
    assert.equal((await tool(hf, token, again.session, "balance", {})).status, 200);
  } finally { await hf.close(); }
});

test("badJson answers something that is not JSON; toolError holds the token in its text", async () => {
  const { hf, s, token, session } = await ready({ badJson: true });
  try {
    const r = await tool(hf, token, session, "balance", {});
    assert.equal(r.status, 200);
    assert.throws(() => JSON.parse(r.text));
    hf.behaviour.badJson = false;
    hf.behaviour.toolError = true;
    const e = await tool(hf, token, session, "balance", {});
    assert.equal(e.msg.result.isError, true);
    assert.ok(e.msg.result.content[0].text.includes(s.tokens.access_token));
  } finally { await hf.close(); }
});

test("use_unlim or use_free_gens set true is refused", async () => {
  const { hf, token, session } = await ready();
  try {
    for (const flag of ["use_unlim", "use_free_gens"]) {
      const r = await tool(hf, token, session, "generate_image", { params: { model: "m", prompt: "x", [flag]: true } });
      assert.equal(r.msg.result.isError, true);
    }
  } finally { await hf.close(); }
});

test("net resolves the three made-up names and refuses others", async () => {
  const hf = await startHiggsfield();
  try {
    for (const h of ["mcp.higgsfield.test", "upload.higgsfield.test", "cdn.higgsfield.test"]) {
      const [a] = await hf.net.resolve(h);
      assert.match(a.address, /^13\.32\.0\.\d+$/);
    }
    await assert.rejects(hf.net.resolve("example.com"), { code: "ENOTFOUND" });
    const [a] = await hf.net.resolve(CDN_HOST);
    const sock = hf.net.connect({ address: a.address, port: 443, hostname: CDN_HOST, secure: true });
    await new Promise((resolve, reject) => { sock.once("connect", resolve); sock.once("error", reject); });
    sock.destroy();
  } finally { await hf.close(); }
});

test("calls record whether Authorization came, never a token, code or verifier", async () => {
  const hf = await startHiggsfield();
  try {
    const s = await signIn(hf);
    const { session } = await open(hf, s.tokens.access_token);
    await tool(hf, s.tokens.access_token, session, "balance", {});
    await fetch(`${hf.url}/.well-known/oauth-authorization-server`);
    const dump = JSON.stringify(hf.calls);
    for (const secret of [s.tokens.access_token, s.tokens.refresh_token, s.code, s.verifier, s.clientId.slice(4)]) {
      if (secret.length >= 8) assert.ok(!dump.includes(secret), "a secret is in the record");
    }
    assert.ok(!/Bearer/i.test(dump));
    assert.equal(hf.calls.find((c) => c.rpc === "tools/call").hasAuth, true);
    assert.equal(hf.calls.find((c) => c.path === "/.well-known/oauth-authorization-server").hasAuth, false);
    assert.deepEqual(hf.calls.find((c) => c.path === "/oauth2/token").fields, ["client_id", "code", "code_verifier", "grant_type", "redirect_uri"]);
  } finally { await hf.close(); }
});
