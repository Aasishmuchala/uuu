// One goal: what was asked, the result and the Checker's verdict, the steps and who has each,
// the files, the conversation, a note to the Chief of staff, and "Stop this goal".
import { html, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { bytes, fullWhen, when } from "../lib/format.js";
import { ErrorNotice, Loading, StateWord } from "../components/notice.js";
import { PageHeader, Section } from "../components/page.js";
import { GOAL_TONES, steps as stepsLine } from "./goals.js";

const BACK = { href: "#/goals", label: "All goals" };

function Time({ at, prefix }) {
  if (!at) return null;
  return html`<time datetime=${at} title=${fullWhen(at)}>${prefix ? `${prefix} ` : ""}${when(at)}</time>`;
}

// Comments carry the agents' markers (RESULT:, VERDICT: PASS - ...); show the words after them.
function plainUpdate(text) {
  return String(text || "")
    .replace(/^RESULT:\s*/i, "")
    .replace(/^VERDICT:\s*PASS\s*[-:–]\s*/i, "Checked and passed: ")
    .replace(/^VERDICT:\s*FAIL\s*[-:–]\s*/i, "Checked and failed: ")
    .trim();
}

function Verdict({ verdict }) {
  const pass = verdict.outcome === "pass";
  return html`
    <div class=${`verdict verdict--${pass ? "pass" : "fail"}`}>
      <p class="verdict-word"><${StateWord} tone=${pass ? "good" : "bad"}>${pass ? "Checked: passed" : "Checked: failed"}<//></p>
      ${verdict.reason ? html`<p>${verdict.reason.charAt(0).toUpperCase() + verdict.reason.slice(1)}</p>` : null}
      <p class="small muted">${verdict.by || "The Checker"} · <${Time} at=${verdict.at} /></p>
    </div>`;
}

function NoteForm({ goal, onSent }) {
  const { announce, refreshState } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const restarts = goal.state === "done" || goal.state === "needs_you";

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(goal.id)}/note`, { text: text.trim() });
      setText("");
      announce(restarts ? "Note sent. The goal is started again." : "Note sent to the Chief of staff.");
      refreshState();
      onSent(restarts ? "Note sent. The goal is started again." : "Note sent to the Chief of staff.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="note-form" onSubmit=${send}>
      <label for="goal-note">Add a note for the Chief of staff</label>
      <p class="hint" id="goal-note-hint">${restarts ? "Sending a note starts this goal again." : "It is added to the goal's conversation."}</p>
      <textarea id="goal-note" rows="3" value=${text} aria-describedby="goal-note-hint" disabled=${busy}
        onInput=${(e) => setText(e.currentTarget.value)}></textarea>
      <${ErrorNotice} error=${error} />
      <div class="row-actions">
        <button type="submit" class="btn btn--primary" disabled=${busy || !text.trim()}>${busy ? "Sending…" : "Send note"}</button>
      </div>
    </form>`;
}

function StopGoal({ goal, onStopped }) {
  const { announce, refreshState } = useApp();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(goal.id)}/stop`, {});
      announce("The goal is stopped.");
      refreshState();
      onStopped("The goal is stopped. Agents will not work on it any more.");
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (!asking) {
    return html`<button type="button" class="btn btn--danger" onClick=${() => setAsking(true)}>Stop this goal</button>`;
  }
  return html`
    <div class="item-actions--confirm" role="group" aria-label="Stop this goal?">
      <p class="confirm-text">Stop “${goal.title}”? Agents stop working on it. You can give it again later.</p>
      <div class="row-actions">
        <button type="button" class="btn btn--danger" onClick=${stop} disabled=${busy}>${busy ? "Stopping…" : "Yes, stop it"}</button>
        <button type="button" class="btn btn--quiet" onClick=${() => setAsking(false)} disabled=${busy}>Cancel</button>
      </div>
      <${ErrorNotice} error=${error} />
    </div>`;
}

export function GoalPage({ id }) {
  const res = useResource(`/api/goals/${encodeURIComponent(id)}`, { every: 10000 });
  const [said, setSaid] = useState(null);
  const d = res.data;

  if (!d) {
    return html`
      <${PageHeader} title="Goal" back=${BACK} />
      ${res.loading ? html`<div class="card"><${Loading} lines=${5} label="Loading the goal" /></div>` : null}
      <${ErrorNotice} error=${res.error} onRetry=${res.reload} />`;
  }

  const g = d.goal;
  const after = (message) => { setSaid(message); res.refresh(); };
  const text = g.text && g.text.trim() !== g.title.trim() ? g.text : null;
  const open = g.state !== "done" && g.state !== "stopped";
  const doneSteps = d.steps.filter((s) => s.state === "done").length;

  return html`
    <${PageHeader} title=${g.title} back=${BACK} />
    <div class="goal-status">
      <${StateWord} tone=${GOAL_TONES[g.state]}>${g.plainState}<//>
      <span class="muted">${stepsLine(g)} · <${Time} at=${g.createdAt} prefix="given" /></span>
    </div>
    ${said ? html`<p class="done-line" role="status"><span class="done-mark" aria-hidden="true"></span>${said}</p>` : null}

    ${text ? html`
      <${Section} title="What you asked" id="asked">
        <p class="quote">${text}</p>
      <//>` : null}

    ${d.result || d.verdict ? html`
      <${Section} title="Result" id="result">
        <div class="panel">
          ${d.result ? html`
            <p class="result-text">${d.result.text}</p>
            <p class="small muted">${d.result.by || "The Chief of staff"} · <${Time} at=${d.result.at} /></p>` : html`<p class="muted">No result has been written yet.</p>`}
          ${d.verdict ? html`<${Verdict} verdict=${d.verdict} />` : html`<p class="muted">The Checker has not given a verdict yet.</p>`}
        </div>
      <//>` : null}

    <${Section} title="Steps" id="steps" aside=${d.steps.length ? html`<span class="muted small">${doneSteps} of ${d.steps.length} done</span>` : null}>
      ${d.steps.length ? html`
        <ol class="rows steps">
          ${d.steps.map((s) => html`
            <li key=${s.id} class="row">
              <div class="row-main">
                <p class="row-title-text">${s.title}</p>
                <p class="row-sub">${s.who}${s.updatedAt ? html` · <${Time} at=${s.updatedAt} />` : null}</p>
              </div>
              <div class="row-side"><${StateWord} tone=${GOAL_TONES[s.state]}>${s.plainState}<//></div>
            </li>`)}
        </ol>` : html`<p class="muted">${g.state === "waiting" ? "The Chief of staff has not split this goal into steps yet." : "This goal has no separate steps."}</p>`}
    <//>

    ${d.files.length ? html`
      <${Section} title="Files" id="files" aside=${html`<span class="muted small">${d.files.length === 1 ? "1 file" : `${d.files.length} files`}</span>`}>
        <ul class="rows files">
          ${d.files.map((f) => html`
            <li key=${f.url} class="row">
              <div class="row-main"><a href=${f.url} download>${f.name}</a></div>
              <div class="row-side muted small">${bytes(f.size)}</div>
            </li>`)}
        </ul>
      <//>` : null}

    ${d.updates.length ? html`
      <${Section} title="Conversation" id="updates">
        <ol class="updates">
          ${d.updates.map((u, i) => html`
            <li key=${i} class="update">
              <p class="update-meta"><strong>${u.who}</strong> · <${Time} at=${u.at} /></p>
              <p class="update-text">${plainUpdate(u.text)}</p>
            </li>`)}
        </ol>
      <//>` : null}

    <${Section} title="Your note" id="note">
      <${NoteForm} key=${g.id} goal=${g} onSent=${after} />
    <//>

    ${open ? html`
      <div class="danger-zone">
        <${StopGoal} goal=${g} onStopped=${after} />
      </div>` : null}`;
}
