// Settings: the Web section (PLAN-V5 K11, T35). The switch that lets one agent, the Researcher, read the public web
// through the web door. What it does, what leaves this Mac and who can use it come first; then the switch, the
// owner's three lists, how it searches, the owner's Test, and every address it opened, newest first.
// A search key is typed into a password field that the server never fills; it lives only in this component's
// memory until Save, and is cleared then. It is never put in storage, the address bar, the console or a message.
// An address, a search's words and every list entry come from the web or from typing: they are shown only as plain
// capped text, never as HTML.
import { html, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { count, fullWhen } from "../lib/format.js";
import {
  Avatar, Button, Card, Dialog, ErrorNotice, Field, Icon, Loading, NextStep, Notice, Ring, Section, StatusDot, Switch, TextInput, Time,
} from "../kit/index.js";

const EVERY = 10000;

// The sentences of K11, as written, and the few this section adds.
export const WORDS = {
  title: "Web",
  intro: "One agent, the Researcher, can read public web pages and watch videos through the web door. No other agent can reach the internet.",
  leaves: "When this is on, the addresses the Researcher opens and the words it searches for leave this Mac. It can read only its own task and what you mark as fine to share. What it brings back is treated as reference, never as instructions.",
  switchLabel: "Let the Researcher use the web",
  off: "Off. No agent can reach the internet.",
  on: "On. Every address it opens is listed below.",
  doorOff: "The web door is off. Run: engine start",
  searchDown: "Search is not answering. Reading a page by its address still works.",
  noVisits: "Nothing has been opened yet.",
  allow: "Only these sites (leave empty for any public site)",
  block: "Never these sites",
  watch: "Video sites it may watch",
  keyless: "Search without an account (may stop working)",
  brave: "Search with a Brave key",
  keyField: "Search key",
  test: "Test",
  save: "Save",
  restart: "This section appears after the home screen is restarted: engine stop, then engine start.",
  switching: "Switching…",
  doorOn: "The web door is running.",
  notInstalled: "The web door is not installed yet.",
  unhealthy: "The web door is running but not answering. Run: engine stop, then engine start.",
  noResearcher: "The Researcher is not set up yet. Run: engine setup",
  cannot: "The web cannot be switched on yet.",
  testWhat: "Test opens one page, example.com, and searches for the word \"architecture\", from this Mac. It works while the switch is off.",
  listsHint: "Type a site's name and press Enter. A name covers its sub-sites too: example.com also covers www.example.com.",
};

// The three lists, in K11's words, with what an empty list means.
export const LISTS = [
  { key: "allow", label: WORDS.allow, short: "Only these sites", empty: "Empty, so any public site may be opened.", placeholder: "example.com" },
  { key: "block", label: WORDS.block, short: "Never these sites", empty: "None yet.", placeholder: "example.com" },
  { key: "watchHosts", label: WORDS.watch, short: "Video sites it may watch", empty: "None, so it cannot watch videos.", placeholder: "vimeo.com" },
];

export const MAX_HOSTS = 200;
// K11 row 8's pattern for a site's name, after lower-casing (the web door's own, engine/web/address.mjs).
export const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

// Plain text: control and invisible characters taken out, at most `n` characters.
export const plain = (v, n = 200) => String(v ?? "")
  .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
  .slice(0, n);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested in test/pages/settings-web.test.mjs)

// The switch's state sentence.
export const switchLine = (on) => (on ? WORDS.on : WORDS.off);

// The web door's state as a mark and a sentence: on, off, unhealthy or not installed.
export const DOOR = {
  on: { tone: "ok", word: "Running", sentence: WORDS.doorOn },
  off: { tone: "off", word: "Off", sentence: WORDS.doorOff },
  unhealthy: { tone: "warn", word: "Not answering", sentence: WORDS.unhealthy },
  not_installed: { tone: "off", word: "Not installed", sentence: WORDS.notInstalled },
};
export function doorState(door) {
  const s = door && typeof door === "object" && Object.hasOwn(DOOR, door.state) ? door.state : "off";
  return { state: s, ...DOOR[s] };
}

// Why the switch cannot be turned on, one sentence per blocker, in the order the server gives them.
export function blockerLines(view) {
  const v = view && typeof view === "object" ? view : {};
  const out = [];
  for (const b of arr(v.blockers)) {
    if (b === "no_researcher") out.push(WORDS.noResearcher);
    else if (b === "door_off") out.push(doorState(v.door).sentence);
  }
  if (!out.length && v.canSwitchOn === false) out.push(WORDS.cannot);
  return out;
}

// K11's search-down sentence when the last test found search not answering, else "".
export function searchDownLine(view) {
  const t = view && view.lastTest;
  return t && typeof t === "object" && t.search && t.search.ok === false ? WORDS.searchDown : "";
}

// The sentence for a list entry that is not a site's name.
export const refusedLine = (typed) => `"${plain(typed, 80)}" is not a site name.`;

// One typed entry as a site's name: lower case, a leading "*." or "." dropped, and from a pasted address only its
// site (an address of www.example.com with a path gives "www.example.com"). -> { host } or { host: null, refused: sentence }.
export function hostCheck(text) {
  const typed = plain(text, 300).trim();
  if (!typed) return { host: null, refused: "" };
  let s = typed.toLowerCase();
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/.exec(s);
  if (m) s = m[1].replace(/^[^@]*@/, "").replace(/:\d{1,5}$/, "");
  else s = s.split(/[/?#]/)[0];
  s = s.replace(/^\*?\./, "").replace(/\.$/, "");
  return HOST_PATTERN.test(s) ? { host: s, refused: "" } : { host: null, refused: refusedLine(typed) };
}

// What was typed or pasted, as entries: split at commas, semicolons and line breaks; words split at spaces only when
// every word is a site's name ("a.com b.com" is two, "exa mple" is one entry, refused as it is).
export function entriesOf(text) {
  const out = [];
  for (const chunk of String(text ?? "").slice(0, 4000).split(/[,;\n\r\t]+/)) {
    const t = chunk.trim();
    if (!t) continue;
    const words = t.split(/\s+/);
    if (words.length > 1 && words.every((w) => hostCheck(w).host)) out.push(...words);
    else out.push(t);
  }
  return out.slice(0, MAX_HOSTS);
}

// The list after adding what was typed: new names at the end, a name already there once, at most `max`.
// -> { list, refused: [typed entries that are not names], full }.
export function addHosts(list, text, max = MAX_HOSTS) {
  const out = arr(list).filter((h) => typeof h === "string");
  const refused = [];
  let full = false;
  for (const entry of entriesOf(text)) {
    const c = hostCheck(entry);
    if (!c.host) { refused.push(plain(entry, 80)); continue; }
    if (out.includes(c.host)) continue;
    if (out.length >= max) { full = true; continue; }
    out.push(c.host);
  }
  return { list: out, refused, full };
}

// An address cut in the middle when it is longer than `max` characters ("journal.example.org/2026/…/light?ref=2").
// The "https://" in front is left out; anything else stays as it was.
export function shortAddress(text, max = 64) {
  const s = plain(text, 1024).replace(/^https:\/\//i, "");
  const n = Math.max(9, Math.round(Number(max)) || 64);
  const chars = [...s];
  if (chars.length <= n) return s;
  const head = Math.ceil((n - 1) * 0.6);
  const tail = n - 1 - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

// What kind of visit it was, in a word, and its picture.
export const KIND_WORDS = { fetch: "Page", search: "Search", watch: "Video" };
const KIND_ICONS = { fetch: "file", search: "search", watch: "video" };

// Why the door refused, by its code.
export const WHY = {
  web_blocked: "Not allowed by your lists.",
  web_private_address: "It led to this Mac or a private network.",
  web_bad_address: "Not an address it may open.",
  web_too_big: "Larger than 5 MB.",
  web_not_text: "Not a page of text.",
  web_too_many: "Over the limit for the hour or the day.",
  web_off: "The web was switched off.",
  web_watch_off: "Watching videos was not available.",
  web_watch_site: "This video site cannot be watched on this Mac yet.",
  web_watch_busy: "Another video was being watched.",
  web_unreachable: "The site could not be reached.",
};

// A visit's result in one word, its tone and a short reason: { word, tone, why }.
export function visitResult(v) {
  const x = v && typeof v === "object" ? v : {};
  if (x.result === "ok") return { word: x.kind === "search" ? "Searched" : x.kind === "watch" ? "Watched" : "Opened", tone: "ok", why: "" };
  if (x.result === "site_error") {
    return { word: "Error", tone: "warn", why: Number.isInteger(x.status) ? `The site answered ${x.status}.` : "The site answered with an error." };
  }
  if (x.result === "unreachable") return { word: "Unreachable", tone: "warn", why: WHY.web_unreachable };
  if (x.code === "web_search_down") return { word: "Failed", tone: "warn", why: "Search was not answering." };
  return { word: "Refused", tone: "bad", why: WHY[x.code] || "The web door refused it." };
}

// What a visit shows as its address: the address, or a search's words in quotes.
export const visitText = (v) => (v && v.kind === "search" ? `"${plain(v.url, 300)}"` : plain(v && v.url, 1024));

// Two pages of visits as one list, newest first, each visit once.
export function mergeVisits(a, b) {
  const seen = new Set();
  const out = [];
  for (const v of [...arr(a), ...arr(b)]) {
    if (!v || typeof v !== "object" || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at))) continue;
    const k = `${v.at}|${v.kind}|${v.url}|${v.status}|${v.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 2000);
}

// Today's counts beside the caps.
export function todayFigures(view) {
  const t = (view && view.today) || {};
  const c = (view && view.caps) || {};
  const used = num(t.fetches) + num(t.searches) + num(t.watches);
  const perDay = num(c.perDay);
  const perHour = num(c.perHour);
  return {
    used, perDay, perHour,
    pages: num(t.fetches), searches: num(t.searches), videos: num(t.watches), refused: num(t.refused),
    line: perDay ? `${used} of ${perDay} today` : `${used} today`,
    caps: `At most ${perHour} an hour and ${perDay} a day.`,
  };
}

// The last test as a mark ({ tone, word }) and as two lines ([{ tone, text }]).
export function testMark(t) {
  if (!t || typeof t !== "object") return { tone: "off", word: "Not tested yet" };
  const f = Boolean(t.fetch && t.fetch.ok);
  const s = Boolean(t.search && t.search.ok);
  if (f && s) return { tone: "ok", word: "Works" };
  if (f) return { tone: "warn", word: "Search is down" };
  return { tone: "bad", word: "Not working" };
}
export function testRows(t) {
  if (!t || typeof t !== "object") return [];
  const f = t.fetch && typeof t.fetch === "object" ? t.fetch : {};
  const s = t.search && typeof t.search === "object" ? t.search : {};
  return [
    { tone: f.ok ? "ok" : "bad", text: plain(f.sentence, 200) || (f.ok ? "Reading a page worked." : "Reading a page did not work.") },
    { tone: s.ok && s.results > 0 ? "ok" : "warn", text: plain(s.sentence, 200) || (s.ok ? "Search answered." : WORDS.searchDown) },
  ];
}

// A file that could not be read, in plain words: the server's own sentence first.
export const PROBLEMS = {
  state_unreadable: "The doors' switches could not be read, so every door is off. Saving anything here writes them again, all off but what you change.",
  folder_unsafe: "The folder shared with the Researcher is not a plain folder, so nothing more can be shared.",
  shared_unreadable: "The list of files shared with the Researcher could not be read.",
};
export function problemLine(view) {
  const p = view && view.problem;
  if (!p) return "";
  return plain(view.problemSentence, 300) || PROBLEMS[p] || "Part of these settings could not be read.";
}

// "Shared with the Researcher: 2 files" (the Files page says the same).
export const sharedLine = (n) => `Shared with the Researcher: ${count(num(n), "file")}`;

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

// The word under the drawn door: open or closed while it runs (the switch), else the door's own state.
export function doorWord(on, door) {
  const d = doorState(door);
  if (d.state !== "on") return d.word;
  return on ? "Open" : "Closed";
}

// The door, drawn: the Researcher, the door, the public web. The other agents stop at the door. The words around it
// say all of this; the drawing is for the eye only.
function DoorMap({ open, on, door }) {
  const word = door ? doorWord(on, door) : "";
  return html`<div class=${`p-settings__w-map${open ? " p-settings__w-map--open" : ""}`} aria-hidden="true">
    <span class="p-settings__w-node p-settings__w-node--agent">
      <${Avatar} name="Researcher" size=${32} />
      <span class="p-settings__w-name">Researcher</span>
    </span>
    <span class="p-settings__w-wire"></span>
    <span class="p-settings__w-node p-settings__w-node--door">
      <span class="p-settings__w-door"><${Icon} name=${open ? "check" : "lock"} size=${16} /></span>
      <span class="p-settings__w-name">Web door</span>
      ${word ? html`<span class="p-settings__w-state">${word}</span>` : null}
    </span>
    <span class="p-settings__w-wire p-settings__w-wire--out"></span>
    <span class="p-settings__w-node p-settings__w-node--web">
      <span class="p-settings__w-globe"></span>
      <span class="p-settings__w-name">Public web</span>
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
  // On while the door is not running: the words stay K11's, the mark warns (the notice below says why).
  const tone = on ? (doorState(view.door).state === "on" ? "ok" : "warn") : "off";
  return html`<div class="p-settings__w-switch">
    <${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
      onChange=${(next) => act("switch", "/api/web/switch", { on: next }, switchLine(next))} />
    <p class="p-settings__m-state" role="status">
      ${busy === "switch"
        ? html`<${StatusDot} tone="live" label=${WORDS.switching} />`
        : html`<${StatusDot} tone=${tone} label=${switchLine(on)} />`}
    </p>
    ${locked ? html`
      <p class="p-settings__m-text">It can be switched on when these are done:</p>
      <ul class="p-settings__m-steps">
        ${reasons.map((r, i) => html`<li key=${i}><${Line}>${r}<//></li>`)}
      </ul>` : null}
    <${Failure} failure=${failure} where="switch" />
  </div>`;
}

function SharedLine({ view }) {
  const n = arr(view.shared).length;
  return html`<p class="p-settings__w-shared">
    <${Icon} name="lock" size=${14} />
    <span>${sharedLine(n)}.</span>
    <a href=${n ? "#/files?shared=1" : "#/files"}>${n ? "See them in Files" : "Choose some in Files"}</a>
  </p>`;
}

// One of the three lists: a field to add names, and the names as chips. A name that is not a site's name is
// shown as a refused chip, with one sentence, and is never sent.
function HostList({ spec, hosts, busy, save, failure }) {
  const [hostText, setHostText] = useState("");
  const [refused, setRefused] = useState([]);
  const [full, setFull] = useState(false);
  const list = arr(hosts).filter((h) => typeof h === "string");
  const where = `list:${spec.key}`;
  const serverError = failure && failure.where === where ? failure.error.message : "";
  const last = refused[refused.length - 1];
  const sentence = last ? refusedLine(last) : full ? `${MAX_HOSTS} sites is the most for one list.` : serverError;

  async function add(event) {
    event.preventDefault();
    if (!hostText.trim() || busy) return;
    const r = addHosts(list, hostText);
    setRefused(r.refused);
    setFull(r.full);
    const added = r.list.length - list.length;
    if (!added) { setHostText(""); return; }
    const done = await save(spec.key, r.list, added === 1 ? `${r.list[r.list.length - 1]} is added.` : `${added} sites are added.`);
    if (done) setHostText("");
  }
  const remove = (h) => {
    setFull(false);
    save(spec.key, list.filter((x) => x !== h), `${h} is taken off.`);
  };

  return html`<div class="p-settings__w-list">
    <form onSubmit=${add} autocomplete="off">
      <${Field} label=${spec.label} error=${sentence || null}>
        <div class="p-settings__w-addrow">
          <${TextInput} value=${hostText} maxLength=${4000} placeholder=${spec.placeholder} autocapitalize="off" spellcheck=${false}
            onInput=${(e) => setHostText(e.currentTarget.value)} />
          <${Button} type="submit" icon="plus" busy=${busy === where} disabled=${Boolean(busy) || !hostText.trim()}>Add<//>
        </div>
      <//>
    </form>
    ${list.length || refused.length ? html`
      <ul class="p-settings__w-chips" aria-label=${`${spec.short}: ${count(list.length, "site")}`}>
        ${list.map((h) => html`<li key=${h} class="p-settings__w-chip">
          <span class="p-settings__w-chip-name">${plain(h, 253)}</span>
          <button type="button" class="p-settings__w-chip-x" aria-label=${`Take ${plain(h, 253)} off`} disabled=${Boolean(busy)}
            onClick=${() => remove(h)}><${Icon} name="cross" size=${12} /></button>
        </li>`)}
        ${refused.map((t, i) => html`<li key=${`refused-${i}`} class="p-settings__w-chip p-settings__w-chip--bad">
          <${Icon} name="alert" size=${12} />
          <span class="p-settings__w-chip-name">${plain(t, 80)}</span>
          <span class="k-sr">Refused, not a site name.</span>
          <button type="button" class="p-settings__w-chip-x" aria-label=${`Clear ${plain(t, 80)}`}
            onClick=${() => setRefused(refused.filter((_, j) => j !== i))}><${Icon} name="cross" size=${12} /></button>
        </li>`)}
      </ul>` : html`<p class="p-settings__w-none">${spec.empty}</p>`}
  </div>`;
}

function ListsCard({ view, busy, act, failure }) {
  const save = (key, list, said) => act(`list:${key}`, "/api/web/lists", { [key]: list }, said);
  return html`<${Card} class="p-settings__m-card p-settings__w-listcard">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">What it may open</h3>
    </div>
    <p class="p-settings__m-text">${WORDS.listsHint}</p>
    <div class="p-settings__w-lists">
      ${LISTS.map((spec) => html`<${HostList} key=${spec.key} spec=${spec} hosts=${view[spec.key]} busy=${busy} save=${save} failure=${failure} />`)}
    </div>
  <//>`;
}

function SearchCard({ view, busy, act, failure }) {
  const [wantBrave, setWantBrave] = useState(false);
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const keyBox = useRef(null);
  const saved = Boolean(view.searchKeySaved);
  const chosen = view.search === "brave" || wantBrave ? "brave" : "keyless";
  const down = searchDownLine(view);
  const showKey = chosen === "brave" || saved;
  const tested = view.lastTest && view.lastTest.search && view.lastTest.search.ok;
  const mark = down
    ? { tone: "warn", word: "Not answering" }
    : { tone: tested ? "ok" : "off", word: view.search === "brave" ? "With your Brave key" : "Without an account" };
  const focusKey = () => setTimeout(() => {
    const input = keyBox.current && keyBox.current.querySelector("input");
    if (input) input.focus();
  }, 0);

  async function choose(id) {
    if (id === "keyless") {
      setWantBrave(false);
      if (view.search !== "keyless") await act("search", "/api/web/search", { search: "keyless" }, "Search now works without an account.");
      return;
    }
    if (saved) {
      if (view.search !== "brave") await act("search", "/api/web/search", { search: "brave" }, "Search now uses your Brave key.");
      return;
    }
    setWantBrave(true);
    focusKey();
  }
  async function save(event) {
    event.preventDefault();
    if (!typed.trim()) return;
    const ok = await act("key", "/api/web/search-key", { key: typed }, "The key is saved. Search uses it now.");
    if (ok) setTyped("");
    if (ok) setWantBrave(false);
  }

  const choices = [
    { id: "keyless", label: WORDS.keyless, sub: "Needs nothing from you. It reads a free public search page, which can change or refuse at any time." },
    { id: "brave", label: WORDS.brave, sub: saved ? "Steadier. It uses the key you saved." : "Steadier. It needs a key from your own Brave Search account." },
  ];
  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label" id="web-search-title">Search</h3>
      <${StatusDot} tone=${mark.tone} label=${mark.word} />
    </div>
    ${down ? html`<${Notice} tone="warn" title=${down}>
      ${view.search !== "brave" ? html`<div class="p-settings__w-down"><span>A Brave key is steadier.</span>
        <${Button} size="sm" onClick=${() => choose("brave")} disabled=${Boolean(busy)}>Use a Brave key<//></div>` : null}
    <//>` : null}
    <div class="p-settings__w-choices" role="radiogroup" aria-labelledby="web-search-title">
      ${choices.map((c) => html`<label key=${c.id} class=${`p-settings__w-choice${chosen === c.id ? " p-settings__w-choice--on" : ""}`}>
        <input type="radio" name="web-search" value=${c.id} checked=${chosen === c.id} disabled=${Boolean(busy)} onChange=${() => choose(c.id)} />
        <span class="p-settings__w-choice-words">
          <span class="p-settings__w-choice-title">${c.label}</span>
          <span class="p-settings__w-choice-sub">${c.sub}</span>
        </span>
      </label>`)}
    </div>
    <${Failure} failure=${failure} where="search" />
    ${showKey ? html`
      <form class="p-settings__m-key" onSubmit=${save} autocomplete="off" ref=${keyBox}>
        <${Field} label=${WORDS.keyField} hint=${saved ? "A key is saved. Paste a new one to replace it." : "It is kept on this Mac only and is never shown again."}
          error=${failure && failure.where === "key" ? failure.error : null}>
          <${TextInput} type="password" name="search-key" autocomplete="off" autocapitalize="off" spellcheck=${false}
            value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)} placeholder=${saved ? "A key is saved" : "Paste your key here"} />
        <//>
        <div class="p-settings__m-buttons">
          <${Button} variant="primary" type="submit" busy=${busy === "key"} disabled=${Boolean(busy) || !typed.trim()}>${WORDS.save}<//>
          ${saved ? html`<${Button} variant="quiet" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>Remove key<//>` : null}
        </div>
        ${wantBrave && !saved ? html`<p class="p-settings__m-text">Until a key is saved, search goes on without an account.</p>` : null}
      </form>` : null}
    <${Failure} failure=${failure} where="remove" />
    <${Dialog} open=${asking} title="Remove the key?" size="sm" onClose=${() => setAsking(false)}
      footer=${html`
        <${Button} data-autofocus onClick=${() => setAsking(false)}>Keep the key<//>
        <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("remove", "/api/web/search-key/remove", {}, "The key is removed."); }}>Remove key<//>`}>
      <p class="p-settings__m-text">The key is deleted from this Mac. Search goes back to working without an account.</p>
    <//>
  <//>`;
}

function TestCard({ view, busy, act, failure }) {
  const door = doorState(view.door);
  const t = view.lastTest;
  const mark = testMark(t);
  return html`<${Card} class="p-settings__m-card">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">Test</h3>
      <${StatusDot} tone=${mark.tone} label=${mark.word} />
    </div>
    <p class="p-settings__m-text">${WORDS.testWhat}</p>
    <div class="p-settings__m-buttons">
      <${Button} icon="play" onClick=${() => act("test", "/api/web/test", {}, "The test is done.")} busy=${busy === "test"}
        disabled=${Boolean(busy) || door.state !== "on"}>${WORDS.test}<//>
    </div>
    ${door.state !== "on" ? html`<p class="p-settings__m-text">It can be tested once the web door is running.</p>` : null}
    ${busy === "test" ? html`<p class="p-settings__m-text" role="status"><${StatusDot} tone="live" label="Testing. This can take up to 45 seconds." /></p>` : null}
    <${Failure} failure=${failure} where="test" />
    ${t ? html`
      <div class="p-settings__m-test">
        <h4 class="p-settings__m-sub">Last test${fullWhen(t.at) ? `, ${fullWhen(t.at)}` : ""}</h4>
        <ul class="p-settings__m-answers">
          ${testRows(t).map((r, i) => html`<li key=${i} class="p-settings__m-answer"><${StatusDot} tone=${r.tone} label=${r.text} /></li>`)}
        </ul>
      </div>` : null}
  <//>`;
}

function Today({ view }) {
  const f = todayFigures(view);
  const tiles = [["Pages", f.pages], ["Searches", f.searches], ["Videos", f.videos], ["Refused", f.refused]];
  return html`<div class="p-settings__w-today">
    <${Ring} value=${f.used} total=${f.perDay || 1} size=${44} label=${f.line} />
    <div class="p-settings__w-today-words">
      <p class="p-settings__w-today-line">${f.line}</p>
      <p class="p-settings__w-today-caps">${f.caps}</p>
    </div>
    <dl class="p-settings__w-counts" aria-label="Today">
      ${tiles.map(([label, n]) => html`<div key=${label} class="p-settings__w-count"><dt>${label}</dt><dd>${n}</dd></div>`)}
    </dl>
  </div>`;
}

function VisitRow({ v }) {
  const r = visitResult(v);
  const full = visitText(v);
  return html`<li class="p-settings__w-visit">
    <span class="p-settings__w-kind"><${Icon} name=${KIND_ICONS[v.kind] || "file"} size=${14} /><span class="p-settings__w-kind-word">${KIND_WORDS[v.kind] || "Page"}</span></span>
    <span class="p-settings__w-addr" title=${full}>
      <span class="p-settings__w-addr-long" aria-hidden="true">${shortAddress(full, 72)}</span>
      <span class="p-settings__w-addr-short" aria-hidden="true">${shortAddress(full, 34)}</span>
      <span class="k-sr">${full}</span>
    </span>
    <span class="p-settings__w-result">
      <${StatusDot} tone=${r.tone} label=${r.word} />
      ${r.why ? html`<span class="p-settings__w-why">${r.why}</span>` : null}
    </span>
    <span class="p-settings__w-when"><${Time} at=${v.at} /></span>
  </li>`;
}

function VisitsCard({ view }) {
  const first = useResource("/api/web/visits", { every: EVERY });
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(null);
  const list = mergeVisits(first.data && first.data.visits, older);
  const hasMore = more === null ? Boolean(first.data && first.data.more) : more;

  async function showOlder() {
    const last = list[list.length - 1];
    if (!last) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await api.get(`/api/web/visits?before=${encodeURIComponent(last.at)}`);
      setOlder([...older, ...arr(page.visits)]);
      setMore(Boolean(page.more));
    } catch (error) {
      setOlderError(error);
    } finally {
      setLoadingOlder(false);
    }
  }

  return html`<${Card} class="p-settings__m-card p-settings__w-logcard">
    <div class="p-settings__m-head">
      <h3 class="p-settings__label">What it has opened</h3>
      ${list.length ? html`<span class="p-settings__w-newest">Newest first</span>` : null}
    </div>
    <${Today} view=${view} />
    ${first.loading && !first.data ? html`<${Loading} lines=${3} label="Loading what it has opened" />` : null}
    ${first.error && !first.data ? html`<${ErrorNotice} error=${first.error} onRetry=${first.reload} />` : null}
    ${first.data && !list.length ? html`
      <div class="p-settings__w-empty">
        <${Icon} name="search" size=${20} />
        <p class="p-settings__w-empty-title">${WORDS.noVisits}</p>
        <p class="p-settings__m-text">${view.on ? "Every page it opens, every search and every video shows here." : "Once it is switched on, every page it opens shows here."}</p>
      </div>` : null}
    ${list.length ? html`
      <div class="p-settings__w-log">
        <div class="p-settings__w-loghead" aria-hidden="true"><span>What</span><span>Address</span><span>Result</span><span>When</span></div>
        <ol class="p-settings__w-visits" aria-label="What it has opened, newest first">
          ${list.map((v, i) => html`<${VisitRow} key=${`${v.at}-${i}`} v=${v} />`)}
        </ol>
      </div>` : null}
    ${olderError ? html`<${ErrorNotice} error=${olderError} onRetry=${showOlder} />` : null}
    ${list.length && hasMore ? html`<div class="p-settings__w-older"><${Button} busy=${loadingOlder} onClick=${showOlder}>Show older<//></div>` : null}
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The section

export default function WebSection() {
  const { announce } = useApp();
  const res = useResource("/api/web", { every: EVERY });
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState(null);
  const state = sectionState(res);
  // The answer of the last action is shown until the next quiet refresh brings a newer view.
  const view = fresh && fresh.base === res.data ? fresh.view : res.data;
  const ready = state === "ready" && view && typeof view === "object";
  const on = Boolean(ready && view.on);
  const door = ready ? doorState(view.door) : null;
  // Open: switched on and the door running. Switched on while the door is not running is on, but nothing goes out.
  const open = Boolean(on && door && door.state === "on");

  // Runs one action. Errors carry the server's plain message only: nothing typed is ever put in one.
  async function act(where, path, body, said) {
    setBusy(where);
    setFailure(null);
    try {
      const next = await api.post(path, body);
      setFresh({ view: next, base: res.data });
      if (said) announce(said);
      return true;
    } catch (error) {
      setFailure({ where, error: { message: plain(error && error.message, 300) || "That did not work.", next: plain(error && error.next, 300) } });
      res.refresh();
      return false;
    } finally {
      setBusy("");
    }
  }

  return html`
    <div class="p-settings__web" id="settings-web">
      <${Section} title=${WORDS.title}>
        <div class="p-settings__models">
          <${Card} class=${`p-settings__m-card p-settings__w-hero${open ? " p-settings__w-hero--on" : ""}`}>
            <div class="p-settings__m-head">
              <h3 class="p-settings__label">The web door</h3>
              ${ready ? html`<${StatusDot} tone=${open ? "ok" : on ? "warn" : "off"} label=${on ? "On" : "Off"} />` : null}
            </div>
            <div class="p-settings__w-intro">
              <div class="p-settings__w-words">
                <p class="p-settings__m-lead">${WORDS.intro}</p>
                <${Notice} tone="warn">${WORDS.leaves}<//>
              </div>
              <${DoorMap} open=${open} on=${on} door=${ready ? view.door : null} />
            </div>
            ${state === "loading" ? html`<${Loading} lines=${3} label="Loading the web settings" />` : null}
            ${state === "restart" ? html`<div class="p-settings__m-later"><${StatusDot} tone="off" label="Not here yet" /><${RestartLine} /></div>` : null}
            ${state === "error" ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
            ${ready && view.problem ? html`<${Notice} tone="bad"><${Line}>${problemLine(view)}<//><//>` : null}
            ${ready ? html`<${SwitchBlock} view=${view} busy=${busy} act=${act} failure=${failure} />` : null}
            ${ready && on && door.state !== "on" ? html`<${Notice} tone="warn"><${Line}>${door.sentence}<//><//>` : null}
            ${ready ? html`<${SharedLine} view=${view} />` : null}
          <//>
          ${ready ? html`
            <${ListsCard} view=${view} busy=${busy} act=${act} failure=${failure} />
            <${SearchCard} view=${view} busy=${busy} act=${act} failure=${failure} />
            <${TestCard} view=${view} busy=${busy} act=${act} failure=${failure} />
            <${VisitsCard} view=${view} />` : null}
        </div>
      <//>
    </div>`;
}
