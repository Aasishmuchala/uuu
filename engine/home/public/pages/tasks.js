// Tasks: every task as a calm list grouped by what it needs, or as the board of six columns. CONTRACTS-V3 30, "Tasks".
// Address: #/tasks (list), #/tasks?view=board, ?who=<slug>, ?d=<department>, ?state=<group> (the list only). Data:
// GET /api/tasks (shape `tasks`), with ?who= and ?d= passed on; the state is chosen here, from the cards. The list's
// groups come from the cards: waiting for the owner first, then by column.
// PLAN-COOK T61 (R03): the title, then one row of filters as quiet buttons that open a menu (state, department,
// agent) with the view switch and New task at the right; groups as one-line headers on the raised step with a count
// and a fold arrow, the rows under each on one left edge. Needs you is said by the rows' glyph and words alone.
// Fix round B2 (TB5a): a row is two lines: the state's glyph (neutral unless the state asks for the eye), the title
// with its ID, the state's sentence under it, and the date in a right-hand column, relative while it is recent. The
// group bars are flat, a step off the ground; the filters edged and 32 px. The page stands on the white pane in light
// (k-page--plain, styles/shell.css).
// Fix round R5 (R5-H): a row is one line at about 52 px: the state's glyph in the third ink (the warn tone only on a
// row that is stuck), the title, then at the right the state as a small chip (the row's own words shortened by the
// pinned table CHIP_WORDS, left out where it only repeats its group's name), the ID and the date. The whole state
// sentence stays the row's spoken words and its hover. A second line only for words of the row's own (an answer, a
// result's sentence). A group's head is its label and count over a hairline, no filled band.
// Fix round R6 (R6-H): every row one height: the row's own words follow its title on the same line in the second
// ink, cut with an ellipsis; the state quiet words with a dot (the kit's Tag, only Stuck in the warn tone and
// Working in the info tone); a group's head a quiet filled band (32 px, 6 px corner, the raised tone).
// PLAN-3D-ALL U5: the studio's language. The title and the bar sit in the room header (kit/room.js), the desk's
// glimpse behind them; the rows stay on the ground. States follow the lamps (D5): a working row's glyph is lit
// (the lamp's tone in its pool of light), a stuck one amber, a finished row quiet; shape and words as before.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, when } from "../lib/format.js";
import {
  BoardColumn,
  Button,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  Menu,
  NotConnected,
  Mono,
  RoomHeader,
  Segmented,
  StateIcon,
  Tag,
  TaskCard,
  glimpseFor,
  rowLine,
  taskHref,
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

// The words of a row's second line, as the list shows them: the job (or "A question"), then the outcome, or the
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

// A row's glyph: its column's own shape, in the third ink; the warn tone only on a row that is stuck ("Stuck, needs
// you"), so amber marks the rows that differ from their neighbours and never every row of a group (R5-H). `word` is
// the state in words, for screen readers. Pure.
const COLUMN_WORDS = { backlog: "Backlog", in_progress: "In progress", pending_review: "Pending review", done: "Done", failed: "Failed", canceled: "Canceled" };
const STUCK = "Stuck, needs you";
export function glyphOf(task) {
  const t = task && typeof task === "object" ? task : {};
  const column = COLUMN_IDS.includes(t.column) ? t.column : "backlog";
  const tone = text(t.plainState) === STUCK ? "warn" : "";
  if (t.live === true) return { column: "in_progress", tone, word: "Working" };
  if (t.waitingForYou === true && !tone) return { column, tone, word: "Waiting for you" };
  return { column, tone, word: text(t.plainState) || COLUMN_WORDS[column] };
}

// The short state chip, made from the words the row already has: the pinned table below, read in order (stuck first,
// then working, then the plain state, then waiting for the owner, then the board column's own word). Nothing is
// invented: every chip is a word or two of the sentence it stands for.
export const CHIP_WORDS = {
  "Stuck, needs you": "Stuck",
  Working: "Working",
  "Being worked on": "Working",
  "Being checked": "Checking",
  "Waiting to start": "Waiting",
  "Waiting its turn": "Waiting",
  Finished: "Finished",
  Stopped: "Stopped",
  "Waiting for you": "Needs you",
  Backlog: "Backlog",
  "In progress": "In progress",
  "Pending review": "Review",
  Done: "Done",
  Failed: "Failed",
  Canceled: "Canceled",
};
// The tone of a chip: only a stuck row takes the warn tone and a working one the info tone; every other state is
// neutral words.
export const CHIP_TONES = { Stuck: "warn", Working: "info" };
// A group's own name as a chip says it: a row's chip equal to it is left out (the group's head already says it).
export const GROUP_CHIP = { "needs-you": "Needs you", working: "Working", waiting: "Waiting", finished: "Finished", stopped: "Stopped" };

// The whole state sentence of a row, without its outcome: the job, waiting for the owner or working when the row's
// own words do not say it already, then the stage, the round and the state ("Brief: waiting for you · Stuck, needs
// you"). It is the row's spoken words and its hover. Pure.
export function stateSentence(task) {
  const t = forRow(task);
  if (!t || typeof t !== "object") return "";
  const jobTitle = t.job && t.job.title ? text(t.job.title) : "";
  const job = jobTitle && !text(t.title).toLowerCase().startsWith(jobTitle.toLowerCase()) ? jobTitle : "";
  const rest = rowLine({ ...t, outcome: null }, "waiting");
  const waiting = t.waitingForYou === true && !/waiting for you|needs you/i.test(rest) ? "Waiting for you" : "";
  const working = t.live === true && !/\bworking\b|being worked on/i.test(rest) ? "Working" : "";
  return [job, waiting, working, rest].filter(Boolean).join(" · ");
}

// The chip's word for a row, by the pinned table; "" when the row has no state words at all. Pure.
export function chipOf(task) {
  const t = task && typeof task === "object" ? task : {};
  const plain = text(t.plainState);
  const column = COLUMN_IDS.includes(t.column) ? t.column : "";
  if (plain === STUCK) return CHIP_WORDS[STUCK];
  if (t.live === true) return CHIP_WORDS.Working;
  if (Object.hasOwn(CHIP_WORDS, plain)) return CHIP_WORDS[plain];
  if (t.waitingForYou === true) return CHIP_WORDS["Waiting for you"];
  return column ? CHIP_WORDS[COLUMN_WORDS[column]] : "";
}

// A row's second line: only words of its own, an answer or a result's sentence (the job's name before it when the
// title does not start with it). "" for a row whose state words are all it has. Pure.
export function ownWords(task) {
  const t = forRow(task);
  if (!t || typeof t !== "object" || !text(t.outcome).trim()) return "";
  const jobTitle = t.job && t.job.title ? text(t.job.title) : "";
  const job = jobTitle && !text(t.title).toLowerCase().startsWith(jobTitle.toLowerCase()) ? jobTitle : "";
  return [job, rowLine({ ...t, live: false, waitingForYou: false })].filter(Boolean).join(" · ");
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// A row's date, relative while it is recent: "Just now", "12 min ago", "3 h ago" (under six hours), "Today 09:10",
// "Yesterday 14:05", "Wed 14:05" (this past week), then the plain date ("3 Nov", "3 Nov 2025"). Empty for a missing
// or broken time. Pure.
export function rowWhen(iso, now = new Date()) {
  const t = Date.parse(text(iso));
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const mins = Math.floor((now.getTime() - t) / 60000);
  if (mins < 0) return when(iso, now);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 360) return `${Math.floor(mins / 60)} h ago`;
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${WEEKDAYS[d.getDay()]} ${clock}`;
  return when(iso, now);
}

// One task on the list, one line: the glyph, the title (14 px 500) and after it the row's own words (an answer, a
// result's sentence) in the second ink, then at the right the state's quiet chip, the ID and the date. The whole state sentence is the row's
// spoken words and its hover. Under a group the chip is left out when it only says the group's name. The
// department and the agent are named for screen readers only.
function Line({ task, group }) {
  if (!task) return null;
  const g = glyphOf(task);
  // A working row's glyph is lit; amber (a stuck row) wins over it.
  const tone = g.tone || (task.live === true ? "lamp" : "");
  const sentence = stateSentence(task);
  const own = ownWords(task);
  const chip = chipOf(task);
  const showChip = chip && chip !== GROUP_CHIP[group] ? chip : "";
  const date = task.updatedAt || task.since || task.createdAt;
  const dept = typeof task.department === "string" ? DEPARTMENTS.find((x) => x.id === task.department) : null;
  const who = task.who && task.who.name ? text(task.who.name) : "";
  return html`<a class="p-tasks__line" href=${taskHref(task)} title=${sentence || undefined}>
    <span class=${`p-tasks__mark${tone ? ` p-tasks__mark--${tone}` : ""}`} aria-hidden="true"><${StateIcon} column=${g.column} label="" /></span>
    <span class="p-tasks__main">
      <span class="p-tasks__title" title=${text(task.title)}>${text(task.title)}</span>
      ${sentence && html`<span class="k-sr">. ${sentence}.</span>`}
      ${own && html`<span class="p-tasks__say">${own}</span>`}
      ${dept && html`<span class="k-sr">${dept.title}.</span>`}
      ${who && html`<span class="k-sr">${who}.</span>`}
    </span>
    <span class="p-tasks__meta">
      ${showChip && html`<span class="p-tasks__chip" aria-hidden="true"><${Tag} tone=${CHIP_TONES[showChip] || "neutral"} dot=${true} quiet=${true}>${showChip}<//></span>`}
      ${task.identifier && html`<span class="p-tasks__id"><${Mono}>${text(task.identifier)}<//></span>`}
      ${date && html`<time class="p-tasks__when" datetime=${text(date)} title=${fullWhen(date)}>${rowWhen(date)}</time>`}
    </span>
  </a>`;
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

// A group: its head is the label and count over a hairline (the whole line folds), then its rows on the ground.
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
        ${g.tasks.map((t) => html`<li key=${text(t.id || t.identifier)} class="p-tasks__row"><${Line} task=${forRow(t)} group=${g.id} /></li>`)}
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
    id: o.value || "all", label: o.label, icon: o.current ? "check" : undefined, current: o.current ? true : undefined, onSelect: () => go(o.href),
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
      <${Button} variant="primary" size="sm" icon="plus" onClick=${newTask}>New task<//>
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

  return html`<div class=${`p-tasks p-tasks--${view} k-page--plain`}>
    <${RoomHeader} glimpse=${glimpseFor("tasks")} title="Tasks">${bar}<//>
    ${body}
  </div>`;
}
