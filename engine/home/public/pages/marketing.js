// Marketing page (CONTRACTS 9.6, 9.8): the content calendar grouped by week, each draft opening in place
// with its text and the inbox decision, files that could not be used, and the ready-made goals strip.
// Publishing is off and nothing here can turn it on.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  AgentChip, Card, Chip, DataTable, DecisionCard, Empty, ErrorNotice, Figures, Loading, Notice, PageHeader, Section, Switch, Tag,
} from "../kit/index.js";

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

const STATUS_TONE = { "Waiting for you": "warn", Approved: "ok", "Sent back": "neutral" };

function DraftBody({ id, item, onDone }) {
  const res = useResource(id ? `/api/content/${encodeURIComponent(id)}` : null);
  const draft = res.data?.draft;
  return html`
    <div class="p-marketing__open">
      ${res.loading && !draft ? html`<${Loading} lines=${3} label="Loading the draft" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${draft ? html`
        <p class="p-marketing__text">${String(draft.body ?? "").slice(0, 8000)}</p>
        ${draft.note ? html`<p class="p-marketing__note">Your note: ${String(draft.note).slice(0, 500)}</p>` : null}` : null}
      ${item ? html`<${DecisionCard} item=${item} compact onDone=${onDone} />` : null}
    </div>`;
}

function CalendarRow({ row, inbox, onDone }) {
  const [open, setOpen] = useState(false);
  const id = draftIdOf(row);
  const item = itemFor(row, inbox);
  const panel = `p-marketing-row-${id || "none"}`;
  return html`
    <li class="p-marketing__row">
      <button type="button" class="p-marketing__head" aria-expanded=${open ? "true" : "false"} aria-controls=${panel} onClick=${() => setOpen(!open)}>
        <span class="p-marketing__date">${row.planned || "No date"}</span>
        <span class="p-marketing__title">${row.title || "Untitled"}</span>
        <span class="p-marketing__meta"><${Chip}>${row.kind || "Draft"}<//></span>
        <${Tag} tone=${STATUS_TONE[row.status] || "neutral"}>${row.status || ""}<//>
      </button>
      ${open ? html`
        <div id=${panel}>
          ${id ? html`<${DraftBody} id=${id} item=${item} onDone=${onDone} />`
            : html`<p class="p-marketing__note">Only drafts still waiting for you can be opened here.</p>`}
        </div>` : null}
    </li>`;
}

function Strip({ department, openComposer }) {
  const goals = (department?.goals || []).slice(0, 3);
  if (!goals.length) return null;
  return html`
    <${Section} title="Ready-made goals" aside=${html`<a href="#/gallery?d=marketing">All ready-made goals</a>`}>
      <div class="p-marketing__strip">
        ${goals.map((g) => html`
          <${Card} key=${g.id} onClick=${() => openComposer({ text: g.text, to: g.to, planFirst: !!g.planFirst, template: g.id })}>
            <p class="p-marketing__goal-title">${g.title}</p>
            <p class="p-marketing__goal-text">${g.summary}</p>
          <//>`)}
      </div>
    <//>`;
}

export default function Page({ route }) {
  const { openComposer } = useApp();
  const res = useResource("/api/departments/marketing", { every: 10000 });
  const inbox = useResource("/api/inbox", { every: 10000 });
  const gallery = useResource("/api/gallery");
  const d = res.data;
  const sections = d?.sections || [];
  const calendar = sections.find((s) => s.id === "calendar");
  const problems = sections.find((s) => s.id === "problems");
  const onDone = () => { res.refresh(); inbox.refresh(); };
  const groups = groupByWeek(calendar?.rows || [], new Date()).filter((g) => g.rows.length);
  const strip = (gallery.data?.departments || []).find((x) => x.id === "marketing");
  const publishing = (d?.switches || []).find((s) => s.id === "publishing");
  return html`
    <div class="p-marketing">
      <${PageHeader} title="Marketing" lead="Posts and newsletters drafted by the Marketer.">
        ${d?.agent ? html`<${AgentChip} agent=${{ slug: "marketer", name: d.agent.name, state: d.agent.state, plainState: d.agent.plainState }} />` : null}
      <//>
      ${res.loading && !d ? html`<${Loading} lines=${4} label="Loading Marketing" />` : null}
      <${ErrorNotice} error=${res.error} onRetry=${res.reload} />
      <${Notice} tone="info" title="Publishing is off.">${publishing?.explain || "Connect an account to turn this on."}<//>
      ${d ? html`
        <${Figures} figures=${d.figures} />
        <${Section} title=${calendar?.title || "Content calendar"}>
          ${groups.length ? groups.map((g) => html`
            <div key=${g.id} class="p-marketing__group">
              <h3 class="p-marketing__group-title">${g.title}</h3>
              <ul class="p-marketing__rows">
                ${g.rows.map((r, i) => html`<${CalendarRow} key=${r.inboxId || `${r.planned}-${i}`} row=${r} inbox=${inbox.data} onDone=${onDone} />`)}
              </ul>
            </div>`)
            : html`<${Empty} title=${calendar?.emptyText || "No drafts yet."} />`}
        <//>
        ${problems?.rows?.length ? html`
          <${Section} title=${problems.title || "Files that could not be used"}>
            <${DataTable} columns=${problems.columns} rows=${problems.rows} />
          <//>` : null}
        ${d.inFlight?.length ? html`
          <${Section} title="In progress">
            <ul class="p-marketing__rows">
              ${d.inFlight.map((g) => html`<li key=${g.goalId}><a href=${`#/tasks/${encodeURIComponent(g.goalId)}`}>${g.title}</a> <${Chip}>${g.plainState}<//></li>`)}
            </ul>
          <//>` : null}
        <${Strip} department=${strip} openComposer=${openComposer} />
        ${d.switches?.length ? html`
          <${Section} title="Switched off">
            ${d.switches.map((s) => html`<${Switch} key=${s.id} on=${!!s.on} disabled label=${s.label} explain=${s.explain} />`)}
          <//>` : null}` : null}
    </div>`;
}
