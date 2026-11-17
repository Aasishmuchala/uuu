// One page for Books, Customers, Support and People (CONTRACTS 9.6, CONTRACTS-V3 30), at #/dashboards/<id>, in the
// manner of a ledger (R07): the title with the agent and its state at the top right, a row of filters (the list
// pattern's menus), the figures on one edged strip, then each list as the kit's table on a card: the party with its
// initials disc, a state as a chip, money at the right with its sign and its small part at three quarters size, the
// columns as wide as their content. Drafts waiting for the owner stay as rows and open in Needs you; money that came
// in or is owed to you is in the good ink, what failed or is late in the bad. Every value is shown as the books send
// it. Then what is being worked on, jobs to start, the switches that are off, and the department's link.
// Fix round R5 (R5-H): a column in which every row of its table says the same thing is not drawn, and its fact is
// said once in the section's head line ("Made by: Bookkeeper"). Fix round R6 (R6-H): one column as wide as the pane
// up to 1040 px; each table flat at its whole width with the room left shared among its columns; a document's type
// the kit's one neutral chip; the figures the page's one raised surface.
// PLAN-3D-ALL U12: the title, the agent and the filters stand in the room header, the dashboard's room behind them
// (kit/room.js; Customers live in Sales). The figures stay the one raised surface, set at the stat size in the display
// face and whole; the tables stay flat on the ground. Nothing is on paper here.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { HealthNext } from "./team.js";
import {
  AgentChip, Avatar, Button, Card, DataTable, ErrorNotice, Icon, JobRow, Live, Loading, Menu, NotConnected, RoomHeader, Row,
  Rows, Section, St, StatusDot, Tag, Waiting, glimpseFor,
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
// Columns whose words are a kind (an invoice, a bill), shown as a neutral chip.
const KIND_KEYS = ["type"];
// The column that names the party of a row (a customer, a supplier, a person), by section where the key alone
// does not say so. That column carries an initials disc and takes the room the other columns leave.
const PARTY_KEYS = ["party", "who"];
const PARTY_BY_SECTION = { staff: "name", leads: "name", deals: "name", lead_notes: "name" };
// Sections whose money is owed to you (drawn in the good ink, as the figure "You are owed" is).
const OWED_SECTIONS = ["unpaid_invoices"];
// A text column with a value longer than this wraps instead of fitting its content.
const FIT_MAX = 40;
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
// Figures of money owed to you: in the good ink too.
export const OWED_TO_YOU = ["owed_to_you"];
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

// An amount's figure split at its decimal point, so the small part can be drawn smaller: "1,18,000.00" →
// ["1,18,000", ".00"]. Nothing is rounded or recomputed. Pure.
export function figureSplit(figure) {
  const s = String(figure ?? "");
  const m = /^(.*\d)(\.\d+)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ""];
}

// The party column of a section: by its section, else the first column whose key names a party. Null when none.
export function partyKey(section) {
  const keys = (Array.isArray(section?.columns) ? section.columns : []).map((c) => c && c.key);
  const by = PARTY_BY_SECTION[section?.id];
  if (by && keys.includes(by)) return by;
  return PARTY_KEYS.find((k) => keys.includes(k)) || null;
}

// The columns of a section as the dashboard draws them, in the order a ledger is read: the row's number, the
// party, other words, the state, dates and counts, then money. Each keeps its key, label and values; a column is
// marked `fit` (as wide as its content, the room left shared evenly among them) unless its words are long enough to
// wrap, so no one column takes all the room and opens a band in the middle of the table (R5-H). Pure.
export function ledgerColumns(section) {
  const columns = (Array.isArray(section?.columns) ? section.columns : []).filter((c) => c && c.key !== undefined);
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  const longest = (c) => Math.max(0, ...rows.map((r) => String(r?.[c.key] ?? "").length));
  const money = (c) => rows.some((r) => moneyParts(r?.[c.key]));
  const chip = (c) => CHIP_KEYS.includes(c.key) || c.key === STATUS_KEY;
  const party = partyKey(section);
  const figure = (c) => rows.length > 0 && rows.every((r) => { const v = String(r?.[c.key] ?? "").trim(); return v === "" || /^\d[\d,.]*$/.test(v) || dayOf(v) !== null; });
  const rank = (c, i) => {
    if (c.key === party) return 1;
    if (i === 0) return 0;
    if (money(c)) return 5;
    if (chip(c)) return 3;
    if (figure(c)) return 4;
    return 2;
  };
  const ranked = columns.map((c, i) => ({ c, i, r: rank(c, i) })).sort((a, b) => a.r - b.r || a.i - b.i);
  return ranked.map(({ c }) => ({ ...c, fit: longest(c) <= FIT_MAX }));
}

// The columns of a section in which every row says the same thing (two rows or more): each is left out of the table
// and said once in the section's head line, as { key, label, value } with the value as the books send it. Never the
// row's number (the first column) or money. Pure.
export function sameColumns(section) {
  const columns = (Array.isArray(section?.columns) ? section.columns : []).filter((c) => c && c.key !== undefined);
  const rows = (Array.isArray(section?.rows) ? section.rows : []).filter((r) => r && typeof r === "object");
  if (rows.length < 2) return [];
  const out = [];
  columns.forEach((c, i) => {
    if (i === 0) return;
    const values = rows.map((r) => String(r[c.key] ?? "").replace(/\s+/g, " ").trim());
    if (!values[0] || values.some((v) => v !== values[0])) return;
    if (values.some((v) => moneyParts(v))) return;
    out.push({ key: c.key, label: String(c.label ?? c.key), value: values[0].slice(0, TEXT_MAX) });
  });
  return out;
}

// The section's head line for the columns left out: "Made by: Bookkeeper · Valid until: 16 Dec 2026". Pure.
export function sameLine(same) {
  return (Array.isArray(same) ? same : []).map((c) => `${c.label}: ${c.value}`).join(" · ");
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

// The kit's chip tone of a status word's tone: a draft neutral, final or paid good, unpaid warn, late or lost bad,
// an open stage of a lead the info tone.
const TAG_TONES = { ok: "good", warn: "warn", bad: "bad", off: "neutral", sales: "info" };

// A status in a table: the kit's chip in its tone, with the words as the books give them.
function StatusWords({ value }) {
  const c = statusChip(value);
  if (!c) return text(value);
  return html`<${Tag} tone=${TAG_TONES[c.tone] || "neutral"}>${c.label}<//>`;
}

// An amount: the sign and the currency's symbol at three quarters size on the baseline, the figure in tabular
// figures with its small part at three quarters size; struck through when its row failed, in the good colour when
// its money came in or is owed to you.
export function Amount({ value, failed, cameIn }) {
  const m = moneyParts(value);
  const [whole, small] = m ? figureSplit(m.figure) : ["", ""];
  const body = m
    ? html`${m.sign ? html`<span class="p-dashboard-sign">${m.sign}</span>` : null}<span class="p-dashboard-unit">${m.unit}</span>${whole}${small ? html`<span class="p-dashboard-cents">${small}</span>` : null}`
    : text(value);
  const cls = `p-dashboard-amount${cameIn && !failed ? " p-dashboard-amount--in" : ""}`;
  return failed ? html`<s class=${cls}>${body}</s>` : html`<span class=${cls}>${body}</span>`;
}

// A party: a 24 px disc with the initials of its own name, then the name.
function Party({ value }) {
  if (value === null || value === undefined || String(value).trim() === "") return text(value);
  return html`<span class="p-dashboard-party"><${Avatar} name=${String(value)} size=${24} /><span class="p-dashboard-party-name">${text(value)}</span></span>`;
}

// A document's type ("invoice", "bill"): the kit's one neutral chip, the words as the books send them (fix round R6:
// one chip style for every type, colour kept for states).
function Kind({ value }) {
  return html`<span class="p-dashboard-kind"><${Tag}>${text(value)}<//></span>`;
}

// The cells of one section's table.
const cellsFor = (section) => {
  const party = partyKey(section);
  const owed = OWED_SECTIONS.includes(section?.id);
  return (row, col) => {
    if (CHIP_KEYS.includes(col.key) || col.key === STATUS_KEY) return html`<${StatusWords} value=${row[col.key]} />`;
    if (KIND_KEYS.includes(col.key) && String(row[col.key] ?? "").trim()) return html`<${Kind} value=${row[col.key]} />`;
    if (col.key === party) return html`<${Party} value=${row[col.key]} />`;
    if (moneyParts(row[col.key])) return html`<${Amount} value=${row[col.key]} failed=${rowFailed(row)} cameIn=${rowCameIn(row) || owed} />`;
    return undefined;
  };
};

// One section's table, flat on the ground (a head row over a rule, hairlines between rows; no card: the figures are
// the page's one raised surface), without the columns every row says the same of (`same`, said in the head line).
function Ledger({ section, emptyText, same = [] }) {
  const out = new Set(same.map((c) => c.key));
  return html`<div class="p-dashboard-sheet">
    <${DataTable} columns=${ledgerColumns(section).filter((c) => !out.has(c.key))} rows=${section.rows || []} emptyText=${emptyText} renderCell=${cellsFor(section)} />
  </div>`;
}

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
    <${Section} title="Jobs to start" aside=${html`<${Button} variant="ghost" size="sm" href=${`#/jobs?d=${encodeURIComponent(dept)}`}>Every job<//>`}>
      <div class="p-dashboard-jobs">
        ${jobs.map((j) => html`<${JobRow} key=${j.id} job=${j} />`)}
      </div>
    <//>`;
}

// The figures on one edged strip with dividers (R07): a 12 px label in the third ink over the figure at 24 px, its
// currency's symbol at three quarters size on the baseline, the server's hint under it; money that came in or is
// owed to you in the good ink.
export function Totals({ figures }) {
  const list = (Array.isArray(figures) ? figures : []).filter((f) => f && f.label !== undefined && f.value !== undefined);
  if (!list.length) return null;
  return html`<${Card} padding="none" class="p-dashboard-strip"><dl class="p-dashboard-totals">
    ${list.map((f, i) => {
      const tone = figureTone(f);
      return html`<div class="p-dashboard-total" key=${f.id ?? i}>
        <dt class="p-dashboard-total-label">${text(f.label)}</dt>
        <dd class="p-dashboard-total-value">
          <${Amount} value=${f.value} failed=${tone === "failed"} cameIn=${tone === "in" || OWED_TO_YOU.includes(String(f.id))} />
          ${tone === "failed" ? html`<${Tag} tone="bad">${DASHBOARD_WORDS.failed}<//>` : null}
        </dd>
        ${f.hint ? html`<dd class="p-dashboard-total-hint">${text(f.hint)}</dd>` : null}
      </div>`;
    })}
  </dl><//>`;
}

// The way into Needs you, filtered to the department.
export function QueueLink({ dept }) {
  const app = useApp() || {};
  const open = () => { if (typeof app.openNeeds === "function") app.openNeeds({ department: dept }); };
  return html`<${Button} variant="ghost" size="sm" icon="inbox" class="p-dashboard-queue" onClick=${open}>${DASHBOARD_WORDS.queue}<//>`;
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
  const same = sameColumns(section);
  return html`
    <${Section} title=${section.title || "Drafts waiting for you"} count=${rows.length} hint=${sameLine(same) || undefined}
      aside=${rows.length ? html`<${QueueLink} dept=${dept} />` : null}>
      <${Ledger} section=${section} same=${same} emptyText=${section.emptyText || "Nothing waiting."} />
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
      <${RoomHeader} glimpse=${glimpseFor("dashboard", id)} pull strip title=${title}
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
          const same = sameColumns(s);
          return html`
            <${Section} key=${s.id} title=${s.title} count=${(s.rows || []).length} hint=${sameLine(same) || undefined}
              aside=${waiting.length ? html`<${QueueLink} dept=${dept} />` : null}>
              ${waiting.length ? html`<p class="p-dashboard-waits">
                <${St} icon="inbox">${waiting.length === 1 ? DASHBOARD_WORDS.waitsOne : DASHBOARD_WORDS.waitsMany(waiting.length)}<//>
              </p>` : null}
              <${Ledger} section=${s} same=${same} emptyText=${f.st ? DASHBOARD_WORDS.noRows : s.emptyText || "Nothing here yet."} />
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
