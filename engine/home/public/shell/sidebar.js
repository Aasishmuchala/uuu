// The left sidebar (CONTRACTS-V2 14.2): the company name, New task, Search; Home, Tasks, Docs; the
// Team with one row per agent; the Departments; and Routines, Health, Settings and the engine line at
// the bottom. The same component fills the narrow window's drawer.
import { html } from "../vendor/preact-htm.js";
import { Avatar, Icon, Kbd, NextStep, StatusDot } from "../kit/index.js";
import { DEPARTMENT_IDS, ROUTES, routeById } from "../routes.js";

// The sidebar's mark for an agent: "live", "warn", "bad", or null (free, paused).
export function agentMark(agent) {
  if (!agent) return null;
  if (agent.state === "working") return { tone: "live", label: "Working" };
  if (agent.waitingForYou || agent.state === "waiting_for_you") return { tone: "warn", label: "Waiting for you" };
  if (agent.state === "problem") return { tone: "bad", label: "Has a problem" };
  return null;
}

// One plain line about the engine, from the shell's `engine` (CONTRACTS 9.2).
export function engineLine(engine) {
  if (!engine) return null;
  if (engine.board !== "on") return { tone: "bad", text: "Engine off" };
  if (engine.books === "off") return { tone: "warn", text: "Books are off" };
  return { tone: "ok", text: "Engine on" };
}

// The macOS command key or Ctrl, for the hint beside Search.
export function commandKey() {
  const p = typeof navigator === "undefined" ? "" : String(navigator.platform || navigator.userAgent || "");
  return /Mac|iPhone|iPad/i.test(p) ? "⌘K" : "Ctrl K";
}

function NavItem({ href, icon, label, current, count, countLabel, onNavigate }) {
  return html`
    <a class=${`s-nav-item${current ? " is-current" : ""}`} href=${href} aria-current=${current ? "page" : undefined} onClick=${onNavigate}>
      ${icon ? html`<${Icon} name=${icon} />` : null}
      <span class="s-nav-label u-truncate">${label}</span>
      ${count ? html`<span class="s-count" aria-label=${countLabel}>${count}</span>` : null}
    </a>`;
}

function TeamRow({ agent, current, onNavigate }) {
  const mark = agentMark(agent);
  return html`
    <a class=${`s-nav-item s-agent${current ? " is-current" : ""}`} href=${`#/team/${encodeURIComponent(agent.slug)}`}
      aria-current=${current ? "page" : undefined} onClick=${onNavigate}>
      <${Avatar} slug=${agent.slug} name=${agent.name} size=${20} />
      <span class="s-nav-label u-truncate">${agent.name}</span>
      ${mark ? html`<span class="s-mark"><${StatusDot} tone=${mark.tone} label=${mark.label} hideLabel=${true} pulse=${mark.tone === "live"} /></span>` : null}
    </a>`;
}

function Group({ title, href, current, onNavigate, children }) {
  return html`
    <div class="s-group">
      ${href
        ? html`<a class=${`s-group-title${current ? " is-current" : ""}`} href=${href} aria-current=${current ? "page" : undefined} onClick=${onNavigate}>${title}</a>`
        : html`<p class="s-group-title">${title}</p>`}
      ${children}
    </div>`;
}

export function Sidebar({ routeId, parts = [], shell, shellError, onCompose, onCommand, onNavigate, inDrawer }) {
  const name = shell?.company?.name || "";
  const counts = shell?.counts || {};
  const team = Array.isArray(shell?.team) ? shell.team : [];
  const known = new Map((Array.isArray(shell?.departments) ? shell.departments : []).map((d) => [d.id, d]));
  const departments = DEPARTMENT_IDS.map((id) => ({ id, title: known.get(id)?.title || routeById(id).title, connected: known.get(id)?.connected !== false }));
  const engine = engineLine(shell?.engine);
  const nav = (group) => ROUTES.filter((r) => r.nav === group);
  const needs = Number(counts.needsYou) || 0;

  return html`
    <nav class=${`s-sidebar${inDrawer ? " s-sidebar--drawer" : ""}`} aria-label="Main">
      ${inDrawer ? null : html`
        <div class="s-brand">
          <span class="s-brand-mark" aria-hidden="true">${(name || "H").slice(0, 1).toUpperCase()}</span>
          <span class="s-brand-name u-truncate">${name || "Home"}</span>
        </div>`}
      <div class="s-actions">
        <button type="button" class="s-new" onClick=${onCompose}>
          <${Icon} name="plus" />
          <span class="u-grow">New task</span>
          <${Kbd}>C<//>
        </button>
        <button type="button" class="s-search" onClick=${onCommand}>
          <${Icon} name="search" />
          <span class="u-grow">Search</span>
          <${Kbd}>${commandKey()}<//>
        </button>
      </div>

      ${shellError ? html`
        <div class="s-offline" role="status">
          <p>${shellError.message}</p>
          ${shellError.next ? html`<${NextStep} text=${shellError.next} />` : null}
        </div>` : null}

      <div class="s-scroll">
        <div class="s-group">
          ${nav("main").map((r) => html`
            <${NavItem} href=${`#/${r.id}`} icon=${r.icon} label=${r.title} current=${routeId === r.id || (r.id === "tasks" && routeId === "task")}
              count=${r.id === "home" && needs ? needs : 0} countLabel=${`${needs} need you`} onNavigate=${onNavigate} />`)}
        </div>

        <${Group} title="Team" href="#/team" current=${routeId === "team"} onNavigate=${onNavigate}>
          ${team.length
            ? team.map((a) => html`<${TeamRow} agent=${a} current=${routeId === "agent" && parts[1] === a.slug} onNavigate=${onNavigate} />`)
            : html`<p class="s-quiet">${shell ? "No agents yet." : shellError ? "Not available right now." : "Loading"}</p>`}
        <//>

        <${Group} title="Departments">
          ${departments.map((d) => html`
            <a class=${`s-nav-item${routeId === d.id ? " is-current" : ""}`} href=${`#/${d.id}`} aria-current=${routeId === d.id ? "page" : undefined} onClick=${onNavigate}>
              <${Icon} name=${routeById(d.id).icon} />
              <span class="s-nav-label u-truncate">${d.title}</span>
              ${d.connected ? null : html`<span class="s-mark"><${StatusDot} tone="off" label="Not connected" hideLabel=${true} /></span>`}
            </a>`)}
        <//>
      </div>

      <div class="s-bottom">
        ${nav("bottom").map((r) => html`
          <${NavItem} href=${`#/${r.id}`} icon=${r.icon} label=${r.title} current=${routeId === r.id} onNavigate=${onNavigate} />`)}
        ${engine ? html`
          <a class="s-engine" href="#/health" onClick=${onNavigate}>
            <${StatusDot} tone=${engine.tone} label=${engine.text} />
          </a>` : null}
      </div>
    </nav>`;
}
