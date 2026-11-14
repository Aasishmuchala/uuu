// The hold sweep: finds open tasks (and their open steps) the board has put on hold, and clears a hold
// only when the run behind it provably never started. Everything else is shown to the owner in Needs you
// (inbox/board.mjs reads `holds()`).
//
// How the board holds a task (paperclip 2026.1106.0, server/dist):
//   - GET /api/issues/:id/execution (routes/agents.js) projects the newest run of the task; phase
//     "recovery_needed" (services/execution-projection.js projectExecution) is the hold, "Stopped" when the
//     watchdog settled it with automaticRecovery.replay "blocked", "Recovery needed" while its action is open.
//   - The hold is a recovery action (GET /api/issues/:id/recovery-actions) whose cause is one of
//     EXECUTION_RECONCILIATION_CAUSES; services/execution-blocker.js keeps deferring every wake while it stands.
//   - Nothing clears it by itself. The way out is POST /api/issues/:id/recovery-actions/resolve with an
//     executionReconciliation (routes/issues.js), as the owner. Its validator (shared/dist/validators/issue.js
//     resolveIssueRecoveryActionSchema) and the route take exactly the body `resolveBody` builds:
//     outcome "restored" with sourceIssueStatus "todo" (the only status a settled no-replay hold may be
//     reopened with), runId equal to the action's evidence.runId (validateExecutionReconciliation in
//     services/execution-recovery-resolution.js), providerStopped true, an outcome and 20+ characters of evidence.
//     The hand-back gates (assertSafeRecoveryHandBackGates) read only the task: its owner must still be the
//     action's returnOwnerAgentId and no run may hold it; both are checked here before sending.
//   - POST /api/issues/:id/retry does not clear such a hold: it only queues a wake, and the blocker defers it
//     ("These incidents require an explicit reconciliation, never a generic Retry").
// Every id sent is one the board returned; nothing an agent wrote is read or sent.
import { descendants, goalsOf, loadIssues } from "./goals.mjs";

// shared/dist/types/execution-projection.js EXECUTION_RECONCILIATION_CAUSES (a test compares the two).
export const RECONCILIATION_CAUSES = [
  "uncertain_provider_action", "uncertain_external_action", "uncertain_control_plane_action",
  "completed_action_context_missing", "continuation_evidence_incomplete", "execution_finalization_deadline_exceeded",
  "execution_recovery_budget_exhausted", "provider_effect_inventory_unavailable", "provider_failure_meaning_unverified",
  "provider_ownership_unverified", "native_provider_terminal_failed", "native_event_replay_conflict",
  "native_session_cleanup_quarantined", "native_session_retry_exhausted", "native_restart_recovery_blocked",
  "native_continuation_requires_reconciliation", "legacy_execution_requires_reconciliation",
];
const CAUSES = new Set(RECONCILIATION_CAUSES);

export const SWEEP_MS = 60000;
export const MAX_TRIES = 3;
// At most this many hand-backs of one task in any 24 hours: a hold that keeps coming back after each one is
// shown to the owner instead of waking the agent again and again.
export const MAX_HANDBACKS = 3;
export const HANDBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
const START_DELAY_MS = 5000;
const NEVER_RAN_WITHIN_MS = 5000;
const SUPPRESSED = "legacy_disposition_repair_suppressed";
const TERMINAL = new Set(["failed", "interrupted", "timed_out", "cancelled"]);
const OPEN = (i) => i && i.status !== "done" && i.status !== "cancelled";
// Statuses a hand-back to "todo" may come from; a task under review is left to the owner.
const HANDABLE = new Set(["todo", "backlog", "in_progress", "blocked"]);

const enc = encodeURIComponent;
const ms = (t) => (t ? Date.parse(t) : NaN);

// The recovery action behind a hold: an open one with a reconciliation cause, else a settled no-replay one,
// preferring the one about `runId`. Null when none (the hold is then only the board's projection).
export function holdingAction(list, runId) {
  const all = [list?.active, ...(Array.isArray(list?.actions) ? list.actions : [])].filter((a) => a && a.id);
  const holding = all.filter((a) => CAUSES.has(a.cause) && !a.evidence?.executionReconciliation
    && (["active", "escalated"].includes(a.status) || a.evidence?.automaticRecovery?.replay === "blocked"));
  return holding.find((a) => (a.evidence?.runId ?? a.evidence?.sourceRunId) === runId) || holding[0] || null;
}

// "never_ran" when the run behind the hold provably did nothing: no process, no output, no log, and it was
// either suppressed by the board before it began or ended within 5 seconds of being claimed. Else "other".
export function classify(run) {
  if (!run || !TERMINAL.has(run.status)) return "other";
  if (run.processPid != null || run.processGroupId != null || run.processStartedAt) return "other";
  if (Number(run.logBytes) > 0 || run.stdoutExcerpt || run.stderrExcerpt) return "other";
  if (run.lastOutputAt || Number(run.lastOutputBytes) > 0 || Number(run.lastOutputSeq) > 0 || run.sessionIdAfter) return "other";
  if (run.errorCode === SUPPRESSED) return "never_ran";
  const claimed = ms(run.startedAt);
  const ended = ms(run.finishedAt);
  if (!run.startedAt && run.finishedAt) return "never_ran";
  if (Number.isFinite(claimed) && Number.isFinite(ended) && ended - claimed >= 0 && ended - claimed <= NEVER_RAN_WITHIN_MS) return "never_ran";
  return "other";
}

// The evidence the board records, from the run's own fields only.
export function evidenceOf(run) {
  const claimed = ms(run.startedAt);
  const ended = ms(run.finishedAt);
  const when = Number.isFinite(claimed) && Number.isFinite(ended)
    ? `${((ended - claimed) / 1000).toFixed(1)} s after it was claimed`
    : "before it was claimed";
  const code = run.errorCode ? ` (error code ${run.errorCode})` : "";
  return `Run ${String(run.id).slice(0, 8)} was ${run.status} ${when}${code} with no process, no output and no log; nothing was performed.`;
}

// The resolve request that hands a never-started hold back to the task's owner agent.
export function resolveBody(action, run) {
  return {
    actionId: action.id,
    outcome: "restored",
    sourceIssueStatus: "todo",
    executionReconciliation: {
      runId: run.id,
      providerStopped: true,
      actionOutcome: "not_performed",
      outcomeEvidence: evidenceOf(run),
    },
    resolutionNote: "The home screen found that the stopped run never started, so it handed the task back to its agent.",
  };
}

// True when the board's hand-back gates and reconciliation checks can pass for this task right now.
function canHandBack(issue, action, run) {
  const runId = action.evidence?.runId ?? action.evidence?.sourceRunId;
  return HANDABLE.has(issue.status)
    && !!issue.assigneeAgentId && action.returnOwnerAgentId === issue.assigneeAgentId
    && run.id === runId && run.agentId === issue.assigneeAgentId
    && (run.issueId == null || run.issueId === issue.id)
    && !issue.checkoutRunId && !issue.executionRunId
    && !action.evidence?.workspaceRestoreRecovery && !action.evidence?.workspaceRestoreFailure;
}

// options: board (ctx.board), ids (ctx.ids), decisions (ctx.decisions, optional), log, intervalMs, now, and
// onIssues: called with the board's whole list of tasks once each sweep has read it (lib/app.mjs closes the
// generation batches of cancelled tasks there, lib/batches.mjs closeFinishedBatches); a failure in it is logged only.
export function createUnstick({ board, ids, decisions = null, log = () => {}, intervalMs = SWEEP_MS, now = () => Date.now(), onIssues = null }) {
  const checked = new Map(); // issue id -> time of its last check
  const tries = new Map(); // action id -> failed hand-backs
  const handbacks = new Map(); // issue id -> times (ms) of its successful hand-backs, also kept in decisions
  const shown = new Set(); // action ids already logged as left to the owner
  const holds = new Map(); // issue id -> what the owner sees
  let running = null;
  let timers = [];

  const triesOf = (actionId) => {
    if (tries.has(actionId)) return tries.get(actionId);
    const saved = decisions?.get(`unstick:${actionId}`);
    return Number.isInteger(saved?.tries) ? saved.tries : 0;
  };
  const setTries = (actionId, n) => {
    tries.set(actionId, n);
    try { decisions?.set(`unstick:${actionId}`, { tries: n, at: new Date(now()).toISOString() }); } catch { /* memory still counts */ }
  };

  // The successful hand-backs of a task within the last 24 hours.
  const handbacksOf = (issueId) => {
    let list = handbacks.get(issueId);
    if (!list) {
      const saved = decisions?.get(`unstick-handbacks:${issueId}`);
      list = Array.isArray(saved?.at) ? saved.at.map((t) => Date.parse(t)).filter(Number.isFinite) : [];
    }
    return list.filter((t) => now() - t < HANDBACK_WINDOW_MS);
  };
  const addHandback = (issueId) => {
    const list = [...handbacksOf(issueId), now()];
    handbacks.set(issueId, list);
    try { decisions?.set(`unstick-handbacks:${issueId}`, { at: list.map((t) => new Date(t).toISOString()) }); } catch { /* memory still counts */ }
  };

  async function checkOne(issue, goal, seen) {
    seen.add(issue.id);
    const last = checked.get(issue.id);
    if (last !== undefined && now() - last < intervalMs - 1000) return;
    checked.set(issue.id, now());
    const exec = await board.get(`/api/issues/${enc(issue.id)}/execution`);
    if (exec?.execution?.phase !== "recovery_needed") { holds.delete(issue.id); return; }
    let action = null;
    try { action = holdingAction(await board.get(`/api/issues/${enc(issue.id)}/recovery-actions`), exec.runId); } catch { action = null; }
    const runId = action ? (action.evidence?.runId ?? action.evidence?.sourceRunId) : exec.runId;
    let run = null;
    if (typeof runId === "string" && runId) {
      try { run = await board.get(`/api/heartbeat-runs/${enc(runId)}`); } catch { run = null; }
    }
    const ref = issue.identifier || "a task";
    // A never-started hold is handed back only when the board's checks can pass now (else it is shown, and looked
    // at again next sweep) and the task has not been handed back 3 times in the last 24 hours (else it is shown).
    if (action && run && classify(run) === "never_ran" && triesOf(action.id) < MAX_TRIES
      && canHandBack(issue, action, run) && handbacksOf(issue.id).length < MAX_HANDBACKS) {
      try {
        await board.post(`/api/issues/${enc(issue.id)}/recovery-actions/resolve`, resolveBody(action, run));
        addHandback(issue.id);
        holds.delete(issue.id);
        log(`unstick: ${ref} was held by the board although its last run never started; handed it back to its agent`);
        return;
      } catch {
        const n = triesOf(action.id) + 1;
        setTries(action.id, n);
        log(`unstick: ${ref} could not be handed back (try ${n} of ${MAX_TRIES})`);
        if (n < MAX_TRIES) return;
      }
    }
    const key = action?.id || `run:${runId}`;
    if (!shown.has(key)) { shown.add(key); log(`unstick: ${ref} is held by the board; left to the owner`); }
    holds.set(issue.id, {
      issueId: issue.id, identifier: issue.identifier || null, title: issue.title || null,
      goalId: goal.id, goalTitle: goal.title || null, actionId: action?.id || null,
      when: run?.finishedAt || action?.updatedAt || issue.updatedAt || null,
    });
  }

  async function sweepOnce() {
    const id = ids();
    if (!id?.companyId || !id?.projectId) return;
    let issues;
    try { issues = await loadIssues({ board }, id.companyId); } catch { return; }
    if (typeof onIssues === "function") {
      try { onIssues(issues); } catch (e) { log(`unstick: the after-sweep step failed: ${String(e?.code || e?.message || e).split("\n")[0]}`); }
    }
    const seen = new Set();
    for (const goal of goalsOf(issues, id).filter(OPEN)) {
      for (const issue of [goal, ...descendants(issues, goal.id).filter(OPEN)]) {
        try {
          await checkOne(issue, goal, seen);
        } catch (e) {
          // The board is off or too slow: stop here, keep what is known, and look again next sweep.
          if (e?.code === "board_off") return;
        }
      }
    }
    for (const issueId of [...holds.keys()]) if (!seen.has(issueId)) holds.delete(issueId);
    for (const issueId of [...checked.keys()]) if (!seen.has(issueId)) checked.delete(issueId);
  }

  return {
    // One sweep at a time: a call while one runs waits for that one.
    sweep() {
      if (!running) running = sweepOnce().catch(() => {}).finally(() => { running = null; });
      return running;
    },
    // What the owner sees: one entry per held task or step, newest first.
    holds: () => [...holds.values()],
    // Forget the holds of a task the owner has stopped.
    forget(goalId) { for (const [k, v] of holds) if (v.goalId === goalId) holds.delete(k); },
    start() {
      if (timers.length) return;
      const first = setTimeout(() => this.sweep(), START_DELAY_MS);
      const every = setInterval(() => this.sweep(), intervalMs);
      first.unref?.(); every.unref?.();
      timers = [first, every];
    },
    stop() { for (const t of timers) { clearTimeout(t); clearInterval(t); } timers = []; },
  };
}
