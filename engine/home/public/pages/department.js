// One page for Books, Customers, Support and People (CONTRACTS 9.6): figures, drafts with the approval card in
// place, the other tables, what is being worked on, ready-made goals, and the switches that are off.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  AgentChip, Card, Chip, DataTable, DecisionCard, ErrorNotice, Figures, Live, Loading, NotConnected,
  PageHeader, Section, StatusDot, Switch, Waiting,
} from "../kit/index.js";

const TITLES = { books: "Books", customers: "Customers", support: "Support", people: "People" };
const AGENTS = { books: "bookkeeper", customers: "sales", support: "support", people: "people" };
const DRAFT_SECTIONS = ["drafts", "draft_replies"];
const MAX_GOALS = 3;

// Splits the sections into the drafts group, the lead stages row and the plain tables.
export function splitSections(page) {
  const sections = Array.isArray(page?.sections) ? page.sections : [];
  const drafts = sections.filter((s) => DRAFT_SECTIONS.includes(s.id));
  const stages = sections.find((s) => s.id === "lead_stages") || null;
  const tables = sections.filter((s) => !DRAFT_SECTIONS.includes(s.id) && s.id !== "lead_stages");
  return { drafts, stages, tables };
}

// The inbox item a row points at, or null when it is not (or no longer) there.
export function itemFor(row, inbox) {
  if (!row || !row.inboxId) return null;
  const items = Array.isArray(inbox) ? inbox : Array.isArray(inbox?.items) ? inbox.items : [];
  return items.find((it) => it && it.id === row.inboxId) || null;
}

const text = (v) => (v == null || v === "" ? "—" : String(v));

function AgentState({ agent }) {
  if (!agent) return null;
  if (agent.state === "working") return html`<${Live} />`;
  if (agent.state === "waiting_for_you") return html`<${Waiting} />`;
  return html`<${StatusDot} tone=${agent.state === "problem" ? "bad" : agent.state === "paused" ? "off" : "ok"} label=${agent.plainState} />`;
}

function PlainRow({ section, row }) {
  const cols = section.columns || [];
  return html`
    <li class="p-department-plain">
      ${cols.map((c) => html`<span key=${c.key}><span class="p-department-label">${c.label}</span> ${text(row[c.key])}</span>`)}
    </li>`;
}

function DraftSection({ section, inbox }) {
  const rows = section.rows || [];
  return html`
    <${Section} title=${section.title || "Drafts waiting for you"} count=${rows.length}>
      ${rows.length === 0 ? html`<p class="p-department-empty">${section.emptyText || "Nothing waiting."}</p>` : html`
        <ul class="p-department-drafts">
          ${rows.map((row, i) => {
            const item = itemFor(row, inbox);
            return item
              ? html`<li key=${row.inboxId}><${DecisionCard} item=${item} compact /></li>`
              : html`<${PlainRow} key=${row.inboxId || i} section=${section} row=${row} />`;
          })}
        </ul>`}
    <//>`;
}

function StageRow({ section }) {
  const rows = section.rows || [];
  const cols = section.columns || [];
  const [a, b] = [cols[0]?.key || "stage", cols[1]?.key || "count"];
  return html`
    <${Section} title=${section.title}>
      ${rows.length === 0 ? html`<p class="p-department-empty">${section.emptyText || "Nothing here yet."}</p>` : html`
        <div class="p-department-stages">
          ${rows.map((r, i) => html`<${Chip} key=${i}>${text(r[a])} · ${text(r[b])}<//>`)}
        </div>`}
    <//>`;
}

function Goals({ id, gallery }) {
  const { openComposer } = useApp();
  const dep = (gallery?.departments || []).find((d) => d.id === id);
  const goals = (dep?.goals || []).slice(0, MAX_GOALS);
  if (!goals.length) return null;
  return html`
    <${Section} title="Ready-made goals" aside=${html`<a href=${`#/gallery?d=${encodeURIComponent(id)}`}>All ready-made goals</a>`}>
      <div class="p-department-goals">
        ${goals.map((g) => html`
          <${Card} key=${g.id} onClick=${() => openComposer({ text: g.text, to: g.to, planFirst: !!g.planFirst, template: g.id })}>
            <strong>${g.title}</strong>
            <p>${g.summary}</p>
          <//>`)}
      </div>
    <//>`;
}

export default function DepartmentPage({ route }) {
  const id = route?.id || "books";
  const title = TITLES[id] || "Department";
  const res = useResource(`/api/departments/${encodeURIComponent(id)}`, { every: 10000 });
  const inbox = useResource("/api/inbox", { every: 10000 });
  const gallery = useResource("/api/gallery", { every: 10000 });
  const d = res.data;
  const parts = d ? splitSections(d) : null;
  const connected = d ? d.connected !== false : true;

  return html`
    <div class="p-department">
      <${PageHeader} title=${d?.title || title}
        actions=${d?.agent ? html`<span class="p-department-agent"><${AgentChip} agent=${{ slug: AGENTS[id] || "", name: d.agent.name }} /><${AgentState} agent=${d.agent} /></span>` : null} />
      ${res.loading && !d ? html`<${Loading} lines=${4} />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${d && !connected ? html`<${NotConnected} reason=${d.notConnected?.reason} next=${d.notConnected?.next} />` : null}
      ${d && connected ? html`
        <${Figures} figures=${d.figures || []} />
        ${parts.drafts.map((s) => html`<${DraftSection} key=${s.id} section=${s} inbox=${inbox.data} />`)}
        ${parts.stages ? html`<${StageRow} section=${parts.stages} />` : null}
        ${parts.tables.map((s) => html`
          <${Section} key=${s.id} title=${s.title} count=${(s.rows || []).length}>
            <${DataTable} columns=${s.columns || []} rows=${s.rows || []} emptyText=${s.emptyText || "Nothing here yet."}
              renderCell=${(row, col) => text(row[col.key])} />
          <//>`)}
        ${(d.inFlight || []).length ? html`
          <${Section} title="In progress">
            <ul class="p-department-flight">
              ${d.inFlight.map((t) => html`
                <li key=${t.goalId}><a href=${`#/tasks/${encodeURIComponent(t.goalId)}`}>${t.title}</a> <span class="p-department-state">${t.plainState}</span></li>`)}
            </ul>
          <//>` : null}
        <${Goals} id=${id} gallery=${gallery.data} />` : null}
      ${d && (d.switches || []).length ? html`
        <${Section} title="Switched off">
          <div class="p-department-switches">
            ${d.switches.map((s) => html`<${Switch} key=${s.id} on=${false} disabled=${true} label=${s.label} explain=${s.explain} />`)}
          </div>
        <//>` : null}
    </div>`;
}
