// CONTRACTS-V2 17.3: GET /api/tasks/:id, one task's acceptance view. Read-only.
// Joins the task card, the check rounds, the five stages with their documents, the steps, every comment
// of the task's tree and the files of its folder. Everything here except the board's own fields was
// written by an agent, so it is untrusted: documents and evidence are read only through taskfiles.mjs
// (no links, nothing outside the goal's folder), texts are capped, markers are taken out of what the
// owner reads, and nothing is ever followed or run. Accepting and sending back go through
// POST /api/inbox/act with the ids given here; there is no other accept route.
import { plainState } from "../lib/goals.mjs";
import { findTask, loadTaskContext, taskCard, treeComments } from "../lib/tasks.mjs";
import {
  MARKERS, ROUND_CAP, parseBrief, parseDoc, parsePlan, parseSummary, roundsOf, sizeOf, stagesOf, textOf,
} from "../lib/staged.mjs";
import { fileEntry, listTaskFiles, readTaskText } from "../lib/taskfiles.mjs";

const YOU = { slug: "you", name: "You" };
const SOMEONE = { slug: null, name: "An agent" };
const MAX_TEXT = 4000;            // characters of one comment, result or exchange line
const MAX_EVIDENCE = 10;          // evidence files per check
const MAX_EXCHANGE = 20;
const MAX_CONVERSATION = 200;
const MAX_TIMELINE = 200;
const FINISHED = new Set(["done", "cancelled"]);
const DOCS = [
  ["brief", "00-brief.md", parseBrief],
  ["plan", "01-plan.md", parsePlan],
  ["summary", "04-summary.md", parseSummary],
];
const CHECK_SECTIONS = ["Questions", "Actions", "Anything unclear"];

const bodyOf = (c) => (c && typeof c.body === "string" ? c.body : "");
const cap = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const isVerdict = (c) => /^\s*VERDICT:/i.test(bodyOf(c).slice(0, 4000));
const isResult = (c) => /^\s*RESULT:/.test(bodyOf(c).slice(0, 4000));

function whoOf(tctx, comment) {
  if (!comment.authorAgentId) return YOU;
  const a = tctx.agents.get(comment.authorAgentId);
  return a ? { slug: a.slug, name: a.name } : SOMEONE;
}

function assigneeOf(tctx, issue) {
  const a = issue.assigneeAgentId ? tctx.agents.get(issue.assigneeAgentId) : null;
  return a ? { slug: a.slug, name: a.name } : null;
}

// One line with its marker turned into plain words; null drops the line.
function plainLine(line) {
  const t = line.trimStart();
  let m;
  if ((m = /^VERDICT:\s*(PASS|FAIL)\b\s*[-:]?\s*(.*)$/i.exec(t))) {
    const said = m[1].toUpperCase() === "PASS" ? "Passed" : "Did not pass";
    return m[2].trim() ? `${said}: ${m[2].trim()}` : `${said}.`;
  }
  if (/^VERDICT:/i.test(t)) return t.replace(/^VERDICT:\s*/i, "The check says: ");
  if (/^Verdict:\s*(PASS|FAIL)\s*$/i.test(t)) return null;
  if ((m = /^SIZE:\s*(.*)$/.exec(t))) return m[1].trim() ? `Sized as ${m[1].trim()}` : null;
  if ((m = /^PLAN READY:\s*(.*)$/.exec(t))) return m[1].trim() ? `The plan is ready. ${m[1].trim()}` : "The plan is ready.";
  if (t.startsWith(MARKERS.planAccepted)) return "You accepted the plan.";
  if ((m = /^ANSWER:\s*(.*)$/.exec(t))) return m[1].trim() || null;
  if ((m = /^STOPPED:\s*(.*)$/.exec(t))) return m[1].trim() ? `Stopped because ${m[1].trim()}` : "Stopped.";
  if ((m = /^RESULT:\s*(.*)$/.exec(t))) return m[1].trim() || null;
  if ((m = /^FOR:\s*(.*)$/.exec(t))) return m[1].trim() ? `For the ${m[1].trim()}` : null;
  if (t.startsWith(MARKERS.planFirst)) return null;
  if (t.startsWith(MARKERS.routine)) return null;
  return line;
}

// A comment as the owner reads it: markers taken out, capped. A check shows as its first line only;
// the whole check is in the rounds.
function plainText(comment) {
  let body = bodyOf(comment).slice(0, MAX_TEXT * 4).replace(/\r\n?/g, "\n");
  if (isVerdict(comment)) body = body.trimStart().split("\n", 1)[0];
  const lines = [];
  for (const line of body.split("\n")) {
    const p = plainLine(line);
    if (p !== null) lines.push(p);
  }
  return cap(lines.join("\n").trim());
}

function kindOfComment(comment) {
  if (isResult(comment)) return "result";
  if (isVerdict(comment)) return "verdict";
  if (!comment.authorAgentId) return "note";
  return "comment";
}

// The evidence paths of one check that exist as plain files in the goal's folder, at most 10.
function evidenceOf(config, identifier, paths) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(paths) ? paths : []) {
    if (out.length >= MAX_EVIDENCE) break;
    if (typeof p !== "string" || seen.has(p)) continue;
    seen.add(p);
    const hit = identifier ? readTaskText(config, identifier, p, { maxBytes: 0 }) : null;
    if (hit) out.push(fileEntry(identifier, p, hit.size));
  }
  return out;
}

function roundLabel(round, isLast, open) {
  if (round.outcome === "pass") return `Round ${round.n} · Passed`;
  return !isLast || open ? `Round ${round.n} · Repairing` : `Round ${round.n} · Failed`;
}

function roundsView(tctx, goal, comments, rounds) {
  const stopped = comments.some((c) => c.authorAgentId && /^\s*STOPPED:/.test(bodyOf(c)));
  const open = !FINISHED.has(goal.status) && !stopped && rounds.length < ROUND_CAP;
  let from = 0;
  return rounds.map((r, i) => {
    const at = comments.indexOf(r.comment);
    const between = comments.slice(from, at < 0 ? from : at).filter((c) => !isVerdict(c));
    from = at < 0 ? from : at + 1;
    return {
      n: r.n, outcome: r.outcome, label: roundLabel(r, i === rounds.length - 1, open),
      by: whoOf(tctx, r.comment).name, at: r.comment.createdAt || null,
      reason: r.reason, wellFormed: r.wellFormed,
      checks: r.checks.map((c) => ({
        n: c.n, question: c.question, answer: c.answer, reason: c.reason,
        evidence: evidenceOf(tctx.config, goal.identifier, c.evidence),
      })),
      actions: r.actions,
      exchange: between.slice(-MAX_EXCHANGE)
        .map((c) => ({ who: whoOf(tctx, c), text: plainText(c), at: c.createdAt || null }))
        .filter((e) => e.text),
    };
  });
}

// The newest check as the document "Check": its three sections, without the closing verdict line.
function checkDoc(round) {
  const lines = bodyOf(round.comment).replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && /^Verdict:\s*(PASS|FAIL)\s*$/i.test(lines[lines.length - 1].trim())) lines.pop();
  const { sections } = parseDoc(lines.join("\n"));
  return { name: "Check", file: null, sections: sections.filter((s) => CHECK_SECTIONS.includes(s.heading)) };
}

function stagesView(tctx, goal, comments, rounds) {
  const docs = {};
  for (const [id, name, parse] of DOCS) {
    const hit = goal.identifier ? readTaskText(tctx.config, goal.identifier, name) : null;
    if (!hit) continue;
    const parsed = parse(hit.text);
    const doc = { name, file: fileEntry(goal.identifier, name, hit.size), sections: parsed.sections };
    if (parsed.steps) doc.steps = parsed.steps;
    docs[id] = { doc, unclear: parsed.unclear };
  }
  const newest = rounds[rounds.length - 1] || null;
  const stages = stagesOf({
    size: sizeOf(comments),
    has: { brief: !!docs.brief, plan: !!docs.plan, summary: !!docs.summary },
    steps: tctx.stepsOf(goal.id),
    rounds,
    status: goal.status,
  });
  return stages.map((s) => {
    if (docs[s.id]) return { ...s, unclear: docs[s.id].unclear, doc: docs[s.id].doc };
    if (s.id === "check" && newest) return { ...s, unclear: newest.unclear, doc: checkDoc(newest) };
    return { ...s, unclear: [], doc: null };
  });
}

function timelineView(tctx, goal) {
  const now = Date.now();
  return tctx.stepsOf(goal.id).slice(0, MAX_TIMELINE).map((s) => {
    const who = assigneeOf(tctx, s);
    const startedAt = s.startedAt || s.createdAt || null;
    const endedAt = s.completedAt || (FINISHED.has(s.status) ? s.updatedAt || null : null);
    const start = Date.parse(startedAt);
    const end = endedAt ? Date.parse(endedAt) : now;
    return {
      id: s.id, identifier: s.identifier, title: s.title, who,
      kind: who && who.slug === "checker" ? "check" : "work",
      ...plainState(s.status),
      startedAt, endedAt,
      durationMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round(end - start)) : 0,
    };
  });
}

function acceptanceState(goal, tctx, comments) {
  if (goal.status === "cancelled") return "stopped";
  if (goal.status === "done") return tctx.accepted(goal.id) ? "accepted" : "waiting_for_you";
  const result = [...comments].reverse().find(isResult);
  if (result && comments.some((c) => !c.authorAgentId && String(c.createdAt) > String(result.createdAt))) return "sent_back";
  return "not_ready";
}

function resultOf(tctx, goal, comments) {
  const c = [...comments].reverse().find((x) => x.issueId === goal.id && isResult(x));
  if (!c) return null;
  return { text: plainText(c), by: whoOf(tctx, c).name, at: c.createdAt || null };
}

export default function register(app) {
  app.get("/api/tasks/:id", async (ctx) => {
    const tctx = await loadTaskContext(ctx, { withInbox: true, withComments: false });
    const goal = findTask(tctx, ctx.params.id);
    if (!goal) throw ctx.fail(404, "There is no such task.", "Go back to Tasks and pick one from the list.", "task_not_found");
    const comments = await treeComments(tctx, goal);
    tctx.comments.set(goal.id, comments);
    const rounds = roundsOf(comments);
    const newest = rounds[rounds.length - 1] || null;
    const text = textOf(goal.description || "");
    const needsYou = tctx.needsYou.filter((i) => i.taskId === goal.id);

    const state = acceptanceState(goal, tctx, comments);
    let accept = null;
    let sendBack = null;
    if (state === "waiting_for_you") {
      const inboxId = `goal:${goal.id}`;
      const item = needsYou.find((i) => i.id === inboxId);
      const label = (id, fallback) => item?.actions?.find((a) => a.id === id)?.label || fallback;
      accept = { inboxId, action: "acknowledge", label: label("acknowledge", "Accept") };
      sendBack = { inboxId, action: "reopen", label: label("reopen", "Send back") };
    }

    return {
      task: taskCard(goal, tctx),
      text: cap(text.text), planFirst: text.planFirst, for: text.for,
      needsYou,
      acceptance: {
        state, accept, sendBack,
        rounds: roundsView(tctx, goal, comments, rounds),
        checksPassed: newest ? newest.checks.filter((c) => c.answer === "yes").length : 0,
        checksTotal: newest ? newest.checks.length : 0,
        roundCap: ROUND_CAP,
      },
      stages: stagesView(tctx, goal, comments, rounds),
      timeline: timelineView(tctx, goal),
      conversation: comments.slice(-MAX_CONVERSATION)
        .map((c) => ({ who: whoOf(tctx, c), kind: kindOfComment(c), text: plainText(c), at: c.createdAt || null })),
      files: goal.identifier ? listTaskFiles(ctx.config, goal.identifier).map((f) => fileEntry(goal.identifier, f.name, f.size)) : [],
      result: resultOf(tctx, goal, comments),
      generatedAt: new Date().toISOString(),
    };
  });
}
