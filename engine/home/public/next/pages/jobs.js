// Jobs (CONTRACTS-V3 30, "Jobs"), at #/jobs: every job the agents can start, by department and cluster, with
// filters that live in the address (?d= &handoff= &stage= &show=ready &q=). ?view=order is the build order:
// four bands, one per stage, each with its ring and its rows; stage 1 is the nine basics of the company brain.
// A job's words come from the company's own job files; everything is shown as text, and capped.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { fileToken } from "../lib/format.js";
import {
  Creature, Empty, ErrorNotice, Field, HANDOFFS, HandoffTag, Icon, JobRow, Loading, PageHeader, Ring, Segmented,
  STAGES, StageMark, Switch, TextInput,
} from "../kit/index.js";

const LEAD = "Named pieces of work an agent can start for you. Starting a job makes a task.";
const ORDER_LINE = "Later stages work best once the stage before is in place.";
const DEPT_ID = /^[a-z][a-z0-9-]{1,30}$/;
const FORM_ID = /^[a-z][a-z0-9-]{0,40}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,400}$/;
const WORDS_MAX = 100;
const CREATURE_DEPTS = ["operations", "sales", "marketing", "studio", "support", "people", "books"];

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const cap = (v, n) => str(v).slice(0, n);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The filters an address carries, each checked; anything odd is left out.
// → { d, handoff, stage, ready, q, view }
export function readFilters(query) {
  const q = query && typeof query.get === "function" ? query : new URLSearchParams(typeof query === "string" ? query : "");
  const d = str(q.get("d"));
  const handoff = str(q.get("handoff"));
  const stage = Number(q.get("stage"));
  return {
    d: DEPT_ID.test(d) ? d : "",
    handoff: Object.hasOwn(HANDOFFS, handoff) ? handoff : "",
    stage: Number.isInteger(stage) && Object.hasOwn(STAGES, String(stage)) ? stage : 0,
    ready: q.get("show") === "ready",
    q: str(q.get("q")).replace(/\s+/g, " ").trimStart().slice(0, WORDS_MAX),
    view: q.get("view") === "order" ? "order" : "list",
  };
}

// The address of a set of filters. The build order carries no filters.
export function address(filters = {}) {
  const f = filters || {};
  if (f.view === "order") return "#/jobs?view=order";
  const p = new URLSearchParams();
  if (f.d && DEPT_ID.test(f.d)) p.set("d", f.d);
  if (f.handoff && Object.hasOwn(HANDOFFS, f.handoff)) p.set("handoff", f.handoff);
  if (f.stage && Object.hasOwn(STAGES, String(f.stage))) p.set("stage", String(f.stage));
  if (f.ready) p.set("show", "ready");
  const words = str(f.q).trim().slice(0, WORDS_MAX);
  if (words) p.set("q", words);
  const qs = p.toString().replace(/\+/g, "%20");
  return qs ? `#/jobs?${qs}` : "#/jobs";
}

// True when any filter narrows the list.
export const filtering = (f) => Boolean(f && (f.d || f.handoff || f.stage || f.ready || str(f.q).trim()));

const deptIdOf = (job) => {
  const d = job && job.department;
  const id = typeof d === "string" ? d : str(d && d.id);
  return id || str(job && job.id).split("/")[0];
};

// The search words, in lower case: every one must be in the job's title or summary.
export function wordsOf(q) {
  return str(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 12);
}

export function matches(job, filters = {}) {
  if (!job || typeof job !== "object") return false;
  const f = filters || {};
  if (f.d && deptIdOf(job) !== f.d) return false;
  if (f.handoff && job.handoff !== f.handoff) return false;
  if (f.stage && Number(job.stage) !== Number(f.stage)) return false;
  if (f.ready && job.ready !== true) return false;
  const words = wordsOf(f.q);
  if (words.length) {
    const hay = `${cap(job.title, 200)} ${cap(job.summary, 400)}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

// The catalogue as the server sends it (departments → clusters → jobs), well formed.
export function departmentsOf(data) {
  return arr(data && data.departments)
    .filter((d) => d && DEPT_ID.test(str(d.id)))
    .map((d) => ({
      id: d.id,
      title: cap(d.title, 60) || d.id,
      clusters: arr(d.clusters)
        .filter((c) => c && typeof c === "object")
        .map((c) => ({ id: str(c.id), title: cap(c.title, 60), jobs: arr(c.jobs).filter((j) => j && typeof j === "object" && typeof j.id === "string") })),
    }));
}

// Every job, in catalogue order.
export function allJobs(departments) {
  const out = [];
  for (const d of arr(departments)) for (const c of arr(d && d.clusters)) for (const j of arr(c && c.jobs)) out.push(j);
  return out;
}

// The departments and clusters that still hold a job once the filters are applied. Pure.
export function filterJobs(departments, filters = {}) {
  const out = [];
  for (const d of arr(departments)) {
    if (!d) continue;
    if (filters && filters.d && d.id !== filters.d) continue;
    const clusters = arr(d.clusters)
      .map((c) => ({ ...c, jobs: arr(c && c.jobs).filter((j) => matches(j, filters)) }))
      .filter((c) => c.jobs.length);
    if (clusters.length) out.push({ ...d, clusters });
  }
  return out;
}

// { jobs, ready } over a list of departments.
export function tally(departments) {
  const jobs = allJobs(departments);
  return { jobs: jobs.length, ready: jobs.filter((j) => j.ready === true).length };
}

// One quiet line when job files could not be read (the details are on Health), else null.
export function problemLine(problems) {
  const n = arr(problems).length;
  if (!n) return null;
  return n === 1 ? "1 job file could not be read." : `${n} job files could not be read.`;
}

// Where a basic leads: its file when it is filled, else its form.
export function formHref(form) {
  const id = str(form);
  return FORM_ID.test(id) ? `#/files?new=form:${id}` : null;
}

function fileHref(item) {
  const token = TOKEN.test(str(item && item.token)) ? item.token : str(item && item.file) ? fileToken(item.file) : "";
  return token ? `#/files?file=${token}` : null;
}

// The nine basics as rows of stage 1. `brain` is the answer of /api/brain, or null while it is not there.
export function basicsRows(brain) {
  return arr(brain && brain.basics && brain.basics.items)
    .filter((b) => b && FORM_ID.test(str(b.form)))
    .slice(0, 20)
    .map((b) => {
      const filled = b.state === "filled";
      return { form: b.form, title: cap(b.title, 80) || b.form, filled, href: filled ? fileHref(b) : formHref(b.form) };
    });
}

// The jobs of one stage, grouped by department in catalogue order: [{ id, title, jobs }].
export function stageGroups(departments, n) {
  const out = [];
  for (const d of arr(departments)) {
    const jobs = allJobs([d]).filter((j) => Number(j.stage) === n);
    if (jobs.length) out.push({ id: d.id, title: d.title, jobs });
  }
  return out;
}

// The four bands of the build order. Stage 1's ring counts the basics filled of nine (from /api/brain);
// the others count the jobs tried (at least one accepted task) of the jobs in the stage.
export function buildOrder(data, brain) {
  const departments = departmentsOf(data);
  const stages = arr(data && data.stages);
  return [1, 2, 3, 4].map((n) => {
    const words = STAGES[n];
    const groups = stageGroups(departments, n);
    const jobs = groups.reduce((t, g) => t + g.jobs.length, 0);
    if (n === 1) {
      const basics = (brain && brain.basics) || {};
      const filled = Number.isFinite(Number(basics && basics.filled)) ? Math.max(0, Math.round(Number(basics.filled))) : null;
      const total = Number.isFinite(Number(basics && basics.total)) && Number(basics.total) > 0 ? Math.round(Number(basics.total)) : 9;
      return {
        n, label: words.label, about: words.about, groups,
        basics: brain ? basicsRows(brain) : null,
        ring: brain && filled !== null ? { value: filled, total, words: `${filled} of ${total} basics filled` } : null,
      };
    }
    const s = stages.find((x) => x && Number(x.n) === n);
    const count = s && Number.isFinite(Number(s.jobs)) ? Number(s.jobs) : jobs;
    const tried = s && Number.isFinite(Number(s.tried))
      ? Number(s.tried)
      : groups.reduce((t, g) => t + g.jobs.filter((j) => Number(j.runs && j.runs.accepted) > 0).length, 0);
    return { n, label: words.label, about: words.about, groups, basics: null, ring: { value: tried, total: count, words: `${tried} of ${plural(count, "job")} tried` } };
  });
}

// --- The page --------------------------------------------------------------------------------------------

function ChipRow({ label, items }) {
  return html`<div class="p-jobs__chips" role="group" aria-label=${label}>
    <span class="p-jobs__chips-label" aria-hidden="true">${label}</span>
    <div class="p-jobs__chips-row">
      ${items.map((it) => html`<a key=${it.id} class=${`p-jobs__chip${it.on ? " p-jobs__chip--on" : ""}`} href=${it.href}
          aria-current=${it.on ? "true" : undefined} data-dept=${it.dept || undefined}>
          ${it.dept ? html`<span class="p-jobs__chip-dot" aria-hidden="true"></span>` : null}
          ${it.mark || null}<span>${it.label}</span>
        </a>`)}
    </div>
  </div>`;
}

function Filters({ f, departments, words, onWords }) {
  const go = (change) => address({ ...f, q: words, ...change });
  const depts = [{ id: "all", label: "All", href: go({ d: "" }), on: !f.d },
    ...departments.map((d) => ({ id: d.id, label: d.title, dept: d.id, href: go({ d: d.id }), on: f.d === d.id }))];
  const handoffs = [{ id: "all", label: "Any", href: go({ handoff: "" }), on: !f.handoff },
    ...Object.keys(HANDOFFS).map((id) => ({ id, label: HANDOFFS[id].label, href: go({ handoff: id }), on: f.handoff === id }))];
  const stages = [{ id: "all", label: "Any", href: go({ stage: 0 }), on: !f.stage },
    ...[1, 2, 3, 4].map((n) => ({ id: String(n), label: STAGES[n].label, mark: html`<span class="p-jobs__chip-n" aria-hidden="true">${n}</span>`, href: go({ stage: n }), on: f.stage === n }))];
  return html`<div class="p-jobs__filters">
    <div class="p-jobs__search">
      <${Field} label="Search the jobs">
        <${TextInput} type="search" value=${words} maxlength=${WORDS_MAX} placeholder="Words from a job's name or what it does"
          onInput=${(e) => onWords(String(e.target.value))} />
      <//>
      <${Switch} on=${f.ready} label="Ready only" onChange=${(on) => { location.hash = go({ ready: on }); }} />
    </div>
    <${ChipRow} label="Department" items=${depts} />
    <${ChipRow} label="Hand-off" items=${handoffs} />
    <${ChipRow} label="Stage" items=${stages} />
  </div>`;
}

function Department({ d }) {
  const t = tally([d]);
  const pet = CREATURE_DEPTS.includes(d.id) ? html`<${Creature} id=${d.id} size=${32} />` : html`<span class="p-jobs__dept-dot" aria-hidden="true"></span>`;
  return html`<section class="p-jobs__dept u-glass" data-dept=${d.id} aria-label=${d.title}>
    <header class="p-jobs__dept-head">
      <span class="p-jobs__dept-pet">${pet}</span>
      <h2 class="p-jobs__dept-name u-serif">${d.title}</h2>
      <span class="p-jobs__dept-count">${plural(t.jobs, "job")}${t.ready !== t.jobs ? ` · ${t.ready} ready` : ""}</span>
      <a class="p-jobs__dept-open" href=${`#/departments/${d.id}`}>Open ${d.title}</a>
    </header>
    ${d.clusters.map((c) => html`<div key=${c.id} class="p-jobs__cluster">
      <h3 class="p-jobs__cluster-name u-over">${c.title} · ${plural(c.jobs.length, "job")}</h3>
      <div class="p-jobs__rows">${c.jobs.map((j) => html`<${JobRow} key=${j.id} job=${j} />`)}</div>
    </div>`)}
  </section>`;
}

function Legend({ open }) {
  return html`<details class="p-jobs__legend u-glass" open=${open}>
    <summary class="p-jobs__legend-head">What the tags and stages mean</summary>
    <div class="p-jobs__legend-body">
      <div>
        <p class="u-over">How much is left for you</p>
        <dl class="p-jobs__legend-list">
          ${Object.keys(HANDOFFS).map((id) => html`<div key=${id} class="p-jobs__legend-item">
            <dt><${HandoffTag} id=${id} /></dt><dd>${HANDOFFS[id].about}</dd>
          </div>`)}
        </dl>
      </div>
      <div>
        <p class="u-over">The build order</p>
        <dl class="p-jobs__legend-list">
          ${[1, 2, 3, 4].map((n) => html`<div key=${n} class="p-jobs__legend-item">
            <dt><${StageMark} n=${n} /></dt><dd>${STAGES[n].about}</dd>
          </div>`)}
        </dl>
      </div>
    </div>
  </details>`;
}

function ListView({ data, f, words, onWords }) {
  const departments = departmentsOf(data);
  const total = tally(departments);
  const known = f.d && !departments.some((d) => d.id === f.d) ? { ...f, d: "" } : f;
  const shown = filterJobs(departments, { ...known, q: words });
  const now = tally(shown);
  const narrowed = filtering({ ...known, q: words });
  return html`
    <${Filters} f=${known} departments=${departments} words=${words} onWords=${onWords} />
    <p class="p-jobs__count" aria-live="polite">
      ${narrowed ? `Showing ${now.jobs} of ${plural(total.jobs, "job")}` : `${plural(total.jobs, "job")} · ${total.ready} ready to start`}
    </p>
    ${total.jobs === 0
      ? html`<${Empty} title="There are no jobs yet." text="Jobs appear here once the company's job files are in place." />`
      : shown.length === 0
        ? html`<${Empty} title="No job matches." text="Try fewer words or another filter."><a href="#/jobs">Show every job</a><//>`
        : html`<div class="p-jobs__depts">${shown.map((d) => html`<${Department} key=${d.id} d=${d} />`)}</div>`}
    <${Legend} open=${false} />`;
}

function Band({ band, brainState }) {
  const groups = band.groups;
  return html`<li class="p-jobs__band u-glass" aria-labelledby=${`p-jobs-stage-${band.n}`}>
    <div class="p-jobs__band-head">
      ${band.ring
        ? html`<${Ring} value=${band.ring.value} total=${band.ring.total} size=${48} label=${band.ring.words} />`
        : html`<span class="p-jobs__band-ring-wait" aria-hidden="true"></span>`}
      <div class="p-jobs__band-titles">
        <p class="u-over">Stage ${band.n}</p>
        <h2 class="p-jobs__band-name" id=${`p-jobs-stage-${band.n}`}>${band.label}</h2>
        <p class="p-jobs__band-about">${band.about}</p>
      </div>
      ${band.ring ? html`<p class="p-jobs__band-count" aria-hidden="true">${band.ring.words}</p>` : null}
    </div>
    ${band.n === 1
      ? band.basics
        ? band.basics.length
          ? html`<ul class="p-jobs__forms">${band.basics.map((b) => html`<li key=${b.form} class=${`p-jobs__form${b.filled ? " p-jobs__form--filled" : ""}`}>
              <${Icon} name=${b.filled ? "check" : "form"} size=${16} class="p-jobs__form-icon" />
              ${b.filled && b.href ? html`<a class="p-jobs__form-name" href=${b.href}>${b.title}</a>` : html`<span class="p-jobs__form-name">${b.title}</span>`}
              ${b.filled
                ? html`<span class="p-jobs__form-state">Filled</span>`
                : b.href ? html`<a class="p-jobs__form-fill" href=${b.href}>Fill it in<span class="k-sr">: ${b.title}</span></a>` : null}
            </li>`)}</ul>`
          : html`<p class="p-jobs__band-empty">The company brain lists no basics yet.</p>`
        : brainState.error
          ? html`<${ErrorNotice} error=${brainState.error} onRetry=${brainState.reload} />`
          : html`<${Loading} lines=${3} label="Loading the company brain" />`
      : null}
    ${groups.length
      ? html`<div class="p-jobs__band-jobs">
          ${band.n === 1 ? html`<p class="p-jobs__band-sub u-over">Jobs at this stage</p>` : null}
          ${groups.map((g) => html`<div key=${g.id} class="p-jobs__band-group" data-dept=${g.id}>
            <p class="p-jobs__band-dept"><span class="p-jobs__chip-dot" aria-hidden="true"></span>${g.title}</p>
            <div class="p-jobs__rows">${g.jobs.map((j) => html`<${JobRow} key=${j.id} job=${j} />`)}</div>
          </div>`)}
        </div>`
      : band.n === 1 ? null : html`<p class="p-jobs__band-empty">No jobs at this stage yet.</p>`}
  </li>`;
}

function OrderView({ data, brain }) {
  const bands = buildOrder(data, brain.data);
  return html`
    <p class="p-jobs__order-line">${ORDER_LINE}</p>
    <ol class="p-jobs__bands">${bands.map((b) => html`<${Band} key=${b.n} band=${b} brainState=${brain} />`)}</ol>
    <${Legend} open=${true} />`;
}

export default function JobsPage({ route }) {
  const query = (route && route.query) || new URLSearchParams();
  const f = readFilters(query);
  const res = useResource("/api/jobs", { every: 10000 });
  const brain = useResource(f.view === "order" ? "/api/brain" : null, { every: 10000 });
  const data = res.data;

  // The search words are typed here and written into the address as they change, without a new history
  // entry; the address wins when it changes from outside (a chip, Back).
  const [words, setWords] = useState(f.q);
  useEffect(() => { setWords(f.q); }, [f.q]);
  const onWords = (v) => {
    const w = v.slice(0, WORDS_MAX);
    setWords(w);
    if (typeof history !== "undefined" && typeof location !== "undefined") {
      history.replaceState(history.state, "", `${location.pathname}${location.search}${address({ ...f, q: w })}`);
    }
  };

  const views = [
    { id: "list", label: "List", icon: "list", href: address({ ...f, view: "list", q: words }) },
    { id: "order", label: "Build order", icon: "stage", href: address({ view: "order" }) },
  ];
  const problems = problemLine(data && data.problems);

  return html`<div class=${`p-jobs p-jobs--${f.view}`}>
    <${PageHeader} title=${f.view === "order" ? "The build order" : "Jobs"} over="Jobs"
      lead=${f.view === "order" ? "Four stages, from filling the company brain to work handed from one agent to the next." : LEAD}
      actions=${html`<${Segmented} items=${views} current=${f.view} label="Show the jobs as" size="sm" />`} />
    ${res.loading && !data ? html`<${Loading} lines=${6} label="Loading the jobs" />` : null}
    ${res.error && !data ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
    ${data
      ? f.view === "order"
        ? html`<${OrderView} data=${data} brain=${brain} />`
        : html`<${ListView} data=${data} f=${f} words=${words} onWords=${onWords} />`
      : null}
    ${problems ? html`<p class="p-jobs__problems">${problems} <a href="#/health">See Health</a></p>` : null}
  </div>`;
}
