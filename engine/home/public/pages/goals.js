// Goals: each goal with its plain state and how many of its steps are done.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, when } from "../lib/format.js";
import { ErrorNotice, Loading, StateWord } from "../components/notice.js";
import { PageHeader } from "../components/page.js";

export const GOAL_TONES = {
  waiting: "wait",
  working: "active",
  checking: "active",
  needs_you: "warn",
  done: "good",
  stopped: "wait",
};

const SHOWS = [
  { id: "active", label: "In progress", empty: "No goal is in progress." },
  { id: "finished", label: "Finished", empty: "No goal has finished yet." },
  { id: "all", label: "All", empty: "No goals yet." },
];

export function steps(g) {
  if (!g.stepsTotal) return g.state === "waiting" ? "Not split into steps yet" : "No steps yet";
  return `${g.stepsDone} of ${g.stepsTotal} ${g.stepsTotal === 1 ? "step" : "steps"} done`;
}

export function GoalsPage({ route }) {
  const { openGoalBox } = useApp();
  const show = SHOWS.find((s) => s.id === route.query.get("show")) || SHOWS[0];
  const res = useResource(`/api/goals?show=${show.id}`, { every: 10000 });
  const goals = res.data?.goals || [];

  return html`
    <${PageHeader} title="Goals" lead="What you have asked for, and where each one stands." />
    <nav class="filter" aria-label="Which goals">
      ${SHOWS.map((s) => html`
        <a key=${s.id} class="filter-link" href=${s.id === "active" ? "#/goals" : `#/goals?show=${s.id}`}
          aria-current=${s.id === show.id ? "page" : null}>${s.label}</a>`)}
    </nav>
    ${res.loading && !res.data ? html`<div class="card"><${Loading} lines=${4} label="Loading the goals" /></div>` : null}
    <${ErrorNotice} error=${res.error} onRetry=${res.reload} />
    ${res.data && !goals.length ? html`
      <div class="empty">
        <p class="empty-title">${show.empty}</p>
        <p class="muted">Tell the Chief of staff what you want done. <button type="button" class="link-button" onClick=${openGoalBox}>Give a goal</button></p>
      </div>` : null}
    ${goals.length ? html`
      <ul class="rows">
        ${goals.map((g) => html`
          <li key=${g.id} class="row">
            <div class="row-main">
              <a class="row-title" href=${`#/goals/${encodeURIComponent(g.id)}`}>${g.title}</a>
              <p class="row-sub">${steps(g)}${g.updatedAt ? html` · <span title=${fullWhen(g.updatedAt)}>last change ${when(g.updatedAt)}</span>` : null}</p>
            </div>
            <div class="row-side"><${StateWord} tone=${GOAL_TONES[g.state]}>${g.plainState}<//></div>
          </li>`)}
      </ul>` : null}`;
}
