// Checks the design tokens (CONTRACTS-V2 section 12) and the base stylesheet: every pinned token resolves to its
// pinned value in light and dark, whichever way dark is chosen, for every accent; no other file defines a token;
// base.css uses tokens only; and the pinned text-on-surface pairs meet their contrast in both themes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES = join(PUBLIC, "styles");
const TOKENS_CSS = readFileSync(join(STYLES, "tokens.css"), "utf8");
const BASE_CSS = readFileSync(join(STYLES, "base.css"), "utf8");

// Section 12, themed colours: [light, dark].
const THEMED = {
  "--bg": ["#ffffff", "#0f0f10"],
  "--bg-sidebar": ["#f7f7f8", "#161618"],
  "--bg-subtle": ["#f4f4f5", "#1f1f23"],
  "--bg-card": ["#ffffff", "#17171a"],
  "--bg-warm": ["#fff7ed", "#2a1d0f"],
  "--border-warm": ["#fed7aa", "#7c4a12"],
  "--border": ["#e8e8ea", "#27272a"],
  "--border-strong": ["#d4d4d8", "#3f3f46"],
  "--text": ["#18181b", "#fafafa"],
  "--text-2": ["#52525b", "#a1a1aa"],
  "--text-3": ["#6b6b74", "#8f8f99"],
  "--primary": ["#18181b", "#fafafa"],
  "--primary-hover": ["#27272a", "#e4e4e7"],
  "--primary-text": ["#ffffff", "#18181b"],
  "--accept": ["#15803d", "#15803d"],
  "--accept-hover": ["#166534", "#166534"],
  "--accept-text": ["#ffffff", "#ffffff"],
  "--ok": ["#16a34a", "#4ade80"],
  "--ok-bg": ["#f0fdf4", "#0f2417"],
  "--ok-text": ["#166534", "#86efac"],
  "--warn": ["#d97706", "#fbbf24"],
  "--warn-bg": ["#fffbeb", "#2a2008"],
  "--warn-text": ["#92400e", "#fcd34d"],
  "--bad": ["#dc2626", "#f87171"],
  "--bad-bg": ["#fef2f2", "#2c1212"],
  "--bad-text": ["#991b1b", "#fca5a5"],
  "--live": ["#16a34a", "#4ade80"],
  "--shadow-pop": ["0 8px 24px rgba(0,0,0,.12)", "0 8px 24px rgba(0,0,0,.5)"],
};

// Accents: { name: [[accent, accent-text] light, [accent, accent-text] dark] }.
const ACCENTS = {
  graphite: [["#18181b", "#ffffff"], ["#fafafa", "#18181b"]],
  blue: [["#2563eb", "#ffffff"], ["#60a5fa", "#18181b"]],
  green: [["#15803d", "#ffffff"], ["#4ade80", "#18181b"]],
  violet: [["#7c3aed", "#ffffff"], ["#a78bfa", "#18181b"]],
  orange: [["#c2410c", "#ffffff"], ["#fb923c", "#18181b"]],
  rose: [["#be123c", "#ffffff"], ["#fb7185", "#18181b"]],
};

// Not themed.
const FIXED = {
  "--font-sans": '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "--font-mono": '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  "--fs-caption": "12px", "--fs-body": "14px", "--fs-title": "16px", "--fs-heading": "20px", "--fs-display": "28px",
  "--fw-regular": "400", "--fw-medium": "500", "--fw-bold": "600",
  "--lh-body": "1.5", "--lh-tight": "1.3",
  "--s-1": "4px", "--s-2": "8px", "--s-3": "12px", "--s-4": "16px", "--s-5": "20px", "--s-6": "24px",
  "--s-8": "32px", "--s-10": "40px", "--s-12": "48px",
  "--r-1": "4px", "--r-2": "6px", "--r-3": "8px", "--r-4": "12px", "--r-pill": "999px",
  "--h-sm": "28px", "--h-md": "36px", "--h-lg": "40px",
  "--t-fast": "100ms", "--t-med": "160ms", "--t-slow": "200ms", "--ease": "cubic-bezier(.2,0,0,1)",
  "--sidebar-w": "248px", "--panel-w": "360px", "--content-max": "960px",
  "--focus": "var(--accent)",
};

const PINNED = new Set([...Object.keys(THEMED), "--accent", "--accent-text", ...Object.keys(FIXED)]);

// --- a small CSS reader: rules with their selectors, the media query around them, and declarations ---

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseRules(css) {
  const src = stripComments(css);
  const rules = [];
  let i = 0;
  let order = 0;
  function block(media) {
    while (i < src.length) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = src.length; return; }
      const prelude = src.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith("@media")) { block(prelude.slice(6).trim()); continue; }
      if (prelude.startsWith("@")) { // keyframes and the like: skip the nested block
        let depth = 1;
        while (i < src.length && depth > 0) { if (src[i] === "{") depth++; else if (src[i] === "}") depth--; i++; }
        continue;
      }
      const end = src.indexOf("}", i);
      const body = src.slice(i, end);
      i = end + 1;
      const decls = new Map();
      for (const part of body.split(";")) {
        const c = part.indexOf(":");
        if (c === -1) continue;
        decls.set(part.slice(0, c).trim(), part.slice(c + 1).trim());
      }
      rules.push({ selectors: prelude.split(",").map((s) => s.trim()), media, decls, order: order++ });
    }
  }
  block(null);
  return rules;
}

// Selectors in tokens.css are :root followed by [data-x="v"] or :not([data-x="v"]) parts, nothing else.
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
  assert.equal(media.replace(/\s+/g, " "), "(prefers-color-scheme: dark)", `unexpected media query in tokens.css: ${media}`);
  return env.systemDark;
}

const TOKEN_RULES = parseRules(TOKENS_CSS);

// Resolve every custom property on <html> for a theme attribute, accent attribute and system preference.
function resolveTokens({ theme, accent, systemDark = false }) {
  const attrs = { "data-theme": theme, "data-accent": accent };
  const winners = new Map();
  for (const rule of TOKEN_RULES) {
    if (!mediaMatches(rule.media, { systemDark })) continue;
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
const LIGHT_WAYS = [{}, { theme: "light" }, { theme: "light", systemDark: true }, { systemDark: false }];
const DARK_WAYS = [{ theme: "dark" }, { theme: "dark", systemDark: true }, { systemDark: true }];
const MODES = [["light", 0, LIGHT_WAYS], ["dark", 1, DARK_WAYS]];

// --- contrast ---

function luminance(hex) {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  assert.ok(m, `not a six-digit hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((o) => parseInt(m[1].slice(o, o + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT_PAIRS = [
  ...["--text", "--text-2", "--text-3"].flatMap((fg) => ["--bg", "--bg-sidebar", "--bg-card", "--bg-subtle"].map((bg) => [fg, bg])),
  ["--text", "--bg-warm"], ["--text-2", "--bg-warm"],
  ["--primary-text", "--primary"],
  ["--accept-text", "--accept"],
  ["--ok-text", "--ok-bg"], ["--warn-text", "--warn-bg"], ["--bad-text", "--bad-bg"],
];

// --- tests ---

test("tokens.css defines exactly the pinned token names", () => {
  const defined = new Set();
  for (const rule of TOKEN_RULES) for (const name of rule.decls.keys()) if (name.startsWith("--")) defined.add(name);
  const missing = [...PINNED].filter((n) => !defined.has(n));
  const extra = [...defined].filter((n) => !PINNED.has(n));
  assert.deepEqual(missing, [], `missing tokens: ${missing.join(" ")}`);
  assert.deepEqual(extra, [], `tokens not pinned in section 12: ${extra.join(" ")}`);
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
        assert.equal(Object.keys(t).length, PINNED.size, `token count in ${where}`);
      }
    }
    assert.ok(checked > 0);
  });

  test(`contrast of the pinned pairs in ${mode}`, () => {
    for (const way of ways) {
      const t = resolveTokens(way);
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrast(computed(t, fg), computed(t, bg));
        assert.ok(ratio >= 4.5, `${fg} on ${bg} in ${mode}: ${ratio.toFixed(2)} < 4.5`);
      }
      for (const accent of Object.keys(ACCENTS)) {
        const ta = resolveTokens({ ...way, accent });
        const onAccent = contrast(computed(ta, "--accent-text"), computed(ta, "--accent"));
        assert.ok(onAccent >= 4.5, `--accent-text on --accent (${accent}, ${mode}): ${onAccent.toFixed(2)} < 4.5`);
        const onBg = contrast(computed(ta, "--accent"), computed(ta, "--bg"));
        assert.ok(onBg >= 3, `--accent on --bg (${accent}, ${mode}): ${onBg.toFixed(2)} < 3`);
      }
    }
  });
}

test("the accent defaults to graphite with no data-accent", () => {
  assert.equal(resolveTokens({})["--accent"], ACCENTS.graphite[0][0]);
  assert.equal(resolveTokens({ theme: "dark" })["--accent"], ACCENTS.graphite[1][0]);
  assert.equal(resolveTokens({ systemDark: true })["--accent"], ACCENTS.graphite[1][0]);
});

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
    assert.match(m[1].trim(), /^var\(--font-(?:sans|mono)\)$/, `font-family not through a token: ${m[1]}`);
  }
  for (const m of src.matchAll(/(?:^|[;{\s])font\s*:\s*([^;}]+)/g)) {
    assert.equal(m[1].trim(), "inherit", `font shorthand other than inherit: ${m[1]}`);
  }
  for (const m of src.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    assert.match(m[1].trim(), /^var\(--fs-[a-z]+\)$/, `font-size not through a token: ${m[1]}`);
  }
  assert.doesNotMatch(src, /url\(|@import|@font-face/, "base.css loads nothing");
  assert.doesNotMatch(TOKENS_CSS, /url\(|@import|@font-face|https?:/, "tokens.css loads nothing");
});

test("base.css uses only tokens that exist", () => {
  const used = new Set([...stripComments(BASE_CSS).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const unknown = [...used].filter((n) => !PINNED.has(n));
  assert.deepEqual(unknown, [], `unknown tokens in base.css: ${unknown.join(" ")}`);
});

function rulesFor(selector) {
  return parseRules(BASE_CSS).filter((r) => r.selectors.includes(selector));
}

function declOf(selector, prop) {
  for (const r of rulesFor(selector).reverse()) if (r.decls.has(prop)) return r.decls.get(prop);
  return undefined;
}

test("base.css holds the document defaults, focus ring, selection and reduced motion", () => {
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
  const reduced = parseRules(BASE_CSS).filter((r) => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media));
  assert.ok(reduced.length > 0, "no reduced-motion block");
  const d = reduced[0].decls;
  assert.match(d.get("animation-duration") ?? "", /!important/);
  assert.match(d.get("transition-duration") ?? "", /!important/);
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
