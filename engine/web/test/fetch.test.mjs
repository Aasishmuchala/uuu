// fetchPublic against the stand-in internet (engine/test/stubs/internet.mjs): every name is
// made up and every socket lands on 127.0.0.1. The door's real checks run unmodified: the
// stand-in only answers lookups and carries connections.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { REAL_NET, SENT_HEADERS, WEB_LIMITS, fetchPublic } from "../fetch.mjs";
import { big, bomb, drip, ok, redirect, stall, startInternet } from "../../test/stubs/internet.mjs";

const MB = 1024 * 1024;
const PAGE = "<html><head><title>Hello</title></head><body><p>Hi.</p></body></html>";
let inet;
const fast = { totalMs: 1500 };
const get = (url, extra = {}) => fetchPublic(url, { net: inet.net, ...extra });
const requestsTo = (site) => inet.seen.requests.filter((r) => r.site === site);

before(async () => {
  let flip = 0;
  inet = await startInternet({
    sites: {
      "site.test": { addresses: ["93.184.216.34"], handler: ok(PAGE) },
      // Public on the first lookup, private on every later one.
      "flip.test": { addresses: (n) => (n === 1 ? ["151.101.0.10"] : ["127.0.0.1"]), handler: ok(PAGE) },
      "mixed.test": { addresses: ["151.101.0.11", "10.0.0.5"], handler: ok(PAGE) },
      "v6private.test": { addresses: ["2606:4700::1", "::ffff:192.168.1.1"], handler: ok(PAGE) },
      "private.test": { addresses: ["192.168.1.20"], handler: ok("SECRET ROUTER PAGE") },
      "to-private.test": { addresses: ["151.101.0.12"], handler: redirect("http://private.test/admin") },
      "to-ip.test": { addresses: ["151.101.0.13"], handler: redirect("http://127.0.0.1:8120/") },
      "to-ip6.test": { addresses: ["151.101.0.14"], handler: redirect("http://[::1]/") },
      "to-file.test": { addresses: ["151.101.0.15"], handler: redirect("file:///etc/passwd") },
      "to-relative.test": { addresses: ["151.101.0.16"], handler: (req, res) => (req.url === "/" ? redirect("/landed?x=1", { status: 301 })(req, res) : ok(PAGE)(req, res)) },
      "no-location.test": { addresses: ["151.101.0.17"], handler: (_q, res) => { res.writeHead(302, { "Content-Length": 0 }); res.end(); } },
      "cookie.test": { addresses: ["151.101.0.18"], handler: redirect("https://site.test/after", { headers: { "Set-Cookie": "sid=SECRET-COOKIE; Path=/" } }) },
      "chain.test": {
        addresses: ["151.101.0.19"],
        handler: (req, res) => {
          const n = Number((/^\/(\d+)$/.exec(req.url) || [0, 0])[1]);
          return n < 9 ? redirect(`/${n + 1}`)(req, res) : ok(PAGE)(req, res);
        },
      },
      "big.test": { addresses: ["151.101.0.20"], handler: big(6 * MB, { declare: true }) },
      "big-quiet.test": { addresses: ["151.101.0.21"], handler: big(6 * MB, { declare: false }) },
      "gzip-bomb.test": { addresses: ["151.101.0.22"], handler: bomb("gzip", 64 * MB) },
      "br-bomb.test": { addresses: ["151.101.0.23"], handler: bomb("br", 64 * MB) },
      "pdf.test": { addresses: ["151.101.0.24"], handler: ok("%PDF-1.7", { type: "application/pdf" }) },
      "no-type.test": { addresses: ["151.101.0.25"], handler: (_q, res) => { res.writeHead(200, { "Content-Length": 2 }); res.end("hi"); } },
      "two-enc.test": { addresses: ["151.101.0.26"], handler: ok("x", { headers: { "Content-Encoding": "gzip, gzip" } }) },
      "deflate.test": { addresses: ["151.101.0.27"], handler: ok("x", { headers: { "Content-Encoding": "deflate" } }) },
      "stall.test": { addresses: ["151.101.0.28"], handler: stall() },
      "drip.test": { addresses: ["151.101.0.29"], handler: drip(50) },
      "odd-status.test": { addresses: ["151.101.0.30"], handler: (req, res) => { res.socket.end("HTTP/1.1 099 Odd\r\nContent-Length: 0\r\n\r\n"); } },
      "two-lengths.test": { addresses: ["151.101.0.31"], handler: (req, res) => { res.socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2\r\nContent-Length: 9\r\n\r\nhi"); } },
      "json.test": { addresses: ["151.101.0.32"], handler: ok("{\"a\":1}", { type: "application/json" }) },
      "own.test": { addresses: ["151.101.0.33"], handler: ok(PAGE) },
      "plain.test": { addresses: ["151.101.0.34"], handler: ok("gzip text", { type: "text/plain" }) },
      "provider.test": {
        addresses: ["151.101.0.35"],
        handler: (req, res) => {
          if (req.url === "/same") return redirect("/landed")(req, res);
          if (req.url === "/away") return redirect("https://site.test/away")(req, res);
          return ok("{}", { type: "application/json" })(req, res);
        },
      },
    },
  });
});
after(() => inet.close());

test("a page is fetched with the fixed headers only, the name as Host", async () => {
  const r = await get("https://site.test/a?b=c");
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.url, "https://site.test/a?b=c");
  assert.equal(r.body.toString(), PAGE);
  const last = requestsTo("site.test").at(-1);
  assert.equal(last.url, "/a?b=c");
  const names = [];
  for (let i = 0; i < last.rawHeaders.length; i += 2) names.push(last.rawHeaders[i].toLowerCase());
  assert.deepEqual(names.sort(), ["accept", "accept-encoding", "connection", "host", "user-agent"]);
  assert.equal(last.rawHeaders[last.rawHeaders.indexOf("Host") + 1], "site.test");
  assert.equal(SENT_HEADERS["Accept-Encoding"], "gzip, br");
  const c = inet.seen.connects.at(-1);
  assert.deepEqual(c, { address: "93.184.216.34", port: 443, hostname: "site.test", secure: true });
});

test("a name that answers public first and private second is fetched from the checked address, one lookup per hop", async () => {
  const before_ = inet.seen.lookups.filter((h) => h === "flip.test").length;
  const r = await get("http://flip.test/");
  assert.equal(r.ok, true);
  assert.equal(r.lookups, 1);
  assert.equal(inet.seen.lookups.filter((h) => h === "flip.test").length - before_, 1);
  assert.equal(inet.seen.connects.at(-1).address, "151.101.0.10");
  // The next fetch looks up again, gets the private answer, and is refused before connecting.
  const n = inet.seen.connects.length;
  const again = await get("http://flip.test/");
  assert.equal(again.code, "web_private_address");
  assert.equal(inet.seen.connects.length, n);
});

test("a name with one public and one private address is refused and nothing connects", async () => {
  const n = inet.seen.connects.length;
  assert.equal((await get("http://mixed.test/")).code, "web_private_address");
  assert.equal((await get("http://v6private.test/")).code, "web_private_address");
  assert.equal(inet.seen.connects.length, n);
  assert.equal(requestsTo("mixed.test").length, 0);
});

test("one of this Mac's own addresses is refused like a private one", async () => {
  const r = await get("http://own.test/", { own: (ip) => ip === "151.101.0.33" });
  assert.equal(r.code, "web_private_address");
  assert.equal(requestsTo("own.test").length, 0);
});

test("a redirect to a private name, to an IP, to [::1] and to file: is refused and the target sees nothing", async () => {
  assert.equal((await get("http://to-private.test/")).code, "web_private_address");
  assert.equal(requestsTo("private.test").length, 0);
  assert.equal((await get("http://to-ip.test/")).code, "web_bad_address");
  assert.equal((await get("http://to-ip6.test/")).code, "web_bad_address");
  assert.equal((await get("http://to-file.test/")).code, "web_bad_address");
  // Only the redirecting sites were ever connected to.
  const lands = new Set(inet.seen.connects.map((c) => c.address));
  for (const a of ["127.0.0.1", "::1", "192.168.1.20"]) assert.equal(lands.has(a), false, a);
});

test("five redirects are followed; the sixth is refused and its target sees nothing", async () => {
  const start = requestsTo("chain.test").length;
  const five = await get("http://chain.test/4");
  assert.equal(five.ok, true);
  assert.equal(five.hops, 6);
  assert.equal(requestsTo("chain.test").length - start, 6);
  const six = await get("http://chain.test/0");
  assert.equal(six.code, "web_unreachable");
  assert.equal(six.why, "redirects");
  const urls = requestsTo("chain.test").slice(start + 6).map((r) => r.url);
  assert.deepEqual(urls, ["/0", "/1", "/2", "/3", "/4", "/5"]);
});

test("a relative redirect is made absolute; a redirect with no Location is unreachable", async () => {
  const r = await get("http://to-relative.test/");
  assert.equal(r.ok, true);
  assert.equal(r.url, "http://to-relative.test/landed?x=1");
  assert.equal((await get("http://no-location.test/")).code, "web_unreachable");
});

test("a cookie set by hop 1 is not sent to hop 2", async () => {
  const r = await get("http://cookie.test/");
  assert.equal(r.ok, true);
  const hop2 = requestsTo("site.test").at(-1);
  assert.equal(hop2.url, "/after");
  assert.equal(hop2.rawHeaders.some((h) => /cookie|SECRET-COOKIE|referer/i.test(h)), false);
});

test("a 6 MB page stops at the cap, declared or not", async () => {
  assert.equal((await get("http://big.test/")).code, "web_too_big");
  assert.equal((await get("http://big-quiet.test/")).code, "web_too_big");
  assert.equal(WEB_LIMITS.maxBytes, 5 * MB);
});

test("a gzip bomb and a brotli bomb stop at the cap", async () => {
  const before_ = process.memoryUsage().rss;
  assert.equal((await get("http://gzip-bomb.test/")).code, "web_too_big");
  assert.equal((await get("http://br-bomb.test/")).code, "web_too_big");
  assert.ok(process.memoryUsage().rss - before_ < 48 * MB, "unpacking stopped near 5 MB");
});

test("wrong or missing types and odd encodings are not read", async () => {
  assert.equal((await get("http://pdf.test/")).code, "web_not_text");
  assert.equal((await get("http://no-type.test/")).code, "web_not_text");
  assert.equal((await get("http://two-enc.test/")).code, "web_not_text");
  assert.equal((await get("http://deflate.test/")).code, "web_not_text");
  assert.equal((await get("http://json.test/")).ok, true);
  assert.equal((await get("http://plain.test/")).ok, true);
});

test("a site that never answers, or drips, is cut at the deadline", async () => {
  const t0 = Date.now();
  assert.equal((await get("http://stall.test/", { limits: fast })).code, "web_unreachable");
  assert.equal((await get("http://drip.test/", { limits: fast })).code, "web_unreachable");
  assert.ok(Date.now() - t0 < 4500);
  assert.equal(WEB_LIMITS.totalMs, 20_000);
});

test("odd status lines, two lengths and an unknown name are unreachable", async () => {
  assert.equal((await get("http://odd-status.test/")).code, "web_unreachable");
  assert.equal((await get("http://two-lengths.test/")).code, "web_unreachable");
  assert.equal((await get("http://nowhere.test/")).code, "web_unreachable");
});

test("an abort ends a fetch at once", async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = get("http://stall.test/", { signal: ctl.signal });
  setTimeout(() => ctl.abort(), 100);
  assert.equal((await p).code, "web_unreachable");
  assert.ok(Date.now() - t0 < 2000);
});

test("proxy variables change nothing: the real connect goes to the address it is given", async () => {
  let proxied = 0;
  const canary = http.createServer((_q, res) => { proxied += 1; res.end("proxy"); });
  await new Promise((r) => canary.listen(0, "127.0.0.1", r));
  const proxy = `http://127.0.0.1:${canary.address().port}`;
  const saved = {};
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "NODE_USE_ENV_PROXY", "NO_PROXY"]) {
    saved[k] = process.env[k];
  }
  Object.assign(process.env, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NODE_USE_ENV_PROXY: "1", NO_PROXY: "" });
  try {
    // The stand-in answers the lookup; the REAL connect carries the socket (to the site's
    // own server on 127.0.0.1, standing in for the public address that was checked).
    const port = inet.port("site.test");
    const net = {
      resolve: inet.net.resolve,
      connect: (o) => REAL_NET.connect({ ...o, address: "127.0.0.1", family: 4, port, secure: false }),
    };
    const r = await fetchPublic("http://site.test/through", { net });
    assert.equal(r.ok, true);
    assert.equal(requestsTo("site.test").at(-1).url, "/through");
    assert.equal(proxied, 0);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise((r) => canary.close(r));
  }
});

test("the real network is frozen and resolves an address without asking anyone", async () => {
  assert.equal(Object.isFrozen(REAL_NET), true);
  assert.throws(() => { REAL_NET.connect = () => null; });
  const got = await REAL_NET.resolve("127.0.0.1");
  assert.deepEqual(got.map((a) => a.address), ["127.0.0.1"]);
});

// ---- the one header a caller may add (the keyed search provider's key) ----------------------

const MARK = "MARKER-KEY-7c1e0b9a";
const tokenOf = (r) => {
  const out = [];
  for (let i = 0; i < r.rawHeaders.length; i += 2) if (/^x-subscription-token$/i.test(r.rawHeaders[i])) out.push(r.rawHeaders[i + 1]);
  return out;
};

test("the subscription header arrives on the first hop only, to the host the caller named", async () => {
  const r = await get("https://provider.test/q", { headers: { "x-subscription-token": MARK } });
  assert.equal(r.ok, true);
  const got = requestsTo("provider.test").at(-1);
  assert.deepEqual(tokenOf(got), [MARK]);
  assert.equal(JSON.stringify(r).includes(MARK), false);
});

test("a redirect drops the subscription header, to the same host or another", async () => {
  await get("https://provider.test/same", { headers: { "X-Subscription-Token": MARK } });
  const hops = requestsTo("provider.test").slice(-2);
  assert.deepEqual(hops.map((h) => h.url), ["/same", "/landed"]);
  assert.deepEqual(tokenOf(hops[0]), [MARK]);
  assert.deepEqual(tokenOf(hops[1]), []);
  await get("https://provider.test/away", { headers: { "X-Subscription-Token": MARK } });
  const away = requestsTo("site.test").at(-1);
  assert.equal(away.url, "/away");
  assert.equal(JSON.stringify(away.rawHeaders).includes(MARK), false);
});

test("any other header name, a second header, or an odd value refuses before a lookup or a connection", async () => {
  const lookups = inet.seen.lookups.length;
  const connects = inet.seen.connects.length;
  for (const headers of [
    { "X-Subscription-Token": MARK, Cookie: "a=b" }, { Authorization: `Bearer ${MARK}` }, { Host: "evil.test" },
    { "X-Subscription-Token": `${MARK}\r\nX-Evil: 1` }, { "X-Subscription-Token": "" }, { "X-Subscription-Token": "a b" },
    { "X-Subscription-Token": "x".repeat(513) }, { "X-Subscription-Token": 5 }, [["X-Subscription-Token", MARK]], "X-Subscription-Token: x",
    Object.assign(Object.create({ Cookie: "x" }), { "X-Subscription-Token": MARK }),
  ]) {
    const r = await get("https://provider.test/q", { headers });
    assert.equal(r.code, "web_bad_request", JSON.stringify(headers));
    assert.equal(JSON.stringify(r).includes(MARK), false);
  }
  assert.equal(inet.seen.lookups.length, lookups);
  assert.equal(inet.seen.connects.length, connects);
  assert.equal((await get("https://provider.test/q", { headers: {} })).ok, true, "no header at all is fine");
});
