// Team: every agent as a card, in the company file's order, each a link to its own page, with its department
// as a chip linking to that department (CONTRACTS-V2 17.5, CONTRACTS-V3 30 "Team and an agent").
// Which department an agent is in comes from the map's answer (GET /api/map, 33.2): every agent is in exactly one.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { AgentCard, Chip, Empty, ErrorNotice, Loading, NotConnected, PageHeader } from "../kit/index.js";

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const text = (v) => (v === null || v === undefined ? "" : String(v));

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

// The words under an agent's card: a note when it is not on the board yet. The department is its own chip.
export function cardNotes(agent) {
  return agent && agent.applied === false ? ["Not set up yet. Run: engine setup"] : [];
}

// The page's lead line: how many agents, and how many are working.
export function teamLead(agents) {
  const list = agents || [];
  if (!list.length) return "";
  const working = list.filter((a) => a && a.state === "working").length;
  const all = list.length === 1 ? "1 agent" : `${list.length} agents`;
  return working ? `${all}. ${working} working now.` : `${all}. None is working right now.`;
}

// The department chip: a link to the department's page, with its colour.
export function DeptChip({ department }) {
  if (!department || !SLUG.test(text(department.id))) return null;
  return html`<a class="p-team__dept" href=${`#/departments/${department.id}`} data-dept=${department.id}
    aria-label=${`${department.title}: open the department`}><${Chip} dot=${department.id}>${department.title}<//></a>`;
}

function Card({ agent, departments }) {
  const [note] = cardNotes(agent);
  const dept = departmentOf(agent.slug, departments);
  return html`<li class="p-team__item">
    <${AgentCard} agent=${agent} />
    ${(dept || note) && html`<div class="p-team__under">
      <${DeptChip} department=${dept} />
      ${note && html`<p class="p-team__note">${note}</p>`}
    </div>`}
  </li>`;
}

export default function Page() {
  const { shell } = useApp();
  const res = useResource("/api/team", { every: 10000 });
  const map = useResource("/api/map");
  const d = res.data;
  const agents = (d && Array.isArray(d.agents) ? d.agents : []).filter((a) => a && a.slug);
  const departments = map.data && Array.isArray(map.data.departments) ? map.data.departments : [];
  const company = text(shell && shell.company && shell.company.name);

  let body;
  if (!d && res.loading) body = html`<${Loading} lines=${4} label="Loading the team" />`;
  else if (!d && res.error) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  else {
    body = html`
      ${d && d.connected === false && html`<${NotConnected}
        title="The board is not answering"
        reason=${text(d.notConnected && d.notConnected.reason) || "The engine is not running."}
        next=${text(d.notConnected && d.notConnected.next) || "Run: engine start"} />`}
      ${agents.length
        ? html`<ul class="p-team__grid">${agents.map((a) => html`<${Card} key=${a.slug} agent=${a} departments=${departments} />`)}</ul>`
        : html`<${Empty} title="No agents yet" text="The company file names no agents." />`}`;
  }

  return html`<div class="p-team">
    <${PageHeader} over=${company ? `${company.slice(0, 40)} · Agents` : "Agents"} title="Team" lead=${teamLead(agents)} />
    ${body}
  </div>`;
}
