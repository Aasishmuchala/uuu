// Tasks as one quiet line (TaskRow), as a board card (TaskCard), and a board column (BoardColumn). CONTRACTS-V2 13.2.
// `task` is a task-card (17.1); TaskRow also takes a Home "running" entry ({ taskId, identifier, title, who, live, plainState }).
// CONTRACTS-V3 28, redrawn by PLAN-COOK T37 (R03): TaskRow is one line: the state's glyph, the name, the ref quietly
// after it, one grey fact (the job, then the outcome, else the stage and state in words) and the date at the right.
// It reads the same with or without `outcome`, `job` and `department` (33.2). A department has no colour (O7): it is
// named for screen readers only. A row that needs the owner says so with its glyph and its words, never a tint.
// A task's short ref (STH-20) is how the owner and the agents name it, so it stays, quietly after the name.
import { html } from "../vendor/preact-htm.js";
import { when, fullWhen } from "../lib/format.js";
import { Icon, StateIcon } from "./icon.js";
import { Live, St } from "./status.js";
import { Chip } from "./tag.js";
import { Mono } from "./text.js";

const text = (v) => (v === null || v === undefined ? "" : String(v));

const COLUMN_LABELS = {
  backlog: "Backlog",
  in_progress: "In progress",
  pending_review: "Pending review",
  done: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

export const taskHref = (task) => {
  const id = task && (task.id || task.taskId || task.identifier);
  return id ? `#/tasks/${encodeURIComponent(id)}` : null;
};

// The words for a task's state: its plain state, else its column's label.
const stateWords = (task) => text(task.plainState) || COLUMN_LABELS[task.column] || "";

// The seven departments' names (engine/company/departments.json), for screen readers.
const DEPARTMENTS = {
  operations: "Operations", sales: "Sales", marketing: "Marketing", studio: "Studio",
  support: "Support", people: "People", books: "Books",
};

// A task card's department id (CONTRACTS-V3 33.2: a string), or "" when it has none or one we do not know.
const deptOf = (task) => {
  const d = task && task.department;
  const id = d && typeof d === "object" ? d.id : d;
  return typeof id === "string" && Object.hasOwn(DEPARTMENTS, id) ? id : "";
};

// Pure. The row's fact: the task's outcome when it has one, else its stage and its state in words
// ("Check · Round 2 · Finished"). A task that is working or waiting for the owner says so first, in words, beside
// its glyph. One line: no line breaks, the outcome cut to 140 characters. With `quiet` "waiting" (a row under a
// group already headed "Needs you") "Waiting for you" is left out: the outcome alone, else the next most useful
// fact, else nothing.
export function rowLine(task, quiet) {
  if (!task) return "";
  // An answer's source marks ("[1]") mean nothing on one line, so they are left out (M50 F8).
  const outcome = text(task.outcome).replace(/\s*\[\d{1,2}\]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  const flag = task.live ? "Working" : task.waitingForYou && quiet !== "waiting" ? "Waiting for you" : "";
  if (outcome) return flag ? `${flag} · ${outcome}` : outcome;
  const parts = [];
  if (task.stage && task.stage.label) parts.push(text(task.stage.label));
  if (Number(task.round) > 0) parts.push(`Round ${Number(task.round)}`);
  const state = stateWords(task) || flag;
  if (state && !parts.includes(state) && !(quiet === "waiting" && task.waitingForYou && !task.live && state === "Waiting for you")) parts.push(state);
  return parts.join(" · ");
}

// The row's glyph: needs you (amber), working (green), done (green), failed (red), else the board column's own
// shape in grey; amber is kept for what needs the owner. Its word is for screen readers; the fact says it on screen.
function Glyph({ task }) {
  if (task.waitingForYou) {
    return html`<span class="k-task-row__mark k-task-row__mark--warn"><${StateIcon} column="pending_review" label="" /><span class="k-sr">Waiting for you</span></span>`;
  }
  if (task.live) {
    return html`<span class="k-task-row__mark k-task-row__mark--live"><${StateIcon} column="in_progress" label="" /><span class="k-sr">Working</span></span>`;
  }
  const column = Object.hasOwn(COLUMN_LABELS, task.column) ? task.column : "backlog";
  const tone = column === "failed" ? " k-task-row__mark--bad" : column === "done" ? " k-task-row__mark--good" : "";
  return html`<span class=${`k-task-row__mark${tone}`}><${StateIcon} column=${column} label="" /><span class="k-sr">${stateWords(task) || COLUMN_LABELS[column]}</span></span>`;
}

export function TaskRow({ task, quiet }) {
  if (!task) return null;
  const href = taskHref(task);
  const dept = deptOf(task);
  // The job's name is left out when the title already starts with it (M51 F12).
  const jobTitle = task.job && task.job.title ? text(task.job.title) : "";
  const job = jobTitle && !text(task.title).toLowerCase().startsWith(jobTitle.toLowerCase()) ? jobTitle : "";
  const line = rowLine(task, quiet);
  const date = task.updatedAt || task.since || task.createdAt;
  const who = task.who && task.who.name ? text(task.who.name) : "";
  return html`<a class=${`k-task-row${task.waitingForYou ? " k-task-row--needs" : ""}`} href=${href}>
    <${Glyph} task=${task} />
    <span class="k-task-row__main">
      <span class="k-task-row__top">
        <span class="k-task-row__title">${text(task.title)}</span>
        ${task.identifier && html`<span class="k-task-row__ref"><${Mono}>${text(task.identifier)}<//></span>`}
      </span>
      ${(line || job || dept) && html`<span class="k-task-row__line">
        ${dept && html`<span class="k-task-row__dept k-sr" data-dept=${dept}>${DEPARTMENTS[dept]}.</span>`}
        ${job && html`<span class="k-task-row__job">${job}</span>`}
        ${line && html`<span class="k-task-row__text">${line}</span>`}
      </span>`}
      ${who && html`<span class="k-sr">${who}.</span>`}
    </span>
    ${date && html`<time class="k-task-row__time" datetime=${text(date)} title=${fullWhen(date)}>${when(date)}</time>`}
  </a>`;
}

export function TaskCard({ task }) {
  if (!task) return null;
  const date = task.updatedAt || task.createdAt;
  const total = Number(task.stepsTotal) || 0;
  const steps = total > 0 ? `${Number(task.stepsDone) || 0} of ${total} ${total === 1 ? "step" : "steps"}` : "";
  const who = task.who && task.who.name ? text(task.who.name) : "";
  return html`<a class=${`k-task-card${task.waitingForYou ? " k-task-card--waiting" : ""}`} href=${taskHref(task)}>
    <div class="k-task-card__top">
      <span class=${`k-task-card__state${task.column === "done" ? " k-task-card__state--good" : task.column === "failed" ? " k-task-card__state--bad" : task.live ? " k-task-card__state--live" : ""}`}><${StateIcon} column=${task.column} label="" /></span>
      <span class="k-task-card__title">
        <span class="k-task-card__title-text">${text(task.title)}</span>
      </span>
    </div>
    <span class="k-sr">${stateWords(task)}${who ? `. ${who}` : ""}.</span>
    ${task.stage && html`<div class="k-task-card__stage">
      <span>${text(task.stage.label)}</span>${Number(task.round) > 0 && html`<span> · Round ${Number(task.round)}</span>`}${steps && html`<span> · ${steps}</span>`}
    </div>`}
    <div class="k-task-card__bottom">
      ${task.live && html`<span class="k-task-card__live"><${Live} /></span>`}
      ${task.waitingForYou && html`<span class="k-task-card__needs"><${St} tone="warn">Waiting for you<//></span>`}
      ${task.size && html`<${Chip}>Size ${text(task.size)}<//>`}
      ${task.schedule && html`<${Chip} icon="loop">${text(task.schedule.label)}<//>`}
      <span class="k-task-card__end">
        ${task.identifier && html`<span class="k-task-card__ref"><${Mono}>${text(task.identifier)}<//></span>`}
        ${date && html`<time class="k-task-card__date" datetime=${text(date)} title=${fullWhen(date)}>${when(date)}</time>`}
      </span>
    </div>
  </a>`;
}

// `column` is { id, label, count } (17.2); the cards are the children.
export function BoardColumn({ column, children }) {
  if (!column) return null;
  const label = text(column.label) || COLUMN_LABELS[column.id] || "";
  const count = Number(column.count) || 0;
  const headId = `k-board-col-${text(column.id)}`;
  const empty = !children || (Array.isArray(children) && children.length === 0);
  return html`<section class=${`k-board-col k-board-col--${text(column.id)}`} aria-labelledby=${headId}>
    <header class="k-board-col__head">
      <${StateIcon} column=${column.id} label="" />
      <h2 class="k-board-col__label" id=${headId}>${label}</h2>
      <span class="k-board-col__count" aria-label=${`${count} ${count === 1 ? "task" : "tasks"}`}>${count}</span>
    </header>
    <div class="k-board-col__cards">
      ${empty ? html`<p class="k-board-col__empty"><${Icon} name="inbox" size=${14} /><span>No tasks.</span></p>` : children}
    </div>
  </section>`;
}
