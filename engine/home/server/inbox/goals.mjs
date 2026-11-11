// Inbox source "goals": finished goals the owner has not accepted yet (CONTRACTS 9.3, CONTRACTS-V2 17.4).
// Each item's `version` (CONTRACTS 9.3a) is a hash of the newest result and the newest check, read from the
// board on every list (never cached), so Accept acts only on the delivery the owner read.
import { agentNames, commentsOf, descendants, goalsOf, loadIssues, needIds, pickResult } from "../lib/goals.mjs";
import { isFixTask } from "../lib/draftfix.mjs";
import { capText } from "../lib/format.mjs";
import { versionOf } from "../lib/inbox.mjs";
import { roundsOf } from "../lib/staged.mjs";
import { listTaskFiles } from "../lib/taskfiles.mjs";

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

async function list(ctx) {
  const ids = needIds(ctx);
  const issues = await loadIssues(ctx, ids.companyId);
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
    return item;
  }));
  return { items };
}

async function act(ctx, itemId, action, note) {
  const goalId = ctx.item._goalId;
  if (action === "acknowledge") {
    ctx.decisions.set(ackKey(goalId), new Date().toISOString());
    return { message: "Accepted." };
  }
  if (action === "reopen") {
    const path = `/api/issues/${encodeURIComponent(goalId)}`;
    await ctx.board.post(`${path}/comments`, { body: String(note).trim() });
    await ctx.board.patch(path, { status: "todo" });
    return { message: "Sent back with your note. The Chief of staff will pick it up." };
  }
  throw ctx.fail(400, "That action is not offered for this item.", "Refresh the inbox and pick one of the buttons shown.", "bad_action");
}

export default { id: "goals", list, act };
