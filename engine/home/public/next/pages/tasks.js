// Tasks: every task as a calm list grouped by what it needs, or as the board of six columns. CONTRACTS-V3 30, "Tasks".
// Address: #/tasks (list), #/tasks?view=board, ?who=<slug>, ?d=<department>. Data: GET /api/tasks (shape `tasks`),
// with ?who= and ?d= passed on. The list's groups come from the cards: waiting for the owner first, then by column.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  BoardColumn,
  Button,
  Chip,
  Empty,
  ErrorNotice,
  Loading,
  NotConnected,
  PageHeader,
  Segmented,
  TaskCard,
  TaskRow,
  rowLine,
} from "../kit/index.js";

const COLUMN_IDS = ["backlog", "in_progress", "pending_review", "done", "failed", "canceled"];
const COLUMN_LABELS = {
  backlog: "Backlog",
  in_progress: "In progress",
  pending_review: "Pending review",
  done: "Done",
  failed: "Failed",
  canceled: "Canceled",
};
// Columns that stay slim, showing only their header, while they hold nothing.
const SLIM_WHEN_EMPTY = new Set(["failed", "canceled"]);
// Caps on what an answer may put on screen; the board never shows more than this per column.
const MAX_TASKS_PER_COLUMN = 200;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

// The list's groups, in order, and the column each card goes to when it is not waiting for the owner.
export const GROUPS = [
  { id: "needs-you", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "waiting", label: "Waiting to start" },
  { id: "finished", label: "Finished" },
  { id: "stopped", label: "Stopped" },
];
const GROUP_OF_COLUMN = {
  backlog: "waiting",
  in_progress: "working",
  pending_review: "working",
  done: "finished",
  failed: "stopped",
  canceled: "stopped",
};
// Finished shows only its newest 20; the rest are counted.
const FINISHED_MAX = 20;

// The seven departments (engine/company/departments.json), used until the shell's dock has been read.
const DEPARTMENTS = [
  { id: "operations", title: "Operations" },
  { id: "sales", title: "Sales" },
  { id: "marketing", title: "Marketing" },
  { id: "studio", title: "Studio" },
  { id: "support", title: "Support" },
  { id: "people", title: "People" },
  { id: "books", title: "Books" },
];

const text = (v) => (v === null || v === undefined ? "" : String(v));
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const at = (t) => {
  const n = Date.parse(text(t && (t.updatedAt || t.createdAt)));
  return Number.isFinite(n) ? n : 0;
};

// The page's address for a view, a person and a department. The list, everyone and every department is plain `#/tasks`.
export function address({ view, who, d } = {}) {
  const q = new URLSearchParams();
  if (view === "board") q.set("view", "board");
  if (who) q.set("who", String(who));
  if (d) q.set("d", String(d));
  const s = q.toString();
  return s ? `#/tasks?${s}` : "#/tasks";
}

// The API path for the filters in the address.
export function apiPath({ who, d } = {}) {
  const q = new URLSearchParams();
  if (who) q.set("who", String(who));
  if (d) q.set("d", String(d));
  const s = q.toString();
  return s ? `/api/tasks?${s}` : "/api/tasks";
}

// How many tasks of a column the answer left out (done and canceled keep only their newest 20).
export function older(column) {
  if (!column) return 0;
  const shown = Array.isArray(column.tasks) ? column.tasks.length : 0;
  return Math.max(0, num(column.count) - shown);
}

// The six columns in the server's order, each well formed, whatever the answer held.
export function columnsOf(data) {
  const given = data && Array.isArray(data.columns) ? data.columns : [];
  const byId = new Map(given.filter((c) => c && COLUMN_IDS.includes(c.id)).map((c) => [c.id, c]));
  const order = given.filter((c) => c && COLUMN_IDS.includes(c.id)).map((c) => c.id);
  for (const id of COLUMN_IDS) if (!order.includes(id)) order.push(id);
  return order.map((id) => {
    const c = byId.get(id) || {};
    const tasks = (Array.isArray(c.tasks) ? c.tasks : []).filter((t) => t && typeof t === "object").slice(0, MAX_TASKS_PER_COLUMN);
    return { id, label: text(c.label) || COLUMN_LABELS[id], count: Math.max(num(c.count), tasks.length), tasks };
  });
}

// The list view. Every card waiting for the owner goes under Needs you, whatever its column; the others go by
// column. Inside a group the newest comes first (the server's order breaks ties). Finished keeps its newest 20.
// `older` counts what is not shown: what the server left out of the group's columns, and what Finished cut.
// Only groups with something in them are returned, in the order of GROUPS.
export function groupsOf(columns) {
  const groups = new Map(GROUPS.map((g) => [g.id, { ...g, tasks: [], older: 0 }]));
  for (const c of Array.isArray(columns) ? columns : []) {
    if (!c || !COLUMN_IDS.includes(c.id)) continue;
    const tasks = (Array.isArray(c.tasks) ? c.tasks : []).filter((t) => t && typeof t === "object").slice(0, MAX_TASKS_PER_COLUMN);
    groups.get(GROUP_OF_COLUMN[c.id]).older += Math.max(0, num(c.count) - tasks.length);
    for (const t of tasks) groups.get(t.waitingForYou === true ? "needs-you" : GROUP_OF_COLUMN[c.id]).tasks.push(t);
  }
  const out = [];
  for (const g of groups.values()) {
    const sorted = g.tasks.map((t, i) => ({ t, i })).sort((a, b) => at(b.t) - at(a.t) || a.i - b.i).map((x) => x.t);
    const cap = g.id === "finished" ? FINISHED_MAX : MAX_TASKS_PER_COLUMN;
    const tasks = sorted.slice(0, cap);
    const left = g.older + (sorted.length - tasks.length);
    if (tasks.length + left === 0) continue;
    out.push({ id: g.id, label: g.label, tasks, count: tasks.length + left, older: left });
  }
  return out;
}

// A question to the company brain shows as one on its row, before the answer or the state.
export function forRow(task) {
  if (!task || typeof task !== "object") return task;
  if (task.ask === true && !(task.job && task.job.title)) return { ...task, job: { id: null, title: "A question" } };
  return task;
}

// The words of a row's second line, as TaskRow shows them: the job (or "A question"), then the outcome, or the
// stage and the state in words.
export function rowWords(task) {
  const t = forRow(task);
  if (!t || typeof t !== "object") return "";
  const job = t.job && t.job.title ? text(t.job.title) : "";
  return [job, rowLine(t)].filter(Boolean).join(" · ");
}

// The department chips: every department, from the shell's dock when it has been read (the brain is not one).
export function departmentOptions(dock, d) {
  const fromDock = (Array.isArray(dock) ? dock : [])
    .filter((x) => x && x.id !== "brain" && SLUG.test(text(x.id)))
    .map((x) => ({ id: x.id, title: text(x.title) || x.id }));
  const list = fromDock.length ? fromDock : DEPARTMENTS;
  const options = [{ value: "", label: "Every department" }, ...list.map((x) => ({ value: x.id, label: x.title }))];
  if (d && !options.some((o) => o.value === d)) options.push({ value: d, label: d });
  return options;
}

// Who the page may filter by: everyone, then each agent of the team (and the address's slug if the team does not know it yet).
export function whoOptions(team, who) {
  const rows = (Array.isArray(team) ? team : []).filter((a) => a && SLUG.test(text(a.slug)));
  const options = [{ value: "", label: "Everyone" }, ...rows.map((a) => ({ value: a.slug, label: text(a.name) || a.slug }))];
  if (who && !options.some((o) => o.value === who)) options.push({ value: who, label: who });
  return options;
}

// The filter chips: one link each, the current one marked. `make(value)` gives the address of a chip.
export function chipLinks(options, current, make) {
  return (Array.isArray(options) ? options : []).map((o) => ({ ...o, href: make(o.value), current: o.value === (current || "") }));
}

const olderLine = (n) => (n > 0 ? html`<p class="p-tasks__older u-caption">and ${n} older</p>` : null);

function Column({ c }) {
  const slim = SLIM_WHEN_EMPTY.has(c.id) && c.count === 0;
  const n = older(c);
  const cards = c.tasks.map((t) => html`<${TaskCard} key=${text(t.id || t.identifier)} task=${t} />`);
  const children = n > 0 ? [...cards, olderLine(n)] : cards;
  return html`<div class=${`p-tasks__col p-tasks__col--${c.id}${slim ? " p-tasks__col--slim" : ""}`}>
    <${BoardColumn} column=${c}>${children}<//>
  </div>`;
}

// Failed and Canceled share the last place on the board, one above the other, so all six fit at 1280 px.
function Board({ columns }) {
  const main = columns.filter((c) => !SLIM_WHEN_EMPTY.has(c.id));
  const last = columns.filter((c) => SLIM_WHEN_EMPTY.has(c.id));
  const allSlim = last.every((c) => c.count === 0);
  return html`<div class="p-tasks__board">
    ${main.map((c) => html`<${Column} key=${c.id} c=${c} />`)}
    ${last.length > 0 && html`<div class=${`p-tasks__stack${allSlim ? " p-tasks__stack--slim" : ""}`}>
      ${last.map((c) => html`<${Column} key=${c.id} c=${c} />`)}
    </div>`}
  </div>`;
}

function List({ groups }) {
  return html`<div class="p-tasks__list">
    ${groups.map((g) => html`<section key=${g.id} class=${`p-tasks__group p-tasks__group--${g.id}`} aria-labelledby=${`p-tasks-group-${g.id}`}>
      <h2 class="p-tasks__group-head" id=${`p-tasks-group-${g.id}`}>
        <span>${g.label}</span><span class="p-tasks__group-count">${g.count}</span>
      </h2>
      <ul class="p-tasks__rows u-glass">
        ${g.tasks.map((t) => html`<li key=${text(t.id || t.identifier)} class="p-tasks__row"><${TaskRow} task=${forRow(t)} /></li>`)}
      </ul>
      ${olderLine(g.older)}
    </section>`)}
  </div>`;
}

function Filters({ label, chips, dots }) {
  return html`<nav class="p-tasks__filter" aria-label=${label}>
    <ul class="p-tasks__chips">
      ${chips.map((c) => html`<li key=${c.value || "all"}>
        <a class=${`p-tasks__chip${c.current ? " p-tasks__chip--on" : ""}`} href=${c.href} aria-current=${c.current ? "page" : null}>
          <${Chip} dot=${dots && c.value ? c.value : null}>${c.label}<//>
        </a>
      </li>`)}
    </ul>
  </nav>`;
}

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route && route.query ? route.query : new URLSearchParams();
  const view = query.get("view") === "board" ? "board" : "list";
  const rawWho = text(query.get("who"));
  const who = SLUG.test(rawWho) ? rawWho : "";
  const rawD = text(query.get("d"));
  const d = SLUG.test(rawD) ? rawD : "";
  const res = useResource(apiPath({ who, d }), { every: 10000 });

  const team = app.shell && Array.isArray(app.shell.team) ? app.shell.team : [];
  const dock = Array.isArray(app.dock) && app.dock.length ? app.dock : app.shell && Array.isArray(app.shell.dock) ? app.shell.dock : [];
  const people = whoOptions(team, who);
  const depts = departmentOptions(dock, d);
  const whoName = (people.find((o) => o.value === who) || {}).label || "";
  const deptName = (depts.find((o) => o.value === d) || {}).label || "";
  const newTask = () => { if (typeof app.openComposer === "function") app.openComposer(); };

  const actions = html`<div class="p-tasks__actions">
    <${Segmented} label="How to show the tasks" size="sm" current=${view}
      items=${[
        { id: "list", label: "List", icon: "list", href: address({ who, d }) },
        { id: "board", label: "Board", icon: "grid", href: address({ view: "board", who, d }) },
      ]} />
    <${Button} variant="primary" icon="plus" onClick=${newTask}>New task<//>
  </div>`;

  const filters = html`<div class="p-tasks__filters">
    <${Filters} label="Show the tasks of one department" dots=${true}
      chips=${chipLinks(depts, d, (value) => address({ view, who, d: value }))} />
    <${Filters} label="Show the tasks of one agent"
      chips=${chipLinks(people, who, (value) => address({ view, who: value, d }))} />
  </div>`;

  const filtered = who || d;
  const showAll = html`<a href=${address({ view })}>Show every task</a>`;

  let body;
  const data = res.data;
  if (!data && res.loading) {
    body = html`<${Loading} lines=${6} label="Loading the tasks" />`;
  } else if (!data && res.error) {
    const e = res.error;
    body = e.offline || e.status === 502
      ? html`<${NotConnected} title="Tasks cannot be shown right now" reason=${e.message} next=${e.next} />`
      : html`<div class="u-stack">
          <${ErrorNotice} error=${e} onRetry=${res.reload} />
          ${filtered && html`<p>${showAll}</p>`}
        </div>`;
  } else if (data && data.connected === false && data.notConnected) {
    body = html`<${NotConnected} title="Tasks cannot be shown right now" reason=${text(data.notConnected.reason)} next=${text(data.notConnected.next)} />`;
  } else if (data) {
    const columns = columnsOf(data);
    const total = columns.reduce((n, c) => n + c.count, 0);
    if (total === 0) {
      const whose = who && d ? `${whoName || "This agent"} has no tasks in ${deptName || "this department"} yet.`
        : who ? `${whoName || "This agent"} has no tasks yet.`
          : d ? `${deptName || "This department"} has no tasks yet.` : "";
      body = filtered
        ? html`<${Empty} title=${whose}>${showAll}<//>`
        : html`<${Empty} title="No tasks yet." text="A task is work you give an agent. Start one, or pick a job.">
            <${Button} variant="primary" icon="plus" onClick=${newTask}>New task<//>
          <//>`;
    } else {
      body = view === "board" ? html`<${Board} columns=${columns} />` : html`<${List} groups=${groupsOf(columns)} />`;
    }
  } else {
    body = html`<${Loading} lines=${6} label="Loading the tasks" />`;
  }

  return html`<div class=${`p-tasks p-tasks--${view}`}>
    <${PageHeader} title="Tasks" actions=${actions}>${filters}<//>
    ${body}
  </div>`;
}
