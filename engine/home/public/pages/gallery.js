// Ready-made goals: goals the owner can start from, by department. CONTRACTS-V2 17.7.
// Each card opens the compose dialog with the goal's text filled in. Nothing is given until the owner sends it.
import { html, useEffect } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { AgentChip, Card, Chip, Empty, ErrorNotice, Loading, PageHeader, Section, Tabs, Tag } from "../kit/index.js";

const LEAD = "Goals you can start from. Each opens as a draft you can change before you give it.";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const cap = (v, n = 600) => text(v).slice(0, n);

// The goals shown for a tab: every department's goals for All (or no `d`), else that department's.
export function pick(departments, d) {
  const list = Array.isArray(departments) ? departments : [];
  const chosen = d && d !== "all" ? list.filter((x) => x && x.id === d) : list;
  const out = [];
  for (const dep of chosen) for (const g of (dep && Array.isArray(dep.goals) ? dep.goals : [])) out.push(g);
  return out;
}

// One goal by its id ("books/draft-an-invoice"), or null.
export function find(departments, id) {
  if (!id) return null;
  for (const dep of Array.isArray(departments) ? departments : []) {
    for (const g of (dep && Array.isArray(dep.goals) ? dep.goals : [])) if (g && g.id === id) return g;
  }
  return null;
}

function start(openComposer, g) {
  openComposer({ text: text(g.text), to: g.to || undefined, planFirst: !!g.planFirst, template: g.id });
}

function GoalCard({ g, onOpen }) {
  return html`<${Card} onClick=${() => onOpen(g)} padding="md">
    <div class="p-gallery__card">
      <h3 class="p-gallery__title">${cap(g.title, 200)}</h3>
      <p class="p-gallery__summary">${cap(g.summary, 400)}</p>
      <div class="p-gallery__meta">
        ${g.to ? html`<${AgentChip} agent=${{ slug: g.to, name: cap(g.toName, 80) || g.to }} />` : html`<span class="p-gallery__who">The Chief of staff decides</span>`}
        ${g.size && html`<${Chip}>${cap(g.size, 8)}<//>`}
        ${g.planFirst && html`<${Tag}>Plan first<//>`}
      </div>
    </div>
  <//>`;
}

export default function Page({ route }) {
  const { openComposer } = useApp();
  const query = (route && route.query) || new URLSearchParams();
  const d = query.get("d") || "all";
  const open = query.get("open");
  const res = useResource("/api/gallery");
  const data = res.data;
  const departments = data && Array.isArray(data.departments) ? data.departments : [];
  const problems = data && Array.isArray(data.problems) ? data.problems : [];

  // `?open=<id>` starts that goal once the list has arrived; runs again on each visit to the page.
  const wanted = open ? find(departments, open) : null;
  const wantedId = wanted ? wanted.id : null;
  useEffect(() => {
    if (wanted) start(openComposer, wanted);
  }, [open, wantedId]);

  const tabs = [{ id: "all", label: "All" }, ...departments.map((x) => ({ id: x.id, label: cap(x.title, 60), count: Array.isArray(x.goals) ? x.goals.length : 0 }))];
  const goals = pick(departments, d);
  const onTab = (id) => { location.hash = id === "all" ? "#/gallery" : `#/gallery?d=${encodeURIComponent(id)}`; };

  return html`<div class="p-gallery">
    <${PageHeader} title="Ready-made goals" lead=${LEAD} />
    ${res.loading && !data ? html`<${Loading} lines=${4} />` : null}
    ${res.error && !data ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
    ${data && html`
      <${Tabs} tabs=${tabs} current=${d} onChange=${onTab} label="Departments" />
      ${goals.length === 0
        ? html`<${Empty} title="No ready-made goals here" text="Pick another department." />`
        : html`<div class="p-gallery__grid">${goals.map((g) => html`<${GoalCard} key=${g.id} g=${g} onOpen=${(x) => start(openComposer, x)} />`)}</div>`}
      ${problems.length > 0 && html`<${Section} title="Left out">
        <ul class="p-gallery__problems">${problems.slice(0, 20).map((p, i) => html`<li key=${i}>${cap(p.file, 120)}: ${cap(p.problem, 300)}</li>`)}</ul>
      <//>`}
    `}
  </div>`;
}
