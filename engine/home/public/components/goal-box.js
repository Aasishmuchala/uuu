// "What do you want done?" Giving a goal should feel like sending a message:
// write it, press "Give goal" (or Ctrl/Cmd + Enter), and it is said back in plain words.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { ErrorNotice } from "./notice.js";

const MAX = 4000;

export function GoalBox({ onClose, focusKey = 0, id = "goal-box" }) {
  const { announce, refreshState } = useApp();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [given, setGiven] = useState(null);
  const area = useRef(null);

  useEffect(() => {
    if (focusKey && area.current) area.current.focus();
  }, [focusKey]);

  async function send(e) {
    if (e) e.preventDefault();
    const t = text.trim();
    if (!t) {
      setError({ message: "There is nothing written yet.", next: "Write what you want done, in your own words." });
      area.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    try {
      const out = await api.post("/api/goals", { text: t });
      setGiven(out.goal || {});
      setText("");
      announce("Given to the Chief of staff.");
      refreshState();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
  }

  if (given) {
    return html`
      <div class="goal-box goal-box--given" id=${id}>
        <p class="goal-given" role="status">
          <span class="goal-given-title">Given to the Chief of staff.</span>
          ${given.title ? html` <span class="goal-given-what">“${given.title}”</span>` : null}
        </p>
        <div class="row-actions">
          ${given.id ? html`<a class="btn" href=${`#/goals/${encodeURIComponent(given.id)}`}>See the goal</a>` : null}
          <button type="button" class="btn btn--quiet" onClick=${() => { setGiven(null); setTimeout(() => area.current?.focus(), 0); }}>Give another</button>
          ${onClose ? html`<button type="button" class="btn btn--quiet" onClick=${onClose}>Close</button>` : null}
        </div>
      </div>`;
  }

  const over = text.length > MAX;
  return html`
    <form class="goal-box" id=${id} onSubmit=${send} novalidate>
      <label class="goal-label" for=${`${id}-text`}>What do you want done?</label>
      <p class="hint" id=${`${id}-hint`}>Say it in your own words. The Chief of staff will take it from here.</p>
      <textarea
        id=${`${id}-text`}
        ref=${area}
        rows="3"
        value=${text}
        aria-describedby=${`${id}-hint`}
        aria-invalid=${over ? "true" : null}
        onInput=${(e) => setText(e.currentTarget.value)}
        onKeyDown=${onKey}
        disabled=${sending}
      ></textarea>
      ${over ? html`<p class="field-error">That is too long. Keep it under ${MAX} characters.</p>` : null}
      <${ErrorNotice} error=${error} />
      <div class="row-actions">
        <button type="submit" class="btn btn--primary" disabled=${sending || over}>${sending ? "Giving…" : "Give goal"}</button>
        ${onClose ? html`<button type="button" class="btn btn--quiet" onClick=${onClose}>Cancel</button>` : null}
      </div>
    </form>`;
}
