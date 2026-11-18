// Settings: the Brain section (PLAN-BRAIN T14, on the pattern of settings-viewer.js). The switch that lets the eleven
// listed agents ask the brain door for passages of the owner's files and the books, the owner's Test question, and
// what was asked (the newest 50 lines the door keeps). From GET /api/brain-door, POST /api/brain-door/switch and
// POST /api/brain-door/test (routes/brain-door.mjs). The settings frame (pages/settings.js) draws the title and the
// line this module's statusLine gives. Everything that came through the server is shown as text and capped again.
// The tidy-up switch (POST /api/brain-door/tidy) lets the Chief of staff's routine leave tidy-up notes in Needs
// you; its label and line are the server's words.
// Its few lines reuse the Page viewer's classes (styles/pages/settings-viewer.css), so no stylesheet is added.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, ErrorNotice, Group, Loading, Notice, Row, Rows, St, Switch, TextInput } from "../kit/index.js";

const EVERY = 10000;

export const WORDS = {
  title: "Brain",
  intro: "Agents can be given the parts of your files and the books that a task needs, instead of reading every folder.",
  switchLabel: "Agents ask the brain for what they need",
  off: "Off. Agents read your files as before.",
  on: "On. Each task starts with a few passages picked from your files and the books, and an agent can ask for more. Nothing leaves this Mac. The Researcher never gets this.",
  switching: "Switching…",
  test: "Test",
  testWhat: "Ask the brain a question as an agent would. The passages come back as plain text.",
  testPlaceholder: "A question, for example: what did we promise Acme?",
  testing: "Asking…",
  nothing: "Nothing in the brain matches this.",
  notFound: "Not found in the brain:",
  asked: "What was asked",
  askedNone: "Nothing has been asked yet.",
  askedNotes: "Notes for a task",
  restart: "This section appears after the home screen is restarted: engine stop, then engine start.",
  notInstalled: "The brain door is not installed yet.",
  cannot: "The brain door cannot be switched on yet.",
};

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

// Plain text: control and invisible characters taken out, at most `n` characters.
export const plain = (v, n = 200) => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
  .slice(0, n);

export const switchLine = (on) => (on ? WORDS.on : WORDS.off);

export const DOOR_TONES = {
  on: { tone: "good", word: "Running" },
  off: { tone: "neutral", word: "Off" },
  unhealthy: { tone: "warn", word: "Not answering" },
  not_installed: { tone: "neutral", word: "Not installed" },
};
export function doorOf(view) {
  const s = obj(view) && obj(view.door) && Object.hasOwn(DOOR_TONES, view.door.state) ? view.door.state : "off";
  return { state: s, ...DOOR_TONES[s], sentence: obj(view) && obj(view.door) ? plain(view.door.sentence, 300) : "" };
}

// What the section draws: "loading", "restart" (the routes are not there yet), "error" or "ready".
export function sectionState(res) {
  if (res && res.data) return "ready";
  if (res && res.error) return res.error.status === 404 ? "restart" : "error";
  return "loading";
}

// The state line of the list of sections, from the answer of /api/brain-door.
export function statusLine(data) {
  const v = obj(data) ? data : {};
  if (v.problem) return { tone: "bad", text: "Its settings could not be read" };
  if (!v.on) return { tone: "neutral", text: "Off" };
  if (!v.answering) return { tone: "warn", text: "On, but the brain door is not running" };
  return { tone: "good", text: "On, agents can ask" };
}

// A newest-first "What was asked" line: { when, who, what, count }. `when` is the stored time cut to minutes.
export function askedLine(a) {
  const x = obj(a) ? a : {};
  const when = plain(x.at, 40).replace("T", " ").replace(/:\d{2}(\.\d+)?Z?$/, "");
  const what = x.kind === "notes" ? WORDS.askedNotes : plain(x.q, 200);
  const n = num(x.results);
  return { when, who: plain(x.agent, 40), what, count: n === 1 ? "1 passage" : `${n} passages` };
}

// The passages of a Test answer as plain rows: { place, text }.
export function passagesOf(answer) {
  const a = obj(answer) ? answer : {};
  return arr(a.results).filter(obj).slice(0, 8).map((r) => ({
    place: [plain(r.source, 160), plain(r.locator, 160)].filter(Boolean).join(" · "),
    text: plain(r.text, 1200),
  }));
}
export const notFoundLine = (answer) => {
  const list = obj(answer) ? arr(answer.notFound).map((w) => plain(w, 40)).filter(Boolean).slice(0, 12) : [];
  return list.length ? `${WORDS.notFound} ${list.join(", ")}.` : "";
};

const errorOf = (error) => ({ message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) });

function Failure({ failure, where }) {
  return failure && failure.where === where
    ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next ? html`<p class="p-settings-viewer__line">${failure.error.next}</p>` : null}<//>`
    : null;
}

function SwitchRow({ view, busy, act, failure }) {
  const on = Boolean(view.on);
  const locked = !on && !view.canSwitchOn;
  const door = doorOf(view);
  return html`
    <${Row} icon="brain" title=${WORDS.switchLabel}
      say=${html`${busy === "switch" ? WORDS.switching : switchLine(on)}
        ${locked ? html`<span class="p-settings-viewer__line">${door.sentence || WORDS.cannot}</span>` : null}`}
      state=${{ tone: door.tone, text: door.word }}
      control=${html`<${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
        onChange=${(next) => act("switch", "/api/brain-door/switch", { on: next }, switchLine(next))} />`} />
    <div class="p-settings-viewer__more"><${Failure} failure=${failure} where="switch" /></div>`;
}

// The tidy-up switch, in the server's words: { on, label, say }. Absent from an older server: no row.
export function tidyOf(view) {
  const t = obj(view) && obj(view.tidy) ? view.tidy : null;
  if (!t) return null;
  return { on: t.on === true, label: plain(t.label, 80), say: plain(t.say, 400) };
}

function TidyRow({ view, busy, act, failure }) {
  const t = tidyOf(view);
  if (!t || !t.label) return null;
  return html`
    <${Row} icon="list" title=${t.label}
      say=${busy === "tidy" ? WORDS.switching : t.say}
      control=${html`<${Switch} on=${t.on} disabled=${Boolean(busy)} label=${t.label}
        onChange=${(next) => act("tidy", "/api/brain-door/tidy", { on: next }, null)} />`} />
    <div class="p-settings-viewer__more"><${Failure} failure=${failure} where="tidy" /></div>`;
}

function TestRow({ view, busy, answer, question, setQuestion, runTest, failure }) {
  const running = doorOf(view).state === "on";
  const rows = answer ? passagesOf(answer) : [];
  const missing = answer ? notFoundLine(answer) : "";
  return html`
    <${Row} icon="search" title=${WORDS.test} say=${WORDS.testWhat}
      control=${html`<${Button} size="sm" variant="ghost" icon="play" onClick=${runTest} busy=${busy === "test"}
        disabled=${Boolean(busy) || !running || plain(question, 400).trim().length < 2}>${WORDS.test}<//>`} />
    <div class="p-settings-viewer__more">
      <${TextInput} value=${question} maxLength=${400} placeholder=${WORDS.testPlaceholder} aria-label="A question for the brain"
        onInput=${(e) => setQuestion(e.currentTarget.value)} />
      ${busy === "test" ? html`<p class="p-settings-viewer__line" role="status"><${St} icon="clock">${WORDS.testing}<//></p>` : null}
      <${Failure} failure=${failure} where="test" />
      ${answer && busy !== "test" ? html`<div class="p-settings-viewer__answer" role="status">
        ${rows.length ? rows.map((r, i) => html`<div key=${i} class="p-settings-viewer__line"><b>${r.place}</b><div>${r.text}</div></div>`)
          : html`<p class="p-settings-viewer__line">${WORDS.nothing}</p>`}
        ${missing ? html`<p class="p-settings-viewer__line">${missing}</p>` : null}
      </div>` : null}
    </div>`;
}

function AskedRow({ view }) {
  const lines = arr(view.asks).slice(0, 50).map(askedLine);
  return html`
    <${Row} icon="list" title=${WORDS.asked}
      say=${lines.length ? "The newest 50 questions and task notes." : WORDS.askedNone} />
    ${lines.length ? html`<div class="p-settings-viewer__more">
      ${lines.map((l, i) => html`<p key=${i} class="p-settings-viewer__line">${l.when} · ${l.who} · ${l.what} · ${l.count}</p>`)}
    </div>` : null}`;
}

export default function BrainSection() {
  const { announce } = useApp();
  const res = useResource("/api/brain-door", { every: EVERY });
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [question, setQuestion] = useState("");
  const state = sectionState(res);
  const view = fresh && fresh.base === res.data ? fresh.view : res.data;
  const ready = state === "ready" && obj(view);

  async function act(where, path, body, said) {
    setBusy(where);
    setFailure(null);
    try {
      const next = await api.post(path, body);
      setFresh({ view: next, base: res.data });
      if (said && typeof announce === "function") announce(said);
    } catch (error) {
      setFailure({ where, error: errorOf(error) });
      res.refresh();
    } finally {
      setBusy("");
    }
  }

  async function runTest() {
    setBusy("test");
    setFailure(null);
    try {
      setAnswer(await api.post("/api/brain-door/test", { q: plain(question, 400).trim() }));
      res.refresh();
    } catch (error) {
      setAnswer(null);
      setFailure({ where: "test", error: errorOf(error) });
    } finally {
      setBusy("");
    }
  }

  return html`<div class="p-settings-viewer" id="settings-brain">
    <p class="k-doc__intro">${WORDS.intro}</p>
    ${state === "loading" ? html`<div class="p-settings-viewer__state"><${Loading} lines=${3} label="Loading the brain's settings" /></div>` : null}
    ${state === "restart" ? html`<div class="p-settings-viewer__state"><${St} icon="clock">Not here yet<//><p class="p-settings-viewer__restart">${WORDS.restart}</p></div>` : null}
    ${state === "error" ? html`<div class="p-settings-viewer__state"><${ErrorNotice} error=${res.error} onRetry=${res.reload} /></div>` : null}
    ${ready ? html`<${Group}>
      <${Rows}>
        <${SwitchRow} view=${view} busy=${busy} act=${act} failure=${failure} />
        <${TestRow} view=${view} busy=${busy} answer=${answer} question=${question} setQuestion=${setQuestion} runTest=${runTest} failure=${failure} />
        <${AskedRow} view=${view} />
        <${TidyRow} view=${view} busy=${busy} act=${act} failure=${failure} />
      <//>
    <//>` : null}
  </div>`;
}
