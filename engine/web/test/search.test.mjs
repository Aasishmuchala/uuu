// The web door's search (T27) on hand-written fixtures. The keyless provider goes through the
// door's real fetchPublic against the stand-in internet (names made up, every socket on
// 127.0.0.1); so does the keyed one, against a stand-in for its provider under its made-up
// (here: real-looking) name, through a wrapper that records what search asked the fetch for.
// Nothing here reaches an outside host.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchPublic } from "../fetch.mjs";
import { search, parseHtmlResults, markupToText } from "../search.mjs";
import { big, ok, startInternet } from "../../test/stubs/internet.mjs";

const here = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const fixture = (name) => readFileSync(here(name));
const MB = 1024 * 1024;
const KEY = "BSA-test-key-0123456789abcdef";
let dir;
let inet;
let page = fixture("search-keyless.html");
let respond = (req, res) => ok(page)(req, res);
let keyedRespond = (req, res) => res.destroy();
const keyless = (extra = {}) => ({
  state: { search: "keyless" }, keyPath: null, fetchPublic: (u) => fetchPublic(u, { net: inet.net, limits: { totalMs: 3000 } }), ...extra,
});
const down = (reason) => (e) => e && e.code === "web_search_down" && (reason === undefined || e.reason === reason);
const requestsTo = (site) => inet.seen.requests.filter((r) => r.site === site);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "search-test-"));
  inet = await startInternet({
    sites: {
      "html.duckduckgo.com": { addresses: ["52.142.124.215"], handler: (q, s) => respond(q, s) },
      "api.search.brave.com": { addresses: ["151.101.40.40"], handler: (q, s) => keyedRespond(q, s) },
    },
  });
});
after(async () => {
  await inet.close();
  rmSync(dir, { recursive: true, force: true });
});
const serve = (body, opts) => { respond = ok(body, opts); };

// A key file the way the home server writes it, and a fake fetch for the keyed provider.
function keyFile(text = KEY, mode = 0o600) {
  const p = join(dir, `key-${Math.random().toString(16).slice(2)}`);
  writeFileSync(p, `${text}\n`, { mode });
  return p;
}
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return typeof answer === "function" ? answer(url, opts) : answer; };
  fn.calls = calls;
  return fn;
}
// The keyed provider's answer, served by its stand-in; the fetch is the door's real one.
const json = (value, status = 200) => ({ status, body: typeof value === "string" ? value : JSON.stringify(value) });
const UNREACHABLE = { destroy: true };
function realFetch(answer) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const a = typeof answer === "function" ? answer(url, opts) : answer;
    keyedRespond = a.destroy ? (q, res) => res.destroy() : ok(a.body, { type: "application/json", status: a.status });
    return fetchPublic(url, { net: inet.net, limits: { totalMs: 3000, maxRedirects: 0 }, ...(opts || {}) });
  };
  fn.calls = calls;
  return fn;
}
const keyHeaders = (r) => {
  const out = [];
  for (let i = 0; i < r.rawHeaders.length; i += 2) if (/^x-subscription-token$/i.test(r.rawHeaders[i])) out.push(r.rawHeaders[i + 1]);
  return out;
};

// ---- keyless: what comes back ----
test("keyless: results from the page, unwrapped, with snippets, as plain text", async () => {
  serve(fixture("search-keyless.html"));
  const out = await search({ q: "architecture", count: 10, ...keyless() });
  assert.equal(out.provider, "keyless");
  assert.deepEqual(out.results, [
    { title: "Software architecture & design", url: "https://example.org/arch?a=1&b=2", snippet: "How systems are shaped — a short guide." },
    { title: "A link that is not wrapped", url: "https://plain.example.net/page", snippet: "Second snippet, on two lines." },
    { title: "Third result", url: "https://third.example.com/", snippet: "Third snippet." },
  ]);
});

test("keyless: count limits the results; the query is URL-encoded in the request", async () => {
  serve(fixture("search-keyless.html"));
  const before = requestsTo("html.duckduckgo.com").length;
  const out = await search({ q: "  c++ & café?  ", count: 2, ...keyless() });
  assert.equal(out.results.length, 2);
  const sent = requestsTo("html.duckduckgo.com").slice(before).map((r) => r.url);
  assert.deepEqual(sent, ["/html/?q=c%2B%2B+%26+caf%C3%A9%3F"]);
});

test("keyless: a result for 127.0.0.1, localhost, javascript:, credentials, and the engine's own advert is dropped", async () => {
  serve(fixture("search-keyless-hostile.html"));
  const out = await search({ q: "x", count: 10, ...keyless() });
  assert.deepEqual(out.results.map((r) => r.url), ["https://good.example.com/ok"]);
});

test("keyless: HTML in a title or snippet is text; scripts, handlers, styles and frames never appear", async () => {
  serve(fixture("search-keyless-hostile.html"));
  const out = await search({ q: "x", count: 10, ...keyless() });
  const [r] = out.results;
  assert.equal(r.title, "Good one <b>literal</b>");
  assert.equal(r.snippet, "Snippet with text & entities after break");
  const all = JSON.stringify(out);
  for (const bad of ["alert", "steal", "onerror", "display:none", "evil.example.com", "script.example.com"]) assert.ok(!all.includes(bad), bad);
});

test("keyless: a page that says it found nothing is an empty answer, not an error", async () => {
  serve(fixture("search-keyless-empty.html"));
  assert.deepEqual(await search({ q: "x", count: 5, ...keyless() }), { provider: "keyless", results: [] });
});

// ---- how each failure ends ----
test("keyless: an empty page, a changed page, plain text and a challenge are all web_search_down", async () => {
  for (const body of ["", fixture("search-keyless-changed.html"), "just words", "<html></html>", "<<<<<<"]) {
    serve(body);
    const out = await search({ q: "x", count: 5, ...keyless() }).then(() => null, (e) => e);
    assert.ok(down()(out), `body ${JSON.stringify(String(body).slice(0, 20))}`);
  }
  serve("<a class='result__a'");
  const out = await search({ q: "x", count: 5, ...keyless() });
  assert.deepEqual(out.results, []); // seen as a results page, but no usable address in it
});

test("keyless: a 202 challenge, a 403 block, a 500 and a 429 are web_search_down", async () => {
  for (const status of [202, 403, 429, 500, 503]) {
    serve(fixture("search-keyless.html"), { status });
    await assert.rejects(search({ q: "x", count: 5, ...keyless() }), down(), String(status));
  }
});

test("keyless: JSON, a wrong type and an unreachable provider are web_search_down", async () => {
  serve("{}", { type: "application/json" });
  await assert.rejects(search({ q: "x", count: 5, ...keyless() }), down());
  serve("%PDF-1.7", { type: "application/pdf" });
  await assert.rejects(search({ q: "x", count: 5, ...keyless() }), down());
  const dead = async () => ({ ok: false, code: "web_unreachable" });
  await assert.rejects(search({ q: "x", count: 5, ...keyless({ fetchPublic: dead }) }), down());
  const boom = async () => { throw new Error("secret detail"); };
  await assert.rejects(search({ q: "x", count: 5, ...keyless({ fetchPublic: boom }) }), (e) => down()(e) && !JSON.stringify(e).includes("secret"));
  await assert.rejects(search({ q: "x", count: 5, ...keyless({ fetchPublic: async () => null }) }), down());
});

test("keyless: a 6 MB page stops at the fetch cap and is web_search_down", async () => {
  respond = big(6 * MB, { declare: false });
  await assert.rejects(search({ q: "x", count: 5, ...keyless() }), down());
  respond = big(6 * MB, { declare: true });
  await assert.rejects(search({ q: "x", count: 5, ...keyless() }), down());
  respond = (req, res) => ok(page)(req, res);
});

test("keyless: a 4 MB page of nothing but tag starts and unclosed quotes is read in linear time", async () => {
  const evil = ["<a class=result__a href=\"", "<a ".repeat(100), "<!--", "<script>", "<<<<", "&#x&#9999999;&"].map((s) => s.repeat(Math.ceil(4 * MB / s.length) | 0).slice(0, 4 * MB));
  for (const body of evil) {
    const t0 = Date.now();
    const out = parseHtmlResults(body);
    assert.ok(Date.now() - t0 < 2500, `${Date.now() - t0} ms`);
    assert.ok(out.found.length <= 61);
  }
});

test("keyless: at most 60 links are read from one page", () => {
  const many = Array.from({ length: 500 }, (_, i) => `<a class="result__a" href="https://s${i}.example.com/">t${i}</a>`).join("");
  assert.ok(parseHtmlResults(many).found.length <= 61);
});

// ---- the query ----
test("the query: empty, control characters, 201 characters and a too-long encoding are refused without a request", async () => {
  const before = inet.seen.requests.length;
  for (const q of ["", "   ", "a\nb", "a\x00b", "a\u0085b", "a".repeat(201), "é".repeat(100), undefined, 5, null, { toString: () => "x" }]) {
    await assert.rejects(search({ q, count: 5, ...keyless() }), down("bad_query"), JSON.stringify(q));
  }
  assert.equal(inet.seen.requests.length, before);
  serve(fixture("search-keyless.html"));
  assert.equal((await search({ q: "a".repeat(200), count: 5, ...keyless() })).provider, "keyless");
});

test("the count: outside 1 to 10 or not a whole number becomes 10", async () => {
  serve(fixture("search-keyless.html"));
  for (const count of [undefined, 0, 11, 2.5, "3", -1]) {
    assert.equal((await search({ q: "x", count, ...keyless() })).results.length, 3);
  }
});

// ---- keyed ----
test("keyed: one GET with the key as X-Subscription-Token; results from web.results", async () => {
  const f = realFetch(json(fixture("search-brave.json").toString()));
  const out = await search({ q: "architecture", count: 10, state: { search: "brave" }, keyPath: keyFile(), fetchPublic: f });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://api.search.brave.com/res/v1/web/search?q=architecture&count=10");
  assert.deepEqual(f.calls[0].opts, { headers: { "X-Subscription-Token": KEY } });
  const got = requestsTo("api.search.brave.com").at(-1);
  assert.equal(got.url, "/res/v1/web/search?q=architecture&count=10");
  assert.deepEqual(keyHeaders(got), [KEY]);
  assert.equal(out.provider, "brave");
  assert.deepEqual(out.results, [
    { title: "Software architecture guide", url: "https://example.org/arch", snippet: "How systems are shaped & why." },
    { title: "Second", url: "https://second.example.net/x?y=1", snippet: "Plain snippet." },
    { title: "No snippet", url: "https://third.example.com/", snippet: "" },
  ]);
  assert.ok(!JSON.stringify(out).includes(KEY));
});

test("keyed: count limits the results and goes into the request", async () => {
  const f = realFetch(json(fixture("search-brave.json").toString()));
  const out = await search({ q: "a b", count: 2, state: { search: "brave" }, keyPath: keyFile(), fetchPublic: f });
  assert.equal(out.results.length, 2);
  assert.match(f.calls[0].url, /\?q=a\+b&count=2$/);
});

test("keyed: 401 and 403 are web_search_down with reason key_refused", async () => {
  for (const status of [401, 403]) {
    const f = realFetch(json({ error: "bad" }, status));
    await assert.rejects(search({ q: "x", count: 5, state: { search: "brave" }, keyPath: keyFile(), fetchPublic: f }), down("key_refused"));
  }
});

test("keyed: other statuses, nonsense, a changed shape and a failed fetch are web_search_down", async () => {
  const run = (answer) => search({ q: "x", count: 5, state: { search: "brave" }, keyPath: keyFile(), fetchPublic: realFetch(answer) });
  for (const answer of [json({}, 429), json({}, 500), json("not json at all"), json("<html>"), json({ web: { results: "x" } }), json({ results: [] }), json("[]"), json("null"), UNREACHABLE]) {
    await assert.rejects(run(answer), down(), JSON.stringify(answer).slice(0, 60));
  }
  assert.deepEqual(await run(json({ type: "search", query: {} })), { provider: "brave", results: [] });
  assert.deepEqual(await run(json({ web: { results: [] } })), { provider: "brave", results: [] });
});

test("keyed: no key, an empty file, a loose file, a link and a bad key are web_search_down without a request", async () => {
  const f = realFetch(json({ web: { results: [] } }));
  const good = keyFile();
  const link = join(dir, "key-link");
  symlinkSync(good, link);
  for (const keyPath of [null, undefined, "", join(dir, "missing"), keyFile(""), keyFile(KEY, 0o644), keyFile("has space in it 123"), keyFile("short"), keyFile("x".repeat(400)), link, dir]) {
    await assert.rejects(search({ q: "x", count: 5, state: { search: "brave" }, keyPath, fetchPublic: f }), down(), String(keyPath));
  }
  assert.equal(f.calls.length, 0);
});

test("the key is in no error, no answer and no thrown detail", async () => {
  const seenText = [];
  const record = (v) => seenText.push(typeof v === "string" ? v : JSON.stringify(v, Object.getOwnPropertyNames(Object(v))));
  const cases = [
    () => realFetch(json({}, 401)),
    () => realFetch(json({}, 500)),
    () => realFetch(json(`oops ${KEY}`)),
    // The one fetch that is not the real one: the real fetch never throws, this proves search's catch.
    () => async () => { throw new Error(`failed with ${KEY}`); },
    () => realFetch(json({ web: { results: [{ title: KEY, url: `https://x.example.com/?k=${KEY}`, description: "d" }] } })),
  ];
  for (const make of cases) {
    try {
      record(await search({ q: "x", count: 5, state: { search: "brave" }, keyPath: keyFile(), fetchPublic: make() }));
    } catch (e) {
      record(e);
      assert.deepEqual(Object.keys(e).sort().filter((k) => k !== "reason"), ["code"]);
      assert.equal(e.message, undefined);
      assert.equal(e.stack, undefined);
    }
  }
  // The only case that returns anything is the one where the provider itself echoed the key.
  for (const t of seenText.slice(0, 4)) assert.ok(!t.includes(KEY));
});

test("a keyless search never reads the key file or sends a header", async () => {
  const f = fakeFetch({ ok: true, status: 200, type: "text/html", charset: "utf-8", body: fixture("search-keyless.html") });
  await search({ q: "x", count: 5, state: { search: "keyless" }, keyPath: join(dir, "nothing-here"), fetchPublic: f });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].opts, undefined);
  assert.equal(f.calls[0].url, "https://html.duckduckgo.com/html/?q=x");
});

test("markupToText: tags, scripts and entities in a short string become capped plain text", () => {
  assert.equal(markupToText("a <b>b</b> <script>x()</script>c &amp; d", 100), "a b c & d");
  assert.equal(markupToText("x".repeat(500), 300).length, 300);
  assert.equal(markupToText(undefined, 10), "");
  assert.equal(markupToText("1 < 2 and 3 > 2", 100), "1 < 2 and 3 > 2");
});
