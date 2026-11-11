// CONTRACTS-V2 17.5: GET /api/team and GET /api/team/:slug. Read-only. The lesson routes live in
// routes/team-lessons.mjs. Everything an agent wrote (comments, lessons, file names) is untrusted text:
// it is capped, never rendered as HTML and never followed.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { HomeError } from "../lib/errors.mjs";
import { descendants } from "../lib/goals.mjs";
import { textOf } from "../lib/staged.mjs";
import { fileEntry, listTaskFiles } from "../lib/taskfiles.mjs";
import { agentCards, loadRoles, profileOf } from "../lib/team.mjs";
import { loadTaskContext, taskCard } from "../lib/tasks.mjs";

const MAX_LESSONS_BYTES = 256 * 1024;
const MAX_LESSONS = 500;
const MAX_CONVERSATION = 100;
const MAX_RECENT = 10;
const MAX_FILES = 5;
const MAX_TEXT = 4000;
const MAX_TASKS_READ = 40;

const WHO_YOU = { slug: "you", name: "You" };
const stamp = (s) => Date.parse(s) || 0;
const who = (r) => ({ slug: r.slug, name: r.name });

// state/lessons/<slug>.md, read with O_NOFOLLOW and capped; "" when missing, a link or unreadable.
function readLessonsFile(config, slug) {
  let fd;
  try {
    fd = openSync(join(config.paths.lessons, `${slug}.md`), constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile()) return "";
    const len = Math.min(st.size, MAX_LESSONS_BYTES);
    const buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const n = readSync(fd, buf, off, len - off, off);
      if (n <= 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
  }
}

export function lessonsOf(config, slug) {
  const out = [];
  for (const raw of readLessonsFile(config, slug).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2);
    const m = /^(\d{4}-\d{2}-\d{2}): ([\s\S]*)$/.exec(body);
    out.push({
      n: out.length + 1, date: m ? m[1] : null, text: m ? m[2] : body,
      hash: createHash("sha256").update(line).digest("hex").slice(0, 8),
    });
    if (out.length >= MAX_LESSONS) break;
  }
  return out;
}

const forName = (goal) => {
  const f = textOf(goal.description || "").for;
  return typeof f === "string" ? f.trim().toLowerCase() : null;
};

// The files a comment names that exist in the goal's folder, at most five.
function filesNamed(config, goal, body) {
  if (!goal.identifier) return [];
  let list;
  try { list = listTaskFiles(config, goal.identifier); } catch { return []; }
  const out = [];
  for (const f of list) {
    const base = f.name.split("/").pop();
    if (body.includes(f.name) || body.includes(base)) out.push(fileEntry(goal.identifier, f.name, f.size));
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

async function conversationOf(ctx, tctx, role, agentId) {
  const name = role.name.toLowerCase();
  const items = [];
  const chief = tctx.agents && [...tctx.agents.values()].find((a) => a.slug === "chief-of-staff");
  const chiefWho = chief ? { slug: chief.slug, name: chief.name } : { slug: "chief-of-staff", name: "Chief of staff" };
  const asked = [...tctx.goals].sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
  let read = 0;
  for (const goal of asked) {
    const steps = descendants(tctx.issues, goal.id);
    const mine = steps.filter((s) => agentId && s.assigneeAgentId === agentId);
    const named = forName(goal) === name;
    if (!named && !mine.length) continue;
    if (read++ >= MAX_TASKS_READ) break;
    if (named) {
      items.push({
        who: WHO_YOU, kind: "ask", text: textOf(goal.description || "").text.slice(0, MAX_TEXT) || goal.title,
        at: goal.createdAt, taskId: goal.id, identifier: goal.identifier, files: [],
      });
    }
    for (const step of mine) {
      items.push({
        who: chiefWho, kind: "ask", text: String(step.title || "").slice(0, MAX_TEXT),
        at: step.createdAt, taskId: goal.id, identifier: goal.identifier, files: [],
      });
    }
    // The agent's own comments, on the task or on any step; the last one on a finished step is the result.
    for (const issue of [goal, ...steps]) {
      let comments;
      try { comments = await tctx.commentsOf(issue.id); } catch { continue; }
      const own = (Array.isArray(comments) ? comments : [])
        .filter((c) => agentId && c.authorAgentId === agentId)
        .sort((a, b) => stamp(a.createdAt) - stamp(b.createdAt));
      own.forEach((c, i) => {
        const body = String(c.body || "").slice(0, MAX_TEXT);
        const isResult = issue.status === "done" && i === own.length - 1;
        items.push({
          who: who(role), kind: isResult ? "result" : "comment", text: body, at: c.createdAt,
          taskId: goal.id, identifier: goal.identifier, files: isResult ? filesNamed(ctx.config, goal, body) : [],
        });
      });
    }
  }
  const order = { ask: 0, comment: 1, result: 2 };
  items.sort((a, b) => stamp(a.at) - stamp(b.at) || order[a.kind] - order[b.kind]);
  return items.slice(-MAX_CONVERSATION);
}

function recentOf(tctx, role, agentId) {
  const name = role.name.toLowerCase();
  const chief = role.slug === "chief-of-staff";
  const goals = tctx.goals.filter((g) => {
    if (chief || (agentId && g.assigneeAgentId === agentId) || forName(g) === name) return true;
    return !!agentId && descendants(tctx.issues, g.id).some((s) => s.assigneeAgentId === agentId);
  });
  goals.sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
  return goals.slice(0, MAX_RECENT).map((g) => taskCard(g, tctx));
}

async function boardContext(ctx) {
  try {
    return await loadTaskContext(ctx, { withInbox: true, withComments: "open" });
  } catch (e) {
    if (e instanceof HomeError) return { error: e };
    throw e;
  }
}

export default function register(app) {
  app.get("/api/team", async (ctx) => {
    const roles = loadRoles(ctx.config);
    const tctx = await boardContext(ctx);
    const generatedAt = new Date().toISOString();
    if (tctx.error) {
      return {
        connected: false, notConnected: { reason: tctx.error.message, next: tctx.error.next },
        agents: agentCards(ctx, null), generatedAt,
      };
    }
    return { connected: true, notConnected: null, agents: agentCards(ctx, tctx), generatedAt };
  });

  app.get("/api/team/:slug", async (ctx) => {
    const roles = loadRoles(ctx.config);
    const role = roles.find((r) => r.slug === ctx.params.slug);
    if (!role) throw ctx.fail(404, "There is no such agent.", "Pick an agent from the Team page.", "agent_not_found");
    const tctx = await boardContext(ctx);
    const generatedAt = new Date().toISOString();
    const profile = profileOf(role, ctx.config);
    const instructions = { text: String(role.instructions || "").slice(0, MAX_LESSONS_BYTES), file: `roles/${role.slug}.md` };
    const lessons = lessonsOf(ctx.config, role.slug);
    if (tctx.error) {
      return {
        agent: agentCards(ctx, null).find((c) => c.slug === role.slug), profile, instructions, lessons,
        recent: [], conversation: [], generatedAt,
      };
    }
    const card = agentCards(ctx, tctx).find((c) => c.slug === role.slug);
    const agentId = card.applied ? card.id : null;
    return {
      agent: card, profile, instructions, lessons,
      recent: recentOf(tctx, role, agentId),
      conversation: await conversationOf(ctx, tctx, role, agentId),
      generatedAt,
    };
  });
}
