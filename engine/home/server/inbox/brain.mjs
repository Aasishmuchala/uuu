// Inbox source "brain": tidy-ups in the owner's own files, shown in Needs you (PLAN-BRAIN B11, T12).
// Two kinds of item:
//  - findings of the fixed rules (brain/tidy.mjs) over the owner's file passages in the brain index: a repeat,
//    two files that disagree on a figure, a date that has passed. No agent and no model is involved.
//  - suggestions filed by the Chief of staff (the owner's decision of 18 Nov 2026): one brain file and a short
//    note of at most 600 characters. The note is shown quoted and labelled as written by an agent. No press
//    writes the agent's words into the brain; the owner edits the file. Agent text never reaches the brain
//    or the index (ADR 0008). Suggestions are kept in the home server's decisions (state/home), never under
//    knowledge/. Filing is off until the owner switches it on (setSuggestionsOn).
// This module never changes the brain: it only reads the brain's listing and the index. With the brain switch
// off it lists nothing and builds no index (T18's finding 4).
import { createHash } from "node:crypto";
import { brainFor, brainToken } from "../brain/store.mjs";
import { indexFor } from "../brain/indexer.mjs";
import { brainOn } from "../brain/notes.mjs";
import { findings, TITLES } from "../brain/tidy.mjs";
import { HomeError } from "../lib/errors.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";
import { istNow } from "../routes/_departments.mjs";

export const MAX_NOTE = 600;
export const MAX_WAITING = 50;
export const MAX_KEPT = 100;
export const MAX_PER_TASK = 5;
export const AGENT = "chief-of-staff";
export const AGENT_NAME = "Chief of staff";
export const NOTES_KEY = "braintidynotes";
export const SWITCH_KEY = "braintidyagents";
export const DISMISSED = "This will not be shown again.";
export const AGENT_LABEL = "Note written by an agent";
const SUGGESTION_TITLE = "An agent suggests a tidy-up";
const SUGGESTION_SUMMARY = "An agent wrote a note about this file. Nothing is changed in your brain unless you edit the file yourself.";
const MAX_VALUE = 300;
const MAX_ROWS = 20000;

const dismissKey = (key) => `braintidy:${key}`;
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const squeeze = (s) => String(s).replace(/\s+/gu, " ").trim();
// Control, zero-width and direction marks never reach the owner's screen.
const UNSEEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu;
const plain = (s) => squeeze(String(s).replace(UNSEEN, " "));
const act = (id, label, style = "plain") => ({ id, label, style, needsNote: false });

export const suggestionKey = (path, note) => {
  const h = createHash("sha256");
  for (const p of ["suggestion", path, note]) h.update(String(p)).update("\u0000");
  return h.digest("hex").slice(0, 16);
};

// ---- the switch and the store of suggestions (in the home server's decisions)

export const suggestionsOn = (ctx) => ctx?.decisions?.get(SWITCH_KEY) === "on";

export function setSuggestionsOn(ctx, on) {
  ctx.decisions.set(SWITCH_KEY, on === true ? "on" : "off");
}

// The kept suggestions, each checked again: a key, a path, a note of the allowed size, a time.
function keptOf(ctx) {
  const raw = ctx?.decisions?.get(NOTES_KEY);
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== "object") continue;
    const { key, path, note, at } = e;
    if (typeof key !== "string" || typeof path !== "string" || typeof note !== "string" || typeof at !== "string") continue;
    if (note.length < 1 || note.length > MAX_NOTE || path.length > 300 || key !== suggestionKey(path, note)) continue;
    out.push({ key, path, note, at });
  }
  return out;
}

const listedPaths = (ctx) => {
  try { return new Set(brainFor(ctx.config).list().map((f) => f.path)); } catch { return new Set(); }
};

const isDismissed = (ctx, key) => ctx.decisions.get(dismissKey(key)) != null;

// File one suggestion: a brain file the store lists and a short note. Only the Chief of staff may file one,
// and only while the owner has switched filing on. -> { key, filed } (filed false for one already kept).
export function fileSuggestion(ctx, { agent, path, note, now = new Date() } = {}) {
  if (!suggestionsOn(ctx)) {
    throw new HomeError(409, "Agents do not suggest tidy-ups yet.", "Switch it on first if you want them.", "tidy_off");
  }
  if (agent !== AGENT) {
    throw new HomeError(403, "Only the Chief of staff can suggest a tidy-up.", "", "tidy_not_allowed");
  }
  if (typeof path !== "string" || !listedPaths(ctx).has(path)) {
    throw new HomeError(400, "That is not a file in the brain.", "Name a file as the Files page lists it.", "tidy_bad_file");
  }
  if (typeof note !== "string" || note.length > 4 * MAX_NOTE) {
    throw new HomeError(400, "The note must be short text.", "Write at most 600 characters.", "tidy_bad_note");
  }
  const text = plain(note);
  if (!text || text.length > MAX_NOTE) {
    throw new HomeError(400, "The note must be between 1 and 600 characters.", "Write it again, shorter.", "tidy_bad_note");
  }
  const key = suggestionKey(path, text);
  const kept = keptOf(ctx);
  if (kept.some((k) => k.key === key)) return { key, filed: false };
  const waiting = kept.filter((k) => !isDismissed(ctx, k.key));
  if (waiting.length >= MAX_WAITING) {
    throw new HomeError(429, "Too many tidy-up notes are waiting.", "Look at the ones in Needs you first.", "tidy_full");
  }
  const next = [...kept.filter((k) => !isDismissed(ctx, k.key)), { key, path, note: text, at: now.toISOString() }].slice(-MAX_KEPT);
  ctx.decisions.set(NOTES_KEY, next);
  return { key, filed: true };
}

// The routine's way in: a finished task of the Chief of staff may hold `brain-tidy.json`, a list of
// { path, note }. At most five are read; a bad one is skipped. -> how many were filed.
export function fileFromTask(ctx, identifier) {
  if (!suggestionsOn(ctx)) return 0;
  const hit = readTaskText(ctx.config, identifier, "brain-tidy.json", { maxBytes: 16 * 1024 });
  if (!hit || hit.truncated) return 0;
  let list;
  try { list = JSON.parse(hit.text); } catch { return 0; }
  let filed = 0;
  for (const e of (Array.isArray(list) ? list : []).slice(0, MAX_PER_TASK)) {
    if (!e || typeof e !== "object") continue;
    try { if (fileSuggestion(ctx, { agent: AGENT, path: e.path, note: e.note }).filed) filed += 1; } catch { /* skip it */ }
  }
  return filed;
}

// ---- items

function filePassages(config, ctx) {
  const ix = indexFor(config).open();
  if (!ix) return null;
  try {
    const rows = ix.db.prepare(
      "SELECT kind, trust, source, title, locator, ord, text FROM passages WHERE kind = 'file' AND trust = 'owner' ORDER BY source, ord LIMIT ?",
    ).all(MAX_ROWS);
    return { rows, builtAt: ix.builtAt };
  } catch (e) {
    try { ctx.log(`brain tidy: ${String(e?.message || e).split("\n")[0]}`); } catch { /* nothing to do */ }
    return null;
  } finally {
    try { ix.db.close(); } catch { /* closed */ }
  }
}

function findingItem(f, titles, when) {
  const detail = (p) => ({ label: titles.get(p.source) || p.source, value: cut(plain(p.text), MAX_VALUE) });
  return {
    id: `brain:${f.key}`,
    source: "brain",
    kind: "question",
    severity: "normal",
    raisedBy: "Home screen",
    when,
    title: TITLES[f.kind],
    summary: f.why,
    details: f.b ? [detail(f.a), detail(f.b)] : [detail(f.a)],
    link: { page: "files", id: brainToken(f.a.source) },
    version: f.key,
    actions: [act("dismiss", "Not a problem")],
  };
}

function suggestionItem(s, titles) {
  return {
    id: `brain:${s.key}`,
    source: "brain",
    kind: "question",
    severity: "normal",
    raisedBy: AGENT_NAME,
    when: s.at,
    title: SUGGESTION_TITLE,
    summary: SUGGESTION_SUMMARY,
    details: [
      { label: titles.get(s.path) || s.path, value: s.path },
      { label: AGENT_LABEL, value: `“${s.note}”` },
    ],
    link: { page: "files", id: brainToken(s.path) },
    version: s.key,
    actions: [act("open", "Open the file", "primary"), act("dismiss", "Not a problem")],
  };
}

async function list(ctx) {
  if (!brainOn(ctx.config)) return { items: [] };
  indexFor(ctx.config).ensureFresh(ctx);
  const items = [];
  const got = filePassages(ctx.config, ctx);
  if (got) {
    const titles = new Map();
    for (const r of got.rows) if (!titles.has(r.source)) titles.set(r.source, plain(r.title));
    const when = Number.isFinite(Date.parse(got.builtAt)) ? new Date(Date.parse(got.builtAt)).toISOString() : undefined;
    for (const f of findings(got.rows, { today: istNow().today })) {
      if (!isDismissed(ctx, f.key)) items.push(findingItem(f, titles, when));
    }
  }
  const listed = listedPaths(ctx);
  const titles = new Map(got ? got.rows.map((r) => [r.source, plain(r.title)]) : []);
  for (const s of keptOf(ctx)) {
    if (!listed.has(s.path) || isDismissed(ctx, s.key)) continue;
    items.push(suggestionItem(s, titles));
  }
  return { items };
}

async function act_(ctx, itemId, action) {
  const key = String(itemId).slice("brain:".length);
  if (action === "open") {
    const s = keptOf(ctx).find((k) => k.key === key);
    if (!s) throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
    return { message: `Open Files and look for ${s.path}. Nothing was changed.` };
  }
  if (action !== "dismiss") {
    throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
  }
  ctx.decisions.set(dismissKey(key), new Date().toISOString());
  return { message: DISMISSED };
}

export default { id: "brain", list, act: act_ };
