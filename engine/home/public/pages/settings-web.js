// Settings: the Web section (PLAN-V5 K11, T35; drawn as groups in Settings' column by PLAN-COOK T55). The switch
// that lets one agent, the Researcher, read the public web through the web door comes first, with what leaves this
// Mac under it, who may ask and the door's state; then the owner's three lists, how it searches, the owner's Test,
// and every address it opened, newest first. The frame draws the title and the state (statusLine).
// A search key is typed into a password field that the server never fills; it lives only in this component's
// memory until Save, and is cleared then. It is never put in storage, the address bar, the console or a message.
// An address, a search's words and every list entry come from the web or from typing: they are shown only as plain
// capped text, never as HTML.
// The switch opens the door only through the Map's confirm (a door opens only through a confirm, 18 Nov 2026): a
// press on it asks, and the confirm's yes sends the request; switching off is one press.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { count, fullWhen } from "../lib/format.js";
import {
  Button, Checklist, DataTable, Dialog, Empty, ErrorNotice, Field, Group, Icon, Loading, NextStep, Notice, Row, Rows, St, Switch, Tag, TextInput,
} from "../kit/index.js";
import * as SELF from "../pages/settings-web.js";

const EVERY = 10000;

// The Map's confirm (map/door-panel.js) is read on the first press of a door switch, not at load: Settings' first
// view asks for nothing more. Its 600 ms inert yes counts from when the confirm is drawn, so a slow read cannot
// shorten it.
let confirmModule = null;
function LazyDoorConfirm(props) {
  const [Confirm, setConfirm] = useState(() => confirmModule);
  useEffect(() => {
    if (confirmModule) return undefined;
    let alive = true;
    import("../map/door-panel.js").then((m) => { confirmModule = m.DoorConfirm; if (alive) setConfirm(() => m.DoorConfirm); }, () => {});
    return () => { alive = false; };
  }, []);
  return Confirm ? html`<${Confirm} ...${props} />` : null;
}

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
// The word under the drawn door: open or closed while it runs (the switch), else the door's own state.
export function doorWord(on, door) {
  const d = doorState(door);
  if (d.state !== "on") return d.word;
  return on ? "Open" : "Closed";
}

// The section's line in Settings' list of sections and beside its title (pages/settings.js): one short fact.
export function statusLine(data) {
  if (!data || typeof data !== "object") return null;
  if (data.problem) return { tone: "bad", text: "Part of these settings could not be read." };
  if (!data.on) return { tone: "neutral", text: WORDS.off };
  const d = doorState(data.door);
  if (d.state === "on") return { tone: "good", text: "On, the web door is open" };
  return { tone: "warn", text: `On, but the web door is ${d.word.toLowerCase()}` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

// When a visit was, for the ledger: "14:27" today, "12 Nov, 14:27" before; "" for a time that is not one.
export function visitWhen(iso, now = new Date()) {
  const d = new Date(typeof iso === "string" ? iso : NaN);
  if (!Number.isFinite(d.getTime())) return "";
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hm}`;
}

// Who opened it, from the visit's agent: "researcher" -> "Researcher".
export function whoOf(slug) {
  const s = plain(slug, 40).replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

// Today's counts in one line: "10 of 300 today: 7 pages, 2 searches, 1 video, 3 refused."
export function todayLine(view) {
  const f = todayFigures(view);
  return `${f.line}: ${count(f.pages, "page")}, ${count(f.searches, "search", "searches")}, ${count(f.videos, "video")}, ${f.refused} refused.`;
}

// A state tone of this module as the kit's St tone.
const ST = { ok: "good", warn: "warn", bad: "bad", off: "neutral", live: "neutral" };

// ---------------------------------------------------------------------------------------------------------------
// Parts

// The restart sentence, with the two commands set apart. The words are the plan's, unchanged.
function RestartLine() {
  return html`<p class="p-settings-web__restart">This section appears after the home screen is restarted: <code class="k-next__command">engine stop</code>, then <code class="k-next__command">engine start</code>.</p>`;
}

// A sentence that may end in "Run: <command>", as a block (in a notice) or inline (in a row's words).
const Line = ({ children }) => (/\bRun:/.test(String(children)) ? html`<${NextStep} text=${children} />` : html`<p class="p-settings-web__text">${children}</p>`);
function RunLine({ text, tone }) {
  const s = String(text ?? "");
  const m = /^(.*?\bRun:)\s+(.+)$/s.exec(s);
  const inner = m ? html`${m[1]} <code class="k-next__command">${m[2]}</code>` : s;
  return html`<span class=${`p-settings-web__line${tone ? ` p-settings-web__line--${tone}` : ""}`}>${inner}</span>`;
}

// A failed action, in the server's words: a notice under a group, or a line inside a row.
const Failure = ({ failure, where }) => (failure && failure.where === where
  ? html`<${Notice} tone="bad" title=${failure.error.message}>${failure.error.next ? html`<${Line}>${failure.error.next}<//>` : null}<//>`
  : null);
const FailLine = ({ failure, where }) => (failure && failure.where === where
  ? html`<${RunLine} tone="bad" text=${failure.error.message} />${failure.error.next ? html`<${RunLine} text=${failure.error.next} />` : null}`
  : null);

// The door, drawn small under its sentence: the Researcher, the door, the public web, as three neutral chips joined
// by a hairline; the door's chip carries a 6 px dot in its state's tone. The words say the same.
function DoorPath({ open, tone }) {
  return html`<span class=${`p-settings-web__path${open ? " p-settings-web__path--open" : ""}`} aria-hidden="true">
    <span class="p-settings-web__node"><${Icon} name="search" size=${14} />Researcher</span>
    <span class="p-settings-web__wire"></span>
    <span class="p-settings-web__node"><span class=${`p-settings-web__dot p-settings-web__dot--${tone || "neutral"}`}></span>Web door</span>
    <span class="p-settings-web__wire"></span>
    <span class="p-settings-web__node"><${Icon} name="globe" size=${14} />Public web</span>
  </span>`;
}

// Focus back on the switch inside `box` once the confirm has gone.
function backToSwitch(box) {
  setTimeout(() => {
    const sw = box.current && typeof box.current.querySelector === "function" ? box.current.querySelector('[role="switch"]') : null;
    if (sw) sw.focus();
  }, 0);
}

// Group 1: the switch first, with its warning inside the panel; who may ask; the door's state.
// Switching on asks first: the press opens the confirm and nothing more; its yes sends the request.
function DoorGroup({ view, busy, act, took, failure }) {
  const [asking, setAsking] = useState(false);
  const box = useRef(null);
  const on = Boolean(view.on);
  const door = doorState(view.door);
  const open = on && door.state === "on";
  const locked = !on && !view.canSwitchOn;
  const reasons = blockerLines(view);
  const n = arr(view.shared).length;
  const word = doorWord(on, view.door);
  const doorTone = open ? "good" : on || door.state === "unhealthy" ? "warn" : "neutral";
  // Each fact once: when the list of what must be done first already says the door's sentence (with its command),
  // the door's row shows its chip and its path only.
  const saidAbove = locked && reasons.includes(door.sentence);
  return html`<${Group}>
    <${Rows}>
      <${Row} icon="globe" title=${WORDS.switchLabel}
        say=${html`<span class="p-settings-web__lines">
          <span role="status">${busy === "switch" ? WORDS.switching : switchLine(on)}</span>
          ${locked && reasons.length ? html`<${Checklist} lead="It can be switched on when these are done:"
            items=${reasons.map((r) => ({ done: false, text: html`<${RunLine} text=${r} />` }))} />` : null}
          <${FailLine} failure=${failure} where="switch" />
        </span>`}
        control=${html`<span class="p-settings-door__switch" ref=${box}><${Switch} on=${on} disabled=${locked || Boolean(busy)} label=${WORDS.switchLabel}
          onChange=${(next) => (next ? setAsking(true) : act("switch", "/api/web/switch", { on: false }, switchLine(false)))} /></span>`}
        warned=${WORDS.leaves} />
      <${Row} icon="team" title="Who may ask"
        say=${`Only the Researcher. ${sharedLine(n)}.`}
        control=${html`<${Button} variant="ghost" size="sm" href=${n ? "#/files?shared=1" : "#/files"}>${n ? "See them in Files" : "Choose some in Files"}<//>`} />
      <${Row} icon="door" title="The web door" state=${{ tone: doorTone, text: word }}
        say=${html`<span class="p-settings-web__lines">${saidAbove ? null : html`<${RunLine} text=${door.sentence} />`}<${DoorPath} open=${open} tone=${doorTone} /></span>`} />
    <//>
    ${asking ? html`<${LazyDoorConfirm} door=${{ id: "web" }} mod=${SELF} cls="p-settings-door" link=${false}
      onCancel=${() => { setAsking(false); backToSwitch(box); }}
      onDone=${(_, answer) => { setAsking(false); took(answer, switchLine(true)); backToSwitch(box); }} />` : null}
  <//>`;
}

// One of the three lists: its sites as a kit table with a remove button each, and the add field on one line under
// them. A name that is not a site's name is shown as a refused row, with one sentence, and is never sent.
function HostList({ spec, hosts, busy, save, failure }) {
  const [hostText, setHostText] = useState("");
  const [refused, setRefused] = useState([]);
  const [full, setFull] = useState(false);
  const list = arr(hosts).filter((h) => typeof h === "string");
  const where = `list:${spec.key}`;
  const serverError = failure && failure.where === where ? failure.error.message : "";
  const last = refused[refused.length - 1];
  const sentence = last ? refusedLine(last) : full ? `${MAX_HOSTS} sites is the most for one list.` : serverError;
  const headId = `web-list-${spec.key}`;

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

  const rows = [
    ...list.map((h) => ({ id: `site-${h}`, site: plain(h, 253) })),
    ...refused.map((t, i) => ({ id: `refused-${i}`, site: plain(t, 80), refused: i })),
  ];

  return html`<section class="p-settings-web__list" aria-labelledby=${headId}>
    <h3 class="p-settings-web__list-title" id=${headId}>
      <span>${spec.label}</span>
      <span class="p-settings-web__count">${count(list.length, "site")}</span>
    </h3>
    <div class="p-settings-web__panel">
      ${rows.length
        ? html`<ul class="p-settings-web__sites" aria-labelledby=${headId}>
            ${rows.map((row) => html`<li key=${row.id} class=${`p-settings-web__siterow${row.refused === undefined ? "" : " p-settings-web__siterow--bad"}`}>
              <${Icon} name="globe" size=${16} class="p-settings-web__glyph" />
              <span class=${`p-settings-web__site${row.refused === undefined ? "" : " p-settings-web__site--bad"}`}>${row.site}</span>
              ${row.refused === undefined ? null : html`<${Tag} tone="bad">Not a site name<//>`}
              ${row.refused === undefined
                ? html`<${Button} variant="quiet" size="sm" icon="cross" class="p-settings-web__remove" aria-label=${`Take ${row.site} off ${spec.short}`}
                    disabled=${Boolean(busy)} onClick=${() => remove(row.site)} />`
                : html`<${Button} variant="quiet" size="sm" icon="cross" class="p-settings-web__remove" aria-label=${`Clear ${row.site}`}
                    onClick=${() => setRefused(refused.filter((_, j) => j !== row.refused))} />`}
            </li>`)}
          </ul>`
        : html`<p class="p-settings-web__none">${spec.empty}</p>`}
      <form class="p-settings-web__add" onSubmit=${add} autocomplete="off">
        <${Field} error=${sentence || null}>
          <div class="p-settings-web__addrow">
            <${TextInput} value=${hostText} maxLength=${4000} placeholder=${spec.placeholder} autocapitalize="off" spellcheck=${false}
              aria-label=${`Add a site to ${spec.short}`} onInput=${(e) => setHostText(e.currentTarget.value)} />
            <${Button} type="submit" icon="plus" busy=${busy === where} disabled=${Boolean(busy) || !hostText.trim()}>Add<//>
          </div>
        <//>
      </form>
    </div>
  </section>`;
}

function ListsGroup({ view, busy, act, failure }) {
  const save = (key, list, said) => act(`list:${key}`, "/api/web/lists", { [key]: list }, said);
  return html`<${Group} title="What it may open" say=${WORDS.listsHint}>
    <div class="p-settings-web__lists">
      ${LISTS.map((spec) => html`<${HostList} key=${spec.key} spec=${spec} hosts=${view[spec.key]} busy=${busy} save=${save} failure=${failure} />`)}
    </div>
  <//>`;
}

// Arrows move the choice between the radio rows and take it, as a radio group does; Home and End go to the ends.
function onRadioKey(ev, ids, choose) {
  const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: "first", End: "last" };
  if (!(ev.key in keys)) return;
  const group = ev.currentTarget && ev.currentTarget.closest ? ev.currentTarget.closest('[role="radiogroup"]') : null;
  const rows = group ? [...group.querySelectorAll('[role="radio"]')] : [];
  if (!rows.length) return;
  ev.preventDefault();
  const at = rows.indexOf(ev.currentTarget);
  const step = keys[ev.key];
  const to = step === "first" ? 0 : step === "last" ? rows.length - 1 : (at + step + rows.length) % rows.length;
  rows[to].focus();
  choose(ids[to], { moved: true });
}

// Group 3: how it searches, as radio rows (one Tab stop; the arrows move), and the key under them when it is used.
function SearchGroup({ view, busy, act, failure }) {
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

  // A choice taken by the arrows leaves the focus on its row; a click on Brave without a key goes to the key field.
  async function choose(id, { moved = false } = {}) {
    if (busy) return;
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
    if (!moved) focusKey();
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
  const ids = choices.map((c) => c.id);
  return html`<${Group} title="Search" aside=${html`<${St} tone=${ST[mark.tone]}>${mark.word}<//>`}>
    ${down ? html`<div class="p-settings-web__notice"><${Notice} tone="warn" title=${down}>
      ${view.search !== "brave" ? html`A Brave key is steadier. <${Button} variant="link" size="sm" onClick=${() => choose("brave")} disabled=${Boolean(busy)}>Use a Brave key<//>` : null}
    <//></div>` : null}
    <${Rows}>
      <div class="p-settings-web__radios" role="radiogroup" aria-label="Search">
        ${choices.map((c) => {
          const on = chosen === c.id;
          return html`<button key=${c.id} type="button" role="radio" aria-checked=${on ? "true" : "false"} tabindex=${on ? "0" : "-1"}
            aria-disabled=${busy ? "true" : undefined} class="k-rows__row p-settings-web__radio" data-option=${c.id}
            onClick=${() => choose(c.id)} onKeyDown=${(ev) => onRadioKey(ev, ids, choose)}>
            <span class="k-rows__icon p-settings-web__radio-mark" aria-hidden="true"><span class="p-settings-web__radio-dot"></span></span>
            <span class="k-rows__text">
              <span class="k-rows__title">${c.label}</span>
              <span class="k-say">${c.sub}</span>
            </span>
          </button>`;
        })}
      </div>
      ${showKey ? html`
        <form class="p-settings-web__key" onSubmit=${save} autocomplete="off" ref=${keyBox}>
          <${Row} icon="key" title=${WORDS.keyField}
            say=${html`<span class="p-settings-web__lines">
              <span>${saved ? "A key is saved. Paste a new one to replace it." : "It is kept on this Mac only and is never shown again."}</span>
              ${wantBrave && !saved ? html`<span>Until a key is saved, search goes on without an account.</span>` : null}
              <${FailLine} failure=${failure} where="key" />
              <${FailLine} failure=${failure} where="remove" />
            </span>`}
            control=${html`
              <${TextInput} type="password" name="search-key" autocomplete="off" autocapitalize="off" spellcheck=${false} aria-label=${WORDS.keyField}
                value=${typed} onInput=${(e) => setTyped(e.currentTarget.value)} placeholder=${saved ? "A key is saved" : "Paste your key here"} />
              <${Button} variant=${typed.trim() ? "primary" : "ghost"} type="submit" busy=${busy === "key"} disabled=${Boolean(busy) || !typed.trim()}>${WORDS.save}<//>
              ${saved ? html`<${Button} variant="quiet" onClick=${() => setAsking(true)} disabled=${Boolean(busy)}>Remove key<//>` : null}`} />
        </form>` : null}
    <//>
    <${Failure} failure=${failure} where="search" />
    <${Dialog} open=${asking} title="Remove the key?" size="sm" onClose=${() => setAsking(false)}
      footer=${html`
        <${Button} data-autofocus onClick=${() => setAsking(false)}>Keep the key<//>
        <${Button} variant="danger" onClick=${async () => { setAsking(false); await act("remove", "/api/web/search-key/remove", {}, "The key is removed."); }}>Remove key<//>`}>
      <p class="p-settings-web__text">The key is deleted from this Mac. Search goes back to working without an account.</p>
    <//>
  <//>`;
}

// Group 4: the owner's Test, and its answer as sent, in one panel.
function TestGroup({ view, busy, act, failure }) {
  const door = doorState(view.door);
  const t = view.lastTest;
  const mark = testMark(t);
  const when = t ? fullWhen(t.at) : "";
  const say = busy === "test"
    ? "Testing. This can take up to 45 seconds."
    : door.state !== "on" ? "It can be tested once the web door is running." : t ? `Last test${when ? `, ${when}` : ""}.` : "Not tested yet.";
  const rows = testRows(t);
  return html`<${Group} title="Test" aside=${html`<${St} tone=${ST[mark.tone]}>${mark.word}<//>`} say=${WORDS.testWhat}>
    <${Rows}>
      <${Row} icon="play" title="Open one page and search once"
        say=${html`<span class="p-settings-web__lines">
          <span role="status">${say}</span>
          <${FailLine} failure=${failure} where="test" />
        </span>`}
        control=${html`<${Button} onClick=${() => act("test", "/api/web/test", {}, "The test is done.")} busy=${busy === "test"}
          disabled=${Boolean(busy) || door.state !== "on"}>${WORDS.test}<//>`} />
      ${rows.length ? html`
        <${Row} icon="file" title="Reading a page" say=${html`<${St} tone=${ST[rows[0].tone]}>${rows[0].text}<//>`} />
        <${Row} icon="search" title="Searching" say=${html`<${St} tone=${ST[rows[1].tone]}>${rows[1].text}<//>`} />` : null}
    <//>
  <//>`;
}

// Group 5: what was opened, as a ledger: when, who, the site, the result; newest first.
function VisitsGroup({ view }) {
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

  const now = new Date();
  const rows = list.map((v, i) => ({ id: `${v.at}-${i}`, v }));
  const cell = (row, col) => {
    const v = row.v;
    if (col.key === "when") return html`<time datetime=${v.at} title=${fullWhen(v.at)}>${visitWhen(v.at, now)}</time>`;
    if (col.key === "who") return whoOf(v.slug) || "Researcher";
    if (col.key === "site") {
      const full = visitText(v);
      return html`<span class="p-settings-web__visit" title=${full}>
        <${Icon} name=${KIND_ICONS[v.kind] || "file"} size=${14} />
        <span class="k-sr">${KIND_WORDS[v.kind] || "Page"}: </span>
        <span class="p-settings-web__addr">
          <span class="p-settings-web__addr-long" aria-hidden="true">${shortAddress(full, 60)}</span>
          <span class="p-settings-web__addr-short" aria-hidden="true">${shortAddress(full, 34)}</span>
          <span class="k-sr">${full}</span>
        </span>
      </span>`;
    }
    const r = visitResult(v);
    return html`<${St} tone=${ST[r.tone]}>${r.word}<//>${r.why ? html`<small>${r.why}</small>` : null}`;
  };

  return html`<${Group} title="What it has opened" aside=${list.length ? "Newest first" : null} say=${`${todayLine(view)} ${todayFigures(view).caps}`}>
    ${first.loading && !first.data ? html`<${Loading} lines=${3} label="Loading what it has opened" />` : null}
    ${first.error && !first.data ? html`<${ErrorNotice} error=${first.error} onRetry=${first.reload} />` : null}
    ${first.data && !list.length ? html`<div class="p-settings-web__panel">
        <${Empty} icon="globe" title=${WORDS.noVisits}
          text=${view.on ? "Every page it opens, every search and every video shows here." : "Once it is switched on, every page it opens shows here."} />
      </div>` : null}
    ${list.length ? html`<div class="p-settings-web__ledger">
        <${DataTable} rows=${rows} renderCell=${cell} columns=${[
          { key: "when", label: "When", align: "start" },
          { key: "who", label: "Who", align: "start" },
          { key: "site", label: "Site", align: "start" },
          { key: "result", label: "Result", align: "start" },
        ]} />
      </div>` : null}
    ${olderError ? html`<${ErrorNotice} error=${olderError} onRetry=${showOlder} />` : null}
    ${list.length && hasMore ? html`<div class="p-settings-web__older"><${Button} variant="quiet" busy=${loadingOlder} onClick=${showOlder}>Show older<//></div>` : null}
  <//>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The section: groups straight into Settings' column (its title and state are the frame's, from statusLine).

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
  // The answer of a request the door's confirm sent, taken as act takes one.
  function took(next, said) {
    setFailure(null);
    setFresh({ view: next, base: res.data });
    if (said) announce(said);
  }

  const parts = { view, busy, act, took, failure };
  return html`<div class="p-settings-web" id="settings-web">
    <p class="p-settings-web__intro">${WORDS.intro}</p>
    ${state === "loading" ? html`<div class="p-settings-web__first"><${Loading} lines=${3} label="Loading the web settings" /></div>` : null}
    ${state === "restart" ? html`<div class="p-settings-web__first p-settings-web__later"><${St} icon="clock">Not here yet<//><${RestartLine} /></div>` : null}
    ${state === "error" ? html`<div class="p-settings-web__first"><${ErrorNotice} error=${res.error} onRetry=${res.reload} /></div>` : null}
    ${ready && view.problem ? html`<div class="p-settings-web__first"><${Notice} tone="bad"><${Line}>${problemLine(view)}<//><//></div>` : null}
    ${ready ? html`
      <${DoorGroup} ...${parts} />
      <${ListsGroup} ...${parts} />
      <${SearchGroup} ...${parts} />
      <${TestGroup} ...${parts} />
      <${VisitsGroup} view=${view} />` : null}
  </div>`;
}
