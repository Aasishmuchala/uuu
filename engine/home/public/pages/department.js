// Any department page (CONTRACTS 9.6): figures, sections as simple tables (stacked rows on a narrow
// window), drafts with the inbox actions in place, what the department's agent is doing, off switches.
import { html, useState } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { ErrorNotice, Loading, Notice, NotConnected, StateWord } from "../components/notice.js";
import { DoneLine, ItemActions } from "../components/inbox-item.js";
import { PageHeader, Section } from "../components/page.js";

const TITLES = {
  books: "Books", customers: "Customers", support: "Support", people: "People", marketing: "Marketing", studio: "Studio",
};
const LEADS = {
  books: "What you are owed, what you owe, and drafts waiting for you.",
  customers: "Leads and deals, by stage.",
  support: "Open requests, how long each has waited, and replies to approve.",
  people: "Staff, leave and attendance.",
  marketing: "Posts and newsletters drafted by the Marketer.",
  studio: "Files and CAD parts made by agents.",
};
const AGENT_TONES = { free: "good", working: "active", paused: "wait", problem: "bad", waiting_for_you: "warn" };

function Figures({ figures }) {
  if (!figures?.length) return null;
  return html`
    <dl class=${`figures${figures.length % 2 === 0 ? " figures--pairs" : ""}`}>
      ${figures.map((f) => html`
        <div key=${f.id} class="figure">
          <dt>${f.label}</dt>
          <dd class="figure-value">${f.value}</dd>
          ${f.hint ? html`<dd class="figure-hint">${f.hint}</dd>` : null}
        </div>`)}
    </dl>`;
}

function Table({ section, inboxItems, handled, onHandled }) {
  const cols = section.columns || [];
  const rows = section.rows || [];
  const hasActions = rows.some((r) => r.inboxId);
  const hasFiles = rows.some((r) => r.fileUrl);
  return html`
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            ${cols.map((c) => html`<th key=${c.key} scope="col">${c.label}</th>`)}
            ${hasFiles ? html`<th scope="col"><span class="visually-hidden">File</span></th>` : null}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => {
            const item = r.inboxId ? inboxItems.find((it) => it.id === r.inboxId) : null;
            return html`
              <tr key=${r.inboxId || i} class=${hasActions && r.inboxId ? "has-actions" : null}>
                ${cols.map((c, ci) => html`
                  <td key=${c.key} data-label=${c.label} class=${[ci === 0 ? "cell-first" : "", String(r[c.key] ?? "").length > 32 ? "cell-long" : ""].join(" ").trim() || null}>${r[c.key] == null || r[c.key] === "" ? "—" : String(r[c.key])}</td>`)}
                ${hasFiles ? html`<td data-label="File">${r.fileUrl ? html`<a href=${r.fileUrl} download>Download</a>` : null}</td>` : null}
              </tr>
              ${hasActions && r.inboxId ? html`
                <tr key=${`${r.inboxId}-actions`} class="actions-row">
                  <td colspan=${cols.length + (hasFiles ? 1 : 0)} class="cell-actions">
                    ${handled[r.inboxId] ? html`<${DoneLine} message=${handled[r.inboxId]} />`
                      : item ? html`<${ItemActions} item=${item} compact onDone=${(m) => onHandled(r.inboxId, m)} />`
                      : html`<span class="muted small">Already handled.</span>`}
                  </td>
                </tr>` : null}`;
          })}
        </tbody>
      </table>
    </div>`;
}

export function DepartmentPage({ id }) {
  const res = useResource(`/api/departments/${encodeURIComponent(id)}`, { every: 10000 });
  const d = res.data;
  const needsInbox = !!d?.sections?.some((s) => (s.rows || []).some((r) => r.inboxId));
  const inbox = useResource(needsInbox ? "/api/inbox" : null, { every: 10000 });
  const [handled, setHandled] = useState({});
  const title = d?.title || TITLES[id] || "Department";
  const notReady = res.error && res.error.status === 404;

  const onHandled = (inboxId, message) => {
    setHandled((h) => ({ ...h, [inboxId]: message }));
    res.refresh();
    inbox.refresh();
  };

  const agent = d?.agent;
  return html`
    <${PageHeader} title=${title} lead=${LEADS[id]}>
      ${agent ? html`<span class="agent-chip"><span class="muted">${agent.name}:</span> <${StateWord} tone=${AGENT_TONES[agent.state]}>${agent.plainState}<//></span>` : null}
    <//>
    ${res.loading && !d ? html`<div class="card"><${Loading} lines=${4} label=${`Loading ${title}`} /></div>` : null}
    ${notReady ? html`
      <${Notice} title="This page is not ready yet">
        <p>Its figures arrive with the next update of the engine. Until then, anything that needs you still shows in the <a href="#/inbox">inbox</a>.</p>
      <//>` : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
    ${d && !d.connected ? html`<${NotConnected} reason=${d.notConnected?.reason} next=${d.notConnected?.next} />` : null}
    ${d ? html`
      <${Figures} figures=${d.figures} />
      ${(d.sections || []).filter((s) => d.connected || (s.rows || []).length).map((s) => html`
        <${Section} key=${s.id} title=${s.title} id=${`section-${s.id}`}>
          ${(s.rows || []).length
            ? html`<${Table} section=${s} inboxItems=${inbox.data?.items || []} handled=${handled} onHandled=${onHandled} />`
            : html`<p class="muted">${s.emptyText || "Nothing here yet."}</p>`}
        <//>`)}
      ${d.inFlight?.length ? html`
        <${Section} title="Being worked on" id="in-flight">
          <ul class="rows">
            ${d.inFlight.map((g) => html`
              <li key=${g.goalId} class="row">
                <div class="row-main"><a class="row-title" href=${`#/goals/${encodeURIComponent(g.goalId)}`}>${g.title}</a></div>
                <div class="row-side"><${StateWord} tone="active">${g.plainState}<//></div>
              </li>`)}
          </ul>
        <//>` : null}
      ${d.switches?.length ? html`
        <${Section} title="Switched off" id="switches">
          <ul class="rows">
            ${d.switches.map((s) => html`
              <li key=${s.id} class="row">
                <div class="row-main">
                  <p class="row-title-text">${s.label}</p>
                  <p class="row-sub">${s.explain}</p>
                </div>
                <div class="row-side"><${StateWord} tone="wait">${s.on ? "On" : "Off"}<//></div>
              </li>`)}
          </ul>
        <//>` : null}` : null}`;
}
