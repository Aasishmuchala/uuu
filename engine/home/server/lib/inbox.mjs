// The inbox merge (CONTRACTS 9.3): every inbox source is asked at once; a source that fails or is
// not connected adds a `notConnected` entry and never fails the whole list.
// Versions (CONTRACTS 9.3a): an item may carry `version`, a short string a source computes from what it
// reads. An action re-reads every source (with `ctx.acting` set, so no source answers from a cache) and is
// refused when the item has a version and the browser did not send that same version back: the owner
// acts only on what the owner saw. No source keeps any memory of what was shown.
// When the item is missing from that re-read because its own source could not be read (the board or the books
// did not answer in time), the action says so with the source's own plain words and next step (502), never
// "no longer waiting for you": the item may well still be there.
// PLAN-V5 K9: an item of kind "pick" (a task's versions, inbox/goals.mjs) offers `pick`, which takes `variant`
// (a, b or c, and nothing else, on no other item or action); a stale version of such an item is refused with
// its own sentence, before anything is written.
import { createHash } from "node:crypto";
import { HomeError } from "./errors.mjs";

// A version from the texts an item shows: the first 16 hex characters of a SHA-256 over them.
export function versionOf(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(String(p ?? "")).update("\u0000");
  return h.digest("hex").slice(0, 16);
}

function plainReason(e) {
  if (e instanceof HomeError) return e.message;
  return "This part could not be read just now.";
}

// Which source lists the items of each id prefix (`board:…`, `goal:…`, `staged:…`, `bench:…`, `content:…`).
const PREFIX_SOURCE = { board: "board", goal: "goals", staged: "staged", bench: "bench", content: "content" };

function unreadError(reason) {
  return new HomeError(502, reason || "This part could not be read just now.",
    "Try again in a minute. If it keeps happening, look at Health.", "source_unread");
}

// The task an item is about: its own taskId, or the goal its link points at (decorateInbox reads the same link).
function taskOf(item) {
  if (typeof item.taskId === "string" && item.taskId) return item.taskId;
  const l = item.link;
  return l && (l.page === "goals" || l.page === "tasks") && typeof l.id === "string" ? l.id : null;
}

// The board's "blocked" problem item (a stuck step or a blocker), as against a failed run or an agent error.
const BLOCKED_KINDS = new Set(["recovery_action", "blocker_attention"]);

// The one task an item is about: the step or goal itself when its source knows it (`_about`, a board record's
// id), else the task of its link.
export function aboutOf(item) {
  if (item && typeof item._about === "string" && item._about) return item._about;
  return item ? taskOf(item) : null;
}

// The task an item is about and its ancestors, nearest first (`_chain`, from the board's own parent links),
// ending with the goal its link points at.
function chainOf(item) {
  const out = Array.isArray(item._chain) ? item._chain.filter((x) => typeof x === "string" && x) : [];
  for (const id of [aboutOf(item), taskOf(item)]) if (id && !out.includes(id)) out.push(id);
  return out;
}

const VARIANT = /^[abc]$/;
export const PICK_CHANGED = "These versions changed since you looked. Read them again.";

const offers = (item, ...ids) => (Array.isArray(item.actions) ? item.actions : []).some((a) => a && ids.includes(a.id));

// An item that waits for the owner on purpose: a question that can be answered or accepted, or the staged plan
// to accept. A question card that offers only Hide waits for nothing.
export function waitsOnOwner(item) {
  if (!item) return false;
  if (item.kind === "question") return offers(item, "answer", "accept");
  return item.source === "goal" && item.kind === "approval" && String(item.id).startsWith("staged:plan:") && offers(item, "accept");
}

// A task the Chief of staff blocked on purpose waits for a question or a plan (waitsForOwner in tasks.mjs uses
// the same rule). Then the board's own blocked problem item for that task, or for a step under it, is a second
// item for one thing, and is dropped from the list. A question on one step never hides another step's item.
function dropDuplicateBlocked(items, owners) {
  const waiting = new Set();
  for (const i of items) {
    const id = waitsOnOwner(i) ? aboutOf(i) : null;
    if (id) waiting.add(id);
  }
  if (!waiting.size) return;
  for (let n = items.length - 1; n >= 0; n--) {
    const i = items[n];
    if (i.source !== "board" || i.kind !== "problem" || !BLOCKED_KINDS.has(i._raw?.sourceKind)) continue;
    if (chainOf(i).some((id) => waiting.has(id))) {
      items.splice(n, 1);
      owners.delete(i.id);
    }
  }
}

// A task the board holds has its own "A task stopped" item. The board's "run failed" item for the same task
// cannot be retried while it is held, so only the held item stays: one item per stopped task. Only the exact
// task held counts (a hold item lists every held task of its goal in `_raw.issueIds`).
export const isHeld = (i) => !!i && i.source === "board" && i.kind === "problem"
  && (i._raw?.sourceKind === "execution_hold" || String(i.id).startsWith("board:hold:"));

function dropFailedWhileHeld(items, owners) {
  const held = new Set();
  for (const i of items) {
    if (!isHeld(i)) continue;
    const list = Array.isArray(i._raw?.issueIds) && i._raw.issueIds.length ? i._raw.issueIds : [aboutOf(i)];
    for (const id of list) if (id) held.add(id);
  }
  if (!held.size) return;
  for (let n = items.length - 1; n >= 0; n--) {
    const i = items[n];
    const id = aboutOf(i);
    if (i.source === "board" && i.kind === "problem" && id && held.has(id) && i._raw?.sourceKind === "failed_run") {
      items.splice(n, 1);
      owners.delete(i.id);
    }
  }
}

export async function mergeInbox(ctx, sources) {
  const items = [];
  const notConnected = [];
  const owners = new Map();
  const unread = new Map(); // source id -> the error to give for an action on one of its items
  await Promise.all(sources.map(async (src) => {
    try {
      const out = (await src.list(ctx)) || {};
      for (const item of Array.isArray(out.items) ? out.items : []) {
        if (!item || typeof item.id !== "string" || owners.has(item.id)) continue;
        owners.set(item.id, src);
        items.push(item);
      }
      if (out.notConnected) {
        notConnected.push({ source: out.notConnected.source || src.id, reason: out.notConnected.reason });
        unread.set(src.id, unreadError(typeof out.notConnected.reason === "string" ? out.notConnected.reason : null));
      }
    } catch (e) {
      if (!(e instanceof HomeError)) ctx.log(`inbox source ${src.id} failed: ${String(e?.message || e).split("\n")[0]}`);
      notConnected.push({ source: src.id, reason: plainReason(e) });
      unread.set(src.id, e instanceof HomeError ? e : unreadError(null));
    }
  }));
  dropDuplicateBlocked(items, owners);
  dropFailedWhileHeld(items, owners);
  const t = (i) => Date.parse(i.when) || 0;
  items.sort((a, b) => ((b.severity === "high") - (a.severity === "high")) || (t(b) - t(a)));
  const bySource = {};
  for (const i of items) bySource[i.source] = (bySource[i.source] || 0) + 1;
  notConnected.sort((a, b) => String(a.source).localeCompare(String(b.source)));
  return { items, counts: { total: items.length, bySource }, notConnected, owners, unread };
}

// The home server's own record of the owner's newest action on a task (`acted:<task id>`, a time): a block the
// owner has just answered is shown as waiting its turn, not as a new "blocked" card (lib/turn.mjs). Hiding an item
// or stopping a task is not an answer.
const NOT_ANSWERS = new Set(["dismiss", "stop"]);
function recordActed(ctx, item, action) {
  if (NOT_ANSWERS.has(action) || !ctx.decisions || typeof ctx.decisions.set !== "function") return;
  const chain = chainOf(item);
  const goalId = taskOf(item) || chain[chain.length - 1] || null;
  if (!goalId) return;
  try { ctx.decisions.set(`acted:${goalId}`, new Date().toISOString()); } catch { /* the action itself is done */ }
}

export function createActor(sources) {
  const handled = new Map(); // item id -> time, so a second click says "already handled"

  return async function act(ctx, { id, action, note, version, variant }) {
    if (typeof id !== "string" || !id || typeof action !== "string" || !action) {
      throw new HomeError(400, "The home screen did not say which item and which action.", "Refresh the page and try again.", "bad_request");
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      throw new HomeError(400, "The note must be text.", "Write the note again and send it.", "bad_request");
    }
    if (version !== undefined && version !== null && typeof version !== "string") {
      throw new HomeError(400, "The home screen sent a version it should not have.", "Refresh the page and try again.", "bad_request");
    }
    const hasVariant = variant !== undefined && variant !== null;
    if (hasVariant && (typeof variant !== "string" || !VARIANT.test(variant))) {
      throw new HomeError(400, "That is not one of the versions.", "Refresh the page and pick one of the versions shown.", "bad_variant");
    }
    const { items, owners, unread } = await mergeInbox({ ...ctx, acting: true }, sources);
    const item = items.find((i) => i.id === id);
    if (!item) {
      if (handled.has(id)) throw new HomeError(409, "This was already handled.", "Nothing more to do here.", "already_handled");
      // Its source could not be read: say why, not "gone". An unknown prefix with any source unread is the same.
      const owner = PREFIX_SOURCE[id.split(":")[0]];
      const why = owner ? unread.get(owner) : unread.values().next().value;
      if (why) throw why;
      throw new HomeError(404, "This item is no longer waiting for you.", "Refresh the inbox.", "not_found");
    }
    const spec = (item.actions || []).find((a) => a.id === action);
    if (!spec) throw new HomeError(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
    const text = typeof note === "string" ? note.trim() : "";
    if (spec.needsNote && !text) {
      throw new HomeError(400, "This needs a short note.", "Write what should change, then send it.", "needs_note");
    }
    if (text.length > 4000) throw new HomeError(400, "The note is too long.", "Keep it under 4000 characters.", "note_too_long");
    const picking = item.kind === "pick" && action === "pick";
    if (hasVariant && !picking) {
      throw new HomeError(400, "A version can be picked only on a card of versions.", "Refresh the inbox and pick one of the buttons shown.", "bad_variant");
    }
    if (picking && !hasVariant) {
      throw new HomeError(400, "Pick one of the versions first.", "Choose the version you want, then press Pick this one.", "needs_variant");
    }
    if (typeof item.version === "string" && item.version && version !== item.version) {
      if (item.kind === "pick") throw new HomeError(409, PICK_CHANGED, "Look at the versions again, then decide.", "changed_since_seen");
      throw new HomeError(409, "This changed after you looked at it. Nothing was done.", "Look at it again, then decide.", "changed_since_seen");
    }
    const out = await owners.get(id).act({ ...ctx, acting: true, item, variant: picking ? variant : null }, id, action, text || null);
    handled.set(id, Date.now());
    recordActed(ctx, item, action);
    if (handled.size > 500) handled.delete(handled.keys().next().value);
    return { ok: true, message: out?.message || "Done." };
  };
}
