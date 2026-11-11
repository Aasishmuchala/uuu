// Tasks as one quiet line (TaskRow), as a board card (TaskCard), and a board column (BoardColumn). CONTRACTS-V2 13.2.
// `task` is a task-card (17.1); TaskRow also takes a Home "running" entry ({ taskId, identifier, title, who, live, plainState }).
// CONTRACTS-V3 28: TaskRow has a second line (the outcome, else the stage and state in words), the department's dot,
// the time at the right and a chevron. It reads the same with or without `outcome`, `job` and `department` (33.2).
import { html } from "../vendor/preact-htm.js";
import { when, fullWhen } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Icon, StateIcon } from "./icon.js";
import { Live, StatusDot, Waiting } from "./status.js";
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

const COLUMN_TONES = {
  backlog: "wait",
  in_progress: "ok",
  pending_review: "warn",
  done: "ok",
  failed: "bad",
  canceled: "off",
};

export const taskHref = (task) => {
  const id = task && (task.id || task.taskId || task.identifier);
  return id ? `#/tasks/${encodeURIComponent(id)}` : null;
};

// The words for a task's state: its plain state, else its column's label.
const stateWords = (task) => text(task.plainState) || COLUMN_LABELS[task.column] || "";

// The seven departments' names (engine/company/departments.json), for screen readers beside the coloured dot.
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

// Pure. The row's second line: the task's outcome when it has one, else its stage and its state in words
// ("Check · Round 2 · Finished"). A task that is working or waiting for the owner says so first, in words, since
// the row's mark shows only a dot. One line: no line breaks, the outcome cut to 140 characters.
export function rowLine(task) {
  if (!task) return "";
  const outcome = text(task.outcome).replace(/\s+/g, " ").trim().slice(0, 140);
  const flag = task.live ? "Working" : task.waitingForYou ? "Waiting for you" : "";
  if (outcome) return flag ? `${flag} · ${outcome}` : outcome;
  const parts = [];
  if (task.stage && task.stage.label) parts.push(text(task.stage.label));
  if (Number(task.round) > 0) parts.push(`Round ${Number(task.round)}`);
  const state = stateWords(task) || flag;
  if (state && !parts.includes(state)) parts.push(state);
  return parts.join(" · ");
}

export function TaskRow({ task }) {
  if (!task) return null;
  const who = task.who || null;
  const href = taskHref(task);
  const dept = deptOf(task);
  const job = task.job && task.job.title ? text(task.job.title) : "";
  const line = rowLine(task);
  const date = task.updatedAt || task.since || task.createdAt;
  // The mark's word is for screen readers here: the second line says the state in words, so the titles line up.
  const mark = task.live
    ? html`<${Live} hideLabel />`
    : task.waitingForYou
      ? html`<${Waiting} hideLabel />`
      : html`<${StatusDot} tone=${COLUMN_TONES[task.column] || "wait"} label=${stateWords(task)} hideLabel />`;
  return html`<a class=${`k-task-row${line || job ? " k-task-row--two" : ""}`} href=${href}>
    <span class="k-task-row__mark">${mark}</span>
    <span class="k-task-row__main">
      <span class="k-task-row__top">
        ${task.identifier && html`<${Mono}>${text(task.identifier)}<//>`}
        <span class="k-task-row__title">${text(task.title)}</span>
      </span>
      ${(line || job || dept) && html`<span class="k-task-row__line">
        ${dept && html`<span class="k-task-row__dept" data-dept=${dept} aria-hidden="true"></span><span class="u-visually-hidden">${DEPARTMENTS[dept]}.</span>`}
        ${job && html`<span class="k-task-row__job">${job}</span>`}
        ${line && html`<span class="k-task-row__text">${line}</span>`}
      </span>`}
    </span>
    ${who && html`<span class="k-task-row__who" title=${text(who.name)}>
      <span class="u-visually-hidden">${text(who.name)}</span><${Avatar} slug=${who.slug} name=${who.name} size=${20} />
    </span>`}
    ${date && html`<time class="k-task-row__time" datetime=${text(date)} title=${fullWhen(date)}>${when(date)}</time>`}
    ${href && html`<span class="k-task-row__chevron" aria-hidden="true"><${Icon} name="chevron-right" /></span>`}
  </a>`;
}

export function TaskCard({ task }) {
  if (!task) return null;
  const who = task.who || null;
  const date = task.updatedAt || task.createdAt;
  const total = Number(task.stepsTotal) || 0;
  const steps = total > 0 ? `${Number(task.stepsDone) || 0} of ${total} ${total === 1 ? "step" : "steps"}` : "";
  return html`<a class=${`k-task-card${task.waitingForYou ? " k-task-card--waiting" : ""}`} href=${taskHref(task)}>
    <div class="k-task-card__top">
      <${Mono}>${text(task.identifier)}<//>
      ${who && html`<span class="k-task-card__who" title=${text(who.name)}>
        <span class="u-visually-hidden">${text(who.name)}</span><${Avatar} slug=${who.slug} name=${who.name} size=${20} />
      </span>`}
    </div>
    <div class="k-task-card__title">
      <span class="k-task-card__state"><${StateIcon} column=${task.column} /></span>
      <span class="k-task-card__title-text">${text(task.title)}</span>
    </div>
    <span class="u-visually-hidden">${stateWords(task)}</span>
    ${task.stage && html`<div class="k-task-card__stage">
      <span>${text(task.stage.label)}</span>${Number(task.round) > 0 && html`<span> · Round ${Number(task.round)}</span>`}${steps && html`<span> · ${steps}</span>`}
    </div>`}
    <div class="k-task-card__bottom">
      ${task.size && html`<${Chip}>Size ${text(task.size)}<//>`}
      ${task.schedule && html`<${Chip} icon="loop">${text(task.schedule.label)}<//>`}
      ${task.live && html`<span class="k-task-card__live"><${Live} /></span>`}
      ${task.waitingForYou && html`<${Waiting} />`}
      ${date && html`<time class="k-task-card__date" datetime=${text(date)} title=${fullWhen(date)}>${when(date)}</time>`}
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
      <${StateIcon} column=${column.id} />
      <h2 class="k-board-col__label" id=${headId}>${label}</h2>
      <span class="k-board-col__count" aria-label=${`${count} ${count === 1 ? "task" : "tasks"}`}>${count}</span>
    </header>
    <div class="k-board-col__cards">
      ${empty ? html`<p class="k-board-col__empty">No tasks.</p>` : children}
    </div>
  </section>`;
}
