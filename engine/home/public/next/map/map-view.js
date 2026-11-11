// The map's drawing (CONTRACTS-V3 29.1, 29.3, 29.5): the overview (the company brain in the middle, the seven
// hubs around it, a dot per job), one department zoomed, and the small crown shown below 860 px.
// One <svg> per view, laid out by map/layout.js. Hubs, dots, jobs and the brain are real links with a name for
// screen readers; lines and decoration are hidden from them. Names and count lines are HTML placed over the
// drawing by percentage, so they stay sharp; they repeat their hub's link for the mouse only.
// Nothing here moves by script: hover labels, pulses and the zoom are CSS (styles/pages/map.css).
// Every word a job or a department shows comes from the company's own files, through the home server; it is
// shown as text and cut to a fixed length.
import { html } from "../vendor/preact-htm.js";
import { Creature, HANDOFFS, Icon } from "../kit/index.js";
import { DEPARTMENTS } from "../routes.js";
import { layoutDepartment, layoutOverview, neighbours } from "./layout.js";

const W = 1200;
const H = 760;
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const JOB_ID = /^[a-z][a-z0-9-]{0,40}\/[a-z][a-z0-9-]{0,60}$/;

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const clip = (v, n) => str(v).slice(0, n);
const pct = (v, of) => `${((Number(v) / of) * 100).toFixed(3)}%`;
const idOf = (d) => (d && SLUG.test(str(d.id)) ? d.id : "");

// ---- Words (pure, tested) ----

// The count line under a hub: [{ kind: "jobs" | "working" | "needs", text }].
export function countParts(counts) {
  const c = counts && typeof counts === "object" ? counts : {};
  const jobs = num(c.jobs);
  const out = [{ kind: "jobs", text: jobs === 0 ? "No jobs yet" : jobs === 1 ? "1 job" : `${jobs} jobs` }];
  const working = num(c.working);
  const needs = num(c.needsYou);
  if (working) out.push({ kind: "working", text: `${working} working` });
  if (needs) out.push({ kind: "needs", text: needs === 1 ? "1 needs you" : `${needs} need you` });
  return out;
}

// The same line as one string: "9 jobs · 1 working · 2 need you".
export const countLine = (counts) => countParts(counts).map((p) => p.text).join(" · ");

// What a screen reader hears for a hub: "Sales, 9 jobs, 1 working, 2 need you".
export function hubLabel(dept) {
  const title = clip(dept && dept.title, 60) || "A department";
  return [title, ...countParts(dept && dept.counts).map((p) => p.text.replace(/^No jobs yet$/, "no jobs yet"))].join(", ");
}

const handoffWord = (id) => (Object.hasOwn(HANDOFFS, str(id)) ? HANDOFFS[id].label : "");
const whyText = (job) => clip(typeof (job && job.why) === "string" ? job.why : job && job.why && job.why.text, 200);

// The marks a job's dot shows: "ready" or "blocked", then "working" and "needs-you" when they hold.
export function dotMarks(job) {
  const marks = [job && job.ready === false ? "blocked" : "ready"];
  if (num(job && job.working)) marks.push("working");
  if (num(job && job.needsYou)) marks.push("needs-you");
  return marks;
}

// What a screen reader hears for a job: "Call write-up, On its own, ready".
export function dotLabel(job) {
  const marks = dotMarks(job);
  const parts = [clip(job && job.title, 60) || "A job"];
  const tag = handoffWord(job && job.handoff);
  if (tag) parts.push(tag);
  parts.push(marks[0] === "ready" ? "ready" : "cannot start yet");
  if (marks.includes("working")) parts.push("being worked on");
  if (marks.includes("needs-you")) parts.push("needs you");
  return parts.join(", ");
}

// The line under the brain: "12 files · 4 of 9 basics filled", or "Reading your files" while a question is open.
export function brainLine(brain) {
  if (!brain || typeof brain !== "object") return "";
  if (brain.asking) return "Reading your files";
  const files = num(brain.files);
  const b = brain.basics || {};
  return `${files === 1 ? "1 file" : `${files} files`} · ${num(b.filled)} of ${num(b.total)} basics filled`;
}

// What a screen reader hears for the brain: "Company brain, 12 files, 4 of 9 basics filled".
export function brainLabel(brain) {
  if (!brain || typeof brain !== "object") return "Company brain";
  const files = num(brain.files);
  const b = brain.basics || {};
  const parts = ["Company brain", files === 1 ? "1 file" : `${files} files`, `${num(b.filled)} of ${num(b.total)} basics filled`];
  if (brain.asking) parts.push("reading your files");
  return parts.join(", ");
}

// The departments of a map answer, each well formed; the fallback names while nothing has come.
export function departmentsOf(data) {
  const list = arr(data && data.departments).filter((d) => idOf(d)).slice(0, 9);
  if (list.length) return list;
  return DEPARTMENTS.map((d) => ({ id: d.id, title: d.title, line: "", counts: null, clusters: [] }));
}

const jobsOfCluster = (c) => arr(c && c.jobs).filter((j) => j && JOB_ID.test(str(j.id))).slice(0, 16);
const clustersOf = (d) => arr(d && d.clusters).filter((c) => c && SLUG.test(str(c.id))).slice(0, 5);

// The overview's input for layoutOverview: departments, clusters and job ids, in file order, at most 16 jobs a hub.
export function overviewInput(data) {
  return {
    departments: departmentsOf(data).map((d) => {
      let room = 16;
      return {
        id: d.id,
        clusters: clustersOf(d).map((c) => {
          const jobs = jobsOfCluster(c).slice(0, room).map((j) => j.id);
          room -= jobs.length;
          return { id: c.id, jobs };
        }),
      };
    }),
  };
}

// A zoomed job's label holds its title and its hand-off pill; the layout keeps label boxes apart by their
// length, so each title is given room for the pill with spaces.
const TITLE_CHAR = 6.6; // a title's letter, drawn, in map units (a little wider than it is)
const PILL_CHAR = 6.2;
const PILL_PAD = 16;
const GAP = 10;
export const pillWidth = (label) => Math.round(PILL_CHAR * str(label).length + PILL_PAD);
export const padFor = (label) => (label ? str(label).length + 2 : 0);

// The input for layoutDepartment: each cluster's title and its jobs, the job titles padded for the pill.
export function departmentInput(dept) {
  return {
    clusters: clustersOf(dept).map((c) => ({
      id: c.id,
      title: clip(c.title, 40),
      jobs: jobsOfCluster(c).slice(0, 8).map((j) => ({ id: j.id, title: clip(j.title, 60) + " ".repeat(padFor(handoffWord(j.handoff))) })),
    })),
  };
}

// Splits a sentence into lines of at most `n` characters, at spaces.
export function wrapWords(text, n = 44) {
  const words = str(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > n) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

// The order Tab walks a zoomed department's jobs: column by column from the left, top to bottom in each.
export function readingOrder(jobs) {
  const cols = new Map();
  for (const j of arr(jobs)) {
    if (!cols.has(j.cluster)) cols.set(j.cluster, []);
    cols.get(j.cluster).push(j);
  }
  return [...cols.values()]
    .map((list) => list.slice().sort((a, b) => a.y - b.y || a.x - b.x))
    .sort((a, b) => Math.min(...a.map((j) => j.x)) - Math.min(...b.map((j) => j.x)))
    .flat();
}

// The lines of a zoomed department: the hub to each cluster, then each cluster's jobs as one stem, from the
// cluster's point to its nearest job and on from job to job, so no line crosses a title.
export function stems(lay) {
  const out = [];
  for (const c of arr(lay && lay.clusters)) {
    out.push({ from: { x: lay.hub.x, y: lay.hub.y }, to: { x: c.x, y: c.y } });
    const jobs = arr(lay.jobs).filter((j) => j.cluster === c.id);
    const cols = new Map();
    for (const j of jobs) {
      if (!cols.has(j.x)) cols.set(j.x, []);
      cols.get(j.x).push(j);
    }
    for (const col of cols.values()) {
      col.sort((a, b) => Math.abs(a.y - c.y) - Math.abs(b.y - c.y));
      let prev = { x: c.x, y: c.y };
      for (const j of col) {
        out.push({ from: prev, to: { x: j.x, y: j.y } });
        prev = { x: j.x, y: j.y };
      }
    }
  }
  return out;
}

// Where a hub's name sits from its label point: { x: 0 | -50 | -100, y: 0 | -50 | -100 } (percent of itself).
export function labelShift(hub) {
  const a = ((Number(hub && hub.angle) || 0) * Math.PI) / 180;
  const s = Math.sin(a);
  const anchor = hub && hub.label ? hub.label.anchor : "middle";
  return { x: anchor === "start" ? 0 : anchor === "end" ? -100 : -50, y: s < -0.5 ? -100 : s > 0.5 ? 0 : -50 };
}

// ---- Pieces ----

// The count line, with the working words a link to the tasks and the warm words opening Needs you.
export function CountLine({ dept, onNeeds, focusable = true }) {
  const id = idOf(dept);
  const tab = focusable ? undefined : "-1";
  return html`<p class="p-map__count">${countParts(dept && dept.counts).map((p, i) => html`${i ? html`<span class="p-map__count-sep" aria-hidden="true"> · </span>` : null}${
    p.kind === "working" && id
      ? html`<a class="p-map__count-live" href=${`#/tasks?d=${id}`} tabindex=${tab}>${p.text}</a>`
      : p.kind === "needs" && onNeeds
        ? html`<button type="button" class="p-map__count-warm" tabindex=${tab} onClick=${() => onNeeds(id)}>${p.text}</button>`
        : html`<span class=${`p-map__count-${p.kind}`}>${p.text}</span>`}`)}</p>`;
}

const FOCUS = (r) => html`<circle class="p-map__focus" r=${r} fill="none" />`;

// The brain's ring of dots: the share of the basics filled is drawn bright.
function BrainRing({ brain, x, y, asking }) {
  const n = 40;
  const b = (brain && brain.basics) || {};
  const lit = num(b.total) ? Math.round((n * Math.min(num(b.filled), num(b.total))) / num(b.total)) : 0;
  const dots = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    dots.push(html`<circle key=${i} class=${i < lit ? "p-map__ring-dot p-map__ring-dot--lit" : "p-map__ring-dot"}
      cx=${(x + 52 * Math.cos(a)).toFixed(1)} cy=${(y + 52 * Math.sin(a)).toFixed(1)} r="1.8" />`);
  }
  return html`<g class=${asking ? "p-map__ring p-map__ring--asking" : "p-map__ring"} aria-hidden="true">${dots}</g>`;
}

// A dot's hover label: the title and the hand-off tag, in a small glass box above the dot.
function Tip({ x, y, lines }) {
  const rows = lines.filter(Boolean);
  if (!rows.length) return null;
  const w = Math.min(420, Math.max(...rows.map((l) => l.length)) * 7 + 24);
  const h = rows.length * 18 + 12;
  const left = Math.max(8, Math.min(W - 8 - w, x - w / 2));
  const top = y - 16 - h < 8 ? y + 16 : y - 16 - h;
  return html`<g class="p-map__tip" aria-hidden="true">
    <rect class="p-map__tip-box" x=${left} y=${top} width=${w} height=${h} rx="8" />
    ${rows.map((l, i) => html`<text class=${i ? "p-map__tip-text p-map__tip-text--2" : "p-map__tip-text"} x=${left + 12} y=${top + 21 + i * 18}>${l}</text>`)}
  </g>`;
}

// ---- The overview ----

export function Overview({ data, loading = false, onNeeds, onHubKey }) {
  const depts = departmentsOf(data);
  const lay = layoutOverview(overviewInput(data));
  const byId = new Map(depts.map((d) => [d.id, d]));
  const jobById = new Map();
  for (const d of depts) for (const c of clustersOf(d)) for (const j of jobsOfCluster(c)) jobById.set(j.id, j);
  const brain = data && data.brain;
  const asking = !!(brain && brain.asking);
  const b = lay.brain;

  const onKeyDown = (e) => {
    const hub = e.target && e.target.closest ? e.target.closest("[data-hub]") : null;
    if (!hub || !onHubKey) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      onHubKey(hub.getAttribute("data-hub"), e.key);
    }
  };

  return html`<div class=${loading ? "p-map__view p-map__view--loading" : "p-map__view"}>
    <svg class="p-map__svg" viewBox=${lay.viewBox.join(" ")} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Company map"
      onKeyDown=${onKeyDown}>
      <g aria-hidden="true">
        <ellipse class="p-map__orbit" cx=${b.x} cy=${b.y} rx="300" ry="215" fill="none" />
        ${lay.hubs.map((h) => html`<line key=${`s-${h.id}`} class="p-map__spoke" data-dept=${h.id} x1=${b.x} y1=${b.y} x2=${h.x} y2=${h.y} />`)}
        ${lay.links.map((l, i) => html`<line key=${i} class="p-map__link" data-dept=${l.department} x1=${l.from.x} y1=${l.from.y} x2=${l.to.x} y2=${l.to.y} />`)}
      </g>
      <a class="p-map__brain" href="#/files" aria-label=${loading ? "Company brain" : brainLabel(brain)}>
        <circle class="p-map__brain-disc" cx=${b.x} cy=${b.y} r=${b.r} />
        <${BrainRing} brain=${brain} x=${b.x} y=${b.y} asking=${asking || loading} />
        <g transform=${`translate(${b.x} ${b.y})`}>${FOCUS(60)}</g>
      </a>
      ${lay.hubs.map((h) => {
        const d = byId.get(h.id);
        return html`<a key=${h.id} class="p-map__hub" data-hub=${h.id} data-dept=${h.id} href=${`#/map/${h.id}`} aria-label=${hubLabel(d)}>
          <g transform=${`translate(${h.x} ${h.y})`}>
            <circle class="p-map__hub-glow" r="34" />
            <circle class="p-map__hub-disc" r="24" />
            ${FOCUS(30)}
          </g>
        </a>`;
      })}
      ${lay.dots.map((dot) => {
        const job = jobById.get(dot.id) || {};
        const marks = dotMarks(job);
        const tag = handoffWord(job.handoff);
        return html`<a key=${dot.id} class=${`p-map__dot p-map__dot--${marks[0]}`} data-dept=${dot.department} href=${`#/jobs/${dot.id}`}
          tabindex="-1" aria-label=${dotLabel(job)}>
          <g transform=${`translate(${dot.x} ${dot.y})`}>
            <circle class="p-map__hit" r="9" />
            ${marks.includes("working") ? html`<circle class="p-map__pulse" r="8.5" fill="none" />` : null}
            <circle class="p-map__dot-core" r="4.5" />
            ${FOCUS(10)}
          </g>
          <${Tip} x=${dot.x} y=${dot.y} lines=${[clip(job.title, 60), [tag, marks[0] === "blocked" ? "Cannot start yet" : ""].filter(Boolean).join(" · ")]} />
        </a>`;
      })}
      ${lay.dots.filter((dot) => num((jobById.get(dot.id) || {}).needsYou)).map((dot) => html`<circle key=${`w-${dot.id}`}
        class="p-map__warm" cx=${dot.x + 7} cy=${dot.y - 7} r="3.5" aria-hidden="true"
        onClick=${onNeeds ? () => onNeeds(dot.department) : undefined} />`)}
    </svg>
    <div class="p-map__over" aria-hidden="true">
      <span class="p-map__pet p-map__pet--brain" style=${`left: ${pct(b.x, W)}; top: ${pct(b.y, H)};`}><${Creature} id="brain" size=${64} /></span>
      <a class="p-map__brain-label" href="#/files" tabindex="-1" style=${`left: ${pct(b.x, W)}; top: ${pct(b.y + 64, H)};`}>
        <span class="p-map__over-line">Company brain</span>
        <span class="p-map__brain-line">${loading ? " " : brainLine(brain)}</span>
      </a>
      ${lay.hubs.map((h) => {
        const d = byId.get(h.id) || {};
        const s = labelShift(h);
        return html`<span key=${`p-${h.id}`} class="p-map__pet" style=${`left: ${pct(h.x, W)}; top: ${pct(h.y, H)};`}><${Creature} id=${h.id} size=${32} /></span>
          <div key=${`l-${h.id}`} class=${`p-map__name p-map__name--${h.label.anchor}`} data-dept=${h.id}
            style=${`left: ${pct(h.label.x, W)}; top: ${pct(h.label.y, H)}; transform: translate(${s.x}%, ${s.y}%);`}>
            <a class="p-map__name-link" href=${`#/map/${h.id}`} tabindex="-1">
              <span class="p-map__name-title">${clip(d.title, 40)}</span>
              ${d.line ? html`<span class="p-map__name-line">${clip(d.line, 80)}</span>` : null}
            </a>
            ${loading ? null : html`<${CountLine} dept=${d} onNeeds=${onNeeds} focusable=${false} />`}
          </div>`;
      })}
    </div>
  </div>`;
}

// Where the overview should zoom from: the chosen hub's place, in percent of the drawing.
export function hubOrigin(data, id) {
  const h = layoutOverview(overviewInput(data)).hubs.find((x) => x.id === id);
  return h ? { x: pct(h.x, W), y: pct(h.y, H) } : { x: "50%", y: "50%" };
}

// ---- One department, zoomed ----

// `all` is every department ({ id, title }) in file order, for the arrows to the neighbours.
export function DepartmentView({ dept, all, onNeeds }) {
  const id = idOf(dept);
  if (!id) return null;
  const lay = layoutDepartment(departmentInput(dept));
  const jobById = new Map();
  for (const c of clustersOf(dept)) for (const j of jobsOfCluster(c)) jobById.set(j.id, j);
  const clusterById = new Map(clustersOf(dept).map((c) => [c.id, c]));
  const list = arr(all).filter((d) => idOf(d));
  const near = neighbours(list.map((d) => d.id), id);
  const titleOf = (x) => clip(list.find((d) => d.id === x)?.title, 40) || x;
  const hub = lay.hub;
  const title = clip(dept.title, 40);

  return html`<div class="p-map__view p-map__view--dept" data-dept=${id}>
    <p class="p-map__ghost" aria-hidden="true">${title}</p>
    <svg class="p-map__svg" viewBox=${lay.viewBox.join(" ")} preserveAspectRatio="xMidYMid meet" role="group" aria-label=${`${title} on the company map`}>
      <g aria-hidden="true">
        ${stems(lay).map((l, i) => html`<line key=${i} class="p-map__link p-map__link--dept" x1=${l.from.x} y1=${l.from.y} x2=${l.to.x} y2=${l.to.y} />`)}
        ${lay.clusters.map((c) => html`<circle key=${`a-${c.id}`} class="p-map__joint" cx=${c.x} cy=${c.y} r="3" />`)}
        ${lay.clusters.map((c) => {
          const n = jobsOfCluster(clusterById.get(c.id)).slice(0, 8).length;
          const words = `${clip(clusterById.get(c.id)?.title, 40)} · ${n === 1 ? "1 job" : `${n} jobs`}`.toUpperCase();
          return html`<text key=${`t-${c.id}`} class="p-map__cluster" x=${c.label.x} y=${c.label.y + 4}
            text-anchor=${c.label.anchor === "end" ? "end" : c.label.anchor === "middle" ? "middle" : "start"}>${words}</text>`;
        })}
      </g>
      ${readingOrder(lay.jobs).map((j) => {
        const job = jobById.get(j.id) || {};
        const marks = dotMarks(job);
        const tag = handoffWord(job.handoff);
        const name = clip(job.title, 60);
        const why = whyText(job);
        const end = j.label.anchor === "end";
        const textW = TITLE_CHAR * name.length;
        const pw = tag ? pillWidth(tag) : 0;
        const pillX = end ? j.label.x - textW - GAP - pw : j.label.x + textW + GAP;
        return html`<a key=${j.id} class=${`p-map__job p-map__job--${marks[0]}`} href=${`#/jobs/${j.id}`}
          aria-label=${why ? `${dotLabel(job)}. ${why}` : dotLabel(job)}>
          <g transform=${`translate(${j.x} ${j.y})`}>
            ${marks.includes("working") ? html`<circle class="p-map__pulse" r="19" fill="none" />` : null}
            <circle class="p-map__job-disc" r="14" />
            <g class="p-map__job-icon" transform="translate(-7 -7)"><${Icon} name=${marks[0] === "ready" ? "spark" : "lock"} size=${14} /></g>
            ${marks.includes("needs-you") ? html`<circle class="p-map__warm" cx="11" cy="-11" r="4" />` : null}
            ${FOCUS(19)}
          </g>
          <text class="p-map__job-title" x=${j.label.x} y=${j.label.y + 4.5} text-anchor=${end ? "end" : "start"}>${name}</text>
          ${tag ? html`<g class="p-map__pill">
              <rect class="p-map__pill-box" x=${pillX} y=${j.label.y - 9} width=${pw} height="18" rx="9" />
              <text class="p-map__pill-text" x=${pillX + pw / 2} y=${j.label.y + 3.5} text-anchor="middle">${tag}</text>
            </g>` : null}
          ${why ? html`<${Tip} x=${j.x} y=${j.y - 8} lines=${wrapWords(why, 44)} />` : null}
        </a>`;
      })}
      <a class="p-map__hub p-map__hub--big" data-dept=${id} href=${`#/departments/${id}`} aria-label=${`Open ${title}`}>
        <g transform=${`translate(${hub.x} ${hub.y})`}>
          <circle class="p-map__hub-glow" r="44" />
          <circle class="p-map__hub-disc" r=${hub.r + 6} />
          ${FOCUS(hub.r + 12)}
        </g>
      </a>
    </svg>
    <div class="p-map__over" aria-hidden="true">
      <span class="p-map__pet" style=${`left: ${pct(hub.x, W)}; top: ${pct(hub.y, H)};`}><${Creature} id=${id} size=${48} /></span>
      <div class="p-map__name p-map__name--middle p-map__name--hub" style=${`left: ${pct(hub.x, W)}; top: ${pct(hub.y + hub.r + 14, H)};`}>
        <a class="p-map__name-link" href=${`#/departments/${id}`} tabindex="-1">
          <span class="p-map__name-title">${title}</span>
          ${dept.line ? html`<span class="p-map__name-line">${clip(dept.line, 80)}</span>` : null}
        </a>
        <${CountLine} dept=${dept} onNeeds=${onNeeds} focusable=${false} />
      </div>
    </div>
    ${near.prev && near.prev !== id ? html`<a class="p-map__edge p-map__edge--prev" href=${`#/map/${near.prev}`}>
        <${Icon} name="arrow-left" size=${16} /><span class="p-map__edge-name">${titleOf(near.prev)}</span></a>` : null}
    ${near.next && near.next !== id ? html`<a class="p-map__edge p-map__edge--next" href=${`#/map/${near.next}`}>
        <span class="p-map__edge-name">${titleOf(near.next)}</span><${Icon} name="arrow-right" size=${16} /></a>` : null}
  </div>`;
}

// ---- The crown: the brain and the seven hubs only, a picture for narrow screens ----

export function Crown({ data, loading = false }) {
  const depts = departmentsOf(data);
  const cw = 360;
  const ch = 300;
  const lay = layoutOverview({ departments: depts.map((d) => ({ id: d.id, clusters: [] })), width: cw, height: ch });
  const b = lay.brain;
  return html`<div class=${loading ? "p-map__crown p-map__view--loading" : "p-map__crown"} aria-hidden="true">
    <svg class="p-map__svg" viewBox=${`0 0 ${cw} ${ch}`} preserveAspectRatio="xMidYMid meet" focusable="false">
      <ellipse class="p-map__orbit" cx=${b.x} cy=${b.y} rx=${(300 * cw) / W} ry=${(215 * ch) / H} fill="none" />
      ${lay.hubs.map((h) => html`<line key=${`s-${h.id}`} class="p-map__spoke" data-dept=${h.id} x1=${b.x} y1=${b.y} x2=${h.x} y2=${h.y} />`)}
      <circle class="p-map__brain-disc" cx=${b.x} cy=${b.y} r="38" />
      ${lay.hubs.map((h) => html`<g key=${h.id} class="p-map__hub" data-dept=${h.id} transform=${`translate(${h.x} ${h.y})`}>
        <circle class="p-map__hub-disc" r="21" /></g>`)}
    </svg>
    <div class="p-map__over">
      <span class="p-map__pet" style=${`left: ${pct(b.x, cw)}; top: ${pct(b.y, ch)};`}><${Creature} id="brain" size=${48} /></span>
      ${lay.hubs.map((h) => html`<span key=${h.id} class="p-map__pet" style=${`left: ${pct(h.x, cw)}; top: ${pct(h.y, ch)};`}><${Creature} id=${h.id} size=${32} /></span>`)}
    </div>
  </div>`;
}
