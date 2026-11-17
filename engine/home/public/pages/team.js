// Team: every agent, in the company file's order, as one row of the kit's table (CONTRACTS-V2 17.5, CONTRACTS-V3
// 30 "Team and an agent"; PLAN-COOK T65 after R06-agents): the avatar and the name (a link to its page) with its
// department under it, what it does, its state, what it is on now (a link to the task) and the model it runs on.
// Which department an agent is in comes from the map's answer (GET /api/map, 33.2): every agent is in exactly one.
// The model comes from GET /api/models; without that answer the column is left out.
// PLAN-3D-ALL U10: a surface screen. The title and its line stand in the room header (kit/room.js), the façade's
// glimpse behind them; the table stays on the ground. Beside each name the Map's lamp (world/state.js lampOf, a
// pure function: no three.js), so a state reads the same here as in the studio; the state's words are unchanged.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { lampOf } from "../world/state.js";
import { AgentState, Avatar, DataTable, Empty, ErrorNotice, Icon, Lamp, Loading, Mono, NotConnected, RoomHeader, glimpseFor } from "../kit/index.js";

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const text = (v) => (v === null || v === undefined ? "" : String(v));

// True while the window is 860 px wide or more (as Settings reads it). A department's and an agent's band ask for
// their picture only then: on a phone their head (title, line, state and actions) fills the band, and words over a
// picture read worse than words on the band's material (PLAN-3D-ALL U10). Read at once, so a phone never asks.
const WIDE = "(min-width: 860px)";
export function useWide() {
  const read = () => typeof matchMedia !== "function" || matchMedia(WIDE).matches === true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia(WIDE);
    const again = () => setWide(mq.matches === true);
    if (mq.addEventListener) mq.addEventListener("change", again);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", again); };
  }, []);
  return wide;
}

// The department an agent works in, from the map's departments ({ id, title, agents: [who] }): { id, title }, or
// null when the map is not read yet or does not name the agent.
export function departmentOf(slug, departments) {
  if (!slug) return null;
  for (const d of Array.isArray(departments) ? departments : []) {
    if (!d || !SLUG.test(text(d.id))) continue;
    const agents = Array.isArray(d.agents) ? d.agents : [];
    if (agents.some((a) => (typeof a === "string" ? a : a && a.slug) === slug)) {
      return { id: d.id, title: text(d.title).slice(0, 40) || d.id };
    }
  }
  return null;
}

// The words under an agent's card: a note only when the board answered and does not have the agent. With the
// board off `applied` is null (not known), and no card says anything: the notice above the cards says why.
// The department is its own chip.
export function cardNotes(agent) {
  return agent && agent.applied === false ? ["Not set up yet."] : [];
}

// The next step of a not-connected notice, in words with a link to Health (Health shows the command).
export function HealthNext({ text: words }) {
  const t = text(words).trim();
  const link = html`<a href="#/health">Open Health</a>`;
  // "Open Health to see how to start it." keeps its words, with "Open Health" as the link.
  const at = t.indexOf("Open Health");
  if (at >= 0 && !/\bRun:/.test(t)) return html`<span class="p-team__next">${t.slice(0, at)}${link}${t.slice(at + 11)}</span>`;
  // The sentence stays one text node, whole, as sent (PLAN-3D-ALL U10, S1); the space and the link after it.
  return html`<span class="p-team__next">${t && !/\bRun:/.test(t) ? t : ""}${t && !/\bRun:/.test(t) ? " " : ""}${link}</span>`;
}

// The page's lead line: how many agents, and how many are working.
export function teamLead(agents) {
  const list = agents || [];
  if (!list.length) return "";
  const working = list.filter((a) => a && a.state === "working").length;
  const all = list.length === 1 ? "1 agent" : `${list.length} agents`;
  return working ? `${all}. ${working} working now.` : `${all}. None is working right now.`;
}

// The department's link: its line icon and its name, in grey (no colour: O7).
export function DeptChip({ department }) {
  if (!department || !SLUG.test(text(department.id))) return null;
  return html`<a class="p-team__dept" href=${`#/departments/${department.id}`} data-dept=${department.id}
    aria-label=${`${department.title}: open the department`}><${Icon} name=${DEPT_ICONS[department.id] || "layers"} size=${14} /><span class="p-team__dept-name">${department.title}</span></a>`;
}

// The departments' line icons, as the sidebar draws them (shell/sidenav.js TEAM_ICONS).
const DEPT_ICONS = { brain: "brain", operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book" };

// The words this page adds (T65): the table's headings and the empty "on now".
export const WORDS = Object.freeze({
  agent: "Agent",
  role: "What it does",
  state: "State",
  now: "On now",
  model: "Model",
  nothing: "Nothing right now",
});

// The model an agent runs on, from GET /api/models: the one Omega Plus sends while that is on, else the one its
// plan uses. "" when the answer does not name the agent. Shown as written by the server, capped.
export function modelOf(slug, models) {
  if (!slug || !models || typeof models !== "object") return "";
  const a = (Array.isArray(models.agents) ? models.agents : []).find((x) => x && x.slug === slug);
  if (!a) return "";
  const v = models.mode === "provider" ? a.pickName || a.pick : a.plansModel;
  return typeof v === "string" ? v.trim().slice(0, 40) : "";
}

// The table's columns; the model's only when the models' answer came.
export function teamColumns(withModel) {
  const cols = [
    { key: "agent", label: WORDS.agent, align: "start" },
    { key: "role", label: WORDS.role, align: "start" },
    { key: "state", label: WORDS.state, align: "start" },
    { key: "now", label: WORDS.now, align: "start" },
  ];
  return withModel ? [...cols, { key: "model", label: WORDS.model, align: "start" }] : cols;
}

function Cell({ agent, column, departments, models }) {
  const a = agent;
  if (column === "agent") {
    const [note] = cardNotes(a);
    const dept = departmentOf(a.slug, departments);
    return html`<span class="p-team__who">
      <${Avatar} slug=${a.slug} name=${a.name} size=${32} />
      <span class="p-team__who-text">
        <span class="p-team__name-line"><${Lamp} state=${lampOf(a)} /><a class="p-team__name" href=${`#/team/${encodeURIComponent(a.slug)}`}>${text(a.name) || a.slug}</a></span>
        ${dept && html`<${DeptChip} department=${dept} />`}
        ${note && html`<span class="p-team__note">${note} <a href="#/health">Open Health</a></span>`}
      </span>
    </span>`;
  }
  if (column === "role") return html`<span class="p-team__role">${text(a.summary).slice(0, 300)}</span>`;
  if (column === "state") return html`<${AgentState} agent=${a} />`;
  if (column === "now") {
    const now = a.doingNow && a.doingNow.title ? text(a.doingNow.title).slice(0, 120) : "";
    const id = a.doingNow && typeof a.doingNow.taskId === "string" ? a.doingNow.taskId : "";
    if (!now) return html`<span class="p-team__none">${WORDS.nothing}</span>`;
    return id ? html`<a class="p-team__task" href=${`#/tasks/${encodeURIComponent(id)}`}>${now}</a>` : html`<span class="p-team__task">${now}</span>`;
  }
  const m = modelOf(a.slug, models);
  return m ? html`<span class="p-team__model"><${Mono}>${m}<//></span>` : null;
}

export default function Page() {
  const res = useResource("/api/team", { every: 10000 });
  const map = useResource("/api/map");
  const models = useResource("/api/models");
  const d = res.data;
  const agents = (d && Array.isArray(d.agents) ? d.agents : []).filter((a) => a && a.slug);
  const departments = map.data && Array.isArray(map.data.departments) ? map.data.departments : [];
  const withModel = Boolean(models.data && Array.isArray(models.data.agents) && agents.some((a) => modelOf(a.slug, models.data)));

  let body;
  if (!d && res.loading) body = html`<${Loading} lines=${4} label="Loading the team" />`;
  else if (!d && res.error) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  else {
    body = html`
      ${d && d.connected === false && html`<${NotConnected}
        title="The board is switched off"
        reason=${text(d.notConnected && d.notConnected.reason) || "The board is switched off, so agents and tasks cannot be reached."}
        next=${html`<${HealthNext} text=${d.notConnected && d.notConnected.next} />`} />`}
      ${agents.length
        ? html`<div class="p-team__table"><${DataTable} columns=${teamColumns(withModel)} rows=${agents.map((a) => ({ ...a, id: a.slug }))}
            renderCell=${(row, col) => html`<${Cell} agent=${row} column=${col.key} departments=${departments} models=${models.data} />`} /></div>`
        : html`<${Empty} title="No agents yet" text="The company file names no agents." />`}`;
  }

  return html`<div class="p-team">
    <${RoomHeader} glimpse=${glimpseFor("team")} title="Team" lead=${teamLead(agents)} />
    ${body}
  </div>`;
}
