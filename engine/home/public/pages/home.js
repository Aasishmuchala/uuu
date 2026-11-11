// Home: the greeting, what needs the owner, what is running, the daily brief, and the composer at the bottom.
// Data: GET /api/home (CONTRACTS-V2 17.2) every 10 seconds; the composer's lists from GET /api/gallery and shell.team.
// Everything shown here came from agents or the board: it is rendered as text only, and lists are capped.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { greeting } from "../lib/format.js";
import {
  BriefCard,
  Button,
  Composer,
  DecisionCard,
  Empty,
  ErrorNotice,
  Loading,
  NextStep,
  NotConnected,
  PageHeader,
  Section,
  TaskRow,
} from "../kit/index.js";

export const FIRST = 5; // Needs-you items shown before "Show all"
const MAX_ITEMS = 20;
const MAX_RUNNING = 10;
const MAX_BRIEF = 8;
const MAX_TEXT = 600;

const SOURCE_WORDS = {
  board: "Agents' work",
  goal: "Tasks",
  books: "Books",
  customers: "Customers",
  people: "People",
  support: "Support",
  marketing: "Marketing",
  studio: "Studio",
};

const text = (v, max = MAX_TEXT) => {
  const s = v === null || v === undefined ? "" : String(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const list = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object").slice(0, max) : []);

// The Needs-you items on screen: the first five, or all of them once "Show all" is pressed.
export function visible(items, expanded) {
  const all = Array.isArray(items) ? items : [];
  return expanded ? all : all.slice(0, FIRST);
}

// The title of "Running now".
export function runningTitle(n) {
  const v = Number(n) || 0;
  if (v <= 0) return "Nothing is running";
  return v === 1 ? "1 task running" : `${v} tasks running`;
}

// The one line under "Nothing needs you right now.", from the shell's team rows.
export function workingLine(team) {
  const rows = Array.isArray(team) ? team : [];
  const n = rows.filter((t) => t && t.state === "working").length;
  if (!rows.length) return "";
  if (n === 0) return "No agent is working right now.";
  return n === 1 ? "1 agent is working." : `${n} agents are working.`;
}

// The composer's ready-made list: every gallery goal, department by department.
export function templatesFrom(gallery) {
  const out = [];
  for (const d of list(gallery && gallery.departments, 20)) {
    for (const g of list(d.goals, 200)) {
      if (g.id && g.title) out.push({ ...g, department: d.id, departmentTitle: d.title });
    }
  }
  return out;
}

// Items the owner has just handled stay in place, as one plain line, until the page is left,
// even after a refresh no longer lists them. `handled` maps id → { item, index }.
export function keepHandled(items, handled) {
  const out = (Array.isArray(items) ? items : []).filter((i) => !(handled && handled[i.id]));
  const done = Object.values(handled || {}).sort((a, b) => a.index - b.index);
  for (const h of done) out.splice(Math.min(h.index, out.length), 0, h.item);
  return out;
}

// The body sent by the composer: only the keys POST /api/goals takes, and only when set.
export function goalBody({ text: t, to, planFirst, template } = {}) {
  const body = { text: String(t || "").trim() };
  if (to && to !== "chief-of-staff") body.to = String(to);
  if (planFirst) body.planFirst = true;
  if (template) body.template = String(template);
  return body;
}

function NeedsYou({ data, team, onHandled }) {
  const [expanded, setExpanded] = useState(false);
  const [handled, setHandled] = useState({});
  const items = keepHandled(list(data.items, MAX_ITEMS), handled);
  const total = Math.max(Number(data.total) || 0, items.length);
  const waiting = items.filter((i) => !handled[i.id]).length;
  const notConnected = list(data.notConnected, 10);
  const shown = visible(items, expanded);

  const done = (item, index) => ({ message }) => {
    setHandled((h) => ({ ...h, [item.id]: { item, index } }));
    onHandled(message);
  };

  return html`<${Section} title="Needs you" count=${waiting}>
    ${shown.length > 0
      ? html`<div class="p-home__decisions">
          ${shown.map((item, i) => html`<${DecisionCard} key=${item.id} item=${item} onDone=${done(item, i)} />`)}
        </div>`
      : html`<${Empty} title="Nothing needs you right now." text=${workingLine(team)} />`}
    ${!expanded && items.length > FIRST && html`<div class="p-home__more">
      <${Button} variant="quiet" onClick=${() => setExpanded(true)}>Show all ${total}<//>
    </div>`}
    ${expanded && total > items.length && html`<p class="p-home__caption">
      Showing the first ${items.length} of ${total}. The rest will show here as these are dealt with.
    </p>`}
    ${notConnected.length > 0 && html`<ul class="p-home__quiet">
      ${notConnected.map((n, i) => html`<li key=${i}>
        <span class="p-home__quiet-source">${SOURCE_WORDS[n.source] || "A part"}:</span> ${text(n.reason, 200)}
      </li>`)}
    </ul>`}
  <//>`;
}

function Running({ running }) {
  const rows = list(running, MAX_RUNNING);
  return html`<${Section} title=${runningTitle(rows.length)}>
    ${rows.length > 0
      ? html`<div class="p-home__running">
          ${rows.map((r) => html`<${TaskRow} key=${r.taskId || r.identifier} task=${{ ...r, id: r.taskId }} />`)}
        </div>`
      : html`<p class="p-home__caption">When an agent starts on a task, it shows here.</p>`}
  <//>`;
}

function Brief({ brief }) {
  const items = list(brief && brief.items, MAX_BRIEF);
  const computed = brief && brief.from === "computed";
  return html`<${Section} title="Daily brief" hint="Nothing to decide, just a glance.">
    ${items.length > 0
      ? html`<div class="p-home__brief">
          ${items.map((item, i) => html`<${BriefCard} key=${item.id || i} item=${item} />`)}
        </div>`
      : html`<${Empty} title="No brief yet." />`}
    ${computed && html`<p class="p-home__caption">
      Put together by the home screen. Switch on the Daily brief routine for a written one.${" "}
      <a href="#/routines/daily-brief">Open the Daily brief routine</a>
    </p>`}
  <//>`;
}

function Compose({ team, onGiven }) {
  const gallery = useResource("/api/gallery");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [given, setGiven] = useState(null);

  const send = async (input) => {
    const body = goalBody(input);
    if (!body.text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/api/goals", body);
      const goal = (res && res.goal) || {};
      setGiven({ id: goal.id || goal.identifier || "", identifier: text(goal.identifier, 40) });
      onGiven();
    } catch (e) {
      setError(e);
      throw e; // the composer keeps the text and shows the message; the next step shows above it
    } finally {
      setBusy(false);
    }
  };

  const agents = list(team, 40);
  return html`<div class="p-home__composer">
    ${given && html`<p class="p-home__given" role="status">
      Given to the Chief of staff.${" "}
      ${given.id && html`<a href=${`#/tasks/${encodeURIComponent(given.id)}`}>${given.identifier ? `Open ${given.identifier}` : "Open the task"}</a>`}
    </p>`}
    ${error && error.next && html`<${NextStep} text=${text(error.next, 300)} />`}
    <${Composer} onSend=${send} busy=${busy} agents=${agents} templates=${templatesFrom(gallery.data)} />
  </div>`;
}

export default function Page() {
  const app = useApp() || {};
  const shell = app.shell || null;
  const home = useResource("/api/home", { every: 10000 });
  const data = home.data;
  const team = shell && Array.isArray(shell.team) ? shell.team : [];
  const name = text((data && data.company && data.company.name) || (shell && shell.company && shell.company.name), 80);

  const refreshShell = () => { if (app.refreshShell) app.refreshShell(); };
  const handled = (message) => {
    if (message && app.announce) app.announce(text(message, 200));
    refreshShell();
    home.refresh();
  };
  const given = () => {
    if (app.announce) app.announce("Given to the Chief of staff.");
    refreshShell();
    home.refresh();
  };

  const boardOff = data && data.boardOff;
  return html`<div class="p-home">
      <${PageHeader} title=${`${greeting(new Date())}.`} lead=${name ? `Here is ${name} today.` : "Here is your company today."} />
      <div class="p-home__body">
        ${home.loading && !data && html`<${Loading} lines=${4} label="Loading Home" />`}
        ${!data && home.error && html`<${ErrorNotice} error=${home.error} onRetry=${home.reload} />`}
        ${data && html`
          ${boardOff && html`<${NotConnected} title="The task board is off"
            reason=${text(boardOff.reason, 300)} next=${text(boardOff.next, 300)} />`}
          <${NeedsYou} data=${data.needsYou || {}} team=${team} onHandled=${handled} />
          <${Running} running=${data.running} />
          <${Brief} brief=${data.brief} />
        `}
      </div>
      <${Compose} team=${team} onGiven=${given} />
    </div>`;
}
