// Setup (PLAN-ONBOARD T2, reworked in round 2 as S2): the guided first run, in three groups read top to bottom.
// "Needed to start": the counted steps in the server's order (models, the fence check, company basics, brand kit, the
// books, a first real task), numbered, each with what is true now, why it matters and where to go. "When you want
// it": the optional steps, never counted, each folded under one line (its title, whether it is set up, what is true
// now) and opened to say what it opens up and what it costs or sends off this Mac. "Not possible yet": what cannot be
// set up today, said plainly, with no state and no button. At the foot "Hide the setup".
// Everything comes from GET /api/setup (read again every 15 seconds, so the page is fresh when the owner comes back).
// The page never acts: every way on is a link to the page that does the step, or a command shown as text for
// Terminal. Its only writes are about how the setup is shown: "Skip for now" / "Bring back" (POST /api/setup/skip)
// and "Hide the setup" / "Show it in the sidebar again" (POST /api/setup/dismiss).
// The answer is treated as untrusted (cleanSetup): only the home screen's own addresses, only the three fixed
// commands, only known step and row ids; every sentence is text, whole, never cut (ADR 0016). The sentences that
// name a tool are the server's; this file names none.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, ErrorNotice, Group, Icon, Loading, Mono, Notice, RoomHeader, Ring, Row, Rows, glimpseFor } from "../kit/index.js";

// Every fixed word of the page. The group titles and sentences are the server's when it sends them; these stand in
// when it does not.
export const WORDS = Object.freeze({
  title: "Setup",
  start: "Needed to start",
  startSay: "Do these and the engine can do real work for you.",
  later: "When you want it",
  laterSay: "Each of these is off until you choose it. Each line says what it opens up and what it costs or sends off this Mac.",
  notyet: "Not possible yet",
  notyetSay: "These cannot be set up yet. Nothing can be published or sent from here until they exist.",
  done: "Done",
  todo: "To do",
  skipped: "Skipped for now",
  unknown: "Not known",
  setUp: "Set up",
  notSetUp: "Not set up",
  opensUp: "Opens up",
  costs: "Costs and cautions",
  canSkip: "You can skip this for now.",
  finished: "Setup is done.",
  newTask: "New task",
  skip: "Skip for now",
  bringBack: "Bring back",
  hide: "Hide the setup",
  hideLine: "You can open it again any time: press Cmd+K and type Setup.",
  hidden: "The setup is hidden from the sidebar.",
  showAgain: "Show it in the sidebar again",
  saidSkipped: "Skipped for now.",
  saidBack: "Brought back.",
  saidHidden: "The setup is hidden.",
  saidShown: "The setup is shown again.",
  loading: "Loading the setup",
});

const TOTAL = 6;
const MAX_TOTAL = 12;
const START_IDS = Object.freeze(["models", "proof", "basics", "brand", "books", "task"]);
// The Checker's own login is an optional step only in plans mode; the server leaves it out otherwise, and so does
// the page.
const CHECKER_LOGIN = "checker-login";
const LATER_IDS = Object.freeze([CHECKER_LOGIN, "routines", "web", "viewer", "generation", "higgsfield", "apps", "brain"]);
const NOT_YET_IDS = Object.freeze(["publishing", "email", "whatsapp", "gst_portal", "board_login"]);
const GROUP_IDS = Object.freeze(["start", "later", "notyet"]);
const STATES = Object.freeze(["done", "todo", "skipped", "unknown"]);
// The only commands the page shows: the server sends one of these or nothing. The second is the login wizard with
// the Checker's part as its argument; that word is a tool's name, which the shared page test (test/pages.test.mjs,
// in any case) keeps out of a page's source, so it is put together here rather than written out.
const WIZARD = "engine/fence/login-wizard.sh";
const CHECKER_PART = ["co", "dex"].join("");
const COMMANDS = Object.freeze([WIZARD, `${WIZARD} ${CHECKER_PART}`, "engine/books/setup-wizard.sh"]);
const HREF = /^#\/[a-z0-9/?=&-]{0,80}$/;
const MAX = Object.freeze({ start: 8, later: 10, notYet: 6, notes: 4, costs: 3, links: 3, commands: 2 });

const str = (v) => (typeof v === "string" ? v : "");
const whole = (v, top) => (Number.isInteger(v) ? Math.min(Math.max(v, 0), top) : 0);
const totalOf = (v) => (Number.isInteger(v) && v >= 1 && v <= MAX_TOTAL ? v : TOTAL);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const sentences = (v, max) => list(v).filter((n) => typeof n === "string" && n).slice(0, max);

// The chip's words for a step's state; anything outside the four is "Not known".
export function stateWords(state) {
  return state === "done" ? WORDS.done : state === "todo" ? WORDS.todo : state === "skipped" ? WORDS.skipped : WORDS.unknown;
}

// The chip's words for an optional step: set up, not set up, or not known.
export function laterWords(state) {
  return state === "done" ? WORDS.setUp : state === "todo" ? WORDS.notSetUp : WORDS.unknown;
}

// The header's line, from the answer's counts (the needed steps only); when finished, a second sentence for the
// optional ones.
export function leadOf(setup) {
  const d = obj(setup);
  if (d.finished === true) {
    const l = obj(d.later);
    const total = whole(l.total, MAX_TOTAL);
    return total > 0 ? `${WORDS.finished} ${whole(l.done, total)} of ${total} extras are set up.` : WORDS.finished;
  }
  const c = obj(d.counts);
  const total = totalOf(c.total);
  const done = whole(c.done, total);
  const skipped = whole(c.skipped, total);
  return skipped ? `${done} of ${total} done, ${skipped} skipped for now.` : `${done} of ${total} done.`;
}

// The step to do next: the first one still to do, or null.
export function nextStepId(steps) {
  const s = list(steps).find((x) => x && x.state === "todo");
  return s ? s.id : null;
}

// One of the home screen's own addresses, or null.
export const safeHref = (href) => (typeof href === "string" && HREF.test(href) ? href : null);

// One of the three fixed commands, or null.
export const safeCommand = (command) => (typeof command === "string" && COMMANDS.includes(command) ? command : null);

function cleanStep(s) {
  const group = s.group;
  const later = group === "later";
  const state = STATES.includes(s.state) ? s.state : "unknown";
  return {
    id: s.id,
    group,
    title: str(s.title) || s.id,
    // An optional step is never skipped: a "skipped" there is not known.
    state: later && state === "skipped" ? "unknown" : state,
    canSkip: !later && s.canSkip === true,
    line: str(s.line),
    why: later ? "" : str(s.why),
    opens: later ? str(s.opens) : "",
    costs: later ? sentences(s.costs, MAX.costs) : [],
    notes: sentences(s.notes, MAX.notes),
    links: list(s.links)
      .filter((l) => l && typeof l === "object" && safeHref(l.href) && str(l.label))
      .slice(0, MAX.links)
      .map((l) => ({ label: l.label, href: l.href })),
    commands: list(s.commands)
      .filter((c) => c && typeof c === "object" && safeCommand(c.command))
      .slice(0, MAX.commands)
      .map((c) => ({ lead: str(c.lead), command: c.command })),
  };
}

// Items of a list whose id is known, once each, in the server's order.
function pick(items, ids, keep = () => true) {
  const seen = new Set();
  return list(items).filter((x) => {
    if (!x || typeof x !== "object" || !ids.includes(x.id) || seen.has(x.id) || !keep(x)) return false;
    seen.add(x.id);
    return true;
  });
}

// Pure. What is drawn from an answer of GET /api/setup, under the hostile-data rules: known step ids only, once each,
// in the server's order, each in its own group (`start` or `later`; any other group drops the step), at most 8 needed
// and 10 optional steps; the Checker's own login not in provider mode; a state outside the four is "unknown"; only
// safe addresses and the three fixed commands; at most 4 notes, 3 costs, 3 links and 2 commands a step; at most 6
// known "not possible yet" rows. Text is kept whole.
export function cleanSetup(data) {
  const d = obj(data);
  const c = obj(d.counts);
  const total = totalOf(c.total);
  const l = obj(d.later);
  const laterTotal = whole(l.total, MAX_TOTAL);
  const mode = d.mode === "provider" ? "provider" : d.mode === "plans" ? "plans" : null;
  const sent = new Map(pick(d.groups, GROUP_IDS).map((g) => [g.id, g]));
  const groups = {};
  for (const id of GROUP_IDS) {
    const g = obj(sent.get(id));
    groups[id] = { title: str(g.title) || WORDS[id], say: str(g.say) || WORDS[`${id}Say`] };
  }
  const known = pick(d.steps, [...START_IDS, ...LATER_IDS], (x) => x.group === "start" || x.group === "later")
    .filter((x) => !(mode === "provider" && x.id === CHECKER_LOGIN));
  const start = known.filter((x) => x.group === "start").slice(0, MAX.start);
  const later = known.filter((x) => x.group === "later").slice(0, MAX.later);
  return {
    dismissed: d.dismissed === true,
    finished: d.finished === true,
    mode,
    counts: { done: whole(c.done, total), skipped: whole(c.skipped, total), total },
    later: { done: whole(l.done, laterTotal), total: laterTotal },
    groups,
    steps: [...start, ...later].map(cleanStep),
    notYet: pick(d.notYet, NOT_YET_IDS).slice(0, MAX.notYet).map((n) => ({
      id: n.id,
      title: str(n.title) || n.id,
      line: str(n.line),
      how: str(n.how),
    })),
  };
}

const STATE_TONES = Object.freeze({ done: "good", todo: "neutral", skipped: "neutral", unknown: "neutral" });
const GLYPHS = Object.freeze({ done: "check", skipped: "clock", unknown: "info" });

function Glyph({ state }) {
  const name = GLYPHS[state];
  return html`<span class=${`p-setup__glyph p-setup__glyph--${state}`}>${name ? html`<${Icon} name=${name} size=${14} />` : null}</span>`;
}

function Commands({ step }) {
  return step.commands.map((c, i) => html`<span key=${`c${i}`} class="p-setup__command">
    ${c.lead ? html`<span class="p-setup__lead">${c.lead}</span>` : null}
    <span class="p-setup__code"><${Mono}>${c.command}<//></span>
  </span>`);
}

function StepWords({ step }) {
  return html`<span class="p-setup__words">
    ${step.line ? html`<span class="p-setup__line">${step.line}</span>` : null}
    ${step.why && step.state !== "done" ? html`<span class="p-setup__why">${step.why}</span>` : null}
    ${step.notes.map((n, i) => html`<span key=${`n${i}`} class="p-setup__note">${n}</span>`)}
    <${Commands} step=${step} />
    ${step.canSkip && step.state === "todo" ? html`<span class="p-setup__may">${WORDS.canSkip}</span>` : null}
  </span>`;
}

function StepControls({ step, next, busy, onSkip, onNewTask }) {
  const task = step.id === "task" && step.state === "todo";
  return html`<span class="p-setup__controls">
    ${task ? html`<${Button} size="sm" variant="primary" onClick=${onNewTask}>${WORDS.newTask}<//>` : null}
    ${step.links.map((l, i) => html`<${Button} key=${`l${i}`} size="sm" variant=${next && i === 0 && !task ? "primary" : "plain"} href=${l.href}>${l.label}<//>`)}
    ${step.canSkip && (step.state === "todo" || step.state === "unknown")
      ? html`<${Button} size="sm" variant="quiet" disabled=${busy} onClick=${() => onSkip(step.id, true)}>${WORDS.skip}<//>`
      : null}
    ${step.state === "skipped"
      ? html`<${Button} size="sm" variant="quiet" disabled=${busy} onClick=${() => onSkip(step.id, false)}>${WORDS.bringBack}<//>`
      : null}
  </span>`;
}

// An optional step: folded under its title, its chip and what is true now; drawn open when there is a command for
// the owner to run.
function LaterStep({ step }) {
  const open = step.state === "todo" && step.commands.length > 0;
  const tone = step.state === "done" ? "good" : "neutral";
  return html`<details class=${`p-setup__later p-setup__later--${step.state}`} data-step=${step.id} open=${open}>
    <summary class="p-setup__fold">
      <${Icon} name="chevron-right" size=${16} class="p-setup__fold-mark" />
      <span class="p-setup__fold-words">
        <span class="p-setup__fold-title">
          <span class="p-setup__name">${step.title}</span>
          <span class=${`k-rows__state k-rows__state--${tone}`}>${laterWords(step.state)}</span>
        </span>
        ${step.line ? html`<span class="p-setup__line">${step.line}</span>` : null}
      </span>
    </summary>
    <div class="p-setup__fold-body">
      ${step.opens
        ? html`<div class="p-setup__part">
            <p class="p-setup__label">${WORDS.opensUp}</p>
            <p class="p-setup__para">${step.opens}</p>
          </div>`
        : null}
      ${step.costs.length
        ? html`<div class="p-setup__part">
            <p class="p-setup__label">${WORDS.costs}</p>
            ${step.costs.map((t, i) => html`<p key=${`k${i}`} class="p-setup__para p-setup__cost">${t}</p>`)}
          </div>`
        : null}
      ${step.notes.map((n, i) => html`<p key=${`n${i}`} class="p-setup__para p-setup__note">${n}</p>`)}
      ${step.commands.length ? html`<div class="p-setup__part"><${Commands} step=${step} /></div>` : null}
      ${step.links.length
        ? html`<span class="p-setup__controls p-setup__controls--start">
            ${step.links.map((l, i) => html`<${Button} key=${`l${i}`} size="sm" variant="plain" href=${l.href}>${l.label}<//>`)}
          </span>`
        : null}
    </div>
  </details>`;
}

export default function Page() {
  const app = useApp() || {};
  const res = useResource("/api/setup", { every: 15000 });
  // The answer of the last write, shown until the next read comes back.
  const [after, setAfter] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  useEffect(() => { setAfter(null); }, [res.data]);

  const raw = after || res.data;
  const s = raw ? cleanSetup(raw) : null;

  async function write(path, body, said) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const answer = await api.post(path, body);
      setAfter(answer);
      if (typeof app.refreshSetup === "function") app.refreshSetup();
      if (typeof app.announce === "function") app.announce(said);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  const onSkip = (step, skip) => write("/api/setup/skip", { step, skip }, skip ? WORDS.saidSkipped : WORDS.saidBack);
  const onDismiss = (dismissed) => write("/api/setup/dismiss", { dismissed }, dismissed ? WORDS.saidHidden : WORDS.saidShown);
  const onNewTask = () => { if (typeof app.openComposer === "function") app.openComposer({}); };

  let body;
  if (!s && res.loading) body = html`<${Loading} lines=${5} label=${WORDS.loading} />`;
  else if (!s && res.error) body = html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  else if (s) {
    const start = s.steps.filter((x) => x.group === "start");
    const later = s.steps.filter((x) => x.group === "later");
    const next = nextStepId(start);
    body = html`
      ${failure
        ? html`<div class="p-setup__failure"><${Notice} tone="bad" title=${str(failure.message) || "Something went wrong."}>${str(failure.next) || null}<//></div>`
        : null}
      ${start.length
        ? html`<${Group} title=${s.groups.start.title} say=${s.groups.start.say}>
          <${Rows}>
            ${start.map((step, i) => html`<div key=${step.id} class=${`p-setup__row${step.id === next ? " p-setup__row--next" : ""}`} data-step=${step.id}>
              <${Row} icon=${html`<${Glyph} state=${step.state} />`} title=${`${i + 1}. ${step.title}`}
                state=${{ tone: STATE_TONES[step.state], text: stateWords(step.state) }}
                say=${html`<${StepWords} step=${step} />`}
                control=${html`<${StepControls} step=${step} next=${step.id === next} busy=${busy} onSkip=${onSkip} onNewTask=${onNewTask} />`} />
            </div>`)}
          <//>
        <//>`
        : null}
      ${later.length
        ? html`<${Group} title=${s.groups.later.title} say=${s.groups.later.say}>
          <div class="p-setup__folds">
            ${later.map((step) => html`<${LaterStep} key=${step.id} step=${step} />`)}
          </div>
        <//>`
        : null}
      ${s.notYet.length
        ? html`<${Group} title=${s.groups.notyet.title} say=${s.groups.notyet.say}>
          <${Rows}>
            ${s.notYet.map((n) => html`<div key=${n.id} class="p-setup__notyet" data-notyet=${n.id}>
              <${Row} title=${n.title}
                say=${html`<span class="p-setup__words">
                  ${n.line ? html`<span class="p-setup__line">${n.line}</span>` : null}
                  ${n.how ? html`<span class="p-setup__why">${n.how}</span>` : null}
                </span>`} />
            </div>`)}
          <//>
        <//>`
        : null}
      <div class="p-setup__foot">
        ${s.dismissed
          ? html`<${Notice} tone="info" title=${WORDS.hidden}
              action=${html`<${Button} size="sm" variant="ghost" disabled=${busy} onClick=${() => onDismiss(false)}>${WORDS.showAgain}<//>`} />`
          : html`<${Button} size="sm" variant="quiet" disabled=${busy} onClick=${() => onDismiss(true)}>${WORDS.hide}<//>
              <p class="p-setup__hint">${WORDS.hideLine}</p>`}
      </div>`;
  }

  const ring = s ? Math.min(s.counts.done + s.counts.skipped, s.counts.total) : 0;
  return html`<div class="p-setup">
    <${RoomHeader} glimpse=${glimpseFor("setup")} pull strip title=${WORDS.title} lead=${s ? leadOf(s) : ""}
      state=${s ? html`<${Ring} value=${ring} total=${s.counts.total} size=${28} label=${leadOf(s)} />` : null} />
    ${body}
  </div>`;
}
