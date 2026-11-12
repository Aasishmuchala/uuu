// CONTRACTS-V3 33.5: ask the company brain. POST /api/ask makes a task for the Chief of staff whose text ends
// with the line ASK, then writes the record `ask:<task id>`; GET /api/ask and GET /api/ask/:id show the
// questions with their state and, once answered, the answer (GET /api/ask/:id answers the shape `ask` itself).
// A task is a question only by its `ask:` record, never by its text. The answer is `answer.md` in the task's
// folder, written by an agent, so it is untrusted: it is read through readTaskText (no links, at most 64 KB),
// parsed by the pure lib/answer.mjs, and a source is a link only when its path is a file of the brain's own
// listing; any other path (`../secrets`, an absolute path) is shown as words. The answer is not checked:
// `checked` is true only when the task's tree has a passing round. Acting on an answer goes through
// POST /api/inbox/act with the ids given in `needsYou`; there is no other route.
import { parseAnswer } from "../lib/answer.mjs";
import { brainTitle } from "../lib/brainfiles.mjs";
import { needIds } from "../lib/goals.mjs";
import { buildText, roundsOf, textOf } from "../lib/staged.mjs";
import { findTask, isHeldTask, loadTaskContext, treeComments } from "../lib/tasks.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";
import { brainFor } from "../brain/store.mjs";
import { titleOf } from "./goals.mjs";

const MAX_QUESTION = 2000;
const ANSWER_BYTES = 64 * 1024;
const NEWEST = 20;
export const ANSWER_FILE = "answer.md";
const PLAIN = {
  reading: "Reading your files",
  answered: "Answered",
  became_task: "Became a task",
  needs_you: "Needs you",
  stopped: "Stopped",
};

const askKey = (id) => `ask:${id}`;
const isoOr = (v, fallback) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : fallback || null);

// The record of a question, or null: the home server's own `ask:` record is the only thing that makes one.
export function askRecord(ctx, goalId) {
  const v = ctx.decisions && typeof ctx.decisions.get === "function" ? ctx.decisions.get(askKey(goalId)) : null;
  return v === null || v === undefined || v === false ? null : v;
}

// The brain's listed files as path -> token (empty when the brain cannot be read).
export function brainPaths(config) {
  const out = new Map();
  try {
    for (const f of brainFor(config).list()) out.set(f.path, f.token);
  } catch { /* no brain: no source is found */ }
  return out;
}

// The parsed answer file of a task, or null when there is none.
export function readAnswer(config, identifier) {
  const hit = identifier ? readTaskText(config, identifier, ANSWER_FILE, { maxBytes: ANSWER_BYTES }) : null;
  return hit ? parseAnswer(hit.text) : null;
}

// Each source with `found` and `link` from the brain's own listing; an exact listed path only. A found source
// also carries the brain file's own `title` (a basic's form title, else the file's name without its folder;
// lib/brainfiles.mjs brainTitle), so the screen names the file the owner knows, not a path (M50 F17).
export function vouch(sources, paths) {
  return sources.map((s) => {
    const token = paths.has(s.path) ? paths.get(s.path) : null;
    return { n: s.n, path: s.path, note: s.note, found: !!token, link: token ? { page: "files", id: token } : null,
      title: token ? brainTitle(s.path) : null };
  });
}

function stateOf(goal, tctx, parsed) {
  if (goal.status === "cancelled") return "stopped";
  if (goal.status === "blocked") return isHeldTask(goal, tctx) ? "stopped" : "needs_you";
  if (goal.status === "done") return parsed ? "answered" : "became_task";
  if (tctx.stepsOf(goal.id).length) return "became_task";
  return "reading";
}

// askOf(ctx, tctx, goal, { paths }) -> shape `ask`. `tctx` from loadTaskContext (with the inbox, for
// `needsYou`); `paths` from brainPaths, read once per request.
export async function askOf(ctx, tctx, goal, { paths } = {}) {
  const parsed = goal.status === "done" ? readAnswer(ctx.config, goal.identifier) : null;
  const state = stateOf(goal, tctx, parsed);
  let answer = null;
  if (state === "answered") {
    const comments = tctx.comments.get(goal.id) || await treeComments(tctx, goal);
    tctx.comments.set(goal.id, comments);
    const rounds = roundsOf(comments, tctx.ids?.agents?.checker || null);
    answer = {
      text: parsed.text,
      sources: parsed.wellFormed ? vouch(parsed.sources, paths || brainPaths(ctx.config)) : [],
      notInFiles: parsed.wellFormed ? parsed.notInFiles : [],
      checked: rounds.some((r) => r.outcome === "pass"),
      at: goal.completedAt || goal.updatedAt || null,
      wellFormed: parsed.wellFormed,
    };
  }
  const inboxId = `goal:${goal.id}`;
  const item = (tctx.needsYou || []).find((i) => i.id === inboxId);
  const ack = item?.actions?.find((a) => a.id === "acknowledge");
  return {
    id: goal.id, identifier: goal.identifier || null,
    question: textOf(goal.description || goal.title || "").text.slice(0, MAX_QUESTION),
    state, plainState: PLAIN[state],
    askedAt: isoOr(askRecord(ctx, goal.id), goal.createdAt),
    answer,
    needsYou: item && ack ? { inboxId, action: "acknowledge", label: ack.label, version: typeof item.version === "string" ? item.version : null } : null,
    taskId: goal.id,
  };
}

function readQuestion(ctx) {
  const text = ctx.body && typeof ctx.body.text === "string" ? ctx.body.text.trim() : "";
  if (!text) throw ctx.fail(400, "There is nothing written yet.", "Write your question, then send it.", "empty_text");
  if (text.length > MAX_QUESTION) throw ctx.fail(400, "That is too long.", `Keep it under ${MAX_QUESTION} characters.`, "text_too_long");
  return text;
}

export default function register(app) {
  app.post("/api/ask", async (ctx) => {
    const text = readQuestion(ctx);
    const ids = needIds(ctx);
    const chief = ids.agents?.["chief-of-staff"];
    if (!chief) throw ctx.fail(409, "The Chief of staff is not set up yet.", "Open Health to see how to set up the engine.", "not_set_up");
    const created = await ctx.board.post(`/api/companies/${encodeURIComponent(ids.companyId)}/issues`, {
      title: titleOf(text), description: buildText({ text, ask: true }), assigneeAgentId: chief,
      projectId: ids.projectId, status: "todo", priority: "medium",
    });
    if (!created || typeof created.id !== "string") {
      throw ctx.fail(502, "The board did not take the question.", "Try again in a moment.", "board_error");
    }
    // The record is written only after the board answered: it is what makes this task a question.
    const askedAt = ctx.decisions.set(askKey(created.id), new Date().toISOString());
    return {
      status: 201,
      body: {
        ask: {
          id: created.id, identifier: created.identifier || null, question: text,
          state: "reading", plainState: PLAIN.reading, askedAt,
          answer: null, needsYou: null, taskId: created.id,
        },
      },
    };
  });

  app.get("/api/ask", async (ctx) => {
    const tctx = await loadTaskContext(ctx, { withInbox: true, withComments: false });
    const asked = tctx.goals
      .map((g) => ({ g, at: isoOr(askRecord(ctx, g.id), null) }))
      .filter((x) => askRecord(ctx, x.g.id) !== null)
      .sort((a, b) => String(b.at || b.g.createdAt).localeCompare(String(a.at || a.g.createdAt)))
      .slice(0, NEWEST);
    const paths = brainPaths(ctx.config);
    const asks = [];
    for (const { g } of asked) asks.push(await askOf(ctx, tctx, g, { paths }));
    return { asks };
  });

  app.get("/api/ask/:id", async (ctx) => {
    const tctx = await loadTaskContext(ctx, { withInbox: true, withComments: false });
    const goal = findTask(tctx, ctx.params.id);
    if (!goal || askRecord(ctx, goal.id) === null) {
      throw ctx.fail(404, "There is no such question.", "Ask the company brain from the map.", "ask_not_found");
    }
    return askOf(ctx, tctx, goal);
  });
}
