// The owner's Runway account sign-in (PLAN-ONBOARD R1) against the stand-in Runway MCP server:
// the address the browser opens, the code taken back once and at once, the token file, refreshes,
// a refused refresh, signing out. Made-up tokens in temp folders. A guard fails the file if any
// socket is opened to a host other than 127.0.0.1: nothing here reaches Runway.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import dc from "node:diagnostics_channel";
import net from "node:net";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AUTH_FILE_BYTES, HF_CLIENT_NAME, PENDING_MS, RW_AUTH_FILE_BYTES, RW_CLIENT_NAME, createRwAuth } from "../oauth.mjs";
import { RW_MCP_ORIGIN, RW_SCOPE, checkRwOrigin } from "../runway-mcp.mjs";
import { ACCESS_SECONDS, startRunwayMcp } from "../../test/stubs/runway-mcp.mjs";

// ---- the guard: every socket this file opens lands on 127.0.0.1 ----
const strays = [];
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guarded(...args) {
  const a = args[0];
  const o = Array.isArray(a) ? a[0] : a;
  const host = o !== null && typeof o === "object" ? (o.path ? "127.0.0.1" : o.host) : typeof args[1] === "string" ? args[1] : "localhost";
  if (host !== "127.0.0.1") strays.push(String(host));
  return realConnect.apply(this, args);
};
const onFetch = (m) => { const h = m && m.connectParams && m.connectParams.hostname; if (h !== "127.0.0.1") strays.push(String(h)); };
dc.subscribe("undici:client:beforeConnect", onFetch);
after(() => {
  net.Socket.prototype.connect = realConnect;
  dc.unsubscribe("undici:client:beforeConnect", onFetch);
  assert.deepEqual(strays, [], "a socket was opened to a host other than 127.0.0.1");
});

const REDIRECT = "http://127.0.0.1:41999/api/generation/runway/back";

function setup(rm, { origin = rm.url } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rw-auth-"));
  const file = join(root, "secrets", "doors", "runway-oauth.json");
  const lines = [];
  let t = Date.now();
  const auth = createRwAuth({ origin, file, redirectUri: REDIRECT, net: rm.net, now: () => t, log: (l) => lines.push(l) });
  return { root, file, lines, auth, add: (ms) => { t += ms; } };
}
async function browser(rm, url) {
  const u = new URL(url);
  const res = await fetch(`${rm.url}${u.pathname}${u.search}`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const back = new URL(res.headers.get("location"));
  return { code: back.searchParams.get("code"), state: back.searchParams.get("state") };
}
async function signIn(rm, s) {
  const b = await s.auth.begin();
  assert.equal(b.ok, true, b.why);
  const back = await browser(rm, b.url);
  const f = await s.auth.finish(back);
  assert.equal(f.ok, true, f.why);
  return back;
}
const grants = (rm, grant) => rm.calls.filter((c) => c.path === "/token" && c.grant === grant).length;

test("Runway's one origin: exactly it, or a stand-in on 127.0.0.1; never a look-alike or Runway's other hosts", () => {
  assert.equal(checkRwOrigin(RW_MCP_ORIGIN).resource, "https://mcp.runwayml.com/mcp");
  assert.equal(checkRwOrigin("http://127.0.0.1:4100").standIn, true);
  for (const bad of ["https://mcp.runwayml.com/", "https://mcp.runwayml.com.evil.example", "https://dev.runwayml.com", "https://api.dev.runwayml.com",
    "http://mcp.runwayml.com", "https://MCP.runwayml.com", "http://localhost:4100", "http://127.0.0.2:4100", "https://mcp.runwayml.com:444", null]) {
    assert.throws(() => checkRwOrigin(bad), /origin must be/, String(bad));
    assert.throws(() => createRwAuth({ origin: bad, file: "/tmp/x", redirectUri: REDIRECT }), /origin must be/, String(bad));
  }
  assert.equal(RW_SCOPE, "openid api:read_write");
  assert.equal(RW_CLIENT_NAME, HF_CLIENT_NAME);
});

test("begin registers one client (a long id) and answers /authorize with S256, a state, the scope and the resource", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    const b = await s.auth.begin();
    assert.equal(b.ok, true, b.why);
    const u = new URL(b.url);
    assert.equal(`${u.origin}${u.pathname}`, `${rm.url}/authorize`);
    const q = u.searchParams;
    assert.ok(q.get("client_id").length > 400, "Runway's client id is long");
    assert.deepEqual([q.get("response_type"), q.get("redirect_uri"), q.get("code_challenge_method"), q.get("scope"), q.get("resource")],
      ["code", REDIRECT, "S256", "openid api:read_write", `${rm.url}/mcp`]);
    assert.match(q.get("state"), /^[0-9a-f]{64}$/);
    assert.match(q.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
    const reg = rm.calls.filter((c) => c.path === "/register");
    assert.deepEqual([reg.length, reg[0].scope, reg[0].name], [1, "openid api:read_write", "uuu engine on this Mac"]);
    await s.auth.begin();
    assert.equal(rm.calls.filter((c) => c.path === "/register").length, 1, "the client is registered once");
  } finally { await rm.close(); }
});

test("finish: a wrong state changes nothing, the right one signs in once and exchanges the code at once; a second use is refused", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    const b = await s.auth.begin();
    const back = await browser(rm, b.url);
    assert.deepEqual(await s.auth.finish({ code: back.code, state: "0".repeat(64) }), { ok: false, why: "bad_state" });
    assert.deepEqual(await s.auth.finish({ code: back.code }), { ok: false, why: "bad_state" });
    assert.equal(grants(rm, "authorization_code"), 0, "a wrong state sends nothing");
    assert.equal(existsSync(s.file), false);
    assert.deepEqual(await s.auth.finish(back), { ok: true });
    assert.equal(grants(rm, "authorization_code"), 1, "exchanged within finish itself");
    const ex = rm.calls.find((c) => c.grant === "authorization_code");
    assert.deepEqual(ex.fields, ["client_id", "code", "code_verifier", "grant_type", "redirect_uri", "resource"]);
    assert.equal(ex.resource, `${rm.url}/mcp`);
    assert.deepEqual(await s.auth.finish(back), { ok: false, why: "no_pending" });
    assert.equal(grants(rm, "authorization_code"), 1);
    assert.deepEqual(s.auth.status(), { signedIn: true, refused: false });
  } finally { await rm.close(); }
});

test("a state ten minutes old is refused and nothing is exchanged", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    const b = await s.auth.begin();
    const back = await browser(rm, b.url);
    s.add(PENDING_MS);
    assert.deepEqual(await s.auth.finish(back), { ok: false, why: "expired" });
    assert.equal(grants(rm, "authorization_code"), 0);
    assert.equal(existsSync(s.file), false);
  } finally { await rm.close(); }
});

test("the token file is 0600 in a 0700 folder; no log line holds a token, a code, a verifier or a state", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    await signIn(rm, s);
    assert.equal(statSync(s.file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(s.file)).mode & 0o777, 0o700);
    const rec = JSON.parse(readFileSync(s.file, "utf8"));
    assert.equal(rec.accessToken, rm.tokens.access);
    const t = await s.auth.token();
    assert.equal(t.access, rm.tokens.access);
    const secrets = [rm.tokens.access, rm.tokens.refresh, ...rm.secrets.codes, ...rm.secrets.states, ...rm.secrets.verifiers];
    assert.ok(s.lines.length >= 2);
    for (const l of s.lines) for (const x of secrets) assert.ok(!l.includes(x), `a secret in a log line: ${l}`);
    assert.ok(s.lines.every((l) => / runway /.test(l)), "lines say runway, not higgsfield");
  } finally { await rm.close(); }
});

test("refresh under a minute left, rotating the refresh token; a refused refresh marks the file refused", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    await signIn(rm, s);
    const first = rm.tokens.access;
    s.add(ACCESS_SECONDS * 1000 - 30_000);
    const t = await s.auth.token();
    assert.equal(t.ok, true);
    assert.notEqual(t.access, first);
    assert.equal(grants(rm, "refresh_token"), 1);
    assert.equal(JSON.parse(readFileSync(s.file, "utf8")).refreshToken, rm.tokens.refresh, "the rotated one is kept");
    rm.behaviour.refuseRefresh = true;
    const r = await s.auth.token({ stale: t.access });
    assert.deepEqual(r, { ok: false, why: "refused" });
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: true });
    assert.deepEqual(await s.auth.token(), { ok: false, why: "refused" });
  } finally { await rm.close(); }
});

test("forget deletes the token file: signed out, and no token is given", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    await signIn(rm, s);
    assert.deepEqual(s.auth.forget(), { ok: true });
    assert.equal(existsSync(s.file), false);
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: false });
    assert.deepEqual(await s.auth.token(), { ok: false, why: "signed_out" });
  } finally { await rm.close(); }
});

// R5 (the review's lower finding on the token file's size): Runway's longest record (a 2,048-character
// client id and two 8,192-character tokens) is over Higgsfield's 16 KB, and must still read as signed in.
test("the token file's cap is 32 KB for Runway: the longest record Runway's rules allow is read; a larger file is signed out", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    await signIn(rm, s);
    const rec = JSON.parse(readFileSync(s.file, "utf8"));
    const long = { ...rec, clientId: "c".repeat(2048), accessToken: `a${"x".repeat(8191)}`, refreshToken: `r${"y".repeat(8191)}` };
    const text = `${JSON.stringify(long)}\n`;
    assert.ok(Buffer.byteLength(text) > AUTH_FILE_BYTES && Buffer.byteLength(text) <= RW_AUTH_FILE_BYTES, String(Buffer.byteLength(text)));
    writeFileSync(s.file, text, { mode: 0o600 });
    assert.deepEqual(s.auth.status(), { signedIn: true, refused: false });
    assert.equal((await s.auth.token()).access, long.accessToken);
    writeFileSync(s.file, `${JSON.stringify({ ...long, pad: "p".repeat(RW_AUTH_FILE_BYTES) })}\n`, { mode: 0o600 });
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: false });
  } finally { await rm.close(); }
});

// The save side of the same cap (second look, item 5): a record the reader would refuse for its size
// is never written. A file at exactly 32 KB with a 16-character access token; the refresh brings a
// longer one, so the new record is over the cap: the save is refused and the old file is left as it was.
test("a refreshed record over 32 KB is never saved: the refresh is not taken and the file is unchanged", async () => {
  const rm = await startRunwayMcp();
  try {
    const s = setup(rm);
    await signIn(rm, s);
    const rec = JSON.parse(readFileSync(s.file, "utf8"));
    const short = { ...rec, accessToken: "s".repeat(16), accessExpiresAt: new Date(Date.now() - 60_000).toISOString(), pad: "" };
    const base = Buffer.byteLength(`${JSON.stringify(short)}\n`);
    const text = `${JSON.stringify({ ...short, pad: "p".repeat(RW_AUTH_FILE_BYTES - base) })}\n`;
    assert.equal(Buffer.byteLength(text), RW_AUTH_FILE_BYTES, "the largest file the reader takes");
    writeFileSync(s.file, text, { mode: 0o600 });
    assert.deepEqual(s.auth.status(), { signedIn: true, refused: false });
    assert.ok(rm.tokens.access.length > 16, "the stand-in's token is longer than the one in the file");
    const before = grants(rm, "refresh_token");
    assert.deepEqual(await s.auth.token(), { ok: false, why: "unreachable" });
    assert.equal(grants(rm, "refresh_token"), before + 1, "Runway was asked once");
    assert.equal(readFileSync(s.file, "utf8"), text, "the file is the one written before");
    assert.ok(!s.lines.some((l) => l.includes("token refreshed")));
  } finally { await rm.close(); }
});
