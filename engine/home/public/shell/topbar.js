// The top bar (PLAN-COOK T20, decision 11): 48 px over the page column, on the page's ground with a hairline
// under it. From the left: the button that shows or hides the sidebar's names, the crumbs (where you are; the
// page's own when it gave them through setTop, else the route table's), then at the right the pager and up to
// two quiet links when the page gave them, the Queue button (Q) and "Search or jump to" (⌘K). Below 860 px it
// is a back button and the last two crumbs. A page's one-line note (the money line) sits before the Queue button, or
// first in the Menu sheet below 860 px. The Menu sheet (the tab bar's More) is here too.
// On a second PC (a seat through the remote door, PLAN-DESKTOP T7) the bar shows one fixed line, from the shell's `seat`.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { Drawer, Icon, Kbd } from "../kit/index.js";
import { DEPARTMENTS, routeById } from "../routes.js";
import { setupItem } from "./sidenav.js";

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The Health row's dot from the shell's `engine` (CONTRACTS 9.2): "ok", "warn", "bad", or null when not
// known yet, with the words a screen reader says. `gate` is read when the shell sends it: a gate that is off
// is never "everything is on".
export function engineDot(engine) {
  if (!engine) return null;
  if (engine.board !== "on") return { tone: "bad", words: "the engine is off" };
  if (engine.gate === "off") return { tone: "bad", words: "the gate is off" };
  if (engine.books === "off") return { tone: "warn", words: "the books are off" };
  return { tone: "ok", words: "everything is on" };
}

// The fixed line a second PC shows (the shell's `seat` is set only on a seat's port), else null.
export const SEAT_LINE = "You are on a second PC. Keys, switches and money stay on the Mac.";
export function seatLine(shell) {
  const s = shell?.seat;
  return s && typeof s === "object" && Number.isInteger(s.n) ? SEAT_LINE : null;
}

// The name of Needs you (the sidebar's row, the Queue button, the phone's tab) for a screen reader.
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

const deptTitle = (id) => DEPARTMENTS.find((d) => d.id === id)?.title || id;
const word = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const crumb = (label, href) => (href ? { label: cap(label, 60), href } : { label: cap(label, 60) });

// The crumbs of a page that gave none, from its route and its address parts: the section as a link, then the
// page. `route` is a route id (or a route of the table). Labels are text, at most 60 characters.
export function defaultCrumbs(route, parts = []) {
  const id = typeof route === "string" ? route : route?.id;
  if (!id) return [];
  const p = Array.isArray(parts) ? parts : [];
  const title = routeById(id)?.title || "";
  switch (id) {
    case "map": return p[1] ? [crumb("Map", "#/map"), crumb(deptTitle(p[1]))] : [crumb("Map")];
    case "dept": return [crumb("Map", "#/map"), crumb(deptTitle(p[1]))];
    case "task": return [crumb("Tasks", "#/tasks"), crumb(p[1])];
    case "dashboard": return [crumb("Dashboards", "#/dashboards"), crumb(word(p[1]))];
    case "marketing":
    case "studio": return [crumb("Dashboards", "#/dashboards"), crumb(title)];
    case "job": return [crumb("Jobs", "#/jobs"), crumb(deptTitle(p[1])), crumb(p[2])];
    case "agent": return [crumb("Team", "#/team"), crumb(p[1])];
    case "routines": return p[1] ? [crumb("Routines", "#/routines"), crumb(p[1])] : [crumb("Routines")];
    case "files": return [crumb("Files")];
    case "app": return [crumb("App Studio", "#/apps"), crumb(p[1])];
    default: return title ? [crumb(title)] : [];
  }
}

// Only the home screen's own addresses are followed from the top bar.
const own = (href) => (typeof href === "string" && href.startsWith("#/") ? href : null);

// What a page gave through setTop, cleaned: crumbs as text with own addresses, a pager, at most two links.
export function cleanTop(top) {
  if (!top || typeof top !== "object") return null;
  const crumbs = Array.isArray(top.crumbs)
    ? top.crumbs.filter((c) => c && cap(c.label, 60)).map((c) => crumb(c.label, own(c.href))).slice(0, 5)
    : null;
  const pg = top.pager && typeof top.pager === "object" ? top.pager : null;
  const pager = pg && cap(pg.label, 20) ? { label: cap(pg.label, 20), prev: own(pg.prev), next: own(pg.next) } : null;
  const links = Array.isArray(top.links)
    ? top.links.filter((l) => l && own(l.href) && cap(l.label, 40)).slice(0, 2).map((l) => ({ label: cap(l.label, 40), href: l.href }))
    : [];
  // One quiet line a page may show (the Map's and Needs you's money line, the server's sentence): text, at most 120 characters, else dropped.
  const raw = typeof top.note === "string" ? top.note.replace(/\s+/g, " ").trim() : "";
  const note = raw && raw.length <= 120 ? raw : null;
  return { crumbs: crumbs && crumbs.length ? crumbs : null, pager, links, note };
}

function Crumbs({ list }) {
  return html`
    <nav class="s-crumbs" aria-label="Where you are">
      ${list.map((c, i) => {
        const last = i === list.length - 1;
        return html`
          ${i ? html`<span class="s-crumbs-sep" aria-hidden="true">/</span>` : null}
          ${last
            ? html`<span class="s-crumbs-here" aria-current="page">${c.label}</span>`
            : c.href ? html`<a class="s-crumbs-link" href=${c.href}>${c.label}</a>` : html`<span class="s-crumbs-link">${c.label}</span>`}`;
      })}
    </nav>`;
}

function Pager({ pager }) {
  const step = (href, icon, label) => (href
    ? html`<a class="s-icon-btn s-icon-btn--sm" href=${href} aria-label=${label} title=${label}><${Icon} name=${icon} /></a>`
    : html`<span class="s-icon-btn s-icon-btn--sm is-off" aria-hidden="true"><${Icon} name=${icon} /></span>`);
  return html`
    <div class="s-pager">
      <span class="s-pager-at u-num">${pager.label}</span>
      ${step(pager.prev, "chevron-left", "Previous")}
      ${step(pager.next, "chevron-right", "Next")}
    </div>`;
}

// True while the window is under 860 px, asked of the window itself on every resize. The shell says `narrow` too, but
// a window shrunk from a desktop's width can leave that a moment behind, and the wide bar (the Queue button and
// "Search or jump to" side by side) is wider than a phone: the bar then draws the phone's, whichever is first.
export const PHONE_QUERY = "(max-width: 859px)";
export function useWindowNarrow() {
  const get = () => typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const m = matchMedia(PHONE_QUERY);
    const look = () => setOn(m.matches);
    look();
    m.addEventListener?.("change", look);
    if (typeof addEventListener === "function") addEventListener("resize", look);
    return () => {
      m.removeEventListener?.("change", look);
      if (typeof removeEventListener === "function") removeEventListener("resize", look);
    };
  }, []);
  return on;
}

// `side` is the sidebar's width ("open" | "icons"); `queueOpen` says whether the queue is open.
export function Topbar({ routeId, parts, shell, top, narrow: shellNarrow, side = "open", queueOpen = false, onSide, onQueue, onCommand }) {
  const narrow = useWindowNarrow() || !!shellNarrow;
  const needs = Math.max(0, Math.floor(Number(shell?.counts?.needsYou) || 0));
  const crumbs = top?.crumbs || defaultCrumbs(routeId, parts);
  const seat = seatLine(shell);

  if (narrow) {
    const shown = crumbs.slice(-2);
    const parent = crumbs.slice(0, -1).reverse().find((c) => c.href)?.href || null;
    const back = (e) => {
      if (parent) return;
      e.preventDefault();
      history.back();
    };
    return html`
      <header class="s-top s-top--narrow">
        <a class="s-icon-btn" href=${parent || "#/"} onClick=${back} aria-label="Back"><${Icon} name="chevron-left" size=${20} /></a>
        <${Crumbs} list=${shown} />
      </header>`;
  }

  return html`
    <header class="s-top">
      <button type="button" class="s-icon-btn" onClick=${onSide} aria-label="Show or hide the names in the sidebar"
        aria-pressed=${side === "open" ? "true" : "false"} title="Show or hide the names in the sidebar ([)">
        <${Icon} name="sidebar" />
      </button>
      <${Crumbs} list=${crumbs} />
      <span class="s-top-gap"></span>
      ${seat ? html`<span class="s-top-note s-top-seat" role="note">${seat}</span>` : null}
      ${top?.pager ? html`<${Pager} pager=${top.pager} />` : null}
      ${(top?.links || []).map((l) => html`<a key=${l.href} class="s-top-link" href=${l.href}>${l.label}</a>`)}
      ${top?.note ? html`<span class="s-top-note u-num">${top.note}</span>` : null}
      <button type="button" class=${`s-queue-btn${queueOpen ? " is-open" : ""}`} onClick=${onQueue}
        aria-label=${`Queue: ${needsLabel(needs)}`} aria-expanded=${queueOpen ? "true" : "false"} aria-controls="s-queue">
        <${Icon} name="inbox" />
        <span aria-hidden="true">Queue</span>
        <${Kbd}>Q<//>
      </button>
      <button type="button" class="s-find" onClick=${onCommand}>
        <${Icon} name="search" />
        <span class="s-find-words">Search or jump to</span>
        <${Kbd}>${commandKey()}<//>
      </button>
    </header>`;
}

// The departments' line icons (the same as the sidebar's teams).
const DEPT_ICONS = { operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book" };

// The phone's More sheet: New task and Search, the places that are not tabs, the teams, Health, Settings and
// the theme switch.
export function MenuSheet({ open, onClose, shell, dock, note, settings, onSaveSettings, onCompose, onCommand, setup }) {
  const known = new Map((Array.isArray(dock) ? dock : []).map((d) => [d && d.id, d]));
  const departments = DEPARTMENTS.map((d) => ({ id: d.id, title: cap(known.get(d.id)?.title, 40) || d.title }));
  const dot = engineDot(shell?.engine);
  const to = switchedTheme(settings?.theme, systemDark());
  const themeWords = to === "light" ? "Switch to light" : "Switch to dark";
  const seat = seatLine(shell);
  const link = (href, icon, words, extra) => html`
    <li><a class="s-sheet-item" href=${href} onClick=${onClose}><${Icon} name=${icon} size=${20} /><span>${words}</span>${extra || null}</a></li>`;
  return html`
    <${Drawer} open=${open} side="right" title="More" onClose=${onClose}>
      <div class="s-sheet">
        ${note ? html`<p class="s-sheet-note u-num">${note}</p>` : null}
        ${seat ? html`<p class="s-sheet-note s-sheet-seat" role="note">${seat}</p>` : null}
        <ul class="s-sheet-list">
          <li><button type="button" class="s-sheet-item" onClick=${onCompose}><${Icon} name="plus" size=${20} /><span>New task</span></button></li>
          <li><button type="button" class="s-sheet-item" onClick=${onCommand}><${Icon} name="search" size=${20} /><span>Search</span><${Kbd}>${commandKey()}<//></button></li>
          ${link("#/map", "map", "Map")}
          ${link("#/apps", "apps", "App Studio")}
          ${setupItem(setup) ? link("#/setup", "check", "Setup") : null}
          ${link("#/jobs", "jobs", "Jobs")}
          ${link("#/routines", "routines", "Routines")}
          ${link("#/team", "team", "Team")}
        </ul>
        <h2 class="s-sheet-title">Teams</h2>
        <ul class="s-sheet-list">
          ${departments.map((d) => html`
            <li key=${d.id}>
              <a class="s-sheet-item" href=${`#/departments/${encodeURIComponent(d.id)}`} onClick=${onClose} data-dept=${d.id}>
                <${Icon} name=${DEPT_ICONS[d.id] || "layers"} size=${20} />
                <span>${d.title}</span>
              </a>
            </li>`)}
        </ul>
        <ul class="s-sheet-list s-sheet-list--foot">
          ${link("#/health", "health", "Health", dot ? html`<span class=${`s-dot s-dot--${dot.tone}`} aria-hidden="true"></span>` : null)}
          ${link("#/settings", "sliders", "Settings")}
          <li>
            <button type="button" class="s-sheet-item" onClick=${() => onSaveSettings && onSaveSettings({ theme: to })}>
              <${Icon} name=${to === "light" ? "sun" : "moon"} size=${20} /><span>${themeWords}</span>
            </button>
          </li>
        </ul>
      </div>
    <//>`;
}
