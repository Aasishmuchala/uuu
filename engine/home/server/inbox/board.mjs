// Inbox source "board": what the board says needs the owner (GET /api/companies/:id/attention),
// mapped to InboxItem as in CONTRACTS 9.3.
import { randomUUID } from "node:crypto";
import { HomeError } from "../lib/errors.mjs";
import { isGoal, loadIssues, rootOf } from "../lib/goals.mjs";

const APPROVAL = new Set(["approval"]);
const REVIEW = new Set(["review"]);
const QUESTION = new Set(["issue_thread_interaction", "decision"]);
const PROBLEM = new Set(["failed_run", "recovery_action", "agent_error_alert", "blocker_attention"]);

const act = (id, label, style, needsNote = false) => ({ id, label, style, needsNote });

function who(item) {
  return item.originAgentName ? `The ${item.originAgentName}` : "An agent";
}

function issueIdOf(item) {
  return item.relatedIssue?.id || item.subject?.metadata?.issueId || null;
}

function summaryOf(item) {
  const task = item.relatedIssue?.title;
  const about = task ? ` It is about "${task}".` : "";
  const k = item.sourceKind;
  if (APPROVAL.has(k)) return `${who(item)} is waiting for your approval.${about}`;
  if (REVIEW.has(k)) return task ? `${who(item)} finished "${task}" and it is waiting for your review.` : `${who(item)} finished a task and it is waiting for your review.`;
  if (QUESTION.has(k)) return `${who(item)} asked you a question.${about}`;
  if (k === "failed_run") return task ? `${who(item)} tried several times and could not finish "${task}".` : `${who(item)} tried several times and could not finish its work.`;
  if (k === "recovery_action") return task ? `"${task}" is stuck and needs you to decide what happens next.` : "A task is stuck and needs you to decide what happens next.";
  if (k === "agent_error_alert") return `${who(item)} stopped with an error.${about}`;
  if (k === "blocker_attention") return task ? `"${task}" is blocked and is waiting on you.` : "A task is blocked and is waiting on you.";
  const why = String(item.whyNow || "").trim();
  return `${why || "The board flagged this for you."}${about}`;
}

function mapItem(item, link) {
  const k = item.sourceKind;
  let kind = "problem";
  let actions;
  if (APPROVAL.has(k)) {
    kind = "approval";
    actions = [act("approve", "Approve", "primary"), act("send_back", "Send back", "plain", true), act("reject", "Reject", "danger")];
  } else if (REVIEW.has(k)) {
    kind = "approval";
    actions = [act("approve", "Approve", "primary"), act("send_back", "Send back", "plain", true)];
  } else if (QUESTION.has(k)) {
    kind = "question";
    actions = [act("accept", "Accept", "primary"), act("answer", "Answer", "plain", true), act("reject", "Decline", "plain")];
  } else if (PROBLEM.has(k)) {
    actions = [];
    if (issueIdOf(item)) actions.push(act("retry", "Try again", "primary"), act("answer", "Reply", "plain", true));
    actions.push(act("dismiss", "Hide", "plain"));
  } else {
    actions = [act("dismiss", "Hide", "plain")];
  }
  const high = kind === "problem" && ["high", "critical"].includes(String(item.severity || "").toLowerCase());
  const details = [];
  if (item.relatedIssue?.title) details.push({ label: "Task", value: item.relatedIssue.title });
  return {
    id: `board:${item.id}`,
    source: "board",
    kind,
    title: item.subject?.title || "Something needs you",
    raisedBy: item.originAgentName || "The board",
    when: item.activityAt || item.updatedAt || item.createdAt || null,
    summary: summaryOf(item),
    severity: high ? "high" : "normal",
    details,
    actions,
    link,
  };
}

async function list(ctx) {
  const companyId = await ctx.board.companyId();
  const data = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/attention`);
  const raw = Array.isArray(data?.items) ? data.items : [];
  const visible = raw.filter((i) => i && i.id && !(i.dismissalKey && ctx.decisions.get(`dismissed:${i.dismissalKey}`)));
  let issues = [];
  const ids = ctx.ids();
  if (ids?.projectId && visible.some((i) => issueIdOf(i))) {
    try { issues = await loadIssues(ctx, companyId); } catch { issues = []; }
  }
  const items = visible.map((i) => {
    const iid = issueIdOf(i);
    const root = iid && ids ? rootOf(issues, iid) : null;
    const link = root && isGoal(root, ids) ? { page: "goals", id: root.id } : null;
    const out = mapItem(i, link);
    Object.defineProperty(out, "_raw", { enumerable: false, value: i });
    return out;
  });
  return { items };
}

async function actOn(ctx, itemId, action, note) {
  const raw = ctx.item._raw;
  const k = raw.sourceKind;
  const enc = encodeURIComponent;
  const issueId = issueIdOf(raw);
  if (action === "dismiss") {
    if (!raw.dismissalKey) throw new HomeError(409, "This item cannot be hidden.", "Deal with it on its own page instead.", "cannot_dismiss");
    ctx.decisions.set(`dismissed:${raw.dismissalKey}`, new Date().toISOString());
    return { message: "Hidden from your inbox." };
  }
  if (APPROVAL.has(k)) {
    const path = `/api/approvals/${enc(raw.subject.id)}`;
    const body = note ? { decisionNote: note } : {};
    if (action === "approve") { await ctx.board.post(`${path}/approve`, body); return { message: "Approved." }; }
    if (action === "send_back") { await ctx.board.post(`${path}/request-revision`, { decisionNote: note }); return { message: "Sent back with your note." }; }
    if (action === "reject") { await ctx.board.post(`${path}/reject`, body); return { message: "Rejected." }; }
  }
  if (REVIEW.has(k) && issueId) {
    const path = `/api/issues/${enc(issueId)}/stalled-review-decision`;
    if (action === "approve") { await ctx.board.post(path, note ? { action: "approve", note } : { action: "approve" }); return { message: "Approved. The task is marked finished." }; }
    if (action === "send_back") { await ctx.board.post(path, { action: "request_changes", note }); return { message: "Sent back with your note." }; }
  }
  if (QUESTION.has(k)) {
    const iid = raw.subject?.metadata?.interactionId || raw.subject?.id;
    const qIssue = raw.subject?.metadata?.issueId || issueId;
    if (!iid || !qIssue) throw new HomeError(409, "This question can no longer be answered here.", "Refresh the inbox.", "question_gone");
    const path = `/api/issues/${enc(qIssue)}/interactions/${enc(iid)}`;
    if (action === "accept") { await ctx.board.post(`${path}/accept`, {}); return { message: "Accepted." }; }
    if (action === "reject") { await ctx.board.post(`${path}/reject`, {}); return { message: "Declined." }; }
    if (action === "answer") { await ctx.board.post(`${path}/respond`, { answers: [], summaryMarkdown: note }); return { message: "Your answer was passed on." }; }
  }
  if (PROBLEM.has(k) && issueId) {
    if (action === "retry") {
      const observedRunId = raw.subject?.kind === "run" ? raw.subject.id : null;
      await ctx.board.post(`/api/issues/${enc(issueId)}/retry`, { idempotencyKey: randomUUID(), observedRunId });
      return { message: "The task will be tried again." };
    }
    if (action === "answer") { await ctx.board.post(`/api/issues/${enc(issueId)}/comments`, { body: note }); return { message: "Your reply was added to the task." }; }
  }
  throw new HomeError(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "board", list, act: actOn };
