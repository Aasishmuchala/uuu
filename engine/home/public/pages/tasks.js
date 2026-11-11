// Tasks: every task as a board of six columns, or as one list grouped by column. CONTRACTS-V2 14.1 and 17.2.
// Address: #/tasks (board), #/tasks?view=list, #/tasks?who=<slug>. Data: GET /api/tasks (shape `tasks`).
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  BoardColumn,
  Button,
  Empty,
  ErrorNotice,
  Loading,
  NotConnected,
  PageHeader,
  Select,
  TaskCard,
  TaskRow,
  Time,
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

const text = (v) => (v === null || v === undefined ? "" : String(v));
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

// The page's address for a view and a person. Board and everyone is plain `#/tasks`.
export function address({ view, who } = {}) {
  const q = new URLSearchParams();
  if (view === "list") q.set("view", "list");
  if (who) q.set("who", String(who));
  const s = q.toString();
  return s ? `#/tasks?${s}` : "#/tasks";
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

// The list view: one group per column that has anything, in the server's order.
export function toList(columns) {
  if (!Array.isArray(columns)) return [];
  return columns
    .filter((c) => c && COLUMN_IDS.includes(c.id))
    .map((c) => {
      const tasks = (Array.isArray(c.tasks) ? c.tasks : []).filter((t) => t && typeof t === "object").slice(0, MAX_TASKS_PER_COLUMN);
      const count = Math.max(num(c.count), tasks.length);
      return { id: c.id, label: text(c.label) || COLUMN_LABELS[c.id], count, tasks, older: Math.max(0, count - tasks.length) };
    })
    .filter((g) => g.count > 0);
}

// Who the page may filter by: everyone, then each agent of the team (and the address's slug if the team does not know it yet).
export function whoOptions(team, who) {
  const rows = (Array.isArray(team) ? team : []).filter((a) => a && SLUG.test(text(a.slug)));
  const options = [{ value: "", label: "Everyone" }, ...rows.map((a) => ({ value: a.slug, label: text(a.name) || a.slug }))];
  if (who && !options.some((o) => o.value === who)) options.push({ value: who, label: who });
  return options;
}

const olderLine = (n) => (n > 0 ? html`<p class="p-tasks__older u-caption">and ${n} older</p>` : null);

function Board({ columns }) {
  return html`<div class="p-tasks__board">
    ${columns.map((c) => {
      const slim = SLIM_WHEN_EMPTY.has(c.id) && c.count === 0;
      const n = older(c);
      const cards = c.tasks.map((t) => html`<${TaskCard} key=${text(t.id || t.identifier)} task=${t} />`);
      const children = n > 0 ? [...cards, olderLine(n)] : cards;
      return html`<div key=${c.id} class=${`p-tasks__col p-tasks__col--${c.id}${slim ? " p-tasks__col--slim" : ""}`}>
        <${BoardColumn} column=${c}>${children}<//>
      </div>`;
    })}
  </div>`;
}

function List({ groups }) {
  return html`<div class="p-tasks__list">
    ${groups.map((g) => html`<section key=${g.id} class="p-tasks__group" aria-labelledby=${`p-tasks-group-${g.id}`}>
      <h2 class="p-tasks__group-head" id=${`p-tasks-group-${g.id}`}>
        <span>${g.label}</span><span class="p-tasks__group-count u-caption">${g.count}</span>
      </h2>
      <ul class="p-tasks__rows">
        ${g.tasks.map((t) => html`<li key=${text(t.id || t.identifier)} class="p-tasks__row">
          <div class="p-tasks__row-main"><${TaskRow} task=${t} /></div>
          <span class="p-tasks__row-state u-muted">${text(t.plainState)}</span>
          <span class="p-tasks__row-date u-caption">${(t.updatedAt || t.createdAt) && html`<${Time} at=${t.updatedAt || t.createdAt} />`}</span>
        </li>`)}
      </ul>
      ${olderLine(g.older)}
    </section>`)}
  </div>`;
}

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route && route.query ? route.query : new URLSearchParams();
  const view = query.get("view") === "list" ? "list" : "board";
  const rawWho = text(query.get("who"));
  const who = SLUG.test(rawWho) ? rawWho : "";
  const res = useResource(`/api/tasks${who ? `?who=${encodeURIComponent(who)}` : ""}`, { every: 10000 });

  const team = app.shell && Array.isArray(app.shell.team) ? app.shell.team : [];
  const options = whoOptions(team, who);
  const whoName = (options.find((o) => o.value === who) || {}).label || "";
  const newTask = () => { if (typeof app.openComposer === "function") app.openComposer(); };
  const goTo = (to) => { if (typeof location !== "undefined") location.hash = address(to); };

  const actions = html`<div class="p-tasks__actions">
    <nav class="p-tasks__switch" aria-label="How to show the tasks">
      <a class="p-tasks__switch-link" href=${address({ who })} aria-current=${view === "board" ? "page" : null}>Board</a>
      <a class="p-tasks__switch-link" href=${address({ view: "list", who })} aria-current=${view === "list" ? "page" : null}>List</a>
    </nav>
    <label class="p-tasks__who">
      <span class="u-caption">Who</span>
      <${Select} options=${options} value=${who} aria-label="Who"
        onChange=${(e) => goTo({ view, who: e.currentTarget.value })} />
    </label>
    <${Button} variant="primary" icon="plus" onClick=${newTask}>New task<//>
  </div>`;

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
          ${who && html`<p><a href=${address({ view })}>Show everyone's tasks</a></p>`}
        </div>`;
  } else if (data && data.connected === false && data.notConnected) {
    body = html`<${NotConnected} title="Tasks cannot be shown right now" reason=${text(data.notConnected.reason)} next=${text(data.notConnected.next)} />`;
  } else if (data) {
    const columns = columnsOf(data);
    const total = columns.reduce((n, c) => n + c.count, 0);
    if (total === 0) {
      body = who
        ? html`<${Empty} title=${`${whoName || "This agent"} has no tasks yet.`}>
            <a href=${address({ view })}>Show everyone's tasks</a>
          <//>`
        : html`<${Empty} title="No tasks yet.">
            <${Button} variant="primary" icon="plus" onClick=${newTask}>New task<//>
          <//>`;
    } else {
      body = view === "list" ? html`<${List} groups=${toList(columns)} />` : html`<${Board} columns=${columns} />`;
    }
  } else {
    body = html`<${Loading} lines=${6} label="Loading the tasks" />`;
  }

  return html`<div class=${`p-tasks p-tasks--${view}`}>
    <${PageHeader} title="Tasks" actions=${actions} />
    ${body}
  </div>`;
}
