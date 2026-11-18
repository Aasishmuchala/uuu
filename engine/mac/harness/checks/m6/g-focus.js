// (g) Focus: what a keyboard can reach on this page in DOM order (links, buttons, fields, tabindex), which of them
// WebKit's Tab passes over by default (links: WKPreferences.tabFocusesLinks, or the Mac's Keyboard navigation
// setting / Option-Tab), whether the style sheets have :focus-visible rules, and the ring each kind shows when it is
// focused after a key press (an untrusted Tab keydown first, so the focus counts as from a keyboard).
if (INJ.wait) await waitFor(INJ.wait, 15000);
await quiet(8000);
const all = [...document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=true]")]
  .filter((e) => visible(e) && !e.disabled && e.tabIndex >= 0 && !e.closest("[inert]"));
const kind = (e) => e.matches("a[href]:not([tabindex])") ? "link" : e.matches("button, summary") ? "button" : e.matches("input, select, textarea") ? "field" : "tabindex";
const counts = all.reduce((m, e) => { m[kind(e)] = (m[kind(e)] || 0) + 1; return m; }, {});
const positive = all.filter((e) => e.tabIndex > 0).map(label);
let fvRules = 0;
for (const sh of document.styleSheets) { try { const walk = (rs) => { for (const r of rs) { if (r.selectorText && r.selectorText.includes(":focus-visible")) fvRules++; if (r.cssRules) walk(r.cssRules); } }; walk(sh.cssRules); } catch { /* */ } }
const ring = (e) => { const cs = getComputedStyle(e); return { el: label(e), text: text(e, 40), focusVisible: e.matches(":focus-visible"), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow === "none" ? null : cs.boxShadow.slice(0, 80) }; };
const rings = [];
for (const k of ["link", "button", "field", "tabindex"]) {
  const e = all.find((x) => kind(x) === k && !x.matches("[role=switch]"));
  if (!e) continue;
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true }));
  e.focus(); await frame();
  rings.push({ kind: k, ...ring(e) });
  e.blur();
}
const sw = document.querySelector("[role=switch]");
if (sw) { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true })); sw.focus(); await frame(); rings.push({ kind: "switch", ...ring(sw) }); sw.blur(); }
return { path: location.hash, reachable: all.length, counts, positiveTabindex: positive, order: all.slice(0, 25).map((e) => `${kind(e)} ${label(e)} "${text(e, 30)}"`), focusVisibleRules: fvRules, rings };
