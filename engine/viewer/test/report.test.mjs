// PLAN-V5 T58b: the page report as the judge's measure. parseColour reads every form Chrome writes a computed colour
// in; mergePage keeps `filtered` and `capped`; and, with the REAL Chrome (skipped, saying why, when it is not
// installed), a page that fools the brand check by code is measured as it is drawn: the colour color-mix() makes the
// long way round, a colour from a style block inside SVG written as character references, a filter, text in rem.
// The page cannot tell the viewer from a visitor by navigator.webdriver, "HeadlessChrome" in the user agent or its
// client hints, and the site kit's reveal.js still shows every part for the whole-page picture. The viewer starts its
// own hidden Chrome on a throwaway profile and ends it itself; nothing leaves 127.0.0.1.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintToken } from "../../relay/token.mjs";
import { CHROME_PATH, chromeInstalled } from "../chrome.mjs";
import { CAPS, mergePage, parseColour } from "../report.mjs";
import { writeTar } from "../tar.mjs";
import { createViewer } from "../viewer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = "8".repeat(64);
const skip = chromeInstalled(CHROME_PATH) ? false : `Chrome is not installed at ${CHROME_PATH}`;
const rgb = (c) => { const o = parseColour(c); return o && [o.r, o.g, o.b].map(Math.round).concat(o.a); };

test("parseColour: rgb(), color() in every space, lab(), lch(), oklab() and oklch(), each to sRGB", () => {
  assert.deepEqual(rgb("rgb(26, 60, 94)"), [26, 60, 94, 1]);
  assert.deepEqual(rgb("rgba(26, 60, 94, 0.5)"), [26, 60, 94, 0.5]);
  assert.deepEqual(rgb("rgba(0, 0, 0, 0)"), [0, 0, 0, 0]);
  // what Chrome wrote for color-mix(in hsl longer hue, ink, ink) in T57's a11: the ink's opposite hue
  assert.deepEqual(rgb("color(srgb 0.368627 0.235294 0.101961)"), [94, 60, 26, 1]);
  assert.deepEqual(rgb("color(srgb 0.1 0.2 0.3 / 0.25)"), [26, 51, 77, 0.25]);
  assert.deepEqual(rgb("color(srgb-linear 0.5 0.5 0.5)"), [188, 188, 188, 1]);
  assert.deepEqual(rgb("color(display-p3 1 0 0)"), [255, 0, 0, 1], "out of sRGB: clipped");
  assert.deepEqual(rgb("color(display-p3 0.5 0.5 0.5)"), [128, 128, 128, 1]);
  assert.deepEqual(rgb("color(xyz-d65 0.95047 1 1.08883)"), [255, 255, 255, 1]);
  assert.deepEqual(rgb("color(rec2020 0 0 0)"), [0, 0, 0, 1]);
  assert.deepEqual(rgb("lab(50 0 0)"), [119, 119, 119, 1]);
  assert.deepEqual(rgb("lch(50 0 none)"), [119, 119, 119, 1]);
  assert.deepEqual(rgb("oklab(1 0 0)"), [255, 255, 255, 1]);
  assert.deepEqual(rgb("oklch(0.627955 0.257683 29.2339)"), [255, 0, 0, 1]);
  for (const bad of ["", "red", "hsl(0 0% 0%)", "rgb(1 2)", "color(nope 1 2 3)", "rgb(1, 2, 3) x", "url(x)"]) assert.equal(parseColour(bad), null, bad);
});

test("mergePage keeps the most elements drawn through a filter, and says when the page held more than is listed", () => {
  const colours = Array.from({ length: CAPS.colours + 5 }, (_, i) => `#${i.toString(16).padStart(6, "0").toUpperCase()}`);
  const p = mergePage({ page: "index.html", passes: [{ width: 1280, data: { filtered: 3, colours: colours.slice(0, 10) } }, { width: 390, data: { filtered: "x", colours } }] });
  assert.equal(p.filtered, 3);
  assert.equal(p.capped, true);
  assert.equal(p.colours.length, CAPS.colours);
  const q = mergePage({ page: "index.html", passes: [{ width: 1280, data: { capped: true } }] });
  assert.deepEqual([q.filtered, q.capped], [0, true]);
  assert.deepEqual([mergePage({ page: "x.html", passes: [] }).filtered, mergePage({ page: "x.html", passes: [] }).capped], [0, false]);
});

let dir; let paths;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "viewer-report-"));
  mkdirSync(join(dir, "doors"), { mode: 0o700 });
  paths = {
    doorsState: join(dir, "doors", "state.json"), ids: join(dir, "ids.json"), viewerSecret: join(dir, "viewer-secret"),
    viewerStatus: join(dir, "doors", "viewer-status.json"), doorWork: join(dir, "doors", "work"),
  };
  writeFileSync(paths.viewerSecret, `${SECRET}\n`);
  chmodSync(paths.viewerSecret, 0o600);
  writeFileSync(paths.ids, JSON.stringify({ agents: {} }));
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Measured</title>
<style>:root { --brand-ink: #1A3C5E; } body { color: var(--brand-ink); margin: 0; font-family: Helvetica, sans-serif; font-size: 18px; }
h1 { background: color-mix(in hsl longer hue, var(--brand-ink), var(--brand-ink)); }
.turned { filter: hue-rotate(180deg); } .terms { font-size: 0.3rem; } .oklch { color: oklch(0.627955 0.257683 29.2339); }</style>
</head><body>
<h1 id="mixed">Mixed the long way round</h1>
<p id="svgstyled">Coloured by a style block inside inline SVG</p>
<svg width="0" height="0"><style>#svgstyled{background:&#x23;ff00aa}</style></svg>
<p class="turned">Turned by a filter</p><p class="terms">Terms in a third of a rem</p><p class="oklch">Red in oklch</p>
<p data-reveal id="part">A part that fades in</p>
<script src="reveal.js"></script>
<script>
addEventListener("load", () => {
  const brands = navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand).join("|") : "";
  console.error("T58B webdriver=" + navigator.webdriver + " headless=" + /Headless/.test(navigator.userAgent + brands)
    + " reduced=" + matchMedia("(prefers-reduced-motion: reduce)").matches + " shown=" + document.getElementById("part").classList.contains("is-in"));
});
</script>
</body></html>
`;

test("the real Chrome: the colours drawn, the filter, the smallest text, and a page that cannot tell the viewer apart", { skip, timeout: 120_000 }, async () => {
  const reveal = readFileSync(join(HERE, "..", "..", "site-kit", "reveal.js"));
  const body = writeTar([{ name: "index.html", data: Buffer.from(PAGE) }, { name: "reveal.js", data: reveal }]);
  const v = createViewer({ listenPort: 0, paths, config: { doors: { viewer: { agents: [] } } }, log: () => {}, chrome: { path: CHROME_PATH } });
  const port = await v.listen();
  let raw;
  try {
    raw = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/view/shots?pages=index.html", agent: false,
        headers: { Authorization: `Bearer ${mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600)}`, "Content-Type": "application/x-tar" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(body);
    });
  } finally {
    await v.close();
  }
  assert.equal(raw.status, 200, raw.data.toString().slice(0, 300));
  let off = 0;
  let report = null;
  while (off + 512 <= raw.data.length) {
    const n = raw.data.subarray(off, off + 100).toString("latin1").replace(/\0.*$/s, "");
    if (!n) break;
    const size = parseInt(raw.data.subarray(off + 124, off + 136).toString("latin1"), 8);
    if (n === "report.json") report = JSON.parse(raw.data.subarray(off + 512, off + 512 + size).toString("utf8"));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  const p = report.pages[0];
  assert.ok(p.colours.includes("#5E3C1A"), `the long-way mix, written by Chrome as color(srgb …): ${p.colours}`);
  assert.ok(p.colours.includes("#FF00AA"), `the SVG style block's colour: ${p.colours}`);
  assert.ok(p.colours.includes("#FF0000"), `oklch red: ${p.colours}`);
  assert.ok(p.filtered >= 1, "the filter is counted");
  assert.equal(p.capped, false);
  assert.ok(p.fonts.some((f) => f.minPx === 4.8), JSON.stringify(p.fonts));
  assert.ok(p.errors.includes("T58B webdriver=false headless=false reduced=true shown=true"), p.errors.join(" | "));
});
