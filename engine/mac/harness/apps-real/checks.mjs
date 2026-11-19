// The checks of the real-apps run (PLAN-DESKTOP T2): for each app, one load of the test home's App Studio page per
// check, the steps the runner (runner/main.swift) takes in it, and how its report is judged. A verdict is `works`,
// `breaks` or `looks wrong`, with the facts it rests on; `hand check` is a row only a person can settle (a drag from
// Finder, a pick in a real open panel) and is left to the orchestrator in a development build.
// The rows are the plan's nine items; item 1 and item 9 also use webkit-probe's own reports (run.mjs).

export const ALLOW_SENTENCE = "Allow spending in the bar above.";

// Script pieces run inside a page.
const DIALOGS = `[...document.querySelectorAll('[role=dialog],dialog[open],[role=alertdialog]')].filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; })`;
const dialogs = (as) => ({ do: "js", in: "frame", as, body: `return ${DIALOGS}.map((d) => (d.getAttribute('aria-label') || d.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80))` });
const go = (hash, wait = 2500) => [{ do: "js", in: "frame", body: `location.hash = ${JSON.stringify(hash)}; return 1` }, { do: "wait", ms: wait }];
const ready = [{ do: "waitFor", in: "frame", body: "document.querySelector('nav')", ms: 30000, as: "frameReady" }, { do: "wait", ms: 1500 }];
const homeDialog = (as) => ({ do: "js", in: "top", as, body: "return { cmd: !!document.querySelector('.s-cmd'), compose: !!document.querySelector('.k-dialog__panel') }" });
const focusWhere = (as) => ({ do: "js", in: "top", as, body: "const a = document.activeElement; return { top: a ? a.tagName : null, label: a ? (a.getAttribute('aria-label') || a.innerText || '').trim().slice(0, 40) : null }" });
const frameFocus = (as) => ({ do: "js", in: "frame", as, body: "const a = document.activeElement; return a ? a.tagName + ':' + (a.getAttribute('aria-label') || a.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40) : null" });
// Marks the first plain text on screen (a text node of 20 characters or more, not in a control) for a click.
const markText = (where = "frame") => ({ do: "js", in: where, as: "marked", body: `document.querySelectorAll('[data-ar-pick]').forEach((e) => e.removeAttribute('data-ar-pick'));
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const el = t.parentElement;
    if (!el || t.textContent.trim().length < 20 || el.closest('button,a,input,textarea,select,label,[role=button],[role=dialog],dialog,nav,[aria-hidden=true]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8 || r.top < 0 || r.bottom > innerHeight) continue;
    const hit = document.elementFromPoint(r.left + 6, r.top + r.height / 2);
    if (hit !== el && !el.contains(hit)) continue;
    el.setAttribute('data-ar-pick', '1');
    return t.textContent.trim().slice(0, 40);
  }
  return null;` });
// A click on the app's own top edge, away from any control: the focus goes into the frame, at its start.
const intoFrame = { do: "click", in: "frame", selector: "body", fx: 0.5, fy: 0.004, as: "clickFrame" };
const shot = (dir, name) => ({ do: "snapshot", path: `${dir}/${name}.png`, as: `shot:${name}` });
// A video's state: playing, where, sound, size and whether it is drawn inline.
const VIDEO = (sel) => `const v = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((x) => x.getBoundingClientRect().width > 0).pop();
  if (!v) return null;
  const r = v.getBoundingClientRect();
  return { paused: v.paused, t: Math.round(v.currentTime * 100) / 100, duration: v.duration, muted: v.muted, volume: v.volume, readyState: v.readyState,
    error: v.error ? v.error.code : null, audio: (v.webkitAudioDecodedByteCount || 0), video: (v.webkitVideoDecodedByteCount || 0),
    inline: r.width > 0 && r.width < innerWidth + 1, w: Math.round(r.width), fs: !!(document.fullscreenElement || document.webkitFullscreenElement) };`;
// A button put on the page by the check, which asks for the video's full screen when it is really clicked (a user
// gesture), as the player's own full-screen control would.
const FS_BUTTON = (sel) => `const v = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((x) => x.getBoundingClientRect().width > 0).pop();
  if (!v) return false;
  const b = document.createElement('button');
  b.id = 'apps-real-fs'; b.textContent = 'full screen';
  b.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647;width:120px;height:40px';
  window.__fs = null; window.__fsLog = [];
  for (const t of ['fullscreenchange', 'webkitfullscreenchange', 'fullscreenerror', 'webkitfullscreenerror']) document.addEventListener(t, () => window.__fsLog.push(t + ':' + !!(document.fullscreenElement || document.webkitFullscreenElement) + '@' + Math.round(performance.now())));
  b.addEventListener('click', () => {
    const go = v.requestFullscreen ? v.requestFullscreen() : (v.webkitRequestFullscreen ? v.webkitRequestFullscreen() : null);
    if (go && go.then) go.then(() => { window.__fs = 'entered'; }, (e) => { window.__fs = 'refused: ' + e.name + ' ' + e.message; });
    else if (v.webkitEnterFullscreen) { try { v.webkitEnterFullscreen(); window.__fs = 'entered (video)'; } catch (e) { window.__fs = 'refused: ' + e.message; } }
  });
  (v.closest('dialog,[role=dialog]') || document.body).appendChild(b);
  return true;`;
// Every button that names a price or a known spending action, and whether it is off; the allowance sentence anywhere
// on the page, in its words or in a title, tooltip or description.
const SPEND = `const words = (e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\\s+/g, ' ');
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const off = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true';
  const spend = [...document.querySelectorAll('button')].filter(vis).filter((b) => /\\$\\d|Make it cinematic|Make another take|^Shoot|^Make \\d|^Make clip|^Reshoot|^Make a video|^Enhance|^Make master|^Make revised|^Animate this|^Make the clip|^Upscale/i.test(words(b)));
  const all = document.documentElement.outerHTML;
  return { sentence: all.includes(${JSON.stringify(ALLOW_SENTENCE)}), buttons: spend.map((b) => ({ words: words(b).slice(0, 60), off: off(b) })) };`;

const HOME_KEYS = [
  { do: "click", in: "top", selector: ".p-app__who", as: "clickHome" },
  focusWhere("focusHome"),
  { do: "key", key: "k", mods: ["cmd"] }, { do: "wait", ms: 600 }, homeDialog("homeCmdK"),
  { do: "key", key: "Escape" }, { do: "wait", ms: 500 }, homeDialog("homeCmdKClosed"),
  { do: "key", key: "c" }, { do: "wait", ms: 600 }, homeDialog("homeC"),
];

// The keys inside the frame: Cmd+K, ? and Escape after a click on the app's own heading.
const frameKeys = (dir, slug, palette) => [
  intoFrame,
  focusWhere("focusAfterClick"),
  { do: "key", key: "k", mods: ["cmd"] }, { do: "wait", ms: 700 },
  homeDialog("cmdKHome"), dialogs("cmdKFrame"),
  { do: "js", in: "frame", as: "paletteField", body: `return !!document.querySelector(${JSON.stringify(palette)})` },
  shot(dir, `${slug}-frame-cmdk`),
  { do: "key", key: "Escape" }, { do: "wait", ms: 500 }, dialogs("afterEsc1"),
  { do: "key", key: "?", mods: ["shift"] }, { do: "wait", ms: 600 }, dialogs("question"),
  shot(dir, `${slug}-frame-shortcuts`),
  { do: "key", key: "Escape" }, { do: "wait", ms: 500 }, dialogs("afterEsc2"),
  homeDialog("homeAfter"),
];

// Tab from the app's heading until the focus leaves the frame (at most `n` presses).
function tabSteps(n) {
  // The focus put on the app's first control by script, so every Tab after it is counted from the start.
  const out = [intoFrame, { do: "js", in: "frame", as: "start", body: "const f = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex=\"-1\"])')].find((e) => !e.disabled); if (f) f.focus(); return f ? (f.getAttribute('aria-label') || f.innerText).trim().slice(0, 30) : null" }];
  for (let i = 0; i < n; i++) out.push({ do: "key", key: "Tab" }, focusWhere(`top${i}`), frameFocus(`frame${i}`));
  return out;
}
function judgeTab(r, n, ctx = {}) {
  const trail = [];
  let left = null;
  for (let i = 0; i < n; i++) {
    const t = r[`top${i}`];
    if (!t) break;
    if (t.top !== "IFRAME") { left = { at: i + 1, to: `${t.top} ${t.label || ""}`.trim() }; break; }
    trail.push(r[`frame${i}`]);
  }
  const distinct = new Set(trail).size;
  if (left && distinct >= 3) return ["works", `Tab moved through ${distinct} of the app's controls, then left the frame at press ${left.at} to the home page (${left.to})`];
  if (left && ctx.keyboardUIMode === 0 && distinct < 5) {
    return ["looks wrong", `from the app's first control Tab reached ${distinct} control(s) (${trail.slice(0, 5).join(" | ")}), then left the frame at press ${left.at} (to ${left.to}); `
      + `this Mac's Keyboard navigation setting is ${ctx.keyboardUIMode === 0 ? "off (AppleKeyboardUIMode 0)" : `AppleKeyboardUIMode ${ctx.keyboardUIMode}`}, and WebKit then moves Tab only between text fields, lists and elements with their own tabindex, as Safari does (the app's links and most of its buttons are skipped); the web view sets no tabFocusesLinks. The same holds for the home pages`];
  }
  if (left) return ["looks wrong", `the focus left the frame after ${left.at} presses having visited ${distinct} controls (${trail.slice(0, 5).join(" | ")})`];
  return ["looks wrong", `after ${n} presses the focus was still in the frame (${distinct} controls visited); last: ${trail.slice(-3).join(" | ")}`];
}

const own = (rep) => Object.entries(rep.byOrigin || {}).filter(([o]) => /:(3188|3189)$/.test(o)).map(([, v]) => v)[0] || {};
const homeOwn = (rep) => Object.entries(rep.byOrigin || {}).filter(([o]) => !/:(3188|3189)$/.test(o)).map(([, v]) => v)[0] || {};
const n = (x) => (Array.isArray(x) ? x.length : 0);

// One check per row. `steps(ctx)` -> steps; `judge(report, ctx)` -> [verdict, words]; `where` names the side a fault
// would be on when the row is not `works`.
export function checksFor(slug, ctx) {
  const dir = ctx.picDir;
  const R2F = slug === "render-to-film";
  const made = ctx.made[slug] || {};
  const at = (screen, project = made.main) => (R2F ? screen : `#/p/${project}/${screen}`);
  const palette = R2F ? 'input[placeholder^="Jump to"], input[aria-label^="Jump to"]' : 'input[aria-label="Search commands"], input[placeholder^="Search"]';
  const rows = [];

  rows.push({
    id: "1-frame-draws", item: 1, where: "app",
    steps: () => [...ready, { do: "wait", ms: 2000 }, { do: "js", in: "frame", as: "frame", body: "return { images: document.images.length, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 5), text: document.body.innerText.length }" }],
    judge: (r) => {
      const f = own(r);
      const h = homeOwn(r);
      const fr = r.results.frame || {};
      const bad = [...(f.console || []).map((x) => `app console: ${x}`), ...(f.csp || []).map((x) => `app policy: ${x}`), ...(f.failed || []).map((x) => `app failed: ${x}`),
        ...(h.console || []).map((x) => `home console: ${x}`), ...(h.csp || []).map((x) => `home policy: ${x}`), ...(h.failed || []).map((x) => `home failed: ${x}`),
        ...(fr.broken || []).map((x) => `app broken image: ${x}`)];
      if (r.dropped) bad.push(`the guard dropped ${r.dropped} address(es)`);
      if (!r.results.frameReady || !(fr.text > 50)) return ["breaks", "the app's page did not draw in its frame"];
      return bad.length ? ["breaks", bad.slice(0, 6).join("; ")] : ["works", `the app drew (${fr.images} images, none broken); no console error, policy violation, failed request or dropped address in the app's frame or the home page`];
    },
  });

  rows.push({
    id: "2-keys-home", item: 2, where: "home",
    steps: () => [...ready, ...HOME_KEYS, shot(dir, `${slug}-home-compose`), { do: "key", key: "Escape" }],
    judge: (r) => {
      const x = r.results;
      const ok = x.homeCmdK?.cmd && x.homeCmdKClosed && !x.homeCmdKClosed.cmd && x.homeC?.compose;
      return ok ? ["works", "focus in the home page: Cmd+K opened the jump box, Escape closed it, c opened a new task"]
        : ["breaks", `Cmd+K ${x.homeCmdK?.cmd ? "opened" : "did not open"} the jump box; c ${x.homeC?.compose ? "opened" : "did not open"} a new task (focus: ${JSON.stringify(x.focusHome)})`];
    },
  });

  rows.push({
    id: "3-keys-frame", item: 3, where: "app",
    steps: () => [...ready, ...frameKeys(dir, slug, palette)],
    judge: (r) => {
      const x = r.results;
      const inFrame = x.focusAfterClick?.top === "IFRAME";
      const appPalette = n(x.cmdKFrame) > 0 && x.paletteField;
      const words = `focus ${inFrame ? "in the frame" : `in ${x.focusAfterClick?.top}`}; Cmd+K opened ${appPalette ? "the app's own palette" : "nothing in the app"}${x.cmdKHome?.cmd ? " AND the home page's jump box" : ", the home page's jump box stayed shut"}; Escape ${n(x.afterEsc1) === 0 ? "closed it" : "left it open"}; ? opened ${n(x.question) ? `"${x.question[0].slice(0, 30)}"` : "nothing"}; Escape ${n(x.afterEsc2) === 0 ? "closed it" : "left it open"}`;
      const ok = inFrame && appPalette && !x.cmdKHome?.cmd && n(x.afterEsc1) === 0 && n(x.question) > 0 && n(x.afterEsc2) === 0;
      return [ok ? "works" : "breaks", words];
    },
  });

  const TABS = 120;
  rows.push({
    id: "3-tab", item: 3,
    steps: () => [...ready, ...go(R2F ? "history" : "#/"), ...tabSteps(TABS)],
    judge: (r) => judgeTab(r.results, TABS, ctx),
    where: "mac",
  });

  if (R2F) {
    rows.push({
      id: "3-lightbox-keys", item: 3, where: "app",
      steps: () => [...ready, ...go("library"),
        { do: "waitFor", in: "frame", body: "document.querySelectorAll('button[aria-label^=\"Select \"]').length > 3", ms: 15000 },
        { do: "click", in: "frame", selector: "button", text: "Golden hour, 2K", as: "pick" }, { do: "wait", ms: 600 },
        { do: "key", key: "f" }, { do: "wait", ms: 900 }, dialogs("open"),
        { do: "js", in: "frame", as: "cap0", body: `return ${DIALOGS}.map((d) => d.innerText.trim().slice(0, 80) + '|' + ([...d.querySelectorAll('img,video')].map((m) => m.currentSrc || m.src).join(',')).slice(-80)).join(' / ')` },
        shot(dir, `${slug}-lightbox`),
        { do: "key", key: "ArrowRight" }, { do: "wait", ms: 700 },
        { do: "js", in: "frame", as: "cap1", body: `return ${DIALOGS}.map((d) => d.innerText.trim().slice(0, 80) + '|' + ([...d.querySelectorAll('img,video')].map((m) => m.currentSrc || m.src).join(',')).slice(-80)).join(' / ')` },
        { do: "key", key: "ArrowLeft" }, { do: "wait", ms: 700 },
        { do: "js", in: "frame", as: "cap2", body: `return ${DIALOGS}.map((d) => d.innerText.trim().slice(0, 80) + '|' + ([...d.querySelectorAll('img,video')].map((m) => m.currentSrc || m.src).join(',')).slice(-80)).join(' / ')` },
        { do: "key", key: "Escape" }, { do: "wait", ms: 600 }, dialogs("closed"),
      ],
      judge: (r) => {
        const x = r.results;
        if (!n(x.open)) return ["breaks", "F on a picture did not open the lightbox"];
        const src = (c) => String(c || "").split("|").pop();
        const moved = src(x.cap1) && src(x.cap1) !== src(x.cap0);
        const back = src(x.cap2) === src(x.cap0);
        const shut = n(x.closed) === 0;
        return [moved && back && shut ? "works" : "breaks", `lightbox opened; ArrowRight ${moved ? "moved to the next picture" : "did nothing"}; ArrowLeft ${back ? "came back" : "did not come back"}; Escape ${shut ? "closed it" : "left it open"}`];
      },
    });
  } else {
    rows.push({
      id: "3-lightbox-keys", item: 3, where: "app",
      steps: () => [...ready, ...go(at("review")),
        { do: "waitFor", in: "frame", body: "document.querySelector('input[type=range][aria-label^=\"Compare \"]')", ms: 15000 },
        intoFrame,
        { do: "js", in: "frame", as: "pic0", body: "return [...document.querySelectorAll('[aria-current=true],[aria-pressed=true],[aria-selected=true]')].map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40)).join(' / ') + ' # ' + (document.querySelector('input[type=range][aria-label^=\"Compare \"]') || {}).getAttribute?.('aria-label')" },
        { do: "key", key: "ArrowRight" }, { do: "wait", ms: 700 },
        { do: "js", in: "frame", as: "pic1", body: "return [...document.querySelectorAll('[aria-current=true],[aria-pressed=true],[aria-selected=true]')].map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40)).join(' / ') + ' # ' + (document.querySelector('input[type=range][aria-label^=\"Compare \"]') || {}).getAttribute?.('aria-label')" },
        { do: "key", key: "ArrowLeft" }, { do: "wait", ms: 700 },
        { do: "js", in: "frame", as: "pic2", body: "return [...document.querySelectorAll('[aria-current=true],[aria-pressed=true],[aria-selected=true]')].map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40)).join(' / ') + ' # ' + (document.querySelector('input[type=range][aria-label^=\"Compare \"]') || {}).getAttribute?.('aria-label')" },
        { do: "click", in: "frame", selector: "button", text: "Open full size", as: "openFull" }, { do: "wait", ms: 900 }, dialogs("open"),
        shot(dir, `${slug}-lightbox`),
        { do: "key", key: "Escape" }, { do: "wait", ms: 600 }, dialogs("closed"),
      ],
      judge: (r) => {
        const x = r.results;
        const moved = x.pic1 && x.pic1 !== x.pic0;
        const back = x.pic2 === x.pic0;
        const ok = moved && back && n(x.open) > 0 && n(x.closed) === 0;
        return [ok ? "works" : "breaks", `Review: ArrowRight ${moved ? "moved to the next picture" : "did nothing"} (${String(x.pic0).slice(0, 60)} -> ${String(x.pic1).slice(0, 60)}); ArrowLeft ${back ? "came back" : "did not come back"}; Open full size ${n(x.open) ? "opened the lightbox" : "opened nothing"}; Escape ${n(x.closed) === 0 ? "closed it" : "left it open"}`];
      },
    });
  }

  // The film player: a clip plays inline, sound off and on, seeks, full screen and back, keys while it plays.
  const vsel = R2F ? "[role=dialog] video, dialog video, video" : "video";
  rows.push({
    id: "4-video", item: 4, where: "app",
    steps: () => [...ready,
      ...(R2F
        ? [...go("library"), { do: "waitFor", in: "frame", body: "document.querySelectorAll('button[aria-label^=\"Select \"]').length > 3", ms: 15000 },
          { do: "click", in: "frame", selector: "button", text: "Videos" }, { do: "wait", ms: 800 },
          { do: "click", in: "frame", selector: "button[aria-label]:not([aria-label^=\"Select \"]):not([aria-label$=\"favourites\"])", text: "Golden hour, Locked off, steady, slow, 1080p", as: "pickClip" }, { do: "wait", ms: 600 },
          { do: "key", key: "f" }, { do: "wait", ms: 1500 }, dialogs("player")]
        : [...go(at("film", made.second)), { do: "waitFor", in: "frame", body: "document.querySelector('video')", ms: 15000, as: "player" },
          { do: "click", in: "frame", selector: "button", text: "Play", as: "play" }]),
      { do: "wait", ms: 1500 },
      { do: "js", in: "frame", as: "auto", body: VIDEO(vsel) },
      ...(R2F ? [{ do: "js", in: "frame", as: "playedByClick", body: `const v = [...document.querySelectorAll(${JSON.stringify(vsel)})].filter((x) => x.getBoundingClientRect().width > 0).pop(); return v ? v.paused : null` },
        { do: "click", in: "frame", selector: vsel, as: "clickVideo" }] : []),
      { do: "wait", ms: 1800 },
      { do: "js", in: "frame", as: "v0", body: VIDEO(vsel) },
      { do: "js", in: "frame", as: "unmute", body: `const v = [...document.querySelectorAll(${JSON.stringify(vsel)})].filter((x) => x.getBoundingClientRect().width > 0).pop(); if (!v) return null; v.muted = false; v.volume = 0.05; if (v.paused) await v.play().catch(() => {}); await new Promise((r) => setTimeout(r, 1200)); return { muted: v.muted, paused: v.paused, audio: v.webkitAudioDecodedByteCount || 0 }` },
      { do: "js", in: "frame", as: "mute", body: `const v = [...document.querySelectorAll(${JSON.stringify(vsel)})].filter((x) => x.getBoundingClientRect().width > 0).pop(); if (!v) return null; v.muted = true; await new Promise((r) => setTimeout(r, 500)); return { muted: v.muted, paused: v.paused }` },
      { do: "js", in: "frame", as: "seek", body: `const v = [...document.querySelectorAll(${JSON.stringify(vsel)})].filter((x) => x.getBoundingClientRect().width > 0).pop(); if (!v) return null; v.pause(); v.currentTime = 0.5; await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 2000); }); const t = v.currentTime; v.currentTime = 2.0; await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 2000); }); return [Math.round(t * 100) / 100, Math.round(v.currentTime * 100) / 100]` },
      shot(dir, `${slug}-player`),
      { do: "js", in: "frame", as: "fsButton", body: FS_BUTTON(vsel) },
      { do: "click", in: "frame", selector: "#apps-real-fs", as: "fsClick" }, { do: "wait", ms: 300 },
      { do: "js", in: "frame", as: "fsSoon", body: "return { element: !!(document.fullscreenElement || document.webkitFullscreenElement), log: window.__fsLog }" },
      { do: "frameState", as: "fsStateSoon" }, { do: "wait", ms: 1200 },
      { do: "js", in: "frame", as: "fsIn", body: "return { asked: window.__fs, element: !!(document.fullscreenElement || document.webkitFullscreenElement), log: window.__fsLog }" },
      { do: "frameState", as: "fsState" },
      { do: "js", in: "frame", as: "fsOut", body: "const x = document.exitFullscreen ? document.exitFullscreen() : (document.webkitExitFullscreen && document.webkitExitFullscreen()); if (x && x.then) await x.catch(() => {}); await new Promise((r) => setTimeout(r, 1500)); return !(document.fullscreenElement || document.webkitFullscreenElement)" },
      { do: "frameState", as: "fsStateAfter" },
      { do: "js", in: "frame", body: "document.getElementById('apps-real-fs')?.remove(); return 1" },
      ...(R2F ? [{ do: "key", key: "Escape" }, { do: "wait", ms: 600 }, dialogs("closed")] : []),
    ],
    judge: (r) => {
      const x = r.results;
      const v = x.v0;
      if (!v) return ["breaks", "no clip was on screen"];
      const plays = v.t > 0.2 && !v.error;
      const inline = v.inline && !v.fs;
      const sound = x.unmute && x.unmute.muted === false && !x.unmute.paused;
      const muted = x.mute && x.mute.muted === true;
      const seeks = Array.isArray(x.seek) && Math.abs(x.seek[0] - 0.5) < 0.2 && Math.abs(x.seek[1] - 2) < 0.2;
      const fsIn = x.fsIn && x.fsIn.element;
      const fsOut = x.fsOut === true;
      const fsLog = (x.fsIn && x.fsIn.log) || [];
      const entered = fsLog.some((l) => /:true@/.test(l));
      const auto = !R2F ? "the player waits for Play" : x.auto ? (x.auto.paused ? "the clip did not start by itself" : "the clip started by itself") : "";
      const bits = [`${auto}${R2F ? "; a click on it" : "; Play"} -> plays inline ${plays && inline ? "yes" : "NO"} (t ${v.t}s, paused ${v.paused}, ${v.w}px wide)`, `sound on ${sound ? "yes (unmuted at volume 0.05 and still playing)" : "NO"}`, `sound off ${muted ? "yes" : "NO"}`,
        `seek ${seeks ? `yes (${x.seek.join(" then ")} s)` : `NO (${JSON.stringify(x.seek)})`}`];
      if (R2F) bits.push(`Escape ${n(x.closed) === 0 ? "closed the lightbox" : "left it open"}`);
      const ok = plays && inline && sound && muted && seeks && (!R2F || n(x.closed) === 0);
      const autoWrong = R2F && x.auto && x.auto.paused;
      const verdict = !ok ? "breaks" : autoWrong ? "looks wrong" : "works";
      const why = bits.join("; ") + (autoWrong ? ". The lightbox asks for autoplay (hasAutoPlay) with sound; in this web view the clip waits for a click" : "");
      const fs = fsIn && fsOut ? ["works", "full screen entered and left"]
        : entered ? ["hand check", `the frame's request for full screen was granted (allow="fullscreen" holds: ${fsLog.join(", ")}), and WebKit left full screen by itself within ${(() => { const t = fsLog.map((l) => Number(l.split("@")[1])); return t.length > 1 ? t[1] - t[0] : "?"; })()} ms, which a window kept off every screen in an app that is never active cannot hold; seen by hand in a development build only`]
        : ["breaks", `the frame's request for full screen was not granted (${x.fsIn?.asked}; ${JSON.stringify(fsLog)})`];
      return [verdict, why, [{ row: "4-video-fullscreen", verdict: fs[0], why: fs[1], where: fs[0] === "breaks" ? "mac" : "hand" }]];
    },
  });

  // Upload by the file button: the open panel is asked for, the runner answers with a picture, the app takes it.
  rows.push({
    id: "5-upload", item: 5, where: "app",
    steps: () => [...ready,
      ...(R2F
        ? [...go("director"), { do: "js", in: "frame", as: "before", body: "return [...document.querySelectorAll('button[aria-label^=\"Remove \"]')].filter((b) => b.getBoundingClientRect().width > 0).length" },
          { do: "click", in: "frame", selector: "button", text: "Add images", as: "press" }, { do: "wait", ms: 5000 },
          { do: "js", in: "frame", as: "after", body: "return [...document.querySelectorAll('button[aria-label^=\"Remove \"]')].filter((b) => b.getBoundingClientRect().width > 0).length" }]
        : [...go(at("renders", made.second)), { do: "js", in: "frame", as: "before", body: "return [...document.querySelectorAll('button[aria-label^=\"Select IMG-\"]')].length" },
          { do: "click", in: "frame", selector: "button", text: "Add renders", as: "press" }, { do: "wait", ms: 6000 },
          { do: "js", in: "frame", as: "after", body: "return [...document.querySelectorAll('button[aria-label^=\"Select IMG-\"]')].length" }]),
      shot(dir, `${slug}-upload`),
    ],
    judge: (r) => {
      const x = r.results;
      const asked = (r.panels || []).filter((p) => p.panel === "open");
      if (!asked.length) return ["breaks", "pressing the button asked for no open panel"];
      return x.after > x.before ? ["works", `the open panel was asked for (${asked.length}); the picture given to it was taken (${x.before} -> ${x.after}). The hand check in a development build is the orchestrator's.`]
        : ["breaks", `the open panel was asked for, but the app did not show the picture (${x.before} -> ${x.after})`];
    },
  });

  rows.push({
    id: "6-drag-from-finder", item: 6, where: "hand",
    steps: null,
    judge: () => ["hand check", "a picture dragged from Finder onto the drop zone: only a person can do it, in a development build (build.sh --dev, open -g); the orchestrator's"],
  });

  if (R2F) {
    rows.push({
      id: "6-drag-mask-brush", item: 6, where: "app",
      steps: () => [...ready, ...go("stills"),
        { do: "click", in: "frame", selector: "button", text: "Mark an area to edit", as: "open" }, { do: "wait", ms: 1200 },
        { do: "js", in: "frame", as: "tools", body: "return [...document.querySelectorAll('[aria-label=\"Marking tool\"] button, [aria-label=\"Marking tool\"] input, [aria-label=\"Marking tool\"] [role=radio]')].map((b) => (b.getAttribute('aria-label') || b.innerText || b.value || '').trim())" },
        { do: "click", in: "frame", selector: "[aria-label=\"Marking tool\"] button, [aria-label=\"Marking tool\"] [role=radio], [aria-label=\"Marking tool\"] label", text: "Brush", as: "brush" }, { do: "wait", ms: 400 },
        { do: "js", in: "frame", as: "undoBefore", body: "const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.innerText).trim() === 'Undo' && x.getBoundingClientRect().width > 0); return b ? (b.disabled || b.getAttribute('aria-disabled') === 'true') : null" },
        { do: "drag", in: "frame", selector: "canvas", fx: 0.3, fy: 0.4, dx: 160, dy: 60, steps: 16, as: "stroke" }, { do: "wait", ms: 500 },
        { do: "js", in: "frame", as: "undoAfter", body: "const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.innerText).trim() === 'Undo' && x.getBoundingClientRect().width > 0); return b ? (b.disabled || b.getAttribute('aria-disabled') === 'true') : null" },
        { do: "js", in: "frame", as: "painted", body: "const c = [...document.querySelectorAll('canvas')].find((x) => x.getBoundingClientRect().width > 0); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) k++; return k" },
        shot(dir, `${slug}-mask-brush`),
      ],
      judge: (r) => {
        const x = r.results;
        const ok = x.undoBefore === true && x.undoAfter === false && x.painted > 0;
        return [ok ? "works" : "breaks", `mask painter (tools ${JSON.stringify(x.tools)}): Undo ${x.undoBefore ? "off" : "on"} before the drag, ${x.undoAfter === false ? "on" : "off"} after; ${x.painted ?? 0} painted pixels on the canvas`];
      },
    });
  } else {
    rows.push({
      id: "6-drag-storyboard", item: 6, where: "app",
      steps: () => [...ready, ...go(at("storyboard")),
        { do: "waitFor", in: "frame", body: "document.querySelector('[data-shot]')", ms: 15000 },
        { do: "js", in: "frame", as: "order0", body: "return [...document.querySelectorAll('[data-shot]')].map((b) => b.dataset.shot.slice(0, 4) + '(' + b.getAttribute('aria-label').split(',').slice(0, 3).join(',') + ')').join(' ')" },
        { do: "drag", in: "frame", selector: "[data-shot]", index: 0, toSelector: "[data-shot]", toIndex: 2, toFx: 0.8, steps: 20, as: "drag" }, { do: "wait", ms: 1500 },
        { do: "js", in: "frame", as: "order1", body: "return [...document.querySelectorAll('[data-shot]')].map((b) => b.dataset.shot.slice(0, 4) + '(' + b.getAttribute('aria-label').split(',').slice(0, 3).join(',') + ')').join(' ')" },
        { do: "js", in: "frame", as: "ids1", body: "return [...document.querySelectorAll('[data-shot]')].map((b) => b.dataset.shot)" },
        shot(dir, `${slug}-storyboard-drag`),
      ],
      judge: (r) => {
        const x = r.results;
        const moved = x.order1 && x.order1 !== x.order0;
        return [moved ? "works" : "breaks", `storyboard: shot 1 dragged with the pointer onto shot 3; the shots (id and label) went from ${x.order0} to ${x.order1}`];
      },
    });
  }

  // The before/after slider, dragged with the pointer.
  rows.push({
    id: "6-compare-slider", item: 6, where: "app",
    steps: () => [...ready,
      ...(R2F ? [...go("director"), { do: "click", in: "frame", selector: "button", text: "Open frame 1: Arrival at the wall, shot", as: "frame1" }, { do: "wait", ms: 1500 }] : [...go(at("review"))]),
      { do: "waitFor", in: "frame", body: "[...document.querySelectorAll('input[type=range][aria-label^=\"Compare \"]')].some((i) => i.getBoundingClientRect().width > 0)", ms: 10000, as: "found" },
      { do: "js", in: "frame", as: "v0", body: "const i = [...document.querySelectorAll('input[type=range][aria-label^=\"Compare \"]')].find((x) => x.getBoundingClientRect().width > 0); return i ? Number(i.value) : null" },
      { do: "drag", in: "frame", selector: "input[type=range][aria-label^=\"Compare \"]", fx: 0.5, dx: -150, steps: 15, as: "drag" }, { do: "wait", ms: 500 },
      { do: "js", in: "frame", as: "v1", body: "const i = [...document.querySelectorAll('input[type=range][aria-label^=\"Compare \"]')].find((x) => x.getBoundingClientRect().width > 0); return i ? Number(i.value) : null" },
      { do: "js", in: "frame", as: "pos", body: "const f = [...document.querySelectorAll('input[type=range][aria-label^=\"Compare \"]')].find((x) => x.getBoundingClientRect().width > 0); return f ? getComputedStyle(f.parentElement).getPropertyValue('--pos') : null" },
      shot(dir, `${slug}-compare-slider`),
    ],
    judge: (r) => {
      const x = r.results;
      if (x.v0 === null || x.v0 === undefined) return ["looks wrong", "no before/after slider on the screen the check opened (it shows only after a take is viewed); not judged here"];
      return x.v1 < x.v0 ? ["works", `the divider moved with the pointer: ${x.v0} -> ${x.v1} (--pos ${x.pos})`] : ["breaks", `the divider did not move: ${x.v0} -> ${x.v1}`];
    },
  });

  // A download through the save panel with a cleaned name, and copy after a click.
  rows.push({
    id: "7-download", item: 7, where: "app",
    steps: () => [...ready,
      ...(R2F
        ? [...go("library"), { do: "waitFor", in: "frame", body: "document.querySelectorAll('button[aria-label^=\"Select \"]').length > 3", ms: 15000 },
          { do: "click", in: "frame", selector: "button", text: "Golden hour, 2K" }, { do: "wait", ms: 800 },
          { do: "js", in: "frame", as: "labels", body: "return [...document.querySelectorAll('aside button, aside a')].map((b) => b.getAttribute('aria-label') || b.innerText).filter(Boolean).slice(0, 20)" },
          { do: "click", in: "frame", selector: "aside button[aria-label^=\"Download\"], aside a[aria-label^=\"Download\"], button[aria-label^=\"Download\"]", as: "press" }]
        : [...go(at("film", made.second)), { do: "waitFor", in: "frame", body: "document.querySelector('a[aria-label^=\"Download\"]')", ms: 15000 },
          { do: "click", in: "frame", selector: "a[aria-label^=\"Download\"]", as: "press" }]),
      { do: "wait", ms: 4000 },
    ],
    judge: (r) => {
      const saves = (r.panels || []).filter((p) => p.panel === "save");
      if (!r.results.press) return ["breaks", `no download control found (${JSON.stringify(r.results.labels || []).slice(0, 200)})`];
      if (!saves.length) {
        const csp = Object.entries(r.byOrigin || {}).flatMap(([o, v]) => (v.csp || []).map((c) => `${o} refused "${c}"`));
        return ["breaks", `pressing Download asked for no save panel and nothing was saved (external ${JSON.stringify(r.externalAsked)}, dropped ${r.dropped}${csp.length ? `; ${csp.join("; ")}` : ""})`
          + (R2F ? ". The app fetches the file and clicks a link to a blob: address with `download`; in this web view that click becomes a load of the frame at blob:, which the home page's frame-src refuses" : "")];
      }
      const s = saves[0];
      return ["works", `the save panel was asked for: WebKit suggested "${s.suggested}", the panel shows "${s.cleaned}"; written to the runner's folder`];
    },
    after: (r, fsx) => { const s = (r.panels || []).find((p) => p.panel === "save"); return s && s.to ? fsx(s.to) : null; },
  });

  rows.push({
    id: "7-select-copy", item: 7, where: "app",
    steps: () => [...ready, ...go(R2F ? "library" : "#/"), { do: "wait", ms: 800 },
      markText(), { do: "click", in: "frame", selector: "[data-ar-pick]", fx: 0.15, count: 2, as: "dbl" }, { do: "wait", ms: 300 },
      { do: "js", in: "frame", as: "selected", body: "return String(getSelection())" },
      { do: "action", name: "copy:", as: "copied" }, { do: "wait", ms: 400 },
      { do: "pasteboard", as: "board" },
      { do: "js", in: "frame", body: "getSelection().removeAllRanges(); return 1" },
      { do: "click", in: "frame", selector: "button", index: 2, count: 2, as: "dblButton" }, { do: "wait", ms: 300 },
      { do: "js", in: "frame", as: "selectedButton", body: "return String(getSelection())" },
      { do: "click", in: "top", selector: ".p-app__trust", count: 2, as: "dblHome" }, { do: "wait", ms: 300 },
      { do: "js", in: "top", as: "selectedHome", body: "return String(getSelection())" },
    ],
    judge: (r) => {
      const x = r.results;
      const sel = (x.selected || "").trim();
      const copied = sel && (x.board || "").trim() === sel;
      const bits = [`double-click on the app's text selected "${sel.slice(0, 30)}"`, `Copy put ${copied ? "it" : `"${String(x.board).slice(0, 30)}"`} on the clipboard`,
`a button selects "${String(x.selectedButton || "").trim().slice(0, 20)}"`, `home text selects "${String(x.selectedHome || "").trim().slice(0, 20)}"`];
      if (!sel || !copied) return ["breaks", bits.join("; ")];
      if (String(x.selectedButton || "").trim()) return ["looks wrong", bits.join("; ") + " (a button's label can be selected)"];
      return ["works", bits.join("; ") + ". The apps have no copy button of their own; the clipboard was put back after."];
    },
  });

  rows.push({
    id: "8-spending-off", item: 8, where: "app",
    steps: () => [...ready, ...(R2F ? [...go("stills"), { do: "js", in: "frame", as: "a", body: SPEND }, ...go("director"), { do: "js", in: "frame", as: "b", body: SPEND }, ...go("video"), { do: "js", in: "frame", as: "c", body: SPEND }]
      : [...go(at("storyboard")), { do: "js", in: "frame", as: "a", body: SPEND }, ...go(at("enhance")), { do: "click", in: "frame", selector: "button", text: "Select all not enhanced (3)" }, { do: "wait", ms: 800 }, { do: "js", in: "frame", as: "b", body: SPEND }, ...go(at("masters")), { do: "click", in: "frame", selector: "button", text: "Select all without a master (2)" }, { do: "wait", ms: 800 }, { do: "js", in: "frame", as: "c", body: SPEND }]),
    shot(dir, `${slug}-spending-off`)],
    judge: (r) => {
      const xs = ["a", "b", "c"].map((k) => r.results[k]).filter(Boolean);
      const buttons = xs.flatMap((x) => x.buttons);
      const on = buttons.filter((b) => !b.off);
      const sentence = xs.every((x) => x.sentence);
      if (!buttons.length) return ["looks wrong", "no spending button found on the screens checked"];
      const words = `${buttons.length} spending buttons (${[...new Set(buttons.map((b) => b.words))].slice(0, 6).join("; ")}); ${on.length} on; "${ALLOW_SENTENCE}" ${sentence ? "on every screen" : "missing on a screen"}`;
      return [on.length === 0 && sentence ? "works" : "breaks", words];
    },
  });

  return rows;
}
