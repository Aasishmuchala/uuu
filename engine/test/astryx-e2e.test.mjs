// PLAN-ASTRYX T10: end to end. The Astryx kit is installed into a state folder of this test's own, a site is put
// together the way the Builder's block in roles/builder.md says, from the INSTALLED copies only, and the INSTALLED
// brand check passes it. The old way still works: a site made with the plain site kit gives the same brand check and
// the same page viewer report as on build/v5-cook, and the site kit's files are byte for byte that branch's. No file
// of the kit, the example or the astryx playbook names an address the kit's list does not pin.
//
// Two installers, two ways:
//   - engine/playbooks/install.sh is run for real, into the temp state (its test env names).
//   - engine/art/install.sh is NOT run: it fetches a Python and Pillow with uv, and tests never download. Its step
//     that puts the tools in state/art/tools is done here from the installer's own lists (TOOL_FILES, BRAND_FILES,
//     ASTRYX_FILES, read from its text), file for file, as it copies them. The installed brand check is then run by
//     a Python of this Mac that has Pillow (the brand check refuses to start without it); with none, those tests are
//     skipped, saying why.
// Nothing reaches the internet: no address is fetched, the page viewer's ports are 0 and its proxy allows only the
// site. Only processes this file started are ended, by their group id.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { deflateSync, crc32 } from "node:zlib";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mintToken } from "../relay/token.mjs";
import { CHROME_PATH, chromeInstalled, defaultLaunch, groupOf, readPs } from "../viewer/chrome.mjs";
import { writeTar } from "../viewer/tar.mjs";
import { createViewer } from "../viewer/viewer.mjs";
import { checkKit, emptyKit, ensureAstryxTheme, kitCss } from "../home/server/brain/kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..");
const REPO = join(ENGINE, "..");
const BASE = "build/v5-cook";
const SITE_KIT_FILES = ["reset.css", "layout.css", "reveal.js", "gallery.js", "README.md"];

// A Python of this Mac with Pillow, by fixed path (never from PATH), or null.
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

// A whole PNG of one colour (the kit's logo), made here: no picture library.
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

// Kit A of PLAN-ASTRYX T3 with the logo the brand check looks for on pages.
const ENV = { families: new Set(["Didot", "Avenir Next"]), fonts: new Set(), brandPictures: new Set(["logo.png"]), referencePictures: new Set() };
function brandKit() {
  const k = emptyKit(["Didot"]);
  k.name = "Harbour";
  k.colours = [
    { name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sun", hex: "#E0A100", role: "accent" },
    { name: "paper", hex: "#FAF7F2", role: "background" }, { name: "night", hex: "#0B1D2E", role: "text" },
  ];
  k.type.body = { family: "Avenir Next", file: null, fallback: "sans-serif" };
  k.layout.radiusPx = 6;
  k.type.minPx = 16;
  k.logo.files = [{ file: "logo.png", on: "light" }];
  return checkKit(k, ENV);
}

// The installer's own list of names: NAME="a b c".
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "astryx-e2e-")));
  state = join(root, "state");
  brand = join(state, "knowledge", "docs", "brand");
  mkdirSync(brand, { recursive: true });
  mkdirSync(join(state, "knowledge", "docs", "pictures"), { recursive: true });
  mkdirSync(join(state, "media", "room"), { recursive: true });
  // The brand kit, saved as the home server saves it: kit.json, kit.css, and astryx-theme.css by its own start hook.
  writeFileSync(join(brand, "logo.png"), png(96, 32, [0x1a, 0x3c, 0x5e]));
  const kit = brandKit();
  writeFileSync(join(brand, "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
  writeFileSync(join(brand, "kit.css"), kitCss(kit));
  assert.equal(ensureAstryxTheme({ paths: { knowledgeDocs: join(state, "knowledge", "docs"), state } }), "written");

  // The playbooks installer, for real, into the temp state; no skill of the owner's (an empty folder stands in).
  playbooks = join(state, "playbooks");
  mkdirSync(join(root, "no-skills"));
  install = spawnSync("/bin/bash", [join(ENGINE, "playbooks", "install.sh")], {
    encoding: "utf8",
    env: { ...process.env, ENGINE_PLAYBOOKS_SOURCE: join(root, "no-skills"), ENGINE_PLAYBOOKS_DEST: playbooks },
  });

  // The art installer's step 4, from its own lists: the brand check and what it reads, in state/art/tools.
  const text = readFileSync(join(ENGINE, "art", "install.sh"), "utf8");
  tools = join(state, "art", "tools");
  mkdirSync(tools, { recursive: true });
  const from = (f, list) => (list === "BRAND_FILES" ? join(ENGINE, "company", "brand", f) : list === "ASTRYX_FILES" ? join(ENGINE, "astryx-kit", f) : join(ENGINE, "art", f));
  for (const list of ["TOOL_FILES", "BRAND_FILES", "ASTRYX_FILES"]) {
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

// A goal's folder in the state, made empty: state/tasks/company-work/<id>.
function goal(id) {
  const g = join(state, "tasks", "company-work", id);
  mkdirSync(join(g, "site"), { recursive: true });
  return g;
}
// The installed brand check (state/art/tools/brandcheck.py: it finds the state from where it is), or another copy
// with --state. -> { code, report }.
function brandCheck(script, id, extra = []) {
  const r = spawnSync(PYTHON, ["-I", script, "--json", ...extra, id], { cwd: join(state, "tasks", "company-work"), encoding: "utf8", timeout: 120_000 });
  assert.equal(r.stderr, "", r.stderr);
  return { code: r.status, report: JSON.parse(r.stdout) };
}

test("the playbooks installer puts the Astryx kit and the astryx playbook in the state", () => {
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const lock = JSON.parse(readFileSync(join(ENGINE, "astryx-kit", "astryx.lock.json"), "utf8"));
  const kit = join(playbooks, "astryx-kit");
  assert.deepEqual(filesUnder(join(kit, "astryx")), lock.files.map((f) => f.name).sort());
  for (const f of ["README.md", "example/index.html", "example/app.js", "example/style.css"]) assert.ok(lstatSync(join(kit, f)).isFile(), f);
  for (const f of ["SKILL.md", "COMPONENTS.md"]) assert.ok(lstatSync(join(playbooks, "astryx", f)).isFile(), f);
  const index = JSON.parse(readFileSync(join(playbooks, "index.json"), "utf8"));
  assert.ok(JSON.stringify(index).includes("astryx-kit"), "index.json lists the kit");
  // the art installer would copy the kit's list beside the brand check
  assert.ok(lstatSync(join(tools, "astryx.lock.json")).isFile());
});

test("a site made as the Builder's block says, from the installed copies only, passes the installed brand check", { skip: noPython }, () => {
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const kit = join(playbooks, "astryx-kit");
  const g = goal("STH-7");
  const site = join(g, "site", "launch");
  mkdirSync(site);
  // The Builder's own command, word for word from its block, run inside the goal's folder.
  const block = readFileSync(join(ENGINE, "company", "roles", "builder.md"), "utf8").split("<!-- astryx:start -->")[1].split("<!-- astryx:end -->")[0];
  const cmd = /`(cp -R "\$UUU_PLAYBOOKS_DIR\/astryx-kit\/astryx" site\/<name>\/astryx)`/.exec(block);
  assert.ok(cmd, "the block names the copy");
  execFileSync("/bin/sh", ["-c", cmd[1].replace("<name>", "launch")], { cwd: g, env: { PATH: "/usr/bin:/bin", UUU_PLAYBOOKS_DIR: playbooks } });
  // brand/kit.css and brand/astryx-theme.css byte for byte, the logo, and the example page to start from
  for (const f of ["kit.css", "astryx-theme.css", "logo.png"]) copyFileSync(join(brand, f), join(site, f));
  for (const f of ["app.js", "style.css"]) copyFileSync(join(kit, "example", f), join(site, f));
  const index = readFileSync(join(kit, "example", "index.html"), "utf8");
  assert.ok(index.includes('src="logo.svg"'));
  writeFileSync(join(site, "index.html"), index.replace('src="logo.svg"', 'src="logo.png"'));   // the kit's logo file

  // the site's astryx/ is the engine's kit, file for file
  const mine = join(site, "astryx");
  const theirs = join(ENGINE, "astryx-kit", "astryx");
  assert.deepEqual(filesUnder(mine), filesUnder(theirs));
  for (const f of filesUnder(theirs)) assert.ok(readFileSync(join(mine, f)).equals(readFileSync(join(theirs, f))), f);

  const { code, report } = brandCheck(join(tools, "brandcheck.py"), "STH-7");
  const piece = report.pieces.find((p) => p.name === "launch");
  assert.ok(piece, JSON.stringify(report));
  assert.deepEqual({ code, kind: piece.kind, result: piece.result, hard: piece.hard, soft: piece.soft }, { code: 0, kind: "site", result: "pass", hard: [], soft: [] });
  assert.ok(piece.measured.words > 10, "the page's words were read");
});

// The plain site kit's way (the shape of engine/art/tests/test_brandcheck_pages.py's good site, with the site kit's
// reset.css and layout.css as its honest-motion test adds them, and reveal.js from the site kit).
const PLAIN_INDEX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harbour</title>
<link rel="stylesheet" href="reset.css">
<link rel="stylesheet" href="layout.css">
<link rel="stylesheet" href="kit.css">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="top"><a href="index.html"><img src="logo.png" alt="Harbour" height="32"></a></header>
<main class="grid">
<h1>Homes that follow the sun</h1>
<p>Every home we build starts with the light on its site at seven in the morning, and the plan follows the sun.</p>
<p data-reveal>The kitchen is warm before anyone wakes, and the rooms open to the garden by noon.</p>
</main>
<script src="reveal.js"></script>
</body>
</html>
`;
const PLAIN_STYLE = `body { margin: 0; color: var(--brand-night); background: var(--brand-paper); font-family: var(--brand-body); }
h1, h2 { font-family: var(--brand-heading); font-size: max(var(--brand-min-size), 2.5rem); }
a:hover, a:focus-visible { color: var(--brand-sun); outline: 2px solid currentColor; }
@media (min-width: 768px) { .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem; } }
@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }
`;
function plainFiles() {
  const files = [
    { name: "index.html", data: Buffer.from(PLAIN_INDEX) }, { name: "style.css", data: Buffer.from(PLAIN_STYLE) },
    { name: "kit.css", data: readFileSync(join(brand, "kit.css")) }, { name: "logo.png", data: readFileSync(join(brand, "logo.png")) },
  ];
  for (const f of ["reset.css", "layout.css", "reveal.js"]) files.push({ name: f, data: readFileSync(join(ENGINE, "site-kit", f)) });
  return files;
}

test("the site kit's files are byte for byte those of build/v5-cook", { skip: noBase }, () => {
  for (const f of SITE_KIT_FILES) assert.ok(readFileSync(join(ENGINE, "site-kit", f)).equals(git("show", `${BASE}:engine/site-kit/${f}`)), f);
});

test("a site made with the plain site kit: the same brand check as on build/v5-cook, and it passes", { skip: noPython || noBase }, () => {
  const g = goal("STH-8");
  const site = join(g, "site", "plain");
  mkdirSync(site);
  for (const f of plainFiles()) writeFileSync(join(site, f.name), f.data);
  const now = brandCheck(join(tools, "brandcheck.py"), "STH-8");
  // build/v5-cook's brand check and what it reads, in a folder not named tools (so --state is taken)
  const old = join(root, "base-bin");
  mkdirSync(old);
  for (const f of ["art/brandcheck.py", "art/kit.py", "art/fontmap.json", "company/brand/filler.json", "company/brand/directions.json"]) {
    writeFileSync(join(old, f.split("/").pop()), git("show", `${BASE}:engine/${f}`));
  }
  const then = brandCheck(join(old, "brandcheck.py"), "STH-8", ["--state", state]);
  assert.deepEqual(now, then);
  const piece = now.report.pieces.find((p) => p.name === "plain");
  assert.deepEqual({ code: now.code, result: piece.result, hard: piece.hard }, { code: 0, result: "pass", hard: [] });
});

// One render through a viewer's door (this branch's or build/v5-cook's createViewer) -> the report.
const SECRET = "6".repeat(64);
async function render(make, files) {
  const dir = mkdtempSync(join(root, "viewer-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  const paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
  const launch = (program, args, env) => { const out = defaultLaunch(program, args, env); launched.push(out.child.pid); return out; };
  const v = make({ listenPort: 0, paths, config: { doors: { viewer: { agents: ["builder"] } } }, log: () => {}, chrome: { path: CHROME_PATH, launch } });
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
      req.end(writeTar(files));
    });
    assert.equal(r.status, 200, r.raw.toString().slice(0, 300));
    let off = 0;
    while (off + 512 <= r.raw.length) {
      const name = r.raw.subarray(off, off + 100).toString("latin1").replace(/\0.*$/s, "");
      if (!name) break;
      const size = parseInt(r.raw.subarray(off + 124, off + 136).toString("latin1"), 8);
      if (name === "report.json") return JSON.parse(r.raw.subarray(off + 512, off + 512 + size));
      off += 512 + Math.ceil(size / 512) * 512;
    }
    throw new Error("no report.json in the viewer's answer");
  } finally {
    await v.close();
  }
}

test("the plain site kit's site: the same page viewer report as build/v5-cook's viewer gives", { skip: noChrome || noBase, timeout: 180_000 }, async () => {
  // build/v5-cook's viewer and the modules it imports, unpacked from git into the temp folder
  const base = join(root, "base");
  mkdirSync(base);
  const tar = git("archive", "--format=tar", BASE, "engine/viewer", "engine/doors", "engine/relay", "engine/lib");
  execFileSync("/usr/bin/tar", ["-x", "-C", base, "-f", "-"], { input: tar });
  const old = await import(pathToFileURL(join(base, "engine", "viewer", "viewer.mjs")).href);
  const files = plainFiles();
  const then = await render(old.createViewer, files);
  const now = await render(createViewer, files);
  // this branch adds one fact to each page (PLAN-ASTRYX D9), false for a page with no data-astryx-root
  const same = (r, drop) => r.pages.map((p) => {
    const q = { ...p, errors: [...p.errors].sort() };
    if (drop) { assert.equal(q.drawn_late, false); delete q.drawn_late; }
    return q;
  });
  assert.deepEqual(same(now, true), same(then, false));
  const p = now.pages[0];
  assert.deepEqual([p.errors, p.blocked, p.missing, p.cut], [[], [], [], null]);
});

test("no file of the kit, the example or the astryx playbook names an address the kit's list does not pin", () => {
  const lock = JSON.parse(readFileSync(join(ENGINE, "astryx-kit", "astryx.lock.json"), "utf8"));
  const pinned = new Set(lock.addresses);
  // The kit's build reads an address as the scheme and at least one more character (engine/astryx-kit/build.mjs,
  // ADDRESS_RE); a bare "https://" in a script (a test of whether a string starts with it) names no place.
  const ANY = /https?:\/\/[^\s"'`)<>\\]*/g;
  const found = [];
  for (const dir of ["astryx-kit/astryx", "astryx-kit/example", "playbooks/own/astryx"]) {
    const top = join(ENGINE, dir);
    for (const f of filesUnder(top)) {
      const text = readFileSync(join(top, f), "latin1");
      for (const m of text.matchAll(ANY)) {
        if (/^https?:\/\/$/.test(m[0])) continue;
        if (!pinned.has(m[0])) found.push(`${relative(ENGINE, join(top, f))}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test("after every render: no Chrome this file started is left", { skip: noChrome }, async () => {
  const rows = await readPs();
  for (const g of launched) assert.equal(groupOf(rows, g).members.length, 0, `group ${g} still runs`);
});
