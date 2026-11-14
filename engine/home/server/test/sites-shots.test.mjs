// PLAN-V5 T52 (lib/siteshots.mjs), with no home: the sites of a task read as hostile folders, the key of a site,
// the home server's own strict reader of the viewer's answer (C14), the report as sentences, the kept pictures and
// their 500 MB cap. A temp project folder stands in for tasks/company-work; nothing calls a door.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { writeTar } from "../../../viewer/tar.mjs";
import {
  KEY_RE, SAY, SHOT_LIMITS, SHOT_NAME, findSite, forgetSiteShots, htmlPages, keptShots, pagePreview, pagesOf, pngOk, pruneShots,
  readShot, readShotsTar,
  readSite, reportLines, siteInfo, siteKey, sitesOf, shotsView, takeShots,
} from "../lib/siteshots.mjs";
import { placeOf, previewIsChecked, previewOf } from "../lib/variants.mjs";

// A real PNG of w × h (one grey row repeated), made here.
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
  ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const PAGE = (page, extra = {}) => ({
  page, errors: [], wider: [], missing: [], blocked: [],
  a11y: { noAlt: 0, noLabel: 0, noLang: false, noTitle: false, headingSkips: 0, smallTargets: 0 },
  contrast: [], fonts: [{ family: "Avenir Next", minPx: 16 }], colours: ["#1A3C5E", "#FFFFFF"], drawn: ["Avenir Next"], dark: false,
  shots: [], cut: null, ...extra,
});
const answer = (entries) => writeTar(entries.map(([name, data]) => ({ name, data: typeof data === "string" ? Buffer.from(data) : data })));
const reportOf = (...pages) => JSON.stringify({ version: 1, chrome: "Chrome/131", pages });
const goodAnswer = (page = "index.html", slug = "index") => answer([
  [`shot-${slug}-1280-light.png`, png(4, 3)], [`shot-${slug}-390-light.png`, png(3, 4)], ["report.json", reportOf(PAGE(page))],
]);

function withGoal(fn) {
  const root = mkdtempSync(join(tmpdir(), "uuu-siteshots-"));
  const project = join(root, "company-work");
  const goal = join(project, "STH-12");
  mkdirSync(goal, { recursive: true });
  const state = join(root, "state");
  mkdirSync(join(state, "doors"), { recursive: true });
  const config = {
    engineDir: join(root, "engine"),
    paths: {
      projectFolder: project, state, homeData: join(state, "home"), doorsState: join(state, "doors", "state.json"), doors: join(state, "doors"),
      knowledgeDocs: join(state, "knowledge", "docs"),
    },
  };
  forgetSiteShots();
  const done = () => { forgetSiteShots(); rmSync(root, { recursive: true, force: true }); };
  let out;
  try {
    out = fn({ root, goal, config, at: (...p) => join(goal, ...p) });
  } catch (e) {
    done();
    throw e;
  }
  if (out && typeof out.then === "function") return out.finally(done);
  done();
  return out;
}

function site(g, ref, files = {}) {
  const dir = g.at("site", ref);
  mkdirSync(dir, { recursive: true });
  const all = { "index.html": `<!doctype html><title>${ref}</title><h1>${ref}</h1>`, "style.css": "body{margin:0}", ...files };
  for (const [name, data] of Object.entries(all)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), data);
  }
  return dir;
}

const VARIANTS = { kind: "page", name: "launch", round: 1, variants: [{ id: "a", direction: "editorial" }, { id: "b", direction: "gallery" }, { id: "c", direction: "spec-sheet" }] };

function threeVersions(g) {
  writeFileSync(g.at("variants.json"), JSON.stringify(VARIANTS));
  for (const id of ["a", "b", "c"]) site(g, `launch-${id}`);
}

// Keeps pictures for a site the way a render would, through the real write path (a fake viewer is in the route
// tests; here the kept folder is written as keep() writes it).
function keepFor(g, key, names, pages = [PAGE("index.html")]) {
  const dir = join(g.config.paths.homeData, "shots", key);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const n of names) writeFileSync(join(dir, n), png(), { mode: 0o600 });
  writeFileSync(join(dir, "report.json"), JSON.stringify({ version: 1, taken: "2026-11-13T10:00:00.000Z", pages }), { mode: 0o600 });
}

test("sites: a task's three page versions by variants.json, their refs and directions", () => {
  withGoal((g) => {
    threeVersions(g);
    const s = sitesOf(g.config, "STH-12");
    assert.equal(s.problem, null);
    assert.deepEqual(s.sites.map((x) => [x.ref, x.variant, x.direction.id, x.direction.title, x.rel]), [
      ["launch-a", "a", "editorial", "Editorial", "site/launch-a"],
      ["launch-b", "b", "gallery", "Gallery", "site/launch-b"],
      ["launch-c", "c", "spec-sheet", "Spec sheet", "site/launch-c"],
    ]);
    // A version whose folder is a link is not listed.
    rmSync(g.at("site", "launch-c"), { recursive: true });
    const outside = join(g.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "index.html"), "<h1>outside</h1>");
    symlinkSync(outside, g.at("site", "launch-c"));
    assert.deepEqual(sitesOf(g.config, "STH-12").sites.map((x) => x.ref), ["launch-a", "launch-b"]);
    // A broken variants.json is its plain problem and no site.
    writeFileSync(g.at("variants.json"), "{ nope");
    assert.match(sitesOf(g.config, "STH-12").problem, /not valid JSON/);
    assert.deepEqual(sitesOf(g.config, "STH-12").sites, []);
  });
});

test("sites: with no variants.json, the plain folders under site/ whose names fit, at most six, in name order", () => {
  withGoal((g) => {
    assert.deepEqual(sitesOf(g.config, "STH-12"), { sites: [], problem: null });
    for (const n of ["home", "about-us", "Upper", "a_b", ".hidden", "zz", "p1", "p2", "p3", "p4"]) mkdirSync(g.at("site", n), { recursive: true });
    writeFileSync(g.at("site", "file-not-folder"), "x");
    const outside = join(g.root, "elsewhere");
    mkdirSync(outside);
    symlinkSync(outside, g.at("site", "linked"));
    const s = sitesOf(g.config, "STH-12");
    assert.deepEqual(s.sites.map((x) => x.ref), ["about-us", "home", "p1", "p2", "p3", "p4"]);
    assert.ok(s.sites.every((x) => x.variant === null && x.direction === null));
    // site/ itself a link: nothing.
    rmSync(g.at("site"), { recursive: true });
    symlinkSync(outside, g.at("site"));
    mkdirSync(join(outside, "home"));
    assert.deepEqual(sitesOf(g.config, "STH-12").sites, []);
  });
});

test("sites: a ref is only matched against the list: ../x, launch-d and other letter case are no site", () => {
  withGoal((g) => {
    threeVersions(g);
    assert.equal(findSite(g.config, "STH-12", "launch-a").rel, "site/launch-a");
    for (const ref of ["../x", "launch-d", "Launch-a", "LAUNCH-A", "launch-a/", "launch-a/../launch-b", "", null, "launch"]) {
      assert.equal(findSite(g.config, "STH-12", ref), null, String(ref));
    }
    assert.equal(findSite(g.config, "../STH-12", "launch-a"), null);
  });
});

test("reading a site: a link in it is left out and listed in left; site/ swapped for a link is refused", () => {
  withGoal((g) => {
    threeVersions(g);
    const secret = join(g.root, "secret.css");
    writeFileSync(secret, "body{color:red}");
    symlinkSync(secret, g.at("site", "launch-a", "stolen.css"));
    writeFileSync(g.at("site", "launch-a", ".DS_Store"), "x");
    const r = readSite(g.config, "STH-12", "site/launch-a");
    assert.equal(r.ok, true);
    assert.deepEqual(r.files.map((f) => f.name).sort(), ["index.html", "style.css"]);
    assert.deepEqual(r.left.find((l) => l.name === "stolen.css"), { name: "stolen.css", why: "a link" });
    assert.ok(r.left.some((l) => l.name === ".DS_Store"));
    const info = siteInfo(g.config, "STH-12", "site/launch-a");
    assert.equal(info.files, 2);
    assert.deepEqual(info.pages, ["index.html"]);
    assert.ok(info.left.some((l) => l.name === "stolen.css" && l.why === "a link"));
    // A site with no index.html cannot be opened, said plainly.
    rmSync(g.at("site", "launch-b", "index.html"));
    const b = siteInfo(g.config, "STH-12", "site/launch-b");
    assert.equal(b.ok, false);
    assert.equal(b.problem, "This site cannot be opened: there is no index.html at the top.");
    // The whole site/ folder a link to a copy outside: refused.
    const copy = join(g.root, "copy");
    mkdirSync(join(copy, "launch-a"), { recursive: true });
    writeFileSync(join(copy, "launch-a", "index.html"), "<h1>copy</h1>");
    rmSync(g.at("site"), { recursive: true });
    symlinkSync(copy, g.at("site"));
    assert.deepEqual(readSite(g.config, "STH-12", "site/launch-a"), { ok: false, sentence: SAY.gone });
    assert.equal(readSite(g.config, "STH-12", "site/../x").ok, false);
  });
});

test("the key: the same for the same files, changed by one byte, by the pages, and not by the order", () => {
  const files = [{ name: "index.html", data: Buffer.from("<h1>a</h1>") }, { name: "style.css", data: Buffer.from("h1{}") }];
  const k = siteKey(files, ["index.html"]);
  assert.match(k, KEY_RE);
  assert.equal(siteKey([...files].reverse(), ["index.html"]), k);
  assert.equal(siteKey(files.map((f) => ({ name: f.name, data: Buffer.from(f.data) })), ["index.html"]), k);
  assert.notEqual(siteKey([files[0], { name: "style.css", data: Buffer.from("h1{ ") }], ["index.html"]), k);
  assert.notEqual(siteKey([files[0], { name: "style2.css", data: files[1].data }], ["index.html"]), k);
  assert.notEqual(siteKey(files, ["index.html", "about.html"]), k);
});

test("the key of a site folder follows its files: one byte changed, even with its size and time put back", () => {
  withGoal((g) => {
    threeVersions(g);
    const one = siteInfo(g.config, "STH-12", "site/launch-a");
    assert.equal(siteInfo(g.config, "STH-12", "site/launch-a").key, one.key, "the same stamp, the same key");
    assert.notEqual(siteInfo(g.config, "STH-12", "site/launch-b").key, one.key, "another site, another key");
    const css = g.at("site", "launch-a", "style.css");
    const was = statSync(css);
    writeFileSync(css, "body{margin:1}");
    utimesSync(css, was.atime, was.mtime);
    assert.equal(statSync(css).size, was.size);
    const two = siteInfo(g.config, "STH-12", "site/launch-a");
    assert.notEqual(two.key, one.key, "a changed byte is a new key though the size and time are the same");
    writeFileSync(css, "body{margin:0}");
    assert.equal(siteInfo(g.config, "STH-12", "site/launch-a").key, one.key, "the same files again, the same key");
  });
});

test("pages: index.html, then every other page of the site in name order up to the cap; none without index.html", () => {
  const f = (...names) => names.map((name) => ({ name, data: Buffer.alloc(1) }));
  assert.deepEqual(pagesOf(f("style.css", "index.html")), ["index.html"]);
  // T58e: pages in folders too (their shot names with "_"), never an ending in other letters (the viewer is not asked
  // for it), and one whose shot name would be another's is left out
  assert.deepEqual(pagesOf(f("index.html", "zeta.html", "about.html", "contact.html", "sub/inner.html", "UP.HTML", "sub_inner.html")),
    ["index.html", "about.html", "contact.html", "sub/inner.html", "zeta.html"]);
  assert.equal(htmlPages(f("index.html", "zeta.html", "about.html", "contact.html", "sub/inner.html", "UP.HTML", "sub_inner.html", "a.css")), 7);
  assert.deepEqual(pagesOf(f("about.html")), []);
  assert.deepEqual(pagesOf(f("index.html", `${"a".repeat(91)}.html`)), ["index.html"], "a page whose shot name would not fit is not asked");
  const many = f("index.html", ...Array.from({ length: 12 }, (_, i) => `p${String(i).padStart(2, "0")}.html`));
  assert.equal(pagesOf(many).length, SHOT_LIMITS.pages);
  assert.equal(SHOT_LIMITS.pages, 8);
});

test("the viewer's answer: a good one is read with its pictures and a capped, plain report", () => {
  const r = readShotsTar(goodAnswer(), { pages: ["index.html"] });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.shots.map((s) => s.name), ["shot-index-1280-light.png", "shot-index-390-light.png"]);
  assert.ok(r.shots.every((s) => pngOk(s.data)));
  assert.equal(r.report.pages.length, 1);
  assert.equal(r.report.pages[0].page, "index.html");
  assert.deepEqual(r.report.pages[0].drawn, ["Avenir Next"]);
  // Markup and control characters in the page's text come out plain and capped.
  const noisy = readShotsTar(answer([["report.json", reportOf(PAGE("index.html", { errors: [`<b>x</b>\u0000‮${"y".repeat(500)}`], wider: [{ tag: "div\n<script>", cls: "a b", width: 9e9, at: 390 }] }))]]));
  assert.equal(noisy.ok, true);
  const p = noisy.report.pages[0];
  assert.ok(p.errors[0].length <= 300 && !/[\u0000‮]/.test(p.errors[0]));
  assert.equal(p.wider[0].tag.length <= 20 && !p.wider[0].tag.includes("\n"), true);
  assert.equal(p.wider[0].width, 1_000_000);
});

test("the viewer's answer: ../x.png, a 17th entry, a JPEG named .png, a 30 MB PNG, a 1 MB report.json: refused whole", () => {
  const report = ["report.json", reportOf(PAGE("index.html"))];
  const shot = ["shot-index-1280-light.png", png()];
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60)]);
  const big = Buffer.concat([png(), Buffer.alloc(30 * 1024 * 1024)]);
  const many = Array.from({ length: 16 }, (_, i) => [`shot-p${i}-1280-light.png`, png()]);
  // The count alone: 16 entries of good names are read; a 17th refuses the whole answer.
  assert.equal(readShotsTar(answer([report, ...many.slice(0, 15)])).ok, true, "16 entries");
  assert.deepEqual(readShotsTar(answer([report, ...many])), { ok: false, reason: SAY.answer }, "17 entries");
  const cases = [
    ["a name with ..", answer([report, ["../x.png", png()]])],
    ["a 17th entry", answer([report, ...many])],
    ["a JPEG named .png", answer([report, ["shot-index-1280-light.png", jpeg]])],
    ["a 30 MB PNG", answer([report, ["shot-index-1280-light.png", big]])],
    ["a report.json of 1 MB", answer([["report.json", JSON.stringify({ pages: [PAGE("index.html")], pad: "x".repeat(1024 * 1024) })], shot])],
    ["no report.json", answer([shot])],
    ["a report that is not JSON", answer([["report.json", "{ nope"], shot])],
    ["a report with no pages", answer([["report.json", JSON.stringify({ version: 1 })], shot])],
    ["a report page of another kind", answer([["report.json", reportOf({ ...PAGE("index.html"), errors: "lots" })], shot])],
    ["an upper-case ending", answer([report, ["shot-index-1280-light.PNG", png()]])],
    ["another file", answer([report, ["notes.txt", "hello"]])],
    ["a name twice", answer([report, shot, shot])],
  ];
  for (const [why, buf] of cases) assert.deepEqual(readShotsTar(buf, { pages: ["index.html"] }), { ok: false, reason: SAY.answer }, why);
});

test("the viewer's answer: only ustar of plain files, nothing after the end, only the pages asked", () => {
  const good = goodAnswer();
  const no = (buf, why, opts = { pages: ["index.html"] }) => assert.equal(readShotsTar(buf, opts).ok, false, why);
  // a folder entry (type 5), a link (type 2) and an old-style type of NUL
  for (const flag of [0x35, 0x32, 0x00]) {
    const b = Buffer.from(good);
    b[156] = flag;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : b[i];
    b.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
    no(b, `type ${flag}`);
  }
  const damaged = Buffer.from(good);
  damaged[0] ^= 1;
  no(damaged, "a checksum that is wrong");
  const gnu = Buffer.from(good);
  gnu.write("ustar  \0", 257, "latin1");
  no(gnu, "not ustar 00");
  no(Buffer.concat([good, Buffer.from("trailing")]), "bytes after the end");
  no(Buffer.concat([good.subarray(0, good.length - 1024), Buffer.alloc(512, 0x41), Buffer.alloc(1024)]), "a block of rubbish at the end");
  no(good.subarray(0, good.length - 1024), "no end");
  no(goodAnswer("about.html", "about"), "a page not asked for");
  no(answer([["report.json", reportOf(PAGE("index.html"))], ["shot-about-1280-light.png", png()]]), "a picture of another page");
  no(Buffer.from("not a tar at all"), "not a tar");
  no("text", "not bytes");
  assert.equal(readShotsTar(goodAnswer("about.html", "about"), { pages: ["about.html"] }).ok, true);
  assert.equal(readShotsTar(good).ok, true, "without pages, any page");
});

test("report lines: each sentence once, from a fixture report and a kit", () => {
  const kit = { colours: ["#1A3C5E", "#E8DCC8"], families: ["Didot", "Avenir Next"], minPx: 16 };
  const page = PAGE("index.html", {
    errors: ["TypeError: x is not a function", "second"],
    wider: [{ tag: "div", cls: "hero wide", width: 512, at: 390 }],
    missing: ["img/a.png", "img/b.png"],
    blocked: ["example.com:443", "evil.test:80", "127.0.0.1:3110"],
    a11y: { noAlt: 2, noLabel: 3, noLang: true, noTitle: true, headingSkips: 2, smallTargets: 4 },
    contrast: [{ text: "Small grey", fg: "#AAAAAA", bg: "#FFFFFF", ratio: 2.32 }],
    fonts: [{ family: "Avenir Next", minPx: 12 }, { family: "Arial", minPx: 14 }],
    colours: ["#1A3C5E", "#FFFFFF", "#F4F4F5", "#FF00AA", "#E8DCC8"],
    drawn: ["Avenir Next", "Helvetica"],
    cut: "time",
  });
  assert.deepEqual(reportLines(page, kit), [
    "2 errors in the page's console, such as: TypeError: x is not a function",
    "Wider than the screen at 390 px: div.hero.wide (512 px)",
    "Pictures that did not load: img/a.png, img/b.png",
    "The page tried to reach 3 other addresses; each was blocked.",
    "2 pictures have no description (alt)",
    "3 form fields have no label",
    "The page does not say its language",
    "The page has no title",
    "Headings skip a level 2 times",
    "4 links or buttons are smaller than 24 px",
    "Hard to read: \"Small grey\" (#AAAAAA on #FFFFFF, 2.32 to 1)",
    "Faces that are not your kit's: Helvetica",
    "Smallest text: 12 px; your kit's smallest is 16 px",
    "Colours that are not in your kit: #FF00AA",
    "This page was cut: it took too long to open.",
    "Drawn with: Avenir Next, Helvetica",
  ]);
  // Nothing found; and without a kit no kit line is said.
  assert.deepEqual(reportLines(PAGE("index.html"), kit), ["Nothing to fix was found.", "Drawn with: Avenir Next"]);
  assert.deepEqual(reportLines({ ...page, drawn: [], fonts: [{ family: "Arial", minPx: 9 }], colours: ["#FF00AA"] }, null).filter((l) => /kit/.test(l)), []);
  // One of each reads as one; a long error is cut at 120 characters.
  const one = reportLines(PAGE("index.html", { errors: ["e".repeat(400)], blocked: ["a:1"], a11y: { noAlt: 1, noLabel: 1, noLang: false, noTitle: false, headingSkips: 1, smallTargets: 1 } }), kit);
  assert.equal(one[0], `1 error in the page's console: ${"e".repeat(120)}`);
  assert.ok(one.includes("The page tried to reach 1 other address; it was blocked."));
  assert.ok(one.includes("1 picture has no description (alt)") && one.includes("1 form field has no label") && one.includes("Headings skip a level once") && one.includes("1 link or button is smaller than 24 px"));
  assert.deepEqual(reportLines(null, kit), []);
  assert.deepEqual(reportLines({ page: "../x.html" }, kit), []);
});

test("kept pictures: read back by key, a shot only by its pattern, as a PNG, never through a link", () => {
  withGoal((g) => {
    const key = "a".repeat(64);
    keepFor(g, key, ["shot-index-1280-light.png", "shot-index-390-light.png"]);
    writeFileSync(join(g.config.paths.homeData, "shots", key, "notes.txt"), "x");
    const k = keptShots(g.config, key);
    assert.deepEqual(k.names.sort(), ["shot-index-1280-light.png", "shot-index-390-light.png"]);
    assert.equal(k.taken, "2026-11-13T10:00:00.000Z");
    assert.ok(pngOk(readShot(g.config, key, "shot-index-1280-light.png")));
    for (const [kk, n] of [[key, "notes.txt"], [key, "../report.json"], ["A".repeat(64), "shot-index-1280-light.png"], ["a".repeat(63), "shot-index-1280-light.png"], [key, "shot-index-800-light.png"]]) {
      assert.equal(readShot(g.config, kk, n), null, `${kk.slice(0, 4)} ${n}`);
    }
    writeFileSync(join(g.config.paths.homeData, "shots", key, "shot-index-390-dark.png"), "<svg onload=alert(1)>");
    assert.equal(readShot(g.config, key, "shot-index-390-dark.png"), null, "bytes that are not a PNG are never served");
    const other = join(g.root, "other.png");
    writeFileSync(other, png());
    symlinkSync(other, join(g.config.paths.homeData, "shots", key, "shot-index-1280-dark.png"));
    assert.equal(readShot(g.config, key, "shot-index-1280-dark.png"), null, "a link is not followed");
    assert.equal(keptShots(g.config, "b".repeat(64)), null);
  });
});

test("kept pictures are at most a cap in all, the oldest removed first; a write that did not finish is removed", () => {
  const root = mkdtempSync(join(tmpdir(), "uuu-shots-prune-"));
  try {
    const keys = ["1", "2", "3", "4"].map((c) => c.repeat(64));
    keys.forEach((k, i) => {
      mkdirSync(join(root, k));
      writeFileSync(join(root, k, "shot-index-1280-light.png"), Buffer.alloc(1000));
      utimesSync(join(root, k), new Date(2026, 0, i + 1), new Date(2026, 0, i + 1));
    });
    mkdirSync(join(root, ".new-0123456789ab"));
    pruneShots(root, 2500, keys[0]);
    assert.deepEqual(readdirSync(root).sort(), [keys[0], keys[3]].sort(), "the oldest went first, but never the one kept");
    pruneShots(root, 10000, null);
    assert.equal(readdirSync(root).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the state of a site's pictures: off with the switch off and no call, ready when kept, failed with its sentence", async () => {
  await withGoal(async (g) => {
    threeVersions(g);
    const info = siteInfo(g.config, "STH-12", "site/launch-a");
    assert.equal(shotsView(g.config, info, { on: false }).state, "off");
    assert.equal(shotsView(g.config, info, { on: false }).sentence, SAY.off);
    assert.equal(shotsView(g.config, info, { on: true }).state, "none");
    // Switch off: takeShots answers off and calls nothing (no address would be needed to show it).
    const ctx = { config: g.config, home: { urls: { viewer: "http://127.0.0.1:9" } } };
    assert.deepEqual(await takeShots(ctx, "STH-12", "launch-a"), { state: "off", sentence: SAY.off });
    keepFor(g, info.key, ["shot-index-1280-light.png", "shot-index-390-light.png", "shot-index-390-dark.png"]);
    const ready = shotsView(g.config, info, { on: false, kit: null });
    assert.equal(ready.state, "ready");
    assert.deepEqual(ready.images.map((i) => [i.page, i.width, i.scheme]), [["index.html", 1280, "light"], ["index.html", 390, "light"], ["index.html", 390, "dark"]]);
    assert.ok(ready.images.every((i) => i.url === `/api/sites/shot/${info.key}/shot-index-${i.width}-${i.scheme}.png` && SHOT_NAME.test(i.url.split("/").pop())));
    assert.deepEqual(ready.report, [{ page: "index.html", lines: ["Nothing to fix was found.", "Drawn with: Avenir Next"] }]);
    const bad = siteInfo(g.config, "STH-12", "site/nowhere");
    assert.deepEqual(shotsView(g.config, bad, { on: true }).state, "failed");
  });
});

test("the pick card's preview of a page version: the index page at 1280 then 390, light; else one sentence", () => {
  withGoal((g) => {
    threeVersions(g);
    const v = placeOf("page", "launch", "a");
    assert.deepEqual(previewOf(g.config, "STH-12", "page", v), [{ type: "text", text: "Pictures of this version are not taken yet: the page viewer is off." }]);
    mkdirSync(g.config.paths.doors, { recursive: true, mode: 0o700 });
    writeFileSync(g.config.paths.doorsState, JSON.stringify({ version: 1, web: { on: false }, generate: { on: false }, viewer: { on: true } }), { mode: 0o600 });
    assert.deepEqual(previewOf(g.config, "STH-12", "page", v), [{ type: "text", text: "Pictures of this version are not taken yet." }]);
    const key = siteInfo(g.config, "STH-12", "site/launch-a").key;
    keepFor(g, key, ["shot-index-390-light.png", "shot-index-1280-light.png", "shot-index-1280-dark.png", "shot-about-1280-light.png"]);
    const pics = previewOf(g.config, "STH-12", "page", v);
    assert.deepEqual(pics, [
      { type: "image", url: `/api/sites/shot/${key}/shot-index-1280-light.png`, file: "shot-index-1280-light.png" },
      { type: "image", url: `/api/sites/shot/${key}/shot-index-390-light.png`, file: "shot-index-390-light.png" },
    ]);
    assert.equal(previewIsChecked("page", pics), true, "the check reads the page's own files");
    assert.equal(previewIsChecked("page", []), true);
    assert.deepEqual(pagePreview(g.config, "STH-12", placeOf("page", "launch", "b")), [{ type: "text", text: "Pictures of this version are not taken yet." }]);
    assert.ok(readFileSync(join(g.config.paths.homeData, "shots", key, "report.json"), "utf8").includes("index.html"));
  });
});
