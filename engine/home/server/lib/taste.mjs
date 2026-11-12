// The taste file (PLAN-V5 K9): `brand/taste.md` in the company brain, what the owner picked, sent back and asked
// again for, by kind of piece. Every maker and the Art director read it before a piece of that kind, as "what the
// owner likes", so nothing an agent wrote may reach it (docs/adr/0007). It is built only from:
//   - which tasks and of which kind: the home server's own `template:` records and the repo's craft.json
//     (routes/pieces.mjs kindOfTask); never variants.json's own word;
//   - the owner's choices: the home server's `pick:` records (lib/picks.mjs) and `verdicts:` records
//     (lib/verdicts.mjs); a verdict written in the same moment as a choice is that choice, not a second line;
//   - direction titles from the repo's directions.json, looked up by the id in the record (an id the repo does
//     not list is never written: the line says "a version" instead);
//   - the owner's own note, through noteLine (one line, cleaned, capped);
//   - dates and fixed words.
// Newest first, at most 30 lines a kind. refreshTaste writes the file through the brain store only when its text
// changes, and never throws.
import { brainFor } from "../brain/store.mjs";
import { KINDS } from "../../../company/lib/craft-files.mjs";
import { goalsOf, loadIssues } from "./goals.mjs";
import { ANOTHER, BACK, directionTitle, PICK, picksOf } from "./picks.mjs";
import { dateText } from "./recipes.mjs";
import { ACCEPTED, noteLine, verdictsOf } from "./verdicts.mjs";
import { kindOfTask } from "../routes/pieces.mjs";

export const TASTE_PATH = "brand/taste.md";
export const LINES_PER_KIND = 30;
const CHECK_EVERY = 60000;

// "Title card" from "title-card": the repo's kind id with spaces and a capital.
export const kindTitle = (kind) => {
  const t = String(kind).replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const quoted = (s) => `"${s}"`;
const andList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const COUNT = { 1: "it", 2: "both", 3: "all three" };

const timeOf = (v) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

function noteText(note) {
  const n = noteLine(note);
  return n ? ` Your note: ${quoted(n)}` : "";
}

// One choice on a card of versions as a line's words (after the date). Pure.
export function choiceWords(kind, p) {
  if (p.action === PICK) {
    const title = directionTitle(kind, p.direction);
    const others = p.versions.filter((v) => v.id !== p.variant)
      .map((v) => directionTitle(kind, v.direction)).filter(Boolean).map(quoted);
    const picked = title ? `picked ${quoted(title)}` : "picked a version";
    return `${picked}${others.length ? ` over ${andList(others)}` : ""}.${noteText(p.note)}`;
  }
  if (p.action === BACK) {
    return `sent ${COUNT[p.versions.length] || "them all"} back.${noteText(p.note)}`;
  }
  if (p.action === ANOTHER) return `asked for another round.${noteText(p.note)}`;
  return null;
}

// tasteEvents(ctx, goals) -> Map(kind -> [{ at, words }]), newest first, at most 30 a kind.
export function tasteEvents(ctx, goals) {
  const byKind = new Map();
  for (const g of goals) {
    let kind = null;
    try { kind = kindOfTask(ctx, g); } catch { kind = null; }
    if (!kind) continue;
    const list = byKind.get(kind) || [];
    const picks = picksOf(ctx.decisions, g.id);
    const choiceTimes = new Set(picks.map((p) => p.at));
    for (const p of picks) {
      const words = choiceWords(kind, p);
      const at = timeOf(p.at);
      if (words && at !== null) list.push({ at, words });
    }
    for (const v of verdictsOf(ctx.decisions, g.id)) {
      if (choiceTimes.has(v.at)) continue;
      const at = timeOf(v.at);
      if (at === null) continue;
      list.push({ at, words: v.verdict === ACCEPTED ? "accepted it." : `sent it back.${noteText(v.note)}` });
    }
    if (list.length) byKind.set(kind, list);
  }
  for (const [kind, list] of byKind) byKind.set(kind, list.sort((a, b) => b.at - a.at).slice(0, LINES_PER_KIND));
  return byKind;
}

// The file's text: fixed words, kind titles, direction titles from the repo, dates and the owner's notes. Pure.
export function renderTaste(byKind) {
  const lines = [
    "# Taste: what the owner picked",
    "",
    "What the owner picked, sent back and asked again for, by kind of piece. Newest first. Read the part for the kind you are making before you start.",
    "The home screen writes this file from the owner's own choices and notes. Agents do not write it.",
  ];
  const kinds = KINDS.filter((k) => byKind.has(k) && byKind.get(k).length);
  if (!kinds.length) lines.push("", "Nothing yet.");
  for (const kind of kinds) {
    lines.push("", `## ${kindTitle(kind)}`);
    for (const e of byKind.get(kind)) lines.push(`- ${dateText(e.at)}: ${e.words}`);
  }
  return `${lines.join("\n")}\n`;
}

// writeTaste(ctx, { issues }) -> { written }: builds the file and writes it only when its text would change.
// Nothing is written while there is nothing to say and no file yet. May throw.
export async function writeTaste(ctx, { issues = null } = {}) {
  const ids = ctx.ids();
  if (!ids?.companyId || !ids?.projectId) return { written: false };
  const all = Array.isArray(issues) ? issues : await loadIssues(ctx, ids.companyId);
  const byKind = tasteEvents(ctx, goalsOf(all, ids));
  const brain = brainFor(ctx.config);
  const current = brain.find(TASTE_PATH);
  if (!current && !byKind.size) return { written: false };
  const text = renderTaste(byKind);
  if (current) {
    const now = brain.get(current.token);
    if (!now.truncated && now.text === text) return { written: false };
  }
  brain.replace(TASTE_PATH, text, current ? current.version : null);
  return { written: true };
}

// state folder -> when the file was last checked without being asked to
const checked = new Map();

// refreshTaste(ctx, { issues, force, now }) -> { written }. The owner's own actions pass force (the file is
// right before the next agent reads it); an inbox list checks at most once a minute. Never throws.
export async function refreshTaste(ctx, { issues = null, force = false, now = Date.now() } = {}) {
  try {
    const key = ctx.config.paths.state;
    if (!force) {
      const last = checked.get(key);
      if (last !== undefined && now - last < CHECK_EVERY) return { written: false, skipped: true };
    }
    checked.set(key, now);
    if (checked.size > 50) for (const k of checked.keys()) { checked.delete(k); if (checked.size <= 25) break; }
    return await writeTaste(ctx, { issues });
  } catch (e) {
    try { ctx.log?.(`taste file: ${String(e?.message || e).split("\n")[0]}`); } catch { /* never fail the caller */ }
    return { written: false };
  }
}

// For tests: forget when the file was last checked.
export function forgetTasteChecks() {
  checked.clear();
}
