// A department, in one column (CONTRACTS-V3 30, "A department"; data: GET /api/map/:department, 33.2).
// PLAN-COOK T65, TB4, R5-G (R02's reading column, one left edge): the department's line icon in a tile inside the
// title, its links as a button group on the title's line, its line and its state under it (the one warn line on the
// page when it waits); then what needs the owner (its items as rows, from GET /api/home, with who raised each and
// its age, and "Open the queue"; the one raised panel of the page), its agents as rows and the owner's tasks with it
// as two-line rows, both flat under hairlines (R6-G); every heading's count one muted figure; the jobs it can run as cards (as the Jobs page lays them), and a composer that gives it a task
// (POST /api/goals).
// Not connected: this page's answer does not say when the board cannot be read, so that comes from GET /api/map's
// `boardOff` and from the shell (boardOffOf below); the page then says so on top and stops guessing.
// Everything here came from the server: titles and outcomes are rendered as text only, capped.
// PLAN-3D-ALL U10: a surface screen (#/map/<id> is its scene). The head (the tile and the name, the two links, the
// line and the state) stands in the room header (kit/room.js), the picture of this department's room (else the
// generic room); no picture is asked for while the department is read, nor on a phone, where the head fills the
// band (the band's material alone). Each agent's row carries the Map's lamp
// at the column's edge (world/state.js lampOf, a pure function: no three.js), lit by the same rule as the Map: an
// agent with something in the queue waits for the owner. The state's words are unchanged. Nothing here is on paper.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { aheadLine } from "../lib/format.js";
import { needsFor, queueHref, rowTime, sortNeeds } from "../lib/queue.js";
import { lampOf } from "../world/state.js";
import { HealthNext, useWide } from "./team.js";
import {
  AgentCard, Button, Card, Composer, Empty, ErrorNotice, Field, Icon, JobRow, Lamp, Loading, NotConnected, RoomHeader,
  STARTED, Select, St, TaskRow, Tile, UNDER_START, WhyNot, glimpseFor, jobHref,
} from "../kit/index.js";

const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
const RECENT = 10;
// What the notice says when only the shell tells that the board is off (the map's answer carries its own words).
const OFF_REASON = "The board is switched off, so agents and tasks cannot be reached.";
const OFF_NEXT = "Open Health to see how to start it.";
// The Can run list shows this many jobs, then "Show all n" (M51 F24).
export const NARROW_CHIPS = 6;

// The departments' line icons, as the sidebar draws them (shell/sidenav.js TEAM_ICONS; a page does not import the
// shell). No creature and no colour: a department is known by its icon and its name.
const DEPT_ICONS = { brain: "brain", operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book" };
export const deptIcon = (id) => DEPT_ICONS[id] || "layers";

// The words this page adds (T65).
export const WORDS = Object.freeze({
  needs: "Needs you",
  agents: "Its agents",
  canRun: "Can run",
  seeAll: "See all",
  seeJobs: "See its jobs",
  openQueue: "Open the queue",
  others: "Other departments",
});

// The line of the "Needs you" row: how many things wait for the owner here, from the department's counts.
// With the board off nobody knows, so it says so instead of "nothing".
export function needsLine(name, counts, off = null) {
  const who = text(name) || "this department";
  if (off) return `What needs you in ${who} cannot be shown right now.`;
  const n = counts ? counts.needsYou : null;
  if (!Number.isSafeInteger(n) || n <= 0) return `Nothing needs you in ${who} right now.`;
  return `${n} ${n === 1 ? "thing needs" : "things need"} you in ${who}.`;
}

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

// The line under the composer: how long a task takes, or that none can be given while the board is off. When other
// work is ahead in the Chief of staff's line (`queue` of GET /api/shell, M63) no time is promised.
export function captionUnder(off = null, queue = null) {
  if (off) return "Tasks cannot be given while the board is off.";
  const ahead = aheadLine(queue);
  return ahead ? `${ahead} It is checked before it reaches you.` : UNDER_START;
}

// The words once a task is given, by the same rule.
export function startedLine(queue = null) {
  const ahead = aheadLine(queue);
  return ahead ? `Started. The Chief of staff has it. ${ahead} It is checked before it reaches you.` : STARTED;
}

// The department's state as a state line (St). Waiting opens the queue for this department; working opens the
// task; idle is only words.
const ST_OF = { warn: { tone: "warn" }, live: { tone: "good", icon: "loop" }, off: { tone: "neutral", icon: "clock" } };
function StateChip({ state, department, off }) {
  const { openNeeds } = useApp();
  const s = stateChip(state, off);
  const st = ST_OF[s.tone] || ST_OF.off;
  const chip = html`<${St} tone=${st.tone} icon=${st.icon}>${s.label}<//>`;
  if (!off && state && state.id === "waiting") {
    return html`<button type="button" class="p-dept__state p-dept__state--link" onClick=${() => openNeeds({ department })}
      aria-label=${`${s.label}. Open what needs you here`}>${chip}</button>`;
  }
  return s.taskId
    ? html`<a class="p-dept__state p-dept__state--link" href=${`#/tasks/${encodeURIComponent(s.taskId)}`}>${chip}</a>`
    : html`<span class=${`p-dept__state${s.tone === "off" ? " p-dept__state--quiet" : ""}`}>${chip}</span>`;
}

// A heading's count: a muted figure after its words, one style for every count (R5-G); what waits on the owner
// is said once, by the head's state.
const Count = ({ n }) => html`<span class="p-dept__count">${n}</span>`;

// A section of the column: its heading (with its count) and, on the heading's line, its one link or button.
const Section = ({ title, aside, children }) => html`<section class="p-dept__section">
  <div class="p-dept__section-head">
    <h2 class="p-dept__section-title">${title}</h2>
    ${aside ? html`<div class="p-dept__section-aside">${aside}</div>` : null}
  </div>
  ${children}
</section>`;

// The glyph of a thing that waits on the owner, by its kind (as the queue draws it).
const KIND_ICON = { shotlist: "video", pick: "layers", approval: "check", question: "reply", result: "check", draft: "file" };
export const needIcon = (kind) => KIND_ICON[kind] || "inbox";

// Who raised a thing that waits on the owner: its agent's name, else the server's `raisedBy`; "" when neither.
export const whoOf = (item) => cap((item && item.agent && item.agent.name) || (item && item.raisedBy), 40);

// What waits on the owner in this department, most urgent and newest first: GET /api/home's items of this
// department (the queue's own rule), or null while they cannot be read.
export function needsHere(home, id, departments) {
  const items = home && home.needsYou && Array.isArray(home.needsYou.items) ? home.needsYou.items : null;
  if (!items) return null;
  return needsFor(sortNeeds(items), id, departments);
}

// The jobs as the Jobs page lays them: cards two across, the kit's JobRow as the card's link, the reason a job
// cannot start under it. The first six, then "Show all n".
function CanRun({ jobs }) {
  const [all, setAll] = useState(false);
  if (!jobs.length) return html`<p class="p-dept__muted">No jobs yet. Give it a task below in your own words.</p>`;
  const more = jobs.length > NARROW_CHIPS;
  const shown = more && !all ? jobs.slice(0, NARROW_CHIPS) : jobs;
  return html`<ul class="p-dept__jobs">
    ${shown.map((j) => {
      const why = j.ready === false ? whyText(j) : "";
      return html`<li key=${j.id} class=${`p-dept__job${why ? " p-dept__job--dim" : ""}`}>
        <${Card} padding="none" class="p-dept__job-box">
          <${JobRow} job=${j} />
          ${why && html`<div class="p-dept__why"><${WhyNot} why=${j.why} /></div>`}
        <//>
      </li>`;
    })}
  </ul>
  ${more && !all && html`<button type="button" class="p-dept__more" onClick=${() => setAll(true)}>Show all ${jobs.length}</button>`}`;
}

function Head({ data, off }) {
  const wide = useWide();
  const dep = data.department || {};
  const id = text(dep.id);
  const name = text(dep.title) || "Department";
  const links = html`<div class="p-dept__actions" role="group" aria-label="This department elsewhere">
    <${Button} variant="ghost" size="sm" icon="map" href=${`#/map/${encodeURIComponent(id)}`}>See on the map<//>
    ${SLUG.test(text(dep.dashboard)) && html`<${Button} variant="ghost" size="sm" icon="dashboards" href=${`#/dashboards/${encodeURIComponent(dep.dashboard)}`}>Open its dashboard<//>`}
  </div>`;
  const title = html`<span class="p-dept__title"><span class="p-dept__tile"><${Tile} icon=${deptIcon(id)} size=${32} /></span><span>${name}</span></span>`;
  return html`<div class="p-dept__head">
    <${RoomHeader} glimpse=${wide ? glimpseFor("dept", id) : null} title=${title} lead=${cap(dep.line, 120)} actions=${links}>
      <${StateChip} state=${dep.state} department=${id} off=${off} />
    <//>
  </div>`;
}

// What needs the owner here: its items as rows (glyph, title, age), "Open the queue" on the heading's line. Until
// the items can be read, or with the board off, one row says how many and opens the queue for this department.
function Needs({ data, off, items }) {
  const { openNeeds } = useApp();
  const dep = data.department || {};
  const id = text(dep.id);
  const n = dep.counts ? dep.counts.needsYou : null;
  const some = !off && Number.isSafeInteger(n) && n > 0;
  const rows = !off && Array.isArray(items) ? items.slice(0, 5) : null;
  const open = () => openNeeds({ department: id });
  const title = html`${WORDS.needs}${some ? html` <${Count} n=${n} />` : null}`;
  if (rows && rows.length) {
    return html`<${Section} title=${title}
      aside=${html`<${Button} variant="ghost" size="sm" onClick=${open}>${WORDS.openQueue}<//>`}>
      <ul class="p-dept__list p-dept__list--needs">${rows.map((i) => html`<li key=${i.id}>
        <a class="p-dept__need" href=${queueHref(i)}>
          <${Tile} icon=${needIcon(i.kind)} size=${28} />
          <span class="p-dept__need-title">${cap(i.title, 160)}</span>
          <span class="p-dept__need-meta">
            ${whoOf(i) ? html`<span class="p-dept__need-who">${whoOf(i)}</span>` : null}
            ${i.when ? html`<time class="p-dept__need-when" datetime=${text(i.when)}>${rowTime(i.when)}</time>` : null}
          </span>
        </a>
      </li>`)}</ul>
    <//>`;
  }
  if (rows && !rows.length && !some) {
    return html`<${Section} title=${title}><p class="p-dept__muted">${needsLine(dep.title, dep.counts, off)}</p><//>`;
  }
  return html`<${Section} title=${title}>
    <button type="button" class=${`p-dept__needs${some ? " p-dept__needs--some" : ""}`} onClick=${open}>
      <span class="p-dept__needs-icon" aria-hidden="true"><${Icon} name="inbox" size=${16} /></span>
      <span class="p-dept__needs-text">${needsLine(dep.title, dep.counts, off)}</span>
      <span class="p-dept__needs-go">${WORDS.openQueue}<${Icon} name="chevron-right" size=${16} /></span>
    </button>
  <//>`;
}

// The agents' slugs that have something in the queue (GET /api/home's items), as the Map reads them: their lamp is
// amber. An empty set until the home has answered.
export function queuedSlugs(home) {
  const items = home && home.needsYou && Array.isArray(home.needsYou.items) ? home.needsYou.items : [];
  return new Set(items.map((i) => (i && i.agent && typeof i.agent.slug === "string" ? i.agent.slug : null)).filter(Boolean));
}

// An agent's lamp on this page: the Map's rule (world/state.js), with the queue's word on who waits for the owner.
export const lampHere = (agent, queued) =>
  lampOf(agent && typeof agent === "object" ? { ...agent, waitingForYou: agent.waitingForYou === true || (queued ? queued.has(agent.slug) : false) } : agent);

function Agents({ agents, queued }) {
  const list = arr(agents).filter((a) => a && a.slug);
  if (!list.length) return null;
  return html`<${Section} title=${html`${WORDS.agents} <${Count} n=${list.length} />`}>
    <ul class="p-dept__agents">${list.map((a) => html`<li key=${a.slug} class="p-dept__agent"><span class="p-dept__lamp"><${Lamp} state=${lampHere(a, queued)} /></span><${AgentCard} agent=${a} /></li>`)}</ul>
  <//>`;
}

function Tasks({ data, off }) {
  const name = text(data.department && data.department.title);
  const id = text(data.department && data.department.id);
  const recent = arr(data.recent).filter((t) => t && t.id).slice(0, RECENT);
  const h = tasksHeading(name, recent, data.recentTotal);
  return html`<${Section} title=${html`${h.label}${off && !recent.length ? null : html` <${Count} n=${h.count} />`}`}
    aside=${recent.length > 0 ? html`<${Button} variant="ghost" size="sm" href=${`#/tasks?d=${encodeURIComponent(id)}`}>${WORDS.seeAll}<//>` : null}>
    ${recent.length
      ? html`<ul class="p-dept__rows">${recent.map((t) => html`<li key=${t.id} class="p-dept__row"><${TaskRow} task=${t} /></li>`)}</ul>`
      : html`<p class="p-dept__muted">${noTasksLine(name, off)}</p>`}
  <//>`;
}

function Jobs({ data }) {
  const id = text(data.department && data.department.id);
  const jobs = jobsInOrder(data.clusters);
  return html`<${Section} title=${html`${WORDS.canRun}${jobs.length ? html` <${Count} n=${jobs.length} />` : null}`}
    aside=${html`<${Button} variant="ghost" size="sm" href=${`#/jobs?d=${encodeURIComponent(id)}`}>${WORDS.seeJobs}<//>`}>
    <${CanRun} jobs=${jobs} />
  <//>`;
}

function Around({ data }) {
  const nb = data.neighbours || {};
  const prev = nb.prev && SLUG.test(text(nb.prev.id)) ? nb.prev : null;
  const next = nb.next && SLUG.test(text(nb.next.id)) ? nb.next : null;
  if (!prev && !next) return null;
  return html`<nav class="p-dept__around" aria-label=${WORDS.others}>
    ${prev && html`<a class="p-dept__nb" href=${`#/departments/${prev.id}`} data-dept=${prev.id}>
      <${Icon} name="arrow-left" size=${16} /><span>${cap(prev.title, 40)}</span></a>`}
    ${next && html`<a class="p-dept__nb p-dept__nb--next" href=${`#/departments/${next.id}`} data-dept=${next.id}>
      <span>${cap(next.title, 40)}</span><${Icon} name="arrow-right" size=${16} /></a>`}
  </nav>`;
}

function Give({ data, off, onSent }) {
  const { refreshShell, announce, shell } = useApp();
  const queue = shell && shell.queue ? shell.queue : null;
  const name = text(data.department && data.department.title);
  const agents = arr(data.agents).filter((a) => a && a.slug);
  const [picked, setPicked] = useState(null);
  const [started, setStarted] = useState(null);
  const jobs = jobsInOrder(data.clusters);
  const who = goalTo(agents, picked);

  async function send(input) {
    setStarted(null);
    const out = await api.post("/api/goals", goalBody(input, agents, picked));
    // The line as it stood when the task was given: it joined the end of it.
    const line = startedLine(queue);
    setStarted({ ...(out && out.goal ? out.goal : {}), line });
    announce(line);
    refreshShell();
    onSent();
  }
  const pickJob = (job) => {
    const href = jobHref(job);
    if (href && typeof location !== "undefined") location.hash = href;
  };

  return html`<div class="p-dept__give">
    ${started && html`<p class="p-dept__started" role="status"><${Icon} name="check" size=${16} />
      <span>${started.line || STARTED}${started.id
        ? html` <a href=${`#/tasks/${encodeURIComponent(started.id)}`}>Open the task${started.identifier ? ` ${cap(started.identifier, 20)}` : ""}</a>`
        : null}</span></p>`}
    ${agents.length > 1 && html`<div class="p-dept__for">
      <${Field} label="Give it to">
        <${Select} value=${who || ""} onChange=${(e) => setPicked(String(e.currentTarget.value))}
          options=${agents.map((a) => ({ value: a.slug, label: text(a.name) || a.slug }))} />
      <//>
    </div>`}
    <fieldset class=${`p-dept__box${off ? " p-dept__box--off" : ""}`} disabled=${!!off}>
      <legend class="k-sr">${composerPlaceholder(name)}</legend>
      <${Composer}
        placeholder=${composerPlaceholder(name)}
        agents=${[]}
        templates=${jobs}
        onPickJob=${pickJob}
        onSend=${send} />
    </fieldset>
    <p class="p-dept__caption">${captionUnder(off, queue)}</p>
  </div>`;
}

export default function Page({ route }) {
  const { shell } = useApp();
  const wide = useWide();
  const id = deptIdOf(route);
  const res = useResource(id ? `/api/map/${id}` : null, { every: 10000 });
  // Read for `boardOff` (whether this page's figures are real, or zeros because the board cannot be read) and for
  // the departments' agents, which tell the queue's items apart.
  const map = useResource(id ? "/api/map" : null, { every: 10000 });
  // What waits on the owner, as the queue has it: this department's items are listed under Needs you.
  const home = useResource(id ? "/api/home" : null, { every: 15000 });
  const d = res.data;
  const docName = d && d.department ? cap(d.department.title, 40) : "";
  const company = shell && shell.company ? cap(shell.company.name, 60) : "";
  // The title is drawn with its tile, so the window's title is set here: "Marketing · Sthyra".
  useEffect(() => {
    if (docName && typeof document !== "undefined") document.title = [docName, company].filter(Boolean).join(" · ");
  }, [docName, company]);

  if (!d || !d.department) {
    let body;
    if (!id || (res.error && res.error.status === 404)) {
      body = html`<${Empty} title="That department is not here" text="The company has seven departments. Pick one on the map.">
        <a href="#/map">Open the map</a>
      <//>`;
    } else if (res.error) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
    else body = html`<${Loading} lines=${6} label="Loading the department" />`;
    return html`<div class="p-dept">
      <${RoomHeader} glimpse=${wide && (!id || res.error) ? glimpseFor("dept", id) : null} title=${!id || (res.error && res.error.status === 404) ? "Not found" : "Department"} back=${{ href: "#/map", label: "Map" }} />
      ${body}
    </div>`;
  }

  const off = boardOffOf(map.data, shell);
  return html`<div class="p-dept" data-dept=${text(d.department.id)}>
    ${off && html`<${NotConnected} title=${offTitle(d.department.title)} reason=${off.reason}
      next=${html`<${HealthNext} text=${off.next} />`} />`}
    <${Head} data=${d} off=${off} />
    <${Needs} data=${d} off=${off} items=${needsHere(home.data, id, map.data && map.data.departments)} />
    <${Agents} agents=${d.agents} queued=${queuedSlugs(home.data)} />
    <${Tasks} data=${d} off=${off} />
    <${Jobs} data=${d} />
    <${Give} data=${d} off=${off} onSent=${() => res.refresh()} />
    <${Around} data=${d} />
  </div>`;
}
