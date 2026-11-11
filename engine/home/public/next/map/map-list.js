// The map's list twin (CONTRACTS-V3 29.6): the same data as the drawing, as plain HTML. Used for `?view=list`,
// for one department below 860 px, and for the rows of departments under the crown. Everything the drawing can
// do is here: open the brain, zoom to a department, open a job, see the work, open Needs you.
import { html } from "../vendor/preact-htm.js";
import { Creature, Icon, JobRow } from "../kit/index.js";
import { brainLine, CountLine, departmentsOf } from "./map-view.js";

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (v, n) => str(v).slice(0, n);
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const JOB_ID = /^[a-z][a-z0-9-]{0,40}\/[a-z][a-z0-9-]{0,60}$/;

const clustersOf = (d) => arr(d && d.clusters).filter((c) => c && SLUG.test(str(c.id))).slice(0, 5);
const jobsOf = (c) => arr(c && c.jobs).filter((j) => j && JOB_ID.test(str(j.id))).slice(0, 16);

// Every job id in the order the list shows them: department by department, cluster by cluster, as the files
// order them. The drawing places its dots in the same order.
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

// One department (`level` 1 is the page's own department, below 860 px): its creature, name, three words, count line, links, then its clusters and jobs.
export function DepartmentSection({ dept, onNeeds, level = 2, links = true }) {
  const id = str(dept && dept.id);
  if (!SLUG.test(id)) return null;
  const clusters = clustersOf(dept);
  return html`<section class="p-map__dept" data-dept=${id} aria-labelledby=${`p-map-dept-${id}`}>
    <div class="p-map__dept-head">
      <${Creature} id=${id} size=${level === 1 ? 48 : 32} />
      <div class="p-map__dept-names">
        <h2 class=${level === 1 ? "p-map__dept-title p-map__dept-title--big" : "p-map__dept-title"} id=${`p-map-dept-${id}`}>${clip(dept.title, 40)}</h2>
        ${dept.line ? html`<p class="p-map__dept-line">${clip(dept.line, 80)}</p>` : null}
        <${CountLine} dept=${dept} onNeeds=${onNeeds} />
      </div>
    </div>
    ${links ? html`<p class="p-map__dept-links">
      <a href=${`#/departments/${id}`}>Open</a>
      <a href=${`#/jobs?d=${id}`}>See its jobs</a>
    </p>` : null}
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
  </section>`;
}

// The whole list twin: the brain, then every department with its jobs.
export function MapList({ data, onNeeds }) {
  const brain = data && data.brain;
  return html`<div class="p-map__list">
    <section class="p-map__brain-row u-glass" aria-labelledby="p-map-brain">
      <${Creature} id="brain" size=${48} />
      <div class="p-map__dept-names">
        <h2 class="p-map__dept-title" id="p-map-brain">Company brain</h2>
        <p class="p-map__dept-line">${brainLine(brain)}</p>
      </div>
      <a class="p-map__row-go" href="#/files">Open Files <${Icon} name="chevron-right" size=${14} /></a>
    </section>
    ${departmentsOf(data).map((d) => html`<div key=${d.id} class="p-map__card u-glass"><${DepartmentSection} dept=${d} onNeeds=${onNeeds} /></div>`)}
  </div>`;
}

// Under the crown, below 860 px: the brain and each department as one glass row.
export function DepartmentRows({ data, onNeeds }) {
  const brain = data && data.brain;
  return html`<ul class="p-map__rows">
    <li class="p-map__row u-glass">
      <a class="p-map__row-main" href="#/files">
        <${Creature} id="brain" size=${32} />
        <span class="p-map__row-names">
          <span class="p-map__row-title">Company brain</span>
          <span class="p-map__dept-line">${brainLine(brain)}</span>
        </span>
        <${Icon} name="chevron-right" size=${16} />
      </a>
    </li>
    ${departmentsOf(data).map((d) => html`<li key=${d.id} class="p-map__row u-glass" data-dept=${d.id}>
      <a class="p-map__row-main" href=${`#/map/${d.id}`}>
        <${Creature} id=${d.id} size=${32} />
        <span class="p-map__row-names">
          <span class="p-map__row-title">${clip(d.title, 40)}</span>
          ${d.line ? html`<span class="p-map__dept-line">${clip(d.line, 80)}</span>` : null}
        </span>
        <${Icon} name="chevron-right" size=${16} />
      </a>
      ${d.counts ? html`<div class="p-map__row-count"><${CountLine} dept=${d} onNeeds=${onNeeds} /></div>` : null}
    </li>`)}
  </ul>`;
}
