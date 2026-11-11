// Tasks as one quiet line (TaskRow), as a board card (TaskCard), and a board column (BoardColumn). CONTRACTS-V2 13.2.
// `task` is a task-card (17.1); TaskRow also takes a Home "running" entry ({ taskId, identifier, title, who, live, plainState }).
import { html } from "../vendor/preact-htm.js";
import { when, fullWhen } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { StateIcon } from "./icon.js";
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

export function TaskRow({ task }) {
  if (!task) return null;
  const who = task.who || null;
  const href = taskHref(task);
  const mark = task.live
    ? html`<${Live} />`
    : task.waitingForYou
      ? html`<${Waiting} />`
      : html`<${StatusDot} tone=${COLUMN_TONES[task.column] || "wait"} label=${stateWords(task)} hideLabel />`;
  return html`<a class="k-task-row" href=${href}>
    <span class="k-task-row__mark">${mark}</span>
    ${task.identifier && html`<${Mono}>${text(task.identifier)}<//>`}
    <span class="k-task-row__title">${text(task.title)}</span>
    ${who && html`<span class="k-task-row__who" title=${text(who.name)}>
      <span class="u-visually-hidden">${text(who.name)}</span><${Avatar} slug=${who.slug} name=${who.name} size=${20} />
    </span>`}
  </a>`;
}

export function TaskCard({ task }) {
  if (!task) return null;
  const who = task.who || null;
  const date = task.updatedAt || task.createdAt;
  const steps = Number(task.stepsTotal) > 0 ? `${Number(task.stepsDone) || 0} of ${Number(task.stepsTotal)} steps` : "";
  return html`<a class=${`k-task-card${task.waitingForYou ? " k-task-card--waiting" : ""}`} href=${taskHref(task)}>
    <div class="k-task-card__top">
      <${Mono}>${text(task.identifier)}<//>
      ${task.live && html`<${Live} />`}
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
      ${task.size && html`<${Chip}><span class="u-visually-hidden">Size </span>${text(task.size)}<//>`}
      ${task.schedule && html`<${Chip} icon="loop">${text(task.schedule.label)}<//>`}
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
