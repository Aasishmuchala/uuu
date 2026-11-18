// The Astryx kit in an app, with the REAL Chrome (PLAN-ASTRYX T7): the kit draws under App
// Studio's exact headers when a module imports it by relative path, and an inline import map is
// refused by the same policy (finding 12), so the README's rule stays true. A small server on
// 127.0.0.1, port 0, serves a temp folder holding a copy of engine/astryx-kit/astryx/ and two
// pages, every answer carrying the host's own security headers. Chrome is the page viewer's:
// its own throwaway profile, its flags, every address through the viewer's proxy (which passes
// only this server) and no name lookups. Only the process group this file started is ended, by
// its id. Skipped, saying why, when Chrome is not installed.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_PATH, chromeInstalled, defaultLaunch, prepareRoot, startChrome } from "../../viewer/chrome.mjs";
import { startProxy } from "../../viewer/proxy.mjs";
import { contentPolicy, securityHeaders } from "../host.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..", "..", "astryx-kit", "astryx");
const HAVE = chromeInstalled(CHROME_PATH);
const skip = HAVE ? false : `Chrome is not installed at ${CHROME_PATH}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// A classic script of the app's own, before everything else: it keeps every content-policy
// violation the page sees, where the test can read them.
const WATCH_JS = `window.__violations = [];
document.addEventListener("securitypolicyviolation", function (e) {
  window.__violations.push({ directive: String(e.effectiveDirective || e.violatedDirective || ""), blocked: String(e.blockedURI || "") });
});
`;
const HEAD = (title, extra = "") => `<!doctype html>
<html lang="en" data-astryx-theme="neutral">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script src="watch.js"></script>
<link rel="stylesheet" href="astryx/reset.css">
<link rel="stylesheet" href="astryx/astryx.css">
<link rel="stylesheet" href="astryx/theme.css">
${extra}</head>
`;
const BODY = (main) => `<body>
<main id="root"></main>
<script type="module" src="${main}"></script>
</body>
</html>
`;
const DRAW = `const root = createRoot(document.getElementById("root"));
root.render(React.createElement(Button, { label: "Proof", variant: "primary" }));
`;
// Page 1: no import map; the kit by relative path.
const PAGE1 = HEAD("Relative imports") + BODY("main.js");
const MAIN1 = `import * as React from "./astryx/react.js";
import { createRoot } from "./astryx/react-dom-client.js";
import { Button } from "./astryx/core.js";
${DRAW}`;
// Page 2: the same with an inline import map and bare names.
const PAGE2 = HEAD("Inline import map", `<script type="importmap">
${readFileSync(join(KIT, "importmap.json"), "utf8")}</script>
`) + BODY("main2.js");
const MAIN2 = `import * as React from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@astryxdesign/core";
${DRAW}`;

let dir; let server; let port; let proxy; let session;
const launched = [];
const blocked = [];    // what the viewer's proxy refused, as "host:port" (Chrome's own background calls land here, never the page's)
const pageRequests = []; // every address either page asked for, as Chrome saw it
const passed = [];     // what the proxy passed to this server
const served = [];     // every path this server answered

before(async () => {
  if (!HAVE) return;
  dir = mkdtempSync(join(tmpdir(), "apps-astryx-"));
  const app = join(dir, "app");
  mkdirSync(join(app, "astryx"), { recursive: true, mode: 0o700 });
  const files = new Map();
  for (const name of readdirSync(KIT)) {
    copyFileSync(join(KIT, name), join(app, "astryx", name));
    files.set(`/astryx/${name}`, readFileSync(join(app, "astryx", name)));
  }
  for (const [name, text] of [["page1.html", PAGE1], ["page2.html", PAGE2], ["main.js", MAIN1], ["main2.js", MAIN2], ["watch.js", WATCH_JS]]) {
    writeFileSync(join(app, name), text);
    files.set(`/${name}`, readFileSync(join(app, name)));
  }
  server = http.createServer((req, res) => {
    req.resume();
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    served.push(path);
    const body = files.get(path);
    // The app's own Content-Type and Content-Length, then exactly what the host sets over it.
    const headers = body
      ? { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Content-Length": body.length }
      : { "Content-Type": "text/plain; charset=utf-8", "Content-Length": 10 };
    Object.assign(headers, securityHeaders(port));
    res.writeHead(body ? 200 : 404, headers);
    res.end(req.method === "HEAD" ? undefined : (body || "not found\n"));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
  proxy = await startProxy({ sitePort: port, onBlocked: (to) => blocked.push(to), onPassed: (_m, p) => passed.push(p) });
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

// Opens one page in a fresh tab. -> { sid, requests, errors, close() }; `requests` holds every
// address the page asked for, as Chrome saw it.
async function open(page) {
  const send = (m, p, s, ms) => session.send(m, p, s, ms);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const errors = [];
  let loaded;
  const load = new Promise((r) => { loaded = r; });
  session.on((m) => {
    if (m.sessionId !== sid) return;
    if (m.method === "Network.requestWillBeSent") { requests.push(String(m.params.request.url)); pageRequests.push(String(m.params.request.url)); }
    if (m.method === "Runtime.exceptionThrown") errors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 200));
    if (m.method === "Page.loadEventFired") loaded();
  });
  await send("Page.enable", {}, sid);
  await send("Runtime.enable", {}, sid);
  await send("Network.enable", {}, sid);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/${page}` }, sid);
  await Promise.race([load, wait(10_000)]);
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }, sid)).result.value;
  return { sid, requests, errors, evaluate, close: () => send("Target.closeTarget", { targetId }).catch(() => {}) };
}

// Polls for the drawn button's text, up to `ms`.
async function buttonText(evaluate, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const t = await evaluate(`(() => { const b = document.querySelector("#root button"); return b ? b.textContent.trim() : null; })()`);
    if (t !== null || Date.now() > until) return t;
    await wait(100);
  }
}

const others = (requests) => requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`));

test("the server answers with the host's own policy and nosniff", { skip }, () => {
  const h = securityHeaders(port);
  assert.equal(h["Content-Security-Policy"], contentPolicy(port));
  assert.match(h["Content-Security-Policy"], /script-src 'self';/);
  assert.doesNotMatch(h["Content-Security-Policy"], /unsafe-inline'[^;]*script|script-src[^;]*unsafe-inline/);
  assert.equal(h["X-Content-Type-Options"], "nosniff");
});

test("page 1: a module that imports the kit by relative path draws a Button under the host's policy, with no violation", { skip, timeout: 60_000 }, async () => {
  const p = await open("page1.html");
  try {
    const text = await buttonText(p.evaluate, 5000);
    assert.equal(text, "Proof", `no button drew; errors: ${JSON.stringify(p.errors)}`);
    const v = await p.evaluate("JSON.stringify(window.__violations)");
    assert.deepEqual(JSON.parse(v), [], "a content-policy violation");
    assert.deepEqual(p.errors, []);
    assert.ok(p.requests.some((u) => u.endsWith("/astryx/core.js")), "core.js was loaded");
    assert.ok(p.requests.some((u) => /\/astryx\/chunk-[A-Z0-9]+\.js$/.test(u)), "the kit's chunks were loaded");
    assert.deepEqual(others(p.requests), [], "a request to another host");
  } finally {
    await p.close();
  }
});

test("page 2: an inline import map is refused by script-src, so nothing draws", { skip, timeout: 60_000 }, async () => {
  const p = await open("page2.html");
  try {
    assert.equal(await buttonText(p.evaluate, 2000), null, "a button drew through an inline import map");
    const v = JSON.parse(await p.evaluate("JSON.stringify(window.__violations)"));
    assert.ok(v.some((x) => x.directive.startsWith("script-src") && x.blocked === "inline"), `no script-src violation for the inline import map: ${JSON.stringify(v)}`);
    assert.deepEqual(others(p.requests), [], "a request to another host");
  } finally {
    await p.close();
  }
});

test("both pages: the count of requests to any host but the server's own is 0", { skip }, () => {
  assert.ok(pageRequests.length >= 10, "the pages were loaded");
  assert.equal(others(pageRequests).length, 0, JSON.stringify(others(pageRequests).slice(0, 5)));
  // The proxy passed only this server, and only paths it served; Chrome's own calls home
  // (not the pages') were all refused there, none was ever passed.
  assert.ok(passed.length > 0 && passed.every((p) => served.includes(new URL(p, "http://127.0.0.1").pathname)));
  assert.ok(blocked.every((to) => !to.startsWith(`127.0.0.1:${port}`)), "a request to this server was refused");
});
