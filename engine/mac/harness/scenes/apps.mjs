// App Studio (shots S07, S08, S08b, S08c, S08d and B06), written anew from the cook harness's scenes/apps.mjs for one
// reason: that scene puts its stand-in app on the first free port from 3172 to 3189, and PLAN-MAC-2 rule 3 keeps every
// port from 3100 to 3299 unbound. Here the stand-in app listens on the first free port from 3300 up.
// Consequence: App Studio's own page (pages/app.js) makes no frame for a port outside 3171 to 3189 and shows its
// sentence "This app's port is not one App Studio opens, so it is not shown here." instead (and the app's web view
// would drop such a frame too). The pictures show the bars, the notice line and that sentence where the frame goes;
// what the app's page draws inside an allowed frame needs a port from 3171 to 3189, which only the orchestrator can
// allow, and is M8's trial.
// As in the cook scene: a stub home on the V2 seed behind a small front that answers /api/apps from a scene (so every
// state of App Studio can be shown) and rewrites the home's frame-src to the stand-in's port.
// B06 ("astryx-app"): the stand-in is an app built on the Astryx kit (ADR 0019, decision 10): the kit's files copied
// from engine/astryx-kit/astryx/, the kit's example page imported by relative path (no import map), every answer
// carrying App Studio's own headers (engine/apps/host.mjs securityHeaders), as engine/apps/test/astryx-real.test.mjs
// serves it.
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { freePort, imp, kept } from "./_lib.mjs";

const clone = (v) => JSON.parse(JSON.stringify(v));
const CHOICES = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "gpt-5-2", name: "GPT-5.2" },
];
const closed = { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: "This app cannot spend anything right now.", limitLeft: 2880, limitWords: "What is left of today's limit: $28.80." };
const open = { open: true, budget: 500, spent: 120, left: 380, expiresAt: "2026-11-14T18:30:00.000Z", words: "Allowed today: $5.00. Spent: $1.20.", limitLeft: 2880, limitWords: "What is left of today's limit: $28.80." };
const SENT = { off: "Off", starting: "Starting…", on: "On", failed: "Stopped. It could not start.", not_installed: "Not ready yet.", damaged: "This app's description is damaged." };
const hostOn = { state: "on", sentence: "App Studio is on." };
const view = (apps, more = {}) => ({ host: hostOn, apps, sites: [], problem: null, problemSentence: null, ...more });
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#3a3f4a"/><rect x="18" y="18" width="28" height="28" rx="6" fill="#c9ced8"/></svg>';

const PLAIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Render to Film (stand-in)</title><style>:root{color-scheme:light dark}html,body{margin:0;height:100%;font:14px/1.45 -apple-system,system-ui,sans-serif;background:#fbfaf7;color:#1e1b18}
main{padding:28px}h1{font-size:28px;font-weight:500}</style></head><body><main><h1>Turn a render into a film still</h1>
<p>A stand-in page for the pictures.</p></main></body></html>`;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

// The Astryx app's files: the kit as it is, the example page with its import map taken out and its bare names made
// relative (an inline import map is refused under App Studio's policy, ADR 0019 finding 12).
function astryxFiles(engine) {
  const kit = join(engine, "astryx-kit", "astryx");
  const example = join(engine, "astryx-kit", "example");
  const files = new Map();
  for (const name of readdirSync(kit)) files.set(`/astryx/${name}`, readFileSync(join(kit, name)));
  const html = readFileSync(join(example, "index.html"), "utf8")
    .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, "")
    .replace(/<link rel="stylesheet" href="(kit|astryx-theme)\.css">\n?/g, "")
    .replace(/<header class="page-header">[\s\S]*?<\/header>\n?/, "");
  const names = { react: "./astryx/react.js", "react-dom/client": "./astryx/react-dom-client.js", "@astryxdesign/core": "./astryx/core.js", "@astryxdesign/theme-neutral": "./astryx/theme-neutral.js" };
  const js = readFileSync(join(example, "app.js"), "utf8").replace(/from '([^']+)'/g, (m, n) => (names[n] ? `from '${names[n]}'` : m));
  files.set("/", Buffer.from(html)); files.set("/index.html", Buffer.from(html));
  files.set("/app.js", Buffer.from(js));
  files.set("/style.css", readFileSync(join(example, "style.css")));
  return files;
}

export async function start({ engine }) {
  const I = imp(engine);
  const seeds = await I("test/stubs/seed.mjs");
  const { startOnV2Seed } = await I("home/server/lib/testing-v2.mjs");
  const { securityHeaders } = await I("apps/host.mjs");
  const SHAPE = JSON.parse(readFileSync(join(engine, "home/server/test/shapes/apps.json"), "utf8"));
  const ASTRYX = astryxFiles(engine);
  const h = await startOnV2Seed(seeds, { port: 0, log: () => {} });
  const stubPort = h.port;
  const appPort = await freePort(3300);
  if (!appPort || kept(appPort)) { await h.close(); throw new Error("no free port from 3300 up for the stand-in app"); }

  const BASE = SHAPE.apps[0];
  function rtf(state, on, extra = {}) {
    const a = clone(BASE);
    a.state = state; a.sentence = SENT[state]; a.on = on; a.port = appPort;
    a.spending = clone(closed);
    a.thinks = { model: "claude-opus-5-5", name: "Claude Opus 5.5", choices: CHOICES };
    return Object.assign(a, extra);
  }
  const SCENES = {
    off: () => view([rtf("off", false)]),
    on: () => view([rtf("on", true, { spending: clone(open) })]),
    "on-nospend": () => view([rtf("on", true)]),
    astryx: () => view([rtf("on", true, { spending: clone(open), name: "Room Planner", about: "Plan a room's furniture on its drawing. Built on the Astryx kit." })]),
    mixed: () => view([
      rtf("on", true, { spending: clone(open) }),
      rtf("starting", true, { slug: "storyboard", name: "Storyboard", about: "Lay out a film's shots as cards before anything is made.", icon: "/api/apps/storyboard/icon" }),
      rtf("failed", true, { slug: "colour-room", name: "Colour Room", about: "Grade a clip with your own looks.", icon: "/api/apps/colour-room/icon", thinks: null }),
      rtf("off", false, { slug: "site-check", name: "Site Check", about: "Look over a site the team built, page by page.", icon: "/api/apps/site-check/icon" }),
      rtf("not_installed", false, { slug: "type-lab", name: "Type Lab", about: "Try type pairings on your own words.", icon: "/api/apps/type-lab/icon" }),
      rtf("damaged", false, { slug: "broken-app", name: "broken-app", about: "", port: null, icon: null }),
    ], { problem: "apps_state_unreadable", problemSentence: "Your app switches could not be read, so every app is off. Turning an app on or off writes them again." }),
  };
  const OF = { "list-every-state": "mixed", "app-on": "on", "app-off": "off", sheet: "on-nospend", "app-on-nospend": "on-nospend", "astryx-app": "astryx" };
  let current = SCENES.off();
  let astryxOn = false;

  function answerApps(req, res, url) {
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true; };
    if (req.method === "GET" && url.pathname === "/api/apps") return send(200, current);
    const m = /^\/api\/apps\/([a-z0-9-]+)\/(switch|allowance|allowance\/stop|thinks)$/.exec(url.pathname);
    if (req.method !== "POST" || !m) return null;
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let b = {};
      try { b = body ? JSON.parse(body) : {}; } catch { return send(400, { error: { message: "Not JSON.", code: "bad_json" } }); }
      const app = current.apps.find((a) => a.slug === m[1]);
      if (!app) return send(404, { error: { message: "App Studio has no app by that name.", next: "Open App Studio again.", code: "no_app" } });
      if (m[2] === "switch") { app.on = b.on; app.state = b.on ? "on" : "off"; app.sentence = SENT[app.state]; }
      else if (m[2] === "allowance") app.spending = { ...clone(open), budget: b.cents, spent: 0, left: b.cents, words: `Allowed today: $${(Number(b.cents) / 100).toFixed(2)}. Spent: $0.00.` };
      else if (m[2] === "allowance/stop") app.spending = clone(closed);
      else if (m[2] === "thinks") { const c = app.thinks.choices.find((x) => x.id === b.model); if (c) { app.thinks.model = c.id; app.thinks.name = c.name; } }
      return send(200, current);
    });
    return true;
  }

  const front = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const im = /^\/api\/apps\/([a-z0-9-]+)\/icon$/.exec(url.pathname);
    if (im && im[1] !== "render-to-film") { res.writeHead(200, { "content-type": "image/svg+xml" }); return res.end(ICON); }
    if (url.pathname.startsWith("/api/apps") && !/\/icon$/.test(url.pathname)) { if (answerApps(req, res, url)) return; }
    const headers = { ...req.headers, host: `127.0.0.1:${stubPort}` };
    if (headers.origin) headers.origin = `http://127.0.0.1:${stubPort}`;
    const up = http.request({ host: "127.0.0.1", port: stubPort, method: req.method, path: req.url, headers }, (r) => {
      const out = { ...r.headers };
      const csp = out["content-security-policy"];
      if (csp) {
        const parts = String(csp).split(";").map((x) => x.trim()).filter((x) => x && !x.startsWith("frame-src"));
        out["content-security-policy"] = [...parts, `frame-src http://127.0.0.1:${appPort}`].join("; ");
      }
      res.writeHead(r.statusCode, out);
      r.pipe(res);
    });
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  await new Promise((r) => front.listen(0, "127.0.0.1", r));
  const homePort = front.address().port;
  const app = http.createServer((req, res) => {
    req.resume();
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (!astryxOn) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...securityHeaders(homePort) });
      return res.end(PLAIN_PAGE);
    }
    const body = ASTRYX.get(path);
    res.writeHead(body ? 200 : 404, { "content-type": body ? (TYPES[extname(path)] || TYPES[".html"]) : "text/plain; charset=utf-8", ...securityHeaders(homePort) });
    res.end(body || "not found\n");
  });
  await new Promise((r) => app.listen(appPort, "127.0.0.1", r));

  return {
    base: `http://127.0.0.1:${homePort}`,
    appBase: `http://127.0.0.1:${appPort}`,
    prepare(state) { current = SCENES[OF[state] || "off"](); astryxOn = state === "astryx-app"; },
    async stop() {
      front.closeAllConnections?.(); app.closeAllConnections?.();
      await new Promise((r) => front.close(r)); await new Promise((r) => app.close(r));
      await h.close();
    },
  };
}

export const states = {
  "list-every-state": { address: "#/apps" },
  "app-on": { address: "#/apps/render-to-film" },
  "app-off": { address: "#/apps/render-to-film" },
  "app-on-nospend": { address: "#/apps/render-to-film" },
  sheet: { address: "#/apps/render-to-film", steps: [["click", ".p-app__spend button", "Allow spending"], ["quiet", 2000]] },
  "astryx-app": { address: "#/apps/render-to-film" },
};
