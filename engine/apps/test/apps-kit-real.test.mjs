// Both App Studio apps, built with the Astryx kit, in the REAL Chrome under App Studio's exact
// headers (PLAN-APPS-ASTRYX T1). A small server on 127.0.0.1, port 0, serves an app's built
// dist/ with the host's own security headers and answers /trpc/* and /api/* with 503, as a
// server that is not up yet would. The copy of index.html it serves carries one extra classic
// script, /watch.js, that keeps every content-policy violation; the repository's file is never
// changed. Chrome is the page viewer's, as in astryx-real.test.mjs: its own throwaway profile,
// its flags, every address through the viewer's proxy (which passes only this server) and no
// name lookups. Only the process group this file started is ended, by its id. Skipped, saying
// why, when Chrome is not installed or an app has not been built (app-exec <slug> --build).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_PATH, chromeInstalled, defaultLaunch, prepareRoot, startChrome } from "../../viewer/chrome.mjs";
import { startProxy } from "../../viewer/proxy.mjs";
import { securityHeaders } from "../host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const APPS = ["arch-film-studio", "render-to-film"];
const DIST = Object.fromEntries(APPS.map((slug) => [slug, join(REPO, "apps", slug, "dist")]));
const HAVE = chromeInstalled(CHROME_PATH);
const built = (slug) => existsSync(join(DIST[slug], "index.html")) && existsSync(join(DIST[slug], "assets"));
const skipFor = (slug) => !HAVE ? `Chrome is not installed at ${CHROME_PATH}`
  : !built(slug) ? `${slug} is not built; run engine/apps/app-exec ${slug} --build first` : false;
const ANY = APPS.some(built) && HAVE;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

const WATCH_JS = `window.__violations = [];
document.addEventListener("securitypolicyviolation", function (e) {
  window.__violations.push({ directive: String(e.effectiveDirective || e.violatedDirective || ""), blocked: String(e.blockedURI || ""), source: String(e.sourceFile || "").replace(location.origin, "") + ":" + e.lineNumber + ":" + e.columnNumber });
});
`;

let dir; let server; let port; let proxy; let session;
let current = null; // the app this server serves now
const launched = [];
const passed = [];  // what the proxy passed to this server
const served = [];  // every path this server answered

// One answer, from the current app's dist/; the host's headers over the app's own.
function answer(req, res) {
  req.resume();
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  served.push(path);
  let status = 200; let type; let body;
  if (path === "/watch.js") {
    type = TYPES[".js"]; body = Buffer.from(WATCH_JS);
  } else if (path.startsWith("/trpc/") || path.startsWith("/api/")) {
    status = 503; type = TYPES[".json"]; body = Buffer.from(JSON.stringify({ error: "The app is starting. Try again in a moment." }));
  } else if (path === "/" || path === "/index.html") {
    type = TYPES[".html"];
    const html = readFileSync(join(DIST[current], "index.html"), "utf8");
    assert.ok(html.includes("<head>"), "index.html has a <head>");
    body = Buffer.from(html.replace("<head>", '<head>\n    <script src="/watch.js"></script>'));
  } else {
    const file = normalize(join(DIST[current], decodeURIComponent(path)));
    if (file.startsWith(DIST[current] + sep) && existsSync(file) && statSync(file).isFile()) {
      type = TYPES[extname(file)] || "application/octet-stream"; body = readFileSync(file);
    } else {
      status = 404; type = TYPES[".txt"]; body = Buffer.from("not found\n");
    }
  }
  const headers = { "Content-Type": type, "Content-Length": body.length, ...securityHeaders(port) };
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

before(async () => {
  if (!ANY) return;
  dir = mkdtempSync(join(tmpdir(), "apps-kit-real-"));
  server = http.createServer(answer);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  proxy = await startProxy({ sitePort: port, onPassed: (_m, p) => passed.push(p) });
  const root = join(dir, "chrome");
  mkdirSync(root, { mode: 0o700 });
  prepareRoot(root);
  const launch = (program, args, env) => {
    const out = defaultLaunch(program, args, env);
    launched.push(out.child.pid);
    return out;
  };
  session = await startChrome({ program: CHROME_PATH, root, proxyPort: proxy.port, launch });
});

after(async () => {
  if (session) await session.end().catch(() => {});
  for (const g of launched) { try { process.kill(-g, "SIGKILL"); } catch { /* ended already */ } }
  if (proxy) await proxy.close();
  if (server) await new Promise((r) => { server.closeAllConnections(); server.close(r); });
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens / in a fresh tab. -> { requests: [{ url, type }], errors, evaluate, close() }
async function open() {
  const send = (m, p, s, ms) => session.send(m, p, s, ms);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const errors = [];
  let loaded;
  const load = new Promise((r) => { loaded = r; });
  session.on((m) => {
    if (m.sessionId !== sid) return;
    if (m.method === "Network.requestWillBeSent") requests.push({ url: String(m.params.request.url), type: String(m.params.type || "") });
    if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 300));
    if (m.method === "Page.loadEventFired") loaded();
  });
  await send("Page.enable", {}, sid);
  await send("Runtime.enable", {}, sid);
  await send("Network.enable", {}, sid);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sid);
  await Promise.race([load, wait(10_000)]);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }, sid)).result.value;
  return { requests, errors, evaluate, close: () => send("Target.closeTarget", { targetId }).catch(() => {}) };
}

// Polls until #root holds an element, up to `ms`. -> the count of its child elements
async function rootChildren(evaluate, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const n = await evaluate(`(() => { const r = document.getElementById("root"); return r ? r.childElementCount : -1; })()`);
    if (n > 0 || Date.now() > until) return n;
    await wait(100);
  }
}

for (const slug of APPS) {
  const skip = skipFor(slug);

  test(`${slug}: every built script imports the kit's React by path and holds no React of its own`, { skip }, () => {
    const assets = join(DIST[slug], "assets");
    const scripts = readdirSync(assets).filter((n) => n.endsWith(".js"));
    assert.ok(scripts.length >= 1, "dist/assets holds a script");
    for (const n of scripts) {
      const text = readFileSync(join(assets, n), "utf8");
      assert.ok(text.includes('"/astryx/react.js"'), `${n} does not import /astryx/react.js`);
      assert.ok(!text.includes("react.dev/errors"), `${n} holds a second React`);
    }
    for (const n of ["react.js", "core.js", "theme.css"]) assert.ok(existsSync(join(DIST[slug], "astryx", n)), `dist/astryx/${n}`);
  });

  test(`${slug}: the built page draws under the host's policy, with no violation and nothing from another host`, { skip, timeout: 60_000 }, async () => {
    current = slug;
    const p = await open();
    try {
      const n = await rootChildren(p.evaluate, 10_000);
      assert.ok(n >= 1, `#root stayed empty; errors: ${JSON.stringify(p.errors)}`);
      await wait(500); // the first queries' 503s and any late style or font request
      const v = JSON.parse(await p.evaluate("JSON.stringify(window.__violations)"));
      assert.deepEqual(v, [], "a content-policy violation");
      assert.deepEqual(p.errors, [], "an uncaught error on the page");
      assert.equal(await p.evaluate("getComputedStyle(document.documentElement).colorScheme"), "dark", "the kit's dark theme is on");
      const own = `http://127.0.0.1:${port}/`;
      const others = p.requests.filter((r) => !r.url.startsWith(own));
      assert.deepEqual(others, [], "a request to another host");
      const scripts = p.requests.filter((r) => r.type === "Script").map((r) => new URL(r.url).pathname).filter((s) => s !== "/watch.js");
      assert.ok(scripts.some((s) => s.startsWith("/assets/")), "the app's script was loaded");
      assert.ok(scripts.includes("/astryx/react.js") && scripts.includes("/astryx/core.js"), "the kit's React and core were loaded");
      assert.deepEqual(scripts.filter((s) => !s.startsWith("/assets/") && !s.startsWith("/astryx/")), [], "a script from outside /assets/ and /astryx/");
    } finally {
      await p.close();
    }
  });
}

test("the proxy passed only paths this server answered", { skip: ANY ? false : "nothing to open" }, () => {
  assert.ok(passed.length > 0);
  assert.ok(passed.every((p) => served.includes(new URL(p, "http://127.0.0.1").pathname)));
});
