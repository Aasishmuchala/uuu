// One page for Books, Customers, Support and People (CONTRACTS 9.6, CONTRACTS-V3 30), at #/dashboards/<id>, in the
// manner of a ledger (R07): the title with the agent and its state at the top right, a row of filters (the list
// pattern's menus), the figures as totals in a row, then each list as the kit's table edge to edge of the column.
// Drafts waiting for the owner stay as rows and open in Needs you; nothing is coloured but money that came in and
// what failed or is late. Then what is being worked on, jobs to start, the switches that are off, and the
// department's link.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { HealthNext } from "./team.js";
import {
  AgentChip, DataTable, ErrorNotice, Icon, JobRow, Live, Loading, Menu, NotConnected, PageHeader, Row, Rows, Section,
  St, StatusDot, Tag, Waiting,
} from "../kit/index.js";

const TITLES = { books: "Books", customers: "Customers", support: "Support", people: "People" };
const AGENTS = { books: "bookkeeper", customers: "sales", support: "support", people: "people" };
// The department each dashboard belongs to (its page, its jobs, its items in Needs you).
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

// The Needs-you items of a section's rows that are not drafts (a leave request on People, say): every row with an
// `inboxId` whose item is in Needs you, so it can be acted on in place above its table (M51 F5, C3 30).
export function waitingItems(section, inbox) {
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  const out = [];
  for (const row of rows) {
    const item = itemFor(row, inbox);
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
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


// The page's own words (a new label is added here and pinned by the page's test).
export const DASHBOARD_WORDS = {
  filters: "Filters",
  show: "Show",
  everything: "Every list",
  status: "Status",
  anyStatus: "Any status",
  queue: "Open in Needs you",
  waitsOne: "1 row here waits for you.",
  waitsMany: (n) => `${n} rows here wait for you.`,
  failed: "Failed",
  noRows: "No rows have this status.",
};

// Figures whose money came in (drawn in the good colour). Every other figure stays in the first ink.
export const MONEY_IN = ["money_in", "received", "received_month", "paid_month", "payments_in"];
// Status words that mean a row's money did not move: its amount is struck through.
const FAILED = ["failed", "bounced", "returned", "cancelled"];
// Status words that mean a row's money came in.
const CAME_IN = ["paid", "received"];

const statusOf = (row) => String(row?.status ?? row?.[STATUS_KEY] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export const rowFailed = (row) => FAILED.includes(statusOf(row));
export const rowCameIn = (row) => CAME_IN.includes(statusOf(row));
// How a figure is drawn: "failed" (struck through, with a tag), "in" (money that came in) or "plain".
export const figureTone = (f) => (f && f.failed === true ? "failed" : f && MONEY_IN.includes(String(f.id)) ? "in" : "plain");

// An amount as the server writes it ("₹ 1,18,000.00", "-$213.11") → { sign, unit, figure }, so the unit can be
// drawn small and grey beside the figure. Null when the value is not an amount with a currency. Pure.
export function moneyParts(v) {
  const m = /^([-+−]?)\s*([₹$€£]|Rs\.?)\s*(\d[\d,]*(?:\.\d+)?)$/.exec(String(v ?? "").trim());
  return m ? { sign: m[1] === "-" ? "−" : m[1], unit: m[2], figure: m[3] } : null;
}

// The filters of the address: ?s=<list id>&st=<status, in small letters>. Pure.
export function filtersOf(query) {
  const get = (k) => (query && typeof query.get === "function" ? String(query.get(k) || "") : "");
  return { s: get("s").slice(0, 60), st: get("st").slice(0, 60).toLowerCase() };
}

// The address of a dashboard with its filters; an empty filter is left out. Pure.
export function dashboardAddress(id, f = {}) {
  const q = new URLSearchParams();
  if (f.s) q.set("s", f.s);
  if (f.st) q.set("st", f.st);
  const qs = q.toString();
  return `#/dashboards/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
}

// The status words of the tables' rows, once each, in the order first seen: [{ value, label }]. Pure.
export function statusChoices(tables) {
  const seen = new Map();
  for (const s of Array.isArray(tables) ? tables : []) {
    for (const row of Array.isArray(s?.rows) ? s.rows : []) {
      const c = statusChip(row?.status ?? row?.[STATUS_KEY]);
      if (c && !seen.has(c.label.toLowerCase())) seen.set(c.label.toLowerCase(), c.label);
    }
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

// The tables the filters keep: one list when `s` names one; with `st`, only the rows of that status (a table with
// no statuses is left out then). Pure.
export function filterTables(tables, f = {}) {
  let list = (Array.isArray(tables) ? tables : []).filter(Boolean);
  if (f.s) list = list.filter((t) => t.id === f.s);
  if (f.st) {
    list = list
      .filter((t) => (t.columns || []).some((c) => c.key === "status" || c.key === STATUS_KEY))
      .map((t) => ({ ...t, rows: (t.rows || []).filter((r) => (statusChip(r?.status ?? r?.[STATUS_KEY])?.label || "").toLowerCase() === f.st) }));
  }
  return list;
}

// A status in a table: late, lost or failed is a tag in the bad colour; every other word stays grey.
function StatusWords({ value }) {
  const c = statusChip(value);
  if (!c) return text(value);
  return c.tone === "bad" ? html`<${Tag} tone="bad">${c.label}<//>` : html`<span class="p-dashboard-status">${c.label}</span>`;
}

// An amount: the unit small and grey, the figure in tabular figures; struck through when its row failed, in the
// good colour when its money came in.
export function Amount({ value, failed, cameIn }) {
  const m = moneyParts(value);
  const body = m ? html`${m.sign}<span class="p-dashboard-unit">${m.unit}</span>${m.figure}` : text(value);
  const cls = `p-dashboard-amount${cameIn && !failed ? " p-dashboard-amount--in" : ""}`;
  return failed ? html`<s class=${cls}>${body}</s>` : html`<span class=${cls}>${body}</span>`;
}

const renderCell = (row, col) => {
  if (CHIP_KEYS.includes(col.key) || col.key === STATUS_KEY) return html`<${StatusWords} value=${row[col.key]} />`;
  if (moneyParts(row[col.key])) return html`<${Amount} value=${row[col.key]} failed=${rowFailed(row)} cameIn=${rowCameIn(row)} />`;
  return undefined;
};

export function AgentState({ agent }) {
  if (!agent) return null;
  if (agent.state === "working") return html`<${Live} />`;
  if (agent.state === "waiting_for_you") return html`<${Waiting} />`;
  return html`<${StatusDot} tone=${agent.state === "problem" ? "bad" : agent.state === "paused" ? "warn" : "off"} label=${text(agent.plainState)} />`;
}

// The agent's chip and its state, at the top right of every dashboard (M51 F20: the six are built one way).
export function AgentHead({ slug, agent }) {
  if (!agent) return null;
  return html`<span class="p-dashboard-agent"><${AgentChip} agent=${{ slug, name: text(agent.name) }} /><${AgentState} agent=${agent} /></span>`;
}

// The closing link of every dashboard.
export function OpenDepartment({ dept }) {
  return html`<p class="p-dashboard-foot">
    <a class="p-dashboard-open" href=${`#/departments/${dept}`}>Open the department <${Icon} name="arrow-right" size=${14} /></a>
  </p>`;
}

// Jobs to start: three of the department's jobs, ready ones first, and a link to every job of it.
export function Jobs({ dept }) {
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

// The figures as totals in a row (R07): a 13 px label over the figure at the stat size, its unit small and grey,
// the server's hint under it.
export function Totals({ figures }) {
  const list = (Array.isArray(figures) ? figures : []).filter((f) => f && f.label !== undefined && f.value !== undefined);
  if (!list.length) return null;
  return html`<dl class="p-dashboard-totals">
    ${list.map((f, i) => {
      const tone = figureTone(f);
      return html`<div class="p-dashboard-total" key=${f.id ?? i}>
        <dt class="p-dashboard-total-label">${text(f.label)}</dt>
        <dd class="p-dashboard-total-value">
          <${Amount} value=${f.value} failed=${tone === "failed"} cameIn=${tone === "in"} />
          ${tone === "failed" ? html`<${Tag} tone="bad">${DASHBOARD_WORDS.failed}<//>` : null}
        </dd>
        ${f.hint ? html`<dd class="p-dashboard-total-hint">${text(f.hint)}</dd>` : null}
      </div>`;
    })}
  </dl>`;
}

// The way into Needs you, filtered to the department.
export function QueueLink({ dept }) {
  const app = useApp() || {};
  const open = () => { if (typeof app.openNeeds === "function") app.openNeeds({ department: dept }); };
  return html`<button type="button" class="p-dashboard-queue" onClick=${open}>${DASHBOARD_WORDS.queue}<${Icon} name="chevron-right" size=${14} /></button>`;
}

const go = (href) => { if (href && typeof location !== "undefined") location.hash = href; };

// One filter: the kit's menu, its button showing the filter's name, or its choice once one is made.
function FilterMenu({ name, options, current, make }) {
  const on = options.find((o) => o.value && o.value === current);
  const items = options.map((o) => {
    const now = o.value === (current || "");
    return { id: o.value || "all", label: o.label, icon: now ? "check" : undefined, current: now ? true : undefined, onSelect: () => go(make(o.value)) };
  });
  return html`<div class=${`p-dashboard-filter${on ? " p-dashboard-filter--on" : ""}`}>
    <${Menu} label=${on ? on.label : name} items=${items} />
  </div>`;
}

function Bar({ id, f, lists, statuses }) {
  const W = DASHBOARD_WORDS;
  if (lists.length < 2 && !statuses.length) return null;
  return html`<div class="p-dashboard-bar" role="group" aria-label=${W.filters}>
    ${lists.length > 1 ? html`<${FilterMenu} name=${W.show} current=${f.s} make=${(v) => dashboardAddress(id, { ...f, s: v })}
      options=${[{ value: "", label: W.everything }, ...lists.map((s) => ({ value: s.id, label: text(s.title) }))]} />` : null}
    ${statuses.length ? html`<${FilterMenu} name=${W.status} current=${f.st} make=${(v) => dashboardAddress(id, { ...f, st: v })}
      options=${[{ value: "", label: W.anyStatus }, ...statuses]} />` : null}
  </div>`;
}

// Drafts waiting for the owner: rows as the server words them, and the way into Needs you.
function DraftSection({ section, dept }) {
  const rows = section.rows || [];
  return html`
    <${Section} title=${section.title || "Drafts waiting for you"} count=${rows.length}
      aside=${rows.length ? html`<${QueueLink} dept=${dept} />` : null}>
      <${DataTable} columns=${section.columns || []} rows=${rows} emptyText=${section.emptyText || "Nothing waiting."}
        renderCell=${renderCell} />
    <//>`;
}

export default function DashboardPage({ route }) {
  const asked = route?.parts?.[1];
  const id = Object.hasOwn(TITLES, asked) ? asked : "books";
  const title = TITLES[id];
  const dept = DEPARTMENTS[id];
  const f = filtersOf(route?.query);
  const res = useResource(`/api/departments/${encodeURIComponent(id)}`, { every: 10000 });
  const inbox = useResource("/api/inbox", { every: 10000 });
  const d = res.data;
  const parts = d ? splitSections(d) : null;
  const connected = d ? d.connected !== false : true;
  const now = new Date();
  const all = parts ? [...(parts.stages ? [parts.stages] : []), ...parts.tables.map((s) => withStatus(s, now))] : [];
  const lists = parts ? [...parts.drafts, ...all] : [];
  const statuses = statusChoices(all);
  const shown = filterTables(all, f);
  const drafts = parts && !f.st ? parts.drafts.filter((s) => !f.s || s.id === f.s) : [];
  const filtered = Boolean(f.s || f.st);

  return html`
    <div class="p-dashboard p-dashboard--records">
      <${PageHeader} title=${title}
        back=${{ href: "#/dashboards", label: "All dashboards" }}
        crumbs=${[{ label: "Dashboards", href: "#/dashboards" }, { label: title }]}
        actions=${d?.agent ? html`<${AgentHead} slug=${AGENTS[id]} agent=${d.agent} />` : null}>
        ${d && connected ? html`<${Bar} id=${id} f=${f} lists=${lists} statuses=${statuses} />` : null}
      <//>
      ${res.loading && !d ? html`<${Loading} lines=${4} />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${d && !connected ? html`<${NotConnected} reason=${d.notConnected?.reason}
        next=${html`<${HealthNext} text=${d.notConnected?.next} />`} />` : null}
      ${d && connected ? html`
        <${Totals} figures=${d.figures || []} />
        ${drafts.map((s) => html`<${DraftSection} key=${s.id} section=${s} dept=${dept} />`)}
        ${shown.map((s) => {
          const waiting = waitingItems(s, inbox.data);
          return html`
            <${Section} key=${s.id} title=${s.title} count=${(s.rows || []).length}
              aside=${waiting.length ? html`<${QueueLink} dept=${dept} />` : null}>
              ${waiting.length ? html`<p class="p-dashboard-waits">
                <${St} icon="inbox">${waiting.length === 1 ? DASHBOARD_WORDS.waitsOne : DASHBOARD_WORDS.waitsMany(waiting.length)}<//>
              </p>` : null}
              <${DataTable} columns=${s.columns || []} rows=${s.rows || []}
                emptyText=${f.st ? DASHBOARD_WORDS.noRows : s.emptyText || "Nothing here yet."} renderCell=${renderCell} />
            <//>`;
        })}
        ${!filtered && (d.inFlight || []).length ? html`
          <${Section} title="In progress" count=${d.inFlight.length}>
            <ul class="p-dashboard-flight">
              ${d.inFlight.map((t) => html`
                <li key=${t.goalId}>
                  <a href=${`#/tasks/${encodeURIComponent(t.goalId)}`}>${text(t.title)}</a>
                  <span class="p-dashboard-state">${text(t.plainState)}</span>
                </li>`)}
            </ul>
          <//>` : null}
        ${filtered ? null : html`<${Jobs} dept=${dept} />`}` : null}
      ${d && !filtered && (d.switches || []).length ? html`
        <${Section} title="Switched off">
          <${Rows}>
            ${d.switches.map((s) => html`<${Row} key=${s.id} icon="power" title=${text(s.label)} state="Off" say=${text(s.explain)} />`)}
          <//>
        <//>` : null}
      <${OpenDepartment} dept=${dept} />
    </div>`;
}
