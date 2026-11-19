// The reliability sweep (PLAN-APPS-ASTRYX T7, the owner's "no lag, no bugs, no errors"): each
// app on the stage (stage.mjs, the real fence with the stand-ins), seeded as for the stills and
// then made big (Arch Film Studio: a project at its limit of 200 renders; Render to Film: a
// library of 200 takes), driven screen by screen through the page viewer's hidden Chrome on its
// own throwaway profile, as take-stills.mjs does. For every screen it records:
//
//   - console errors and warnings, uncaught exceptions and rejected promises (React's own
//     warnings arrive as console errors), failed requests, content-policy violations;
//   - lag: the time from navigation to the screen being ready (its heading on screen, no
//     Skeleton, every picture in view decoded, still for 250 ms), first contentful paint, long
//     tasks over 50 ms (PerformanceObserver "longtask"), the slowest input to paint ("event"
//     timing) while it is driven;
//   - polling: the requests the page makes while it sits idle for 8 s with no work running;
//   - its actions: each main action of the screen, done with real clicks, keys and drags, with
//     what failed.
//
// And on the big data: scrolling the longest grid (frames over 50 ms) and typing into a search.
//
//   node engine/apps/test/stage/sweep.mjs --app <slug>|all --out <dir>
//
// Writes <out>/<slug>.json and <out>/<slug>.md. Exits 1 when any screen has an error, a failed
// request, a policy violation or an action that failed. Nothing of the live state is touched.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHROME_PATH, chromeInstalled, defaultLaunch, prepareRoot, startChrome } from "../../../viewer/chrome.mjs";
import { makePictures } from "./pictures.mjs";
import { REPO, STAGE_PORTS, startStage } from "./stage.mjs";
import { openTab, startStageProxy } from "./take-stills.mjs";

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const IDLE_MS = 8000;

// Put in before any of the page's own code: the watchers the sweep reads.
export const WATCHERS = `(() => {
  const S = (window.__sweep = { console: [], errors: [], long: [], events: [], requests: [] });
  const words = (a) => a.map((x) => { if (x instanceof Error) return x.message; if (typeof x === "string") return x; try { return JSON.stringify(x); } catch { return String(x); } }).join(" ").slice(0, 400);
  for (const kind of ["error", "warn"]) {
    const own = console[kind];
    console[kind] = function (...a) { try { S.console.push({ kind, text: words(a) }); } catch {} return own.apply(this, a); };
  }
  addEventListener("error", (e) => S.errors.push(String(e.message || e.error || "error").slice(0, 400)));
  addEventListener("unhandledrejection", (e) => S.errors.push("unhandled rejection: " + String((e.reason && (e.reason.message || e.reason)) || "").slice(0, 400)));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.events.push({ name: e.name, ms: Math.round(e.duration), at: Math.round(e.startTime), work: Math.round(e.processingEnd - e.processingStart), wait: Math.round(e.processingStart - e.startTime), target: e.target ? (e.target.getAttribute("aria-label") || e.target.tagName + "." + String(e.target.className).slice(0, 30) || "").slice(0, 60) : "" }); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.requests.push({ at: Math.round(e.startTime), url: String(e.name).replace(location.origin, "").slice(0, 160), bytes: e.transferSize || 0, kind: e.initiatorType }); }).observe({ type: "resource", buffered: true }); } catch {}
  // The screen is ready: a heading, no Skeleton, every picture in view decoded, and still for 250 ms.
  window.__sweepReady = (limitMs = 20000) => new Promise((done) => {
    const t0 = performance.now();
    let since = null;
    let shape = "";
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const tick = () => {
      const ok = (!document.fonts || document.fonts.status === "loaded")
        && !!document.querySelector("h1, h2, [role=heading]")
        && ![...document.querySelectorAll('[class*="skeleton" i], [data-skeleton]')].some(inView)
        && ![...document.images].filter(inView).some((i) => !i.complete || i.naturalWidth === 0);
      const now = document.body.innerText.length + ":" + document.querySelectorAll("*").length;
      if (ok && now === shape) { if (since === null) since = performance.now(); else if (performance.now() - since >= 250) return done(Math.round(since)); }
      else since = ok ? performance.now() : null;
      shape = now;
      if (performance.now() - t0 > limitMs) return done(null);
      setTimeout(tick, 40);
    };
    tick();
  });
})();`;

// Text that is cut by its box (clipped labels): a leaf element whose text box runs past the
// nearest box around it that hides its overflow, or that overflows itself while hiding it.
// Text that ellipsizes on purpose, words for screen readers only, and the inside of scrolled
// lists (a scroller shows the rest when scrolled) are left out.
const CLIPPED = `(() => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.children.length > 0 || !el.textContent.trim() || el.closest("[aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === "ellipsis" || el.closest("[title]")) continue;
    let srOnly = false;
    for (let p = el, n = 0; p && n < 3 && !srOnly; p = p.parentElement, n += 1) {
      const q = getComputedStyle(p); const b = p.getBoundingClientRect();
      srOnly = (q.clip && q.clip !== "auto") || (q.clipPath && q.clipPath !== "none") || b.width <= 2 || b.height <= 2;
    }
    if (srOnly) continue;
    let cut = cs.overflow !== "visible" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
    if (!cut) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const q = getComputedStyle(p);
        if (q.overflowX === "visible" && q.overflowY === "visible") continue;
        if (/(auto|scroll)/.test(q.overflowX + q.overflowY)) break;
        if (q.textOverflow === "ellipsis") break;
        const b = p.getBoundingClientRect();
        cut = r.right > b.right + 1 || r.left < b.left - 1;
        break;
      }
    }
    if (cut) out.push(el.textContent.trim().slice(0, 60));
  }
  return [...new Set(out)].slice(0, 12);
})()`;

// ---------------------------------------------------------------------------
// The big data.

async function bigAfs(stage, pictures, log) {
  const p = await stage.mutate("project.create", { name: "Riverside campus, all renders" });
  const sets = pictures.sets;
  for (let i = 0; i < 200; i += 1) {
    const set = sets[i % sets.length];
    const name = `View ${String(i + 1)} ${set.name}`;
    await stage.upload(`/api/upload?project=${encodeURIComponent(p.id)}`, readFileSync(set.render), { "x-file-name": encodeURIComponent(name) });
  }
  log("  a project of 200 renders");
  return p.id;
}

async function bigR2f(stage, ctx, log) {
  stage.door.state.maxRunning = 1000;
  stage.door.setAllowance({ open: true, budget: 1_000_000, spent: 0 });
  const size = { width: 2560, height: 1440 };
  const looks = ["golden-hour", "blue-hour", "overcast", "after-rain", "early-morning"];
  const ids = [];
  // The app takes a few asks at a time ("asking the engine too much at once"): two at a time,
  // each waited for, and asked again after a moment when refused for that.
  const one = async (i) => {
    for (let tries = 0; ; tries += 1) {
      try {
        const { id } = await stage.mutate("createShot", { imageUrl: ctx.renderUrl, imageModel: "nano-banana-pro", look: looks[i % looks.length], crowd: "none", direction: `Take ${i + 1}: soft light on the stone.`, ...size });
        for (;;) { const st = await stage.query("shotStatus", { id }); if (st.done) break; await wait(500); }
        ids.push(id);
        return;
      } catch (err) {
        if (tries > 20 || !/too much at once|busy/i.test(String(err.message))) throw err;
        await wait(700);
      }
    }
  };
  for (let i = 0; i < 190; i += 2) await Promise.all([one(i), one(i + 1)]);
  stage.door.state.maxRunning = 2;
  stage.door.setAllowance({ open: true, budget: 2000, spent: 340 });
  await stage.query("library");
  log(`  a library of ${ids.length} more takes`);
  return ids;
}

// ---------------------------------------------------------------------------
// The screens and their actions. `act(name, fn)` runs one action and records a failure.

const at = (id, screen) => `#/p/${id}/${screen}`;

function afsScreens(c) {
  return [
    { name: "projects", hash: "#/", actions: async (page, act) => {
      await act("open New project and close it", async () => { await page.click("New project"); await page.wait(300); await page.key("Escape"); });
      await act("command palette: type and go", async () => { await page.key("k", { meta: true }); await page.type("Courtyard"); await page.wait(500); await page.key("Enter"); await page.wait(600); if (!(await page.evaluate("location.hash")).includes("/p/")) throw new Error("not in the project"); });
      await act("shortcuts sheet", async () => { await page.key("?", { shift: true }); await page.wait(300); await page.key("Escape"); });
    } },
    { name: "overview", hash: at(c.main, "overview"), actions: async (page, act) => {
      await act("stage rail goes to Review", async () => { await page.click("Review"); await page.wait(400); if (!(await page.evaluate("location.hash")).endsWith("/review")) throw new Error("not on Review"); });
    } },
    { name: "renders", hash: at(c.main, "renders"), actions: async (page, act) => {
      await act("select one, then a range", async () => { await page.clickNth("li > button[aria-pressed]", 0); await page.clickNth("li > button[aria-pressed]", 5, { shift: true }); });
      await act("upload one render", async () => { await page.upload('input[type="file"]', page.sample); await page.waitFor(`document.body.innerText.includes("13")`, 30_000); });
    } },
    { name: "renders-empty", hash: at(c.fresh, "renders"), actions: async () => {} },
    { name: "enhance", hash: at(c.main, "enhance"), actions: async (page, act) => {
      await act("filter chips", async () => { await page.chip("Not enhanced"); await page.chip("Done"); await page.chip("All"); });
      await act("select all not enhanced", async () => { await page.click("Select all not enhanced"); });
      await act("Cmd+A then clear", async () => { await page.key("a", { meta: true }); await page.click("Clear"); });
      await act("range of eight", async () => { await page.clickNth("li > button[aria-pressed]", 4); await page.clickNth("li > button[aria-pressed]", 11, { shift: true }); });
    } },
    { name: "review", hash: at(c.main, "review"), actions: async (page, act) => {
      await act("filter All", async () => { await page.chip("All"); });
      await act("next and previous picture", async () => { await page.key("ArrowRight"); await page.key("k"); await page.key("ArrowLeft"); await page.key("j"); });
      await act("hold Space for the render", async () => { await page.hold(" "); await page.wait(300); await page.release(" "); });
      await act("revision note opens and closes", async () => { await page.key("v"); if (!(await page.waitFor("document.activeElement.tagName === 'TEXTAREA'", 3000))) throw new Error("no note field"); await page.type("Keep the sky softer"); await page.key("Escape"); });
      await act("full size and back", async () => { await page.key("f"); await page.wait(500); await page.key("Escape"); });
      await act("grid view and back", async () => { await page.key("g"); if (!(await page.waitFor(`[...document.querySelectorAll("[aria-pressed=true],[aria-checked=true]")].some((e) => e.innerText.trim() === "Grid")`, 3000))) throw new Error("no grid"); await page.key("g"); });
      await act("approve one with A", async () => { await page.chip("To decide"); await page.key("a"); await page.wait(800); });
    } },
    { name: "masters", hash: at(c.main, "masters"), actions: async (page, act) => {
      await act("open full size and close", async () => { await page.clickNth("li > button", 0); await page.wait(200); await page.dblclickNth("li > button", 0); await page.wait(600); const open = await page.evaluate("document.querySelectorAll('dialog[open]').length"); await page.key("Escape"); if (!open) throw new Error("no full size view"); });
    } },
    { name: "storyboard", hash: at(c.main, "storyboard"), actions: async (page, act) => {
      await act("pick a shot", async () => { await page.clickNth("[data-shot]", 2); });
      await act("move a shot with Alt and arrows", async () => { await page.focusNth("[data-shot]", 1); await page.key("ArrowRight", { alt: true }); await page.wait(800); await page.focusNth("[data-shot]", 2); await page.key("ArrowLeft", { alt: true }); await page.wait(800); });
      await act("drag a shot, and the order changes", async () => {
        const order = () => page.evaluate(`[...document.querySelectorAll("[data-shot]")].map((e) => e.dataset.shot).join()`);
        const before = await order();
        await page.dragNth("[data-shot]", 0, 260); await page.wait(1500);
        if ((await order()) === before) throw new Error("the order did not change");
        await page.dragNth("[data-shot]", 1, -260); await page.wait(1500);
      });
      await act("type in a field", async () => { await page.focusSelector("textarea"); await page.type(" slowly"); await page.key("Tab"); await page.wait(600); });
    } },
    { name: "film-preview", hash: at(c.main, "film"), actions: async (page, act) => {
      await act("play the preview for two seconds", async () => { await page.playVideo(2000); });
    } },
    { name: "film-done", hash: at(c.second, "film"), actions: async (page, act) => {
      await act("play the film for two seconds", async () => { await page.playVideo(2000); });
    } },
    { name: "big-renders", hash: at(c.big, "renders"), big: true, actions: async (page, act, out) => {
      await act("scroll the 200 renders", async () => { out.scroll = await page.scrollTest(); });
      await act("select all 200 (Cmd+A)", async () => { await page.clickNth("li > button[aria-pressed]", 0); await page.key("a", { meta: true }); await page.wait(400); });
    } },
    { name: "big-enhance", hash: at(c.big, "enhance"), big: true, actions: async (page, act, out) => {
      await act("scroll the 200 renders", async () => { out.scroll = await page.scrollTest(); });
      await act("select all not enhanced (200)", async () => { await page.click("Select all not enhanced"); await page.wait(600); });
    } },
    { name: "big-overview", hash: at(c.big, "overview"), big: true, actions: async (page, act, out) => {
      await act("scroll", async () => { out.scroll = await page.scrollTest(); });
      await act("type in the command palette", async () => { await page.key("k", { meta: true }); out.typing = await page.typeTest("View 150"); await page.key("Escape"); });
    } },
  ];
}

function r2fScreens(c) {
  return [
    { name: "stills", hash: "#stills", actions: async (page, act) => {
      await act("make a take (priced, stand-in door)", async () => { await page.makeTake("Blue hour"); });
      await act("compare with render", async () => { await page.click("Compare with render"); await page.wait(300); await page.click("Compare with render"); });
      await act("full size and back", async () => { await page.key("f"); await page.wait(500); await page.key("Escape"); });
      await act("star the take", async () => { await page.key("s"); await page.wait(500); await page.key("s"); await page.wait(500); });
      await act("type a direction", async () => { await page.focusLabel("Extra direction"); await page.type("Soft light"); });
    } },
    { name: "video", hash: "#video", actions: async () => {} },
    { name: "director", hash: "#director", actions: async (page, act) => {
      await act("open a frame and back", async () => { await page.clickText("Water and stone"); await page.wait(600); await page.key("Escape"); });
    } },
    { name: "closeups", hash: "#closeups", actions: async () => {} },
    { name: "location", hash: "#location", actions: async (page, act) => {
      await act("type coordinates", async () => { await page.focusLabel("Latitude"); await page.type("51.5"); await page.focusLabel("Longitude"); await page.type("-0.12"); });
    } },
    { name: "edit", hash: "#edit", actions: async (page, act) => {
      await act("pick a cut", async () => { await page.clickNth('[aria-label*="Locked off"]', 1); });
      await act("move a cut with Alt and arrows", async () => { await page.key("ArrowRight", { alt: true }); await page.wait(500); await page.key("ArrowLeft", { alt: true }); await page.wait(500); });
      await act("Look and Editor tabs", async () => { await page.click("Editor"); await page.wait(300); await page.click("Look"); });
      await act("play the timeline for two seconds", async () => { await page.click("Play the timeline"); await page.wait(2000); await page.key(" "); });
    } },
    { name: "library", hash: "#library", actions: async (page, act) => {
      await act("kind filter", async () => { await page.chip("Images"); await page.chip("Videos"); await page.chip("All"); });
      await act("favourites only", async () => { await page.chip("Favourites only"); await page.wait(300); await page.chip("Favourites only"); });
      await act("select three and compare", async () => { await page.click("Select Golden hour, 2K"); await page.click("Select Blue hour, 2K"); await page.click("Select Soft overcast, 2K"); await page.key("c"); await page.wait(800); await page.key("Escape"); });
      await act("open details and close", async () => { await page.key("Escape"); await page.click("Golden hour, 2K"); await page.wait(600); await page.key("Escape"); });
    } },
    { name: "favourites", hash: "#favourites", actions: async () => {} },
    { name: "history", hash: "#history", actions: async (page, act) => {
      await act("search", async () => { await page.focusSelector('input[type="search"], input'); await page.type("stone"); await page.wait(400); });
    } },
    { name: "palette-and-keys", hash: "#library", actions: async (page, act) => {
      await act("command palette: type and go", async () => { await page.key("k", { meta: true }); await page.type("Edit"); await page.wait(500); await page.key("Enter"); await page.wait(600); if (!(await page.evaluate("location.hash")).includes("edit")) throw new Error("not on Edit"); });
      await act("shortcuts sheet", async () => { await page.key("?", { shift: true }); await page.wait(300); await page.key("Escape"); });
    } },
    { name: "big-library", hash: "#library", big: true, actions: async (page, act, out) => {
      await act("scroll the 200 takes", async () => { out.scroll = await page.scrollTest(); });
      await act("type in search", async () => { await page.focusSelector('input[placeholder^="Search"]'); out.typing = await page.typeTest("golden"); });
      await act("small density", async () => { await page.clickNth('[role="radio"], [aria-pressed]', 0); });
    } },
    // The same Library opened again: its 200 thumbnails are made on first sight, then kept.
    { name: "big-library-again", hash: "#library", big: true, actions: async () => {} },
    { name: "big-history", hash: "#history", big: true, actions: async (page, act, out) => {
      await act("scroll", async () => { out.scroll = await page.scrollTest(); });
      await act("type in search", async () => { await page.focusSelector("input"); out.typing = await page.typeTest("Take 1"); });
    } },
  ];
}

// ---------------------------------------------------------------------------
// The page, with the sweep's own moves on top of take-stills' tab.

export function moves(page, sample) {
  const mark = (finder) => page.evaluate(`(() => { document.querySelectorAll("[data-sweep]").forEach((e) => e.removeAttribute("data-sweep"));
    const el = (${finder})(); if (el) el.setAttribute("data-sweep", "1"); return !!el; })()`);
  const nth = (selector, n) => `() => [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[${Number(n)}] || null`;
  const centre = async () => page.evaluate(`(() => { const el = document.querySelector("[data-sweep]"); el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const mouse = (type, x, y, extra = {}) => page.cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
  // Headless Chrome hides the tab when it is sent Escape (document.visibilityState turns
  // "hidden", painting and lazy pictures stop); the tab is brought back to the front after it,
  // and before each screen. Nothing of the apps does this.
  const key = page.key;
  const open = page.open;
  page.key = async (k, mods) => { await key(k, mods); if (k === "Escape") await page.cdp("Page.bringToFront"); };
  page.open = async (hash, o) => { await page.cdp("Page.bringToFront"); await open(hash, o); };
  Object.assign(page, {
    sample,
    async type(text) {
      for (const ch of text) await page.cdp("Input.insertText", { text: ch });
      await wait(150);
    },
    async clickText(text) {
      if (!(await mark(`() => [...document.querySelectorAll("button, a, [role=button], li, article, figure, div")].find((e) => e.children.length < 6 && e.innerText && e.innerText.trim().split("\\n")[0] === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 0)`))) throw new Error(`nothing says "${text}"`);
      const at = await centre();
      await mouse("mouseMoved", at.x, at.y); await mouse("mousePressed", at.x, at.y, { clickCount: 1, buttons: 1 }); await mouse("mouseReleased", at.x, at.y, { clickCount: 1 });
      await wait(250);
    },
    // A filter chip or toggle by its word ("All", "Not enhanced"), never a link in the side bar.
    async chip(word) {
      const ok = await mark(`() => [...document.querySelectorAll('[role=radio], [role=tab], [aria-pressed], [role=checkbox], [role=switch], button, label')]
        .filter((e) => e.tagName !== "A" && !e.closest("nav, [role=navigation]") && e.getBoundingClientRect().width > 0)
        .find((e) => { const t = (e.innerText || e.getAttribute("aria-label") || "").split(String.fromCharCode(10)).join(" ").trim(); const w = ${JSON.stringify(word)}; return t === w || (t.startsWith(w + " ") && "0123456789".includes(t.charAt(w.length + 1))); })`);
      if (!ok) throw new Error(`no chip "${word}"`);
      const at = await centre();
      await mouse("mouseMoved", at.x, at.y); await mouse("mousePressed", at.x, at.y, { clickCount: 1, buttons: 1 }); await mouse("mouseReleased", at.x, at.y, { clickCount: 1 });
      await wait(300);
    },
    async dblclickNth(selector, n) {
      if (!(await mark(nth(selector, n)))) throw new Error(`no ${selector}`);
      const at = await centre();
      for (const clickCount of [1, 2]) { await mouse("mousePressed", at.x, at.y, { clickCount, buttons: 1 }); await mouse("mouseReleased", at.x, at.y, { clickCount }); }
      await wait(250);
    },
    async focusNth(selector, n) {
      if (!(await mark(nth(selector, n)))) throw new Error(`no ${selector} ${n}`);
      await page.evaluate(`document.querySelector("[data-sweep]").focus()`);
    },
    async focusSelector(selector) {
      if (!(await mark(nth(selector, 0)))) throw new Error(`no ${selector}`);
      const at = await centre();
      await mouse("mousePressed", at.x, at.y, { clickCount: 1, buttons: 1 }); await mouse("mouseReleased", at.x, at.y, { clickCount: 1 });
      await wait(150);
    },
    async focusLabel(label) {
      const ok = await page.evaluate(`(() => { const l = [...document.querySelectorAll("label")].find((x) => x.innerText.trim().startsWith(${JSON.stringify(label)}));
        const id = l && l.getAttribute("for"); const el = id ? document.getElementById(id) : l && l.parentElement.querySelector("input, textarea");
        if (!el) return false; el.focus(); return true; })()`);
      if (!ok) throw new Error(`no field ${label}`);
    },
    async upload(selector, file) {
      const { root } = await page.cdp("DOM.getDocument", { depth: 0 });
      const { nodeId } = await page.cdp("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`no ${selector}`);
      await page.cdp("DOM.setFileInputFiles", { nodeId, files: [file] });
    },
    // A pointer drag of the n-th element by dx pixels, in small steps.
    async dragNth(selector, n, dx) {
      if (!(await mark(nth(selector, n)))) throw new Error(`no ${selector} ${n}`);
      const at = await centre();
      await mouse("mouseMoved", at.x, at.y);
      await mouse("mousePressed", at.x, at.y, { clickCount: 1, buttons: 1 });
      for (let i = 1; i <= 12; i += 1) { await mouse("mouseMoved", at.x + (dx * i) / 12, at.y, { buttons: 1 }); await wait(16); }
      await mouse("mouseReleased", at.x + dx, at.y, { clickCount: 1 });
    },
    async playVideo(ms) {
      const ok = await page.evaluate(`(async () => { const v = [...document.querySelectorAll("video")].find((x) => x.getBoundingClientRect().width > 0); if (!v) return "no video"; v.muted = true; try { await v.play(); } catch (e) { return "play: " + e.message; } return true; })()`);
      if (ok !== true) throw new Error(String(ok));
      await wait(ms);
      const state = await page.evaluate(`(() => { const v = [...document.querySelectorAll("video")].find((x) => x.getBoundingClientRect().width > 0); const s = { t: v.currentTime, err: v.error && v.error.code }; v.pause(); return s; })()`);
      if (state.err || !(state.t > 0.5)) throw new Error(`the video did not play (${JSON.stringify(state)})`);
    },
    async makeTake(look) {
      await page.evaluate(`(() => { document.querySelectorAll("[data-sweep]").forEach((e) => e.removeAttribute("data-sweep"));
        const l = [...document.querySelectorAll("label")].find((x) => x.innerText.trim().startsWith("Cinematic look"));
        let box = l; while (box && !box.querySelector("button")) box = box.parentElement; box.querySelector("button").setAttribute("data-sweep", "1"); })()`);
      let at = await centre();
      await mouse("mousePressed", at.x, at.y, { clickCount: 1, buttons: 1 }); await mouse("mouseReleased", at.x, at.y, { clickCount: 1 }); await wait(300);
      if (!(await mark(`() => [...document.querySelectorAll('[role="option"]')].find((e) => e.innerText.trim().split("\\n")[0] === ${JSON.stringify(look)})`))) throw new Error(`no look ${look}`);
      at = await centre();
      await mouse("mousePressed", at.x, at.y, { clickCount: 1, buttons: 1 }); await mouse("mouseReleased", at.x, at.y, { clickCount: 1 }); await wait(300);
      const before = await page.evaluate(`document.querySelectorAll('[aria-label$=", ready"]').length`);
      const label = await page.evaluate(`([...document.querySelectorAll("button")].find((b) => ["Make it cinematic", "Make another take"].includes(b.innerText.trim())) || {}).innerText`);
      if (!label) throw new Error("no priced button");
      await page.click(label.trim());
      if (!(await page.waitFor(`document.querySelectorAll('[aria-label$=", ready"]').length > ${before}`, 120_000))) throw new Error("the take did not land");
    },
    // Scrolls the tallest scroller to the end and back, one step a frame; frames over 50 ms.
    async scrollTest() {
      return page.evaluate(`(async () => {
        const all = [document.scrollingElement, ...document.querySelectorAll("*")].filter((e) => e && e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) || e === document.scrollingElement);
        const el = all.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        const longBefore = window.__sweep.long.length;
        const frames = [];
        let last = performance.now();
        const height = el.scrollHeight - el.clientHeight;
        for (let i = 0; i <= 60; i += 1) {
          el.scrollTop = (height * (i <= 30 ? i : 60 - i)) / 30;
          await new Promise((r) => requestAnimationFrame(() => r()));
          const now = performance.now(); frames.push(now - last); last = now;
        }
        frames.shift();
        const slow = frames.filter((f) => f > 50);
        return { height: el.scrollHeight, frames: frames.length, slowFrames: slow.length, worstFrameMs: Math.round(Math.max(...frames)), longTasks: window.__sweep.long.length - longBefore };
      })()`);
    },
    // Types one key at a time and measures each key to its next paint.
    async typeTest(text) {
      const per = [];
      for (const ch of text) {
        const t0 = Date.now();
        await page.cdp("Input.insertText", { text: ch });
        await page.evaluate("new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))");
        per.push(Date.now() - t0);
      }
      return { keys: per.length, worstKeyMs: Math.max(...per), averageKeyMs: Math.round(per.reduce((a, b) => a + b, 0) / per.length) };
    },
  });
  return page;
}

// ---------------------------------------------------------------------------

async function sweepApp({ slug, out, pictures, log = console.log }) {
  const shots = await import(slug === "arch-film-studio" ? "./shots-afs.mjs" : "./shots-r2f.mjs");
  let stage = null;
  let session = null;
  let proxy = null;
  const report = { app: slug, at: new Date().toISOString(), bundle: bundleOf(slug), screens: [] };
  try {
    stage = await startStage({ slug, port: STAGE_PORTS[slug], pictures });
    log(`${slug}: seeding`);
    const ctx = await shots.seed(stage, pictures, log);
    // No work left running: the page's polling must come to rest.
    stage.door.releaseAll();
    if (slug === "arch-film-studio") {
      for (let i = 0; i < 60; i += 1) {
        const p = await stage.query("project.get", { id: ctx.main });
        if (!p.storyboard.shots.some((s) => ["queued", "running"].includes(s.video?.state))) break;
        await wait(1000);
      }
      ctx.big = await bigAfs(stage, pictures, log);
    }
    const blocked = [];
    proxy = await startStageProxy({ sitePort: stage.port, onBlocked: (to, how) => blocked.push(`${how} ${to}`) });
    const croot = join(stage.root, "chrome-sweep");
    mkdirSync(croot, { mode: 0o700 });
    prepareRoot(croot);
    session = await startChrome({ program: CHROME_PATH, root: croot, proxyPort: proxy.port, launch: defaultLaunch, limits: { memCapKb: 6 * 1024 * 1024 } });
    let page = moves(await openTab(session, stage.url, { scripts: [WATCHERS] }), pictures.sets[0].render);
    const screens = slug === "arch-film-studio" ? afsScreens(ctx) : r2fScreens(ctx);
    let bigDone = false;
    for (const screen of screens) {
      if (screen.big && !bigDone && slug === "render-to-film") {
        await bigR2f(stage, ctx, log);
        bigDone = true;
        // A tab left idle through minutes of seeding can be frozen by Chrome: a fresh one.
        await page.close();
        page = moves(await openTab(session, stage.url, { scripts: [WATCHERS] }), pictures.sets[0].render);
      }
      const failedBefore = page.failed.length;
      const errorsBefore = page.errors.length;
      const refusedBefore = blocked.length;
      const entry = { name: screen.name, hash: screen.hash, actions: [] };
      await page.open(screen.hash, { clearStorage: screen.name === "projects" });
      const ready = await page.evaluate("window.__sweepReady()");
      const load = await page.evaluate(`({ fcp: Math.round((performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0), long: window.__sweep.long.slice(), bytes: window.__sweep.requests.reduce((s, r) => s + r.bytes, 0), scripts: window.__sweep.requests.filter((r) => r.kind === "script").map((r) => r.url) })`);
      entry.readyMs = ready;
      entry.fcpMs = load.fcp;
      entry.loadLongTasks = load.long.length;
      entry.loadWorstTaskMs = load.long.reduce((m, t) => Math.max(m, t.ms), 0);
      entry.loadBytes = load.bytes;
      entry.clipped = await page.evaluate(CLIPPED);
      const act = async (name, fn) => {
        const t0 = Date.now();
        try { await fn(); entry.actions.push({ name, ok: true, ms: Date.now() - t0 }); }
        catch (err) { entry.actions.push({ name, ok: false, why: String(err?.message || err).slice(0, 300) }); }
      };
      await screen.actions(page, act, entry);
      // Idle: the requests the page makes on its own with nothing running.
      const idleFrom = await page.evaluate("performance.now()");
      await wait(IDLE_MS);
      const s = await page.evaluate(`(() => { const S = window.__sweep; return { console: S.console, errors: S.errors, long: S.long, events: S.events, idle: S.requests.filter((r) => r.at >= ${idleFrom}).map((r) => r.url) }; })()`);
      entry.consoleErrors = s.console.filter((x) => x.kind === "error").map((x) => x.text);
      entry.consoleWarnings = s.console.filter((x) => x.kind === "warn").map((x) => x.text);
      entry.exceptions = [...s.errors, ...page.errors.slice(errorsBefore)];
      entry.failedRequests = page.failed.slice(failedBefore).filter((f) => f.url !== "/favicon.ico").map((f) => `${f.why} ${f.url || ""}`.trim());
      entry.proxyRefused = blocked.slice(refusedBefore);
      entry.policyViolations = (await page.violations()).length;
      entry.longTasks = s.long.length;
      entry.worstTaskMs = s.long.reduce((m, t) => Math.max(m, t.ms), 0);
      entry.worstInputMs = s.events.reduce((m, e) => Math.max(m, e.ms), 0);
      entry.slowInputs = s.events.filter((e) => e.ms >= 100).sort((a, b) => b.ms - a.ms).slice(0, 6);
      entry.idleRequests = s.idle.length;
      entry.idleRequestUrls = [...new Set(s.idle)].slice(0, 6);
      report.screens.push(entry);
      const bad = entry.actions.filter((a) => !a.ok).map((a) => a.name);
      log(`  ${screen.name}: ready ${entry.readyMs} ms, fcp ${entry.fcpMs} ms, long tasks ${entry.longTasks} (worst ${entry.worstTaskMs} ms), errors ${entry.consoleErrors.length + entry.exceptions.length}, warnings ${entry.consoleWarnings.length}, failed ${entry.failedRequests.length}, csp ${entry.policyViolations}, idle requests ${entry.idleRequests}${bad.length ? `, FAILED: ${bad.join("; ")}` : ""}`);
    }
    await page.close();
  } catch (err) {
    report.stoppedEarly = String(err?.stack || err).slice(0, 2000);
    log(`${slug}: stopped early: ${report.stoppedEarly}`);
  } finally {
    if (session) await session.end().catch(() => {});
    if (proxy) await proxy.close();
    if (stage) await stage.stop();
  }
  writeFileSync(join(out, `${slug}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, `${slug}.md`), table(report));
  return report;
}

// The built bundle: each file of dist/assets and its size.
function bundleOf(slug) {
  const dir = join(REPO, "apps", slug, "dist", "assets");
  return readdirSync(dir).map((f) => ({ file: f, kb: Math.round(statSync(join(dir, f)).size / 1024) }));
}

function table(r) {
  const rows = r.screens.map((s) => `| ${s.name} | ${s.readyMs ?? "never"} | ${s.fcpMs} | ${s.longTasks} | ${s.worstTaskMs} | ${s.worstInputMs} | ${s.consoleErrors.length + s.exceptions.length} | ${s.consoleWarnings.length} | ${s.failedRequests.length} | ${s.policyViolations} | ${s.idleRequests} | ${s.scroll ? `${s.scroll.slowFrames}/${s.scroll.frames}, worst ${s.scroll.worstFrameMs}` : ""} | ${s.typing ? `worst ${s.typing.worstKeyMs}, avg ${s.typing.averageKeyMs}` : ""} | ${s.actions.filter((a) => !a.ok).map((a) => `${a.name}: ${a.why}`).join("; ").replace(/\|/g, "/")} |`);
  return [`# ${r.app}, ${r.at}`, "", r.stoppedEarly ? `Stopped early: ${r.stoppedEarly}\n` : "",
    "| screen | ready ms | fcp ms | long tasks | worst task ms | worst input ms | errors | warnings | failed requests | csp | idle requests (8 s) | scroll slow frames | typing ms | failed actions |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|", ...rows, "",
    "Details per screen (console text, clipped labels, idle request addresses) are in the JSON.", ""].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const app = args[args.indexOf("--app") + 1];
  const out = resolve(args[args.indexOf("--out") + 1]);
  if (!app || !out || args.indexOf("--app") < 0 || args.indexOf("--out") < 0) { console.error("usage: sweep.mjs --app <slug>|all --out <dir>"); process.exit(2); }
  if (!chromeInstalled(CHROME_PATH)) { console.error(`Chrome is not installed at ${CHROME_PATH}`); process.exit(1); }
  mkdirSync(out, { recursive: true });
  const picsDir = mkdtempSync("/private/tmp/uuu-stage-pictures-");
  let bad = 0;
  try {
    const pictures = await makePictures({ from: null, into: picsDir });
    for (const slug of app === "all" ? Object.keys(STAGE_PORTS) : [app]) {
      const r = await sweepApp({ slug, out, pictures });
      if (r.stoppedEarly) bad += 1;
      for (const s of r.screens) bad += s.consoleErrors.length + s.exceptions.length + s.failedRequests.length + s.policyViolations + s.actions.filter((a) => !a.ok).length;
    }
  } finally {
    rmSync(picsDir, { recursive: true, force: true });
  }
  console.log(bad ? `${bad} problems` : "no problems");
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
