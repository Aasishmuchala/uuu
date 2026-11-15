// An agent's page in one column (CONTRACTS-V2 17.5, CONTRACTS-V3 30 "Team and an agent"; PLAN-COOK T65 after
// R02 and R05, TB4): the head is one row (the 40 px avatar, the name, its state as a chip, then "Give it a task" and
// Pause) with what it does under it; then its work as one list with two group labels (what it is working on, its
// recent work: TaskRows), how it is set up (label and value rows: what it may and may not do as written, the model
// as a chip), its lessons, its standing instructions (folded) and the talk with its composer.
// The five parts of the old tabs (Talk, Profile, Work, Instructions, Lessons) are sections now; the address keeps
// `?tab=` (`#/team/<slug>?tab=lessons`) and opens the page at that section. The department comes from the map's
// answer (GET /api/map); the jobs the composer offers from that department's answer; the model from GET /api/models.
// Everything shown here was written by an agent or read from its files: it is rendered as text only (the
// instructions as Markdown, built as elements).
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { DeptChip, HealthNext, departmentOf, modelOf } from "./team.js";
import {
  AgentChip, AgentState, Avatar, Button, Composer, Conversation, Empty, ErrorNotice, Icon, Loading, Markdown,
  NotConnected, Notice, PageHeader, STARTED, Tag, TaskRow, TextInput, jobHref,
} from "../kit/index.js";

export const TABS = [
  { id: "talk", label: "Talk" },
  { id: "profile", label: "Profile" },
  { id: "work", label: "Work" },
  { id: "instructions", label: "Instructions" },
  { id: "lessons", label: "Lessons" },
];

// The words this page adds (T65): the sections' headings, the set-up rows' labels and the header's action.
export const WORDS = Object.freeze({
  working: "Working on",
  recent: "Recent work",
  setup: "How it is set up",
  lessons: "Lessons",
  instructions: "Instructions",
  readInstructions: "Read its standing instructions",
  talk: "Talk",
  give: "Give it a task",
  may: "What it may do",
  mayNot: "What it may not do",
  tool: "Works with",
  limits: "Limits",
  reports: "Reports to",
  dept: "Works in",
  model: "Model",
});

// The section each part of the old tabs became, by the address's `?tab=`.
export const sectionId = (tab) => `p-agent-${TABS.some((t) => t.id === tab) ? tab : "talk"}`;

const CHIEF = "chief-of-staff";
const MAX_TEXT = 20000; // what is shown of one block of agent-written text
const MAX_LESSON = 500;

const text = (v) => (v === null || v === undefined ? "" : String(v));
const cap = (v, n = MAX_TEXT) => {
  const s = text(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

// The tab the address asks for; anything else is Talk.
export function pickTab(query) {
  const wanted = query && typeof query.get === "function" ? query.get("tab") : null;
  return TABS.some((t) => t.id === wanted) ? wanted : "talk";
}

// The address of a tab on this agent's page.
export function tabHref(slug, tab) {
  const base = `#/team/${encodeURIComponent(slug)}`;
  return tab && tab !== "talk" ? `${base}?tab=${tab}` : base;
}

// The limits in one plain sentence: "Works on one task at a time, for up to 15 minutes a run."
export function limitsSentence(limits) {
  const l = limits || {};
  const first = l.oneAtATime === false ? "Works on more than one task at a time" : "Works on one task at a time";
  const m = Number(l.runMinutes);
  if (!Number.isFinite(m) || m <= 0) return `${first}.`;
  return `${first}, for up to ${m} ${m === 1 ? "minute" : "minutes"} a run.`;
}

// Pause or Resume for an agent, or null when there is nothing to offer (not set up on the board yet).
export function pauseAction(agent) {
  if (!agent || agent.applied === false || !agent.id) return null;
  return agent.state === "paused" || agent.state === "problem" ? "resume" : "pause";
}

// The jobs the composer offers ("/"): those of the agent's department (shape `department`, 33.2) that this agent
// does; the Chief of staff also gets the ones nobody is named for, since it plans those itself. Ready ones first.
export function jobsFor(department, slug) {
  const all = ((department && department.clusters) || []).flatMap((c) => (c && Array.isArray(c.jobs) ? c.jobs : []))
    .filter((j) => j && typeof j.id === "string");
  const mine = all.filter((j) => {
    const who = Array.isArray(j.who) ? j.who.map((w) => (typeof w === "string" ? w : w && w.slug)) : [];
    return who.includes(slug) || (slug === CHIEF && who.length === 0);
  });
  return [...mine.filter((j) => j.ready !== false), ...mine.filter((j) => j.ready === false)];
}

// The body of POST /api/goals from this page. The Chief of staff gets no `to`: it hands out the work itself.
export function goalBody({ text: t, planFirst, template } = {}, slug) {
  const body = { text: text(t) };
  if (slug && slug !== CHIEF) body.to = slug;
  if (planFirst) body.planFirst = true;
  if (template) body.template = template;
  return body;
}

export function composerPlaceholder(name) {
  return `Hand ${text(name) || "this agent"} a task.  /  for its jobs`;
}

// A lesson as the owner may type it: one line, 1 to 500 characters. Returns a plain problem, or "".
export function lessonProblem(value) {
  const s = text(value);
  if (/[\u0000-\u001f\u007f]/.test(s)) return "Keep a lesson to one line.";
  const t = s.trim();
  if (!t) return "Write the lesson first.";
  if (t.length > MAX_LESSON) return `Keep a lesson under ${MAX_LESSON + 1} characters.`;
  return "";
}

function PauseButton({ agent, onChanged }) {
  const { announce, refreshShell } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const verb = pauseAction(agent);
  if (!verb) return null;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/company/agents/${encodeURIComponent(agent.id)}/${verb}`, {});
      announce(verb === "pause" ? `${agent.name} is paused.` : `${agent.name} is back at work.`);
      refreshShell();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="p-agent__pause">
    <${Button} variant="ghost" busy=${busy} onClick=${go}>
      ${verb === "pause" ? "Pause" : "Resume"}
    <//>
    ${error && html`<p class="p-agent__error" role="alert">${text(error.message)}</p>`}
  </div>`;
}

// The words under the header: a note only when the board answered and does not have the agent (applied false).
// With the board off `applied` is null: not known, and the page's notice says why instead.
export function headerNote(agent) {
  return agent && agent.applied === false ? "Not set up yet." : "";
}

function Reports({ agent }) {
  const reports = agent.reportsTo && agent.reportsTo.slug ? agent.reportsTo : null;
  return reports ? html`<${AgentChip} agent=${reports} />` : html`<span>you</span>`;
}

// Focus the composer at the foot of the page (the header's "Give it a task").
function toComposer() {
  if (typeof document === "undefined") return;
  const at = document.getElementById(sectionId("talk"));
  const box = at && at.querySelector("textarea");
  if (at && typeof at.scrollIntoView === "function") at.scrollIntoView({ block: "start", behavior: "auto" });
  if (box) box.focus({ preventScroll: true });
}

// The top, one row: the avatar inside the title, the state as a chip beside it, then "Give it a task" (the one
// primary) and Pause; what it does under the row, in balanced lines.
function Header({ data, onChanged }) {
  const a = data.agent;
  const note = headerNote(a);
  const name = text(a.name) || "Agent";
  const title = html`<span class="p-agent__title"><${Avatar} slug=${a.slug} name=${a.name} size=${40} /><span>${name}</span></span>`;
  return html`<div class="p-agent__head">
    <${PageHeader} title=${title} lead=${cap(a.summary, 400)}
      crumbs=${[{ label: "Team", href: "#/team" }, { label: name }]}
      actions=${html`<span class="p-agent__state"><${AgentState} agent=${a} chip /></span>
        <span class="p-agent__acts">
          <${Button} variant="primary" icon="send" onClick=${toComposer}>${WORDS.give}<//>
          <${PauseButton} agent=${a} onChanged=${onChanged} />
        </span>`}>
      ${note && html`<p class="p-agent__note">${note} <a href="#/health">Open Health</a></p>`}
    <//>
  </div>`;
}

function Talk({ data, dept, onSent }) {
  const { refreshShell, announce } = useApp();
  const department = useResource(dept ? `/api/map/${encodeURIComponent(dept.id)}` : null);
  const [busy, setBusy] = useState(false);
  const [given, setGiven] = useState(null);
  const a = data.agent;
  const messages = (data.conversation || []).map((m) => ({ ...m, text: cap(m.text) }));

  async function send(input) {
    setBusy(true);
    setGiven(null);
    try {
      const out = await api.post("/api/goals", goalBody(input, a.slug));
      setGiven(out && out.goal ? out.goal : {});
      announce(STARTED);
      refreshShell();
      onSent();
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="p-agent__talk">
    <div class="p-agent__convo">
      ${messages.length
        ? html`<${Conversation} messages=${messages} />`
        : html`<${Empty} title="Nothing said yet" text=${`Tasks you hand to ${a.slug === CHIEF ? "the Chief of staff" : text(a.name)}, and what it says about them, show here.`} />`}
    </div>
    <div class="p-agent__compose">
      ${given && html`<p class="p-agent__given" role="status">${STARTED}${given.id
        ? html` <a href=${`#/tasks/${encodeURIComponent(given.id)}`}>See the task${given.identifier ? ` ${text(given.identifier)}` : ""}</a>`
        : null}</p>`}
      <${Composer}
        placeholder=${composerPlaceholder(a.name)}
        to=${a.slug === CHIEF ? undefined : a.slug}
        agents=${a.slug === CHIEF ? [] : [{ slug: a.slug, name: text(a.name) || a.slug }]}
        templates=${jobsFor(department.data, a.slug)}
        onPickJob=${(job) => { const href = jobHref(job); if (href && typeof location !== "undefined") location.hash = href; }}
        busy=${busy}
        onSend=${send} />
      <p class="p-agent__caption">${a.slug === CHIEF
        ? "The Chief of staff hands it to the right agent, and the Checker checks the work."
        : "It goes through the Chief of staff, so the Checker still checks it."}</p>
    </div>
  </div>`;
}

function SentenceList({ items, empty }) {
  const list = (items || []).map((s) => cap(s, 400)).filter(Boolean);
  if (!list.length) return html`<p class="p-agent__muted">${empty}</p>`;
  return html`<ul class="p-agent__list">${list.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul>`;
}

// One label and its value, as a row of the set-up panel.
const Fact = ({ label, children }) => html`<div class="p-agent__fact"><dt class="p-agent__label">${label}</dt><dd class="p-agent__value">${children}</dd></div>`;

// How it is set up: label and value rows. What it may and may not do are shown exactly as written.
function Setup({ data, dept, model }) {
  const p = data.profile || {};
  const tool = p.tool || null;
  const a = data.agent || {};
  return html`<dl class="p-agent__facts">
    <${Fact} label=${WORDS.may}><${SentenceList} items=${p.may} empty="Nothing is written down yet." /><//>
    <${Fact} label=${WORDS.mayNot}><${SentenceList} items=${p.mayNot} empty="Nothing is written down yet." /><//>
    ${tool && tool.label && html`<${Fact} label=${WORDS.tool}>
      <p>${cap(tool.label, 120)}</p>
      ${tool.installed === false && html`<p class="p-agent__warn">Not installed yet.</p>`}
    <//>`}
    <${Fact} label=${WORDS.limits}><p>${limitsSentence(p.limits)}</p><//>
    ${model && html`<${Fact} label=${WORDS.model}><span class="p-agent__model"><${Tag}>${model}<//></span><//>`}
    <${Fact} label=${WORDS.reports}><${Reports} agent=${a} /><//>
    ${dept && html`<${Fact} label=${WORDS.dept}><${DeptChip} department=${dept} /><//>`}
  </dl>`;
}

function Working({ data }) {
  const a = data.agent;
  const recent = (data.recent || []).filter((t) => t && t.id);
  const nowId = a.doingNow && a.doingNow.taskId;
  const doing = nowId ? recent.find((t) => t.id === nowId) : null;
  if (doing) return html`<ul class="p-agent__rows"><li class="p-agent__row"><${TaskRow} task=${doing} /></li></ul>`;
  if (a.doingNow && a.doingNow.title) {
    return html`<p class="p-agent__now">${nowId
      ? html`<a href=${`#/tasks/${encodeURIComponent(nowId)}`}>${cap(a.doingNow.title, 200)}</a>`
      : cap(a.doingNow.title, 200)}</p>`;
  }
  return html`<p class="p-agent__muted">Nothing right now.</p>`;
}

// The recent work, less the task it is working on now (that one is shown just above).
export function recentOthers(recent, doingNow) {
  const nowId = doingNow && doingNow.taskId;
  return (Array.isArray(recent) ? recent : []).filter((t) => t && t.id && t.id !== nowId);
}

function Recent({ data }) {
  const a = data.agent;
  const recent = recentOthers(data.recent, a.doingNow);
  return recent.length
    ? html`<ul class="p-agent__rows">${recent.map((t) => html`<li key=${t.id} class="p-agent__row"><${TaskRow} task=${t} /></li>`)}</ul>`
    : html`<${Empty} title="No work yet" text=${`Tasks ${text(a.name)} has worked on show here.`} />`;
}

function Instructions({ data, open }) {
  const ins = data.instructions || {};
  return html`<details class="p-agent__instructions" open=${open}>
    <summary class="p-agent__fold"><${Icon} name="chevron-right" size=${16} class="p-agent__fold-mark" /><span>${WORDS.readInstructions}</span></summary>
    <div class="p-agent__fold-body">
      <p class="p-agent__caption">Standing instructions, written for the agent. They are changed in the company's files.</p>
      ${text(ins.text)
        ? html`<div class="p-agent__text"><${Markdown} text=${cap(ins.text, 200000)} /></div>`
        : html`<p class="p-agent__muted">No instructions are written for this agent yet.</p>`}
    </div>
  </details>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A lesson's date is a calendar day with no time ("2026-11-10"): show it as "10 Nov 2026",
// read straight from the text so no clock time or time zone shift is ever added. Anything else is shown as written, capped.
export function lessonDate(value) {
  const s = text(value).trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return cap(s, 40);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return cap(s, 40);
  return `${day} ${MONTHS[month - 1]} ${m[1]}`;
}

// One lesson: its date and text; Edit opens a field in place, Delete asks once.
function LessonRow({ slug, lesson, onChanged, onProblem }) {
  const [mode, setMode] = useState("view"); // view | edit | confirm
  const [draft, setDraft] = useState(lesson.text || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/team/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lesson.n)}`;

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode("view");
      onChanged();
    } catch (err) {
      if (err && err.code === "lesson_changed") {
        onProblem(err);
        onChanged();
      } else setError(text(err && err.message) || "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const save = () => {
    const problem = lessonProblem(draft);
    if (problem) return setError(problem);
    return run(() => api.post(base, { text: draft.trim(), hash: lesson.hash }));
  };
  const remove = () => run(() => api.del(`${base}?hash=${encodeURIComponent(lesson.hash)}`));
  const onKey = (e) => {
    if (e.key === "Escape") { setMode("view"); setDraft(lesson.text || ""); setError(""); }
    if (e.key === "Enter") { e.preventDefault(); save(); }
  };

  return html`<li class="p-agent__lesson">
    ${mode === "edit"
      ? html`<div class="p-agent__lesson-edit">
          <${TextInput} value=${draft} maxLength=${MAX_LESSON} aria-label="Lesson" autoFocus
            onInput=${(e) => setDraft(e.currentTarget.value)} onKeyDown=${onKey} />
          <div class="u-row">
            <${Button} variant="primary" size="sm" busy=${busy} onClick=${save}>Save<//>
            <${Button} variant="quiet" size="sm" onClick=${() => { setMode("view"); setDraft(lesson.text || ""); setError(""); }}>Cancel<//>
          </div>
        </div>`
      : html`<div class="p-agent__lesson-view">
          <p class="p-agent__lesson-text">${cap(lesson.text, 1000)}</p>
          <p class="p-agent__lesson-date">${lessonDate(lesson.date) || "No date"}</p>
        </div>
        <div class="p-agent__lesson-actions u-row">
          ${mode === "confirm"
            ? html`<span class="p-agent__muted">Delete this lesson?</span>
                <${Button} variant="danger" size="sm" busy=${busy} onClick=${remove}>Delete<//>
                <${Button} variant="quiet" size="sm" onClick=${() => setMode("view")}>Keep it<//>`
            : html`<${Button} variant="quiet" size="sm" onClick=${() => { setDraft(lesson.text || ""); setMode("edit"); }}>Edit<//>
                <${Button} variant="quiet" size="sm" onClick=${() => setMode("confirm")}>Delete<//>`}
        </div>`}
    ${error && html`<p class="p-agent__error" role="alert">${error}</p>`}
  </li>`;
}

function Lessons({ data, onChanged }) {
  const { announce } = useApp();
  const slug = data.agent.slug;
  const lessons = (data.lessons || []).filter((l) => l && l.n);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problem, setProblem] = useState(null);

  async function add(e) {
    if (e) e.preventDefault();
    const p = lessonProblem(draft);
    if (p) return setError(p);
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/team/${encodeURIComponent(slug)}/lessons`, { text: draft.trim() });
      setDraft("");
      announce("Lesson added.");
      onChanged();
    } catch (err) {
      setError(text(err && err.message) || "That did not work.");
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return html`<div class="p-agent__lessons">
    <p class="p-agent__caption">${text(data.agent.name)} reads these before every task.</p>
    ${problem && html`<${Notice} tone="warn" title=${text(problem.message)}>${text(problem.next)}<//>`}
    ${lessons.length
      ? html`<ul class="p-agent__lesson-list">${lessons.map((l) => html`<${LessonRow} key=${`${l.n}:${l.hash}`}
          slug=${slug} lesson=${l} onChanged=${onChanged} onProblem=${setProblem} />`)}</ul>`
      : html`<${Empty} title="No lessons yet" text="Add one below, or let the agent write its own as it works." />`}
    <form class="p-agent__lesson-add" onSubmit=${add}>
      <${TextInput} value=${draft} maxLength=${MAX_LESSON} aria-label="A new lesson" placeholder="Add a lesson"
        onInput=${(e) => { setDraft(e.currentTarget.value); setError(""); }} />
      <${Button} type="submit" variant="plain" busy=${busy}>Add<//>
    </form>
    ${error && html`<p class="p-agent__error" role="alert">${error}</p>`}
  </div>`;
}

// A section of the column, found by the address's `?tab=`: its 17 px heading, then its body.
const Part = ({ tab, title, aside, children }) => html`<section class="p-agent__part" id=${sectionId(tab)}>
  <div class="p-agent__part-head">
    <h2 class="p-agent__part-title">${title}</h2>
    ${aside ? html`<div class="p-agent__part-aside">${aside}</div>` : null}
  </div>
  ${children}
</section>`;

const Count = ({ n }) => (n ? html`<span class="p-agent__count"><${Tag}>${n}<//></span>` : null);

// What it is working on and its recent work: one list in one panel, each part under a group label.
function Work({ data, recent, onlyNow }) {
  return html`<section class="p-agent__part p-agent__work" id=${sectionId("work")} aria-label="Its work">
    <div class="p-agent__group">
      <h2 class="p-agent__group-title">${WORDS.working}</h2>
      <${Working} data=${data} />
    </div>
    ${!onlyNow && html`<div class="p-agent__group">
      <h2 class="p-agent__group-title">${WORDS.recent}<${Count} n=${recent} /></h2>
      <${Recent} data=${data} />
    </div>`}
  </section>`;
}

export default function Page({ route }) {
  const { shell } = useApp();
  // The address is `#/team/<slug>`, so the slug is the second part.
  const parts = (route && route.parts) || [];
  const slug = text(parts[0] === "team" ? parts[1] : parts[0]);
  const asked = route && route.query && typeof route.query.get === "function" ? route.query.get("tab") : null;
  const tab = pickTab(route && route.query);
  const res = useResource(slug ? `/api/team/${encodeURIComponent(slug)}` : null, { every: 10000 });
  const map = useResource(slug ? "/api/map" : null);
  const models = useResource(slug ? "/api/models" : null);
  const d = res.data;
  const dept = departmentOf(slug, map.data && map.data.departments);
  const ready = Boolean(d);

  // An address with `?tab=` opens the page at that section, once the agent has answered.
  const went = useRef("");
  useEffect(() => {
    if (!ready || !asked || went.current === `${slug}:${tab}` || typeof document === "undefined") return;
    went.current = `${slug}:${tab}`;
    const el = document.getElementById(sectionId(tab));
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "auto" });
  }, [ready, asked, slug, tab]);

  // The title is drawn with its avatar, so the window's title is set here: "Marketer · Sthyra".
  const docName = d && d.agent ? text(d.agent.name).slice(0, 40) || "Agent" : "";
  const company = shell && shell.company ? text(shell.company.name).slice(0, 60) : "";
  useEffect(() => {
    if (docName && typeof document !== "undefined") document.title = [docName, company].filter(Boolean).join(" · ");
  }, [docName, company]);

  if (!d) {
    let body;
    if (res.error && res.error.status === 404) {
      body = html`<${Empty} title="That agent is not here" text="It may have left the company file.">
        <a href="#/team">See the team</a>
      <//>`;
    } else if (res.error) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
    else body = html`<${Loading} lines=${5} label="Loading the agent" />`;
    return html`<div class="p-agent">
      <${PageHeader} title=${res.error && res.error.status === 404 ? "Not found" : "Team"} back=${{ href: "#/team", label: "Team" }} />
      ${body}
    </div>`;
  }

  const a = d.agent || {};
  const lessons = (d.lessons || []).length;

  const recent = recentOthers(d.recent, a.doingNow).length;
  // With nothing but the task it is on now, the recent work is that task, already shown above.
  const onlyNow = !recent && (d.recent || []).some((t) => t && t.id && a.doingNow && t.id === a.doingNow.taskId);
  const refresh = () => res.refresh();

  return html`<div class="p-agent">
    ${d.connected === false && html`<${NotConnected} title="The board is switched off"
      reason=${text(d.notConnected && d.notConnected.reason) || "The board is switched off, so agents and tasks cannot be reached."}
      next=${html`<${HealthNext} text=${d.notConnected && d.notConnected.next} />`} />`}
    <${Header} data=${d} onChanged=${refresh} />
    <${Work} data=${d} recent=${recent} onlyNow=${onlyNow} />
    <${Part} tab="profile" title=${WORDS.setup}><${Setup} data=${d} dept=${dept} model=${modelOf(a.slug, models.data)} /><//>
    <${Part} tab="lessons" title=${html`${WORDS.lessons}<${Count} n=${lessons} />`}><${Lessons} data=${d} onChanged=${refresh} /><//>
    <${Part} tab="instructions" title=${WORDS.instructions}><${Instructions} data=${d} open=${tab === "instructions"} /><//>
    <${Part} tab="talk" title=${WORDS.talk}><${Talk} data=${d} dept=${dept} onSent=${refresh} /><//>
  </div>`;
}
