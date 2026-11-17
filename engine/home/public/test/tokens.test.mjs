// Checks the design tokens and the base stylesheet (PLAN-COOK T10: C+ at the root): every pinned token resolves to
// its pinned value in dark and light, whichever way the theme is chosen; one accent, whatever data-accent says;
// no other file defines a token; the ground is flat (no canvas, no aurora, no gradient behind the page); the
// pinned text pairs meet their contrast on each of the three ground steps; and theme-boot.js and theme.js set
// and read the attributes on <html>. Every value is written once, in tokens.pinned.mjs. PLAN-3D-ALL U1: the
// studio's materials (warm grounds and panels, the lamplight accent) and the two surfaces as scopes, with the
// contrast loops carried into the paper scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { ALIASES, FIXED, SURFACES, THEMED } from "./tokens.pinned.mjs";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES = join(PUBLIC, "styles");
const TOKENS_CSS = readFileSync(join(STYLES, "tokens.css"), "utf8");
const BASE_CSS = readFileSync(join(STYLES, "base.css"), "utf8");
const BOOT_JS = readFileSync(join(PUBLIC, "lib", "theme-boot.js"), "utf8");

const DEPTS = ["operations", "sales", "marketing", "studio", "support", "people", "books", "brain"];
// The six accents the old picker offered; the attribute is still set by theme-boot.js, and nothing reads it.
const OLD_ACCENTS = ["graphite", "blue", "green", "violet", "orange", "rose"];
// The six quiet tints for identity (fix round R5; kit/tile.js names them in the same order).
const TINTS = ["blue", "green", "violet", "orange", "rose", "teal"];

const ROOT_PINNED = new Set([...Object.keys(THEMED), ...Object.keys(FIXED), ...Object.keys(ALIASES)]);
const PINNED = new Set([...ROOT_PINNED, "--dept"]);

// --- a small CSS reader: rules with their selectors, the at-rule around them, and declarations ---

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseRules(css) {
  const src = stripComments(css);
  const rules = [];
  const keyframes = new Map();
  let i = 0;
  let order = 0;
  function readBody(end) {
    const decls = new Map();
    for (const part of src.slice(i, end).split(";")) {
      const c = part.indexOf(":");
      if (c === -1) continue;
      decls.set(part.slice(0, c).trim(), part.slice(c + 1).trim());
    }
    return decls;
  }
  function block(media) {
    while (i < src.length) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const prelude = src.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith("@media")) { block(prelude.slice(6).trim()); continue; }
      if (prelude.startsWith("@keyframes")) {
        const name = prelude.slice(10).trim();
        const steps = [];
        while (true) {
          const o = src.indexOf("{", i);
          const c = src.indexOf("}", i);
          if (c < o || o === -1) { i = c + 1; break; }
          const sel = src.slice(i, o).trim();
          i = o + 1;
          const e = src.indexOf("}", i);
          steps.push({ sel, decls: readBody(e) });
          i = e + 1;
        }
        keyframes.set(name, steps);
        continue;
      }
      if (prelude.startsWith("@")) {
        let depth = 1;
        while (i < src.length && depth > 0) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; }
        continue;
      }
      const end = src.indexOf("}", i);
      const decls = readBody(end);
      i = end + 1;
      rules.push({ selectors: prelude.split(",").map((s) => s.trim()), media, decls, order: order++ });
    }
  }
  block(null);
  return { rules, keyframes };
}

// Root selectors in tokens.css are :root followed by [data-x="v"] parts; the department rules are [data-dept="v"].
function parseRootSelector(sel) {
  assert.ok(sel.startsWith(":root"), `tokens.css selector must start with :root: ${sel}`);
  let rest = sel.slice(5);
  const parts = [];
  const re = /^(?::not\(\[(data-[a-z]+)="([a-z]+)"\]\)|\[(data-[a-z]+)="([a-z]+)"\])/;
  while (rest.length) {
    const m = rest.match(re);
    assert.ok(m, `unexpected selector in tokens.css: ${sel}`);
    parts.push(m[1] ? { attr: m[1], value: m[2], negate: true } : { attr: m[3], value: m[4], negate: false });
    rest = rest.slice(m[0].length);
  }
  return { parts, specificity: 1 + parts.length };
}

function matches(parsed, attrs) {
  return parsed.parts.every((p) => (attrs[p.attr] === p.value) !== p.negate);
}

function mediaMatches(media, env) {
  if (media === null) return true;
  assert.equal(media.replace(/\s+/g, " "), "(prefers-color-scheme: light)", `unexpected media query in tokens.css: ${media}`);
  return env.systemLight;
}

const { rules: ALL_TOKEN_RULES } = parseRules(TOKENS_CSS);
const isDeptRule = (r) => r.selectors.every((s) => /^\[data-dept="[a-z]+"\]$/.test(s));
// PLAN-3D-ALL U1 (D4): a surface scope is [data-surface="<name>"]; the aliases' rule also names [data-surface].
const isScopeSel = (s) => /^\[data-surface(?:="[a-z]+")?\]$/.test(s);
const TOKEN_RULES = ALL_TOKEN_RULES.filter((r) => !isDeptRule(r))
  .map((r) => ({ ...r, selectors: r.selectors.filter((s) => !isScopeSel(s)) }))
  .filter((r) => r.selectors.length > 0);
const DEPT_RULES = ALL_TOKEN_RULES.filter(isDeptRule);
const SCOPE_RULES = ALL_TOKEN_RULES.filter((r) => r.selectors.some(isScopeSel));

// Resolve every custom property on <html> for a theme attribute, an accent attribute and the Mac's setting.
function resolveTokens({ theme, accent, systemLight = false }) {
  const attrs = { "data-theme": theme, "data-accent": accent };
  const winners = new Map();
  for (const rule of TOKEN_RULES) {
    if (!mediaMatches(rule.media, { systemLight })) continue;
    for (const sel of rule.selectors) {
      const parsed = parseRootSelector(sel);
      if (!matches(parsed, attrs)) continue;
      for (const [name, value] of rule.decls) {
        if (!name.startsWith("--")) continue;
        const prev = winners.get(name);
        const rank = [parsed.specificity, rule.order];
        if (!prev || rank[0] > prev.rank[0] || (rank[0] === prev.rank[0] && rank[1] >= prev.rank[1])) winners.set(name, { value, rank });
      }
    }
  }
  return Object.fromEntries([...winners].map(([k, v]) => [k, v.value]));
}

function computed(tokens, name, depth = 0) {
  const v = tokens[name];
  assert.ok(v !== undefined, `${name} is not defined`);
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (m && depth < 5) return computed(tokens, m[1], depth + 1);
  return v;
}

// PLAN-3D-ALL U1 (D4): the custom properties of an element carrying data-surface="<surface>" just under <html>. It
// inherits the root's values as they compute there; then the scope's own declarations (and the aliases, which the
// aliases' rule declares on [data-surface] too) are read on the element, so a var() among them reads the element's.
function resolveSurface(way, surface) {
  const root = resolveTokens(way);
  const element = Object.fromEntries(Object.keys(root).map((name) => [name, computed(root, name)]));
  for (const rule of SCOPE_RULES) {
    if (!rule.selectors.some((s) => s === "[data-surface]" || s === `[data-surface="${surface}"]`)) continue;
    for (const [name, value] of rule.decls) if (name.startsWith("--")) element[name] = value;
  }
  return element;
}

const ACCENT_CHOICES = [undefined, ...OLD_ACCENTS];
const DARK_WAYS = [{}, { theme: "dark" }, { theme: "dark", systemLight: true }, { theme: "auto" }, { systemLight: true }];
const LIGHT_WAYS = [{ theme: "light" }, { theme: "light", systemLight: true }, { theme: "auto", systemLight: true }];
const MODES = [["dark", 0, DARK_WAYS], ["light", 1, LIGHT_WAYS]];

// --- colour: parsing, laying a translucent colour over an opaque one, and the WCAG contrast ratio ---

function parseColour(text) {
  const s = text.trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = s.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  assert.ok(m, `not a colour this test reads: ${text}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
}

// Source-over: a colour at its alpha laid over an opaque backdrop gives an opaque colour.
function over(top, under) {
  assert.equal(under.a, 1, "the backdrop must be opaque");
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

function withAlpha(c, a) {
  return { ...c, a };
}

function luminance(c) {
  const [r, g, b] = [c.r, c.g, c.b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const top = fg.a === 1 ? fg : over(fg, bg);
  const [l1, l2] = [luminance(top), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const colourOf = (t, name) => parseColour(computed(t, name));

// --- tests: the tokens ---

test("tokens.css defines exactly the pinned token names", () => {
  const defined = new Set();
  for (const rule of ALL_TOKEN_RULES) for (const name of rule.decls.keys()) if (name.startsWith("--")) defined.add(name);
  const missing = [...PINNED].filter((n) => !defined.has(n));
  const extra = [...defined].filter((n) => !PINNED.has(n));
  assert.deepEqual(missing, [], `missing tokens: ${missing.join(" ")}`);
  assert.deepEqual(extra, [], `tokens not pinned in tokens.pinned.mjs: ${extra.join(" ")}`);
});

for (const [mode, index, ways] of MODES) {
  test(`every pinned token resolves to its pinned value in ${mode}, for every way of choosing ${mode}`, () => {
    let checked = 0;
    for (const way of ways) {
      for (const accent of ACCENT_CHOICES) {
        const t = resolveTokens({ ...way, accent });
        const where = `${mode} ${JSON.stringify(way)} data-accent=${accent ?? "(none)"}`;
        for (const [name, values] of Object.entries(THEMED)) {
          // The studio's paper and its ink are aliases (PLAN-3D-ALL U1): pinned there, and here as they compute.
          if (name in ALIASES) assert.equal(computed(t, name), values[index], `${name} in ${where}`);
          else assert.equal(t[name], values[index], `${name} in ${where}`);
          checked++;
        }
        for (const [name, value] of Object.entries({ ...FIXED, ...ALIASES })) {
          assert.equal(t[name], value, `${name} in ${where}`);
          checked++;
        }
        assert.equal(computed(t, "--focus"), THEMED["--accent"][index], `--focus in ${where}`);
        assert.equal(Object.keys(t).length, ROOT_PINNED.size, `token count in ${where}`);
      }
    }
    assert.ok(checked > 0);
  });
}

test("dark is the default, and there is one accent: no rule reads data-accent", () => {
  const t = resolveTokens({});
  assert.equal(t["--bg"], THEMED["--bg"][0]);
  assert.equal(t["--accent"], THEMED["--accent"][0]);
  assert.equal(resolveTokens({ theme: "light" })["--accent"], THEMED["--accent"][1]);
  assert.equal(resolveTokens({ theme: "auto", systemLight: true })["--accent"], THEMED["--accent"][1]);
  assert.doesNotMatch(stripComments(TOKENS_CSS), /data-accent/);
});

test("depth at the root: four steps in dark, the sidebar the darkest, then the stage, the page ground, the rail and a card", () => {
  const t = resolveTokens({});
  const l = (name) => luminance(colourOf(t, name));
  // Dark (fix round A2): each step is lighter than the one under it, and the raised or chosen step is above a card.
  const steps = ["--side", "--stage", "--bg", "--panel", "--card", "--raise"];
  for (let i = 1; i < steps.length; i++) {
    assert.ok(l(steps[i]) > l(steps[i - 1]), `${steps[i]} is a step above ${steps[i - 1]} (dark)`);
  }
  // A field sits a step under the rail it is on, above the page ground.
  assert.ok(l("--field") < l("--panel") && l("--field") > l("--bg"), "--field is between --bg and --panel (dark)");
});

// The quiet look was rejected on 16 November 2026 (PLAN-3D-ALL U1). Was: "light is one cool neutral family: white
// panels and cards lift off a calm cool ground" (white panels, cards and fields; blue at least red).
test("light is one warm family: morning plaster and oak", () => {
  for (const way of LIGHT_WAYS) {
    const t = resolveTokens(way);
    const l = (name) => luminance(colourOf(t, name));
    // The stage is the deepest of the work, under the sidebar, under the page ground.
    assert.ok(l("--stage") < l("--side") && l("--side") < l("--bg"), "--stage, then --side, then --bg (light)");
    // Oak boards a step lighter than the plaster: the rail, a card, a field and what floats stand above the ground.
    for (const raised of ["--panel", "--card", "--field", "--overlay", "--over"]) assert.ok(l(raised) > l("--bg"), `${raised} is above the ground (light)`);
    assert.ok(l("--card") >= l("--panel"), "a card is at least as light as the rail it is on (light)");
    // The raised or chosen step and a current row are warm fills, under the ground.
    for (const fill of ["--raise", "--sel"]) assert.ok(l(fill) < l("--bg"), `${fill} is a fill a step under the ground (light)`);
    assert.ok(l("--sel") < l("--raise"), "a current row is a step deeper than the raised fill (light)");
    // A warm off-white ground, 4 to 9 percent off white: no white page, and no grey one.
    const bg = colourOf(t, "--bg");
    const grey = 1 - (bg.r + bg.g + bg.b) / 3 / 255;
    assert.ok(grey >= 0.04 && grey <= 0.09, `the light ground is 4 to 9 percent off white: ${(grey * 100).toFixed(1)}`);
    // Paper is lighter than the plaster it lies on, so a sheet reads as a sheet.
    assert.ok(l("--paper") > l("--bg"), "--paper is above the ground (light)");
  }
});

// CIE L* of an opaque colour, for the steps a person sees.
function lstar(c) {
  const y = luminance(c);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

test("a card stands off the ground: at least 5 L* in dark, and in light a white card 3.5 L* off the ground with its 1 px edge (fix rounds A3, R5, R6 and R7)", () => {
  for (const [way, floor] of [[{}, 5], [{ theme: "light" }, 3.5], [{ theme: "auto", systemLight: true }, 3.5]]) {
    const t = resolveTokens(way);
    const step = Math.abs(lstar(colourOf(t, "--card")) - lstar(colourOf(t, "--bg")));
    assert.ok(step >= floor, `--card against --bg in ${JSON.stringify(way)}: ${step.toFixed(1)} L* < ${floor}`);
  }
});

// The quiet look was rejected on 16 November 2026 (PLAN-3D-ALL U1). Was: "the dark neutrals are neutral
// near-blacks: blue at most 10 above red, never a navy cast (fix round R6)".
test("the dark grounds are warm near-blacks: dusk", () => {
  const t = resolveTokens({});
  for (const name of ["--side", "--stage", "--bg"]) {
    const c = colourOf(t, name);
    assert.ok(lstar(c) <= 10, `${name} is a near-black: ${computed(t, name)} at ${lstar(c).toFixed(1)} L*`);
  }
  // Red over green over blue: the warmth of plaster and oak at dusk, not a brown cast and not a grey.
  for (const name of ["--side", "--stage", "--bg", "--field", "--panel", "--card", "--raise", "--sel", "--raise-2", "--overlay", "--over"]) {
    const { r, g, b } = colourOf(t, name);
    assert.ok(r >= g && g >= b && r > b, `${name} is warm, red over green over blue: ${computed(t, name)}`);
  }
  assert.ok(luminance(colourOf(t, "--paper")) > 0.6, "paper stays a light sheet at dusk");
});

// PLAN-3D-ALL U1 (D3, constraint b): warm, never cool, in both themes. Every ground, panel and edge has at least as
// much red as blue, and at most 14 more in dark, 24 more in light. A translucent edge is measured as it shows: laid
// over the surface it parts (the ground; paper's edge over paper, the over-panel's edge over it). Paper is a light
// sheet in both themes (D4), so its family keeps the light cap at dusk too.
const WARM_GROUNDS = ["--side", "--stage", "--bg", "--panel", "--card", "--raise", "--sel", "--raise-2", "--overlay", "--field", "--chip", "--over"];
const WARM_LINES = [["--line", "--bg"], ["--line-2", "--bg"], ["--overlay-line", "--overlay"], ["--over-line", "--over"]];
const WARM_PAPER = [["--paper"], ["--paper-2"], ["--paper-field"], ["--paper-line", "--paper"]];
for (const [mode, , ways, cap] of MODES.map((m) => [...m, m[0] === "dark" ? 14 : 24])) {
  test(`warm, never cool, in ${mode}: red at least blue and at most ${cap} above it on every ground, panel and edge`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      const check = (name, c) => assert.ok(c.r >= c.b && c.r - c.b <= cap, `${name} in ${mode} ${JSON.stringify(way)}: r ${Math.round(c.r)}, b ${Math.round(c.b)}`);
      for (const name of WARM_GROUNDS) {
        const c = colourOf(t, name);
        assert.equal(c.a, 1, `${name} is opaque`);
        check(name, c);
      }
      for (const [name, under] of WARM_LINES) {
        const c = colourOf(t, name);
        check(name, c.a === 1 ? c : over(c, colourOf(t, under)));
      }
      for (const [name, under] of WARM_PAPER) {
        const c = colourOf(t, name);
        const shown = c.a === 1 ? c : over(c, colourOf(t, under));
        assert.ok(shown.r >= shown.b && shown.r - shown.b <= 24, `${name} (paper) in ${mode}: r ${Math.round(shown.r)}, b ${Math.round(shown.b)}`);
      }
    }
  });
}

// CIE Lab (D65) of an opaque sRGB colour, and the distance between two colours in it (CIE76).
function lab(c) {
  const lin = [c.r, c.g, c.b].map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const x = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047;
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
  const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}
function labDistance(p, q) {
  const [m, n] = [lab(p), lab(q)];
  return Math.hypot(m.L - n.L, m.a - n.a, m.b - n.b);
}

test("the Lab helper measures as CIE does", () => {
  const white = lab(parseColour("#ffffff"));
  assert.ok(Math.abs(white.L - 100) < 0.01 && Math.abs(white.a) < 0.05 && Math.abs(white.b) < 0.05);
  assert.ok(Math.abs(lab(parseColour("#000000")).L) < 0.01);
  const red = lab(parseColour("#ff0000"));
  assert.ok(Math.abs(red.L - 53.24) < 0.1 && Math.abs(red.a - 80.09) < 0.2 && Math.abs(red.b - 67.20) < 0.2, JSON.stringify(red));
  assert.ok(Math.abs(labDistance(parseColour("#ffffff"), parseColour("#000000")) - 100) < 0.01);
});

// PLAN-3D-ALL U1 follow-up (D5): a dot where only its colour and a pulse differ must still tell working (the accent,
// and the lamp glyph) from waiting for you (--warn), and waiting from a problem (--bad): at least 20 apart in Lab
// for working and waiting, 15 for waiting and a problem.
function assertStatesApart(t, where) {
  for (const working of ["--accent", "--lamp"]) {
    const d = labDistance(colourOf(t, working), colourOf(t, "--warn"));
    assert.ok(d >= 20, `${working} and --warn are ${d.toFixed(1)} apart in Lab in ${where}, under 20`);
  }
  const bad = labDistance(colourOf(t, "--warn"), colourOf(t, "--bad"));
  assert.ok(bad >= 15, `--warn and --bad are ${bad.toFixed(1)} apart in Lab in ${where}, under 15`);
}

// PLAN-3D-ALL U1 (D5, constraints f and g): one warm light.
for (const [mode, , ways] of MODES) {
  test(`the lamplight accent in ${mode}: text on every step, the filled primary, its dark ink, and never a warning`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      const where = `${mode} ${JSON.stringify(way)}`;
      for (const bg of ["--side", "--stage", "--bg", "--panel", "--card", "--raise", "--sel", "--field", "--overlay", "--over"]) {
        const r = contrast(colourOf(t, "--accent"), colourOf(t, bg));
        assert.ok(r >= 4.5, `--accent on ${bg} in ${where}: ${r.toFixed(2)} < 4.5`);
      }
      for (const bg of ["--bg", "--panel", "--card"]) {
        const r = contrast(colourOf(t, "--accent-fill"), colourOf(t, bg));
        assert.ok(r >= 3, `--accent-fill against ${bg} in ${where}: ${r.toFixed(2)} < 3`);
      }
      const ink = contrast(colourOf(t, "--accent-ink"), colourOf(t, "--accent-fill"));
      assert.ok(ink >= 4.5, `--accent-ink on --accent-fill in ${where}: ${ink.toFixed(2)} < 4.5`);
      // Dark ink on a lamplight fill, in both themes (4.1).
      assert.ok(luminance(colourOf(t, "--accent-ink")) < 0.05, "the filled primary's words are dark");
      const d = labDistance(colourOf(t, "--accent-fill"), colourOf(t, "--warn"));
      assert.ok(d >= 15, `--accent-fill and --warn are ${d.toFixed(1)} apart in Lab in ${where}, under 15`);
      assertStatesApart(t, where);
      // The lamp glyph is a mark: 3 to 1 on the ground, the rail and a card; the focus ring is the lamp's accent.
      for (const bg of ["--bg", "--panel", "--card"]) {
        const r = contrast(colourOf(t, "--lamp"), colourOf(t, bg));
        assert.ok(r >= 3, `--lamp against ${bg} in ${where}: ${r.toFixed(2)} < 3`);
      }
      assert.equal(computed(t, "--focus"), computed(t, "--accent"));
      // A row in the lamp's pool keeps every ink and the accent at 4.5, on the rail and on a card.
      for (const under of ["--panel", "--card", "--bg"]) {
        const ground = over(colourOf(t, "--lamp-pool"), colourOf(t, under));
        for (const fg of ["--ink", "--ink-2", "--ink-3", "--accent"]) {
          const r = contrast(colourOf(t, fg), ground);
          assert.ok(r >= 4.5, `${fg} on --lamp-pool over ${under} in ${where}: ${r.toFixed(2)} < 4.5`);
        }
      }
    }
  });
}

// PLAN-3D-ALL U1 (D4, D6, constraint h): a panel over a scene is opaque; the room header's scrim is at least 72
// percent under the title, so the title and its lede read over any picture, the brightest and the darkest.
test("the over-panel is opaque, and the room header's scrim holds the title over any picture", () => {
  for (const [mode, , ways] of MODES) {
    for (const way of ways) {
      const t = resolveTokens(way);
      const where = `${mode} ${JSON.stringify(way)}`;
      assert.equal(colourOf(t, "--over").a, 1, `--over is opaque in ${where}`);
      const s0 = colourOf(t, "--room-scrim-0");
      const s1 = colourOf(t, "--room-scrim-1");
      assert.ok(s0.a >= 0.72, `--room-scrim-0 is at least 72 percent under the title in ${where}: ${s0.a}`);
      assert.ok(s1.a < s0.a, `--room-scrim-1 lets the picture show (${where})`);
      assert.deepEqual([s0.r, s0.g, s0.b], [s1.r, s1.g, s1.b], "one colour, two strengths");
      for (const picture of ["#000000", "#ffffff", "#c8925f", "#161c2c"]) {
        const ground = over(s0, parseColour(picture));
        for (const fg of ["--ink", "--ink-2"]) {
          const r = contrast(colourOf(t, fg), ground);
          assert.ok(r >= 4.5, `${fg} on the scrim over ${picture} in ${where}: ${r.toFixed(2)} < 4.5`);
        }
      }
    }
  }
});

// PLAN-3D-ALL U1 (D4): the two surfaces are scopes that re-point the core names, exactly as pinned.
test("the paper and over scopes set exactly their pinned names, and the aliases follow them", () => {
  const declared = { paper: new Map(), over: new Map() };
  let aliasRule = 0;
  for (const rule of SCOPE_RULES) {
    for (const sel of rule.selectors) {
      if (sel === ":root") continue;
      if (sel === "[data-surface]") {
        // The aliases' rule: exactly the alias names, and only on :root beside it.
        assert.deepEqual(rule.selectors, [":root", "[data-surface]"]);
        assert.deepEqual([...rule.decls.keys()].filter((n) => n.startsWith("--")).sort(),
          Object.keys(ALIASES).filter((n) => !n.startsWith("--w-")).concat(["--primary-hover", "--accept-hover"]).sort());
        aliasRule++;
        continue;
      }
      const name = sel.match(/^\[data-surface="([a-z]+)"\]$/)[1];
      assert.ok(name in declared, `an unknown surface: ${sel}`);
      assert.deepEqual(rule.selectors, [sel], `${sel} stands alone`);
      for (const [k, v] of rule.decls) if (k.startsWith("--")) declared[name].set(k, v);
    }
  }
  assert.equal(aliasRule, 1, "one aliases' rule on :root and [data-surface]");
  for (const surface of ["paper", "over"]) assert.deepEqual(Object.fromEntries(declared[surface]), SURFACES[surface], `[data-surface="${surface}"]`);
  // Every core name D4 lists is re-pointed on paper, and nothing a scope sets is an alias (they follow on their own).
  for (const name of ["--bg", "--panel", "--card", "--raise", "--sel", "--field", "--ctl", "--chip", "--line", "--line-2", "--ink", "--ink-2", "--ink-3", "--accent", "--accent-fill", "--accent-ink", "--good", "--warn", "--bad"]) {
    assert.ok(name in SURFACES.paper, `paper re-points ${name}`);
  }
  for (const surface of ["paper", "over"]) for (const name of Object.keys(SURFACES[surface])) assert.ok(!(name in ALIASES), `${name} is not an alias`);
  for (const surface of ["paper", "over"]) {
    for (const [, , ways] of MODES) {
      for (const way of ways) {
        const e = resolveSurface(way, surface);
        for (const [alias, target] of Object.entries(ALIASES)) {
          if (alias.startsWith("--w-")) continue;
          assert.equal(computed(e, alias), computed(e, target.slice(4, -1)), `${alias} on ${surface} in ${JSON.stringify(way)}`);
        }
      }
    }
  }
  // The scopes hold no colour a theme would need to change except through the themed paper and over families.
  assert.match(stripComments(TOKENS_CSS), /\[data-surface="paper"\]\s*\{[^}]*color-scheme: light;/, "paper's controls are drawn light");
});

// PLAN-3D-ALL U1 (D4, constraints d and e): what is on paper reads at the same floors as on the ground.
for (const [mode, , ways] of MODES) {
  test(`on paper, in ${mode}: every ink, the accent and the states on paper, its inset and its steps`, () => {
    for (const way of ways) {
      const t = resolveSurface(way, "paper");
      const where = `paper ${mode} ${JSON.stringify(way)}`;
      const grounds = ["--paper", "--paper-2", "--bg", "--stage", "--panel", "--card", "--field", "--sel", "--raise", "--overlay"];
      for (const bg of grounds) {
        for (const fg of ["--ink", "--ink-2", "--ink-3", "--accent", "--good", "--warn", "--bad"]) {
          const r = contrast(colourOf(t, fg), colourOf(t, bg));
          assert.ok(r >= 4.5, `${fg} on ${bg} in ${where}: ${r.toFixed(2)} < 4.5`);
        }
      }
      for (const bg of ["--paper", "--paper-2"]) {
        const r = contrast(colourOf(t, "--accent-fill"), colourOf(t, bg));
        assert.ok(r >= 3, `--accent-fill against ${bg} in ${where}: ${r.toFixed(2)} < 3`);
      }
      for (const fill of ["--accent-fill", "--bad-fill"]) {
        const r = contrast(colourOf(t, "--accent-ink"), colourOf(t, fill));
        assert.ok(r >= 4.5, `--accent-ink on ${fill} in ${where}: ${r.toFixed(2)} < 4.5`);
      }
      const d = labDistance(colourOf(t, "--accent-fill"), colourOf(t, "--warn"));
      assert.ok(d >= 15, `--accent-fill and --warn on paper are ${d.toFixed(1)} apart in Lab in ${where}`);
      assertStatesApart(t, where);
      // The Lamp glyph's "on" disc reads on cream (a mark: 3 to 1 on paper and its inset).
      for (const bg of ["--paper", "--paper-2"]) assert.ok(contrast(colourOf(t, "--lamp"), colourOf(t, bg)) >= 3, `--lamp on ${bg} in ${where}`);
      // The focus ring shows on paper: the accent at 3 to 1 as a mark.
      assert.ok(contrast(colourOf(t, "--focus"), colourOf(t, "--paper")) >= 3, `the focus ring on paper in ${where}`);
      for (const under of ["--paper", "--paper-2"]) {
        const ground = colourOf(t, under);
        for (const [fg, tint] of [["--warn", "--warn-bg"], ["--bad", "--bad-bg"], ["--good", "--add-bg"], ["--good", "--good-bg"], ["--accent", "--info-bg"], ["--ink-2", "--ctl"], ["--ink-2", "--chip"], ["--ink", "--lamp-pool"], ["--ink-3", "--lamp-pool"]]) {
          const r = contrast(colourOf(t, fg), over(colourOf(t, tint), ground));
          assert.ok(r >= 4.5, `${fg} on ${tint} over ${under} in ${where}: ${r.toFixed(2)} < 4.5`);
        }
        for (const tint of TINTS) {
          const r = contrast(colourOf(t, `--tint-${tint}`), over(colourOf(t, `--tint-${tint}-bg`), ground));
          assert.ok(r >= 4.5, `tint ${tint} on its fill over ${under} in ${where}: ${r.toFixed(2)} < 4.5`);
        }
      }
      const chip = contrast(colourOf(t, "--chip"), colourOf(t, "--paper"));
      assert.ok(chip >= 1.3, `--chip against paper in ${where}: ${chip.toFixed(2)} < 1.3`);
    }
  });

  test(`over a scene, in ${mode}: every ink and the accent on the over-panel`, () => {
    for (const way of ways) {
      const t = resolveSurface(way, "over");
      for (const bg of ["--bg", "--panel", "--over"]) {
        for (const fg of ["--ink", "--ink-2", "--ink-3", "--accent", "--good", "--warn", "--bad"]) {
          const r = contrast(colourOf(t, fg), colourOf(t, bg));
          assert.ok(r >= 4.5, `${fg} on ${bg} over a scene in ${mode} ${JSON.stringify(way)}: ${r.toFixed(2)} < 4.5`);
        }
      }
    }
  });
}

test("one overlay surface: in dark lighter than a card, in light the card's warm white; its edge a step firmer than a card's", () => {
  const dark = resolveTokens({});
  assert.ok(luminance(colourOf(dark, "--overlay")) > luminance(colourOf(dark, "--card")), "--overlay is above --card (dark)");
  assert.ok(parseColour(computed(dark, "--overlay-line")).a >= 0.14, "the overlay's edge is at least 14 percent white (dark)");
  assert.ok(parseColour(computed(dark, "--line")).a >= 0.08, "a card's edge is at least 8 percent white (dark)");
  const light = resolveTokens({ theme: "light" });
  // The quiet look was rejected on 16 November 2026 (PLAN-3D-ALL U1): was "#ffffff"; now the card's warm white.
  assert.equal(computed(light, "--overlay"), THEMED["--overlay"][1]);
  assert.equal(computed(light, "--overlay"), computed(light, "--card"));
  assert.ok(luminance(colourOf(light, "--overlay-line")) < luminance(colourOf(light, "--line")), "the overlay's edge is firmer than a card's (light)");
  // Fix rounds R5 and R6: the overlay a step above a card in dark (at least 3 L*) with its edge at 16 percent white.
  assert.ok(lstar(colourOf(dark, "--overlay")) - lstar(colourOf(dark, "--card")) >= 3, "the overlay is a step above a card (dark)");
  assert.ok(parseColour(computed(dark, "--overlay-line")).a >= 0.16, "the overlay's edge is at least 16 percent white (dark)");
  // The dim (fix round R6): black at 60 percent in dark; in light a near-black at about a quarter, so the page
  // behind recedes and is not washed out.
  const dimDark = parseColour(computed(dark, "--scrim"));
  assert.ok(dimDark.a >= 0.55 && dimDark.a <= 0.65 && dimDark.r + dimDark.g + dimDark.b < 30, "the dark dim is a near-black at about 60 percent");
  const dimLight = parseColour(computed(light, "--scrim"));
  assert.ok(dimLight.a >= 0.2 && dimLight.a <= 0.35 && dimLight.r + dimLight.g + dimLight.b < 90, "the light dim is a near-black at about a quarter");
  // The quiet look was rejected on 16 November 2026 (PLAN-3D-ALL U1): was one cool drop at 6 percent
  // ("0 1px 2px rgba(16,24,40,.06)"); an oak board now has a real shadow, a warm contact drop and a soft one.
  assert.equal(computed(light, "--shadow-card"), "0 1px 2px rgba(60,40,20,.07), 0 6px 16px rgba(60,40,20,.06)");
  // Fix round R7: in dark what floats has a deep drop beside its edge (0 20px 60px at 55 percent black).
  assert.match(computed(dark, "--overlay-shadow"), /0 20px 60px rgba\(0,0,0,\.55\)/);
});

test("every raised thing has a real shadow in both themes: the card, lift and float shadows are never none", () => {
  for (const way of [{}, { theme: "light" }]) {
    const t = resolveTokens(way);
    for (const name of ["--shadow-card", "--shadow-lift", "--float", "--overlay-shadow", "--paper-shadow"]) {
      const v = computed(t, name);
      assert.notEqual(v, "none", `${name} in ${JSON.stringify(way)}`);
      // At least one shadow in the list is blurred (a soft drop, not a ring alone).
      assert.ok(v.split(/,(?![^(]*\))/).some((part) => /^\s*-?\d+p?x?\s+\d+px\s+[1-9]\d*px/.test(part.trim())), `${name} has a soft drop: ${v}`);
    }
  }
});

test("the kept names are aliases of the new ones in both themes", () => {
  for (const way of [{}, { theme: "light" }]) {
    const t = resolveTokens(way);
    for (const [alias, target] of Object.entries(ALIASES)) {
      assert.equal(computed(t, alias), computed(t, target.slice(4, -1)), `${alias} in ${JSON.stringify(way)}`);
    }
  }
});

test("data-dept sets --dept to that department's colour, for all eight", () => {
  const seen = new Map();
  for (const rule of DEPT_RULES) {
    for (const sel of rule.selectors) {
      const id = sel.match(/^\[data-dept="([a-z]+)"\]$/)[1];
      assert.deepEqual([...rule.decls.keys()], ["--dept"], `${sel} sets only --dept`);
      seen.set(id, rule.decls.get("--dept"));
    }
  }
  assert.deepEqual([...seen.keys()].sort(), [...DEPTS].sort());
  for (const id of DEPTS) assert.equal(seen.get(id), `var(--dept-${id})`);
});

// --- tests: contrast on the opaque grounds, with translucent tints laid over a panel ---

// Every surface text is drawn on (fix round A3: the card, the field and the overlay too).
const GROUNDS = ["--bg", "--stage", "--panel", "--side", "--card", "--field", "--sel", "--raise", "--overlay"];

for (const [mode, , ways] of MODES) {
  test(`text on each ground step, in ${mode}`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      const pair = (fg, bg, floor, under) => {
        const ratio = contrast(colourOf(t, fg), under ?? colourOf(t, bg));
        assert.ok(ratio >= floor, `${fg} on ${bg} in ${mode} ${JSON.stringify(way)}: ${ratio.toFixed(2)} < ${floor}`);
      };
      for (const bg of GROUNDS) for (const fg of ["--ink", "--ink-2", "--ink-3", "--accent"]) pair(fg, bg, 4.5);
      pair("--accent-ink", "--accent-fill", 4.5);
      pair("--accent-ink", "--bad-fill", 4.5);
      pair("--accent", "--bg", 3);
      pair("--tip-ink", "--tip", 4.5);
    }
  });

  test(`state colours on the ground, on a panel and on their own tints over a panel, in ${mode}`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      const panel = colourOf(t, "--panel");
      for (const state of ["--good", "--warn", "--bad"]) {
        for (const bg of ["--bg", "--panel"]) {
          const ratio = contrast(colourOf(t, state), colourOf(t, bg));
          assert.ok(ratio >= 4.5, `${state} on ${bg} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
      for (const [fg, tint] of [["--warn", "--warn-bg"], ["--bad", "--bad-bg"], ["--good", "--add-bg"]]) {
        const ratio = contrast(colourOf(t, fg), over(colourOf(t, tint), panel));
        assert.ok(ratio >= 4.5, `${fg} on ${tint} over --panel in ${mode}: ${ratio.toFixed(2)} < 4.5`);
      }
      // The chips (fix round A3): one system, each tone's ink on its own tint, over a card, a panel, the raised
      // step and the overlay.
      for (const [fg, tint] of [["--ink-2", "--ctl"], ["--ink-2", "--chip"], ["--good", "--good-bg"], ["--warn", "--warn-bg"], ["--bad", "--bad-bg"], ["--accent", "--info-bg"]]) {
        for (const under of ["--card", "--panel", "--raise", "--overlay"]) {
          const ratio = contrast(colourOf(t, fg), over(colourOf(t, tint), colourOf(t, under)));
          assert.ok(ratio >= 4.5, `chip ${fg} on ${tint} over ${under} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
      // The neutral chip (fix round R5) stands off a card and a panel: its fill at least 1.3 to 1 against them.
      for (const under of ["--card", "--panel"]) {
        const ratio = contrast(colourOf(t, "--chip"), colourOf(t, under));
        assert.ok(ratio >= 1.3, `--chip against ${under} in ${mode}: ${ratio.toFixed(2)} < 1.3`);
      }
      // The tints (fix round R5): each ink on its own fill, over a card, a panel and the overlay.
      for (const tint of TINTS) {
        for (const under of ["--card", "--panel", "--overlay"]) {
          const ratio = contrast(colourOf(t, `--tint-${tint}`), over(colourOf(t, `--tint-${tint}-bg`), colourOf(t, under)));
          assert.ok(ratio >= 4.5, `tint ${tint} on its fill over ${under} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
    }
  });
}

test("the contrast helpers composite and measure as WCAG does", () => {
  assert.equal(contrast(parseColour("#ffffff"), parseColour("#000000")).toFixed(1), "21.0");
  assert.equal(contrast(parseColour("#777777"), parseColour("#777777")), 1);
  const half = over(parseColour("rgba(255,255,255,.5)"), parseColour("#000000"));
  assert.equal(Math.round(half.r), 128);
  // A translucent text colour is laid over its backdrop before it is measured.
  assert.equal(contrast(parseColour("rgba(255,255,255,0)"), parseColour("#000000")), 1);
});

// --- tests: the flat ground ---

test("the canvas is gone: no canvas.css, no bundled fonts, and the shell draws no s-canvas", () => {
  assert.ok(!existsSync(join(STYLES, "canvas.css")), "styles/canvas.css is removed");
  assert.ok(!existsSync(join(PUBLIC, "assets", "fonts")), "assets/fonts/ is removed: system fonts only");
  const shell = readFileSync(join(PUBLIC, "shell", "app-shell.js"), "utf8");
  assert.doesNotMatch(shell, /s-canvas/, "app-shell.js renders no s-canvas");
  assert.doesNotMatch(stripComments(TOKENS_CSS), /aurora|--star\b|Geist|url\(|@font-face/);
});

test("no stylesheet under styles/ lays a gradient on html, body or .s-app", () => {
  const files = walkCss(STYLES);
  assert.ok(files.length > 20, "the stylesheets were found");
  for (const file of files) {
    for (const r of parseRules(readFileSync(file, "utf8")).rules) {
      const ground = r.selectors.some((s) => /^(?::root(?:\[[^\]]+\])*\s+)?(?:html|body|\.s-app)(?:\[[^\]]+\])*$/.test(s) || /^:root(?:\[[^\]]+\])*$/.test(s));
      if (!ground) continue;
      for (const [prop, value] of r.decls) {
        if (prop.startsWith("--")) continue;
        assert.doesNotMatch(value, /gradient\(/, `${file}: ${r.selectors.join(", ")} { ${prop} } has a gradient`);
      }
    }
  }
});

// --- tests: the base stylesheet ---

function walkCss(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkCss(full, out);
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

test("no stylesheet other than tokens.css defines a token", () => {
  const files = [...walkCss(STYLES), ...walkCss(join(PUBLIC, "assets"))].filter((f) => f !== join(STYLES, "tokens.css"));
  assert.ok(files.includes(join(STYLES, "base.css")));
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8"));
    const defs = [...src.matchAll(/(?:^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]).filter((n) => PINNED.has(n));
    assert.deepEqual(defs, [], `${file} defines pinned tokens: ${defs.join(" ")}`);
  }
  const baseDefs = [...stripComments(BASE_CSS).matchAll(/(?:^|[;{\s])(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]);
  assert.deepEqual(baseDefs, [], `base.css defines custom properties: ${baseDefs.join(" ")}`);
});

test("base.css has no hex colour, no colour function, no raw font and no px font size", () => {
  const src = stripComments(BASE_CSS);
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, "hex colour in base.css");
  assert.doesNotMatch(src, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/, "colour function in base.css");
  for (const m of src.matchAll(/font-family\s*:\s*([^;}]+)/g)) {
    // PLAN-3D-ALL U1 (D5): titles take --font-display.
    assert.match(m[1].trim(), /^var\(--font-(?:sans|mono|serif|display)\)$/, `font-family not through a token: ${m[1]}`);
  }
  for (const m of src.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]+)/g)) {
    assert.equal(m[1].trim(), "inherit", `font shorthand other than inherit: ${m[1]}`);
  }
  for (const m of src.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    assert.match(m[1].trim(), /^var\(--fs-[a-z]+\)$/, `font-size not through a token: ${m[1]}`);
  }
  assert.doesNotMatch(src, /url\(|@import|@font-face/, "base.css loads nothing");
  assert.doesNotMatch(TOKENS_CSS, /url\(|@import|@font-face|https?:/, "tokens.css loads nothing");
  assert.doesNotMatch(src, /filter|will-change/, "base.css has no filter and no will-change");
});

test("base.css uses only tokens that exist", () => {
  const used = new Set([...stripComments(BASE_CSS).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const unknown = [...used].filter((n) => !PINNED.has(n));
  assert.deepEqual(unknown, [], `unknown tokens in base.css: ${unknown.join(" ")}`);
});

const BASE = parseRules(BASE_CSS).rules;

function rulesFor(selector) {
  return BASE.filter((r) => r.selectors.includes(selector));
}

function declOf(selector, prop) {
  for (const r of rulesFor(selector).reverse()) if (r.decls.has(prop)) return r.decls.get(prop);
  return undefined;
}

test("base.css holds the document defaults, focus ring, selection, motion off and reduced motion", () => {
  assert.equal(declOf("*", "box-sizing"), "border-box");
  assert.equal(declOf("body", "margin"), "0");
  for (const el of ["button", "input"]) assert.equal(declOf(el, "font"), "inherit");
  assert.equal(declOf("html", "font-family"), "var(--font-sans)");
  assert.equal(declOf("html", "font-size"), "var(--fs-body)");
  assert.equal(declOf("html", "line-height"), "var(--lh-body)");
  assert.equal(declOf("html", "color"), "var(--ink)");
  assert.equal(declOf("html", "background"), "var(--bg)");
  assert.match(declOf("html", "-webkit-font-smoothing"), /antialiased/);
  for (const h of ["h1", "h2", "h3"]) assert.match(declOf(h, "font-size"), /^var\(--fs-/);
  // The page title is the one display size, at the display weight with its tracking; sections and below are
  // bold at their size.
  assert.equal(declOf("h1", "font-size"), "var(--fs-page)");
  assert.equal(declOf("h1", "font-weight"), "var(--fw-medium)");
  assert.equal(declOf("h1", "letter-spacing"), "var(--ls-page)");
  assert.equal(declOf("h2", "font-size"), "var(--fs-section)");
  // PLAN-3D-ALL U1 (D5): titles in the display face; h3 and below, and everything read or typed, on the system face.
  for (const h of ["h1", "h2"]) assert.equal(declOf(h, "font-family"), "var(--font-display)", `${h} in the display face`);
  for (const h of ["h3", "h4", "h5", "h6"]) assert.equal(declOf(h, "font-family"), undefined, `${h} keeps the system face`);
  // PLAN-3D-ALL U1 (D8): a page's content rises 8 px and fades in over 180 ms once (not on the Map or an app).
  const enter = BASE.find((r) => r.selectors.some((s) => /^\.s-content:not\(\.s-content--map\):not\(\.s-content--fill\) > \*$/.test(s)));
  assert.ok(enter, "the page-enter rule");
  assert.match(enter.decls.get("animation"), /^u-page-enter 180ms var\(--ease\)$/, "once, 180 ms, no fill left behind");
  const frames = parseRules(BASE_CSS).keyframes.get("u-page-enter");
  assert.deepEqual(frames.map((f) => [...f.decls.keys()].sort()), [["opacity", "transform"], ["opacity", "transform"]], "transform and opacity only");
  assert.match(frames[0].decls.get("transform"), /^translateY\(8px\)$/);
  assert.equal(frames[1].decls.get("transform"), "none");
  assert.equal(declOf("h3", "font-size"), "var(--fs-body)");
  for (const h of ["h2", "h3"]) {
    const weight = BASE.filter((r) => r.selectors.includes(h)).map((r) => r.decls.get("font-weight")).filter(Boolean).pop();
    assert.equal(weight, "var(--fw-bold)", `${h} is bold`);
  }
  assert.equal(declOf("a", "color"), "var(--accent)");
  assert.equal(declOf("a", "text-decoration"), "underline");
  assert.equal(declOf(":focus-visible", "outline"), "2px solid var(--focus)");
  assert.equal(declOf(":focus-visible", "outline-offset"), "2px");
  assert.ok(rulesFor("::selection").length === 1);
  const reduced = BASE.filter((r) => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media));
  assert.ok(reduced.length > 0, "no reduced-motion block");
  const d = reduced[0].decls;
  assert.match(d.get("animation-duration") ?? "", /!important/);
  assert.match(d.get("transition-duration") ?? "", /!important/);
  const off = rulesFor(':root[data-motion="off"] *');
  assert.ok(off.length === 1, "a motion-off rule");
  // M55: motion off ends every animation at once (as reduced motion does) instead of pausing it, since a
  // paused opening animation held the Needs you drawer out of sight.
  assert.equal(off[0].decls.get("animation-play-state"), undefined);
  assert.match(off[0].decls.get("animation-duration") ?? "", /^0\.01ms !important$/);
  assert.match(off[0].decls.get("animation-iteration-count") ?? "", /^1 !important$/);
  assert.match(off[0].decls.get("transition-duration") ?? "", /!important/);
});

test("base.css defines every u- utility the contracts name, and no other", () => {
  const expected = {
    ".u-visually-hidden": { position: /absolute/, overflow: /hidden/ },
    ".u-row": { display: "flex", "align-items": "center", gap: "var(--s-2)" },
    ".u-stack": { display: "flex", "flex-direction": "column", gap: "var(--s-3)" },
    ".u-spread": { display: "flex", "justify-content": "space-between" },
    ".u-muted": { color: "var(--ink-2)" },
    ".u-caption": { "font-size": "var(--fs-note)", color: "var(--ink-2)" },
    ".u-num": { "font-variant-numeric": "tabular-nums" },
    ".u-mono": { "font-family": "var(--font-mono)" },
    ".u-truncate": { "text-overflow": "ellipsis", "white-space": "nowrap", overflow: "hidden" },
    ".u-wrap": { "overflow-wrap": "anywhere" },
    ".u-grow": { flex: "1 1 auto" },
    // The 12 px label in sentence case: no capitals and no wide tracking (the slop ban list).
    ".u-over": { "font-size": "var(--fs-label)", "letter-spacing": "var(--ls-label)", "font-weight": "var(--fw-medium)", color: "var(--ink-3)" },
    // A department's name: the stat size in the one face, as written.
    ".u-serif": { "font-family": "var(--font-sans)", "font-size": "var(--fs-stat)", "font-weight": "var(--fw-medium)" },
    // Kept for the un-migrated pages: an opaque card with a hairline edge, no blur.
    ".u-glass": { background: "var(--card)", border: "1px solid var(--line)", "box-shadow": "var(--highlight)", "border-radius": "var(--r-3)" },
  };
  for (const sel of [".u-over", ".u-serif"]) {
    assert.equal(declOf(sel, "text-transform"), undefined, `${sel} has no text-transform`);
  }
  assert.equal(declOf(".u-serif", "letter-spacing"), undefined, ".u-serif has no letter-spacing");
  assert.doesNotMatch(stripComments(BASE_CSS), /text-transform\s*:\s*uppercase/, "base.css sets no capitals");
  for (const [sel, props] of Object.entries(expected)) {
    for (const [prop, want] of Object.entries(props)) {
      const got = declOf(sel, prop);
      assert.ok(got !== undefined, `${sel} has no ${prop}`);
      if (want instanceof RegExp) assert.match(got, want, `${sel} ${prop}`);
      else assert.equal(got, want, `${sel} ${prop}`);
    }
  }
  const defined = new Set([...stripComments(BASE_CSS).matchAll(/\.(u-[a-z-]+)/g)].map((m) => "." + m[1]));
  assert.deepEqual([...defined].sort(), Object.keys(expected).sort());
});

// --- tests: theme-boot.js and theme.js ---

function fakeRoot() {
  const attrs = new Map();
  return {
    attrs,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: (k) => attrs.delete(k),
  };
}

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function boot(search = "", stored = {}) {
  const root = fakeRoot();
  vm.runInNewContext(BOOT_JS, {
    document: { documentElement: root },
    location: { search },
    localStorage: fakeStorage(stored),
    URLSearchParams,
  });
  return Object.fromEntries(root.attrs);
}

test("theme-boot.js: dark, the aurora and motion on with no choice; the address wins over this browser", () => {
  assert.deepEqual(boot(), { "data-theme": "dark", "data-backdrop": "aurora", "data-motion": "on" });
  const kept = { "home.theme": "light", "home.accent": "blue", "home.backdrop": "stars", "home.motion": "off" };
  assert.deepEqual(boot("", kept), { "data-theme": "light", "data-accent": "blue", "data-backdrop": "stars", "data-motion": "off" });
  assert.deepEqual(boot("?theme=auto&accent=rose&backdrop=plain&motion=on", kept),
    { "data-theme": "auto", "data-accent": "rose", "data-backdrop": "plain", "data-motion": "on" });
  assert.deepEqual(boot("?theme=pink&backdrop=lava&motion=fast&accent=gold", { "home.theme": "nope" }),
    { "data-theme": "dark", "data-backdrop": "aurora", "data-motion": "on" });
  assert.doesNotMatch(BOOT_JS, /\bimport\b|\bexport\b/, "a classic script");
});

test("theme.js reads and sets the theme, the accent, the backdrop and motion", async () => {
  const root = fakeRoot();
  const storage = fakeStorage();
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.document = { documentElement: root };
  globalThis.localStorage = storage;
  try {
    const m = await import("../lib/theme.js");
    assert.equal(m.currentTheme(), "dark");
    assert.equal(m.currentBackdrop(), "aurora");
    assert.equal(m.currentMotion(), "on");
    m.setTheme("auto");
    assert.equal(root.getAttribute("data-theme"), "auto");
    assert.equal(storage.getItem("home.theme"), "auto");
    assert.equal(m.currentTheme(), "auto");
    m.setBackdrop("plain");
    assert.equal(m.currentBackdrop(), "plain");
    assert.equal(storage.getItem("home.backdrop"), "plain");
    m.setMotion("off", { remember: false });
    assert.equal(m.currentMotion(), "off");
    assert.equal(storage.getItem("home.motion"), null);
    root.setAttribute("data-backdrop", "lava");
    assert.equal(m.currentBackdrop(), "aurora");
    assert.equal(m.nextTheme("dark"), "auto");
    for (const name of ["currentTheme", "setTheme", "nextTheme", "THEME_WORDS", "ACCENTS", "setAccent", "currentAccent", "currentBackdrop", "currentMotion"]) {
      assert.ok(name in m, `theme.js exports ${name}`);
    }
  } finally {
    globalThis.document = saved.document;
    globalThis.localStorage = saved.localStorage;
  }
});
