// The owner's preview in a REAL browser like the owner's own (T57 F2): site A is hostile (it tries to leave a service
// worker behind, and keeps an open tab reading the preview's address); then site B is previewed, then the preview is
// cleared. Nothing of A may run for B, A's open tab may never read B, nothing may reach another local port, and the
// first page of a load clears only its own origin (another origin's storage on 127.0.0.1 stays). Skipped, saying
// why, when Chrome is not installed. The Chrome started is hidden, on its own throwaway profile, in its own process
// group, ended by that group's id; every address that is not local goes to a dead proxy.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { CHROME_PATH, Pipe, chromeInstalled } from "../chrome.mjs";
import { headerOverflow } from "../../lib/overflow.mjs";
import { createPreview } from "../preview.mjs";
import { writeTar } from "../tar.mjs";

const SECRET = "5".repeat(64);
const skip = chromeInstalled(CHROME_PATH) ? false : `Chrome is not installed at ${CHROME_PATH}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let dir; let preview; let port; let canary; let other; const hits = []; const servers = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "preview-real-"));
  writeFileSync(join(dir, "viewer-secret"), `${SECRET}\n`);
  chmodSync(join(dir, "viewer-secret"), 0o600);
  writeFileSync(join(dir, "ids.json"), JSON.stringify({ agents: {} }));
  chmodSync(join(dir, "ids.json"), 0o644);
  preview = createPreview({ listenPort: 0, paths: { viewerSecret: join(dir, "viewer-secret"), ids: join(dir, "ids.json") }, log: () => {} });
  port = await preview.listen();
  // A stand-in for the engine's other local ports: it records every request.
  const c = net.createServer((sock) => {
    sock.on("error", () => {});
    sock.once("data", (d) => hits.push(d.toString("latin1").split("\r\n")[0]));
    setTimeout(() => sock.end("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 6\r\nConnection: close\r\n\r\nCANARY"), 30);
  });
  await new Promise((r) => c.listen(0, "127.0.0.1", r));
  canary = c.address().port;
  servers.push(c);
  // Another origin on 127.0.0.1 (as the home screen is): a page that keeps a mark in its own storage.
  const o = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><title>other</title>");
  });
  await new Promise((r) => o.listen(0, "127.0.0.1", r));
  other = o.address().port;
  servers.push(o);
});
after(async () => {
  if (preview) await preview.close();
  for (const s of servers) s.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const owner = () => mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600);
function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path, agent: false, headers: { Authorization: `Bearer ${owner()}`, ...headers } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(body);
  });
}
const loadSite = (files) => post("/preview/load", writeTar(files.map(([name, text]) => ({ name, data: Buffer.from(text) }))), { "Content-Type": "application/x-tar" });

// A browser like the owner's: a normal profile that keeps what sites store, no proxy for local addresses.
async function ownerLikeBrowser() {
  const root = mkdtempSync(join(dir, "chrome-"));
  for (const d of ["profile", "home", "tmp"]) mkdirSync(join(root, d), { mode: 0o700 });
  const args = [
    "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${root}/profile`, "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--disable-default-apps",
    "--disable-breakpad", "--disable-crash-reporter", "--use-mock-keychain", "--password-store=basic", "--disable-gpu", "--mute-audio",
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=127.0.0.1;localhost", "about:blank",
  ];
  const env = { PATH: "/usr/bin:/bin", HOME: `${root}/home`, TMPDIR: `${root}/tmp/`, MAC_CHROMIUM_TMPDIR: `${root}/tmp` };
  const child = spawn(CHROME_PATH, args, { detached: true, env, stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  child.stderr.on("error", () => {});
  const pipe = new Pipe(child.stdio[3], child.stdio[4]);
  await pipe.send("Browser.getVersion", {}, undefined, 30000);
  const tab = async () => {
    const { targetId } = await pipe.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await pipe.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (m, p = {}, ms = 15000) => pipe.send(m, p, sessionId, ms);
    await send("Page.enable");
    await send("Runtime.enable");
    return {
      async goto(url, settle = 1200) { await send("Page.navigate", { url }); await wait(settle); },
      async evaluate(expression) {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        return r.result ? r.result.value : undefined;
      },
    };
  };
  return {
    tab,
    async close() {
      await pipe.send("Browser.close", {}, undefined, 3000).catch(() => {});
      await wait(300);
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* ended already */ }
      pipe.close();
    },
  };
}

test("after site A then site B: nothing of A runs, A's open tab cannot read B, nothing reaches another port", { skip, timeout: 120000 }, async () => {
  const browser = await ownerLikeBrowser();
  try {
    // Another origin of 127.0.0.1 keeps a mark: the preview's clearing must not take it.
    const home = await browser.tab();
    await home.goto(`http://127.0.0.1:${other}/`, 600);
    await home.evaluate("localStorage.setItem('mark', 'kept'), true");

    // What A's worker would serve in place of every later page: no content policy, so it could reach any port.
    const takeover = `<!doctype html><title>TAKEN</title><h1 id="who">TAKEN OVER BY SITE A</h1><script>fetch("http://127.0.0.1:${canary}/stolen", { mode: "no-cors" });</script>`;
    const siteA = [
      ["index.html", `<!doctype html><title>Site A</title><h1 id="who">SITE A</h1><script>
        localStorage.setItem("a", "left by A");
        navigator.serviceWorker.register("sw.js").then(() => navigator.serviceWorker.ready).then(() => { document.body.dataset.sw = "ready"; }, (e) => { document.body.dataset.sw = "refused"; });
        setInterval(async () => {
          try { const t = await (await fetch("/index.html", { cache: "no-store" })).text(); if (!t.includes("SITE A")) document.title = "READ: " + t.slice(0, 90); }
          catch (e) { document.body.dataset.gone = "yes"; }
        }, 200);
      </script>`],
      ["sw.js", `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => { if (e.request.mode === "navigate") e.respondWith(new Response(${JSON.stringify(takeover)}, { headers: { "Content-Type": "text/html" } })); });`],
    ];
    const siteB = [["index.html", "<!doctype html><title>Site B</title><h1 id=\"who\">SITE B: another task's draft</h1><script>document.body.dataset.a = String(localStorage.getItem('a'));</script>"]];

    assert.equal(await loadSite(siteA), 200);
    const tabA = await browser.tab();
    await tabA.goto(`http://127.0.0.1:${port}/`, 2000);
    const a = await tabA.evaluate("({ who: document.getElementById('who')?.textContent, sw: document.body.dataset.sw, origin: location.origin })");
    assert.equal(a.who, "SITE A");
    assert.equal(a.sw, "refused", "no worker can be registered");
    assert.equal(a.origin, `http://${preview.siteHost}:${preview.sitePort}`, "the home's address sent the tab on to the load's own origin");

    assert.equal(await loadSite(siteB), 200);
    await wait(1200);
    const left = await tabA.evaluate("({ title: document.title, gone: document.body.dataset.gone })");
    assert.doesNotMatch(left.title, /SITE B/, "A's open tab did not read B");
    assert.equal(left.gone, "yes", "A's tab reaches nothing once B is loaded");

    const tabB = await browser.tab();
    await tabB.goto(`http://127.0.0.1:${port}/`, 1500);
    const b = await tabB.evaluate("({ who: document.getElementById('who')?.textContent, a: document.body.dataset.a })");
    assert.equal(b.who, "SITE B: another task's draft");
    assert.equal(b.a, "null", "nothing A kept is there for B");

    assert.equal(await post("/preview/clear", ""), 200);
    await tabB.goto(`http://127.0.0.1:${port}/`, 800);
    assert.match(await tabB.evaluate("document.body.innerText"), /Nothing to preview/);
    assert.equal(await home.evaluate("localStorage.getItem('mark')"), "kept", "another origin's storage stays");
    assert.deepEqual(hits, [], "nothing reached another local port");
  } finally {
    await browser.close();
  }
});

// T58d N1, N5: each load on a host of its own. A cookie bomb of a previewed page reaches neither the home screen's
// stand-in on 127.0.0.1 nor the next load; site B reads nothing site A kept; an old tab of A reads nothing of a later
// load, after a restart of the preview (the ports start again from the first) and after nine more loads. And a
// browser already carrying huge cookies for 127.0.0.1 is answered 431 once, with its cookies cleared, then let in.
test("a host of its own per load: cookies and storage stay with their load, and huge cookies for 127.0.0.1 are cleared", { skip, timeout: 180000 }, async () => {
  const free = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, "127.0.0.1", r)); const n = s.address().port; await new Promise((r) => s.close(r)); return n; };
  const sitePorts = []; for (let i = 0; i < 9; i++) sitePorts.push(await free());
  const front = await free();
  const paths = { viewerSecret: join(dir, "viewer-secret"), ids: join(dir, "ids.json") };
  let pv = createPreview({ listenPort: front, paths, log: () => {}, sitePorts });
  await pv.listen();
  // The home screen's stand-in: as the home server makes its own, with the same answer to over-long headers.
  const homeHits = [];
  const home = http.createServer((req, res) => {
    if (req.url !== "/favicon.ico") homeHits.push(String(req.headers.cookie || "").length);
    if (req.url === "/bomb") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return void res.end("<!doctype html><title>bomb</title><link rel=icon href='data:,'><script>for (let i = 0; i < 40; i++) document.cookie = 'h' + i + '=' + 'x'.repeat(4000) + '; max-age=600; path=/';</script>");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><title>HOME</title><h1>HOME SCREEN</h1>");
  });
  home.on("clientError", headerOverflow);
  await new Promise((r) => home.listen(0, "127.0.0.1", r));
  const homePort = home.address().port;
  const loadAt = (text) => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: front, method: "POST", path: "/preview/load", agent: false,
      headers: { Authorization: `Bearer ${owner()}`, "Content-Type": "application/x-tar" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.end(writeTar([{ name: "index.html", data: Buffer.from(text) }]));
  });
  const browser = await ownerLikeBrowser();
  try {
    // A keeps a cookie and storage, and leaves a tab that keeps reading its own address.
    assert.equal(await loadAt(`<!doctype html><title>A</title><h1>OLD SITE A</h1><script>
      document.cookie = "kept_by_a=COOKIE-OF-A; max-age=600; path=/"; localStorage.setItem("kept_by_a", "STORAGE-OF-A");
      window.read = [];
      setInterval(async () => { try { const t = await (await fetch("/index.html", { cache: "no-store" })).text(); if (t.includes("<h1>") && !t.includes("OLD SITE A")) window.read.push(t.slice(0, 80)); } catch { /* closed or refused */ } }, 200);
    </script>`), 200);
    const tabA = await browser.tab();
    await tabA.goto(`http://127.0.0.1:${front}/`, 1500);
    const a = await tabA.evaluate("({ origin: location.origin, cookie: document.cookie })");
    assert.match(a.origin, /^http:\/\/p-[0-9a-f]{20}\.localhost:\d+$/);
    assert.equal(a.cookie, "kept_by_a=COOKIE-OF-A");

    assert.equal(await loadAt("<!doctype html><title>B</title><h1>SITE B</h1><script>window.seen = { cookie: document.cookie, storage: localStorage.getItem('kept_by_a') };</script>"), 200);
    const tabB = await browser.tab();
    await tabB.goto(`http://127.0.0.1:${front}/`, 1200);
    assert.deepEqual(await tabB.evaluate("window.seen"), { cookie: "", storage: null }, "B reads nothing A kept");

    // The preview restarts: its ports start again from the first, so the very next load is on A's port.
    await pv.close();
    pv = createPreview({ listenPort: front, paths, log: () => {}, sitePorts });
    await pv.listen();
    assert.equal(await loadAt("<!doctype html><title>NEXT</title><h1>NEXT after the restart</h1>"), 200);
    assert.equal(pv.sitePort, sitePorts[0]);
    assert.equal(new URL(a.origin).port, String(sitePorts[0]), "A's tab is on the same port as the load after the restart");
    await wait(1200);
    assert.deepEqual(await tabA.evaluate("window.read"), [], "A's old tab read nothing after the restart");
    for (let i = 1; i <= 9; i++) { assert.equal(await loadAt(`<!doctype html><title>LOAD ${i}</title><h1>LOAD ${i}</h1>`), 200); await wait(400); }
    await wait(800);
    assert.deepEqual(await tabA.evaluate("window.read"), [], "nor after nine more loads");

    // A cookie bomb in a previewed page: the home's stand-in and the next load are untouched.
    assert.equal(await loadAt("<!doctype html><title>BOMB</title><script>for (let i = 0; i < 40; i++) document.cookie = 'c' + i + '=' + 'x'.repeat(4000) + '; max-age=600; path=/'; window.len = document.cookie.length;</script>"), 200);
    const tabD = await browser.tab();
    await tabD.goto(`http://127.0.0.1:${front}/`, 1200);
    assert.ok(await tabD.evaluate("window.len") > 100000, "the page did set its cookies");
    homeHits.length = 0;
    const tabH = await browser.tab();
    await tabH.goto(`http://127.0.0.1:${homePort}/`, 800);
    assert.equal(await tabH.evaluate("document.title"), "HOME");
    assert.deepEqual(homeHits, [0], "the home's stand-in got no cookie at all");
    assert.equal(await loadAt("<!doctype html><title>AFTER</title><script>window.c = document.cookie;</script>"), 200);
    const tabE = await browser.tab();
    await tabE.goto(`http://127.0.0.1:${front}/`, 1000);
    assert.deepEqual(await tabE.evaluate("({ t: document.title, c: window.c })"), { t: "AFTER", c: "" }, "the next load is answered and reads no cookie");

    // A browser that already carries huge cookies for 127.0.0.1 (set by a page there): 431 once, cleared, let in.
    await tabH.goto(`http://127.0.0.1:${homePort}/bomb`, 800);
    assert.ok(await tabH.evaluate("document.cookie.length") > 100000, "a page on 127.0.0.1 set huge cookies there");
    homeHits.length = 0;
    await tabH.goto(`http://127.0.0.1:${homePort}/`, 800);
    assert.match(await tabH.evaluate("document.body.innerText"), /cookies for this address are cleared/);
    assert.deepEqual(homeHits, [], "the over-long request reached no handler");
    await tabH.goto(`http://127.0.0.1:${homePort}/`, 800);
    assert.equal(await tabH.evaluate("document.title"), "HOME", "the next request is let in");
    assert.deepEqual(homeHits, [0], "with no cookie left");
  } finally {
    await browser.close();
    await pv.close();
    await new Promise((r) => { home.close(() => r()); home.closeAllConnections(); });
  }
});
