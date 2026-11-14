// Settings: the Page viewer section (PLAN-V5 K15, T54). The switch that lets two agents, the Builder and the Art
// director, open the pages the Builder makes in a hidden Chrome on this Mac, to take pictures of them. What it does
// and who can ask come first, drawn as a door; then the switch, Chrome as the viewer found it, what it opened today,
// and the owner's Test, which opens a page built into the engine (never anything an agent made) and shows its
// pictures small. From GET /api/viewer, POST /api/viewer/switch (T52b) and POST /api/viewer/test (T52).
// Chrome's version and every count come from the viewer through the home server, already cut to plain text there;
// they are shown here only as text, capped again.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Avatar, Card, ErrorNotice, Icon, Loading, NextStep, Notice, Section, ShotPair, StatusDot, Switch, Button } from "../kit/index.js";

const EVERY = 10000;

// The sentences of K15 and T54, as written, and the few this section adds.
export const WORDS = {
  title: "Page viewer",
  intro: "When this is on, pages the Builder makes are opened in a hidden Chrome on this Mac to take pictures of them at desktop and phone width. Nothing is sent anywhere, and the pages can reach nothing but themselves.",
  switchLabel: "Let pages be opened to take pictures",
  off: "Off. No page is opened.",
  on: "On. Only the Builder and the Art director can ask.",
  doorOff: "The page viewer is off. Run: engine start",
  noChrome: "No Chrome was found on this Mac.",
  test: "Test",
  testWhat: "Opens a page built into the engine, nothing an agent made.",
  testing: "Opening the test page. This can take up to a minute.",
  testOnce: "It can be tested once the page viewer is running.",
  restart: "This section appears after the home screen is restarted: engine stop, then engine start.",
  switching: "Switching…",
  doorOn: "The page viewer is running.",
  unhealthy: "The page viewer is running but not answering. Run: engine stop, then engine start.",
  notInstalled: "The page viewer is not installed yet.",
  noAgents: "Run engine setup first, then try again.",
  cannot: "The page viewer cannot be switched on yet.",
  busyNow: "Opening a page now.",
  noPictures: "No picture came back.",
};

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

// Plain text: control and invisible characters taken out, at most `n` characters.
export const plain = (v, n = 200) => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
  .slice(0, n);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/settings-viewer.test.mjs)

// The switch's state sentence.
export const switchLine = (on) => (on ? WORDS.on : WORDS.off);

// The viewer's own state as a mark and a sentence: on, off, unhealthy or not installed.
export const DOOR = {
  on: { tone: "ok", word: "Running", sentence: WORDS.doorOn },
  off: { tone: "off", word: "Off", sentence: WORDS.doorOff },
  unhealthy: { tone: "warn", word: "Not answering", sentence: WORDS.unhealthy },
  not_installed: { tone: "off", word: "Not installed", sentence: WORDS.notInstalled },
};
export function doorState(door) {
  const s = obj(door) && Object.hasOwn(DOOR, door.state) ? door.state : "off";
  return { state: s, ...DOOR[s] };
}

// The word under the drawn door: open or closed while it runs (the switch), else the viewer's own state.
export function doorWord(view) {
  const v = obj(view) ? view : {};
  const d = doorState(v.door);
  if (d.state !== "on") return d.word;
  if (chromeOf(v).found === false) return "No Chrome";
  return v.on ? "Open" : "Closed";
}

// Open: switched on, the viewer running and Chrome found. Only then can the two agents' pages be opened.
export function isOpen(view) {
  const v = obj(view) ? view : {};
  return Boolean(v.on && !v.problem && doorState(v.door).state === "on" && chromeOf(v).found === true);
}

// Chrome as the viewer found it: { found: true | false | null, version, line }. "Chrome <version> is used." when
// found, K15's sentence when not, nothing while the viewer does not answer (it is not known then).
export function chromeOf(view) {
  const c = obj(view) && obj(view.chrome) ? view.chrome : {};
  const found = c.found === true ? true : c.found === false ? false : null;
  const version = found ? plain(c.version, 60).replace(/[^A-Za-z0-9 ./()-]/g, "").trim() : "";
  const line = found === true ? (version ? `Chrome ${version} is used.` : "Chrome is used.") : found === false ? WORDS.noChrome : "";
  return { found, version, line };
}

// Why the switch cannot be turned on, one sentence per blocker, in the order the server gives them.
export function blockerLines(view) {
  const v = obj(view) ? view : {};
  const out = [];
  for (const b of arr(v.blockers)) {
    if (b === "door_off") out.push(doorState(v.door).state === "on" ? WORDS.doorOff : doorState(v.door).sentence);
    else if (b === "no_chrome") out.push(WORDS.noChrome);
    else if (b === "no_agents") out.push(WORDS.noAgents);
  }
  if (!out.length && v.canSwitchOn === false) out.push(plain(v.whyNot, 300) || WORDS.cannot);
  return out;
}

// The mark beside the section's first card.
export function heroMark(view) {
  const v = obj(view) ? view : {};
  if (!v.on) return { tone: "off", word: "Off" };
  return { tone: isOpen(v) ? "ok" : "warn", word: "On" };
}

// Today's counts: { renders, refused, tiles: [[label, n]] }.
export function todayFigures(view) {
  const t = obj(view) && obj(view.today) ? view.today : {};
  const renders = num(t.renders);
  const refused = num(t.refused);
  return { renders, refused, tiles: [["Opened today", renders], ["Refused today", refused]] };
}

// The answer of Test ({ ok, seconds, pictures, images, sentence }) as a mark, the server's sentence, and the two
// light pictures of its page: { tone, word, sentence, desktop, phone }.
export function testResult(answer) {
  const a = obj(answer) ? answer : {};
  const said = plain(a.sentence, 300);
  const images = arr(a.images).filter(obj);
  const pick = (w) => { const i = images.find((x) => x.width === w && x.scheme === "light"); return i && typeof i.url === "string" ? i.url : null; };
  if (a.ok === true) return { tone: "ok", word: "Works", sentence: said || WORDS.noPictures, desktop: pick(1280), phone: pick(390) };
  if (said === WORDS.noChrome) return { tone: "bad", word: "No Chrome", sentence: said, desktop: null, phone: null };
  if (said === WORDS.doorOff) return { tone: "warn", word: "Not running", sentence: said, desktop: null, phone: null };
  return { tone: "bad", word: "Did not work", sentence: said || "The test did not work.", desktop: null, phone: null };
}

// The mark beside "Test": what the last Test found, else that it was not run.
export const testMark = (answer) => (answer ? (({ tone, word }) => ({ tone, word }))(testResult(answer)) : { tone: "off", word: "Not tested yet" });

// A file that could not be read, in the server's words first.
export const PROBLEMS = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
};
export function problemLine(view) {
  const p = obj(view) ? view.problem : null;
  if (!p) return "";
  return plain(view.problemSentence, 300) || PROBLEMS[p] || "Part of these settings could not be read.";
}

// What the section draws: "loading", "restart" (the routes are not there yet), "error" or "ready".
export function sectionState(res) {
  if (res && res.data) return "ready";
  if (res && res.error) return res.error.status === 404 ? "restart" : "error";
  return "loading";
}

// ---------------------------------------------------------------------------------------------------------------
// Parts

// The restart sentence, with the two commands set apart. The words are the plan's, unchanged.
function RestartLine() {
  return html`<p class="p-settings__m-restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>".
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings__m-text">${children}</p>`);

const Failure = ({ failure, where }) => (failure && failure.where === where
  ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next ? html`<${Line}>${failure.error.next}<//>` : null}<//>`
  : null);

// The door, drawn: the Builder and the Art director, the page viewer, a hidden Chrome. The other agents stop at the
// door. The words around it say all of this; the drawing is for the eye only.
function DoorMap({ view }) {
  const open = isOpen(view);
  const word = view ? doorWord(view) : "";
  const chrome = view ? chromeOf(view) : { found: null };
  return html`<div class=${`p-settings__w-map${open ? " p-settings__w-map--open" : ""}`} aria-hidden="true">
    <span class="p-settings__w-node p-settings__w-node--agent">
      <span class="p-settings__v-pair"><${Avatar} slug="builder" name="Builder" size=${32} /><${Avatar} name="Art director" size=${32} /></span>
      <span class="p-settings__w-name">Builder</span>
      <span class="p-settings__w-name p-settings__v-second">Art director</span>
    </span>
    <span class="p-settings__w-wire"></span>
    <span class="p-settings__w-node p-settings__w-node--door">
      <span class="p-settings__w-door"><${Icon} name=${open ? "check" : "lock"} size=${16} /></span>
      <span class="p-settings__w-name">Page viewer</span>
      ${word ? html`<span class="p-settings__w-state">${word}</span>` : null}
    </span>
    <span class="p-settings__w-wire p-settings__w-wire--out"></span>
    <span class="p-settings__w-node p-settings__w-node--web">
      <span class=${`p-settings__v-chrome${chrome.found === false ? " p-settings__v-chrome--none" : ""}`}><span class="p-settings__v-chrome-bar"></span></span>
      <span class="p-settings__w-name">Hidden Chrome</span>
      ${chrome.found === false ? html`<span class="p-settings__w-state">Not found</span>` : null}
    </span>
    <span class="p-settings__w-node p-settings__w-node--others">
      <span class="p-settings__w-others"><${Icon} name="team" size=${16} /></span>
      <span class="p-settings__w-name">Other agents</span>
    </span>
    <span class="p-settings__w-wire p-settings__w-wire--shut"><${Icon} name="cross" size=${12} /></span>
  </div>`;
}

function SwitchBlock({ view, busy, act, failure }) {
  const on = Boolean(view.on);
  const locked = !on && !view.canSwitchOn;
  const reasons = blockerLines(view);
  const mark = heroMark(view);
  return html`<div class="p-settings__w-switch">
    <${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
      onChange=${(next) => act("switch", "/api/viewer/switch", { on: next }, switchLine(next))} />
    <p class="p-settings__m-state" role="status">
      ${busy === "switch"
        ? html`<${StatusDot} tone="live" label=${WORDS.switching} />`
        : html`<${StatusDot} tone=${on ? mark.tone : "off"} label=${switchLine(on)} />`}
    </p>
    ${locked && reasons.length ? html`
      <p class="p-settings__m-text">It can be switched on when these are done:</p>
      <ul class="p-settings__m-steps">
        ${reasons.map((r, i) => html`<li key=${i}><${Line}>${r}<//></li>`)}
      </ul>` : null}
    <${Failure} failure=${failure} where="switch" />
  </div>`;
}

// Chrome as found, what was opened today, and whether a page is open now. Chrome not found is said once, where it
// is something to do: in the list under the switch while it is off, in a notice while it is on.
function Facts({ view }) {
  const chrome = chromeOf(view);
  const f = todayFigures(view);
  return html`<div class="p-settings__v-facts">
    ${chrome.found ? html`<p class="p-settings__v-chromeline"><${Icon} name="check" size=${16} /><span>${chrome.line}</span></p>` : null}
    <dl class="p-settings__w-counts p-settings__v-counts" aria-label="Today">
      ${f.tiles.map(([label, n]) => html`<div key=${label} class="p-settings__w-count"><dt>${label}</dt><dd>${n}</dd></div>`)}
    </dl>
    ${view.busy ? html`<p class="p-settings__m-text"><${StatusDot} tone="live" label=${WORDS.busyNow} /></p>` : null}
  </div>`;
}

function TestCard({ view, busy, test, runTest, failure }) {
  const door = doorState(view.door);
  const mark = testMark(test);
  const result = test ? testResult(test) : null;
  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">${WORDS.test}</h3>
      <${StatusDot} tone=${mark.tone} label=${mark.word} />
    </div>
    <p class="p-settings__m-text">${WORDS.testWhat}</p>
    <div class="p-settings__m-buttons">
      <${Button} icon="play" onClick=${runTest} busy=${busy === "test"} disabled=${Boolean(busy) || door.state !== "on"}>${WORDS.test}<//>
    </div>
    ${door.state !== "on" ? html`<p class="p-settings__m-text">${WORDS.testOnce}</p>` : null}
    ${busy === "test" ? html`<p class="p-settings__m-text" role="status"><${StatusDot} tone="live" label=${WORDS.testing} /></p>` : null}
    <${Failure} failure=${failure} where="test" />
    ${result && busy !== "test" ? html`
      <div class=${`p-settings__g-answer p-settings__g-answer--${result.tone} p-settings__v-answer`} role="status">
        <${StatusDot} tone=${result.tone} label=${result.word} hideLabel=${true} />
        <div class="p-settings__g-answer-words">
          ${/\bRun:/.test(result.sentence) ? html`<${NextStep} text=${result.sentence} />` : html`<p class="p-settings__g-answer-line">${result.sentence}</p>`}
          ${result.desktop || result.phone ? html`<${ShotPair} desktop=${result.desktop} phone=${result.phone} label="The test page" small=${true} />` : null}
        </div>
      </div>` : null}
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The section

export default function ViewerSection() {
  const { announce } = useApp();
  const res = useResource("/api/viewer", { every: EVERY });
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const [test, setTest] = useState(null);
  const state = sectionState(res);
  // The answer of the last action is shown until the next quiet refresh brings a newer view.
  const view = fresh && fresh.base === res.data ? fresh.view : res.data;
  const ready = state === "ready" && obj(view);
  const on = Boolean(ready && view.on);
  const door = ready ? doorState(view.door) : null;
  const mark = ready ? heroMark(view) : null;
  const errorOf = (error) => ({ message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) });

  async function act(where, path, body, said) {
    setBusy(where);
    setFailure(null);
    try {
      const next = await api.post(path, body);
      setFresh({ view: next, base: res.data });
      if (said) announce(said);
      return true;
    } catch (error) {
      setFailure({ where, error: errorOf(error) });
      res.refresh();
      return false;
    } finally {
      setBusy("");
    }
  }

  // Test: the home server's own page through the viewer. Its answer is kept on screen until the next Test.
  async function runTest() {
    setBusy("test");
    setFailure(null);
    try {
      const answer = await api.post("/api/viewer/test", {});
      setTest(answer);
      announce(testResult(answer).sentence);
      res.refresh();
    } catch (error) {
      setTest(null);
      setFailure({ where: "test", error: errorOf(error) });
    } finally {
      setBusy("");
    }
  }

  return html`
    <div class="p-settings__viewer" id="settings-viewer">
      <${Section} title=${WORDS.title}>
        <div class="p-settings__models">
          <${Card} class=${`p-settings__m-card p-settings__w-hero${ready && isOpen(view) ? " p-settings__w-hero--on" : ""}${on && !isOpen(view) ? " p-settings__g-hero--held" : ""}`}>
            <div class="p-settings__m-head">
              <h3 class="p-settings__label">The page viewer</h3>
              ${mark ? html`<${StatusDot} tone=${mark.tone} label=${mark.word} />` : null}
            </div>
            <div class="p-settings__w-intro">
              <div class="p-settings__w-words">
                <p class="p-settings__m-lead">${WORDS.intro}</p>
                ${ready ? html`<${Facts} view=${view} />` : null}
              </div>
              <${DoorMap} view=${ready ? view : null} />
            </div>
            ${state === "loading" ? html`<${Loading} lines=${3} label="Loading the page viewer's settings" />` : null}
            ${state === "restart" ? html`<div class="p-settings__m-later"><${StatusDot} tone="off" label="Not here yet" /><${RestartLine} /></div>` : null}
            ${state === "error" ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
            ${ready && view.problem ? html`<${Notice} tone="bad"><${Line}>${problemLine(view)}<//><//>` : null}
            ${ready ? html`<${SwitchBlock} view=${view} busy=${busy} act=${act} failure=${failure} />` : null}
            ${ready && on && door.state !== "on" ? html`<${Notice} tone="warn"><${Line}>${door.sentence}<//><//>` : null}
            ${ready && on && door.state === "on" && chromeOf(view).found === false ? html`<${Notice} tone="warn" title=${WORDS.noChrome} />` : null}
          <//>
          ${ready ? html`<${TestCard} view=${view} busy=${busy} test=${test} runTest=${runTest} failure=${failure} />` : null}
        </div>
      <//>
    </div>`;
}
