// The frames trial (PLAN-MAC D16, PLAN-MAC-2 M8): what a page inside App Studio's frame can do in the Mac app's web
// view, before the rule list and with it. Prints one line per attempt, `<attempt>: blocked | allowed-by-design |
// STILL GETS OUT`, for each of the two, and writes EVID/rmac8/frames.json and frames.txt.
// usage: node engine/mac/harness/frames/run.mjs
//
// Everything runs on 127.0.0.1, on free ports from 3300 up (PLAN-MAC-2 rule 3: 3100 to 3299 are never bound):
//  - a stand-in home: a page that frames the stand-in app with exactly the `sandbox`, `allow` and `referrerpolicy` of
//    PUB/pages/app.js, under the home screen's own content policy (read from home/server/lib/app.mjs), and a
//    stand-in `/api/brain/find`;
//  - a stand-in app: pages/attack.js, the Astryx kit's example, a download and a service worker, every answer with
//    App Studio's headers (apps/host.mjs securityHeaders) and every request judged by host.mjs's browserRefusal;
//  - a stand-in internet (http, WebSocket, a bare-connection port for preconnect), a stand-in brain door (standing for
//    3190), and a UDP port that counts STUN packets.
// The web view is the app's (frames-trial, built from trial/main.swift with EngineShell's sources); trial/main.swift
// says which two things stand in for the app's own ports 3171 to 3189.
// Exit 1 when the runner could not run, the frame never answered, the frame's first request is not what host.mjs
// needs, the Astryx app does not draw with the list on, its own origin is blocked with the list on, or any row for
// top-page movement, parent reading, a granted permission or the brain is not `blocked`.
import { execFileSync, spawn } from "node:child_process";
import dgram from "node:dgram";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freePort, kept } from "../scenes/_lib.mjs";

process.title = "uuu-mac-frames-trial";
const HERE = dirname(fileURLToPath(import.meta.url));
const MAC = resolve(HERE, "../..");
const ENGINE = resolve(MAC, "..");
if (ENGINE === "/Users/aasish/uuu/engine" || ENGINE.startsWith("/Users/aasish/uuu/engine/")) {
  console.error("refused: this copy of the trial is in the live checkout; run the worktree's");
  process.exit(2);
}
const PUB = join(ENGINE, "home", "public");
const EVID = process.env.WEBKIT_EVID || "/Users/aasish/uuu/.router/evidence/mac";
const OUT = join(EVID, "rmac8");
const LOCKS = [process.env.WEBKIT_LOCK || join(EVID, "browser.lock"),
  "/private/tmp/claude-501/-Users-aasish-uuu/9fa356e7-01ff-4248-bf1d-261a723e0785/scratchpad/chrome.lock"];
const RUNNER = join(MAC, ".build", "frames", "frames-trial");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- what is read from the engine (never run on its real ports) ----------------------------------------------------
const appJs = readFileSync(join(PUB, "pages", "app.js"), "utf8");
const SANDBOX = (appJs.match(/export const SANDBOX = "([^"]+)"/) || [])[1];
const ALLOW = (appJs.match(/export const ALLOW = "([^"]+)"/) || [])[1];
const REFERRER = (appJs.match(/referrerpolicy="([^"]+)"/) || [])[1];
const homeJs = readFileSync(join(ENGINE, "home", "server", "lib", "app.mjs"), "utf8");
const HOME_CSP = (homeJs.match(/^const CSP = "([^"]+)";/m) || [])[1];
if (!SANDBOX || !ALLOW || !REFERRER || !HOME_CSP) { console.error("could not read SANDBOX, ALLOW, referrerpolicy or the home's CSP"); process.exit(2); }
const { securityHeaders, browserRefusal } = await import(pathToFileURL(join(ENGINE, "apps", "host.mjs")).href);

// ---- power and the locks -------------------------------------------------------------------------------------------
const batt = execFileSync("/usr/bin/pmset", ["-g", "batt"], { encoding: "utf8" });
const pct = Number((batt.match(/(\d+)%/) || [])[1]);
console.log(`pmset: ${batt.trim().split("\n").pop().trim()}`);
if (/discharging/.test(batt) && pct < 20) { console.error("on battery below 20 percent: no trial"); process.exit(1); }
const held = [];
async function takeLocks() {
  for (const lock of LOCKS) {
    mkdirSync(dirname(lock), { recursive: true });
    for (;;) {
      try { mkdirSync(lock); held.push(lock); break; } catch (e) {
        if (e.code !== "EEXIST") throw e;
        console.log(`lock: ${lock} is held; waiting 20 s`);
        await wait(20000);
      }
    }
  }
}
function dropLocks() { while (held.length) { try { rmdirSync(held.pop()); } catch { /* gone */ } } }

// ---- the runner ----------------------------------------------------------------------------------------------------
function swiftSources() {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".swift")) out.push(p); } };
  walk(join(MAC, "Sources", "EngineShell"));
  return [...out.sort(), join(HERE, "trial", "main.swift")];
}
function buildRunner() {
  const sources = swiftSources();
  if (!existsSync(join(MAC, "Sources", "EngineShell", "Build", "BuildConstants.swift"))) throw new Error("no BuildConstants.swift: run ./check.sh once first");
  const newest = Math.max(...sources.map((s) => statSync(s).mtimeMs));
  if (existsSync(RUNNER) && statSync(RUNNER).mtimeMs > newest) return;
  mkdirSync(dirname(RUNNER), { recursive: true });
  console.log("building frames-trial (swiftc, EngineShell's sources and trial/main.swift)");
  execFileSync("/usr/bin/swiftc", ["-O", "-swift-version", "5", "-module-name", "FramesTrial", ...sources, "-o", RUNNER], { stdio: "inherit" });
}

// ---- the stand-ins -------------------------------------------------------------------------------------------------
const servers = [];
let hits = [];              // { who, path, kind } since the last reset
const record = (who, path, kind = "request") => hits.push({ who, path, kind });
function listen(server, port) { return new Promise((r, j) => { server.once("error", j); server.listen(port, "127.0.0.1", () => { servers.push(server); r(); }); }); }
async function port() { const p = await freePort(3300); if (!p || kept(p)) throw new Error("no free port from 3300 up"); return p; }
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

// The Astryx app as App Studio serves one (ADR 0019): the kit's files as they are, its example page with the import
// map taken out and the bare names made relative (an inline import map is refused under App Studio's policy).
function astryxFiles() {
  const kit = join(ENGINE, "astryx-kit", "astryx");
  const example = join(ENGINE, "astryx-kit", "example");
  const files = new Map();
  for (const name of readdirSync(kit)) files.set(`/kit/astryx/${name}`, readFileSync(join(kit, name)));
  const page = readFileSync(join(example, "index.html"), "utf8")
    .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, "")
    .replace(/<link rel="stylesheet" href="(kit|astryx-theme)\.css">\n?/g, "")
    .replace(/<header class="page-header">[\s\S]*?<\/header>\n?/, "");
  const names = { react: "./astryx/react.js", "react-dom/client": "./astryx/react-dom-client.js", "@astryxdesign/core": "./astryx/core.js", "@astryxdesign/theme-neutral": "./astryx/theme-neutral.js" };
  const js = readFileSync(join(example, "app.js"), "utf8").replace(/from '([^']+)'/g, (m, n) => (names[n] ? `from '${names[n]}'` : m));
  files.set("/kit/", Buffer.from(page));
  files.set("/kit/app.js", Buffer.from(js));
  files.set("/kit/style.css", readFileSync(join(example, "style.css")));
  return files;
}

let P = {};
const firstRequests = [];   // what the frame's first request carried, one per load
async function startStandIns() {
  P = { home: await port() };
  const home = http.createServer();
  await listen(home, P.home);
  P.app = await port();
  const app = http.createServer();
  await listen(app, P.app);
  P.o = await port(); const outside = http.createServer(); await listen(outside, P.o);
  P.pc = await port(); const bare = net.createServer((s) => { record("preconnect", "/", "connection"); s.destroy(); }); await listen(bare, P.pc);
  P.b = await port(); const brain = http.createServer(); await listen(brain, P.b);
  for (let u = P.b + 1; u < 65535; u++) {
    if (kept(u)) continue;
    const sock = dgram.createSocket("udp4");
    const ok = await new Promise((r) => { sock.once("error", () => r(false)); sock.bind(u, "127.0.0.1", () => r(true)); });
    if (ok) { P.u = u; sock.on("message", () => record("udp", "stun", "packet")); servers.push(sock); break; }
    sock.close();
  }
  for (const v of Object.values(P)) if (kept(v)) throw new Error(`refused: port ${v}`);

  const TOP_JS = readFileSync(join(HERE, "pages", "top.js"));
  const ATTACK_JS = readFileSync(join(HERE, "pages", "attack.js"));
  const SW_JS = readFileSync(join(HERE, "pages", "sw.js"));
  const KIT = astryxFiles();
  const esc = (s) => String(s).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);

  home.on("request", (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/brain")) { record("home-brain", url.pathname + url.search); res.writeHead(200, { "content-type": "application/json" }); return res.end("{}"); }
    if (url.pathname === "/top.js") { res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" }); return res.end(TOP_JS); }
    if (url.pathname !== "/") { res.writeHead(404); return res.end(); }
    const kit = url.searchParams.get("kit");
    const q = new URLSearchParams({ only: url.searchParams.get("only") || "auto", o: P.o, pc: P.pc, b: P.b, h: P.home, u: P.u });
    const src = kit ? `http://127.0.0.1:${P.app}/kit/` : `http://127.0.0.1:${P.app}/attack.html?${q}`;
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Frames trial home</title>
<style>html,body{margin:0;background:#1e1f22;color:#eee}iframe{position:absolute;left:0;top:0;width:1000px;height:800px;border:0;background:#fff}</style></head>
<body><iframe id="app" title="app" sandbox="${esc(SANDBOX)}" referrerpolicy="${esc(REFERRER)}" allow="${esc(ALLOW)}" src="${esc(src)}"></iframe>
<script src="/top.js"></script></body></html>`;
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store",
      "content-security-policy": `${HOME_CSP}; frame-src http://127.0.0.1:${P.app} http://localhost:${P.app}` });
    res.end(page);
  });
  home.on("upgrade", (req, s) => { record("home-brain", req.url, "upgrade"); s.destroy(); });

  app.on("request", (req, res) => {
    const url = new URL(req.url, "http://x");
    const refusal = browserRefusal(req, P.app);
    const h = req.headers;
    if (url.pathname === "/attack.html" || url.pathname === "/kit/") {
      firstRequests.push({ path: url.pathname, refusal, secFetchSite: h["sec-fetch-site"] ?? null, secFetchDest: h["sec-fetch-dest"] ?? null,
        secFetchMode: h["sec-fetch-mode"] ?? null, origin: h.origin ?? null, referer: h.referer ?? null });
    }
    record("app", url.pathname);
    const sec = securityHeaders(P.home);
    if (refusal) { res.writeHead(403, { ...sec, "content-type": "text/plain" }); return res.end(`refused: ${refusal}\n`); }
    if (url.pathname === "/attack.html") {
      res.writeHead(200, { ...sec, "content-type": TYPES[".html"], "cache-control": "no-store" });
      return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stand-in app</title></head><body><p>Stand-in app</p><script src="/attack.js"></script></body></html>`);
    }
    if (url.pathname === "/attack.js") { res.writeHead(200, { ...sec, "content-type": TYPES[".js"], "cache-control": "no-store" }); return res.end(ATTACK_JS); }
    if (url.pathname === "/sw.js") { res.writeHead(200, { ...sec, "content-type": TYPES[".js"], "cache-control": "no-store" }); return res.end(SW_JS); }
    if (url.pathname === "/dl") { res.writeHead(200, { ...sec, "content-type": "text/plain", "content-disposition": 'attachment; filename="trial.txt"' }); return res.end("frames trial\n"); }
    const body = KIT.get(url.pathname);
    if (body) { res.writeHead(200, { ...sec, "content-type": TYPES[extname(url.pathname)] || TYPES[".html"], "cache-control": "no-store" }); return res.end(body); }
    res.writeHead(404, { ...sec, "content-type": "text/plain" }); res.end("not found\n");
  });

  outside.on("connection", () => record("outside", "", "connection"));
  outside.on("request", (req, res) => {
    req.resume();
    record("outside", new URL(req.url, "http://x").pathname);
    if (req.url.startsWith("/sse")) { res.writeHead(200, { "content-type": "text/event-stream", "access-control-allow-origin": "*" }); return res.end("data: x\n\n"); }
    res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" }); res.end("outside\n");
  });
  outside.on("upgrade", (req, s) => { record("outside", req.url, "upgrade"); s.destroy(); });
  brain.on("connection", () => record("brain-door", "", "connection"));
  brain.on("request", (req, res) => { req.resume(); record("brain-door", new URL(req.url, "http://x").pathname); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  brain.on("upgrade", (req, s) => { record("brain-door", req.url, "upgrade"); s.destroy(); });
}

async function stopStandIns() {
  for (const s of servers.splice(0)) {
    if (s.closeAllConnections) s.closeAllConnections();
    await new Promise((r) => { try { s.close(() => r()); } catch { r(); } });
  }
}

// ---- one load ------------------------------------------------------------------------------------------------------
const scratch = mkdtempSync(join(tmpdir(), "uuu-mac-frames-"));
let child = null;
async function load(rules, query, extra = []) {
  hits = [];
  const json = join(scratch, `r-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const args = ["--home-port", String(P.home), "--app-port", String(P.app), "--rules", rules, "--path", `/?${query}`, "--json", json, ...extra];
  const code = await new Promise((r) => {
    child = spawn(RUNNER, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (c, sig) => { child = null; r(c ?? (sig ? 128 : 1)); });
  });
  await wait(300);
  let report = {};
  try { report = JSON.parse(readFileSync(join(json), "utf8")); } catch { report = { ready: false, notes: ["no report"] }; }
  return { code, report, hits: hits.slice() };
}

// ---- judging -------------------------------------------------------------------------------------------------------
const B = "blocked", D = "allowed-by-design", S = "STILL GETS OUT";
const hit = (h, who, path) => h.some((x) => x.who === who && (path === undefined || x.path.startsWith(path)));
const homeOrigin = () => `http://127.0.0.1:${P.home}/`;
const moved = (r) => !r.onHome || !String(r.topUrl || "").startsWith(homeOrigin());
const asked = (r, path) => (r.openerAsked || []).some((u) => u.includes(path));

// [id, kind, judge(result, load)] in the order printed. kind: the categories the done-when names.
const AUTO_ROWS = [
  ["read-parent-document", "parent", (v) => (v && v.read === false ? B : S)],
  ["read-top-location", "parent", (v) => (v && v.read === false ? B : S)],
  ["alert", "", (v, L) => (L.report.panelsAsked || []).includes("alert") ? S : B],
  ["confirm", "", (v, L) => (v && v.value === true) || (L.report.panelsAsked || []).includes("confirm") ? S : B],
  ["prompt", "", (v) => (v && v.value != null ? S : B)],
  ["cookie", "", (v) => (v && v.own ? D : B)],
  ["local-storage", "", (v, L) => (L.report.top && L.report.top.storageSeen ? S : v && v.own ? D : B)],
  ["fetch-own-origin", "own", (v) => (v && v.ok ? D : B)],
  ["fetch-outside", "", (v, L) => (hit(L.hits, "outside", "/fetch") ? S : B)],
  ["img-outside", "", (v, L) => (hit(L.hits, "outside", "/img") ? S : B)],
  ["websocket-outside", "", (v, L) => (hit(L.hits, "outside", "/ws") ? S : B)],
  ["eventsource-outside", "", (v, L) => (hit(L.hits, "outside", "/sse") ? S : B)],
  ["beacon-outside", "", (v, L) => (hit(L.hits, "outside", "/beacon") ? S : B)],
  ["link-prerender-outside", "", (v, L) => (hit(L.hits, "outside", "/prerender") ? S : B)],
  ["link-prefetch-outside", "", (v, L) => (hit(L.hits, "outside", "/prefetch") ? S : B)],
  ["link-preconnect-outside", "", (v, L) => (hit(L.hits, "preconnect") ? S : B)],
  ["service-worker", "", (v) => (v && v.registered ? D : B)],
  ["service-worker-outside", "", (v, L) => (hit(L.hits, "outside", "/sw-") ? S : B)],
  ["webrtc-stun", "", (v, L) => (hit(L.hits, "udp") ? S : B)],
  ["get-user-media", "permission", (v) => (v && v.granted ? S : B)],
  ["get-display-media", "permission", (v) => (v && v.granted ? S : B)],
  ["geolocation", "permission", (v) => (v && v.granted ? S : B)],
  ["data-image", "", (v) => (v && v.loaded ? D : B)],
  ["blob-image", "", (v) => (v && v.loaded ? D : B)],
  ["brain-door-fetch", "brain", (v, L) => (hit(L.hits, "brain-door") ? S : B)],
  ["brain-door-img", "brain", (v, L) => (hit(L.hits, "brain-door") ? S : B)],
  ["brain-door-websocket", "brain", (v, L) => (hit(L.hits, "brain-door") ? S : B)],
  ["home-brain-find-fetch", "brain", (v, L) => (L.hits.some((x) => x.who === "home-brain" && x.path.includes("q=trial") && !x.path.includes("q=trial-")) ? S : B)],
  ["home-brain-find-img", "brain", (v, L) => (hit(L.hits, "home-brain", "/api/brain/find?q=trial-img") ? S : B)],
  ["home-brain-find-websocket", "brain", (v, L) => (hit(L.hits, "home-brain", "/api/brain/find?q=trial-ws") ? S : B)],
];
// Each its own load. The judge sees the load's report and hits.
const OWN_ROWS = [
  ["top-assign", "move", [], (L) => (moved(L.report) || hit(L.hits, "outside", "/top-assign") ? S : B)],
  ["parent-assign", "move", [], (L) => (moved(L.report) || hit(L.hits, "outside", "/parent-assign") ? S : B)],
  ["open-no-click", "", [], (L) => (asked(L.report, "/open-no-click") || hit(L.hits, "outside", "/open-no-click") ? S : B)],
  ["open-click", "", ["--click-all"], (L) => (moved(L.report) || hit(L.hits, "outside", "/open-click") ? S : asked(L.report, "/open-click") ? D : B)],
  ["a-top-click", "move", ["--click-all"], (L) => (moved(L.report) || hit(L.hits, "outside", "/a-top") ? S : asked(L.report, "/a-top") ? D : B)],
  ["a-blank-click", "", ["--click-all"], (L) => (moved(L.report) || hit(L.hits, "outside", "/a-blank") ? S : asked(L.report, "/a-blank") ? D : B)],
  ["form-top-click", "move", ["--click-all"], (L) => (moved(L.report) || hit(L.hits, "outside", "/form-top") ? S : asked(L.report, "/form-top") ? D : B)],
  ["top-assign-click", "move", ["--click-all"], (L) => (moved(L.report) || hit(L.hits, "outside", "/top-assign-click") ? S : asked(L.report, "/top-assign-click") ? D : B)],
  ["download-click", "", ["--click-all"], (L) => ((L.report.panelsAsked || []).includes("save") ? D : B)],
  ["fullscreen-click", "", ["--click-all"], (L) => (L.report.results?.["fullscreen-click"]?.granted ? D : B)],
  ["pointer-lock-click", "permission", ["--click-all"], (L) => (L.report.results?.["pointer-lock-click"]?.granted ? S : B)],
  ["clipboard-read-click", "permission", ["--click-all", "--pasteboard", "plant"], (L) => (L.report.results?.["clipboard-read-click"]?.granted ? S : B)],
  ["clipboard-write-click", "", ["--click-all", "--pasteboard", "keep"], (L) => (L.report.results?.["clipboard-write-click"]?.written ? D : B)],
  ["get-display-media-click", "permission", ["--click-all"], (L) => (L.report.results?.["get-display-media-click"]?.granted ? S : B)],
];
// What each design row rests on, said once under the table.
const WHY = {
  cookie: "the frame's own cookie (allow-same-origin)",
  "local-storage": "the frame's own storage (allow-same-origin)",
  "fetch-own-origin": "the app's own origin",
  "service-worker": "registered on the app's own origin",
  "data-image": "an image the page made itself",
  "blob-image": "an image the page made itself",
  "open-click": "the guard hands it to the default browser after a click (S4)",
  "a-blank-click": "the guard hands it to the default browser after a click (S4)",
  "download-click": "allow-downloads; the owner's save panel was asked",
  "fullscreen-click": "allow=\"fullscreen\" (the film player)",
  "clipboard-write-click": "allow=\"clipboard-write\" (the trial puts the owner's clipboard back after it)",
};

async function phase(rules) {
  const rows = [];
  const loads = {};
  const auto = await load(rules, "only=auto");
  loads.auto = auto;
  for (const [id, kind, judge] of AUTO_ROWS) {
    const v = auto.report.results ? auto.report.results[id] : undefined;
    const verdict = auto.report.ready ? judge(v, auto) : S;
    rows.push({ id, kind, verdict, seen: v === undefined ? null : v });
  }
  for (const [id, kind, extra, judge] of OWN_ROWS) {
    const L = await load(rules, `only=${id}`, extra);
    loads[id] = L;
    const verdict = L.report.ready ? judge(L) : S;
    rows.push({ id, kind, verdict, seen: { result: L.report.results?.[id] ?? null, pasteboardHolds: L.report.pasteboardHolds ?? null, topUrl: L.report.topUrl, openerAsked: L.report.openerAsked, panelsAsked: L.report.panelsAsked, dropped: L.report.dropped, clicked: L.report.clicked } });
  }
  const shot = join(OUT, `astryx-frame-${rules}.png`);
  const kit = await load(rules, "kit=1", ["--astryx", "--snapshot", shot, "--settle-ms", "1500"]);
  return { rules, rows, loads, astryx: kit.report.astryx, astryxShot: shot, astryxReady: kit.report.ready, cookieSeenByHome: !!auto.report.top?.cookieSeen };
}

// ---- the run -------------------------------------------------------------------------------------------------------
async function cleanup() {
  if (child) { try { child.kill("SIGTERM"); } catch { /* ended */ } }
  await stopStandIns();
  rmSync(scratch, { recursive: true, force: true });
  dropLocks();
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await cleanup(); process.exit(130); });

let exitCode = 0;
const lines = [];
const print = (s = "") => { console.log(s); lines.push(s); };
try {
  buildRunner();
  await takeLocks();
  mkdirSync(OUT, { recursive: true });
  await startStandIns();
  print(`frames trial: home 127.0.0.1:${P.home}, app 127.0.0.1:${P.app} (standing for 3175), outside ${P.o} and ${P.pc}, brain door ${P.b} (standing for 3190), STUN udp ${P.u}`);
  print(`frame: sandbox="${SANDBOX}" allow="${ALLOW}" referrerpolicy="${REFERRER}"; home policy: ${HOME_CSP}; frame-src the app`);
  const phases = [];
  for (const rules of ["before", "after"]) phases.push(await phase(rules));
  const problems = [];
  for (const ph of phases) {
    print("");
    print(ph.rules === "before" ? "== before the rule list (the guard, the frame's sandbox and App Studio's headers) ==" : "== with the rule list ==");
    for (const r of ph.rows) {
      print(`${r.id}: ${r.verdict}`);
      if (["move", "parent", "permission", "brain"].includes(r.kind) && r.verdict !== B) problems.push(`${ph.rules}: ${r.id} is ${r.verdict}`);
      if (r.kind === "own" && ph.rules === "after" && r.verdict !== D) problems.push(`after: the app's own origin is ${r.verdict}`);
    }
    const a = ph.astryx || {};
    const drew = ph.astryxReady && a.rootChildren > 0 && a.elements > 5 && (a.errors || []).length === 0;
    print(`astryx-app-draws: ${drew ? "yes" : "NO"} (elements ${a.elements ?? 0}, height ${a.height ?? 0}, console errors ${(a.errors || []).length}; picture ${ph.astryxShot})`);
    for (const e of (a.errors || []).slice(0, 5)) print(`  console: ${e}`);
    if (ph.rules === "after" && !drew) problems.push("after: the Astryx app does not draw in its frame");
    print(`cookie set by the frame seen on the home page: ${ph.cookieSeenByHome ? "yes (cookies do not separate ports on one host)" : "no"}`);
  }
  print("");
  print("allowed-by-design rests on: " + Object.entries(WHY).map(([k, v]) => `${k}, ${v}`).join("; "));
  print("note: link rel=dns-prefetch is not tried: an address has nothing to look up, and a name lookup leaves this Mac.");
  const seen = new Map();
  for (const f of firstRequests) { const k = JSON.stringify({ ...f }); seen.set(k, (seen.get(k) || 0) + 1); }
  print("");
  print("the frame's first request, as host.mjs's browserRefusal judges it:");
  for (const [k, n] of seen) {
    const f = JSON.parse(k);
    print(`  ${f.path}: Sec-Fetch-Site=${f.secFetchSite} Sec-Fetch-Dest=${f.secFetchDest} Sec-Fetch-Mode=${f.secFetchMode} Origin=${f.origin} Referer=${f.referer} -> ${f.refusal ? `refused (${f.refusal})` : "accepted"} (${n} loads)`);
    if (f.refusal || !f.secFetchSite) problems.push(`the frame's first request: Sec-Fetch-Site ${f.secFetchSite}, ${f.refusal || "no Sec-Fetch-Site"}`);
  }
  if (!firstRequests.length) problems.push("the frame never asked for its page");
  print("");
  if (problems.length) { exitCode = 1; for (const p of problems) print(`problem: ${p}`); } else print("trial: every row for top-page movement, parent reading, a permission and the brain is blocked");
  writeFileSync(join(OUT, "frames.json"), JSON.stringify({ ports: P, sandbox: SANDBOX, allow: ALLOW, referrerpolicy: REFERRER, homePolicy: HOME_CSP, firstRequests, phases, problems }, null, 2));
  writeFileSync(join(OUT, "frames.txt"), lines.join("\n") + "\n");
} catch (e) {
  console.error(`frames trial: ${e.stack || e.message}`);
  exitCode = 1;
} finally {
  await cleanup();
}
process.exit(exitCode);
