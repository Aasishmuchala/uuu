// Files, Brand kit (PLAN-V5 K5, T14): the page's pure helpers, on the pinned `brand-kit` shape. The kit and the
// form state, the colour rules, a proposal laid beside the form and used part by part, what changed, where a
// refusal's field belongs, and the source: no address but its own API paths, nothing set as HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const shape = (name) => JSON.parse(readFileSync(resolve(SHAPES, `${name}.json`), "utf8"));
const SOURCE = readFileSync(new URL("../../pages/brand-kit.js", import.meta.url), "utf8");
const FILES_SOURCE = readFileSync(new URL("../../pages/files.js", import.meta.url), "utf8");
const stripJsComments = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");

const m = await import("../../pages/brand-kit.js");
const files = await import("../../pages/files.js");
const view = shape("brand-kit");

test("brand kit: the page is a component and the plan's sentences are used as written", () => {
  assert.equal(typeof m.default, "function");
  assert.equal(m.WORDS.card, "Brand kit: your colours, type, logo, voice and examples. Agents' tools obey it.");
  assert.equal(m.WORDS.fromBook, "From your brand book. Nothing is saved until you press Save.");
  assert.equal(m.WORDS.saved, "Saved. Every tool uses this from now on.");
  assert.equal(m.WORDS.restart, "This page appears after the home screen is restarted: engine stop, then engine start.");
  assert.equal(m.WORDS.researcher, "Only this, your company's name and your voice words are shared with the Researcher.");
  assert.equal(m.WORDS.noPicks, "Nothing yet. When you pick between versions, your choices and notes are kept here for the agents.");
  assert.equal(m.WORDS.noPlaybooks, "Playbooks are not in place yet. See Health.");
  assert.deepEqual(Object.values(m.PLACE_WORDS), ["The last slide of a carousel", "Posters", "Title cards", "End cards", "Web pages"]);
  assert.equal(`Brand kit: ${files.BRAND_KIT_WORDS}`, m.WORDS.card);
});

test("brand kit: the address, and what the page draws for each answer", () => {
  assert.equal(m.kitAddress(""), "/api/brand/kit");
  assert.equal(m.kitAddress("STH-12"), "/api/brand/kit?proposal=STH-12");
  assert.equal(m.kitAddress("../x"), "/api/brand/kit");
  assert.equal(m.kitAddress("a&b=c"), "/api/brand/kit");
  assert.equal(m.viewState({ loading: true }), "loading");
  assert.equal(m.viewState({ error: { status: 404 } }), "restart");
  assert.equal(m.viewState({ error: { status: 500 } }), "error");
  assert.equal(m.viewState({ data: view }), "ready");
});

test("brand kit: kit to form state and back is the same kit", () => {
  const form = m.formFromKit(view.kit);
  assert.equal(form.type.minPx, "16");
  assert.equal(form.type.minSlidePx, "28");
  assert.equal(form.logo.minPx, "48");
  const back = m.kitFromForm(form);
  const { version, savedAt, ...rest } = view.kit;
  assert.deepEqual(back, rest);
  // A typed size that is not a number goes as text, for the server to name the field.
  assert.equal(m.kitFromForm({ ...form, type: { ...form.type, minPx: "big" } }).type.minPx, "big");
  // Tidying: names and hex as the rules want them, empty lines left out.
  const k = m.kitFromForm({ ...form, colours: [{ name: " Deep Ink ", hex: "1a3c5e", role: "main" }], voice: { ...form.voice, do: ["  Name the street. ", "", " "] } });
  assert.deepEqual(k.colours, [{ name: "deep-ink", hex: "#1A3C5E", role: "main" }]);
  assert.deepEqual(k.voice.do, ["Name the street."]);
  // Nothing missing: an empty start is a whole kit.
  assert.deepEqual(Object.keys(m.kitFromForm(m.formFromKit(null))).sort(), ["colours", "filler", "layout", "logo", "name", "neutrals", "public", "references", "type", "voice"]);
});

test("brand kit: the colour rules, one main colour always", () => {
  assert.deepEqual(m.colourProblems(view.kit.colours), []);
  assert.equal(m.colourProblems([{ name: "ink", hex: "#1A3C5E", role: "main" }])[0].field, "colours");
  const two = [{ name: "ink", hex: "#1A3C5E", role: "main" }, { name: "ink", hex: "#zz", role: "main" }];
  const fields = m.colourProblems(two).map((p) => p.field);
  assert.ok(fields.includes("colours.1.name"));
  assert.ok(fields.includes("colours.1.hex"));
  assert.ok(m.colourProblems(two).some((p) => p.message === "Only one colour can be the main colour."));
  assert.ok(m.colourProblems([{ name: "a", hex: "#000000", role: "other" }, { name: "b", hex: "#FFFFFF", role: "other" }]).some((p) => p.message === "Mark one colour as the main colour."));
  // Choosing main moves it; removing the main gives it to the first left; the first added is main.
  const moved = m.withRole(view.kit.colours, 1, "main");
  assert.deepEqual(moved.map((c) => c.role), ["other", "main"]);
  assert.deepEqual(m.removeColour(view.kit.colours, 0).map((c) => c.role), ["main"]);
  assert.equal(m.addColour([])[0].role, "main");
  assert.equal(m.addColour(view.kit.colours)[2].role, "other");
  assert.equal(m.addColour(Array.from({ length: 8 }, () => ({ role: "other" }))).length, 8);
  assert.equal(m.normHex(" #1a3c5e "), "#1A3C5E");
  assert.equal(m.normHex("red"), "red");
  assert.equal(m.safeHex("url(x)"), null);
  assert.equal(m.normName("Warm Sand!"), "warm-sand");
});

test("brand kit: colours read on their ground; the logo's two grounds come from the kit", () => {
  assert.equal(m.inkOn("#1A3C5E"), "#FFFFFF");
  assert.equal(m.inkOn("#E8DCC8"), "#141414");
  assert.ok(m.contrast("#000000", "#FFFFFF") > 20);
  assert.deepEqual(m.stages(view.kit.colours), { light: "#E8DCC8", dark: "#1A3C5E" });
  assert.deepEqual(m.stages([]), { light: "#FFFFFF", dark: "#141414" });
});

test("brand kit: faces, uploaded fonts and their names", () => {
  assert.equal(m.familyFromFile("Sthyra-Display.otf"), "Sthyra Display");
  assert.equal(m.familyFromFile("!!.ttf"), "Uploaded font");
  assert.equal(m.fontStack({ family: "Didot", fallback: "serif" }), "\"Didot\", serif");
  assert.equal(m.fontStack({ family: "x\"; background: url(y)", fallback: "serif" }), "inherit");
  const opts = m.faceOptions(view.fontsOnThisMac, view.fontsUploaded);
  assert.deepEqual(opts.map((o) => o.value), ["mac:Avenir Next", "mac:Didot", "file:Sthyra-Display.otf"]);
  assert.deepEqual(m.faceFrom("file:Sthyra-Display.otf", { fallback: "serif" }), { family: "Sthyra Display", file: "Sthyra-Display.otf", fallback: "serif" });
  assert.deepEqual(m.faceFrom("mac:Didot", { fallback: "sans-serif" }), { family: "Didot", file: null, fallback: "serif" });
  assert.equal(m.faceValue(view.kit.type.heading), "mac:Didot");
});

test("brand kit: a proposal is laid beside the form, voice line by line, and used part by part", () => {
  const proposal = { from: "STH-12", values: { colours: [{ name: "ink", hex: "#1A3C5E", role: "main" }, { name: "clay", hex: "#B5653A", role: "accent" }], voice: { words: ["warm"], is: "", do: ["Name the street."], dont: [], signoff: "" } }, dropped: ["logo"], problem: null };
  const offers = m.offersOf({ proposal });
  assert.deepEqual(Object.keys(offers).sort(), ["colours", "voice.do", "voice.words"]);
  assert.equal(offers.colours.from, "book");
  const form = m.formFromKit(m.emptyKit());
  assert.equal(m.offerUsed(form, offers.colours), false);
  const used = m.useOffer(form, "colours", offers.colours.value);
  assert.deepEqual(used.colours.map((c) => c.name), ["ink", "clay"]);
  assert.equal(m.offerUsed(used, offers.colours), true);
  const doLine = m.useOffer(used, "voice.do", offers["voice.do"].value);
  assert.deepEqual(doLine.voice.do, ["Name the street."]);
  assert.deepEqual(doLine.voice.words, [], "only the do lines are used");
  assert.deepEqual(m.useOffer(form, "../x", 1), form);
  // The old brand page is offered the same way, only where it differs from an empty kit; the brand book wins.
  const old = { ...m.emptyKit(["Helvetica Neue"]), name: "Sthyra", colours: [{ name: "colour-1", hex: "#111111", role: "main" }] };
  const both = m.offersOf({ proposal, oldKit: old, families: ["Helvetica Neue"] });
  assert.equal(both.name.from, "old");
  assert.equal(both.colours.from, "book");
  assert.equal(both.type, undefined);
  assert.deepEqual(m.offersOf({ proposal: view.proposal }), {});
});

test("brand kit: what changed, what is filled, and where a refusal shows", () => {
  const a = m.kitFromForm(m.formFromKit(view.kit));
  assert.deepEqual(m.changedParts(a, a), []);
  const b = { ...a, neutrals: false, voice: { ...a.voice, signoff: "x" }, public: { summary: "y" } };
  assert.deepEqual(m.changedParts(a, b), ["Colours", "How we sound", "For the Researcher"]);
  const f = m.filledParts(view.kit, true);
  assert.deepEqual(f, { name: true, colours: true, type: true, logo: true, voice: true, references: true, public: false });
  assert.equal(m.nextPart(f), "public");
  assert.equal(m.nextPart(m.filledParts(m.emptyKit(), false)), "name");
  assert.equal(m.filledParts(m.emptyKit(), false).type, false);
  assert.deepEqual(m.fieldPlace("colours.2.hex"), { part: "colours", inline: true });
  assert.deepEqual(m.fieldPlace("colours"), { part: "colours", inline: false });
  assert.deepEqual(m.fieldPlace("logo.files.0.file"), { part: "logo", inline: false });
  assert.deepEqual(m.fieldPlace("neutrals"), { part: "colours", inline: false });
  assert.deepEqual(m.fieldPlace("type.minPx"), { part: "type", inline: true });
  assert.deepEqual(m.fieldPlace("voice.dont.3"), { part: "voice", inline: true });
  assert.deepEqual(m.fieldPlace(null), { part: null, inline: false });
});

test("brand kit: logos, the taste file and the playbooks' words", () => {
  const files2 = m.toggleLogo([], "logo.png", "light");
  assert.deepEqual(files2, [{ file: "logo.png", on: "light" }]);
  assert.deepEqual(m.toggleLogo(files2, "logo.png", "light"), []);
  const four = ["a", "b", "c", "d"].map((f) => ({ file: f, on: "light" }));
  assert.equal(m.toggleLogo(four, "e", "dark").length, 4);
  assert.deepEqual(m.tasteLines("# Taste\n\n## Carousel\n- 12 Nov 2026: picked \"Picture led\".\n"), [{ kind: "head", text: "Carousel" }, { kind: "line", text: "12 Nov 2026: picked \"Picture led\"." }]);
  assert.equal(m.roleName("art-director"), "Art director");
  assert.equal(m.roleName("<b>"), "");
});

test("brand kit: the source holds no address but its own, and never sets HTML", () => {
  const code = stripJsComments(SOURCE);
  const paths = [...code.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((x) => x[1]);
  const allowed = ["/api/brand/kit", "/api/brand/kit/font/", "/api/brain/file/", "/api/brain/folder/", "/api/brain/raw/"];
  assert.ok(paths.length >= 3);
  for (const p of paths) assert.ok(allowed.some((a) => p === a || p.startsWith(a)) || /^\/api\/brain\/raw\\\/\[/.test(p), `${p} is the page's own API path`);
  assert.doesNotMatch(code, /https?:\/\//);
  assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML/);
  // A picture's address is the brain's own raw address only; colours and faces pass a pattern before a style.
  assert.match(code, /\/\^\\\/api\\\/brain\\\/raw\\\//);
  assert.match(code, /style=\$\{h \? \{ background: h \}/);
});

test("brand kit: Files hands over its address and the old brand form leads to it", () => {
  assert.equal(files.isBrandKit(["files", "brand-kit"]), true);
  assert.equal(files.isBrandKit(["files", "brand"]), false);
  assert.equal(files.formLeadsToKit("brand"), true);
  assert.equal(files.formLeadsToKit("cant-say"), false);
  assert.match(FILES_SOURCE, /brandKit: \["\.\/brand-kit\.js", "default"\]/);
});
