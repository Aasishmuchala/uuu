// A task's acceptance view (CONTRACTS-V2 17.3): who did it and how many check rounds it took, one large Accept,
// the Checker's numbered checks per round with their evidence, the timeline of steps, the staged documents, the
// conversation with a note to the Chief of staff, and the files in the work panel.
// Address state: ?round=<n>, ?check=<n>, ?files=1 (14.1). Everything here was written by agents: shown as text only.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { go } from "../lib/router.js";
import {
  Avatar, Button, Chip, CheckList, Composer, Conversation, DecisionCard, DocView, Empty, ErrorNotice, Evidence,
  FileCard, Loading, Menu, PageHeader, Section, Tabs, TextArea, Timeline, useInboxAct,
} from "../kit/index.js";

const BACK = { href: "#/tasks", label: "All tasks" };
const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (v, n) => { const s = text(v); return s.length > n ? `${s.slice(0, n)}…` : s; };

// --- Pure helpers (tested in test/pages/task.test.mjs) ---------------------------------------------------------

// "Not checked yet", "1 verification round", "3 verification rounds".
export function roundsLine(n) {
  const v = Math.floor(Number(n) || 0);
  if (v <= 0) return "Not checked yet";
  return v === 1 ? "1 verification round" : `${v} verification rounds`;
}

// The round the address asks for (by its number), else the newest. null when there are none.
export function pickRound(rounds, wanted) {
  const all = list(rounds).filter((r) => r && typeof r === "object");
  if (all.length === 0) return null;
  const w = Number(wanted);
  if (wanted !== null && wanted !== undefined && wanted !== "" && Number.isFinite(w)) {
    const hit = all.find((r) => Number(r.n) === w);
    if (hit) return hit;
  }
  return all.reduce((best, r) => (Number(r.n) > Number(best.n) ? r : best), all[all.length - 1]);
}

// The check the address asks for (by its number), else the first that failed, else the first. null when none.
export function pickCheck(round, wanted) {
  const checks = list(round && round.checks).filter((c) => c && typeof c === "object");
  if (checks.length === 0) return null;
  const w = Number(wanted);
  if (wanted !== null && wanted !== undefined && wanted !== "" && Number.isFinite(w)) {
    const hit = checks.find((c) => Number(c.n) === w);
    if (hit) return hit;
  }
  return checks.find((c) => text(c.answer).toLowerCase() !== "yes") || checks[0];
}

const STATE_WORDS = {
  waiting_for_you: "Waiting for you",
  accepted: "Accepted",
  not_ready: "Not ready yet",
  sent_back: "Sent back",
  stopped: "Stopped",
};

// The word shown in place of the Accept button.
export function stateWord(acceptance) {
  const s = acceptance && acceptance.state;
  return STATE_WORDS[s] || "Not ready yet";
}

// Every Needs-you item of the task except the delivery itself (that one is the Accept button).
export function otherNeeds(needsYou, acceptance) {
  const own = new Set([acceptance && acceptance.accept && acceptance.accept.inboxId,
    acceptance && acceptance.sendBack && acceptance.sendBack.inboxId].filter(Boolean));
  return list(needsYou).filter((i) => i && i.id && !own.has(i.id) && !(text(i.id).startsWith("goal:") && i.kind === "result"));
}

// The address of this page with some of its state changed (null removes a key).
export function address(id, query, change) {
  const q = new URLSearchParams(query ? query.toString() : "");
  for (const [k, v] of Object.entries(change || {})) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  const qs = q.toString();
  return `#/tasks/${encodeURIComponent(text(id))}${qs ? `?${qs}` : ""}`;
}

const passedCount = (round) => list(round && round.checks).filter((c) => text(c && c.answer).toLowerCase() === "yes").length;

const STAGE_WORDS = { done: "Done", current: "Now", waiting: "Not started", skipped: "Skipped" };

// --- The header's right side: Accept and Send back, or a word for the state ------------------------------------

function AcceptBar({ acceptance, onDone }) {
  const { act, busy, error } = useInboxAct();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const accept = acceptance && acceptance.accept;
  const sendBack = acceptance && acceptance.sendBack;

  if (!accept) {
    return html`<p class="p-task__state" role="status">${stateWord(acceptance)}</p>`;
  }

  async function doAccept() {
    const res = await act(accept.inboxId, accept.action);
    if (res) onDone(text(res.message) || "Accepted.");
  }
  async function doSendBack(e) {
    if (e) e.preventDefault();
    if (!sendBack || !note.trim()) return;
    const res = await act(sendBack.inboxId, sendBack.action, note.trim());
    if (res) { setNoting(false); setNote(""); onDone(text(res.message) || "Sent back with your note."); }
  }
  const cancel = () => { setNoting(false); setNote(""); };

  return html`
    <div class="p-task__accept">
      ${noting ? html`
        <form class="p-task__sendback" onSubmit=${doSendBack}
          onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } }}>
          <label class="u-caption" for="p-task-sendback">What should change?</label>
          <${TextArea} id="p-task-sendback" autoGrow rows=${3} maxLength=${4000} value=${note} autoFocus disabled=${busy}
            onInput=${(e) => setNote(e.currentTarget.value)} />
          <div class="u-row">
            <${Button} type="submit" variant="primary" busy=${busy} disabled=${!note.trim()}>${text(sendBack && sendBack.label) || "Send back"}<//>
            <${Button} variant="quiet" onClick=${cancel} disabled=${busy}>Cancel<//>
          </div>
        </form>` : html`
        <div class="u-row">
          ${sendBack ? html`<${Button} variant="plain" onClick=${() => setNoting(true)} disabled=${busy}>${text(sendBack.label) || "Send back"}<//>` : null}
          <${Button} variant="accept" size="lg" busy=${busy} onClick=${doAccept}>${text(accept.label) || "Accept"}<//>
        </div>`}
      ${error ? html`<${ErrorNotice} error=${error} />` : null}
    </div>`;
}

// "Stop this task" in a menu; asks once, then POST /api/goals/<id>/stop.
function StopTask({ task, onDone }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(task.id)}/stop`, {});
      setAsking(false);
      onDone("The task is stopped. Agents will not work on it any more.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!asking) {
    return html`<${Menu} label="More for this task" icon="menu"
      items=${[{ id: "stop", label: "Stop this task", danger: true, onSelect: () => setAsking(true) }]} />`;
  }
  return html`
    <div class="p-task__confirm" role="group" aria-label="Stop this task?"
      onKeyDown=${(e) => { if (e.key === "Escape") { e.stopPropagation(); setAsking(false); } }}>
      <p>Stop this task? Agents stop working on it.</p>
      <div class="u-row">
        <${Button} variant="danger" busy=${busy} onClick=${stop}>Yes, stop it<//>
        <${Button} variant="quiet" onClick=${() => setAsking(false)} disabled=${busy}>Cancel<//>
      </div>
      ${error ? html`<${ErrorNotice} error=${error} />` : null}
    </div>`;
}

// --- Acceptance: tabs per round, the checks on the left, the chosen check on the right --------------------------

function ChosenCheck({ check }) {
  const [pick, setPick] = useState(0);
  const files = list(check && check.evidence).filter((f) => f && typeof f === "object");
  useEffect(() => setPick(0), [check && check.n]);
  if (!check) return null;
  const file = files[Math.min(pick, files.length - 1)] || null;
  const ok = text(check.answer).toLowerCase() === "yes";
  return html`
    <div class="p-task__chosen">
      <p class="p-task__chosen-q"><strong>${text(check.n)}. ${cap(check.question, 400)}</strong></p>
      <p class=${`p-task__chosen-a p-task__chosen-a--${ok ? "pass" : "fail"}`}>${ok ? "Passed" : "Failed"}${check.reason ? `: ${cap(check.reason, 2000)}` : ""}</p>
      ${file ? html`<div class="p-task__evidence"><${Evidence} key=${text(file.url || file.name)} file=${file} /></div>`
        : html`<p class="u-caption">No evidence was given for this check.</p>`}
      ${files.length > 1 ? html`
        <div class="p-task__pick" role="group" aria-label="Other evidence">
          ${files.map((f, i) => html`
            <button type="button" key=${text(f.url || f.name) + i} class="p-task__pick-item"
              aria-pressed=${i === pick ? "true" : "false"} onClick=${() => setPick(i)}>${cap(f.name, 80)}</button>`)}
        </div>` : null}
    </div>`;
}

function Acceptance({ id, acceptance, query }) {
  const rounds = list(acceptance && acceptance.rounds);
  if (rounds.length === 0) return html`<p class="u-muted">Not checked yet.</p>`;
  const round = pickRound(rounds, query.get("round"));
  const check = round && round.wellFormed ? pickCheck(round, query.get("check")) : null;
  const tabs = rounds.map((r) => ({ id: text(r.n), label: text(r.label) || `Round ${text(r.n)}`, tone: r.outcome === "pass" ? "ok" : "bad" }));
  const exchange = list(round.exchange).slice(-20);
  const actions = list(round.actions).slice(0, 50);

  return html`
    <${Tabs} label="Verification rounds" tabs=${tabs} current=${text(round.n)}
      onChange=${(n) => go(address(id, query, { round: n, check: null }))} />
    ${round.wellFormed ? html`
      <div class="p-task__rounds">
        <div class="p-task__checks">
          <div class="u-spread">
            <h3 class="p-task__h">Acceptance checks</h3>
            <span class="u-caption">${passedCount(round)} passed</span>
          </div>
          <${CheckList} checks=${list(round.checks)} selected=${check ? check.n : null}
            onSelect=${(n) => go(address(id, query, { round: round.n, check: n }))} />
        </div>
        <div class="p-task__detail">
          <${ChosenCheck} check=${check} />
          <h3 class="p-task__h">What was said in this round</h3>
          ${exchange.length ? html`<${Conversation} messages=${exchange} />` : html`<p class="u-caption">Nothing was said in this round.</p>`}
          ${actions.length ? html`
            <h3 class="p-task__h">What the Checker asked to change</h3>
            <ul class="p-task__actions">${actions.map((a, i) => html`<li key=${i}>${cap(a, 600)}</li>`)}</ul>` : null}
        </div>
      </div>` : html`
      <div class="p-task__verdict">
        <p><strong>${round.outcome === "pass" ? "Passed" : round.outcome === "fail" ? "Failed" : "No clear verdict"}</strong></p>
        ${round.reason ? html`<p>${cap(round.reason, 2000)}</p>` : null}
      </div>`}`;
}

// --- Documents: the five stages in order ------------------------------------------------------------------------

function Stages({ stages }) {
  const [open, setOpen] = useState(null);
  return html`
    <ol class="p-task__stages">
      ${list(stages).map((s) => {
        const isOpen = open === s.id && !!s.doc;
        return html`
          <li key=${text(s.id)} class=${`p-task__stage p-task__stage--${text(s.state)}`}>
            <div class="u-spread">
              ${s.doc ? html`
                <button type="button" class="p-task__stage-name" aria-expanded=${isOpen ? "true" : "false"}
                  onClick=${() => setOpen(isOpen ? null : s.id)}>${text(s.label)}</button>`
                : html`<span class="p-task__stage-name">${text(s.label)}</span>`}
              <span class="u-caption">${s.state === "skipped" ? "Skipped for a small task." : STAGE_WORDS[s.state] || text(s.state)}</span>
            </div>
            ${isOpen ? html`<div class="p-task__doc"><${DocView} doc=${s.doc} unclear=${list(s.unclear)} /></div>` : null}
          </li>`;
      })}
    </ol>`;
}

function FilesPanel({ files }) {
  return html`<div class="p-task"><div class="p-task__files">${files.map((f, i) => html`<${FileCard} key=${text(f.url || f.name) + i} file=${f} />`)}</div></div>`;
}

// --- The page --------------------------------------------------------------------------------------------------

export default function Page({ route }) {
  const app = useApp() || {};
  const id = text(route && route.parts && route.parts[1]);
  const query = (route && route.query) || new URLSearchParams();
  const res = useResource(id ? `/api/tasks/${encodeURIComponent(id)}` : null, { every: 10000 });
  const [said, setSaid] = useState(null);
  const opened = useRef(null);
  const d = res.data;
  const files = list(d && d.files).filter((f) => f && typeof f === "object").slice(0, 200);

  const showFiles = () => {
    if (typeof app.openPanel === "function") app.openPanel(html`<${FilesPanel} files=${files} />`, { title: `Files (${files.length})` });
  };

  // The work panel opens from the start with ?files=1, or on a wide window when there are files. Once per task.
  useEffect(() => {
    if (!d || opened.current === id) return;
    opened.current = id;
    const wide = typeof window !== "undefined" && window.innerWidth >= 1280;
    if (query.get("files") === "1" || (wide && files.length > 0)) showFiles();
  }, [d, id]);
  useEffect(() => () => { if (typeof app.closePanel === "function" && opened.current) app.closePanel(); }, []);

  const after = (message) => {
    setSaid(message);
    if (typeof app.announce === "function") app.announce(message);
    if (typeof app.refreshShell === "function") app.refreshShell();
    res.refresh();
  };

  if (!d) {
    const missing = res.error && (res.error.code === "task_not_found" || res.error.status === 404);
    return html`
      <div class="p-task">
        <${PageHeader} title=${missing ? "Task not found" : "Task"} back=${BACK} />
        ${missing ? html`<${Empty} title="That task is not here."><a href="#/tasks">All tasks</a><//>`
          : res.loading || !res.error ? html`<${Loading} lines=${6} label="Loading the task" />`
          : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
      </div>`;
  }

  const t = d.task || {};
  const acceptance = d.acceptance || {};
  const rounds = list(acceptance.rounds);
  const needs = otherNeeds(d.needsYou, acceptance);
  const who = t.who || null;
  const canStop = acceptance.state !== "stopped" && acceptance.state !== "accepted";

  async function sendNote({ text: note }) {
    const body = text(note).trim();
    if (!body) return;
    await api.post(`/api/goals/${encodeURIComponent(t.id)}/note`, { text: body });
    after("Note sent to the Chief of staff.");
  }

  const actions = html`
    <div class="p-task__head-actions">
      <${AcceptBar} acceptance=${acceptance} onDone=${after} />
      ${canStop && t.id ? html`<${StopTask} task=${t} onDone=${after} />` : null}
    </div>`;

  return html`
    <div class="p-task">
    <${PageHeader} title=${cap(t.title, 300) || "Task"} back=${BACK} actions=${actions}>
      <div class="p-task__meta">
        ${who ? html`<span class="u-row"><${Avatar} slug=${text(who.slug)} name=${text(who.name)} size=${20} /><span>${text(who.name)}</span></span>` : null}
        <span>${roundsLine(rounds.length)}</span>
        ${t.size ? html`<${Chip}>Size ${text(t.size)}<//>` : null}
        ${t.schedule ? html`<${Chip} icon="clock">${text(t.schedule.label)}<//>` : null}
      </div>
    <//>
      ${said ? html`<p class="p-task__said" role="status">${said}</p>` : null}

      ${needs.length ? html`
        <div class="p-task__needs">
          ${needs.map((item) => html`<${DecisionCard} key=${item.id} item=${item} onDone=${() => after("Done.")} />`)}
        </div>` : null}

      <${Section} title="Acceptance">
        <${Acceptance} id=${id} acceptance=${acceptance} query=${query} />
      <//>

      <${Section} title="Timeline">
        ${list(d.timeline).length ? html`<${Timeline} items=${list(d.timeline)} now=${d.generatedAt} />`
          : html`<p class="u-muted">No steps yet.</p>`}
      <//>

      <${Section} title="Documents">
        <${Stages} stages=${d.stages} />
      <//>

      <${Section} title="Conversation">
        ${list(d.conversation).length ? html`<${Conversation} messages=${list(d.conversation).slice(-200)} />`
          : html`<p class="u-muted">Nothing has been said yet.</p>`}
        <div class="p-task__composer">
          <${Composer} placeholder="Send a note to the Chief of staff." allowPlanFirst=${false} onSend=${sendNote} />
        </div>
      <//>

      ${files.length ? html`
        <div class="p-task__files-open">
          <${Button} variant="plain" icon="panel" onClick=${showFiles}>Files (${files.length})<//>
        </div>` : null}
    </div>`;
}
