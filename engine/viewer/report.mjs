// The page report of K15. REPORT_SCRIPT is evaluated in an ISOLATED WORLD of the page
// (Page.createIsolatedWorld, as prototype p2 found): the page's own scripts cannot replace
// getComputedStyle, querySelectorAll or anything else it uses; the page can only change its
// own DOM, which is what is reported on. Everything that comes back is the page's text, so
// mergePage() turns it into plain capped values before it leaves the viewer.
export const CAPS = Object.freeze({
  errors: 20, errorChars: 300, wider: 20, missing: 20, blocked: 20, contrast: 20, contrastChars: 40,
  fonts: 20, colours: 40, elements: 5000,
});

export const REPORT_SCRIPT = `(() => {
  const W = innerWidth;
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || "");
    if (!m) return null;
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (o) => "#" + [o.r, o.g, o.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (o) => 0.2126 * lin(o.r) + 0.7152 * lin(o.g) + 0.0722 * lin(o.b);
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (e) => {
    const layers = [];
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const all = [...document.querySelectorAll("body, body *")].slice(0, ${CAPS.elements});
  const wider = [], colours = new Set(), fonts = new Map(), contrast = [];
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = e.getBoundingClientRect();
    if (wider.length < 40 && r.width > 0 && (r.right > W + 1 || r.left < -1) && cs.position !== "fixed")
      wider.push({ tag: e.tagName.toLowerCase(), cls: String(e.getAttribute("class") || ""), width: Math.round(r.width) });
    for (const [p, wp] of [["color"], ["backgroundColor"], ["borderTopColor", "borderTopWidth"]]) {
      const c = parse(cs[p]);
      if (c && c.a > 0 && (!wp || parseFloat(cs[wp]) > 0) && colours.size < 200) colours.add(hex(c));
    }
    const text = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!text || r.width === 0) continue;
    const family = cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    const px = parseFloat(cs.fontSize);
    if (fonts.size < 50 || fonts.has(family)) fonts.set(family, Math.min(fonts.get(family) ?? Infinity, px));
    const fgc = parse(cs.color);
    if (!fgc || contrast.length >= 40) continue;
    const bg = bgOf(e), fg = over(fgc, bg);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) contrast.push({ text: text.slice(0, 40), fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100 });
  }
  const missing = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).slice(0, 40).map((i) => String(i.getAttribute("src") || "").slice(0, 120));
  let last = 0, headingSkips = 0;
  for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) { const n = Number(h.tagName[1]); if (last && n > last + 1) headingSkips++; last = n; }
  const labelled = (i) => (i.labels && i.labels.length) || i.getAttribute("aria-label") || i.getAttribute("aria-labelledby") || i.type === "hidden" || i.type === "submit" || i.type === "button";
  let hasDark = false;
  const walk = (rules) => { for (const r of rules) { if (r.media && /prefers-color-scheme/.test(r.media.mediaText)) hasDark = true; if (r.conditionText && /prefers-color-scheme/.test(r.conditionText)) hasDark = true; if (r.cssRules) walk(r.cssRules); } };
  for (const s of document.styleSheets) { try { if (s.media && /prefers-color-scheme/.test(s.media.mediaText)) hasDark = true; walk(s.cssRules); } catch {} }
  return {
    href: location.href.slice(0, 200),
    innerWidth: W,
    height: Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)),
    hasDark,
    wider: wider.slice(0, ${CAPS.wider}),
    missing: missing.slice(0, ${CAPS.missing}),
    a11y: {
      noAlt: document.querySelectorAll("img:not([alt])").length,
      noLabel: [...document.querySelectorAll("input,select,textarea")].filter((i) => !labelled(i)).length,
      noLang: !document.documentElement.lang,
      noTitle: !document.title.trim(),
      headingSkips,
      smallTargets: [...document.querySelectorAll("a,button,[role=button]")].slice(0, 2000).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).length,
    },
    contrast: contrast.slice(0, ${CAPS.contrast}),
    fonts: [...fonts].map(([family, minPx]) => ({ family, minPx })),
    colours: [...colours].slice(0, ${CAPS.colours}),
  };
})()`;

const HEX_RE = /^#[0-9A-F]{6}$/;
export const plainText = (v, max) => String(v === undefined || v === null ? "" : v).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " ").slice(0, max);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0);
const px = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

// One page's report from its passes (each { width, scheme, data } where data is what
// REPORT_SCRIPT gave, or null), plus what the viewer saw itself. -> K15's page object,
// with `dark`, `drawn` (the faces Chrome really drew with), `shots` and `cut` added.
export function mergePage({ page, passes, errors, blocked, missing, drawn, shots, cut }) {
  const out = {
    page,
    errors: [], wider: [], missing: [], blocked: [],
    a11y: { noAlt: 0, noLabel: 0, noLang: false, noTitle: false, headingSkips: 0, smallTargets: 0 },
    contrast: [], fonts: [], colours: [], drawn: [], dark: false, shots: [...(shots || [])], cut: cut || null,
  };
  const addUnique = (list, value, cap, key = (x) => JSON.stringify(x)) => {
    if (list.length >= cap) return;
    if (!list.some((x) => key(x) === key(value))) list.push(value);
  };
  for (const e of errors || []) addUnique(out.errors, plainText(e, CAPS.errorChars), CAPS.errors);
  for (const b of blocked || []) addUnique(out.blocked, plainText(b, 140), CAPS.blocked);
  for (const m of missing || []) addUnique(out.missing, plainText(m, 120), CAPS.missing);
  const fonts = new Map();
  let firstA11y = true;
  for (const { width, data } of passes || []) {
    if (!data || typeof data !== "object") continue;
    if (data.hasDark === true) out.dark = true;
    for (const w of Array.isArray(data.wider) ? data.wider : []) {
      if (!w || typeof w !== "object") continue;
      addUnique(out.wider, { tag: plainText(w.tag, 20), cls: plainText(w.cls, 40), width: count(w.width), at: width }, CAPS.wider);
    }
    for (const m of Array.isArray(data.missing) ? data.missing : []) addUnique(out.missing, plainText(m, 120), CAPS.missing);
    const a = data.a11y && typeof data.a11y === "object" ? data.a11y : null;
    if (a) {
      // the desktop pass's numbers, with the smallest targets of any width
      if (firstA11y) {
        out.a11y = { noAlt: count(a.noAlt), noLabel: count(a.noLabel), noLang: a.noLang === true, noTitle: a.noTitle === true, headingSkips: count(a.headingSkips), smallTargets: count(a.smallTargets) };
        firstA11y = false;
      } else {
        out.a11y.smallTargets = Math.max(out.a11y.smallTargets, count(a.smallTargets));
      }
    }
    for (const c of Array.isArray(data.contrast) ? data.contrast : []) {
      if (!c || typeof c !== "object" || !HEX_RE.test(c.fg) || !HEX_RE.test(c.bg)) continue;
      addUnique(out.contrast, { text: plainText(c.text, CAPS.contrastChars), fg: c.fg, bg: c.bg, ratio: px(c.ratio) }, CAPS.contrast, (x) => `${x.text}|${x.fg}|${x.bg}`);
    }
    for (const f of Array.isArray(data.fonts) ? data.fonts : []) {
      if (!f || typeof f !== "object") continue;
      const family = plainText(f.family, 80);
      const size = px(f.minPx);
      if (size === null) continue;
      if (!fonts.has(family) && fonts.size >= CAPS.fonts) continue;
      fonts.set(family, Math.min(fonts.has(family) ? fonts.get(family) : Infinity, size));
    }
    for (const c of Array.isArray(data.colours) ? data.colours : []) if (HEX_RE.test(c)) addUnique(out.colours, c, CAPS.colours);
  }
  out.fonts = [...fonts].map(([family, minPx]) => ({ family, minPx }));
  for (const d of drawn || []) addUnique(out.drawn, plainText(d, 80), CAPS.fonts);
  return out;
}

// The file name part of a page: its archive name without ".html", "/" as "_".
export function pageSlug(name) {
  return String(name).replace(/\.html$/i, "").replace(/\//g, "_");
}
