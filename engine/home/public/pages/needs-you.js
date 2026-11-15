// Needs you: every item waiting for the owner, and one of them opened (PLAN-COOK T50; CONTRACTS-V3 30, 26.4).
// Address: #/needs-you, #/needs-you?d=<department> (one department), #/needs-you?item=<id> (one item opened).
// Data: GET /api/inbox every 10 seconds; the agents of each department come from GET /api/map (read once; without
// it items are placed by their source alone).
// From 1280 px the list is at the left (grouped as the queue groups it) and the item opened at the right, the first
// one when the address names none. A film's shotlist or a task's versions to pick from (kit ShotlistCard, PickCard)
// is a whole stage: it takes the pane, its title is the page's heading, and the list is the queue panel. Below 1280
// px the list is the page and an item opened is a screen of its own (the top bar's back button returns to the list).
// The top bar gets the crumbs and a pager over the list's order. After an action its outcome stays where the item
// was until the owner moves on.
// Side by side (T104, T116, R5-D) the page fills the pane: the list a column of its own that scrolls by itself, each
// row a title on up to two lines with its time in a 64 px gutter at the right (its grey line only where it adds a
// fact the title does not say), each group under its label and count over a hairline; the item opened at the top of
// the rest, and under it, on the ground, what helps decide: the other items of the same task with a way to the task,
// then the task's story so far (its whole thread, up to eight entries, the newest first, from GET /api/tasks/:id, the
// route the task page reads: one request a task, kept while the page lives). The list beside it already says what
// comes next; alone (under 1280 px) one line names it.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, linkHref } from "../lib/format.js";
import { SOURCE_DEPARTMENT, queueGroups, rowTime, sortNeeds } from "../lib/queue.js";
import {
  Avatar, Button, DecisionCard, DecisionDone, Empty, ErrorNotice, Icon, Loading, NotConnected, Notice, PickCard, PickDone, Select,
  ShotlistCard, ShotlistDone, StateIcon, SHOTLIST_WORDS, isPickItem, isShotlistItem,
} from "../kit/index.js";

const DEPARTMENT_IDS = ["operations", "sales", "marketing", "studio", "support", "people", "books"];
const DEPARTMENT_TITLES = { operations: "Operations", sales: "Sales", marketing: "Marketing", studio: "Studio", support: "Support", people: "People", books: "Books" };
const SOURCE_WORDS = { board: "The board", books: "The books", customers: "Customers", support: "Support", people: "People", marketing: "Marketing", studio: "Studio", goal: "Tasks" };
const MAX_ITEMS = 200;
const MAX_SETTLED = 3;
// The list and an item side by side from here; under it the list is the page.
const WIDE = "(min-width: 1280px)";

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

// One row: the kind's glyph, the title on up to two lines, the time at the top right, and the grey line (one line)
// only where it adds a fact (`line` true shows it always, as under the item opened, where there is room).
function Row({ item, href, current, line = false }) {
  const at = rowTime(item.when);
  return html`<a class="p-needs-you__row" href=${href} aria-current=${current ? "true" : undefined}>
    <span class="p-needs-you__icon" aria-hidden="true"><${KindIcon} kind=${item.kind} /></span>
    <span class="p-needs-you__title">${cap(item.title, 120)}</span>
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
    ${task ? html`<section class="p-needs-you__more" aria-labelledby="p-needs-you-same">
      <div class="p-needs-you__more-head">
        <h2 id="p-needs-you-same" class="p-needs-you__more-title">${PAGE_WORDS.sameTask}${same.length ? html` <span class="p-needs-you__more-count u-num">${same.length}</span>` : null}</h2>
        <a class="p-needs-you__link p-needs-you__more-link" href=${task.href}>${PAGE_WORDS.openTask}<${Icon} name="arrow-right" size=${14} /></a>
      </div>
      ${same.length ? html`<div class="p-needs-you__more-rows">
        ${same.map((i) => html`<${Row} key=${i.id} item=${i} href=${itemAddress(i.id, d)} line=${true} />`)}
      </div>` : null}
    </section>` : null}
    ${story.length ? html`<section class="p-needs-you__more" aria-labelledby="p-needs-you-story">
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

export default function Page({ route }) {
  const app = useApp() || {};
  const query = route && route.query ? route.query : new URLSearchParams();
  const d = filterOf(query);
  const want = openOf(query);
  const wide = useMedia(WIDE);
  const res = useResource("/api/inbox", { every: 10000 });
  const [departments, setDepartments] = useState(null);
  const [settled, setSettled] = useState([]);
  const was = useRef({ id: "", at: null });
  const seen = useRef(null);
  const stories = useRef(Object.create(null));

  // The agents of each department, once; the page works without them.
  useEffect(() => {
    let live = true;
    api.get("/api/map")
      .then((m) => { if (live) setDepartments(Array.isArray(m?.departments) ? m.departments : []); })
      .catch(() => { if (live) setDepartments([]); });
    return () => { live = false; };
  }, []);

  // After an action the list and the shell's count are read again at once; what happened is kept, so it stays
  // where the item was when the item leaves the list.
  const done = (r) => {
    const out = r && r.done && r.done.id ? r.done
      : r && r.item && r.item.id ? { id: r.item.id, kind: "decision", of: r.item.kind, action: r.action, message: String(r.message || "Done."), title: cap(r.item.title, 200) }
        : null;
    if (out) setSettled((old) => [out, ...old.filter((s) => s.id !== out.id)].slice(0, MAX_SETTLED));
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

  // The top bar: where you are, and the pager when an item is open.
  const topKey = JSON.stringify([crumbs, pager]);
  useEffect(() => {
    if (typeof app.setTop === "function") app.setTop({ crumbs, pager: pager || undefined });
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

  // ---- States before the list
  if (!data) {
    let body;
    if (res.error) {
      const e = res.error;
      body = e.offline || e.status === 502
        ? html`<${NotConnected} title="What needs you cannot be shown right now" reason=${e.message} next=${plainNext(e.next)} />
            <p><a class="p-needs-you__link" href="#/health">Open Health</a></p>`
        : html`<${ErrorNotice} error=${e} onRetry=${res.reload} />`;
    } else body = html`<${Loading} lines=${5} label="Loading what needs you" />`;
    return html`<div class="p-needs-you p-needs-you--alone">
      <header class="p-needs-you__head"><h1 id="page-title" class="p-needs-you__name" tabindex="-1">${PAGE_WORDS.title}</h1></header>
      ${body}
    </div>`;
  }

  // ---- A whole stage: the shotlist or the versions opened, or a shotlist just approved
  if (opened && isStageItem(opened)) {
    return html`<div class="p-needs-you p-needs-you--stage">
      ${isShotlistItem(opened)
        ? html`<${ShotlistCard} key=${opened.id} item=${opened} onDone=${done} />`
        : html`<${PickCard} key=${opened.id} item=${opened} onDone=${done} href=${itemAddress(opened.id, d)} />`}
    </div>`;
  }
  if (!opened && isStageOutcome(kept)) {
    return html`<div class="p-needs-you p-needs-you--stage">
      ${kept.kind === "shotlist"
        ? html`<${ShotlistDone} key=${`done:${kept.id}`} done=${kept} focus=${true} />`
        : html`<${PickDone} key=${`done:${kept.id}`} done=${kept} focus=${true} />`}
    </div>`;
  }

  const chips = chipsFor(all, departments, d);
  const quiet = quietLines(data.notConnected);

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

  // ---- Nothing waits
  if (!all.length && !open) {
    return html`<div class="p-needs-you p-needs-you--alone">
      <header class="p-needs-you__head"><h1 id="page-title" class="p-needs-you__name" tabindex="-1">${PAGE_WORDS.title}</h1></header>
      <${Empty} title=${PAGE_WORDS.empty} text=${PAGE_WORDS.emptyLine}>
        <${Button} href="#/tasks">${PAGE_WORDS.openTasks}<//>
      <//>
    </div>`;
  }

  const list = html`<${List} items=${shown} chips=${chips} d=${d} openId=${openId} quiet=${quiet} />`;
  const head = html`<header class="p-needs-you__head">
    <h1 id="page-title" class="p-needs-you__name" tabindex="-1">${PAGE_WORDS.title}</h1>
    <span class="p-needs-you__count u-num">${shown.length}</span>
  </header>`;

  // From 1280 px: the list at the left, the item opened at the right.
  if (wide && open) {
    return html`<div class="p-needs-you p-needs-you--split">
      <div class="p-needs-you__side">${head}${list}</div>
      <div class="p-needs-you__pane">
        <section class="p-needs-you__open" tabindex="-1" aria-label=${opened ? cap(opened.title, 120) : PAGE_WORDS.title}>${open}</section>
        ${opened ? html`<${Helps} item=${opened} items=${order} order=${order} d=${d} wide=${true} cache=${stories} />` : null}
      </div>
    </div>`;
  }
  // Under 1280 px an item opened is a screen of its own; the top bar's back button returns to the list.
  if (open) {
    return html`<div class="p-needs-you p-needs-you--alone">
      <header class="p-needs-you__head p-needs-you__head--item">
        <h1 id="page-title" class="p-needs-you__kind" tabindex="-1">${crumbsFor(crumbItem, d)[1].label}</h1>
        ${pager && pager.index ? html`<span class="p-needs-you__at u-num">${pager.label}</span>` : null}
      </header>
      <section class="p-needs-you__open" tabindex="-1">${open}</section>
      ${opened ? html`<${Helps} item=${opened} items=${order} order=${order} d=${d} wide=${false} cache=${stories} />` : null}
    </div>`;
  }
  return html`<div class="p-needs-you p-needs-you--list">
    <div class="p-needs-you__side">${head}<p class="p-needs-you__lede">${PAGE_WORDS.lede}</p>${list}</div>
  </div>`;
}
