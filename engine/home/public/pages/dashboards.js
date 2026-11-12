// Dashboards (CONTRACTS-V3 30): the figures and records of each department, as six glass cards on a shelf.
// Each card reads its own GET /api/departments/<id>, so one card that cannot be read or is not connected
// shows that by itself and never fails the page. Below 860 px the shelf scrolls sideways with snap.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { Button, Card, Creature, glueValue, Icon, PageHeader } from "../kit/index.js";

// The six dashboards, in the order of the shelf. `dept` names the department whose creature and colour the
// card wears (Customers is the Sales department's dashboard).
export const DASHBOARDS = [
  { id: "books", title: "Books", dept: "books", about: "Invoices, bills and what is owed" },
  { id: "customers", title: "Customers", dept: "sales", about: "Leads and deals" },
  { id: "support", title: "Support", dept: "support", about: "Requests and replies" },
  { id: "people", title: "People", dept: "people", about: "Staff, leave and attendance" },
  { id: "marketing", title: "Marketing", dept: "marketing", about: "Posts, newsletters and carousels" },
  { id: "studio", title: "Studio", dept: "studio", about: "Parts, pictures and video" },
];

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
  const figures = state === "ready" ? cardFigures(page) : [];
  const waits = state === "ready" ? waitsLine(page) : null;
  const href = `#/dashboards/${d.id}`;
  return html`
    <li class="p-dashboards-item">
      <${Card} class="p-dashboards-card" data-dept=${d.dept} aria-busy=${state === "loading" ? "true" : undefined}>
        <div class="p-dashboards-head">
          <span class="p-dashboards-pet"><${Creature} id=${d.dept} size=${32} /></span>
          <div class="p-dashboards-names">
            <h2 class="p-dashboards-name"><a class="p-dashboards-link" href=${href}>${d.title}</a></h2>
            <p class="p-dashboards-about">${d.about}</p>
          </div>
          <${Icon} name="arrow-right" size=${16} class="p-dashboards-go" />
        </div>
        ${state === "loading" ? html`
          <div class="p-dashboards-figures p-dashboards-figures--wait" role="status">
            <span class="k-sr">Loading</span>
            ${[0, 1, 2].map((i) => html`<span key=${i} class="p-dashboards-ghost" aria-hidden="true"></span>`)}
          </div>` : null}
        ${state === "ready" ? html`
          ${figures.length ? html`
            <dl class="p-dashboards-figures">
              ${figures.map((f) => html`
                <div class="p-dashboards-figure" key=${f.id}>
                  <dt class="p-dashboards-label">${f.label}</dt>
                  <dd class="p-dashboards-value">${glueValue(f.value)}</dd>
                </div>`)}
            </dl>` : html`<p class="p-dashboards-quiet">No figures yet.</p>`}
          <p class="p-dashboards-waits">
            <span class="p-dashboards-dot" aria-hidden="true"></span>${waits}
          </p>` : null}
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
      <${PageHeader} over="DASHBOARDS" title="Dashboards"
        lead="The figures and records of each department. They are real: they come from your books." />
      <ul class="p-dashboards-shelf" aria-label="Dashboards">
        ${DASHBOARDS.map((d) => html`<${DashboardCard} key=${d.id} d=${d} />`)}
      </ul>
    </div>`;
}
