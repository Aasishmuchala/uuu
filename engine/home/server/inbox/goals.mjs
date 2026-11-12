// Inbox source "goals": finished goals the owner has not accepted yet (CONTRACTS 9.3, CONTRACTS-V2 17.4).
// Each item's `version` (CONTRACTS 9.3a) is a hash of the newest result and the newest check, read from the
// board on every list (never cached), so Accept acts only on the delivery the owner read.
// An answered question (CONTRACTS-V3 33.5) is the same item with its own title, summary, details and labels.
// A finished task of a job that makes versions (PLAN-V5 K9), whose goal folder holds a valid variants.json, is an
// item of kind "pick": the versions side by side as GET /api/tasks/:id/pieces shows them (routes/pieces.mjs), and
// three actions: `pick` (the pick IS the acceptance: the acknowledged record, the verdict and the `pick:` record,
// and for a post or newsletter the picked draft in the calendar), `another` (the fixed line ANOTHER ROUND and the
// owner's note, the task back to todo) and `reopen` ("Send all back", as Send back). Each brings the taste file up
// to date (lib/taste.mjs). Its version also hashes the pieces' files (stampOf), the newest review comment and the
// versions as shown, so a pick made on a card that has changed is refused. A task without variants.json gets
// today's item.
import { agentNames, commentsOf, descendants, goalsOf, loadIssues, needIds, pickResult } from "../lib/goals.mjs";
import { parseAnswer } from "../lib/answer.mjs";
import { brainFor } from "../brain/store.mjs";
import { isFixTask } from "../lib/draftfix.mjs";
import { capText, plainMarks } from "../lib/format.mjs";
import { versionOf } from "../lib/inbox.mjs";
import { askedQuestion } from "../lib/owner-text.mjs";
import { reviewsOf } from "../lib/artreview.mjs";
import { stampOf } from "../lib/brandcheck.mjs";
import { ANOTHER, BACK, PICK, recordPick } from "../lib/picks.mjs";
import { roundsOf } from "../lib/staged.mjs";
import { refreshTaste } from "../lib/taste.mjs";
import { listTaskFiles, readTaskText } from "../lib/taskfiles.mjs";
import { readVariants } from "../lib/variants.mjs";
import { ACCEPTED, recordVerdict, SENT_BACK } from "../lib/verdicts.mjs";
import { storeOf } from "../content/context.mjs";
import { kindOfTask, piecesFor } from "../routes/pieces.mjs";

// One line of Markdown as plain words: null for a line that is only a mark (a rule, a table divider, a fence).
// `ends` says the line was a heading, list item or table row, `item` that it was a list item.
function plainMdLine(raw) {
  let line = String(raw).trim();
  if (!line) return { line: "", ends: false, item: false };
  if (/^```/.test(line) || (/^[|\s:-]+$/.test(line) && line.includes("-")) || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) return null;
  let ends = false;
  let item = false;
  if (/^#{1,6}\s/.test(line)) { line = line.replace(/^#{1,6}\s+/, ""); ends = true; }
  else if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) { line = line.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ""); ends = true; item = true; }
  else if (line.startsWith(">")) line = line.replace(/^>+\s*/, "");
  if (line.startsWith("|") || /\s\|\s/.test(line)) {
    line = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(", ");
    ends = true;
  }
  line = line
    // Link text and address hold no brackets or parentheses, so each try stops at the next one (linear).
    .replace(/!\[([^[\]]*)\]\([^()]*\)/g, "$1")
    .replace(/\[([^[\]]+)\]\([^()]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/[`*]/g, "").replace(/\s+/g, " ").trim();
  return line ? { line, ends, item } : null;
}

// A finished task's summary as plain text: Markdown marks removed, the words kept, lines joined.
// Only the first part of a long text is read (capText).
export function plainSummary(md) {
  const out = [];
  for (const raw of capText(md).replace(/\r/g, "").split("\n")) {
    const p = plainMdLine(raw);
    if (!p || !p.line) continue;
    out.push(p.ends && !/[.!?:;]$/.test(p.line) ? `${p.line}.` : p.line);
  }
  return out.join(" ");
}

// Agent-written Markdown as plain text that keeps its lines: list items start with "• ", marks are removed,
// at most one empty line in a row. Only the first part of a long text is read (capText).
export function plainLines(md) {
  const out = [];
  for (const raw of capText(md).replace(/\r/g, "").split("\n")) {
    const p = plainMdLine(raw);
    if (!p) continue;
    if (!p.line) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }
    out.push(p.item ? `• ${p.line}` : p.line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

const ackKey = (id) => `acknowledged:goal:${id}`;

// "Passed in round <n>" for the newest round that passed, else "Not checked".
function checkedOf(rounds) {
  const passed = rounds.filter((r) => r.outcome === "pass").at(-1);
  return passed ? `Passed in round ${passed.n}` : "Not checked";
}

// CONTRACTS-V3 33.5: the parsed answer of a finished question (a task with the home server's `ask:` record),
// or null when the task is not a question or its answer file is missing. One that does not parse is returned
// too (wellFormed false): the answer panel shows its text, so the item's version must hash it.
function answerOf(ctx, g) {
  if (!ctx.decisions.get(`ask:${g.id}`) || !g.identifier) return null;
  const hit = readTaskText(ctx.config, g.identifier, "answer.md", { maxBytes: 64 * 1024 });
  return hit ? parseAnswer(hit.text) : null;
}

// The paths of the brain's own listing (never the agent's word).
function listedOf(ctx) {
  try { return new Set(brainFor(ctx.config).list().map((f) => f.path)); } catch { return new Set(); }
}

// How many different files of that listing the answer's sources name: one file named twelve times is one.
const foundOf = (answer, listed) => new Set(answer.sources.filter((s) => listed.has(s.path)).map((s) => s.path)).size;

const cutTo = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// An answered question: its own title, summary, details and button labels; everything else as for any result.
// Its version also hashes what the answer panel shows (the text, each source as shown, what is not in the
// files), so "Got it" never acknowledges an answer that changed after the owner opened it (CONTRACTS 9.3a).
// The question is the one in the `ask:` record (lib/owner-text.mjs askedQuestion), hashed in list() (S8 F3).
function asAnswer(ctx, item, g, answer) {
  const listed = listedOf(ctx);
  const question = askedQuestion(ctx.decisions.get(`ask:${g.id}`), g).text.replace(/\s+/g, " ").trim() || g.title || "";
  item.title = `Answer: ${cutTo(question, 60)}`;
  item.summary = cutTo(plainMarks(answer.text).replace(/\s+/g, " ").trim(), 200);
  item.details = [
    item.details[0],
    { label: "From", value: `${foundOf(answer, listed)} of your files` },
  ];
  const shown = [answer.text, answer.sources.map((s) => [s.n, s.path, s.note, listed.has(s.path)]), answer.notInFiles];
  item.version = versionOf(item.version, JSON.stringify(shown));
  item.actions = [
    { id: "acknowledge", label: "Got it", style: "primary", needsNote: false },
    { id: "reopen", label: "Ask again", style: "plain", needsNote: true },
  ];
  return item;
}

// ---- versions to pick from (PLAN-V5 K9)

// How long a list waits for the home server's brand check before it shows "still running" (the run goes on and
// its result is kept, so the next list has it).
const LIST_BRAND_WAIT_MS = 1500;
const ANOTHER_LINE = "ANOTHER ROUND";
const NUMBER = { 1: "One", 2: "Two", 3: "Three" };
const PICKED = "Picked. Your choice and note are kept for next time.";

// The versions of a finished task as the pick card shows them, or null when the task has no variants.json (or
// is not from a job that makes versions). { problem } when variants.json is there but cannot be used.
async function versionsOf(ctx, g, tree, artDirectorId) {
  let kind = null;
  try { kind = kindOfTask(ctx, g); } catch { kind = null; }
  if (!kind || typeof g.identifier !== "string") return null;
  const v = readVariants(ctx.config, g.identifier, kind);
  if (!v.present) return null;
  if (v.problem) return { problem: v.problem };
  const home = ctx.home && typeof ctx.home === "object" ? ctx.home : {};
  const wait = Math.min(Number.isFinite(home.brandCheckWaitMs) ? home.brandCheckWaitMs : LIST_BRAND_WAIT_MS, LIST_BRAND_WAIT_MS);
  const pieces = await piecesFor({ ...ctx, home: { ...home, brandCheckWaitMs: wait } }, g, tree, { artDirectorId });
  if (pieces.problem) return { problem: pieces.problem };
  if (pieces.single || !pieces.variants.length) return { problem: "The versions' files are missing, so there is nothing to pick from." };
  const reviews = reviewsOf(tree, artDirectorId);
  return { kind, name: v.name, identifier: g.identifier, pieces, stamp: stampOf(ctx.config, g.identifier, { versions: v.variants.map((x) => x.rel) }).key, reviewId: reviews.at(-1)?.commentId || null };
}

const countWords = (n) => (n === 1 ? "One version is ready" : `${NUMBER[n] || n} versions are ready`);

// A finished task's item as a card of versions: the item of today with its own title, summary, details, actions,
// the versions and a version that hashes them.
function asPick(item, versions) {
  const { pieces } = versions;
  const shown = pieces.variants.map((x) => [x.id, x.direction?.id || null, x.review]);
  item.kind = "pick";
  item.title = `Pick one: ${item.title.replace(/^Finished: /, "")}`;
  item.summary = `${countWords(pieces.variants.length)}. Pick one, ask for another round, or send all back with a note.`;
  item.details = [
    { label: "Versions", value: pieces.missing.length
      ? `${pieces.variants.length} to choose from; ${pieces.missing.length === 1 ? "1 has" : `${pieces.missing.length} have`} missing files`
      : `${pieces.variants.length} to choose from` },
    ...(pieces.round ? [{ label: "Round", value: String(pieces.round) }] : []),
    ...(pieces.note ? [{ label: "Scores", value: pieces.note }] : []),
    ...item.details,
  ];
  item.actions = [
    { id: "pick", label: "Pick this one", style: "primary", needsNote: false, takes: "variant" },
    { id: "another", label: "Another round", style: "plain", needsNote: false },
    { id: "reopen", label: "Send all back", style: "plain", needsNote: true },
  ];
  item.pieceKind = pieces.kind;
  item.round = pieces.round;
  item.missing = pieces.missing;
  item.variants = pieces.variants;
  item.version = versionOf(item.version, "pick", versions.stamp, versions.reviewId, JSON.stringify([pieces.round, pieces.missing, shown]));
  Object.defineProperty(item, "_pick", { enumerable: false, value: { kind: versions.kind, name: versions.name, identifier: versions.identifier, round: pieces.round, variants: pieces.variants } });
  return item;
}

async function list(ctx) {
  const ids = needIds(ctx);
  const issues = await loadIssues(ctx, ids.companyId);
  // The taste file follows the owner's records (at most once a minute here; the owner's own actions force it).
  await refreshTaste(ctx, { issues });
  const done = goalsOf(issues, ids).filter((g) => g.status === "done" && !isFixTask(ctx, g.id) && !ctx.decisions.get(ackKey(g.id)));
  if (!done.length) return { items: [] };
  const names = await agentNames(ctx, ids.companyId);
  const items = await Promise.all(done.map(async (g) => {
    const own = await commentsOf(ctx, g.id);
    const steps = await Promise.all(descendants(issues, g.id).map((s) => commentsOf(ctx, s.id)));
    const tree = [...own, ...steps.flat()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const result = pickResult(own, names);
    const text = result?.text ? plainSummary(result.text) : "";
    const files = listTaskFiles(ctx.config, g.identifier).length;
    const resultComment = [...own].reverse().find((x) => /^\s*RESULT:/.test(x.body || "")) || null;
    const rounds = roundsOf(tree, ids.agents?.checker || null);
    const check = rounds.at(-1)?.comment || null;
    const item = {
      id: `goal:${g.id}`,
      source: "goal",
      kind: "result",
      title: `Finished: ${g.title}`,
      raisedBy: "Chief of staff",
      when: g.updatedAt || g.createdAt,
      version: versionOf(resultComment?.id, resultComment?.body, check?.id, check?.body),
      summary: text ? (text.length > 280 ? `${text.slice(0, 279)}…` : text) : "The Chief of staff says this task is finished.",
      severity: "normal",
      details: [
        { label: "Checked", value: checkedOf(rounds) },
        { label: "Files", value: files === 1 ? "1 file" : `${files} files` },
      ],
      actions: [
        { id: "acknowledge", label: "Accept", style: "primary", needsNote: false },
        { id: "reopen", label: "Send back", style: "plain", needsNote: true },
      ],
      link: { page: "tasks", id: g.id },
    };
    Object.defineProperty(item, "_goalId", { enumerable: false, value: g.id });
    // A question's item also hashes the question as shown (the answer panel and the title show it, S8 F3).
    const asked = ctx.decisions.get(`ask:${g.id}`);
    if (asked) item.version = versionOf(item.version, JSON.stringify(["question", askedQuestion(asked, g).text]));
    const answer = answerOf(ctx, g);
    if (answer && !answer.wellFormed) item.version = versionOf(item.version, JSON.stringify([answer.text]));
    if (answer && answer.wellFormed) return asAnswer(ctx, item, g, answer);
    const versions = await versionsOf(ctx, g, tree, ids.agents?.["art-director"] || null);
    if (versions && versions.problem) {
      // The versions cannot be shown: the task is accepted or sent back as any other, and the owner is told why.
      item.details = [...item.details, { label: "Versions", value: versions.problem }];
      item.version = versionOf(item.version, JSON.stringify(["versions", versions.problem]));
      return item;
    }
    return versions ? asPick(item, versions) : item;
  }));
  return { items };
}

// The choice as lib/picks.mjs keeps it: ids, direction ids from the repo's list and numbers, never an agent's word.
function choiceOf(pick, action, variant, note) {
  const versions = pick.variants.map((x) => ({ id: x.id, direction: x.direction?.id || null, total: x.review ? x.review.total : null }));
  const chosen = variant ? pick.variants.find((x) => x.id === variant) : null;
  return {
    action, round: pick.round, note,
    variant: chosen ? chosen.id : null,
    direction: chosen ? chosen.direction?.id || null : null,
    scores: chosen && chosen.review ? chosen.review.scores : null,
    versions,
  };
}

async function actOnPick(ctx, goalId, action, note) {
  const pick = ctx.item._pick;
  const path = `/api/issues/${encodeURIComponent(goalId)}`;
  if (action === "pick") {
    const chosen = pick.variants.find((x) => x.id === ctx.variant);
    if (!chosen) throw ctx.fail(400, "That version is not one of those shown.", "Refresh the page and pick one of the versions shown.", "bad_variant");
    const now = new Date();
    ctx.decisions.set(ackKey(goalId), now.toISOString());
    recordVerdict(ctx.decisions, goalId, ACCEPTED, null, { now });
    recordPick(ctx.decisions, goalId, choiceOf(pick, PICK, chosen.id, note), { now });
    let message = PICKED;
    if (pick.kind === "post" || pick.kind === "newsletter") {
      let added;
      try { added = storeOf(ctx).addPicked(pick.identifier, pick.name, chosen.id); } catch { added = { ok: false }; }
      if (!added.ok) message = `${PICKED} The draft is not in the Marketing calendar: ${added.problem || "it could not be read."}`;
    }
    await refreshTaste(ctx, { force: true });
    return { message };
  }
  if (action === "another") {
    await ctx.board.post(`${path}/comments`, { body: note ? `${ANOTHER_LINE}\n\n${String(note).trim()}` : ANOTHER_LINE });
    recordPick(ctx.decisions, goalId, choiceOf(pick, ANOTHER, null, note));
    await ctx.board.patch(path, { status: "todo" });
    await refreshTaste(ctx, { force: true });
    return { message: "Another round is asked for. The Chief of staff will start it with new directions." };
  }
  if (action === "reopen") {
    await ctx.board.post(`${path}/comments`, { body: String(note).trim() });
    const now = new Date();
    recordVerdict(ctx.decisions, goalId, SENT_BACK, note, { now });
    recordPick(ctx.decisions, goalId, choiceOf(pick, BACK, null, note), { now });
    await ctx.board.patch(path, { status: "todo" });
    await refreshTaste(ctx, { force: true });
    return { message: "Sent back with your note. The Chief of staff will pick it up." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

async function act(ctx, itemId, action, note) {
  const goalId = ctx.item._goalId;
  if (ctx.item.kind === "pick" && ctx.item._pick) return actOnPick(ctx, goalId, action, note);
  if (action === "acknowledge") {
    ctx.decisions.set(ackKey(goalId), new Date().toISOString());
    recordVerdict(ctx.decisions, goalId, ACCEPTED);
    return { message: "Accepted." };
  }
  if (action === "reopen") {
    const path = `/api/issues/${encodeURIComponent(goalId)}`;
    await ctx.board.post(`${path}/comments`, { body: String(note).trim() });
    // The owner's verdict, as the owner gave it, once the board has the note (lib/verdicts.mjs).
    recordVerdict(ctx.decisions, goalId, SENT_BACK, note);
    await ctx.board.patch(path, { status: "todo" });
    return { message: "Sent back with your note. The Chief of staff will pick it up." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "goals", list, act };
