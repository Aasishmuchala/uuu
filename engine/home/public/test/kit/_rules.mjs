// The kit tests' CSS readers and the stylesheet rules every part file calls for its own sheet. Moved here word for
// word from kit-a (11.2 and 27.3), kit-b (11.2 and 27.3 for the composites), kit-c (27.3 for the V3 parts) and
// kit-m55 (T01 of PLAN-COOK); each loop over modules became one call per part file, with the same test name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC, STYLES } from "./_dom.mjs";

// kit-m55: a sheet under styles/ without its comments, and a source file as it is.
export const css = (p) => readFileSync(join(PUBLIC, "styles", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
export const src = (p) => readFileSync(join(PUBLIC, p), "utf8");

export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// kit-a: returns the selectors of every style rule, looking inside @media and @supports, skipping @keyframes bodies.
export function selectorsOf(css) {
  const out = [];
  const keyframes = [];
  let i = 0;
  function block(endAt) {
    let prelude = "";
    while (i < css.length) {
      const ch = css[i];
      if (ch === "{") {
        i++;
        const p = prelude.trim();
        prelude = "";
        if (p.startsWith("@keyframes")) {
          keyframes.push(p.slice(10).trim());
          skip();
        } else if (p.startsWith("@media") || p.startsWith("@supports")) {
          block(true);
        } else {
          out.push(...p.split(",").map((s) => s.trim()));
          skip();
        }
      } else if (ch === "}") {
        i++;
        if (endAt) return;
      } else {
        prelude += ch;
        i++;
      }
    }
  }
  function skip() {
    let depth = 1;
    while (i < css.length && depth) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
  }
  block(false);
  return { selectors: out, keyframes };
}

// kit-c: the same, also looking inside @container.
export function rulesOf(css) {
  const selectors = [];
  const keyframes = [];
  let i = 0;
  const skip = () => { let d = 1; while (i < css.length && d) { if (css[i] === "{") d++; else if (css[i] === "}") d--; i++; } };
  (function block(nested) {
    let pre = "";
    while (i < css.length) {
      const ch = css[i++];
      if (ch === "{") {
        const p = pre.trim();
        pre = "";
        if (p.startsWith("@keyframes")) { keyframes.push(p.slice(10).trim()); skip(); }
        else if (p.startsWith("@media") || p.startsWith("@supports") || p.startsWith("@container")) block(true);
        else { selectors.push(...p.split(",").map((s) => s.trim())); skip(); }
      } else if (ch === "}") { if (nested) return; }
      else pre += ch;
    }
  })(false);
  return { selectors, keyframes };
}

// ---- A primitive's sheet (kit-a): 11.2, and the per-module part of 27.3. ----

export function primitiveSheetTests(m) {
  test(`stylesheet ${m}.css exists and follows the class and token rules`, () => {
    const file = join(STYLES, `${m}.css`);
    assert.ok(existsSync(file), `styles/kit/${m}.css exists`);
    const css = stripComments(readFileSync(file, "utf8"));
    assert.ok(css.trim().length > 0, "it is not empty");
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "no hex colour");
    assert.doesNotMatch(css, /\brgba?\(/i, "no rgb(");
    assert.doesNotMatch(css, /font-family/i, "no font-family");
    assert.doesNotMatch(css, /font-size\s*:\s*[\d.]+px/i, "no font size in px");
    assert.doesNotMatch(css, /@import|url\(/i, "no import and no url()");
    if (m !== "overlays") {
      for (const z of css.matchAll(/z-index\s*:\s*(\d+)/g)) assert.ok(Number(z[1]) <= 50, `z-index ${z[1]} is at most 50`);
    }
    const { selectors, keyframes } = selectorsOf(css);
    assert.ok(selectors.length > 0, "it has rules");
    // M55: a rule for motion switched off may lead with [data-motion="off"], as kit-c allows.
    for (const s of selectors) assert.ok(s.replace(/^\[data-motion="off"\] /, "").startsWith(".k-"), `selector "${s}" starts with .k-`);
    for (const k of keyframes) assert.ok(k.startsWith("k-"), `keyframes "${k}" are named k-...`);
  });

  // 27.3: tokens only, no backdrop-filter, motion only on transform and opacity (colours may fade
  // for at most --t-med), no endless animation but the live dot, no will-change.
  test("the primitives' stylesheets follow the rules of V3 27.3", () => {
    const ALLOWED_TRANSITION = /^(transform|opacity|color|background-color|border-color)$/;
    const css = stripComments(readFileSync(join(STYLES, `${m}.css`), "utf8"));
    assert.doesNotMatch(css, /backdrop-filter/, `${m}.css has no backdrop-filter`);
    assert.doesNotMatch(css, /(^|[^-])filter\s*:\s*blur/, `${m}.css has no filter: blur`);
    assert.doesNotMatch(css, /will-change/, `${m}.css has no will-change`);
    assert.doesNotMatch(css, /mix-blend-mode/, `${m}.css has no blend mode`);
    for (const t of css.matchAll(/transition\s*:\s*([^;]+);/g)) {
      if (t[1].trim() === "none") continue;
      for (const part of t[1].split(",")) {
        const [prop, time] = part.trim().split(/\s+/);
        assert.match(prop, ALLOWED_TRANSITION, `${m}.css transitions ${prop}`);
        if (prop !== "transform" && prop !== "opacity") assert.match(time, /^var\(--t-(fast|med)\)$/, `${m}.css: ${prop} fades in at most --t-med`);
      }
    }
    if (m !== "status") assert.doesNotMatch(css, /\binfinite\b/, `${m}.css has no animation that never ends`);
    for (const k of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)) {
      for (const d of k[1].matchAll(/([a-z-]+)\s*:/g)) assert.match(d[1], /^(transform|opacity)$/, `${m}.css animates ${d[1]}`);
    }
  });
}

// kit-a 27.3, for button, tabs, fields, overlays and page: 44 px controls below 860 px.
export function narrowControlsTest(m) {
  test(`${m}: ${m}.css makes controls at least 44 px high below 860 px`, () => {
    const css = stripComments(readFileSync(join(STYLES, `${m}.css`), "utf8"));
    const narrow = /@media \(max-width: 859px\) \{([\s\S]*)\}\s*$/.exec(css);
    assert.ok(narrow, `${m}.css has a narrow block`);
    assert.match(narrow[1], /min-height: calc\(var\(--h-lg\) \+ var\(--s-[12]\)\)/, `${m}.css makes controls at least 44 px high below 860 px`);
  });
}

// ---- A composite's sheet (kit-b): 27.3 and 11.2. ----

export function compositeSheetTests(name) {
  test("no composite stylesheet blurs what is behind it (27.3)", () => {
    const css = readFileSync(join(PUBLIC, "styles", "kit", `${name}.css`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/backdrop-filter/.test(css), `${name}.css: no backdrop-filter`);
    assert.ok(!/filter\s*:\s*blur/.test(css), `${name}.css: no filter: blur`);
    assert.ok(!/will-change/.test(css), `${name}.css: no will-change`);
    // Nothing moves for ever here (the live dot is status.css's).
    assert.ok(!/animation[^;]*infinite/.test(css), `${name}.css: no endless animation`);
    for (const m of css.matchAll(/transition\s*:([^;]+);/g)) {
      for (const part of m[1].split(",")) {
        const prop = part.trim().split(/\s+/)[0];
        assert.ok(["transform", "opacity", "background-color", "border-color", "color", "box-shadow"].includes(prop), `${name}.css: transition of ${prop}`);
        if (!["transform", "opacity"].includes(prop)) assert.ok(/var\(--t-(fast|med)\)/.test(part), `${name}.css: a colour moves in --t-med at most`);
      }
    }
  });

  test("each composite stylesheet exists, uses only k- selectors and tokens (11.2)", () => {
    const file = join(PUBLIC, "styles", "kit", `${name}.css`);
    assert.ok(existsSync(file), `${name}.css exists`);
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(css.trim().length > 0, `${name}.css is not empty`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), `${name}.css: no hex colour`);
    assert.ok(!/\brgba?\(/.test(css), `${name}.css: no rgb(`);
    assert.ok(!/font-family\s*:/.test(css), `${name}.css: no font-family`);
    assert.ok(!/font-size\s*:\s*[\d.]+px/.test(css), `${name}.css: no font-size in px`);
    for (const m of css.matchAll(/z-index\s*:\s*(\d+)/g)) assert.ok(Number(m[1]) <= 50, `${name}.css: z-index ${m[1]}`);
    // Every rule's selectors (outside @-rules' own lines and keyframe steps) are k- classes.
    const blocks = css
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
      .replace(/@(?:media|supports|container)[^{]+\{/g, "");
    for (const m of blocks.matchAll(/([^{}@;]+)\{/g)) {
      for (const sel of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
        assert.ok(/^(?:[a-z]+)?\.k-/.test(sel), `${name}.css: selector "${sel}" starts with a k- class`);
      }
    }
  });
}

// ---- A V3 part's sheet (kit-c): 27.3. ----

// The root class each V3 part's sheet must style.
export const ROOTS = { segmented: "k-seg", job: "k-job", answer: "k-answer", ring: "k-ring", forms: "k-form", upload: "k-upload" };

export function newSheetTest(m) {
  test(`stylesheet ${m}.css follows 27.3`, () => {
    const file = join(STYLES, `${m}.css`);
    assert.ok(existsSync(file), `styles/kit/${m}.css exists`);
    const css = stripComments(readFileSync(file, "utf8"));
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "no hex colour");
    assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/i, "no rgb( or hsl(");
    assert.doesNotMatch(css, /font-family/i, "no font-family");
    assert.doesNotMatch(css, /font-size\s*:\s*[\d.]+px/i, "no font size in px");
    assert.doesNotMatch(css, /@import|url\(/i, "no import and no url()");
    assert.doesNotMatch(css, /backdrop-filter/, "no backdrop-filter");
    assert.doesNotMatch(css, /filter\s*:\s*blur|will-change|mix-blend-mode/, "no blur, will-change or blend");
    for (const z of css.matchAll(/z-index\s*:\s*(\d+)/g)) assert.ok(Number(z[1]) <= 50, `z-index ${z[1]}`);
    for (const t of css.matchAll(/transition\s*:\s*([^;]+);/g)) {
      for (const part of t[1].split(",")) {
        const [prop, time] = part.trim().split(/\s+/);
        if (prop === "none") continue;
        assert.ok(["transform", "opacity", "color", "background-color", "border-color"].includes(prop), `transition of ${prop}`);
        if (!["transform", "opacity"].includes(prop)) assert.match(time, /^var\(--t-(fast|med)\)$/, `${prop} changes within --t-med`);
      }
    }
    for (const kf of css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\})\s*\}/g)) {
      for (const p of kf[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(["transform", "opacity"].includes(p[1]), `keyframes move only ${p[1]}`);
    }
    // An endless animation only for the live dot (the answer's "reading" mark), and it stops when motion is off.
    const endless = [...css.matchAll(/animation\s*:[^;]*infinite/g)];
    if (endless.length) {
      assert.equal(m, "answer", "only the live dot runs for ever");
      assert.match(css, /\[data-motion="off"\] \.k-answer__live\s*\{\s*animation: none;/);
      assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.k-answer__live\s*\{\s*animation: none;/);
    }
    const { selectors, keyframes } = rulesOf(css);
    assert.ok(selectors.length > 0, "it has rules");
    for (const s of selectors) assert.match(s, /^(a|\[data-motion="off"\] )?\.k-/, `selector "${s}" is the kit's`);
    for (const k of keyframes) assert.ok(k.startsWith("k-"), `keyframes "${k}" are named k-...`);
    assert.ok(selectors.some((s) => s.startsWith(`.${ROOTS[m]}`)), `the root class .${ROOTS[m]} is styled`);
  });
}
