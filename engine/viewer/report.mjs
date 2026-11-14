// The page report of K15. REPORT_SCRIPT is evaluated in an ISOLATED WORLD of the page
// (Page.createIsolatedWorld, as prototype p2 found): the page's own scripts cannot replace
// getComputedStyle, querySelectorAll or anything else it uses; the page can only change its
// own DOM, which is what is reported on. Everything that comes back is the page's text, so
// mergePage() turns it into plain capped values before it leaves the viewer.
// What it reports is what Chrome drew, for the home server to judge against the kit (PLAN-V5
// T58b): every colour of every element in any form Chrome writes a computed colour (rgb(),
// color(srgb …), color(display-p3 …) and the other spaces, lab(), lch(), oklab(), oklch(),
// each turned into sRGB), the colours inside gradients and shadows, how many elements are drawn
// through a filter or blend mode (whose colours cannot be compared), the faces and the smallest
// text, and whether the page held more elements or colours than it lists.
// T58e: the size of text as it is DRAWN (its font size times every zoom, transform, scale and
// SVG viewBox above it), gradients that go round the hue wheel (`turned`), parts a paint
// worklet draws (`painted`), text whose drawn size cannot be worked out (`unsized`), the
// colours of border images, list markers and first lines and letters, and the
// elements of open shadow trees. SETTLE_SCRIPT puts every animation and transition of the page
// at each of its keyframes in turn, so the report can be taken again as the page looks later.
export const CAPS = Object.freeze({
  errors: 20, errorChars: 300, wider: 20, missing: 20, blocked: 20, contrast: 20, contrastChars: 40,
  fonts: 20, colours: 120, elements: 5000,
});

// A computed colour -> { r, g, b, a } in sRGB 0 to 255 (alpha 0 to 1), or null. Out of sRGB's
// gamut each channel is clipped, as a screen shows it. Self-contained: REPORT_SCRIPT carries
// its source into the page.
export function parseColour(c) {
  const m = /^\s*(rgba?|color|lab|lch|oklab|oklch)\(\s*([^()]*)\)\s*$/i.exec(String(c || ""));
  if (!m) return null;
  const fn = m[1].toLowerCase();
  const halves = m[2].split("/");
  if (halves.length > 2) return null;
  const parts = halves[0].split(/[\s,]+/).filter(Boolean);
  const num = (s, full) => {
    if (s === undefined) return NaN;
    const t = String(s).toLowerCase();
    if (t === "none") return 0;
    return t.endsWith("%") ? (parseFloat(t) / 100) * full : parseFloat(t);
  };
  let alpha = halves.length === 2 ? num(halves[1].trim(), 1) : 1;
  const space = fn === "color" ? String(parts.shift() || "").toLowerCase() : fn;
  if ((fn === "rgb" || fn === "rgba") && parts.length === 4 && halves.length === 1) alpha = num(parts.pop(), 1);
  if (parts.length !== 3) return null;
  const mul = (M, v) => M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
  const XYZ_TO_SRGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
  const D50_TO_D65 = [[0.955473421488075, -0.02309845494876471, 0.06325924320057072], [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323], [0.012314014864481998, -0.020507649298898964, 1.330365926242124]];
  const signed = (v, f) => (v < 0 ? -f(-v) : f(v));
  const srgbDecode = (v) => signed(v, (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  let lin; // linear sRGB
  if (space === "rgb" || space === "rgba") {
    lin = parts.map((p) => srgbDecode(num(p, 255) / 255));
  } else if (space === "srgb") {
    lin = parts.map((p) => srgbDecode(num(p, 1)));
  } else if (space === "srgb-linear") {
    lin = parts.map((p) => num(p, 1));
  } else if (space === "display-p3") {
    lin = mul(XYZ_TO_SRGB, mul([[0.4865709486482162, 0.26566769316909306, 0.1982172852343625], [0.2289745640697488, 0.6917385218365064, 0.079286914093745], [0, 0.04511338185890264, 1.043944368900976]], parts.map((p) => srgbDecode(num(p, 1)))));
  } else if (space === "a98-rgb") {
    lin = mul(XYZ_TO_SRGB, mul([[0.5766690429101305, 0.1855582379065463, 0.1882286462349947], [0.29734497525053605, 0.6273635662554661, 0.07529145849399788], [0.02703136138641234, 0.07068885253582723, 0.9913375368376388]], parts.map((p) => signed(num(p, 1), (x) => Math.pow(x, 563 / 256)))));
  } else if (space === "prophoto-rgb") {
    lin = mul(XYZ_TO_SRGB, mul(D50_TO_D65, mul([[0.7977604896723027, 0.13518583717574031, 0.0313493495815248], [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902], [0, 0, 0.8251046025104601]], parts.map((p) => signed(num(p, 1), (x) => (x <= 16 / 512 ? x / 16 : Math.pow(x, 1.8)))))));
  } else if (space === "rec2020") {
    const A = 1.09929682680944, B = 0.018053968510807;
    lin = mul(XYZ_TO_SRGB, mul([[0.6369580483012914, 0.14461690358620832, 0.1688809751641721], [0.2627002120112671, 0.6779980715188708, 0.05930171646986196], [0, 0.028072693049087428, 1.060985057710791]], parts.map((p) => signed(num(p, 1), (x) => (x < B * 4.5 ? x / 4.5 : Math.pow((x + A - 1) / A, 1 / 0.45))))));
  } else if (space === "xyz" || space === "xyz-d65") {
    lin = mul(XYZ_TO_SRGB, parts.map((p) => num(p, 1)));
  } else if (space === "xyz-d50") {
    lin = mul(XYZ_TO_SRGB, mul(D50_TO_D65, parts.map((p) => num(p, 1))));
  } else if (space === "lab" || space === "lch") {
    const L = num(parts[0], 100);
    let a = num(parts[1], 125), b = num(parts[2], 125);
    if (space === "lch") {
      const C = num(parts[1], 150), h = (num(parts[2], 1) * Math.PI) / 180;
      a = C * Math.cos(h);
      b = C * Math.sin(h);
    }
    const k = 24389 / 27, e = 216 / 24389;
    const f1 = (L + 16) / 116, f0 = a / 500 + f1, f2 = f1 - b / 200;
    const xyz = [Math.pow(f0, 3) > e ? Math.pow(f0, 3) : (116 * f0 - 16) / k, L > k * e ? Math.pow(f1, 3) : L / k, Math.pow(f2, 3) > e ? Math.pow(f2, 3) : (116 * f2 - 16) / k];
    lin = mul(XYZ_TO_SRGB, mul(D50_TO_D65, [xyz[0] * 0.9642956764295677, xyz[1], xyz[2] * 0.8251046025104602]));
  } else if (space === "oklab" || space === "oklch") {
    const L = num(parts[0], 1);
    let a = num(parts[1], 0.4), b = num(parts[2], 0.4);
    if (space === "oklch") {
      const C = num(parts[1], 0.4), h = (num(parts[2], 1) * Math.PI) / 180;
      a = C * Math.cos(h);
      b = C * Math.sin(h);
    }
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
    const mm = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
    lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  } else {
    return null;
  }
  const enc = (v) => { const x = Math.max(0, Math.min(1, v)); return 255 * (x > 0.0031308 ? 1.055 * Math.pow(x, 1 / 2.4) - 0.055 : 12.92 * x); };
  const out = lin.map(enc);
  if (!out.every(Number.isFinite) || !Number.isFinite(alpha)) return null;
  return { r: out[0], g: out[1], b: out[2], a: Math.max(0, Math.min(1, alpha)) };
}

export const REPORT_SCRIPT = `(() => {
  const W = innerWidth;
  const parse = ${parseColour.toString()};
  const COLOURS_IN = /(?:rgba?|color|lab|lch|oklab|oklch)\\([^()]*\\)/gi;
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
  // The light tree, then every open shadow tree (a host before its shadow's elements).
  const every = [document.documentElement, ...document.querySelectorAll("body, body *")];
  for (let i = 0; i < every.length && every.length <= ${CAPS.elements}; i++) {
    const sr = every[i].shadowRoot;
    if (sr) every.push(...sr.querySelectorAll("*"));
  }
  const all = every.slice(0, ${CAPS.elements});
  const wider = [], colours = new Set(), fonts = new Map(), contrast = [];
  let filtered = 0, turned = 0, painted = 0, unsized = 0, fontsCut = false;
  const add = (c) => { if (c && c.a > 0 && colours.size < 400) colours.add(hex(c)); };
  // How much smaller (or larger) an element's text is drawn than its font size: the smallest stretch of every
  // transform, scale and rotate from it up to the root (in the flat tree), times its zoom. An SVG element's is its
  // screen matrix (viewBox, transforms and zoom above it). null when a 3D transform is on the way.
  const stretch = (m) => { const t = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3], d = m[0] * m[3] - m[1] * m[2]; return Math.sqrt(Math.max(0, (t - Math.sqrt(Math.max(0, t * t - 4 * d * d))) / 2)); };
  const times = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3]];
  const ANGLE = { deg: Math.PI / 180, rad: 1, grad: Math.PI / 200, turn: 2 * Math.PI };
  const ownLinear = (cs) => {
    let m = [1, 0, 0, 1];
    const r = String(cs.rotate || "none").trim();
    if (r !== "none") {
      const a = /^(?:z\\s+)?(-?[0-9.e+-]+)(deg|rad|grad|turn)$/.exec(r);
      if (!a) return null;
      const t = parseFloat(a[1]) * ANGLE[a[2]];
      m = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)];
    }
    const sc = String(cs.scale || "none").trim();
    if (sc !== "none") {
      const v = sc.split(/\\s+/).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x)));
      if (v.length > 2 && v[2] !== 1) return null;
      m = times(m, [v[0], 0, 0, v.length > 1 ? v[1] : v[0]]);
    }
    if (String(cs.translate || "none").trim().split(/\\s+/).length > 2) return null;
    if (cs.transform && cs.transform !== "none") {
      let d;
      try { d = new DOMMatrixReadOnly(cs.transform); } catch { return null; }
      if (!d.is2D) return null;
      m = times(m, [d.a, d.b, d.c, d.d]);
    }
    return m.every(Number.isFinite) ? m : null;
  };
  const flatParent = (e) => e.assignedSlot || e.parentElement || (e.parentNode && e.parentNode.host) || null;
  const linear = new Map();
  const linearOf = (e) => {
    if (linear.has(e)) return linear.get(e);
    const chain = [];
    let n = e;
    while (n && !linear.has(n) && chain.length < 10000) { chain.push(n); n = flatParent(n); }
    let up = !n ? [1, 0, 0, 1] : linear.has(n) ? linear.get(n) : null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const own = up && ownLinear(getComputedStyle(chain[i]));
      up = own ? times(up, own) : null;
      linear.set(chain[i], up);
    }
    return linear.get(e);
  };
  const drawnScale = (e, r) => {
    if (e instanceof SVGGraphicsElement && e.getScreenCTM) {
      const m = e.getScreenCTM();
      return m ? stretch([m.a, m.b, m.c, m.d]) : null;
    }
    const m = e.closest("foreignObject") ? null : linearOf(e);
    const zoom = typeof e.currentCSSZoom === "number" && e.currentCSSZoom > 0 ? e.currentCSSZoom : 1;
    if (m) return stretch(m) * zoom;
    // a 3D transform or an SVG drawing on the way: the drawn box against the laid-out one
    const ow = e.offsetWidth, oh = e.offsetHeight;
    return ow > 0 && oh > 0 ? Math.min(r.width / ow, r.height / oh) : null;
  };
  const sizeAt = (cs, e, r, family) => {
    const k = drawnScale(e, r);
    if (k === null || !Number.isFinite(k)) { unsized++; return; }
    if (cs.fontSizeAdjust && cs.fontSizeAdjust !== "none") unsized++;
    const px = Math.round(parseFloat(cs.fontSize) * k * 100) / 100;
    if (!Number.isFinite(px)) { unsized++; return; }
    if (fonts.size < 50 || fonts.has(family)) fonts.set(family, Math.min(fonts.get(family) ?? Infinity, px));
    else fontsCut = true;
  };
  const familyOf = (cs) => cs.fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
  // Whether any style sheet of the page (or of an open shadow tree) styles a first line or letter: only then is
  // each text element's ::first-line and ::first-letter measured (it is slow on a deep page). A sheet that cannot
  // be read counts as one that does.
  let firsts = false;
  const seeFirsts = (rules, depth) => {
    for (const r of rules) {
      if (firsts || depth > 64) return;
      if (typeof r.selectorText === "string" && /first-(?:line|letter)/i.test(r.selectorText)) firsts = true;
      if (r.cssRules) seeFirsts(r.cssRules, depth + 1);
    }
  };
  const sheetsOf = (root) => [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])];
  for (const sheet of [document, ...every.filter((e) => e.shadowRoot).map((e) => e.shadowRoot)].flatMap(sheetsOf)) {
    try { seeFirsts(sheet.cssRules, 0); } catch { firsts = true; }
    if (firsts) break;
  }
  // Every colour an element is drawn with: its own, its borders and outline, its text's fill, stroke and
  // decoration, an SVG shape's paint, and every colour inside its gradients and shadows (of <html>, only its
  // background and filters: it holds no text of its own).
  const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "use"]);
  const SVG_PAINT = { stop: ["stopColor"], feFlood: ["floodColor"], feDropShadow: ["floodColor"], feDiffuseLighting: ["lightingColor"], feSpecularLighting: ["lightingColor"] };
  const paint = (cs, e) => {
    const top = e === document.documentElement;
    for (const [p, wp] of [["color"], ["backgroundColor"], ["borderTopColor", "borderTopWidth"], ["borderRightColor", "borderRightWidth"],
      ["borderBottomColor", "borderBottomWidth"], ["borderLeftColor", "borderLeftWidth"], ["webkitTextFillColor"], ["webkitTextStrokeColor", "webkitTextStrokeWidth"]]) {
      if ((!top || p === "backgroundColor") && (!wp || parseFloat(cs[wp]) > 0)) add(parse(cs[p]));
    }
    if (!top && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) add(parse(cs.outlineColor));
    if (!top && cs.textDecorationLine && cs.textDecorationLine !== "none") add(parse(cs.textDecorationColor));
    if (e instanceof SVGElement) {
      const props = SHAPES.has(e.localName) ? ["fill", "stroke"] : SVG_PAINT[e.localName] || [];
      for (const p of props) if (cs[p] && cs[p] !== "none") add(parse(cs[p]));
    }
    for (const p of top ? ["backgroundImage", "borderImageSource"] : ["backgroundImage", "borderImageSource", "listStyleImage", "boxShadow", "textShadow", ...(e ? [] : ["content"])]) {
      const v = cs[p];
      if (!v || v === "none" || v === "normal") continue;
      for (const one of v.match(COLOURS_IN) || []) add(parse(one));
      if (/\\bpaint\\(/i.test(v)) painted++;
      if (/\\b(?:longer|increasing|decreasing)\\s+hue\\b/i.test(v)) turned++;
    }
    if (cs.filter !== "none" || (cs.backdropFilter && cs.backdropFilter !== "none") || cs.mixBlendMode !== "normal"
      || String(cs.backgroundBlendMode).split(",").some((x) => x.trim() !== "normal")) filtered++;
  };
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    paint(cs, e);
    const r = e.getBoundingClientRect();
    for (const pseudo of ["::before", "::after"]) {
      const ps = getComputedStyle(e, pseudo);
      if (ps.content && ps.content !== "none" && ps.content !== "normal") {
        paint(ps, null);
        if (/["']/.test(ps.content) && r.width > 0) sizeAt(ps, e, r, familyOf(ps));
      }
    }
    if (cs.display === "list-item") paint(getComputedStyle(e, "::marker"), null);
    if (wider.length < 40 && r.width > 0 && (r.right > W + 1 || r.left < -1) && cs.position !== "fixed")
      wider.push({ tag: e.tagName.toLowerCase(), cls: String(e.getAttribute("class") || ""), width: Math.round(r.width) });
    const text = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!text || r.width === 0) continue;
    for (const pseudo of firsts ? ["::first-line", "::first-letter"] : []) {
      const ps = getComputedStyle(e, pseudo);
      paint(ps, null);
      sizeAt(ps, e, r, familyOf(ps));
    }
    const family = familyOf(cs);
    sizeAt(cs, e, r, family);
    const px = parseFloat(cs.fontSize);
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
    filtered,
    turned,
    painted,
    unsized,
    capped: every.length > ${CAPS.elements} || colours.size > ${CAPS.colours} || fontsCut,
  };
})()`;

// T58e: the most keyframes of one animation the page is measured at; one with more is said, not measured.
export const SETTLE_STEPS = 8;

// The page as it looks later, with no time spent (T58e): every animation and transition of the document (CSS
// animations, transitions and those a script made) paused, made linear, forwards and from its first iteration, and
// put at its `step`-th keyframe (its last one when it has fewer), and every SVG drawing's own animations at a time
// later on. Run in the viewer's isolated world, between two runs of REPORT_SCRIPT. -> { any, more, unsettled }:
// whether the page has any animation, whether another step would put some animation elsewhere, and how many could
// not be put at their keyframes (one that follows scrolling or a view, one with more than SETTLE_STEPS keyframes,
// one that refused).
export function settleScript(step) {
  const k = Number.isSafeInteger(step) && step >= 0 ? step : 0;
  return `(() => {
  const k = ${k};
  let unsettled = 0, more = false, list = [];
  try { list = document.getAnimations(); } catch { return { more: false, unsettled: 1 }; }
  if (list.length > 2000) { unsettled++; list = list.slice(0, 2000); }
  for (const a of list) {
    try {
      const effect = a.effect;
      if (!effect || typeof effect.getKeyframes !== "function") continue;
      if (a.timeline !== document.timeline) { unsettled++; continue; }
      const offsets = [...new Set(effect.getKeyframes().map((f) => Number(f.computedOffset)).filter(Number.isFinite))].sort((x, y) => x - y);
      if (!offsets.length) continue;
      if (offsets.length > ${SETTLE_STEPS}) unsettled++;
      if (k + 1 < Math.min(offsets.length, ${SETTLE_STEPS})) more = true;
      a.pause();
      a.playbackRate = 1;
      effect.updateTiming({ easing: "linear", direction: "normal", iterationStart: 0 });
      const t = effect.getComputedTiming();
      const delay = Number(t.delay) || 0;
      const dur = Number(t.duration);
      if (!Number.isFinite(dur) || dur < 0) { unsettled++; continue; }
      const o = offsets[Math.min(k, offsets.length - 1)];
      a.currentTime = delay + (dur > 0 ? Math.min(o * dur, dur - Math.min(0.01, dur / 2)) : 0);
    } catch {
      unsettled++;
    }
  }
  const at = [1, 3, 10, 60, 600, 3600, 36000, 360000];
  for (const s of document.querySelectorAll("svg")) {
    try { if (s.animationsPaused !== undefined) { s.pauseAnimations(); s.setCurrentTime(at[Math.min(k, at.length - 1)]); } } catch { unsettled++; }
  }
  const smil = !!document.querySelector("animate, set, animateTransform, animateMotion, animateColor");
  if (k + 1 < ${SETTLE_STEPS} && smil) more = true;
  return { any: list.length > 0 || smil, more, unsettled };
})()`;
}

const HEX_RE = /^#[0-9A-F]{6}$/;
export const plainText = (v, max) => String(v === undefined || v === null ? "" : v).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, " ").slice(0, max);
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0);
const px = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

// One page's report from its passes (each { width, scheme, data } where data is what
// REPORT_SCRIPT gave, or null), plus what the viewer saw itself. -> K15's page object,
// with `dark`, `drawn` (the faces Chrome really drew with), `shots` and `cut` added, and (T58b)
// `filtered` (the most elements of any pass drawn through a filter or blend mode) and `capped` (the
// page held more elements or colours than are listed, so not every one was reported).
// T58e: a pass with `extra` (the page with no less motion asked, and the page with its animations put at
// their keyframes) adds only to what the brand is judged by: colours, faces and sizes, `filtered`,
// `capped`, `turned`, `painted` and `unsized` (the most of any pass); `unsettled` is the most animations
// a pass could not put at their keyframes; `fallbacks` the faces Chrome drew only letters of other
// scripts with (letters the page's own faces have none of).
export function mergePage({ page, passes, errors, blocked, missing, drawn, fallbacks, shots, cut, unsettled }) {
  const out = {
    page,
    errors: [], wider: [], missing: [], blocked: [],
    a11y: { noAlt: 0, noLabel: 0, noLang: false, noTitle: false, headingSkips: 0, smallTargets: 0 },
    contrast: [], fonts: [], colours: [], drawn: [], fallbacks: [], dark: false, shots: [...(shots || [])], cut: cut || null,
    filtered: 0, capped: false, turned: 0, painted: 0, unsized: 0, unsettled: count(unsettled),
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
  for (const { width, data, extra } of passes || []) {
    if (!data || typeof data !== "object") continue;
    if (data.capped === true) out.capped = true;
    for (const k of ["filtered", "turned", "painted", "unsized"]) out[k] = Math.max(out[k], count(data[k]));
    if (extra) {
      addBrand(data);
      continue;
    }
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
    addBrand(data);
  }
  function addBrand(data) {
    for (const f of Array.isArray(data.fonts) ? data.fonts : []) {
      if (!f || typeof f !== "object") continue;
      const family = plainText(f.family, 80);
      const size = px(f.minPx);
      if (size === null) continue;
      if (!fonts.has(family) && fonts.size >= CAPS.fonts) { out.capped = true; continue; }
      fonts.set(family, Math.min(fonts.has(family) ? fonts.get(family) : Infinity, size));
    }
    for (const c of Array.isArray(data.colours) ? data.colours : []) {
      if (!HEX_RE.test(c)) continue;
      if (out.colours.length >= CAPS.colours && !out.colours.includes(c)) out.capped = true;
      addUnique(out.colours, c, CAPS.colours);
    }
  }
  out.fonts = [...fonts].map(([family, minPx]) => ({ family, minPx }));
  for (const d of drawn || []) addUnique(out.drawn, plainText(d, 80), CAPS.fonts);
  for (const d of fallbacks || []) if (!out.drawn.includes(plainText(d, 80))) addUnique(out.fallbacks, plainText(d, 80), CAPS.fonts);
  return out;
}

// The file name part of a page: its archive name without ".html", "/" as "_".
export function pageSlug(name) {
  return String(name).replace(/\.html$/i, "").replace(/\//g, "_");
}
