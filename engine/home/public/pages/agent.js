// An agent's page: who it is, and five tabs (Talk, Profile, Work, Instructions, Lessons). CONTRACTS-V2 17.5.
// The tab is in the address (`#/team/<slug>?tab=`), so every state can be opened without a click.
// Everything shown here was written by an agent or read from its files: it is rendered as text only.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  AgentChip, Avatar, Button, Card, Composer, Conversation, Empty, ErrorNotice, Live, Loading,
  Notice, PageHeader, Section, StatusDot, Tabs, TaskRow, TextInput, Waiting,
} from "../kit/index.js";

export const TABS = [
  { id: "talk", label: "Talk" },
  { id: "profile", label: "Profile" },
  { id: "work", label: "Work" },
  { id: "instructions", label: "Instructions" },
  { id: "lessons", label: "Lessons" },
];

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

// The ready-made goals of this agent's department only. The three with no department use the Company list.
export function goalsFor(gallery, agent) {
  const dept = (agent && agent.department) || "general";
  const d = ((gallery && gallery.departments) || []).find((x) => x && x.id === dept);
  return d && Array.isArray(d.goals) ? d.goals : [];
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
  return `Hand ${text(name) || "this agent"} a task.  /  for ready-made goals`;
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

// The agent's state as a mark: working, waiting for the owner, or its plain state.
function StateMark({ agent }) {
  if (agent.state === "working") return html`<${Live} />`;
  if (agent.waitingForYou || agent.state === "waiting_for_you") return html`<${Waiting} />`;
  const tone = agent.state === "problem" ? "bad" : agent.state === "paused" ? "warn" : "off";
  return html`<${StatusDot} tone=${tone} label=${text(agent.plainState) || "Free"} />`;
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
    <${Button} variant=${verb === "resume" ? "primary" : "plain"} busy=${busy} onClick=${go}>
      ${verb === "pause" ? "Pause" : "Resume"}
    <//>
    ${error && html`<p class="p-agent__error" role="alert">${text(error.message)}</p>`}
  </div>`;
}

function Header({ data, onChanged }) {
  const a = data.agent;
  const reports = a.reportsTo && a.reportsTo.slug ? a.reportsTo : null;
  return html`<div class="p-agent__head">
    <${Avatar} slug=${a.slug} name=${a.name} size=${72} />
    <div class="p-agent__who">
      <p class="p-agent__summary">${cap(a.summary, 400)}</p>
      <div class="p-agent__facts">
        <${StateMark} agent=${a} />
        <span class="p-agent__reports">Reports to ${reports ? html`<${AgentChip} agent=${reports} />` : "you"}</span>
      </div>
      ${a.applied === false && html`<p class="p-agent__note">Not set up yet. Run: engine setup</p>`}
    </div>
    <div class="p-agent__actions"><${PauseButton} agent=${a} onChanged=${onChanged} /></div>
  </div>`;
}

function TalkTab({ data, onSent }) {
  const { refreshShell, announce } = useApp();
  const gallery = useResource("/api/gallery");
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
      announce("Given to the Chief of staff.");
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
        : html`<${Empty} title="Nothing said yet" text=${`Tasks handed to ${text(a.name)}, and what it said about them, show here.`} />`}
    </div>
    <div class="p-agent__compose">
      ${given && html`<p class="p-agent__given" role="status">Given to the Chief of staff.${given.id
        ? html` <a href=${`#/tasks/${encodeURIComponent(given.id)}`}>See the task${given.identifier ? ` ${text(given.identifier)}` : ""}</a>`
        : null}</p>`}
      <${Composer}
        placeholder=${composerPlaceholder(a.name)}
        to=${a.slug === CHIEF ? undefined : a.slug}
        agents=${[]}
        templates=${goalsFor(gallery.data, a)}
        busy=${busy}
        onSend=${send} />
      <p class="p-agent__caption">It goes through the Chief of staff, so the Checker still checks it.</p>
    </div>
  </div>`;
}

function SentenceList({ items, empty }) {
  const list = (items || []).map((s) => cap(s, 400)).filter(Boolean);
  if (!list.length) return html`<p class="p-agent__muted">${empty}</p>`;
  return html`<ul class="p-agent__list">${list.map((s, i) => html`<li key=${i}>${s}</li>`)}</ul>`;
}

function ProfileTab({ data }) {
  const p = data.profile || {};
  const tool = p.tool || null;
  return html`<div class="p-agent__profile">
    <${Section} title="What it may do"><${SentenceList} items=${p.may} empty="Nothing is written down yet." /><//>
    <${Section} title="What it may not do"><${SentenceList} items=${p.mayNot} empty="Nothing is written down yet." /><//>
    <${Section} title="How it works">
      ${tool && tool.label && html`<p>Works with: ${cap(tool.label, 120)}</p>`}
      ${tool && tool.installed === false && html`<p class="p-agent__note">Not installed yet.</p>`}
      <p>${limitsSentence(p.limits)}</p>
    <//>
  </div>`;
}

function WorkTab({ data }) {
  const a = data.agent;
  const recent = (data.recent || []).filter((t) => t && t.id);
  const nowId = a.doingNow && a.doingNow.taskId;
  const doing = nowId ? recent.find((t) => t.id === nowId) : null;
  return html`<div class="p-agent__work">
    <${Section} title="Doing now">
      ${doing
        ? html`<${TaskRow} task=${doing} />`
        : a.doingNow && a.doingNow.title
          ? html`<p>${nowId
            ? html`<a href=${`#/tasks/${encodeURIComponent(nowId)}`}>${cap(a.doingNow.title, 200)}</a>`
            : cap(a.doingNow.title, 200)}</p>`
          : html`<p class="p-agent__muted">Nothing right now.</p>`}
    <//>
    <${Section} title="Recent work" count=${recent.length}>
      ${recent.length
        ? html`<ul class="p-agent__rows">${recent.map((t) => html`<li key=${t.id}><${TaskRow} task=${t} /></li>`)}</ul>`
        : html`<${Empty} title="No work yet" text=${`Tasks ${text(a.name)} has worked on show here.`} />`}
    <//>
  </div>`;
}

function InstructionsTab({ data }) {
  const ins = data.instructions || {};
  return html`<div class="p-agent__instructions">
    <p class="p-agent__caption">Standing instructions. They are changed in the company's files, then applied with: engine setup</p>
    <${Card} tone="sunken">
      ${text(ins.text)
        ? html`<pre class="p-agent__text u-mono">${cap(ins.text, 200000)}</pre>`
        : html`<p class="p-agent__muted">No instructions are written for this agent yet.</p>`}
    <//>
  </div>`;
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

function LessonsTab({ data, onChanged }) {
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
      <${Button} type="submit" variant="primary" busy=${busy}>Add<//>
    </form>
    ${error && html`<p class="p-agent__error" role="alert">${error}</p>`}
  </div>`;
}

export default function Page({ route }) {
  const slug = text(route && route.parts && route.parts[0]);
  const tab = pickTab(route && route.query);
  const res = useResource(slug ? `/api/team/${encodeURIComponent(slug)}` : null, { every: 10000 });
  const d = res.data;

  // Keep the address in step when a tab is picked, so the state can be shared and reopened.
  const pick = (id) => {
    if (typeof location !== "undefined") location.hash = tabHref(slug, id);
  };
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
  const counts = { lessons: (d.lessons || []).length, work: (d.recent || []).length };
  const tabs = TABS.map((t) => (counts[t.id] ? { ...t, count: counts[t.id] } : t));
  const refresh = () => res.refresh();

  let panel;
  if (tab === "profile") panel = html`<${ProfileTab} data=${d} />`;
  else if (tab === "work") panel = html`<${WorkTab} data=${d} />`;
  else if (tab === "instructions") panel = html`<${InstructionsTab} data=${d} />`;
  else if (tab === "lessons") panel = html`<${LessonsTab} data=${d} onChanged=${refresh} />`;
  else panel = html`<${TalkTab} data=${d} onSent=${refresh} />`;

  return html`<div class=${`p-agent p-agent--${tab}`}>
    <${PageHeader} title=${text(a.name) || "Agent"} back=${{ href: "#/team", label: "Team" }} />
    <${Header} data=${d} onChanged=${refresh} />
    <${Tabs} tabs=${tabs} current=${tab} onChange=${pick} label=${`About ${text(a.name)}`} />
    <div class="p-agent__panel">${panel}</div>
  </div>`;
}
