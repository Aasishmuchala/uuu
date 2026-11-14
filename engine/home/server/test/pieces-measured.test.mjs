// PLAN-V5 T58b: a page version's brand line carries the verdict of the home server's OWN page viewer report, whatever
// the brand check by code said. A stub home with a kit, a brand check runner that passes every version, and a fake
// page viewer on 127.0.0.1 port 0 that answers each site with a report of our choosing (the pages T57's review found
// the check by code passed: a colour mixed the long way round, another face, small text, an outside address, a
// filter). Nothing calls a live door and no Chrome is started here.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { ensureSecret } from "../../../doors/common.mjs";
import { writeTar } from "../../../viewer/tar.mjs";
import { forgetBrandChecks } from "../lib/brandcheck.mjs";
import { updateDoors } from "../lib/doors.mjs";
import { MEASURED_SAY, judgePage, withMeasured } from "../lib/sitebrand.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { forgetSiteShots, shotsIdle } from "../lib/siteshots.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call } from "../lib/testing.mjs";
import { IDS_V2 } from "../../../test/stubs/seed.mjs";

const GOAL = IDS_V2.issues["STH-2"];
const JOB = "marketing/carousel-from-a-concept";
const VARIANTS = { kind: "page", name: "launch", round: 1, variants: [{ id: "a", direction: "editorial" }, { id: "b", direction: "gallery" }] };
const KIT = {
  version: 1, name: "Sthyra",
  colours: [{ name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sand", hex: "#E8DCC8", role: "background" }],
  neutrals: true,
  type: { heading: { family: "Didot", file: null, fallback: "serif" }, body: { family: "Avenir Next", file: null, fallback: "sans-serif" }, minPx: 16, minSlidePx: 28 },
};
const HONEST = { fonts: [{ family: "Avenir Next", minPx: 18 }, { family: "Didot", minPx: 40 }], colours: ["#1A3C5E", "#E8DCC8", "#1B3D5F", "#222222"], drawn: ["Avenir Next", "Didot"], blocked: [] };
// What the viewer measured of the page T57's a11 opened (sites/fooled), and of the a10 pages a check by code passed.
const FOOLED = {
  fonts: [{ family: "Avenir Next", minPx: 18 }, { family: "Comic Sans MS", minPx: 4.8 }],
  colours: ["#1A3C5E", "#5E3C1A", "#FF00AA"], drawn: ["Avenir Next", "Comic Sans MS"],
  blocked: ["outside-by-svg-script.example:80", "outside-by-svg-set.example:80"], filtered: 1,
};

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
const pageReport = (page, extra) => ({
  page, errors: [], wider: [], missing: [], blocked: [],
  a11y: { noAlt: 0, noLabel: 0, noLang: false, noTitle: false, headingSkips: 0, smallTargets: 0 },
  contrast: [], fonts: [], colours: [], drawn: [], dark: false, shots: [], cut: null, ...extra,
});
const tarOf = (entries) => writeTar(entries.map(([name, data]) => ({ name, data: typeof data === "string" ? Buffer.from(data) : data })));

// A fake viewer: each call's site is told apart by its title (launch-a or launch-b); `reports[ref]` is its page.
async function fakeViewer(reports) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const ref = /<title>(launch-[ab])<\/title>/.exec(body)?.[1] || "launch-a";
      const tar = tarOf([["shot-index-1280-light.png", png(4, 3)], ["shot-index-390-light.png", png(3, 4)],
        ["report.json", JSON.stringify({ version: 1, pages: [pageReport("index.html", reports[ref])] })]]);
      res.writeHead(200, { "content-type": "application/x-tar", "content-length": tar.length, connection: "close" });
      res.end(tar);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

// The brand check by code passes every version: whatever the judge says, it says over a pass.
const passing = async () => ({
  version: 1, kit: "present",
  pieces: ["launch-a", "launch-b"].map((name) => ({ kind: "site", name, result: "pass", hard: [], soft: [] })),
  variants: { result: "pass", hard: [], present: true },
});

async function withHome(fn, { reports = { "launch-a": HONEST, "launch-b": FOOLED }, kit = KIT } = {}) {
  forgetSiteShots();
  forgetBrandChecks();
  const h = await startV2({ routes: ["sites", "pieces"], decisions: { [`template:${GOAL}`]: JOB } });
  const tmp = mkdtempSync(join(tmpdir(), "uuu-pieces-measured-"));
  let v = null;
  try {
    const craft = join(tmp, "craft.json");
    writeFileSync(craft, JSON.stringify({ version: 1, jobs: { [JOB]: { kind: "page", review: "art", variants: 3, playbooks: [] } } }));
    h.app.home.craftFile = craft;
    h.app.home.brandCheckRunner = passing;
    ensureSecret(h.config.paths.viewerSecret);
    if (kit) {
      mkdirSync(join(h.config.paths.knowledgeDocs, "brand"), { recursive: true });
      writeFileSync(join(h.config.paths.knowledgeDocs, "brand", "kit.json"), JSON.stringify(kit));
    }
    const goal = join(h.state, "tasks", "company-work", "STH-2");
    mkdirSync(goal, { recursive: true });
    writeFileSync(join(goal, "variants.json"), JSON.stringify(VARIANTS));
    for (const ref of ["launch-a", "launch-b"]) {
      mkdirSync(join(goal, "site", ref), { recursive: true });
      writeFileSync(join(goal, "site", ref, "index.html"), `<!doctype html><html lang="en"><title>${ref}</title><h1>${ref}</h1>`);
    }
    v = await fakeViewer(reports);
    h.app.home.urls.viewer = v.url;
    return await fn({ h });
  } finally {
    await shotsIdle();
    if (v) await v.close();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
    forgetSiteShots();
    forgetBrandChecks();
  }
}

const pieces = async (h) => {
  const r = await call(h.url, "GET", "/api/tasks/STH-2/pieces");
  assert.equal(r.status, 200, r.text);
  return r.json;
};

test("a page version is never 'pass' before the home server's own viewer has measured it", async () => {
  await withHome(async ({ h }) => {
    const off = await pieces(h);
    assert.deepEqual(off.variants.map((x) => x.brand), [1, 2].map(() => ({ result: "unknown", lines: [MEASURED_SAY.notYetOff] })));
    updateDoors(h.config, (s) => { s.viewer.on = true; });
    const asked = await pieces(h);
    assert.deepEqual(asked.variants.map((x) => x.brand), [1, 2].map(() => ({ result: "unknown", lines: [MEASURED_SAY.notYet] })));
  });
});

test("the measured verdict fails the page that fools the check by code, and passes the honest one", async () => {
  await withHome(async ({ h }) => {
    updateDoors(h.config, (s) => { s.viewer.on = true; });
    await pieces(h);
    await shotsIdle();
    const r = await pieces(h);
    assert.deepEqual(sameShape(readShape("pieces"), r), []);
    const [a, b] = r.variants;
    assert.deepEqual(a.brand, { result: "pass", lines: [] }, "the honest page: kit colours (one within 2 of ink), a grey, the kit's faces");
    assert.equal(b.brand.result, "fail", "the check by code said pass; the home server's own report says otherwise");
    assert.deepEqual(b.brand.lines, [
      "Measured in the page viewer: colours that are not in your kit: #5E3C1A, #FF00AA.",
      "Measured in the page viewer: 1 part drawn through a filter or blend mode, whose colours cannot be compared with your kit.",
      "Measured in the page viewer: text set in faces that are not your kit's: Comic Sans MS.",
      "Measured in the page viewer: text of 4.8 px; your kit's smallest is 16 px.",
      "Measured in the page viewer: the page tried to reach 2 addresses outside the site.",
    ]);
    // The site view carries the same verdict for each site.
    const sites = await call(h.url, "GET", "/api/tasks/STH-2/sites");
    assert.deepEqual(sameShape(readShape("sites"), sites.json), []);
    assert.deepEqual(sites.json.sites.map((s) => s.brand.result), ["pass", "fail"]);
    assert.deepEqual(sites.json.sites[1].brand.lines, b.brand.lines);
  });
});

test("a page cut short, or holding more than the report lists, is unknown; no kit leaves the line to the check by code", async () => {
  await withHome(async ({ h }) => {
    updateDoors(h.config, (s) => { s.viewer.on = true; });
    await pieces(h);
    await shotsIdle();
    const [a, b] = (await pieces(h)).variants;
    assert.deepEqual(a.brand, { result: "unknown", lines: ["Measured in the page viewer: the page did not finish in the page viewer, so it was not measured in full."] });
    assert.deepEqual(b.brand, { result: "unknown", lines: ["Measured in the page viewer: the page holds more elements or colours than the page viewer lists, so not all were measured."] });
  }, { reports: { "launch-a": { ...HONEST, cut: "time" }, "launch-b": { ...HONEST, capped: true } } });
  await withHome(async ({ h }) => {
    const r = await pieces(h);
    assert.deepEqual(r.variants.map((x) => x.brand.result), ["pass", "pass"], "no kit: nothing to compare with");
  }, { kit: null });
});

test("judgePage: the kit's tolerance, greys only with neutrals, drawn faces only when the kit names this Mac's faces", () => {
  const kit = { colours: [[0x1a, 0x3c, 0x5e]], families: new Set(["avenir next"]), minPx: 16, neutrals: true, uploaded: false };
  const page = { colours: ["#1C3E60", "#1D3C5E", "#808080"], fonts: [{ family: "Avenir  Next", minPx: 16 }], drawn: ["Avenir Next", "Helvetica"], blocked: [] };
  assert.deepEqual(judgePage(page, kit), { fail: ["colours that are not in your kit: #1D3C5E", "drawn with faces that are not your kit's: Helvetica"], unknown: [] });
  assert.deepEqual(judgePage(page, { ...kit, neutrals: false, uploaded: true }).fail, ["colours that are not in your kit: #1D3C5E, #808080"]);
  assert.deepEqual(withMeasured({ result: "warn", lines: ["x"] }, { state: "done", result: "pass", lines: [] }), { result: "warn", lines: ["x"] });
  assert.deepEqual(withMeasured({ result: "pass", lines: [] }, { state: "nokit" }), { result: "pass", lines: [] });
  assert.equal(withMeasured({ result: "fail", lines: [] }, { state: "done", result: "unknown", lines: ["u"] }).result, "fail");
});
