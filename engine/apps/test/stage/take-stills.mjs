// Takes the stills of both App Studio apps on the stage (PLAN-APPS-ASTRYX T6).
//
//   node engine/apps/test/stage/take-stills.mjs --app <slug>|all --out <dir> [--pictures <dir>] [--only a,b]
//
// For each app: the pictures (pictures.mjs; the owner's folder with --pictures, read only, else
// reframings of the repository's sample render), the app in the real fence on its staging port
// with the stand-ins (stage.mjs), its state seeded through its own procedures (shots-<app>.mjs),
// then the page viewer's hidden Chrome (engine/viewer/chrome.mjs: headless, its own throwaway
// profile under the stage's temp root, no name lookups, driven over the debugging pipe) opens the
// page at 1600x1000, scale 2, through a proxy that passes the staged app's address and nothing
// else. Each still is reached by setting the address and by real clicks and keys through the
// pipe, waits until every picture in view has loaded and no Skeleton is on screen, and is taken
// with Page.captureScreenshot. Writes <out>/<slug>/<name>.png and <out>/<slug>/index.json (name,
// screen, size, and for each still the failed requests and the policy violations, which must be
// 0). Exits non-zero, naming them, when a still could not be taken. Ends only what it started.
import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHROME_PATH, chromeInstalled, defaultLaunch, prepareRoot, startChrome } from "../../../viewer/chrome.mjs";
import { blockedAddress, passes } from "../../../viewer/proxy.mjs";
import { makePictures } from "./pictures.mjs";
import { STAGE_PORTS, startStage } from "./stage.mjs";

export const VIEW = Object.freeze({ width: 1600, height: 1000, scale: 2 });
// The watchdog's cap for this Chrome: pages at scale 2 full of 4K pictures need more than the
// viewer's 2 GB.
const CHROME_MEMORY_KB = 6 * 1024 * 1024;
const SHOTS = { "arch-film-studio": "./shots-afs.mjs", "render-to-film": "./shots-r2f.mjs" };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Set by Ctrl-C: the run stops before the next still and ends what it started.
let stopRequested = false;

// Every content-policy violation of the page, kept where the stills can read it; put in by the
// debugging pipe before any of the page's own script, so the app's files are never changed.
const WATCH = `window.__violations = window.__violations || [];
document.addEventListener("securitypolicyviolation", function (e) {
  window.__violations.push({ directive: String(e.effectiveDirective || e.violatedDirective || ""), blocked: String(e.blockedURI || "") });
});`;

// ---------------------------------------------------------------------------
// The proxy: the viewer's rule (one destination, the staged app's http://127.0.0.1:<port>, never
// a name lookup, never a socket elsewhere; CONNECT and upgrades refused) with one difference
// from engine/viewer/proxy.mjs: the page's own POSTs to its own server pass too, with the headers
// the host checks (Origin, Sec-Fetch-*), so clicks that ask the app work as in the home screen.
const PASSED_HEADERS = ["accept", "accept-language", "content-type", "origin", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
  "x-file-name", "range", "if-none-match", "if-modified-since", "if-range"];

export function startStageProxy({ sitePort, onBlocked = () => {} }) {
  const sockets = new Set();
  const refuseSocket = (sock) => { sock.on("error", () => {}); sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", () => sock.destroy()); };
  const server = http.createServer((req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    const method = req.method;
    const path = ["GET", "HEAD", "POST"].includes(method) ? passes(req.url, "GET", sitePort) : null;
    if (path === null) {
      onBlocked(blockedAddress(req.url, method), method);
      res.writeHead(403, { "Content-Type": "text/plain", "Content-Length": 8, Connection: "close" });
      return void res.end("refused\n");
    }
    const headers = { host: `127.0.0.1:${sitePort}` };
    for (const k of PASSED_HEADERS) if (typeof req.headers[k] === "string") headers[k] = req.headers[k];
    if (typeof req.headers["content-length"] === "string") headers["content-length"] = req.headers["content-length"];
    const up = http.request({ host: "127.0.0.1", port: sitePort, method, path, headers, agent: false }, (r) => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502, { Connection: "close" }); res.end(); });
    up.setTimeout(60_000, () => up.destroy());
    req.pipe(up);
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  server.on("clientError", (_e, sock) => sock.destroy());
  server.on("connect", (req, sock) => { onBlocked(blockedAddress(req.url, "CONNECT"), "CONNECT"); refuseSocket(sock); });
  server.on("upgrade", (req, sock) => { onBlocked(blockedAddress(req.url, "UPGRADE"), "UPGRADE"); refuseSocket(sock); });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok({
      port: server.address().port,
      close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
    }));
  });
}

// ---------------------------------------------------------------------------
// One tab, driven through the pipe.

const KEYS = {
  Escape: ["Escape", 27], Enter: ["Enter", 13], Tab: ["Tab", 9], " ": ["Space", 32], Space: ["Space", 32],
  ArrowLeft: ["ArrowLeft", 37], ArrowUp: ["ArrowUp", 38], ArrowRight: ["ArrowRight", 39], ArrowDown: ["ArrowDown", 40],
  "?": ["Slash", 191], "/": ["Slash", 191],
};
function keyInfo(key) {
  if (KEYS[key]) return { key: key === "Space" ? " " : key, code: KEYS[key][0], vk: KEYS[key][1] };
  if (/^[a-z]$/i.test(key)) return { key, code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}`, vk: key.charCodeAt(0) };
  throw new Error(`no key named ${key}`);
}
const modsOf = (m = {}) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);

// `scripts`: more code put in before any of the page's own (the sweep's watchers).
export async function openTab(session, base, { scripts = [] } = {}) {
  const send = (m, p, s, ms) => session.send(m, p, s, ms);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
  const failed = [];
  const errors = [];
  let loaded = () => {};
  session.on((m) => {
    if (m.sessionId !== sid) return;
    const p = m.params || {};
    if (m.method === "Network.loadingFailed" && !p.canceled) failed.push({ id: p.requestId, why: String(p.errorText || "failed") });
    if (m.method === "Network.responseReceived" && p.response?.status >= 400) failed.push({ id: p.requestId, url: String(p.response.url).replace(base, ""), why: String(p.response.status) });
    if (m.method === "Network.requestWillBeSent") {
      const f = failed.find((x) => x.id === p.requestId);
      if (f && !f.url) f.url = String(p.request.url).replace(base, "");
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "").slice(0, 300));
    if (m.method === "Page.loadEventFired") loaded();
  });
  await send("Page.enable", {}, sid);
  await send("Runtime.enable", {}, sid);
  await send("Network.enable", {}, sid);
  if (session.userAgent) await send("Network.setUserAgentOverride", { userAgent: session.userAgent }, sid);
  await send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale, mobile: false }, sid);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: WATCH }, sid);
  for (const source of scripts) await send("Page.addScriptToEvaluateOnNewDocument", { source }, sid);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid, 30_000);
    if (r.exceptionDetails) throw new Error(`on the page: ${String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300)}`);
    return r.result?.value;
  };
  const navigate = async (url) => {
    const load = new Promise((r) => { loaded = r; });
    await send("Page.navigate", { url }, sid);
    await Promise.race([load, wait(20_000)]);
  };
  const mouse = async (x, y, mods) => {
    const modifiers = modsOf(mods);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers }, sid);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, modifiers }, sid);
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, modifiers }, sid);
    await wait(250);
  };
  const keyEvent = async (type, key, mods = {}) => {
    const k = keyInfo(key);
    const printable = k.key.length === 1 && !mods.meta && !mods.ctrl && !mods.alt;
    await send("Input.dispatchKeyEvent", {
      type: type === "down" && printable ? "keyDown" : type === "down" ? "rawKeyDown" : "keyUp",
      key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: modsOf(mods),
      ...(type === "down" && printable ? { text: k.key, unmodifiedText: k.key } : {}),
    }, sid);
  };
  // The center of an element, scrolled into view; null when there is none.
  const centerOf = (finder) => evaluate(`(() => { const el = (${finder})(); if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`);

  const page = {
    failed, errors, evaluate,
    // A raw call on this tab's session (the sweep's uploads and drags).
    cdp: (method, params = {}, ms) => send(method, params, sid, ms),
    sid,
    // A fresh load of the page at `hash`; storage cleared first when asked.
    async open(hash = "", { clearStorage = false } = {}) {
      if (clearStorage) {
        await navigate("about:blank");
        await navigate(`${base}/`);
        await evaluate("localStorage.clear(); sessionStorage.clear(); true");
      }
      await navigate("about:blank");
      await navigate(`${base}/${hash}`);
      await page.waitFor(`(() => { const r = document.getElementById("root"); return !!r && r.childElementCount > 0; })()`, 15_000);
    },
    async waitFor(expression, ms = 10_000) {
      const end = Date.now() + ms;
      for (;;) {
        if (await evaluate(expression).catch(() => false)) return true;
        if (Date.now() > end) return false;
        await wait(150);
      }
    },
    wait,
    async key(key, mods = {}) { await keyEvent("down", key, mods); await keyEvent("up", key, mods); await wait(250); },
    async hold(key, mods = {}) { await keyEvent("down", key, mods); await wait(250); },
    async release(key, mods = {}) { await keyEvent("up", key, mods); await wait(150); },
    // A real click on the button, link, tab or menu item whose text is `text`.
    async click(text, mods = {}) {
      const finder = `() => { const want = ${JSON.stringify(text)}.trim().toLowerCase();
        const all = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], [role="option"], label, summary')];
        const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const name = (el) => (el.getAttribute("aria-label") || el.innerText || "").trim().toLowerCase();
        return all.find((el) => seen(el) && name(el) === want) || all.find((el) => seen(el) && name(el).startsWith(want)) || null; }`;
      const at = await centerOf(finder);
      if (!at) throw new Error(`nothing on screen says "${text}"`);
      await mouse(at.x, at.y, mods);
    },
    // A real click on the n-th visible element matching `selector` (0 is the first).
    async clickNth(selector, n, mods = {}) {
      const finder = `() => [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[${Number(n)}] || null`;
      await page.waitFor(`(${finder})() !== null`, 8000);
      const at = await centerOf(finder);
      if (!at) throw new Error(`there is no element ${n + 1} of "${selector}" on screen`);
      await mouse(at.x, at.y, mods);
    },
    // Every picture in view loaded, no Skeleton on screen, and the screen still for a moment.
    async settle(ms = 20_000) {
      const check = `(async () => {
        if (document.fonts && document.fonts.status !== "loaded") return null;
        const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
        if ([...document.querySelectorAll('[class*="skeleton" i], [data-skeleton]')].some(inView)) return null;
        if ([...document.images].filter(inView).some((i) => !i.complete || i.naturalWidth === 0)) return null;
        if ([...document.querySelectorAll("video")].filter(inView).some((v) => v.preload !== "none" && v.readyState < 2 && !v.error)) return null;
        return document.body.innerText.length + ":" + document.images.length + ":" + document.querySelectorAll("*").length;
      })()`;
      const end = Date.now() + ms;
      let last = null;
      for (;;) {
        const now = await evaluate(check).catch(() => null);
        if (now !== null && now === last) return true;
        last = now;
        if (Date.now() > end) return false;
        await wait(300);
      }
    },
    async violations() { return (await evaluate("JSON.stringify(window.__violations || [])").then(JSON.parse).catch(() => [])); },
    async capture(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sid, 30_000);
      writeFileSync(file, Buffer.from(data, "base64"));
    },
    close: () => send("Target.closeTarget", { targetId }).catch(() => {}),
  };
  return page;
}

// ---------------------------------------------------------------------------

// Takes one app's stills into <out>/<slug>/. -> { slug, taken: [names], missing: [{ name, why }] }
export async function takeApp({ slug, out, pictures, only = null, log = console.log }) {
  const shots = await import(SHOTS[slug]);
  const dir = join(out, slug);
  mkdirSync(dir, { recursive: true });
  const stills = shots.STILLS.filter((s) => !only || only.includes(s.name));
  const index = { app: slug, takenAt: new Date().toISOString(), view: `${VIEW.width}x${VIEW.height} at scale ${VIEW.scale}`, pictures: pictures.sample ? "sample render reframings" : "the owner's own renders", stills: [] };
  const missing = [];
  let stage = null;
  let session = null;
  let proxy = null;
  const blocked = [];
  try {
    log(`${slug}: starting on ${STAGE_PORTS[slug]}`);
    stage = await startStage({ slug, port: STAGE_PORTS[slug], pictures });
    log(`${slug}: seeding`);
    const ctx = await shots.seed(stage, pictures, log);
    proxy = await startStageProxy({ sitePort: stage.port, onBlocked: (to, how) => blocked.push(`${how} ${to}`) });
    // Chrome under the stage's temp root, a new throwaway profile for each start; started again
    // if the watchdog or a crash ends it part way.
    let starts = 0;
    let page = null;
    const startBrowser = async () => {
      if (session) await session.end().catch(() => {});
      starts += 1;
      const croot = join(stage.root, `chrome-${starts}`);
      mkdirSync(croot, { mode: 0o700 });
      prepareRoot(croot);
      session = await startChrome({ program: CHROME_PATH, root: croot, proxyPort: proxy.port, launch: defaultLaunch, limits: { memCapKb: CHROME_MEMORY_KB } });
      page = await openTab(session, stage.url);
    };
    await startBrowser();
    // One still: brought on screen, settled, taken. -> its index entry (with `error` when not taken)
    const takeOne = async (still, file) => {
      const failedBefore = page.failed.length;
      const refusedBefore = blocked.length;
      const errorsBefore = page.errors.length;
      const entry = { name: still.name, screen: still.screen, file: `${still.name}.png`, size: { width: VIEW.width * VIEW.scale, height: VIEW.height * VIEW.scale } };
      try {
        if (still.before) await still.before(stage, ctx);
        await still.run(page, ctx);
        await wait(300);
        entry.settled = await page.settle();
        const v = await page.violations();
        await page.capture(file);
        // The page's own requests that failed or answered 4xx or 5xx (one to another host fails
        // here too, refused by the proxy). The tab's automatic /favicon.ico is the browser's, not the app's.
        const own = page.failed.slice(failedBefore).filter((f) => f.url !== "/favicon.ico");
        entry.failedRequests = own.length;
        entry.failed = own.map((f) => `${f.why} ${f.url || ""}`.trim());
        // What the proxy refused meanwhile, the browser's own background calls included.
        entry.proxyRefused = blocked.slice(refusedBefore);
        entry.policyViolations = v.length;
        entry.violations = v;
        entry.pageErrors = page.errors.slice(errorsBefore);
      } catch (err) {
        entry.error = String(err?.message || err).slice(0, 400);
        rmSync(file, { force: true });
      } finally {
        if (still.after) await Promise.resolve(still.after(stage, ctx)).catch(() => {});
      }
      return entry;
    };
    for (const still of stills) {
      if (stopRequested) throw new Error("stopped by the owner");
      const file = join(dir, `${still.name}.png`);
      rmSync(file, { force: true });
      let entry = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (session.gone) {
          log(`  Chrome ended (${session.why}, peak ${Math.round(session.peakKb / 1024)} MB); starting it again`);
          await startBrowser();
        }
        entry = await takeOne(still, file);
        if (!entry.error || !session.gone) break;
      }
      if (entry.error) {
        missing.push({ name: still.name, why: entry.error });
        log(`  ${still.name}: NOT taken: ${entry.error}`);
        index.stills.push({ ...entry, file: null });
      } else {
        log(`  ${still.name}: taken${entry.settled ? "" : " (the screen did not settle)"}; failed requests ${entry.failedRequests}, policy violations ${entry.policyViolations}`);
        index.stills.push(entry);
      }
    }
    await page?.close();
  } catch (err) {
    for (const s of stills) if (!index.stills.some((e) => e.name === s.name)) missing.push({ name: s.name, why: String(err?.message || err).slice(0, 600) });
    log(`${slug}: stopped early: ${String(err?.message || err).slice(0, 1200)}`);
  } finally {
    if (session) await session.end().catch(() => {});
    if (proxy) await proxy.close();
    if (stage) await stage.stop();
  }
  index.missing = missing;
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return { slug, taken: index.stills.filter((e) => e.file).map((e) => e.name), missing };
}

function parseArgs(argv) {
  const a = { app: null, out: null, pictures: null, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--app") { a.app = v; i += 1; } else if (k === "--out") { a.out = v; i += 1; } else if (k === "--pictures") { a.pictures = v; i += 1; } else if (k === "--only") { a.only = String(v).split(",").filter(Boolean); i += 1; } else throw new Error(`unknown argument ${k}`);
  }
  if (!a.app || !a.out) throw new Error("usage: take-stills.mjs --app <slug>|all --out <dir> [--pictures <dir>] [--only a,b]");
  if (a.app !== "all" && !Object.hasOwn(STAGE_PORTS, a.app)) throw new Error(`no app is named ${a.app}`);
  return a;
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }
  if (!chromeInstalled(CHROME_PATH)) { console.error(`Chrome is not installed at ${CHROME_PATH}`); process.exit(1); }
  const out = resolve(args.out);
  const from = args.pictures ? resolve(args.pictures) : null;
  if (from && !existsSync(from)) { console.error(`no folder ${from}`); process.exit(2); }
  const picsDir = mkdtempSync("/private/tmp/uuu-stage-pictures-");
  const cleanup = () => rmSync(picsDir, { recursive: true, force: true });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopRequested = true; console.error("stopping after this step"); });
  try {
    console.log(from ? `pictures: the renders in ${from} (read only)` : "pictures: reframings of the sample render");
    const pictures = await makePictures({ from, into: picsDir });
    const slugs = args.app === "all" ? Object.keys(STAGE_PORTS) : [args.app];
    const results = [];
    for (const slug of slugs) if (!stopRequested) results.push(await takeApp({ slug, out, pictures, only: args.only }));
    const missing = results.flatMap((r) => r.missing.map((m) => `${r.slug}/${m.name}: ${m.why.split("\n")[0]}`));
    for (const r of results) console.log(`${r.slug}: ${r.taken.length} stills in ${join(out, r.slug)}`);
    if (missing.length) {
      console.error(`not taken (${missing.length}):\n${missing.join("\n")}`);
      process.exitCode = 1;
    }
  } finally {
    cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
