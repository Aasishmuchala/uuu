// The tab bar (CONTRACTS-V3 26.2): below 860 px the five sections move from the top bar's capsule to a bar
// fixed at the bottom, under the thumb. Each tab is at least 44 px high.
import { html } from "../vendor/preact-htm.js";
import { Icon } from "../kit/index.js";
import { SECTIONS, sectionOf } from "../routes.js";

export function TabBar({ routeId }) {
  const current = sectionOf(routeId);
  return html`
    <nav class="s-tabbar s-glass" aria-label="Sections">
      ${SECTIONS.map((s) => html`
        <a key=${s.id} class=${`s-tab${current === s.id ? " is-current" : ""}`} href=${s.href}
          aria-current=${current === s.id ? "page" : undefined}>
          <${Icon} name=${s.icon} size=${20} />
          <span class="s-tab-word">${s.short || s.title}</span>
        </a>`)}
    </nav>`;
}
