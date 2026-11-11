// One thing that needs the owner, and the one or two things they can do about it.
// An action is one click. "Add a note" sends a note with whichever action comes next; an action that
// needs a note opens the note field in place; a "danger" action asks once, in place, before it goes.
// The result is said back in plain words, in the card's place.
import { html, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { fullWhen, linkHref, when } from "../lib/format.js";
import { ErrorNotice } from "./notice.js";

const KIND_WORDS = {
  approval: "Needs your approval",
  question: "Question",
  problem: "Problem",
  result: "Finished",
  draft: "Draft",
};

const NOTE_LABELS = {
  send_back: "What should change?",
  answer: "Your answer",
  reopen: "What is still to do?",
};

const LINK_WORDS = {
  goals: "See the goal", books: "See it in Books", customers: "See it in Customers", support: "See it in Support",
  people: "See it in People", marketing: "See it in Marketing", studio: "See it in Studio", knowledge: "See it in Knowledge",
};

function ordered(actions) {
  const rank = { primary: 0, plain: 1, danger: 2 };
  return [...(actions || [])].sort((a, b) => (rank[a.style] ?? 1) - (rank[b.style] ?? 1));
}

function btnClass(style) {
  if (style === "primary") return "btn btn--primary";
  if (style === "danger") return "btn btn--danger";
  return "btn";
}

// The buttons and the note field for one inbox item. Used by the inbox and by department tables.
// onDone(message) is called once the server has said what happened.
export function ItemActions({ item, onDone, compact = false }) {
  const { announce, refreshState } = useApp();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteFor, setNoteFor] = useState(null); // the action that needs the note
  const [confirm, setConfirm] = useState(null); // the danger action waiting for "yes"
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const base = `act-${String(item.id).replace(/[^A-Za-z0-9_-]/g, "-")}`;

  async function run(action) {
    const text = note.trim();
    if (action.needsNote && !text) {
      setNoteFor(action);
      setNoteOpen(true);
      setTimeout(() => document.getElementById(`${base}-note`)?.focus(), 0);
      return;
    }
    setBusy(action.id);
    setError(null);
    try {
      const out = await api.post("/api/inbox/act", { id: item.id, action: action.id, ...(text ? { note: text } : {}) });
      const message = out.message || "Done.";
      announce(message);
      refreshState();
      onDone(message);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  function click(action) {
    setError(null);
    if (action.style === "danger" && confirm?.id !== action.id) {
      setConfirm(action);
      return;
    }
    setConfirm(null);
    run(action);
  }

  function cancelNote() {
    setNoteOpen(false);
    setNoteFor(null);
    setNote("");
  }

  const actions = ordered(item.actions);
  const disabled = !!busy;

  if (confirm) {
    return html`
      <div class="item-actions item-actions--confirm" role="group" aria-label="Are you sure?">
        <p class="confirm-text">${confirm.label} “${item.title}”? This cannot be taken back.</p>
        <div class="row-actions">
          <button type="button" class="btn btn--danger" onClick=${() => click(confirm)} disabled=${disabled}>
            ${busy ? "Working…" : `Yes, ${confirm.label.toLowerCase()}`}
          </button>
          <button type="button" class="btn btn--quiet" onClick=${() => setConfirm(null)} disabled=${disabled}>Cancel</button>
        </div>
        <${ErrorNotice} error=${error} />
      </div>`;
  }

  if (noteFor) {
    const label = NOTE_LABELS[noteFor.id] || "Your note";
    return html`
      <form class="item-actions item-actions--note" onSubmit=${(e) => { e.preventDefault(); run(noteFor); }}>
        <label for=${`${base}-note`}>${label}</label>
        <textarea id=${`${base}-note`} rows="3" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} disabled=${disabled}></textarea>
        <div class="row-actions">
          <button type="submit" class="btn btn--primary" disabled=${disabled || !note.trim()}>${busy ? "Sending…" : "Send"}</button>
          <button type="button" class="btn btn--quiet" onClick=${cancelNote} disabled=${disabled}>Cancel</button>
        </div>
        <${ErrorNotice} error=${error} />
      </form>`;
  }

  return html`
    <div class=${`item-actions${compact ? " item-actions--compact" : ""}`}>
      <div class="row-actions">
        ${actions.map((a) => html`
          <button type="button" class=${btnClass(a.style)} onClick=${() => click(a)} disabled=${disabled}>
            ${busy === a.id ? "Working…" : a.label}
          </button>`)}
        ${!noteOpen && !compact && actions.some((a) => !a.needsNote) ? html`
          <button type="button" class="btn btn--quiet" onClick=${() => { setNoteOpen(true); setTimeout(() => document.getElementById(`${base}-note`)?.focus(), 0); }}
            disabled=${disabled}>Add a note</button>` : null}
      </div>
      ${noteOpen ? html`
        <div class="optional-note">
          <label for=${`${base}-note`}>Note <span class="muted">(optional, sent with your choice)</span></label>
          <textarea id=${`${base}-note`} rows="2" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} disabled=${disabled}></textarea>
          <button type="button" class="btn btn--quiet btn--small" onClick=${cancelNote} disabled=${disabled}>Remove note</button>
        </div>` : null}
      <${ErrorNotice} error=${error} />
    </div>`;
}

// The line that takes a card's place once it is handled.
export function DoneLine({ message }) {
  return html`<p class="done-line"><span class="done-mark" aria-hidden="true"></span>${message}</p>`;
}

export function InboxCard({ item, done, onDone }) {
  const titleId = `item-${String(item.id).replace(/[^A-Za-z0-9_-]/g, "-")}`;
  if (done) {
    return html`<li class="card card--done">${html`<${DoneLine} message=${done} />`}</li>`;
  }
  const high = item.severity === "high";
  const href = linkHref(item.link);
  const details = Array.isArray(item.details) ? item.details.filter((d) => d && d.label && d.value) : [];
  return html`
    <li class=${`card${high ? " card--high" : ""}`}>
      <article class="item" aria-labelledby=${titleId}>
        <div class="item-text">
          <p class="item-meta">
            <span class=${`tag${high ? " tag--high" : ""}`}>${high ? "Urgent" : KIND_WORDS[item.kind] || "For you"}</span>
            ${high && KIND_WORDS[item.kind] ? html`<span class="tag">${KIND_WORDS[item.kind]}</span>` : null}
            <span class="item-who">${item.raisedBy || "The engine"}</span>
            ${item.when ? html`<span aria-hidden="true">·</span><time datetime=${item.when} title=${fullWhen(item.when)}>${when(item.when)}</time>` : null}
          </p>
          <h2 class="item-title" id=${titleId}>${item.title}</h2>
          ${item.summary ? html`<p class="item-summary">${item.summary}</p>` : null}
          ${details.length ? html`
            <dl class="details">
              ${details.map((d) => html`<div class="detail"><dt>${d.label}</dt><dd>${d.value}</dd></div>`)}
            </dl>` : null}
          ${href ? html`<p class="item-link"><a href=${href}>${LINK_WORDS[item.link.page] || "Open"}</a></p>` : null}
        </div>
        <${ItemActions} item=${item} onDone=${onDone} />
      </article>
    </li>`;
}
