// The dock (CONTRACTS-V3 26.2): a floating vertical glass capsule at the left edge, shown from 860 px up on
// the pages of work. Top: "+" (a new task). Then the company brain and the seven departments from
// shell.dock (26.4), each its creature with a tiny label, a link, and two marks: working (live) and
// something waiting for the owner (warm), whose words also show on hover. Bottom: the briefcase that stands
// for jobs everywhere else in the interface, a link to every job (M18-33, M18-C1).
import { html } from "../vendor/preact-htm.js";
import { Icon } from "../kit/index.js";
import { Creature } from "../kit/creature.js";
import { CREATURE_IDS } from "../kit/creature-data.js";
import { DEPARTMENTS } from "../routes.js";

// The pages that show the dock.
export const DOCK_PAGES = ["tasks", "task", "dept", "jobs", "job", "team", "agent", "needs-you"];

export const showsDock = (routeId) => DOCK_PAGES.includes(routeId);

// Until the server sends shell.dock: the brain and the seven departments, with no marks.
const FALLBACK = [{ id: "brain", title: "Company brain" }, ...DEPARTMENTS];

const whole = (n) => Math.max(0, Math.floor(Number(n) || 0));
const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// The dock's items from shell.dock: [{ id, title, creature, href, live, warm, label }]. `label` is what a
// screen reader says ("Sales, 1 working, 2 need you"). Ids that are not plain words are left out.
export function dockItems(dock) {
  const list = Array.isArray(dock) && dock.length ? dock : FALLBACK;
  const out = [];
  for (const d of list) {
    if (!d || typeof d.id !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(d.id)) continue;
    if (out.some((x) => x.id === d.id)) continue;
    const fallback = FALLBACK.find((f) => f.id === d.id);
    const title = cap(d.title, 40) || fallback?.title || d.id;
    const working = whole(d.working);
    const needsYou = whole(d.needsYou);
    const creature = CREATURE_IDS.includes(d.creature) ? d.creature : CREATURE_IDS.includes(d.id) ? d.id : null;
    const words = [title];
    if (working) words.push(`${working} working`);
    if (needsYou) words.push(`${needsYou} ${needsYou === 1 ? "needs" : "need"} you`);
    out.push({
      id: d.id,
      title,
      creature,
      href: d.id === "brain" ? "#/files" : `#/departments/${encodeURIComponent(d.id)}`,
      live: working > 0,
      warm: needsYou > 0,
      label: words.join(", "),
    });
  }
  return out;
}

// The department the page is about, for the dock's mark: a department's page, a job's page, or a list
// filtered to one department ("?d="). Null otherwise.
export function dockCurrent(routeId, parts = [], query) {
  if (routeId === "dept" || routeId === "job") return parts[1] || null;
  if (["jobs", "tasks", "needs-you"].includes(routeId) && query && typeof query.get === "function") return query.get("d") || null;
  return null;
}

export function Dock({ dock, current, onCompose }) {
  const items = dockItems(dock);
  return html`
    <nav class="s-dock s-glass" aria-label="Departments">
      <button type="button" class="s-dock-new" onClick=${onCompose} aria-label="New task" title="New task">
        <${Icon} name="plus" />
      </button>
      <ul class="s-dock-list">
        ${items.map((it) => html`
          <li key=${it.id}>
            <a class=${`s-dock-item${current === it.id ? " is-current" : ""}`} href=${it.href} data-dept=${it.id}
              aria-label=${it.label} title=${it.label} aria-current=${current === it.id ? "page" : undefined}>
              <span class="s-dock-face">
                ${it.creature ? html`<${Creature} id=${it.creature} size=${32} />` : html`<${Icon} name="brain" />`}
                ${it.live ? html`<span class="s-dock-live" aria-hidden="true"></span>` : null}
                ${it.warm ? html`<span class="s-dock-warm" aria-hidden="true"></span>` : null}
              </span>
              <span class="s-dock-label" aria-hidden="true">${it.id === "brain" ? "Brain" : it.title}</span>
            </a>
          </li>`)}
      </ul>
      <a class="s-dock-book" href="#/jobs" aria-label="Every job" title="Every job">
        <${Icon} name="jobs" />
      </a>
    </nav>`;
}
