// The one approval component (CONTRACTS-V2 13.2): a warm card that shows exactly what is being approved,
// one primary action, "Send back" with a note in place, and the rest in a menu. It calls only POST /api/inbox/act.
import { html, useCallback, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { when, fullWhen } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Menu } from "./overlays.js";
import { Mono } from "./text.js";

// Pure. The first action with style "primary" (else the first action) is the primary one; of the others, those
// that need a note are shown as quiet buttons that open the note field, and the rest go in the menu.
export function splitActions(actions) {
  const list = Array.isArray(actions) ? actions.filter((a) => a && a.id) : [];
  const primary = list.find((a) => a.style === "primary") || list[0] || null;
  const others = list.filter((a) => a !== primary);
  return {
    primary,
    withNote: others.filter((a) => a.needsNote),
    rest: others.filter((a) => !a.needsNote),
  };
}

// { act(id, action, note), busy, error }. `act` resolves to the server's answer or null when it failed.
export function useInboxAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = useCallback(async (id, action, note) => {
    setBusy(true);
    setError(null);
    try {
      const body = { id, action };
      if (note) body.note = note;
      const res = await api.post("/api/inbox/act", body);
      setBusy(false);
      return res;
    } catch (e) {
      setError(e);
      setBusy(false);
      return null;
    }
  }, []);
  return { act, busy, error };
}

const text = (v) => (v === null || v === undefined ? "" : String(v));

// What a card becomes after its action: one plain line with the server's message.
export function DecisionDone({ message }) {
  return html`<div class="k-decision k-decision--done" role="status">
    <${Icon} name="check" /><span class="k-decision__done-text">${text(message)}</span>
  </div>`;
}

export function DecisionCard({ item, onDone, compact = false }) {
  const { act, busy, error } = useInboxAct();
  const [noteFor, setNoteFor] = useState(null); // the action whose note field is open
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(null); // a danger action asking once
  const [done, setDone] = useState(null); // the server's message after success
  const noteRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (noteFor && noteRef.current) noteRef.current.focus();
  }, [noteFor]);

  if (!item) return null;
  if (done !== null) return html`<${DecisionDone} message=${done} />`;

  const { primary, withNote, rest } = splitActions(item.actions);

  const run = async (action, noteText) => {
    const res = await act(item.id, action.id, noteText);
    if (!res) return;
    const message = text(res.message) || "Done.";
    setNoteFor(null);
    setConfirm(null);
    setNote("");
    setDone(message);
    if (onDone) onDone({ item, action: action.id, message });
  };

  const choose = (action, ev) => {
    if (busy) return;
    if (action.needsNote) {
      openerRef.current = ev && ev.currentTarget ? ev.currentTarget : null;
      setConfirm(null);
      setNoteFor(action);
      return;
    }
    if (action.style === "danger") {
      setNoteFor(null);
      setConfirm(action);
      return;
    }
    run(action);
  };

  const cancelNote = () => {
    setNoteFor(null);
    setNote("");
    const opener = openerRef.current;
    if (opener && opener.isConnected) opener.focus();
  };

  const onNoteKey = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      cancelNote();
    } else if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && note.trim()) {
      ev.preventDefault();
      run(noteFor, note.trim());
    }
  };

  const agent = item.agent || (item.raisedBy ? { slug: "", name: item.raisedBy } : null);
  const context = [text(item.raisedBy), when(item.when)].filter(Boolean);
  const details = Array.isArray(item.details) ? item.details : [];
  const high = item.severity === "high";

  const actions = html`<div class="k-decision__actions">
    ${primary && html`<${Button} variant="primary" busy=${busy && !noteFor && !confirm}
      disabled=${busy} onClick=${(ev) => choose(primary, ev)}>${text(primary.label)}<//>`}
    ${withNote.map((a) => html`<${Button} variant="quiet" disabled=${busy}
      onClick=${(ev) => choose(a, ev)}>${text(a.label)}<//>`)}
    ${rest.length > 0 && html`<${Menu} label="More actions" icon="chevron-down"
      items=${rest.map((a) => ({ id: a.id, label: text(a.label), danger: a.style === "danger", onSelect: () => choose(a) }))} />`}
  </div>`;

  return html`<article class=${`k-decision${compact ? " k-decision--compact" : ""}${high ? " k-decision--high" : ""}`}
      aria-label=${text(item.title)}>
    ${!compact && agent && html`<div class="k-decision__avatar"><${Avatar} slug=${agent.slug} name=${agent.name} size=${32} /></div>`}
    <div class="k-decision__body">
      <h3 class="k-decision__title">${high && html`<span class="k-decision__flag"><${Icon} name="alert" /><span>Urgent</span></span>`}${text(item.title)}</h3>
      <p class="k-decision__context">
        ${context.map((c, i) => html`${i > 0 && html`<span aria-hidden="true"> · </span>`}<span title=${i === 1 ? fullWhen(item.when) : undefined}>${c}</span>`)}
        ${item.identifier && html`${context.length > 0 && html`<span aria-hidden="true"> · </span>`}<${Mono}>${text(item.identifier)}<//>`}
      </p>
      ${!compact && item.summary && html`<p class="k-decision__summary">${text(item.summary)}</p>`}
      ${details.length > 0 && html`<dl class="k-decision__details">
        ${details.map((d) => html`<div class="k-decision__detail"><dt>${text(d && d.label)}</dt><dd>${text(d && d.value)}</dd></div>`)}
      </dl>`}
      ${noteFor && html`<div class="k-decision__note">
        <label class="k-decision__note-label" for=${`k-note-${item.id}`}>${text(noteFor.label)}: say what should change</label>
        <textarea id=${`k-note-${item.id}`} ref=${noteRef} class="k-textarea k-decision__note-field" rows="3"
          value=${note} onInput=${(e) => setNote(e.currentTarget.value)} onKeyDown=${onNoteKey}
          placeholder="Write a short note. Esc cancels."></textarea>
        <div class="k-decision__note-actions">
          <${Button} variant="primary" icon="send" busy=${busy} disabled=${busy || !note.trim()}
            onClick=${() => run(noteFor, note.trim())}>Send<//>
          <${Button} variant="quiet" disabled=${busy} onClick=${cancelNote}>Cancel<//>
        </div>
      </div>`}
      ${confirm && html`<div class="k-decision__confirm" role="group" aria-label="Confirm">
        <span>${text(confirm.label)}? This cannot be undone here.</span>
        <${Button} variant="danger" busy=${busy} disabled=${busy} onClick=${() => run(confirm)}>${`Yes, ${text(confirm.label).toLowerCase()}`}<//>
        <${Button} variant="quiet" disabled=${busy} onClick=${() => setConfirm(null)}>Cancel<//>
      </div>`}
      ${error && html`<p class="k-decision__error" role="alert"><${Icon} name="alert" /><span>${text(error.message)}${error.next ? ` ${text(error.next)}` : ""}</span></p>`}
    </div>
    ${!noteFor && !confirm && actions}
  </article>`;
}
