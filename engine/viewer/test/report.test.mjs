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
import { CAPS, SETTLE_STEPS, mergePage, parseColour, settleScript } from "../report.mjs";
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

test("T58e: mergePage takes only the brand's measures from a measured-only pass, the most of each count, and fallbacks apart", () => {
  const p = mergePage({
    page: "index.html",
    passes: [
      { width: 1280, data: { colours: ["#1A3C5E"], fonts: [{ family: "Didot", minPx: 40 }], wider: [], contrast: [], turned: 0 } },
      { width: 1280, extra: true, data: { colours: ["#FF00AA"], fonts: [{ family: "Didot", minPx: 5.4 }], wider: [{ tag: "p", cls: "", width: 2000 }], contrast: [{ text: "x", fg: "#000000", bg: "#000000", ratio: 1 }], turned: 2, painted: 1, unsized: 3, hasDark: true } },
    ],
    drawn: ["Didot", "Kohinoor Devanagari"], fallbacks: ["Kohinoor Devanagari", "Kohinoor Telugu"], unsettled: 4,
  });
  assert.deepEqual(p.colours, ["#1A3C5E", "#FF00AA"]);
  assert.deepEqual(p.fonts, [{ family: "Didot", minPx: 5.4 }]);
  assert.deepEqual([p.wider, p.contrast, p.dark], [[], [], false], "the page's own report lines come from the pictured passes");
  assert.deepEqual([p.turned, p.painted, p.unsized, p.unsettled], [2, 1, 3, 4]);
  assert.deepEqual(p.fallbacks, ["Kohinoor Telugu"], "a face that also drew Latin is drawn, not a fallback");
  assert.equal(mergePage({ page: "x.html", passes: [] }).unsettled, 0);
  assert.ok(SETTLE_STEPS >= 2);
  assert.match(settleScript(3), /const k = 3;/);
  assert.match(settleScript(-1), /const k = 0;/);
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

// T58e: the pages T57's second look found both judges passed, measured as Chrome draws them.
const KIT_HEAD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Second look</title><style>
:root { --brand-ink: #1A3C5E; --brand-sand: #E8DCC8; --brand-clay: #C8553D; }
body { margin: 0; color: var(--brand-ink); background: var(--brand-sand); font-family: Helvetica, sans-serif; font-size: 18px; }
`;
const SECOND = {
  rainbow: { css: "body { background: linear-gradient(in hsl longer hue, var(--brand-clay), var(--brand-clay)); }", body: "<p>x</p>" },
  border: { css: "body { border-image: conic-gradient(in hsl longer hue, var(--brand-clay), var(--brand-clay)) fill 0 / 0 / 0 100vmax; }", body: "<p>x</p>" },
  zoom: { css: ".terms { zoom: 0.3; }", body: '<p class="terms">Terms</p>' },
  scaled: { css: ".box { transform: scale(0.3); transform-origin: 0 0; }", body: '<div class="box"><p>Terms</p></div>' },
  viewbox: { css: "", body: '<svg viewBox="0 0 3000 300" width="300" height="30"><text x="0" y="20" font-size="16">Terms</text></svg>' },
  deep: { css: ".d { perspective: 100px; } .d span { display: inline-block; transform: translateZ(-300px); }", body: '<div class="d"><span>Terms</span></div>' },
  later: { css: "@keyframes late { to { background: #ff00aa; color: #00ff00; } } body { animation: late 0s 2s forwards; }", body: "<p>x</p>" },
  steps: { css: "@keyframes walk { 0% { color: var(--brand-ink); } 50% { color: #00ff00; } 100% { color: var(--brand-ink); } } p { animation: walk 4s infinite; }", body: "<p>x</p>" },
  motion: { css: ".other { display: none; } @media (prefers-reduced-motion: no-preference) { main { display: none; } .other { display: block; color: #ff00aa; } }", body: '</main><div class="other">Most visitors</div><main>' },
  painted: { css: "body { background: paint(flat); }", body: "<p>x</p>" },
  honest: { css: "a { color: var(--brand-clay); transition: color 0.3s; } .r { transform: rotate(90deg) scale(1.2); } @keyframes in { from { opacity: 0; transform: translateY(1rem); } to { opacity: 1; transform: none; } } p { animation: in 0.6s both; }", body: '<p>Honest <a href="#">link</a></p><p class="r">Turned</p>' },
};

test("T58e, the real Chrome: drawn sizes, gradients round the wheel, a paint worklet, the page later and with nothing asked", { skip, timeout: 240_000 }, async () => {
  const entries = Object.entries(SECOND);
  const files = entries.map(([name, { css, body }]) => ({ name: `${name}.html`, data: Buffer.from(`${KIT_HEAD}${css}</style></head><body><main>${body}</main></body></html>`) }));
  const v = createViewer({ listenPort: 0, paths, config: { doors: { viewer: { agents: [] } } }, log: () => {}, chrome: { path: CHROME_PATH } });
  const port = await v.listen();
  const pages = {};
  try {
    for (let i = 0; i < entries.length; i += 3) {
      const ask = entries.slice(i, i + 3).map(([n]) => `${n}.html`);
      const raw = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method: "POST", path: `/view/shots?pages=${ask.join(",")}`, agent: false,
          headers: { Authorization: `Bearer ${mintToken(SECRET, "t", "owner", Math.floor(Date.now() / 1000) + 600)}`, "Content-Type": "application/x-tar" } }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("error", reject);
        req.end(writeTar([...files, { name: "index.html", data: Buffer.from(`${KIT_HEAD}</style></head><body><p>x</p></body></html>`) }]));
      });
      let off = 0;
      while (off + 512 <= raw.length) {
        const n = raw.subarray(off, off + 100).toString("latin1").replace(/\0.*$/s, "");
        if (!n) break;
        const size = parseInt(raw.subarray(off + 124, off + 136).toString("latin1"), 8);
        if (n === "report.json") for (const p of JSON.parse(raw.subarray(off + 512, off + 512 + size).toString("utf8")).pages) pages[p.page.replace(/\.html$/, "")] = p;
        off += 512 + Math.ceil(size / 512) * 512;
      }
    }
  } finally {
    await v.close();
  }
  const smallest = (p) => Math.min(...p.fonts.map((f) => f.minPx));
  assert.ok(pages.rainbow.turned >= 1 && pages.border.turned >= 1, "a gradient round the hue wheel is counted, as a background and as a border image");
  assert.equal(smallest(pages.zoom), 5.4, "zoom");
  assert.equal(smallest(pages.scaled), 5.4, "a transform on the text's box");
  assert.equal(smallest(pages.viewbox), 1.6, "an SVG viewBox");
  assert.ok(smallest(pages.deep) < 16, `a 3D transform, by its drawn box: ${smallest(pages.deep)}`);
  assert.ok(pages.later.colours.includes("#FF00AA") && pages.later.colours.includes("#00FF00"), `off-brand after 2 s: ${pages.later.colours}`);
  assert.ok(pages.steps.colours.includes("#00FF00"), `the middle keyframe of an endless animation: ${pages.steps.colours}`);
  assert.ok(pages.motion.colours.includes("#FF00AA"), `what a visitor who asks for nothing gets: ${pages.motion.colours}`);
  assert.ok(pages.painted.painted >= 1, "a paint worklet");
  const h = pages.honest;
  assert.deepEqual([h.turned, h.painted, h.unsized, h.unsettled, h.filtered, h.capped], [0, 0, 0, 0, 0, false]);
  assert.ok(smallest(h) >= 18, `honest text is measured at its size (a turned box is not smaller): ${JSON.stringify(h.fonts)}`);
  assert.deepEqual(h.colours.filter((c) => !["#1A3C5E", "#E8DCC8", "#C8553D"].includes(c)), [], `honest colours: ${h.colours}`);
  for (const [n, p] of Object.entries(pages)) assert.equal(p.cut, null, n);
});
