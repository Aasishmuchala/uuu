// The map: the home page as the lit studio (CONTRACTS-V3 29; PLAN-3D T9, D8, D12 to D16). The company is a building
// at dusk that fills the page column (world/stage.js: the 3D world where it may load, else the drawn studio); over it,
// at the left, a 340 px rail: the company's name, its counts, the brain's line, "Open the queue", then the mirrored
// list (a section per room in the server's order with a row per agent, the three doors, App Studio) and today's three
// blocks; the box that asks the company brain at the foot of the free area; at #/map/<department> a 392 px panel at
// the right about that room ("Who is here" with Switch off and on, its needs with Answer, its tasks with Open the task
// and Stop this task, and "Open the department"); a door chosen from the list or the studio opens the door's panel
// (map/door-panel.js), the only way to open or shut a door here. The list twin at ?view=list loads nothing of the
// world. Below 860 px the studio is a picture above today's rows, and the money line is the page's own first line.
// Data: GET /api/map and GET /api/world every 10 seconds, GET /api/home every 15 seconds; the box sends POST /api/ask
// and then reads GET /api/ask/:id every 5 seconds while that question is still being read; Got it acts through
// POST /api/inbox/act with the item's version. No timer or frame loop runs while the page is at rest.
// Server text (names, titles, sentences) is shown only as text nodes or escaped attributes; the world gets only the
// SceneState of worldState() (ids, enums and numbers).
import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { aheadLine, linkHref, waitingLine } from "../lib/format.js";
import { needsFor, queueHref, rowTime, sortNeeds } from "../lib/queue.js";
import {
  AgentChip,
  AgentState,
  AnswerView,
  ASK_HINT,
  Avatar,
  Blk,
  Button,
  changedText,
  Composer,
  Empty,
  ErrorNotice,
  Icon,
  Loading,
  NextStep,
  Notice,
  PageHeader,
  Segmented,
  StatusDot,
  Tag,
  useInboxAct,
} from "../kit/index.js";
import { nearestHub } from "../map/layout.js";
import { brainLine, departmentsOf, iconOf, jobsLine, nodeLine, nodeTone, stuckOf } from "../map/map-view.js";
import { DepartmentRows, DepartmentSection, MapList } from "../map/map-list.js";
import { DoorPanel } from "../map/door-panel.js";
import { WorldStage } from "../world/stage.js";
import { worldState } from "../world/state.js";
import { diffWorld } from "../world/diff.js";
import { WORDS as W } from "../world/words.js";

const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const ASK_ID = /^[A-Za-z0-9-]{1,64}$/;
const NARROW = "(max-width: 859px)";
const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const clip = (v, n) => str(v).slice(0, n);

// The page's own words (PLAN-COOK T63). Pinned by test/pages/map.test.mjs.
export const MAP_WORDS = Object.freeze({
  company: "The whole company",
  department: "Department",
  stage: "Company map",
  needsYou: "Needs you",
  working: "Working now",
  results: "Newest results",
  agents: "Agents",
  doing: "Being worked on",
  openQueue: "Open the queue",
  openDept: "Open the department",
  seeJobs: "See its jobs",
  question: "Your question",
  showAs: "Show the map as",
  noNeeds: "Nothing needs you right now.",
  noNeedsHere: "Nothing here needs you right now.",
  noWorking: "Nobody is working on anything right now.",
  noResults: "No new results.",
  noAgents: "No agents yet.",
});

// The studio's own labels (PLAN-3D T9), beside the shared ones of world/words.js. Pinned by
// test/pages/map-world.test.mjs. "Stop this task?" and its yes are the task page's own words (pages/task.js).
export const STUDIO_WORDS = Object.freeze({
  rooms: "Rooms and who is in them",
  overflow: "Only in this list: the studio has room for eleven.",
  nobody: "Nobody works here yet.",
  doorOpen: "Open",
  doorShut: "Shut",
  appOpen: "Open",
  tasks: "Tasks",
  answer: "Answer",
  openTask: "Open the task",
  close: "Close",
  switchOffAsk: "Switch it off? It stops what it is working on now.",
  switchOffYes: "Yes, switch it off",
  switchedOff: "It is switched off.",
  switchedOn: "It is switched on.",
  stopAsk: "Stop this task? Agents stop working on it.",
  stopYes: "Yes, stop it",
  stopped: "The task is stopped. Agents will not work on it any more.",
  skip: "Skip the map, show it as a list",
});

// A next step for the owner in words: a command ("Run: ...") stays off screen outside Health (C3 25, M50 F18);
// Health is linked instead.
export const plainNext = (next) => (/\bRun:/i.test(String(next ?? "")) ? "" : String(next ?? "").slice(0, 200));

// ---- The address (pure, tested) ----

// { dept, view, ask } from the route: #/map/<department>?view=list&ask=<task id>. Anything odd is dropped.
export function readAddress(route) {
  const parts = arr(route && route.parts);
  const q = route && route.query && typeof route.query.get === "function" ? route.query : new URLSearchParams("");
  const dept = parts[0] === "map" && parts.length === 2 && SLUG.test(str(parts[1])) ? parts[1] : null;
  const bad = parts[0] === "map" && parts.length === 2 && !dept;
  const view = q.get("view") === "list" ? "list" : "map";
  const ask = ASK_ID.test(str(q.get("ask"))) ? q.get("ask") : null;
  return { dept, view, ask, bad };
}

// The address for a state of the map.
export function mapHref({ dept = null, view = "map", ask = null } = {}) {
  const q = new URLSearchParams();
  if (view === "list") q.set("view", "list");
  if (ask && ASK_ID.test(str(ask))) q.set("ask", ask);
  const s = q.toString();
  return `${dept && SLUG.test(dept) ? `#/map/${dept}` : "#/map"}${s ? `?${s}` : ""}`;
}

// Asking the company brain comes with a later update of the home server; until then its routes answer 404.
export const ASK_NOT_READY = {
  message: "The company brain cannot take questions on this home screen yet.",
  next: "This comes with the next update. Until then, use New task to say what you want done.",
};
export const ASK_NOT_FOUND = {
  message: "That question was not found.",
  next: "Close this and ask again in the box.",
};

// What to show when the ask routes refuse: the two designed cases, else the server's own words.
export function askProblem(error) {
  if (!error) return null;
  if (error.status === 404 && error.code === "ask_not_found") return { kind: "missing", ...ASK_NOT_FOUND };
  if (error.status === 404) return { kind: "not-ready", ...ASK_NOT_READY };
  return { kind: "error", message: str(error.message) || "Something went wrong.", next: str(error.next) };
}

// How often an open question is read again: every 5 seconds while its answer is being written, then never.
export const askEvery = (ask) => (!ask || ask.state === "reading" ? 5000 : 0);

// The hint under the box (C3 25, M63): the time an answer takes, unless other work is ahead in the Chief of staff's
// line (`brain.queue`, worked out by the server); then no time is promised.
export function askHint(brain) {
  const ahead = aheadLine(brain && brain.queue);
  return ahead ? `Enter to send. ${ahead}` : ASK_HINT;
}

// The chip of the open question: "Reading your files", or "Waiting its turn" while other work is ahead of it.
export function askingChip(asking) {
  return waitingLine(asking && asking.queue) ? "Waiting its turn" : "Reading your files";
}

// What the map says when /api/map fails: the map is read from files, so the board is not named (C3 29.7).
export const MAP_ERROR = "The map could not be read. Try again; if it stays, Health shows what is wrong.";

// The page's heading for a screen reader, and the window's title.
export const titleFor = (dept, data) => {
  if (!dept) return "Map";
  const d = departmentsOf(data).find((x) => x.id === dept);
  return d ? `${str(d.title).slice(0, 40)} on the map` : "Map";
};

// ---- What the rail shows (pure, tested) ----

// The line over the stage: "7 departments, 72 jobs".
export function stageLine(data) {
  const depts = arr(data && data.departments);
  if (!depts.length) return "";
  const jobs = depts.reduce((n, d) => n + num(d && d.counts && d.counts.jobs), 0);
  return `${depts.length === 1 ? "1 department" : `${depts.length} departments`}, ${jobs === 1 ? "1 job" : `${jobs} jobs`}`;
}

// The whole company's counts in the words a card uses: { working, needsYou } from /api/map's counts.
export const companyCounts = (data) => ({ working: num(data && data.counts && data.counts.running), needsYou: num(data && data.counts && data.counts.needsYou) });

// What needs the owner, most urgent and newest first: for the whole company or one department. The results to
// accept are listed apart (resultsOf), so `asks` leaves them out.
export function needsOf(home, dept = null, departments = []) {
  const items = sortNeeds(arr(home && home.needsYou && home.needsYou.items));
  return dept ? needsFor(items, dept, departments) : items;
}
export const asksOf = (items) => arr(items).filter((i) => i.kind !== "result");
export const resultsOf = (items) => arr(items).filter((i) => i.kind === "result");

// The work being done now: every running task, or those of one department's agents.
export function workingOf(home, dept = null) {
  const all = arr(home && home.running).filter((r) => r && typeof r === "object" && r.who && r.title);
  if (!dept) return all;
  const slugs = new Set(arr(dept.agents).map((a) => a && a.slug).filter(Boolean));
  return all.filter((r) => slugs.has(r.who.slug));
}

// A department's agents, each with its state for the kit's AgentState: working while one of its tasks runs, waiting
// for the owner while something of its own needs them, else free.
export function agentsOf(dept, home) {
  const running = arr(home && home.running);
  const items = arr(home && home.needsYou && home.needsYou.items);
  return arr(dept && dept.agents).filter((a) => a && SLUG.test(str(a.slug))).slice(0, 12).map((a) => {
    const working = running.some((r) => r && r.who && r.who.slug === a.slug);
    const waiting = items.some((i) => i && i.agent && i.agent.slug === a.slug);
    return { slug: a.slug, name: clip(a.name, 40) || a.slug, state: working ? "working" : waiting ? "waiting_for_you" : "", plainState: "Free" };
  });
}

// The link that opens the queue for one department: "Open it in the queue", "Open all 7 in the queue".
export const queueWords = (n) => (num(n) === 1 ? "Open it in the queue" : `Open all ${num(n)} in the queue`);

// ---- Small hooks ----

function useNarrow() {
  const mq = () => (typeof matchMedia === "function" ? matchMedia(NARROW) : null);
  const [narrow, setNarrow] = useState(() => !!mq()?.matches);
  useEffect(() => {
    const m = mq();
    if (!m || !m.addEventListener) return undefined;
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

const isTyping = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

// The department last chosen, so Esc gives focus back to its card.
let cameFrom = null;

// ---- The answer, at the top of the rail ----

function AnswerPanel({ id, onClose }) {
  const app = useApp();
  const [every, setEvery] = useState(5000);
  const res = useResource(`/api/ask/${encodeURIComponent(id)}`, { every });
  const ask = res.data && res.data.ask && typeof res.data.ask === "object" ? res.data.ask : res.data;
  const { act, busy, error, changed } = useInboxAct();
  useEffect(() => { setEvery(res.data ? askEvery(ask) : res.error ? 0 : 5000); }, [res.data, res.error]);

  const problem = askProblem(res.error);
  const waiting = ask && ask.needsYou && typeof ask.needsYou === "object" ? ask.needsYou : null;

  const gotIt = async () => {
    if (!waiting) return;
    const done = await act(waiting.inboxId, waiting.action || "acknowledge", undefined, waiting.version);
    if (done) {
      app.announce("Marked as read.");
      app.refreshShell();
      res.refresh();
    } else res.refresh();
  };

  let body;
  if (res.loading && !res.data) body = html`<${Loading} lines=${2} label="Loading the answer" />`;
  else if (problem && problem.kind !== "error") {
    body = html`<${Notice} tone=${problem.kind === "missing" ? "warn" : "info"} title=${problem.message}><${NextStep} text=${problem.next} /><//>`;
  } else if (problem) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  else if (ask && typeof ask === "object") body = html`<${AnswerView} ask=${ask} />`;
  else body = html`<${ErrorNotice} error="The answer could not be read." onRetry=${res.reload} />`;

  const err = error ? (changed ? changedText(error) : { message: str(error.message), next: str(error.next) }) : null;
  return html`<section class="p-map__answer" aria-label="Your question to the company brain">
    <div class="p-map__answer-head">
      <h2 class="p-map__answer-title">${MAP_WORDS.question}</h2>
      <button type="button" class="p-map__icon-btn" aria-label="Close the answer" onClick=${onClose}><${Icon} name="cross" size=${16} /></button>
    </div>
    <div class="p-map__answer-body">${body}</div>
    ${waiting ? html`<div class="p-map__answer-foot">
      ${err ? html`<p class="p-map__answer-error" role="alert">${err.message} ${err.next}</p>` : null}
      <${Button} variant="primary" size="sm" icon="check" busy=${busy} onClick=${gotIt}>${str(waiting.label).slice(0, 30) || "Got it"}<//>
    </div>` : null}
  </section>`;
}

// ---- The rail's pieces ----

// One thing that needs the owner, or one result: its department's icon, its title, and where it is from and when.
function ItemRow({ item, depts }) {
  const d = depts.find((x) => x.id === item.department);
  const from = [clip(d && d.title, 40), rowTime(item.when)].filter(Boolean).join(" · ");
  return html`<li class="p-map__item">
    <a class="p-map__item-link" href=${queueHref(item)}>
      <span class="p-map__item-icon" aria-hidden="true"><${Icon} name=${iconOf(d ? d.id : "")} size=${16} /></span>
      <span class="p-map__item-text">
        <span class="p-map__item-title">${clip(item.title, 120)}</span>
        ${from ? html`<span class="p-map__item-sub">${from}</span>` : null}
      </span>
    </a>
  </li>`;
}

// One task being worked on: the agent's avatar, the task as the row's link, and the agent's name under it.
function WorkRow({ run }) {
  const href = linkHref({ page: "tasks", id: run.identifier || run.taskId });
  const who = run.who || {};
  const inner = html`<span class="p-map__item-icon p-map__item-icon--who" aria-hidden="true"><${Avatar} slug=${who.slug} name=${who.name} size=${24} /></span>
    <span class="p-map__item-text">
      <span class="p-map__item-title">${clip(run.title, 120)}</span>
      <span class="p-map__item-sub">${clip(who.name, 40)}</span>
    </span>`;
  return html`<li class="p-map__item p-map__item--work">
    ${href ? html`<a class="p-map__item-link" href=${href}>${inner}</a>` : html`<span class="p-map__item-link">${inner}</span>`}
  </li>`;
}

// A group's count in the rail's heads: a chip, warm for what waits on the owner.
const countChip = (n, tone = "neutral") => (n ? html`<${Tag} tone=${tone}>${String(n)}<//>` : null);

const none = (words) => html`<p class="p-map__none">${words}</p>`;

// An error in the server's words, as sent.
const errorWords = (e) => ({ message: str(e && e.message) || "That did not work.", next: str(e && e.next) });
const Failure = ({ error }) => (error ? html`<p class="p-map__failure" role="alert">${error.message}${error.next ? html` <span>${error.next}</span>` : null}</p>` : null);

// The rail about the whole company.
function CompanyBlocks({ home, depts }) {
  const items = needsOf(home.data);
  const asks = asksOf(items);
  const results = resultsOf(items);
  const runs = workingOf(home.data);
  const total = num(home.data && home.data.needsYou && home.data.needsYou.total) || items.length;
  if (home.loading && !home.data) return html`<div class="p-map__rail-pad"><${Loading} lines=${4} label="Loading what needs you" /></div>`;
  if (home.error && !home.data) return html`<div class="p-map__rail-pad"><${ErrorNotice} error=${home.error} onRetry=${home.reload} /></div>`;
  return html`
    <${Blk} title=${MAP_WORDS.needsYou} aside=${countChip(total, "warn")}>
      ${asks.length ? html`<ul class="p-map__items">${asks.slice(0, 3).map((i) => html`<${ItemRow} key=${i.id} item=${i} depts=${depts} />`)}</ul>` : none(MAP_WORDS.noNeeds)}
    <//>
    <${Blk} title=${MAP_WORDS.working} aside=${countChip(runs.length)}>
      ${runs.length ? html`<ul class="p-map__items">${runs.slice(0, 3).map((r) => html`<${WorkRow} key=${r.taskId} run=${r} />`)}</ul>` : none(MAP_WORDS.noWorking)}
    <//>
    <${Blk} title=${MAP_WORDS.results} aside=${countChip(results.length)}>
      ${results.length ? html`<ul class="p-map__items">${results.slice(0, 2).map((i) => html`<${ItemRow} key=${i.id} item=${i} depts=${depts} />`)}</ul>` : none(MAP_WORDS.noResults)}
    <//>`;
}

// ---- The room's actions (D13) ----

// "Switch off" and "Switch on" for one agent, through POST /api/company/agents/<id>/pause and /resume. Asks once when
// the agent is working.
function AgentSwitch({ agent, onChanged }) {
  const app = useApp();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!agent || !agent.id) return null;
  const paused = agent.state === "paused";
  async function go(verb) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/company/agents/${encodeURIComponent(agent.id)}/${verb}`, {});
      setAsking(false);
      app.announce(verb === "pause" ? STUDIO_WORDS.switchedOff : STUDIO_WORDS.switchedOn);
      if (onChanged) onChanged();
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(false);
    }
  }
  if (asking) {
    return html`<div class="p-map__ask-once" role="group" aria-label=${STUDIO_WORDS.switchOffAsk}
        onKeyDown=${(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAsking(false); } }}>
      <p>${STUDIO_WORDS.switchOffAsk}</p>
      <div class="p-map__ask-once-buttons">
        <${Button} variant="danger" size="sm" busy=${busy} onClick=${() => go("pause")}>${STUDIO_WORDS.switchOffYes}<//>
        <${Button} variant="quiet" size="sm" disabled=${busy} onClick=${() => setAsking(false)}>${W.cancel}<//>
      </div>
      <${Failure} error=${error} />
    </div>`;
  }
  return html`<span class="p-map__switch">
    ${paused
      ? html`<${Button} variant="ghost" size="sm" busy=${busy} onClick=${() => go("resume")}>${W.switchOn}<//>`
      : html`<${Button} variant="ghost" size="sm" busy=${busy} onClick=${() => (agent.state === "working" ? setAsking(true) : go("pause"))}>${W.switchOff}<//>`}
    <${Failure} error=${error} />
  </span>`;
}

// "Stop this task": asks once, then POST /api/goals/<id>/stop (the words and body of pages/task.js).
function StopTask({ taskId, onChanged }) {
  const app = useApp();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(taskId)}/stop`, {});
      setAsking(false);
      app.announce(STUDIO_WORDS.stopped);
      if (onChanged) onChanged();
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(false);
    }
  }
  if (!asking) return html`<${Button} variant="danger-quiet" size="sm" icon="cross" onClick=${() => setAsking(true)}>${W.stopTask}<//>`;
  return html`<div class="p-map__ask-once" role="group" aria-label=${STUDIO_WORDS.stopAsk}
      onKeyDown=${(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAsking(false); } }}>
    <p>${STUDIO_WORDS.stopAsk}</p>
    <div class="p-map__ask-once-buttons">
      <${Button} variant="danger" size="sm" busy=${busy} onClick=${stop}>${STUDIO_WORDS.stopYes}<//>
      <${Button} variant="quiet" size="sm" disabled=${busy} onClick=${() => setAsking(false)}>${W.cancel}<//>
    </div>
    <${Failure} error=${error} />
  </div>`;
}

// A lamp glyph as the studio draws it: on, amber, red, off or down. Hidden from readers: the words beside it say it.
const Lamp = ({ lamp }) => html`<span class=${`p-map__lamp p-map__lamp--${lamp || "off"}`} aria-hidden="true"></span>`;

// The amber lamp's words when the server's own state does not say it (PLAN-3D-ALL U17): an agent with something in
// the queue is amber while its state reads "Free" or "Working", so the row says it waits for the owner as well.
const WAITING = "Waiting for you";
const waitWords = (a, cls) => (a.lamp === "amber" && !/wait/i.test(String(a.plainState || ""))
  ? html`<span class=${cls}>${WAITING}</span>` : null);

// "Who is here": each agent of the room with its state words, its task and its switch.
function WhoIsHere({ room, onChanged }) {
  const agents = arr(room && room.agents);
  return html`<${Blk} title=${W.whoIsHere} aside=${countChip(agents.length)}>
    ${agents.length ? html`<ul class="p-map__who">${agents.map((a) => html`<li key=${a.slug} class="p-map__who-row">
      <${Lamp} lamp=${a.lamp} />
      <span class="p-map__who-text">
        <span class="p-map__who-name" title=${a.name}>${a.name}</span>
        <span class="p-map__who-state">${a.plainState}</span>
        ${waitWords(a, "p-map__who-wait")}
        ${a.doing ? html`<span class="p-map__who-task">${a.doing.title}</span>` : null}
      </span>
      <${AgentSwitch} agent=${a} onChanged=${onChanged} />
    </li>`)}</ul>` : none(STUDIO_WORDS.nobody)}
  <//>`;
}

// The rail or panel about one department: its state, what needs the owner there (each with Answer), the work being
// done (Open the task, Stop this task) and, when "Who is here" is not shown, its agents.
function DeptBlocks({ dept, home, depts, onNeeds, room = null, onChanged }) {
  const items = needsOf(home.data, dept.id, depts);
  const n = num(dept.counts && dept.counts.needsYou) || items.length;
  const runs = workingOf(home.data, dept);
  const agents = agentsOf(dept, home.data);
  return html`
    <${Blk}>
      <div class="p-map__facts">
        <${StatusDot} tone=${nodeTone(dept.counts)} pulse=${false} label=${nodeLine(dept.counts)} />
        <p class="p-map__fact"><${Icon} name="jobs" size=${16} /><span>${jobsLine(dept.counts)}</span>
          <a class="p-map__link" href=${`#/jobs?d=${dept.id}`}>${MAP_WORDS.seeJobs}</a></p>
      </div>
    <//>
    ${room ? html`<${WhoIsHere} room=${room} onChanged=${onChanged} />` : null}
    <${Blk} title=${MAP_WORDS.needsYou} aside=${countChip(n, "warn")}>
      ${items.length ? html`<ul class="p-map__tasks">${items.slice(0, 3).map((i) => html`<li key=${i.id} class="p-map__task">
          <span class="p-map__task-title">${clip(i.title, 120)}</span>
          ${i.agent && i.agent.name ? html`<span class="p-map__task-sub">${clip(i.agent.name, 40)}</span>` : null}
          <span class="p-map__task-actions">
            <${Button} variant="primary" size="sm" href=${queueHref(i)}>${STUDIO_WORDS.answer}<//>
            ${linkHref(i.link) ? html`<a class="p-map__link" href=${linkHref(i.link)}>${STUDIO_WORDS.openTask}</a>` : null}
          </span>
        </li>`)}</ul>`
        : home.data || !n ? none(MAP_WORDS.noNeedsHere) : null}
      ${n ? html`<button type="button" class="p-map__link p-map__queue-link" onClick=${() => onNeeds(dept.id)}>${queueWords(n)}<${Icon} name="chevron-right" size=${14} /></button>` : null}
    <//>
    ${room ? null : html`<${Blk} title=${MAP_WORDS.agents} aside=${countChip(agents.length)}>
      ${agents.length ? html`<ul class="p-map__items">${agents.map((a) => html`<li key=${a.slug} class="p-map__item p-map__item--agent">
        <${AgentChip} agent=${a} /><${AgentState} agent=${a} /></li>`)}</ul>` : none(MAP_WORDS.noAgents)}
    <//>`}
    ${runs.length ? html`<${Blk} title=${MAP_WORDS.doing} aside=${countChip(runs.length)}>
      <ul class="p-map__tasks">${runs.map((r) => {
        const href = linkHref({ page: "tasks", id: r.identifier || r.taskId });
        return html`<li key=${r.taskId} class="p-map__task">
          <span class="p-map__task-title">${clip(r.title, 120)}</span>
          <span class="p-map__task-sub">${clip(r.who && r.who.name, 40)}</span>
          <span class="p-map__task-actions">
            ${r.taskId ? html`<${StopTask} taskId=${r.taskId} onChanged=${onChanged} />` : null}
            ${href ? html`<a class="p-map__link" href=${href}>${STUDIO_WORDS.openTask}</a>` : null}
          </span>
        </li>`;
      })}</ul>
    <//>` : null}`;
}

// The notices about the map itself: the board switched off, or a map that could not be read again.
function MapNotices({ map }) {
  const data = map.data;
  const boardOff = data && data.boardOff && typeof data.boardOff === "object" ? data.boardOff : null;
  if (!boardOff && !(map.error && data)) return null;
  return html`<div class="p-map__notices">
    ${boardOff ? html`<${Notice} tone="warn" title="The board is switched off, so the map cannot show what is being worked on.">
        ${plainNext(boardOff.next) ? html`<p class="k-next">${plainNext(boardOff.next)}</p>` : null}
        <p class="k-next"><a href="#/health">Open Health</a></p>
      <//>` : null}
    ${map.error && data ? html`<${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} />` : null}
  </div>`;
}

// ---- The mirrored list: rooms, doors, App Studio ----

// Up and Down move along the list's rows, Home and End jump; Enter is the row's own (a link or a button).
function onListKey(e) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  const box = e.currentTarget;
  const rows = box && typeof box.querySelectorAll === "function" ? [...box.querySelectorAll("[data-row]")] : [];
  if (!rows.length) return;
  const at = rows.indexOf(document.activeElement);
  const to = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1
    : e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
  e.preventDefault();
  rows[to].focus();
}

function RoomList({ ws, chosen, hover, onHover }) {
  const point = (id) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null), onFocus: () => onHover(id), onBlur: () => onHover(null) });
  return html`<ul class="p-map__rooms" role="list" aria-label=${STUDIO_WORDS.rooms}>
    ${ws.rooms.map((r) => html`<li key=${r.id} class=${`p-map__room-sec${hover === r.id ? " is-marked" : ""}${chosen === r.id ? " is-chosen" : ""}`} data-section=${r.id}>
      <a class="p-map__room" href=${mapHref({ dept: r.id })} data-node=${r.id} data-row="" aria-current=${chosen === r.id ? "true" : undefined} ...${point(r.id)}>
        <span class="p-map__room-name" title=${r.title}>${r.title}</span>
        <span class=${`p-map__room-count${r.counts.needsYou ? " is-warn" : ""}`}>${nodeLine(r.counts)}</span>
      </a>
      ${r.inPlan ? null : html`<p class="p-map__room-note">${STUDIO_WORDS.overflow}</p>`}
      ${r.agents.length ? html`<ul class="p-map__agents" role="list">
        ${r.agents.map((a) => html`<li key=${a.slug}>
          <a class="p-map__agent" href=${mapHref({ dept: r.id })} data-row="" ...${point(r.id)}>
            <${Lamp} lamp=${a.lamp} />
            <span class="p-map__agent-name" title=${a.name}>${a.name}</span>
            <span class=${`p-map__agent-state p-map__agent-state--${a.lamp}`}>${a.plainState}</span>
            ${waitWords(a, "p-map__agent-wait")}
            ${a.doing ? html`<span class="p-map__agent-task">${a.doing.title}</span>` : null}
          </a>
        </li>`)}
      </ul>` : null}
    </li>`)}
  </ul>`;
}

function DoorRows({ ws, door, onDoor, onHover }) {
  if (!ws.doors.length) return null;
  return html`<section class="p-map__group" aria-labelledby="p-map-doors">
    <h2 class="p-map__group-title" id="p-map-doors">${W.doors}</h2>
    <ul class="p-map__doors" role="list">
      ${ws.doors.map((d) => html`<li key=${d.id}>
        <button type="button" class=${`p-map__door${door === d.id ? " is-chosen" : ""}`} data-door=${d.id} data-row=""
          aria-expanded=${door === d.id ? "true" : "false"} onClick=${() => onDoor(d.id)}
          onMouseEnter=${() => onHover(d.anchor)} onMouseLeave=${() => onHover(null)}>
          <span class=${`p-map__door-mark p-map__door-mark--${d.state}`} aria-hidden="true"></span>
          <span class="p-map__door-name">${d.title}</span>
          <span class="p-map__door-state">${d.on ? STUDIO_WORDS.doorOpen : STUDIO_WORDS.doorShut}</span>
          ${d.sentence ? html`<span class="p-map__door-line">${d.sentence}</span>` : null}
        </button>
      </li>`)}
    </ul>
  </section>`;
}

function AppRows({ ws }) {
  if (!ws.apps.length && !ws.studio) return null;
  return html`<section class="p-map__group" aria-labelledby="p-map-apps">
    <h2 class="p-map__group-title" id="p-map-apps">${W.appStudio}</h2>
    ${ws.studio && ws.studio.sentence ? html`<p class="p-map__group-line">${ws.studio.sentence}</p>` : null}
    ${ws.apps.length ? html`<ul class="p-map__apps" role="list">
      ${ws.apps.map((a) => html`<li key=${a.slug} class="p-map__app">
        <span class=${`p-map__app-mark${a.on ? " is-on" : ""}${a.spending.open ? " is-open" : ""}`} aria-hidden="true"></span>
        <span class="p-map__app-text">
          <span class="p-map__app-name" title=${a.name}>${a.name}</span>
          ${a.sentence ? html`<span class="p-map__app-line">${a.sentence}</span>` : null}
          ${a.spending.words ? html`<span class="p-map__app-line">${a.spending.words}</span>` : null}
        </span>
        <a class="p-map__link p-map__app-open" href=${a.href} data-row="">${STUDIO_WORDS.appOpen}</a>
      </li>`)}
    </ul>` : null}
  </section>`;
}

// ---- The world's handle, for diffWorld's events ----

// The stage loads world.js through this, so the page keeps the handle and can hand it the events of an update
// (handle.play) before the stage sets the new scene. Loaded only by import(), as the stage does.
function worldLoader(ref) {
  return () => import("../world/world.js").then((m) => ({
    acquire: async (host, opts) => {
      const h = await m.acquire(host, opts);
      ref.current = h;
      return h;
    },
  }));
}

// The free part of the stage, in the stage's pixels: right of the rail, left of the panel, above the foot.
export function safeRectOf(stage, { rail, side, foot } = {}) {
  if (!stage || !(stage.width > 0) || !(stage.height > 0)) return null;
  const x = rail ? Math.max(0, rail.right - stage.left) : 0;
  const right = side ? Math.min(stage.width, side.left - stage.left) : stage.width;
  const bottom = foot ? Math.min(stage.height, foot.top - stage.top) : stage.height;
  return { x: Math.round(x), y: 0, w: Math.max(0, Math.round(right - x)), h: Math.max(0, Math.round(bottom)) };
}

// Focus the first element a selector finds, where the page has a document to search.
const focusOn = (sel) => { if (typeof document !== "undefined" && typeof document.querySelector === "function") document.querySelector(sel)?.focus(); };

const rectOf = (el) => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);

// ---- The page ----

export default function MapPage({ route }) {
  const app = useApp();
  const narrow = useNarrow();
  const { dept, view, ask, bad } = readAddress(route);
  const map = useResource("/api/map", { every: 10000 });
  const home = useResource(view === "list" ? null : "/api/home", { every: 15000 });
  const world = useResource(view === "list" ? null : "/api/world", { every: 10000 });
  const data = map.data;
  const depts = data ? departmentsOf(data) : [];
  const ws = worldState({ world: world.data, map: data, home: home.data });
  const known = !dept || !data || depts.some((d) => d.id === dept) || ws.rooms.some((r) => r.id === dept);
  const company = clip(data && data.company && data.company.name, 60) || clip(ws.company.name, 60);
  const docEl = typeof document !== "undefined" ? document.documentElement : null;
  const still = app.settings?.motion === "off" || (!!docEl && typeof docEl.getAttribute === "function" && docEl.getAttribute("data-motion") === "off");
  const theme = (docEl && typeof docEl.getAttribute === "function" && docEl.getAttribute("data-theme")) === "light" || app.settings?.theme === "light" ? "light" : "dark";
  const money = ws.money && ws.money.line ? ws.money.line : "";
  const [door, setDoor] = useState(null);
  const [hover, setHover] = useState(null);
  const [safe, setSafe] = useState(null);
  const handle = useRef(null);
  const loader = useRef(null);
  if (!loader.current) loader.current = worldLoader(handle);
  const rootRef = useRef(null);
  const railRef = useRef(null);
  const sideRef = useRef(null);
  const footRef = useRef(null);

  // An address for a department that does not exist goes back to the map.
  useEffect(() => {
    if (bad || (data && dept && !known)) location.replace(mapHref({ view, ask }));
  }, [bad, data, dept, known]);

  // The window's title: "Map · Sthyra", "Sales on the map · Sthyra".
  const docTitle = [titleFor(dept, data), company].filter(Boolean).join(" · ");
  useEffect(() => { if (typeof document !== "undefined") document.title = docTitle; }, [docTitle]);

  // The money line in the top bar (D11): the server's sentence, whole.
  useEffect(() => {
    if (view !== "list" && money && typeof app.setTop === "function") app.setTop({ note: money });
  }, [money, view]);

  // Back from a department: focus returns to its heading in the list (after the shell has focused the page's title).
  const was = useRef(dept);
  useEffect(() => {
    const from = was.current;
    was.current = dept;
    if (dept) { cameFrom = dept; return undefined; }
    if (!from || !cameFrom || narrow || view === "list") return undefined;
    const id = cameFrom;
    const t = setTimeout(() => focusOn(`.p-map__room[data-node="${id}"]`), 120);
    return () => clearTimeout(t);
  }, [dept]);

  // A department chosen: the left and right arrows choose its neighbours.
  useEffect(() => {
    if (!dept || !data) return undefined;
    const ids = ws.rooms.length ? ws.rooms.map((r) => r.id) : depts.map((d) => d.id);
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const next = nearestHub(ids, dept, e.key);
      if (next && next !== dept) {
        e.preventDefault();
        location.hash = mapHref({ dept: next, view, ask });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dept, data, view, ask, ws.rooms.length]);

  // A new reading of the company: its changes are played in the studio (D22) before the stage sets the new scene.
  const prevWs = useRef(null);
  const worldKey = world.data ? JSON.stringify([ws.scene, ws.stack]) : "";
  useLayoutEffect(() => {
    const prev = prevWs.current;
    if (!world.data) return;
    prevWs.current = ws;
    const h = handle.current;
    if (!prev || !h) return;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const events = diffWorld(prev, ws, { visible: !hidden });
    if (events.length) try { h.play(events); } catch { /* the world keeps its last picture */ }
  }, [worldKey]);

  // The free rectangle the studio frames its subject in (D15): measured from the rail, the panel and the foot. With a
  // panel open the rail slides away (styles/pages/map.css, as in the approved prototype), so it takes no room then.
  const panelOpen = !!(dept || door || ask);
  useEffect(() => {
    if (narrow || view === "list") return undefined;
    const measure = () => {
      const r = safeRectOf(rectOf(rootRef.current), { rail: panelOpen ? null : rectOf(railRef.current), side: rectOf(sideRef.current), foot: rectOf(footRef.current) });
      if (r) setSafe((p) => (p && p.x === r.x && p.y === r.y && p.w === r.w && p.h === r.h ? p : r));
    };
    measure();
    if (typeof globalThis.ResizeObserver !== "function") return undefined;
    const ro = new globalThis.ResizeObserver(measure);
    for (const el of [rootRef.current, railRef.current, sideRef.current, footRef.current]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [narrow, view, panelOpen]);

  const onNeeds = (department) => app.openNeeds({ department });
  const reread = () => { world.refresh(); map.refresh(); home.refresh(); };

  // The studio's picks: a room goes to its address; a door opens its panel (and nothing more).
  const openDoor = (id) => { if (["web", "generation", "higgsfield"].includes(id)) setDoor(id); };
  const onPick = (id) => {
    if (typeof id !== "string") return;
    if (id.startsWith("door:")) { openDoor(id.slice(5)); return; }
    if (SLUG.test(id) && ws.rooms.some((r) => r.id === id)) {
      setDoor(null);
      location.hash = mapHref({ dept: id, view, ask });
    }
  };
  const closeDoor = () => {
    const id = door;
    setDoor(null);
    setTimeout(() => focusOn(`.p-map__door[data-door="${id}"]`), 0);
  };

  const send = async ({ text }) => {
    let res;
    try {
      res = await api.post("/api/ask", { text });
    } catch (e) {
      const p = askProblem(e);
      throw new Error(p.next ? `${p.message} ${p.next}` : p.message);
    }
    const id = res && res.ask && res.ask.id;
    if (id) location.hash = mapHref({ dept, view, ask: id });
    app.refreshShell();
  };

  const asking = data && data.brain && data.brain.asking;
  const loading = !data && map.loading;
  const failed = !!(map.error && !data);
  const chosen = arr(data && data.departments).find((d) => d && d.id === dept) || depts.find((d) => d.id === dept) || null;
  const room = ws.rooms.find((r) => r.id === dept) || null;
  const doorNow = door ? ws.doors.find((d) => d.id === door) || null : null;
  const listHref = mapHref({ dept, view: "list", ask });
  const closeAsk = () => { location.hash = mapHref({ dept, view }); };
  const answer = ask ? html`<${AnswerPanel} key=${ask} id=${ask} onClose=${closeAsk} />` : null;

  // The box that asks the company brain: one bar with New task, the open question's chip, the field and send; the
  // hint under the bar. The composer's box and hint are laid into the bar's grid (styles/pages/map.css).
  const askBox = html`<div class="p-map__ask">
    <div class="p-map__chips">
      <button type="button" class="p-map__chip" onClick=${() => app.openComposer({})}><${Icon} name="plus" size=${14} /><span>New task</span></button>
      ${asking && !ask && ASK_ID.test(str(asking.id)) ? html`<a class="p-map__chip p-map__chip--live" href=${mapHref({ dept, view, ask: asking.id })}>
        ${waitingLine(asking.queue) ? html`<${Icon} name="clock" size=${14} />` : html`<span class="p-map__live" aria-hidden="true"></span>`}<span>${askingChip(asking)}</span></a>` : null}
    </div>
    <div class="p-map__box" data-box><${Composer} mode="ask" onSend=${send} hint=${askHint(data && data.brain)} /></div>
  </div>`;

  const switcher = html`<${Segmented} size="sm" label=${MAP_WORDS.showAs} current=${view} items=${[
    { id: "map", label: "Map", icon: "map", href: mapHref({ dept, ask }) },
    { id: "list", label: "List", icon: "list", href: listHref },
  ]} />`;

  // The list twin, on any width: the list pattern of Tasks and Jobs.
  if (view === "list") {
    return html`<div class="p-map p-map--list">
      <${PageHeader} title=${titleFor(dept, data)} />
      <div class="p-map__bar">
        <p class="p-map__bar-line">${stageLine(data)}</p>
        <div class="p-map__bar-actions">${switcher}</div>
      </div>
      <${MapNotices} map=${map} />
      ${failed ? html`<${Empty} title=${MAP_ERROR} icon="map"><${Button} size="sm" onClick=${map.reload}>Try again<//><//>`
        : loading ? html`<${Loading} label="Loading the map" />`
        : html`<${MapList} data=${data} onNeeds=${onNeeds} />`}
    </div>`;
  }

  const stage = (focus) => html`<${WorldStage} mode="map" state=${ws} focus=${focus} hover=${hover} safeRect=${narrow ? null : safe}
    theme=${theme} still=${still} label=${ws.summary || MAP_WORDS.stage} onPick=${onPick} onHover=${setHover} load=${loader.current} />`;
  const doorPanel = doorNow ? html`<${DoorPanel} key=${doorNow.id} door=${doorNow} onClose=${closeDoor} onChanged=${reread} announce=${app.announce} />` : null;
  const moneyLine = money ? html`<p class="p-map__money">${money}</p>` : null;

  // A phone: the studio as a picture above today's rows; one department is the picture framed on its room, its facts,
  // who is here and its jobs.
  if (narrow) {
    if (dept) {
      return html`<div class="p-map p-map--narrow p-map--studio-narrow">
        <div class="p-map__phone-stage p-map__phone-stage--room" data-cook-picture>${stage(dept)}</div>
        <div class="p-map__back"><${Button} size="sm" icon="arrow-left" href=${mapHref({ ask })}>Back to the map<//></div>
        <${PageHeader} title=${chosen ? clip(chosen.title, 40) : titleFor(dept, data)} lede=${chosen ? clip(chosen.line, 80) : null} />
        ${moneyLine}
        <${MapNotices} map=${map} />
        ${answer}
        ${chosen ? html`<div class="p-map__phone-go"><${Button} variant="primary" href=${`#/departments/${chosen.id}`}>${MAP_WORDS.openDept}<//></div>
          <div class="p-map__phone-rail"><${DeptBlocks} dept=${chosen} home=${home} depts=${depts} onNeeds=${onNeeds} room=${room} onChanged=${reread} /></div>
          <${DepartmentSection} dept=${chosen} onNeeds=${onNeeds} links=${false} />`
          : html`<${Loading} label="Loading the map" />`}
        ${doorPanel ? html`<div class="p-map__sheet">${doorPanel}</div>` : null}
      </div>`;
    }
    return html`<div class="p-map p-map--narrow p-map--studio-narrow">
      <div class="p-map__phone-stage" data-cook-picture>${stage(null)}</div>
      <${PageHeader} title=${company || titleFor(null, data)} lede=${data ? html`<${StatusDot} tone=${nodeTone(companyCounts(data))} pulse=${false} label=${nodeLine(companyCounts(data))} />` : null} />
      ${moneyLine}
      ${ws.summary ? html`<p class="p-map__summary">${ws.summary}</p>` : null}
      <${MapNotices} map=${map} />
      ${answer}
      ${askBox}
      ${failed ? html`<${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} />`
        : html`<${DepartmentRows} data=${data} stuck=${stuckOf(needsOf(home.data))} />${loading ? html`<span class="u-visually-hidden" role="status">Loading the map</span>` : null}`}
      <div class="p-map__list p-map__list--phone" onKeyDown=${onListKey}>
        <${DoorRows} ws=${ws} door=${door} onDoor=${openDoor} onHover=${setHover} />
        <${AppRows} ws=${ws} />
      </div>
      <p class="p-map__phone-list"><a class="p-map__link" href=${listHref}>Every job, as a list</a></p>
      ${doorPanel ? html`<div class="p-map__sheet">${doorPanel}</div>` : null}
    </div>`;
  }

  // A wide window: the studio fills the page column; the rail, the foot and the panel lie over it.
  const marked = hover ? ws.rooms.find((r) => r.id === hover) || ws.doors.find((d) => d.anchor === hover) || null : null;
  const strip = marked ? html`<p class="p-map__strip" aria-hidden="true">
      <b>${marked.title}</b><span>${marked.counts ? nodeLine(marked.counts) : marked.on ? STUDIO_WORDS.doorOpen : STUDIO_WORDS.doorShut}</span>
      ${marked.line ? html`<span class="p-map__strip-line">${marked.line}</span>` : null}</p>` : null;

  const roomPanel = chosen ? html`<section class="p-map__panel" data-surface="over" aria-labelledby="p-map-room-title"
      onKeyDown=${(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); location.hash = mapHref({ view, ask }); } }}>
    ${answer}
    <div class="p-map__panel-head">
      <div class="p-map__panel-titles">
        <h2 class="p-map__panel-title" id="p-map-room-title"><${Icon} name=${iconOf(chosen.id)} size=${20} /><span>${clip(chosen.title, 60)}</span></h2>
        <p class="p-map__panel-line">${[clip(chosen.line, 120), nodeLine(chosen.counts)].filter(Boolean).join(" · ")}</p>
      </div>
      <a class="p-map__close" href=${mapHref({ view, ask })}><span>${STUDIO_WORDS.close}</span><kbd class="p-map__esc" aria-hidden="true">Esc</kbd></a>
    </div>
    <div class="p-map__panel-body">
      <${DeptBlocks} dept=${chosen} home=${home} depts=${depts} onNeeds=${onNeeds} room=${room || { agents: [] }} onChanged=${reread} />
    </div>
    <div class="p-map__panel-foot">
      <${Button} variant="primary" href=${`#/departments/${chosen.id}`}>${MAP_WORDS.openDept}<//>
    </div>
  </section>` : null;
  const askPanel = !chosen && ask ? html`<section class="p-map__panel" data-surface="over" aria-label=${MAP_WORDS.question}
      onKeyDown=${(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeAsk(); } }}>${answer}</section>` : null;
  const side = doorPanel || roomPanel || askPanel;

  return html`<div class=${["p-map p-map--studio", side ? "p-map--chosen" : "", still ? "p-map--still" : ""].filter(Boolean).join(" ")} ref=${rootRef}>
    <a class="p-map__skip" href=${listHref}>${STUDIO_WORDS.skip}</a>
    <div class="p-map__world" data-cook-picture>${stage(dept)}</div>
    <div class="w-scrim p-map__scrim" aria-hidden="true"></div>
    ${/* With a room, a door or the answer open the rail is inert, and its h1 with it: the page's title stays for a
         screen reader, unseen (PLAN-3D-ALL U17: the accessibility tree had no h1). */
      side ? html`<h1 class="k-sr">${company || "Map"}</h1>` : null}
    <div class="p-map__rail" data-surface="over" ref=${railRef} inert=${side ? true : undefined}>
      <div class="p-map__head">
        <${PageHeader} title=${company || "Map"} />
        <p class="p-map__counts">${data ? html`<${StatusDot} tone=${nodeTone(companyCounts(data))} pulse=${false} label=${nodeLine(companyCounts(data))} />` : null}</p>
        ${ws.summary ? html`<p class="p-map__summary">${ws.summary}</p>` : null}
        ${data && data.brain ? html`<p class="p-map__brain"><${Icon} name="brain" size=${14} /><span>${brainLine(data.brain)}</span></p>` : null}
        <div class="p-map__head-actions">
          <${Button} variant="primary" size="sm" icon="inbox" onClick=${() => app.openNeeds({})}>${MAP_WORDS.openQueue}<//>
          ${switcher}
        </div>
      </div>
      <${MapNotices} map=${map} />
      ${failed ? html`<div class="p-map__stage-error"><${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} /></div>`
        : html`<div class="p-map__list" onKeyDown=${onListKey}>
          ${loading ? html`<${Loading} lines=${4} label="Loading the map" />` : html`<${RoomList} ws=${ws} chosen=${dept} hover=${hover} onHover=${setHover} />`}
          <${DoorRows} ws=${ws} door=${door} onDoor=${openDoor} onHover=${setHover} />
          <${AppRows} ws=${ws} />
        </div>`}
      <div class="p-map__blocks"><${CompanyBlocks} home=${home} depts=${depts} /></div>
    </div>
    <div class=${`p-map__foot${side ? " p-map__foot--side" : ""}`} ref=${footRef}>
      ${strip}
      ${askBox}
    </div>
    ${side ? html`<div class="p-map__side" ref=${sideRef}>${side}</div>` : null}
  </div>`;
}
