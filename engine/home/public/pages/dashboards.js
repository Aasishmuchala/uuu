// Dashboards (CONTRACTS-V3 30): the figures and records of each department, as six cards two or three across on
// the raised step (R12). Each card reads its own GET /api/departments/<id>, so one card that cannot be read or is
// not connected shows that by itself and never fails the page. A card is a line icon, the name, one sentence and
// two facts as label and value; no creature and no department colour (O2, O7). Fix round R5 (R5-H): the icon stands
// in the kit's Tile, in the quiet tint the kit gives the dashboard's department (identity, never a state).
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { Button, Card, glueValue, Icon, PageHeader, Tile, tintFor } from "../kit/index.js";
import { figureSplit, moneyParts, OWED_TO_YOU } from "./dashboard.js";

// A fact's value: an amount's symbol and the small part after its point at three quarters size on the digits'
// baseline, as the record dashboards draw them; anything else as written.
function Value({ value }) {
  const m = moneyParts(value);
  if (!m) return glueValue(value);
  const [whole, small] = figureSplit(m.figure);
  return html`${m.sign}<span class="p-dashboards-unit">${m.unit}</span>${whole}${small ? html`<span class="p-dashboards-cents">${small}</span>` : null}`;
}

// The six dashboards, in the order of the shelf. `dept` names the department the dashboard belongs to (Customers
// is the Sales department's dashboard); `icon` is that department's line icon, as the sidebar draws it.
export const DASHBOARDS = [
  { id: "books", title: "Books", dept: "books", icon: "book", about: "Invoices, bills and what is owed" },
  { id: "customers", title: "Customers", dept: "sales", icon: "trend", about: "Leads and deals" },
  { id: "support", title: "Support", dept: "support", icon: "buoy", about: "Requests and replies" },
  { id: "people", title: "People", dept: "people", icon: "team", about: "Staff, leave and attendance" },
  { id: "marketing", title: "Marketing", dept: "marketing", icon: "horn", about: "Posts, newsletters and carousels" },
  { id: "studio", title: "Studio", dept: "studio", icon: "film", about: "Parts, pictures and video" },
];

// How many facts a card shows.
export const CARD_FACTS = 2;
const MAX_FIGURES = 3;
const TEXT_MAX = 80;
const short = (v) => (v === null || v === undefined ? "" : String(v).slice(0, TEXT_MAX));
const arr = (v) => (Array.isArray(v) ? v : []);

// The first few figures of a department's answer, as { id, label, value }, with text capped.
export function cardFigures(page, n = MAX_FIGURES) {
  return arr(page?.figures)
    .filter((f) => f && typeof f === "object" && f.label !== undefined && f.value !== undefined)
    .slice(0, n)
    .map((f, i) => ({ id: short(f.id) || String(i), label: short(f.label), value: short(f.value) }));
}

// What a waiting row is called, by the section it is in.
const NOUNS = {
  drafts: ["draft", "drafts"],
  draft_replies: ["reply", "replies"],
  leave: ["leave request", "leave requests"],
  calendar: ["draft", "drafts"],
};

const joinWords = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

// One plain line of what waits on a dashboard: the rows that wait for the owner (rows that carry an inbox
// item), then the tasks being worked on. Null when the answer is missing or not connected.
export function waitsLine(page) {
  if (!page || typeof page !== "object" || page.connected === false) return null;
  const counts = new Map();
  let total = 0;
  for (const s of arr(page.sections)) {
    const n = arr(s?.rows).filter((r) => r && r.inboxId).length;
    if (!n) continue;
    const [one, many] = NOUNS[s.id] || ["item", "items"];
    const key = one;
    const prev = counts.get(key) || { n: 0, one, many };
    prev.n += n;
    counts.set(key, prev);
    total += n;
  }
  const lines = [];
  if (total) {
    const parts = [...counts.values()].map((c) => `${c.n} ${c.n === 1 ? c.one : c.many}`);
    lines.push(`${joinWords(parts)} ${total === 1 ? "waits" : "wait"} for you.`);
  }
  const working = arr(page.inFlight).length;
  if (working) lines.push(`${working} ${working === 1 ? "task is" : "tasks are"} being worked on.`);
  return lines.length ? lines.join(" ") : "Nothing waits for you.";
}

// Which of the four states a card is in: "loading", "error", "off" (not connected) or "ready".
export function cardState(res) {
  if (res?.data && typeof res.data === "object") return res.data.connected === false ? "off" : "ready";
  if (res?.error) return "error";
  return "loading";
}

function DashboardCard({ d }) {
  const res = useResource(`/api/departments/${encodeURIComponent(d.id)}`, { every: 10000 });
  const state = cardState(res);
  const page = res.data;
  const figures = state === "ready" ? cardFigures(page, CARD_FACTS) : [];
  const waits = state === "ready" ? waitsLine(page) : null;
  const href = `#/dashboards/${d.id}`;
  return html`
    <li class="p-dashboards-item">
      <${Card} class="p-dashboards-card" padding="none" aria-busy=${state === "loading" ? "true" : undefined}>
        <div class="p-dashboards-head">
          <span class="p-dashboards-tile"><${Tile} icon=${d.icon} tint=${tintFor(d.dept)} size=${32} /></span>
          <h2 class="p-dashboards-name"><a class="p-dashboards-link" href=${href}>${d.title}</a></h2>
          <${Icon} name="chevron-right" size=${16} class="p-dashboards-go" />
        </div>
        <p class="p-dashboards-about">${d.about}</p>
        ${state === "loading" ? html`
          <div class="p-dashboards-figures p-dashboards-figures--wait" role="status">
            <span class="k-sr">Loading</span>
            ${[0, 1].map((i) => html`<span key=${i} class="p-dashboards-ghost" aria-hidden="true"></span>`)}
          </div>` : null}
        ${state === "ready" ? html`
          ${figures.length ? html`
            <dl class="p-dashboards-figures">
              ${figures.map((f) => html`
                <div class="p-dashboards-figure" key=${f.id}>
                  <dt class="p-dashboards-label">${f.label}</dt>
                  <dd class=${`p-dashboards-value${OWED_TO_YOU.includes(f.id) ? " p-dashboards-value--in" : ""}`}><${Value} value=${f.value} /></dd>
                </div>`)}
            </dl>` : html`<p class="p-dashboards-quiet">No figures yet.</p>`}
          <p class="p-dashboards-waits">${waits}</p>` : null}
        ${state === "off" ? html`
          <div class="p-dashboards-off">
            <p class="p-dashboards-off-title"><${Icon} name="alert" size=${14} /> Not connected yet</p>
            <p class="p-dashboards-quiet">${short(page?.notConnected?.reason) || "This dashboard cannot read its records yet."} Open it for the next step.</p>
          </div>` : null}
        ${state === "error" ? html`
          <div class="p-dashboards-off" role="alert">
            <p class="p-dashboards-off-title"><${Icon} name="alert" size=${14} /> This could not be loaded.</p>
            <div class="p-dashboards-retry"><${Button} size="sm" onClick=${res.reload}>Try again<//></div>
          </div>` : null}
      <//>
    </li>`;
}

export default function DashboardsPage() {
  return html`
    <div class="p-dashboards">
      <${PageHeader} title="Dashboards"
        lead="The figures and records of each department. They are real: they come from your books." />
      <ul class="p-dashboards-shelf" aria-label="Dashboards">
        ${DASHBOARDS.map((d) => html`<${DashboardCard} key=${d.id} d=${d} />`)}
      </ul>
    </div>`;
}
