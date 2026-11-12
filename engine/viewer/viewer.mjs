// The page viewer (PLAN-V5 K15, with the corrections after prototype p2): the Builder and the
// Art director send a built site as the bytes of a tar archive; the viewer unpacks it into a
// throwaway folder of its own, serves it on a throwaway 127.0.0.1 port, opens it in a hidden
// Chrome whose only way out is the viewer's own proxy (which passes nothing but that site),
// and answers with screenshots at 1280 and 390 px, light and dark where the site has both,
// and a report. It runs unfenced and trusts no byte of the archive and nothing the page does
// (docs/adr/0007). Checks, in K15's order: upgrades and CONNECT, health, the path and query
// (raw, no decoding), the token (this door's own secret; an agent of `doors.viewer.agents`,
// or the owner), the switch (owner tokens pass), Chrome, one render at a time, the archive.
// Log lines never hold a header, a body, a token, a file name or a page's text.
// main() starts this listener and the owner's preview (preview.mjs) and ends every Chrome it
// started when it stops.
import http from "node:http";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCaller, ensureSecret, headerValues, readBody, readDoorsState, refuse, statusFile, wantsUpgrade } from "../doors/common.mjs";
import { describeError } from "../relay/relay.mjs";
import { CHROME_PATH, chromeInstalled, chromeVersion, defaultLaunch, prepareRoot, readPs, startChrome } from "./chrome.mjs";
import { startProxy } from "./proxy.mjs";
import { REPORT_SCRIPT, mergePage, pageSlug, plainText } from "./report.mjs";
import { SITE_LIMITS, nameProblem, siteHandler } from "./sitefiles.mjs";
import { readTar, unpack, writeTar } from "./tar.mjs";

export const VIEW_LIMITS = Object.freeze({
  pageMs: 15_000,        // every shot of one page
  renderMs: 60_000,      // every page of one render, after Chrome has answered
  settleMs: 300,         // after the load event, before the report and the shots
  shotMaxHeight: 6000,   // a full page, cut here
  pages: 3,
});
export const SIZES = Object.freeze([[1280, 900], [390, 844]]);
const PERMISSIONS = ["geolocation", "notifications", "clipboard-read", "clipboard-write", "camera", "microphone", "midi",
  "idle-detection", "background-sync", "storage-access", "window-management", "local-fonts"];

// Every refusal: [status, sentence]. All go through `refuse` (never 429 or 5xx).
export const CODES = Object.freeze({
  view_refused: [403, "The page viewer does not take this kind of request."],
  view_not_found: [404, "The page viewer has no such address."],
  view_no_token: [401, "The page viewer needs a valid token for an agent that may use it."],
  view_off: [403, "The page viewer is off. The owner can switch it on in Settings."],
  view_bad_site: [400, "The site was not taken."],
  view_busy: [403, "The page viewer is already opening a site. Try again in a minute."],
  view_no_chrome: [403, "No Chrome was found on this Mac."],
});

const PAGES_RE = /^pages=([A-Za-z0-9._,/-]{1,600})$/;

// The raw target -> { pages: [names] } for POST /view/shots, "refused" for a query this
// address does not take, null for any other path.
export function parseTarget(target) {
  if (typeof target !== "string") return null;
  const at = target.indexOf("?");
  const path = at < 0 ? target : target.slice(0, at);
  if (path !== "/view/shots") return null;
  if (at < 0) return { pages: ["index.html"] };
  const m = PAGES_RE.exec(target.slice(at + 1));
  if (!m) return "refused";
  const pages = m[1].split(",");
  if (pages.length > VIEW_LIMITS.pages || new Set(pages).size !== pages.length) return "refused";
  if (!pages.every((p) => /\.html$/.test(p) && nameProblem(p, "file") === null)) return "refused";
  if (new Set(pages.map(pageSlug)).size !== pages.length) return "refused";
  return { pages };
}

function viewerPaths(paths) {
  const p = paths || {};
  const pick = (...names) => names.map((n) => p[n]).find((v) => typeof v === "string" && v !== "");
  const out = {
    state: pick("doorsState", "state"),
    ids: pick("ids"),
    secret: pick("viewerSecret", "secret"),
    status: pick("viewerStatus", "status"),
    work: pick("doorWork", "work"),
  };
  for (const k of Object.keys(out)) if (!out[k]) throw new Error(`createViewer: paths.${k} is needed`);
  return out;
}

const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The answer's own tar: shots and report.json, written by the viewer.
function answerTar(res, files) {
  const body = writeTar(files);
  res.writeHead(200, {
    "Content-Type": "application/x-tar", "Content-Length": body.length, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", Connection: "close",
  });
  res.end(body);
}

// One render: the site, the proxy, Chrome, each page in turn. -> { files, cut } where files
// are the answer's [{ name, data }]. Everything it started is ended and its folder removed
// before it returns, whatever happened.
async function render({ entries, pages, root, program, launch, ps, lim, chromeLimits, testing, onChrome }) {
  const files = new Map(entries.filter((e) => e.type === "file").map((e) => [e.name, e.data]));
  let current = null; // what the page now being opened collects
  const allBlocked = [];
  const note = (list, value) => { if (current && current[list].length < 200) current[list].push(value); };
  // What Chrome itself tries before any page is open (its own Google calls) is refused like
  // everything else but is not put on a page's list.
  const startup = new Set();
  const block = (addr) => { allBlocked.push(addr); if (current) { if (!startup.has(addr)) note("blocked", addr); } else if (startup.size < 50) startup.add(addr); };
  // Chrome asks for /favicon.ico by itself; it is missing only when a page names it.
  const missed = (name) => { if (name !== "favicon.ico") note("missing", name); };
  const site = http.createServer(siteHandler(() => files, { onMissing: missed }));
  if (testing && testing.sitePolicy === false) {
    // Tests only: the site served with no content policy, so the proxy and the interception
    // are proven bare (as p2 did). Nothing outside createViewer's own caller can ask this.
    site.removeAllListeners("request");
    const plain = siteHandler(() => files, { onMissing: missed });
    site.on("request", (req, res) => {
      const head = res.writeHead.bind(res);
      res.writeHead = (st, h) => { const c = { ...h }; delete c["Content-Security-Policy"]; return head(st, c); };
      plain(req, res);
    });
  }
  site.headersTimeout = 10_000;
  site.requestTimeout = 15_000;
  const siteSockets = new Set();
  site.on("connection", (s) => { siteSockets.add(s); s.on("close", () => siteSockets.delete(s)); });
  let proxy = null;
  let session = null;
  const report = { version: 1, chrome: null, pages: [] };
  const out = [];
  let renderCut = null;
  let renderTimer = null;
  try {
    unpack(entries, join(root, "site"));
    prepareRoot(root);
    await new Promise((resolve, reject) => { site.once("error", reject); site.listen(0, "127.0.0.1", resolve); });
    const sitePort = site.address().port;
    const origin = `http://127.0.0.1:${sitePort}`;
    proxy = await startProxy({ sitePort, onBlocked: (to) => block(to) });
    session = await startChrome({ program, root, proxyPort: proxy.port, launch, ps, limits: chromeLimits });
    onChrome(session);
    report.chrome = session.version;
    const renderDeadline = Date.now() + lim.renderMs;
    renderTimer = setTimeout(() => { renderCut = "time"; session.end(); }, lim.renderMs);
    renderTimer.unref();
    const send = (m, p, s, ms) => session.send(m, p, s, ms);

    // Every target is attached paused; interception, dialogs and logs are set before it runs.
    const sessions = new Map();
    const loadWaiters = new Map();
    const requests = new Map(); // requestId -> url, for refusals Chrome makes itself (the content policy)
    session.on((m) => {
      const sid = m.sessionId;
      const p = m.params || {};
      switch (m.method) {
        case "Target.attachedToTarget": {
          const info = p.targetInfo || {};
          sessions.set(p.sessionId, info);
          const tasks = [send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, p.sessionId).catch(() => {})];
          if (info.type === "page" || info.type === "iframe") tasks.push(send("Page.enable", {}, p.sessionId).catch(() => {}), send("Network.enable", {}, p.sessionId).catch(() => {}));
          tasks.push(send("Runtime.enable", {}, p.sessionId).catch(() => {}), send("Log.enable", {}, p.sessionId).catch(() => {}));
          tasks.push(send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, p.sessionId).catch(() => {}));
          Promise.all(tasks).then(() => send("Runtime.runIfWaitingForDebugger", {}, p.sessionId).catch(() => {}));
          break;
        }
        case "Fetch.requestPaused": {
          const url = p.request && typeof p.request.url === "string" ? p.request.url : "";
          let ok = false;
          try { const u = new URL(url); ok = u.protocol === "data:" || u.protocol === "blob:" || u.origin === origin; } catch { ok = false; }
          if (ok) send("Fetch.continueRequest", { requestId: p.requestId }, sid).catch(() => {});
          else {
            block(addressOf(url));
            send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }, sid).catch(() => {});
          }
          break;
        }
        case "Network.requestWillBeSent":
          if (requests.size < 5000 && p.request && typeof p.request.url === "string") requests.set(p.requestId, p.request.url);
          break;
        case "Network.loadingFailed": {
          const url = requests.get(p.requestId);
          if (url && p.blockedReason) { try { if (new URL(url).origin !== origin) block(addressOf(url)); } catch { /* not an address */ } }
          break;
        }
        case "Page.javascriptDialogOpening":
          send("Page.handleJavaScriptDialog", { accept: false }, sid).catch(() => {});
          break;
        case "Page.loadEventFired": {
          const w = loadWaiters.get(sid);
          if (w) { loadWaiters.delete(sid); w(); }
          break;
        }
        case "Runtime.exceptionThrown": {
          const d = p.exceptionDetails || {};
          note("errors", String((d.exception && d.exception.description) || d.text || "").split("\n")[0]);
          break;
        }
        case "Runtime.consoleAPICalled":
          if (p.type === "error") note("errors", (Array.isArray(p.args) ? p.args : []).map((a) => (a && (a.value ?? a.description)) ?? "").join(" "));
          break;
        case "Log.entryAdded":
          if (p.entry && p.entry.level === "error") note("errors", String(p.entry.text || ""));
          break;
        case "Inspector.targetCrashed":
          if (current) current.crashed = true;
          break;
        default:
      }
    });
    await send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: false }, undefined, 5000);
    for (const name of PERMISSIONS) await send("Browser.setPermission", { permission: { name }, setting: "denied" }, undefined, 5000).catch(() => {});
    await send("Target.setDiscoverTargets", { discover: true }, undefined, 5000);
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, undefined, 5000);

    for (const page of pages) {
      const shots = [];
      const passes = [];
      current = { errors: [], blocked: [], missing: [], crashed: false };
      let cut = null;
      let drawn = [];
      if (renderCut || session.gone) {
        report.pages.push(mergePage({ page, passes, errors: [], blocked: [], missing: [], drawn, shots, cut: renderCut || session.why || "chrome ended" }));
        continue;
      }
      const deadline = Math.min(Date.now() + lim.pageMs, renderDeadline);
      const left = () => { const ms = deadline - Date.now(); if (ms <= 0) throw new Error("time"); return ms; };
      let targetId = null;
      let moved = false;
      try {
        ({ targetId } = await send("Target.createTarget", { url: "about:blank" }, undefined, left()));
        let sid = null;
        for (let i = 0; i < 100 && !sid; i++) {
          for (const [k, ti] of sessions) if (ti.targetId === targetId) sid = k;
          if (!sid) await wait(Math.min(50, left()));
        }
        if (!sid) throw new Error("time");
        let hasDark = false;
        for (const [w, h] of SIZES) {
          for (const scheme of ["light", "dark"]) {
            if (scheme === "dark" && !hasDark) continue;
            await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sid, left());
            await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] }, sid, left());
            const loaded = new Promise((resolve) => loadWaiters.set(sid, resolve));
            await send("Page.navigate", { url: `${origin}/${page}` }, sid, left());
            let timer;
            const timedOut = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("time")), left()); });
            try { await Promise.race([loaded, timedOut, session.whenGone.then(() => { throw new Error("gone"); })]); } finally { clearTimeout(timer); loadWaiters.delete(sid); }
            await wait(Math.min(lim.settleMs, left()));
            const tree = await send("Page.getFrameTree", {}, sid, left());
            const frame = tree.frameTree && tree.frameTree.frame;
            if (!moved && frame && typeof frame.url === "string" && !frame.url.startsWith(`${origin}/`)) {
              moved = true;
              current.errors.push("The page moved away from itself, so the shot shows where it went.");
            }
            const world = await send("Page.createIsolatedWorld", { frameId: frame.id, worldName: "viewer-report" }, sid, left());
            await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", contextId: world.executionContextId, awaitPromise: true, returnByValue: true }, sid, Math.min(2000, left())).catch(() => {});
            const r = await send("Runtime.evaluate", { expression: REPORT_SCRIPT, contextId: world.executionContextId, returnByValue: true }, sid, left());
            const data = r && r.result && r.result.value && typeof r.result.value === "object" ? r.result.value : null;
            passes.push({ width: w, scheme, data });
            if (w === SIZES[0][0] && scheme === "light") {
              hasDark = !!(data && data.hasDark === true);
              drawn = await drawnFonts(send, sid, left).catch(() => []);
            }
            const tall = data && Number.isFinite(data.height) ? data.height : h;
            const height = Math.max(1, Math.min(lim.shotMaxHeight, Math.max(h, Math.ceil(tall))));
            const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height, scale: 1 } }, sid, left());
            const png = Buffer.from(typeof shot.data === "string" ? shot.data : "", "base64");
            if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error("no picture");
            const name = `shot-${pageSlug(page)}-${w}-${scheme}.png`;
            out.push({ name, data: png });
            shots.push(name);
          }
        }
      } catch {
        cut = session.why === "memory" ? "memory" : current.crashed ? "crashed" : renderCut || (session.gone ? "chrome ended" : "time");
        current.errors.push(cut === "memory" ? "The page used more than 2 GB of memory, so Chrome was stopped."
          : cut === "time" ? `The page did not finish in ${Math.round(lim.pageMs / 1000)} seconds, so it was cut.`
            : "Chrome stopped while opening this page.");
      }
      if (targetId && !session.gone) {
        const closed = await send("Target.closeTarget", { targetId }, undefined, 5000).then(() => true, () => false);
        if (!closed) await session.end();
      }
      const errors = current.errors.map((e) => String(e).split(origin).join(""));
      report.pages.push(mergePage({ page, passes, errors, blocked: current.blocked, missing: current.missing, drawn, shots, cut }));
    }
  } finally {
    clearTimeout(renderTimer);
    current = null;
    if (session) await session.end();
    if (proxy) await proxy.close();
    for (const s of siteSockets) s.destroy();
    await new Promise((r) => { if (site.listening) site.close(() => r()); else r(); });
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  out.push({ name: "report.json", data: Buffer.from(`${JSON.stringify(report, null, 1)}\n`) });
  return { files: out, cut: renderCut, blocked: allBlocked.length };
}

function addressOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "file:") return "file:";
    const port = u.port || (u.protocol === "https:" || u.protocol === "wss:" ? "443" : "80");
    return `${u.hostname}:${port}`.replace(/[^\x21-\x7e]/g, "?").slice(0, 140);
  } catch {
    return plainText(url, 60);
  }
}

// The faces Chrome really drew with (a named face that is not on the Mac falls back).
async function drawnFonts(send, sid, left) {
  const used = new Set();
  await send("DOM.enable", {}, sid, left());
  await send("CSS.enable", {}, sid, left());
  const doc = await send("DOM.getDocument", { depth: 0 }, sid, left());
  const { nodeIds } = await send("DOM.querySelectorAll", { nodeId: doc.root.nodeId, selector: "h1,h2,h3,h4,p,a,button,li,label,input,span" }, sid, left());
  for (const n of (nodeIds || []).slice(0, 30)) {
    const r = await send("CSS.getPlatformFontsForNode", { nodeId: n }, sid, left());
    for (const f of r.fonts || []) if (typeof f.familyName === "string") used.add(f.familyName);
  }
  return [...used];
}

export function createViewer({ listenPort, paths, config, log, now, chrome, limits, testing } = {}) {
  const P = viewerPaths(paths);
  const agentList = config && config.doors && config.doors.viewer && Array.isArray(config.doors.viewer.agents)
    ? config.doors.viewer.agents.filter((s) => typeof s === "string") : [];
  const program = chrome && typeof chrome.path === "string" ? chrome.path : chrome === undefined ? CHROME_PATH : null;
  const launch = chrome && typeof chrome.launch === "function" ? chrome.launch : defaultLaunch;
  const ps = chrome && typeof chrome.ps === "function" ? chrome.ps : readPs;
  const lim = { ...VIEW_LIMITS, ...(limits || {}) };
  const chromeLimits = limits && limits.chrome ? limits.chrome : {};
  const clock = typeof now === "function" ? now : typeof now === "number" ? () => now : () => Date.now();
  const iso = () => new Date(clock()).toISOString();
  const say = (line) => {
    try {
      if (typeof log === "function") log(line);
      else if (typeof log === "string" && log) appendFileSync(log, `${line}\n`);
    } catch {
      // A log failure changes nothing.
    }
  };
  const viewRoot = join(P.work, "view");
  let busy = false;
  let running = null;      // the render in progress, so close() can wait for it
  let chromeNow = null;    // its Chrome, so close() can end it

  const status = { startedAt: null, on: false, chrome: false, version: null, busy: false, today: { day: null, renders: 0, refused: 0 }, lastAt: null };
  const statusOut = statusFile(P.status);
  const bump = (what) => {
    const day = dayOf(clock());
    if (status.today.day !== day) status.today = { day, renders: 0, refused: 0 };
    status.today[what] += 1;
    status.lastAt = iso();
    status.busy = busy;
    statusOut.save(status);
  };
  function no(res, code, detail, statusOverride) {
    say(`${iso()} refused ${code}`);
    bump("refused");
    const [st, sentence] = CODES[code] || [403, "The page viewer refused this request."];
    return refuse(res, statusOverride || st, code, detail ? `${sentence} ${detail}` : sentence,
      code === "view_busy" ? { retryAfterSec: 30 } : undefined);
  }
  const caller = (req) => checkCaller({ rawHeaders: req.rawHeaders, secretPath: P.secret, idsPath: P.ids, agents: agentList, now: clock() });
  function admitted(req) {
    const who = caller(req);
    if (typeof who !== "object" || who === null) return "view_no_token";
    const vs = readDoorsState(P.state);
    status.on = vs.ok && vs.viewer.on;
    if (who.kind === "a" && (!vs.ok || !vs.viewer.on)) return "view_off";
    return { who };
  }

  async function onRequest(req, res) {
    if (wantsUpgrade(req.rawHeaders)) return no(res, "view_refused");
    const target = req.url;
    if (req.method === "GET" && target === "/view/health") {
      const vs = readDoorsState(P.state);
      return sendHealth(res, { status: "ok", part: "viewer", on: vs.ok && vs.viewer.on, chrome: chromeInstalled(program), version: chromeVersion(program) });
    }
    const t = req.method === "POST" ? parseTarget(target) : null;
    if (t === null) return no(res, "view_not_found");
    if (t === "refused") return no(res, "view_refused");
    let ok = admitted(req);
    if (typeof ok === "string") return no(res, ok);
    if (!chromeInstalled(program)) return no(res, "view_no_chrome");
    if (busy) return no(res, "view_busy");
    busy = true;
    try {
      const types = headerValues(req.rawHeaders, "content-type");
      if (types.length !== 1 || String(types[0]).split(";")[0].trim().toLowerCase() !== "application/x-tar") {
        return no(res, "view_bad_site", "Send it with Content-Type: application/x-tar.");
      }
      const raw = await readBody(req, SITE_LIMITS.sentBytes);
      if (raw === null) return undefined;
      if (raw === "too-big") return no(res, "view_bad_site", "The archive is over 20 MB.", 413);
      ok = admitted(req);
      if (typeof ok === "string") return no(res, ok);
      const tar = readTar(raw);
      if (!tar.ok) return no(res, "view_bad_site", `${tar.reason.charAt(0).toUpperCase()}${tar.reason.slice(1)}.`);
      const missing = t.pages.filter((p) => !tar.files.includes(p));
      if (missing.length) return no(res, "view_bad_site", "A page asked for is not in the archive.");
      const started = Date.now();
      mkdirSync(viewRoot, { recursive: true, mode: 0o700 });
      chmodSync(viewRoot, 0o700);
      const root = join(viewRoot, randomBytes(6).toString("hex"));
      mkdirSync(root, { mode: 0o700 });
      status.busy = true;
      statusOut.save(status);
      running = render({
        entries: tar.entries, pages: t.pages, root, program, launch, ps, lim, chromeLimits, testing,
        onChrome: (s) => { chromeNow = s; status.version = s.version; },
      });
      let result;
      try {
        result = await running;
      } catch (err) {
        say(`${iso()} chrome failed ${describeError(err)}`);
        return no(res, "view_no_chrome", "Chrome could not be started.");
      } finally {
        running = null;
        chromeNow = null;
      }
      const shots = result.files.length - 1;
      say(`${iso()} shots ${ok.who.kind === "t" ? "owner" : ok.who.slug} pages=${t.pages.length} shots=${shots} blocked=${result.blocked} ${result.cut ? `cut=${result.cut} ` : ""}${Date.now() - started}`);
      bump("renders");
      return answerTar(res, result.files);
    } finally {
      busy = false;
      status.busy = false;
      statusOut.save(status);
    }
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((err) => {
      say(`${iso()} error ${describeError(err)}`);
      if (!res.headersSent) no(res, "view_bad_site");
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;
  const onRaw = (_req, socket) => {
    say(`${iso()} refused view_refused`);
    bump("refused");
    const text = JSON.stringify({ error: { message: CODES.view_refused[1] }, code: "view_refused" });
    socket.on("error", () => {});
    if (!socket.writable) return void socket.destroy();
    socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n` +
      `Cache-Control: no-store\r\nConnection: close\r\n\r\n${text}`, () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
  };
  server.on("upgrade", onRaw);
  server.on("connect", onRaw);

  return {
    server,
    get port() {
      const a = server.address();
      return a && typeof a === "object" ? a.port : null;
    },
    listen() {
      // A crash leaves throwaway folders behind (their Chrome ended with the pipe): removed here.
      try { for (const n of readdirSync(viewRoot)) if (/^[0-9a-f]{12}$/.test(n)) rmSync(join(viewRoot, n), { recursive: true, force: true }); } catch { /* none */ }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, "127.0.0.1", () => {
          server.off("error", reject);
          status.startedAt = iso();
          const vs = readDoorsState(P.state);
          status.on = vs.ok && vs.viewer.on;
          status.chrome = chromeInstalled(program);
          status.version = chromeVersion(program);
          statusOut.save(status);
          statusOut.flush();
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        const done = async () => {
          if (chromeNow) await chromeNow.end();
          if (running) { try { await running; } catch { /* ended */ } }
          if (status.startedAt) statusOut.flush();
          resolve();
        };
        if (!server.listening) return void done();
        server.close(() => void done());
        server.closeAllConnections();
      });
    },
  };
}

function sendHealth(res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), "Cache-Control": "no-store", Connection: "close" });
  res.end(text);
}

// What main() starts the viewer with. Chrome's path is fixed here: nothing in a file, the
// config or the environment can replace it.
export function viewerOptions(cfg) {
  return { listenPort: cfg.ports.viewer, paths: cfg.paths, config: cfg, log: (line) => console.log(line), chrome: { path: CHROME_PATH } };
}

function lastResort(err) {
  console.log(`${new Date().toISOString()} page viewer caught an error it did not expect: ${describeError(err)}`);
}

async function main() {
  process.on("uncaughtException", lastResort);
  process.on("unhandledRejection", lastResort);
  const { loadConfig } = await import("../lib/config.mjs");
  const { createPreview } = await import("./preview.mjs");
  const cfg = loadConfig();
  mkdirSync(cfg.paths.doors, { recursive: true, mode: 0o700 });
  chmodSync(cfg.paths.doors, 0o700);
  ensureSecret(cfg.paths.viewerSecret);
  const viewer = createViewer(viewerOptions(cfg));
  const preview = createPreview({ listenPort: cfg.ports.preview, paths: cfg.paths, log: (line) => console.log(line) });
  try {
    await viewer.listen();
    await preview.listen();
  } catch (err) {
    console.log(`${new Date().toISOString()} page viewer could not start on 127.0.0.1:${cfg.ports.viewer} and :${cfg.ports.preview}: ${err.code || "error"}`);
    await viewer.close();
    await preview.close();
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} page viewer started on 127.0.0.1:${cfg.ports.viewer}, preview on 127.0.0.1:${cfg.ports.preview}`);
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    await viewer.close();
    await preview.close();
    console.log(`${new Date().toISOString()} page viewer stopped (${signal})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

const self = fileURLToPath(import.meta.url);
let invoked = "";
try {
  invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
} catch {
  invoked = "";
}
if (invoked === realpathSync(self)) {
  main().catch((err) => {
    console.log(`${new Date().toISOString()} page viewer failed: ${describeError(err)}`);
    process.exit(1);
  });
}
