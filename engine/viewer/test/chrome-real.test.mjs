// The page viewer with the REAL Chrome (PLAN-V5 K15, corrections after p2): the walls against
// a hostile page of our own, true widths, dark only when asked, the report, the time limit,
// the memory watchdog, and nothing left behind. One render at a time, all in this one file.
// Skipped, saying why, when Chrome is not installed. Nothing reaches the internet: every
// canary listens on this Mac, the page's internet name can never resolve, and Chrome is
// pointed at the viewer's own proxy, which refuses it. Only processes this file started are
// ended, by their group id.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken } from "../../relay/token.mjs";
import { CHROME_PATH, chromeInstalled, defaultLaunch, readPs, groupOf } from "../chrome.mjs";
import { collectSite } from "../sitefiles.mjs";
import { writeTar } from "../tar.mjs";
import { createViewer } from "../viewer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = "9".repeat(64);
const HAVE = chromeInstalled(CHROME_PATH);
const skip = HAVE ? false : `Chrome is not installed at ${CHROME_PATH}`;
const GB = 1024 * 1024;

let dir; let paths; const hits = []; const datagrams = []; const canaries = []; let A; let B; let U; let U2;
let launched = [];       // group ids of every Chrome this file started
let watchedCmds = [];    // the command lines of the group while a render runs
let watching = null;

// The real launcher, with every group id kept so the test can look at it and end it.
function launch(program, args, env) {
  const out = defaultLaunch(program, args, env);
  launched.push(out.child.pid);
  watching = setInterval(async () => {
    const rows = await readPs();
    if (rows) for (const r of groupOf(rows, out.child.pid).members) watchedCmds.push(r.cmd);
  }, 400);
  out.child.on("exit", () => clearInterval(watching));
  return out;
}

function viewer(limits = {}, testing) {
  return createViewer({
    listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, log: () => {},
    chrome: { path: CHROME_PATH, launch }, limits, testing,
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "viewer-chrome-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
  chmodSync(paths.ids, 0o644);
  const tcp = (name, host, port = 0) => new Promise((resolve) => {
    const s = net.createServer((sock) => {
      hits.push(name);
      sock.on("error", () => {});
      sock.end("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 13\r\nConnection: close\r\n\r\nCANARY-SECRET");
    });
    s.on("error", () => resolve(null));
    s.listen(port, host, () => { canaries.push(s); resolve(s.address().port); });
  });
  A = await tcp("A", "127.0.0.1");
  B = await tcp("B", "127.0.0.1");
  await tcp("B6", "::1", B);
  for (const name of ["U", "U2"]) {
    const u = dgram.createSocket("udp4");
    u.on("message", () => datagrams.push(name));
    await new Promise((r) => u.bind(0, "127.0.0.1", r));
    canaries.push(u);
    if (name === "U") U = u.address().port; else U2 = u.address().port;
  }
});
after(async () => {
  clearInterval(watching);
  for (const g of launched) { try { process.kill(-g, "SIGKILL"); } catch { /* ended already */ } }
  for (const c of canaries) c.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const owner = () => mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600);
function siteTar(name, extra = []) {
  const s = collectSite(join(HERE, "sites", name));
  assert.equal(s.ok, true, s.reason);
  return writeTar([...s.files, ...extra]);
}
const portsFile = () => ({ name: "ports.json", data: Buffer.from(JSON.stringify({ A, B, U, U2 })) });
async function render(v, body, query = "") {
  const port = await v.listen();
  try {
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: `/view/shots${query}`, agent: false,
        headers: { Authorization: `Bearer ${owner()}`, "Content-Type": "application/x-tar" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(body);
    });
    assert.equal(r.status, 200, r.raw.toString().slice(0, 300));
    const files = {};
    let off = 0;
    while (off + 512 <= r.raw.length) {
      const n = r.raw.subarray(off, off + 100).toString("latin1").replace(/\0.*$/s, "");
      if (!n) break;
      const size = parseInt(r.raw.subarray(off + 124, off + 136).toString("latin1"), 8);
      files[n] = r.raw.subarray(off + 512, off + 512 + size);
      off += 512 + Math.ceil(size / 512) * 512;
    }
    return { files, report: JSON.parse(files["report.json"]) };
  } finally {
    await v.close();
  }
}
const nothingLeft = () => {
  assert.deepEqual(readdirSync(join(paths.doorWork, "view")), [], "the work folder is gone");
  let out = "";
  try { out = execFileSync("/usr/bin/pgrep", ["-f", join(paths.doorWork, "view")], { encoding: "utf8" }); } catch { out = ""; }
  assert.equal(out.trim(), "", "no Chrome of the viewer is left");
};

test("the hostile page, with no content policy (the walls bare): no canary sees anything, every way is in blocked, Chrome's sandbox is on", { skip, timeout: 150_000 }, async () => {
  watchedCmds = [];
  const before = { hits: hits.length, udp: datagrams.length };
  const { report } = await render(viewer({}, { sitePolicy: false }), siteTar("hostile", [portsFile()]), "?pages=index.html,nav-location.html,nav-meta.html");
  assert.deepEqual(hits.slice(before.hits), [], "a TCP canary was reached");
  assert.deepEqual(datagrams.slice(before.udp), [], "a UDP canary was reached");
  const [page, loc, meta] = report.pages;
  for (const want of [`127.0.0.1:${A}`, `canary.localhost:${B}`, `localhost:${B}`, "uuu-outside.example:80", "uuu-outside.example:443"]) {
    assert.ok(page.blocked.includes(want), `${want} not in blocked: ${page.blocked.join(", ")}`);
  }
  assert.equal(page.shots.length, 2, "1280 and 390, light only");
  for (const p of [loc, meta]) {
    assert.ok(p.blocked.includes(`127.0.0.1:${A}`), `${p.page}: ${p.blocked}`);
    assert.ok(p.errors.some((e) => /moved away/.test(e)), `${p.page}: ${p.errors}`);
  }
  // Chrome's own sandbox: every renderer was started as a sandboxed client
  const renderers = watchedCmds.filter((c) => /--type=renderer/.test(c));
  assert.ok(renderers.length > 0, "renderers were seen");
  assert.ok(renderers.every((c) => /--seatbelt-client=/.test(c)), "a renderer ran without Chrome's sandbox");
  nothingLeft();
});

test("the hostile page's other ways of moving away, and the page as the viewer serves it (with its content policy)", { skip, timeout: 150_000 }, async () => {
  const before = { hits: hits.length, udp: datagrams.length };
  const { report } = await render(viewer(), siteTar("hostile", [portsFile()]), "?pages=index.html,nav-form.html,nav-open.html");
  assert.deepEqual(hits.slice(before.hits), []);
  assert.deepEqual(datagrams.slice(before.udp), []);
  assert.ok(report.pages[0].blocked.length > 0, "the refusals are listed");
  assert.ok(report.pages[0].blocked.includes(`127.0.0.1:${A}`), report.pages[0].blocked.join(", "));
  nothingLeft();
});

test("a plain site: true widths, dark because its CSS asks, and the report finds what was planted", { skip, timeout: 120_000 }, async () => {
  const { files, report } = await render(viewer(), siteTar("plain"));
  const pngs = Object.keys(files).filter((n) => n.endsWith(".png")).sort();
  assert.deepEqual(pngs, ["shot-index-1280-dark.png", "shot-index-1280-light.png", "shot-index-390-dark.png", "shot-index-390-light.png"]);
  assert.equal(files["shot-index-1280-light.png"].readUInt32BE(16), 1280);
  assert.equal(files["shot-index-390-dark.png"].readUInt32BE(16), 390, "a true 390, not zoomed out");
  assert.ok(files["shot-index-390-light.png"].readUInt32BE(20) > 2600, "the full page");
  assert.ok(files["shot-index-390-light.png"].readUInt32BE(20) <= 6000, "cut at 6000 px");
  const p = report.pages[0];
  assert.match(report.chrome, /Chrome\/\d+/);
  assert.equal(p.dark, true);
  assert.ok(p.errors.includes("planted console error"), p.errors.join(" | "));
  assert.ok(p.wider.some((w) => w.cls === "wide" && w.width === 1500 && w.at === 390));
  assert.ok(p.missing.includes("img/missing.png"), p.missing.join(","));
  assert.ok(p.contrast.some((c) => c.fg === "#A9A9A9" && c.bg === "#BBBBBB" && c.ratio < 1.5));
  assert.ok(p.fonts.some((f) => f.family === "Georgia" && f.minPx === 10));
  assert.ok(p.colours.includes("#B5562F") && p.colours.includes("#E08A5F"));
  assert.ok(p.drawn.includes("Georgia"));
  assert.deepEqual(p.a11y, { noAlt: 1, noLabel: 1, noLang: false, noTitle: false, headingSkips: 1, smallTargets: 1 });
  assert.equal(p.cut, null);
  nothingLeft();
});

test("a light-only site gets no dark shots", { skip, timeout: 120_000 }, async () => {
  const { files, report } = await render(viewer(), siteTar("light"));
  assert.deepEqual(Object.keys(files).filter((n) => n.endsWith(".png")).sort(), ["shot-index-1280-light.png", "shot-index-390-light.png"]);
  assert.equal(report.pages[0].dark, false);
  nothingLeft();
});

test("a page that never finishes loading is cut at its time, and the next render still works", { skip, timeout: 150_000 }, async () => {
  const t0 = Date.now();
  const { report } = await render(viewer({ pageMs: 6000 }), siteTar("loop"));
  assert.equal(report.pages[0].cut, "time");
  assert.ok(Date.now() - t0 < 60_000);
  nothingLeft();
  const next = await render(viewer(), siteTar("light"));
  assert.equal(next.report.pages[0].shots.length, 2);
  nothingLeft();
});

test("a page that eats memory: the watchdog ends the whole group at its cap", { skip, timeout: 150_000 }, async () => {
  // the cap lowered for the test, so the Mac is never pushed near 2 GB of extra memory
  const { report } = await render(viewer({ chrome: { memCapKb: 1.5 * GB } }), siteTar("memory"));
  assert.equal(report.pages[0].cut, "memory", JSON.stringify(report.pages[0]));
  assert.ok(report.pages[0].errors.some((e) => /memory/.test(e)));
  nothingLeft();
});

test("after every render: no Chrome this file started is left, and no throwaway folder", { skip }, async () => {
  const rows = await readPs();
  for (const g of launched) assert.equal(groupOf(rows, g).members.length, 0, `group ${g} still runs`);
  nothingLeft();
});
