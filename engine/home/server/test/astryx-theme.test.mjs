// PLAN-ASTRYX T3: the home server writes the brand kit as an Astryx theme (brand/astryx-theme.css) on every save and
// at start. The roles are fixed by the plan; the rest is proven against the judge of drawn colours
// (lib/sitebrand.mjs, colourOk): every colour the file gives passes it, opaque or see-through.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASTRYX_LOW_CONTRAST, ASTRYX_TOKENS, astryxThemeCss, astryxThemeProblem, checkKit, emptyKit, ensureAstryxTheme, kitCss, loadAstryxTokens,
} from "../brain/kit.mjs";
import { colourOk } from "../lib/sitebrand.mjs";
import { call } from "../lib/testing.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const ENGINE = join(import.meta.dirname, "..", "..", "..");
const TOKENS = loadAstryxTokens(join(ENGINE, "astryx-kit", "tokens.json"));
const THEME_CSS = readFileSync(join(ENGINE, "astryx-kit", "astryx", "theme.css"), "utf8");
const FORBIDDEN = ["light-dark(", "@import", "url(", "http"];

const ENV = { families: new Set(["Didot", "Avenir Next"]), fonts: new Set(), brandPictures: new Set(), referencePictures: new Set() };
function kitA(neutrals = true) {
  const k = emptyKit(["Didot"]);
  k.name = "Harbour";
  k.colours = [
    { name: "ink", hex: "#1A3C5E", role: "main" }, { name: "sun", hex: "#E0A100", role: "accent" },
    { name: "paper", hex: "#FAF7F2", role: "background" }, { name: "night", hex: "#0B1D2E", role: "text" },
  ];
  k.neutrals = neutrals;
  k.layout.radiusPx = 6;
  k.type.minPx = 16;
  return checkKit(k, ENV);
}
// One colour (checkKit asks for two to save; the function is pure and takes the kit's parts as they are).
function kitC() {
  return { ...emptyKit(["Didot"]), colours: [{ name: "blue", hex: "#336699", role: "main" }], neutrals: true };
}
// The colour declarations of the theme's one big rule: { name: value }.
function colours(text) {
  const out = {};
  for (const m of text.matchAll(/^ {2}(--color-[a-z0-9-]+): ([^;]+);$/gm)) out[m[1]] = m[2];
  return out;
}
// The judge as the home server holds it (sitebrand.mjs's measuredKit shape).
const judgeKit = (kit) => ({ colours: kit.colours.map((c) => [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16))), neutrals: kit.neutrals });
// How engine/viewer/report.mjs lists a colour: alpha 0 not at all; else its own three channels, alpha dropped.
function drawn(value) {
  if (value === "transparent") return null;
  assert.match(value, /^#(?:[0-9A-F]{6}|[0-9A-F]{8})$/, value);
  if (value.length === 9 && value.endsWith("00")) return null;
  return value.slice(0, 7);
}
function judged(kit, text) {
  const k = judgeKit(kit);
  for (const [name, v] of Object.entries(colours(text))) {
    const hex = drawn(v);
    if (hex) assert.ok(colourOk(k, hex), `${name}: ${v} does not pass the judge`);
  }
}

test("tokens.json reads: 114 colour names, three faces, sizes, radii and shadows", () => {
  assert.ok(TOKENS);
  assert.deepEqual(ASTRYX_TOKENS, TOKENS);
  assert.equal(TOKENS.colour.length, 114);
  assert.deepEqual(TOKENS.face, ["--font-family-body", "--font-family-heading", "--font-family-code"]);
  assert.equal(TOKENS.size.length, 26);
  assert.ok(TOKENS.radius.length >= 4 && TOKENS.shadow.length >= 1);
});

test("tokens: a missing, oversized or misshapen file gives null, never an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "astryx-tokens-"));
  try {
    assert.equal(loadAstryxTokens(join(dir, "none.json")), null);
    writeFileSync(join(dir, "big.json"), `{"version":1,"x":"${"a".repeat(300 * 1024)}"}`);
    assert.equal(loadAstryxTokens(join(dir, "big.json")), null);
    writeFileSync(join(dir, "bad.json"), "{not json");
    assert.equal(loadAstryxTokens(join(dir, "bad.json")), null);
    writeFileSync(join(dir, "shape.json"), JSON.stringify({ version: 1, colour: "x" }));
    assert.equal(loadAstryxTokens(join(dir, "shape.json")), null);
    symlinkSync(join(ENGINE, "astryx-kit", "tokens.json"), join(dir, "link.json"));
    assert.equal(loadAstryxTokens(join(dir, "link.json")), null);
    // A value that is not a plain length or a reference is left out, never written.
    writeFileSync(join(dir, "odd.json"), JSON.stringify({
      version: 1, colour: [{ name: "--color-accent", light: "#000" }], face: [], shadow: [],
      size: [{ name: "--font-size-a", value: "1rem;} body{background:url(x)" }, { name: "--font-size-b", value: "1rem" }],
      radius: [{ name: "--radius-x", value: "calc(1px)" }],
    }));
    const odd = loadAstryxTokens(join(dir, "odd.json"));
    assert.deepEqual(odd.size, [{ name: "--font-size-b", value: "1rem" }]);
    assert.deepEqual(odd.radius, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Kit A: the roles, the faces, color-scheme, a declaration for every colour name, nothing forbidden", () => {
  const kit = kitA();
  const text = astryxThemeCss(kit, TOKENS);
  assert.ok(text.startsWith("/* The brand kit as an Astryx theme, written by the home server on every save. Change it in Files, Brand kit. */\n:root { color-scheme: light; }\n"));
  for (const s of ["--color-accent: #E0A100;", "--color-background-body: #FAF7F2;", "--color-text-primary: #0B1D2E;",
    "--color-on-accent: #0B1D2E;", "--font-family-heading: var(--brand-heading);", "--font-family-code: var(--brand-body);",
    "--font-family-body: var(--brand-body);", "color-scheme: light"]) assert.ok(text.includes(s), s);
  const c = colours(text);
  for (const t of TOKENS.colour) assert.ok(Object.hasOwn(c, t.name), t.name);
  assert.equal(Object.keys(c).length, 114);
  for (const f of FORBIDDEN) assert.ok(!text.includes(f), f);
  for (const name of kit.colours.map((x) => x.name)) {
    assert.ok(!new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`).test(text.replace(/--[a-z0-9-]+/g, "")), `the kit's name ${name}`);
  }
  assert.ok(!text.includes("Harbour"));
  // Upper six rows of the table, as the plan fixes them.
  assert.equal(c["--color-background-surface"], "#FAF7F2");
  assert.equal(c["--color-background-card"], "#FAF7F2");
  assert.equal(c["--color-background-popover"], "#FAF7F2");
  assert.equal(c["--color-on-light"], "#0B1D2E");
  assert.equal(c["--color-text-accent"], "#E0A100");
  assert.equal(c["--color-on-dark"], "#FAF7F2");
  assert.equal(c["--color-on-info"], "#FAF7F2"); // ON(MAIN): paper against #1A3C5E beats night
  // Neutrals allowed: the theme's own greys stay, as Chrome computes them, with their alpha.
  assert.equal(c["--color-border"], "#00000014");
  assert.equal(c["--color-text-secondary"], "#474747");
  assert.equal(c["--color-syntax-diff-header"], "transparent");
  // Not grey: the kit's.
  assert.equal(c["--color-text-error"], "#0B1D2E");
  assert.equal(c["--color-background-red"], "#FAF7F2");
  assert.equal(c["--color-info"], "#1A3C5E");
  assert.ok(text.includes("--radius-element: var(--brand-radius);"));
  assert.ok(text.includes("--radius-inner: min(var(--brand-radius), 0.375rem);"));
  assert.ok(!text.includes("--radius-none") && !text.includes("--radius-full"));
  assert.ok(text.includes("--font-size-sm: max(var(--brand-min-size), var(--_scaled-font-size-sm));"));
  assert.ok(text.includes("--text-body-size: max(var(--brand-min-size), var(--font-size-base));"));
  assert.ok(!text.includes("--shadow-"), "shadows are the theme's own when neutrals are allowed");
  assert.ok(text.endsWith("body { margin: 0; font-family: var(--font-family-body); background: var(--color-background-body); color: var(--color-text-primary); }\n"));
  judged(kit, text);
});

test("Kit B: neutrals refused: every colour is one of the four or transparent; shadows are none; the judge passes it", () => {
  const kit = kitA(false);
  const text = astryxThemeCss(kit, TOKENS);
  const four = new Set(kit.colours.map((x) => x.hex));
  for (const [name, v] of Object.entries(colours(text))) assert.ok(four.has(v) || v === "transparent", `${name}: ${v}`);
  for (const t of TOKENS.shadow) assert.ok(text.includes(`  ${t.name}: none;`), t.name);
  for (const f of FORBIDDEN) assert.ok(!text.includes(f), f);
  judged(kit, text);
});

test("Kit C: one colour, neutrals allowed: GROUND #FFFFFF, INK #111111, ACCENT the main colour", () => {
  const kit = kitC();
  const c = colours(astryxThemeCss(kit, TOKENS));
  assert.equal(c["--color-background-body"], "#FFFFFF");
  assert.equal(c["--color-text-primary"], "#111111");
  assert.equal(c["--color-accent"], "#336699");
  assert.equal(c["--color-on-accent"], "#FFFFFF");
  judged(kit, astryxThemeCss(kit, TOKENS));
});

// Fable's review (T12): a role the kit leaves unset is chosen by contrast against the one it sets, and a ground that
// does not read against its ink gives no theme at all, said in the server's words.
const one = (hex, role, neutrals) => ({ ...emptyKit(["Didot"]), colours: [{ name: "only", hex, role }], neutrals });

test("one colour #336699 with neutrals refused: ground and ink are the same colour, so no theme, and the reason", () => {
  const kit = one("#336699", "main", false);
  assert.equal(astryxThemeCss(kit, TOKENS), null);
  assert.equal(astryxThemeProblem(kit), ASTRYX_LOW_CONTRAST);
  assert.match(ASTRYX_LOW_CONTRAST, /^No Astryx theme was written: .*4\.5 to 1.*Files, Brand kit/);
});

test("a light text colour #F5F5F0 and no background: the ground is chosen by contrast (#111111), and it reads", () => {
  const kit = one("#F5F5F0", "text", true);
  const text = astryxThemeCss(kit, TOKENS);
  assert.ok(text);
  const c = colours(text);
  assert.equal(c["--color-text-primary"], "#F5F5F0");
  assert.equal(c["--color-background-body"], "#111111");
  assert.equal(astryxThemeProblem(kit), null);
  judged(kit, text);
  // Neutrals refused and nothing else in the kit: no ground that reads, so no theme.
  assert.equal(astryxThemeCss(one("#F5F5F0", "text", false), TOKENS), null);
  // Neutrals refused with a dark kit colour beside it: that colour is the ground.
  const two = { ...one("#F5F5F0", "text", false), colours: [{ name: "only", hex: "#F5F5F0", role: "text" }, { name: "deep", hex: "#1A3C5E", role: "main" }] };
  assert.equal(colours(astryxThemeCss(two, TOKENS))["--color-background-body"], "#1A3C5E");
});

test("a dark background #101820 and no text: the ink is chosen by contrast (#FFFFFF), and it reads", () => {
  const kit = one("#101820", "background", true);
  const text = astryxThemeCss(kit, TOKENS);
  assert.ok(text);
  const c = colours(text);
  assert.equal(c["--color-background-body"], "#101820");
  assert.equal(c["--color-text-primary"], "#FFFFFF");
  judged(kit, text);
  assert.equal(astryxThemeCss(one("#101820", "background", false), TOKENS), null);
});

test("ensureAstryxTheme: a kit whose ground and ink do not read writes no theme, removes a stale one, and says why", () => {
  const t = tempState();
  try {
    const kit = { ...kitA(), colours: [{ name: "a", hex: "#336699", role: "main" }, { name: "b", hex: "#3A6EA0", role: "accent" }], neutrals: false };
    writeKit(t, kit);
    assert.equal(ensureAstryxTheme(t.config), "low_contrast");
    assert.equal(existsSync(themePath(t)), false);
    writeFileSync(themePath(t), "stale");
    assert.equal(ensureAstryxTheme(t.config), "low_contrast");
    assert.equal(existsSync(themePath(t)), false);
  } finally { rmSync(t.state, { recursive: true, force: true }); }
});

test("an empty kit, or no tokens, gives no theme", () => {
  assert.equal(astryxThemeCss(emptyKit([]), TOKENS), null);
  assert.equal(astryxThemeCss(kitA(), null), null);
});

// A rule that sets a token to another token (`.astryx-switch`: var(--color-border-emphasized)) needs nothing: that
// token is the theme's. One that sets it to a colour of its own must be covered, or the colour would be drawn.
test("every rule of the theme's own file that gives a colour token a literal colour is covered by the theme's selector", () => {
  const text = astryxThemeCss(kitA(), TOKENS);
  const selector = text.split("\n").slice(2).join("\n").split(" {")[0].split(",\n").map((s) => s.trim());
  for (const m of THEME_CSS.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/--color-[a-z0-9-]+\s*:[^;]*(?:#[0-9a-fA-F]{3}|rgba?\(|oklch\(|light-dark\()/.test(m[2]) || sel === ":scope" || sel.startsWith(":root") || sel.startsWith("html[data-theme")) continue;
    const plain = sel.replace(/="(light|dark)"/, "");
    assert.ok(selector.includes(sel) || selector.includes(plain), `not covered: ${sel}`);
  }
});

// ---- the disk: ensureAstryxTheme in a temp state

function tempState() {
  const state = mkdtempSync(join(tmpdir(), "astryx-theme-"));
  const docs = join(state, "knowledge", "docs");
  mkdirSync(join(docs, "brand"), { recursive: true });
  return { state, docs, config: { paths: { state, knowledgeDocs: docs }, engineDir: ENGINE } };
}
const writeKit = (t, kit) => writeFileSync(join(t.docs, "brand", "kit.json"), `${JSON.stringify(kit, null, 2)}\n`);
const themePath = (t) => join(t.docs, "brand", "astryx-theme.css");

test("ensureAstryxTheme writes a missing file, rewrites a changed one, and leaves a right one alone", () => {
  const t = tempState();
  try {
    writeKit(t, kitA());
    assert.equal(ensureAstryxTheme(t.config), "written");
    const want = astryxThemeCss(kitA(), TOKENS);
    assert.equal(readFileSync(themePath(t), "utf8"), want);
    assert.equal(statSync(themePath(t)).mode & 0o777, 0o644);
    const old = new Date(Date.now() - 60_000);
    utimesSync(themePath(t), old, old);
    const before = statSync(themePath(t)).mtimeMs;
    assert.equal(ensureAstryxTheme(t.config), "same");
    assert.equal(statSync(themePath(t)).mtimeMs, before);
    writeFileSync(themePath(t), "/* changed by hand */\n");
    assert.equal(ensureAstryxTheme(t.config), "written");
    assert.equal(readFileSync(themePath(t), "utf8"), want);
    // The kit changed since: the file follows it.
    writeKit(t, kitA(false));
    assert.equal(ensureAstryxTheme(t.config), "written");
    assert.equal(readFileSync(themePath(t), "utf8"), astryxThemeCss(kitA(false), TOKENS));
    // No tokens: nothing is written and nothing fails.
    writeFileSync(themePath(t), "kept");
    assert.equal(ensureAstryxTheme(t.config, { tokens: null }), "none");
    assert.equal(readFileSync(themePath(t), "utf8"), "kept");
  } finally { rmSync(t.state, { recursive: true, force: true }); }
});

test("ensureAstryxTheme: an empty kit writes no file and removes a stale one; a bad kit or a link changes nothing", () => {
  const t = tempState();
  try {
    writeKit(t, emptyKit([]));
    assert.equal(ensureAstryxTheme(t.config), "none");
    assert.equal(existsSync(themePath(t)), false);
    writeFileSync(themePath(t), "stale");
    assert.equal(ensureAstryxTheme(t.config), "removed");
    assert.equal(existsSync(themePath(t)), false);
    // A kit whose colours break a rule: nothing written.
    const bad = kitA();
    bad.colours[0].hex = "red";
    writeKit(t, bad);
    assert.equal(ensureAstryxTheme(t.config), "none");
    assert.equal(existsSync(themePath(t)), false);
    // No kit at all.
    rmSync(join(t.docs, "brand", "kit.json"));
    assert.equal(ensureAstryxTheme(t.config), "none");
    // A link planted at the theme's place is never written through.
    writeKit(t, kitA());
    const outside = join(t.state, "outside.css");
    writeFileSync(outside, "untouched");
    symlinkSync(outside, themePath(t));
    assert.equal(ensureAstryxTheme(t.config), "unsafe");
    assert.equal(readFileSync(outside, "utf8"), "untouched");
    assert.ok(lstatSync(themePath(t)).isSymbolicLink());
  } finally { rmSync(t.state, { recursive: true, force: true }); }
});

// ---- saveKit through the brand kit's route, on the version 2 seed (port 0)

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
function kitBody() {
  return {
    version: 1, savedAt: null, name: "Harbour",
    colours: [{ name: "ink", hex: "#1a3c5e", role: "main" }, { name: "sun", hex: "#E0A100", role: "accent" }, { name: "paper", hex: "#FAF7F2", role: "background" }, { name: "night", hex: "#0B1D2E", role: "text" }],
    neutrals: true,
    type: { heading: { family: "Didot", file: null, fallback: "serif" }, body: { family: "Avenir Next", file: null, fallback: "sans-serif" }, minPx: 16, minSlidePx: 28 },
    logo: { files: [{ file: "logo.png", on: "light" }], clearSpace: 0.5, minPx: 48, requiredOn: ["page"] },
    layout: { radiusPx: 6, marginShare: 0.06 },
    voice: { words: ["warm"], is: "Plain.", do: [], dont: [], signoff: "" },
    references: [], filler: { block: true, allow: [] }, public: { summary: "" },
  };
}
async function withHome(fn) {
  const h = await startV2({ routes: ["brain", "brand-kit"], log: () => {} });
  h.config.minFreeDiskGb = 0;
  try {
    const r = await call(h.url, "POST", "/api/brain/files", { body: { folder: "brand", name: "logo.png", base64: PNG.toString("base64") } });
    assert.equal(r.status, 201, r.text);
    return await fn(h, (...p) => join(h.config.paths.state, "knowledge", "docs", "brand", ...p));
  } finally { await h.close(); }
}
async function save(h, kit = kitBody()) {
  const version = (await call(h.url, "GET", "/api/brand/kit")).json.version;
  return call(h.url, "POST", "/api/brand/kit", { body: { kit, version } });
}

test("saveKit writes brand/astryx-theme.css at 0644 and leaves kit.css as kitCss gives it", () => withHome(async (h, brand) => {
  const r = await save(h);
  assert.equal(r.status, 200, r.text);
  assert.equal(readFileSync(brand("astryx-theme.css"), "utf8"), astryxThemeCss(r.json.kit, TOKENS));
  assert.equal(statSync(brand("astryx-theme.css")).mode & 0o777, 0o644);
  assert.equal(readFileSync(brand("kit.css"), "utf8"), kitCss(r.json.kit));
  assert.ok(readFileSync(brand("astryx-theme.css"), "utf8").includes("--color-accent: #E0A100;"));
  // A second save with neutrals refused rewrites it.
  const r2 = await save(h, { ...kitBody(), neutrals: false });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(readFileSync(brand("astryx-theme.css"), "utf8"), astryxThemeCss(r2.json.kit, TOKENS));
  assert.equal(readFileSync(brand("kit.css"), "utf8"), kitCss(r2.json.kit));
}));

test("saveKit: a kit whose ground and ink do not read is saved, writes no theme and the answer says why", () => withHome(async (h, brand) => {
  const r = await save(h);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.theme, undefined);
  assert.ok(existsSync(brand("astryx-theme.css")));
  const low = { ...kitBody(), neutrals: false, colours: [{ name: "a", hex: "#336699", role: "main" }, { name: "b", hex: "#3A6EA0", role: "accent" }] };
  const r2 = await save(h, low);
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.json.theme, ASTRYX_LOW_CONTRAST);
  assert.equal(existsSync(brand("astryx-theme.css")), false);
  assert.equal(readFileSync(brand("kit.css"), "utf8"), kitCss(r2.json.kit));
}));

test("a link planted at brand/astryx-theme.css is refused as one at kit.css is, before anything is written", () => withHome(async (h, brand) => {
  const outside = join(h.config.paths.state, "outside.txt");
  writeFileSync(outside, "untouched");
  symlinkSync(outside, brand("astryx-theme.css"));
  const r = await save(h);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "folder_unsafe");
  assert.equal(readFileSync(outside, "utf8"), "untouched");
  assert.ok(lstatSync(brand("astryx-theme.css")).isSymbolicLink());
  assert.equal(existsSync(brand("kit.json")), false);
  assert.equal(existsSync(brand("kit.css")), false);
}));
