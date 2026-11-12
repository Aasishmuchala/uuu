// Settings: the Models section (CONTRACTS-V4 C8 and C9). The owner pastes the Omega Plus key here, tests it,
// sees which model each agent would use, and switches the provider on or off. The key is typed into a password
// field that the server never fills; it lives only in this component's memory until Save, and is cleared then.
// It is never put in storage, the address bar, the console or an error message.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen } from "../lib/format.js";
import {
  Button, Card, DataTable, Dialog, ErrorNotice, Field, Loading, Mono, NextStep, Notice, Section, Select, StatusDot, Switch, TextInput,
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

// What the section draws: "loading", "restart" (the routes are not there yet), "error" or "ready".
export function sectionState(res) {
  if (res && res.data) return "ready";
  if (res && res.error) return res.error.status === 404 ? "restart" : "error";
  return "loading";
}

// The restart sentence, with the two commands set apart. The words are C9's, unchanged.
function RestartLine() {
  return html`<p class="p-settings__m-restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>".
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings__m-text">${children}</p>`);

function Intro() {
  return html`
    <p class="p-settings__m-lead">${WORDS.intro}</p>
    <${Notice} tone="warn">${WORDS.warning}<//>`;
}

function KeyCard({ view, busy, act, failure }) {
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const status = keyStatus(view.key);
  const saved = Boolean(view.key && view.key.saved);
  const t = view.lastTest;

  async function save(event) {
    event.preventDefault();
    if (!typed.trim()) return;
    const ok = await act("save", "/api/models/key", { key: typed }, "The key is saved.");
    if (ok) setTyped("");
  }

  return html`
    <${Card} class="p-settings__m-card">
      <div class="p-settings__m-head">
        <h3 class="p-settings__label">Your key</h3>
        <${StatusDot} tone=${status.tone} label=${status.word} />
      </div>
      <p class="p-settings__m-text">${status.sentence}</p>
      <form class="p-settings__m-key" onSubmit=${save} autocomplete="off">
        <${Field} label="Provider key" hint=${saved ? "Paste a new key to replace the saved one." : "It is kept on this Mac only and is never shown again."}
          error=${failure && failure.where === "save" ? failure.error : null}>
          <${TextInput} type="password" name="provider-key" autocomplete="off" autocapitalize="off" spellcheck=${false}
            value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)} placeholder=${saved ? "A key is saved" : "Paste your key here"} />
        <//>
        <div class="p-settings__m-buttons">
          <${Button} variant="primary" type="submit" busy=${busy === "save"} disabled=${Boolean(busy) || !typed.trim()}>Save key<//>
          <${Button} onClick=${() => act("test", "/api/models/test", {}, "The test is done.")} busy=${busy === "test"} disabled=${Boolean(busy) || !saved}>Test<//>
          <${Button} variant="quiet" onClick=${() => setAsking(true)} disabled=${Boolean(busy) || !saved}>Remove key<//>
        </div>
      </form>
      ${busy === "test" ? html`<p class="p-settings__m-text" role="status"><${StatusDot} tone="live" label="Testing the key and each picked model. This can take up to 30 seconds." /></p>` : null}
      ${failure && (failure.where === "test" || failure.where === "remove") ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next || null}<//>` : null}
      ${t ? html`<${TestResult} test=${t} />` : null}
      <${Dialog} open=${asking} title="Remove the key?" size="sm" onClose=${() => setAsking(false)}
        footer=${html`
          <${Button} data-autofocus onClick=${() => setAsking(false)}>Keep the key<//>
          <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("remove", "/api/models/key/remove", {}, "The key is removed."); }}>Remove key<//>`}>
        <p class="p-settings__m-text">The key is deleted from this Mac.${view.mode === "provider" ? " Omega Plus is switched off first, so your agents go back to your Claude and Codex plans." : ""}</p>
      <//>
    <//>`;
}

function TestResult({ test }) {
  const plan = Array.isArray(test.plan) ? test.plan.slice(0, 12) : [];
  const models = Array.isArray(test.models) ? test.models : [];
  return html`
    <div class="p-settings__m-test">
      <div class="p-settings__m-head">
        <h4 class="p-settings__m-sub">Last test${fullWhen(test.at) ? `, ${fullWhen(test.at)}` : ""}</h4>
        <${StatusDot} tone=${test.key === "ok" ? "ok" : test.key === "refused" ? "bad" : "warn"} label=${test.key === "ok" ? "Key works" : "Key problem"} />
      </div>
      <p class="p-settings__m-text">${testKeyLine(test.key)}</p>
      ${plan.length ? html`
        <dl class="p-settings__m-plan" aria-label="What Omega Plus says about your plan">
          ${plan.map((r, i) => html`<div key=${i} class="p-settings__m-planrow"><dt>${text(r.label, 80)}</dt><dd>${text(r.value, 120)}</dd></div>`)}
        </dl>` : null}
      ${models.length ? html`
        <ul class="p-settings__m-answers">
          ${models.map((m) => html`
            <li key=${m.model} class="p-settings__m-answer">
              <${StatusDot} tone=${m.answered ? "ok" : "bad"} label=${testLine(m)} />
              ${Array.isArray(m.agents) && m.agents.length ? html`<span class="p-settings__m-for">For ${m.agents.map((a) => text(a, 40)).join(", ")}</span>` : null}
            </li>`)}
        </ul>` : null}
    </div>`;
}

function AgentsCard({ view, busy, act, failure, technical }) {
  const readAt = view.catalogue && view.catalogue.readAt;
  const agents = Array.isArray(view.agents) ? view.agents : [];
  const missing = new Set(Array.isArray(view.missing) ? view.missing : []);
  const columns = [
    { key: "agent", label: "Agent" },
    { key: "needs", label: "Works on" },
    { key: "model", label: "Model" },
    { key: "used", label: "Used" },
  ];
  const cell = (a, c) => {
    if (c.key === "agent") {
      return html`<span class="p-settings__m-agent">${text(a.name, 80)}</span>
        ${technical ? html`<span class="p-settings__m-tech"><${Mono}>${text(a.slug, 80)}<//> on ${text(a.program, 20)}${a.plansModel ? `, ${text(a.plansModel, 40)} on the plan` : ""}</span>` : null}`;
    }
    if (c.key === "needs") return NEEDS[a.needs] || "Nothing set";
    if (c.key === "used") return usageLine(a.usage);
    const opts = orderOptions(a.options);
    if (!readAt || !opts.length) return html`<span class="p-settings__m-none">None yet</span>`;
    const list = a.pick ? opts : [{ value: "", label: "Choose a model", disabled: true }, ...opts];
    return html`
      <div class="p-settings__m-pick">
        <${Select} aria-label=${`Model for ${text(a.name, 80)}`} options=${list} value=${a.pick || ""}
          disabled=${Boolean(busy)} onChange=${(e) => e.currentTarget.value && act(`pick:${a.slug}`, "/api/models/pick", { agent: a.slug, model: e.currentTarget.value }, `${a.name} will use ${e.currentTarget.selectedOptions[0]?.textContent || "that model"}.`)} />
        ${missing.has(a.slug) ? html`<${StatusDot} tone="warn" label="No model yet" />` : null}
        ${a.source === "owner" ? html`
          <span class="p-settings__m-chosen">Chosen by you.
            <${Button} variant="quiet" size="sm" disabled=${Boolean(busy)}
              onClick=${() => act(`pick:${a.slug}`, "/api/models/pick", { agent: a.slug, model: null }, `${a.name} is back on the ranked model.`)}>Use the ranked one<//></span>` : null}
        ${technical && a.pick ? html`<span class="p-settings__m-tech"><${Mono}>${text(a.pick, 80)}<//></span>` : null}
      </div>`;
  };
  return html`
    <${Card} class="p-settings__m-card">
      <div class="p-settings__m-head">
        <h3 class="p-settings__label">The model each agent uses</h3>
        ${readAt ? html`<${Button} variant="quiet" size="sm" onClick=${() => act("refresh", "/api/models/refresh", {}, "The list of models is read again.")}
          busy=${busy === "refresh"} disabled=${Boolean(busy)}>Read the list again<//>` : null}
      </div>
      ${readAt
        ? html`<p class="p-settings__m-text">The best model for each kind of work is picked for you. Change any of them here.${fullWhen(readAt) ? ` The list of ${Number(view.catalogue.count) || 0} models was read on ${fullWhen(readAt)}.` : ""}</p>`
        : html`
          <div class="p-settings__m-empty">
            <p class="p-settings__m-text">${WORDS.notRead}</p>
            <${Button} variant="primary" onClick=${() => act("refresh", "/api/models/refresh", {}, "The list of models is read.")}
              busy=${busy === "refresh"} disabled=${Boolean(busy)}>Read the list<//>
          </div>`}
      ${failure && (failure.where === "refresh" || failure.where.startsWith("pick:")) ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next || null}<//>` : null}
      ${readAt && missing.size ? html`
        <${Notice} tone="warn">
          ${[...missing].map((s) => html`<p key=${s} class="p-settings__m-text">${missingLine((agents.find((a) => a.slug === s) || {}).name || s)}</p>`)}
        <//>` : null}
      ${agents.length ? html`<${DataTable} columns=${columns} rows=${agents.map((a) => ({ ...a, id: a.slug }))} renderCell=${cell} />` : null}
    <//>`;
}

function SwitchCard({ view, busy, act, failure, switched }) {
  const on = view.mode === "provider";
  const blockers = blockerLines(view);
  const locked = !on && !view.canSwitchOn;
  return html`
    <${Card} class=${`p-settings__m-card p-settings__m-switch${on ? " p-settings__m-switch--on" : ""}`}>
      <${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
        explain=${locked ? "It can be switched on when these are done:" : null}
        onChange=${(next) => act("mode", "/api/models/mode", { mode: next ? "provider" : "plans" }, next ? WORDS.on : WORDS.off, true)} />
      <p class="p-settings__m-state" role="status">
        ${busy === "mode"
          ? html`<${StatusDot} tone="live" label=${WORDS.switching} />`
          : html`<${StatusDot} tone=${on ? "ok" : "off"} label=${modeLine(view.mode)} />`}
      </p>
      ${locked ? html`
        <ul class="p-settings__m-steps">
          ${blockers.map((b, i) => html`<li key=${i}><${Line}>${b}<//></li>`)}
        </ul>` : null}
      ${switched && busy !== "mode" ? html`<${Notice} tone="ok" title=${WORDS.afterSwitch} />` : null}
      ${failure && failure.where === "mode" ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next || null}<//>` : null}
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

  const aside = state === "ready"
    ? html`<${Button} variant="quiet" onClick=${() => setTechnical(!technical)}>${technical ? "Hide technical details" : "Show technical details"}<//>`
    : null;

  return html`
    <${Section} title="Models" aside=${aside}>
      <div class="p-settings__models">
        <${Card} class="p-settings__m-card">
          <div class="p-settings__m-head">
            <h3 class="p-settings__label">Omega Plus</h3>
            ${state === "ready" ? html`<${StatusDot} tone=${view.mode === "provider" ? "ok" : "off"} label=${view.mode === "provider" ? "On" : "Off"} />` : null}
          </div>
          <${Intro} />
          ${state === "loading" ? html`<${Loading} lines=${3} label="Loading the models settings" />` : null}
          ${state === "restart" ? html`<div class="p-settings__m-later"><${StatusDot} tone="off" label="Not here yet" /><${RestartLine} /></div>` : null}
          ${state === "error" ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
          ${state === "ready" && view.problem ? html`<${Notice} tone="bad"><${Line}>${problemLine(view.problem)}<//><//>` : null}
          ${state === "ready" && view.relay && view.relay.state !== "on" ? html`<${Notice} tone="warn"><${Line}>${text(view.relay.sentence, 200) || WORDS.relayOff}<//><//>` : null}
          ${state === "ready" && technical ? html`
            <ul class="p-settings__m-techlist">
              <li>Provider: <${Mono}>${text(view.provider && view.provider.host, 120)}<//></li>
              <li>Model relay: <${Mono}>${text(view.relay && view.relay.state, 20)}<//></li>
              <li>Mode: <${Mono}>${text(view.mode, 20)}<//></li>
              <li>Models in the list: <${Mono}>${Number(view.catalogue && view.catalogue.count) || 0}<//></li>
            </ul>` : null}
        <//>
        ${state === "ready" ? html`
          <${KeyCard} view=${view} busy=${busy} act=${act} failure=${failure} />
          <${AgentsCard} view=${view} busy=${busy} act=${act} failure=${failure} technical=${technical} />
          <${SwitchCard} view=${view} busy=${busy} act=${act} failure=${failure} switched=${switched} />` : null}
      </div>
    <//>`;
}
