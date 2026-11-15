// Jobs (shape `job`, CONTRACTS-V3 31 and 33.3): the hand-off tag, the stage mark, why a job cannot start,
// a job as one line and as a chip, and the start form with its questions.
// PLAN-COOK T37: a job in a list is drawn as R12's card is built (its department's line icon on a tile, the name at
// 15 px semibold, one 13 px sentence, the facts as grey words with a glyph each, one button at the right) without
// the card's frame, since lists of jobs sit inside a page's own panel. No department colour anywhere (O7).
// PLAN-COOK TB3, R5-F: JobCard is a job as a card's body: the kit's 28 px Tile with its stage's line glyph in its
// stage's tint, the name as the one link (the whole card answers the click), two lines of sentence and the hand-off
// and stage as neutral chips.
// A job's words come from the company's own job files; the server's refusals are shown as the sentences it sends.
import { html, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { aheadLine, linkHref } from "../lib/format.js";
import { Button } from "./button.js";
import { Field, Select, TextArea, TextInput } from "./fields.js";
import { Icon } from "./icon.js";
import { Notice, NotConnected } from "./states.js";
import { Tag } from "./tag.js";
import { Tile, tintFor } from "./tile.js";
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
// Beside a Start that is off: the reason stands at the head of the form, so this only says it (PLAN-COOK TB3).
export const CANNOT_START = "Cannot start yet: see the note above.";
// Under Start when other work is ahead in the Chief of staff's line (`queue` from the server, M63): no time is
// promised. "3 tasks are ahead, so it waits its turn. It is checked before it reaches you."
// `timed` false (a job with craft, whose estimate is shown above Start) never promises a time.
export function underStart(queue, timed = true) {
  const ahead = aheadLine(queue);
  return ahead ? `${ahead} It is checked before it reaches you.` : timed ? UNDER_START : "It is checked before it reaches you.";
}

const SLUG = /^[a-z][a-z0-9-]{0,50}$/;
const REF = /^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/;
const ASK_ID = /^[a-z][a-z0-9-]{0,30}$/;
const str = (v) => (typeof v === "string" ? v : "");
const arr = (v) => (Array.isArray(v) ? v : []);
// The departments' line icons (as the sidebar draws them).
const DEPT_ICONS = { brain: "brain", operations: "layers", sales: "trend", marketing: "horn", studio: "film", support: "buoy", people: "team", books: "book" };
const deptIcon = (dept) => DEPT_ICONS[dept] || "jobs";
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

// `blank(id)` marks an unanswered required question (for previewParts); null leaves it as [id]. `mark(words)`, when
// given, wraps each answer as it is put in (for previewPieces).
function fill(job, answers, blank, mark = (v) => v) {
  const given = answers && typeof answers === "object" ? answers : {};
  const byId = new Map(asksOf(job).map((a) => [a.id, a]));
  const out = str(job && job.text).replace(/\[([a-z][a-z0-9-]{0,30})\]/g, (whole, id) => {
    const ask = byId.get(id);
    if (!ask) return whole;
    const value = str(given[id]).trim();
    if (!value) return ask.required ? (blank ? blank(id) : whole) : "";
    if (ask.kind === "file") return mark(`the company file ${value}`);
    if (ask.kind === "media") return mark(`the file ${value} in the room`);
    if (ask.kind === "task") {
      const ident = identifierOf(ask, value);
      return mark(ident ? `the sub-folder ${ident} of your current working folder` : "the sub-folder of the earlier task");
    }
    return mark(value);
  });
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
}

// The preview as parts for the screen: the same words as fillPreview, but a required question not yet answered
// is { blank: <its question, quietly> } instead of its short id, so "[who]" reads "[Who was the call with]"
// (M51 F22). fillPreview stays the text that is sent.
// Answers are never read for blanks: the marks are private-use characters taken out of every answer first.
const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const VALUE_OPEN = "\uE002";
const VALUE_CLOSE = "\uE003";
// A question's words as a slot: without the question mark or colon it ends on.
const slotWords = (ask, id) => str(ask && ask.label).replace(/[?:]\s*$/, "") || id;
const cleanAnswers = (answers) => {
  const given = {};
  for (const [k, v] of Object.entries(answers && typeof answers === "object" ? answers : {})) given[k] = str(v).replace(/[\uE000-\uE003]/g, "");
  return given;
};
export function previewParts(job, answers) {
  const byId = new Map(asksOf(job).map((a) => [a.id, a]));
  const text = fill(job, cleanAnswers(answers), (id) => `${MARK_OPEN}${id}${MARK_CLOSE}`);
  const out = [];
  for (const [i, piece] of text.split(/\uE000|\uE001/).entries()) {
    if (i % 2) out.push({ blank: slotWords(byId.get(piece), piece) });
    else if (piece) out.push({ text: piece });
  }
  return out;
}

// PLAN-COOK TB3: the preview as pieces for the screen, an answer kept apart so it can be drawn in the accent ink:
// [{ text } | { value } | { blank }]. The same words as previewParts, in the same order.
export function previewPieces(job, answers) {
  const byId = new Map(asksOf(job).map((a) => [a.id, a]));
  const text = fill(job, cleanAnswers(answers), (id) => `${MARK_OPEN}${id}${MARK_CLOSE}`, (v) => `${VALUE_OPEN}${v}${VALUE_CLOSE}`);
  const out = [];
  for (const piece of text.split(/(\uE000[^\uE001]*\uE001|\uE002[^\uE003]*\uE003)/)) {
    if (!piece) continue;
    if (piece[0] === MARK_OPEN) out.push({ blank: slotWords(byId.get(piece.slice(1, -1)), piece.slice(1, -1)) });
    else if (piece[0] === VALUE_OPEN) out.push({ value: piece.slice(1, -1) });
    else out.push({ text: piece });
  }
  return out;
}

// The pieces in blocks: a line that starts "1." or "1)" is a numbered step (the template's own number, its marker
// taken off), consecutive steps one list; any other lines a paragraph, an empty line ending it. Pure.
// → [{ kind: "steps", items: [{ n, pieces }] } | { kind: "para", pieces }]
export function previewBlocks(pieces) {
  const lines = [[]];
  for (const p of arr(pieces)) {
    if (p && typeof p.text === "string") {
      p.text.split("\n").forEach((t, i) => {
        if (i) lines.push([]);
        if (t) lines[lines.length - 1].push({ text: t });
      });
    } else if (p) lines[lines.length - 1].push(p);
  }
  const out = [];
  let para = null;
  for (const line of lines) {
    const head = line[0] && typeof line[0].text === "string" ? /^\s*(\d{1,2})[.)]\s+/.exec(line[0].text) : null;
    const empty = line.every((p) => typeof p.text === "string" && !p.text.trim());
    if (empty) { para = null; continue; }
    if (head) {
      para = null;
      const rest = line[0].text.slice(head[0].length);
      const item = { n: Number(head[1]), pieces: [...(rest ? [{ text: rest }] : []), ...line.slice(1)] };
      const last = out[out.length - 1];
      if (last && last.kind === "steps") last.items.push(item);
      else out.push({ kind: "steps", items: [item] });
      continue;
    }
    if (para) para.pieces.push({ text: "\n" }, ...line);
    else { para = { kind: "para", pieces: [...line] }; out.push(para); }
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
    <${Icon} name="stage" size=${14} class="k-job__stage-icon" />
    <span class="k-sr">Stage ${Number(n)}: </span>${s.label}
  </span>`;
}

// The server's sentence without a last sentence that only repeats the link's words ("... Open Settings." before the
// link "Open Settings"): the one trim made to a server sentence. Only an exact, whole trailing sentence equal to the
// label goes; a sentence that is nothing else, or ends any other way, is returned untouched.
export function withoutLinkWords(text, label) {
  const t = typeof text === "string" ? text : "";
  if (!t || typeof label !== "string" || !label) return t;
  const body = t.replace(/\s+$/, "");
  for (const tail of [`${label}.`, label]) {
    if (!body.endsWith(tail)) continue;
    const head = body.slice(0, body.length - tail.length);
    if (/[.!?]["'”)]?\s+$/.test(head)) return head.replace(/\s+$/, "");
  }
  return t;
}

// `why` is { text, link } from the server (31.4), or the sentence alone. → { text, href, where } or null.
function whyOf(why) {
  const text = typeof why === "string" ? why : str(why && why.text);
  if (!text) return null;
  const href = why && typeof why === "object" ? linkHref(why.link) : null;
  const page = why && why.link ? why.link.page : "";
  // A form that must be filled in first opens that form, so the link says so (M51 F26).
  const where = page === "health" ? "Open Health" : page === "settings" ? "Open Settings" : page === "files" && /^Fill in\b/.test(text) ? "Fill it in" : page === "files" ? "Open Files" : "Open";
  return { text: (href ? withoutLinkWords(text, where) : text).slice(0, 200), href, where };
}

export function WhyNot({ why }) {
  const w = whyOf(why);
  if (!w) return null;
  return html`<p class="k-job k-job--why">
    <${Icon} name="lock" size=${14} class="k-job__why-icon" />
    <span>${w.text}</span>
    ${w.href ? html`<a class="k-job__why-link" href=${w.href}>${w.where}</a>` : null}
  </p>`;
}

// PLAN-COOK TB3: why a job cannot start, at the head of its form, as the kit's warning Notice with the way to fix
// it as its action, a small ghost button.
export function WhyNotice({ why }) {
  const w = whyOf(why);
  if (!w) return null;
  return html`<div class="k-job__notice"><${Notice} tone="warn"
    action=${w.href ? html`<${Button} size="sm" variant="ghost" href=${w.href}>${w.where}<//>` : null}>${w.text}<//></div>`;
}

export function JobRow({ job }) {
  if (!job || typeof job !== "object") return null;
  const dim = job.ready === false;
  const href = jobHref(job);
  const dept = deptOf(job);
  const why = typeof job.why === "string" ? job.why : str(job.why && job.why.text);
  const summary = str(job.summary).replace(/\s+/g, " ").trim().slice(0, 200);
  const inner = html`<span class="k-job__dot" aria-hidden="true"><${Icon} name=${deptIcon(dept)} size=${16} /></span>
    <span class="k-job__body">
      <span class="k-job__title">${str(job.title).slice(0, 60)}</span>
      ${summary ? html`<span class="k-job__sentence">${summary}</span>` : null}
      <span class="k-job__marks"><${HandoffTag} id=${job.handoff} /><${StageMark} n=${job.stage} />${dim
        ? html`<span class="k-job__blocked" aria-hidden="true"><${Icon} name="lock" size=${14} />Cannot start yet</span>` : null}</span>
    </span>
    ${dim ? html`<span class="k-sr">. Cannot start yet${why ? `: ${why}` : "."}</span>` : null}
    ${href ? html`<span class="k-job__go" aria-hidden="true">Open</span>` : null}`;
  const cls = cx("k-job", "k-job--row", dim && "k-job--dim");
  return href
    ? html`<a class=${cls} href=${href} data-dept=${dept || undefined} title=${dim && why ? why : undefined}>${inner}</a>`
    : html`<span class=${cls} data-dept=${dept || undefined}>${inner}</span>`;
}

// PLAN-COOK TB3: a job's tile glyph, by its stage (the build order the owner reads in the legend): filling the
// company brain is a form, taking in is the inbox, making is a spark, handing on is sending.
const STAGE_GLYPHS = Object.freeze({ 1: "form", 2: "inbox", 3: "spark", 4: "send" });
export const stageGlyph = (n) => STAGE_GLYPHS[Number(n)] || "jobs";
// R5-F: the tile's quiet tint, by its stage (the kit's tint for "stage-<n>", so each of the four stages has its own,
// the same every time); a job with no known stage is neutral. Identity, never a state.
export const stageTint = (n) => (Object.hasOwn(STAGES, String(Number(n))) ? tintFor(`stage-${Number(n)}`) : "neutral");

// A job as a card's body (the page gives the frame): the tile, the name as the card's one link (its ::after
// covers the card, so the whole card answers the click and the keyboard stops once, on the name), the sentence on
// two lines, the hand-off and the stage as neutral chips, and, for a job that cannot start yet, why, with its own
// link standing above the card's.
export function JobCard({ job }) {
  if (!job || typeof job !== "object") return null;
  const dim = job.ready === false;
  const href = jobHref(job);
  const title = str(job.title).slice(0, 60);
  const summary = str(job.summary).replace(/\s+/g, " ").trim().slice(0, 200);
  const h = Object.hasOwn(HANDOFFS, str(job.handoff)) ? HANDOFFS[job.handoff] : null;
  const s = Object.hasOwn(STAGES, String(job.stage)) ? STAGES[job.stage] : null;
  return html`<div class=${cx("k-jobcard", dim && "k-jobcard--dim")}>
    <span class="k-jobcard__tile"><${Tile} icon=${stageGlyph(job.stage)} tint=${stageTint(job.stage)} size=${28} /></span>
    <div class="k-jobcard__body">
      <h3 class="k-jobcard__title">${href
        ? html`<a class="k-jobcard__link" href=${href}>${title}${dim ? html`<span class="k-sr"> (cannot start yet)</span>` : null}</a>`
        : html`<span>${title}</span>`}</h3>
      ${summary ? html`<p class="k-jobcard__sentence">${summary}</p>` : null}
      ${h || s ? html`<p class="k-jobcard__marks">
        ${h ? html`<${Tag}>${h.label}<//>` : null}
        ${s ? html`<${Tag}><span class="k-sr">Stage ${Number(job.stage)}: </span>${s.label}<//>` : null}
      </p>` : null}
      ${dim && job.why ? html`<div class="k-jobcard__why"><${WhyNot} why=${job.why} /></div>` : null}
    </div>
  </div>`;
}

// The "can run" chip on a department's page: the department's line icon and the job's name.
export function JobChip({ job }) {
  if (!job || typeof job !== "object") return null;
  const href = jobHref(job);
  const dim = job.ready === false;
  const dept = deptOf(job) || undefined;
  const inner = html`<span class="k-job__dot" aria-hidden="true"><${Icon} name=${dim ? "lock" : deptIcon(dept)} size=${14} /></span><span class="k-job__chip-text">${str(job.title).slice(0, 60)}</span>
    ${dim ? html`<span class="k-sr"> (cannot start yet)</span>` : null}`;
  const cls = cx("k-job", "k-job--chip", dim && "k-job--dim");
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

// PLAN-COOK TB3: what an empty question shows, by its kind (a job's file gives no example of its own).
export const ASK_PLACEHOLDERS = Object.freeze({
  text: "Write it as you would say it. A few lines are enough.",
  line: "One short line",
});

function AskField({ ask, value, error, disabled, onValue, fromText }) {
  const label = ask.required ? ask.label : `${ask.label} (optional)`;
  const set = (e) => onValue(String(e.target.value));
  if (fromText) {
    return html`<${Field} label=${label}><p class="k-job__from"><${Icon} name="link" size=${14} /><span>${fromText}</span></p><//>`;
  }
  if (ask.kind === "text") {
    return html`<${Field} label=${label} error=${error}><${TextArea} autoGrow maxlength=${2000} value=${value} disabled=${disabled}
      placeholder=${ASK_PLACEHOLDERS.text} onInput=${set} /><//>`;
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
  return html`<${Field} label=${label} error=${error}><${TextInput} maxlength=${200} value=${value} disabled=${disabled}
    placeholder=${ASK_PLACEHOLDERS.line} onInput=${set} /><//>`;
}

// PLAN-COOK TB3, R5-F: the preview of what will be asked as plain words at 13 px on 20: the template's numbered steps
// as a list, an answer in the accent ink, a question not answered yet as its words underlined in their place (no
// chip); a long one held to a set height with "Show all". The words are the job's own, every piece a text node.
const PREVIEW_LONG = 360;
const Piece = ({ p }) => p.blank !== undefined
  ? html`<span class="k-job__blank">${p.blank}</span>`
  : p.value !== undefined ? html`<span class="k-job__value">${p.value}</span>` : p.text;

function Preview({ job, answers }) {
  const [all, setAll] = useState(false);
  const pieces = previewPieces(job, answers);
  const blocks = previewBlocks(pieces);
  const long = pieces.reduce((t, p) => t + str(p.text || p.value || p.blank).length, 0) > PREVIEW_LONG;
  const pieceList = (list) => list.map((p, i) => html`<${Piece} key=${i} p=${p} />`);
  return html`<details class="k-job__preview">
    <summary class="k-job__preview-head"><${Icon} name="chevron-right" size=${14} class="k-job__fold" /><span>What will be asked</span></summary>
    <div class=${cx("k-job__preview-text", long && !all && "k-job__preview-text--capped")}>
      ${blocks.map((b, i) => b.kind === "steps"
        ? html`<ol key=${i} class="k-job__steps">${b.items.map((it, j) => html`<li key=${j} value=${it.n}>${pieceList(it.pieces)}</li>`)}</ol>`
        : html`<p key=${i} class="k-job__para">${pieceList(b.pieces)}</p>`)}
    </div>
    ${long ? html`<div class="k-job__preview-more">
      <${Button} size="sm" variant="quiet" aria-expanded=${all ? "true" : "false"} onClick=${() => setAll(!all)}>${all ? "Show less" : "Show all"}<//>
    </div>` : null}
  </details>`;
}

const offline = (e) => Boolean(e && (e.offline || e.code === "not_set_up" || Number(e.status) >= 502));

// The start form. `from` is the earlier task this one follows (a task id or identifier), when the owner came
// from "What can come next". `onStarted(answer)` gets the server's 201 answer. `queue` is the Chief of staff's line
// as the server sent it with the job ({ ahead }), for the line under Start.
// A job that cannot start yet (not ready, or it follows earlier work with nothing to pick) keeps its questions
// switched off, with the one sentence that says why (M63 item 13).
// `extra` is an object merged into the start request (the job page sends `versions` this way); `before` is a node
// shown just above the Start button.
export function JobStart({ job, from, onStarted, queue = null, extra = null, before = null, timed = true }) {
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
    if (extra && typeof extra === "object") Object.assign(body, extra);
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

  const off = !ready || !!blocked;
  return html`<form ref=${form} class=${cx("k-job", "k-job--start", off && "k-job--dim")} onSubmit=${start} novalidate>
    ${!ready ? html`<${WhyNotice} why=${job.why} />` : null}
    ${asks.length
      ? html`<div class=${cx("k-job__asks", off && "k-job__asks--off")}>${asks.map((a) => html`<${AskField} key=${a.id} ask=${a} value=${str(answers[a.id])} error=${errors[a.id]}
          disabled=${off || sending} fromText=${fromAsk && a.id === fromAsk.id ? fromText : null} onValue=${(v) => setOne(a.id, v)} />`)}</div>`
      : null}
    <${Reads} reads=${job.reads} />
    ${str(job.text) ? html`<${Preview} job=${job} answers=${previewAnswers} />` : null}
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
      : html`${before}<div class="k-job__actions">
          <p class="k-job__under">${!ready ? CANNOT_START : sending ? "Sending…" : underStart(queue, timed)}</p>
          <${Button} type="submit" variant="primary" icon="play" busy=${sending} disabled=${!ready || !href}>Start<//>
        </div>`}
  </form>`;
}
