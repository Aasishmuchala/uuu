// Needs you: every item waiting for the owner as a full decision card, urgent first, with chips to filter by
// department and the not-connected lines. CONTRACTS-V3 30 ("Needs you") and 26.4.
// Address: #/needs-you, #/needs-you?d=<department>. Data: GET /api/inbox every 10 seconds; the agents of each
// department come from GET /api/map (read once; without it items are placed by their source alone).
// A finished task with versions (PLAN-V5 K9) is a card of versions to pick from (kit PickCard); after a pick its
// outcome stays at the top of the list, so the owner sees what was chosen when the item leaves the list. A film's
// shotlist (PLAN-V5 K14, T45) is a card of treatments and their cost to approve (kit ShotlistCard), settled the same way.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  DecisionCard, Empty, ErrorNotice, Loading, NotConnected, PageHeader, PickCard, PickDone, ShotlistCard, ShotlistDone, isPickItem, isShotlistItem,
} from "../kit/index.js";

const DEPARTMENT_IDS = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
const DEPARTMENT_TITLES = { operations: "Operations", sales: "Sales", marketing: "Marketing", studio: "Studio", support: "Support", people: "People", books: "Books" };
// The department a dashboard's items belong to (CONTRACTS-V3 26.4): `customers` counts for sales.
const SOURCE_DEPARTMENT = { books: "books", people: "people", support: "support", marketing: "marketing", customers: "sales" };
const SOURCE_WORDS = { board: "The board", books: "The books", customers: "Customers", support: "Support", people: "People", marketing: "Marketing", studio: "Studio", goal: "Tasks" };
const MAX_ITEMS = 200;
const MAX_SETTLED = 3;

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// A next step for the owner in words: a command ("Run: ...") stays off screen outside Health (C3 25, M50 F18);
// Health is linked instead.
export const plainNext = (next) => (/\bRun:/i.test(String(next ?? "")) ? "" : String(next ?? "").slice(0, 200));

// The page's address for a department filter. Everyone is plain `#/needs-you`.
export function address(d) {
  return DEPARTMENT_IDS.includes(d) ? `#/needs-you?d=${d}` : "#/needs-you";
}

// The filter an address asks for: one of the seven departments, else none.
export function filterOf(query) {
  const d = query && typeof query.get === "function" ? String(query.get("d") || "") : "";
  return DEPARTMENT_IDS.includes(d) ? d : "";
}

// Pure. The department of one item: the one the home server placed it in (`department`: a task's item belongs to
// the task's department, as the map and the dock count it), else the one whose agent raised it (`agent.slug`),
// else the one whose dashboard is its source, else "" (the item belongs to no department). `departments` is
// /api/map's list ({ id, agents: [{ slug }] }), when it could be read.
export function departmentOf(item, departments) {
  if (!item || typeof item !== "object") return "";
  if (Object.hasOwn(item, "department")) return DEPARTMENT_IDS.includes(item.department) ? item.department : "";
  const slug = item.agent && typeof item.agent === "object" ? item.agent.slug : "";
  if (slug) {
    for (const d of Array.isArray(departments) ? departments : []) {
      if (!d || !DEPARTMENT_IDS.includes(d.id)) continue;
      const agents = Array.isArray(d.agents) ? d.agents : [];
      if (agents.some((a) => (a && typeof a === "object" ? a.slug : a) === slug)) return d.id;
    }
  }
  return Object.hasOwn(SOURCE_DEPARTMENT, item.source) ? SOURCE_DEPARTMENT[item.source] : "";
}

const timeOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// Pure. Urgent first, then newest first; items of the same rank keep their order.
export function sortItems(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i === "object" && i.id).slice(0, MAX_ITEMS);
  return list
    .map((item, n) => ({ item, n, urgent: item.severity === "high" ? 0 : 1, at: timeOf(item.when) }))
    .sort((a, b) => a.urgent - b.urgent || b.at - a.at || a.n - b.n)
    .map((x) => x.item);
}

// Pure. The chips: "All" first, then each department that has an item (and the one the address asks for),
// each with its count.
export function chipsFor(items, departments, current) {
  const list = Array.isArray(items) ? items : [];
  const counts = new Map();
  for (const i of list) {
    const d = departmentOf(i, departments);
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  const chips = [{ id: "", label: "All", count: list.length, href: address("") }];
  for (const id of DEPARTMENT_IDS) {
    if (counts.has(id) || id === current) chips.push({ id, label: DEPARTMENT_TITLES[id], count: counts.get(id) || 0, href: address(id) });
  }
  return chips;
}

// Pure. The items to show: the sorted list, narrowed to one department when asked.
export function itemsFor(items, departments, d) {
  const sorted = sortItems(items);
  return d ? sorted.filter((i) => departmentOf(i, departments) === d) : sorted;
}

// Pure. The not-connected lines, each a source and a reason, at most ten.
export function quietLines(list) {
  return (Array.isArray(list) ? list : []).filter((n) => n && typeof n === "object").slice(0, 10)
    .map((n) => ({ source: SOURCE_WORDS[n.source] || "A part", reason: cap(n.reason, 200) }));
}

// Pure. The outcomes of picks to keep showing: the newest first, at most three, and only those whose item has
// left the list (while it is still listed, its own card says what happened).
export function settledShown(settled, items) {
  const listed = new Set((Array.isArray(items) ? items : []).map((i) => i && i.id));
  return (Array.isArray(settled) ? settled : []).filter((s) => s && s.id && !listed.has(s.id)).slice(0, MAX_SETTLED);
}

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route && route.query ? route.query : new URLSearchParams();
  const d = filterOf(query);
  const res = useResource("/api/inbox", { every: 10000 });
  const [departments, setDepartments] = useState(null);
  const [settled, setSettled] = useState([]);

  // The agents of each department, once; the page works without them.
  useEffect(() => {
    let live = true;
    api.get("/api/map")
      .then((m) => { if (live) setDepartments(Array.isArray(m?.departments) ? m.departments : []); })
      .catch(() => { if (live) setDepartments([]); });
    return () => { live = false; };
  }, []);

  // After an action the list and the shell's count are read again at once.
  const done = (r) => {
    if (r && r.done && r.done.id) setSettled((old) => [r.done, ...old.filter((s) => s.id !== r.done.id)].slice(0, MAX_SETTLED));
    res.refresh();
    if (typeof app.refreshShell === "function") app.refreshShell();
    if (r && r.message && typeof app.announce === "function") app.announce(String(r.message));
  };

  const data = res.data;
  let body;
  if (!data && res.loading) body = html`<${Loading} lines=${5} label="Loading what needs you" />`;
  else if (!data && res.error) {
    const e = res.error;
    body = e.offline || e.status === 502
      ? html`<${NotConnected} title="What needs you cannot be shown right now" reason=${e.message} next=${plainNext(e.next)} />
          <p><a class="p-needs-you__link" href="#/health">Open Health</a></p>`
      : html`<${ErrorNotice} error=${e} onRetry=${res.reload} />`;
  } else if (data) {
    const all = sortItems(data.items);
    const shown = itemsFor(data.items, departments, d);
    const chips = chipsFor(all, departments, d);
    const quiet = quietLines(data.notConnected);
    const kept = settledShown(settled, all);
    const outcomes = kept.length ? html`<div class="p-needs-you__list">
      ${kept.map((s, i) => (s.kind === "shotlist"
        ? html`<${ShotlistDone} key=${`done:${s.id}`} done=${s} focus=${i === 0} />`
        : html`<${PickDone} key=${`done:${s.id}`} done=${s} focus=${i === 0} />`))}
    </div>` : null;
    let list;
    if (!all.length) {
      list = html`${outcomes}<${Empty} title="Nothing needs you.">
        <a class="p-needs-you__link" href="#/map">Back to the map</a>
      <//>`;
    } else if (!shown.length) {
      list = html`<${Empty} title=${`Nothing from ${DEPARTMENT_TITLES[d]} needs you.`}>
        <a class="p-needs-you__link" href=${address("")}>Show everything</a>
      <//>`;
    } else {
      list = html`${outcomes}<div class="p-needs-you__list">
        ${shown.map((item) => (isShotlistItem(item)
          ? html`<${ShotlistCard} key=${item.id} item=${item} onDone=${done} />`
          : isPickItem(item)
            ? html`<${PickCard} key=${item.id} item=${item} onDone=${done} />`
            : html`<${DecisionCard} key=${item.id} item=${item} onDone=${done} />`))}
      </div>`;
    }
    body = html`
      ${all.length || d ? html`<nav class="p-needs-you__filters" aria-label="Filter by department">
        ${chips.map((c) => html`<a key=${c.id || "all"} class="p-needs-you__filter" href=${c.href} aria-current=${c.id === d ? "page" : null}>
          <span>${c.label}</span><span class="p-needs-you__count">${c.count}</span>
        </a>`)}
      </nav>` : null}
      ${list}
      ${quiet.length ? html`<ul class="p-needs-you__quiet">
        ${quiet.map((n, i) => html`<li key=${i}><span class="p-needs-you__source">${n.source}:</span> ${n.reason}</li>`)}
        <li><a class="p-needs-you__link" href="#/health">Open Health</a></li>
      </ul>` : null}`;
  } else body = html`<${Loading} lines=${5} label="Loading what needs you" />`;

  return html`<div class="p-needs-you">
    <${PageHeader} title="Needs you" lead="Things your team has finished or cannot go on with until you decide." />
    ${body}
  </div>`;
}
