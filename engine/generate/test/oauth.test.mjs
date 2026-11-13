// The owner's Higgsfield sign-in (PLAN-V5 K21) against the stand-in Higgsfield (T67): the
// address the browser opens, the code taken back once, the token file, refreshes, a refused
// refresh, signing out. Made-up tokens in temp folders; every socket lands on 127.0.0.1.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HF_CLIENT_NAME, HF_SCOPE, PENDING_MS, createHfAuth } from "../oauth.mjs";
import { HF_ORIGIN } from "../higgsfield.mjs";
import { startHiggsfield } from "../../test/stubs/higgsfield.mjs";

const REDIRECT = "http://127.0.0.1:41999/api/generation/higgsfield/back";
const HF_HOST = new URL(HF_ORIGIN).hostname;
const HOUR = 3600_000;

function setup(hf, { origin = hf.url, net = hf.net } = {}) {
  const root = mkdtempSync(join(tmpdir(), "hf-auth-"));
  const file = join(root, "secrets", "doors", "higgsfield-oauth.json");
  const lines = [];
  let t = Date.now();
  const auth = createHfAuth({ origin, file, redirectUri: REDIRECT, net, now: () => t, log: (l) => lines.push(l) });
  return { root, file, lines, auth, add: (ms) => { t += ms; }, at: () => t };
}
// The owner's browser: opens the address and reads the code and the state off the stand-in's
// 302 to the return address (which is not fetched).
async function browser(hf, url) {
  const u = new URL(url);
  const res = await fetch(`${hf.url}${u.pathname}${u.search}`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const back = new URL(res.headers.get("location"));
  return { code: back.searchParams.get("code"), state: back.searchParams.get("state") };
}
async function signIn(hf, s) {
  const b = await s.auth.begin();
  assert.equal(b.ok, true, b.why);
  const back = await browser(hf, b.url);
  const f = await s.auth.finish(back);
  assert.equal(f.ok, true, f.why);
  return { url: b.url, back };
}
const fileOf = (s) => JSON.parse(readFileSync(s.file, "utf8"));
const grants = (hf, grant) => hf.calls.filter((c) => c.path === "/oauth2/token" && c.grant === grant).length;
// Higgsfield's own origin, with its name looked up as the given address and every byte the door
// writes kept in `sent` (the stand-in is plain HTTP, so nothing is hidden by TLS here).
function routed(hf, sent, address = "13.32.0.11") {
  return {
    resolve: async (host) => (host === HF_HOST ? [{ address, family: 4 }] : hf.net.resolve(host)),
    connect(o) {
      const sock = hf.net.connect(o);
      const write = sock.write.bind(sock);
      sock.write = (chunk, ...rest) => { sent.push(Buffer.from(chunk).toString("latin1")); return write(chunk, ...rest); };
      return sock;
    },
  };
}

test("begin registers one client and answers the authorize address with S256, a state, the scope and the resource", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    const b = await s.auth.begin();
    assert.equal(b.ok, true);
    const u = new URL(b.url);
    assert.equal(`${u.origin}${u.pathname}`, `${hf.url}/oauth2/authorize`);
    const q = u.searchParams;
    assert.equal(q.get("response_type"), "code");
    assert.match(q.get("client_id"), /^[A-Za-z0-9._:-]{1,200}$/);
    assert.equal(q.get("redirect_uri"), REDIRECT);
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.match(q.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
    assert.match(q.get("state"), /^[0-9a-f]{64}$/);
    assert.equal(q.get("scope"), HF_SCOPE);
    assert.equal(q.get("resource"), `${hf.url}/mcp`);
    const again = await s.auth.begin();
    assert.equal(new URL(again.url).searchParams.get("client_id"), q.get("client_id"));
    assert.notEqual(new URL(again.url).searchParams.get("state"), q.get("state"));
    assert.equal(hf.calls.filter((c) => c.path === "/oauth2/register").length, 1);
    assert.equal(existsSync(s.file), false);
  } finally { await hf.close(); }
});

test("the sign-in end to end: the token file is 0600 in a 0700 folder, its shape, and status signed in", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: false });
    const { url } = await signIn(hf, s);
    assert.equal(statSync(s.file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(s.file)).mode & 0o777, 0o700);
    const f = fileOf(s);
    assert.deepEqual(Object.keys(f).sort(), ["accessExpiresAt", "accessToken", "clientId", "redirectUri", "refreshToken", "refused", "savedAt", "version"]);
    assert.equal(f.version, 1);
    assert.equal(f.clientId, new URL(url).searchParams.get("client_id"));
    assert.equal(f.redirectUri, REDIRECT);
    assert.equal(f.accessToken, hf.tokens.access);
    assert.equal(f.refreshToken, hf.tokens.refresh);
    assert.equal(f.refused, false);
    assert.equal(Date.parse(f.accessExpiresAt), s.at() + HOUR);
    assert.deepEqual(s.auth.status(), { signedIn: true, refused: false });
    const t = await s.auth.token();
    assert.equal(t.ok, true);
    assert.equal(t.access, hf.tokens.access);
    assert.equal(grants(hf, "refresh_token"), 0);
    // A second sign-in reuses the saved client.
    await signIn(hf, s);
    assert.equal(hf.calls.filter((c) => c.path === "/oauth2/register").length, 1);
  } finally { await hf.close(); }
});

test("finish refuses another begin's state, an 11-minute-old state, a used one and a bad code, and writes nothing", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    const a = await s.auth.begin();
    const b = await s.auth.begin();               // replaces a
    const backA = await browser(hf, a.url);
    assert.deepEqual(await s.auth.finish(backA), { ok: false, why: "bad_state" });
    const backB = await browser(hf, b.url);
    assert.deepEqual(await s.auth.finish(backB), { ok: false, why: "no_pending" });   // cleared by the refusal before
    const c = await s.auth.begin();
    const backC = await browser(hf, c.url);
    s.add(PENDING_MS + 60_000);
    assert.deepEqual(await s.auth.finish(backC), { ok: false, why: "expired" });
    const d = await s.auth.begin();
    const backD = await browser(hf, d.url);
    assert.deepEqual(await s.auth.finish({ code: "has space", state: backD.state }), { ok: false, why: "bad_code" });
    assert.equal(await s.auth.finish({ code: backD.code, state: backD.state }).then((r) => r.why), "no_pending");
    assert.equal(await s.auth.finish({}).then((r) => r.why), "no_pending");
    assert.equal(existsSync(s.file), false);
    assert.equal(grants(hf, "authorization_code"), 0);
    const e = await s.auth.begin();
    const backE = await browser(hf, e.url);
    assert.equal((await s.auth.finish({ code: backE.code, state: backE.state.toUpperCase() })).why, "bad_state");
    const f = await s.auth.begin();
    const backF = await browser(hf, f.url);
    assert.deepEqual(await s.auth.finish(backF), { ok: true });
    assert.deepEqual(await s.auth.finish(backF), { ok: false, why: "no_pending" });    // used
    assert.equal(grants(hf, "authorization_code"), 1);
  } finally { await hf.close(); }
});

test("a code the sign-in host refuses (a wrong verifier, a used code) writes nothing", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    const a = await s.auth.begin();
    const back = await browser(hf, a.url);
    // The code is used once by someone else first: the door's exchange is refused.
    await fetch(`${hf.url}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: back.code, redirect_uri: REDIRECT, client_id: new URL(a.url).searchParams.get("client_id"), code_verifier: "x".repeat(43) }) });
    assert.deepEqual(await s.auth.finish(back), { ok: false, why: "code_refused" });
    assert.equal(existsSync(s.file), false);
  } finally { await hf.close(); }
});

test("token refreshes when under 60 seconds remain and keeps the rotated refresh token", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    await signIn(hf, s);
    const first = fileOf(s);
    s.add(HOUR - 61_000);
    assert.equal((await s.auth.token()).access, first.accessToken);
    assert.equal(grants(hf, "refresh_token"), 0);
    s.add(2_000);
    const t = await s.auth.token();
    assert.equal(t.ok, true);
    assert.notEqual(t.access, first.accessToken);
    assert.equal(grants(hf, "refresh_token"), 1);
    const next = fileOf(s);
    assert.equal(next.accessToken, t.access);
    assert.equal(next.refreshToken, hf.tokens.refresh);
    assert.notEqual(next.refreshToken, first.refreshToken);
    assert.equal(next.clientId, first.clientId);
    assert.equal(Date.parse(next.accessExpiresAt), s.at() + HOUR);
    assert.equal(statSync(s.file).mode & 0o777, 0o600);
    assert.equal((await s.auth.token()).access, t.access);
    assert.equal(grants(hf, "refresh_token"), 1);
  } finally { await hf.close(); }
});

test("after a 401 the token is refreshed once; a caller whose token was already replaced gets the new one", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    await signIn(hf, s);
    const old = fileOf(s).accessToken;
    const t = await s.auth.token({ stale: old });
    assert.equal(t.ok, true);
    assert.notEqual(t.access, old);
    assert.equal(grants(hf, "refresh_token"), 1);
    const late = await s.auth.token({ stale: old });
    assert.equal(late.access, t.access);
    assert.equal(grants(hf, "refresh_token"), 1);
  } finally { await hf.close(); }
});

test("three calls racing a refresh share one refresh", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    await signIn(hf, s);
    s.add(HOUR);
    const all = await Promise.all([s.auth.token(), s.auth.token(), s.auth.token({ stale: fileOf(s).accessToken })]);
    assert.ok(all.every((t) => t.ok && t.access === all[0].access));
    assert.equal(grants(hf, "refresh_token"), 1);
  } finally { await hf.close(); }
});

test("a refused refresh marks the file refused: no refresh is tried after, until the owner signs in again", async () => {
  const hf = await startHiggsfield({ behaviour: { refuseRefresh: true } });
  try {
    const s = setup(hf);
    await signIn(hf, s);
    s.add(HOUR);
    assert.deepEqual(await s.auth.token(), { ok: false, why: "refused" });
    assert.equal(fileOf(s).refused, true);
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: true });
    assert.deepEqual(await s.auth.token(), { ok: false, why: "refused" });
    assert.equal(grants(hf, "refresh_token"), 1);
    hf.behaviour.refuseRefresh = false;
    await signIn(hf, s);
    assert.deepEqual(s.auth.status(), { signedIn: true, refused: false });
    assert.equal((await s.auth.token()).ok, true);
  } finally { await hf.close(); }
});

test("forget removes the file; a refresh under way when the owner signs out writes nothing", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    await signIn(hf, s);
    s.add(HOUR);
    const racing = s.auth.token();
    assert.deepEqual(s.auth.forget(), { ok: true });
    assert.deepEqual(await racing, { ok: false, why: "signed_out" });
    assert.equal(existsSync(s.file), false);
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: false });
    assert.deepEqual(await s.auth.token(), { ok: false, why: "signed_out" });
    assert.deepEqual(s.auth.forget(), { ok: true });
  } finally { await hf.close(); }
});

test("a token file that is not trusted is not used: a link, group-writable, in a shared folder, not JSON, the wrong shape", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    await signIn(hf, s);
    const good = readFileSync(s.file, "utf8");
    const put = (text, mode = 0o600) => { rmSync(s.file, { force: true }); writeFileSync(s.file, text); chmodSync(s.file, mode); };
    const signedOut = async (name) => {
      assert.deepEqual(s.auth.status(), { signedIn: false, refused: false }, name);
      assert.deepEqual(await s.auth.token(), { ok: false, why: "signed_out" }, name);
    };
    put(good, 0o620);
    await signedOut("group-writable");
    put("not json");
    await signedOut("not json");
    put(JSON.stringify({ ...JSON.parse(good), version: 2 }));
    await signedOut("version");
    put(JSON.stringify({ ...JSON.parse(good), accessToken: "short" }));
    await signedOut("a token that is not one");
    put(JSON.stringify({ ...JSON.parse(good), refused: "no" }));
    await signedOut("refused not a boolean");
    const elsewhere = join(s.root, "elsewhere.json");
    writeFileSync(elsewhere, good, { mode: 0o600 });
    rmSync(s.file);
    symlinkSync(elsewhere, s.file);
    await signedOut("a link");
    put(good);
    assert.equal(s.auth.status().signedIn, true);
    chmodSync(dirname(s.file), 0o770);
    await signedOut("a shared folder");
    chmodSync(dirname(s.file), 0o700);
    assert.equal(s.auth.status().signedIn, true);
  } finally { await hf.close(); }
});

test("a token folder that is a link is never written through: the sign-in does not finish", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    const real = join(s.root, "real-secrets");
    mkdirSync(real, { mode: 0o700 });
    mkdirSync(join(s.root, "secrets"), { mode: 0o700 });
    symlinkSync(real, dirname(s.file));
    const b = await s.auth.begin();
    assert.deepEqual(await s.auth.finish(await browser(hf, b.url)), { ok: false, why: "not_saved" });
    assert.equal(existsSync(join(real, "higgsfield-oauth.json")), false);
    assert.deepEqual(s.auth.status(), { signedIn: false, refused: false });
  } finally { await hf.close(); }
});

test("only Higgsfield's origin or a stand-in on 127.0.0.1, and only a loopback return address", () => {
  const ok = { origin: HF_ORIGIN, file: "/tmp/x.json", redirectUri: REDIRECT };
  assert.ok(createHfAuth(ok));
  for (const origin of [`${HF_ORIGIN}/`, "http://mcp.higgsfield.ai", "https://clerk.higgsfield.ai", "http://localhost:4000", "http://127.0.0.1:4000/mcp", undefined]) {
    assert.throws(() => createHfAuth({ ...ok, origin }), /origin must be/, String(origin));
  }
  for (const redirectUri of ["https://127.0.0.1:41999/back", "http://localhost:41999/back", "http://127.0.0.1:41999/../back", "http://127.0.0.1:41999", "http://evil.test/back", undefined]) {
    assert.throws(() => createHfAuth({ ...ok, redirectUri }), /redirectUri/, String(redirectUri));
  }
  assert.throws(() => createHfAuth({ ...ok, file: "" }), /file/);
});

test("the sign-in host's answers are hostile: a redirect, a huge answer, a client id or a token that is not one; nothing is written", async () => {
  let mode = "redirect";
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (mode === "redirect") { res.writeHead(302, { Location: "http://127.0.0.1:1/elsewhere", "Content-Length": 0 }); return res.end(); }
      if (mode === "huge") { const big = `{"client_id":"${"a".repeat(200)}","x":"${"y".repeat(70_000)}"}`; res.writeHead(201, { "Content-Type": "application/json" }); return res.end(big); }
      if (mode === "badClient") { res.writeHead(201, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ client_id: "has space" })); }
      if (req.url === "/oauth2/register") { res.writeHead(201, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ client_id: "client-1" })); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mode === "shortToken" ? { access_token: "short", token_type: "Bearer" } : { access_token: "a".repeat(40), token_type: "mac" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const root = mkdtempSync(join(tmpdir(), "hf-auth-hostile-"));
    const file = join(root, "secrets", "doors", "higgsfield-oauth.json");
    const auth = createHfAuth({ origin, file, redirectUri: REDIRECT });
    for (const [m, why] of [["redirect", "redirect"], ["huge", "unreachable"], ["badClient", "not_registered"]]) {
      mode = m;
      assert.deepEqual(await auth.begin(), { ok: false, why }, m);
    }
    for (const m of ["shortToken", "macToken"]) {
      mode = m;
      const b = await auth.begin();
      assert.equal(b.ok, true);
      const state = new URL(b.url).searchParams.get("state");
      assert.deepEqual(await auth.finish({ code: "code-1", state }), { ok: false, why: "bad_answer" }, m);
    }
    assert.equal(existsSync(file), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Higgsfield's own origin: the exact registration and code exchange through a pinned lookup, and a private address refused", async () => {
  const hf = await startHiggsfield();
  try {
    const sent = [];
    const s = setup(hf, { origin: HF_ORIGIN, net: routed(hf, sent) });
    const b = await s.auth.begin();
    assert.equal(b.ok, true, b.why);
    assert.ok(b.url.startsWith(`${HF_ORIGIN}/oauth2/authorize?`));
    assert.equal(new URL(b.url).searchParams.get("resource"), `${HF_ORIGIN}/mcp`);
    const reg = sent.join("");
    assert.match(reg, /^POST \/oauth2\/register HTTP\/1\.1\r\n/);
    assert.match(reg, new RegExp(`\\r\\nHost: ${HF_HOST.replace(/\./g, "\\.")}\\r\\n`));
    assert.doesNotMatch(reg, /authorization:/i);
    const body = JSON.parse(reg.slice(reg.indexOf("\r\n\r\n") + 4));
    assert.deepEqual(body, { client_name: HF_CLIENT_NAME, redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none", scope: HF_SCOPE });
    sent.length = 0;
    const back = await browser(hf, b.url);
    assert.deepEqual(await s.auth.finish(back), { ok: true });
    const tok = sent.join("");
    assert.match(tok, /^POST \/oauth2\/token HTTP\/1\.1\r\n/);
    assert.match(tok, /\r\nContent-Type: application\/x-www-form-urlencoded\r\n/);
    const form = new URLSearchParams(tok.slice(tok.indexOf("\r\n\r\n") + 4));
    assert.deepEqual([...form.keys()].sort(), ["client_id", "code", "code_verifier", "grant_type", "redirect_uri", "resource"]);
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("resource"), `${HF_ORIGIN}/mcp`);
    assert.equal(createHash("sha256").update(form.get("code_verifier")).digest("base64url"), new URL(b.url).searchParams.get("code_challenge"));

    const lookedUp = [];
    const priv = { resolve: async (h) => { lookedUp.push(h); return [{ address: "10.0.0.7", family: 4 }]; }, connect: () => { throw new Error("must not connect"); } };
    const p = setup(hf, { origin: HF_ORIGIN, net: priv });
    assert.deepEqual(await p.auth.begin(), { ok: false, why: "unreachable" });
    assert.deepEqual(lookedUp, [HF_HOST]);
  } finally { await hf.close(); }
});

test("no token, code or state is in any log line or answer", async () => {
  const hf = await startHiggsfield();
  try {
    const s = setup(hf);
    const answers = [];
    const b = await s.auth.begin();
    const back = await browser(hf, b.url);
    answers.push(await s.auth.finish(back));
    const first = fileOf(s);
    s.add(HOUR);
    const t = await s.auth.token();
    answers.push(s.auth.status());
    hf.behaviour.refuseRefresh = true;
    s.add(HOUR);
    answers.push(await s.auth.token(), s.auth.status(), s.auth.forget());
    const dump = JSON.stringify(answers) + s.lines.join("\n");
    assert.ok(s.lines.length >= 4);
    for (const secret of [first.accessToken, first.refreshToken, t.access, back.code, back.state]) {
      assert.ok(!dump.includes(secret), "a secret is in a log line or an answer");
      assert.ok(!dump.includes(secret.slice(-12)));
    }
  } finally { await hf.close(); }
});
