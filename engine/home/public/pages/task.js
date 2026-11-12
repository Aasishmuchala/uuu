// A task, as a conversation with its acceptance beside it (CONTRACTS-V3 30, "A task"; CONTRACTS-V2 17.3).
// The column: the back chip, the title, a line with the agent, the size, the job it came from and the task it
// follows, then the story in time order (the owner's words, each document as it was written, the agents'
// comments, a marker for each check round, the result with its files). For a question task the story is the
// answer. Beside the column when there is room (under the title when there is not): the acceptance panel with
// the state, Accept and Send back, the other Needs-you items, the rounds and their checks, what can come next,
// how it went, the files, a note and stop. Below 860 px a bar above the tab bar holds Accept and Send back.
// Address state: ?round=<n>, ?check=<n>, ?doc=<stage id>, ?files=1. Everything here was written by agents:
// shown as text only, sizes capped, no link followed.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import { waitingLine } from "../lib/format.js";
import { go } from "../lib/router.js";
import {
  AnswerView, Avatar, Button, Chip, CheckList, Conversation, DecisionCard, DocView, Empty, ErrorNotice, Evidence,
  FileCard, Icon, Loading, PageHeader, Tabs, TextArea, Timeline, changedText, isChangedSinceSeen, jobHref, useInboxAct,
} from "../kit/index.js";

const BACK = { href: "#/tasks", label: "All tasks" };
const YOU = { slug: "you", name: "You" };
const text = (v) => (v === null || v === undefined ? "" : String(v));
const list = (v) => (Array.isArray(v) ? v : []);
const cap = (v, n) => { const s = text(v); return s.length > n ? `${s.slice(0, n)}…` : s; };
const ms = (iso) => { const t = Date.parse(text(iso)); return Number.isFinite(t) ? t : NaN; };
const NARROW = 860;
const WIDE = 1080;

// --- Pure helpers (tested in test/pages/task.test.mjs) ---------------------------------------------------------

// "Not checked yet", "1 verification round", "3 verification rounds". A question is answered by the Chief of staff
// and never checked (C3 25), so with no round it is "Not checked" (M63 item 4).
export function roundsLine(n, { ask = false } = {}) {
  const v = Math.floor(Number(n) || 0);
  if (v <= 0) return ask ? "Not checked" : "Not checked yet";
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
const STATE_DOTS = { waiting_for_you: "warn", accepted: "ok", not_ready: "live", sent_back: "warn", stopped: "off" };

// The word for the state of the acceptance.
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

// The arguments of `act` for the delivery's own buttons: the item, the action, the note, and the version the
// button was showing (CONTRACTS 9.3a). which is "accept" or "sendBack".
export function actArgs(acceptance, which, note) {
  const a = (acceptance && acceptance[which]) || {};
  return [a.inboxId, a.action, note, a.version];
}

// The marker of a check round: its label and a tone (passed, repairing, failed).
export function roundMarker(round) {
  const n = Number(round && round.n);
  const pass = round && round.outcome === "pass";
  const label = cap(text(round && round.label).trim() || (Number.isFinite(n) ? `Round ${n}` : "A round"), 80);
  if (pass) return { label, tone: "ok" };
  return { label, tone: /failed/i.test(label) ? "bad" : "warn" };
}

// The documents the story shows, and the line that marks each as written. The check is in the panel.
export const STORY_DOCS = { brief: "Brief written", plan: "Plan ready", summary: "Summary written" };

const STORY_FILES = 6;
const STAFF = new Set(["chief-of-staff", "you"]);
const slugOf = (name) => text(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// The task's files that belong under the result: not the staged documents, which the story shows as documents.
export function resultFiles(files, stages) {
  const docs = new Set(list(stages).map((s) => s && s.doc && s.doc.file && text(s.doc.file.name)).filter(Boolean));
  return list(files).filter((f) => f && typeof f === "object" && !docs.has(text(f.name)));
}

// The question of a question task as shape `ask` (33.5), for AnswerView; null when this is not a question,
// or when the Chief of staff took it as work (then the story is told as for any task). `answer` may be the
// whole ask or only its answer; before the server sends it, an open question reads as being read.
export function askOf(d) {
  const t = d && d.task;
  if (!t || t.ask !== true) return null;
  const a = d.answer;
  if (a && typeof a === "object" && (typeof a.question === "string" || typeof a.state === "string")) {
    return a.state === "became_task" ? null : a;
  }
  const answered = !!(a && typeof a === "object");
  const done = t.state === "done" || t.column === "done";
  let state;
  if (answered) state = "answered";
  else if (t.column === "canceled" || (d.acceptance && d.acceptance.state === "stopped")) state = "stopped";
  else if (done || Number(t.stepsTotal) > 0) return null;
  else if (t.state === "needs_you") state = "needs_you";
  else state = "reading";
  return {
    id: t.id, identifier: t.identifier, taskId: t.id,
    question: cap(text(d.text).trim() || t.title, 2000),
    state, plainState: text(t.plainState), askedAt: t.createdAt,
    answer: answered ? a : null,
    queue: t.queue && typeof t.queue === "object" ? t.queue : null,
  };
}

// The story of a task, in time order: [{ kind: "message", message } | { kind: "doc", id, label, marker, doc,
// unclear } | { kind: "answer", ask }]. Built from the owner's words, `conversation`, `stages`,
// `acceptance.rounds` and `result`. Documents carry no time of their own: the brief and the plan are placed
// before the first word of an agent other than the Chief of staff (or the first round, or the result), the
// summary before the newest round (or the result); with nothing to place them by, after what was said.
export function storyOf(d) {
  if (!d || typeof d !== "object") return [];
  const ask = askOf(d);
  if (ask) return [{ kind: "answer", ask }];
  const t = d.task || {};
  const rounds = list(d.acceptance && d.acceptance.rounds).filter((r) => r && typeof r === "object");
  const result = d.result && typeof d.result === "object" && text(d.result.text).trim() ? d.result : null;
  const convo = list(d.conversation).filter((m) => m && typeof m === "object").slice(-200);
  const out = [];
  let seq = 0;
  const push = (time, rank, item) => out.push({ time, rank, i: seq++, item });

  const opening = text(d.text).trim() || text(t.title).trim();
  if (opening) {
    const start = ms(t.createdAt);
    push(Number.isFinite(start) ? start : -Infinity, 0, { kind: "message", message: { who: YOU, text: cap(opening, 8000), at: t.createdAt } });
  }

  // Rounds: each marks the Checker's verdict given at its time, or stands alone.
  const unused = rounds.map((r) => ({ r, at: ms(r.at), used: false }));
  const files = resultFiles(d.files, d.stages).slice(0, STORY_FILES);
  let last = -Infinity;
  let resultPlaced = false;
  for (const m of convo) {
    const at = ms(m.at);
    if (Number.isFinite(at)) last = at;
    const who = m.who && typeof m.who === "object" ? { slug: text(m.who.slug), name: text(m.who.name) } : { slug: "", name: "" };
    const message = { who, kind: text(m.kind) || "comment", text: cap(m.text, 8000), at: m.at };
    // A long comment of an agent folds behind "Show all" (M63 item 28); the check and the result stay open.
    if (message.kind === "comment" && who.slug !== YOU.slug) message.fold = true;
    if (message.kind === "verdict") {
      const hit = unused.find((u) => !u.used && u.at === at);
      if (hit) { hit.used = true; message.marker = roundMarker(hit.r); }
    }
    if (result && !resultPlaced && message.kind === "result" && ms(result.at) === at) {
      resultPlaced = true;
      message.text = cap(result.text, 8000);
      if (files.length) message.files = files;
    }
    push(last, 2, { kind: "message", message });
  }
  for (const u of unused) {
    if (u.used) continue;
    push(Number.isFinite(u.at) ? u.at : Infinity, 3, { kind: "message", message: { marker: roundMarker(u.r) } });
  }
  if (result && !resultPlaced) {
    const at = ms(result.at);
    const said = convo.find((m) => m.kind === "result" && m.who && text(m.who.name) === text(result.by));
    const who = said ? { slug: text(said.who.slug), name: text(said.who.name) } : { slug: slugOf(result.by), name: cap(result.by, 80) };
    push(Number.isFinite(at) ? at : Infinity, 9, { kind: "message", message: { who, kind: "result", text: cap(result.text, 8000), at: result.at, files: files.length ? files : undefined } });
  }

  // Documents.
  const finite = (xs) => xs.filter(Number.isFinite);
  const firstWorker = convo.find((m) => m.who && !STAFF.has(text(m.who.slug)) && m.kind !== "verdict" && Number.isFinite(ms(m.at)));
  const early = finite([firstWorker ? ms(firstWorker.at) : NaN, rounds.length ? ms(rounds[0].at) : NaN, result ? ms(result.at) : NaN]);
  const newest = rounds.length ? ms(rounds[rounds.length - 1].at) : NaN;
  const late = finite([newest, result ? ms(result.at) : NaN]);
  for (const s of list(d.stages)) {
    if (!s || !s.doc || !Object.hasOwn(STORY_DOCS, s.id)) continue;
    const anchor = s.id === "summary" ? (late.length ? late[0] : Infinity) : (early.length ? Math.min(...early) : Infinity);
    push(anchor, 1, { kind: "doc", id: s.id, label: text(s.label), marker: { label: STORY_DOCS[s.id], tone: "neutral" }, doc: s.doc, unclear: list(s.unclear) });
  }

  if (d.acceptance && d.acceptance.state === "stopped") push(Infinity, 8, { kind: "message", message: { marker: { label: "Stopped", tone: "bad" } } });

  const order = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
  out.sort((a, b) => order(a.time, b.time) || a.rank - b.rank || a.i - b.i);
  return out.map((e) => e.item);
}

// "What can come next" (33.4 `next`) as links to the job, told which task they follow.
export function nextLinks(next, task) {
  const from = text(task && (task.identifier || task.id));
  return list(next).filter((n) => n && typeof n === "object").slice(0, 12).map((n) => {
    const base = jobHref({ id: text(n.jobId) });
    if (!base) return null;
    const why = n.why && typeof n.why === "object" ? n.why.text : n.why;
    return {
      href: from ? `${base}?from=${encodeURIComponent(from)}` : base,
      title: cap(n.title, 120),
      label: cap(n.label, 120) || cap(n.title, 120),
      ready: n.ready === true,
      why: cap(why, 300),
    };
  }).filter(Boolean);
}

// Whether the panel stands beside the column: the window is at least 1080 px wide and the page has room for
// both (`room`, the width the main pane leaves the page). `width` is how wide the page then is.
export const SIDE_ROOM = 880;
export const SIDE_MAX = 1084;
export function sideLayout(viewport, room) {
  const v = Number(viewport);
  const r = Math.floor(Number(room));
  if (!Number.isFinite(v) || v < WIDE || !Number.isFinite(r) || r < SIDE_ROOM) return { side: false, width: null };
  return { side: true, width: Math.min(r, SIDE_MAX) };
}

// --- Layout: beside, stacked, or narrow with a bar ---------------------------------------------------------------

const px = (v) => Number.parseFloat(v) || 0;

function useLayout(ref) {
  const [state, setState] = useState({ narrow: false, side: false, width: null });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return undefined;
    const main = el.closest("main");
    const outer = main && main.parentElement;
    const measure = () => {
      const vw = window.innerWidth;
      let room = 0;
      if (outer) {
        const o = getComputedStyle(outer);
        const m = getComputedStyle(main);
        room = outer.clientWidth - px(o.paddingLeft) - px(o.paddingRight) - px(m.paddingLeft) - px(m.paddingRight);
      }
      const next = { narrow: vw < NARROW, ...sideLayout(vw, room) };
      setState((s) => (s.narrow === next.narrow && s.side === next.side && s.width === next.width ? s : next));
    };
    measure();
    const ro = typeof ResizeObserver === "function" && outer ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(outer);
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return state;
}

// The height of the bar fixed at the bottom, so the page can leave room for it.
function useHeight(ref, on) {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) { setH(0); return undefined; }
    const measure = () => setH(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [on]);
  return h;
}

// --- Accept and Send back, or a word for the state ----------------------------------------------------------------

function AcceptBar({ acceptance, onDone, onChanged }) {
  const { act, busy, error, changed } = useInboxAct();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const accept = acceptance && acceptance.accept;
  const sendBack = acceptance && acceptance.sendBack;

  // The task changed after the owner looked: read it again once. Nothing is sent again.
  useEffect(() => { if (changed && typeof onChanged === "function") onChanged(); }, [changed, error]);

  if (!accept) return null;

  async function doAccept() {
    const res = await act(...actArgs(acceptance, "accept"));
    if (res) onDone(text(res.message) || "Accepted.");
  }
  async function doSendBack(e) {
    if (e) e.preventDefault();
    if (!sendBack || !note.trim()) return;
    const res = await act(...actArgs(acceptance, "sendBack", note.trim()));
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
        <div class="p-task__accept-row">
          <${Button} variant="accept" size="lg" busy=${busy} onClick=${doAccept}>${text(accept.label) || "Accept"}<//>
          ${sendBack ? html`<${Button} variant="plain" onClick=${() => setNoting(true)} disabled=${busy}>${text(sendBack.label) || "Send back"}<//>` : null}
        </div>`}
      ${error ? html`<${Refused} error=${error} />` : null}
    </div>`;
}

// A refused or failed action, in place: the server's words and next step. Not the "could not be loaded" box.
function Refused({ error }) {
  const t = isChangedSinceSeen(error) ? changedText(error) : { message: text(error && error.message) || "That did not work.", next: text(error && error.next) };
  return html`<div class="k-decision__changed" role="alert">
    <${Icon} name="alert" />
    <div class="k-decision__changed-text">
      <p class="k-decision__changed-title">${text(t.message)}</p>
      ${t.next ? html`<p class="k-decision__changed-next">${text(t.next)}</p>` : null}
    </div>
  </div>`;
}

// "Stop this task": asks once, then POST /api/goals/<id>/stop.
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

  if (!asking) return html`<${Button} variant="quiet" size="sm" icon="cross" onClick=${() => setAsking(true)}>Stop this task<//>`;
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

// "Send a note": a short note to the Chief of staff, POST /api/goals/<id>/note.
function SendNote({ task, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function send(e) {
    if (e) e.preventDefault();
    const body = note.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/goals/${encodeURIComponent(task.id)}/note`, { text: body });
      setNote("");
      setOpen(false);
      onDone("Note sent to the Chief of staff.");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const cancel = () => { setOpen(false); setError(null); };

  if (!open) return html`<${Button} variant="plain" size="sm" icon="reply" onClick=${() => setOpen(true)}>Send a note<//>`;
  return html`
    <form class="p-task__note" onSubmit=${send} onKeyDown=${(e) => {
      if (e.key === "Escape") { e.stopPropagation(); cancel(); }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
    }}>
      <label class="u-caption" for="p-task-note">A note to the Chief of staff</label>
      <${TextArea} id="p-task-note" autoGrow rows=${3} maxLength=${4000} value=${note} autoFocus disabled=${busy}
        onInput=${(e) => setNote(e.currentTarget.value)} />
      <div class="u-row">
        <${Button} type="submit" variant="primary" size="sm" busy=${busy} disabled=${!note.trim()}>Send<//>
        <${Button} variant="quiet" size="sm" onClick=${cancel} disabled=${busy}>Cancel<//>
      </div>
      ${error ? html`<${Refused} error=${error} />` : null}
    </form>`;
}

// --- The rounds: tabs, the checks, the chosen check with its evidence, the Checker's actions --------------------

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

function Rounds({ id, acceptance, query }) {
  const rounds = list(acceptance && acceptance.rounds).filter((r) => r && typeof r === "object");
  if (rounds.length === 0) return html`<p class="u-caption">Not checked yet.</p>`;
  const round = pickRound(rounds, query.get("round"));
  const check = round && round.wellFormed ? pickCheck(round, query.get("check")) : null;
  const tabs = rounds.map((r) => ({ id: text(r.n), label: `Round ${text(r.n)}`, tone: r.outcome === "pass" ? "ok" : "bad" }));
  const actions = list(round.actions).slice(0, 50);

  return html`
    <div class="p-task__rounds">
      <${Tabs} label="Check rounds" tabs=${tabs} current=${text(round.n)}
        onChange=${(n) => go(address(id, query, { round: n, check: null }))} />
      <p class="p-task__round-line">${cap(round.label, 80)}${round.by ? html` <span class="u-caption">by ${cap(round.by, 60)}</span>` : null}</p>
      ${round.wellFormed ? html`
        <div class="u-spread">
          <h2 class="p-task__h">The six checks</h2>
          <span class="u-caption">${passedCount(round)} passed</span>
        </div>
        <${CheckList} checks=${list(round.checks)} selected=${check ? check.n : null}
          onSelect=${(n) => go(address(id, query, { round: round.n, check: n }))} />
        <${ChosenCheck} check=${check} />
        ${actions.length ? html`
          <h2 class="p-task__h">What the Checker asked to change</h2>
          <ul class="p-task__actions">${actions.map((a, i) => html`<li key=${i}>${cap(a, 600)}</li>`)}</ul>` : null}` : html`
        <div class="p-task__verdict">
          <p><strong>${round.outcome === "pass" ? "Passed" : round.outcome === "fail" ? "Failed" : "No clear verdict"}</strong></p>
          ${round.reason ? html`<p>${cap(round.reason, 2000)}</p>` : null}
        </div>`}
    </div>`;
}

// --- How it went: the five stages and the timeline of steps ------------------------------------------------------

function HowItWent({ stages, timeline, now }) {
  return html`
    <details class="p-task__how">
      <summary class="p-task__summary">How it went</summary>
      <ol class="p-task__stages">
        ${list(stages).filter((s) => s && s.id).map((s) => html`
          <li key=${text(s.id)} class=${`p-task__stage p-task__stage--${text(s.state)}`}>
            <span class="p-task__stage-name">${cap(s.label, 60)}</span>
            <span class="u-caption">${s.state === "skipped" ? "Skipped for a small task." : STAGE_WORDS[s.state] || cap(s.state, 30)}</span>
          </li>`)}
      </ol>
      ${list(timeline).length ? html`<${Timeline} items=${list(timeline).slice(0, 100)} now=${now} />`
        : html`<p class="u-caption">No steps yet.</p>`}
    </details>`;
}

// Once a task is accepted, what can come next is the point of the panel: it goes at the top, above the checks (M63
// item 48). Otherwise it keeps its place below them.
export const nextOnTop = (acceptance, next) => !!acceptance && acceptance.state === "accepted" && list(next).length > 0;

function NextUp({ items }) {
  if (!items.length) return null;
  return html`
    <div class="p-task__next">
      <h2 class="p-task__h">What can come next</h2>
      <ul class="p-task__next-list">
        ${items.map((n, i) => html`
          <li key=${i} class=${`p-task__next-item${n.ready ? "" : " p-task__next-item--dim"}`}>
            <a class="p-task__next-link" href=${n.href}>
              <${Icon} name="arrow-right" size=${14} />
              <span class="p-task__next-text">
                <span class="p-task__next-label">${n.label}</span>
                ${n.label !== n.title ? html`<span class="u-caption">${n.title}</span>` : null}
              </span>
            </a>
            ${!n.ready && n.why ? html`<p class="p-task__next-why">${n.why}</p>` : null}
          </li>`)}
      </ul>
    </div>`;
}

// --- The story -----------------------------------------------------------------------------------------------------

function DocItem({ item, open, onToggle }) {
  const box = `p-task-doc-${item.id}`;
  return html`
    <div class="p-task__docitem">
      <${Conversation} messages=${[{ marker: item.marker }]} />
      <div class="p-task__docbox">
        <button type="button" class="p-task__doc-toggle" aria-expanded=${open ? "true" : "false"} aria-controls=${box}
          onClick=${onToggle}>
          <${Icon} name=${open ? "chevron-down" : "chevron-right"} size=${14} />
          <span>${open ? "Hide" : "Read"} the ${cap(item.label, 40).toLowerCase() || "document"}</span>
        </button>
        ${open ? html`<div class="p-task__doc" id=${box}><${DocView} doc=${item.doc} unclear=${item.unclear} /></div>` : null}
      </div>
    </div>`;
}

function Story({ id, items, query }) {
  if (!items.length) return html`<p class="u-muted">Nothing has been said yet.</p>`;
  const blocks = [];
  let run = [];
  const flush = () => {
    if (run.length) blocks.push(html`<${Conversation} key=${`c${blocks.length}`} messages=${run} />`);
    run = [];
  };
  for (const it of items) {
    if (it.kind === "message") { run.push(it.message); continue; }
    flush();
    if (it.kind === "answer") blocks.push(html`<${AnswerView} key="answer" ask=${it.ask} />`);
    else if (it.kind === "doc") {
      const open = query.get("doc") === it.id;
      blocks.push(html`<${DocItem} key=${`d${it.id}`} item=${it} open=${open}
        onToggle=${() => go(address(id, query, { doc: open ? null : it.id }))} />`);
    }
  }
  flush();
  return html`<div class="p-task__story">${blocks}</div>`;
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
  const root = useRef(null);
  const bar = useRef(null);
  const layout = useLayout(root);
  const d = res.data;
  const files = list(d && d.files).filter((f) => f && typeof f === "object").slice(0, 200);
  const acceptance = (d && d.acceptance) || {};
  const barred = layout.narrow && !!acceptance.accept;
  const barHeight = useHeight(bar, barred);

  const showFiles = () => {
    if (typeof app.openPanel === "function") app.openPanel(html`<${FilesPanel} files=${files} />`, { title: `Files (${files.length})` });
  };

  // The work panel opens from the start with ?files=1, once per task. The right side is the acceptance panel's.
  useEffect(() => {
    if (!d || opened.current === id) return;
    opened.current = id;
    if (query.get("files") === "1" && files.length > 0) showFiles();
  }, [d, id]);
  useEffect(() => () => { if (typeof app.closePanel === "function" && opened.current) app.closePanel(); }, []);

  // After Accept, Send back or a note the line that says what happened takes focus, so the keyboard does not
  // fall to the page's body when the button it was on goes away (M52 K3).
  const saidRef = useRef(null);
  const after = (message) => {
    setSaid(message);
    setTimeout(() => saidRef.current?.focus(), 0);
    if (typeof app.announce === "function") app.announce(message);
    if (typeof app.refreshShell === "function") app.refreshShell();
    res.refresh();
  };

  const rootClass = ["p-task", layout.side ? "p-task--side" : "", barred ? "p-task--barred" : ""].filter(Boolean).join(" ");
  const rootStyle = [layout.side && layout.width ? `--p-task-w: ${layout.width}px` : "", barred && barHeight ? `--p-task-bar: ${barHeight}px` : ""]
    .filter(Boolean).join("; ") || undefined;

  if (!d) {
    const missing = res.error && (res.error.code === "task_not_found" || res.error.status === 404);
    return html`
      <div class="p-task" ref=${root}>
        <${PageHeader} title=${missing ? "Task not found" : "Task"} back=${BACK} />
        ${missing ? html`<${Empty} title="That task is not here."><a class="p-task__empty-link" href="#/tasks">All tasks</a><//>`
          : res.loading || !res.error ? html`<${Loading} lines=${6} label="Loading the task" />`
          : html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />`}
      </div>`;
  }

  const t = d.task || {};
  const rounds = list(acceptance.rounds);
  const needs = otherNeeds(d.needsYou, acceptance);
  const who = t.who || null;
  const job = d.job && typeof d.job === "object" ? d.job : t.job && typeof t.job === "object" ? t.job : null;
  const jobLink = job ? jobHref(job) : null;
  const follows = d.follows && typeof d.follows === "object" ? d.follows : null;
  const dept = text((job && job.department) || t.department);
  const canStop = acceptance.state !== "stopped" && acceptance.state !== "accepted" && t.column !== "canceled";
  const next = nextLinks(d.next, t);
  const story = storyOf(d);
  const state = acceptance.state || "not_ready";

  const panel = html`
    <aside class="p-task__panel" aria-label="Acceptance">
      <div class="p-task__state-row">
        <p class="p-task__over">Acceptance</p>
        <${Chip} dot=${STATE_DOTS[state] || "off"}>${stateWord(acceptance)}<//>
      </div>
      ${nextOnTop(acceptance, next) ? html`<${NextUp} items=${next} />` : null}
      ${!layout.narrow ? html`<${AcceptBar} acceptance=${acceptance} onDone=${after} onChanged=${res.refresh} />` : null}
      ${said ? html`<p class="p-task__said" role="status" tabindex="-1" ref=${saidRef}>${said}</p>` : null}
      ${needs.length ? html`
        <div class="p-task__needs">
          ${needs.map((item) => html`<${DecisionCard} key=${item.id} item=${item} onDone=${() => after("Done.")} />`)}
        </div>` : null}
      <${Rounds} id=${id} acceptance=${acceptance} query=${query} />
      ${nextOnTop(acceptance, next) ? null : html`<${NextUp} items=${next} />`}
      <${HowItWent} stages=${d.stages} timeline=${d.timeline} now=${d.generatedAt} />
      <div class="p-task__tools">
        ${files.length ? html`<${Button} variant="plain" size="sm" icon="panel" onClick=${showFiles}>Files (${files.length})<//>` : null}
        ${t.id ? html`<${SendNote} task=${t} onDone=${after} />` : null}
        ${canStop && t.id ? html`<${StopTask} task=${t} onDone=${after} />` : null}
      </div>
    </aside>`;

  return html`
    <div class=${rootClass} ref=${root} style=${rootStyle}>
      <div class="p-task__head">
        <${PageHeader} title=${cap(t.title, 300) || "Task"} back=${BACK}>
          <div class="p-task__meta">
            ${who ? html`<span class="p-task__who"><${Avatar} slug=${text(who.slug)} name=${text(who.name)} size=${20} /><span>${cap(who.name, 60)}</span></span>` : null}
            ${t.size ? html`<${Chip}>Size ${cap(t.size, 4)}<//>` : null}
            ${job && jobLink ? html`<a class="p-task__chip-link" href=${jobLink}><${Chip} dot=${dept || true}>${cap(job.title, 80)}<//></a>` : null}
            ${follows && (follows.identifier || follows.taskId) ? html`
              <a class="p-task__chip-link" href=${`#/tasks/${encodeURIComponent(text(follows.identifier || follows.taskId))}`}>
                <${Chip} icon="link">Follows ${cap(follows.title || follows.identifier, 80)}<//>
              </a>` : null}
            ${t.schedule ? html`<${Chip} icon="clock">${cap(t.schedule.label, 60)}<//>` : null}
            <span class="u-caption">${roundsLine(rounds.length, { ask: t.ask === true })}</span>
          </div>
          ${waitingLine(t.queue) && !askOf(d) ? html`<p class="p-task__turn"><${Icon} name="clock" size=${14} /><span>${waitingLine(t.queue)}</span></p>` : null}
        <//>
      </div>
      ${panel}
      <section class="p-task__main" aria-label="What was said">
        <${Story} id=${id} items=${story} query=${query} />
      </section>
      ${barred ? html`
        <div class="p-task__bar" ref=${bar} role="region" aria-label="Accept or send back">
          <${AcceptBar} acceptance=${acceptance} onDone=${after} onChanged=${res.refresh} />
        </div>` : null}
    </div>`;
}
