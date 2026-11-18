// PLAN-ASTRYX T8: the page viewer with the REAL Chrome and a site that carries the Astryx kit. The site is put
// together here, as the Builder makes it: the example page (engine/astryx-kit/example/), the kit's files under
// astryx/, kit.css and astryx-theme.css written from Kit A by the home server's own functions, and a small logo.
// Proven: the page is drawn and reported with nothing blocked, missing or wider than the screen, in Kit A's colours
// and faces; the hostile Astryx page reaches nothing; the wait for a drawn page (D9) runs out at about 2 seconds
// and is said; 50 roots cost nothing extra; a site with no root renders as before. Skipped, saying why, when Chrome
// is not installed. Nothing reaches the internet: the canary listens on this Mac and every port is 0. Only
// processes this file started are ended, by their group id.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken } from "../../relay/token.mjs";
import { CHROME_PATH, chromeInstalled, defaultLaunch, readPs, groupOf } from "../chrome.mjs";
import { collectSite } from "../sitefiles.mjs";
import { writeTar } from "../tar.mjs";
import { createViewer } from "../viewer.mjs";
import { astryxThemeCss, checkKit, emptyKit, kitCss, loadAstryxTokens } from "../../home/server/brain/kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..", "..", "astryx-kit");
const SECRET = "8".repeat(64);
const HAVE = chromeInstalled(CHROME_PATH);
const skip = HAVE ? false : `Chrome is not installed at ${CHROME_PATH}`;

// Kit A of PLAN-ASTRYX T3, with two faces this Mac has: Didot for headings, Avenir Next for the rest.
const ENV = { families: new Set(["Didot", "Avenir Next"]), fonts: new Set(), brandPictures: new Set(), referencePictures: new Set() };
function kitA() {
  const k = emptyKit(["Didot"]);
  k.name = "Harbour";
  k.colours = [
    { name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sun", hex: "#E0A100", role: "accent" },
    { name: "paper", hex: "#FAF7F2", role: "background" }, { name: "night", hex: "#0B1D2E", role: "text" },
  ];
  k.type.body = { family: "Avenir Next", file: null, fallback: "sans-serif" };
  k.neutrals = true;
  k.layout.radiusPx = 6;
  k.type.minPx = 16;
  return checkKit(k, ENV);
}

let dir; let paths; const hits = []; let canary; let canaryPort;
const launched = [];
let lines = [];

function launch(program, args, env) {
  const out = defaultLaunch(program, args, env);
  launched.push(out.child.pid);
  return out;
}
function viewer(limits = {}, testing) {
  return createViewer({
    listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, log: (l) => lines.push(l),
    chrome: { path: CHROME_PATH, launch }, limits, testing,
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "viewer-astryx-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
  chmodSync(paths.ids, 0o644);
  await new Promise((resolve) => {
    canary = net.createServer((sock) => {
      hits.push("canary");
      sock.on("error", () => {});
      sock.end("HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 13\r\nConnection: close\r\n\r\nCANARY-SECRET");
    });
    canary.listen(0, "127.0.0.1", () => { canaryPort = canary.address().port; resolve(); });
  });
});
after(async () => {
  for (const g of launched) { try { process.kill(-g, "SIGKILL"); } catch { /* ended already */ } }
  if (canary) canary.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// The example Astryx site, file by file; `over` replaces or adds files by name.
function astryxSite(over = []) {
  const kit = kitA();
  const tokens = loadAstryxTokens(join(KIT, "tokens.json"));
  const files = new Map();
  for (const n of readdirSync(join(KIT, "astryx")).sort()) files.set(`astryx/${n}`, readFileSync(join(KIT, "astryx", n)));
  for (const n of readdirSync(join(KIT, "example")).sort()) files.set(n, readFileSync(join(KIT, "example", n)));
  files.set("kit.css", Buffer.from(kitCss(kit)));
  files.set("astryx-theme.css", Buffer.from(astryxThemeCss(kit, tokens)));
  files.set("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="64" height="32" fill="#1A3C5E"/></svg>'));
  for (const f of over) files.set(f.name, f.data);
  return [...files].map(([name, data]) => ({ name, data }));
}
const page = (body) => ({ name: "index.html", data: Buffer.from(`<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>t</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`) });

const owner = () => mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600);
// One render through the viewer's door. -> { files, report, ms (the render alone), log (its line) }.
async function render(v, body) {
  const port = await v.listen();
  lines = [];
  try {
    const t0 = Date.now();
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/view/shots", agent: false,
        headers: { Authorization: `Bearer ${owner()}`, "Content-Type": "application/x-tar" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(body);
    });
    const ms = Date.now() - t0;
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
    return { files, report: JSON.parse(files["report.json"]), ms, log: lines.find((l) => / shots /.test(l)) || "" };
  } finally {
    await v.close();
  }
}
// The same archive rendered as before this task (no wait at all) and as now, in turn, twice each: -> [old, now], each
// the faster of its two (Chrome's own start varies by a second or more from one render to the next).
async function sideBySide(body) {
  const old = []; const now = [];
  for (let i = 0; i < 2; i++) {
    old.push(await render(viewer({ rootWaitMs: 0 }), body));
    now.push(await render(viewer(), body));
  }
  const fastest = (list) => list.reduce((a, b) => (b.ms < a.ms ? b : a));
  return [fastest(old), fastest(now)];
}
const nothingLeft = () => {
  assert.deepEqual(readdirSync(join(paths.doorWork, "view")), [], "the work folder is gone");
  let out = "";
  try { out = execFileSync("/usr/bin/pgrep", ["-f", join(paths.doorWork, "view")], { encoding: "utf8" }); } catch { out = ""; }
  assert.equal(out.trim(), "", "no Chrome of the viewer is left");
};

test("the example Astryx site: drawn, nothing blocked, missing or too wide, Kit A's colours and faces, light only", { skip, timeout: 120_000 }, async () => {
  const { files, report, log } = await render(viewer(), writeTar(astryxSite()));
  const p = report.pages[0];
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.blocked, []);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(p.wider, [], "nothing wider than the screen at 1280 or at 390");
  assert.equal(p.cut, null);
  assert.equal(p.drawn_late, false);
  assert.equal(p.dark, false);
  const pngs = Object.keys(files).filter((n) => n.endsWith(".png")).sort();
  assert.deepEqual(pngs, ["shot-index-1280-light.png", "shot-index-390-light.png"], "no dark shot");
  assert.deepEqual(p.shots.slice().sort(), pngs);
  for (const [name, w] of [["shot-index-1280-light.png", 1280], ["shot-index-390-light.png", 390]]) {
    assert.equal(files[name].readUInt32BE(0), 0x89504e47, `${name} is a PNG`);
    assert.equal(files[name].readUInt32BE(16), w, `${name} is ${w} wide`);
  }
  assert.ok(p.colours.includes("#E0A100"), `the accent: ${p.colours.join(", ")}`);
  assert.ok(p.colours.includes("#FAF7F2"), `the ground: ${p.colours.join(", ")}`);
  const families = new Set(p.fonts.map((f) => f.family));
  assert.ok(families.size > 0);
  for (const f of families) assert.ok(["Didot", "Avenir Next"].includes(f), `a face not the kit's: ${[...families].join(", ")}`);
  assert.ok(families.has("Didot") && families.has("Avenir Next"), [...families].join(", "));
  assert.match(log, / shots owner pages=1 shots=2 /, log);
  nothingLeft();
  // The proxy's record of the page: the same site served with no content policy (tests only), so anything the page
  // asked of another host would reach the proxy and be listed. It asked for nothing but the site's own.
  const bare = await render(viewer({}, { sitePolicy: false }), writeTar(astryxSite()));
  assert.deepEqual(bare.report.pages[0].blocked, []);
  assert.deepEqual(bare.report.pages[0].errors, []);
  assert.equal(bare.report.pages[0].drawn_late, false);
  nothingLeft();
});

test("the hostile Astryx page: esm.sh, Google's fonts, a worker and a beacon are all refused; the canary is never reached", { skip, timeout: 120_000 }, async () => {
  const before = hits.length;
  const hostile = { name: "app.js", data: readFileSync(join(HERE, "sites", "astryx-hostile", "app.js")) };
  const ports = { name: "ports.json", data: Buffer.from(JSON.stringify({ canary: canaryPort })) };
  const { report } = await render(viewer(), writeTar(astryxSite([hostile, ports])));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(hits.slice(before), [], "the canary was reached");
  const p = report.pages[0];
  assert.equal(p.cut, null, "the page is still reported");
  assert.equal(p.shots.length, 2);
  assert.equal(p.drawn_late, false, "the hostile page still draws itself");
  const refused = (host) => p.blocked.some((b) => b.startsWith(host)) || p.errors.some((e) => e.includes(host) && /Content Security Policy/i.test(e));
  for (const host of ["esm.sh", "fonts.googleapis.com", `127.0.0.1:${canaryPort}`]) assert.ok(refused(host), `${host}: blocked ${p.blocked.join(", ")} | errors ${p.errors.join(" | ")}`);
  assert.ok(p.errors.some((e) => /worker/i.test(e) && /Content Security Policy/i.test(e)), `the worker: ${p.errors.join(" | ")}`);
  nothingLeft();
});

test("a root that never gets a child: shot after about 2 seconds, drawn_late, not cut; the next render works", { skip, timeout: 120_000 }, async () => {
  const never = writeTar([page("<header><h1>Never drawn</h1></header>\n<main data-astryx-root></main>")]);
  const quick = await render(viewer({ rootWaitMs: 0 }), never);
  const slow = await render(viewer(), never);
  const p = slow.report.pages[0];
  assert.equal(p.drawn_late, true);
  assert.equal(p.cut, null);
  assert.equal(p.shots.length, 2);
  assert.equal(quick.report.pages[0].drawn_late, false, "no wait, nothing said");
  // drawn_late says the wait ran its 2 seconds (the page's own clock); one wait for the page, not one for each of
  // its four openings (that would add 8 seconds). Chrome's own start varies by a second or more, so the bound is wide.
  assert.ok(slow.ms >= 2000, `${slow.ms}`);
  assert.ok(slow.ms - quick.ms < 4000, `${slow.ms} against ${quick.ms}`);
  nothingLeft();
  const next = await render(viewer(), writeTar(astryxSite()));
  assert.equal(next.report.pages[0].drawn_late, false);
  assert.equal(next.report.pages[0].shots.length, 2);
  nothingLeft();
});

test("a page with 50 roots: only the first is looked at, and it costs no extra time", { skip, timeout: 120_000 }, async () => {
  const roots = ['<main data-astryx-root><p>drawn</p></main>', ...Array.from({ length: 49 }, () => "<div data-astryx-root></div>")].join("\n");
  const fifty = writeTar([page(roots)]);
  const [base, now] = await sideBySide(fifty);
  assert.equal(now.report.pages[0].drawn_late, false);
  assert.equal(now.report.pages[0].cut, null);
  assert.ok(now.ms < base.ms + 500, `${now.ms} against ${base.ms}`);
  nothingLeft();
});

test("the plain site, with no root: the same report as with no wait, and no added time", { skip, timeout: 120_000 }, async () => {
  const s = collectSite(join(HERE, "sites", "plain"));
  assert.equal(s.ok, true, s.reason);
  const body = writeTar(s.files);
  const [old, now] = await sideBySide(body);
  assert.equal(now.report.pages[0].drawn_late, false);
  // the same report (Chrome's console lines may come in either order)
  const same = (r) => r.pages.map((x) => ({ ...x, errors: [...x.errors].sort() }));
  assert.deepEqual(same(now.report), same(old.report));
  assert.ok(now.ms < old.ms + 500, `${now.ms} against ${old.ms}`);
  nothingLeft();
});

test("after every render: no Chrome this file started is left, and no throwaway folder", { skip }, async () => {
  const rows = await readPs();
  for (const g of launched) assert.equal(groupOf(rows, g).members.length, 0, `group ${g} still runs`);
  nothingLeft();
});
