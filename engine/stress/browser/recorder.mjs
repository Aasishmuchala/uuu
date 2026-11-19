// The browser sweep's eyes on one tab (PLAN-STRESS T3): everything a page load or a press does, as data.
//   openTab(browser, { stage, width, height }) -> tab
//   tab = { page, width, height, window(), load(url), settle(), snapshot(), eval(expr), key(...), click(x, y), close() }
// A "window" is what happened since the last tab.window(): exceptions, console errors and warnings, CSP reports
// (from Chrome's log and from a securitypolicyviolation listener put on every new document), requests and their
// answers, failed loads, requests to a host that is not the stage, and native dialogs (each refused at once, so a
// planted alert() can never hold the page). In the page, window.__stress keeps paint times, long tasks and a count
// of DOM changes (style changes left out, so an animation is not a change).
import { inflateSync } from "node:zlib";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Put on every new document before the page's own scripts.
export const IN_PAGE = `(() => {
  if (window.__stress) return;
  const S = window.__stress = { paints: {}, longtasks: [], csp: [], mutations: 0 };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) S.paints[e.name] = Math.round(e.startTime); })
      .observe({ type: "paint", buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) S.longtasks.push({ start: Math.round(e.startTime), ms: Math.round(e.duration), hash: location.hash });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  document.addEventListener("securitypolicyviolation", (e) => {
    S.csp.push({ directive: e.violatedDirective, blocked: String(e.blockedURI || "").slice(0, 200), source: String(e.sourceFile || "").slice(0, 200), line: e.lineNumber, sample: String(e.sample || "").slice(0, 120) });
  }, true);
  const watch = () => {
    try {
      new MutationObserver((rs) => {
        for (const r of rs) {
          if (r.type === "attributes" && (r.attributeName === "style" || r.attributeName === "data-stress-ring")) continue;
          S.mutations += 1;
        }
      }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) {}
  };
  if (document.documentElement) watch(); else document.addEventListener("DOMContentLoaded", watch, { once: true });
})();`;

// What a loaded page looks like, measured in the page. Returns plain data.
export const SNAPSHOT = `(() => {
  const S = window.__stress || { paints: {}, longtasks: [], csp: [], mutations: 0 };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const d = document.documentElement;
  const wide = [...document.querySelectorAll("body *")].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.right > innerWidth + 1)) return false;
    const cs = getComputedStyle(e);
    if (cs.position === "fixed") return false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return false;
    }
    return true;
  }).slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).slice(0, 2).join(".") : ""));
  // Text cut off with no way to read it: overflow hidden, no title, no link or button around it, no label holding it.
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    if (clipped.length >= 8) break;
    if (!el.firstChild || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) continue;
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    // Text kept for screen readers only (a 1 px box, clipped on purpose) is not cut off.
    if (el.closest(".u-visually-hidden, .k-sr, .sr-only") || el.clientWidth <= 2 || el.clientHeight <= 2 || (cs.clip && cs.clip !== "auto") || /inset\(50%\)/.test(cs.clipPath)) continue;
    const hid = (v) => v === "hidden" || v === "clip";
    const cutX = hid(cs.overflowX) && el.scrollWidth > el.clientWidth + 8;
    const cutY = hid(cs.overflowY) && el.scrollHeight > el.clientHeight + 8 && cs.webkitLineClamp === "none";
    const clamp = cs.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 8;
    if (!cutX && !cutY && !clamp) continue;
    let readable = false;
    const text = el.textContent.trim();
    for (let p = el, i = 0; p && i < 6; p = p.parentElement, i += 1) {
      if (p.getAttribute && (p.getAttribute("title") || (p.getAttribute("aria-label") || "").includes(text.slice(0, 40)))) { readable = true; break; }
      if (p.matches && p.matches("a[href], button, [role=button], [role=link], summary, [tabindex]:not([tabindex='-1'])")) { readable = true; break; }
      // A card whose own link opens the whole thing (within three levels) is a way to read it.
      if (i <= 3 && p.querySelector && p.querySelector("a[href^='#/'], [role=link]")) { readable = true; break; }
    }
    if (!readable) clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 60), text: text.slice(0, 80) });
  }
  // Text whose colour is too close to the solid colour behind it (only where that colour is plain, no picture).
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ""); if (!m) return null; const v = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const faint = [];
  let checked = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (faint.length >= 8 || checked > 1500) break;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if (Number(cs.opacity) < 0.99 || el.closest("[aria-hidden=true], [disabled], [aria-disabled=true], .k-sr, .u-visually-hidden")) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.99) continue;
    // What lies under the text on screen (a scene, a picture or a see-through layer makes it unknown, so skipped).
    const rr = el.getBoundingClientRect();
    const cx = rr.left + Math.min(rr.width / 2, 20), cy = rr.top + rr.height / 2;
    if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) continue;
    const stack = document.elementsFromPoint(cx, cy);
    const at = stack.indexOf(el);
    let bg = null;
    for (const p of (at >= 0 ? stack.slice(at) : [])) {
      if (/^(canvas|img|video|svg|picture|iframe)$/i.test(p.tagName)) { bg = null; break; }
      const ps = getComputedStyle(p);
      if (ps.backgroundImage && ps.backgroundImage !== "none") { bg = null; break; }
      if (ps.backdropFilter && ps.backdropFilter !== "none") { bg = null; break; }
      if (Number(ps.opacity) < 0.99) { bg = null; break; }
      // A ::before or ::after that paints (a wash over a scene) is not in the stack; its colour is unknown here.
      const painted = ["::before", "::after"].some((w) => { const q = getComputedStyle(p, w); if (!q.content || q.content === "none") return false; const qc = parse(q.backgroundColor); return (q.backgroundImage && q.backgroundImage !== "none") || (qc && qc.a > 0.01); });
      if (painted) { bg = null; break; }
      const c = parse(ps.backgroundColor);
      if (c && c.a >= 0.99) { bg = c; break; }
      if (c && c.a > 0.01) { bg = null; break; }
    }
    if (!bg) continue;
    checked += 1;
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    if (ratio < 3) faint.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 60), text: el.textContent.trim().slice(0, 60), ratio: Math.round(ratio * 100) / 100, fg: [fg.r, fg.g, fg.b], box: { x: Math.max(0, Math.floor(rr.left + scrollX)), y: Math.max(0, Math.floor(rr.top + scrollY)), width: Math.max(1, Math.min(Math.ceil(rr.width), 400)), height: Math.max(1, Math.ceil(rr.height)) } });
  }
  const main = document.getElementById("main");
  const busy = [...document.querySelectorAll("[aria-busy=true], .k-loading")].filter(vis).length;
  // Planted text that became markup: a script or picture made from a title, an onerror on anything.
  const planted = [...document.querySelectorAll("script")].filter((s) => /alert\\(1\\)/.test(s.textContent || "")).length
    + document.querySelectorAll("img[src='x'], [onerror]").length;
  return {
    hash: location.hash, title: document.title,
    scrollWidth: d.scrollWidth, innerWidth, wide,
    shell: !!document.querySelector(".s-app") && !!main,
    pageRoot: main ? [...main.children].map((c) => String(c.className || "")).join(" ").slice(0, 120) : "",
    h1: (document.getElementById("page-title") || document.querySelector("main h1") || {}).textContent || "",
    notFound: !!document.querySelector(".s-notfound"),
    building: /This page is being built\\./.test(main ? main.innerText : ""),
    busy, clipped, faint, planted,
    text: (main ? main.innerText : document.body ? document.body.innerText : "").slice(0, 4000),
    bodyText: (document.body ? document.body.innerText : "").slice(0, 60000),
    paints: S.paints, longtasks: S.longtasks.slice(), csp: S.csp.slice(), mutations: S.mutations,
    nodes: document.getElementsByTagName("*").length,
  };
})()`;

function hostOk(url, base) {
  let u;
  try { u = new URL(url); } catch { return true; }
  if (["data:", "blob:", "about:", "chrome:", "devtools:", "chrome-error:"].includes(u.protocol)) return true;
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  return u.hostname === "127.0.0.1" && port >= base && port <= base + 99;
}

const descOf = (d) => (d && (d.exception && (d.exception.description || d.exception.value)) || d.text || "").toString().split("\n").slice(0, 4).join("\n");

export async function openTab(browser, { stage, width = 1280, height = 900 } = {}) {
  const page = await browser.page();
  const base = stage.base;
  let win = null;
  const inflight = new Map(); // requestId -> url
  let lastNet = Date.now();
  const fresh = () => ({
    exceptions: [], console: [], warnings: [], csp: [], requests: [], failed: [], outside: [], dialogs: [], navigations: 0, started: Date.now(),
  });
  win = fresh();
  const reqs = new Map(); // requestId -> request record in this window
  page.on((m) => {
    const p = m.params || {};
    switch (m.method) {
      case "Runtime.exceptionThrown":
        win.exceptions.push(descOf(p.exceptionDetails).slice(0, 600));
        break;
      case "Runtime.consoleAPICalled": {
        const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(" ").slice(0, 600);
        if (p.type === "error" || p.type === "assert") win.console.push(text);
        else if (p.type === "warning") win.warnings.push(text);
        break;
      }
      case "Log.entryAdded": {
        const e = p.entry || {};
        const text = String(e.text || "").slice(0, 600);
        if (e.source === "security" || /Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(text)) win.csp.push(text);
        else if (e.source === "network") { /* the failed request is counted from the network events */ }
        else if (e.level === "error") win.console.push(text);
        else if (e.level === "warning") win.warnings.push(`${e.source}: ${text}`);
        break;
      }
      case "Network.requestWillBeSent": {
        const url = p.request && p.request.url;
        lastNet = Date.now();
        if (p.type !== "EventSource" && p.type !== "WebSocket") inflight.set(p.requestId, url);
        const r = { url, method: p.request && p.request.method, type: p.type, status: null, t: Date.now() };
        reqs.set(p.requestId, r);
        win.requests.push(r);
        if (url && !hostOk(url, base)) win.outside.push({ url: url.slice(0, 300), type: p.type || "" });
        break;
      }
      case "Network.responseReceived": {
        const r = reqs.get(p.requestId);
        if (r) r.status = p.response && p.response.status;
        if (p.response && p.response.status >= 400) win.failed.push({ url: String(p.response.url).slice(0, 300), status: p.response.status, method: r ? r.method : "GET" });
        break;
      }
      case "Network.loadingFinished":
        inflight.delete(p.requestId);
        lastNet = Date.now();
        break;
      case "Network.loadingFailed": {
        inflight.delete(p.requestId);
        lastNet = Date.now();
        const r = reqs.get(p.requestId);
        if (r) r.status = r.status || 0;
        if (!p.canceled && !(r && r.status >= 400)) {
          win.failed.push({ url: String(r ? r.url : "").slice(0, 300), status: 0, error: p.errorText, blocked: p.blockedReason || null, method: r ? r.method : "GET" });
          if (p.blockedReason === "csp") win.csp.push(`blocked by the policy: ${r ? r.url : ""}`);
        }
        break;
      }
      case "Page.javascriptDialogOpening":
        win.dialogs.push({ type: p.type, message: String(p.message || "").slice(0, 200) });
        page.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
        break;
      case "Page.frameNavigated":
        if (p.frame && !p.frame.parentId) win.navigations += 1;
        break;
      default:
    }
  });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: IN_PAGE });
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  if (width < 500) await page.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
  await page.send("Network.setCacheDisabled", { cacheDisabled: false }).catch(() => {});

  const evalJs = async (expression, { awaitPromise = false, timeoutMs = 20000 } = {}) => {
    const r = await Promise.race([
      page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }),
      sleep(timeoutMs).then(() => ({ timedOut: true })),
    ]);
    if (r.timedOut) throw new Error("the page did not answer an evaluation in time");
    if (r.exceptionDetails) throw new Error(`in the page: ${descOf(r.exceptionDetails)}`);
    return r.result ? r.result.value : undefined;
  };

  const tab = {
    page, width, height,
    // Starts a new window of events and returns the one that ended.
    window() {
      const w = win;
      win = fresh();
      reqs.clear();
      return w;
    },
    get current() { return win; },
    inflight: () => inflight.size,
    async blank() {
      await page.goto("about:blank", { timeoutMs: 5000 }).catch(() => {});
      inflight.clear();
    },
    async load(url, { settle = true, maxMs = 10000 } = {}) {
      await tab.blank();
      tab.window();
      const nav = await page.goto(url, { timeoutMs: 30000 });
      if (settle) await tab.settle({ maxMs });
      return nav;
    },
    // Waits until no request has been open for `quietMs`, at most `maxMs`.
    async settle({ quietMs = 500, maxMs = 10000 } = {}) {
      const end = Date.now() + maxMs;
      await sleep(150);
      while (Date.now() < end) {
        if (inflight.size === 0 && Date.now() - lastNet >= quietMs) break;
        await sleep(100);
      }
      await sleep(150);
      return inflight.size === 0;
    },
    snapshot: () => evalJs(SNAPSHOT),
    eval: evalJs,
    async key(key, { code, keyCode, text, modifiers = 0 } = {}) {
      const k = { key, code: code || key, windowsVirtualKeyCode: keyCode || 0, modifiers };
      await page.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...k, ...(text ? { text } : {}) });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...k });
    },
    async click(x, y) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    async type(text) {
      await page.send("Input.insertText", { text });
    },
    close: () => page.close(),
  };
  return tab;
}

export const KEYS = {
  Tab: { code: "Tab", keyCode: 9 },
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Space: { code: "Space", keyCode: 32, text: " " },
  Escape: { code: "Escape", keyCode: 27 },
};

export async function press(tab, name, modifiers = 0) {
  const k = KEYS[name];
  if (name === "Space") return tab.key(" ", { code: "Space", keyCode: 32, text: " ", modifiers });
  return tab.key(name, { ...k, modifiers });
}

// The colour behind a piece of text as it is really drawn: a picture of its box, the commonest colour in it. A
// wash or a scene that hit-testing cannot see is in the picture. -> contrast ratio of `fg` against it, or null.
export async function drawnContrast(tab, { box, fg }) {
  let shot;
  try {
    shot = await tab.page.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 } });
  } catch {
    return null;
  }
  const img = decodePng(Buffer.from(shot.data, "base64"));
  if (!img) return null;
  const counts = new Map();
  for (let i = 0; i < img.pixels.length; i += 4) {
    const k = ((img.pixels[i] >> 3) << 10) | ((img.pixels[i + 1] >> 3) << 5) | (img.pixels[i + 2] >> 3);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (!best || n > best[1]) best = [k, n];
  if (!best) return null;
  const bg = [((best[0] >> 10) & 31) * 8 + 4, ((best[0] >> 5) & 31) * 8 + 4, (best[0] & 31) * 8 + 4];
  const lum = ([r0, g0, b0]) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r0) + 0.7152 * f(g0) + 0.0722 * f(b0); };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return { ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, bg };
}

// A small PNG reader for Chrome's own pictures (8-bit RGB or RGBA, not interlaced). -> { width, height, pixels RGBA }
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let p = 8;
  let width = 0, height = 0, type = 0, depth = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace || (type !== 2 && type !== 6)) return null;
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x += 1) {
      out[(y * width + x) * 4] = line[x * bpp];
      out[(y * width + x) * 4 + 1] = line[x * bpp + 1];
      out[(y * width + x) * 4 + 2] = line[x * bpp + 2];
      out[(y * width + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

export { hostOk, sleep };
