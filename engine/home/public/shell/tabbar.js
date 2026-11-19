// The phone's tab bar (PLAN-COOK T20, decision O10): below 860 px, five tabs fixed at the bottom, under the
// thumb: Needs you (with its count), Tasks, Dashboards, Files, and More, which opens the More sheet with the
// rest. Each tab is at least 44 px high: a 22 px icon over a 12 px word.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "../kit/index.js";
import { needsLabel } from "./topbar.js";

export const TABS = [
  { id: "needs-you", title: "Needs you", href: "#/needs-you", icon: "inbox" },
  { id: "tasks", title: "Tasks", href: "#/tasks", icon: "tasks" },
  { id: "dashboards", title: "Dashboards", href: "#/dashboards", icon: "dashboards" },
  { id: "files", title: "Files", href: "#/files", icon: "folder" },
];

// The tab that is the current place on a page, or null (the pages the More sheet holds).
const OF = {
  "needs-you": "needs-you", tasks: "tasks", task: "tasks",
  dashboards: "dashboards", dashboard: "dashboards", marketing: "dashboards", studio: "dashboards", files: "files",
};
export const tabOf = (routeId) => OF[routeId] || null;

// partial: the count is a floor (a part did not answer): said with "at least" and a plus.
export function TabBar({ routeId, needs = 0, partial = false, moreOpen = false, onMore }) {
  const current = tabOf(routeId);
  const n = Math.max(0, Math.floor(Number(needs) || 0));
  return html`
    <nav class="s-tabbar" aria-label="Sections">
      ${TABS.map((t) => html`
        <a key=${t.id} class=${`s-tab${current === t.id ? " is-current" : ""}`} href=${t.href}
          aria-current=${current === t.id ? "page" : undefined} aria-label=${t.id === "needs-you" ? needsLabel(n, partial) : undefined}>
          <span class="s-tab-icon">
            <${Icon} name=${t.icon} size=${22} />
            ${t.id === "needs-you" && (n || partial) ? html`<span class="s-tab-count u-num" aria-hidden="true">${n > 99 ? "99+" : partial ? `${n}+` : n}</span>` : null}
          </span>
          <span class="s-tab-word">${t.title}</span>
        </a>`)}
      <button type="button" class="s-tab" onClick=${onMore} aria-expanded=${moreOpen ? "true" : "false"} aria-haspopup="dialog">
        <span class="s-tab-icon"><${Icon} name="more" size=${22} /></span>
        <span class="s-tab-word">More</span>
      </button>
    </nav>`;
}
