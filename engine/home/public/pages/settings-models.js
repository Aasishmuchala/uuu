// Settings: the Models section (CONTRACTS-V4 C8 and C9; drawn as PLAN-COOK T56). The owner pastes the Omega Plus key
// here, tests it, sees which model each agent would use, and switches the provider on or off. The settings frame
// (pages/settings.js) draws the title and the state this module's statusLine gives; this module draws groups of the
// kit into the column: Omega Plus (the switch with its warning, the key with Test), the model each agent uses as a
// table with Save under it, and the apps that asked to think as quiet lines. The key is typed into a password field
// that the server never fills; it lives only in this component's memory until Save, and is cleared then.
// It is never put in storage, the address bar, the console or an error message.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen } from "../lib/format.js";
import {
  Button, Card, Checklist, DataTable, Dialog, ErrorNotice, Field, Group, Loading, Mono, NextStep, Notice, Row, Rows, Select, St, Switch, TextInput,
} from "../kit/index.js";

// The sentences of C9, as written.
export const WORDS = {
  intro: "Your agents can run on models from Omega Plus instead of your Claude and Codex plans. Omega Plus is a paid service with its own key.",
  warning: "When this is on, everything an agent reads and writes in a task is sent to Omega Plus, and Omega Plus decides which model answers under each name.",
  noKey: "No key yet. Paste the one from your Omega Plus account.",
  refused: "Omega Plus refused this key. Check it and paste it again.",
  limited: "Omega Plus says your limit is reached. Agents cannot work until it resets.",
  unreachable: "Omega Plus is not answering. Nothing was changed.",
  relayOff: "The model relay is off. Run: engine start",
  notRead: "The list of models has not been read yet.",
  switching: "Switching…",
  on: "On. Your agents use Omega Plus.",
  off: "Off. Your agents use your Claude and Codex plans.",
  afterSwitch: "Nothing else to do. Each agent's next run uses this. Run the proof on Health to check the fence.",
  restart: "This section appears after the home screen is restarted: engine stop, then engine start.",
  switchLabel: "Use Omega Plus for the agents",
  apps: "Apps",
  agents: "The model each agent uses",
  // PLAN-V5 K8, as written.
  sameModel: "The Art director is on the same model as the makers. A second opinion from another model is stronger: choose one if your list has it.",
};

// What each kind of work is called on screen.
export const NEEDS = {
  reasoning: "Thinking and planning",
  making: "Making things",
  writing: "Writing",
  checking: "Checking",
};

const text = (v, n = 200) => (v === null || v === undefined ? "" : String(v)).slice(0, n);

// "A key is saved (12 Nov 2026, 10:00)."
export function savedLine(savedAt) {
  const at = fullWhen(savedAt);
  return at ? `A key is saved (${at}).` : "A key is saved.";
}

// The key's state as a mark and a sentence: { tone, word, sentence }.
export function keyStatus(key) {
  const k = key && typeof key === "object" ? key : {};
  if (!k.saved || k.state === "none") return { tone: "off", word: "No key", sentence: WORDS.noKey };
  const saved = savedLine(k.savedAt);
  switch (k.state) {
    case "ok": return { tone: "ok", word: "Works", sentence: `${saved} It works.` };
    case "refused": return { tone: "bad", word: "Refused", sentence: WORDS.refused };
    case "limited": return { tone: "warn", word: "Limit reached", sentence: WORDS.limited };
    case "unreachable": return { tone: "warn", word: "Not answering", sentence: WORDS.unreachable };
    default: return { tone: "wait", word: "Not tested yet", sentence: `${saved} Press Test to see whether it works.` };
  }
}

// The switch's state sentence.
export const modeLine = (mode) => (mode === "provider" ? WORDS.on : WORDS.off);

// "No model is available for Builder. Choose one from the list."
export const missingLine = (name) => `No model is available for ${text(name, 80)}. Choose one from the list.`;

// Whether the switch's list of what to do first is drawn and says this sentence.
export function saidInChecklist(view, sentence) {
  const v = view && typeof view === "object" ? view : {};
  const locked = v.mode !== "provider" && !v.canSwitchOn;
  return locked && blockerLines(v).includes(sentence);
}

// Whether the relay is down, so the page says so once in a notice at its top (whatever the switch's list says).
export function relayNotShown(view) {
  return Boolean(view && view.relay && view.relay.state !== "on");
}

// Why the switch cannot be turned on, one sentence per blocker, in the order the server gives them.
export function blockerLines(view) {
  const v = view && typeof view === "object" ? view : {};
  const names = new Map((Array.isArray(v.agents) ? v.agents : []).map((a) => [a.slug, a.name]));
  const out = [];
  const list = Array.isArray(v.blockers) ? v.blockers : [];
  for (const b of list) {
    if (b === "no_key") out.push(WORDS.noKey);
    else if (b === "key_refused") out.push(WORDS.refused);
    else if (b === "relay_off") out.push(WORDS.relayOff);
    else if (b === "no_catalogue") out.push(WORDS.notRead);
    else if (b === "pick_missing" && !list.includes("no_catalogue")) for (const s of Array.isArray(v.missing) ? v.missing : []) out.push(missingLine(names.get(s) || s));
  }
  return out;
}

// Whether every row of the agents table would be empty in its Model and Used columns: the list not read, no calls.
export const allBlank = (view) => unreadInTable(view)
  && (Array.isArray(view && view.agents) ? view.agents : []).every((a) => usageLine(a && a.usage) === "No calls yet");

// Whether the agents table says the list of models has not been read yet (its empty state, with Read the list).
export const unreadInTable = (view) => !(view && view.catalogue && view.catalogue.readAt);

// The words for why a model did not answer the test.
export const REASONS = {
  refused: "Omega Plus refused the key",
  limited: "your limit is reached",
  unreachable: "Omega Plus is not answering",
  no_answer: "no answer came back",
  relay_off: "the model relay is off",
};

// "Fable 5.1 answered." or "Fable 5.1 did not answer: no answer came back."
export function testLine(m) {
  const name = text(m && (m.name || m.model), 80) || "A model";
  if (m && m.answered) return `${name} answered.`;
  return `${name} did not answer: ${REASONS[m && m.reason] || REASONS.no_answer}.`;
}

// The last test's verdict on the key.
export function testKeyLine(k) {
  if (k === "ok") return "The key works.";
  if (k === "refused") return WORDS.refused;
  if (k === "limited") return WORDS.limited;
  return WORDS.unreachable;
}

// A file the server could not read, in plain words.
export const PROBLEMS = {
  state_unreadable: "The file that keeps these settings could not be read, so Omega Plus is treated as off. Saving any change here writes it again.",
  company_unreadable: "The company file could not be read, so no agent is listed here. Run: engine setup",
  ranking_unreadable: "The ranking of models could not be read, so no model is picked by itself. Choose one for each agent.",
};
export const problemLine = (p) => (p ? PROBLEMS[p] || "Part of these settings could not be read." : "");

// The choices of one agent's list: ranked ones first, in the server's order, then the rest marked "not ranked".
export function orderOptions(options) {
  const list = (Array.isArray(options) ? options : []).filter((o) => o && typeof o.id === "string");
  const label = (o) => text(o.name || o.id, 80);
  return [
    ...list.filter((o) => o.ranked).map((o) => ({ value: o.id, label: label(o) })),
    ...list.filter((o) => !o.ranked).map((o) => ({ value: o.id, label: `${label(o)} (not ranked)` })),
  ];
}

// "No calls yet" or "4 calls, 1,215 tokens".
export function usageLine(u) {
  const req = Number(u && u.requests) || 0;
  const tok = (Number(u && u.inputTokens) || 0) + (Number(u && u.outputTokens) || 0);
  if (!req && !tok) return "No calls yet";
  return `${req.toLocaleString("en")} ${req === 1 ? "call" : "calls"}, ${tok.toLocaleString("en")} ${tok === 1 ? "token" : "tokens"}`;
}

// One app's thinking in a line: "Render to Film: 3 calls today, 1 this hour." The server sends the numbers.
export function appLine(a) {
  const name = text(a && a.name, 40) || "An app";
  const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  const today = n(a && a.callsToday);
  const hour = n(a && a.callsHour);
  return `${name}: ${today.toLocaleString("en")} ${today === 1 ? "call" : "calls"} today, ${hour.toLocaleString("en")} this hour.`;
}

// The plan an agent runs on, in a line: "Runs on your Claude plan", or Omega Plus while the switch is on.
export function planLine(a, mode) {
  if (mode === "provider") return "Runs on Omega Plus";
  const program = text(a && a.program, 20);
  return program ? `Runs on your ${program.charAt(0).toUpperCase()}${program.slice(1)} plan` : "Runs on your plan";
}

// The state line of the list of sections, from the answer of /api/models.
export function statusLine(data) {
  const v = data && typeof data === "object" ? data : {};
  if (v.problem) return { tone: "bad", text: "Its settings could not be read" };
  if (v.mode !== "provider") return { tone: "neutral", text: "Your Claude and Codex plans" };
  const k = v.key && typeof v.key === "object" ? v.key.state : null;
  if (k === "refused") return { tone: "bad", text: "Omega Plus refused the key" };
  if (k === "limited") return { tone: "warn", text: "Omega Plus, its limit is reached" };
  if (v.relay && v.relay.state !== "on") return { tone: "warn", text: "Omega Plus, but the model relay is off" };
  if (k === "unreachable") return { tone: "warn", text: "Omega Plus is not answering" };
  return { tone: "good", text: "Omega Plus for the agents" };
}

// The head's chip: one or two words (the line above says the rest, in the list of sections).
export function stateWord(data) {
  const v = data && typeof data === "object" ? data : {};
  if (v.problem) return "Not read";
  return v.mode === "provider" ? "Omega Plus" : "Your plans";
}

// The K8 sentence when the Art director's model is the Artist's, else "". The Artist stands for the makers.
export function sameModelLine(view) {
  const agents = view && Array.isArray(view.agents) ? view.agents : [];
  const pickOf = (slug) => {
    const a = agents.find((x) => x && x.slug === slug);
    return a && typeof a.pick === "string" && a.pick ? a.pick : null;
  };
  const judge = pickOf("art-director");
  return judge && judge === pickOf("artist") ? WORDS.sameModel : "";
}

// What the section draws: "loading", "restart" (the routes are not there yet), "error" or "ready".
export function sectionState(res) {
  if (res && res.data) return "ready";
  if (res && res.error) return res.error.status === 404 ? "restart" : "error";
  return "loading";
}

// ---------------------------------------------------------------------------------------------------------------
// Parts
// Every part is the kit's (Group, Rows, Row, DataTable, Select, Switch, St, Notice) placed into the settings column;
// this file adds only a few lines under a row and the table's cells.

// The restart sentence, with the two commands set apart. The words are C9's, unchanged.
function RestartLine() {
  return html`<p class="p-settings-models__restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>", on a line of its own.
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings-models__line">${children}</p>`);

// The same inside a line of text (a row's words): the command set apart, every word kept.
function Said({ text: t0 }) {
  const t = String(t0 ?? "");
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(t);
  return m ? html`${m[1]} <code class="k-next__command">${m[2]}</code>` : t;
}

const Failure = ({ failure, where }) => (failure && failure.where === where
  ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next ? html`<${Line}>${failure.error.next}<//>` : null}<//>`
  : null);

// The helpers' tones (ok, warn, bad, off, wait, live) in the kit's.
const TONE = { ok: "good", bad: "bad", warn: "warn" };
const toneOf = (t) => TONE[t] || "neutral";

// What follows a row inside its panel, under its words. Draws nothing when there is nothing to say.
function More({ children }) {
  const list = [children].flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== "");
  return list.length ? html`<div class="p-settings-models__more">${list}</div>` : null;
}

// The apps that asked to think (App Studio), one quiet line each, with the relay's refusal in the server's words.
function AppsThinking({ apps }) {
  const list = (Array.isArray(apps) ? apps : []).filter((a) => a && typeof a.slug === "string");
  if (!list.length) return null;
  return html`<${Group} title=${WORDS.apps}>
    <ul class="p-settings-models__apps">
      ${list.map((a) => html`
        <li key=${a.slug} class="p-settings-models__app">
          <span>${appLine(a)}</span>
          ${a.refused ? html`<span>${text(a.refused, 200)}</span>` : null}
        </li>`)}
    </ul>
  <//>`;
}

// The last test: the key's verdict, what Omega Plus says about the plan, and each model asked, as lines.
function TestResult({ test }) {
  const plan = Array.isArray(test.plan) ? test.plan.slice(0, 12) : [];
  const models = Array.isArray(test.models) ? test.models : [];
  return html`<div class="p-settings-models__answer">
    <p class="p-settings-models__line p-settings-models__answer-head">Last test${fullWhen(test.at) ? `, ${fullWhen(test.at)}` : ""}</p>
    <p class="p-settings-models__line"><${St} tone=${test.key === "ok" ? "good" : test.key === "refused" ? "bad" : "warn"}>${testKeyLine(test.key)}<//></p>
    ${plan.map((r, i) => html`<p key=${i} class="p-settings-models__line">${text(r.label, 80)}: ${text(r.value, 120)}</p>`)}
    ${models.map((m) => html`<p key=${m.model} class="p-settings-models__line"><${St} tone=${m.answered ? "good" : "bad"}>${testLine(m)}${Array.isArray(m.agents) && m.agents.length ? ` For ${m.agents.map((a) => text(a, 40)).join(", ")}.` : ""}<//></p>`)}
  </div>`;
}

function SwitchRow({ view, busy, failure, act, switched }) {
  const on = view.mode === "provider";
  // Each fact once: the list of models not yet read is said where it is acted on, as the agents table's empty state
  // with Read the list beside it, so this list does not say it again.
  // The relay's sentence is the notice at the top of the page whenever the relay is not on, so it is left out here.
  const blockers = blockerLines(view).filter((b) => !(b === WORDS.notRead && unreadInTable(view)) && !(b === WORDS.relayOff && relayNotShown(view)));
  const locked = !on && !view.canSwitchOn;
  return html`
    <${Row} icon="power" title=${WORDS.switchLabel}
      say=${html`${busy === "mode" ? WORDS.switching : modeLine(view.mode)}
        ${locked && blockers.length ? html`<${Checklist} lead="It can be switched on when these are done:"
          items=${blockers.map((b) => ({ done: false, text: html`<${Said} text=${b} />` }))} />` : null}`}
      control=${html`<${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
        onChange=${(next) => act("mode", "/api/models/mode", { mode: next ? "provider" : "plans" }, next ? WORDS.on : WORDS.off, true)} />`}
      warned=${WORDS.warning} />
    <${More}>
      ${switched && busy !== "mode" ? html`<${Notice} tone="ok" title=${WORDS.afterSwitch} />` : null}
      <${Failure} failure=${failure} where="mode" />
    <//>`;
}

function KeyRow({ view, busy, act, failure }) {
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const status = keyStatus(view.key);
  const saved = Boolean(view.key && view.key.saved);
  const t = view.lastTest;
  const open = editing || !saved;
  // Each fact once: while the switch's list of what to do first says there is no key yet, this row does not say it
  // again (its chip and the field do).
  const saidAbove = !saved && saidInChecklist(view, WORDS.noKey);

  async function save(event) {
    event.preventDefault();
    if (!typed.trim()) return;
    const ok = await act("save", "/api/models/key", { key: typed }, "The key is saved.");
    if (ok) setTyped("");
    if (ok) setEditing(false);
  }
  function cancel() {
    setTyped("");
    setEditing(false);
  }

  return html`
    <${Row} icon="key" title="Provider key" state=${{ tone: status.tone === "wait" ? "warn" : toneOf(status.tone), text: status.word }}
      say=${html`${saidAbove ? null : status.sentence}
        ${saved ? html`<span class="p-settings-models__actions">
          <${Button} size="sm" variant="ghost" icon="play" onClick=${() => act("test", "/api/models/test", {}, "The test is done.")} busy=${busy === "test"} disabled=${Boolean(busy)}>Test<//>
          ${editing ? null : html`<${Button} size="sm" variant="ghost" disabled=${Boolean(busy)} onClick=${() => setEditing(true)}>Replace<//>`}
          <${Button} size="sm" variant="ghost" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>Remove key<//>
        </span>` : null}`} />
    <${More}>
      ${open ? html`<form class="p-settings-models__key" onSubmit=${save} autocomplete="off">
        <${Field} hint=${saved ? "Paste a new key to replace the saved one." : "It is kept on this Mac only and is never shown again."}
          error=${failure && failure.where === "save" ? failure.error : null}>
          <${TextInput} type="password" name="provider-key" autocomplete="off" autocapitalize="off" spellcheck=${false} aria-label="Provider key"
            value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)} placeholder=${saved ? "A key is saved" : "Paste your key here"}
            onKeyDown=${(e) => { if (e.key === "Escape" && saved) { e.preventDefault(); cancel(); } }} />
        <//>
        <span class="p-settings-models__buttons">
          ${saved ? html`<${Button} variant="quiet" onClick=${cancel} disabled=${busy === "save"}>Cancel<//>` : null}
          <${Button} variant=${typed.trim() ? "primary" : "ghost"} type="submit" busy=${busy === "save"} disabled=${Boolean(busy) || !typed.trim()}>Save key<//>
        </span>
      </form>` : null}
      ${busy === "test" ? html`<p class="p-settings-models__line" role="status"><${St} icon="clock">Testing the key and each picked model. This can take up to 30 seconds.<//></p>` : null}
      ${failure && (failure.where === "test" || failure.where === "remove") ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next || null}<//>` : null}
      ${t ? html`<${TestResult} test=${t} />` : null}
    <//>
    <${Dialog} open=${asking} title="Remove the key?" size="sm" paper onClose=${() => setAsking(false)}
      footer=${html`
        <${Button} data-autofocus onClick=${() => setAsking(false)}>Keep the key<//>
        <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("remove", "/api/models/key/remove", {}, "The key is removed."); }}>Remove key<//>`}>
      <p class="p-settings-models__line">The key is deleted from this Mac.${view.mode === "provider" ? " Omega Plus is switched off first, so your agents go back to your Claude and Codex plans." : ""}</p>
    <//>`;
}

// Group 1: Omega Plus: the switch with its warning inside the panel, the key with Test, and (on request) the technical lines.
function OmegaGroup({ view, busy, act, failure, switched, technical, setTechnical }) {
  const aside = html`<${Button} variant="quiet" size="sm" aria-expanded=${technical ? "true" : "false"} onClick=${() => setTechnical(!technical)}>${technical ? "Hide technical details" : "Show technical details"}<//>`;
  return html`<${Group} title="Omega Plus" aside=${aside}>
    <${Rows}>
      <${SwitchRow} view=${view} busy=${busy} act=${act} failure=${failure} switched=${switched} />
      <${KeyRow} view=${view} busy=${busy} act=${act} failure=${failure} />
      ${technical ? html`<${Row} icon="info" title="Technical details"
        say=${html`<span class="p-settings-models__line">Provider: <${Mono}>${text(view.provider && view.provider.host, 120)}<//></span>
          <span class="p-settings-models__line">Model relay: <${Mono}>${text(view.relay && view.relay.state, 20)}<//></span>
          <span class="p-settings-models__line">Mode: <${Mono}>${text(view.mode, 20)}<//></span>
          <span class="p-settings-models__line">Models in the list: <${Mono}>${Number(view.catalogue && view.catalogue.count) || 0}<//></span>`} />` : null}
    <//>
  <//>`;
}

// Group 2: the model each agent uses, one row of a table each, the model a Select, Save under the table.
function AgentsGroup({ view, busy, act, failure, technical }) {
  const [draft, setDraft] = useState({});
  const [done, setDone] = useState([]);
  const readAt = view.catalogue && view.catalogue.readAt;
  const agents = Array.isArray(view.agents) ? view.agents : [];
  const missing = new Set(Array.isArray(view.missing) ? view.missing : []);
  // Fix round R6: while the list is not read and no agent has made a call, the Model and Used columns would be
  // "None yet" and "No calls yet" on every row; the table's one muted line says it instead, and they are left out.
  const blank = allBlank(view);
  const columns = [
    { key: "agent", label: "Agent", align: "start" },
    { key: "needs", label: "Works on", align: "start" },
    ...(blank ? [] : [{ key: "model", label: "Model", align: "start" }, { key: "used", label: "Used", align: "end" }]),
  ];
  const changed = agents.filter((a) => a && typeof a.slug === "string" && draft[a.slug] !== undefined && draft[a.slug] !== (a.pick || ""));
  const label = (a, id) => (orderOptions(a.options).find((o) => o.value === id) || { label: "that model" }).label;

  function choose(a, value) {
    const next = { ...draft };
    if (value === (a.pick || "")) delete next[a.slug]; else next[a.slug] = value;
    setDraft(next);
    setDone([]);
  }
  async function save(event) {
    event.preventDefault();
    if (!changed.length || busy) return;
    const left = { ...draft };
    const said = [];
    for (const a of changed) {
      const line = `${text(a.name, 80)} will use ${label(a, draft[a.slug])}.`;
      const ok = await act("picks", "/api/models/pick", { agent: a.slug, model: draft[a.slug] }, line);
      if (!ok) { setDraft(left); setDone(said); return; }
      delete left[a.slug];
      said.push(line);
    }
    setDraft({});
    setDone(said);
  }

  const cell = (a, c) => {
    if (c.key === "agent") {
      return html`<span class="p-settings-models__who"><span class="p-settings-models__agent">${text(a.name, 80)}</span>
        <span class="p-settings-models__plan">${planLine(a, view.mode)}${technical ? html` <${Mono}>${text(a.slug, 80)}<//>${a.plansModel ? `, ${text(a.plansModel, 40)} on the plan` : ""}` : ""}</span></span>`;
    }
    if (c.key === "needs") return NEEDS[a.needs] || "Nothing set";
    if (c.key === "used") return html`<span class="p-settings-models__used">${usageLine(a.usage)}</span>`;
    const opts = orderOptions(a.options);
    if (!readAt || !opts.length) return html`<span class="p-settings-models__none">None yet</span>`;
    const shown = draft[a.slug] !== undefined ? draft[a.slug] : a.pick || "";
    const list = shown ? opts : [{ value: "", label: "Choose a model", disabled: true }, ...opts];
    return html`
      <div class="p-settings-models__pick">
        <${Select} aria-label=${`Model for ${text(a.name, 80)}`} options=${list} value=${shown}
          disabled=${Boolean(busy)} onChange=${(e) => e.currentTarget.value && choose(a, e.currentTarget.value)} />
        ${missing.has(a.slug) ? html`<span class="p-settings-models__line"><${St} tone="warn">No model yet<//></span>` : null}
        ${a.source === "owner" ? html`
          <span class="p-settings-models__chosen">Chosen by you.
            <${Button} variant="quiet" size="sm" disabled=${Boolean(busy)}
              onClick=${() => { choose(a, a.pick || ""); act(`pick:${a.slug}`, "/api/models/pick", { agent: a.slug, model: null }, `${a.name} is back on the ranked model.`); }}>Use the ranked one<//></span>` : null}
        ${technical && a.pick ? html`<span class="p-settings-models__line"><${Mono}>${text(a.pick, 80)}<//></span>` : null}
      </div>`;
  };

  const aside = readAt ? html`<${Button} variant="quiet" size="sm" onClick=${() => act("refresh", "/api/models/refresh", {}, "The list of models is read again.")}
    busy=${busy === "refresh"} disabled=${Boolean(busy)}>Read the list again<//>` : null;
  const say = readAt
    ? `The best model for each kind of work is picked for you. Change any of them here.${fullWhen(readAt) ? ` The list of ${Number(view.catalogue.count) || 0} models was read on ${fullWhen(readAt)}.` : ""}`
    : null;
  // Not read yet: the table's own empty state, one 14 px line at its head with Read the list beside it.
  const unread = readAt ? null : html`<div class="p-settings-models__unread">
    <p class="p-settings-models__unread-say">${WORDS.notRead}</p>
    <${Button} size="sm" onClick=${() => act("refresh", "/api/models/refresh", {}, "The list of models is read.")}
      busy=${busy === "refresh"} disabled=${Boolean(busy)}>Read the list<//>
  </div>`;
  return html`<${Group} title=${WORDS.agents} aside=${aside} say=${say}>
    ${unread && !agents.length ? html`<${Card} padding="none" class="p-settings-models__agents">${unread}<//>` : null}
    ${failure && (failure.where === "refresh" || failure.where.startsWith("pick")) ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next || null}<//>` : null}
    ${readAt && missing.size ? html`
      <${Notice} tone="warn">
        ${[...missing].map((s) => html`<p key=${s} class="p-settings-models__line">${missingLine((agents.find((a) => a.slug === s) || {}).name || s)}</p>`)}
      <//>` : null}
    ${readAt && sameModelLine(view) ? html`<${Notice} tone="warn" title=${sameModelLine(view)} />` : null}
    ${agents.length ? html`<${Card} padding="none" class="p-settings-models__agents">
      ${unread}
      <form onSubmit=${save} autocomplete="off">
        <${DataTable} columns=${columns} rows=${agents.map((a) => ({ ...a, id: a.slug }))} renderCell=${cell} />
        ${blank && !done.length ? null : html`<div class="p-settings-models__foot">
          <div class="p-settings-models__saved" role="status">
            ${done.map((l) => html`<p key=${l} class="p-settings-models__line"><${St} tone="good">${l}<//></p>`)}
          </div>
          <span class="p-settings-models__buttons">
            ${changed.length ? html`<${Button} variant="quiet" onClick=${() => setDraft({})} disabled=${Boolean(busy)}>Put back<//>` : null}
            <${Button} variant=${changed.length ? "primary" : "ghost"} type="submit" busy=${busy === "picks"} disabled=${Boolean(busy) || !changed.length}>Save<//>
          </span>
        </div>`}
      </form>
    <//>` : null}
  <//>`;
}

export default function ModelsSection() {
  const { announce } = useApp();
  const res = useResource("/api/models", { every: 10000 });
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const [switched, setSwitched] = useState(false);
  const [technical, setTechnical] = useState(false);
  const state = sectionState(res);
  // The answer of the last action is shown until the next quiet refresh brings a newer view.
  const view = fresh && fresh.base === res.data ? fresh.view : res.data;

  // Runs one action. Errors carry the server's plain message only: nothing typed is ever put in one.
  async function act(where, path, body, said, isSwitch = false) {
    setBusy(where);
    setFailure(null);
    if (isSwitch) setSwitched(false);
    try {
      const next = await api.post(path, body);
      setFresh({ view: next, base: res.data });
      if (isSwitch) setSwitched(true);
      if (said) announce(said);
      return true;
    } catch (error) {
      setFailure({ where, error: { message: text(error && error.message, 300) || "That did not work.", next: text(error && error.next, 300) } });
      res.refresh();
      return false;
    } finally {
      setBusy("");
    }
  }

  return html`<div class="p-settings-models" id="settings-models">
    <p class="k-doc__intro">${WORDS.intro}</p>
    ${state === "loading" ? html`<div class="p-settings-models__state"><${Loading} lines=${3} label="Loading the models settings" /></div>` : null}
    ${state === "restart" ? html`<div class="p-settings-models__state"><${St} icon="clock">Not here yet<//><${RestartLine} /></div>` : null}
    ${state === "error" ? html`<div class="p-settings-models__state"><${ErrorNotice} error=${res.error} onRetry=${res.reload} /></div>` : null}
    ${state === "ready" && view.problem ? html`<div class="p-settings-models__state"><${Notice} tone="bad"><${Line}>${problemLine(view.problem)}<//><//></div>` : null}
    ${state === "ready" && relayNotShown(view)
      ? html`<div class="p-settings-models__state"><${Notice} tone="warn"><${Line}>${text(view.relay.sentence, 200) || WORDS.relayOff}<//><//></div>` : null}
    ${state === "ready" ? html`
      <${OmegaGroup} view=${view} busy=${busy} act=${act} failure=${failure} switched=${switched} technical=${technical} setTechnical=${setTechnical} />
      <${AgentsGroup} view=${view} busy=${busy} act=${act} failure=${failure} technical=${technical} />
      <${AppsThinking} apps=${view.apps} />` : null}
  </div>`;
}
