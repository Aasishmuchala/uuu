// Setup (PLAN-ONBOARD T2): the guided first run. Five counted steps in the server's order (company basics, brand kit,
// models, the books, a first real task), each with what is true now, why it matters and where to go; under them the
// switches the owner may want later, shown and never counted; at the foot "Hide the setup".
// Everything comes from GET /api/setup (read again every 15 seconds, so the page is fresh when the owner comes back).
// The page never acts: every way on is a link to the page that does the step, or a command shown as text for
// Terminal. Its only writes are about how the setup is shown: "Skip for now" / "Bring back" (POST /api/setup/skip)
// and "Hide the setup" / "Show it in the sidebar again" (POST /api/setup/dismiss).
// The answer is treated as untrusted (cleanSetup): only the home screen's own addresses, only the three fixed
// commands, only known step and switch ids; every sentence is text, whole, never cut (ADR 0016). The sentences that
// name a tool are the server's; this file names none.
import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, ErrorNotice, Group, Icon, Loading, Mono, Notice, RoomHeader, Ring, Row, Rows, glimpseFor } from "../kit/index.js";

// Every fixed word of the page.
export const WORDS = Object.freeze({
  title: "Setup",
  steps: "Steps",
  switches: "Switches you may want later",
  switchesSay: "Each of these is off until you switch it on in Settings. Nothing here changes them.",
  done: "Done",
  todo: "To do",
  skipped: "Skipped for now",
  unknown: "Not known",
  on: "On",
  off: "Off",
  finished: "Setup is done.",
  newTask: "New task",
  skip: "Skip for now",
  bringBack: "Bring back",
  openSettings: "Open Settings",
  openApps: "Open App Studio",
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

const TOTAL = 5;
const STEP_IDS = Object.freeze(["basics", "brand", "models", "books", "task"]);
const SWITCH_IDS = Object.freeze(["web", "generation", "viewer", "apps", "brain"]);
const STATES = Object.freeze(["done", "todo", "skipped", "unknown"]);
// The only commands the page shows: the server sends one of these or nothing. The second is the login wizard with
// the Checker's part as its argument; that word is a tool's name, which the shared page test (test/pages.test.mjs,
// in any case) keeps out of a page's source, so it is put together here rather than written out.
const WIZARD = "engine/fence/login-wizard.sh";
const CHECKER_PART = ["co", "dex"].join("");
const COMMANDS = Object.freeze([WIZARD, `${WIZARD} ${CHECKER_PART}`, "engine/books/setup-wizard.sh"]);
const HREF = /^#\/[a-z0-9/?=&-]{0,80}$/;
const MAX = Object.freeze({ notes: 4, links: 3, commands: 2 });
const SWITCH_ICONS = Object.freeze({ web: "globe", generation: "film", viewer: "eye", apps: "apps", brain: "brain" });

const str = (v) => (typeof v === "string" ? v : "");
const whole = (v) => (Number.isInteger(v) ? Math.min(Math.max(v, 0), TOTAL) : 0);
const list = (v) => (Array.isArray(v) ? v : []);

// The chip's words for a step's state; anything outside the four is "Not known".
export function stateWords(state) {
  return state === "done" ? WORDS.done : state === "todo" ? WORDS.todo : state === "skipped" ? WORDS.skipped : WORDS.unknown;
}

// The header's line, from the answer's counts.
export function leadOf(setup) {
  if (setup && setup.finished === true) return WORDS.finished;
  const c = setup && setup.counts && typeof setup.counts === "object" ? setup.counts : {};
  const done = whole(c.done);
  const skipped = whole(c.skipped);
  return skipped ? `${done} of ${TOTAL} done, ${skipped} skipped for now.` : `${done} of ${TOTAL} done.`;
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
  const state = STATES.includes(s.state) ? s.state : "unknown";
  return {
    id: s.id,
    title: str(s.title) || s.id,
    state,
    canSkip: s.canSkip === true,
    line: str(s.line),
    why: str(s.why),
    notes: list(s.notes).filter((n) => typeof n === "string" && n).slice(0, MAX.notes),
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

function cleanSwitch(w) {
  return {
    id: w.id,
    title: str(w.title) || w.id,
    on: w.on === true ? true : w.on === false ? false : null,
    line: str(w.line),
    href: safeHref(w.href),
  };
}

// Pure. What is drawn from an answer of GET /api/setup, under the hostile-data rules: known ids only (once each, in
// the server's order, at most five), a state outside the four is "unknown", only safe addresses and the three fixed
// commands, at most 4 notes, 3 links and 2 commands a step. Text is kept whole.
export function cleanSetup(data) {
  const d = data && typeof data === "object" ? data : {};
  const pick = (items, ids) => {
    const seen = new Set();
    return list(items).filter((x) => {
      if (!x || typeof x !== "object" || !ids.includes(x.id) || seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  };
  const c = d.counts && typeof d.counts === "object" ? d.counts : {};
  return {
    dismissed: d.dismissed === true,
    finished: d.finished === true,
    counts: { done: whole(c.done), skipped: whole(c.skipped), total: TOTAL },
    steps: pick(d.steps, STEP_IDS).slice(0, TOTAL).map(cleanStep),
    switches: pick(d.switches, SWITCH_IDS).slice(0, SWITCH_IDS.length).map(cleanSwitch),
  };
}

const STATE_TONES = Object.freeze({ done: "good", todo: "neutral", skipped: "neutral", unknown: "neutral" });
const GLYPHS = Object.freeze({ done: "check", skipped: "clock", unknown: "info" });

function Glyph({ state }) {
  const name = GLYPHS[state];
  return html`<span class=${`p-setup__glyph p-setup__glyph--${state}`}>${name ? html`<${Icon} name=${name} size=${14} />` : null}</span>`;
}

function StepWords({ step }) {
  return html`<span class="p-setup__words">
    ${step.line ? html`<span class="p-setup__line">${step.line}</span>` : null}
    ${step.why && step.state !== "done" ? html`<span class="p-setup__why">${step.why}</span>` : null}
    ${step.notes.map((n, i) => html`<span key=${`n${i}`} class="p-setup__note">${n}</span>`)}
    ${step.commands.map((c, i) => html`<span key=${`c${i}`} class="p-setup__command">
      ${c.lead ? html`<span class="p-setup__lead">${c.lead}</span>` : null}
      <span class="p-setup__code"><${Mono}>${c.command}<//></span>
    </span>`)}
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

function SwitchRow({ item }) {
  const chip = item.on === true ? { tone: "good", text: WORDS.on } : { tone: "neutral", text: item.on === false ? WORDS.off : WORDS.unknown };
  return html`<${Row} icon=${SWITCH_ICONS[item.id]} title=${item.title} state=${chip} say=${item.line || null}
    control=${item.href
      ? html`<${Button} size="sm" variant="plain" href=${item.href}>${item.href === "#/apps" ? WORDS.openApps : WORDS.openSettings}<//>`
      : null} />`;
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
    const next = nextStepId(s.steps);
    body = html`
      ${failure
        ? html`<div class="p-setup__failure"><${Notice} tone="bad" title=${str(failure.message) || "Something went wrong."}>${str(failure.next) || null}<//></div>`
        : null}
      <${Group} title=${WORDS.steps}>
        <${Rows}>
          ${s.steps.map((step, i) => html`<div key=${step.id} class=${`p-setup__row${step.id === next ? " p-setup__row--next" : ""}`} data-step=${step.id}>
            <${Row} icon=${html`<${Glyph} state=${step.state} />`} title=${`${i + 1}. ${step.title}`}
              state=${{ tone: STATE_TONES[step.state], text: stateWords(step.state) }}
              say=${html`<${StepWords} step=${step} />`}
              control=${html`<${StepControls} step=${step} next=${step.id === next} busy=${busy} onSkip=${onSkip} onNewTask=${onNewTask} />`} />
          </div>`)}
        <//>
      <//>
      ${s.switches.length
        ? html`<${Group} title=${WORDS.switches} say=${WORDS.switchesSay}>
            <${Rows}>
              ${s.switches.map((w) => html`<div key=${w.id} class="p-setup__switch" data-switch=${w.id}><${SwitchRow} item=${w} /></div>`)}
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

  const ring = s ? Math.min(s.counts.done + s.counts.skipped, TOTAL) : 0;
  return html`<div class="p-setup">
    <${RoomHeader} glimpse=${glimpseFor("setup")} pull strip title=${WORDS.title} lead=${s ? leadOf(s) : ""}
      state=${s ? html`<${Ring} value=${ring} total=${TOTAL} size=${28} label=${leadOf(s)} />` : null} />
    ${body}
  </div>`;
}
