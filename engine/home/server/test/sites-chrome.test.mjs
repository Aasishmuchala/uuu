// PLAN-V5 T52 with the REAL page viewer (createViewer) and the real Chrome of this Mac, and the real preview
// (createPreview): a stub home takes its own pictures of a task's site, reads the answer with its own reader, shows
// them, loads the preview, and runs the Test. Skipped, saying why, when Chrome is not installed. Every listener is on
// 127.0.0.1 port 0 in a temp state folder; the viewer starts its own Chrome with a throwaway profile and ends it by
// its own group, so no other Chrome is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSecret } from "../../../doors/common.mjs";
import { CHROME_PATH, chromeInstalled } from "../../../viewer/chrome.mjs";
import { createPreview } from "../../../viewer/preview.mjs";
import { SITE_HEADERS } from "../../../viewer/sitefiles.mjs";
import { createViewer } from "../../../viewer/viewer.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { forgetSiteShots, shotsIdle } from "../lib/siteshots.mjs";
import { forgetBrandChecks } from "../lib/brandcheck.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call } from "../lib/testing.mjs";
import { IDS_V2 } from "../../../test/stubs/seed.mjs";

const HAVE = chromeInstalled(CHROME_PATH);
const skip = HAVE ? false : `Chrome is not installed at ${CHROME_PATH}, so the real viewer cannot be tried here.`;
const GOAL = IDS_V2.issues["STH-2"];
const JOB = "marketing/carousel-from-a-concept";
const KEY_IN_URL = /^\/api\/sites\/shot\/[0-9a-f]{64}\/shot-[A-Za-z0-9._-]{1,90}-(1280|390)-(light|dark)\.png$/;

const SITE = {
  "index.html": [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">",
    "<title>Launch</title><link rel=\"stylesheet\" href=\"style.css\"></head>",
    "<body><header><h1>Launch</h1></header><main><p>Three floors of light over the lake.</p>",
    "<img src=\"img/missing.png\" alt=\"A plan\"><a href=\"about.html\">About the project</a>",
    "<div class=\"too wide\">This box is wider than a phone.</div></main>",
    "<script>fetch('http://example.com/x').catch(() => {});</script></body></html>",
  ].join(""),
  "about.html": "<!doctype html><html lang=\"en\"><head><title>About</title><link rel=\"stylesheet\" href=\"style.css\"></head><body><h1>About</h1><p>The studio.</p></body></html>",
  "style.css": [
    "body { margin: 0; padding: 24px; font-family: Helvetica, sans-serif; font-size: 18px; background: #FFFFFF; color: #222222; }",
    ".too { width: 700px; background: #EEEEEE; }",
    "@media (prefers-color-scheme: dark) { body { background: #111111; color: #EEEEEE; } }",
  ].join("\n"),
};

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ host: u.hostname, port: u.port, path: u.pathname, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
}

test("the real viewer and Chrome: the home server's own pictures of a site, its report, the preview and the Test", { skip, timeout: 300000 }, async () => {
  forgetSiteShots();
  forgetBrandChecks();
  const h = await startV2({ routes: ["sites", "pieces"], decisions: { [`template:${GOAL}`]: JOB } });
  const tmp = mkdtempSync(join(tmpdir(), "uuu-sites-chrome-"));
  let viewer = null;
  let preview = null;
  try {
    const craft = join(tmp, "craft.json");
    writeFileSync(craft, JSON.stringify({ version: 1, jobs: { [JOB]: { kind: "page", review: "art", variants: 3, playbooks: [] } } }));
    h.app.home.craftFile = craft;
    ensureSecret(h.config.paths.viewerSecret);
    const goal = join(h.state, "tasks", "company-work", "STH-2");
    const dir = join(goal, "site", "launch");
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(SITE)) writeFileSync(join(dir, name), data);
    writeFileSync(join(tmp, "outside.css"), "body { color: red; }");
    symlinkSync(join(tmp, "outside.css"), join(dir, "linked.css"));

    viewer = createViewer({ listenPort: 0, paths: h.config.paths, config: h.config, log: () => {}, chrome: { path: CHROME_PATH } });
    await viewer.listen();
    preview = createPreview({ listenPort: 0, paths: h.config.paths, log: () => {} });
    await preview.listen();
    h.app.home.urls.viewer = `http://127.0.0.1:${viewer.port}`;
    h.app.home.urls.preview = `http://127.0.0.1:${preview.port}`;

    // The Test works with the switch off (C17).
    const t = await call(h.url, "POST", "/api/viewer/test", { body: {} });
    assert.equal(t.status, 200, t.text);
    assert.equal(t.json.ok, true, t.json.sentence);
    assert.equal(t.json.pictures, 2);
    assert.equal(t.json.sentence, `Chrome opened a test page and took 2 pictures in ${t.json.seconds} seconds.`);
    assert.ok(t.json.images.every((i) => KEY_IN_URL.test(i.url)));

    // The switch off: the site is off and the viewer is not asked.
    const off = await call(h.url, "GET", "/api/tasks/STH-2/sites");
    assert.equal(off.json.sites[0].shots.state, "off");
    assert.deepEqual(off.json.viewer, { on: false, state: "on" });

    updateDoors(h.config, (s) => { s.viewer.on = true; });
    const first = await call(h.url, "GET", "/api/tasks/STH-2/sites");
    assert.equal(first.json.sites[0].shots.state, "working");
    assert.deepEqual(first.json.sites[0].left, [{ name: "linked.css", why: "a link" }]);
    await shotsIdle();
    const r = await call(h.url, "GET", "/api/tasks/STH-2/sites");
    assert.deepEqual(sameShape(readShape("sites"), r.json), []);
    const s = r.json.sites[0];
    assert.equal(s.shots.state, "ready", s.shots.sentence);
    assert.deepEqual(s.pages, ["index.html", "about.html"]);
    assert.deepEqual(s.shots.images.map((i) => `${i.page} ${i.width} ${i.scheme}`), [
      "index.html 1280 light", "index.html 1280 dark", "index.html 390 light", "index.html 390 dark",
      "about.html 1280 light", "about.html 1280 dark", "about.html 390 light", "about.html 390 dark",
    ]);
    for (const img of s.shots.images) {
      const pic = await call(h.url, "GET", img.url);
      assert.equal(pic.status, 200, img.url);
      assert.equal(pic.headers["content-security-policy"], "default-src 'none'; sandbox");
      assert.equal(pic.buffer.readUInt32BE(0), 0x89504e47);
      assert.equal(pic.buffer.readUInt32BE(16), img.width, `${img.url} is ${img.width} px wide`);
    }
    const index = s.shots.report.find((p) => p.page === "index.html").lines;
    assert.ok(index.includes("Wider than the screen at 390 px: div.too.wide (700 px)"), index.join(" | "));
    assert.ok(index.includes("Pictures that did not load: img/missing.png"), index.join(" | "));
    // The page's fetch to another address is stopped by the content policy before any network: it shows as an error.
    assert.ok(index.some((l) => /^\d+ errors? in the page's console/.test(l)), index.join(" | "));
    assert.ok(index.some((l) => l.startsWith("Drawn with: ")), index.join(" | "));
    const about = s.shots.report.find((p) => p.page === "about.html").lines;
    assert.ok(about.includes("Nothing to fix was found.") || about.every((l) => !/^Wider/.test(l)), about.join(" | "));

    // The preview: the checked files loaded, the home's own address, the page served with K15's headers.
    const pv = await call(h.url, "POST", "/api/tasks/STH-2/sites/launch/preview", { body: {} });
    assert.deepEqual(pv.json, { url: `http://127.0.0.1:${preview.port}/` });
    // The home's address sends the browser on to the load's own origin (T57 F2).
    const there = await get(pv.json.url);
    assert.equal(there.status, 302);
    const siteUrl = there.headers.location;
    // On a host of its own too (T58d): a name under .localhost that this Mac takes to the loopback by itself.
    assert.equal(siteUrl, `http://${preview.siteHost}:${preview.sitePort}/`);
    assert.match(siteUrl, /^http:\/\/p-[0-9a-f]{20}\.localhost:\d+\/$/);
    const page = await get(siteUrl);
    assert.equal(page.status, 200);
    assert.ok(page.text.includes("Three floors of light"));
    for (const [k, v] of Object.entries(SITE_HEADERS)) assert.equal(page.headers[k.toLowerCase()], v, k);
    assert.equal((await get(`${siteUrl}linked.css`)).status, 404, "a link left out of the site is not served");

    // Nothing is left in the viewer's work folder.
    let left = [];
    try { left = readdirSync(join(h.config.paths.doorWork, "view")); } catch { left = []; }
    assert.deepEqual(left, []);
  } finally {
    await shotsIdle();
    if (viewer) await viewer.close();
    if (preview) await preview.close();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
    forgetSiteShots();
    forgetBrandChecks();
  }
});
