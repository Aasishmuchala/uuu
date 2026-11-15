// The map's drawing (CONTRACTS-V3 29.1, 29.3, 29.5; PLAN-COOK T63, TB4, R5-G): the company brain as a card at the
// centre and each department as a card round it on a faint dot grid, joined to the brain by a 1.5 px connector that
// ends in a 4 px dot on each card's edge. Edges and lines are neutral, so the map stays calm when most departments
// need the owner: what a department needs of the owner is its count, a warn chip; beside it a 6 px dot, green for
// one at work and red for one that is stuck (a problem of its own waits on the owner), whose line is red too; no
// stripe on a card (R6-G). The brain is the larger card at the centre, edged in the accent. The cards are real links (a
// department's chooses it at #/map/<department>; the brain's opens Files) with a name for screen readers; the lines
// are hidden from them. Laid out by map/layout.js in screen pixels for the box the stage gives the drawing, so every
// word is drawn at its true size; when the cards do not fit the box, the departments are shown as rows instead.
// Nothing moves by script: choosing a department lifts its card in place (styles/pages/map.css). Every tile is the
// kit's neutral Tile: with the dots kept for work and trouble, a tint on the tiles would be one colour too many.
// Every word a department shows comes from the company's own files, through the home server; it is shown as text
// and cut to a fixed length.
import { html, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { Icon, Tag, Tile } from "../kit/index.js";
import { DEPARTMENTS } from "../routes.js";
import { CORE, NODE, NODE_SMALL, layoutNodes } from "./layout.js";

const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const JOB_ID = /^[a-z][a-z0-9-]{0,40}\/[a-z][a-z0-9-]{0,60}$/;

const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const clip = (v, n) => str(v).slice(0, n);
const idOf = (d) => (d && SLUG.test(str(d.id)) ? d.id : "");

// Each team's line icon, as the sidebar draws it (no creature, no colour: O2, O7).
export const DEPT_ICONS = Object.freeze({
  brain: "brain", operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book",
});
export const iconOf = (id) => DEPT_ICONS[id] || "layers";

// ---- Words (pure, tested) ----

// The count line under a department: [{ kind: "jobs" | "working" | "needs", text }].
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

// What a screen reader hears for a department's card: "Sales, 9 jobs, 1 working, 2 need you".
export function hubLabel(dept) {
  const title = clip(dept && dept.title, 60) || "A department";
  return [title, ...countParts(dept && dept.counts).map((p) => p.text.replace(/^No jobs yet$/, "no jobs yet"))].join(", ");
}

// The words on a card, after its dot: "1 working, 2 need you"; "Nothing running" when neither holds.
export function nodeLine(counts) {
  const parts = countParts(counts).filter((p) => p.kind !== "jobs").map((p) => p.text);
  return parts.length ? parts.join(", ") : "Nothing running";
}

// The dot before those words: something waits for the owner, else something is being worked on, else quiet.
export function nodeTone(counts) {
  const c = counts && typeof counts === "object" ? counts : {};
  return num(c.needsYou) ? "warn" : num(c.working) ? "live" : "wait";
}

// The state of a card (R5-G, R6-G: its 6 px dot): "bad" for a department that is stuck, "live" for one at work, else
// none. Waiting on the owner is said by the card's count chip alone, so it gives no dot.
export function edgeTone(counts, stuck = false) {
  const c = counts && typeof counts === "object" ? counts : {};
  return stuck ? "bad" : num(c.working) ? "live" : "";
}

// The departments that are stuck: those with a problem of their own (a failed run, a stopped task) waiting on the
// owner, from /api/home's items.
export function stuckOf(items) {
  return [...new Set(arr(items).filter((i) => i && i.kind === "problem" && SLUG.test(str(i.department))).map((i) => i.department))];
}

// The line under a card's name: its jobs and who is at work, "20 jobs · 1 working"; what needs the owner is the
// card's warn chip, so it is not said twice. The smaller card leaves the jobs out when someone is working.
export function cardLine(counts, small = false) {
  const parts = countParts(counts).filter((p) => p.kind !== "needs");
  const shown = small && parts.length > 1 ? parts.slice(1) : parts;
  return shown.map((p) => p.text).join(" · ");
}

// The jobs on a card and in the rail: "9 jobs, 7 ready to start".
export function jobsLine(counts) {
  const c = counts && typeof counts === "object" ? counts : {};
  const jobs = num(c.jobs);
  if (!jobs) return "No jobs yet";
  return `${jobs === 1 ? "1 job" : `${jobs} jobs`}, ${Math.min(num(c.ready), jobs)} ready to start`;
}

// The line under the brain: "12 files · 4 of 9 basics filled", always; while a question is open the chip over
// the box says so, so the count is never hidden.
export function brainLine(brain) {
  if (!brain || typeof brain !== "object") return "";
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

// The share of the basics filled, 0 to 100, for the brain's meter.
export function basicsShare(brain) {
  const b = (brain && brain.basics) || {};
  const total = num(b.total);
  return total ? Math.round((100 * Math.min(num(b.filled), total)) / total) : 0;
}

// The departments of a map answer, each well formed; the fallback names while nothing has come.
export function departmentsOf(data) {
  const list = arr(data && data.departments).filter((d) => idOf(d)).slice(0, 9);
  if (list.length) return list;
  return DEPARTMENTS.map((d) => ({ id: d.id, title: d.title, line: "", counts: null, clusters: [] }));
}

const jobsOfCluster = (c) => arr(c && c.jobs).filter((j) => j && JOB_ID.test(str(j.id))).slice(0, 16);
const clustersOf = (d) => arr(d && d.clusters).filter((c) => c && SLUG.test(str(c.id))).slice(0, 5);

// The departments, clusters and job ids in file order, at most 16 jobs a department: the order the list twin
// shows them in (layoutOverview's input).
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

// ---- Pieces ----

// The count line, with the working words a link to the tasks and the warm words opening Needs you.
export function CountLine({ dept, onNeeds, focusable = true }) {
  const id = idOf(dept);
  const tab = focusable ? undefined : "-1";
  // Each link says whose count it is, so a list of departments is not "1 working, 1 working" (M52 K9).
  const title = clip(dept && dept.title, 40);
  return html`<p class="p-map__count">${countParts(dept && dept.counts).map((p, i) => html`${i ? html`<span class="p-map__count-sep" aria-hidden="true"> · </span>` : null}${
    p.kind === "working" && id
      ? html`<a class="p-map__count-live" href=${`#/tasks?d=${id}`} tabindex=${tab} aria-label=${title ? `${title}: ${p.text}` : undefined}>${p.text}</a>`
      : p.kind === "needs" && onNeeds
        ? html`<button type="button" class="p-map__count-warm" tabindex=${tab} aria-label=${title ? `${title}: ${p.text}` : undefined} onClick=${() => onNeeds(id)}>${p.text}</button>`
        : html`<span class=${`p-map__count-${p.kind}`}>${p.text}</span>`}`)}</p>`;
}

// The size of an element in screen pixels, read again when it changes (no frame loop: a ResizeObserver).
function useBoxSize(ref) {
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

const place = (b) => `left: ${b.x - b.w / 2}px; top: ${b.y - b.h / 2}px; width: ${b.w}px; height: ${b.h}px;`;

// ---- The overview: the brain and the departments as cards ----

// `chosen` is the department chosen at #/map/<department> (its card is lifted); `onNodeKey(id, key)` moves focus
// between the cards on the arrow keys; `fallback` is what the stage shows when the cards do not fit its box; `stuck`
// the ids of the departments that are stuck (stuckOf).
export function Overview({ data, loading = false, chosen = null, onNodeKey, fallback = null, stuck = [] }) {
  const ref = useRef(null);
  const size = useBoxSize(ref);
  const depts = departmentsOf(data);
  const ids = depts.map((d) => d.id);
  // The full card, else the smaller one (without the jobs count), else the rows.
  const big = size ? layoutNodes({ ids, width: size.w, height: size.h, node: NODE, core: CORE }) : null;
  const small = big && !big.fits;
  const lay = small ? layoutNodes({ ids, width: size.w, height: size.h, node: NODE_SMALL, core: CORE }) : big;
  const byId = new Map(depts.map((d) => [d.id, d]));
  const brain = data && data.brain;
  const c = lay && lay.core;
  const stuckIds = new Set(arr(stuck));

  const onKeyDown = (e) => {
    const node = e.target && e.target.closest ? e.target.closest("[data-node]") : null;
    if (!node || !onNodeKey) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      onNodeKey(node.getAttribute("data-node"), e.key);
    }
  };

  let body = null;
  if (lay && !lay.fits) body = html`<div class="p-map__fallback">${fallback}</div>`;
  else if (lay) {
    body = html`<svg class="p-map__lines" viewBox=${lay.viewBox.join(" ")} width=${size.w} height=${size.h} aria-hidden="true" focusable="false">
        ${lay.lines.map((l) => {
          const d = byId.get(l.id) || {};
          const bad = !loading && stuckIds.has(l.id);
          const cls = ["p-map__line", bad ? "p-map__line--bad" : "", l.id === chosen ? "p-map__line--chosen" : ""].filter(Boolean).join(" ");
          return html`<g key=${l.id} class=${cls}>
            <line class="p-map__wire" x1=${l.start.x} y1=${l.start.y} x2=${l.end.x} y2=${l.end.y} />
            <circle class="p-map__port" cx=${l.start.x} cy=${l.start.y} r="2" />
            <circle class="p-map__port" cx=${l.end.x} cy=${l.end.y} r="2" />
          </g>`;
        })}
      </svg>
      <ul class="p-map__nodes" role="list" aria-label="Company map" onKeyDown=${onKeyDown}>
        <li class="p-map__slot" style=${place(c)}>
          <a class="p-map__node p-map__node--brain" href="#/files" aria-label=${loading ? "Company brain" : brainLabel(brain)}>
            <${Tile} icon="brain" size=${32} />
            <span class="p-map__node-text">
              <span class="p-map__node-name">Company brain</span>
              <span class="p-map__node-line">${loading ? " " : brainLine(brain)}</span>
              <span class="p-map__meter" aria-hidden="true"><span class="p-map__meter-fill" style=${`width: ${basicsShare(brain)}%;`}></span></span>
            </span>
          </a>
        </li>
        ${lay.nodes.map((n) => {
          const d = byId.get(n.id) || {};
          const on = n.id === chosen;
          const edge = d.counts && !loading ? edgeTone(d.counts, stuckIds.has(n.id)) : "";
          const needs = num(d.counts && d.counts.needsYou);
          const cls = ["p-map__node", on ? "p-map__node--chosen" : ""].filter(Boolean).join(" ");
          return html`<li key=${n.id} class="p-map__slot" style=${place(n)}>
            <a class=${cls} data-node=${n.id} data-dept=${n.id}
              href=${`#/map/${n.id}`} aria-current=${on ? "true" : undefined} aria-label=${hubLabel(d)}>
              <span class="p-map__node-head">
                <${Tile} icon=${iconOf(n.id)} size=${28} />
                <span class="p-map__node-name">${clip(d.title, 40)}</span>
                ${edge || (needs && !loading) ? html`<span class="p-map__node-state" aria-hidden="true">
                  ${edge ? html`<span class=${`p-map__node-dot p-map__node-dot--${edge}`}></span>` : null}
                  ${needs && !loading ? html`<span class="p-map__node-needs"><${Tag} tone="warn">${needs}<//></span>` : null}
                </span>` : null}
              </span>
              <span class="p-map__node-line">${d.counts && !loading ? cardLine(d.counts, small) : " "}</span>
            </a>
          </li>`;
        })}
      </ul>`;
  }

  return html`<div class=${loading ? "p-map__view p-map__view--loading" : "p-map__view"} ref=${ref}>${body}</div>`;
}
