// Jobs (shape `job`, CONTRACTS-V3 31 and 33.3): the hand-off tag, the stage mark, why a job cannot start,
// a job as one line and as a chip, and the start form with its questions.
// A job's words come from the company's own job files; the server's refusals are shown as the sentences it sends.
import { html, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { linkHref } from "../lib/format.js";
import { Button } from "./button.js";
import { Field, Select, TextArea, TextInput } from "./fields.js";
import { Icon } from "./icon.js";
import { Notice, NotConnected } from "./states.js";
import { cx, safeHref } from "./util.js";

// Section 25: the words on screen.
export const HANDOFFS = Object.freeze({
  "you-lead": { label: "You lead", about: "The agent gets things ready. You do the main part." },
  "you-approve": { label: "You approve", about: "The agent does the work. It counts only when you approve it." },
  "on-its-own": { label: "On its own", about: "The agent does it to the end and it is checked. You read the result." },
});
export const STAGES = Object.freeze({
  1: { label: "Foundations", about: "Fill the company brain, so work sounds like your company." },
  2: { label: "Take in", about: "Jobs that read and sort what comes in." },
  3: { label: "Make", about: "Jobs that produce work." },
  4: { label: "Hand on", about: "Work passed from one agent to the next, with nothing copied by hand." },
});
export const STARTED = "Started. The Chief of staff has it. It takes a few minutes and is checked before it reaches you.";
export const UNDER_START = "Takes a few minutes. It is checked before it reaches you.";

const SLUG = /^[a-z][a-z0-9-]{0,50}$/;
const REF = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
const ASK_ID = /^[a-z][a-z0-9-]{0,30}$/;
const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const deptOf = (job) => {
  const d = job && job.department;
  const id = typeof d === "string" ? d : d && typeof d.id === "string" ? d.id : "";
  return SLUG.test(id) ? id : (str(job && job.id).split("/")[0] || "");
};

// "#/jobs/sales/proposal-from-a-call" for a job whose id is "sales/proposal-from-a-call". Null for anything odd.
export function jobHref(job) {
  const parts = str(job && job.id).split("/");
  const [dept, id] = parts.length === 2 ? parts : [deptOf(job), parts[0]];
  return SLUG.test(dept || "") && SLUG.test(id || "") ? `#/jobs/${dept}/${id}` : null;
}

const optionsOf = (ask) =>
  arr(ask && ask.options)
    .map((o) => (typeof o === "string" ? { value: o, label: o }
      : o && typeof o.value === "string" ? { value: o.value, label: str(o.label) || o.value, ref: REF.test(str(o.ref)) ? o.ref : "" } : null))
    .filter(Boolean)
    .slice(0, 100);
const asksOf = (job) => arr(job && job.asks).filter((a) => a && ASK_ID.test(str(a.id))).slice(0, 8);
// The task ask that `from` answers: the server fills the ask named by the job's hand-on, which is of kind task.
const fromAskOf = (job) => asksOf(job).find((a) => a.kind === "task") || null;

// A task's offered label as the server sends it ("STH-20 · Call write-up: Asha Kitchens") split into its name
// and its short ref, so the name is shown first and the ref quietly after it: { name, ref }. A label with no
// ref in front is all name.
export function nameAndRef(label) {
  const s = str(label);
  const m = /^([A-Z][A-Z0-9]{0,9}-\d{1,7}) · (.+)$/s.exec(s);
  return m ? { name: m[2], ref: m[1] } : { name: s, ref: "" };
}
const nameFirst = (label) => {
  const { name, ref } = nameAndRef(label);
  return ref ? `${name} · ${ref}` : name;
};

// "STH-20" from an offered option "STH-20 · Call write-up: Asha Kitchens", or the value when it is an identifier.
function identifierOf(ask, value) {
  const o = optionsOf(ask).find((x) => x.value === value);
  if (o && o.ref) return o.ref;
  const head = str(o && o.label).split(" · ")[0].trim();
  if (REF.test(head)) return head;
  return REF.test(str(value)) ? value : "";
}

// The words the owner is about to send (31.3): every [id] replaced by its answer, an empty optional answer
// leaving nothing, an unanswered required one left as [id]. Pure, one pass: an answer is never read for [ids].
export function fillPreview(job, answers) {
  return fill(job, answers, null);
}

// `blank(id)` marks an unanswered required question (for previewParts); null leaves it as [id].
function fill(job, answers, blank) {
  const given = answers && typeof answers === "object" ? answers : {};
  const byId = new Map(asksOf(job).map((a) => [a.id, a]));
  const out = str(job && job.text).replace(/\[([a-z][a-z0-9-]{0,30})\]/g, (whole, id) => {
    const ask = byId.get(id);
    if (!ask) return whole;
    const value = str(given[id]).trim();
    if (!value) return ask.required ? (blank ? blank(id) : whole) : "";
    if (ask.kind === "file") return `the company file ${value}`;
    if (ask.kind === "media") return `the file ${value} in the room`;
    if (ask.kind === "task") {
      const ident = identifierOf(ask, value);
      return ident ? `the sub-folder ${ident} of your current working folder` : "the sub-folder of the earlier task";
    }
    return value;
  });
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
}

// The preview as parts for the screen: the same words as fillPreview, but a required question not yet answered
// is { blank: <its question, quietly> } instead of its short id, so "[who]" reads "[Who was the call with]"
// (M51 F22). fillPreview stays the text that is sent.
// Answers are never read for blanks: the marks are private-use characters taken out of every answer first.
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
export function previewParts(job, answers) {
  const byId = new Map(asksOf(job).map((a) => [a.id, a]));
  const given = {};
  for (const [k, v] of Object.entries(answers && typeof answers === "object" ? answers : {})) given[k] = str(v).replace(/[\uE000\uE001]/g, "");
  const text = fill(job, given, (id) => `${MARK_OPEN}${id}${MARK_CLOSE}`);
  const out = [];
  for (const [i, piece] of text.split(/\uE000|\uE001/).entries()) {
    if (i % 2) out.push({ blank: str(byId.get(piece)?.label).replace(/\?\s*$/, "") || piece });
    else if (piece) out.push({ text: piece });
  }
  return out;
}

// Pure. For a job that follows earlier work and has no accepted earlier task yet: the sentence that replaces
// Start, the first job it follows and, when one waits for the owner, that task (`takes.after`, `takes.waiting`).
// → { sentence, href, waiting: { href } | null }
export function followsOf(job) {
  const takes = job && typeof job.takes === "object" && job.takes ? job.takes : {};
  const after = arr(takes.after).filter((a) => a && typeof a.id === "string");
  const first = after[0] || (arr(takes.from).find((x) => typeof x === "string") ? { id: arr(takes.from).find((x) => typeof x === "string") } : null);
  const title = first && str(first.title) && str(first.title) !== first.id ? str(first.title).slice(0, 80) : "";
  const w = takes.waiting && typeof takes.waiting === "object" ? takes.waiting : null;
  const wid = w && (str(w.taskId) || str(w.identifier));
  const waiting = wid ? { href: safeHref(`#/tasks/${encodeURIComponent(wid)}`) } : null;
  const sentence = title
    ? `This follows "${title}". ${waiting ? "Accept the task that waits from it first." : "Run that job and accept what it makes first."}`
    : `This follows an earlier job. ${waiting ? "Accept the task that waits from it first." : "Run that job and accept what it makes first."}`;
  return { sentence, href: first ? jobHref({ id: first.id }) : null, waiting: waiting && waiting.href ? waiting : null };
}

// The answers checked by the rules of 31.2 before anything is sent. `from` answers the job's task ask.
// → { ok, errors: { <ask id>: sentence }, missing: [labels] }
export function checkAnswers(job, answers, from) {
  const given = answers && typeof answers === "object" ? answers : {};
  const fromAsk = from ? fromAskOf(job) : null;
  const errors = {};
  const missing = [];
  for (const a of asksOf(job)) {
    if (fromAsk && a.id === fromAsk.id) continue;
    const v = str(given[a.id]).trim();
    if (!v) {
      if (a.required) {
        errors[a.id] = "Fill this in.";
        missing.push(str(a.label));
      }
      continue;
    }
    let problem = null;
    if (a.kind === "line") problem = /[\r\n]/.test(v) ? "Keep this to one line." : v.length > 200 ? "Keep this to 200 characters." : null;
    else if (a.kind === "text") problem = v.length > 2000 ? "Keep this to 2000 characters." : null;
    else if (a.kind === "date") {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      const t = d ? new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])) : null;
      problem = t && t.getUTCDate() === +d[3] && t.getUTCMonth() === +d[2] - 1 ? null : "Pick a date.";
    } else if (a.kind === "number") problem = /^\d{1,7}$/.test(v) && Number(v) <= 1000000 ? null : "Give a whole number from 0 to 1000000.";
    else if (["choice", "file", "media", "task"].includes(a.kind)) problem = optionsOf(a).some((o) => o.value === v) ? null : "Pick one of the choices.";
    if (problem) errors[a.id] = problem;
  }
  return { ok: Object.keys(errors).length === 0, errors, missing };
}

export function HandoffTag({ id }) {
  const h = Object.hasOwn(HANDOFFS, String(id)) ? HANDOFFS[id] : null;
  if (!h) return null;
  return html`<span class=${cx("k-job", "k-job--handoff", `k-job--${id}`)} title=${h.about}>
    <span class="k-job__handoff-mark" aria-hidden="true"></span>${h.label}
  </span>`;
}

export function StageMark({ n }) {
  const s = Object.hasOwn(STAGES, String(n)) ? STAGES[n] : null;
  if (!s) return null;
  return html`<span class="k-job k-job--stage" title=${s.about}>
    <span class="k-job__stage-n" aria-hidden="true">${Number(n)}</span>
    <span class="k-sr">Stage ${Number(n)}: </span>${s.label}
  </span>`;
}

// `why` is { text, link } from the server (31.4), or the sentence alone.
export function WhyNot({ why }) {
  const text = typeof why === "string" ? why : str(why && why.text);
  if (!text) return null;
  const href = why && typeof why === "object" ? linkHref(why.link) : null;
  const page = why && why.link ? why.link.page : "";
  // A form that must be filled in first opens that form, so the link says so (M51 F26).
  const where = page === "health" ? "Open Health" : page === "files" && /^Fill in\b/.test(text) ? "Fill it in" : page === "files" ? "Open Files" : "Open";
  return html`<p class="k-job k-job--why">
    <${Icon} name="lock" size=${14} class="k-job__why-icon" />
    <span>${text.slice(0, 200)}</span>
    ${href ? html`<a class="k-job__why-link" href=${href}>${where}</a>` : null}
  </p>`;
}

export function JobRow({ job }) {
  if (!job || typeof job !== "object") return null;
  const dim = job.ready === false;
  const href = jobHref(job);
  const dept = deptOf(job);
  const why = typeof job.why === "string" ? job.why : str(job.why && job.why.text);
  const inner = html`<span class="k-job__dot" aria-hidden="true"></span>
    <span class="k-job__title">${str(job.title).slice(0, 60)}</span>
    ${dim ? html`<span class="k-sr">. Cannot start yet${why ? `: ${why}` : "."}</span>` : null}
    <span class="k-job__marks"><${HandoffTag} id=${job.handoff} /><${StageMark} n=${job.stage} /></span>
    ${href ? html`<${Icon} name="chevron-right" size=${14} class="k-job__go" />` : null}`;
  const cls = cx("k-job", "k-job--row", dim && "k-job--dim");
  return href
    ? html`<a class=${cls} href=${href} data-dept=${dept || undefined} title=${dim && why ? why : undefined}>${inner}</a>`
    : html`<span class=${cls} data-dept=${dept || undefined}>${inner}</span>`;
}

// The "can run" chip on a department's page.
export function JobChip({ job }) {
  if (!job || typeof job !== "object") return null;
  const href = jobHref(job);
  const dim = job.ready === false;
  const inner = html`<span class="k-job__dot" aria-hidden="true"></span><span class="k-job__chip-text">${str(job.title).slice(0, 60)}</span>
    ${dim ? html`<span class="k-sr"> (cannot start yet)</span>` : null}`;
  const cls = cx("k-job", "k-job--chip", dim && "k-job--dim");
  const dept = deptOf(job) || undefined;
  return href ? html`<a class=${cls} href=${href} data-dept=${dept}>${inner}</a>` : html`<span class=${cls} data-dept=${dept}>${inner}</span>`;
}

const READ_STATE = { filled: "Filled in", empty: "Not filled in yet", missing: "Not there yet" };

function Reads({ reads }) {
  const list = arr(reads).filter((r) => r && typeof r.file === "string").slice(0, 8);
  if (!list.length) return null;
  return html`<div class="k-job__reads">
    <p class="k-job__over">It reads first</p>
    <ul class="k-job__read-list">${list.map((r) => {
      const filled = r.state === "filled";
      const href = linkHref(r.link);
      const name = str(r.title) || r.file;
      // Only a file the job needs carries the warning mark; one that only helps is a quiet dot (M51 F7).
      const must = r.need === "must";
      const state = filled ? READ_STATE.filled : must ? `${READ_STATE[r.state] || READ_STATE.missing}. Needed.` : "Not added yet. Optional.";
      return html`<li key=${r.file} class=${cx("k-job__read", filled ? "k-job__read--filled" : must ? "k-job__read--missing" : "k-job__read--optional")}>
        ${filled || must ? html`<${Icon} name=${filled ? "check" : "alert"} size=${14} />` : html`<span class="k-job__read-dot" aria-hidden="true"></span>`}
        ${href ? html`<a class="k-job__read-name" href=${href}>${name}</a>` : html`<span class="k-job__read-name">${name}</span>`}
        <span class="k-job__read-state">${state}</span>
      </li>`;
    })}</ul>
  </div>`;
}

const EMPTY_OPTIONS = {
  task: "There is no accepted earlier task to start from yet.",
  file: "There are no files for this in the company brain yet.",
  media: "The room has no files yet.",
  choice: "There is nothing to pick from.",
};

function AskField({ ask, value, error, disabled, onValue, fromText }) {
  const label = ask.required ? ask.label : `${ask.label} (optional)`;
  const set = (e) => onValue(String(e.target.value));
  if (fromText) {
    return html`<${Field} label=${label}><p class="k-job__from"><${Icon} name="link" size=${14} /><span>${fromText}</span></p><//>`;
  }
  if (ask.kind === "text") {
    return html`<${Field} label=${label} error=${error}><${TextArea} autoGrow maxlength=${2000} value=${value} disabled=${disabled} onInput=${set} /><//>`;
  }
  if (ask.kind === "date") {
    return html`<${Field} label=${label} error=${error}><${TextInput} type="date" value=${value} disabled=${disabled} onInput=${set} /><//>`;
  }
  if (ask.kind === "number") {
    return html`<${Field} label=${label} error=${error} hint="A whole number.">
      <${TextInput} type="number" inputmode="numeric" min="0" max="1000000" step="1" value=${value} disabled=${disabled} onInput=${set} />
    <//>`;
  }
  if (["choice", "file", "media", "task"].includes(ask.kind)) {
    const options = optionsOf(ask);
    if (!options.length) return html`<${Field} label=${label} error=${error} hint=${EMPTY_OPTIONS[ask.kind]}><${Select} options=${[{ value: "", label: "Nothing to pick" }]} disabled /><//>`;
    const shown = ask.kind === "task" ? options.map((o) => ({ ...o, label: nameFirst(o.label) })) : options;
    return html`<${Field} label=${label} error=${error}>
      <${Select} value=${value} disabled=${disabled} onChange=${set} options=${[{ value: "", label: "Pick one" }, ...shown]} />
    <//>`;
  }
  return html`<${Field} label=${label} error=${error}><${TextInput} maxlength=${200} value=${value} disabled=${disabled} onInput=${set} /><//>`;
}

const offline = (e) => Boolean(e && (e.offline || e.code === "not_set_up" || Number(e.status) >= 502));

// The start form. `from` is the earlier task this one follows (a task id or identifier), when the owner came
// from "What can come next". `onStarted(answer)` gets the server's 201 answer.
export function JobStart({ job, from, onStarted }) {
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [phase, setPhase] = useState({ id: "ready" });
  if (!job || typeof job !== "object") return null;

  const asks = asksOf(job);
  const fromAsk = from ? fromAskOf(job) : null;
  const ready = job.ready !== false;
  const sending = phase.id === "sending";
  const href = jobHref(job);
  const previewAnswers = fromAsk ? { ...answers, [fromAsk.id]: str(from) } : answers;
  const fromOption = fromAsk ? optionsOf(fromAsk).find((o) => o.value === from || (o.ref && o.ref === from) || o.label.startsWith(`${from} · `)) : null;
  // Already answered by the task the owner came from: its name first, its ref quietly after (M51 F8, F9).
  const fromName = fromOption ? (fromOption.ref ? { name: nameAndRef(fromOption.label).name, ref: fromOption.ref } : nameAndRef(fromOption.label)) : null;
  const fromText = fromName
    ? html`Already answered: from the earlier task, ${fromName.name}${fromName.ref ? html` <span class="k-job__ref">${fromName.ref}</span>` : null}.`
    : "Already answered: from the earlier task you came from.";
  // A job that follows another one, with no accepted earlier task to start from: Start could only be refused,
  // so the form says what to do first instead (M51 F6).
  const blocked = !from && asks.find((a) => a.kind === "task" && a.required && !optionsOf(a).length);
  const follows = blocked ? followsOf(job) : null;
  const form = useRef(null);
  const focusProblem = () => {
    const go = () => {
      const el = form.current && form.current.querySelector && form.current.querySelector('[aria-invalid="true"]');
      if (el && typeof el.focus === "function") el.focus();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
    else setTimeout(go, 0);
  };

  const setOne = (id, v) => {
    setAnswers((p) => ({ ...p, [id]: v }));
    if (errors[id]) setErrors((p) => { const n = { ...p }; delete n[id]; return n; });
    if (phase.id === "missing" || phase.id === "refused") setPhase({ id: "ready" });
  };

  const start = async (event) => {
    if (event && event.preventDefault) event.preventDefault();
    if (!ready || sending || !href) return;
    const check = checkAnswers(job, answers, from);
    setErrors(check.errors);
    if (!check.ok) {
      setPhase({ id: "missing", text: check.missing.length ? `Fill in: ${check.missing[0]}` : "Some answers need a change." });
      // Focus goes to the first question with a problem, not left on Start (M52 K5).
      focusProblem();
      return;
    }
    const body = { answers: {} };
    for (const a of asks) {
      if (fromAsk && a.id === fromAsk.id) continue;
      const v = str(answers[a.id]).trim();
      if (v) body.answers[a.id] = v;
    }
    if (from) body.from = String(from);
    setPhase({ id: "sending" });
    try {
      const res = await api.post(`/api/${href.slice(2)}/start`, body);
      setPhase({ id: "started", res });
      if (onStarted) onStarted(res);
    } catch (e) {
      setPhase(offline(e) ? { id: "off", text: e.message, next: e.next } : { id: "refused", text: e && e.message, next: e && e.next });
    }
  };

  if (phase.id === "started") {
    const goal = (phase.res && phase.res.goal) || {};
    const task = str(goal.identifier) || str(goal.id);
    const taskHref = task ? safeHref(`#/tasks/${encodeURIComponent(task)}`) : null;
    return html`<div class="k-job k-job--start k-job--started" role="status">
      <p class="k-job__started"><${Icon} name="check" size=${16} /><span>${str(phase.res && phase.res.message) || STARTED}</span></p>
      <div class="k-job__actions">
        ${taskHref ? html`<${Button} variant="primary" href=${taskHref} icon="chevron-right">Open the task<//>` : null}
        <${Button} variant="quiet" onClick=${() => { setAnswers({}); setPhase({ id: "ready" }); }}>Start it again<//>
      </div>
    </div>`;
  }

  return html`<form ref=${form} class=${cx("k-job", "k-job--start", !ready && "k-job--dim")} onSubmit=${start} novalidate>
    ${!ready ? html`<${WhyNot} why=${job.why} />` : null}
    ${asks.length
      ? html`<div class="k-job__asks">${asks.map((a) => html`<${AskField} key=${a.id} ask=${a} value=${str(answers[a.id])} error=${errors[a.id]}
          disabled=${!ready || sending} fromText=${fromAsk && a.id === fromAsk.id ? fromText : null} onValue=${(v) => setOne(a.id, v)} />`)}</div>`
      : null}
    <${Reads} reads=${job.reads} />
    ${str(job.text)
      ? html`<details class="k-job__preview">
          <summary class="k-job__preview-head"><${Icon} name="chevron-right" size=${14} class="k-job__fold" /><span>What will be asked</span></summary>
          <p class="k-job__preview-text">${previewParts(job, previewAnswers).map((p, i) =>
            p.blank ? html`<span key=${i} class="k-job__blank">[${p.blank}]</span>` : p.text)}</p>
        </details>`
      : null}
    ${phase.id === "missing" ? html`<${Notice} tone="warn" title=${phase.text} />` : null}
    ${phase.id === "refused"
      ? html`<${Notice} tone="bad" title=${str(phase.text) || "It could not be started."}>${phase.next ? str(phase.next) : null}<//>`
      : null}
    ${phase.id === "off" ? html`<${NotConnected} reason=${phase.text} next=${phase.next} />` : null}
    ${blocked && ready
      ? html`<p class="k-job k-job--why k-job--follows">
          <${Icon} name="link" size=${14} class="k-job__why-icon" />
          <span>${follows.sentence}</span>
          ${follows.waiting ? html`<a class="k-job__why-link" href=${follows.waiting.href}>Open the task that waits</a>` : null}
          ${follows.href ? html`<a class="k-job__why-link" href=${follows.href}>Open that job</a>` : null}
        </p>`
      : html`<div class="k-job__actions">
          <${Button} type="submit" variant="primary" icon="play" busy=${sending} disabled=${!ready || !href}>Start<//>
          <p class="k-job__under">${sending ? "Sending…" : UNDER_START}</p>
        </div>`}
  </form>`;
}
