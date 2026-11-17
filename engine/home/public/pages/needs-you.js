// Needs you: every item waiting for the owner, and one of them opened (PLAN-COOK T50; CONTRACTS-V3 30, 26.4), on the
// owner's desk in the lit studio (PLAN-3D T10, D10, D15, D16).
// Address: #/needs-you, #/needs-you?d=<department> (one department), #/needs-you?item=<id> (one item opened).
// Data: GET /api/inbox every 10 seconds; the agents of each department come from GET /api/map (read once; without
// it items are placed by their source alone); GET /api/world every 10 seconds for the desk model and today's money
// line, which goes to the top bar (`setTop({ note })`) and, on a phone, stands whole above the list.
// From 1280 px the owner's desk fills the page column: a photograph of the oak desk on the loft's mezzanine, at dusk
// or in the golden morning by the theme (office/stage.js, mode "desk"; the owner chose photographs over 3D on 18 Nov
// 2026: no three.js, no WebGL). The item opened is a paper sheet
// at the left (today's kit card inside it, unchanged, so every action goes over the wire as before), what helps
// decide under it on the same sheet, and the keys line at its foot, ink on paper; the "Waiting" list is a 320 px
// column at the right. The desk's paper stack and the white model of the loft stand in the free rectangle between
// them (`safeRect`, the queue's panel left out when it is open); the stack holds one sheet a waiting item, twelve at
// most ("N more" beside it). A film's shotlist or versions to pick from (kit ShotlistCard, PickCard) is a wide sheet over the whole
// free area with the desk dimmed behind; its title is the page's heading. Approved, accepted, picked or answered,
// the top sheet lifts off the stack and goes to the model on the desk; anything else slides to the tray. No Undo.
// Below 1280 px the list is the page over a short desk strip and an item opened is the paper sheet alone (the top
// bar's back button returns to the list); below 860 px the strip is 390 x 200 and the money line is on the page.
// Keys, when focus is in no field: J and Down the pager's next address, K and Up the one before, Enter on the sheet
// the story so far, A the card's primary button, D its send-back or decline control. No key acts: Enter or Space on
// the focused button does. A shotlist's approval keeps the kit's second confirm with its money sentences whole.
// The top bar gets the crumbs, a pager over the list's order and the money line. After an action its outcome stays
// where the item was until the owner moves on.
// The list (T104, T116, R5-D): each row a title on one line with its time in a 64 px gutter at the right (its grey
// line only where it adds a fact the title does not say), each group under its label and count over a hairline.
// Under the item opened: the other items of the same task with a way to the task, then the task's story so far (its
// whole thread, up to eight entries, the newest first, from GET /api/tasks/:id, the route the task page reads: one
// request a task, kept while the page lives). The list beside it already says what comes next; alone one line
// names it.
import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, linkHref } from "../lib/format.js";
import { SOURCE_DEPARTMENT, queueGroups, rowTime, sortNeeds } from "../lib/queue.js";
import {
  Avatar, Button, DecisionCard, DecisionDone, Empty, ErrorNotice, Icon, Loading, NotConnected, Notice, PickCard, PickDone, Select,
  ShotlistCard, ShotlistDone, StateIcon, SHOTLIST_WORDS, isPickItem, isShotlistItem, splitActions,
} from "../kit/index.js";
import { diffWorld } from "../world/diff.js";
import { OfficeStage } from "../office/stage.js";
import { worldState } from "../world/state.js";
import { stillOf } from "../world/support.js";
import { WORDS } from "../world/words.js";

const DEPARTMENT_IDS = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
const DEPARTMENT_TITLES = { operations: "Operations", sales: "Sales", marketing: "Marketing", studio: "Studio", support: "Support", people: "People", books: "Books" };
const SOURCE_WORDS = { board: "The board", books: "The books", customers: "Customers", support: "Support", people: "People", marketing: "Marketing", studio: "Studio", goal: "Tasks" };
const MAX_ITEMS = 200;
const MAX_SETTLED = 3;
// The list and an item side by side from here; under it the list is the page.
const WIDE = "(min-width: 1280px)";
// A phone: the desk is a 390 x 200 strip and the money line stands on the page (D16).
const PHONE = "(max-width: 859px)";

// A row's glyph by the item's kind, as the queue draws it ("done" is the board's Done mark); a draft is a file.
const KIND_ICON = { shotlist: "video", pick: "layers", approval: "check", question: "reply", result: "done", draft: "file" };

// The top bar's last crumb for an item opened, by its kind.
export const CRUMB_WORDS = {
  shotlist: "A shotlist to approve",
  pick: `Versions to pick from`,
  approval: "Something to approve",
  draft: "Something to approve",
  question: "A question",
  result: "A result",
  problem: "A problem",
};
const OTHER_WORDS = "Something to know";

export const PAGE_WORDS = {
  title: "Needs you",
  lede: "Things your team has finished or cannot go on with until you decide.",
  empty: "Nothing needs you.",
  emptyLine: "When your team finishes something or cannot go on without you, it waits here.",
  openTasks: "Open Tasks",
  filter: "Department",
  list: "What needs you",
  back: "Back to the list",
  showAll: "Show everything",
  sameTask: "From the same task",
  openTask: "Open the task",
  upNext: "Up next",
  next: "Next",
  story: "The story so far",
};

// How many of the task's latest entries show as its story so far (its whole thread, up to this many).
export const STORY_SHOWN = 8;

// How many of the next items show under the item opened.
export const NEXT_SHOWN = 3;

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// A next step for the owner in words: a command ("Run: ...") stays off screen outside Health (C3 25, M50 F18);
// Health is linked instead.
export const plainNext = (next) => (/\bRun:/i.test(String(next ?? "")) ? "" : String(next ?? "").slice(0, 200));

// The page's address for a department filter. Everyone is plain `#/needs-you`.
export function address(d) {
  return DEPARTMENT_IDS.includes(d) ? `#/needs-you?d=${d}` : "#/needs-you";
}

// The address of one item opened on this page, keeping the department filter when there is one. Without a filter
// it is exactly the queue's address for the item, so the queue marks its row.
export function itemAddress(id, d = "") {
  const own = `#/needs-you?item=${encodeURIComponent(String(id ?? ""))}`;
  return DEPARTMENT_IDS.includes(d) ? `${own}&d=${d}` : own;
}

// The filter an address asks for: one of the seven departments, else none.
export function filterOf(query) {
  const d = query && typeof query.get === "function" ? String(query.get("d") || "") : "";
  return DEPARTMENT_IDS.includes(d) ? d : "";
}

// The item an address opens: its id, else "".
export function openOf(query) {
  return query && typeof query.get === "function" ? String(query.get("item") || "").slice(0, 400) : "";
}

// Pure. The top bar's word for an item by its kind.
export function crumbWord(item) {
  const k = item && typeof item === "object" ? item.kind : "";
  return Object.hasOwn(CRUMB_WORDS, k) ? CRUMB_WORDS[k] : OTHER_WORDS;
}

// Pure. The crumbs: "Needs you" alone for the list; with a department, "Needs you / Sales"; with an item opened,
// "Needs you / <its word>", the first a link back to the list (the phone's back button follows it).
export function crumbsFor(item, d = "") {
  const dept = DEPARTMENT_IDS.includes(d) ? d : "";
  if (item) return [{ label: PAGE_WORDS.title, href: address(dept) }, { label: crumbWord(item) }];
  if (dept) return [{ label: PAGE_WORDS.title, href: address("") }, { label: DEPARTMENT_TITLES[dept] }];
  return [{ label: PAGE_WORDS.title }];
}

// Pure. The list in the queue's order: its groups (to approve, to answer, to accept, to know) one after another.
export function queueOrder(items) {
  return queueGroups(items).flatMap((g) => g.items);
}

// Pure. The pager over `order` (items or ids) for the item `id`: { index, total, label: "3 of 21", prev, next },
// prev and next as addresses (none past either end). When the item has left the list (after an action) and `at`
// is where it was, the pager says how many are left and steps from that place: next is the one that took it.
export function pagerOf(order, id, d = "", at = null) {
  const ids = (Array.isArray(order) ? order : []).map((i) => (i && typeof i === "object" ? i.id : i)).filter(Boolean);
  const total = ids.length;
  const i = id ? ids.indexOf(id) : -1;
  if (i >= 0) {
    return { index: i + 1, total, label: `${i + 1} of ${total}`, prev: i > 0 ? itemAddress(ids[i - 1], d) : null, next: i < total - 1 ? itemAddress(ids[i + 1], d) : null };
  }
  if (Number.isInteger(at) && at >= 0) {
    const k = Math.min(at, total);
    return { index: null, total, label: total ? `${total} left` : "None left", prev: k > 0 ? itemAddress(ids[k - 1], d) : null, next: k < total ? itemAddress(ids[k], d) : null };
  }
  return null;
}

const words = (v) => new Set(String(v ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4));

// Pure. True when an item's summary adds a fact its title does not say: its first sentence does not repeat most of
// the title's words. A row shows its grey second line only then.
export function addsFact(item) {
  if (!item || typeof item !== "object") return false;
  const summary = String(item.summary ?? "").trim();
  if (!summary) return false;
  const title = words(item.title);
  if (!title.size) return true;
  const first = words(summary.split(/(?<=[.!?])\s/)[0]);
  let same = 0;
  for (const w of title) if (first.has(w)) same += 1;
  return same / title.size < 0.6;
}

// Pure. The task an item belongs to, as { href }, when its link is to a task; else null.
export function taskOf(item) {
  const link = item && typeof item === "object" ? item.link : null;
  if (!link || (link.page !== "tasks" && link.page !== "goals") || !link.id) return null;
  return { href: linkHref(link), id: String(link.id) };
}

// Pure. The other items of `items` that belong to the same task as `item`, in the list's order.
export function sameTask(item, items) {
  const own = taskOf(item);
  if (!own) return [];
  return (Array.isArray(items) ? items : []).filter((i) => i && i.id && i.id !== item.id && taskOf(i) && taskOf(i).id === own.id);
}

// Pure. The items after `id` in `order`, at most `n`, leaving out those in `skip` (ids).
export function nextAfter(order, id, n = NEXT_SHOWN, skip = []) {
  const list = Array.isArray(order) ? order : [];
  const at = list.findIndex((i) => i && i.id === id);
  const out = new Set(skip);
  return (at < 0 ? [] : list.slice(at + 1)).filter((i) => i && !out.has(i.id)).slice(0, n);
}

// Pure. The last `n` entries of a task's conversation (GET /api/tasks/:id), newest first, each with words to show.
export function storyOf(task, n = STORY_SHOWN) {
  const list = task && typeof task === "object" && Array.isArray(task.conversation) ? task.conversation : [];
  return list.filter((m) => m && typeof m === "object" && typeof m.text === "string" && m.text.trim()).slice(-n).reverse();
}

// Pure. True for an item drawn as a whole stage: a film's shotlist, or versions to pick from.
export function isStageItem(item) {
  return isShotlistItem(item) || isPickItem(item);
}

// Pure. The department of one item: the one the home server placed it in (`department`: a task's item belongs to
// the task's department, as the map and the dock count it), else the one whose agent raised it (`agent.slug`),
// else the one whose dashboard is its source, else "" (the item belongs to no department). `departments` is
// /api/map's list ({ id, agents: [{ slug }] }), when it could be read.
export function departmentOf(item, departments) {
  if (!item || typeof item !== "object") return "";
  if (Object.hasOwn(item, "department")) return DEPARTMENT_IDS.includes(item.department) ? item.department : "";
  const slug = item.agent && typeof item.agent === "object" ? item.agent.slug : "";
  if (slug) {
    for (const d of Array.isArray(departments) ? departments : []) {
      if (!d || !DEPARTMENT_IDS.includes(d.id)) continue;
      const agents = Array.isArray(d.agents) ? d.agents : [];
      if (agents.some((a) => (a && typeof a === "object" ? a.slug : a) === slug)) return d.id;
    }
  }
  return Object.hasOwn(SOURCE_DEPARTMENT, item.source) ? SOURCE_DEPARTMENT[item.source] : "";
}

// Pure. Urgent first, then newest first; items of the same rank keep their order; bad entries are dropped.
export function sortItems(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i === "object" && i.id).slice(0, MAX_ITEMS);
  return sortNeeds(list);
}

// Pure. The department choices: "All" first, then each department that has an item (and the one the address asks
// for), each with its count.
export function chipsFor(items, departments, current) {
  const list = Array.isArray(items) ? items : [];
  const counts = new Map();
  for (const i of list) {
    const d = departmentOf(i, departments);
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  const chips = [{ id: "", label: "All", count: list.length, href: address("") }];
  for (const id of DEPARTMENT_IDS) {
    if (counts.has(id) || id === current) chips.push({ id, label: DEPARTMENT_TITLES[id], count: counts.get(id) || 0, href: address(id) });
  }
  return chips;
}

// Pure. The items to show: the sorted list, narrowed to one department when asked.
export function itemsFor(items, departments, d) {
  const sorted = sortItems(items);
  return d ? sorted.filter((i) => departmentOf(i, departments) === d) : sorted;
}

// Pure. The not-connected lines, each a source and a reason, at most ten.
export function quietLines(list) {
  return (Array.isArray(list) ? list : []).filter((n) => n && typeof n === "object").slice(0, 10)
    .map((n) => ({ source: SOURCE_WORDS[n.source] || "A part", reason: cap(n.reason, 200) }));
}

// Pure. The outcomes to keep: the newest first, at most three, and only those whose item has left the list (while
// it is still listed, its own card says what happened).
export function settledShown(settled, items) {
  const listed = new Set((Array.isArray(items) ? items : []).map((i) => i && i.id));
  return (Array.isArray(settled) ? settled : []).filter((s) => s && s.id && !listed.has(s.id)).slice(0, MAX_SETTLED);
}

// Pure. The words beside the desk's stack when more wait than it holds: "28 more".
export const moreWords = (n) => `${n} more`;

// Pure. What the desk does with the top sheet after the owner acted (PLAN-3D D10): approved, accepted, picked or
// answered, it goes to the model of the loft on the desk (`room`, the item's department, is kept for the record);
// anything else (send back, decline, reject, hide, another round) slides it to the tray.
const FORWARD = new Set(["approve", "accept", "pick", "answer"]);
export function deskEvent(r, departments) {
  const action = r && typeof r === "object" ? String(r.action || "") : "";
  if (FORWARD.has(action)) return { type: "approve", room: departmentOf(r.item, departments) || null, animate: true };
  return { type: "aside", animate: true };
}

// Pure. The action ids a card's "send back or decline" control stands for, in the order D looks for them.
export const DECLINE_IDS = ["send_back", "reject", "decline", "another"];

// Pure. The words of the primary and of the send-back or decline control of an item: { primary, decline } (either
// "" when the item has none).
export function keyTargets(item) {
  const actions = item && typeof item === "object" && Array.isArray(item.actions) ? item.actions : [];
  const { primary } = splitActions(actions);
  const decline = DECLINE_IDS.map((id) => actions.find((a) => a && a.id === id)).find(Boolean) || null;
  return { primary: primary ? String(primary.label || "") : "", decline: decline ? String(decline.label || "") : "" };
}

// Pure. What a key press asks of the page, or null: { go: address } for J/K and the arrows, { focus: "story" |
// "primary" | "decline" } for Enter on the sheet, A and D. `onSheet` is true when focus is on the sheet itself.
export function keyIntent(key, { pager = null, onSheet = false, opened = false } = {}) {
  const k = String(key || "");
  if ((k === "j" || k === "J" || k === "ArrowDown") && pager && pager.next) return { go: pager.next };
  if ((k === "k" || k === "K" || k === "ArrowUp") && pager && pager.prev) return { go: pager.prev };
  if (!opened) return null;
  if (k === "Enter" && onSheet) return { focus: "story" };
  if (k === "a" || k === "A") return { focus: "primary" };
  if (k === "d" || k === "D") return { focus: "decline" };
  return null;
}

function useMedia(query) {
  const get = () => typeof matchMedia === "function" && matchMedia(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}

const KindIcon = ({ kind }) => {
  const name = KIND_ICON[kind] || "alert";
  return name === "done" ? html`<${StateIcon} column="done" label="" />` : html`<${Icon} name=${name} />`;
};

// One row: the kind's glyph, the title on one line (its whole words on hover), the time at the right, and the grey line (one line)
// only where it adds a fact (`line` true shows it always, as under the item opened, where there is room).
function Row({ item, href, current, line = false }) {
  const at = rowTime(item.when);
  return html`<a class="p-needs-you__row" href=${href} aria-current=${current ? "true" : undefined}>
    <span class="p-needs-you__icon" aria-hidden="true"><${KindIcon} kind=${item.kind} /></span>
    <span class="p-needs-you__title" title=${cap(item.title, 120)}>${cap(item.title, 120)}</span>
    ${at ? html`<time class="p-needs-you__when" datetime=${item.when} title=${fullWhen(item.when)}>${at}</time>` : null}
    ${item.summary && (line || addsFact(item)) ? html`<span class="p-needs-you__line">${cap(item.summary, 200)}</span>` : null}
  </a>`;
}

// The story of a task, read once a task while the page lives: { [taskId]: { conversation } | null }. One request a
// task; nothing when the item belongs to none, while it is read, or when it cannot be read.
function useStory(task, cache) {
  const id = task ? task.id : "";
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id || Object.hasOwn(cache.current, id)) return;
    cache.current[id] = undefined;
    // Drawn again when it arrives, even after the owner moved on and back: the answer is kept either way.
    api.get(`/api/tasks/${encodeURIComponent(id)}`)
      .then((t) => { cache.current[id] = t && typeof t === "object" ? { conversation: t.conversation } : null; })
      .catch(() => { cache.current[id] = null; })
      .finally(() => bump((n) => n + 1));
  }, [id]);
  return id && cache.current[id] ? storyOf(cache.current[id]) : [];
}

// One entry of the story: who, when, and what was said (agent-written words stay text).
function Entry({ m }) {
  const who = m.who && typeof m.who === "object" ? m.who : {};
  const at = rowTime(m.at);
  return html`<li class="p-needs-you__entry">
    <span class="p-needs-you__entry-avatar" aria-hidden="true"><${Avatar} slug=${who.slug || undefined} name=${String(who.name || "")} size=${20} /></span>
    <span class="p-needs-you__entry-who">${cap(who.name, 60)}</span>
    ${at ? html`<time class="p-needs-you__when" datetime=${m.at} title=${fullWhen(m.at)}>${at}</time>` : null}
    <span class="p-needs-you__entry-text">${cap(m.text, 600)}</span>
  </li>`;
}

// Under the item opened: the other items of its task with a way to the task, then the task's story so far. Alone
// (no list beside it), one line names what comes next.
function Helps({ item, items, order, d, wide, cache }) {
  const task = taskOf(item);
  const same = sameTask(item, items);
  const story = useStory(task, cache);
  const next = wide ? [] : nextAfter(order, item.id, 1);
  if (!task && !next.length) return null;
  return html`<div class="p-needs-you__helps">
    ${task ? html`<section class="p-needs-you__more p-needs-you__same-block" tabindex="-1" aria-labelledby="p-needs-you-same">
      <div class="p-needs-you__more-head">
        <h2 id="p-needs-you-same" class="p-needs-you__more-title">${PAGE_WORDS.sameTask}${same.length ? html` <span class="p-needs-you__more-count u-num">${same.length}</span>` : null}</h2>
        <a class="p-needs-you__link p-needs-you__more-link" href=${task.href}>${PAGE_WORDS.openTask}<${Icon} name="arrow-right" size=${14} /></a>
      </div>
      ${same.length ? html`<div class="p-needs-you__more-rows">
        ${same.map((i) => html`<${Row} key=${i.id} item=${i} href=${itemAddress(i.id, d)} line=${true} />`)}
      </div>` : null}
    </section>` : null}
    ${story.length ? html`<section class="p-needs-you__more p-needs-you__story-block" tabindex="-1" aria-labelledby="p-needs-you-story">
      <div class="p-needs-you__more-head">
        <h2 id="p-needs-you-story" class="p-needs-you__more-title">${PAGE_WORDS.story}</h2>
      </div>
      <ol class="p-needs-you__story">${story.map((m, i) => html`<${Entry} key=${i} m=${m} />`)}</ol>
    </section>` : null}
    ${next.length ? html`<p class="p-needs-you__next">
      <span class="p-needs-you__next-label">${PAGE_WORDS.next}:</span>
      <a class="p-needs-you__link" href=${itemAddress(next[0].id, d)}>${cap(next[0].title, 120)}</a>
    </p>` : null}
  </div>`;
}

// The list: the department choice, then the groups. Up and Down move along the rows; Enter opens one.
function List({ items, chips, d, openId, quiet }) {
  const groups = queueGroups(items);
  const onKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const rows = [...e.currentTarget.querySelectorAll(".p-needs-you__row")];
    const at = rows.indexOf(document.activeElement);
    if (!rows.length || at < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next].focus();
  };
  const go = (e) => {
    const v = e.currentTarget.value;
    location.hash = address(v);
  };
  return html`<div class="p-needs-you__list">
    ${chips.length > 1 || d ? html`<div class="p-needs-you__filter">
      <${Select} aria-label=${PAGE_WORDS.filter} value=${d} onChange=${go}
        options=${chips.map((c) => ({ value: c.id, label: `${c.label} · ${c.count}` }))} />
    </div>` : null}
    ${items.length
      ? html`<nav class="p-needs-you__groups" aria-label=${PAGE_WORDS.list} onKeyDown=${onKey}>
          ${groups.map((g) => html`<section key=${g.id} class="p-needs-you__group" aria-label=${g.heading}>
            <h2 class="p-needs-you__heading" aria-hidden="true"><span>${g.title}</span><span class="p-needs-you__heading-count u-num">${g.items.length}</span></h2>
            ${g.items.map((item) => html`<${Row} key=${item.id} item=${item} href=${itemAddress(item.id, d)} current=${item.id === openId} />`)}
          </section>`)}
        </nav>`
      : html`<${Empty} title=${`Nothing from ${DEPARTMENT_TITLES[d] || "here"} needs you.`}>
          <a class="p-needs-you__link" href=${address("")}>${PAGE_WORDS.showAll}</a>
        <//>`}
    ${quiet.length ? html`<ul class="p-needs-you__quiet">
      ${quiet.map((n, i) => html`<li key=${i}><span class="p-needs-you__source">${n.source}:</span> ${n.reason}</li>`)}
      <li><a class="p-needs-you__link" href="#/health">Open Health</a></li>
    </ul>` : null}
  </div>`;
}

// What an action left, drawn where the item was: a shotlist's approval is still a stage; anything else one line.
function Outcome({ done: s }) {
  if (s.kind === "decision") return html`<${DecisionDone} message=${s.message} />`;
  return s.kind === "shotlist"
    ? html`<${ShotlistDone} key=${`done:${s.id}`} done=${s} focus=${true} />`
    : html`<${PickDone} key=${`done:${s.id}`} done=${s} focus=${true} />`;
}

const isStageOutcome = (s) => Boolean(s && s.kind === "shotlist" && s.action === "approve" && s.version);


// ---- The desk around the cards

// Walks the elements under `root` (the page's own DOM; a NodeList or an array of children) for the first that `f`
// accepts.
function findIn(root, f) {
  const kids = root && root.childNodes ? root.childNodes : [];
  for (const c of kids) {
    if (!c || c.nodeType !== 1) continue;
    if (f(c)) return c;
    const deeper = findIn(c, f);
    if (deeper) return deeper;
  }
  return null;
}
const wordsIn = (n) => (n && n.nodeType === 3 ? String(n.data || "") : n && n.childNodes ? [...n.childNodes].map(wordsIn).join("") : "");
const classesOf = (el) => String((el && typeof el.getAttribute === "function" && el.getAttribute("class")) || "").split(/\s+/);
const usable = (el) => el && el.localName === "button" && !el.disabled && el.getAttribute("disabled") === null;

// The button A or D moves focus to: the one whose words are the item's primary (or send-back) action, else, for the
// primary, the card's one filled primary (a shotlist's "Approve A and its cost").
function keyButton(sheet, item, which) {
  const t = keyTargets(item);
  const words = which === "primary" ? t.primary : t.decline;
  const byWords = words ? findIn(sheet, (el) => usable(el) && wordsIn(el).trim() === words) : null;
  if (byWords || which !== "primary") return byWords;
  return findIn(sheet, (el) => usable(el) && classesOf(el).includes("k-btn--primary"));
}

const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/i.test(String(t.tagName || t.localName || "")) || t.isContentEditable === true);
const inside = (t, sel) => !!(t && typeof t.closest === "function" && t.closest(sel));
const modalOpen = () => {
  const d = globalThis.document;
  return !!(d && typeof d.querySelector === "function" && d.querySelector('[aria-modal="true"], [role="alertdialog"]'));
};

// The theme the desk is drawn in: the owner's choice, "auto" as the system says.
function themeOf(settings) {
  const t = settings && settings.theme;
  if (t === "light" || t === "dark") return t;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const rectOf = (el) => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);
const GUTTER = 24;

// The free rectangle of the desk (D15): the stage less the sheet at the left, the list at the right and the shell's
// queue when it is open over the page, in the stage's own pixels. Measured again when any of them changes size and
// when the queue opens or shuts. Null until it can be measured (the test DOM, a stage not shown).
function useSafeRect(rootRef, on, key) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    if (!on) { setRect(null); return undefined; }
    const root = rootRef.current;
    if (!root || typeof root.getBoundingClientRect !== "function") return undefined;
    let timer = 0;
    const measure = () => {
      const r = root.getBoundingClientRect();
      if (!r || !(r.width > 0) || !(r.height > 0)) return;
      let left = 0;
      let right = r.width;
      const sheet = rectOf(root.querySelector(".p-needs-you__sheet"));
      const side = rectOf(root.querySelector(".p-needs-you__side"));
      const queue = rectOf(document.querySelector("#s-queue .k-drawer__panel"));
      if (sheet && sheet.width > 0) left = Math.max(left, sheet.right - r.left);
      if (side && side.width > 0) right = Math.min(right, side.left - r.left);
      if (queue && queue.width > 0 && queue.left < r.right) right = Math.min(right, queue.left - r.left);
      const x = Math.round(left + GUTTER);
      const next = { x, y: 0, w: Math.max(0, Math.round(right - GUTTER) - x), h: Math.round(r.height) };
      setRect((old) => (old && old.x === next.x && old.y === next.y && old.w === next.w && old.h === next.h ? old : next));
    };
    const later = () => { clearTimeout(timer); measure(); timer = setTimeout(measure, 320); };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
    if (ro) {
      ro.observe(root);
      for (const sel of [".p-needs-you__sheet", ".p-needs-you__side"]) { const el = root.querySelector(sel); if (el) ro.observe(el); }
    }
    const host = document.getElementById("s-queue");
    const mo = host && typeof MutationObserver === "function" ? new MutationObserver(later) : null;
    if (mo) mo.observe(host, { childList: true, subtree: true });
    return () => { clearTimeout(timer); if (ro) ro.disconnect(); if (mo) mo.disconnect(); };
  }, [on, key]);
  return rect;
}

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route && route.query ? route.query : new URLSearchParams();
  const d = filterOf(query);
  const want = openOf(query);
  const wide = useMedia(WIDE);
  const phone = useMedia(PHONE);
  const res = useResource("/api/inbox", { every: 10000 });
  const world = useResource("/api/world", { every: 10000 });
  const [departments, setDepartments] = useState(null);
  const [settled, setSettled] = useState([]);
  const [events, setEvents] = useState(null);
  const was = useRef({ id: "", at: null });
  const seen = useRef(null);
  const stories = useRef(Object.create(null));
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const prevWorld = useRef(null);
  const keys = useRef({});

  // The agents of each department, once; the page works without them.
  useEffect(() => {
    let live = true;
    api.get("/api/map")
      .then((m) => { if (live) setDepartments(Array.isArray(m?.departments) ? m.departments : []); })
      .catch(() => { if (live) setDepartments([]); });
    return () => { live = false; };
  }, []);

  // After an action the list and the shell's count are read again at once; what happened is kept, so it stays
  // where the item was when the item leaves the list. The desk's top sheet goes into its room or to the tray.
  const done = (r) => {
    const out = r && r.done && r.done.id ? r.done
      : r && r.item && r.item.id ? { id: r.item.id, kind: "decision", of: r.item.kind, action: r.action, message: String(r.message || "Done."), title: cap(r.item.title, 200) }
        : null;
    if (out) setSettled((old) => [out, ...old.filter((s) => s.id !== out.id)].slice(0, MAX_SETTLED));
    if (r && typeof r === "object") setEvents([deskEvent(r, departments)]);
    res.refresh();
    if (typeof app.refreshShell === "function") app.refreshShell();
    if (r && r.message && typeof app.announce === "function") app.announce(String(r.message));
  };

  const data = res.data;
  const all = data ? sortItems(data.items) : [];
  const shown = data ? itemsFor(data.items, departments, d) : [];
  const order = queueOrder(shown);
  const listed = want ? all.find((i) => i.id === want) || null : null;
  const kept = want ? settled.find((s) => s.id === want) || null : null;
  // The item opened: the one the address names; else, from 1280 px, the first in the list.
  const opened = want ? listed : wide ? order[0] || null : null;
  const openId = want || (opened ? opened.id : "");
  const at = order.findIndex((i) => i.id === openId);
  if (openId && at >= 0) was.current = { id: openId, at };
  const pager = openId && data ? pagerOf(order, openId, d, was.current.id === openId ? was.current.at : null) : null;
  const crumbItem = opened || (kept ? { kind: kept.kind === "decision" ? kept.of : kept.kind } : want ? {} : null);
  const crumbs = crumbsFor(crumbItem, d);

  // The studio's state for the desk: the rooms from /api/world (or the map's departments), the stack from the list
  // shown. The picture gets numbers only; the money line is the server's sentence, whole.
  const worldData = world.data && typeof world.data === "object" ? world.data : null;
  const ws = worldState({ world: worldData, map: departments ? { departments } : null, inbox: { items: shown } });
  const note = ws.money && ws.money.line ? ws.money.line : "";
  const sceneKey = JSON.stringify(ws.scene);
  useEffect(() => {
    const prev = prevWorld.current;
    prevWorld.current = ws;
    if (!prev) return;
    const ev = diffWorld(prev, ws, { visible: !(typeof document !== "undefined" && document.hidden) });
    if (ev.length) setEvents(ev);
  }, [sceneKey]);

  // The top bar: where you are, the pager when an item is open, and today's money line.
  const topKey = JSON.stringify([crumbs, pager, note]);
  useEffect(() => {
    if (typeof app.setTop === "function") app.setTop({ crumbs, pager: pager || undefined, note: note || undefined });
  }, [topKey, app.setTop]);

  // The owner moved to another item on this page: go to the top and give focus to it (a page change does this in
  // the shell; a change of `item` is the same page).
  const stageNow = Boolean((opened && isStageItem(opened)) || isStageOutcome(kept));
  useEffect(() => {
    if (seen.current === null) { seen.current = want; return; }
    if (seen.current === want) return;
    seen.current = want;
    if (typeof window !== "undefined") window.scrollTo(0, 0);
    const look = () => {
      const target = stageNow || !wide ? document.getElementById("page-title") : document.querySelector(".p-needs-you__open");
      if (target && typeof target.focus === "function") target.focus({ preventScroll: true });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(look);
  }, [want]);

  // The keys (D10). They move between items and move focus; none of them acts.
  keys.current = { pager, opened };
  useEffect(() => {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc || typeof doc.addEventListener !== "function") return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target;
      if (typing(t) || modalOpen()) return;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && inside(t, '[role="radiogroup"], [role="menu"], [role="listbox"], [role="tablist"], .p-needs-you__groups')) return;
      const sheet = sheetRef.current;
      const cur = keys.current;
      const intent = keyIntent(e.key, { pager: cur.pager, onSheet: !!sheet && t === sheet, opened: !!cur.opened && !!sheet });
      if (!intent) return;
      if (intent.go) {
        e.preventDefault();
        location.hash = intent.go;
        return;
      }
      const el = intent.focus === "story"
        ? findIn(sheet, (x) => classesOf(x).includes("p-needs-you__story-block")) || findIn(sheet, (x) => classesOf(x).includes("p-needs-you__same-block"))
        : keyButton(sheet, cur.opened, intent.focus);
      if (!el || typeof el.focus !== "function") return;
      e.preventDefault();
      el.focus();
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, []);

  const theme = themeOf(app.settings);
  const still = stillOf();
  const more = ws.stack ? ws.stack.more : 0;
  const deskShown = wide && !!data;
  const safe = useSafeRect(rootRef, deskShown && !stageNow, `${openId}|${shown.length}|${Boolean(kept)}`);
  // The stage: the picture is hidden from readers (office/stage.js); its label, "28 more" when the stack cannot hold
  // every item, is spoken beside it, and the same words stand by the stack in the picture (`note`).
  const stage = (cls) => html`<div class=${cls}>
    <${OfficeStage} mode="desk" state=${ws} safeRect=${cls === "p-needs-you__strip" ? null : safe} theme=${theme} still=${still} events=${events}
      label=${more ? moreWords(more) : ""} note=${more ? moreWords(more) : ""} />
  </div>`;
  const keysLine = html`<p class="p-needs-you__keys">${WORDS.keys}</p>`;
  const moneyLine = phone && note ? html`<p class="p-needs-you__money u-num">${note}</p>` : null;
  const strip = stage("p-needs-you__strip");

  // ---- States before the list: today's words on a sheet over the desk
  if (!data) {
    let body;
    if (res.error) {
      const e = res.error;
      body = e.offline || e.status === 502
        ? html`<${NotConnected} title="What needs you cannot be shown right now" reason=${e.message} next=${plainNext(e.next)} />
            <p><a class="p-needs-you__link" href="#/health">Open Health</a></p>`
        : html`<${ErrorNotice} error=${e} onRetry=${res.reload} />`;
    } else body = html`<${Loading} lines=${5} label="Loading what needs you" />`;
    const titled = html`<header class="p-needs-you__head"><h1 id="page-title" class="p-needs-you__name" tabindex="-1">${PAGE_WORDS.title}</h1></header>
      ${body}`;
    if (wide) {
      return html`<div class="p-needs-you p-needs-you--desk" ref=${rootRef}>
        ${stage("p-needs-you__stage")}
        <section class="p-needs-you__sheet p-needs-you__sheet--small" data-surface="paper">${titled}</section>
      </div>`;
    }
    return html`<div class="p-needs-you p-needs-you--alone">${strip}${titled}</div>`;
  }

  const chips = chipsFor(all, departments, d);
  const quiet = quietLines(data.notConnected);
  const list = html`<${List} items=${shown} chips=${chips} d=${d} openId=${openId} quiet=${quiet} />`;

  // The "Waiting" column at the desk's right: its heading is the page's h1, except under a whole stage, whose own
  // title is the page's one heading.
  const waiting = (h1) => html`<aside class="p-needs-you__side" data-surface="over" aria-label=${PAGE_WORDS.list}>
    <header class="p-needs-you__head">
      ${h1
        ? html`<h1 id="page-title" class="p-needs-you__name p-needs-you__name--desk" tabindex="-1"><span class="u-visually-hidden">${PAGE_WORDS.title}: </span>${WORDS.waiting}</h1>`
        : html`<h2 class="p-needs-you__name p-needs-you__name--desk"><span class="u-visually-hidden">${PAGE_WORDS.title}: </span>${WORDS.waiting}</h2>`}
      <span class="p-needs-you__count u-num">${shown.length}</span>
    </header>
    ${list}
  </aside>`;

  // ---- A whole stage: the shotlist or the versions opened, or a shotlist just approved
  const stageCard = opened && isStageItem(opened)
    ? (isShotlistItem(opened)
      ? html`<${ShotlistCard} key=${opened.id} item=${opened} onDone=${done} />`
      : html`<${PickCard} key=${opened.id} item=${opened} onDone=${done} href=${itemAddress(opened.id, d)} />`)
    : !opened && isStageOutcome(kept)
      ? (kept.kind === "shotlist"
        ? html`<${ShotlistDone} key=${`done:${kept.id}`} done=${kept} focus=${true} />`
        : html`<${PickDone} key=${`done:${kept.id}`} done=${kept} focus=${true} />`)
      : null;
  if (stageCard) {
    if (wide) {
      return html`<div class="p-needs-you p-needs-you--desk p-needs-you--wide-sheet" ref=${rootRef}>
        ${stage("p-needs-you__stage")}
        <div class="p-needs-you__dim" aria-hidden="true"></div>
        ${waiting(false)}
        <section class="p-needs-you__open p-needs-you__sheet p-needs-you__sheet--wide" data-surface="paper" tabindex="-1" ref=${sheetRef}
          aria-label=${opened ? cap(opened.title, 120) : PAGE_WORDS.title}>${stageCard}</section>
      </div>`;
    }
    return html`<div class="p-needs-you p-needs-you--stage">${phone ? strip : null}${stageCard}</div>`;
  }

  // ---- The item opened (or what became of it), as a card at the page's level
  const card = (item) => (isShotlistItem(item)
    ? html`<${ShotlistCard} key=${item.id} item=${item} onDone=${done} />`
    : isPickItem(item)
      ? html`<${PickCard} key=${item.id} item=${item} onDone=${done} />`
      : html`<${DecisionCard} key=${item.id} item=${item} onDone=${done} level />`);
  let open = null;
  if (opened) open = card(opened);
  else if (kept) open = html`<${Outcome} done=${kept} />`;
  else if (want) {
    open = html`<div class="p-needs-you__gone"><${Notice} tone="info" title=${SHOTLIST_WORDS.gone}>
      <a class="p-needs-you__link" href=${address(d)}>${PAGE_WORDS.back}</a>
    <//></div>`;
  }

  // ---- Nothing waits: the desk with an empty tray, the existing words and "Open Tasks" on a small sheet
  if (!all.length && !open) {
    const nothing = html`<header class="p-needs-you__head"><h1 id="page-title" class="p-needs-you__name" tabindex="-1">${PAGE_WORDS.title}</h1></header>
      <${Empty} title=${PAGE_WORDS.empty} text=${PAGE_WORDS.emptyLine}>
        <${Button} href="#/tasks">${PAGE_WORDS.openTasks}<//>
      <//>`;
    if (wide) {
      return html`<div class="p-needs-you p-needs-you--desk p-needs-you--empty" ref=${rootRef}>
        ${stage("p-needs-you__stage")}
        <section class="p-needs-you__sheet p-needs-you__sheet--small" data-surface="paper">${nothing}</section>
      </div>`;
    }
    return html`<div class="p-needs-you p-needs-you--alone">${strip}${moneyLine}${nothing}</div>`;
  }

  // From 1280 px: the desk, the sheet at the left, the list at the right.
  if (wide) {
    return html`<div class="p-needs-you p-needs-you--desk" ref=${rootRef}>
      ${stage("p-needs-you__stage")}
      ${waiting(true)}
      ${open ? html`<section class="p-needs-you__open p-needs-you__sheet" data-surface="paper" tabindex="-1" ref=${sheetRef}
          aria-label=${opened ? cap(opened.title, 120) : PAGE_WORDS.title}>
        ${open}
        ${opened ? html`<${Helps} item=${opened} items=${order} order=${order} d=${d} wide=${true} cache=${stories} />` : null}
        ${opened ? keysLine : null}
      </section>` : null}
    </div>`;
  }
  // Under 1280 px an item opened is the sheet alone (on a phone under the desk strip, as e2's phone shows it, with
  // nothing of the desk behind the sheet); the top bar's back button returns to the list.
  if (open) {
    // On a phone the item's kind and place head the sheet, and the sheet lies over the strip's lower edge (e2's phone).
    const itemHead = html`<header class="p-needs-you__head p-needs-you__head--item">
        <h1 id="page-title" class="p-needs-you__kind" tabindex="-1">${crumbsFor(crumbItem, d)[1].label}</h1>
        ${pager && pager.index ? html`<span class="p-needs-you__at u-num">${pager.label}</span>` : null}
      </header>`;
    return html`<div class=${`p-needs-you p-needs-you--alone${phone ? " p-needs-you--on-strip" : ""}`}>
      ${phone ? strip : itemHead}
      <section class="p-needs-you__open p-needs-you__sheet" data-surface="paper" tabindex="-1" ref=${sheetRef}>
        ${phone ? itemHead : null}
        ${open}
        ${opened ? html`<${Helps} item=${opened} items=${order} order=${order} d=${d} wide=${false} cache=${stories} />` : null}
        ${opened && !phone ? keysLine : null}
      </section>
    </div>`;
  }
  const head = html`<header class="p-needs-you__head">
    <h1 id="page-title" class="p-needs-you__name" tabindex="-1">${PAGE_WORDS.title}</h1>
    <span class="p-needs-you__count u-num">${shown.length}</span>
  </header>`;
  return html`<div class="p-needs-you p-needs-you--list">
    ${strip}
    <div class="p-needs-you__side">${moneyLine}${head}<p class="p-needs-you__lede">${PAGE_WORDS.lede}</p>${list}</div>
  </div>`;
}
