// The frame every page lives in (CONTRACTS-V2 14.2 and 14.3): the sidebar (a drawer in a narrow
// window), the main pane, the optional work panel, the command menu and the compose dialog, the keys,
// the skip link and the aria-live line. It reads GET /api/shell every 10 seconds and gives every page
// the context of lib/context.js.
import { html, useCallback, useEffect, useMemo, useRef, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { AppContext } from "../lib/context.js";
import { useRoute } from "../lib/router.js";
import { loadSettings, saveSettings as storeSettings } from "../lib/settings.js";
import { currentAccent, currentTheme } from "../lib/theme.js";
import { Drawer, Icon, PageHeader } from "../kit/index.js";
import { findRoute, redirectFor } from "../routes.js";
import { CommandMenu } from "./command-menu.js";
import { ComposeDialog } from "./compose-dialog.js";
import { LazyPage } from "./lazy-page.js";
import { Sidebar } from "./sidebar.js";
import { WorkPanel } from "./work-panel.js";

const OVERLAYS = ["command", "compose", "menu"];
const NARROW = "(max-width: 859px)";

// What a key press means, or null. `typing` is true while focus is in a field; `pendingG` is true
// right after a bare "g". Returns "command" | "compose" | "go:home" | "go:tasks" | "go:docs" | "g".
export function keyAction({ key, metaKey, ctrlKey, altKey, typing }, pendingG = false) {
  const k = String(key || "");
  if ((metaKey || ctrlKey) && !altKey && k.toLowerCase() === "k") return "command";
  if (metaKey || ctrlKey || altKey || typing) return null;
  if (pendingG) {
    const go = { h: "go:home", t: "go:tasks", d: "go:docs" }[k];
    if (go) return go;
  }
  if (k === "/") return "command";
  if (k === "c") return "compose";
  if (k === "g") return "g";
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

// Tasks as a board and the Studio use the whole width of the pane.
export function isWide(routeId, query) {
  if (routeId === "studio") return true;
  return routeId === "tasks" && (!query || query.get("view") !== "list");
}

const isTyping = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

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
      <p>The address may be old or mistyped. <a href="#/home">Go to Home</a>.</p>
    </div>`;
}

export function AppShell() {
  const address = useRoute();
  const route = findRoute(address.parts);
  const redirect = redirectFor(address.parts, address.query);
  const shell = useResource("/api/shell", { every: 10000 });
  const narrow = useNarrow();
  const [overlay, setOverlay] = useState(() => (typeof location === "undefined" ? null : overlayFrom(location.search)));
  const [seed, setSeed] = useState({ n: 0 });
  const [panel, setPanel] = useState(null);
  const [live, setLive] = useState("");
  const [settings, setSettings] = useState(() => ({ theme: currentTheme(), accent: currentAccent(), accents: null, saved: false }));
  const pendingG = useRef(false);
  const gTimer = useRef(0);
  const first = useRef(true);

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
  const openPanel = useCallback((content, { title } = {}) => setPanel({ content, title: title || "" }), []);
  const closePanel = useCallback(() => setPanel(null), []);
  const saveSettings = useCallback(async (s) => {
    const next = await storeSettings(s);
    setSettings((old) => ({ ...next, accents: next.accents || old.accents }));
    return next;
  }, []);

  // A new page: close the drawer and the panel, go to the top, and move focus to the page's heading
  // (it appears once the page's module has loaded, so look for it for up to two seconds).
  const pathKey = address.parts.join("/");
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    setOverlay((o) => (o === "menu" ? null : o));
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

  // The keys of 14.2. Dialogs and drawers close themselves on Esc; the work panel closes on Esc when
  // focus is inside it.
  useEffect(() => {
    const onKey = (e) => {
      const what = keyAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, typing: isTyping(e.target) }, pendingG.current);
      pendingG.current = false;
      clearTimeout(gTimer.current);
      if (!what) return;
      if (what !== "command" && overlay) return;
      e.preventDefault();
      if (what === "g") {
        pendingG.current = true;
        gTimer.current = setTimeout(() => { pendingG.current = false; }, 1500);
      } else if (what === "command") {
        setOverlay((o) => (o === "command" ? null : "command"));
      } else if (what === "compose") {
        openComposer({});
      } else if (what.startsWith("go:")) {
        location.hash = `#/${what.slice(3)}`;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [overlay, openComposer]);

  const ctx = useMemo(() => ({
    shell: shell.data,
    shellError: shell.error,
    refreshShell: shell.refresh,
    announce,
    openComposer,
    openPanel,
    closePanel,
    settings,
    saveSettings,
  }), [shell.data, shell.error, shell.refresh, announce, openComposer, openPanel, closePanel, settings, saveSettings]);

  const skip = (e) => {
    e.preventDefault();
    document.getElementById("main")?.focus();
  };

  const team = shell.data?.team || [];
  const company = shell.data?.company?.name || "Home";
  const sidebarProps = {
    routeId: route?.id || null,
    parts: address.parts,
    shell: shell.data,
    shellError: shell.data ? null : shell.error,
    onCompose: () => openComposer({}),
    onCommand: openCommand,
  };
  const wide = route && isWide(route.id, address.query);
  const needs = Number(shell.data?.counts?.needsYou) || 0;

  return html`
    <${AppContext.Provider} value=${ctx}>
      <a class="s-skip" href="#main" onClick=${skip}>Skip to content</a>
      <div class=${`s-app${panel && !narrow ? " has-panel" : ""}`}>
        ${narrow ? null : html`<${Sidebar} ...${sidebarProps} />`}
        <div class="s-main">
          ${narrow ? html`
            <header class="s-topbar">
              <button type="button" class="s-icon-btn" onClick=${() => setOverlay("menu")} aria-label=${needs ? `Menu, ${needs} need you` : "Menu"}>
                <${Icon} name="menu" />
                ${needs ? html`<span class="s-topbar-dot" aria-hidden="true"></span>` : null}
              </button>
              <span class="s-topbar-name u-truncate">${company}</span>
              <button type="button" class="s-icon-btn" onClick=${openCommand} aria-label="Search">
                <${Icon} name="search" />
              </button>
              <button type="button" class="s-topbar-new" onClick=${() => openComposer({})}>
                <${Icon} name="plus" /><span>New task</span>
              </button>
            </header>` : null}
          <main id="main" class=${`s-content${wide ? " s-content--wide" : ""}`} tabindex="-1">
            ${redirect ? null : route
              ? html`<${LazyPage} route=${route} address=${address} />`
              : html`<${NotFound} />`}
          </main>
        </div>
        <${WorkPanel} panel=${panel} onClose=${closePanel} narrow=${narrow} />
      </div>
      ${narrow ? html`
        <${Drawer} open=${overlay === "menu"} side="left" title=${company} onClose=${closeOverlay}>
          <${Sidebar} ...${sidebarProps} inDrawer=${true} onNavigate=${closeOverlay}
            onCompose=${() => openComposer({})} onCommand=${openCommand} />
        <//>` : null}
      <${CommandMenu} open=${overlay === "command"} onClose=${closeOverlay} team=${team} onCompose=${openComposer} />
      <${ComposeDialog} open=${overlay === "compose"} seed=${seed} team=${team} onClose=${closeOverlay}
        onSent=${(text) => { announce(text); shell.refresh(); }} />
      <p class="u-visually-hidden" aria-live="polite" role="status">${live}</p>
    <//>`;
}
