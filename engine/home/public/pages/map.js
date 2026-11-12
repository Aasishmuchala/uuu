// The map: the home page (CONTRACTS-V3 29). The company brain in the middle, the seven departments around it,
// a dot per job; one department zoomed at #/map/<department>; the list twin at ?view=list; the box at the
// bottom that asks the company brain, with the answer above it at ?ask=<task id>.
// Data: GET /api/map every 10 seconds; the Today chip reads GET /api/home; the box sends POST /api/ask and then
// reads GET /api/ask/:id every 5 seconds while that question is still being read; Got it acts through
// POST /api/inbox/act with the item's version. No timer or frame loop runs while the page is at rest.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { aheadLine, waitingLine } from "../lib/format.js";
import {
  AnswerView,
  ASK_HINT,
  BriefCard,
  Button,
  changedText,
  Composer,
  ErrorNotice,
  HANDOFFS,
  Icon,
  Loading,
  NextStep,
  Notice,
  PageHeader,
  Segmented,
  STAGES,
  useInboxAct,
} from "../kit/index.js";
import { nearestHub } from "../map/layout.js";
import { Crown, DepartmentView, departmentsOf, hubOrigin, Overview } from "../map/map-view.js";
import { DepartmentRows, DepartmentSection, MapList } from "../map/map-list.js";

const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const ASK_ID = /^[A-Za-z0-9-]{1,64}$/;
const NARROW = "(max-width: 859px)";
const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);

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

// The daily brief's items from /api/home, at most 12.
export const briefItems = (home) => arr(home && home.brief && home.brief.items).filter((i) => i && typeof i === "object").slice(0, 12);

// The page's heading for a screen reader, and the window's title.
// What the map says when /api/map fails: the map is read from files, so the board is not named (C3 29.7).
export const MAP_ERROR = "The map could not be read. Try again; if it stays, Health shows what is wrong.";

export const titleFor = (dept, data) => {
  if (!dept) return "Map";
  const d = departmentsOf(data).find((x) => x.id === dept);
  return d ? `${str(d.title).slice(0, 40)} on the map` : "Map";
};

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

// The department the map last zoomed into, so Esc gives focus back to its hub.
let cameFrom = null;

// ---- The answer above the box ----

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
      <p class="p-map__over-line">Company brain</p>
      <button type="button" class="p-map__icon-btn" aria-label="Close the answer" onClick=${onClose}><${Icon} name="cross" size=${16} /></button>
    </div>
    <div class="p-map__answer-body">${body}</div>
    ${waiting ? html`<div class="p-map__answer-foot">
      ${err ? html`<p class="p-map__answer-error" role="alert">${err.message} ${err.next}</p>` : null}
      <${Button} variant="primary" size="sm" icon="check" busy=${busy} onClick=${gotIt}>${str(waiting.label).slice(0, 30) || "Got it"}<//>
    </div>` : null}
  </section>`;
}

// ---- Today and the legend ----

// Esc closes an open disclosure and gives focus back to its chip, before anything else hears the key (M52 K4).
function closeOnEsc(e) {
  const d = e.currentTarget;
  if (e.key !== "Escape" || !d || !d.open) return;
  e.preventDefault();
  e.stopPropagation();
  d.open = false;
  d.querySelector("summary")?.focus();
}

function Today() {
  const [open, setOpen] = useState(false);
  const home = useResource(open ? "/api/home" : null);
  const items = briefItems(home.data);
  return html`<details class="p-map__pop p-map__pop--today" onToggle=${(e) => setOpen(e.currentTarget.open)} onKeyDown=${closeOnEsc}>
    <summary class="p-map__chip"><${Icon} name="sun" size=${14} /><span>Today</span></summary>
    <div class="p-map__pop-body">
      <p class="p-map__over-line">Today's brief</p>
      ${home.loading ? html`<${Loading} lines=${2} label="Loading the brief" />`
        : home.error ? html`<${ErrorNotice} error=${home.error} onRetry=${home.reload} />`
        : items.length ? html`<div class="p-map__brief">${items.map((it) => html`<${BriefCard} key=${it.id} item=${it} />`)}</div>`
        : html`<p class="p-map__none">Nothing new today.</p>`}
    </div>
  </details>`;
}

function Legend() {
  return html`<details class="p-map__pop p-map__pop--legend" onKeyDown=${closeOnEsc}>
    <summary class="p-map__chip"><${Icon} name="tag" size=${14} /><span>What the dots mean</span></summary>
    <div class="p-map__pop-body">
      <ul class="p-map__legend">
        <li><span class="p-map__key p-map__key--ready" aria-hidden="true"></span>A job that is ready to start</li>
        <li><span class="p-map__key p-map__key--blocked" aria-hidden="true"></span>A job that cannot start yet</li>
        <li><span class="p-map__key p-map__key--working" aria-hidden="true"></span>Being worked on now</li>
        <li><span class="p-map__key p-map__key--warm" aria-hidden="true"></span>Something waits for you</li>
      </ul>
      <p class="p-map__over-line">The order to build in</p>
      <ul class="p-map__legend">
        ${Object.entries(STAGES).map(([n, s]) => html`<li key=${n}><strong class="p-map__legend-tag">${n} ${s.label}</strong> ${s.about}</li>`)}
      </ul>
      <p class="p-map__over-line">Who does the main part</p>
      <ul class="p-map__legend">
        ${Object.entries(HANDOFFS).map(([id, h]) => html`<li key=${id}><strong class="p-map__legend-tag">${h.label}</strong> ${h.about}</li>`)}
      </ul>
    </div>
  </details>`;
}

// ---- The page ----

export default function MapPage({ route }) {
  const app = useApp();
  const narrow = useNarrow();
  const { dept, view, ask, bad } = readAddress(route);
  const map = useResource("/api/map", { every: 10000 });
  const data = map.data;
  const depts = data ? departmentsOf(data) : [];
  const known = !dept || !data || depts.some((d) => d.id === dept);
  const still = app.settings?.motion === "off"
    || (typeof document !== "undefined" && document.documentElement.getAttribute("data-motion") === "off");

  // The last department zoomed into stays drawn while the view zooms back out.
  const [shown, setShown] = useState(dept);
  useEffect(() => { if (dept) setShown(dept); }, [dept]);

  // An address for a department that does not exist goes back to the map.
  useEffect(() => {
    if (bad || (data && dept && !known)) location.replace(mapHref({ view, ask }));
  }, [bad, data, dept, known]);

  // Back from a department: focus returns to its hub (after the shell has focused the heading).
  const was = useRef(dept);
  useEffect(() => {
    const from = was.current;
    was.current = dept;
    if (dept) { cameFrom = dept; return undefined; }
    if (!from || !cameFrom || narrow || view === "list") return undefined;
    const id = cameFrom;
    const t = setTimeout(() => document.querySelector(`.p-map__hub[data-hub="${id}"]`)?.focus(), 120);
    return () => clearTimeout(t);
  }, [dept]);

  // Zoomed: the left and right arrows go to the neighbouring departments.
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

  const onHubKey = (id, key) => {
    const next = nearestHub(depts.map((d) => d.id), id, key);
    if (next) document.querySelector(`.p-map__hub[data-hub="${next}"]`)?.focus();
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
  const zoomedDept = depts.find((d) => d.id === dept) || null;
  const shownDept = depts.find((d) => d.id === (dept || shown)) || null;
  const origin = hubOrigin(data, dept || shown);
  const listHref = mapHref({ dept, view: "list", ask });
  const failed = !!(map.error && !data);
  const cls = ["p-map", narrow ? "p-map--narrow" : "p-map--wide", dept ? "p-map--zoomed" : "", view === "list" ? "p-map--list" : "",
    ask ? "p-map--asked" : "", still ? "p-map--still" : ""]
    .filter(Boolean).join(" ");

  // The legend and Today: fixed corners on a wide window; on a phone one row under the crown (or at the top of a
  // department's list), before the rows. Not shown while the map cannot be read: there is nothing to explain.
  const chipsRow = html`<div class="p-map__aids">
    <div class="p-map__corner p-map__corner--top"><${Legend} /></div>
    <div class="p-map__corner p-map__corner--left"><${Today} /></div>
  </div>`;

  let body;
  if (failed) {
    body = html`<div class="p-map__stage-error"><${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} /></div>`;
  } else if (view === "list" && !narrow) {
    body = loading ? html`<${Loading} label="Loading the map" />` : html`<${MapList} data=${data} onNeeds=${onNeeds} />`;
  } else if (narrow && dept) {
    body = html`<div class="p-map__narrow">
      <${Button} size="sm" icon="arrow-left" href=${mapHref({ view, ask })}>Back to the map<//>
      ${chipsRow}
      ${zoomedDept ? html`<div class="p-map__card u-glass"><${DepartmentSection} dept=${zoomedDept} level=${1} onNeeds=${onNeeds} /></div>`
        : html`<${Loading} label="Loading the map" />`}
    </div>`;
  } else if (narrow && view === "list") {
    body = loading ? html`<${Loading} label="Loading the map" />` : html`<div class="p-map__narrow">${chipsRow}<${MapList} data=${data} onNeeds=${onNeeds} /></div>`;
  } else if (narrow) {
    body = html`<div class="p-map__narrow">
      <${Crown} data=${data} loading=${loading} />
      ${chipsRow}
      ${loading ? html`<span class="u-visually-hidden" role="status">Loading the map</span>` : html`<${DepartmentRows} data=${data} onNeeds=${onNeeds} />`}
    </div>`;
  } else {
    body = html`<div class="p-map__stage">
      <div class=${`p-map__layer p-map__layer--overview${dept ? " is-away" : ""}`} inert=${!!dept}
        style=${`--p-map-ox: ${origin.x}; --p-map-oy: ${origin.y};`}>
        <${Overview} data=${data} loading=${loading} onNeeds=${onNeeds} onHubKey=${onHubKey} />
        ${loading ? html`<span class="u-visually-hidden" role="status">Loading the map</span>` : null}
      </div>
      <div class=${`p-map__layer p-map__layer--dept${dept ? " is-on" : ""}`} inert=${!dept}>
        ${shownDept ? html`<${DepartmentView} dept=${shownDept} all=${depts} onNeeds=${onNeeds}
          fallback=${html`<${DepartmentSection} dept=${shownDept} level=${1} onNeeds=${onNeeds} />`} />` : null}
      </div>
    </div>`;
  }

  const boardOff = data && data.boardOff && typeof data.boardOff === "object" ? data.boardOff : null;

  return html`<div class=${cls}>
    ${view === "list" ? null : html`<a class="p-map__skip" href=${listHref}>Skip the map, show it as a list</a>`}
    <div class="u-visually-hidden"><${PageHeader} title=${titleFor(dept, data)} /></div>
    ${boardOff ? html`<div class="p-map__notice">
      <${Notice} tone="warn" title="The board is switched off, so the map cannot show what is being worked on.">
        ${plainNext(boardOff.next) ? html`<p class="k-next">${plainNext(boardOff.next)}</p>` : null}
        <p class="k-next"><a href="#/health">Open Health</a></p>
      <//>
    </div>` : null}
    ${map.error && data ? html`<div class="p-map__notice"><${ErrorNotice} error=${MAP_ERROR} onRetry=${map.reload} /></div>` : null}
    ${dept && !narrow && view !== "list" ? html`<div class="p-map__back">
      <${Button} size="sm" icon="arrow-left" href=${mapHref({ view, ask })}>Back to the map<//>
    </div>` : null}
    ${body}
    ${narrow || failed ? null : chipsRow}
    ${narrow ? null : html`<div class="p-map__corner p-map__corner--right">
      <${Segmented} size="sm" label="Show the map as" current=${view} items=${[
        { id: "map", label: "Map", icon: "map", href: mapHref({ dept, ask }) },
        { id: "list", label: "List", icon: "list", href: listHref },
      ]} />
    </div>`}
    <div class="p-map__bottom">
      ${ask ? html`<${AnswerPanel} key=${ask} id=${ask} onClose=${() => { location.hash = mapHref({ dept, view }); }} />` : null}
      <div class="p-map__chips">
        <button type="button" class="p-map__chip" onClick=${() => app.openComposer({})}><${Icon} name="plus" size=${14} /><span>New task</span></button>
        ${asking && !ask && ASK_ID.test(str(asking.id)) ? html`<a class="p-map__chip p-map__chip--live" href=${mapHref({ dept, view, ask: asking.id })}>
          ${waitingLine(asking.queue) ? html`<${Icon} name="clock" size=${14} />` : html`<span class="p-map__live" aria-hidden="true"></span>`}<span>${askingChip(asking)}</span></a>` : null}
      </div>
      <div class="p-map__box" data-box><${Composer} mode="ask" onSend=${send} hint=${askHint(data && data.brain)} /></div>
    </div>
  </div>`;
}
