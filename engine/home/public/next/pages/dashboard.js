// One page for Books, Customers, Support and People (CONTRACTS 9.6, CONTRACTS-V3 30), at #/dashboards/<id>:
// the figures as stat tiles, drafts with the approval card in place, the other sections as tables with status
// chips (Books also shows its quotations), what is being worked on, jobs to start, the switches that are off,
// and a link to the department.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import {
  AgentChip, Chip, DataTable, DecisionCard, ErrorNotice, Figures, Icon, JobRow, Live, Loading, NotConnected,
  PageHeader, Section, StatusDot, Switch, Waiting,
} from "../kit/index.js";

const TITLES = { books: "Books", customers: "Customers", support: "Support", people: "People" };
const AGENTS = { books: "bookkeeper", customers: "sales", support: "support", people: "people" };
// The department each dashboard belongs to (its creature, its colour, its page).
export const DEPARTMENTS = { books: "books", customers: "sales", support: "support", people: "people" };
const DRAFT_SECTIONS = ["drafts", "draft_replies"];
// Sections whose rows owe money and carry a due date: their status is worked out from it.
const DUE_SECTIONS = ["unpaid_invoices", "unpaid_bills"];
// Columns whose words are shown as chips.
const CHIP_KEYS = ["status", "stage"];
const STATUS_KEY = "_status";
const MAX_JOBS = 3;
const TEXT_MAX = 200;

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

// Status words and the tone of their chip's dot. Words not listed get a quiet grey dot; stages of a lead or
// deal still open get the Sales colour.
const OK = ["paid", "final", "approved", "accepted", "present", "won", "converted", "resolved", "closed", "ordered", "submitted", "done"];
const WARN = ["unpaid", "waiting for you", "open", "partly paid", "partially paid", "on hold", "half day"];
const BAD = ["lost", "rejected", "absent", "expired", "cancelled", "do not contact"];
const OFF = ["draft", "replied", "paused", "on leave", "not sent"];
const STAGES = ["new", "lead", "contacted", "interested", "qualified", "qualification", "opportunity", "proposal", "proposal/price quote", "negotiation", "needs analysis", "quotation"];

// A status or stage word → { label, tone } for a chip, or null when there is no word. `tone` is a state tone
// (ok, warn, bad, off) or "sales" for an open stage. "Overdue by 12 days" and "overdue 12d" are bad.
export function statusChip(value) {
  if (value === null || value === undefined) return null;
  const label = String(value).replace(/\s+/g, " ").trim().slice(0, 60);
  if (!label || label === "—") return null;
  const w = label.toLowerCase();
  if (/^overdue\b/.test(w)) return { label, tone: "bad" };
  if (OK.includes(w)) return { label, tone: "ok" };
  if (WARN.includes(w)) return { label, tone: "warn" };
  if (BAD.includes(w)) return { label, tone: "bad" };
  if (OFF.includes(w)) return { label, tone: "off" };
  if (STAGES.includes(w)) return { label, tone: "sales" };
  return { label, tone: "off" };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// A date as the server writes it ("11 Dec 2026", or "2026-12-11") → a UTC day number, or null.
export function dayOf(text) {
  const s = String(text ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5);
  m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month >= 0) return Math.floor(Date.UTC(+m[3], month, +m[1]) / 864e5);
  }
  return null;
}

const todayOf = (now) => {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
};

// The status of a row that is still owed: "Overdue by n days" after its due date, else "Unpaid".
export function dueStatus(due, now) {
  const day = dayOf(due);
  if (day === null) return "Unpaid";
  const late = todayOf(now) - day;
  if (late <= 0) return "Unpaid";
  return `Overdue by ${late} ${late === 1 ? "day" : "days"}`;
}

// A section ready for its table: the unpaid sections gain a Status column worked out from the due date.
export function withStatus(section, now) {
  if (!section || !DUE_SECTIONS.includes(section.id)) return section;
  const columns = Array.isArray(section.columns) ? section.columns : [];
  if (columns.some((c) => c.key === "status")) return section;
  const rows = (Array.isArray(section.rows) ? section.rows : []).map((r) => ({ ...r, [STATUS_KEY]: dueStatus(r?.due, now) }));
  return { ...section, columns: [...columns, { key: STATUS_KEY, label: "Status" }], rows };
}

// The ready jobs of the department first, then the others, at most n, from GET /api/map/<department>.
export function jobsToStart(mapDept, n = MAX_JOBS) {
  const clusters = Array.isArray(mapDept?.clusters) ? mapDept.clusters : [];
  const jobs = clusters.flatMap((c) => (Array.isArray(c?.jobs) ? c.jobs : [])).filter((j) => j && typeof j === "object");
  return [...jobs.filter((j) => j.ready !== false), ...jobs.filter((j) => j.ready === false)].slice(0, n);
}

const text = (v) => (v == null || v === "" ? "—" : String(v).slice(0, TEXT_MAX));

function StatusChip({ value }) {
  const c = statusChip(value);
  if (!c) return text(value);
  return html`<${Chip} dot=${c.tone}>${c.label}<//>`;
}

const renderCell = (row, col) =>
  CHIP_KEYS.includes(col.key) || col.key === STATUS_KEY ? html`<${StatusChip} value=${row[col.key]} />` : text(row[col.key]);

function AgentState({ agent }) {
  if (!agent) return null;
  if (agent.state === "working") return html`<${Live} />`;
  if (agent.state === "waiting_for_you") return html`<${Waiting} />`;
  return html`<${StatusDot} tone=${agent.state === "problem" ? "bad" : agent.state === "paused" ? "warn" : "off"} label=${text(agent.plainState)} />`;
}

function PlainRow({ section, row }) {
  const cols = section.columns || [];
  return html`
    <li class="p-dashboard-plain">
      ${cols.map((c) => html`<span key=${c.key}><span class="p-dashboard-label">${c.label}</span> ${text(row[c.key])}</span>`)}
    </li>`;
}

function DraftSection({ section, inbox }) {
  const rows = section.rows || [];
  return html`
    <${Section} title=${section.title || "Drafts waiting for you"} count=${rows.length}>
      ${rows.length === 0 ? html`<p class="p-dashboard-empty">${section.emptyText || "Nothing waiting."}</p>` : html`
        <ul class="p-dashboard-drafts">
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
      ${rows.length === 0 ? html`<p class="p-dashboard-empty">${section.emptyText || "Nothing here yet."}</p>` : html`
        <ul class="p-dashboard-stages">
          ${rows.map((r, i) => html`
            <li key=${i} class="p-dashboard-stage">
              <span class="p-dashboard-stage-count">${text(r[b])}</span>
              <span class="p-dashboard-stage-name">${text(r[a])}</span>
            </li>`)}
        </ul>`}
    <//>`;
}

function Jobs({ dept }) {
  const res = useResource(`/api/map/${encodeURIComponent(dept)}`, { every: 10000 });
  const jobs = jobsToStart(res.data);
  if (!jobs.length) return null;
  return html`
    <${Section} title="Jobs to start" aside=${html`<a href=${`#/jobs?d=${encodeURIComponent(dept)}`}>Every job</a>`}>
      <div class="p-dashboard-jobs">
        ${jobs.map((j) => html`<${JobRow} key=${j.id} job=${j} />`)}
      </div>
    <//>`;
}

export default function DashboardPage({ route }) {
  const asked = route?.parts?.[1];
  const id = Object.hasOwn(TITLES, asked) ? asked : "books";
  const title = TITLES[id];
  const dept = DEPARTMENTS[id];
  const res = useResource(`/api/departments/${encodeURIComponent(id)}`, { every: 10000 });
  const inbox = useResource("/api/inbox", { every: 10000 });
  const d = res.data;
  const parts = d ? splitSections(d) : null;
  const connected = d ? d.connected !== false : true;
  const now = new Date();

  return html`
    <div class="p-dashboard" data-dept=${dept}>
      <${PageHeader} title=${title} over="DASHBOARD" creature=${dept}
        back=${{ href: "#/dashboards", label: "All dashboards" }}
        actions=${d?.agent ? html`<span class="p-dashboard-agent"><${AgentChip} agent=${{ slug: AGENTS[id], name: text(d.agent.name) }} /><${AgentState} agent=${d.agent} /></span>` : null} />
      ${res.loading && !d ? html`<${Loading} lines=${4} />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${d && !connected ? html`<${NotConnected} reason=${d.notConnected?.reason} next=${d.notConnected?.next} />` : null}
      ${d && connected ? html`
        <${Figures} figures=${d.figures || []} />
        ${parts.drafts.map((s) => html`<${DraftSection} key=${s.id} section=${s} inbox=${inbox.data} />`)}
        ${parts.stages ? html`<${StageRow} section=${parts.stages} />` : null}
        ${parts.tables.map((raw) => {
          const s = withStatus(raw, now);
          return html`
            <${Section} key=${s.id} title=${s.title} count=${(s.rows || []).length}>
              <${DataTable} columns=${s.columns || []} rows=${s.rows || []} emptyText=${s.emptyText || "Nothing here yet."}
                renderCell=${renderCell} />
            <//>`;
        })}
        ${(d.inFlight || []).length ? html`
          <${Section} title="In progress" count=${d.inFlight.length}>
            <ul class="p-dashboard-flight">
              ${d.inFlight.map((t) => html`
                <li key=${t.goalId}>
                  <a href=${`#/tasks/${encodeURIComponent(t.goalId)}`}>${text(t.title)}</a>
                  <span class="p-dashboard-state">${text(t.plainState)}</span>
                </li>`)}
            </ul>
          <//>` : null}
        <${Jobs} dept=${dept} />` : null}
      ${d && (d.switches || []).length ? html`
        <${Section} title="Switched off">
          <div class="p-dashboard-switches">
            ${d.switches.map((s) => html`<${Switch} key=${s.id} on=${false} disabled=${true} label=${s.label} explain=${s.explain} />`)}
          </div>
        <//>` : null}
      <p class="p-dashboard-foot">
        <a class="p-dashboard-open" href=${`#/departments/${dept}`}>Open the department <${Icon} name="arrow-right" size=${14} /></a>
      </p>
    </div>`;
}
