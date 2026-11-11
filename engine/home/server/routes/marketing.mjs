// Marketing page (CONTRACTS 9.6) and one draft (9.8). Publishing is switched off and there is no route,
// and no code, that turns it on: approving a draft only changes its status.
// Version 3 (CONTRACTS-V3 36.1, 36.4) adds three sections: `concepts` (the five headlines of each task's
// concepts.md, read through readTaskText, five or none), `carousels` (a link to each set of slides the
// Studio lists) and `recipes` (lib/recipes.mjs: the date, the job, the rounds, the scores and the verdict).
// Each is best effort: when its source cannot be read it is listed empty, and the page still answers.
import { storeOf } from "../content/context.mjs";
import { indiaToday, plainRange } from "../content/plain-date.mjs";
import { isDraftId } from "../content/store.mjs";
import { descendants, goalsOf, isGoal, loadIssues, rootOf } from "../lib/goals.mjs";
import { plainState } from "../lib/goals.mjs";
import { loadCatalogue } from "../lib/jobs.mjs";
import { recipeEntries } from "../lib/recipes.mjs";
import { readTaskText } from "../lib/taskfiles.mjs";

const KIND = { post: "Post", newsletter: "Newsletter" };
const STATUS = { draft: "Waiting for you", approved: "Approved", sent_back: "Sent back" };
const PLAIN_AGENT = { free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval" };

const day = (d) => d.toISOString().slice(0, 10);

// Monday to Sunday of the current week in India time, as YYYY-MM-DD.
function thisWeek(now = new Date()) {
  const base = new Date(`${indiaToday(now)}T00:00:00Z`);
  const back = (base.getUTCDay() + 6) % 7;
  const start = new Date(base.getTime() - back * 86400000);
  return [day(start), day(new Date(start.getTime() + 6 * 86400000))];
}

async function agentAndWork(ctx) {
  const unknown = { agent: { name: "Marketer", state: "free", plainState: "Status not available right now" }, inFlight: [] };
  const ids = ctx.ids();
  const marketerId = ids?.agents?.marketer;
  if (!ids?.companyId || !marketerId) return unknown;
  try {
    const co = encodeURIComponent(ids.companyId);
    const [agents, live, issues] = await Promise.all([
      ctx.board.get(`/api/companies/${co}/agents`),
      ctx.board.get(`/api/companies/${co}/live-runs`).catch(() => []),
      loadIssues(ctx, ids.companyId).catch(() => []),
    ]);
    const a = (Array.isArray(agents) ? agents : []).find((x) => x.id === marketerId);
    if (!a) return unknown;
    const working = (Array.isArray(live) ? live : []).some((r) => r?.agentId === marketerId);
    const state = a.status === "pending_approval" ? "waiting_for_you" : a.status === "error" ? "problem"
      : a.status === "paused" ? "paused" : working || a.status === "running" ? "working" : "free";
    const goals = new Map();
    for (const i of issues) {
      if (i.assigneeAgentId !== marketerId || i.status === "done" || i.status === "cancelled") continue;
      const root = rootOf(issues, i.id);
      if (root && isGoal(root, ids) && !goals.has(root.id)) {
        goals.set(root.id, { goalId: root.id, identifier: root.identifier, title: root.title, plainState: plainState(root.status).plainState });
      }
    }
    return { agent: { name: a.name || "Marketer", state, plainState: PLAIN_AGENT[state] }, inFlight: [...goals.values()] };
  } catch {
    return unknown;
  }
}

// ---- concepts (36.1)
const CONCEPTS_FILE = "concepts.md";
const MAX_CONCEPT_TASKS = 20;
const MAX_HEADLINE = 80;

// The five headlines of a concepts.md: "# Concepts: <subject>" first, then exactly the headings "## 1. " to
// "## 5. ", in order, each headline at most 80 characters. Anything else gives [] (five or none). The
// headlines are an agent's text: shown as plain text only, with control and format characters taken out.
export function conceptHeadlines(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i >= lines.length || !/^# Concepts: \S/.test(lines[i])) return [];
  const out = [];
  for (const line of lines.slice(i + 1)) {
    if (!line.startsWith("#")) continue;
    const m = /^## ([1-9])\. (.+)$/.exec(line);
    if (!m || Number(m[1]) !== out.length + 1) return [];
    const headline = m[2].replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim();
    if (!headline || headline.length > MAX_HEADLINE) return [];
    out.push(headline);
  }
  return out.length === 5 ? out : [];
}

// Tasks started from a job whose file says it produces concepts.md (by the home server's `template:` record),
// newest first, each with its five headlines.
function conceptRows(ctx, goals) {
  let jobs;
  try { jobs = loadCatalogue(ctx.config).jobs; } catch { return []; }
  const rows = [];
  for (const g of goals) {
    if (rows.length >= MAX_CONCEPT_TASKS) break;
    const ref = ctx.decisions?.get(`template:${g.id}`);
    const job = typeof ref === "string" ? jobs.get(ref) : null;
    if (!job || !(Array.isArray(job.produces) && job.produces.includes(CONCEPTS_FILE))) continue;
    if (typeof g.identifier !== "string") continue;
    const read = readTaskText(ctx.config, g.identifier, CONCEPTS_FILE, { maxBytes: 65536 });
    const headlines = read && !read.truncated ? conceptHeadlines(read.text) : [];
    if (!headlines.length) continue;
    rows.push({ taskId: g.id, identifier: g.identifier, title: String(g.title || "").slice(0, 200), headlines });
  }
  return rows;
}

// ---- carousels (36.4): the Studio's own list of slide sets (routes/studio-slides.mjs), as links.
async function carouselRows(ctx, taskIds) {
  try {
    const { scanSlides } = await import("./studio-slides.mjs");
    const { rows } = scanSlides(ctx.config);
    return rows.map(({ row }) => ({
      id: row.id, goal: row.goal, taskId: taskIds.get(row.goal) ?? null, title: row.title || row.name,
      count: row.count, ok: !!row.checks?.ok, changed: row.changed,
      link: { page: "marketing", id: null, slides: row.id },
    }));
  } catch {
    return [];
  }
}

// ---- what was made and how it did (36.4)
async function recipeRows(ctx) {
  try {
    return (await recipeEntries(ctx)).map((e) => ({
      taskId: e.taskId, identifier: e.identifier, date: e.date, job: e.job, rounds: e.rounds,
      scores: e.scores, verdict: e.verdict, note: e.note,
    }));
  } catch {
    return [];
  }
}

async function newSections(ctx) {
  let goals = [];
  try {
    const ids = ctx.ids();
    if (ids?.companyId && ids?.projectId) goals = goalsOf(await loadIssues(ctx, ids.companyId), ids);
  } catch { goals = []; }
  const taskIds = new Map(goals.filter((g) => typeof g.identifier === "string").map((g) => [g.identifier, g.id]));
  const [carousels, recipes] = await Promise.all([carouselRows(ctx, taskIds), recipeRows(ctx)]);
  return [
    {
      id: "concepts", title: "Concepts", emptyText: "No concepts yet. Start the job Five concepts before any design to get some.",
      columns: [{ key: "title", label: "Task" }, { key: "headlines", label: "Headlines" }],
      rows: conceptRows(ctx, goals),
    },
    {
      id: "carousels", title: "Carousels", emptyText: "No carousels yet. Start a carousel from one of the concepts.",
      columns: [{ key: "title", label: "Carousel" }, { key: "count", label: "Slides" }, { key: "changed", label: "Made" }],
      rows: carousels,
    },
    {
      id: "recipes", title: "What was made and how it did", emptyText: "Nothing made and answered yet.",
      columns: [
        { key: "date", label: "Date" }, { key: "job", label: "What was made" }, { key: "rounds", label: "Rounds" },
        { key: "scores", label: "Scores" }, { key: "verdict", label: "Your answer" },
      ],
      rows: recipes,
    },
  ];
}

export default function register(app) {
  app.get("/api/departments/marketing", async (ctx) => {
    const { drafts, problems } = storeOf(ctx).sync();
    const [from, to] = thisWeek();
    const [{ agent, inFlight }, added] = await Promise.all([agentAndWork(ctx), newSections(ctx)]);
    const sections = [{
      id: "calendar", title: "Content calendar", emptyText: "No drafts yet. Give the Marketer a goal to get some.",
      columns: [
        { key: "planned", label: "Planned" }, { key: "title", label: "Title" },
        { key: "kind", label: "Kind" }, { key: "status", label: "Status" },
      ],
      rows: drafts.map((d) => ({
        planned: d.planned, title: d.title, kind: KIND[d.channel], status: STATUS[d.status],
        ...(d.status === "draft" ? { inboxId: `content:${d.id}` } : {}),
      })),
    }, ...added];
    if (problems.length) {
      sections.push({
        id: "problems", title: "Files that could not be used", emptyText: "",
        columns: [{ key: "file", label: "File" }, { key: "problem", label: "What is wrong" }],
        rows: problems,
      });
    }
    return {
      id: "marketing", title: "Marketing", connected: true, notConnected: null, agent,
      figures: [
        { id: "drafts", label: "Drafts waiting", value: String(drafts.filter((d) => d.status === "draft").length), hint: "Waiting for you in the inbox" },
        { id: "approved", label: "Approved", value: String(drafts.filter((d) => d.status === "approved").length), hint: "Approved, not published" },
        { id: "this_week", label: "Planned this week", value: String(drafts.filter((d) => d.planned >= from && d.planned <= to).length), hint: plainRange(from, to) },
      ],
      sections, inFlight,
      switches: [{ id: "publishing", label: "Publish posts and newsletters", on: false, explain: "Connect an account to turn this on." }],
    };
  });

  app.get("/api/content/:id", async (ctx) => {
    const store = storeOf(ctx);
    store.sync();
    const draft = isDraftId(ctx.params.id) ? store.read(ctx.params.id) : null;
    if (!draft) throw ctx.fail(404, "That draft is not there.", "Open the Marketing page and pick one from the list.", "draft_not_found");
    return { draft };
  });
}
