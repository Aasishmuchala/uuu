// (c) CSS: every property, at-rule, media feature, pseudo-class or -element, function and unit the style sheets use
// (INJ.inv, from css-inventory.mjs), asked of this engine with CSS.supports or its object model. Returns only what
// this engine does not take, with the files, and the count of what it does.
const inv = INJ.inv;
const S = (a, b) => { try { return b === undefined ? CSS.supports(a) : CSS.supports(a, b); } catch { return false; } };
const no = [];
let yes = 0;
for (const [p, m] of Object.entries(inv.props)) {
  const decl = m.sample || `${p}: initial`;
  const i = decl.indexOf(":");
  const asWritten = S(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  const known = asWritten || S(p, "initial") || S(p, "inherit");
  if (known && asWritten) { yes++; continue; }
  no.push({ kind: "property", name: p, known, asWritten, sample: decl, files: m.files });
}
const AT = { media: "CSSMediaRule", keyframes: "CSSKeyframesRule", container: "CSSContainerRule", supports: "CSSSupportsRule",
  layer: "CSSLayerBlockRule", property: "CSSPropertyRule", "starting-style": "CSSStartingStyleRule", "font-face": "CSSFontFaceRule",
  scope: "CSSScopeRule", "view-transition": "CSSViewTransitionRule", import: "CSSImportRule", "font-feature-values": "CSSFontFeatureValuesRule",
  "position-try": "CSSPositionTryRule", page: "CSSPageRule", namespace: "CSSNamespaceRule", "counter-style": "CSSCounterStyleRule" };
for (const [a, m] of Object.entries(inv.atRules)) {
  const ok = AT[a] ? typeof window[AT[a]] === "function" : false;
  if (ok) yes++; else no.push({ kind: "at-rule", name: `@${a}`, sample: m.sample, files: m.files });
}
for (const [k, m] of Object.entries(inv.media)) {
  const [where, f] = k.split(":");
  let ok;
  if (where === "media") ok = matchMedia(m.sample).media !== "not all";
  else ok = typeof window.CSSContainerRule === "function";
  if (ok) yes++; else no.push({ kind: `${where} feature`, name: f, sample: m.sample, files: m.files });
}
for (const [p, m] of Object.entries(inv.pseudos)) {
  const name = p.replace(/\(\)$/, "");
  const arg = { ":not": "(a)", ":has": "(a)", ":is": "(a)", ":nth-child": "(2n)", ":where": "(a)" }[name] || (p.endsWith("()") ? "(a)" : "");
  const ok = S(`selector(${name}${arg})`) || S(`selector(a${name}${arg})`);
  if (ok) yes++; else no.push({ kind: "selector", name: p, sample: m.sample, files: m.files });
}
const FN = { "var()": ["color", "var(--x)"], "env()": ["padding-top", "env(safe-area-inset-top)"], "steps()": ["animation-timing-function", "steps(4)"],
  "url()": ["background-image", "url(a.png)"], "color-mix()": ["color", "color-mix(in srgb, red 40%, blue)"], "max()": ["width", "max(1px, 2px)"],
  "min()": ["width", "min(1px, 2px)"], "minmax()": ["grid-template-columns", "minmax(0, 1fr)"], "conic-gradient()": ["background-image", "conic-gradient(red, blue)"],
  "repeat()": ["grid-template-columns", "repeat(2, 1fr)"], "radial-gradient()": ["background-image", "radial-gradient(red, blue)"],
  "linear-gradient()": ["background-image", "linear-gradient(red, blue)"], "attr()": ["content", "attr(title)"], "counter()": ["content", "counter(a)"],
  "clamp()": ["width", "clamp(1px, 2px, 3px)"], "light-dark()": ["color", "light-dark(red, blue)"], "oklch()": ["color", "oklch(0.5 0.1 30)"] };
for (const [f, m] of Object.entries(inv.functions)) {
  const t = FN[f];
  const ok = t ? S(t[0], t[1]) : null;
  if (ok) yes++; else no.push({ kind: "function", name: f, tested: t ? `${t[0]}: ${t[1]}` : "not tested", sample: m.sample, files: m.files });
}
for (const [u, m] of Object.entries(inv.units)) {
  const ok = S("width", `1${u}`);
  if (ok) yes++; else no.push({ kind: "unit", name: u, sample: m.sample, files: m.files });
}
// The values the plan names, asked the same way whether or not the sheets use them today.
const named = {
  "color-mix": S("color", "color-mix(in srgb, red 40%, blue)"), "@container": typeof window.CSSContainerRule === "function",
  ":has": S("selector(a:has(b))"), "text-wrap: balance": S("text-wrap", "balance"), "text-wrap: pretty": S("text-wrap", "pretty"),
  "scrollbar-gutter": S("scrollbar-gutter", "stable"), "@starting-style": typeof window.CSSStartingStyleRule === "function",
  "view transitions": typeof document.startViewTransition === "function", "field-sizing": S("field-sizing", "content"),
  "anchor positioning": S("anchor-name", "--a") && S("position-anchor", "--a"), "scroll-driven animations": S("animation-timeline", "scroll()"),
  "::-webkit-scrollbar": S("selector(::-webkit-scrollbar)"), "scrollbar-width": S("scrollbar-width", "thin"), "overscroll-behavior": S("overscroll-behavior", "none"),
  "line-clamp": S("line-clamp", "2"), "-webkit-line-clamp": S("-webkit-line-clamp", "2"), "mask-image": S("mask-image", "linear-gradient(red, blue)"),
  "mask-composite": S("mask-composite", "intersect"), "text-size-adjust": S("text-size-adjust", "100%"), "dvh": S("height", "1dvh"),
};
return { engine: navigator.userAgent, yes, no, named };
