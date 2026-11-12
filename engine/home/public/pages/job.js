// A job (CONTRACTS-V3 30, "A job"): the breadcrumb chip, the overline, the title, the sentence, the hand-off tag and
// stage with their one-liners, who does it, then the start form. When it cannot start the reason stands in place of
// the button. Under it, the earlier runs. With ?from=, the earlier task is named above the form, as a link to it by
// its title. A job that follows earlier work, with no accepted earlier task to pick, says which job to run first in
// place of the button (M51 F6).
// The words of a job come from the company's own files; the server's refusals are shown as they come.
import { html } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useRoute } from "../lib/router.js";
import {
  Empty, ErrorNotice, HANDOFFS, HandoffTag, JobStart, Loading, NotConnected, PageHeader, STAGES, Section, StageMark, TaskRow,
} from "../kit/index.js";

const SLUG = /^[a-z][a-z0-9-]{0,50}$/;
const FROM = /^[A-Za-z0-9-]{1,64}$/;
const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);

// --- Pure helpers (tested in test/pages/job.test.mjs) ---------------------------------------------------------

// The job's address parts from the page's route parts (["jobs", "sales", "proposal"]) → { department, id } or null.
export function jobAddress(parts) {
  const p = list(parts);
  return p.length === 3 && p[0] === "jobs" && SLUG.test(text(p[1])) && SLUG.test(text(p[2])) ? { department: p[1], id: p[2] } : null;
}

// "MARKETING · DESIGN": the department, then the cluster.
export function overlineOf(job) {
  const dept = text(job && job.department && job.department.title);
  const cluster = text(job && job.cluster && job.cluster.title);
  return [dept, cluster].filter(Boolean).join(" · ").toUpperCase();
}

// Who does it. One agent: its name. Two or three: the Chief of staff plans it and each does a part. None: the Chief of staff plans it.
export function whoLine(job) {
  const names = list(job && job.who).map((w) => text(typeof w === "string" ? w : w && (w.name || w.slug))).filter(Boolean);
  if (names.length === 0) return "The Chief of staff plans it.";
  if (names.length === 1) return `Done by ${names[0]}.`;
  return `Done by ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}. The Chief of staff plans it.`;
}

// The one-liners of the hand-off tag and the stage, in the words of section 25.
export function aboutLines(job) {
  const h = Object.hasOwn(HANDOFFS, text(job && job.handoff)) ? HANDOFFS[job.handoff] : null;
  const s = Object.hasOwn(STAGES, text(job && job.stage)) ? STAGES[job.stage] : null;
  return { handoff: h ? h.about : "", stage: s ? s.about : "" };
}

// Whether the job can start, and if not the reason that stands in place of the button.
export function startState(job) {
  if (!job || job.ready !== false) return { canStart: true, why: "" };
  const why = job.why && typeof job.why === "object" ? text(job.why.text) : text(job.why);
  return { canStart: false, why: why || "This job cannot start yet." };
}

// The earlier task from ?from=: kept only when it looks like a task id or an identifier, else null.
export function fromOf(query) {
  const raw = query && typeof query.get === "function" ? query.get(`from`) : null;
  const v = text(raw).trim();
  return FROM.test(v) ? v : null;
}

// The earlier task of ?from=, for the band above the form: { title, href }, or null without ?from=. The title is
// the task's own (from GET /api/tasks/<from>), else the offered option's title (its label without the date), else "".
export function fromNote(job, from, task) {
  if (!from) return null;
  const href = `#/tasks/${encodeURIComponent(from)}`;
  const own = task && typeof task === "object" && (task.id === from || task.identifier === from) ? text(task.title).slice(0, 160) : "";
  if (own) return { title: own, href };
  const ask = list(job && job.asks).find((a) => a && a.kind === "task");
  const opt = ask ? list(ask.options).find((o) => o && (o.value === from || (o.ref && o.ref === from))) : null;
  return { title: opt ? text(opt.label).replace(/ · [^·]*$/, "").slice(0, 160) : "", href };
}

// A job that follows earlier work whose required task question has nothing to pick (and no ?from=): what to do
// first, in place of Start. { after: [{ title, href }], waiting: { title, href } | null }, or null when it can start.
export function followsFirst(job, from) {
  if (!job || from || job.ready === false) return null;
  const ask = list(job.asks).find((a) => a && a.kind === "task" && a.required);
  if (!ask || list(ask.options).length) return null;
  const takes = job.takes && typeof job.takes === "object" ? job.takes : {};
  const after = list(takes.after).filter((a) => a && typeof a.id === "string")
    .map((a) => ({ title: text(a.title).slice(0, 120) || a.id, href: /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(a.id) ? `#/jobs/${a.id}` : null }));
  const w = takes.waiting && typeof takes.waiting === "object" && FROM.test(text(takes.waiting.taskId)) ? takes.waiting : null;
  return { after, waiting: w ? { title: text(w.title).slice(0, 160) || "The waiting task", href: `#/tasks/${encodeURIComponent(w.taskId)}` } : null };
}

// The sentence of followsFirst: `This follows "Five concepts before any design". Accept one first.`
export function followsSentence(first) {
  const names = list(first && first.after).map((a) => `"${a.title}"`);
  if (!names.length) return "This follows an earlier task. Accept one first.";
  return `This follows ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`}. Accept one first.`;
}

// The unknown-job state is a 404 from the server.
export const isUnknown = (error) => Boolean(error && (Number(error.status) === 404 || error.code === "job_not_found" || error.code === "not_found"));

// --- The page --------------------------------------------------------------------------------------------------

function FollowsFirst({ first }) {
  return html`<div class="p-job__follows" role="note">
    <p class="p-job__follows-text">${followsSentence(first)}</p>
    <p class="p-job__follows-links">
      ${first.after.filter((a) => a.href).map((a) => html`<a key=${a.href} class="p-job__link" href=${a.href}>Open ${a.title}</a>`)}
      ${first.waiting ? html`<a class="p-job__link" href=${first.waiting.href}>${first.waiting.title}, waiting for you</a>` : null}
    </p>
  </div>`;
}

function Body({ job, recent, from, earlier, onStarted, queue }) {
  const dept = text(job.department && job.department.id);
  const about = aboutLines(job);
  const note = fromNote(job, from, earlier);
  const first = followsFirst(job, from);
  const state = startState(job);
  const runs = list(recent).filter((t) => t && typeof t === "object");
  return html`
    <div class="p-job__card">
      <div class="p-job__tags">
        <div class="p-job__tag"><${HandoffTag} id=${job.handoff} />${about.handoff && html`<span class="p-job__about">${about.handoff}</span>`}</div>
        <div class="p-job__tag"><${StageMark} n=${job.stage} />${about.stage && html`<span class="p-job__about">${about.stage}</span>`}</div>
      </div>
      <p class="p-job__who">${whoLine(job)}</p>
      ${note && html`<p class="p-job__from">${note.title
        ? html`Following the earlier task <a class="p-job__link" href=${note.href}>${note.title}</a>.`
        : html`Following an <a class="p-job__link" href=${note.href}>earlier task</a>.`}</p>`}
      ${first
        ? html`<${FollowsFirst} first=${first} />`
        : html`<div class=${state.canStart ? "p-job__start" : "p-job__start p-job__start--blocked"} data-dept=${dept || undefined}>
            <${JobStart} key=${text(job.id)} job=${job} from=${from} onStarted=${onStarted} queue=${queue} />
          </div>`}
    </div>
    <${Section} title="Earlier runs" count=${runs.length || undefined}>
      ${runs.length
        ? html`<ul class="p-job__runs">${runs.map((t) => html`<li key=${text(t.id)}><${TaskRow} task=${t} /></li>`)}</ul>`
        : html`<${Empty} title="Nothing started from this job yet" text="When you start it, the task will show here." />`}
    <//>`;
}

export default function Page() {
  const { parts, query } = useRoute();
  const addr = jobAddress(parts);
  const res = useResource(addr ? `/api/jobs/${addr.department}/${addr.id}` : null, { every: 10000 });
  const d = res.data;
  const job = d && d.job && typeof d.job === "object" ? d.job : null;
  const from = fromOf(query);
  const earlier = useResource(from ? `/api/tasks/${encodeURIComponent(from)}` : null);
  const back = { href: "#/jobs", label: "All jobs" };

  if (!addr || (!job && res.error && isUnknown(res.error))) {
    return html`<div class="p-job">
      <${PageHeader} title="This job is not here" back=${back} />
      <${Empty} title="There is no such job" text="It may have been renamed or taken away. The list shows every job.">
        <a class="p-job__link" href="#/jobs">Open the list of jobs</a>
      <//>
    </div>`;
  }
  if (!job) {
    return html`<div class="p-job">
      <${PageHeader} title="A job" back=${back} />
      ${res.error
        ? res.error.offline || Number(res.error.status) >= 502
          ? html`<${NotConnected} reason=${text(res.error.message)} next=${text(res.error.next)} />`
          : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`
        : html`<${Loading} lines=${5} label="Loading the job" />`}
    </div>`;
  }

  const deptId = text(job.department && job.department.id);
  const chip = {
    label: [text(job.department && job.department.title), text(job.title)],
    href: SLUG.test(deptId) ? `#/departments/${deptId}` : "#/jobs",
    closeLabel: "Close the job",
  };
  return html`<div class="p-job">
    <${PageHeader} title=${text(job.title)} over=${overlineOf(job)} lead=${text(job.summary)} chip=${chip}
      creature=${SLUG.test(deptId) ? deptId : undefined} />
    <${Body} job=${job} recent=${d.recent} from=${from} earlier=${earlier.data && earlier.data.task}
      onStarted=${() => res.refresh()} queue=${d.queue && typeof d.queue === "object" ? d.queue : null} />
  </div>`;
}
