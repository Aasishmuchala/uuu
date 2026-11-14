// The map's list twin (CONTRACTS-V3 29.6; PLAN-COOK T63): the same data as the drawing, in the list pattern of
// Tasks and Jobs. Used for `?view=list` (the company brain as one row, then a group per department whose heading
// folds its jobs), for one department on a phone, and for the rows of departments the phone shows instead of the
// drawing (and the stage, when its box is too small for the cards). Everything the drawing can do is here: open the
// brain, choose a department, open a job, see the work, open Needs you.
import { html, useState } from "../vendor/preact-htm.js";
import { Icon, JobRow, StatusDot } from "../kit/index.js";
import { brainLine, CountLine, countParts, departmentsOf, iconOf, nodeLine, nodeTone } from "./map-view.js";

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (v, n) => str(v).slice(0, n);
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const JOB_ID = /^[a-z][a-z0-9-]{0,40}\/[a-z][a-z0-9-]{0,60}$/;

const clustersOf = (d) => arr(d && d.clusters).filter((c) => c && SLUG.test(str(c.id))).slice(0, 5);
const jobsOf = (c) => arr(c && c.jobs).filter((j) => j && JOB_ID.test(str(j.id))).slice(0, 16);

// Every job id in the order the list shows them: department by department, cluster by cluster, as the files
// order them.
export function listOrder(data) {
  const out = [];
  for (const d of departmentsOf(data)) {
    let room = 16;
    for (const c of clustersOf(d)) {
      const jobs = jobsOf(c).slice(0, room);
      room -= jobs.length;
      for (const j of jobs) out.push(j.id);
    }
  }
  return out;
}

// A job of the map's answer as the kit's JobRow wants it (shape `job` in part).
const asJob = (j, dept) => ({ ...j, department: { id: dept.id, title: str(dept.title) } });

// One department's work: its count line and links, then its clusters, each a quiet heading over its jobs as rows.
export function DepartmentSection({ dept, onNeeds, links = true }) {
  const id = str(dept && dept.id);
  if (!SLUG.test(id)) return null;
  const clusters = clustersOf(dept);
  return html`<div class="p-map__dept" data-dept=${id}>
    <div class="p-map__dept-sum">
      <${CountLine} dept=${dept} onNeeds=${onNeeds} />
      ${links ? html`<p class="p-map__dept-links">
        <a class="p-map__link" href=${`#/departments/${id}`}>Open ${clip(dept.title, 40)}</a>
        <a class="p-map__link" href=${`#/jobs?d=${id}`}>See its jobs</a>
      </p>` : null}
    </div>
    ${clusters.map((c) => {
      const jobs = jobsOf(c);
      return html`<div key=${c.id} class="p-map__cluster-list">
        <h3 class="p-map__cluster-title">${clip(c.title, 40)} · ${jobs.length === 1 ? "1 job" : `${jobs.length} jobs`}</h3>
        ${jobs.length
          ? html`<ul class="p-map__jobs">${jobs.map((j) => html`<li key=${j.id}><${JobRow} job=${asJob(j, dept)} /></li>`)}</ul>`
          : html`<p class="p-map__none">No jobs here yet.</p>`}
      </div>`;
    })}
    ${clusters.length ? null : html`<p class="p-map__none">No jobs yet.</p>`}
  </div>`;
}

// One department as a group of the list: a heading that folds its work, on the raised step, with its jobs' count.
function DepartmentGroup({ dept, open, onFold, onNeeds }) {
  const id = dept.id;
  const head = `p-map-group-${id}`;
  const body = `p-map-group-body-${id}`;
  return html`<section class=${open ? "p-map__group" : "p-map__group p-map__group--folded"} data-dept=${id} aria-labelledby=${head}>
    <h2 class="p-map__group-head" id=${head}>
      <button type="button" class="p-map__fold" aria-expanded=${open ? "true" : "false"} aria-controls=${body} onClick=${onFold}>
        <${Icon} name=${iconOf(id)} size=${18} />
        <span class="p-map__group-label">${clip(dept.title, 40)}</span>
        <span class="p-map__group-count">${countParts(dept.counts)[0].text}</span>
        <${Icon} name="chevron-down" size=${16} class="p-map__fold-mark" />
      </button>
    </h2>
    <div id=${body} class="p-map__group-body" hidden=${!open}><${DepartmentSection} dept=${dept} onNeeds=${onNeeds} /></div>
  </section>`;
}

// The company brain as one row in the kit's rows panel: its icon, its name and line, and the way into Files.
function BrainRow({ brain }) {
  return html`<div class="k-rows p-map__rows">
    <a class="k-rows__row p-map__row" href="#/files">
      <span class="k-rows__icon" aria-hidden="true"><${Icon} name="brain" size=${18} /></span>
      <span class="k-rows__text">
        <span class="k-rows__title"><span>Company brain</span></span>
        <span class="k-say">${brainLine(brain)}</span>
      </span>
      <span class="p-map__row-go">Open Files <${Icon} name="chevron-right" size=${16} /></span>
    </a>
  </div>`;
}

// The whole list twin: the brain, then every department as a group with its jobs.
export function MapList({ data, onNeeds }) {
  const [folded, setFolded] = useState(() => new Set());
  const fold = (id) => setFolded((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return html`<div class="p-map__list">
    <${BrainRow} brain=${data && data.brain} />
    ${departmentsOf(data).map((d) => html`<${DepartmentGroup} key=${d.id} dept=${d} open=${!folded.has(d.id)} onFold=${() => fold(d.id)} onNeeds=${onNeeds} />`)}
  </div>`;
}

// The brain and each department as one row of the kit's rows panel: its line icon, its name, its dot and words.
// A department's row chooses it (#/map/<department>); `chosen` marks the one chosen.
export function DepartmentRows({ data, chosen = null }) {
  const brain = data && data.brain;
  return html`<ul class="k-rows p-map__rows" role="list">
    <li>
      <a class="k-rows__row p-map__row" href="#/files">
        <span class="k-rows__icon" aria-hidden="true"><${Icon} name="brain" size=${18} /></span>
        <span class="k-rows__text">
          <span class="k-rows__title"><span>Company brain</span></span>
          <span class="k-say">${brainLine(brain)}</span>
        </span>
        <${Icon} name="chevron-right" size=${16} class="p-map__row-mark" />
      </a>
    </li>
    ${departmentsOf(data).map((d) => html`<li key=${d.id} data-dept=${d.id}>
      <a class="k-rows__row p-map__row" href=${`#/map/${d.id}`} aria-current=${d.id === chosen ? "true" : undefined}>
        <span class="k-rows__icon" aria-hidden="true"><${Icon} name=${iconOf(d.id)} size=${18} /></span>
        <span class="k-rows__text">
          <span class="k-rows__title"><span>${clip(d.title, 40)}</span>${d.counts ? html`<span class="k-rows__state">${countParts(d.counts)[0].text}</span>` : null}</span>
          ${d.counts ? html`<span class="p-map__row-state"><${StatusDot} tone=${nodeTone(d.counts)} pulse=${false} label=${nodeLine(d.counts)} /></span>` : null}
        </span>
        <${Icon} name="chevron-right" size=${16} class="p-map__row-mark" />
      </a>
    </li>`)}
  </ul>`;
}
