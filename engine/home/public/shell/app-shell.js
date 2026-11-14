// The frame every page lives in (CONTRACTS-V3 26.2): the canvas behind everything, the top bar with the
// capsule, the Needs you pill and drawer, the dock on the pages of work, the tab bar and the Menu sheet
// below 860 px, the main pane, the optional work panel, the command menu and the compose dialog, the keys,
// the skip link and the aria-live line. It reads GET /api/shell every 10 seconds and gives every page the
// context of lib/context.js.
import { html, useCallback, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { AppContext } from "../lib/context.js";
import { useRoute } from "../lib/router.js";
import { loadSettings, saveSettings as storeSettings } from "../lib/settings.js";
import { currentAccent, currentBackdrop, currentMotion, currentTheme } from "../lib/theme.js";
import { PageHeader } from "../kit/index.js";
import { findRoute, redirectFor } from "../routes.js";
import { CommandMenu } from "./command-menu.js";
import { ComposeDialog } from "./compose-dialog.js";
import { Dock, dockCurrent, showsDock } from "./dock.js";
import { LazyPage } from "./lazy-page.js";
import { NeedsDrawer } from "./needs-drawer.js";
import { TabBar } from "./tabbar.js";
import { MenuSheet, Topbar } from "./topbar.js";
import { WorkPanel } from "./work-panel.js";

const OVERLAYS = ["command", "compose", "needs", "menu"];
const NARROW = "(max-width: 859px)";

// "g" then one of these keys goes to that page.
const GO = { m: "map", t: "tasks", d: "dashboards", f: "files", n: "needs-you", j: "jobs" };

// What a key press means, or null. `typing` is true while focus is in a field; `pendingG` is true right
// after a bare "g"; `page` is the current page's id and `zoomed` is true on one department of the map.
// Returns "command" | "compose" | "box" | "map-back" | "go:<page>" | "g".
export function keyAction({ key, metaKey, ctrlKey, altKey, typing, page, zoomed }, pendingG = false) {
  const k = String(key || "");
  if ((metaKey || ctrlKey) && !altKey && k.toLowerCase() === "k") return "command";
  if (metaKey || ctrlKey || altKey || typing) return null;
  if (pendingG && GO[k]) return `go:${GO[k]}`;
  if (k === "/") return page === "map" ? "box" : "command";
  if (k === "c") return "compose";
  if (k === "g") return "g";
  if (k === "Escape" && page === "map" && zoomed) return "map-back";
  return null;
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

function useNarrow() {
  const get = () => typeof matchMedia === "function" && matchMedia(NARROW).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const m = matchMedia(NARROW);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
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

// The canvas of CONTRACTS-V3 27.3: five soft lights and the stars, drawn once, behind everything.
function Canvas() {
  return html`
    <div class="s-canvas" aria-hidden="true">
      <span class="s-canvas__light s-canvas__light--1"></span>
      <span class="s-canvas__light s-canvas__light--2"></span>
      <span class="s-canvas__light s-canvas__light--3"></span>
      <span class="s-canvas__light s-canvas__light--4"></span>
      <span class="s-canvas__light s-canvas__light--5"></span>
      <span class="s-canvas__stars"></span>
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
  const shell = useResource("/api/shell", { every: 10000 });
  const narrow = useNarrow();
  const [overlay, setOverlay] = useState(() => (typeof location === "undefined" ? null : overlayFrom(location.search)));
  const [seed, setSeed] = useState({ n: 0 });
  const [needsFor, setNeedsFor] = useState(null);
  const [panel, setPanel] = useState(null);
  const [live, setLive] = useState("");
  const [settings, setSettings] = useState(looks);
  const pendingG = useRef(false);
  const gTimer = useRef(0);
  const first = useRef(true);
  const routeId = route?.id || null;

  useEffect(() => { loadSettings().then(setSettings); }, []);

  useEffect(() => {
    if (redirect) location.replace(redirect);
  }, [redirect]);

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
  const openNeeds = useCallback(({ department } = {}) => {
    setNeedsFor(typeof department === "string" && department ? department : null);
    setOverlay("needs");
  }, []);
  const openPanel = useCallback((content, { title } = {}) => setPanel({ content, title: title || "" }), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const saveSettings = useCallback(async (s) => {
    const next = await storeSettings(s);
    setSettings((old) => ({ ...next, accents: next.accents || old.accents, backdrops: next.backdrops || old.backdrops }));
    return next;
  }, []);

  // A new page: close the menu sheet and the panel, go to the top, and move focus to the page's heading
  // (it appears once the page's module has loaded, so look for it for up to two seconds).
  const pathKey = address.parts.join("/");
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
      } else if (what === "map-back") {
        location.hash = "#/map";
      } else if (what.startsWith("go:")) {
        location.hash = `#/${what.slice(3)}`;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, openComposer, routeId, zoomed]);

  const dock = Array.isArray(shell.data?.dock) ? shell.data.dock : [];
  const ctx = useMemo(() => ({
    shell: shell.data,
    shellError: shell.error,
    refreshShell: shell.refresh,
    announce,
    openComposer,
    openPanel,
    closePanel,
    openNeeds,
    closeNeeds: closeOverlay,
    dock,
    settings,
    saveSettings,
  }), [shell.data, shell.error, shell.refresh, announce, openComposer, openPanel, closePanel, openNeeds, closeOverlay, settings, saveSettings]);

  const skip = (e) => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  };

  // The tab bar sits inside .s-app, in the same layer as the pages: a page's own dialog (z-index 100 there)
  // then lies over it, and its Save is never under the bar (M52 F2).
  const team = shell.data?.team || [];
  const pane = route ? paneOf(route.id, address.query) : "normal";
  const withDock = !narrow && route && showsDock(route.id);
  const offline = shell.error && !shell.data ? shell.error : null;
  const cls = ["s-app", narrow ? "s-app--narrow" : "", withDock ? "s-app--dock" : "", panel && !narrow ? "has-panel" : ""].filter(Boolean).join(" ");

  return html`
    <${AppContext.Provider} value=${ctx}>
      <a class="s-skip" href="#main" onClick=${skip}>Skip to content</a>
      <${Canvas} />
      <div class=${cls}>
        <${Topbar} routeId=${routeId} shell=${shell.data} narrow=${narrow} settings=${settings} onSaveSettings=${saveSettings}
          onNeeds=${openNeeds} onMenu=${() => setOverlay("menu")} />
        ${withDock ? html`
          <${Dock} dock=${dock} current=${dockCurrent(route.id, address.parts, address.query)} onCompose=${() => openComposer({})} />` : null}
        <div class="s-main">
          ${offline ? html`
            <p class="s-offline" role="status">${offline.message}${offline.next ? html` <span class="s-offline-next">${offline.next}</span>` : null}</p>` : null}
          <main id="main" class=${`s-content s-content--${pane}`} tabindex="-1">
            ${redirect ? null : route
              ? html`<${LazyPage} route=${route} address=${address} />`
              : html`<${NotFound} />`}
          </main>
        </div>
        <${WorkPanel} panel=${panel} onClose=${closePanel} narrow=${narrow} />
        ${narrow ? html`<${TabBar} routeId=${routeId} />` : null}
      </div>
      <${NeedsDrawer} open=${overlay === "needs"} department=${needsFor} stamp=${shell.data?.generatedAt || ""}
        onClose=${closeOverlay} onDone=${(message) => { if (message) announce(message); shell.refresh(); }} />
      <${MenuSheet} open=${overlay === "menu"} onClose=${closeOverlay} shell=${shell.data} dock=${dock}
        settings=${settings} onSaveSettings=${saveSettings} onCompose=${() => openComposer({})} onCommand=${openCommand} />
      <${CommandMenu} open=${overlay === "command"} onClose=${closeOverlay} team=${team} onCompose=${openComposer} />
      <${ComposeDialog} open=${overlay === "compose"} seed=${seed} team=${team} queue=${shell.data?.queue || null} onClose=${closeOverlay}
        onSent=${(text) => { announce(text); shell.refresh(); }} />
      <p class="u-visually-hidden" aria-live="polite" role="status">${live}</p>
    <//>`;
}
