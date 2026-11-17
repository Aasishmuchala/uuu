// Marketing page (CONTRACTS 9.6, 9.8), in the frame of the record dashboards (R07): the title with the agent and
// its state at the top right, a row of filters, the figures as totals, then the content calendar grouped by week,
// each post a row with a small picture and its state, opening in place with its text and the inbox decision. A
// shotlist or a card of versions waiting for the owner is the compact card that opens it in Needs you; drafts
// waiting stay as rows with the way into Needs you. Then concepts, carousels, what was made, files that could not
// be used, the jobs to start (M51 F20). Publishing is off and nothing here can turn it on.
// PLAN-3D-ALL U12: the title, its line, the agent and the filters stand in the room header, Marketing's room behind
// them (kit/room.js). The calendar, the tables and the cards stay on the ground; only what the owner reads and decides
// is on paper (D4): a card waiting to be picked or approved, and a post opened in place with its decision.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  DataTable, DecisionCard, Empty, ErrorNotice, Icon, isPickItem, isShotlistItem, Loading, Menu, NotConnected, Notice,
  RoomHeader, Row, Rows, Section, Sheet, St, Tag, glimpseFor,
} from "../kit/index.js";
import { AgentHead, Jobs, OpenDepartment, QueueLink, Totals } from "./dashboard.js";

export const GROUPS = [
  { id: "this-week", title: "This week" },
  { id: "next-week", title: "Next week" },
  { id: "later", title: "Later" },
  { id: "no-date", title: "No date" },
];

const DAY = 86400000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const dayNumber = (iso) => {
  const m = ISO.exec(String(iso ?? ""));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  // Reject dates that roll over (30 February).
  return d.getUTCMonth() === +m[2] - 1 ? Math.floor(t / DAY) : null;
};

const todayNumber = (today) => {
  if (typeof today === "string") {
    const n = dayNumber(today.slice(0, 10));
    if (n !== null) return n;
  }
  const d = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
};

// Group calendar rows under This week, Next week, Later and No date. Weeks start on Monday; a past
// date goes under This week. Always returns the four groups in that order; each has its rows by date.
export function groupByWeek(rows, today = new Date()) {
  const t = todayNumber(today);
  // 1 January 1970 was a Thursday, so (n + 3) % 7 is 0 for Monday.
  const monday = t - ((t + 3) % 7);
  const out = GROUPS.map((g) => ({ ...g, rows: [] }));
  for (const row of Array.isArray(rows) ? rows : []) {
    const n = dayNumber(row?.planned);
    const i = n === null ? 3 : n < monday + 7 ? 0 : n < monday + 14 ? 1 : 2;
    out[i].rows.push(row);
  }
  for (const g of out) g.rows.sort((a, b) => String(a.planned ?? "").localeCompare(String(b.planned ?? "")));
  return out;
}

// The id of a draft from its inbox id `content:<id>`, or null.
export const draftIdOf = (row) => {
  const m = /^content:([0-9a-f]{12})$/.exec(String(row?.inboxId ?? ""));
  return m ? m[1] : null;
};

export const itemFor = (row, inbox) => (row?.inboxId ? (inbox?.items || []).find((i) => i.id === row.inboxId) || null : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// A planned day ("2026-11-12") as the owner reads it: "Thu 12 Nov". Read from the text, so no time zone shifts it.
export function plannedLabel(iso) {
  const n = dayNumber(iso);
  if (n === null) return "No date";
  const m = ISO.exec(String(iso));
  return `${WEEKDAYS[(n + 3) % 7]} ${+m[3]} ${MONTHS[+m[2] - 1]}`;
}

// The calendar rows whose decision is waiting in the inbox, each with its item, in date order.
export function waitingDrafts(rows, inbox) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, item: itemFor(row, inbox) }))
    .filter((x) => x.item)
    .sort((a, b) => String(a.row.planned ?? "").localeCompare(String(b.row.planned ?? "")));
}


// ---- The three sections of CONTRACTS-V3 36: concepts, carousels, and what was made and how it did. ----
// Rows are read defensively: they come from the home server, which reads what agents wrote.

const clip = (v, n) => String(v ?? "").slice(0, n);
const asList = (v) => (Array.isArray(v) ? v : []);

// Concepts: one entry per task, with at most five headlines and a link to the task.
export function conceptsOf(section) {
  const refOf = (r) => {
    const t = r?.task;
    const v = r?.identifier || r?.taskId || (t && typeof t === "object" ? t.identifier || t.id : t) || "";
    return clip(typeof v === "string" || typeof v === "number" ? v : "", 80);
  };
  return asList(section?.rows).slice(0, 50).map((r, i) => {
    const ref = refOf(r);
    const raw = [r?.headlines, r?.headlineList, r?.list, r?.items].find(Array.isArray) || [];
    const headlines = raw.map((h) => clip(typeof h === "string" ? h : h?.headline ?? h?.title ?? "", 120)).filter(Boolean).slice(0, 5);
    const title = r?.title || r?.subject || (r?.task && typeof r.task === "object" ? r.task.title : "") || "Five concepts";
    return { key: ref || `concepts-${i}`, title: clip(title, 120), href: ref ? `#/tasks/${encodeURIComponent(ref)}` : null, headlines };
  }).filter((c) => c.headlines.length);
}

// Scores arrive as a list of { label, score } (or { slug, score }) or as the text "concept-1 9, concept-2 8".
// Anything else is none. Whatever a piece was called, it is shown as "piece <n>": a label the Checker wrote is
// an agent's word and is never shown (M63 item 26).
export function scoreList(value) {
  const list = Array.isArray(value)
    ? value.map((x) => (x && typeof x === "object" ? { score: Number(x.score) } : null))
    : String(value ?? "").slice(0, 2000).split(",").map((part) => {
      const m = /^\s*([a-z0-9-]{1,40})\s+(10|[0-9])\s*$/.exec(part.slice(0, 60));
      return m ? { score: Number(m[2]) } : null;
    });
  return list.filter((x) => x && Number.isInteger(x.score) && x.score >= 0 && x.score <= 10).slice(0, 20)
    .map((x, i) => ({ label: `piece ${i + 1}`, score: x.score }));
}

// A score of 8 or more passes the Checker's bar.
export const scoreTone = (n) => (n >= 8 ? "ok" : "warn");

export function verdictTone(verdict) {
  const v = String(verdict ?? "");
  return v === "Accepted" ? "ok" : v === "Sent back" ? "warn" : "neutral";
}

// The sets of the slides answer, each with a safe contact picture and a plain line on its checks.
const viewOnly = (file) => (typeof file?.viewUrl === "string" && file.viewUrl.startsWith("/api/view/") ? file.viewUrl : null);
export const slideSets = (data) => asList(data?.sets).filter((s) => s && typeof s.id === "string").slice(0, 50);
export const slideSetById = (data, id) => slideSets(data).find((s) => s.id === id) || null;
export function checksLine(set) {
  const c = set?.checks || {};
  if (c.ok) return "Count and sizes are right";
  const bad = [];
  if (c.countMatches === false) bad.push("the count is wrong");
  if (c.sizesMatch === false) bad.push("the sizes differ");
  return bad.length ? `Needs a look: ${bad.join(" and ")}` : "Not checked";
}

export function Concepts({ section }) {
  const list = conceptsOf(section);
  return html`
    <${Section} title="Concepts" count=${list.length || undefined} hint="Five headlines for each subject. Pick one when you start a carousel from it.">
      ${list.length ? html`
        <ul class="p-marketing__concepts">
          ${list.map((c) => html`
            <li key=${c.key} class="p-marketing__concept">
              <p class="p-marketing__concept-title">${c.title}</p>
              <ol class="p-marketing__headlines">${c.headlines.map((h, i) => html`<li key=${i}>${h}</li>`)}</ol>
              ${c.href ? html`<a href=${c.href}>Open the task</a>` : null}
            </li>`)}
        </ul>` : html`<${Empty} title=${section?.emptyText || "No concepts yet."} text="Ask for five concepts before any design and they show here." />`}
    <//>`;
}

export function SlidesLarge({ set }) {
  const files = asList(set.slides);
  return html`
    <div class="p-marketing p-marketing--panel"><div class="p-marketing__large">
      ${files.map((f, i) => {
        const src = viewOnly(f);
        const text = clip(asList(set.texts)[i], 600);
        return html`
          <figure key=${i} class="p-marketing__slide">
            ${src ? html`<img src=${src} alt=${text || `Slide ${i + 1}`} loading="lazy" />` : html`<p class="p-marketing__note">This slide cannot be shown.</p>`}
            ${text ? html`<figcaption>${text}</figcaption>` : null}
          </figure>`;
      })}
    </div></div>`;
}

export function Carousels({ slides, current, onOpen }) {
  const d = slides.data;
  const sets = slideSets(d);
  return html`
    <${Section} title="Carousels" count=${sets.length || undefined}>
      ${slides.loading && !d ? html`<${Loading} lines=${2} label="Loading the carousels" />` : null}
      ${slides.error && !d ? html`<${ErrorNotice} error=${slides.error} onRetry=${slides.reload} />` : null}
      ${d?.notConnected ? html`<${NotConnected} reason=${d.notConnected.reason} next=${d.notConnected.next} />` : null}
      ${d && !d.notConnected ? (sets.length ? html`
        <ul class="p-marketing__sets">
          ${sets.map((s) => {
            const src = viewOnly(s.contact);
            return html`
              <li key=${s.id} class=${`p-marketing__set${s.id === current ? " is-current" : ""}`}>
                <button type="button" class="p-marketing__set-open" onClick=${() => onOpen(s.id)} aria-label=${`Open ${clip(s.title || s.name, 80)} large`}>
                  ${src ? html`<img class="p-marketing__contact" src=${src} alt="" loading="lazy" />` : html`<span class="p-marketing__contact p-marketing__contact--none">No picture</span>`}
                </button>
                <p class="p-marketing__set-title">${clip(s.title || s.name, 80)}</p>
                <p class="p-marketing__note">${Number(s.count) || 0} slides${s.changed ? ` · ${clip(s.changed, 20)}` : ""}</p>
                <${Tag} tone=${s.checks?.ok ? "ok" : "warn"}>${checksLine(s)}<//>
              </li>`;
          })}
        </ul>` : html`<${Empty} title="No carousels yet." text="Ask for a carousel from one of the concepts and it shows here." />`) : null}
    <//>`;
}

export function Recipes({ section }) {
  const rows = asList(section?.rows).slice(0, 200);
  const columns = [
    { key: "date", label: "Date", align: "start" }, { key: "job", label: "What was made" }, { key: "rounds", label: "Rounds" },
    { key: "scores", label: "Scores" }, { key: "verdict", label: "Your answer" },
  ];
  return html`
    <${Section} title="What was made and how it did" count=${rows.length || undefined}>
      ${rows.length ? html`
        <${DataTable} columns=${columns} rows=${rows.map((r, i) => ({ ...r, id: r?.id ?? i }))} renderCell=${(row, col) => {
          if (col.key === "scores") {
            const list = scoreList(row.scores);
            return list.length ? html`<span class="p-marketing__scores">${list.map((x) => html`<${Tag} key=${x.label} tone=${scoreTone(x.score)}>${x.label}: ${x.score}<//>`)}</span>` : "No scores";
          }
          if (col.key === "verdict") return row.verdict ? html`<${Tag} tone=${verdictTone(row.verdict)}>${clip(row.verdict, 40)}<//>` : "";
          return undefined;
        }} />` : html`<${Empty} title=${section?.emptyText || "Nothing made and answered yet."} text="Once you accept or send back some work, how it did shows here." />`}
    <//>`;
}

const STATUS_TONE = { "Waiting for you": "warn", Approved: "ok", "Sent back": "neutral" };

// The page's own words (a new label is added here and pinned by the page's test).
export const MARKETING_WORDS = {
  filters: "Filters",
  kind: "Kind",
  anyKind: "Any kind",
  status: "Status",
  anyStatus: "Any status",
  noMatch: "No posts match these filters.",
  allPosts: "Show every post",
  waitsPick: "To pick or approve",
  draft: "The draft",
};

// A calendar row's kind of piece and its line icon, for a row with no picture.
const KIND_ICON = { post: "image", newsletter: "send", carousel: "layers" };
export const kindIcon = (kind) => KIND_ICON[String(kind ?? "").toLowerCase()] || "docs";

// A calendar row's own picture, only through the page's view helper (an /api/view/ address), or null.
export const rowPicture = (row) => viewOnly(row?.picture) || viewOnly(row);

// The filters of the address: ?kind=<kind>&st=<status>, both in small letters. Pure.
export function postFilters(query) {
  const get = (k) => (query && typeof query.get === "function" ? String(query.get(k) || "") : "");
  return { kind: get("kind").slice(0, 40).toLowerCase(), st: get("st").slice(0, 40).toLowerCase() };
}

// The address of Marketing with its filters; an empty filter is left out. Pure.
export function marketingAddress(f = {}) {
  const q = new URLSearchParams();
  if (f.kind) q.set("kind", f.kind);
  if (f.st) q.set("st", f.st);
  const qs = q.toString();
  return `#/dashboards/marketing${qs ? `?${qs}` : ""}`;
}

// The words of one column of the calendar's rows, once each in the order first seen: [{ value, label }]. Pure.
export function postChoices(rows, key) {
  const seen = new Map();
  for (const r of asList(rows)) {
    const label = clip(r?.[key], 40).trim();
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

// The calendar rows the filters keep. Pure.
export function filterPosts(rows, f = {}) {
  const low = (v) => String(v ?? "").trim().toLowerCase();
  return asList(rows).filter((r) => r && (!f.kind || low(r.kind) === f.kind) && (!f.st || low(r.status) === f.st));
}

// The items of Marketing in Needs you that are a shotlist or a card of versions: each is drawn as the compact card.
export function cardsWaiting(inbox) {
  return asList(inbox?.items).filter((i) => i && i.department === "marketing" && (isShotlistItem(i) || isPickItem(i)));
}

function DraftBody({ id, item, onDone }) {
  const res = useResource(id ? `/api/content/${encodeURIComponent(id)}` : null);
  const draft = res.data?.draft;
  return html`
    <div class="p-marketing__open"><${Sheet} wide=${true} label=${MARKETING_WORDS.draft}>
      ${res.loading && !draft ? html`<${Loading} lines=${3} label="Loading the draft" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${draft ? html`
        <p class="p-marketing__text">${String(draft.body ?? "").slice(0, 8000)}</p>
        ${draft.note ? html`<p class="p-marketing__note">Your note: ${String(draft.note).slice(0, 500)}</p>` : null}` : null}
      ${item ? html`<${DecisionCard} item=${item} compact onDone=${onDone} />` : null}
    <//></div>`;
}

// One post as a row: a small picture (or its kind's line icon), the title over the day and kind, the state at the
// right. The row opens in place with the draft's text and its decision.
function CalendarRow({ row, inbox, onDone }) {
  const [open, setOpen] = useState(false);
  const id = draftIdOf(row);
  const item = itemFor(row, inbox);
  const panel = `p-marketing-row-${id || "none"}`;
  const src = rowPicture(row);
  return html`
    <li class=${`p-marketing__row${open ? " is-open" : ""}`}>
      <button type="button" class="p-marketing__head" aria-expanded=${open ? "true" : "false"} aria-controls=${panel} onClick=${() => setOpen(!open)}>
        <span class="p-marketing__thumb" aria-hidden="true">
          ${src ? html`<img src=${src} alt="" loading="lazy" />` : html`<${Icon} name=${kindIcon(row.kind)} size=${18} />`}
        </span>
        <span class="p-marketing__words">
          <span class="p-marketing__title">${row.title || "Untitled"}</span>
          <span class="p-marketing__meta"><span class="p-marketing__date">${plannedLabel(row.planned)}</span> · ${row.kind || "Draft"}</span>
        </span>
        ${row.status ? html`<${St} tone=${STATUS_TONE[row.status] || "neutral"}>${row.status}<//>` : null}
        <${Icon} name="chevron-right" size=${16} class="p-marketing__chev" />
      </button>
      ${open ? html`
        <div id=${panel}>
          ${id ? html`<${DraftBody} id=${id} item=${item} onDone=${onDone} />`
            : html`<p class="p-marketing__note">Only drafts still waiting for you can be opened here.</p>`}
        </div>` : null}
    </li>`;
}

// `?slides=` names a carousel that is not (or no longer) there: true once the carousels are read.
export const slidesMissing = (data, current) => Boolean(current && data && !data.notConnected && !slideSetById(data, current));

const go = (href) => { if (href && typeof location !== "undefined") location.hash = href; };

// One filter: the kit's menu, its button showing the filter's name, or its choice once one is made.
function FilterMenu({ name, options, current, make }) {
  const on = options.find((o) => o.value && o.value === current);
  const items = options.map((o) => {
    const now = o.value === (current || "");
    return { id: o.value || "all", label: o.label, icon: now ? "check" : undefined, current: now ? true : undefined, onSelect: () => go(make(o.value)) };
  });
  return html`<div class=${`p-dashboard-filter${on ? " p-dashboard-filter--on" : ""}`}>
    <${Menu} label=${on ? on.label : name} items=${items} />
  </div>`;
}

function Bar({ f, rows }) {
  const W = MARKETING_WORDS;
  const kinds = postChoices(rows, "kind");
  const states = postChoices(rows, "status");
  if (!kinds.length && !states.length) return null;
  return html`<div class="p-dashboard-bar" role="group" aria-label=${W.filters}>
    ${kinds.length ? html`<${FilterMenu} name=${W.kind} current=${f.kind} make=${(v) => marketingAddress({ ...f, kind: v })}
      options=${[{ value: "", label: W.anyKind }, ...kinds]} />` : null}
    ${states.length ? html`<${FilterMenu} name=${W.status} current=${f.st} make=${(v) => marketingAddress({ ...f, st: v })}
      options=${[{ value: "", label: W.anyStatus }, ...states]} />` : null}
  </div>`;
}

export default function Page({ route }) {
  const { openPanel, closePanel } = useApp();
  const res = useResource("/api/departments/marketing", { every: 10000 });
  const slides = useResource("/api/studio/slides", { every: 10000 });
  const inbox = useResource("/api/inbox", { every: 10000 });
  const d = res.data;
  const current = route?.query?.get("slides") || "";
  const f = postFilters(route?.query);
  const opened = useRef("");
  const openSet = (id) => {
    if (typeof location !== "undefined" && location.hash !== `#/dashboards/marketing?slides=${encodeURIComponent(id)}`) location.hash = `#/dashboards/marketing?slides=${encodeURIComponent(id)}`;
  };
  // The address decides what the work panel shows: ?slides=<goal>/<name> opens that set large.
  const set = slideSetById(slides.data, current);
  useEffect(() => {
    if (set && typeof openPanel === "function") {
      opened.current = set.id;
      openPanel(html`<${SlidesLarge} set=${set} />`, { title: clip(set.title || set.name, 80) });
    } else if (!set && opened.current && !current) {
      opened.current = "";
      if (typeof closePanel === "function") closePanel();
    }
  }, [set?.id, current]);
  useEffect(() => () => { if (opened.current && typeof closePanel === "function") closePanel(); }, []);
  const sections = d?.sections || [];
  const calendar = sections.find((s) => s.id === "calendar");
  const problems = sections.find((s) => s.id === "problems");
  const onDone = () => { res.refresh(); inbox.refresh(); };
  const posts = filterPosts(calendar?.rows, f);
  const groups = groupByWeek(posts, new Date()).filter((g) => g.rows.length);
  const waiting = waitingDrafts(calendar?.rows, inbox.data);
  const cards = cardsWaiting(inbox.data);
  const publishing = (d?.switches || []).find((s) => s.id === "publishing");
  const filtered = Boolean(f.kind || f.st);
  return html`
    <div class="p-marketing p-dashboard">
      <${RoomHeader} glimpse=${glimpseFor("marketing")} title="Marketing" back=${{ label: "All dashboards", href: "#/dashboards" }}
        crumbs=${[{ label: "Dashboards", href: "#/dashboards" }, { label: "Marketing" }]}
        lead="Posts and newsletters drafted by the Marketer."
        actions=${d?.agent ? html`<${AgentHead} slug="marketer" agent=${d.agent} />` : null}>
        ${calendar?.rows?.length ? html`<${Bar} f=${f} rows=${calendar.rows} />` : null}
      <//>
      ${slidesMissing(slides.data, current) ? html`<${Notice} tone="warn" title="That carousel is not here.">It may have been moved or taken away. The carousels below are the ones there are.<//>` : null}
      ${res.loading && !d ? html`<${Loading} lines=${4} label="Loading Marketing" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${d ? html`
        <${Totals} figures=${d.figures || []} />
        <${Notice} tone="info" title="Publishing is off.">${publishing?.explain || "Connect an account to turn this on."}<//>
        ${cards.length ? html`
          <${Section} title=${MARKETING_WORDS.waitsPick} count=${cards.length}>
            <ul class="p-marketing__cards">
              ${cards.map((item) => html`<li key=${item.id}><${Sheet} wide=${true}><${DecisionCard} item=${item} compact onDone=${onDone} /><//></li>`)}
            </ul>
          <//>` : null}
        ${waiting.length ? html`
          <${Section} title="Drafts waiting for you" count=${waiting.length} aside=${html`<${QueueLink} dept="marketing" />`}>
            <ul class="p-marketing__waiting">
              ${waiting.map(({ row, item }) => html`<li key=${item.id} class="p-marketing__wait">
                <span class="p-marketing__wait-title">${row.title || "Untitled"}</span>
                <span class="p-marketing__wait-meta">${plannedLabel(row.planned)} · ${row.kind || "Draft"}</span>
              </li>`)}
            </ul>
          <//>` : null}
        <${Section} title=${calendar?.title || "Content calendar"} count=${posts.length || undefined}>
          ${groups.length ? groups.map((g) => html`
            <div key=${g.id} class="p-marketing__group">
              <h3 class="p-marketing__group-title">${g.title}</h3>
              <ul class="p-marketing__rows">
                ${g.rows.map((r, i) => html`<${CalendarRow} key=${r.inboxId || `${r.planned}-${i}`} row=${r} inbox=${inbox.data} onDone=${onDone} />`)}
              </ul>
            </div>`)
            : filtered
              ? html`<${Empty} title=${MARKETING_WORDS.noMatch}><a href="#/dashboards/marketing">${MARKETING_WORDS.allPosts}</a><//>`
              : html`<${Empty} title=${calendar?.emptyText || "No drafts yet."} />`}
        <//>
        <${Concepts} section=${sections.find((x) => x.id === "concepts")} />
        <${Carousels} slides=${slides} current=${current} onOpen=${openSet} />
        <${Recipes} section=${sections.find((x) => x.id === "recipes")} />
        ${problems?.rows?.length ? html`
          <${Section} title=${problems.title || "Files that could not be used"}>
            <${DataTable} columns=${problems.columns} rows=${problems.rows} />
          <//>` : null}
        ${d.inFlight?.length ? html`
          <${Section} title="In progress" count=${d.inFlight.length}>
            <ul class="p-dashboard-flight">
              ${d.inFlight.map((g) => html`<li key=${g.goalId}><a href=${`#/tasks/${encodeURIComponent(g.goalId)}`}>${g.title}</a> <span class="p-dashboard-state">${g.plainState}</span></li>`)}
            </ul>
          <//>` : null}
        <${Jobs} dept="marketing" />
        ${d.switches?.length ? html`
          <${Section} title="Switched off">
            <${Rows}>
              ${d.switches.map((s) => html`<${Row} key=${s.id} icon="power" title=${clip(s.label, 120)} state=${s.on ? "On" : "Off"} say=${clip(s.explain, 300)} />`)}
            <//>
          <//>` : null}
        <${OpenDepartment} dept="marketing" />` : null}
    </div>`;
}
