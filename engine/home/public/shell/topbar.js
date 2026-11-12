// The top bar (CONTRACTS-V3 26.2): the company's mark and name on the left; in the centre one glass capsule
// with the four sections (Map, Tasks, Dashboards, Files); on the right the Needs you pill, Jobs and
// Routines as words, and three square buttons: Health (with a dot), Settings and the light or dark switch.
// Below 860 px it keeps the mark, the Needs you pill and a Menu button, and the Menu sheet (also here)
// lists the rest. The bar has no fill of its own: the canvas shows through it.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { Drawer, Icon, Kbd } from "../kit/index.js";
import { Creature } from "../kit/creature.js";
import { DEPARTMENTS, SECTIONS, sectionOf } from "../routes.js";

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The Health button's dot from the shell's `engine` (CONTRACTS 9.2): "ok", "warn", "bad", or null when not
// known yet, with the words a screen reader says. `gate` is read when the shell sends it: a gate that is off
// is never "everything is on".
export function engineDot(engine) {
  if (!engine) return null;
  if (engine.board !== "on") return { tone: "bad", words: "the engine is off" };
  if (engine.gate === "off") return { tone: "bad", words: "the gate is off" };
  if (engine.books === "off") return { tone: "warn", words: "the books are off" };
  return { tone: "ok", words: "everything is on" };
}

// The Needs you pill's name for a screen reader.
export function needsLabel(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return v ? `Needs you, ${v} waiting` : "Needs you, nothing waiting";
}

// The macOS command key or Ctrl, for the hint beside Search.
export function commandKey() {
  const p = typeof navigator === "undefined" ? "" : String(navigator.platform || navigator.userAgent || "");
  return /Mac|iPhone|iPad/i.test(p) ? "⌘K" : "Ctrl K";
}

// The theme the switch moves to: the opposite of what is on screen. `systemDark` says what "auto" shows.
export function switchedTheme(theme, systemDark) {
  const shown = theme === "auto" ? (systemDark ? "dark" : "light") : theme === "light" ? "light" : "dark";
  return shown === "dark" ? "light" : "dark";
}

function systemDark() {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function ThemeSwitch({ settings, onSave, withWords }) {
  const to = switchedTheme(settings?.theme, systemDark());
  const words = to === "light" ? "Switch to light" : "Switch to dark";
  return html`
    <button type="button" class=${withWords ? "s-sheet-item" : "s-square"} onClick=${() => onSave({ theme: to })}
      aria-label=${withWords ? undefined : words} title=${withWords ? undefined : words}>
      <${Icon} name=${to === "light" ? "sun" : "moon"} />
      ${withWords ? html`<span>${words}</span>` : null}
    </button>`;
}

// `current`: the Needs you page is open; the pill then shows as the current place, and no section of the
// capsule does (M63 item 6).
export function NeedsPill({ count, onOpen, current = false }) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return html`
    <button type="button" class=${`s-needs${n ? " is-warm" : ""}${current ? " is-current" : ""}`} onClick=${() => onOpen({})}
      aria-label=${needsLabel(n)} aria-current=${current ? "page" : undefined}>
      <span class="s-needs-word" aria-hidden="true">Needs you</span>
      <span class="s-needs-count" aria-hidden="true">${n}</span>
    </button>`;
}

function Brand({ name }) {
  const shown = cap(name, 40) || "Home";
  return html`
    <a class="s-brand" href="#/map" aria-label=${`${shown}, the map`}>
      <span class="s-brand-mark" aria-hidden="true">${shown.slice(0, 1).toUpperCase()}</span>
      <span class="s-brand-name u-truncate" aria-hidden="true">${shown}</span>
    </a>`;
}

// The four sections as one capsule; the current one is a solid pill.
export function Capsule({ routeId }) {
  const current = sectionOf(routeId);
  return html`
    <nav class="s-capsule s-glass" aria-label="Sections">
      ${SECTIONS.map((s) => html`
        <a key=${s.id} class=${`s-capsule-item${current === s.id ? " is-current" : ""}`} href=${s.href}
          aria-current=${current === s.id ? "page" : undefined}>
          <${Icon} name=${s.icon} />
          <span>${s.title}</span>
        </a>`)}
    </nav>`;
}

// True once the page has scrolled away from its top: the bar then lays a soft band of the canvas behind
// itself, so what scrolls under it does not read as part of it. The bar stays clear at rest.
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
    const on = () => setScrolled((window.scrollY || 0) > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

export function Topbar({ routeId, shell, narrow, settings, onSaveSettings, onNeeds, onMenu }) {
  const name = shell?.company?.name || "";
  const needs = Number(shell?.counts?.needsYou) || 0;
  const dot = engineDot(shell?.engine);
  const scrolled = useScrolled();
  const cls = `s-topbar${narrow ? " s-topbar--narrow" : ""}${scrolled ? " is-scrolled" : ""}`;

  if (narrow) {
    return html`
      <header class=${cls}>
        <${Brand} name=${name} />
        <span class="s-topbar-gap"></span>
        <${NeedsPill} count=${needs} onOpen=${onNeeds} current=${routeId === "needs-you"} />
        <button type="button" class="s-square" onClick=${onMenu} aria-label="Menu">
          <${Icon} name="menu" />
        </button>
      </header>`;
  }

  return html`
    <header class=${cls}>
      <div class="s-topbar-left"><${Brand} name=${name} /></div>
      <${Capsule} routeId=${routeId} />
      <div class="s-topbar-right">
        <${NeedsPill} count=${needs} onOpen=${onNeeds} current=${routeId === "needs-you"} />
        <a class=${`s-word${routeId === "jobs" || routeId === "job" ? " is-current" : ""}`} href="#/jobs"
          aria-current=${routeId === "jobs" ? "page" : undefined}>Jobs</a>
        <a class=${`s-word${routeId === "routines" ? " is-current" : ""}`} href="#/routines"
          aria-current=${routeId === "routines" ? "page" : undefined}>Routines</a>
        <a class=${`s-square${routeId === "health" ? " is-current" : ""}`} href="#/health"
          aria-label=${dot ? `Health: ${dot.words}` : "Health"} aria-current=${routeId === "health" ? "page" : undefined}>
          <${Icon} name="health" />
          ${dot ? html`<span class=${`s-square-dot s-square-dot--${dot.tone}`} aria-hidden="true"></span>` : null}
        </a>
        <a class=${`s-square${routeId === "settings" ? " is-current" : ""}`} href="#/settings" aria-label="Settings"
          aria-current=${routeId === "settings" ? "page" : undefined}>
          <${Icon} name="settings" />
        </a>
        <${ThemeSwitch} settings=${settings} onSave=${onSaveSettings} />
      </div>
    </header>`;
}

// The narrow layout's Menu sheet: New task and Search, Jobs, Routines, Team, Health, Settings, the theme
// switch and the seven departments.
export function MenuSheet({ open, onClose, shell, dock, settings, onSaveSettings, onCompose, onCommand }) {
  const known = new Map((Array.isArray(dock) ? dock : []).map((d) => [d && d.id, d]));
  const departments = DEPARTMENTS.map((d) => ({ id: d.id, title: cap(known.get(d.id)?.title, 40) || d.title }));
  const dot = engineDot(shell?.engine);
  const link = (href, icon, words, extra) => html`
    <li><a class="s-sheet-item" href=${href} onClick=${onClose}><${Icon} name=${icon} /><span>${words}</span>${extra || null}</a></li>`;
  return html`
    <${Drawer} open=${open} side="right" title="Menu" onClose=${onClose}>
      <div class="s-sheet">
        <ul class="s-sheet-list">
          <li><button type="button" class="s-sheet-item" onClick=${onCompose}><${Icon} name="plus" /><span>New task</span></button></li>
          <li><button type="button" class="s-sheet-item" onClick=${onCommand}><${Icon} name="search" /><span>Search</span><${Kbd}>${commandKey()}<//></button></li>
          ${link("#/jobs", "jobs", "Jobs")}
          ${link("#/routines", "routines", "Routines")}
          ${link("#/team", "team", "Team")}
          ${link("#/health", "health", "Health", dot ? html`<span class=${`s-square-dot s-square-dot--${dot.tone}`} aria-hidden="true"></span>` : null)}
          ${link("#/settings", "settings", "Settings")}
          <li><${ThemeSwitch} settings=${settings} onSave=${onSaveSettings} withWords=${true} /></li>
        </ul>
        <p class="s-sheet-title u-over">Departments</p>
        <ul class="s-sheet-list">
          ${departments.map((d) => html`
            <li key=${d.id}>
              <a class="s-sheet-item" href=${`#/departments/${encodeURIComponent(d.id)}`} onClick=${onClose} data-dept=${d.id}>
                <${Creature} id=${d.id} size=${16} still=${true} />
                <span>${d.title}</span>
              </a>
            </li>`)}
        </ul>
      </div>
    <//>`;
}
