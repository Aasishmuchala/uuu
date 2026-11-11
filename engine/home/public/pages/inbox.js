// The inbox: the goal box, then everything waiting for the owner, as a short list of decisions.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { count } from "../lib/format.js";
import { GoalBox } from "../components/goal-box.js";
import { InboxCard } from "../components/inbox-item.js";
import { ErrorNotice, Loading, Notice } from "../components/notice.js";
import { PageHeader } from "../components/page.js";

const SOURCE_WORDS = {
  board: "Agents' work",
  goal: "Finished goals",
  books: "Books",
  people: "People",
  support: "Support",
  marketing: "Marketing",
};

function working(n) {
  if (!n) return "No agent is working right now.";
  return `${count(n, "agent")} ${n === 1 ? "is" : "are"} working.`;
}

// Items handled here stay as one plain line in their place until the page is left.
function withHandled(items, handled) {
  const list = items.filter((i) => !handled[i.id]).map((item) => ({ item }));
  const lines = Object.values(handled).sort((a, b) => a.index - b.index);
  for (const h of lines) list.splice(Math.min(h.index, list.length), 0, { item: h.item, done: h.message });
  return list;
}

export function InboxPage() {
  const { state } = useApp();
  const inbox = useResource("/api/inbox", { every: 10000 });
  const [handled, setHandled] = useState({});

  const items = inbox.data?.items || [];
  const waiting = items.filter((i) => !handled[i.id]).length;
  const rows = withHandled(items, handled);
  const notConnected = inbox.data?.notConnected || [];

  const markDone = (item, index) => (message) => {
    setHandled((h) => ({ ...h, [item.id]: { item, index, message } }));
    inbox.refresh();
  };

  let lead = null;
  if (inbox.data) lead = waiting ? `${count(waiting, "thing needs", "things need")} you.` : null;

  return html`
    <${PageHeader} title="Inbox" lead=${lead} />
    <section class="panel goal-panel" aria-label="Give a goal">
      <${GoalBox} id="goal-box" />
    </section>

    <section class="inbox" aria-labelledby="page-title">
      ${inbox.loading && !inbox.data ? html`<div class="card"><${Loading} lines=${3} label="Loading the inbox" /></div>` : null}
      <${ErrorNotice} error=${inbox.error} onRetry=${inbox.reload} />
      ${inbox.data && rows.length ? html`
        <ul class="cards">
          ${rows.map((r, i) => html`<${InboxCard} key=${r.item.id} item=${r.item} done=${r.done} onDone=${markDone(r.item, i)} />`)}
        </ul>` : null}
      ${inbox.data && !waiting ? html`
        <div class=${`empty${rows.length ? " empty--after" : ""}`}>
          <p class="empty-title">${rows.length ? "That is everything for now." : "Nothing needs you right now."}</p>
          <p class="muted">${working(state?.counts?.agentsWorking || 0)}${" "}
            <a href="#/company">See the company</a>${state?.counts?.goalsActive ? html` or <a href="#/goals">the goals in progress</a>` : null}.</p>
        </div>` : null}
      ${notConnected.length ? html`
        <${Notice} title="Some parts could not be checked">
          <ul class="plain-list">
            ${notConnected.map((n) => html`<li key=${n.source}><strong>${SOURCE_WORDS[n.source] || "A part"}:</strong> ${n.reason}</li>`)}
          </ul>
          <p class="notice-next">Anything from these parts will show here once they answer. <a href="#/health">See Health</a>.</p>
        <//>` : null}
    </section>`;
}
