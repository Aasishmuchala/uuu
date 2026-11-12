// The owner's preview (PLAN-V5 K15): loaded only with the owner's token, the same archive
// rules, only loaded files served, every answer with K15's headers, no cookie, no other Host.
// Made-up secrets in a temp folder; every socket is on 127.0.0.1.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { createPreview } from "../preview.mjs";
import { SITE_HEADERS } from "../sitefiles.mjs";
import { writeTar } from "../tar.mjs";

const SECRET = "7".repeat(64);
const BUILDER = "11111111-2222-4333-8444-555555555555";
let dir; let preview; let port; const lines = [];
const exp = () => Math.floor(Date.now() / 1000) + 120;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "viewer-preview-"));
  writeFileSync(join(dir, "viewer-secret"), `${SECRET}\n`);
  chmodSync(join(dir, "viewer-secret"), 0o600);
  writeFileSync(join(dir, "ids.json"), JSON.stringify({ agents: { builder: BUILDER } }));
  chmodSync(join(dir, "ids.json"), 0o644);
  preview = createPreview({ listenPort: 0, paths: { viewerSecret: join(dir, "viewer-secret"), ids: join(dir, "ids.json") }, log: (l) => lines.push(l) });
  port = await preview.listen();
});
after(async () => { await preview.close(); rmSync(dir, { recursive: true, force: true }); });

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* a page */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const site = writeTar([{ name: "index.html", data: Buffer.from("<h1>Preview</h1>") }, { name: "css/a.css", data: Buffer.from("a{}") }]);
const load = (token, body = site, type = "application/x-tar") => request("POST", "/preview/load", {
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": type }, body,
});
function headersOk(r, why) {
  for (const [k, v] of Object.entries(SITE_HEADERS)) assert.equal(r.headers[k.toLowerCase()], v, `${why}: ${k}`);
  assert.equal(r.headers["set-cookie"], undefined, why);
}

test("nothing is served before the home server loads a site", async () => {
  const r = await request("GET", "/");
  assert.equal(r.status, 404);
  headersOk(r, "empty");
});

test("a load is refused without the owner's token: none, an agent's, a token of another secret", async () => {
  for (const [t, why] of [[null, "none"], [mintToken(SECRET, "a", BUILDER, exp()), "an agent"], [mintToken("8".repeat(64), "t", "owner", exp()), "another secret"],
    [mintToken(SECRET, "t", "builder", exp()), "a test token for an agent"]]) {
    const r = await load(t);
    assert.equal(r.status, 401, why);
    assert.equal(r.json.code, "view_no_token", why);
    headersOk(r, why);
  }
  assert.equal(preview.loaded, false);
});

test("the same archive rules as the viewer's", async () => {
  const owner = mintToken(SECRET, "t", "owner", exp());
  const bad = writeTar([{ name: "index.html", data: Buffer.from("x") }, { name: "../evil.html", data: Buffer.from("x") }]);
  const r = await load(owner, bad);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "view_bad_site");
  assert.equal((await load(owner, site, "application/json")).json.code, "view_bad_site");
  assert.equal((await load(owner, Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413);
  assert.equal(preview.loaded, false);
});

test("a loaded site: only its files, each with K15's headers, and a load replaces the last", async () => {
  const owner = mintToken(SECRET, "t", "owner", exp());
  const r = await load(owner);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { loaded: true, files: 2, bytes: 19, url: `http://127.0.0.1:${port}/` });
  const home = await request("GET", "/");
  assert.equal(home.status, 200);
  assert.equal(home.text, "<h1>Preview</h1>");
  headersOk(home, "page");
  const css = await request("GET", "/css/a.css");
  assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
  headersOk(css, "css");
  for (const p of ["/missing.html", "/../index.html", "/preview/load"]) {
    const x = await request("GET", p);
    assert.equal(x.status, 404, p);
    headersOk(x, p);
  }
  await load(owner, writeTar([{ name: "index.html", data: Buffer.from("second") }]));
  assert.equal((await request("GET", "/")).text, "second");
  assert.equal((await request("GET", "/css/a.css")).status, 404, "one site at a time");
  const cleared = await request("POST", "/preview/clear", { headers: { Authorization: `Bearer ${owner}` } });
  assert.deepEqual(cleared.json, { loaded: false });
  assert.equal((await request("GET", "/")).status, 404);
});

test("another Host is refused (a name pointed at this Mac by someone else's site), and so are upgrades and CONNECT", async () => {
  for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1:3200", `127.0.0.1.nip.io:${port}`]) {
    const r = await request("GET", "/", { headers: { Host: host } });
    assert.equal(r.status, 403, host);
    headersOk(r, host);
  }
  assert.equal((await request("GET", "/", { headers: { Host: `localhost:${port}` } })).status, 404);
  const rawCall = (text) => new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let got = "";
    s.on("data", (d) => { got += d; });
    s.on("close", () => resolve(got));
    s.on("error", () => resolve(got));
    setTimeout(() => s.destroy(), 1500);
    s.write(text);
  });
  assert.match(await rawCall(`CONNECT 127.0.0.1:3200 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`), /^HTTP\/1\.1 403/);
  assert.match(await rawCall(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`), /^HTTP\/1\.1 403/);
  assert.equal((await request("PUT", "/")).status, 403);
  assert.equal((await request("POST", "/anything")).status, 404);
});

test("log lines hold no token and no file name", () => {
  const text = lines.join("\n");
  assert.equal(/v1\.[at]\./.test(text), false);
  assert.equal(/index\.html|a\.css|Preview/.test(text), false);
  assert.match(text, /preview loaded files=2/);
});
