// CONTRACTS-V2 17.2: GET /api/home. What needs the owner, what is running, today's brief.
// Read only. The brief file and the lessons were written by agents: read through the safe reader, cut to size.
import { opendirSync } from "node:fs";
import { join } from "node:path";
import { HomeError } from "../lib/errors.mjs";
import { descendants } from "../lib/goals.mjs";
import { mergeInbox } from "../lib/inbox.mjs";
import { readChecked, readTaskText } from "../lib/taskfiles.mjs";
import { decorateInbox, findTask, loadTaskContext, taskCard } from "../lib/tasks.mjs";
import { agentCards, DEPARTMENTS, loadRoles } from "../lib/team.mjs";
import { computeBrief, MAX_ITEMS, parseBrief } from "./_brief.mjs";

export default function register(app) {
  app.get("/api/home", async (ctx) => {
    const now = Date.now();
    const company = { name: ctx.config.paperclip.companyName };
    const roles = safeRoles(ctx);
    const merged = await mergeInbox(ctx, ctx.home.inboxSources);

    let tctx = null;
    let boardOff = null;
    try {
      tctx = await loadTaskContext(ctx, { withInbox: false });
    } catch (e) {
      if (!(e instanceof HomeError)) throw e;
      boardOff = { reason: e.message, next: e.next };
    }

    const decorated = tctx ? decorateInbox(merged.items, tctx) : merged.items.map((i) => ({ ...i, taskId: null, identifier: null, agent: null }));
    const needsYou = { total: decorated.length, items: decorated.slice(0, 20), notConnected: merged.notConnected };

    const lessons = readLessons(ctx.config, roles);
    let brief;
    if (!tctx) {
      brief = { date: new Date(now).toISOString().slice(0, 10), from: "computed", items: [] };
    } else {
      brief = routineBrief(ctx, tctx, roles, now) || computed(ctx, tctx, roles, lessons, now);
    }

    return {
      company, needsYou, running: tctx ? runningOf(tctx) : [], brief, boardOff,
      generatedAt: new Date(now).toISOString(),
    };
  });
}

function safeRoles(ctx) {
  try { return loadRoles(ctx.config); } catch { return []; }
}

// ---- running: in progress, live first, then newest; at most 10
function runningOf(tctx) {
  const rows = [];
  for (const goal of tctx.goals) {
    const card = taskCard(goal, tctx);
    if (card.column !== "in_progress") continue;
    const ids = [goal.id, ...descendants(tctx.issues, goal.id).map((d) => d.id)];
    const run = ids.map((id) => tctx.liveByIssue.get(id)).find(Boolean) || null;
    rows.push({
      taskId: card.id, identifier: card.identifier, title: card.title, who: card.who, live: Boolean(card.live),
      plainState: card.plainState, since: (card.live && run?.startedAt) || card.updatedAt,
      _t: Date.parse(card.updatedAt) || 0,
    });
  }
  rows.sort((a, b) => (Number(b.live) - Number(a.live)) || (b._t - a._t));
  return rows.slice(0, 10).map(({ _t, ...r }) => r);
}

// ---- the brief written by the daily routine: the newest brief.md that changed within 36 hours
function routineBrief(ctx, tctx, roles, now) {
  const found = [];
  for (const name of listFolders(ctx.config.paths.projectFolder, 1000)) {
    let file = null;
    try { file = readTaskText(ctx.config, name, "brief.md", { maxBytes: 65536 }); } catch { file = null; }
    if (!file || !(now - file.mtimeMs <= 36 * 3600e3)) continue;
    found.push({ file, name });
  }
  found.sort((a, b) => b.file.mtimeMs - a.file.mtimeMs);
  for (const { file } of found) {
    const parsed = parseBrief(file.text);
    if (!parsed.date) continue;
    const at = new Date(file.mtimeMs).toISOString();
    const items = parsed.items.slice(0, MAX_ITEMS).map((it, i) => ({
      id: `b${i + 1}`, title: it.title, text: it.text, who: whoOf(it.by, roles), about: aboutOf(it.about, tctx), at,
    }));
    return { date: parsed.date, from: "routine", items };
  }
  return null;
}

function listFolders(dir, max) {
  const out = [];
  let d;
  try { d = opendirSync(dir); } catch { return out; }
  try {
    let e;
    while (out.length < max && (e = d.readSync())) out.push(e.name);
  } catch { /* a folder that cannot be read gives what was read so far */ }
  try { d.closeSync(); } catch { /* already closed */ }
  return out;
}

// The brief file is written by an agent, so its `by:` line is the agent's claim: it may name a role, but it
// can never make an item the owner's ("by: you" or "by: owner" is shown as an agent's).
const OWNER_WORDS = new Set(["you", "owner", "the-owner", "me", "board"]);
function whoOf(by, roles) {
  const want = by.trim().toLowerCase();
  const role = roles.find((r) => r.slug !== "you" && (r.name.toLowerCase() === want || r.slug === want));
  if (role) return { slug: role.slug, name: role.name };
  const slug = want.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!slug || OWNER_WORDS.has(slug)) return { slug: "agent", name: "An agent" };
  return { slug, name: by };
}

function aboutOf(about, tctx) {
  const a = about.trim();
  if (a.toLowerCase() === "company") return { label: "Company", link: null };
  const dept = DEPARTMENTS.find((d) => d.id === a.toLowerCase());
  if (dept) return { label: dept.title, link: { page: dept.id, id: null } };
  const task = /^[A-Za-z0-9_-]{1,64}$/.test(a) ? findTask(tctx, a) : null;
  if (task) return { label: task.identifier || a, link: { page: "tasks", id: task.id } };
  return { label: a, link: null };
}

// ---- the computed brief
function computed(ctx, tctx, roles, lessons, now) {
  const names = new Map([...tctx.agents].map(([id, a]) => [id, a.name]));
  const accepted = [];
  for (const goal of tctx.goals) {
    const at = ctx.decisions.get(`acknowledged:goal:${goal.id}`);
    if (typeof at !== "string" || !(now - Date.parse(at) <= 24 * 3600e3)) continue;
    accepted.push({ id: goal.id, identifier: goal.identifier, title: goal.title, result: resultOf(tctx, goal, names), at });
  }
  let cards = [];
  try { cards = agentCards(ctx, tctx); } catch { cards = []; }
  const working = cards.length ? cards.filter((c) => c.state === "working").length : tctx.liveByAgent.size;
  const total = cards.length || roles.length;
  const out = computeBrief({ accepted, lessons, working, total, now });
  return { date: out.date, from: "computed", items: out.items };
}

function resultOf(tctx, goal, names) {
  try {
    const comments = tctx.commentsOf(goal.id);
    const list = Array.isArray(comments) ? comments : [];
    const c = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .find((x) => /^\s*RESULT:/.test(x.body || ""));
    return c ? c.body.replace(/^\s*RESULT:\s*/, "").trim() : "";
  } catch { return ""; }
}

// ---- lessons: state/lessons/<slug>.md, lines "- YYYY-MM-DD: text", at most 256 KB each
function readLessons(config, roles) {
  const dir = join(config.paths.state, "lessons");
  const out = [];
  for (const file of listFolders(dir, 100)) {
    const m = /^([a-z0-9-]{1,64})\.md$/.exec(file);
    if (!m) continue;
    const text = readCapped(join(dir, file), 262144, dir);
    if (text === null) continue;
    const role = roles.find((r) => r.slug === m[1]);
    const name = role?.name || m[1];
    for (const line of text.split(/\r?\n/)) {
      const l = /^\s*[-*]\s*(\d{4}-\d{2}-\d{2}):\s*(\S.*)$/.exec(line);
      if (l) out.push({ slug: m[1], name, date: l[1], text: l[2].trim() });
    }
  }
  return out;
}

// Agents write their lessons files: O_NOFOLLOW and O_NONBLOCK, a regular file still at its place, capped.
function readCapped(path, max, dir) {
  const read = readChecked(path, dir, { maxBytes: max });
  return read ? read.bytes.toString("utf8") : null;
}
