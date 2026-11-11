// A department, in one column (CONTRACTS-V3 30, "A department"; data: GET /api/map/:department, 33.2).
// Card one: who the department is, its state, and the jobs it can run. Card two: its agents. Card three: the
// owner's tasks with it. At the bottom a composer that gives the department a task through POST /api/goals.
// Not connected: this page's answer does not say when the board cannot be read, so that comes from GET /api/map's
// `boardOff` and from the shell (boardOffOf below); the page then says so on top and stops guessing.
// Everything here came from the server: titles and outcomes are rendered as text only, capped.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  AgentCard, AgentChip, AgentState, Card, Chip, Composer, Creature, Empty, ErrorNotice, Field, Icon, JobChip,
  Loading, NotConnected, PageHeader, Select, STARTED, TaskRow, UNDER_START, jobHref,
} from "../kit/index.js";

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const RECENT = 10;
// What the notice says when only the shell tells that the board is off (the map's answer carries its own words).
const OFF_REASON = "The board is not answering, so agents and tasks cannot be reached.";
const OFF_NEXT = "Run: engine start";

const text = (v) => (v === null || v === undefined ? "" : String(v));
const cap = (v, n = 200) => {
  const s = text(v).replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const arr = (v) => (Array.isArray(v) ? v : []);

// The department id of the address `#/departments/<id>`, or "" when it is not one.
export function deptIdOf(route) {
  const parts = (route && route.parts) || [];
  const id = text(parts[0] === "departments" ? parts[1] : "");
  return SLUG.test(id) ? id : "";
}

// Whether the board can be read right now: null when it can, else { reason, next } for the notice. The answer of
// GET /api/map/:department does not say (33.2), so this comes from the two places the contract pins:
//   `boardOff` of GET /api/map, made by the same reader as this page's figures, with the reason and the next step;
//   until the map has answered, the shell's `engine.board` (17.9), with our own words.
export function boardOffOf(map, shell) {
  if (map && typeof map === "object" && "boardOff" in map) {
    const off = map.boardOff;
    if (!off) return null;
    const o = typeof off === "object" ? off : {};
    return { reason: cap(o.reason, 200) || OFF_REASON, next: cap(o.next, 200) || OFF_NEXT };
  }
  const board = shell && shell.engine ? shell.engine.board : undefined;
  return typeof board === "string" && board !== "on" ? { reason: OFF_REASON, next: OFF_NEXT } : null;
}

export const offTitle = (name) => `${text(name) || "This department"} cannot show its tasks right now`;

// The state chip (33.2 `state`): its words and the tone of its dot. The server's sentence is used when it is the
// one this state should say; anything else falls back to the plain word, so an odd answer never shows odd words.
//   waiting → "Waiting for you" (warm); working → "Working on: <title>" (live); idle → "Idle · last active …" (quiet)
// With the board off (`off`) nobody knows what the department is doing, and "Idle" would be a guess: "Not known".
export function stateChip(state, off = null) {
  if (off) return { label: "Not known", tone: "off", taskId: null };
  const id = state && state.id;
  const plain = cap(state && state.plain, 120);
  const taskId = state && typeof state.taskId === "string" && state.taskId ? state.taskId : null;
  if (id === "waiting") return { label: "Waiting for you", tone: "warn", taskId };
  if (id === "working") return { label: /^Working on: ./.test(plain) ? plain : "Working", tone: "live", taskId };
  return { label: /^Idle( · .+)?$/.test(plain) ? plain : "Idle", tone: "off", taskId: null };
}

// Every job of the department as one list for the "Can run" chips: ready ones first, then the ones that cannot
// start yet; inside each, in the order of the department's file (cluster by cluster).
export function jobsInOrder(clusters) {
  const all = arr(clusters).flatMap((c) => arr(c && c.jobs)).filter((j) => j && typeof j.id === "string");
  return [...all.filter((j) => j.ready !== false), ...all.filter((j) => j.ready === false)];
}

// A job's reason for not starting, as one sentence (31.4), or "".
export function whyText(job) {
  const w = job && job.why;
  return cap(typeof w === "string" ? w : w && w.text, 200);
}

// Who the composer gives the task to: the agent picked in the list when it is one of this department's, else the
// department's first agent. Null when the department has no agent (the Chief of staff then decides).
export function goalTo(agents, picked) {
  const slugs = arr(agents).map((a) => a && a.slug).filter((s) => typeof s === "string" && s);
  if (picked && slugs.includes(picked)) return picked;
  return slugs[0] || null;
}

// The body of POST /api/goals from this page.
export function goalBody({ text: t, planFirst } = {}, agents, picked) {
  const body = { text: text(t) };
  const to = goalTo(agents, picked);
  if (to) body.to = to;
  if (planFirst) body.planFirst = true;
  return body;
}

export const composerPlaceholder = (name) => `Give ${text(name) || "this department"} a task`;

// "YOUR TASKS WITH SALES · 14": the words before the count, and the count (all of them, not only the ten shown).
export function tasksHeading(name, recent, total) {
  const n = Number.isFinite(Number(total)) && Number(total) > 0 ? Number(total) : arr(recent).length;
  return { label: `Your tasks with ${text(name) || "this department"}`, count: n };
}

// The sentence of the tasks card when it has no rows. With the board off it does not say there are none.
export function noTasksLine(name, off = null) {
  return off ? "Tasks cannot be shown right now." : `No tasks yet. What you give ${text(name) || "it"} below shows here.`;
}

// The line under the composer: how long a task takes, or that none can start while the board is not connected.
export const captionUnder = (off = null) => (off ? "A task cannot start until the board is connected." : UNDER_START);

// Waiting opens the Needs you drawer for this department; working opens the task; idle is only words.
function StateChip({ state, department, off }) {
  const { openNeeds } = useApp();
  const s = stateChip(state, off);
  const chip = html`<${Chip} dot=${s.tone}>${s.label}<//>`;
  if (!off && state && state.id === "waiting") {
    return html`<button type="button" class="p-dept__state p-dept__state--link" onClick=${() => openNeeds({ department })}
      aria-label=${`${s.label}. Open what needs you here`}>${chip}</button>`;
  }
  return s.taskId
    ? html`<a class="p-dept__state p-dept__state--link" href=${`#/tasks/${encodeURIComponent(s.taskId)}`}>${chip}</a>`
    : html`<span class="p-dept__state">${chip}</span>`;
}

function CanRun({ jobs }) {
  if (!jobs.length) return html`<p class="p-dept__muted">No jobs yet. Give it a task below in your own words.</p>`;
  return html`<ul class="p-dept__jobs">
    ${jobs.map((j) => {
      const why = j.ready === false ? whyText(j) : "";
      return html`<li key=${j.id} class=${`p-dept__job${why ? " p-dept__job--dim" : ""}`}>
        <${JobChip} job=${j} />
        ${why && html`<span class="p-dept__why" role="note">${why}</span>`}
      </li>`;
    })}
  </ul>`;
}

function Head({ data, off }) {
  const dep = data.department || {};
  const id = text(dep.id);
  const name = text(dep.title) || "Department";
  const jobs = jobsInOrder(data.clusters);
  const nb = data.neighbours || {};
  return html`<${Card} class="p-dept__card p-dept__head" data-dept=${id}>
    <div class="p-dept__who">
      <span class="p-dept__creature"><${Creature} id=${id} size=${64} /></span>
      <${PageHeader} over="Department" title=${name} lead=${cap(dep.line, 120)} />
    </div>
    <${StateChip} state=${dep.state} department=${id} off=${off} />
    <div class="p-dept__can">
      <p class="p-dept__over">Can run${jobs.length ? html` <span class="p-dept__count">· ${jobs.length}</span>` : null}</p>
      <${CanRun} jobs=${jobs} />
    </div>
    <div class="p-dept__links">
      <a class="p-dept__link" href=${`#/map/${encodeURIComponent(id)}`}><${Icon} name="map" size=${14} />See on the map</a>
      ${SLUG.test(text(dep.dashboard)) && html`<a class="p-dept__link" href=${`#/dashboards/${encodeURIComponent(dep.dashboard)}`}>
        <${Icon} name="dashboards" size=${14} />Open its dashboard</a>`}
      <a class="p-dept__link" href=${`#/jobs?d=${encodeURIComponent(id)}`}><${Icon} name="jobs" size=${14} />See its jobs</a>
    </div>
    ${(nb.prev || nb.next) && html`<nav class="p-dept__around" aria-label="Other departments">
      ${nb.prev && SLUG.test(text(nb.prev.id)) && html`<a class="p-dept__nb" href=${`#/departments/${nb.prev.id}`} data-dept=${nb.prev.id}>
        <${Icon} name="arrow-left" size=${14} /><span>${cap(nb.prev.title, 40)}</span></a>`}
      ${nb.next && SLUG.test(text(nb.next.id)) && html`<a class="p-dept__nb p-dept__nb--next" href=${`#/departments/${nb.next.id}`} data-dept=${nb.next.id}>
        <span>${cap(nb.next.title, 40)}</span><${Icon} name="arrow-right" size=${14} /></a>`}
    </nav>`}
  <//>`;
}

function Agents({ agents }) {
  const list = arr(agents).filter((a) => a && a.slug);
  if (!list.length) return null;
  if (list.length === 1) {
    const a = list[0];
    return html`<p class="p-dept__one">
      <span class="p-dept__one-label">Its agent</span>
      <${AgentChip} agent=${a} />
      <${AgentState} agent=${a} />
    </p>`;
  }
  return html`<${Card} class="p-dept__card">
    <p class="p-dept__over">Its agents <span class="p-dept__count">· ${list.length}</span></p>
    <ul class="p-dept__agents">${list.map((a) => html`<li key=${a.slug}><${AgentCard} agent=${a} /></li>`)}</ul>
  <//>`;
}

function Tasks({ data, off }) {
  const name = text(data.department && data.department.title);
  const id = text(data.department && data.department.id);
  const recent = arr(data.recent).filter((t) => t && t.id).slice(0, RECENT);
  const h = tasksHeading(name, recent, data.recentTotal);
  return html`<${Card} class="p-dept__card">
    <div class="p-dept__tasks-head">
      <p class="p-dept__over">${h.label}${off && !recent.length ? null : html` <span class="p-dept__count">· ${h.count}</span>`}</p>
      ${recent.length > 0 && html`<a class="p-dept__all" href=${`#/tasks?d=${encodeURIComponent(id)}`}>See all</a>`}
    </div>
    ${recent.length
      ? html`<ul class="p-dept__rows">${recent.map((t) => html`<li key=${t.id}><${TaskRow} task=${t} /></li>`)}</ul>`
      : html`<p class="p-dept__muted">${noTasksLine(name, off)}</p>`}
  <//>`;
}

function Give({ data, off, onSent }) {
  const { refreshShell, announce } = useApp();
  const name = text(data.department && data.department.title);
  const agents = arr(data.agents).filter((a) => a && a.slug);
  const [picked, setPicked] = useState(null);
  const [started, setStarted] = useState(null);
  const jobs = jobsInOrder(data.clusters);
  const who = goalTo(agents, picked);

  async function send(input) {
    setStarted(null);
    const out = await api.post("/api/goals", goalBody(input, agents, picked));
    setStarted(out && out.goal ? out.goal : {});
    announce(STARTED);
    refreshShell();
    onSent();
  }
  const pickJob = (job) => {
    const href = jobHref(job);
    if (href && typeof location !== "undefined") location.hash = href;
  };

  return html`<div class="p-dept__give">
    ${started && html`<p class="p-dept__started" role="status"><${Icon} name="check" size=${16} />
      <span>${STARTED}${started.id
        ? html` <a href=${`#/tasks/${encodeURIComponent(started.id)}`}>Open the task${started.identifier ? ` ${cap(started.identifier, 20)}` : ""}</a>`
        : null}</span></p>`}
    ${agents.length > 1 && html`<div class="p-dept__for">
      <${Field} label="Give it to">
        <${Select} value=${who || ""} onChange=${(e) => setPicked(String(e.currentTarget.value))}
          options=${agents.map((a) => ({ value: a.slug, label: text(a.name) || a.slug }))} />
      <//>
    </div>`}
    <${Composer}
      placeholder=${composerPlaceholder(name)}
      agents=${[]}
      templates=${jobs}
      onPickJob=${pickJob}
      onSend=${send} />
    <p class="p-dept__caption">${captionUnder(off)}</p>
  </div>`;
}

export default function Page({ route }) {
  const { shell } = useApp();
  const id = deptIdOf(route);
  const res = useResource(id ? `/api/map/${id}` : null, { every: 10000 });
  // Read only for `boardOff`: whether this page's figures are real, or zeros because the board cannot be read.
  const map = useResource(id ? "/api/map" : null, { every: 10000 });
  const d = res.data;

  if (!d || !d.department) {
    let body;
    if (!id || (res.error && res.error.status === 404)) {
      body = html`<${Empty} title="That department is not here" text="The company has seven departments. Pick one on the map.">
        <a href="#/map">Open the map</a>
      <//>`;
    } else if (res.error) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
    else body = html`<${Loading} lines=${6} label="Loading the department" />`;
    return html`<div class="p-dept">
      <${PageHeader} title=${!id || (res.error && res.error.status === 404) ? "Not found" : "Department"} back=${{ href: "#/map", label: "Map" }} />
      ${body}
    </div>`;
  }

  const off = boardOffOf(map.data, shell);
  return html`<div class="p-dept" data-dept=${text(d.department.id)}>
    ${off && html`<${NotConnected} title=${offTitle(d.department.title)} reason=${off.reason} next=${off.next} />`}
    <${Head} data=${d} off=${off} />
    <${Agents} agents=${d.agents} />
    <${Tasks} data=${d} off=${off} />
    <${Give} data=${d} off=${off} onSent=${() => res.refresh()} />
  </div>`;
}
