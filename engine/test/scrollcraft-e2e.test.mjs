// PLAN-ASTRYX T13: scroll-craft as the Builder's scroll layer, end to end. The kits are installed into a state
// folder of this test's own and two sites are put together from the INSTALLED copies only, the way the Builder's
// block in roles/builder.md says: an Astryx page with scroll-craft (engine/scrollcraft-kit/example) and a page of
// the plain site kit with scroll-craft (engine/scrollcraft-kit/example-plain). Proven for both:
//   - the installed brand check passes them;
//   - the page viewer (its own code, the REAL Chrome, port 0) renders them with nothing blocked, missing, wider than
//     the screen or cut, in both of its passes (less motion asked, for the pictures; no preference, measured);
//   - the home server's judge of drawn pages (sitebrand.mjs, judgePage) finds no fail and nothing unknown, for a kit
//     with greys (Kit A) and one without (Kit B);
//   - in Chrome under the viewer's exact site headers: with less motion asked every word of the page is shown at once,
//     unmoved and not over another; with no preference scroll-craft is mounted, pins, and every word reaches full
//     view on the screen at some point of the scroll.
// The old site kit is byte for byte build/v5-cook's. The art installer is not run (it fetches a Python with uv; tests
// never download): its copy step is done here from its own lists. Nothing reaches the internet: every port is 0 and
// the viewer's proxy passes only the site. Only processes this file started are ended, by their group id.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { crc32, deflateSync } from "node:zlib";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken } from "../relay/token.mjs";
import { CHROME_PATH, chromeInstalled, defaultLaunch, groupOf, prepareRoot, readPs, startChrome } from "../viewer/chrome.mjs";
import { startProxy } from "../viewer/proxy.mjs";
import { siteHandler } from "../viewer/sitefiles.mjs";
import { writeTar } from "../viewer/tar.mjs";
import { createViewer } from "../viewer/viewer.mjs";
import { astryxThemeCss, checkKit, emptyKit, ensureAstryxTheme, kitCss, loadAstryxTokens } from "../home/server/brain/kit.mjs";
import { judgePage, measuredKit } from "../home/server/lib/sitebrand.mjs";
import { readShotsTar } from "../home/server/lib/siteshots.mjs";
import { verify as verifyLock } from "../scrollcraft-kit/lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..");
const REPO = join(ENGINE, "..");
const BASE = "build/v5-cook";
const SITE_KIT_FILES = ["reset.css", "layout.css", "reveal.js", "gallery.js", "README.md"];

const PYTHONS = ["/opt/homebrew/opt/python@3.14/bin/python3.14", "/usr/local/bin/python3", "/opt/homebrew/opt/python@3.11/bin/python3.11", "/usr/bin/python3"];
const PYTHON = PYTHONS.find((p) => existsSync(p) && spawnSync(p, ["-I", "-c", "import PIL.Image"], { stdio: "ignore" }).status === 0) || null;
const noPython = PYTHON ? false : `no Python with Pillow on this Mac (${PYTHONS.join(", ")}), and the brand check needs it`;
const baseOk = spawnSync("/usr/bin/git", ["-C", REPO, "rev-parse", "--verify", "--quiet", `${BASE}^{commit}`], { stdio: "ignore" }).status === 0;
const noBase = baseOk ? false : `the branch ${BASE} is not in this repo, so there is nothing to compare with`;
const HAVE_CHROME = chromeInstalled(CHROME_PATH);
const noChrome = HAVE_CHROME ? false : `Chrome is not installed at ${CHROME_PATH}`;
const git = (...args) => execFileSync("/usr/bin/git", ["-C", REPO, ...args], { maxBuffer: 64 * 1024 * 1024 });

let root; let state; let brand; let tools; let playbooks; let install;
const launched = [];
function launch(program, args, env) {
  const out = defaultLaunch(program, args, env);
  launched.push(out.child.pid);
  return out;
}

// A whole PNG made here (no picture library): every pixel `at(x, y)` -> [r, g, b, a].
function png(w, h, at) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0, ...Array.from({ length: w }, (_, x) => at(x, y)).flat()]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
const LOGO = png(96, 32, () => [0x1a, 0x3c, 0x5e, 255]);
// The hero's two planes, standing in for the owner's renders: a back plate, and a front plane solid below its edge.
const BACK = png(160, 90, (x, y) => (y < 50 ? [0x1a, 0x3c, 0x5e, 255] : [0x0b, 0x1d, 0x2e, 255]));
const FRONT = png(160, 90, (x, y) => (y > 62 + Math.round(8 * Math.sin(x / 12)) ? [0xfa, 0xf7, 0xf2, 255] : [0, 0, 0, 0]));

// Kit A of PLAN-ASTRYX T3 (Didot and Avenir Next are on this Mac); Kit B is the same with greys refused.
const ENV = { families: new Set(["Didot", "Avenir Next"]), fonts: new Set(), brandPictures: new Set(["logo.png"]), referencePictures: new Set() };
function brandKit(neutrals = true) {
  const k = emptyKit(["Didot"]);
  k.name = "Harbour";
  k.colours = [
    { name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sun", hex: "#E0A100", role: "accent" },
    { name: "paper", hex: "#FAF7F2", role: "background" }, { name: "night", hex: "#0B1D2E", role: "text" },
  ];
  k.type.body = { family: "Avenir Next", file: null, fallback: "sans-serif" };
  k.neutrals = neutrals;
  k.layout.radiusPx = 6;
  k.type.minPx = 16;
  k.logo.files = [{ file: "logo.png", on: "light" }];
  return checkKit(k, ENV);
}
const TOKENS = loadAstryxTokens(join(ENGINE, "astryx-kit", "tokens.json"));

function listIn(text, name) {
  const m = new RegExp(`^${name}="([^"]*)"`, "m").exec(text);
  assert.ok(m, `${name} is in engine/art/install.sh`);
  return m[1].split(/\s+/).filter(Boolean);
}
function filesUnder(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(dir, r));
    else out.push(r);
  }
  return out.sort();
}

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "scrollcraft-e2e-")));
  state = join(root, "state");
  brand = join(state, "knowledge", "docs", "brand");
  mkdirSync(brand, { recursive: true });
  mkdirSync(join(state, "knowledge", "docs", "pictures"), { recursive: true });
  mkdirSync(join(state, "media", "room"), { recursive: true });
  writeFileSync(join(brand, "logo.png"), LOGO);
  const kit = brandKit();
  writeFileSync(join(brand, "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
  writeFileSync(join(brand, "kit.css"), kitCss(kit));
  assert.equal(ensureAstryxTheme({ paths: { knowledgeDocs: join(state, "knowledge", "docs"), state } }), "written");

  playbooks = join(state, "playbooks");
  mkdirSync(join(root, "no-skills"));
  install = spawnSync("/bin/bash", [join(ENGINE, "playbooks", "install.sh")], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_PLAYBOOKS_SOURCE: join(root, "no-skills"), ENGINE_PLAYBOOKS_DEST: playbooks },
  });

  const text = readFileSync(join(ENGINE, "art", "install.sh"), "utf8");
  tools = join(state, "art", "tools");
  mkdirSync(tools, { recursive: true });
  const from = (f, list) => ({ BRAND_FILES: join(ENGINE, "company", "brand", f), ASTRYX_FILES: join(ENGINE, "astryx-kit", f),
    SCROLLCRAFT_FILES: join(ENGINE, "scrollcraft-kit", f) })[list] || join(ENGINE, "art", f);
  for (const list of ["TOOL_FILES", "BRAND_FILES", "ASTRYX_FILES", "SCROLLCRAFT_FILES"]) {
    for (const f of listIn(text, list)) {
      copyFileSync(from(f, list), join(tools, f));
      chmodSync(join(tools, f), 0o644);
    }
  }
});
after(() => {
  for (const g of launched) { try { process.kill(-g, "SIGKILL"); } catch { /* ended already */ } }
  if (root) rmSync(root, { recursive: true, force: true });
});

// The Builder's copy commands, word for word from its block.
const BLOCK = readFileSync(join(ENGINE, "company", "roles", "builder.md"), "utf8").split("<!-- astryx:start -->")[1].split("<!-- astryx:end -->")[0];
function builderCopy(re, goalDir, name) {
  const cmd = re.exec(BLOCK);
  assert.ok(cmd, `the block names the copy ${re}`);
  execFileSync("/bin/sh", ["-c", cmd[1].replace("<name>", name)], { cwd: goalDir, env: { PATH: "/usr/bin:/bin", UUU_PLAYBOOKS_DIR: playbooks } });
}
const ASTRYX_CP = /`(cp -R "\$UUU_PLAYBOOKS_DIR\/astryx-kit\/astryx" site\/<name>\/astryx)`/;
const SCROLLCRAFT_CP = /`(cp -R "\$UUU_PLAYBOOKS_DIR\/scrollcraft-kit\/scrollcraft" site\/<name>\/scrollcraft)`/;

// A site as files, from the INSTALLED kits: `kind` "astryx" or "plain"; the brand's files for `kit`; the logo as
// `logo` names it.
function siteFiles(kind, kit, logo = "logo.svg") {
  const files = new Map();
  const sc = join(playbooks, "scrollcraft-kit");
  for (const f of filesUnder(join(sc, "scrollcraft"))) files.set(`scrollcraft/${f}`, readFileSync(join(sc, "scrollcraft", f)));
  const ex = join(sc, kind === "astryx" ? "example" : "example-plain");
  for (const f of filesUnder(ex)) files.set(f, readFileSync(join(ex, f)));
  if (kind === "astryx") {
    const ak = join(playbooks, "astryx-kit", "astryx");
    for (const f of filesUnder(ak)) files.set(`astryx/${f}`, readFileSync(join(ak, f)));
    files.set("astryx-theme.css", Buffer.from(astryxThemeCss(kit, TOKENS)));
  } else {
    for (const f of ["reset.css", "layout.css"]) files.set(f, readFileSync(join(playbooks, "site-kit", f)));
  }
  files.set("kit.css", Buffer.from(kitCss(kit)));
  if (logo === "logo.svg") {
    files.set("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="64" height="32" fill="#1A3C5E"/></svg>'));
  } else {
    files.set(logo, LOGO);
    files.set("index.html", Buffer.from(files.get("index.html").toString("utf8").replace('src="logo.svg"', `src="${logo}"`)));
  }
  files.set("hero-back.png", BACK);
  files.set("hero-front.png", FRONT);
  return files;
}

function brandCheck(id) {
  const r = spawnSync(PYTHON, ["-I", join(tools, "brandcheck.py"), "--json", id], { cwd: join(state, "tasks", "company-work"), encoding: "utf8", timeout: 120_000 });
  assert.equal(r.stderr, "", r.stderr);
  return { code: r.status, report: JSON.parse(r.stdout) };
}
function goal(id) {
  const g = join(state, "tasks", "company-work", id);
  mkdirSync(join(g, "site"), { recursive: true });
  return g;
}

test("the playbooks installer puts the scroll-craft kit in the state, whole, and lists it", () => {
  assert.equal(install.status, 0, install.stdout + install.stderr);
  assert.match(install.stdout, /^playbooks: scrollcraft-kit: installed, 16 files \(\d+ KB\)\.$/m);
  const lock = JSON.parse(readFileSync(join(ENGINE, "scrollcraft-kit", "scrollcraft.lock.json"), "utf8"));
  const kit = join(playbooks, "scrollcraft-kit");
  assert.deepEqual(filesUnder(join(kit, "scrollcraft")), lock.files.map((f) => f.name).sort());
  for (const f of filesUnder(join(ENGINE, "scrollcraft-kit", "scrollcraft"))) {
    assert.ok(readFileSync(join(kit, "scrollcraft", f)).equals(readFileSync(join(ENGINE, "scrollcraft-kit", "scrollcraft", f))), f);
  }
  for (const f of ["README.md", "guide/journey.md", "guide/devices.md", "guide/hero.md", "guide/motion.md", "guide/verify.md",
    "example/index.html", "example/app.js", "example/style.css", "example-plain/index.html", "example-plain/style.css"]) {
    assert.ok(lstatSync(join(kit, f)).isFile(), f);
  }
  const row = JSON.parse(readFileSync(join(playbooks, "index.json"), "utf8")).playbooks.find((r) => r.name === "scrollcraft-kit");
  assert.ok(row, "index.json lists the kit");
  assert.equal(row.scrollcraft, "75d81f7");
  assert.equal(row.origin, "third-party");
  assert.deepEqual(row.roles, ["builder", "art-director"]);
  assert.ok(lstatSync(join(tools, "scrollcraft.lock.json")).isFile(), "the art installer's list copies the kit's list beside the brand check");
});

for (const kind of ["astryx", "plain"]) {
  test(`${kind}: a scroll-craft site made from the installed copies, as the Builder's block says, passes the installed brand check`, { skip: noPython }, () => {
    assert.equal(install.status, 0, install.stdout + install.stderr);
    const id = kind === "astryx" ? "STH-21" : "STH-22";
    const g = goal(id);
    const name = `scroll-${kind}`;
    const site = join(g, "site", name);
    mkdirSync(site);
    builderCopy(SCROLLCRAFT_CP, g, name);
    if (kind === "astryx") builderCopy(ASTRYX_CP, g, name);
    else for (const f of ["reset.css", "layout.css"]) copyFileSync(join(playbooks, "site-kit", f), join(site, f));
    for (const f of ["kit.css", "logo.png", ...(kind === "astryx" ? ["astryx-theme.css"] : [])]) copyFileSync(join(brand, f), join(site, f));
    const files = siteFiles(kind, brandKit(), "logo.png");
    for (const [n, data] of files) {
      if (n.startsWith("astryx/") || n.startsWith("scrollcraft/") || ["kit.css", "astryx-theme.css", "reset.css", "layout.css", "logo.png"].includes(n)) continue;
      writeFileSync(join(site, n), data);
    }
    // the site's scrollcraft/ is the engine's kit, file for file
    const theirs = join(ENGINE, "scrollcraft-kit", "scrollcraft");
    assert.deepEqual(filesUnder(join(site, "scrollcraft")), filesUnder(theirs));
    for (const f of filesUnder(theirs)) assert.ok(readFileSync(join(site, "scrollcraft", f)).equals(readFileSync(join(theirs, f))), f);

    const { code, report } = brandCheck(id);
    const piece = report.pieces.find((p) => p.name === name);
    assert.ok(piece, JSON.stringify(report));
    assert.deepEqual({ code, kind: piece.kind, result: piece.result, hard: piece.hard, soft: piece.soft },
      { code: 0, kind: "site", result: "pass", hard: [], soft: [] });
    assert.ok(piece.measured.words > 10, "the page's words were read");
  });
}

// The judge's kit, as measuredKit reads it from a saved kit.json.
function judgeKit(kit, name) {
  const docs = join(root, `docs-${name}`);
  mkdirSync(join(docs, "brand"), { recursive: true });
  writeFileSync(join(docs, "brand", "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
  const k = measuredKit({ paths: { knowledgeDocs: docs, state: join(root, "judge-state") } });
  assert.ok(k);
  assert.equal(k.neutrals, kit.neutrals);
  return k;
}

const SECRET = "5".repeat(64);
async function render(files) {
  const dir = mkdtempSync(join(root, "viewer-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  const paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
  const v = createViewer({ listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, log: () => {}, chrome: { path: CHROME_PATH, launch } });
  const port = await v.listen();
  try {
    const token = mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600);
    const r = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/view/shots", agent: false,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-tar" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, raw: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(writeTar([...files].map(([name, data]) => ({ name, data }))));
    });
    assert.equal(r.status, 200, r.raw.toString().slice(0, 300));
    const kept = readShotsTar(r.raw);
    assert.equal(kept.ok, true, kept.reason);
    return { pages: kept.report.pages, shots: kept.shots.map((s) => s.name).sort() };
  } finally {
    await v.close();
  }
}

for (const kind of ["astryx", "plain"]) {
  for (const [label, neutrals] of [["Kit A (greys allowed)", true], ["Kit B (greys refused)", false]]) {
    test(`${kind}: the page viewer renders the scroll-craft example in both passes and the home server's judge passes it: ${label}`,
      { skip: noChrome, timeout: 180_000 }, async () => {
        assert.equal(install.status, 0, install.stdout + install.stderr);
        const kit = brandKit(neutrals);
        const k = judgeKit(kit, `${kind}-${neutrals ? "a" : "b"}`);
        const { pages, shots } = await render(siteFiles(kind, kit));
        assert.deepEqual(shots, ["shot-index-1280-light.png", "shot-index-390-light.png"]);
        assert.equal(pages.length, 1);
        const p = pages[0];
        assert.deepEqual({ errors: p.errors, blocked: p.blocked, missing: p.missing, wider: p.wider, cut: p.cut, dark: p.dark },
          { errors: [], blocked: [], missing: [], wider: [], cut: null, dark: false });
        assert.notEqual(p.drawn_late, true);
        assert.ok(p.colours.length > 0 && p.fonts.length > 0, "nothing was measured");
        const j = judgePage(p, k);
        assert.deepEqual(j.fail, [], `colours ${p.colours.join(", ")}; faces ${JSON.stringify(p.fonts)}`);
        assert.deepEqual(j.unknown, []);
        assert.ok(p.colours.includes("#FAF7F2"), `the kit's ground is drawn: ${p.colours.join(", ")}`);
      });
  }
}

// ---- in Chrome, under the viewer's exact site headers: every part with less motion asked, and the moving page.

// Every element with words of its own -> { key, opacity (its own times every ancestor's), shown (on the screen now),
// moved (a transform on it or an ancestor), box }.
const MEASURE = `(() => {
  const out = [];
  for (const e of document.body.querySelectorAll("*")) {
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\\s+/g, " ").trim();
    if (!own || e.closest("script, style, head")) continue;
    let op = 1, moved = false;
    for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden") op = 0;
      op *= parseFloat(cs.opacity);
      if ((cs.transform !== "none" && cs.transform !== "matrix(1, 0, 0, 1, 0, 0)") || (cs.translate && cs.translate !== "none")) moved = true;
    }
    const r = e.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    out.push({ key: own.slice(0, 60), opacity: Math.round(op * 1000) / 1000, shown, moved,
      box: [r.left + scrollX, r.top + scrollY, r.width, r.height].map(Math.round) });
  }
  return { ready: document.documentElement.classList.contains("sc-ready"), height: document.documentElement.scrollHeight,
    sticky: [...document.querySelectorAll("[data-sc-stage]")].map((s) => getComputedStyle(s).position), words: out };
})()`;

async function inChrome(files, fn) {
  const blocked = [];
  const server = http.createServer(siteHandler(() => files));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const proxy = await startProxy({ sitePort: port, onBlocked: (to) => blocked.push(to) });
  const croot = mkdtempSync(join(root, "chrome-"));
  chmodSync(croot, 0o700);
  prepareRoot(croot);
  const session = await startChrome({ program: CHROME_PATH, root: croot, proxyPort: proxy.port, launch });
  const send = (m, p, s, ms) => session.send(m, p, s, ms ?? 15_000);
  const pageErrors = [];
  const asked = [];
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true });
    session.on((m) => {
      if (m.sessionId !== sid) return;
      if (m.method === "Runtime.exceptionThrown") pageErrors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 200));
      if (m.method === "Network.requestWillBeSent") asked.push(String(m.params.request.url));
    });
    await send("Page.enable", {}, sid);
    await send("Runtime.enable", {}, sid);
    await send("Network.enable", {}, sid);
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };
    const open = async (width, height, motion) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sid);
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: motion }] }, sid);
      await send("Page.navigate", { url: `http://127.0.0.1:${port}/index.html` }, sid);
      const until = Date.now() + 10_000;
      for (;;) {
        const ok = await evaluate(`document.readyState === "complete" && document.documentElement.classList.contains("sc-ready")`).catch(() => false);
        if (ok || Date.now() > until) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))");
    };
    await fn({ open, evaluate });
  } finally {
    await session.end().catch(() => {});
    await proxy.close();
    await new Promise((r) => { server.closeAllConnections(); server.close(r); });
  }
  assert.deepEqual(pageErrors, [], "the page threw");
  assert.deepEqual(asked.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith("blob:") && !u.startsWith("data:")), [],
    "the page asked for an address outside the site");
}

const overlap = (a, b) => a[0] < b[0] + b[2] - 1 && b[0] < a[0] + a[2] - 1 && a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1;
const SCROLL = `(async (y) => { window.scrollTo({ top: y, behavior: "instant" }); for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => setTimeout(r, 60)); return ${MEASURE}; })`;

for (const kind of ["astryx", "plain"]) {
  test(`${kind}: with less motion asked every word is shown at once, unmoved and over no other; with none, it pins and every word reaches full view`,
    { skip: noChrome, timeout: 180_000 }, async () => {
      assert.equal(install.status, 0, install.stdout + install.stderr);
      await inChrome(siteFiles(kind, brandKit()), async ({ open, evaluate }) => {
        for (const [w, h] of [[1280, 900], [390, 844]]) {
          // less motion: the whole page as the viewer pictures it
          await open(w, h, "reduce");
          const still = await evaluate(MEASURE);
          assert.equal(still.ready, true, "scroll-craft is mounted");
          assert.ok(still.words.length >= 10, `${w}: words found ${still.words.length}`);
          const hidden = still.words.filter((x) => x.opacity < 0.99 || x.box[2] === 0).map((x) => x.key);
          assert.deepEqual(hidden, [], `${w}: words not shown with less motion asked`);
          const moved = still.words.filter((x) => x.moved).map((x) => x.key);
          assert.deepEqual(moved, [], `${w}: words moved with less motion asked`);
          const onTop = [];
          for (let i = 0; i < still.words.length; i++) {
            for (let j = i + 1; j < still.words.length; j++) {
              if (overlap(still.words[i].box, still.words[j].box)) onTop.push(`${still.words[i].key} / ${still.words[j].key}`);
            }
          }
          assert.deepEqual(onTop, [], `${w}: words over other words with less motion asked`);
          assert.ok(still.words.every((x) => x.box[1] >= 0 && x.box[1] + x.box[3] <= still.height + 1), `${w}: a word outside the page`);

          // no preference: it pins, and every word is fully in view at some point of the scroll
          await open(w, h, "no-preference");
          const first = await evaluate(MEASURE);
          assert.equal(first.ready, true);
          assert.ok(first.sticky.length >= 2 && first.sticky.every((p) => p === "sticky"), `${w}: stages ${first.sticky.join(", ")}`);
          const keys = new Set([...still.words.map((x) => x.key)]);
          const best = new Map();
          for (let y = 0; y <= first.height; y += Math.round(h / 5)) {
            const at = await evaluate(`${SCROLL}(${y})`);
            for (const x of at.words) if (x.shown && x.opacity >= 0.99) best.set(x.key, true);
          }
          // kinetic lines are split into pieces with the scroll: a line counts when its pieces do
          const never = [...keys].filter((k) => !best.has(k) && ![...best.keys()].some((b) => k.startsWith(b) || b.startsWith(k)));
          assert.deepEqual(never, [], `${w}: words that never reach full view with the scroll`);
        }
      });
    });
}

test("the scroll-craft kit is as its list says, and names no address the list does not pin", () => {
  assert.deepEqual(verifyLock(), []);
  const lock = JSON.parse(readFileSync(join(ENGINE, "scrollcraft-kit", "scrollcraft.lock.json"), "utf8"));
  const pinned = new Set(lock.addresses);
  const found = [];
  const top = join(ENGINE, "scrollcraft-kit");
  for (const f of filesUnder(top)) {
    if (f.startsWith("test/")) continue;
    for (const m of readFileSync(join(top, f), "latin1").matchAll(/https?:\/\/[^\s"'`)<>\\]*/g)) {
      if (!pinned.has(m[0])) found.push(`${relative(ENGINE, join(top, f))}: ${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

test("the old site kit is byte for byte build/v5-cook's", { skip: noBase }, () => {
  for (const f of SITE_KIT_FILES) assert.ok(readFileSync(join(ENGINE, "site-kit", f)).equals(git("show", `${BASE}:engine/site-kit/${f}`)), f);
  assert.deepEqual(readdirSync(join(ENGINE, "site-kit")).sort(), [...SITE_KIT_FILES].sort());
});

test("after every render: no Chrome this file started is left", { skip: noChrome }, async () => {
  const rows = await readPs();
  for (const g of launched) assert.equal(groupOf(rows, g).members.length, 0, `group ${g} still runs`);
});
