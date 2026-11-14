// Tasks: every task as a calm list grouped by what it needs, or as the board of six columns. CONTRACTS-V3 30, "Tasks".
// Address: #/tasks (list), #/tasks?view=board, ?who=<slug>, ?d=<department>, ?state=<group> (the list only). Data:
// GET /api/tasks (shape `tasks`), with ?who= and ?d= passed on; the state is chosen here, from the cards. The list's
// groups come from the cards: waiting for the owner first, then by column.
// PLAN-COOK T61 (R03): the title, then one row of filters as quiet buttons that open a menu (state, department,
// agent) with the view switch and New task at the right; groups as one-line headers on the raised step with a count
// and a fold arrow, the rows under each on one left edge. Needs you is said by the rows' glyph and words alone.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  BoardColumn,
  Button,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  Menu,
  NotConnected,
  PageHeader,
  Segmented,
  TaskCard,
  TaskRow,
  rowLine,
} from "../kit/index.js";

const COLUMN_IDS = ["backlog", "in_progress", "pending_review", "done", "failed", "canceled"];
// The board's columns are named in the list's words (C3 25: plain column names, not the board's states).
// Canceled tasks are shown with the failed ones, under one column: Stopped.
const COLUMN_LABELS = {
  backlog: "Waiting to start",
  in_progress: "Working",
  pending_review: "Needs you",
  done: "Finished",
  failed: "Stopped",
  canceled: "Stopped",
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

// A next step for the owner in words: a command ("Run: ...") stays off screen outside Health (C3 25, M50 F18);
// Health is linked instead.
export const plainNext = (next) => (/\bRun:/i.test(String(next ?? "")) ? "" : String(next ?? "").slice(0, 200));

// The page's words that are not a task's own: the filters' names, their menus' first choices and the sentences of
// a state with nothing in it.
export const WORDS = {
  state: "State",
  department: "Department",
  agent: "Agent",
  everyState: "Every state",
  filters: "Filter the tasks",
  stateLabel: "Show the tasks in one state",
  departmentLabel: "Show the tasks of one department",
  agentLabel: "Show the tasks of one agent",
  views: "How to show the tasks",
  none: {
    "needs-you": "Nothing needs you right now.",
    working: "Nothing is being worked on right now.",
    waiting: "Nothing is waiting to start.",
    finished: "Nothing has finished yet.",
    stopped: "Nothing has stopped.",
  },
};

// The page's address for a view, a person, a department and a state. The list, everyone, every department and every
// state is plain `#/tasks`. The state is the list's alone: the board's columns already are the states.
export function address({ view, who, d, state } = {}) {
  const q = new URLSearchParams();
  if (view === "board") q.set("view", "board");
  if (who) q.set("who", String(who));
  if (d) q.set("d", String(d));
  if (state && view !== "board" && GROUPS.some((g) => g.id === state)) q.set("state", String(state));
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
    return { id, label: COLUMN_LABELS[id], count: Math.max(num(c.count), tasks.length), tasks };
  });
}

// The board's columns: the six of the answer with Failed and Canceled folded into one, Stopped (newest first).
export function boardColumns(columns) {
  const list = Array.isArray(columns) ? columns : [];
  const out = list.filter((c) => c && c.id !== "failed" && c.id !== "canceled");
  const stopped = list.filter((c) => c && (c.id === "failed" || c.id === "canceled"));
  if (stopped.length) {
    const tasks = stopped.flatMap((c) => c.tasks.map((t, i) => ({ t, i })))
      .sort((a, b) => at(b.t) - at(a.t) || a.i - b.i).map((x) => x.t);
    out.push({ id: "failed", label: COLUMN_LABELS.failed, count: stopped.reduce((n, c) => n + c.count, 0), tasks });
  }
  return out;
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

// The state filter's choices: every state, then each group of the list in its order.
export function stateOptions() {
  return [{ value: "", label: WORDS.everyState }, ...GROUPS.map((g) => ({ value: g.id, label: g.label }))];
}

// The list's groups narrowed to one state (all of them when none is chosen or the state is not one of the list's).
export function inState(groups, state) {
  const list = Array.isArray(groups) ? groups : [];
  return state && GROUPS.some((g) => g.id === state) ? list.filter((g) => g && g.id === state) : list;
}

// A filter's button shows the filter's name while nothing is chosen, and the choice once one is (R03).
export function filterLabel(name, options, current) {
  const on = current ? (Array.isArray(options) ? options : []).find((o) => o.value === current) : null;
  return on ? text(on.label) || name : name;
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

const olderLine = (n) => (n > 0 ? html`<p class="p-tasks__older">and ${n} older</p>` : null);

function Column({ c }) {
  const slim = SLIM_WHEN_EMPTY.has(c.id) && c.count === 0;
  const n = older(c);
  const cards = c.tasks.map((t) => html`<${TaskCard} key=${text(t.id || t.identifier)} task=${t} />`);
  const children = n > 0 ? [...cards, olderLine(n)] : cards;
  return html`<div class=${`p-tasks__col p-tasks__col--${c.id}${slim ? " p-tasks__col--slim" : ""}`}>
    <${BoardColumn} column=${c}>${children}<//>
  </div>`;
}

// Stopped (failed and canceled together) takes the last place on the board, slim while it holds nothing.
function Board({ columns }) {
  const folded = boardColumns(columns);
  const main = folded.filter((c) => !SLIM_WHEN_EMPTY.has(c.id));
  const last = folded.filter((c) => SLIM_WHEN_EMPTY.has(c.id));
  const allSlim = last.every((c) => c.count === 0);
  return html`<div class="p-tasks__board">
    ${main.map((c) => html`<${Column} key=${c.id} c=${c} />`)}
    ${last.length > 0 && html`<div class=${`p-tasks__stack${allSlim ? " p-tasks__stack--slim" : ""}`}>
      ${last.map((c) => html`<${Column} key=${c.id} c=${c} />`)}
    </div>`}
  </div>`;
}

// A group: one header on the raised step (its name, its count, the fold arrow), then its rows on the ground.
function Group({ g, open, onFold }) {
  const head = `p-tasks-group-${g.id}`;
  const rows = `p-tasks-rows-${g.id}`;
  return html`<section class=${`p-tasks__group p-tasks__group--${g.id}${open ? "" : " p-tasks__group--folded"}`} aria-labelledby=${head}>
    <h2 class="p-tasks__group-head" id=${head}>
      <button type="button" class="p-tasks__fold" aria-expanded=${open ? "true" : "false"} aria-controls=${rows} onClick=${onFold}>
        <span class="p-tasks__group-label">${g.label}</span>
        <span class="p-tasks__group-count">${g.count}</span>
        <${Icon} name="chevron-down" size=${16} class="p-tasks__fold-mark" />
      </button>
    </h2>
    <div id=${rows} class="p-tasks__group-body" hidden=${!open}>
      <ul class="p-tasks__rows">
        ${g.tasks.map((t) => html`<li key=${text(t.id || t.identifier)} class="p-tasks__row"><${TaskRow} task=${forRow(t)} /></li>`)}
      </ul>
      ${olderLine(g.older)}
    </div>
  </section>`;
}

function List({ groups }) {
  const [folded, setFolded] = useState(() => new Set());
  const fold = (id) => setFolded((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return html`<div class="p-tasks__list">
    ${groups.map((g) => html`<${Group} key=${g.id} g=${g} open=${!folded.has(g.id)} onFold=${() => fold(g.id)} />`)}
  </div>`;
}

const go = (href) => { if (href && typeof location !== "undefined") location.hash = href; };

// One filter: a quiet button that shows its name, or its choice once one is made, and opens the kit's menu of
// choices; the current choice carries the check. A choice goes to its address.
function Filter({ name, label, options, current, make }) {
  const items = chipLinks(options, current, make).map((o) => ({
    id: o.value || "all", label: o.label, icon: o.current ? "check" : undefined, onSelect: () => go(o.href),
  }));
  return html`<div class=${`p-tasks__filter${current ? " p-tasks__filter--on" : ""}`} role="group" aria-label=${label}>
    <${Menu} label=${filterLabel(name, options, current)} items=${items} />
  </div>`;
}

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route && route.query ? route.query : new URLSearchParams();
  const view = query.get("view") === "board" ? "board" : "list";
  const rawWho = text(query.get("who"));
  const who = SLUG.test(rawWho) ? rawWho : "";
  const rawD = text(query.get("d"));
  const d = SLUG.test(rawD) ? rawD : "";
  const rawState = text(query.get("state"));
  const state = view === "list" && GROUPS.some((g) => g.id === rawState) ? rawState : "";
  const res = useResource(apiPath({ who, d }), { every: 10000 });

  const team = app.shell && Array.isArray(app.shell.team) ? app.shell.team : [];
  const dock = Array.isArray(app.dock) && app.dock.length ? app.dock : app.shell && Array.isArray(app.shell.dock) ? app.shell.dock : [];
  const people = whoOptions(team, who);
  const depts = departmentOptions(dock, d);
  const whoName = (people.find((o) => o.value === who) || {}).label || "";
  const deptName = (depts.find((o) => o.value === d) || {}).label || "";
  const newTask = () => { if (typeof app.openComposer === "function") app.openComposer(); };

  const bar = html`<div class="p-tasks__bar">
    <div class="p-tasks__filters" role="group" aria-label=${WORDS.filters}>
      ${view === "list" && html`<${Filter} name=${WORDS.state} label=${WORDS.stateLabel} options=${stateOptions()} current=${state}
        make=${(value) => address({ view, who, d, state: value })} />`}
      <${Filter} name=${WORDS.department} label=${WORDS.departmentLabel} options=${depts} current=${d}
        make=${(value) => address({ view, who, d: value, state })} />
      <${Filter} name=${WORDS.agent} label=${WORDS.agentLabel} options=${people} current=${who}
        make=${(value) => address({ view, who: value, d, state })} />
    </div>
    <div class="p-tasks__actions">
      <${Segmented} label=${WORDS.views} current=${view}
        items=${[
          { id: "list", label: "List", icon: "list", href: address({ who, d, state }) },
          { id: "board", label: "Board", icon: "grid", href: address({ view: "board", who, d }) },
        ]} />
      <${Button} variant="primary" icon="plus" onClick=${newTask}>New task<//>
    </div>
  </div>`;

  const filtered = who || d;
  const showAll = html`<a class="p-tasks__link" href=${address({ view })}>Show every task</a>`;

  let body;
  const data = res.data;
  if (!data && res.loading) {
    body = html`<${Loading} lines=${6} label="Loading the tasks" />`;
  } else if (!data && res.error) {
    const e = res.error;
    body = e.offline || e.status === 502
      ? html`<${NotConnected} title="Tasks cannot be shown right now" reason=${e.message} next=${plainNext(e.next)} />
          <p><a class="p-tasks__link" href="#/health">Open Health</a></p>`
      : html`<div class="u-stack">
          <${ErrorNotice} error=${e} onRetry=${res.reload} />
          ${filtered && html`<p>${showAll}</p>`}
        </div>`;
  } else if (data && data.connected === false && data.notConnected) {
    body = html`<${NotConnected} title="Tasks cannot be shown right now" reason=${text(data.notConnected.reason)} next=${plainNext(data.notConnected.next)} />
      <p><a class="p-tasks__link" href="#/health">Open Health</a></p>`;
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
            <a class="p-tasks__link" href="#/jobs">See the jobs</a>
          <//>`;
    } else if (view === "board") {
      body = html`<${Board} columns=${columns} />`;
    } else {
      const groups = inState(groupsOf(columns), state);
      body = groups.length
        ? html`<${List} groups=${groups} />`
        : html`<${Empty} title=${WORDS.none[state]}><a class="p-tasks__link" href=${address({ view, who, d })}>Show every task</a><//>`;
    }
  } else {
    body = html`<${Loading} lines=${6} label="Loading the tasks" />`;
  }

  return html`<div class=${`p-tasks p-tasks--${view}`}>
    <${PageHeader} title="Tasks">${bar}<//>
    ${body}
  </div>`;
}
