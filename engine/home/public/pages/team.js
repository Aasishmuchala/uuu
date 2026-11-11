// Team: every agent as a card, in the company file's order, each a link to its own page. CONTRACTS-V2 17.5.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { AgentCard, Empty, ErrorNotice, Loading, NotConnected, PageHeader } from "../kit/index.js";

const DEPARTMENTS = {
  general: "Company",
  books: "Books",
  customers: "Customers",
  support: "Support",
  people: "People",
  marketing: "Marketing",
  studio: "Studio",
};

const text = (v) => (v === null || v === undefined ? "" : String(v));

// The department's plain title, from the shell's list when it has it. No department: "Company".
export function departmentLabel(id, departments = []) {
  if (!id) return DEPARTMENTS.general;
  const found = (departments || []).find((d) => d && d.id === id);
  return text(found ? found.title : DEPARTMENTS[id] || "");
}

// The words under an agent's card: its department, and a note when it is not on the board yet.
export function cardNotes(agent, departments) {
  const notes = [departmentLabel(agent && agent.department, departments)];
  if (agent && agent.applied === false) notes.push("Not set up yet. Run: engine setup");
  return notes.filter(Boolean);
}

// The page's lead line: how many agents, and how many are working.
export function teamLead(agents) {
  const list = agents || [];
  if (!list.length) return "";
  const working = list.filter((a) => a && a.state === "working").length;
  const all = list.length === 1 ? "1 agent" : `${list.length} agents`;
  return working ? `${all}. ${working} working now.` : `${all}. None is working right now.`;
}

function Card({ agent, departments }) {
  const [department, note] = cardNotes(agent, departments);
  return html`<li class="p-team__item">
    <${AgentCard} agent=${agent} />
    <p class="p-team__dept">${department}</p>
    ${note && html`<p class="p-team__note">${note}</p>`}
  </li>`;
}

export default function Page() {
  const { shell } = useApp();
  const res = useResource("/api/team", { every: 10000 });
  const d = res.data;
  const agents = (d && Array.isArray(d.agents) ? d.agents : []).filter((a) => a && a.slug);
  const departments = shell && Array.isArray(shell.departments) ? shell.departments : [];

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
    <${PageHeader} title="Team" lead=${teamLead(agents)} />
    ${body}
  </div>`;
}
