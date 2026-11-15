// The map: the home page (CONTRACTS-V3 29; PLAN-COOK T63, a stage page). The company brain and the seven departments
// as cards on the stage, joined by hairlines; the box that asks the company brain at the stage's foot; the rail at the
// right about the whole company (what needs the owner, who is working, the newest results) or, at #/map/<department>,
// about the department chosen (its state, what needs the owner there, its agents, and "Open the department"). The
// list twin at ?view=list; the answer to a question at ?ask=<task id>, at the top of the rail. Below 860 px the map
// is its rows, and one department is its facts and its jobs.
// Data: GET /api/map every 10 seconds; the rail reads GET /api/home every 15 seconds; the box sends POST /api/ask and
// then reads GET /api/ask/:id every 5 seconds while that question is still being read; Got it acts through
// POST /api/inbox/act with the item's version. No timer or frame loop runs while the page is at rest.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
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
  StageBar,
  StageLayout,
  StatusDot,
  Tag,
  useInboxAct,
} from "../kit/index.js";
import { nearestHub } from "../map/layout.js";
import { departmentsOf, iconOf, jobsLine, nodeLine, nodeTone, Overview, stuckOf } from "../map/map-view.js";
import { DepartmentRows, DepartmentSection, MapList } from "../map/map-list.js";

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

// The rail about the whole company.
function CompanyBlocks({ data, home, depts }) {
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

// The rail about one department: its state, what needs the owner there, its agents and the work they are doing.
function DeptBlocks({ dept, home, depts, onNeeds }) {
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
    <${Blk} title=${MAP_WORDS.needsYou} aside=${countChip(n, "warn")}>
      ${items.length ? html`<ul class="p-map__items">${items.slice(0, 3).map((i) => html`<${ItemRow} key=${i.id} item=${i} depts=${depts} />`)}</ul>`
        : home.data || !n ? none(MAP_WORDS.noNeedsHere) : null}
      ${n ? html`<button type="button" class="p-map__link p-map__queue-link" onClick=${() => onNeeds(dept.id)}>${queueWords(n)}<${Icon} name="chevron-right" size=${14} /></button>` : null}
    <//>
    <${Blk} title=${MAP_WORDS.agents} aside=${countChip(agents.length)}>
      ${agents.length ? html`<ul class="p-map__items">${agents.map((a) => html`<li key=${a.slug} class="p-map__item p-map__item--agent">
        <${AgentChip} agent=${a} /><${AgentState} agent=${a} /></li>`)}</ul>` : none(MAP_WORDS.noAgents)}
    <//>
    ${runs.length ? html`<${Blk} title=${MAP_WORDS.doing} aside=${countChip(runs.length)}>
      <ul class="p-map__items">${runs.map((r) => html`<${WorkRow} key=${r.taskId} run=${r} />`)}</ul>
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

// ---- The page ----

export default function MapPage({ route }) {
  const app = useApp();
  const narrow = useNarrow();
  const { dept, view, ask, bad } = readAddress(route);
  const map = useResource("/api/map", { every: 10000 });
  const home = useResource(view === "list" ? null : "/api/home", { every: 15000 });
  const data = map.data;
  const depts = data ? departmentsOf(data) : [];
  const known = !dept || !data || depts.some((d) => d.id === dept);
  const company = clip(data && data.company && data.company.name, 60);
  const still = app.settings?.motion === "off"
    || (typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "off");

  // An address for a department that does not exist goes back to the map.
  useEffect(() => {
    if (bad || (data && dept && !known)) location.replace(mapHref({ view, ask }));
  }, [bad, data, dept, known]);

  // The window's title: "Map · Sthyra", "Sales on the map · Sthyra".
  const docTitle = [titleFor(dept, data), company].filter(Boolean).join(" · ");
  useEffect(() => { if (typeof document !== "undefined") document.title = docTitle; }, [docTitle]);

  // Back from a department: focus returns to its card (after the shell has focused the heading).
  const was = useRef(dept);
  useEffect(() => {
    const from = was.current;
    was.current = dept;
    if (dept) { cameFrom = dept; return undefined; }
    if (!from || !cameFrom || narrow || view === "list") return undefined;
    const id = cameFrom;
    const t = setTimeout(() => document.querySelector(`.p-map__node[data-node="${id}"]`)?.focus(), 120);
    return () => clearTimeout(t);
  }, [dept]);

  // A department chosen: the left and right arrows choose its neighbours.
  useEffect(() => {
    if (!dept || !data) return undefined;
    const ids = depts.map((d) => d.id);
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
  }, [dept, data, view, ask]);

  const onNodeKey = (id, key) => {
    const next = nearestHub(depts.map((d) => d.id), id, key);
    if (next) document.querySelector(`.p-map__node[data-node="${next}"]`)?.focus();
  };
  const onNeeds = (department) => app.openNeeds({ department });

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
  const chosen = depts.find((d) => d.id === dept) || null;
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

  // The canvas's faint dot grid, 16 px apart, under the drawing.
  const grid = html`<svg class="p-map__grid" aria-hidden="true" focusable="false">
    <defs><pattern id="p-map-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle class="p-map__grid-dot" cx="1" cy="1" r="1" /></pattern></defs>
    <rect width="100%" height="100%" fill="url(#p-map-dots)" />
  </svg>`;

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

  // A phone: the map is its rows; one department is its facts, then its jobs.
  if (narrow) {
    if (dept) {
      return html`<div class="p-map p-map--narrow">
        <div class="p-map__back"><${Button} size="sm" icon="arrow-left" href=${mapHref({ ask })}>Back to the map<//></div>
        <${PageHeader} title=${chosen ? clip(chosen.title, 40) : titleFor(dept, data)} lede=${chosen ? clip(chosen.line, 80) : null} />
        <${MapNotices} map=${map} />
        ${answer}
        ${chosen ? html`<div class="p-map__phone-go"><${Button} variant="primary" href=${`#/departments/${chosen.id}`}>${MAP_WORDS.openDept}<//></div>
          <div class="p-map__phone-rail"><${DeptBlocks} dept=${chosen} home=${home} depts=${depts} onNeeds=${onNeeds} /></div>
          <${DepartmentSection} dept=${chosen} onNeeds=${onNeeds} links=${false} />`
          : html`<${Loading} label="Loading the map" />`}
      </div>`;
    }
    return html`<div class="p-map p-map--narrow">
      <${PageHeader} title=${titleFor(null, data)} lede=${data ? html`<${StatusDot} tone=${nodeTone(companyCounts(data))} pulse=${false} label=${nodeLine(companyCounts(data))} />` : null} />
      <${MapNotices} map=${map} />
      ${answer}
      ${askBox}
      ${failed ? html`<${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} />`
        : html`<${DepartmentRows} data=${data} stuck=${stuckOf(needsOf(home.data))} />${loading ? html`<span class="u-visually-hidden" role="status">Loading the map</span>` : null}`}
      <p class="p-map__phone-list"><a class="p-map__link" href=${listHref}>Every job, as a list</a></p>
    </div>`;
  }

  // A wide window: the stage page.
  const stage = html`<div class="p-map__stage">
    ${grid}
    <a class="p-map__skip" href=${listHref}>Skip the map, show it as a list</a>
    <${StageBar}>
      <b>${MAP_WORDS.stage}</b>${stageLine(data) ? html`<span>${stageLine(data)}</span>` : null}
      <span class="k-stagebar__gap"></span>
      ${switcher}
    <//>
    ${failed ? html`<div class="p-map__stage-error"><${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} /></div>`
      : html`<${Overview} data=${data} loading=${loading} chosen=${dept} onNodeKey=${onNodeKey} stuck=${stuckOf(needsOf(home.data))}
          fallback=${html`<${DepartmentRows} data=${data} chosen=${dept} stuck=${stuckOf(needsOf(home.data))} />`} />
        ${loading ? html`<span class="u-visually-hidden" role="status">Loading the map</span>` : null}`}
    ${askBox}
  </div>`;

  const rail = html`<${MapNotices} map=${map} />${answer}${chosen
    ? html`<${DeptBlocks} dept=${chosen} home=${home} depts=${depts} onNeeds=${onNeeds} />`
    : html`<${CompanyBlocks} data=${data} home=${home} depts=${depts} />`}`;

  const title = chosen
    ? html`<span class="p-map__title"><${Icon} name=${iconOf(chosen.id)} size=${24} /><span>${clip(chosen.title, 40)}</span></span>`
    : company || "Map";
  const lede = chosen
    ? clip(chosen.line, 80) || null
    : data ? html`<${StatusDot} tone=${nodeTone(companyCounts(data))} pulse=${false} label=${nodeLine(companyCounts(data))} />` : null;
  const foot = chosen
    ? html`<${Button} variant="primary" size="lg" href=${`#/departments/${chosen.id}`}>${MAP_WORDS.openDept}<//>`
    : html`<${Button} variant="primary" size="lg" icon="inbox" onClick=${() => app.openNeeds({})}>${MAP_WORDS.openQueue}<//>`;

  return html`<div class=${["p-map p-map--wide", chosen ? "p-map--chosen" : "", still ? "p-map--still" : ""].filter(Boolean).join(" ")}>
    <${StageLayout} kind=${chosen ? MAP_WORDS.department : MAP_WORDS.company} title=${title} lede=${lede}
      label=${MAP_WORDS.stage} stage=${stage} rail=${rail} foot=${foot} />
  </div>`;
}
