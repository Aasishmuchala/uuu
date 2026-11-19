// The frame every page lives in (PLAN-COOK T20): from 860 px up the sidebar at the left and the page column
// (the top bar over the main pane); below 860 px the top bar's back button and crumbs, the tab bar and its More
// sheet. Then the optional work panel, the queue panel (T21; below 860 px the Needs you page instead), the
// command menu and the compose dialog, the keys, the skip link and the aria-live line. It reads GET /api/shell every
// 10 seconds and GET /api/setup every 60 seconds, and gives every page the context of lib/context.js.
import { html, useCallback, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { useEngineDown, useResource } from "../lib/api.js";
import { AppContext } from "../lib/context.js";
import { useRoute } from "../lib/router.js";
import { loadSettings, saveSettings as storeSettings } from "../lib/settings.js";
import { currentAccent, currentBackdrop, currentMotion, currentTheme } from "../lib/theme.js";
import { PageHeader } from "../kit/index.js";
import { findRoute, redirectFor } from "../routes.js";
import { CommandMenu } from "./command-menu.js";
import { ComposeDialog } from "./compose-dialog.js";
import { LazyPage } from "./lazy-page.js";
import { QueuePanel } from "./queue.js";
import { SIDE_KEY, Sidenav, sideMode } from "./sidenav.js";
import { TabBar } from "./tabbar.js";
import { MenuSheet, Topbar, cleanTop } from "./topbar.js";
import { WorkPanel } from "./work-panel.js";

const OVERLAYS = ["command", "compose", "needs", "menu"];
const SHELL_EVERY = 10000;
// How often the shell asks whether the engine still answers, so an open page says so within 5 s (S-recovery-0dfd431c).
const ALIVE_EVERY = 3000;
const NARROW = "(max-width: 859px)";
const MIDDLE = "(max-width: 1099px)";

// "g" then one of these keys goes to that page.
const GO = { m: "map", t: "tasks", d: "dashboards", f: "files", n: "needs-you", j: "jobs" };

// What a key press means, or null. `typing` is true while focus is in a field; `pendingG` is true right
// after a bare "g"; `page` is the current page's id and `zoomed` is true on one department of the map.
// Returns "command" | "compose" | "queue" | "side" | "box" | "map-back" | "go:<page>" | "g".
export function keyAction({ key, metaKey, ctrlKey, altKey, typing, page, zoomed }, pendingG = false) {
  const k = String(key || "");
  if ((metaKey || ctrlKey) && !altKey && k.toLowerCase() === "k") return "command";
  if (metaKey || ctrlKey || altKey || typing) return null;
  if (pendingG && GO[k]) return `go:${GO[k]}`;
  if (k === "/") return page === "map" ? "box" : "command";
  if (k === "c") return "compose";
  if (k === "q") return "queue";
  if (k === "[") return "side";
  if (k === "g") return "g";
  if (k === "Escape" && page === "map" && zoomed) return "map-back";
  return null;
}

// Where the bare address goes on a first run (PLAN-ONBOARD decision 7): "#/setup" when the address is the bare one, the
// server says `open: true` and this page load has not gone there yet (`done`); else null. "#/map" and every other
// address stay where they are, and a failed or pending /api/setup sends nowhere.
// It reads the address as typed: parseHash turns the bare address into ["map"], so parts cannot tell it from #/map.
export function setupRedirect({ hash, setup, done } = {}) {
  if (typeof hash !== "string" || !["", "#", "#/"].includes(hash)) return null;
  if (!setup || setup.open !== true || done === true) return null;
  return "#/setup";
}

// The overlay asked for by "?open=" before the "#", or null.
export function overlayFrom(search) {
  try {
    const o = new URLSearchParams(search || "").get("open");
    return OVERLAYS.includes(o) ? o : null;
  } catch {
    return null;
  }
}

// How the main pane holds a page: "map" (the whole pane), "fill" (the whole window under the top bar, with a
// small margin: an app opened inside App Studio), "full" (the full width: the board of tasks and the Studio),
// "column" (one column: a task, a department, a job, an agent), or "normal" (centred, at most --content-max wide).
export function paneOf(routeId, query) {
  if (routeId === "map") return "map";
  if (routeId === "app") return "fill";
  if (routeId === "studio") return "full";
  if (routeId === "tasks" && query && typeof query.get === "function" && query.get("view") === "board") return "full";
  if (["task", "dept", "job", "agent"].includes(routeId)) return "column";
  return "normal";
}

// True for the pages that use the full width (kept from V2 for the pages that ask).
export const isWide = (routeId, query) => paneOf(routeId, query) === "full";

const isTyping = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

// The map's box, for "/" on the map (the Composer in ask mode inside the map page).
function mapBox() {
  return document.querySelector(".p-map [data-box] textarea, .p-map .k-composer textarea, .p-map textarea");
}

function useMedia(query) {
  const get = () => typeof matchMedia === "function" && matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const m = matchMedia(query);
    const change = () => setOn(m.matches);
    change(); // the window may have changed between the first draw and now
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, [query]);
  return on;
}

// The two routes drawn as a lit studio show the sidebar as icons until the owner chooses (PLAN-3D D15).
export const iconsRoute = (routeId) => routeId === "map" || routeId === "needs-you";

// The owner's stored width of the sidebar ("open" | "icons"), or null for automatic.
function storedSide() {
  try {
    const v = localStorage.getItem(SIDE_KEY);
    return v === "open" || v === "icons" ? v : null;
  } catch {
    return null;
  }
}
function storeSide(v) {
  try {
    if (v) localStorage.setItem(SIDE_KEY, v);
    else localStorage.removeItem(SIDE_KEY);
  } catch {
    // A browser that keeps nothing: the choice lasts until the page is reloaded.
  }
}

// True while the page shows work on a stage (a .k-work, or a .k-doc--layout such as Settings, in the main pane): the sidebar then shows icons only,
// unless the owner chose otherwise. Watched, because a page draws its stage once its data has come.
function useStage(key) {
  const [stage, setStage] = useState(false);
  useEffect(() => {
    const main = typeof document !== "undefined" ? document.getElementById("main") : null;
    if (!main || typeof MutationObserver !== "function") return undefined;
    const look = () => setStage(!!main.querySelector(".k-work, .k-doc--layout"));
    look();
    const watch = new MutationObserver(look);
    watch.observe(main, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [key]);
  return stage;
}

// Takes "?open=" out of the address once its overlay is closed, so a reload does not reopen it.
function forgetOpen() {
  const q = new URLSearchParams(location.search);
  if (!q.has("open")) return;
  q.delete("open");
  const rest = q.toString();
  history.replaceState(history.state, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
}

function NotFound() {
  return html`
    <div class="s-notfound">
      <${PageHeader} title="There is no page here" />
      <p>The address may be old or mistyped. <a href="#/map">Go to the map</a>.</p>
    </div>`;
}

const looks = () => ({
  theme: currentTheme(), accent: currentAccent(), backdrop: currentBackdrop(), motion: currentMotion(),
  accents: null, backdrops: null, saved: false,
});

export function AppShell() {
  const address = useRoute();
  const route = findRoute(address.parts);
  const redirect = redirectFor(address.parts, address.query);
  // Read every SHELL_EVERY while the page is visible, and once as soon as it is visible again (useResource's own
  // visibilitychange): nothing is read while it is hidden, so the sidebar's Needs you count catches up on return.
  const shell = useResource("/api/shell", { every: SHELL_EVERY });
  // The engine stopped answering: said over whatever is on screen; when it answers again the shell is read at once.
  const down = useEngineDown(ALIVE_EVERY, () => shell.refresh());
  // The guided setup's state, for its sidebar row and the first-run opening (read on its own, not every 10 seconds).
  const setup = useResource("/api/setup", { every: 60000 });
  const setupDone = useRef(false);
  const narrow = useMedia(NARROW);
  useMedia(MIDDLE); // draws again when the window crosses 1100 px, where the automatic sidebar changes width
  const [overlay, setOverlay] = useState(() => (typeof location === "undefined" ? null : overlayFrom(location.search)));
  const [seed, setSeed] = useState({ n: 0 });
  const [needsFor, setNeedsFor] = useState(null);
  const [panel, setPanel] = useState(null);
  const [live, setLive] = useState("");
  const [settings, setSettings] = useState(looks);
  const [stored, setStored] = useState(storedSide);
  const [top, setTopState] = useState(null);
  const pendingG = useRef(false);
  const gTimer = useRef(0);
  const first = useRef(true);
  const routeId = route?.id || null;

  useEffect(() => { loadSettings().then(setSettings); }, []);

  useEffect(() => {
    if (redirect) location.replace(redirect);
  }, [redirect]);

  // At most once per page load: the bare address opens Setup while the server says it should.
  const toSetup = setupRedirect({ hash: location.hash, setup: setup.data, done: setupDone.current });
  useEffect(() => {
    if (!toSetup) return;
    setupDone.current = true;
    location.replace(toSetup);
  }, [toSetup]);

  const announce = useCallback((text) => {
    setLive("");
    setTimeout(() => setLive(String(text || "")), 50);
  }, []);

  const openComposer = useCallback((s = {}) => {
    setSeed((old) => ({ ...s, n: old.n + 1 }));
    setOverlay("compose");
  }, []);
  const openCommand = useCallback(() => setOverlay("command"), []);
  const closeOverlay = useCallback(() => {
    setOverlay(null);
    forgetOpen();
  }, []);
  // Below 860 px there is no queue panel: the Needs you page opens instead.
  const openQueue = useCallback(({ department } = {}) => {
    const dep = typeof department === "string" && department ? department : null;
    if (typeof matchMedia === "function" && matchMedia(NARROW).matches) {
      location.hash = dep ? `#/needs-you?d=${encodeURIComponent(dep)}` : "#/needs-you";
      return;
    }
    setNeedsFor(dep);
    setOverlay("needs");
  }, []);
  const openNeeds = openQueue;
  const openPanel = useCallback((content, { title } = {}) => setPanel({ content, title: title || "" }), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const saveSettings = useCallback(async (s) => {
    const next = await storeSettings(s);
    setSettings((old) => ({ ...next, accents: next.accents || old.accents, backdrops: next.backdrops || old.backdrops }));
    return next;
  }, []);

  // What the page gave the top bar belongs to the page it came from: kept with its address, and shown only
  // while that address is open, so a page change clears it without a render in between.
  const pathKey = address.parts.join("/");
  const pathNow = useRef(pathKey);
  pathNow.current = pathKey;
  const setTop = useCallback((t) => {
    const clean = cleanTop(t);
    const next = clean ? { ...clean, key: pathNow.current } : null;
    setTopState((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, []);
  const shownTop = top && top.key === pathKey ? top : null;

  // The sidebar's width: the owner's choice, else by the window and whether the page shows a stage.
  const stage = useStage(pathKey);
  const side = narrow ? "none" : sideMode({ stored, stage: stage || iconsRoute(routeId), width: typeof innerWidth === "number" ? innerWidth : 1280 });
  const setSide = useCallback((v) => {
    const next = v === "open" || v === "icons" ? v : null;
    storeSide(next);
    setStored(next);
  }, []);
  const flipSide = useCallback(() => setSide(side === "open" ? "icons" : "open"), [side, setSide]);

  // The queue is not drawn below 860 px: a window made narrow while it is open closes it.
  useEffect(() => {
    if (narrow && overlay === "needs") closeOverlay();
  }, [narrow, overlay, closeOverlay]);

  // A new page: close the menu sheet and the panel, go to the top, and move focus to the page's heading
  // (it appears once the page's module has loaded, so look for it for up to two seconds).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    setOverlay((o) => (o === "menu" || o === "needs" ? null : o));
    setPanel(null);
    window.scrollTo(0, 0);
    let tries = 0;
    let frame = 0;
    const look = () => {
      const h = document.getElementById("page-title");
      if (h) {
        if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
        h.focus({ preventScroll: true });
      } else if (tries++ < 120) frame = requestAnimationFrame(look);
    };
    frame = requestAnimationFrame(look);
    return () => cancelAnimationFrame(frame);
  }, [pathKey]);

  // The keys of 26.2. Dialogs and drawers close themselves on Esc; the work panel closes on Esc when focus
  // is inside it. A page that handles a key itself calls preventDefault() and the shell leaves it alone.
  const zoomed = routeId === "map" && address.parts.length === 2;
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      const what = keyAction({
        key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, typing: isTyping(e.target), page: routeId, zoomed,
      }, pendingG.current);
      if (e.key !== "Shift") {
        pendingG.current = false;
        clearTimeout(gTimer.current);
      }
      if (!what) return;
      if (what === "queue" && overlay === "needs") {
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (what !== "command" && overlay) return;
      if (what === "box") {
        const box = mapBox();
        e.preventDefault();
        if (box) box.focus();
        else setOverlay("command");
        return;
      }
      e.preventDefault();
      if (what === "g") {
        pendingG.current = true;
        gTimer.current = setTimeout(() => { pendingG.current = false; }, 1500);
      } else if (what === "command") {
        setOverlay((o) => (o === "command" ? null : "command"));
      } else if (what === "compose") {
        openComposer({});
      } else if (what === "queue") {
        openQueue({});
      } else if (what === "side") {
        if (!narrow) flipSide();
      } else if (what === "map-back") {
        location.hash = "#/map";
      } else if (what.startsWith("go:")) {
        location.hash = `#/${what.slice(3)}`;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, openComposer, openQueue, closeOverlay, flipSide, narrow, routeId, zoomed]);

  const dock = Array.isArray(shell.data?.dock) ? shell.data.dock : [];
  const ctx = useMemo(() => ({
    shell: shell.data,
    shellError: shell.error,
    refreshShell: shell.refresh,
    refreshSetup: setup.refresh,
    announce,
    openComposer,
    openPanel,
    closePanel,
    openQueue,
    openNeeds,
    closeNeeds: closeOverlay,
    setTop,
    side,
    sideChoice: stored === "open" || stored === "icons" ? stored : null,
    setSide,
    dock,
    settings,
    saveSettings,
  }), [shell.data, shell.error, shell.refresh, setup.refresh, announce, openComposer, openPanel, closePanel, openQueue, openNeeds, closeOverlay, setTop, side, stored, setSide, settings, saveSettings]);

  const skip = (e) => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  };

  // The tab bar sits inside .s-app, in the same layer as the pages: a page's own dialog (z-index 100 there)
  // then lies over it, and its Save is never under the bar (M52 F2).
  const team = shell.data?.team || [];
  const pane = route ? paneOf(route.id, address.query) : "normal";
  const offline = shell.error && !shell.data ? shell.error : down;
  const cls = ["s-app", narrow ? "s-app--narrow" : `s-app--${side}`, panel && !narrow ? "has-panel" : ""].filter(Boolean).join(" ");

  return html`
    <${AppContext.Provider} value=${ctx}>
      <a class="s-skip" href="#main" onClick=${skip}>Skip to content</a>
      <div class=${cls}>
        ${narrow ? null : html`
          <${Sidenav} mode=${side} routeId=${routeId} parts=${address.parts} query=${address.query} shell=${shell.data} dock=${dock}
            settings=${settings} onSaveSettings=${saveSettings} setup=${setup.data} />`}
        <div class="s-main">
          <${Topbar} routeId=${routeId} parts=${address.parts} shell=${shell.data} top=${shownTop} narrow=${narrow} side=${side}
            queueOpen=${overlay === "needs"} onSide=${flipSide} onQueue=${() => (overlay === "needs" ? closeOverlay() : openQueue({}))}
            onCommand=${openCommand} />
          ${offline ? html`
            <p class="s-offline" role="status">${offline.message}${offline.next ? html` <span class="s-offline-next">${offline.next}</span>` : null}</p>` : null}
          <main id="main" class=${`s-content s-content--${pane}`} tabindex="-1">
            ${redirect ? null : route
              ? html`<${LazyPage} route=${route} address=${address} />`
              : html`<${NotFound} />`}
          </main>
        </div>
        <${WorkPanel} panel=${panel} onClose=${closePanel} narrow=${narrow} />
        ${narrow ? html`
          <${TabBar} routeId=${routeId} needs=${shell.data?.counts?.needsYou} moreOpen=${overlay === "menu"} onMore=${() => setOverlay("menu")} />` : null}
      </div>
      <div id="s-queue" class="s-queue-host">
        <${QueuePanel} open=${overlay === "needs"} narrow=${narrow} department=${needsFor} stamp=${shell.data?.generatedAt || ""}
          here=${typeof location === "undefined" ? "" : location.hash} onClose=${closeOverlay} />
      </div>
      <${MenuSheet} open=${overlay === "menu"} onClose=${closeOverlay} shell=${shell.data} dock=${dock} note=${shownTop?.note || null} setup=${setup.data}
        settings=${settings} onSaveSettings=${saveSettings} onCompose=${() => openComposer({})} onCommand=${openCommand} />
      <${CommandMenu} open=${overlay === "command"} onClose=${closeOverlay} team=${team} onCompose=${openComposer} />
      <${ComposeDialog} open=${overlay === "compose"} seed=${seed} team=${team} queue=${shell.data?.queue || null} onClose=${closeOverlay}
        onSent=${(text) => { announce(text); shell.refresh(); }} />
      <p class="u-visually-hidden" aria-live="polite" role="status">${live}</p>
    <//>`;
}
