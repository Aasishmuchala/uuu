// Inbox source "board": what the board says needs the owner (GET /api/companies/:id/attention),
// mapped to InboxItem as in CONTRACTS 9.3.
// A question an agent raises through the board (an issue-thread interaction) is offered only what the board
// takes for its kind (paperclip 2026.1106.0, routes/issues.js and services/issue-thread-interactions.js):
//   ask_user_questions                    -> respond {answers: [{questionId, optionIds, otherText?}]}, one per
//                                            question; accept and reject answer 422
//   request_confirmation, request_checkbox_confirmation, suggest_tasks -> accept {} or reject {}; respond 422
//   anything else (connection_intent, unknown) -> nothing on the board; Hide only
// The records are read from GET /api/issues/:id/interactions, so the owner sees what an answer or an Accept does:
// each question and its choices, the words a confirmation asks to confirm (and its boxes, ticked as Accept sends
// them), and every task a suggestion would make (title and who it is for, by the agent's name in the company
// file). Accept is offered only when all of it can be shown plainly (shared/dist/validators/issue.js
// suggestTasksPayloadSchema, requestConfirmationPayloadSchema, requestCheckboxConfirmationPayloadSchema);
// otherwise Decline and Hide only. The card's `version` (CONTRACTS 9.3a) is a hash of all it shows, so a card
// that changed after the owner saw it is not acted on. Every board card offers Hide.
// A task the board has put on hold (lib/unstick.mjs) is one problem item per task. The board takes no generic
// Retry for it (a retry only queues a wake the hold defers), and starting it again needs someone to say what the
// stopped run did, which the home screen cannot know; so the item offers Stop this task and Reply only. The
// board's own recovery item for a hold of that kind loses its "Try again" for the same reason.
// A write the board may have made although its answer did not arrive in time is looked up again before it is
// reported as failed, so the owner is never told "the board is off" for an answer that was recorded.
// The board's "blocked, waiting on you" card (blocker_attention) stays up after the owner has answered, for as long
// as the agent's run waits its turn. Such a card is left out only once the owner has answered after the block (the
// home server's `acted:` record or the owner's own comment), and then while a run of the blocked task (or of a task
// above it) is queued or running, or for a moment after the answer (lib/turn.mjs answeredBlock); a run with no
// answer from the owner never hides it. The task
// then shows as waiting its turn (lib/tasks.mjs answeredTurn). When the block is still there with nothing queued or running, the card is back.
// Only board records decide it: the runs the board lists, who wrote a comment, when the board blocked the task,
// and the home server's own record of the owner's action.
import { randomUUID } from "node:crypto";
import { HomeError } from "../lib/errors.mjs";
import { isGoal, loadIssues, rootOf } from "../lib/goals.mjs";
import { versionOf } from "../lib/inbox.mjs";
import { recordOwnerAnswer } from "../lib/owner-text.mjs";
import { stopTask } from "../lib/stop.mjs";
import { loadRoles } from "../lib/team.mjs";
import { actedAt, answeredBlock, newer, ownerCommentAt, treeRuns } from "../lib/turn.mjs";
import { RECONCILIATION_CAUSES } from "../lib/unstick.mjs";

const APPROVAL = new Set(["approval"]);
// The one approval type the home screen may approve: an agent asking for the owner's yes to something it
// described. Every other type (paperclip 2026.1106.0: hire_agent, approve_ceo_strategy,
// budget_override_required, and anything unknown or missing) changes the company itself; it is shown as a
// high-severity item with Reject (and Hide) only.
const PLAIN_APPROVAL = "request_board_approval";
const APPROVAL_KINDS = {
  hire_agent: "It asked to add a new agent.",
  approve_ceo_strategy: "It asked you to approve a company strategy.",
  budget_override_required: "It asked to spend over its budget.",
};
const REVIEW = new Set(["review"]);
const QUESTION = new Set(["issue_thread_interaction", "decision"]);
const ASK = "ask_user_questions";
const ACCEPTABLE = new Set(["request_confirmation", "request_checkbox_confirmation", "suggest_tasks"]);
const QUESTIONS_MAX = 20; // the board takes at most 20 answers
const TEXT_MAX = 1000;
const SUGGESTED_MAX = 50; // suggestTasksPayloadSchema: at most 50 tasks
const BOXES_MAX = 50;
const MORE_MAX = 2000; // a confirmation's details longer than this cannot be shown whole: no Accept
const PROBLEM = new Set(["failed_run", "recovery_action", "agent_error_alert", "blocker_attention"]);
const HOLD = "execution_hold";
const HELD_CAUSES = new Set(RECONCILIATION_CAUSES);

const act = (id, label, style, needsNote = false) => ({ id, label, style, needsNote });
const HIDE = () => act("dismiss", "Hide", "plain");

// The decisions key that hides an item: the board's own dismissal key, else one the home server makes from the
// item's own id (a hold: its goal and the action behind it, so a new hold is shown again).
function hideKey(raw) {
  if (raw.sourceKind === HOLD) return `dismissed:hold:${raw.goalId}:${raw.actionId || raw.issueId}`;
  return raw.dismissalKey ? `dismissed:${raw.dismissalKey}` : `dismissed:board-item:${raw.id}`;
}

const cap = (v, n = TEXT_MAX) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function who(item) {
  const name = item.originAgentName || item._agentName;
  return name ? `The ${name}` : "An agent";
}

// The kind of an interaction: from its record, else the attention item, else what the board offers on it.
export function interactionKind(item, record) {
  const k = record?.kind || item?.subject?.metadata?.kind;
  if (typeof k === "string" && k) return k;
  const verbs = (Array.isArray(item?.decisionVerbs) ? item.decisionVerbs : []).map((v) => v && v.id);
  if (verbs.includes("respond")) return ASK;
  if (verbs.includes("accept")) return "request_confirmation";
  return null;
}

// The questions of an ask_user_questions record, as the home screen shows them:
// [{ id, prompt, help, mode: "single"|"multi"|"text", required, options: [{ id, label, description }], allowText }].
// A question is "text" when the board's own form says so, or when its only options are "type an answer" ones.
export function questionsOf(record) {
  const list = record?.payload?.questions;
  if (!Array.isArray(list) || !list.length) return null;
  const canonical = new Map((Array.isArray(record.payload.questionSet?.questions) ? record.payload.questionSet.questions : [])
    .filter((q) => q && typeof q.id === "string").map((q) => [q.id, q]));
  const out = [];
  for (const q of list.slice(0, QUESTIONS_MAX)) {
    if (!q || typeof q.id !== "string" || !q.id) return null;
    const c = canonical.get(q.id);
    const options = Array.isArray(q.options) ? q.options.filter((o) => o && typeof o.id === "string" && o.id) : [];
    const choices = options.filter((o) => !o.freeText);
    const text = c ? c.answerMode === "text" : choices.length === 0;
    const multi = c ? c.answerMode === "multi_select" : q.selectionMode === "multi";
    out.push({
      id: q.id,
      prompt: cap(q.prompt || c?.prompt) || "The agent did not write the question.",
      help: cap(q.helpText || c?.helpText) || null,
      mode: text ? "text" : multi ? "multi" : "single",
      required: c ? c.required === true : q.required === true,
      options: text ? [] : choices.map((o) => ({ id: o.id, label: cap(o.label, 200) || o.id, description: cap(o.description, 400) || null })),
      allowText: text || c?.customAnswer?.enabled === true || q.allowOther === true || options.some((o) => o.freeText),
    });
  }
  return out;
}

const needsAnswer = (message) => new HomeError(400, message, "Answer each question, then send.", "needs_answer");

// The answers the board takes for the owner's note: one per question, in the board's order. The note is either
// what the decision card sends for a question item (JSON: {"answers": {"<question id>": {"optionIds": [], "text": ""}}})
// or plain words, which go as the written answer to every question that takes one.
export function answersFor(questions, note) {
  const raw = String(note ?? "").trim();
  let picks = null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.answers === "object" && parsed.answers && !Array.isArray(parsed.answers)) picks = parsed.answers;
    } catch { picks = null; }
  }
  if (!picks) {
    if (!raw) throw needsAnswer("This needs your answer.");
    picks = Object.fromEntries(questions.filter((q) => q.allowText).map((q) => [q.id, { text: raw }]));
  }
  const answers = [];
  for (const q of questions) {
    const p = Object.hasOwn(picks, q.id) && picks[q.id] && typeof picks[q.id] === "object" ? picks[q.id] : {};
    const text = typeof p.text === "string" ? p.text.trim() : "";
    const chosen = [...new Set(Array.isArray(p.optionIds) ? p.optionIds.filter((x) => typeof x === "string") : [])];
    const known = new Set(q.options.map((o) => o.id));
    if (chosen.some((x) => !known.has(x))) throw needsAnswer("One of the choices is not offered any more.");
    if (q.mode === "single" && chosen.length > 1) throw needsAnswer("Pick only one choice for a question that takes one.");
    if (text && !q.allowText) throw needsAnswer("A question takes only one of its choices, not written words.");
    if (q.mode === "single" && text && chosen.length) throw needsAnswer("Pick a choice or write your own answer, not both.");
    if (q.mode === "text") {
      if (text) answers.push({ questionId: q.id, optionIds: [], otherText: text });
    } else if (chosen.length || text) {
      answers.push(text ? { questionId: q.id, optionIds: chosen, otherText: text } : { questionId: q.id, optionIds: chosen });
    }
    if (q.required && !answers.some((a) => a.questionId === q.id)) throw needsAnswer("Every question needs an answer before it can be sent.");
  }
  if (!answers.length) throw needsAnswer("This needs your answer.");
  return answers;
}

// The approval's type, as the board reports it on the attention item.
function approvalTypeOf(item) {
  const t = item?.subject?.metadata?.type ?? item?.detail?.approvalType;
  return typeof t === "string" ? t : null;
}

const isPlainApproval = (item) => approvalTypeOf(item) === PLAIN_APPROVAL;

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
  if (APPROVAL.has(k) && !isPlainApproval(item)) {
    actions = [act("reject", "Reject", "danger"), HIDE()];
    const details = [{ label: "What it asked", value: APPROVAL_KINDS[approvalTypeOf(item)] || "It asked for a change the home screen does not approve." }];
    if (item.subject?.title) details.push({ label: "Its title", value: String(item.subject.title).slice(0, 200) });
    if (item.relatedIssue?.title) details.push({ label: "Task", value: item.relatedIssue.title });
    return {
      id: `board:${item.id}`,
      source: "board",
      kind: "approval",
      title: "An agent asked for something the home screen will not approve",
      raisedBy: item.originAgentName || "The board",
      when: item.activityAt || item.updatedAt || item.createdAt || null,
      summary: `${who(item)} asked for something the home screen will not approve. ${APPROVAL_KINDS[approvalTypeOf(item)] || "It is not a plain request for your approval."} Reject it unless you expected it.`,
      severity: "high",
      details,
      actions,
      link,
    };
  }
  if (APPROVAL.has(k)) {
    kind = "approval";
    actions = [act("approve", "Approve", "primary"), act("send_back", "Send back", "plain", true), act("reject", "Reject", "danger"), HIDE()];
  } else if (REVIEW.has(k)) {
    kind = "approval";
    actions = [act("approve", "Approve", "primary"), act("send_back", "Send back", "plain", true), HIDE()];
  } else if (QUESTION.has(k)) {
    kind = "question";
    const ik = k === "issue_thread_interaction" ? interactionKind(item, item._record) : null;
    if (ik === ASK && item._questions) actions = [act("answer", "Answer", "primary", true), HIDE()];
    else if (ACCEPTABLE.has(ik) && item._card) actions = [act("accept", "Accept", "primary"), act("reject", "Decline", "plain"), HIDE()];
    else if (ACCEPTABLE.has(ik)) actions = [act("reject", "Decline", "plain"), HIDE()];
    else actions = [HIDE()];
  } else if (PROBLEM.has(k)) {
    actions = [];
    const held = k === "recovery_action" && HELD_CAUSES.has(item.subject?.metadata?.cause);
    if (issueIdOf(item) && !held) actions.push(act("retry", "Try again", "primary"));
    if (issueIdOf(item)) actions.push(act("answer", "Reply", "plain", true));
    actions.push(HIDE());
  } else {
    actions = [HIDE()];
  }
  const high = kind === "problem" && ["high", "critical"].includes(String(item.severity || "").toLowerCase());
  const details = [];
  if (item.relatedIssue?.title) details.push({ label: "Task", value: item.relatedIssue.title });
  const questions = kind === "question" ? item._questions : null;
  if (questions) {
    questions.forEach((q, i) => {
      const label = questions.length === 1 ? "Question" : `Question ${i + 1}`;
      details.push({ label, value: q.prompt });
      if (q.options.length) details.push({ label: "Choices", value: q.options.map((o) => o.label).join(" · ") });
    });
  } else if (kind === "question" && item._card) {
    details.push(...item._card.details);
  } else if (kind === "question" && ACCEPTABLE.has(interactionKind(item, item._record))) {
    details.push({ label: "Why there is no Accept", value: "The home screen cannot show you all that accepting would do. Decline it, or hide it." });
  } else if (kind === "question" && item.detail?.firstQuestionText) {
    details.push({ label: "Question", value: cap(item.detail.firstQuestionText) });
  }
  const out = {
    id: `board:${item.id}`,
    source: "board",
    kind,
    title: item.subject?.title || "Something needs you",
    raisedBy: item.originAgentName || item._agentName || (kind === "problem" || kind === "question" ? "An agent" : "The board"),
    when: item.activityAt || item.updatedAt || item.createdAt || null,
    summary: summaryOf(item),
    severity: high ? "high" : "normal",
    details,
    actions,
    link,
  };
  if (questions && actions.some((a) => a.id === "answer")) out.questions = questions;
  if (kind === "question" && item._card?.suggested) out.suggested = item._card.suggested;
  // What the owner acts on is what the card shows (CONTRACTS 9.3a).
  if (k === "issue_thread_interaction") {
    out.version = versionOf(JSON.stringify([out.title, out.summary, out.raisedBy, out.details, out.suggested || null,
      out.questions || null, out.actions.map((a) => a.id)]));
  }
  return out;
}

// What an Accept does, shown in full, or null when it cannot be shown completely and plainly (then the card
// offers Decline and Hide only): { details, suggested? }. `nameOf(agentId)` is the agent's name in the company
// file, or null.
export function acceptCard(kind, record, nameOf) {
  const p = record?.payload;
  if (!p || typeof p !== "object") return null;
  if (kind === "suggest_tasks") {
    const tasks = p.tasks;
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > SUGGESTED_MAX) return null;
    const suggested = [];
    for (const t of tasks) {
      if (!t || typeof t !== "object" || typeof t.title !== "string" || !t.title.trim() || t.title.length > 240) return null;
      if (t.assigneeUserId) return null; // a person, not an agent of the company
      let who = "Nobody yet";
      if (t.assigneeAgentId) {
        who = typeof t.assigneeAgentId === "string" ? nameOf(t.assigneeAgentId) : null;
        if (!who) return null;
      }
      suggested.push({ title: cap(t.title, 240), who });
    }
    const n = suggested.length;
    return {
      details: [{ label: "If you accept", value: n === 1 ? "One new task is made, as if you made it:" : `${n} new tasks are made, as if you made them:` }],
      suggested,
    };
  }
  if (kind !== "request_confirmation" && kind !== "request_checkbox_confirmation") return null;
  if (typeof p.prompt !== "string" || !p.prompt.trim() || p.prompt.length > TEXT_MAX) return null;
  // Accepting these would do more than the words say (run a tool, or keep a secret).
  if (p.toolAction || p.secretProposal) return null;
  const details = [{ label: "It asks you to confirm", value: cap(p.prompt) }];
  if (p.detailsMarkdown !== undefined && p.detailsMarkdown !== null) {
    if (typeof p.detailsMarkdown !== "string" || p.detailsMarkdown.length > MORE_MAX) return null;
    if (p.detailsMarkdown.trim()) details.push({ label: "More from the agent", value: cap(p.detailsMarkdown, MORE_MAX) });
  }
  if (kind === "request_checkbox_confirmation") {
    const options = p.options;
    if (!Array.isArray(options) || !options.length || options.length > BOXES_MAX) return null;
    const ticked = new Set(Array.isArray(p.defaultSelectedOptionIds) ? p.defaultSelectedOptionIds : []);
    const on = [];
    const off = [];
    for (const o of options) {
      if (!o || typeof o.id !== "string" || !o.id || typeof o.label !== "string" || !o.label.trim() || o.label.length > 120) return null;
      (ticked.has(o.id) ? on : off).push(cap(o.label, 120));
    }
    details.push({ label: "Ticked if you accept", value: on.length ? on.join(" · ") : "None" });
    if (off.length) details.push({ label: "Left unticked", value: off.join(" · ") });
  }
  return { details };
}

// The name in the company file of an agent, by its board id, or null.
function agentName(ctx, ids, agentId) {
  if (typeof agentId !== "string" || !agentId || !ids?.agents) return null;
  const slug = Object.keys(ids.agents).find((s) => ids.agents[s] === agentId);
  if (!slug) return null;
  try { return loadRoles(ctx.config).find((r) => r.slug === slug)?.name || null; } catch { return null; }
}

// The agent that raised an interaction, as the board records it.
function raiserOf(item, record) {
  return item.subject?.metadata?.createdByAgentId || item.resolverAudience?.createdByAgentId || record?.createdByAgentId || null;
}

// The task an item is about and its ancestors, nearest first, from the board's parent links.
function chainOf(issues, issueId) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = [];
  let cur = issueId;
  while (cur && !out.includes(cur) && out.length < 50) {
    out.push(cur);
    cur = byId.get(cur)?.parentId || null;
  }
  return out;
}

// The interaction records of the tasks that have question items, by interaction id. A task whose list cannot
// be read leaves its questions unread (the item then offers only Hide); it never fails the list.
async function interactionRecords(ctx, items) {
  const byIssue = new Map();
  for (const i of items) {
    if (i.sourceKind !== "issue_thread_interaction") continue;
    const issueId = i.subject?.metadata?.issueId || i.relatedIssue?.id;
    if (issueId) byIssue.set(issueId, true);
  }
  const out = new Map();
  await Promise.all([...byIssue.keys()].map(async (issueId) => {
    try {
      const list = await ctx.board.get(`/api/issues/${encodeURIComponent(issueId)}/interactions`);
      for (const r of Array.isArray(list) ? list : []) if (r && r.id) out.set(r.id, r);
    } catch { /* unread: no questions */ }
  }));
  return out;
}

// The task a blocked card is about: the blocked task the board names, else the card's own subject.
function blockedIdsOf(item) {
  return [item.relatedIssue?.id, item.subject?.metadata?.issueId, item.subject?.id].filter((x) => typeof x === "string" && x);
}

// The ids of the board's blocked cards the owner has already answered (see the top of this file).
async function answeredBlockCards(ctx, items, issues, companyId) {
  const cards = items.filter((i) => i.sourceKind === "blocker_attention");
  if (!cards.length || !issues.length) return new Set();
  let live = null;
  try {
    const l = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/live-runs`);
    live = Array.isArray(l) ? l : null;
  } catch { live = null; }
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out = new Set();
  await Promise.all(cards.map(async (card) => {
    const issue = blockedIdsOf(card).map((id) => byId.get(id)).find(Boolean);
    if (!issue) return;
    const root = rootOf(issues, issue.id);
    if (!root) return;
    // A run of the blocked task itself or of a task above it (where the owner's answer wakes its agent); a
    // sibling step at work does not answer this block.
    const runs = treeRuns(live, new Set(chainOf(issues, issue.id)));
    const blockedAt = issue.blockedTransitionAt || card.activityAt || null;
    let ownerAt = actedAt(ctx.decisions, root.id);
    if (!answeredBlock({ blockedAt, ownerAt })) {
      // The owner's own comments on the blocked task and on its top task (a reply, an ANSWER:), read whether or not
      // a run is live: a run alone never hides the card (lib/turn.mjs answeredBlock).
      for (const id of new Set([issue.id, root.id])) {
        try { ownerAt = newer(ownerAt, ownerCommentAt(await ctx.board.get(`/api/issues/${encodeURIComponent(id)}/comments`))); } catch { /* unread: no answer seen */ }
      }
    }
    if (answeredBlock({ live: runs.running + runs.queued > 0, blockedAt, ownerAt })) out.add(card.id);
  }));
  return out;
}

// One problem item per task the board holds, from what the hold sweep last found.
function holdItems(ctx, ids) {
  const byGoal = new Map();
  const held = new Map(); // goal id -> every held task of it
  for (const h of ctx.home?.unstick?.holds?.() || []) {
    if (!h?.goalId) continue;
    if (!held.has(h.goalId)) held.set(h.goalId, []);
    held.get(h.goalId).push(h.issueId);
    if (byGoal.has(h.goalId)) continue;
    byGoal.set(h.goalId, h);
  }
  return [...byGoal.values()].map((h) => {
    const raw = { sourceKind: HOLD, goalId: h.goalId, issueId: h.issueId, actionId: h.actionId, issueIds: held.get(h.goalId) };
    if (ctx.decisions?.get(hideKey(raw))) return null;
    const details = [];
    if (h.goalTitle) details.push({ label: "Task", value: cap(h.goalTitle, 200) });
    if (h.issueId !== h.goalId && h.title) details.push({ label: "Step", value: cap(h.title, 200) });
    details.push({ label: "What you can do", value: "Stop the task, or reply: your reply stays on the task for its agent." });
    const out = {
      id: `board:hold:${h.goalId}`,
      source: "board",
      kind: "problem",
      title: "A task stopped",
      raisedBy: "The board",
      when: h.when || null,
      summary: "This task stopped and the board will not start it again by itself.",
      severity: "high",
      details,
      actions: [act("stop", "Stop this task", "danger"), act("answer", "Reply", "plain", true), HIDE()],
      link: ids?.projectId ? { page: "goals", id: h.goalId } : null,
    };
    Object.defineProperty(out, "_raw", { enumerable: false, value: raw });
    Object.defineProperty(out, "_about", { enumerable: false, value: h.issueId });
    return out;
  }).filter(Boolean);
}

async function list(ctx) {
  const companyId = await ctx.board.companyId();
  const data = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/attention`);
  const raw = Array.isArray(data?.items) ? data.items : [];
  const holds = holdItems(ctx, ctx.ids());
  // A hidden hold still stands: the board's own item for it stays out of the list too.
  const heldActions = new Set((ctx.home?.unstick?.holds?.() || []).map((h) => h?.actionId).filter(Boolean));
  const visible = raw.filter((i) => i && i.id && !ctx.decisions.get(hideKey(i))
    && !(i.sourceKind === "recovery_action" && heldActions.has(i.subject?.id)));
  let issues = [];
  const ids = ctx.ids();
  if (ids?.projectId && visible.some((i) => issueIdOf(i) || i.sourceKind === "blocker_attention")) {
    try { issues = await loadIssues(ctx, companyId); } catch { issues = []; }
  }
  const [records, answered] = await Promise.all([interactionRecords(ctx, visible), answeredBlockCards(ctx, visible, issues, companyId)]);
  const items = visible.filter((i) => !answered.has(i.id)).map((raw) => {
    const i = { ...raw };
    const record = i.sourceKind === "issue_thread_interaction" ? records.get(i.subject?.metadata?.interactionId || i.subject?.id) : null;
    Object.defineProperty(i, "_record", { enumerable: false, value: record || null });
    const ik = i.sourceKind === "issue_thread_interaction" ? interactionKind(i, record) : null;
    Object.defineProperty(i, "_questions", { enumerable: false, value: record && ik === ASK ? questionsOf(record) : null });
    Object.defineProperty(i, "_card", { enumerable: false, value: ACCEPTABLE.has(ik) ? acceptCard(ik, record, (a) => agentName(ctx, ids, a)) : null });
    if (!i.originAgentName && PROBLEM.has(i.sourceKind)) Object.defineProperty(i, "_agentName", { enumerable: false, value: agentName(ctx, ids, i.relatedIssue?.metadata?.assigneeAgentId) });
    if (!i.originAgentName && QUESTION.has(i.sourceKind)) Object.defineProperty(i, "_agentName", { enumerable: false, value: agentName(ctx, ids, raiserOf(i, record)) });
    const iid = issueIdOf(i);
    const root = iid && ids ? rootOf(issues, iid) : null;
    const link = root && isGoal(root, ids) ? { page: "goals", id: root.id } : null;
    const out = mapItem(i, link);
    Object.defineProperty(out, "_raw", { enumerable: false, value: i });
    // The exact task it is about (a question: the task it was raised on) and that task's ancestors (lib/inbox.mjs).
    const about = (i.sourceKind === "issue_thread_interaction" ? i.subject?.metadata?.issueId : null) || iid;
    if (about) {
      Object.defineProperty(out, "_about", { enumerable: false, value: about });
      Object.defineProperty(out, "_chain", { enumerable: false, value: chainOf(issues, about) });
    }
    return out;
  });
  return { items: [...holds, ...items] };
}

// After a write whose answer did not arrive: true when the board shows the interaction resolved as asked.
async function landed(ctx, issueId, interactionId, states) {
  try {
    const list = await ctx.board.get(`/api/issues/${encodeURIComponent(issueId)}/interactions`);
    const r = (Array.isArray(list) ? list : []).find((x) => x && x.id === interactionId);
    return Boolean(r && states.includes(r.status));
  } catch {
    return false;
  }
}

// After a comment whose answer did not arrive: true when the owner's comment with this text is on the task.
async function commentLanded(ctx, issueId, body, since) {
  try {
    const list = await ctx.board.get(`/api/issues/${encodeURIComponent(issueId)}/comments`);
    return (Array.isArray(list) ? list : []).some((c) => c && !c.authorAgentId && String(c.body ?? "").trim() === String(body).trim()
      && (Date.parse(c.createdAt) || 0) >= since - 60000);
  } catch {
    return false;
  }
}

async function actOn(ctx, itemId, action, note) {
  const raw = ctx.item._raw;
  const k = raw.sourceKind;
  const enc = encodeURIComponent;
  const issueId = issueIdOf(raw);
  if (action === "dismiss") {
    ctx.decisions.set(hideKey(raw), new Date().toISOString());
    return { message: "Hidden from your inbox." };
  }
  if (APPROVAL.has(k)) {
    const path = `/api/approvals/${enc(raw.subject.id)}`;
    const body = note ? { decisionNote: note } : {};
    // Only a plain request for approval is ever approved or sent back from here; anything else may only be rejected.
    if (action !== "reject" && !isPlainApproval(raw)) {
      throw new HomeError(400, "The home screen will not approve this kind of request.", "Reject it, or deal with it on the board yourself.", "not_approvable");
    }
    if (action === "approve") { await ctx.board.post(`${path}/approve`, body); return { message: "Approved." }; }
    if (action === "send_back") { await ctx.board.post(`${path}/request-revision`, { decisionNote: note }); return { message: "Sent back with your note." }; }
    if (action === "reject") { await ctx.board.post(`${path}/reject`, body); return { message: "Rejected." }; }
  }
  if (REVIEW.has(k) && issueId) {
    const path = `/api/issues/${enc(issueId)}/stalled-review-decision`;
    if (action === "approve") { await ctx.board.post(path, note ? { action: "approve", note } : { action: "approve" }); return { message: "Approved. The task is marked finished." }; }
    if (action === "send_back") { await ctx.board.post(path, { action: "request_changes", note }); return { message: "Sent back with your note." }; }
  }
  if (k === "issue_thread_interaction") {
    const iid = raw.subject?.metadata?.interactionId || raw.subject?.id;
    const qIssue = raw.subject?.metadata?.issueId || issueId;
    if (!iid || !qIssue) throw new HomeError(409, "This question can no longer be answered here.", "Refresh the inbox.", "question_gone");
    const path = `/api/issues/${enc(qIssue)}/interactions/${enc(iid)}`;
    // Only what the item offers reaches the board (the core has checked `action` against the item's actions).
    const send = async (verb, body, doneStates) => {
      try {
        await ctx.board.post(`${path}/${verb}`, body);
      } catch (e) {
        if (!(e instanceof HomeError) || e.status < 500 || !(await landed(ctx, qIssue, iid, doneStates))) throw e;
      }
    };
    if (action === "answer" && raw._questions) {
      const answers = answersFor(raw._questions, note);
      await send("respond", { answers }, ["answered"]);
      // The owner's own words, for the task's conversation (lib/owner-text.mjs).
      recordOwnerAnswer(ctx.decisions, qIssue, answers.map((a) => a.otherText || ""));
      return { message: "Your answer was passed on." };
    }
    if (action === "accept") { await send("accept", {}, ["accepted"]); return { message: "Accepted." }; }
    if (action === "reject") { await send("reject", {}, ["rejected"]); return { message: "Declined." }; }
  }
  if (k === HOLD) {
    if (action === "stop") {
      // The goal first, then its open steps (lib/stop.mjs).
      const out = await stopTask(ctx, raw.goalId);
      ctx.home?.unstick?.forget?.(raw.goalId);
      return { message: out.message };
    }
    if (action === "answer") {
      const since = Date.now();
      try {
        await ctx.board.post(`/api/issues/${enc(raw.issueId)}/comments`, { body: note });
      } catch (e) {
        if (!(e instanceof HomeError) || e.status < 500 || !(await commentLanded(ctx, raw.issueId, note, since))) throw e;
      }
      return { message: "Your reply was added to the task." };
    }
  }
  if (PROBLEM.has(k) && issueId) {
    if (action === "retry") {
      const observedRunId = raw.subject?.kind === "run" ? raw.subject.id : null;
      await ctx.board.post(`/api/issues/${enc(issueId)}/retry`, { idempotencyKey: randomUUID(), observedRunId });
      return { message: "The task will be tried again." };
    }
    if (action === "answer") {
      const since = Date.now();
      try {
        await ctx.board.post(`/api/issues/${enc(issueId)}/comments`, { body: note });
      } catch (e) {
        if (!(e instanceof HomeError) || e.status < 500 || !(await commentLanded(ctx, issueId, note, since))) throw e;
      }
      return { message: "Your reply was added to the task." };
    }
  }
  throw new HomeError(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "board", list, act: actOn };
