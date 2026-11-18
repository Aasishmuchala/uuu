// The sidebar (PLAN-COOK T20, decision 8): from 860 px up, the left column of every page. The brand row; Needs
// you with its count; Setup with the steps left, while the guided setup is shown (PLAN-ONBOARD); the places (Map, Tasks, Dashboards, Files, App Studio, Jobs, Routines); "Teams": the
// brain and the seven departments from shell.dock, each its line icon and, at the right, a count when something
// needs the owner; then, at the foot under a rule, Health, Settings and the theme switch. A dot means one thing
// only: red, something is wrong there (the engine's Health row); "working" has no dot, the Map shows who works.
// Two widths: open (names beside the icons) and icons (names hidden, each row says its name in a tooltip).
// The department creatures are retired from the chrome; the icons are the kit's line icons.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "../kit/index.js";
import { DEPARTMENTS } from "../routes.js";
import { engineDot, needsLabel, switchedTheme } from "./topbar.js";

// Where this browser keeps the owner's choice of width ("open" or "icons"; nothing means automatic).
export const SIDE_KEY = "home.side";

// The sidebar's width: "none" under 860 px; else the owner's stored choice; else icons on a page with a stage
// or in a window under 1100 px, and open otherwise.
export function sideMode({ stored, stage, width } = {}) {
  const w = Number(width);
  if (Number.isFinite(w) && w < 860) return "none";
  if (stored === "open" || stored === "icons") return stored;
  if (stage === true || (Number.isFinite(w) && w < 1100)) return "icons";
  return "open";
}

// Until the server sends shell.dock: the brain and the seven departments, with no marks.
const FALLBACK = [{ id: "brain", title: "Company brain" }, ...DEPARTMENTS];

// Each team's line icon.
export const TEAM_ICONS = {
  brain: "brain", operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book",
};

const whole = (n) => Math.max(0, Math.floor(Number(n) || 0));
const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The teams from shell.dock: [{ id, title, icon, href, live, warm, count, label }]. `label` is what a screen
// reader says ("Sales, 1 working, 2 need you"); `count` is how many things need the owner. Ids that are not
// plain words are left out.
export function teamItems(dock) {
  const list = Array.isArray(dock) && dock.length ? dock : FALLBACK;
  const out = [];
  for (const d of list) {
    if (!d || typeof d.id !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(d.id)) continue;
    if (out.some((x) => x.id === d.id)) continue;
    const fallback = FALLBACK.find((f) => f.id === d.id);
    const title = cap(d.title, 40) || fallback?.title || d.id;
    const working = whole(d.working);
    const needsYou = whole(d.needsYou);
    const words = [title];
    if (working) words.push(`${working} working`);
    if (needsYou) words.push(`${needsYou} ${needsYou === 1 ? "needs" : "need"} you`);
    out.push({
      id: d.id,
      title,
      icon: TEAM_ICONS[d.id] || "layers",
      href: d.id === "brain" ? "#/files" : `#/departments/${encodeURIComponent(d.id)}`,
      live: working > 0,
      warm: needsYou > 0,
      count: needsYou,
      label: words.join(", "),
    });
  }
  return out;
}

// The department the page is about: a department's page, a job's page, or a list filtered to one department
// ("?d="). Null otherwise.
export function teamCurrent(routeId, parts = [], query) {
  if (routeId === "dept" || routeId === "job") return parts[1] || null;
  if (["jobs", "tasks", "needs-you"].includes(routeId) && query && typeof query.get === "function") return query.get("d") || null;
  return null;
}

// Which of the sidebar's own rows is the current place on a page, or null. On a department's page the open
// sidebar marks the department's row instead (see Sidenav); the icons-only one, whose teams are hidden, marks Map.
const CURRENT = {
  "needs-you": "needs-you", map: "map", dept: "map",
  tasks: "tasks", task: "tasks",
  dashboards: "dashboards", dashboard: "dashboards", marketing: "dashboards", studio: "dashboards",
  files: "files", apps: "apps", app: "apps", jobs: "jobs", job: "jobs", routines: "routines",
  health: "health", settings: "settings", setup: "setup",
};
export function sideCurrent(routeId, mode = "open") {
  if (routeId === "dept" && mode === "open") return null;
  return CURRENT[routeId] || null;
}

// The places, in the sidebar's order.
export const PLACES = [
  { id: "map", title: "Map", href: "#/map", icon: "map" },
  { id: "tasks", title: "Tasks", href: "#/tasks", icon: "tasks" },
  { id: "dashboards", title: "Dashboards", href: "#/dashboards", icon: "dashboards" },
  { id: "files", title: "Files", href: "#/files", icon: "folder" },
  { id: "apps", title: "App Studio", href: "#/apps", icon: "apps" },
  { id: "jobs", title: "Jobs", href: "#/jobs", icon: "jobs" },
  { id: "routines", title: "Routines", href: "#/routines", icon: "routines" },
];

// The Setup row (PLAN-ONBOARD decision 6), from GET /api/setup: null unless the server says to show it. `count` is how
// many of the five steps are left; a step skipped for now counts as dealt with.
export function setupItem(setup) {
  if (!setup || setup.show !== true) return null;
  const c = setup.counts || {};
  const n = Math.min(5, whole(c.done) + whole(c.skipped));
  return { href: "#/setup", icon: "check", title: "Setup", label: `Setup: ${n} of 5 done`, count: 5 - n };
}

function systemDark() {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

// One row. `label` is its name for a screen reader and its tooltip when the sidebar shows icons only. `count` is a
// number in the right-hand column; `chip` makes it the kit's chip (Needs you); `mark` is a dot, red only.
function Go({ href, icon, title, label, current, count, chip, mark, onClick }) {
  const text = count > 99 ? "99+" : count;
  const n = count
    ? chip
      ? html`<span class="k-tag k-tag--info s-go-count s-go-count--chip u-num" aria-hidden="true">${text}</span>`
      : html`<span class="s-go-count u-num" aria-hidden="true">${text}</span>`
    : null;
  const inner = html`
    <${Icon} name=${icon} size=${18} />
    <span class="s-go-label">${title}</span>
    ${mark || null}${n}`;
  if (!href) {
    return html`<button type="button" class="s-go" onClick=${onClick} aria-label=${label} data-tip=${label}>${inner}</button>`;
  }
  return html`
    <a class=${`s-go${current ? " is-current" : ""}`} href=${href} aria-label=${label} data-tip=${label}
      aria-current=${current ? "page" : undefined}>${inner}</a>`;
}

export function Sidenav({ mode = "open", routeId, parts, query, shell, dock, settings, onSaveSettings, setup }) {
  const name = cap(shell?.company?.name, 40) || "Home";
  const needs = whole(shell?.counts?.needsYou);
  const dot = engineDot(shell?.engine);
  const here = sideCurrent(routeId, mode);
  const start = setupItem(setup);
  const team = mode === "open" && routeId === "dept" ? teamCurrent(routeId, parts, query) : null;
  const to = switchedTheme(settings?.theme, systemDark());
  const themeWords = to === "light" ? "Switch to light" : "Switch to dark";
  return html`
    <nav class=${`s-side s-side--${mode === "icons" ? "icons" : "open"}`} aria-label=${name}>
      <a class="s-brand" href="#/map" aria-label=${`${name}, the map`} data-tip=${`${name}, the map`}>
        <span class="s-brand-mark" aria-hidden="true">${name.slice(0, 1).toUpperCase()}</span>
        <span class="s-brand-name u-truncate" aria-hidden="true">${name}</span>
      </a>
      <${Go} href="#/needs-you" icon="inbox" title="Needs you" label=${needsLabel(needs)} current=${here === "needs-you"} count=${needs} chip=${true} />
      ${start ? html`
        <${Go} href=${start.href} icon=${start.icon} title=${start.title} label=${start.label} current=${here === "setup"} count=${start.count} />` : null}
      ${PLACES.map((p) => html`
        <${Go} key=${p.id} href=${p.href} icon=${p.icon} title=${p.title} label=${p.title} current=${here === p.id} />`)}
      <div class="s-side-team">
        <h2 class="s-side-title">Teams</h2>
        ${teamItems(dock).map((t) => html`
          <${Go} key=${t.id} href=${t.href} icon=${t.icon} title=${t.id === "brain" ? "Brain" : t.title} label=${t.label}
            current=${team === t.id} count=${t.count} />`)}
      </div>
      <span class="s-side-gap"></span>
      <div class="s-side-foot">
        <${Go} href="#/health" icon="health" title="Health" label=${dot ? `Health: ${dot.words}` : "Health"} current=${here === "health"}
          mark=${dot && (dot.tone === "bad" || dot.tone === "warn") ? html`<span class=${`s-dot s-dot--${dot.tone}`} title=${dot.words} aria-hidden="true"></span>` : null} />
        <${Go} href="#/settings" icon="sliders" title="Settings" label="Settings" current=${here === "settings"} />
        <${Go} icon=${to === "light" ? "sun" : "moon"} title=${themeWords} label=${themeWords} onClick=${() => onSaveSettings && onSaveSettings({ theme: to })} />
      </div>
    </nav>`;
}
