// The brand kit's routes (PLAN-V5 K5) on the version 2 seed: a save writes the four files and reads back,
// pictures must be the store's own, a stale version is refused as the forms refuse it, a GET writes nothing,
// fonts are checked by their first bytes and counted, links are never written through, and an agent's
// brand-proposal.json can never make the route fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadBrainForms } from "../../../company/lib/brain-files.mjs";
import { parseForm } from "../brain/forms.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { IDS_V3 } from "../../../test/stubs/seed.mjs";

const BRAND_FORM = loadBrainForms(join(import.meta.dirname, "..", "..", "..", "company", "brain", "forms")).forms.find((f) => f.id === "brand");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const OTF = Buffer.concat([Buffer.from("OTTO"), Buffer.alloc(2000, 1)]);

let H = null;
async function withHome(fn) {
  const h = await startV2({ routes: ["brain", "brand-kit"], log: (l) => logs.push(l) });
  h.config.minFreeDiskGb = 0;
  H = h;
  try { return await fn(h); } finally { await h.close(); }
}
const get = (h, path) => call(h.url, "GET", path);
const post = (h, path, body) => call(h.url, "POST", path, { body });
const del = (h, path) => call(h.url, "DELETE", path);
const logs = [];
const brand = (...p) => join(H.config.paths.state, "knowledge", "docs", "brand", ...p);
const mode = (p) => statSync(p).mode & 0o777;

async function addPicture(h, folder, name) {
  const r = await post(h, "/api/brain/files", { folder, name, base64: PNG.toString("base64") });
  assert.equal(r.status, 201, r.text);
}

function kitBody() {
  return {
    version: 1, savedAt: null, name: "Sthyra",
    colours: [{ name: "ink", hex: "#1a3c5e", role: "main" }, { name: "sand", hex: "#E8DCC8", role: "background" }],
    neutrals: true,
    type: { heading: { family: "Didot", file: null, fallback: "serif" }, body: { family: "Avenir Next", file: null, fallback: "sans-serif" }, minPx: 16, minSlidePx: 28 },
    logo: { files: [{ file: "logo.png", on: "light" }], clearSpace: 0.5, minPx: 48, requiredOn: ["carousel-last", "poster", "title-card", "end-card", "page"] },
    layout: { radiusPx: 0, marginShare: 0.06 },
    voice: { words: ["warm", "plain", "exact"], is: "Like an architect on site.", do: ["Name the street."], dont: ["Say luxury."], signoff: "With care" },
    references: [{ file: "references/tower-dusk.png", kinds: ["carousel", "film"], note: "The light on the stone." }],
    filler: { block: true, allow: [] }, public: { summary: "An architecture studio." },
  };
}

// The pictures the kit names, then GET for the version, then a save.
async function setUp(h) {
  await addPicture(h, "brand", "logo.png");
  await addPicture(h, "references", "tower-dusk.png");
  const first = await get(h, "/api/brand/kit");
  assert.equal(first.status, 200, first.text);
  return first.json.version;
}
async function save(h, kit = kitBody(), version) {
  if (version === undefined) version = (await get(h, "/api/brand/kit")).json.version;
  return post(h, "/api/brand/kit", { kit, version });
}

// Every file under a folder with its size, time and mode: what a GET must leave as it was.
function snapshot(root) {
  const out = [];
  const walk = (dir, rel) => {
    let names = [];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      const st = lstatSync(p);
      out.push(`${rel}${n} ${st.isDirectory() ? "dir" : st.size} ${st.mtimeMs} ${st.mode}`);
      if (st.isDirectory()) walk(p, `${rel}${n}/`);
    }
  };
  walk(root, "");
  return out;
}

test("a full kit saves, writes the four files at 0644 and reads back the same; the answer fits shapes/brand-kit.json", () => withHome(async (h) => {
  await setUp(h);
  const r = await save(h);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.kit.colours[0].hex, "#1A3C5E");
  assert.match(r.json.kit.savedAt, /^\d{4}-\d\d-\d\dT/);
  const back = await get(h, "/api/brand/kit");
  assert.equal(back.status, 200);
  assert.deepEqual(back.json.kit, r.json.kit);
  assert.equal(back.json.exists, true);
  assert.equal(back.json.fromOldForm, false);
  assert.equal(back.json.version, r.json.version);
  assert.equal(back.json.proposal, null);
  assert.deepEqual(sameShape(readShape("brand-kit"), { ...back.json, proposal: { from: "STH-1", values: {}, dropped: [], problem: null } }), []);
  assert.deepEqual(JSON.parse(readFileSync(brand("kit.json"), "utf8")), r.json.kit);
  for (const p of [brand("kit.json"), brand("kit.css"), brand("brand.md"), join(h.config.paths.state, "knowledge", "shared", "brand-public.md")]) {
    assert.equal(mode(p), 0o644, p);
    assert.ok(lstatSync(p).isFile(), p);
  }
  assert.equal(mode(join(h.config.paths.state, "knowledge", "shared")), 0o755);
  assert.ok(readFileSync(brand("kit.css"), "utf8").includes("--brand-ink: #1A3C5E;"));
  // No temp file is left behind.
  assert.deepEqual(readdirSync(brand()).filter((n) => n.endsWith(".tmp")), []);
}));

test("brand.md is replaced through the store: its version moves, the old form reads it, the search index finds the new words", () => withHome(async (h) => {
  await setUp(h);
  const before = await get(h, "/api/brain/folder/brand");
  const old = before.json.files.find((f) => f.name === "brand.md");
  assert.equal((await save(h)).status, 200);
  const after = (await get(h, "/api/brain/folder/brand")).json.files.find((f) => f.name === "brand.md");
  assert.notEqual(after.version, old.version);
  const values = parseForm(BRAND_FORM, readFileSync(brand("brand.md"), "utf8")).values;
  assert.deepEqual(values, { tone: ["warm", "plain", "exact"], colours: ["#1A3C5E", "#E8DCC8"], fonts: "Didot", signoff: "With care", logo: "logo.png" });
  const found = await get(h, "/api/brain/search?q=Colours%20by%20name");
  assert.ok(found.json.results.some((x) => x.path === "brand/brand.md"));
  // The kit's files are not in the store's listing: no agent-facing .json or .css appears as a brain file.
  assert.ok(!(await get(h, "/api/brain/folder/brand")).json.files.some((f) => /kit\.(json|css)$/.test(f.name)));
}));

test("brand-public.md in knowledge/shared holds only the name, the voice words and the public summary", () => withHome(async (h) => {
  await setUp(h);
  assert.equal((await save(h)).status, 200);
  const md = readFileSync(join(h.config.paths.state, "knowledge", "shared", "brand-public.md"), "utf8");
  for (const w of ["# Sthyra", "warm", "plain", "exact", "An architecture studio."]) assert.ok(md.includes(w), w);
  for (const s of ["#1A3C5E", "ink", "Didot", "logo", "architect on site", "Name the street", "luxury", "With care", "tower-dusk"]) assert.ok(!md.includes(s), s);
}));

test("a logo or reference file that is not in the store's listing is refused at its field, and nothing is written", () => withHome(async (h) => {
  await setUp(h);
  const k1 = kitBody();
  k1.logo.files[0].file = "missing.png";
  let r = await save(h, k1);
  assert.equal(r.status, 400, `${r.text} ${logs.join(" / ")}`);
  assert.equal(r.json.error.code, "bad_kit");
  assert.equal(r.json.field, "logo.files.0.file");
  assert.match(r.json.error.message, /Logo file 1 must be one of the pictures in Brand\./);
  // A picture placed by hand as a link is not listed by the store, so it is refused too.
  symlinkSync(brand("logo.png"), join(h.config.paths.state, "knowledge", "docs", "references", "linked.png"));
  const k2 = kitBody();
  k2.references[0].file = "references/linked.png";
  r = await save(h, k2);
  assert.equal(r.status, 400);
  assert.equal(r.json.field, "references.0.file");
  // A text file in Brand is not a picture.
  const k3 = kitBody();
  k3.logo.files[0].file = "brand.md";
  assert.equal((await save(h, k3)).json.field, "logo.files.0.file");
  assert.equal(existsSync(brand("kit.json")), false);
}));

test("a save with a stale version is refused as the forms refuse it; the first save must name the old brand file's version", () => withHome(async (h) => {
  const v0 = await setUp(h);
  assert.match(v0, /^k0-b\d+$/);
  let r = await save(h, kitBody(), null);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "changed_since_seen");
  r = await save(h, kitBody(), v0);
  assert.equal(r.status, 200, r.text);
  // The version seen before that save is stale now, and so is null.
  for (const v of [v0, null, "k1-b1"]) {
    const again = await save(h, kitBody(), v);
    assert.equal(again.status, 409, String(v));
    assert.equal(again.json.error.code, "changed_since_seen");
  }
  // A version that is not a string is a bad request.
  assert.equal((await post(h, "/api/brand/kit", { kit: kitBody(), version: 5 })).status, 400);
  assert.equal((await post(h, "/api/brand/kit", { version: r.json.version })).status, 400);
}));

test("with no kit.json and the old brand.md, GET offers its tone, colours, typeface and sign-off, and exists is false", () => withHome(async (h) => {
  const r = await get(h, "/api/brand/kit");
  assert.equal(r.status, 200);
  assert.equal(r.json.exists, false);
  assert.equal(r.json.fromOldForm, true);
  assert.deepEqual(r.json.kit.colours, [
    { name: "colour-1", hex: "#1F3A34", role: "main" }, { name: "colour-2", hex: "#E8B04A", role: "other" }, { name: "colour-3", hex: "#F4EFE6", role: "other" },
  ]);
  assert.deepEqual(r.json.kit.voice.words, ["warm", "plain", "exact"]);
  assert.equal(r.json.kit.voice.signoff, "With care, from the workshop");
  assert.equal(r.json.kit.type.heading.family, "Avenir Next");
  assert.ok(r.json.fontsOnThisMac.includes("Didot"));
  assert.ok(Array.isArray(r.json.playbooks));
  assert.deepEqual(r.json.fontsUploaded, []);
}));

test("nothing is written by a GET, with or without a proposal", () => withHome(async (h) => {
  await setUp(h);
  const goal = join(h.config.paths.state, "tasks", "company-work", "STH-12");
  mkdirSync(goal, { recursive: true });
  writeFileSync(join(goal, "brand-proposal.json"), JSON.stringify({ name: "Sthyra" }));
  const before = snapshot(h.config.paths.state).filter((l) => !l.startsWith("home/"));
  for (const q of ["", "?proposal=STH-12", "?proposal=STH-99", `?proposal=${IDS_V3.issues["STH-20"]}`, "?proposal=../x"]) {
    assert.equal((await get(h, `/api/brand/kit${q}`)).status, 200, q);
  }
  assert.deepEqual(snapshot(h.config.paths.state).filter((l) => !l.startsWith("home/")), before);
  assert.equal(existsSync(join(h.config.paths.state, "knowledge", "shared")), false);
}));

test("a proposal: its good parts are offered, a bad hex is dropped, by identifier or by task id; nothing of it is saved", () => withHome(async (h) => {
  await setUp(h);
  const goal = join(h.config.paths.state, "tasks", "company-work", "STH-20");
  mkdirSync(goal, { recursive: true });
  const proposal = { name: "Sthyra Studio", colours: [{ name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sand", hex: "#E8DCC8", role: "other" }, { name: "neon", hex: "#XYZXYZ", role: "accent" }], voice: { words: ["calm"], is: "Plain.", do: ["Be exact."], dont: [], signoff: "" } };
  writeFileSync(join(goal, "brand-proposal.json"), JSON.stringify(proposal));
  for (const id of ["STH-20", IDS_V3.issues["STH-20"]]) {
    const r = await get(h, `/api/brand/kit?proposal=${id}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.proposal.from, "STH-20");
    assert.equal(r.json.proposal.problem, null);
    assert.equal(r.json.proposal.values.name, "Sthyra Studio");
    assert.deepEqual(r.json.proposal.values.colours.map((c) => c.name), ["ink", "sand"]);
    assert.deepEqual(r.json.proposal.dropped, ["colours"]);
    assert.equal(r.json.kit.name, "", "the kit itself is not changed by a proposal");
  }
  assert.equal(existsSync(brand("kit.json")), false);
}));

test("a proposal that is a link, over 64 KB or not JSON gives a proposal with a plain problem, never an error", () => withHome(async (h) => {
  const root = join(h.config.paths.state, "tasks", "company-work");
  const cases = {
    "STH-31": (g) => { writeFileSync(join(h.config.paths.state, "outside.json"), JSON.stringify({ name: "Leaked" })); symlinkSync(join(h.config.paths.state, "outside.json"), join(g, "brand-proposal.json")); },
    "STH-32": (g) => writeFileSync(join(g, "brand-proposal.json"), JSON.stringify({ name: "Big", pad: "x".repeat(70 * 1024) })),
    "STH-33": (g) => writeFileSync(join(g, "brand-proposal.json"), "{ not json"),
    "STH-34": (g) => writeFileSync(join(g, "brand-proposal.json"), "[1, 2, 3]"),
    "STH-35": () => {},
  };
  for (const [id, make] of Object.entries(cases)) {
    const g = join(root, id);
    mkdirSync(g, { recursive: true });
    make(g);
    const r = await get(h, `/api/brand/kit?proposal=${id}`);
    assert.equal(r.status, 200, id);
    assert.deepEqual(r.json.proposal.values, {}, id);
    assert.match(r.json.proposal.problem, /^[A-Z].*\.$/, id);
    assert.ok(!r.text.includes("Leaked"), id);
  }
  // A goal folder that is a link is not read either.
  mkdirSync(join(h.config.paths.state, "elsewhere"));
  writeFileSync(join(h.config.paths.state, "elsewhere", "brand-proposal.json"), JSON.stringify({ name: "Leaked" }));
  symlinkSync(join(h.config.paths.state, "elsewhere"), join(root, "STH-36"));
  const r = await get(h, "/api/brand/kit?proposal=STH-36");
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes("Leaked"));
  // An address that is neither an identifier nor a task id.
  const odd = await get(h, "/api/brand/kit?proposal=%3Cscript%3E");
  assert.equal(odd.status, 200);
  assert.equal(odd.json.proposal.from, null);
}));

test("fonts: an upload is stored at 0644 by its cleaned name and can be used and named in kit.css", () => withHome(async (h) => {
  await setUp(h);
  const up = await post(h, "/api/brand/kit/font", { name: "Sthyra Display.otf", base64: OTF.toString("base64") });
  assert.equal(up.status, 201, up.text);
  assert.deepEqual(up.json.font, { file: "Sthyra-Display.otf", size: OTF.length });
  assert.equal(mode(brand("fonts", "Sthyra-Display.otf")), 0o644);
  assert.equal(mode(brand("fonts")), 0o755);
  const kit = kitBody();
  kit.type.heading = { family: "Sthyra Display", file: "Sthyra-Display.otf", fallback: "serif" };
  const r = await save(h, kit);
  assert.equal(r.status, 200, r.text);
  const css = readFileSync(brand("kit.css"), "utf8");
  assert.ok(css.includes('@font-face { font-family: "Sthyra Display"; src: url("fonts/Sthyra-Display.otf"); }'));
  assert.deepEqual((await get(h, "/api/brand/kit")).json.fontsUploaded, [{ file: "Sthyra-Display.otf", size: OTF.length }]);
  // The same name again is refused, never replaced.
  const again = await post(h, "/api/brand/kit/font", { name: "Sthyra Display.otf", base64: Buffer.concat([Buffer.from("OTTO"), Buffer.alloc(10)]).toString("base64") });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "font_exists");
  assert.equal(statSync(brand("fonts", "Sthyra-Display.otf")).size, OTF.length);
  // A font the saved kit uses cannot be removed; once the kit no longer uses it, it can.
  let d = await del(h, "/api/brand/kit/font/Sthyra-Display.otf");
  assert.equal(d.status, 409);
  assert.equal(d.json.error.code, "font_in_use");
  assert.equal((await save(h, kitBody())).status, 200);
  d = await del(h, "/api/brand/kit/font/Sthyra-Display.otf");
  assert.equal(d.status, 200, d.text);
  assert.equal(existsSync(brand("fonts", "Sthyra-Display.otf")), false);
  assert.equal((await del(h, "/api/brand/kit/font/Sthyra-Display.otf")).status, 404);
  assert.equal((await del(h, "/api/brand/kit/font/..%2Fkit.json")).status, 404);
  assert.ok(existsSync(brand("kit.json")));
}));

test("fonts: wrong first bytes, a seventh font and a 6 MB font are refused", () => withHome(async (h) => {
  let r = await post(h, "/api/brand/kit/font", { name: "x.ttf", base64: Buffer.from("<svg onload=alert(1)>").toString("base64") });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "font_type");
  r = await post(h, "/api/brand/kit/font", { name: "x.ttf", base64: "not base64!" });
  assert.equal(r.status, 400);
  for (let i = 1; i <= 6; i += 1) {
    r = await post(h, "/api/brand/kit/font", { name: `f${i}.ttf`, base64: Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(32)]).toString("base64") });
    assert.equal(r.status, 201, `${i} ${r.text}`);
  }
  r = await post(h, "/api/brand/kit/font", { name: "f7.ttf", base64: Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(32)]).toString("base64") });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "too_many_fonts");
  assert.equal(existsSync(brand("fonts", "f7.ttf")), false);
  const big = Buffer.concat([Buffer.from("OTTO"), Buffer.alloc(6 * 1024 * 1024)]);
  r = await post(h, "/api/brand/kit/font", { name: "big.otf", base64: big.toString("base64") });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, "font_too_large");
  assert.equal(existsSync(brand("fonts", "big.otf")), false);
}));

test("links are never written through: kit.json or kit.css as a link, a brand folder that is a link", () => withHome(async (h) => {
  await setUp(h);
  const outside = join(h.config.paths.state, "outside.txt");
  writeFileSync(outside, "untouched");
  symlinkSync(outside, brand("kit.css"));
  let r = await save(h);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "folder_unsafe");
  assert.equal(readFileSync(outside, "utf8"), "untouched");
  assert.ok(lstatSync(brand("kit.css")).isSymbolicLink());
  // Refused before anything was written: no kit.json, brand.md as it was, nothing shared.
  assert.equal(existsSync(brand("kit.json")), false);
  assert.ok(!readFileSync(brand("brand.md"), "utf8").includes("Colours by name"));
  assert.equal(existsSync(join(H.config.paths.state, "knowledge", "shared")), false);
  // A kit.json that is a link is never read as the kit.
  writeFileSync(join(h.config.paths.state, "fake-kit.json"), JSON.stringify({ ...kitBody(), name: "Forged" }));
  symlinkSync(join(h.config.paths.state, "fake-kit.json"), brand("kit.json"));
  const g = await get(h, "/api/brand/kit");
  assert.equal(g.status, 200);
  assert.equal(g.json.problem, "kit_unreadable");
  assert.notEqual(g.json.kit.name, "Forged");
}));

test("a brand folder that is a link is refused for a save and a font", () => withHome(async (h) => {
  const docs = join(h.config.paths.state, "knowledge", "docs");
  const real = join(h.config.paths.state, "elsewhere-brand");
  mkdirSync(real);
  // Move the seed's brand folder aside and put a link in its place.
  const { renameSync } = await import("node:fs");
  renameSync(join(docs, "brand"), join(h.config.paths.state, "old-brand"));
  symlinkSync(real, join(docs, "brand"));
  const g = await get(h, "/api/brand/kit");
  assert.equal(g.status, 200);
  assert.equal(g.json.exists, false);
  const r = await save(h, { ...kitBody(), logo: { ...kitBody().logo, files: [] }, references: [] }, null);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error.code, "folder_unsafe");
  const f = await post(h, "/api/brand/kit/font", { name: "x.otf", base64: OTF.toString("base64") });
  assert.equal(f.status, 409);
  assert.deepEqual(readdirSync(real), []);
}));

test("a write that did not come from the home screen is refused before anything is read", () => withHome(async (h) => {
  const r = await call(h.url, "POST", "/api/brand/kit", { body: { kit: kitBody(), version: null }, headers: { "x-engine": "0" } });
  assert.equal(r.status, 403);
  const d = await call(h.url, "DELETE", "/api/brand/kit/font/x.ttf", { bare: true });
  assert.equal(d.status, 403);
}));
