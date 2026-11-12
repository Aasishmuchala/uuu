// The viewer's proxy: exactly one destination passes; everything else is refused and named.
// A canary on another local port proves nothing reaches past the proxy. 127.0.0.1 only.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { blockedAddress, passes, startProxy } from "../proxy.mjs";

let site; let sitePort; let canary; let canaryPort; let proxy;
const hits = [];
const blocked = [];
before(async () => {
  site = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain", "X-Seen-Cookie": String(req.headers.cookie || ""), "X-Seen-Auth": String(req.headers.authorization || "") });
    res.end(`site ${req.method} ${req.url}`);
  });
  await new Promise((r) => site.listen(0, "127.0.0.1", r));
  sitePort = site.address().port;
  canary = net.createServer((s) => { hits.push(1); s.destroy(); });
  await new Promise((r) => canary.listen(0, "127.0.0.1", r));
  canaryPort = canary.address().port;
  proxy = await startProxy({ sitePort, onBlocked: (to, how) => blocked.push(`${how} ${to}`) });
});
after(async () => {
  await proxy.close();
  await new Promise((r) => site.close(r));
  await new Promise((r) => canary.close(r));
});

// A request in a proxy's form, sent as written.
function viaProxy(method, target, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: proxy.port, method, path: target, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}
function connect(authority) {
  return new Promise((resolve) => {
    const s = net.connect(proxy.port, "127.0.0.1", () => s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    let got = "";
    s.on("data", (d) => { got += d; });
    s.on("close", () => resolve(got));
    s.on("error", () => resolve(got));
    setTimeout(() => s.destroy(), 1500);
  });
}

test("passes() takes only GET and HEAD to http://127.0.0.1:<site port>", () => {
  assert.equal(passes("http://127.0.0.1:4000/a.css?x=1", "GET", 4000), "/a.css?x=1");
  assert.equal(passes("http://127.0.0.1:4000/", "HEAD", 4000), "/");
  for (const [t, m] of [["http://127.0.0.1:4001/", "GET"], ["http://127.0.0.1:4000/", "POST"], ["http://localhost:4000/", "GET"],
    ["https://127.0.0.1:4000/", "GET"], ["http://127.0.0.1.nip.io:4000/", "GET"], ["http://u:p@127.0.0.1:4000/", "GET"],
    ["/index.html", "GET"], ["http://[::1]:4000/", "GET"], ["http://2130706433:4000/", "GET"], ["127.0.0.1:4000", "CONNECT"]]) {
    assert.equal(passes(t, m, 4000), null, `${m} ${t}`);
  }
  assert.equal(blockedAddress("http://example.test/x?secret=1", "GET"), "example.test:80");
  assert.equal(blockedAddress("example.test:443", "CONNECT"), "example.test:443");
});

test("the site passes, and none of the page's cookies or credentials go with it", async () => {
  const r = await viaProxy("GET", `http://127.0.0.1:${sitePort}/index.html?v=1`, { Cookie: "a=1", Authorization: "Bearer x" });
  assert.equal(r.status, 200);
  assert.equal(r.text, "site GET /index.html?v=1");
  assert.equal(r.headers["x-seen-cookie"], "");
  assert.equal(r.headers["x-seen-auth"], "");
});

test("every other destination is refused and named, and the canary sees nothing", async () => {
  blocked.length = 0;
  const tries = [
    ["GET", `http://127.0.0.1:${canaryPort}/x`], ["GET", `http://localhost:${sitePort}/`], ["GET", `http://localhost:${canaryPort}/`],
    ["GET", "http://outside.example/"], ["POST", `http://127.0.0.1:${sitePort}/form`], ["GET", `http://127.0.0.1:${proxy.port}/`],
    ["GET", "/index.html"], ["GET", `http://[::1]:${canaryPort}/`],
  ];
  for (const [m, t] of tries) {
    const r = await viaProxy(m, t);
    assert.equal(r.status, 403, `${m} ${t}`);
  }
  assert.ok(blocked.includes(`GET 127.0.0.1:${canaryPort}`));
  assert.ok(blocked.includes(`GET localhost:${sitePort}`));
  assert.ok(blocked.includes("GET outside.example:80"));
  assert.ok(blocked.includes(`POST 127.0.0.1:${sitePort}`));
  assert.equal(blocked.length, tries.length);
  assert.equal(hits.length, 0);
});

test("CONNECT is refused to every address, the site's own included; so is an upgrade", async () => {
  blocked.length = 0;
  for (const a of [`127.0.0.1:${canaryPort}`, `127.0.0.1:${sitePort}`, "outside.example:443"]) {
    const got = await connect(a);
    assert.match(got, /^HTTP\/1\.1 403/, a);
  }
  const up = await new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: proxy.port, path: `http://127.0.0.1:${canaryPort}/ws`, agent: false,
      headers: { Connection: "Upgrade", Upgrade: "websocket" } });
    req.on("upgrade", () => resolve("upgraded"));
    req.on("response", (res) => resolve(res.statusCode));
    req.on("error", () => resolve("closed"));
    req.on("close", () => resolve("closed"));
    req.end();
  });
  assert.notEqual(up, "upgraded");
  assert.deepEqual(blocked, [`CONNECT 127.0.0.1:${canaryPort}`, `CONNECT 127.0.0.1:${sitePort}`, "CONNECT outside.example:443", `UPGRADE 127.0.0.1:${canaryPort}`]);
  assert.equal(hits.length, 0);
});
