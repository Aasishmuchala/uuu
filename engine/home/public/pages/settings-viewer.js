// Settings: the Page viewer section (PLAN-V5 K15, T54; drawn as PLAN-COOK T56). The switch that lets two agents, the
// Builder and the Art director, open the pages the Builder makes in a hidden Chrome on this Mac, to take pictures of
// them. The settings frame (pages/settings.js) draws the title and the state this module's statusLine gives; this
// module draws one panel of the kit's rows into the column: the switch with its sentence, the viewer (its state,
// Chrome as it found it, what it opened today), and the owner's Test, which opens a page built into the engine (never
// anything an agent made) and shows its pictures small. From GET /api/viewer, POST /api/viewer/switch (T52b) and
// POST /api/viewer/test (T52).
// Chrome's version and every count come from the viewer through the home server, already cut to plain text there;
// they are shown here only as text, capped again.
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { Button, Checklist, ErrorNotice, Group, Icon, Loading, NextStep, Notice, Row, Rows, ShotPair, St, Switch } from "../kit/index.js";

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
  // Fix round R5: the live state as a chip in the viewer row's head.
  busyChip: "Opening a page",
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

// Whether the viewer process is not running, whatever the switch says: the panel's notice says so once.
export function doorNotRunning(view) {
  return doorState(obj(view) ? view.door : null).state !== "on";
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

// The state line of the list of sections, from the answer of /api/viewer.
export function statusLine(data) {
  const v = obj(data) ? data : {};
  if (v.problem) return { tone: "bad", text: "Its settings could not be read" };
  if (!v.on) return { tone: "neutral", text: "Off" };
  if (doorState(v.door).state !== "on") return { tone: "warn", text: "On, but the page viewer is not running" };
  if (chromeOf(v).found === false) return { tone: "warn", text: "On, but no Chrome was found" };
  if (!isOpen(v)) return { tone: "warn", text: "On, held" };
  const n = todayFigures(v).renders;
  return { tone: "good", text: n ? `On, ${n} opened today` : "On, ready to open pages" };
}

// ---------------------------------------------------------------------------------------------------------------
// Parts
// Every part is the kit's (Group, Rows, Row, St, Switch, Notice, ShotPair) placed into the settings column; this file
// adds only the drawing of the door's path.

// The restart sentence, with the two commands set apart. The words are the plan's, unchanged.
function RestartLine() {
  return html`<p class="p-settings-viewer__restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>", on a line of its own.
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings-viewer__line">${children}</p>`);

// The same inside a line of text (a row's words): the command set apart, every word kept.
function Said({ text }) {
  const t = String(text ?? "");
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
  return list.length ? html`<div class="p-settings-viewer__more">${list}</div>` : null;
}

// The door's path, drawn: the two agents, the page viewer, a hidden Chrome, as three neutral 28 px chips joined by a
// hairline; the viewer's chip carries a 6 px dot in its state's tone. The row's sentence says the same, so the
// drawing is for the eye only.
function DoorPath({ view }) {
  const open = isOpen(view);
  const dot = open ? "good" : view.on ? "warn" : "neutral";
  return html`<span class=${`p-settings-viewer__path${open ? " p-settings-viewer__path--open" : ""}`} aria-hidden="true">
    <span class="p-settings-viewer__node"><${Icon} name="team" size=${14} />Agents</span>
    <span class="p-settings-viewer__wire"></span>
    <span class="p-settings-viewer__node"><span class=${`p-settings-viewer__dot p-settings-viewer__dot--${dot}`}></span>Viewer</span>
    <span class="p-settings-viewer__wire"></span>
    <span class="p-settings-viewer__node"><${Icon} name="globe" size=${14} />Chrome</span>
  </span>`;
}

// The viewer's word as a row's state: open is good; held while switched on is a look; off or closed is grey.
function doorChip(view) {
  const word = doorWord(view);
  if (word === "Open") return { tone: "good", text: word };
  const s = doorState(view.door).state;
  return { tone: view.on && (s === "on" || s === "unhealthy") ? "warn" : "neutral", text: word };
}

// A Test's answer: the sentence with its tone's glyph (a success's check in the second ink: green is for state chips
// only) and, under it, the two pictures at most 240 px tall in a framed well across the panel.
function Answer({ result }) {
  return html`<div class="p-settings-viewer__answer" role="status">
    <p class="p-settings-viewer__line p-settings-viewer__said"><${St} tone=${toneOf(result.tone) === "good" ? "neutral" : toneOf(result.tone)} icon=${toneOf(result.tone) === "good" ? "check" : undefined}><${Said} text=${result.sentence} /><//></p>
    ${result.desktop || result.phone
      ? html`<div class="p-settings-viewer__well"><${ShotPair} desktop=${result.desktop} phone=${result.phone} label="The test page" /></div>`
      : null}
  </div>`;
}

function SwitchRow({ view, busy, act, failure }) {
  const on = Boolean(view.on);
  const locked = !on && !view.canSwitchOn;
  const door = doorState(view.door);
  // The viewer not running is said once, by the notice at the top of the panel, so the list leaves it out.
  const reasons = blockerLines(view).filter((r) => !(doorNotRunning(view) && r === door.sentence));
  return html`
    <${Row} icon="power" title=${WORDS.switchLabel}
      say=${html`${busy === "switch" ? WORDS.switching : switchLine(on)}
        ${locked && reasons.length ? html`<${Checklist} lead="It can be switched on when these are done:"
          items=${reasons.map((r) => ({ done: false, text: html`<${Said} text=${r} />` }))} />` : null}`}
      control=${html`<${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
        onChange=${(next) => act("switch", "/api/viewer/switch", { on: next }, switchLine(next))} />`}
      />
    <${More}><${Failure} failure=${failure} where="switch" /><//>`;
}

// The viewer itself: its state, what was opened today, whether a page is open now, and the door's path.
function ViewerRow({ view }) {
  const door = doorState(view.door);
  const f = todayFigures(view);
  // The viewer not running is said once, by the notice at the top of the panel.
  const said = !doorNotRunning(view);
  // The live state (a page being opened now) is a second chip in the row's head; the counts are a strip.
  return html`<${Row} icon="eye" title="The page viewer" state=${[doorChip(view), view.busy ? { tone: "neutral", text: WORDS.busyChip } : null]}
    say=${html`${said ? html`<${Said} text=${door.sentence} />` : null}
      <span class="p-settings-viewer__line p-settings-viewer__counts">${f.tiles.map(([label, n]) => html`<span key=${label} class="p-settings-viewer__count"><span>${label}</span> <b>${n}</b></span>`)}</span>
      <span class="p-settings-viewer__line"><${DoorPath} view=${view} /></span>`} />`;
}

// Chrome as the viewer found it, said once. Nothing is said while the viewer does not answer (it is not known then).
// Found is the usual case, so its chip is neutral; only Not found takes a colour (fix round R5).
function ChromeRow({ view }) {
  const chrome = chromeOf(view);
  if (chrome.found === null) return null;
  return html`<${Row} icon="globe" title="Chrome" state=${chrome.found ? { tone: "neutral", text: "Found" } : { tone: "warn", text: "Not found" }}
    say=${chrome.line} />`;
}

function TestRow({ view, busy, test, runTest, failure }) {
  const door = doorState(view.door);
  const mark = testMark(test);
  const result = test ? testResult(test) : null;
  return html`
    <${Row} icon="play" title=${WORDS.test} state=${{ tone: toneOf(mark.tone), text: mark.word }}
      say=${html`${WORDS.testWhat}${door.state !== "on" ? html`<span class="p-settings-viewer__line">${WORDS.testOnce}</span>` : null}`}
      control=${html`<${Button} size="sm" variant="ghost" icon="play" onClick=${runTest} busy=${busy === "test"} disabled=${Boolean(busy) || door.state !== "on"}>${WORDS.test}<//>`} />
    <${More}>
      ${busy === "test" ? html`<p class="p-settings-viewer__line" role="status"><${St} icon="clock">${WORDS.testing}<//></p>` : null}
      <${Failure} failure=${failure} where="test" />
    <//>
    ${result && busy !== "test" ? html`<${Answer} result=${result} />` : null}`;
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

  return html`<div class="p-settings-viewer" id="settings-viewer">
    <p class="k-doc__intro">${WORDS.intro}</p>
    ${state === "loading" ? html`<div class="p-settings-viewer__state"><${Loading} lines=${3} label="Loading the page viewer's settings" /></div>` : null}
    ${state === "restart" ? html`<div class="p-settings-viewer__state"><${St} icon="clock">Not here yet<//><${RestartLine} /></div>` : null}
    ${state === "error" ? html`<div class="p-settings-viewer__state"><${ErrorNotice} error=${res.error} onRetry=${res.reload} /></div>` : null}
    ${ready && view.problem ? html`<div class="p-settings-viewer__state"><${Notice} tone="bad"><${Line}>${problemLine(view)}<//><//></div>` : null}
    ${ready && doorNotRunning(view) ? html`<div class="p-settings-viewer__state"><${Notice} tone="warn"><${Line}>${doorState(view.door).sentence}<//><//></div>` : null}
    ${ready ? html`<${Group}>
      <${Rows}>
        <${SwitchRow} view=${view} busy=${busy} act=${act} failure=${failure} />
        <${ViewerRow} view=${view} />
        <${ChromeRow} view=${view} />
        <${TestRow} view=${view} busy=${busy} test=${test} runTest=${runTest} failure=${failure} />
      <//>
    <//>` : null}
  </div>`;
}
