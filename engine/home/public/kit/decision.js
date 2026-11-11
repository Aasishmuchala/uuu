// The one approval component (CONTRACTS-V2 13.2): a warm card that shows exactly what is being approved,
// one primary action, "Send back" with a note in place, and the rest in a menu. It acts only through
// POST /api/inbox/act, sending the version of the item the owner saw (CONTRACTS 9.3a). When the server answers
// that the item changed since, the card says so, reads the item again and shows it; it never retries by itself.
import { html, useCallback, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { when, fullWhen } from "../lib/format.js";
import { Avatar } from "./avatar.js";
import { Button } from "./button.js";
import { Icon } from "./icon.js";
import { Menu } from "./overlays.js";
import { Mono } from "./text.js";

// ---- Versions (CONTRACTS 9.3a): an action is tied to the version of the item the owner saw. ----
export const CHANGED_SINCE_SEEN = "changed_since_seen";

// What the owner reads when the item changed after they looked at it. The server's own words win when it sends them.
export const CHANGED_TEXT = {
  message: "This changed after you looked at it. Nothing was done.",
  next: "Look at it again, then decide.",
};

// The body of POST /api/inbox/act. `version` is the item's version as the owner saw it; it is sent whenever the
// item has one, so the server can refuse an action on something that changed since.
export function actBody(id, action, note, version) {
  const body = { id, action };
  if (note) body.note = note;
  if (typeof version === "string" ? version !== "" : version !== undefined && version !== null) body.version = version;
  return body;
}

// True when the server refused because the item changed after the owner saw it (409 changed_since_seen).
export function isChangedSinceSeen(error) {
  return Boolean(error && error.code === CHANGED_SINCE_SEEN);
}

// The plain words for that refusal: the server's message and next step, else ours.
export function changedText(error) {
  return {
    message: (error && error.message) || CHANGED_TEXT.message,
    next: (error && error.next) || CHANGED_TEXT.next,
  };
}

// Reads the item again, as it is now: the item, or null when it is no longer waiting for the owner.
export async function reloadInboxItem(id) {
  const data = await api.get("/api/inbox");
  const items = data && Array.isArray(data.items) ? data.items : [];
  return items.find((it) => it && it.id === id) || null;
}

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

// { act(id, action, note, version), busy, error, changed }. `act` resolves to the server's answer or null when
// it failed. The first argument may also be the item itself ({ id, version }); then its version goes with it.
// Pass the version of what the owner saw whenever the item has one. `changed` is true when the server refused
// because the item changed after the owner looked (409 changed_since_seen); `error` then has its plain words.
export function useInboxAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const act = useCallback(async (target, action, note, version) => {
    const item = target && typeof target === "object" ? target : null;
    const id = item ? item.id : target;
    const v = version !== undefined ? version : item ? item.version : undefined;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/api/inbox/act", actBody(id, action, note, v));
      setBusy(false);
      return res;
    } catch (e) {
      setError(e);
      setBusy(false);
      return null;
    }
  }, []);
  return { act, busy, error, changed: isChangedSinceSeen(error) };
}

const text = (v) => (v === null || v === undefined ? "" : String(v));

// What a card becomes after its action: one plain line with the server's message.
export function DecisionDone({ message }) {
  return html`<div class="k-decision k-decision--done" role="status">
    <${Icon} name="check" /><span class="k-decision__done-text">${text(message)}</span>
  </div>`;
}

// When the server says the item changed after the owner looked: its plain words and next step, and what the card
// found when it read the item again. `fresh` is the item as it is now, `gone` when it no longer waits for the owner.
function Changed({ error, reloading, gone }) {
  const t = changedText(error);
  return html`<div class="k-decision__changed" role="alert">
    <${Icon} name="alert" />
    <div class="k-decision__changed-text">
      <p class="k-decision__changed-title">${text(t.message)}</p>
      <p class="k-decision__changed-next">${reloading ? "Reading it again…" : gone ? "It is no longer waiting for you." : text(t.next)}</p>
    </div>
  </div>`;
}

export function DecisionCard({ item, onDone, compact = false }) {
  const { act, busy, error, changed } = useInboxAct();
  const [noteFor, setNoteFor] = useState(null); // the action whose note field is open
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(null); // a danger action asking once
  const [done, setDone] = useState(null); // the server's message after success
  const [fresh, setFresh] = useState(null); // the item as read again after "changed since you looked"
  const [reloading, setReloading] = useState(false);
  const [gone, setGone] = useState(false);
  const noteRef = useRef(null);
  const confirmRef = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => {
    if (noteFor && noteRef.current) noteRef.current.focus();
  }, [noteFor]);
  useEffect(() => {
    if (confirm && confirmRef.current) confirmRef.current.focus();
  }, [confirm]);
  // A newer item from the page replaces what the card read again itself.
  const propVersion = item ? item.version : undefined;
  useEffect(() => {
    setFresh(null);
    setGone(false);
  }, [propVersion]);

  const itemId = item ? item.id : null;
  // After "changed since you looked": close the confirm (the note stays, so nothing typed is lost) and read the
  // item again, so the owner sees the new version before deciding. Nothing is sent again.
  useEffect(() => {
    if (!changed || !itemId) return undefined;
    let live = true;
    setConfirm(null);
    setReloading(true);
    reloadInboxItem(itemId)
      .then((now) => {
        if (!live) return;
        if (now) setFresh(now);
        else setGone(true);
      })
      .catch(() => {})
      .finally(() => { if (live) setReloading(false); });
    return () => { live = false; };
  }, [changed, error]);

  if (!item) return null;
  if (done !== null) return html`<${DecisionDone} message=${done} />`;

  // What the owner sees is what is approved: the item as read again after a change, else the one given.
  const shown = fresh && fresh.id === item.id ? fresh : item;
  const { primary, withNote, rest } = splitActions(shown.actions);

  const restoreFocus = () => {
    const opener = openerRef.current;
    if (opener && opener.isConnected) opener.focus();
  };

  const run = async (action, noteText) => {
    const res = await act(shown.id, action.id, noteText, shown.version);
    if (!res) return;
    const message = text(res.message) || "Done.";
    setNoteFor(null);
    setConfirm(null);
    setNote("");
    setDone(message);
    if (onDone) onDone({ item: shown, action: action.id, message });
  };

  const choose = (action, ev) => {
    if (busy || reloading || gone) return;
    openerRef.current = ev && ev.currentTarget ? ev.currentTarget : null;
    if (action.needsNote) {
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
    restoreFocus();
  };

  const cancelConfirm = () => {
    setConfirm(null);
    restoreFocus();
  };

  // Esc while a note field or a confirm is open cancels it, and nothing is sent.
  const onCardKey = (ev) => {
    if (ev.key !== "Escape" || (!noteFor && !confirm)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (noteFor) cancelNote();
    else cancelConfirm();
  };

  const onNoteKey = (ev) => {
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && note.trim() && !busy && !reloading && !gone) {
      ev.preventDefault();
      run(noteFor, note.trim());
    }
  };

  const agent = shown.agent || (shown.raisedBy ? { slug: "", name: shown.raisedBy } : null);
  const context = [text(shown.raisedBy), when(shown.when)].filter(Boolean);
  const details = Array.isArray(shown.details) ? shown.details : [];
  const high = shown.severity === "high";
  const stopped = busy || reloading || gone;

  const actions = html`<div class="k-decision__actions">
    ${primary && html`<${Button} variant="primary" busy=${busy && !noteFor && !confirm}
      disabled=${stopped} onClick=${(ev) => choose(primary, ev)}>${text(primary.label)}<//>`}
    ${withNote.map((a) => html`<${Button} variant="quiet" disabled=${stopped}
      onClick=${(ev) => choose(a, ev)}>${text(a.label)}<//>`)}
    ${rest.length > 0 && !stopped && html`<${Menu} label="More actions" icon="chevron-down"
      items=${rest.map((a) => ({ id: a.id, label: text(a.label), danger: a.style === "danger", onSelect: () => choose(a) }))} />`}
  </div>`;

  return html`<article class=${`k-decision${compact ? " k-decision--compact" : ""}${high ? " k-decision--high" : ""}`}
      aria-label=${text(shown.title)} onKeyDown=${onCardKey}>
    ${!compact && agent && html`<div class="k-decision__avatar"><${Avatar} slug=${agent.slug} name=${agent.name} size=${32} /></div>`}
    <div class="k-decision__body">
      ${changed && html`<${Changed} error=${error} reloading=${reloading} gone=${gone} />`}
      <h3 class="k-decision__title">${high && html`<span class="k-decision__flag"><${Icon} name="alert" /><span>Urgent</span></span>`}${text(shown.title)}</h3>
      <p class="k-decision__context">
        ${context.map((c, i) => html`${i > 0 && html`<span aria-hidden="true"> · </span>`}<span title=${i === 1 ? fullWhen(shown.when) : undefined}>${c}</span>`)}
        ${shown.identifier && html`${context.length > 0 && html`<span aria-hidden="true"> · </span>`}<${Mono}>${text(shown.identifier)}<//>`}
      </p>
      ${!compact && shown.summary && html`<p class="k-decision__summary">${text(shown.summary)}</p>`}
      ${details.length > 0 && html`<dl class="k-decision__details">
        ${details.map((d) => html`<div class="k-decision__detail"><dt>${text(d && d.label)}</dt><dd>${text(d && d.value)}</dd></div>`)}
      </dl>`}
      ${noteFor && html`<div class="k-decision__note">
        <label class="k-decision__note-label" for=${`k-note-${shown.id}`}>${text(noteFor.label)}: say what should change</label>
        <textarea id=${`k-note-${shown.id}`} ref=${noteRef} class="k-textarea k-decision__note-field" rows="3"
          value=${note} onInput=${(e) => setNote(e.currentTarget.value)} onKeyDown=${onNoteKey}
          placeholder="Write a short note. Esc cancels."></textarea>
        <div class="k-decision__note-actions">
          <${Button} variant="primary" icon="send" busy=${busy} disabled=${stopped || !note.trim()}
            onClick=${() => run(noteFor, note.trim())}>Send<//>
          <${Button} variant="quiet" disabled=${busy} onClick=${cancelNote}>Cancel<//>
        </div>
      </div>`}
      ${confirm && html`<div class="k-decision__confirm" role="group" aria-label="Confirm" tabindex="-1" ref=${confirmRef}>
        <span>${text(confirm.label)}? This cannot be undone here. Esc cancels.</span>
        <${Button} variant="danger" busy=${busy} disabled=${stopped} onClick=${() => run(confirm)}>${`Yes, ${text(confirm.label).toLowerCase()}`}<//>
        <${Button} variant="quiet" disabled=${busy} onClick=${cancelConfirm}>Cancel<//>
      </div>`}
      ${error && !changed && html`<p class="k-decision__error" role="alert"><${Icon} name="alert" /><span>${text(error.message)}${error.next ? ` ${text(error.next)}` : ""}</span></p>`}
    </div>
    ${!noteFor && !confirm && !gone && actions}
  </article>`;
}
