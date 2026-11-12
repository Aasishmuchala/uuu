// Waiting its turn (M63). Every agent works on one thing at a time, and every task goes through the Chief of
// staff, so a question, a job or a task waits while other work is ahead of it. What the screen says about that is
// worked out here from the board's records only (docs/adr/0007), never from text an agent wrote:
//   - the runs the board lists as queued or running (GET /api/companies/:id/live-runs: `status` "queued" or
//     "running", `agentId`, `issueId`, `createdAt`; paperclip 2026.1106.0 routes/agents.js), in the order they
//     were made;
//   - the board's parent links, so a step's run counts for its top task, and two steps of one task are one task;
//   - for a block the owner has already answered: the time the board blocked the task, the owner's own comments
//     (a comment with no agent as its author) and the home server's own record `acted:<task id>`, written when the
//     owner acts on a Needs-you item of the task (lib/inbox.mjs).
// `queue` is { ahead: n }: the number of tasks ahead in the agent's line. It is null once the task's own run is
// running (the present words then hold) or when the board did not say.

// How long an answered block is shown as waiting its turn before the board has queued the agent's run. The board
// queues it at once; when none shows up in this time, the card comes back.
export const ANSWERED_GRACE_MS = 2 * 60 * 1000;

const ms = (t) => { const v = Date.parse(t || ""); return Number.isFinite(v) ? v : NaN; };
const madeAt = (r) => ms(r && (r.createdAt || r.startedAt));
export const isQueued = (r) => !!r && r.status === "queued";
const enc = encodeURIComponent;

// A root finder over a list of issues: issue id -> the id of its top task (itself when it has no parent, or when
// it is unknown).
export function rootFinder(issues) {
  const byId = new Map((Array.isArray(issues) ? issues : []).filter((i) => i && i.id).map((i) => [i.id, i]));
  const memo = new Map();
  return (issueId) => {
    if (typeof issueId !== "string" || !issueId) return null;
    if (memo.has(issueId)) return memo.get(issueId);
    let cur = byId.get(issueId);
    const seen = new Set();
    while (cur && cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    const out = cur ? cur.id : issueId;
    memo.set(issueId, out);
    return out;
  };
}

// aheadIn(liveRuns, { agentId, mine, rootOf }) -> { ahead } | null.
// `mine`: the issue ids of the task and its steps (a Set). null when one of mine is running for this agent (it has
// started). Ahead: every other task the agent is running, and every other task queued before mine (all of them,
// when nothing of mine is queued yet: a new task goes to the end of the line). A run with no task counts as one.
export function aheadIn(liveRuns, { agentId, mine = new Set(), rootOf = (id) => id } = {}) {
  if (typeof agentId !== "string" || !agentId) return null;
  const runs = (Array.isArray(liveRuns) ? liveRuns : []).filter((r) => r && r.agentId === agentId);
  const own = runs.filter((r) => mine.has(r.issueId));
  if (own.some((r) => !isQueued(r))) return null;
  const times = own.map(madeAt).filter(Number.isFinite);
  const myTurn = own.length && times.length ? Math.min(...times) : Infinity;
  const tasks = new Set();
  for (const r of runs) {
    if (mine.has(r.issueId)) continue;
    // A queued run made after mine waits behind it. One whose time is not known is counted: never too few.
    if (isQueued(r) && Number.isFinite(madeAt(r)) && madeAt(r) >= myTurn) continue;
    tasks.add(r.issueId ? `t:${rootOf(r.issueId) || r.issueId}` : `r:${r.id}`);
  }
  return { ahead: tasks.size };
}

// The runs of a task's tree that are queued or running: { running, queued, agentId } (agentId: the agent of the
// first queued run, else of the first running one, else null).
export function treeRuns(liveRuns, mine) {
  const runs = (Array.isArray(liveRuns) ? liveRuns : []).filter((r) => r && mine.has(r.issueId));
  const queued = runs.filter(isQueued);
  const running = runs.filter((r) => !isQueued(r));
  const first = queued[0] || running[0] || null;
  return { running: running.length, queued: queued.length, agentId: first && typeof first.agentId === "string" ? first.agentId : null };
}

// True when a block the board shows is one the owner has already answered: a run of the task is queued or
// running, or the owner acted on the task after it was blocked and less than ANSWERED_GRACE_MS ago. A block whose
// time is not known counts as older than the owner's action.
export function answeredBlock({ live = false, blockedAt = null, ownerAt = null, now = Date.now() } = {}) {
  if (live) return true;
  const o = ms(ownerAt);
  if (!Number.isFinite(o) || now - o >= ANSWERED_GRACE_MS || o > now + 60000) return false;
  const b = ms(blockedAt);
  return !Number.isFinite(b) || o > b;
}

// The newest of the owner's own comments (no agent as author) in a list, as an ISO time, or null.
export function ownerCommentAt(comments) {
  let best = NaN;
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!c || c.authorAgentId) continue;
    const t = ms(c.createdAt);
    if (Number.isFinite(t) && !(t <= best)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

// The newer of two ISO times (either may be missing), or null.
export function newer(a, b) {
  const x = ms(a);
  const y = ms(b);
  if (!Number.isFinite(x)) return Number.isFinite(y) ? new Date(y).toISOString() : null;
  if (!Number.isFinite(y)) return new Date(x).toISOString();
  return new Date(Math.max(x, y)).toISOString();
}

// The home server's record of the owner's newest action on a task (lib/inbox.mjs), as an ISO time, or null.
export function actedAt(decisions, goalId) {
  const v = decisions && typeof decisions.get === "function" && goalId ? decisions.get(`acted:${goalId}`) : null;
  return typeof v === "string" && Number.isFinite(ms(v)) ? v : null;
}

// chiefQueue(ctx) -> { ahead } | null: how many tasks the Chief of staff has now, running or queued; a task given
// to it now waits behind all of them. Reads the board's live runs (and, only when there is more than one, its
// tasks, so two steps of one task count once). null when the board cannot say.
export async function chiefQueue(ctx) {
  const ids = typeof ctx.ids === "function" ? ctx.ids() : null;
  const chief = ids?.agents?.["chief-of-staff"];
  if (!ids?.companyId || !chief) return null;
  try {
    const live = await ctx.board.get(`/api/companies/${enc(ids.companyId)}/live-runs`);
    const runs = (Array.isArray(live) ? live : []).filter((r) => r && r.agentId === chief);
    let rootOf = (id) => id;
    if (runs.filter((r) => r.issueId).length > 1) {
      const issues = await ctx.board.get(`/api/companies/${enc(ids.companyId)}/issues?limit=1000`);
      rootOf = rootFinder(Array.isArray(issues) ? issues : []);
    }
    return aheadIn(runs, { agentId: chief, rootOf });
  } catch {
    return null;
  }
}
