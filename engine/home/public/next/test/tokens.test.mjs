// Checks the design tokens, the base stylesheet and the canvas (CONTRACTS-V3 section 27): every pinned token
// resolves to its pinned value in dark and light, whichever way the theme is chosen, for every accent; no other
// file defines a token; the pinned text pairs meet their contrast with translucent colours laid over the canvas
// and over each aurora light; the canvas keeps the battery rules; and theme-boot.js and theme.js set and read
// the four attributes on <html>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES = join(PUBLIC, "styles");
const TOKENS_CSS = readFileSync(join(STYLES, "tokens.css"), "utf8");
const BASE_CSS = readFileSync(join(STYLES, "base.css"), "utf8");
const CANVAS_CSS = readFileSync(join(STYLES, "canvas.css"), "utf8");
const BOOT_JS = readFileSync(join(PUBLIC, "lib", "theme-boot.js"), "utf8");

// Section 27.1, themed: [dark, light].
const THEMED = {
  "--canvas": ["#0a0b0f", "#f6f5f2"],
  "--glass": ["rgba(22,24,31,.72)", "rgba(255,255,255,.78)"],
  "--glass-strong": ["rgba(22,24,31,.92)", "rgba(255,255,255,.94)"],
  "--glass-soft": ["rgba(255,255,255,.05)", "rgba(15,17,23,.04)"],
  "--hairline": ["rgba(255,255,255,.10)", "rgba(15,17,23,.10)"],
  "--hairline-strong": ["rgba(255,255,255,.18)", "rgba(15,17,23,.20)"],
  "--highlight": ["inset 0 1px 0 rgba(255,255,255,.06)", "inset 0 1px 0 rgba(255,255,255,.7)"],
  "--text": ["#f2f3f5", "#14151a"],
  "--text-2": ["#b4b8c4", "#4b4f5c"],
  "--text-3": ["#9297a6", "#5f6474"],
  "--primary": ["#f2f3f5", "#14151a"],
  "--primary-hover": ["#ffffff", "#2a2c35"],
  "--primary-text": ["#0a0b0f", "#ffffff"],
  "--accept": ["#15803d", "#15803d"],
  "--accept-hover": ["#166534", "#166534"],
  "--accept-text": ["#ffffff", "#ffffff"],
  "--ok": ["#4ade80", "#16a34a"],
  "--ok-bg": ["rgba(74,222,128,.12)", "rgba(22,163,74,.12)"],
  "--ok-text": ["#86efac", "#166534"],
  "--warn": ["#fbbf24", "#d97706"],
  "--warn-bg": ["rgba(251,191,36,.12)", "rgba(217,119,6,.14)"],
  "--warn-text": ["#fcd34d", "#8a3c0a"],
  "--bad": ["#f87171", "#dc2626"],
  "--bad-bg": ["rgba(248,113,113,.12)", "rgba(220,38,38,.10)"],
  "--bad-text": ["#fca5a5", "#991b1b"],
  "--bg-warm": ["rgba(251,191,36,.10)", "rgba(217,119,6,.10)"],
  "--border-warm": ["rgba(251,191,36,.42)", "rgba(217,119,6,.45)"],
  "--live": ["#4ade80", "#16a34a"],
  "--shadow-pop": ["0 16px 48px rgba(0,0,0,.55)", "0 16px 48px rgba(20,21,26,.16)"],
  "--dept-operations": ["#8b9cff", "#4f5bd5"],
  "--dept-sales": ["#ff8a6b", "#c8492a"],
  "--dept-marketing": ["#d48cff", "#9442c9"],
  "--dept-studio": ["#3fd6c4", "#0f8f80"],
  "--dept-support": ["#5fb8ff", "#1877c9"],
  "--dept-people": ["#f7c35a", "#9a6400"],
  "--dept-books": ["#69d98b", "#1f8a4c"],
  "--dept-brain": ["#e8e6ff", "#3a3d4a"],
  "--aurora-1": ["#2dd4bf", "#5eead4"],
  "--aurora-2": ["#8b5cf6", "#c4b5fd"],
  "--aurora-3": ["#ec4899", "#f9a8d4"],
  "--aurora-4": ["#f59e0b", "#fcd34d"],
  "--aurora-5": ["#22c55e", "#86efac"],
  "--aurora-alpha": [".34", ".45"],
  "--star": ["rgba(255,255,255,.55)", "rgba(20,21,26,.18)"],
  // Kept from V2 per theme (section 27.1, last paragraph); in dark, graphite is #f2f3f5 on #0a0b0f.
  "--accent-graphite": ["#f2f3f5", "#18181b"],
  "--accent-blue": ["#60a5fa", "#2563eb"],
  "--accent-green": ["#4ade80", "#15803d"],
  "--accent-violet": ["#a78bfa", "#7c3aed"],
  "--accent-orange": ["#fb923c", "#c2410c"],
  "--accent-rose": ["#fb7185", "#be123c"],
  "--checker-a": ["#d4d4d8", "#f4f4f5"],
  "--checker-b": ["#b4b4bc", "#e4e4e7"],
  "--avatar-backing": ["#b4b4bc", "#f4f4f5"],
};

// Kept names: aliases of the new ones, in both themes.
const ALIASES = {
  "--bg": "var(--canvas)",
  "--bg-card": "var(--glass)",
  "--bg-sidebar": "var(--glass-strong)",
  "--bg-subtle": "var(--glass-soft)",
  "--border": "var(--hairline)",
  "--border-strong": "var(--hairline-strong)",
};

// Accents: { name: [[accent, accent-text] dark, [accent, accent-text] light] }.
const ACCENTS = {
  graphite: [["#f2f3f5", "#0a0b0f"], ["#18181b", "#ffffff"]],
  blue: [["#60a5fa", "#18181b"], ["#2563eb", "#ffffff"]],
  green: [["#4ade80", "#18181b"], ["#15803d", "#ffffff"]],
  violet: [["#a78bfa", "#18181b"], ["#7c3aed", "#ffffff"]],
  orange: [["#fb923c", "#18181b"], ["#c2410c", "#ffffff"]],
  rose: [["#fb7185", "#18181b"], ["#be123c", "#ffffff"]],
};

// Section 27.2, not themed.
const FIXED = {
  "--font-sans": '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--font-mono": '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  "--font-serif": '"Didot", "Bodoni 72", "Hoefler Text", "Baskerville", "Times New Roman", serif',
  "--fs-over": "11px", "--fs-caption": "12px", "--fs-body": "14px", "--fs-title": "16px", "--fs-heading": "22px",
  "--fs-display": "32px", "--fs-dept": "22px", "--fs-ghost": "clamp(72px, 14vw, 180px)",
  "--fw-regular": "400", "--fw-medium": "500", "--fw-bold": "600",
  "--lh-body": "1.5", "--lh-tight": "1.3",
  "--s-1": "4px", "--s-2": "8px", "--s-3": "12px", "--s-4": "16px", "--s-5": "20px", "--s-6": "24px",
  "--s-8": "32px", "--s-10": "40px", "--s-12": "48px",
  "--r-1": "6px", "--r-2": "10px", "--r-3": "12px", "--r-4": "16px", "--r-5": "22px", "--r-pill": "999px",
  "--h-sm": "28px", "--h-md": "36px", "--h-lg": "40px",
  "--blur-chrome": "18px",
  "--t-fast": "120ms", "--t-med": "200ms", "--t-slow": "320ms", "--t-zoom": "420ms", "--ease": "cubic-bezier(.2,0,0,1)",
  "--topbar-h": "56px", "--tabbar-h": "60px", "--dock-w": "56px", "--column": "720px", "--content-max": "1080px",
  "--panel-w": "380px",
  // Kept for the forked V2 shell until M13 replaces the sidebar.
  "--sidebar-w": "248px",
  "--focus": "var(--accent)",
  ...ALIASES,
};

const DEPTS = ["operations", "sales", "marketing", "studio", "support", "people", "books", "brain"];

const ROOT_PINNED = new Set([...Object.keys(THEMED), "--accent", "--accent-text", ...Object.keys(FIXED)]);
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
const TOKEN_RULES = ALL_TOKEN_RULES.filter((r) => !isDeptRule(r));
const DEPT_RULES = ALL_TOKEN_RULES.filter(isDeptRule);

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

const ACCENT_CHOICES = [undefined, ...Object.keys(ACCENTS)];
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

// The backdrops a text can sit on: the canvas alone, and the canvas under each aurora light at its strongest.
function backdrops(t) {
  const canvas = parseColour(computed(t, "--canvas"));
  const alpha = Number(computed(t, "--aurora-alpha"));
  const list = [["the canvas", canvas]];
  for (let n = 1; n <= 5; n++) list.push([`aurora ${n}`, over(withAlpha(parseColour(computed(t, `--aurora-${n}`)), alpha), canvas)]);
  return list;
}

const colourOf = (t, name) => parseColour(computed(t, name));

// --- tests: the tokens ---

test("tokens.css defines exactly the pinned token names", () => {
  const defined = new Set();
  for (const rule of ALL_TOKEN_RULES) for (const name of rule.decls.keys()) if (name.startsWith("--")) defined.add(name);
  const missing = [...PINNED].filter((n) => !defined.has(n));
  const extra = [...defined].filter((n) => !PINNED.has(n));
  assert.deepEqual(missing, [], `missing tokens: ${missing.join(" ")}`);
  assert.deepEqual(extra, [], `tokens not pinned in section 27: ${extra.join(" ")}`);
});

for (const [mode, index, ways] of MODES) {
  test(`every pinned token resolves to its pinned value in ${mode}, for every accent and every way of choosing ${mode}`, () => {
    let checked = 0;
    for (const way of ways) {
      for (const accent of ACCENT_CHOICES) {
        const t = resolveTokens({ ...way, accent });
        const where = `${mode} ${JSON.stringify(way)} accent=${accent ?? "(none)"}`;
        for (const [name, values] of Object.entries(THEMED)) {
          assert.equal(t[name], values[index], `${name} in ${where}`);
          checked++;
        }
        const [acc, accText] = ACCENTS[accent ?? "graphite"][index];
        assert.equal(t["--accent"], acc, `--accent in ${where}`);
        assert.equal(t["--accent-text"], accText, `--accent-text in ${where}`);
        assert.equal(computed(t, "--focus"), acc, `--focus in ${where}`);
        for (const [name, value] of Object.entries(FIXED)) {
          assert.equal(t[name], value, `${name} in ${where}`);
          checked++;
        }
        assert.equal(Object.keys(t).length, ROOT_PINNED.size, `token count in ${where}`);
      }
    }
    assert.ok(checked > 0);
  });
}

test("dark is the default and graphite the accent with no attribute", () => {
  const t = resolveTokens({});
  assert.equal(t["--canvas"], THEMED["--canvas"][0]);
  assert.equal(t["--accent"], ACCENTS.graphite[0][0]);
  assert.equal(resolveTokens({ theme: "light" })["--accent"], ACCENTS.graphite[1][0]);
  assert.equal(resolveTokens({ theme: "auto", systemLight: true })["--accent"], ACCENTS.graphite[1][0]);
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

// --- tests: contrast, with translucent colours laid over the canvas and each aurora light ---

for (const [mode, , ways] of MODES) {
  test(`text straight on the canvas and on each aurora light, in ${mode}`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      for (const [where, bg] of backdrops(t)) {
        for (const fg of ["--text", "--text-2"]) {
          const ratio = contrast(colourOf(t, fg), bg);
          assert.ok(ratio >= 4.5, `${fg} on ${where} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
    }
  });

  test(`all three text colours on glass over the canvas and over each aurora light, in ${mode}`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      for (const [where, under] of backdrops(t)) {
        const glass = over(colourOf(t, "--glass"), under);
        for (const fg of ["--text", "--text-2", "--text-3"]) {
          const ratio = contrast(colourOf(t, fg), glass);
          assert.ok(ratio >= 4.5, `${fg} on glass over ${where} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
    }
  });

  test(`buttons, state colours on their backgrounds over glass, accents and departments, in ${mode}`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      const canvas = colourOf(t, "--canvas");
      for (const [fg, bg] of [["--primary-text", "--primary"], ["--accept-text", "--accept"]]) {
        const ratio = contrast(colourOf(t, fg), colourOf(t, bg));
        assert.ok(ratio >= 4.5, `${fg} on ${bg} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
      }
      for (const [where, under] of backdrops(t)) {
        const glass = over(colourOf(t, "--glass"), under);
        for (const state of ["ok", "warn", "bad"]) {
          const bg = over(colourOf(t, `--${state}-bg`), glass);
          const ratio = contrast(colourOf(t, `--${state}-text`), bg);
          assert.ok(ratio >= 4.5, `--${state}-text on --${state}-bg over glass over ${where} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
        }
      }
      for (const accent of Object.keys(ACCENTS)) {
        const ta = resolveTokens({ ...way, accent });
        const onAccent = contrast(colourOf(ta, "--accent-text"), colourOf(ta, "--accent"));
        assert.ok(onAccent >= 4.5, `--accent-text on --accent (${accent}, ${mode}): ${onAccent.toFixed(2)} < 4.5`);
        const onBg = contrast(colourOf(ta, "--accent"), colourOf(ta, "--bg"));
        assert.ok(onBg >= 3, `--accent on --bg (${accent}, ${mode}): ${onBg.toFixed(2)} < 3`);
      }
      for (const id of DEPTS) {
        const ratio = contrast(colourOf(t, `--dept-${id}`), canvas);
        assert.ok(ratio >= 3, `--dept-${id} on --canvas in ${mode}: ${ratio.toFixed(2)} < 3`);
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

// --- tests: the canvas ---

const CANVAS = parseRules(CANVAS_CSS);
const canvasSrc = stripComments(CANVAS_CSS);

function canvasDecl(selector, prop, media = null) {
  for (const r of [...CANVAS.rules].reverse()) {
    if (r.media !== media || !r.selectors.includes(selector)) continue;
    if (r.decls.has(prop)) return r.decls.get(prop);
  }
  return undefined;
}

const PERIODS = [70, 84, 96, 110, 78];
const CENTRES = [[38, 34], [64, 30], [70, 62], [44, 70], [28, 54]];

test("the canvas is fixed behind everything and lets clicks through", () => {
  assert.equal(canvasDecl(".s-canvas", "position"), "fixed");
  assert.equal(canvasDecl(".s-canvas", "inset"), "0");
  assert.equal(canvasDecl(".s-canvas", "background"), "var(--canvas)");
  assert.equal(canvasDecl(".s-canvas", "pointer-events"), "none");
  assert.equal(canvasDecl(".s-canvas", "z-index"), "0");
});

test("five aurora lights: their colour, size, centre and a steps() drift of eight changes a second", () => {
  const steps = [...canvasSrc.matchAll(/steps\((\d+)\)/g)].map((m) => +m[1]);
  assert.equal(steps.length, 5, "five steps( animations");
  for (let n = 1; n <= 5; n++) {
    const sel = `.s-canvas__light--${n}`;
    assert.equal(canvasDecl(sel, "background"), `radial-gradient(closest-side, var(--aurora-${n}), transparent)`);
    const size = canvasDecl(sel, "--s-canvas-size").match(/^(\d+)vmax$/);
    assert.ok(size && +size[1] >= 46 && +size[1] <= 70, `${sel} is 46 to 70 vmax across`);
    assert.equal(canvasDecl(sel, "--s-canvas-x"), `${CENTRES[n - 1][0]}%`);
    assert.equal(canvasDecl(sel, "--s-canvas-y"), `${CENTRES[n - 1][1]}%`);
    const anim = canvasDecl(sel, "animation");
    const m = anim.match(/^(\S+) (\d+)s steps\((\d+)\) infinite alternate$/);
    assert.ok(m, `${sel} animation: ${anim}`);
    assert.equal(+m[2], PERIODS[n - 1], `${sel} period`);
    assert.equal(+m[3], 8 * PERIODS[n - 1], `${sel} steps are 8 x the period`);
    const frames = CANVAS.keyframes.get(m[1]);
    assert.ok(frames && frames.length >= 2, `keyframes ${m[1]}`);
    for (const f of frames) {
      assert.deepEqual([...f.decls.keys()], ["transform"], `${m[1]} moves transform only`);
      const t = f.decls.get("transform").match(/^translate3d\((-?[\d.]+)(?:vmax)?, (-?[\d.]+)(?:vmax)?, 0\) scale\(([\d.]+)\)$/);
      assert.ok(t, `${m[1]} transform: ${f.decls.get("transform")}`);
      assert.ok(Math.hypot(+t[1], +t[2]) <= 6, `${m[1]} moves at most 6 vmax`);
      assert.ok(+t[3] >= 0.95 && +t[3] <= 1.08, `${m[1]} scales between .95 and 1.08`);
    }
  }
  assert.equal(canvasDecl(".s-canvas__light", "opacity"), "var(--aurora-alpha)");
});

test("the stars: two fields of dots on 240 px and 360 px tiles, in --star, that do not move", () => {
  const bg = canvasDecl(".s-canvas__stars", "background-image");
  assert.equal((bg.match(/radial-gradient\(/g) || []).length, 2);
  assert.equal((bg.match(/var\(--star\)/g) || []).length, 2);
  assert.equal(canvasDecl(".s-canvas__stars", "background-size"), "240px 240px, 360px 360px");
  assert.equal(canvasDecl(".s-canvas__stars", "animation"), undefined);
});

test("canvas.css: no filter, no blend mode, no canvas, no script, nothing loaded", () => {
  assert.doesNotMatch(canvasSrc, /mix-blend-mode/);
  assert.doesNotMatch(canvasSrc, /filter: *blur/);
  assert.doesNotMatch(canvasSrc, /url\(|@import|@font-face|https?:/);
  for (const r of CANVAS.rules) {
    for (const [prop] of r.decls) {
      if (/(^|-)filter$/.test(prop)) {
        assert.ok(/backdrop-filter$/.test(prop) && r.selectors.join() === ".u-glass-chrome", `${r.selectors.join()} has ${prop}`);
      }
      if (/^(animation|transition)/.test(prop) && r.decls.get(prop) !== "none") {
        assert.ok(r.selectors.every((s) => /^\.s-canvas__light--[1-5]$/.test(s)), `only the lights animate: ${r.selectors.join()}`);
      }
    }
  }
});

test("canvas.css stops every drift under data-motion=\"off\" and reduced motion, and hides by data-backdrop", () => {
  assert.equal(canvasDecl(':root[data-motion="off"] .s-canvas__light', "animation"), "none");
  const reduced = CANVAS.rules.find((r) => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media) && r.selectors.includes(".s-canvas__light"));
  assert.ok(reduced, "a reduced-motion block for the lights");
  assert.equal(reduced.decls.get("animation"), "none");
  for (const sel of [':root[data-backdrop="stars"] .s-canvas__light', ':root[data-backdrop="plain"] .s-canvas__light', ':root[data-backdrop="plain"] .s-canvas__stars']) {
    assert.equal(canvasDecl(sel, "display"), "none", sel);
  }
  assert.equal(canvasDecl(':root[data-backdrop="stars"] .s-canvas__stars', "display"), undefined, "stars stay with stars");
});

test(".u-glass is translucent with no backdrop blur; .u-glass-chrome alone blurs", () => {
  assert.equal(canvasDecl(".u-glass", "background"), "var(--glass)");
  assert.equal(canvasDecl(".u-glass", "border"), "1px solid var(--hairline)");
  assert.equal(canvasDecl(".u-glass", "box-shadow"), "var(--highlight)");
  assert.equal(canvasDecl(".u-glass", "border-radius"), "var(--r-4)");
  for (const r of CANVAS.rules.filter((x) => x.selectors.includes(".u-glass"))) {
    for (const prop of r.decls.keys()) assert.doesNotMatch(prop, /filter/, ".u-glass has no filter");
  }
  assert.equal(canvasDecl(".u-glass-chrome", "background"), "var(--glass-strong)");
  assert.equal(canvasDecl(".u-glass-chrome", "--s-canvas-chrome"), "blur(var(--blur-chrome))");
  assert.equal(canvasDecl(".u-glass-chrome", "backdrop-filter"), "var(--s-canvas-chrome)");
  assert.doesNotMatch(stripComments(TOKENS_CSS), /backdrop-filter/);
  assert.doesNotMatch(stripComments(BASE_CSS), /backdrop-filter/);
});

test("canvas.css uses only tokens that exist and its own s-canvas properties, and holds no colour of its own", () => {
  const used = new Set([...canvasSrc.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const unknown = [...used].filter((n) => !PINNED.has(n) && !n.startsWith("--s-canvas-"));
  assert.deepEqual(unknown, [], `unknown tokens in canvas.css: ${unknown.join(" ")}`);
  assert.doesNotMatch(canvasSrc, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(canvasSrc, /\b(?:rgba?|hsla?)\(/);
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
  assert.ok(files.includes(join(STYLES, "canvas.css")));
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
    assert.match(m[1].trim(), /^var\(--font-(?:sans|mono|serif)\)$/, `font-family not through a token: ${m[1]}`);
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
  assert.equal(declOf("html", "color"), "var(--text)");
  assert.equal(declOf("html", "background"), "var(--bg)");
  for (const h of ["h1", "h2", "h3"]) assert.match(declOf(h, "font-size"), /^var\(--fs-/);
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
  assert.match(off[0].decls.get("animation-play-state") ?? "", /^paused !important$/);
  assert.match(off[0].decls.get("transition-duration") ?? "", /!important/);
});

test("base.css defines every u- utility the contracts name, and no other", () => {
  const expected = {
    ".u-visually-hidden": { position: /absolute/, overflow: /hidden/ },
    ".u-row": { display: "flex", "align-items": "center", gap: "var(--s-2)" },
    ".u-stack": { display: "flex", "flex-direction": "column", gap: "var(--s-3)" },
    ".u-spread": { display: "flex", "justify-content": "space-between" },
    ".u-muted": { color: "var(--text-2)" },
    ".u-caption": { "font-size": "var(--fs-caption)", color: "var(--text-3)" },
    ".u-mono": { "font-family": "var(--font-mono)" },
    ".u-truncate": { "text-overflow": "ellipsis", "white-space": "nowrap", overflow: "hidden" },
    ".u-wrap": { "overflow-wrap": "anywhere" },
    ".u-grow": { flex: "1 1 auto" },
    ".u-over": { "font-size": "var(--fs-over)", "text-transform": "uppercase", "letter-spacing": ".16em", "font-weight": "var(--fw-medium)" },
    ".u-serif": { "font-family": "var(--font-serif)", "font-size": "var(--fs-dept)", "text-transform": "uppercase", "letter-spacing": ".22em", "font-weight": "var(--fw-regular)" },
  };
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
