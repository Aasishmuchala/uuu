// The brand kit's rules and the files written from it (PLAN-V5 K5), as pure code: a full kit round-trips,
// every rule refuses with one sentence naming its field, kit.css holds only tokens, brand.md is read back
// by the old brand form without loss, brand-public.md holds only what the Researcher may see, fonts are
// named by their first bytes, and an agent's proposal keeps only the parts that pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadBrainForms } from "../../../company/lib/brain-files.mjs";
import { parseForm } from "../brain/forms.mjs";
import {
  KitError, brandMarkdown, checkKit, fontFileName, fontKind, kitCss, kitFromOldForm, publicMarkdown, salvageKit,
} from "../brain/kit.mjs";

const FORMS = loadBrainForms(join(import.meta.dirname, "..", "..", "..", "company", "brain", "forms")).forms;
const BRAND_FORM = FORMS.find((f) => f.id === "brand");

const ENV = {
  families: new Set(["Avenir Next", "Didot", "Helvetica Neue", "Georgia"]),
  fonts: new Set(["Sthyra-Display.otf"]),
  brandPictures: new Set(["logo.png", "logo-white.png"]),
  referencePictures: new Set(["references/tower-dusk.jpg", "references/lobby.png"]),
};

export function fullKit() {
  return {
    version: 1, savedAt: null, name: "Sthyra",
    colours: [{ name: "ink", hex: "#1a3c5e", role: "main" }, { name: "sand", hex: "#E8DCC8", role: "background" }, { name: "rust", hex: "#b5502a", role: "accent" }],
    neutrals: true,
    type: { heading: { family: "Sthyra Display", file: "Sthyra-Display.otf", fallback: "serif" }, body: { family: "Avenir Next", file: null, fallback: "sans-serif" }, minPx: 16, minSlidePx: 28 },
    logo: { files: [{ file: "logo.png", on: "light" }, { file: "logo-white.png", on: "dark" }], clearSpace: 0.5, minPx: 48, requiredOn: ["poster", "carousel-last"] },
    layout: { radiusPx: 0, marginShare: 0.06 },
    voice: { words: ["warm", "plain", "exact"], is: "We talk like an architect at the site.\nShort, sure, kind.", do: ["Name the street."], dont: ["Say luxury."], signoff: "With care, from the studio" },
    references: [{ file: "references/tower-dusk.jpg", kinds: ["film", "carousel"], note: "The light on the stone,\nat dusk." }],
    filler: { block: true, allow: ["Look No Further"] },
    public: { summary: "An architecture studio in Hyderabad." },
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
// The field a change is refused at, and its sentence.
function refusal(change) {
  const k = fullKit();
  change(k);
  try { checkKit(k, ENV); } catch (e) {
    assert.ok(e instanceof KitError, String(e));
    assert.equal(e.status, 400);
    assert.equal(e.code, "bad_kit");
    assert.match(e.message, /^[A-Z].*\.$/);
    assert.ok(!e.message.includes("\n"));
    return { field: e.field, message: e.message };
  }
  assert.fail("the kit was accepted");
}

test("a full kit passes and comes back in K5's shape and order, hex upper case, lists in their fixed order", () => {
  const kit = checkKit(fullKit(), ENV);
  assert.deepEqual(Object.keys(kit), ["version", "savedAt", "name", "colours", "neutrals", "type", "logo", "layout", "voice", "references", "filler", "public"]);
  assert.deepEqual(kit.colours.map((c) => c.hex), ["#1A3C5E", "#E8DCC8", "#B5502A"]);
  assert.deepEqual(kit.logo.requiredOn, ["carousel-last", "poster"]);
  assert.deepEqual(kit.references[0].kinds, ["carousel", "film"]);
  assert.equal(kit.references[0].note, "The light on the stone, at dusk.");
  assert.deepEqual(kit.filler.allow, ["look no further"]);
  assert.equal(kit.voice.is, "We talk like an architect at the site.\nShort, sure, kind.");
  // Checked again, it is the same: a saved kit reads back as it was.
  assert.deepEqual(checkKit(clone(kit), ENV), kit);
});

test("colours: fewer than two, more than eight, a bad name, a repeated name each refused at their field", () => {
  assert.equal(refusal((k) => { k.colours = k.colours.slice(0, 1); }).field, "colours");
  assert.equal(refusal((k) => { k.colours = Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, hex: "#000000", role: i ? "other" : "main" })); }).field, "colours");
  assert.equal(refusal((k) => { k.colours[1].name = "Sand"; }).field, "colours.1.name");
  assert.equal(refusal((k) => { k.colours[1].name = "a".repeat(25); }).field, "colours.1.name");
  const r = refusal((k) => { k.colours[2].name = "ink"; });
  assert.equal(r.field, "colours.2.name");
  assert.match(r.message, /Colour 3/);
});

test("colours: a bad hex is refused at its field; hex in small letters is stored upper case", () => {
  for (const hex of ["1A3C5E", "#1A3C5", "#1A3C5EE", "#GGGGGG", "red", 12]) {
    assert.equal(refusal((k) => { k.colours[0].hex = hex; }).field, "colours.0.hex", String(hex));
  }
  assert.equal(checkKit(fullKit(), ENV).colours[0].hex, "#1A3C5E");
});

test("colours: two main colours, no main colour, an unknown role are refused", () => {
  assert.match(refusal((k) => { k.colours[1].role = "main"; }).message, /Only one colour can be the main colour/);
  assert.match(refusal((k) => { k.colours[0].role = "accent"; }).message, /Mark one colour as the main colour/);
  assert.equal(refusal((k) => { k.colours[0].role = "primary"; }).field, "colours.0.role");
});

test("type: a family neither on this Mac nor uploaded, a file not uploaded, a bad fallback, sizes out of range", () => {
  assert.equal(refusal((k) => { k.type.body.family = "Comic Sans"; }).field, "type.body.family");
  assert.equal(refusal((k) => { k.type.heading.file = "Other.ttf"; }).field, "type.heading.file");
  assert.equal(refusal((k) => { k.type.heading.family = "Bad \"name\""; }).field, "type.heading.family");
  assert.equal(refusal((k) => { k.type.body.fallback = "fantasy"; }).field, "type.body.fallback");
  assert.equal(refusal((k) => { k.type.minPx = 9; }).field, "type.minPx");
  assert.equal(refusal((k) => { k.type.minPx = 41; }).field, "type.minPx");
  assert.equal(refusal((k) => { k.type.minPx = 16.5; }).field, "type.minPx");
  assert.equal(refusal((k) => { k.type.minSlidePx = 15; }).field, "type.minSlidePx");
  assert.equal(refusal((k) => { k.type.minSlidePx = 121; }).field, "type.minSlidePx");
});

test("logo: a file that is not a picture in Brand, a bad background, clear space and size out of range, an unknown place", () => {
  assert.equal(refusal((k) => { k.logo.files[0].file = "references/tower-dusk.jpg"; }).field, "logo.files.0.file");
  assert.equal(refusal((k) => { k.logo.files[0].file = "../logo.png"; }).field, "logo.files.0.file");
  assert.equal(refusal((k) => { k.logo.files[1].on = "grey"; }).field, "logo.files.1.on");
  assert.equal(refusal((k) => { k.logo.files.push({ ...k.logo.files[0] }); }).field, "logo.files.2");
  assert.equal(refusal((k) => { k.logo.clearSpace = 2.5; }).field, "logo.clearSpace");
  assert.equal(refusal((k) => { k.logo.clearSpace = -0.1; }).field, "logo.clearSpace");
  assert.equal(refusal((k) => { k.logo.minPx = 4; }).field, "logo.minPx");
  assert.equal(refusal((k) => { k.logo.requiredOn = ["billboard"]; }).field, "logo.requiredOn");
  assert.equal(refusal((k) => { k.logo.requiredOn = ["poster", "poster"]; }).field, "logo.requiredOn");
});

test("voice: too many words, a word over the limit, a thirteenth do, a don't over 200 characters, a sign-off on two lines", () => {
  assert.equal(refusal((k) => { k.voice.words = ["a", "b", "c", "d", "e", "f"]; }).field, "voice.words");
  assert.equal(refusal((k) => { k.voice.words = ["x".repeat(41)]; }).field, "voice.words.0");
  assert.equal(refusal((k) => { k.voice.do = Array.from({ length: 13 }, () => "Be plain."); }).field, "voice.do");
  assert.equal(refusal((k) => { k.voice.dont = ["y".repeat(201)]; }).field, "voice.dont.0");
  assert.equal(refusal((k) => { k.voice.signoff = "With care\nThe team"; }).field, "voice.signoff");
  assert.equal(refusal((k) => { k.voice.is = "z".repeat(1001); }).field, "voice.is");
});

test("references: more than 24, a file not in References, twice the same, an unknown kind", () => {
  assert.equal(refusal((k) => { k.references = Array.from({ length: 25 }, () => k.references[0]); }).field, "references");
  assert.equal(refusal((k) => { k.references[0].file = "brand/logo.png"; }).field, "references.0.file");
  assert.equal(refusal((k) => { k.references.push(clone(k.references[0])); }).field, "references.1.file");
  assert.equal(refusal((k) => { k.references[0].kinds = ["billboard"]; }).field, "references.0.kinds");
  assert.equal(refusal((k) => { k.references[0].note = 5; }).field, "references.0.note");
});

test("the rest: name, neutrals, layout, filler, the public summary, and any part the kit does not know", () => {
  assert.equal(refusal((k) => { k.name = ""; }).field, "name");
  assert.equal(refusal((k) => { k.name = "n".repeat(81); }).field, "name");
  assert.equal(refusal((k) => { k.neutrals = "yes"; }).field, "neutrals");
  assert.equal(refusal((k) => { k.layout.radiusPx = 65; }).field, "layout.radiusPx");
  assert.equal(refusal((k) => { k.layout.marginShare = 0.3; }).field, "layout.marginShare");
  assert.equal(refusal((k) => { k.filler.block = 1; }).field, "filler.block");
  assert.equal(refusal((k) => { k.filler.allow = ["x"]; }).field, "filler.allow.0");
  assert.equal(refusal((k) => { k.public.summary = "s".repeat(601); }).field, "public.summary");
  assert.equal(refusal((k) => { k.script = "x"; }).field, "script");
  assert.equal(refusal((k) => { k.type.weight = 700; }).field, "type.weight");
  assert.equal(refusal((k) => { delete k.layout; }).field, "layout");
  assert.equal(refusal((k) => { delete k.voice.dont; }).field, "voice.dont");
});

test("kit.css: one custom property per colour, the stacks, radius and smallest size, an @font-face per uploaded font, nothing from free text", () => {
  const kit = checkKit(fullKit(), ENV);
  const css = kitCss(kit);
  assert.equal((css.match(/--brand-[a-z0-9-]+: #[0-9A-F]{6};/g) || []).length, 3);
  for (const c of kit.colours) assert.ok(css.includes(`  --brand-${c.name}: ${c.hex};`), c.name);
  assert.ok(css.includes('  --brand-heading: "Sthyra Display", serif;'));
  assert.ok(css.includes('  --brand-body: "Avenir Next", sans-serif;'));
  assert.ok(css.includes("  --brand-radius: 0px;"));
  assert.ok(css.includes("  --brand-min-size: 16px;"));
  assert.equal((css.match(/@font-face/g) || []).length, 1);
  assert.ok(css.includes('@font-face { font-family: "Sthyra Display"; src: url("fonts/Sthyra-Display.otf"); }'));
  for (const free of ["Sthyra\n", "architect", "Name the street", "luxury", "With care", "Hyderabad", "light on the stone", "warm"]) {
    assert.ok(!css.includes(free), free);
  }
  // Two faces from the same file give one @font-face; none uploaded gives none.
  const k2 = clone(kit);
  k2.type.body = { ...k2.type.heading };
  assert.equal((kitCss(k2).match(/@font-face/g) || []).length, 1);
  k2.type.heading = { family: "Didot", file: null, fallback: "serif" };
  k2.type.body = { family: "Didot", file: null, fallback: "serif" };
  assert.equal((kitCss(k2).match(/@font-face/g) || []).length, 0);
});

test("brand.md from the kit is read back by the old brand form: tone, colours, typeface, sign-off and logo", () => {
  const kit = checkKit(fullKit(), ENV);
  const md = brandMarkdown(kit, BRAND_FORM, "");
  const back = parseForm(BRAND_FORM, md);
  assert.deepEqual(back.values, {
    tone: ["warm", "plain", "exact"], colours: ["#1A3C5E", "#E8DCC8", "#B5502A"], fonts: "Avenir Next",
    signoff: "With care, from the studio", logo: "logo.png",
  });
  assert.deepEqual(back.unknown.map((u) => u.heading), ["Colours by name", "Type", "Logo rules", "How we sound: do and don't"]);
  assert.ok(md.includes("- ink: #1A3C5E, the main colour"));
  assert.ok(md.includes("- Do: Name the street."));
  assert.ok(md.includes("- Don't: Say luxury."));
  // With a typeface of the old form's own list for headings, that one is the answer.
  const k2 = clone(kit);
  k2.type.heading = { family: "Didot", file: null, fallback: "serif" };
  assert.equal(parseForm(BRAND_FORM, brandMarkdown(k2, BRAND_FORM, "")).values.fonts, "Didot");
});

test("brand.md: a section written by hand is kept, the kit's own sections are not written twice, a # in a do cannot make a heading", () => {
  const kit = checkKit(fullKit(), ENV);
  kit.voice.do = ["## Prices", "# Brand"];
  const first = brandMarkdown(kit, BRAND_FORM, "# Brand\nOur own words.\n\n## Our story\nA garage, then a studio.\n");
  const second = brandMarkdown(kit, BRAND_FORM, first);
  assert.equal(second, first);
  assert.ok(first.includes("Our own words."));
  assert.ok(first.includes("## Our story\nA garage, then a studio."));
  assert.equal((first.match(/^## Colours by name$/gm) || []).length, 1);
  const headings = first.split("\n").filter((l) => /^#/.test(l));
  assert.ok(!headings.includes("## Prices") && !headings.includes("# Brand\n"), headings.join("|"));
  assert.equal(headings.filter((l) => l === "# Brand").length, 1);
});

test("brand-public.md holds only the name, the voice words and the public summary", () => {
  const kit = checkKit(fullKit(), ENV);
  kit.public.summary = "Line one.\n## Not a heading";
  const md = publicMarkdown(kit);
  assert.ok(md.startsWith("# Sthyra\n"));
  for (const w of ["warm", "plain", "exact", "Line one.", "Not a heading"]) assert.ok(md.includes(w), w);
  assert.ok(!/^## Not a heading$/m.test(md));
  for (const secret of ["#1A3C5E", "ink", "Didot", "Avenir", "logo", "architect", "Name the street", "luxury", "With care", "tower-dusk", "look no further"]) {
    assert.ok(!md.includes(secret), secret);
  }
});

test("fonts: the kind comes from the first bytes, the name is cleaned and must agree with the kind", () => {
  const ttf = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(60)]);
  const otf = Buffer.concat([Buffer.from("OTTO"), Buffer.alloc(60)]);
  const ttc = Buffer.concat([Buffer.from("ttcf"), Buffer.alloc(60)]);
  const mac = Buffer.concat([Buffer.from("true"), Buffer.alloc(60)]);
  assert.equal(fontKind(ttf), "truetype");
  assert.equal(fontKind(mac), "truetype");
  assert.equal(fontKind(otf), "opentype");
  assert.equal(fontKind(ttc), "collection");
  assert.equal(fontKind(Buffer.from("<svg>")), null);
  assert.equal(fontFileName("../../My Font Bold.otf", otf), "My-Font-Bold.otf");
  assert.equal(fontFileName("Sthyra", otf), "Sthyra.otf");
  assert.equal(fontFileName("Sthyra", ttc), "Sthyra.ttc");
  assert.equal(fontFileName(".hidden.ttf", ttf), "hidden.ttf");
  assert.throws(() => fontFileName("a.ttc", ttf), (e) => e.code === "font_type");
  assert.throws(() => fontFileName("a.woff", otf), (e) => e.code === "font_type");
  assert.throws(() => fontFileName("a.ttf", Buffer.from("wOFF0000")), (e) => e.code === "font_type");
});

test("a proposal keeps only what passes: a bad hex drops that colour, a broken part is dropped, unknown parts are never named", () => {
  const raw = fullKit();
  raw.colours.push({ name: "neon", hex: "#ZZZZZZ", role: "accent" });
  raw.layout = { radiusPx: 900, marginShare: 0.06 };
  raw.voice.do = ["Be plain.", "x".repeat(300), 7];
  raw["<script>"] = "alert(1)";
  const { values, dropped } = salvageKit(raw, ENV);
  assert.deepEqual(values.colours.map((c) => c.name), ["ink", "sand", "rust"]);
  assert.equal(values.layout, undefined);
  assert.deepEqual(values.voice.do, ["Be plain."]);
  assert.deepEqual(dropped, ["colours", "layout", "voice", "other"]);
  assert.ok(!JSON.stringify({ values, dropped }).includes("script"));
  // Colours that leave no main colour after the bad one goes are dropped whole.
  const r2 = { colours: [{ name: "ink", hex: "#12345", role: "main" }, { name: "a", hex: "#000000", role: "other" }, { name: "b", hex: "#FFFFFF", role: "other" }] };
  assert.deepEqual(salvageKit(r2, ENV), { values: {}, dropped: ["colours"] });
  assert.deepEqual(salvageKit("not a kit", ENV), { values: {}, dropped: ["all"] });
});

test("starting values from the old brand form: tone, colours named colour-1 and on with the first the main one, typeface, logo", () => {
  const kit = kitFromOldForm({ tone: ["warm", "plain"], colours: ["#1f3a34", "#e8b04a", "nope"], fonts: "Didot", signoff: "Regards", logo: "logo.png" }, ENV, "Sthyra");
  assert.equal(kit.name, "Sthyra");
  assert.deepEqual(kit.colours, [{ name: "colour-1", hex: "#1F3A34", role: "main" }, { name: "colour-2", hex: "#E8B04A", role: "other" }]);
  assert.deepEqual(kit.voice.words, ["warm", "plain"]);
  assert.equal(kit.voice.signoff, "Regards");
  assert.deepEqual(kit.type.heading, { family: "Didot", file: null, fallback: "serif" });
  assert.deepEqual(kit.logo.files, [{ file: "logo.png", on: "light" }]);
  // It passes the rules once a name is there: the owner can save it as it is.
  assert.doesNotThrow(() => checkKit({ ...kit, references: [] }, ENV));
});
