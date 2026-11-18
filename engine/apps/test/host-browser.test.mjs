// The App Studio host, browser side (PLAN-V5 K17): each rule of the order once, as a pure check
// and then against a running host with the fixture app behind it (spawned unfenced by an
// injected spawner). Nothing touches the live engine's state.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import {
  BROWSER_CODES, DROPPED_OUT, browserRefusal, contentPolicy, inboundHeaders, notAnsweringPage, outboundHeaders, passOn, securityHeaders,
} from "../host.mjs";
import {
  appOutput, fakeParts, fixtureSpawner, freePorts, header, jsonOf, makeWorld, own, send, startHost, wait, waitFor,
} from "./fixture-app/harness.mjs";

const P = 3171;
const req = (method, headers, url = "/") => {
  const raw = [];
  for (const [k, v] of Object.entries(headers)) for (const one of Array.isArray(v) ? v : [v]) raw.push(k, one);
  return { method, url, rawHeaders: raw };
};
const H = { Host: `127.0.0.1:${P}` };

// ---- the rules, pure ---------------------------------------------------------------------

test("an Upgrade or CONNECT is refused first, whatever else the request has", () => {
  assert.equal(browserRefusal(req("GET", { ...H, Upgrade: "websocket", Connection: "Upgrade" }), P), "upgrade");
  assert.equal(browserRefusal(req("GET", { ...H, Connection: "keep-alive, Upgrade" }), P), "upgrade");
  assert.equal(browserRefusal(req("CONNECT", { Host: "evil.test:443" }, "evil.test:443"), P), "upgrade");
});

test("a Host that is not 127.0.0.1:<port> or localhost:<port> is refused (421)", () => {
  assert.equal(browserRefusal(req("GET", { Host: `evil.test:${P}` }), P), "wrong_host");
  assert.equal(browserRefusal(req("GET", { Host: "127.0.0.1:3172" }), P), "wrong_host");
  assert.equal(browserRefusal(req("GET", { Host: "127.0.0.1" }), P), "wrong_host");
  assert.equal(browserRefusal(req("GET", { Host: [`127.0.0.1:${P}`, `127.0.0.1:${P}`] }), P), "wrong_host");
  assert.equal(browserRefusal(req("GET", {}), P), "wrong_host");
  assert.equal(browserRefusal(req("GET", { Host: `localhost:${P}` }), P), null);
  assert.equal(browserRefusal(req("GET", H), P), null);
  assert.equal(BROWSER_CODES.wrong_host[0], 421);
});

test("Sec-Fetch-Site: same-origin and none pass; cross-site never; same-site only to open the app", () => {
  const nav = (site, dest, method = "GET") => browserRefusal(req(method, { ...H, "Sec-Fetch-Site": site, "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": dest }), P);
  assert.equal(browserRefusal(req("GET", { ...H, "Sec-Fetch-Site": "same-origin" }), P), null);
  assert.equal(browserRefusal(req("GET", { ...H, "Sec-Fetch-Site": "none" }), P), null);
  assert.equal(browserRefusal(req("GET", { ...H, "Sec-Fetch-Site": "cross-site" }), P), "cross_site");
  assert.equal(nav("cross-site", "document"), "cross_site");
  assert.equal(nav("same-site", "iframe"), null);
  assert.equal(nav("same-site", "document"), null);
  assert.equal(nav("same-site", "document", "HEAD"), null);
  assert.equal(nav("same-site", "image"), "cross_site");
  assert.equal(nav("same-site", "iframe", "POST"), "cross_site");
  assert.equal(browserRefusal(req("GET", { ...H, "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty" }), P), "cross_site");
  assert.equal(browserRefusal(req("GET", { ...H, "Sec-Fetch-Site": ["same-origin", "cross-site"] }), P), "cross_site");
  assert.equal(browserRefusal(req("GET", H), P), null, "no Sec-Fetch-Site: judged by the other rules, as the home screen does");
});

test("anything but GET and HEAD needs an Origin equal to http:// and the Host; a GET with another Origin is refused too", () => {
  assert.equal(browserRefusal(req("POST", { ...H, "Sec-Fetch-Site": "same-origin" }), P), "bad_origin");
  assert.equal(browserRefusal(req("POST", { ...H, Origin: "http://127.0.0.1:3200" }), P), "bad_origin");
  assert.equal(browserRefusal(req("POST", { ...H, Origin: "null" }), P), "bad_origin");
  assert.equal(browserRefusal(req("PUT", { ...H, Origin: `http://localhost:${P}` }), P), "bad_origin", "localhost's origin with a 127.0.0.1 Host");
  assert.equal(browserRefusal(req("POST", { ...H, Origin: `http://127.0.0.1:${P}` }), P), null);
  assert.equal(browserRefusal(req("DELETE", { Host: `localhost:${P}`, Origin: `http://localhost:${P}` }), P), null);
  assert.equal(browserRefusal(req("POST", { ...H, Origin: [`http://127.0.0.1:${P}`, `http://127.0.0.1:${P}`] }), P), "bad_origin");
  assert.equal(browserRefusal(req("GET", { ...H, Origin: "http://evil.test" }), P), "bad_origin");
  assert.equal(browserRefusal(req("GET", { ...H, Origin: `http://127.0.0.1:${P}` }), P), null);
});

test("a declared body over 40 MB is refused before anything is sent; two lengths or an absolute target are not read", () => {
  const post = (extra, url) => browserRefusal(req("POST", { ...H, Origin: `http://127.0.0.1:${P}`, ...extra }, url), P);
  assert.equal(post({ "Content-Length": String(40 * 1024 * 1024) }), null);
  assert.equal(post({ "Content-Length": String(40 * 1024 * 1024 + 1) }), "too_big");
  assert.equal(post({ "Content-Length": "lots" }), "too_big");
  assert.equal(post({ "Content-Length": ["5", "5"] }), "bad_target");
  assert.equal(post({}, "http://elsewhere.test/"), "bad_target");
  assert.equal(BROWSER_CODES.too_big[0], 413);
});

test("going in: no Cookie, Authorization, Proxy-*, hop-by-hop header, a header Connection names, or Expect", () => {
  const raw = ["Host", "127.0.0.1:3171", "Cookie", "a=1", "authorization", "Bearer x", "Proxy-Authorization", "Basic x",
    "Proxy-Foo", "1", "Connection", "keep-alive, X-Secret", "X-Secret", "s", "Keep-Alive", "timeout=5", "TE", "trailers",
    "Transfer-Encoding", "chunked", "Upgrade", "h2c", "Expect", "100-continue", "Content-Length", "3", "Accept", "*/*",
    "Sec-Fetch-Site", "same-origin", "X-Kept", "1"];
  assert.deepEqual(inboundHeaders(raw), ["Host", "127.0.0.1:3171", "Accept", "*/*", "Sec-Fetch-Site", "same-origin", "X-Kept", "1"]);
});

test("coming out: no Set-Cookie or hop-by-hop header, and the host's five headers over the app's", () => {
  const raw = ["Content-Type", "text/html", "Set-Cookie", "a=1", "set-cookie", "b=2", "Content-Security-Policy", "default-src *",
    "X-Content-Type-Options", "sniff", "Referrer-Policy", "unsafe-url", "Cross-Origin-Resource-Policy", "cross-origin",
    "Permissions-Policy", "camera=*", "Connection", "X-Hop", "X-Hop", "1", "Keep-Alive", "timeout=9", "Transfer-Encoding", "chunked",
    "Content-Length", "10", "X-Kept", "yes"];
  const out = outboundHeaders(raw, 3200);
  const names = [];
  for (let i = 0; i < out.length; i += 2) names.push(out[i].toLowerCase());
  assert.deepEqual(names, ["content-type", "content-length", "x-kept", "content-security-policy", "x-content-type-options",
    "referrer-policy", "cross-origin-resource-policy", "permissions-policy"]);
  const policy = out[out.indexOf("Content-Security-Policy") + 1];
  assert.equal(policy, contentPolicy(3200));
});

test("coming out: none of the headers that send the browser elsewhere, reload or clear the page, or report (T85)", () => {
  const sent = ["Link", "<http://192.0.2.1/x>; rel=prerender", "link", "<http://192.0.2.1/y>; rel=preconnect", "Refresh", "0; url=http://192.0.2.1/",
    "Clear-Site-Data", "\"cookies\"", "Speculation-Rules", "\"/r.json\"", "Alt-Svc", "h3=\":443\"",
    "Content-Security-Policy-Report-Only", "default-src 'none'; report-uri http://192.0.2.1/r", "Report-To", "{}", "Reporting-Endpoints", "a=\"http://192.0.2.1/\"",
    "NEL", "{}", "Document-Policy", "x", "Document-Policy-Report-Only", "x", "Permissions-Policy-Report-Only", "x",
    "Cross-Origin-Opener-Policy-Report-Only", "x", "Cross-Origin-Embedder-Policy-Report-Only", "x", "Integrity-Policy", "x",
    "Integrity-Policy-Report-Only", "x", "Origin-Trial", "x", "Service-Worker-Allowed", "/", "Location", "/next", "X-Kept", "yes"];
  const out = outboundHeaders(sent, 3200);
  const names = [];
  for (let i = 0; i < out.length; i += 2) names.push(out[i].toLowerCase());
  assert.deepEqual(names, ["location", "x-kept", "content-security-policy", "x-content-type-options", "referrer-policy",
    "cross-origin-resource-policy", "permissions-policy"]);
  for (const n of DROPPED_OUT) assert.equal(n, n.toLowerCase());
});

test("the content policy is K17's, framed only by the home screen", () => {
  assert.equal(contentPolicy(3200), "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    + "media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
    + "form-action 'self'; sandbox allow-downloads allow-forms allow-modals allow-same-origin allow-scripts; "
    + "frame-ancestors http://127.0.0.1:3200 http://localhost:3200");
  // T85: the page is a sandboxed document wherever it is shown, with no popups.
  assert.doesNotMatch(contentPolicy(3200), /allow-popups|allow-top-navigation/);
  assert.equal(securityHeaders(3200)["Permissions-Policy"],
    "camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), hid=(), payment=(), display-capture=()");
  assert.deepEqual(Object.keys(securityHeaders(3200)), ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy",
    "Cross-Origin-Resource-Policy", "Permissions-Policy"]);
  assert.equal(securityHeaders(3200)["Referrer-Policy"], "no-referrer");
});

test("the not-answering page has no script and its name is escaped", () => {
  const page = notAnsweringPage("Render to Film");
  assert.match(page, /Render to Film is starting or stopped\. Open App Studio to see why\./);
  assert.doesNotMatch(page, /<script|javascript:|\son[a-z]+=/i);
  assert.match(notAnsweringPage("<b>x</b>"), /&lt;b&gt;x&lt;\/b&gt; is starting/);
});

// ---- against a running host ---------------------------------------------------------------

let w;
let parts;
let host;
let lines;
let port;
before(async () => {
  const first = await freePorts(3);
  port = first;
  w = makeWorld({ apps: [{ slug: "fix", port }], portFirst: first, portLast: first + 2 });
  parts = await fakeParts(w);
  w.switches({ fix: true });
  ({ host, lines } = await startHost(w, { spawnApp: fixtureSpawner(w), limits: { headersMs: 600 } }));
  await waitFor(() => host.app("fix")?.state === "on", 10000);
  assert.equal(host.app("fix").state, "on", lines.join("\n"));
});
after(async () => {
  if (host) await host.close();
  if (parts) await parts.close();
  if (w) w.cleanup();
});

// Whether the fixture saw a request: it prints each one, and the host keeps what it prints.
// A request that reached it shows within a moment; one the host refused never does.
async function appSaw(marker) {
  const probe = `probe-${Math.random().toString(36).slice(2)}`;
  await send({ port, path: `/echo?${probe}`, headers: own(port) });
  await waitFor(() => appOutput(w, "fix").includes(probe), 3000);
  return appOutput(w, "fix").includes(marker);
}

test("live: the page is passed with only what may go in, and the answer carries the host's headers", async () => {
  const r = await send({ port, path: "/echo?q=1", headers: { ...own(port), Cookie: "owner=1", Authorization: "Bearer x",
    "Proxy-Authorization": "Basic y", "X-Kept-In": "1", Connection: "keep-alive, X-Gone", "X-Gone": "1" } });
  assert.equal(r.status, 200);
  const got = jsonOf(r);
  assert.equal(got.url, "/echo?q=1");
  const names = got.headers.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
  for (const gone of ["cookie", "authorization", "proxy-authorization", "x-gone", "keep-alive"]) assert.ok(!names.includes(gone), gone);
  assert.ok(names.includes("x-kept-in"));
  assert.deepEqual(header(r.headers, "set-cookie"), [], "the app's cookie never reaches the browser");
  assert.deepEqual(header(r.headers, "content-security-policy"), [contentPolicy(3200)], "the host's policy replaces the app's");
  assert.match(header(r.headers, "content-security-policy")[0], /frame-ancestors http:\/\/127\.0\.0\.1:3200 http:\/\/localhost:3200$/);
  assert.deepEqual(header(r.headers, "x-content-type-options"), ["nosniff"]);
  assert.deepEqual(header(r.headers, "referrer-policy"), ["no-referrer"]);
  assert.deepEqual(header(r.headers, "cross-origin-resource-policy"), ["same-origin"]);
  assert.deepEqual(header(r.headers, "permissions-policy"), [securityHeaders(3200)["Permissions-Policy"]]);
  assert.deepEqual(header(r.headers, "x-hop"), [], "a header the app's Connection named is dropped");
  assert.deepEqual(header(r.headers, "x-kept"), ["yes"]);
});

test("live: Host evil.test:<port> → 421, and the app never sees it", async () => {
  const r = await send({ port, path: "/echo?m=evilhost", headers: { Host: `evil.test:${port}` } });
  assert.equal(r.status, 421);
  assert.match(r.body.toString(), /This address is not this app/);
  assert.equal(header(r.headers, "content-security-policy")[0], contentPolicy(3200));
  assert.equal(await appSaw("m=evilhost"), false);
  assert.equal(await appSaw("probe-"), true, "the app's output is kept, so the check above can see");
});

test("live: Sec-Fetch-Site cross-site → 403; same-site + navigate + iframe → 200 (the home screen opening it)", async () => {
  const no = await send({ port, path: "/echo", headers: { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } });
  assert.equal(no.status, 403);
  const yes = await send({ port, path: "/echo", headers: { Host: `localhost:${port}`, "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" } });
  assert.equal(yes.status, 200);
  const img = await send({ port, path: "/echo", headers: { Host: `127.0.0.1:${port}`, "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image" } });
  assert.equal(img.status, 403, "an image GET from another local page");
});

test("live: a POST with no Origin, or another port's, → 403; with its own → 200 and the body arrives", async () => {
  const body = Buffer.from("x".repeat(1000));
  const none = await send({ port, method: "POST", path: "/echo", headers: { ...own(port), "Content-Type": "text/plain" }, body });
  assert.equal(none.status, 403);
  const other = await send({ port, method: "POST", path: "/echo", headers: { ...own(port), Origin: "http://127.0.0.1:3200", "Content-Type": "text/plain" }, body });
  assert.equal(other.status, 403);
  const mine = await send({ port, method: "POST", path: "/echo", headers: { ...own(port), Origin: `http://127.0.0.1:${port}`, "Content-Type": "text/plain" }, body });
  assert.equal(mine.status, 200);
  assert.equal(jsonOf(mine).bytes, 1000);
  assert.equal(jsonOf(mine).method, "POST");
});

test("live: an Upgrade and a CONNECT get 403 and never reach the app", async () => {
  const raw = (text) => new Promise((ok) => {
    const s = net.connect(port, "127.0.0.1");
    let got = "";
    s.on("connect", () => s.write(text));
    s.on("data", (d) => { got += d; });
    s.on("close", () => ok(got));
    s.on("error", () => ok(got));
  });
  const up = await raw(`GET /echo HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  assert.match(up, /^HTTP\/1\.1 403/);
  const conn = await raw(`CONNECT 127.0.0.1:22 HTTP/1.1\r\nHost: 127.0.0.1:22\r\n\r\n`);
  assert.match(conn, /^HTTP\/1\.1 403/);
});

test("live: a 41 MB body is cut, declared or not, and the app gets at most 40 MB", async () => {
  const big = Buffer.alloc(41 * 1024 * 1024, 120);
  const declared = await send({ port, method: "POST", path: "/echo?m=declared", headers: { ...own(port), Origin: `http://127.0.0.1:${port}`, "Content-Length": String(big.length) }, body: big });
  assert.ok(declared.status === 413 || declared.error, JSON.stringify(declared.status ?? declared.error));
  // Chunked: no length to judge first, so the host counts and cuts.
  const chunked = await new Promise((ok) => {
    const s = net.connect(port, "127.0.0.1");
    let got = "";
    s.on("data", (d) => { got += d; });
    s.on("close", () => ok(got));
    s.on("error", () => ok(got));
    s.on("connect", async () => {
      s.write(`POST /echo HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nTransfer-Encoding: chunked\r\n\r\n`);
      const piece = Buffer.alloc(1024 * 1024, 121);
      for (let i = 0; i < 41 && !s.destroyed; i += 1) {
        s.write(`${piece.length.toString(16)}\r\n`);
        s.write(piece);
        s.write("\r\n");
        await wait(1);
      }
      if (!s.destroyed) s.end("0\r\n\r\n");
    });
  });
  assert.match(chunked, /^HTTP\/1\.1 413/);
  assert.match(lines.join("\n"), /app fix browser 413 too_big/);
  assert.equal(await appSaw("m=declared"), false, "a declared 41 MB never reaches the app");
  const cut = await waitFor(() => /fixture cut after (\d+) bytes/.exec(appOutput(w, "fix")), 3000);
  assert.ok(cut, "the app saw its request cut");
  assert.ok(Number(cut[1]) <= 40 * 1024 * 1024, `the app got ${cut[1]} bytes`);
});

test("live: request headers must come within the limit (here 0.6 s)", async () => {
  const closedAfter = await new Promise((ok) => {
    const t0 = Date.now();
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => s.write(`GET /echo HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`));
    s.on("close", () => ok(Date.now() - t0));
    s.on("error", () => {});
    s.resume();
    setTimeout(() => { s.destroy(); ok(-1); }, 5000);
  });
  assert.ok(closedAfter > 0 && closedAfter < 3000, `closed after ${closedAfter} ms`);
});

test("live: 64 requests at once per app; the 65th is told to wait", async () => {
  const slow = [];
  for (let i = 0; i < 64; i += 1) slow.push(send({ port, path: "/slow?ms=1500", headers: own(port) }));
  await waitFor(async () => false, 400);
  const extra = await send({ port, path: "/echo", headers: own(port) });
  assert.equal(extra.status, 503);
  const done = await Promise.all(slow);
  assert.ok(done.every((r) => r.status === 200), done.map((r) => r.status ?? r.error).join(","));
  const after = await send({ port, path: "/echo", headers: own(port) });
  assert.equal(after.status, 200);
});

test("live: an app that does not answer → a 502 page with no script and the host's headers", async () => {
  const before = host.app("fix").pid;
  process.kill(-before, "SIGKILL");
  const r = await waitFor(async () => {
    const x = await send({ port, path: "/", headers: own(port) });
    return x.status === 502 ? x : null;
  }, 3000);
  assert.ok(r, "a 502 page came");
  const text = r.body.toString();
  assert.match(text, /Fixture? .* is starting or stopped|App fix is starting or stopped/);
  assert.doesNotMatch(text, /<script/i);
  assert.equal(header(r.headers, "content-security-policy")[0], contentPolicy(3200));
  assert.match(header(r.headers, "content-type")[0], /^text\/html/);
  // It comes back by itself (one exit is not three).
  await waitFor(() => host.app("fix")?.state === "on" && host.app("fix").restarts === 1, 30000);
  assert.equal(host.app("fix").state, "on");
  assert.equal(host.app("fix").restarts, 1);
  assert.notEqual(host.app("fix").pid, before);
});

test("live: the app's Link, Refresh, Clear-Site-Data and reporting headers never reach the browser (T85)", async () => {
  const r = await send({ port, path: "/hint-headers", headers: own(port) });
  assert.equal(r.status, 200);
  for (const n of ["link", "refresh", "clear-site-data", "content-security-policy-report-only", "report-to", "reporting-endpoints", "nel",
    "speculation-rules", "alt-svc", "origin-trial", "document-policy-report-only"]) {
    assert.deepEqual(header(r.headers, n), [], n);
  }
  assert.deepEqual(header(r.headers, "x-kept"), ["yes"]);
  assert.equal(header(r.headers, "content-security-policy")[0], contentPolicy(3200));
});

test("live: an answer the host cannot pass on is a 502 at once, never a throw or a wait (status 099 or 600, 101, an early close, garbage)", async () => {
  const thrown = [];
  const catcher = (err) => thrown.push(String(err && err.code));
  process.on("uncaughtException", catcher);
  try {
    for (const kind of ["099", "600", "101", "close", "garbage"]) {
      const t0 = Date.now();
      const r = await send({ port, path: `/raw?kind=${kind}`, headers: own(port), timeoutMs: 5000 });
      assert.equal(r.status, 502, `${kind}: ${r.error || r.status}`);
      assert.ok(Date.now() - t0 < 3000, `${kind} took ${Date.now() - t0} ms`);
      assert.match(r.body.toString(), /is starting or stopped/);
      assert.doesNotMatch(r.body.toString(), /RAW BYTES/);
      assert.equal(header(r.headers, "content-security-policy")[0], contentPolicy(3200));
      assert.deepEqual(header(r.headers, "upgrade"), []);
    }
    await wait(200);
    assert.deepEqual(thrown, [], "nothing reached the last-resort handler");
    assert.equal(host.app("fix").state, "on");
    assert.equal((await send({ port, path: "/echo", headers: own(port) })).status, 200, "the app is still reached");
  } finally {
    process.off("uncaughtException", catcher);
  }
});

test("passOn: a status outside 200 to 599 or a header Node will not write → false, with nothing left on the answer", () => {
  const made = () => {
    const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1, headers: {} });
    return res;
  };
  for (const status of [99, 100, 101, 103, 199, 600, 999, 1.5, NaN, "200"]) assert.equal(passOn(made(), status, []), false, String(status));
  const bad = made();
  assert.equal(passOn(bad, 200, ["X-Fine", "1", "X-Bad", "a\u0001b"]), false);
  assert.equal(bad.headersSent, false);
  assert.deepEqual(bad.getHeaderNames(), []);
  const good = made();
  assert.equal(passOn(good, 204, ["X-Fine", "1"]), true);
});
