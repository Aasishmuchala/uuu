// Inbox source "staged" (CONTRACTS-V2 17.4): the three Needs-you items of the staged way of working.
//   staged:unclear:<goal id>:<hash>  a question in "Anything unclear" of the newest brief, plan or check
//   staged:plan:<goal id>            a plan-first task whose plan waits for the owner
//   staged:stopped:<goal id>         a task the Chief of staff stopped at a cap
// Everything read here (documents, comments) was written by an agent: it is parsed, capped and shown as
// text only. What goes back to the board is the owner's note as typed (trimmed) and the two markers this
// code adds, `ANSWER:` and `PLAN ACCEPTED`; nothing an agent wrote is ever sent back.
import { createHash } from "node:crypto";
import { MARKERS, parseBrief, parsePlan, roundsOf, ROUND_CAP, textOf } from "../lib/staged.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";
import { forgetComments, loadTaskContext, treeComments } from "../lib/tasks.mjs";

const DOC_MAX = 262144;
const VALUE_MAX = 500;
const SUMMARY_MAX = 280;
const FINISHED = new Set(["done", "cancelled"]);

const cap = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const timeOf = (c) => Date.parse(c?.createdAt) || 0;
const isOwner = (c) => !!c && !c.authorAgentId;
const iso = (ms) => new Date(ms).toISOString();
const link = (goal) => ({ page: "tasks", id: goal.id });
const hashOf = (questions) => createHash("sha256").update(questions.join("\n"), "utf8").digest("hex").slice(0, 8);

function hidden(item, goalId) {
  Object.defineProperty(item, "_goalId", { enumerable: false, value: goalId });
  return item;
}

function base(goal, fields) {
  return {
    source: "goal", raisedBy: "Chief of staff", severity: "normal", ...fields, link: link(goal),
  };
}

// The newest of 00-brief.md, 01-plan.md and the newest check, with its questions for the owner.
// On equal times the later stage wins (check over plan over brief).
function newestUnclear(config, goal, rounds) {
  const found = [];
  const brief = readTaskText(config, goal.identifier, "00-brief.md", { maxBytes: DOC_MAX });
  if (brief) found.push({ at: brief.mtimeMs, order: 0, unclear: parseBrief(brief.text).unclear });
  const plan = readTaskText(config, goal.identifier, "01-plan.md", { maxBytes: DOC_MAX });
  if (plan) found.push({ at: plan.mtimeMs, order: 1, unclear: parsePlan(plan.text).unclear });
  const check = rounds.at(-1);
  if (check) found.push({ at: timeOf(check.comment), order: 2, unclear: check.unclear || [] });
  if (!found.length) return null;
  found.sort((a, b) => (b.at - a.at) || (b.order - a.order));
  return found[0];
}

function unclearItem(ctx, goal, rounds) {
  const doc = newestUnclear(ctx.config, goal, rounds);
  if (!doc || !doc.unclear.length) return null;
  const questions = doc.unclear.map((q) => cap(q, VALUE_MAX)).filter(Boolean);
  if (!questions.length) return null;
  const id = `staged:unclear:${goal.id}:${hashOf(questions)}`;
  if (ctx.decisions.get(`answered:${id}`)) return null;
  return hidden(base(goal, {
    id, kind: "question",
    title: `A question before work goes on: ${goal.title}`,
    when: iso(doc.at || Date.parse(goal.updatedAt) || 0),
    summary: questions.length === 1
      ? "The Chief of staff needs one answer from you before the work goes on."
      : `The Chief of staff needs ${questions.length} answers from you before the work goes on.`,
    details: questions.map((value, i) => ({ label: `Question ${i + 1}`, value })),
    actions: [
      { id: "answer", label: "Answer", style: "primary", needsNote: true },
      { id: "stop", label: "Stop this task", style: "danger", needsNote: false },
    ],
  }), goal.id);
}

function planItem(ctx, goal, own, planFirst) {
  if (!planFirst) return null;
  const ready = own.filter((c) => !isOwner(c) && String(c.body || "").trimStart().startsWith(MARKERS.planReady)).at(-1);
  if (!ready) return null;
  const lastOwner = own.filter(isOwner).at(-1);
  if (lastOwner && timeOf(lastOwner) >= timeOf(ready)) return null;
  const details = [];
  const file = readTaskText(ctx.config, goal.identifier, "01-plan.md", { maxBytes: DOC_MAX });
  if (file) {
    const plan = parsePlan(file.text);
    const approach = plan.sections.find((s) => s.heading === "Approach")?.text || "";
    if (approach.trim()) details.push({ label: "Approach", value: cap(approach, 200) });
    for (const step of plan.steps || []) {
      details.push({ label: `Step ${step.n}`, value: `${cap(step.text, VALUE_MAX)} (${cap(step.who, 80)})` });
    }
  }
  const line = String(ready.body).trimStart().slice(MARKERS.planReady.length).split("\n")[0];
  return hidden(base(goal, {
    id: `staged:plan:${goal.id}`, kind: "approval",
    title: `Plan ready: ${goal.title}`,
    when: ready.createdAt || goal.updatedAt,
    summary: cap(line, SUMMARY_MAX) || "The brief and the plan are written and wait for you.",
    details,
    actions: [
      { id: "accept", label: "Accept the plan", style: "primary", needsNote: false },
      { id: "send_back", label: "Send back", style: "plain", needsNote: true },
    ],
  }), goal.id);
}

function stoppedItem(goal, own, rounds, chiefId, tctx) {
  if (goal.status !== "blocked") return null;
  const isChief = (c) => !!c?.authorAgentId && (c.authorAgentId === chiefId || tctx.agents.get(c.authorAgentId)?.slug === "chief-of-staff");
  const newest = own.filter(isChief).at(-1);
  if (!newest || !String(newest.body || "").trimStart().startsWith(MARKERS.stopped)) return null;
  const lastOwner = own.filter(isOwner).at(-1);
  if (lastOwner && timeOf(lastOwner) >= timeOf(newest)) return null;
  const why = cap(String(newest.body).trimStart().slice(MARKERS.stopped.length), VALUE_MAX);
  return hidden(base(goal, {
    id: `staged:stopped:${goal.id}`, kind: "problem", severity: "high",
    title: `Stopped: ${goal.title}`,
    when: newest.createdAt || goal.updatedAt,
    summary: "The Chief of staff stopped this task. Try again with a note, or stop it.",
    details: [
      { label: "Why", value: why || "The Chief of staff did not say." },
      { label: "Rounds", value: `${rounds.length} of ${ROUND_CAP}` },
    ],
    actions: [
      { id: "answer", label: "Try again with a note", style: "primary", needsNote: true },
      { id: "stop", label: "Stop this task", style: "danger", needsNote: false },
    ],
  }), goal.id);
}

async function list(ctx) {
  const tctx = await loadTaskContext(ctx, { withInbox: false });
  const chiefId = tctx.ids?.agents?.["chief-of-staff"] || null;
  const items = [];
  for (const goal of tctx.goals) {
    if (FINISHED.has(goal.status)) continue;
    const tree = tctx.comments.get(goal.id) || await treeComments(tctx, goal);
    const own = tree.filter((c) => !c.issueId || c.issueId === goal.id);
    const rounds = roundsOf(tree);
    const planFirst = textOf(goal.description).planFirst;
    for (const item of [
      unclearItem(ctx, goal, rounds),
      planItem(ctx, goal, own, planFirst),
      stoppedItem(goal, own, rounds, chiefId, tctx),
    ]) if (item) items.push(item);
  }
  return { items };
}

async function act(ctx, itemId, action, note) {
  const goalId = ctx.item._goalId;
  const path = `/api/issues/${encodeURIComponent(goalId)}`;
  const text = typeof note === "string" ? note.trim() : "";
  const kind = itemId.split(":")[1];
  const offered = (ctx.item.actions || []).some((a) => a.id === action);
  if (!offered) throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
  try {
    if (action === "stop") {
      await ctx.board.patch(path, { status: "cancelled" });
      return { message: "Stopped. The task will not go on." };
    }
    if (kind === "unclear" && action === "answer") {
      await ctx.board.post(`${path}/comments`, { body: `${MARKERS.answer} ${text}` });
      await ctx.board.patch(path, { status: "todo" });
      ctx.decisions.set(`answered:${itemId}`, new Date().toISOString());
      return { message: "Answered. The Chief of staff will carry on with your answer." };
    }
    if (kind === "plan" && action === "accept") {
      await ctx.board.post(`${path}/comments`, { body: MARKERS.planAccepted });
      await ctx.board.patch(path, { status: "todo" });
      return { message: "Plan accepted. The work will start." };
    }
    if ((kind === "plan" && action === "send_back") || (kind === "stopped" && action === "answer")) {
      await ctx.board.post(`${path}/comments`, { body: text });
      await ctx.board.patch(path, { status: "todo" });
      return { message: kind === "plan"
        ? "Sent back with your note. The Chief of staff will change the plan."
        : "Sent back with your note. The Chief of staff will try again." };
    }
  } finally {
    forgetComments(goalId);
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "staged", list, act };
