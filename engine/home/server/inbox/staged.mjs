// Inbox source "staged" (CONTRACTS-V2 17.4): the Needs-you items of the staged way of working.
//   staged:unclear:<goal id>:<hash>  a question in "Anything unclear" of the newest brief, plan or check
//   staged:plan:<goal id>            a plan-first task whose plan waits for the owner
//   staged:stopped:<goal id>         a task the Chief of staff stopped at a cap
//   staged:shotlist:<goal id>        a film's treatments and their cost, waiting for the owner's yes (PLAN-V5 K14, C7)
// Everything read here (documents, comments, shotlists) was written by an agent: it is parsed, capped and shown
// as text only. What goes back to the board is the owner's note as typed (trimmed) and the markers this code
// adds, `ANSWER:`, `PLAN ACCEPTED`, `SHOTLIST ACCEPTED: <a|b|c> batch <id>` and `ANOTHER ROUND`; nothing an agent
// wrote is ever sent back, and the only agent words kept in a record are an approved shotlist's renders, moves and
// prompts, checked again as the owner read them (lib/shotlist.mjs, T48 F3).
// Every item carries `version` (CONTRACTS 9.3a): a question its questions' hash (the one in its id), a plan
// a hash of the plan file and its PLAN READY comment, a stop a hash of the STOPPED comment, a shotlist a hash of
// its SHOTLIST READY comment, the treatments' files, the newest review, the shots as priced, the caps and the
// models. On an action (`ctx.acting`) the comments are read again from the board, not from the 15-second cache.
// A film's money (C10): the cost on the card and the budget of the batch the approval writes are the home server's
// own sum, from the generation door's prices and the models the owner chose in Settings (lib/shotlist.mjs,
// lib/batches.mjs); the batch file is the only thing that lets the door spend, and it is written only here.
// A question for the owner is a line of "Anything unclear" that ends with a question mark; other notes there
// are the agents' own. Only the newest of brief, plan and the newest round's check is read, and its questions
// go away once a newer check round or a newer owner answer (`ANSWER:`) exists.
// An action's essential write is its comment (or, for Stop, the goal's status; lib/stop.mjs). When the board's answer to that write
// does not arrive in time, the comments (or the status) are read again: if the write is there, the action
// succeeded. A later step that fails (setting the task back to "todo") never turns a success into a failure.
import { createHash } from "node:crypto";
import { reviewsOf } from "../lib/artreview.mjs";
import { closeBatches, generationNow, removeBatch, writeBatch } from "../lib/batches.mjs";
import { stampOf } from "../lib/brandcheck.mjs";
import { HomeError } from "../lib/errors.mjs";
import { versionOf } from "../lib/inbox.mjs";
import { ANOTHER, BACK, PICK, recordPick } from "../lib/picks.mjs";
import {
  approvedShots, boardsOf, costWords, dollars, priceShotlist, readShotlist, recordApproval, shotsHash, TAKES, timeWords,
} from "../lib/shotlist.mjs";
import { MARKERS, parseBrief, parsePlan, roundsOf, ROUND_CAP, textOf } from "../lib/staged.mjs";
import { stopTask } from "../lib/stop.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";
import { forgetComments, loadTaskContext, treeComments } from "../lib/tasks.mjs";
import { refreshTaste } from "../lib/taste.mjs";
import { readVariants } from "../lib/variants.mjs";
import { kindOfTask, piecesFor } from "../routes/pieces.mjs";

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
const isAnswer = (c) => isOwner(c) && String(c.body || "").trimStart().startsWith(MARKERS.answer);
const isQuestion = (line) => String(line).trim().endsWith("?");
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

function unclearItem(ctx, goal, rounds, tree) {
  const doc = newestUnclear(ctx.config, goal, rounds);
  if (!doc || !doc.unclear.length) return null;
  const questions = doc.unclear.filter(isQuestion).map((q) => cap(q, VALUE_MAX)).filter(Boolean);
  if (!questions.length) return null;
  // Handled: a check round or an owner's answer came after the document that asked.
  const newestCheck = rounds.at(-1);
  if (doc.order < 2 && newestCheck && timeOf(newestCheck.comment) > doc.at) return null;
  if (tree.some((c) => isAnswer(c) && timeOf(c) >= doc.at)) return null;
  const hash = hashOf(questions);
  const id = `staged:unclear:${goal.id}:${hash}`;
  if (ctx.decisions.get(`answered:${id}`)) return null;
  return hidden(base(goal, {
    id, kind: "question", version: hash,
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
    version: versionOf(file ? file.text : "", file ? file.truncated : "", ready.id, ready.body),
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

// A comment by the Chief of staff: by its id in ids.json, or by the board's agent of that slug.
const chiefTest = (chiefId, tctx) => (c) => !!c?.authorAgentId
  && (c.authorAgentId === chiefId || tctx.agents.get(c.authorAgentId)?.slug === "chief-of-staff");

function stoppedItem(goal, own, rounds, chiefId, tctx) {
  if (goal.status !== "blocked") return null;
  const isChief = chiefTest(chiefId, tctx);
  const newest = own.filter(isChief).at(-1);
  if (!newest || !String(newest.body || "").trimStart().startsWith(MARKERS.stopped)) return null;
  const lastOwner = own.filter(isOwner).at(-1);
  if (lastOwner && timeOf(lastOwner) >= timeOf(newest)) return null;
  // The first line is the short reason and the rest explains it: join them as two sentences.
  const [reason, ...more] = String(newest.body).trimStart().slice(MARKERS.stopped.length).trim().split("\n");
  const first = reason.trim().replace(/([^.!?:])$/, "$1.");
  const why = cap([first, ...more].filter((x) => x.trim()).join(" "), VALUE_MAX);
  return hidden(base(goal, {
    id: `staged:stopped:${goal.id}`, kind: "problem", severity: "high",
    version: versionOf(newest.id, newest.body),
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

// ---- a film's shotlist (PLAN-V5 K14 steps 1 and 2, C7, C8, C10)

// How long a list waits for the home server's brand check before it shows "still running" (as inbox/goals.mjs).
const LIST_BRAND_WAIT_MS = 1500;
const ANOTHER_LINE = "ANOTHER ROUND";
const READY_WORDS = { 1: "One treatment is ready.", 2: "Two treatments are ready.", 3: "Three treatments are ready." };
const OFF = "Generation is off or has no key yet. Open Settings.";
const LEDGER = "The spending ledger cannot be read, so nothing will be made. Health shows what to do.";
const NO_LIST = "The film's list of treatments (variants.json) is missing, so there is nothing to approve.";
const NO_FILES = "The treatments' files are missing, so there is nothing to approve.";
const PROBLEM_SUMMARY = "The treatments cannot be shown, so none can be approved. Send them back with a note.";

const limitWords = (cap, spent) => `${cap} credits (${dollars(cap)}); ${spent === null ? "what was spent cannot be read" : `${spent} spent`}`;

// Why a treatment cannot be approved now, the first that applies, as { blocked, code } (both null when it can).
function blockOf(gen, read, priced) {
  if (!gen.on || !gen.key) return { blocked: OFF, code: "job_not_ready" };
  if (!read.ok) return { blocked: read.problem, code: "shotlist_problem" };
  if (!priced.ok) return { blocked: priced.problem, code: "shotlist_problem" };
  if (!gen.ledgerOk) return { blocked: LEDGER, code: "ledger_unreadable" };
  if (priced.base > gen.dayLeft) {
    return { blocked: `This costs more than is left of today's limit (${gen.dayLeft} credits). Raise it in Settings, or approve it tomorrow.`, code: "over_limit" };
  }
  if (priced.base > gen.monthLeft) {
    return { blocked: `This costs more than is left of this month's limit (${gen.monthLeft} credits). Raise it in Settings, or approve it next month.`, code: "over_limit" };
  }
  return { blocked: null, code: null };
}

// One treatment as the card shows it, and what the approval needs (kept off the item, not enumerable).
function treatmentOf(ctx, goal, pv, place, gen, allowWords) {
  const read = readShotlist(ctx.config, goal.identifier, place.rel, { allowWords });
  const priced = read.ok ? priceShotlist(read.shotlist, gen.models, { centsPerCredit: gen.centsPerCredit }) : { ok: false, shots: [], base: 0, most: 0, problem: read.problem };
  const boards = boardsOf(ctx.config, goal.identifier, place.rel, read.ok ? read.shotlist.shots.map((s) => s.id) : undefined);
  const { blocked, code } = blockOf(gen, read, priced);
  const price = (id) => (priced.ok ? priced.shots.find((p) => p.id === id) : null);
  const shotlist = read.ok ? {
    title: read.shotlist.title, seconds: read.shotlist.seconds, ratio: read.shotlist.ratio,
    shots: read.shotlist.shots.map((s) => ({
      id: s.id, render: s.render, seconds: s.seconds, move: s.move, prompt: s.prompt, kind: s.kind, best: s.best,
      model: price(s.id)?.model ?? null, credits: price(s.id)?.credits ?? null,
    })),
    cards: read.shotlist.cards,
  } : null;
  const cost = priced.ok ? {
    base: priced.base, most: priced.most,
    words: costWords(priced, { daily: gen.daily, dayLeft: gen.dayLeft, monthLeft: gen.monthLeft }),
    time: timeWords(priced.shots.length),
  } : null;
  const shown = { ...pv, shotlist, boards, cost, approvable: blocked === null, blocked };
  Object.defineProperty(shown, "_approve", { enumerable: false, value: { priced, code, approved: read.ok ? approvedShots(read.shotlist, priced) : [] } });
  return shown;
}

// The card of a film whose shotlist waits for the owner: the Chief of staff's newest SHOTLIST READY comment is
// newer than the owner's newest comment (the rule of planItem), and the goal's job makes films (its craft kind,
// from the home server's own `template:` record). Never throws on what an agent wrote.
async function shotlistItem(ctx, goal, own, tree, tctx, isChief) {
  const ready = own.filter((c) => isChief(c) && String(c.body || "").trimStart().startsWith(MARKERS.shotlistReady)).at(-1);
  if (!ready) return null;
  const lastOwner = own.filter(isOwner).at(-1);
  if (lastOwner && timeOf(lastOwner) >= timeOf(ready)) return null;
  let kind = null;
  try { kind = kindOfTask(ctx, goal); } catch { kind = null; }
  if (kind !== "film" || typeof goal.identifier !== "string") return null;

  const gen = generationNow(ctx.config, Date.now());
  const artDirectorId = tctx.ids?.agents?.["art-director"] || null;
  const v = readVariants(ctx.config, goal.identifier, "film");
  let problem = !v.present ? NO_LIST : v.problem || null;
  let pieces = null;
  if (!problem) {
    const home = ctx.home && typeof ctx.home === "object" ? ctx.home : {};
    const wait = Math.min(Number.isFinite(home.brandCheckWaitMs) ? home.brandCheckWaitMs : LIST_BRAND_WAIT_MS, LIST_BRAND_WAIT_MS);
    pieces = await piecesFor({ ...ctx, home: { ...home, brandCheckWaitMs: wait } }, goal, tree, { artDirectorId });
    if (pieces.problem) problem = pieces.problem;
    else if (pieces.single || !pieces.variants.length) problem = NO_FILES;
  }
  const asked = ctx.decisions.get(`asked:${goal.id}`);
  const allowWords = !!asked && typeof asked === "object" && asked.answers?.fromwords === "Yes";
  const variants = problem ? [] : pieces.variants.map((pv) => {
    const place = v.variants.find((x) => x.id === pv.id);
    return place ? treatmentOf(ctx, goal, pv, place, gen, allowWords) : null;
  }).filter(Boolean);
  if (!problem && !variants.length) problem = NO_FILES;

  const stamp = v.present && !v.problem ? stampOf(ctx.config, goal.identifier, { versions: v.variants.map((x) => x.rel) }).key : "";
  const reviewId = reviewsOf(tree, artDirectorId).at(-1)?.commentId || null;
  const shown = variants.map((x) => [x.id, x.direction?.id || null, x.review, x.shotlist, x.boards.map((b) => b.shot), x._approve.priced.shots]);
  const n = variants.length;
  const item = base(goal, {
    id: `staged:shotlist:${goal.id}`, kind: "shotlist",
    version: versionOf("shotlist", ready.id, ready.body, stamp, reviewId, JSON.stringify([pieces?.round ?? null, pieces?.missing ?? [], shown]),
      JSON.stringify([gen.daily, gen.monthly, gen.models]), problem),
    title: `Approve a shotlist: ${goal.title}`,
    when: ready.createdAt || goal.updatedAt,
    summary: problem ? PROBLEM_SUMMARY : `${READY_WORDS[n] || `${n} treatments are ready.`} Approve one and its cost; nothing is sent to Runway before you do.`,
    details: [
      { label: "Today's limit", value: limitWords(gen.daily, gen.spentDay) },
      { label: "This month", value: limitWords(gen.monthly, gen.spentMonth) },
      ...(problem ? [{ label: "Treatments", value: problem }] : []),
    ],
    actions: [
      ...(problem ? [] : [
        { id: "approve", label: "Approve this one and its cost", style: "primary", needsNote: false, takes: "variant" },
        { id: "another", label: "Another round", style: "plain", needsNote: false },
      ]),
      { id: "send_back", label: "Send all back", style: problem ? "primary" : "plain", needsNote: true },
    ],
    pieceKind: "film",
    round: pieces?.round ?? null,
    missing: pieces?.missing ?? [],
    variants,
    generation: { on: gen.on, key: gen.key, daily: gen.daily, monthly: gen.monthly, dayLeft: gen.dayLeft, monthLeft: gen.monthLeft },
    problem,
  });
  Object.defineProperty(item, "_shotlist", { enumerable: false, value: { readyId: ready.id, round: pieces?.round ?? null, variants } });
  return hidden(item, goal.id);
}

async function list(ctx) {
  if (ctx.acting) forgetComments();
  const tctx = await loadTaskContext(ctx, { withInbox: false });
  const chiefId = tctx.ids?.agents?.["chief-of-staff"] || null;
  const checkerId = tctx.ids?.agents?.checker || null; // only the Checker's VERDICT comments are check rounds
  const isChief = chiefTest(chiefId, tctx);
  const items = [];
  for (const goal of tctx.goals) {
    if (FINISHED.has(goal.status)) continue;
    const tree = tctx.comments.get(goal.id) || await treeComments(tctx, goal);
    const own = tree.filter((c) => !c.issueId || c.issueId === goal.id);
    const rounds = roundsOf(tree, checkerId);
    const planFirst = textOf(goal.description).planFirst;
    let shotlist = null;
    try {
      shotlist = await shotlistItem(ctx, goal, own, tree, tctx, isChief);
    } catch (e) {
      ctx.log?.(`staged: the shotlist of ${goal.id} could not be shown: ${String(e?.code || e?.message || e).split("\n")[0]}`);
    }
    for (const item of [
      unclearItem(ctx, goal, rounds, tree),
      planItem(ctx, goal, own, planFirst),
      stoppedItem(goal, own, rounds, chiefId, tctx),
      shotlist,
    ]) if (item) items.push(item);
  }
  return { items };
}

// Writes the owner's comment once. When the board's answer does not arrive (502), the task's comments are read
// again: the comment counts as written when an owner comment with exactly this text is there since `since`.
async function writeComment(ctx, path, goalId, body) {
  const since = Date.now();
  try {
    await ctx.board.post(`${path}/comments`, { body });
  } catch (e) {
    if (!(e instanceof HomeError) || e.status < 500) throw e;
    let list = [];
    try { list = await ctx.board.get(`${path}/comments`); } catch { throw e; }
    const there = (Array.isArray(list) ? list : []).some((c) => isOwner(c) && String(c.body ?? "").trim() === body.trim()
      && timeOf(c) >= since - 60000);
    if (!there) throw e;
    ctx.log?.(`staged: the comment on ${goalId} was written although the board did not answer in time`);
  }
}

// A later, non-essential step: tried once; a failure is logged, never reported as the action failing.
async function thenTry(ctx, what, fn) {
  try { await fn(); } catch (e) { ctx.log?.(`staged: ${what} failed after the comment was written: ${String(e?.code || e?.message || e)}`); }
}

// ---- the owner's answer to a shotlist

// One owner action per SHOTLIST READY comment, per running home server: two answers sent at once (two tabs, a
// double click) both find the card before either writes, so the second is refused here, before anything is
// written, and stays refused once the first has written its comment. goal id -> the READY comment's id.
const answering = new WeakMap();
function answersOf(ctx) {
  const key = ctx.home && typeof ctx.home === "object" ? ctx.home : ctx.decisions;
  if (!answering.has(key)) answering.set(key, new Map());
  return answering.get(key);
}

// The choice as lib/picks.mjs keeps it: ids, direction ids from the repo's list and numbers, never an agent's word.
function choiceOf(sl, action, variant, note) {
  const chosen = variant ? sl.variants.find((x) => x.id === variant) : null;
  return {
    action, round: sl.round, note,
    variant: chosen ? chosen.id : null,
    direction: chosen ? chosen.direction?.id || null : null,
    scores: chosen && chosen.review ? chosen.review.scores : null,
    versions: sl.variants.map((x) => ({ id: x.id, direction: x.direction?.id || null, total: x.review ? x.review.total : null })),
  };
}

// Approve: the batch file (the door's prices times two takes, read back by the door's own reader), the
// `shotlist:` record (with the hash of the shots as priced and as read, render and prompt included, and the render,
// move and prompt of each shot as the owner read them, T48 F3), the pick, the owner's comment, the goal's older
// batches closed (this approval replaces them, T48 F4), the goal to todo, the taste file. When the comment cannot be
// written, the batch is removed first and the two records are put back as they were; nothing was approved.
async function approveShotlist(ctx, goalId, path, sl, note, done) {
  const chosen = sl.variants.find((x) => x.id === ctx.variant);
  if (!chosen) throw ctx.fail(400, "That treatment is not one of those shown.", "Refresh the page and pick one of the treatments shown.", "bad_variant");
  const { priced, code } = chosen._approve;
  const approved = Array.isArray(chosen._approve.approved) ? chosen._approve.approved : [];
  if (!chosen.approvable || !priced.ok || approved.length !== priced.shots.length) {
    throw ctx.fail(409, chosen.blocked || "This treatment cannot be approved.",
      code === "job_not_ready" || code === "over_limit" ? "Open Settings, then look at the card again." : "Send it back with a note, or approve another treatment.",
      code || "not_approvable");
  }
  const now = new Date();
  const shots = priced.shots.map(({ id, kind, model, seconds }) => ({ id, kind, model, seconds }));
  const batch = writeBatch(ctx.config, {
    task: goalId, slug: "artist", shots, takes: TAKES, textToVideo: shots.some((s) => s.kind === "text_to_video"), now,
    centsPerCredit: priced.centsPerCredit,
  });
  if (batch.budget !== priced.most) {
    removeBatch(ctx.config, batch.id);
    throw ctx.fail(500, "The cost could not be worked out the same way twice, so nothing was approved.", "Try again.", "batch_not_written");
  }
  const before = { shotlist: ctx.decisions.get(`shotlist:${goalId}`), pick: ctx.decisions.get(`pick:${goalId}`) };
  recordApproval(ctx.decisions, goalId, {
    round: sl.round, variant: chosen.id, direction: chosen.direction?.id || null,
    batch: batch.id, budget: batch.budget, base: priced.base, shots: shotsHash(approved),
    approved: approved.map(({ id, render, move, prompt }) => ({ id, render, move, prompt })),
  }, { now });
  recordPick(ctx.decisions, goalId, choiceOf(sl, PICK, chosen.id, note), { now });
  try {
    await writeComment(ctx, path, goalId, `${MARKERS.shotlistAccepted} ${chosen.id} batch ${batch.id}`);
  } catch (e) {
    try { removeBatch(ctx.config, batch.id); } catch (r) { ctx.log?.(`staged: the batch ${batch.id} could not be removed: ${String(r?.code || r?.message || r)}`); }
    try {
      ctx.decisions.set(`shotlist:${goalId}`, before.shotlist ?? null);
      ctx.decisions.set(`pick:${goalId}`, before.pick ?? null);
    } catch { /* the batch is gone, so nothing can be spent */ }
    throw e;
  }
  done();
  closeBatches(ctx.config, [goalId], { keep: batch.id, now: now.getTime(), log: (line) => ctx.log?.(`staged: ${line}`) });
  await thenTry(ctx, "setting the task to todo", () => ctx.board.patch(path, { status: "todo" }));
  await refreshTaste(ctx, { force: true });
  return { message: `Approved. The Artist will make the clips; up to ${batch.budget} credits (${dollars(batch.budget)}) may be spent. You can follow it in Studio.` };
}

async function actOnShotlist(ctx, goalId, path, action, note) {
  const sl = ctx.item._shotlist;
  if (!sl) throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
  const answers = answersOf(ctx);
  if (answers.get(goalId) === sl.readyId) throw ctx.fail(409, "This was already handled.", "Nothing more to do here.", "already_handled");
  answers.set(goalId, sl.readyId);
  if (answers.size > 500) answers.delete(answers.keys().next().value);
  let written = false;
  const done = () => { written = true; };
  try {
    if (action === "approve") return await approveShotlist(ctx, goalId, path, sl, note, done);
    if (action === "another") {
      await writeComment(ctx, path, goalId, note ? `${ANOTHER_LINE}\n\n${note}` : ANOTHER_LINE);
      done();
      recordPick(ctx.decisions, goalId, choiceOf(sl, ANOTHER, null, note));
      await thenTry(ctx, "setting the task to todo", () => ctx.board.patch(path, { status: "todo" }));
      await refreshTaste(ctx, { force: true });
      return { message: "Another round is asked for. The Chief of staff will start it with new directions." };
    }
    if (action === "send_back") {
      await writeComment(ctx, path, goalId, note);
      done();
      recordPick(ctx.decisions, goalId, choiceOf(sl, BACK, null, note));
      await thenTry(ctx, "setting the task to todo", () => ctx.board.patch(path, { status: "todo" }));
      await refreshTaste(ctx, { force: true });
      return { message: "Sent back with your note. The Chief of staff will pick it up." };
    }
    throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
  } finally {
    if (!written && answers.get(goalId) === sl.readyId) answers.delete(goalId);
  }
}

async function act(ctx, itemId, action, note) {
  const goalId = ctx.item._goalId;
  const path = `/api/issues/${encodeURIComponent(goalId)}`;
  const text = typeof note === "string" ? note.trim() : "";
  const kind = itemId.split(":")[1];
  const offered = (ctx.item.actions || []).some((a) => a.id === action);
  if (!offered) throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
  const toTodo = () => thenTry(ctx, "setting the task to todo", () => ctx.board.patch(path, { status: "todo" }));
  try {
    if (kind === "shotlist") return await actOnShotlist(ctx, goalId, path, action, text || null);
    if (action === "stop") {
      // The goal first, then its open steps (lib/stop.mjs).
      const out = await stopTask(ctx, goalId);
      ctx.home?.unstick?.forget?.(goalId);
      return { message: out.message };
    }
    if (kind === "unclear" && action === "answer") {
      await writeComment(ctx, path, goalId, `${MARKERS.answer} ${text}`);
      ctx.decisions.set(`answered:${itemId}`, new Date().toISOString());
      await toTodo();
      return { message: "Answered. The Chief of staff will carry on with your answer." };
    }
    if (kind === "plan" && action === "accept") {
      await writeComment(ctx, path, goalId, MARKERS.planAccepted);
      await toTodo();
      return { message: "Plan accepted. The work will start." };
    }
    if ((kind === "plan" && action === "send_back") || (kind === "stopped" && action === "answer")) {
      await writeComment(ctx, path, goalId, text);
      await toTodo();
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
