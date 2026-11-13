// PLAN-V5 T52: the sites routes on a stub home, with a fake page viewer and a fake preview on port 0 that check the
// owner token (made with the viewer's own made-up secret) and answer fixed archives made with writeTar. Nothing calls
// a live door, nothing leaves 127.0.0.1, and no Chrome is started here (sites-chrome.test.mjs does that).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync, inflateRawSync } from "node:zlib";
import { checkCaller, ensureSecret } from "../../../doors/common.mjs";
import { readTar, writeTar } from "../../../viewer/tar.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { SAY, forgetSiteShots, shotsIdle } from "../lib/siteshots.mjs";
import { forgetBrandChecks } from "../lib/brandcheck.mjs";
import { startStubsHome } from "../lib/stubs.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call } from "../lib/testing.mjs";
import { IDS_V2 } from "../../../test/stubs/seed.mjs";

const GOAL = IDS_V2.issues["STH-2"];
const JOB = "marketing/carousel-from-a-concept";
const DOOR_PORTS = [3130, 3140, 3150, 3160];
const VARIANTS = { kind: "page", name: "launch", round: 1, variants: [{ id: "a", direction: "editorial" }, { id: "b", direction: "gallery" }, { id: "c", direction: "spec-sheet" }] };
const KEY_IN_URL = /^\/api\/sites\/shot\/[0-9a-f]{64}\/shot-[A-Za-z0-9._-]{1,90}-(1280|390)-(light|dark)\.png$/;

function png(w = 2, h = 2) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  const raw = Buffer.alloc((w + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const pageReport = (page, extra = {}) => ({
  page, errors: [], wider: [], missing: [], blocked: [],
  a11y: { noAlt: 0, noLabel: 0, noLang: false, noTitle: false, headingSkips: 0, smallTargets: 0 },
  contrast: [], fonts: [{ family: "Helvetica", minPx: 16 }], colours: ["#222222"], drawn: ["Helvetica"], dark: false, shots: [], cut: null, ...extra,
});
const tarOf = (entries) => writeTar(entries.map(([name, data]) => ({ name, data: typeof data === "string" ? Buffer.from(data) : data })));
const slugOf = (page) => page.replace(/\.html$/, "");
// What the viewer sends for one page: two pictures and the report.
const good = (page, extra) => ({
  tar: tarOf([[`shot-${slugOf(page)}-1280-light.png`, png(4, 3)], [`shot-${slugOf(page)}-390-light.png`, png(3, 4)], ["report.json", JSON.stringify({ version: 1, pages: [pageReport(page, extra)] })]]),
});

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), connection: "close" });
  res.end(text);
}

function listen(server) {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
}

// A fake page viewer: `/view/health`, and `/view/shots?pages=<one page>` only with an owner token of the viewer's
// secret and an archive the viewer would take; `answer(page, n)` gives { tar } or { status, json }.
async function fakeViewer(config, answer) {
  const shots = [];
  const health = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      if (req.method === "GET" && req.url === "/view/health") {
        health.push(req.url);
        return json(res, 200, { status: "ok", part: "viewer", on: true, chrome: true, version: "131.0" });
      }
      const m = /^\/view\/shots\?pages=([A-Za-z0-9._,/-]+)$/.exec(req.url);
      if (req.method !== "POST" || !m) return json(res, 404, { error: { message: "no" }, code: "view_not_found" });
      const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath: config.paths.viewerSecret, idsPath: config.paths.ids, agents: [] });
      if (typeof who !== "object" || who.kind !== "t") return json(res, 401, { error: { message: "no" }, code: "view_no_token" });
      const tar = readTar(Buffer.concat(chunks));
      shots.push({ pages: m[1].split(","), type: req.headers["content-type"], files: tar.ok ? tar.files.slice().sort() : null });
      const a = await answer(m[1], shots.length);
      if (a.tar) {
        res.writeHead(200, { "content-type": "application/x-tar", "content-length": a.tar.length, connection: "close" });
        return void res.end(a.tar);
      }
      return json(res, a.status, a.json);
    });
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, shots, health, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

// A fake preview: /preview/load only with an owner token of the viewer's secret, a tar of a site; it answers an
// address of its own choosing (which the home server must never pass on).
async function fakePreview(config, { status = 200 } = {}) {
  const loads = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const who = checkCaller({ rawHeaders: req.rawHeaders, secretPath: config.paths.viewerSecret, idsPath: config.paths.ids, agents: [] });
      if (req.method !== "POST" || req.url !== "/preview/load") return json(res, 404, { code: "view_not_found" });
      if (typeof who !== "object" || who.kind !== "t") return json(res, 401, { code: "view_no_token" });
      const tar = readTar(Buffer.concat(chunks));
      loads.push({ host: req.headers.host, type: req.headers["content-type"], files: tar.ok ? tar.files.slice().sort() : null });
      if (status !== 200) return json(res, status, { error: { message: "The site was not taken." }, code: "view_bad_site" });
      return json(res, 200, { loaded: true, files: tar.ok ? tar.files.length : 0, bytes: 1, url: "http://evil.example:3160/" });
    });
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, loads, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

function writeSite(goal, ref, files = {}) {
  const dir = join(goal, "site", ref);
  mkdirSync(dir, { recursive: true });
  const all = {
    "index.html": `<!doctype html><html lang="en"><title>${ref}</title><link rel="stylesheet" href="style.css"><h1>${ref}</h1><a href="about.html">About</a>`,
    "about.html": `<!doctype html><html lang="en"><title>About ${ref}</title><h1>About</h1>`,
    "style.css": "body { margin: 0; font-family: var(--brand-body); }",
    "img/logo.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    ...files,
  };
  for (const [name, data] of Object.entries(all)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), data);
  }
  return dir;
}

// A stub home with the sites and pieces routes, a task (STH-2) whose job makes pages, its three versions, a fake
// viewer and a fake preview. `variants: false` writes no variants.json; `sites` names the folders.
async function withSites(fn, { variants = VARIANTS, sites = ["launch-a", "launch-b", "launch-c"], kind = "page", template = JOB, answer = good, on = false, viewer = true, preview = {} } = {}) {
  forgetSiteShots();
  forgetBrandChecks();
  const h = await startV2({ routes: ["sites", "pieces"], decisions: template ? { [`template:${GOAL}`]: template } : {} });
  const tmp = mkdtempSync(join(tmpdir(), "uuu-sites-craft-"));
  let v = null;
  let p = null;
  try {
    const craft = join(tmp, "craft.json");
    writeFileSync(craft, JSON.stringify({ version: 1, jobs: { [JOB]: { kind, review: "art", variants: 3, playbooks: [] } } }));
    h.app.home.craftFile = craft;
    ensureSecret(h.config.paths.viewerSecret);
    const goal = join(h.state, "tasks", "company-work", "STH-2");
    mkdirSync(goal, { recursive: true });
    if (variants) writeFileSync(join(goal, "variants.json"), JSON.stringify(variants));
    for (const ref of sites) writeSite(goal, ref);
    if (viewer) {
      v = await fakeViewer(h.config, answer);
      h.app.home.urls.viewer = v.url;
    }
    if (preview) {
      p = await fakePreview(h.config, preview);
      h.app.home.urls.preview = p.url;
    }
    if (on) updateDoors(h.config, (s) => { s.viewer.on = true; });
    return await fn({ h, goal, viewer: v, preview: p, shotsDir: join(h.config.paths.homeData, "shots") });
  } finally {
    await shotsIdle();
    if (v) await v.close();
    if (p) await p.close();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
    forgetSiteShots();
    forgetBrandChecks();
  }
}

const list = async (h, id = "STH-2") => call(h.url, "GET", `/api/tasks/${id}/sites`);
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const keptKeys = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => /^[0-9a-f]{64}$/.test(n)) : []);

// A zip as the owner's unzip would read it: the central directory, each entry's CRC checked.
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "a zip has an end record");
  const n = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extra;
    const from = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(from, from + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.equal(crc32(data) >>> 0, crc, name);
    out.set(name, data);
  }
  return out;
}

test("the list of three page versions fits shapes/sites.json; with the switch off each is off and nothing is shot", async () => {
  await withSites(async ({ h, viewer }) => {
    const r = await list(h);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(sameShape(readShape("sites"), r.json), []);
    assert.deepEqual(r.json.viewer, { on: false, state: "on" });
    assert.equal(r.json.problem, null);
    assert.deepEqual(r.json.sites.map((s) => [s.ref, s.variant, s.direction.title]), [["launch-a", "a", "Editorial"], ["launch-b", "b", "Gallery"], ["launch-c", "c", "Spec sheet"]]);
    for (const s of r.json.sites) {
      assert.equal(s.files, 4);
      assert.ok(s.bytes > 0);
      assert.deepEqual(s.left, []);
      assert.deepEqual(s.pages, ["index.html", "about.html"]);
      assert.equal(s.problem, null);
      assert.deepEqual(s.shots, { state: "off", sentence: SAY.off, taken: null, images: [], report: [] });
    }
    await shotsIdle();
    assert.equal(viewer.shots.length, 0, "the switch is off: the viewer is never asked");
    // Through the task's id too.
    assert.equal((await list(h, GOAL)).json.sites.length, 3);
  });
});

test("the list of a single site (no variants.json): the plain folders under site/ by name", async () => {
  await withSites(async ({ h, goal }) => {
    mkdirSync(join(goal, "site", "Upper"), { recursive: true });
    mkdirSync(join(goal, "site", ".hidden"), { recursive: true });
    const r = await list(h);
    assert.equal(r.status, 200);
    assert.deepEqual(sameShape(readShape("sites"), r.json), []);
    assert.deepEqual(r.json.sites.map((s) => [s.ref, s.variant, s.direction]), [["home", null, null]]);
    assert.equal(r.json.sites[0].files, 4);
  }, { variants: false, sites: ["home"], template: null });
});

test("a task whose job makes another kind of piece has no sites; a broken variants.json is said", async () => {
  await withSites(async ({ h }) => {
    const r = await list(h);
    assert.deepEqual(r.json.sites, []);
    assert.equal(r.json.problem, null);
    assert.equal((await post(h, "/api/tasks/STH-2/sites/launch-a/preview")).status, 404);
  }, { kind: "carousel" });
  await withSites(async ({ h, goal }) => {
    writeFileSync(join(goal, "variants.json"), "{ not json");
    const r = await list(h);
    assert.deepEqual(r.json.sites, []);
    assert.match(r.json.problem, /not valid JSON/);
  });
});

test("a ref of ../x, launch-d or in other letter case, and a task that is not there, are 404 on every route", async () => {
  await withSites(async ({ h, viewer, preview }) => {
    updateDoors(h.config, (s) => { s.viewer.on = true; });
    for (const ref of ["..%2Fx", "launch-d", "Launch-a", "LAUNCH-A", "launch", "%2E%2E"]) {
      for (const [method, path] of [["POST", "shots"], ["POST", "preview"], ["GET", "zip"]]) {
        const r = method === "GET" ? await call(h.url, "GET", `/api/tasks/STH-2/sites/${ref}/${path}`) : await post(h, `/api/tasks/STH-2/sites/${ref}/${path}`);
        assert.equal(r.status, 404, `${ref} ${path}`);
        assert.equal(r.json.error.code, "site_not_found");
      }
    }
    assert.equal((await list(h, "STH-999")).status, 404);
    assert.equal((await call(h.url, "GET", "/api/tasks/STH-999/sites/launch-a/zip")).json.error.code, "task_not_found");
    await shotsIdle();
    assert.equal(preview.loads.length, 0);
    assert.ok(viewer.shots.length <= 3, "only the listed sites' own background pictures");
  });
});

test("with the switch on the list starts the pictures in the background: one call a page, an owner token, then ready", async () => {
  await withSites(async ({ h, viewer, shotsDir }) => {
    const first = await list(h);
    assert.deepEqual(first.json.viewer, { on: true, state: "on" });
    assert.ok(first.json.sites.every((s) => s.shots.state === "working" && s.shots.sentence === SAY.working));
    await shotsIdle();
    assert.equal(viewer.shots.length, 6, "two pages for each of three versions, one call each");
    assert.deepEqual(viewer.shots.map((c) => c.pages), [["index.html"], ["about.html"], ["index.html"], ["about.html"], ["index.html"], ["about.html"]]);
    assert.ok(viewer.shots.every((c) => c.type === "application/x-tar"));
    assert.deepEqual(viewer.shots[0].files, ["about.html", "img/logo.svg", "index.html", "style.css"]);
    const r = await list(h);
    assert.deepEqual(sameShape(readShape("sites"), r.json), []);
    for (const s of r.json.sites) {
      assert.equal(s.shots.state, "ready");
      assert.equal(s.shots.sentence, null);
      assert.ok(Date.parse(s.shots.taken));
      assert.deepEqual(s.shots.images.map((i) => [i.page, i.width, i.scheme]), [["index.html", 1280, "light"], ["index.html", 390, "light"], ["about.html", 1280, "light"], ["about.html", 390, "light"]]);
      assert.ok(s.shots.images.every((i) => KEY_IN_URL.test(i.url)), JSON.stringify(s.shots.images[0]));
      assert.deepEqual(s.shots.report, [
        { page: "index.html", lines: ["Nothing to fix was found.", "Drawn with: Helvetica"] },
        { page: "about.html", lines: ["Nothing to fix was found.", "Drawn with: Helvetica"] },
      ]);
    }
    assert.equal(keptKeys(shotsDir).length, 3);
    // Asking again takes nothing more: the pictures are kept by the site's key.
    await list(h);
    await shotsIdle();
    assert.equal(viewer.shots.length, 6);
  }, { on: true });
});

test("kept pictures are 0600 in 0700 folders; a changed byte in the site is a new key and new pictures", async () => {
  await withSites(async ({ h, goal, viewer, shotsDir }) => {
    await list(h);
    await shotsIdle();
    const keys = keptKeys(shotsDir);
    assert.equal(keys.length, 1);
    assert.equal(statSync(shotsDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(shotsDir, keys[0])).mode & 0o777, 0o700);
    for (const f of readdirSync(join(shotsDir, keys[0]))) assert.equal(statSync(join(shotsDir, keys[0], f)).mode & 0o777, 0o600, f);
    writeFileSync(join(goal, "site", "launch-a", "style.css"), "body { margin: 1px; }");
    const r = await list(h);
    assert.equal(r.json.sites[0].shots.state, "working");
    await shotsIdle();
    assert.equal(viewer.shots.length, 4);
    assert.equal(keptKeys(shotsDir).length, 2);
    assert.equal((await list(h)).json.sites[0].shots.state, "ready");
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] } });
});

test("a link in the site is left out and listed in left; the viewer, the preview and the zip get only the checked files", async () => {
  await withSites(async ({ h, goal, viewer, preview }) => {
    const secret = join(h.state, "secret.css");
    writeFileSync(secret, "body { color: red; }");
    symlinkSync(secret, join(goal, "site", "launch-a", "stolen.css"));
    writeFileSync(join(goal, "site", "launch-a", ".env"), "KEY=1");
    const r = await list(h);
    const a = r.json.sites[0];
    assert.deepEqual(a.left.find((l) => l.name === "stolen.css"), { name: "stolen.css", why: "a link" });
    assert.ok(a.left.some((l) => l.name === ".env"));
    assert.equal(a.files, 4);
    await shotsIdle();
    assert.ok(viewer.shots.every((c) => !c.files.includes("stolen.css") && !c.files.includes(".env")));
    assert.equal((await post(h, "/api/tasks/STH-2/sites/launch-a/preview")).status, 200);
    assert.deepEqual(preview.loads[0].files, ["about.html", "img/logo.svg", "index.html", "style.css"]);
    const z = await call(h.url, "GET", "/api/tasks/STH-2/sites/launch-a/zip");
    assert.deepEqual([...unzip(z.buffer).keys()].sort(), ["about.html", "img/logo.svg", "index.html", "style.css"]);
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] } });
});

test("an answer that is not what the viewer sends is refused whole and nothing is kept", async () => {
  const report = ["report.json", JSON.stringify({ version: 1, pages: [pageReport("index.html")] })];
  const shot = ["shot-index-1280-light.png", png()];
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
  const cases = {
    "../x.png": () => ({ tar: tarOf([report, ["../x.png", png()]]) }),
    // (16 good names cannot be made for one page; sites-shots.test.mjs refuses the 17th entry on its own)
    "a 17th entry": () => ({ tar: tarOf([report, ...Array.from({ length: 16 }, (_, i) => [`shot-index${i}-1280-light.png`, png()])]) }),
    "a JPEG named .png": () => ({ tar: tarOf([report, ["shot-index-1280-light.png", jpeg]]) }),
    "a 30 MB PNG": () => ({ tar: tarOf([report, ["shot-index-1280-light.png", Buffer.concat([png(), Buffer.alloc(30 * 1024 * 1024)])]]) }),
    "a report.json of 1 MB": () => ({ tar: tarOf([["report.json", JSON.stringify({ pages: [pageReport("index.html")], pad: "x".repeat(1024 * 1024) })], shot]) }),
  };
  let which = null;
  await withSites(async ({ h, viewer, shotsDir }) => {
    for (const why of Object.keys(cases)) {
      which = why;
      forgetSiteShots();
      const before = viewer.shots.length;
      assert.equal((await post(h, "/api/tasks/STH-2/sites/launch-a/shots")).status, 202, why);
      await shotsIdle();
      assert.equal(viewer.shots.length, before + 1, `${why}: asked once, and the second page is not asked after a refusal`);
      const s = (await list(h)).json.sites[0];
      assert.equal(s.shots.state, "failed", why);
      assert.equal(s.shots.sentence, "The page viewer's answer was not what it sends.", why);
      assert.deepEqual(s.shots.images, [], why);
      assert.deepEqual(keptKeys(shotsDir), [], `${why}: nothing kept`);
    }
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] }, answer: (page) => (page === "index.html" ? cases[which]() : good(page)) });
});

test("view_busy waits its retryAfterSec once; busy twice and no Chrome are said plainly", async () => {
  const busy = { status: 403, json: { retryAfterSec: 1, error: { message: "The page viewer is already opening a site." }, code: "view_busy" } };
  await withSites(async ({ h, viewer }) => {
    const started = Date.now();
    await post(h, "/api/tasks/STH-2/sites/launch-a/shots");
    await shotsIdle();
    assert.ok(Date.now() - started >= 900, "it waited the second it was told");
    assert.equal(viewer.shots.length, 3, "busy, then the page again, then the second page");
    assert.equal((await list(h)).json.sites[0].shots.state, "ready");
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] }, answer: (page, n) => (n === 1 ? busy : good(page)) });
  await withSites(async ({ h, viewer }) => {
    await post(h, "/api/tasks/STH-2/sites/launch-a/shots");
    await shotsIdle();
    assert.equal(viewer.shots.length, 2, "one wait only");
    const s = (await list(h)).json.sites[0].shots;
    assert.deepEqual([s.state, s.sentence], ["failed", SAY.busy]);
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] }, answer: () => ({ ...busy, json: { ...busy.json, retryAfterSec: 0 } }) });
  await withSites(async ({ h }) => {
    await post(h, "/api/tasks/STH-2/sites/launch-a/shots");
    await shotsIdle();
    const s = (await list(h)).json.sites[0].shots;
    assert.deepEqual([s.state, s.sentence], ["failed", "No Chrome was found on this Mac."]);
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] }, answer: () => ({ status: 403, json: { error: { message: "<b>no</b>" }, code: "view_no_chrome" } }) });
});

test("Take pictures again: 409 viewer_off while the switch is off; 202 while on, and they are taken again", async () => {
  await withSites(async ({ h, viewer }) => {
    const off = await post(h, "/api/tasks/STH-2/sites/launch-b/shots");
    assert.equal(off.status, 409);
    assert.equal(off.json.error.code, "viewer_off");
    assert.equal(off.json.error.message, "The page viewer is off. Switch it on in Settings.");
    updateDoors(h.config, (s) => { s.viewer.on = true; });
    const on = await post(h, "/api/tasks/STH-2/sites/launch-b/shots");
    assert.equal(on.status, 202);
    assert.deepEqual(on.json, { state: "working", sentence: SAY.working });
    await shotsIdle();
    assert.equal(viewer.shots.length, 2);
    await post(h, "/api/tasks/STH-2/sites/launch-b/shots");
    await shotsIdle();
    assert.equal(viewer.shots.length, 4, "taken again though they were kept");
    const b = (await list(h)).json.sites.find((s) => s.ref === "launch-b");
    assert.equal(b.shots.state, "ready");
  });
});

test("the preview loads the checked files with an owner token and answers the home's own address, never the preview's", async () => {
  await withSites(async ({ h, preview }) => {
    const r = await post(h, "/api/tasks/STH-2/sites/launch-c/preview");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { url: `${preview.url}/` });
    assert.ok(!r.text.includes("evil.example"));
    assert.equal(preview.loads.length, 1);
    assert.equal(preview.loads[0].type, "application/x-tar");
    assert.equal(preview.loads[0].host, preview.url.slice("http://".length), "the preview's own Host check passes");
    assert.deepEqual(preview.loads[0].files, ["about.html", "img/logo.svg", "index.html", "style.css"]);
    // The preview's switch does not matter (C17): the owner's preview works with the viewer off.
    assert.equal((await post(h, "/api/tasks/STH-2/sites/launch-a/preview")).status, 200);
  });
});

test("the preview not running is 409 with its sentence; a refusal is 409; a site that cannot be read is 409", async () => {
  await withSites(async ({ h }) => {
    const r = await post(h, "/api/tasks/STH-2/sites/launch-a/preview");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "preview_off");
    assert.equal(r.json.error.message, "The preview is not running. Run: engine start");
  }, { preview: false });
  await withSites(async ({ h }) => {
    const r = await post(h, "/api/tasks/STH-2/sites/launch-a/preview");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "preview_refused");
  }, { preview: { status: 400 } });
  await withSites(async ({ h, goal, preview }) => {
    rmSync(join(goal, "site", "launch-a", "index.html"));
    const r = await post(h, "/api/tasks/STH-2/sites/launch-a/preview");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, "site_problem");
    assert.equal(r.json.error.message, "This site cannot be opened: there is no index.html at the top.");
    assert.equal(preview.loads.length, 0);
    const z = await call(h.url, "GET", "/api/tasks/STH-2/sites/launch-a/zip");
    assert.equal(z.status, 409);
    const s = (await list(h)).json.sites[0];
    assert.equal(s.problem, "This site cannot be opened: there is no index.html at the top.");
    assert.equal(s.shots.state, "failed");
  });
});

test("the zip opens with the site's files and nothing else, as an attachment named by the task and the site", async () => {
  await withSites(async ({ h, goal }) => {
    const r = await call(h.url, "GET", "/api/tasks/STH-2/sites/launch-b/zip");
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/zip");
    assert.equal(r.headers["content-disposition"], "attachment; filename=\"STH-2-launch-b.zip\"");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["cache-control"], "no-store");
    const files = unzip(r.buffer);
    assert.deepEqual([...files.keys()].sort(), ["about.html", "img/logo.svg", "index.html", "style.css"]);
    for (const [name, data] of files) assert.deepEqual(data, readFileSync(join(goal, "site", "launch-b", name)), name);
    // The system's own unzip agrees, when this Mac has one.
    if (existsSync("/usr/bin/unzip")) {
      const dir = mkdtempSync(join(tmpdir(), "uuu-sites-zip-"));
      try {
        writeFileSync(join(dir, "s.zip"), r.buffer);
        const listed = execFileSync("/usr/bin/unzip", ["-Z1", join(dir, "s.zip")], { encoding: "utf8" }).trim().split("\n").sort();
        assert.deepEqual(listed, ["about.html", "img/logo.svg", "index.html", "style.css"]);
        execFileSync("/usr/bin/unzip", ["-tq", join(dir, "s.zip")]);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});

test("a shot address with a bad key or name is 404; a kept one is a PNG that can run nothing", async () => {
  await withSites(async ({ h }) => {
    await list(h);
    await shotsIdle();
    const s = (await list(h)).json.sites[0];
    const url = s.shots.images[0].url;
    const r = await call(h.url, "GET", url);
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal(r.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.buffer.readUInt32BE(0), 0x89504e47);
    const key = url.split("/")[4];
    for (const bad of [
      `/api/sites/shot/${key.toUpperCase()}/shot-index-1280-light.png`, `/api/sites/shot/${key.slice(1)}/shot-index-1280-light.png`,
      `/api/sites/shot/${"0".repeat(64)}/shot-index-1280-light.png`, `/api/sites/shot/${key}/report.json`,
      `/api/sites/shot/${key}/..%2Freport.json`, `/api/sites/shot/${key}/shot-index-800-light.png`, `/api/sites/shot/${key}/shot-index-1280-dark.png`,
      `/api/sites/shot/..%2F..%2Fdecisions.json/shot-index-1280-light.png`,
    ]) {
      const b = await call(h.url, "GET", bad);
      assert.equal(b.status, 404, bad);
      assert.equal(b.headers["content-type"], "application/json; charset=utf-8", bad);
    }
  }, { on: true, sites: ["launch-a"], variants: { ...VARIANTS, variants: [VARIANTS.variants[0]] } });
});

test("the Test: the home's own page through the viewer with the switch off; no answer and no Chrome are said", async () => {
  await withSites(async ({ h, viewer }) => {
    const r = await post(h, "/api/viewer/test");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.pictures, 2);
    assert.ok(Number.isInteger(r.json.seconds) && r.json.seconds >= 1);
    assert.equal(r.json.sentence, `Chrome opened a test page and took 2 pictures in ${r.json.seconds} seconds.`);
    assert.deepEqual(r.json.images.map((i) => [i.page, i.width, i.scheme]), [["index.html", 1280, "light"], ["index.html", 390, "light"]]);
    assert.ok(r.json.images.every((i) => KEY_IN_URL.test(i.url)));
    assert.equal((await call(h.url, "GET", r.json.images[0].url)).status, 200);
    assert.deepEqual(viewer.shots[0].files, ["index.html", "style.css"], "the home server's own two files, nothing an agent made");
  }, { answer: (page) => good(page) });
  await withSites(async ({ h }) => {
    const r = await post(h, "/api/viewer/test");
    assert.deepEqual([r.json.ok, r.json.pictures, r.json.sentence], [false, 0, "The page viewer is off. Run: engine start"]);
    assert.deepEqual(r.json.images, []);
  }, { viewer: false });
  await withSites(async ({ h }) => {
    const r = await post(h, "/api/viewer/test");
    assert.deepEqual([r.json.ok, r.json.sentence], [false, "No Chrome was found on this Mac."]);
  }, { answer: () => ({ status: 403, json: { error: { message: "No Chrome was found on this Mac." }, code: "view_no_chrome" } }) });
});

test("the pick card of three page versions: a sentence until the pictures are kept, then the home server's own", async () => {
  await withSites(async ({ h, viewer }) => {
    const off = await call(h.url, "GET", "/api/tasks/STH-2/pieces");
    assert.equal(off.status, 200, off.text);
    assert.equal(off.json.kind, "page");
    assert.deepEqual(off.json.variants.map((v) => v.preview), [1, 2, 3].map(() => [{ type: "text", text: "Pictures of this version are not taken yet: the page viewer is off." }]));
    assert.equal(viewer.shots.length, 0);
    updateDoors(h.config, (s) => { s.viewer.on = true; });
    const asked = await call(h.url, "GET", "/api/tasks/STH-2/pieces");
    assert.deepEqual(asked.json.variants.map((v) => v.preview[0].text), [1, 2, 3].map(() => "Pictures of this version are not taken yet."));
    await shotsIdle();
    assert.equal(viewer.shots.length, 6, "the pieces route asked for them in the background");
    const ready = await call(h.url, "GET", "/api/tasks/STH-2/pieces");
    assert.deepEqual(sameShape(readShape("pieces"), ready.json), []);
    for (const v of ready.json.variants) {
      assert.deepEqual(v.preview.map((p) => [p.type, p.file]), [["image", "shot-index-1280-light.png"], ["image", "shot-index-390-light.png"]]);
      assert.ok(v.preview.every((p) => KEY_IN_URL.test(p.url)));
      assert.notEqual(v.brand.lines[0], "This version has none of the pictures the brand check measures, so it was not checked.");
    }
  });
});

test("POSTs without the home screen's same-origin headers are refused by the core and start nothing", async () => {
  await withSites(async ({ h, viewer, preview }) => {
    for (const path of ["/api/tasks/STH-2/sites/launch-a/shots", "/api/tasks/STH-2/sites/launch-a/preview", "/api/viewer/test"]) {
      const r = await call(h.url, "POST", path, { bare: true, body: {}, headers: { "content-type": "application/json" } });
      assert.equal(r.status, 403, path);
      assert.equal(r.json.error.code, "not_same_origin");
    }
    await shotsIdle();
    assert.equal(viewer.shots.length, 0);
    assert.equal(preview.loads.length, 0);
  }, { on: false });
});

async function connectionsDuring(fn) {
  const seen = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function connect(...args) {
    const o = Array.isArray(args[0]) ? args[0][0] : args[0];
    seen.push(Number(o && typeof o === "object" ? o.port : o));
    return original.apply(this, args);
  };
  try { await fn(); } finally { net.Socket.prototype.connect = original; }
  return seen;
}

test("a stub home (null door addresses) opens no socket to the viewer or the preview", async () => {
  for (const start of [
    () => startV2({ routes: ["sites", "pieces"], inbox: [], search: [], port: 0 }),
    () => startStubsHome({ port: 0 }),
  ]) {
    forgetSiteShots();
    const h = await start();
    try {
      for (const d of ["viewer", "preview"]) assert.equal(h.app.home.urls[d], null, d);
      ensureSecret(h.config.paths.viewerSecret);
      updateDoors(h.config, (s) => { s.viewer.on = true; });
      const goal = join(h.state, "tasks", "company-work", "STH-2");
      mkdirSync(goal, { recursive: true });
      writeSite(goal, "home");
      const configured = DOOR_PORTS.concat(["viewer", "preview"].map((d) => h.config.ports[d]));
      const seen = await connectionsDuring(async () => {
        const r = await list(h);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.viewer, { on: true, state: "off" });
        await post(h, "/api/tasks/STH-2/sites/home/shots");
        assert.equal((await post(h, "/api/tasks/STH-2/sites/home/preview")).json.error.message, "The preview is not running. Run: engine start");
        assert.equal((await post(h, "/api/viewer/test")).json.sentence, "The page viewer is off. Run: engine start");
        await shotsIdle();
      });
      assert.ok(seen.length > 0);
      const allowed = new Set([h.port, h.board.port, h.bench.port]);
      for (const port of seen) {
        assert.ok(!configured.includes(port), `a socket to door port ${port}`);
        assert.ok(allowed.has(port), `a socket to ${port}`);
      }
    } finally {
      await shotsIdle();
      await h.close();
      forgetSiteShots();
    }
  }
});
