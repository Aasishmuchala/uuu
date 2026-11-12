// CONTRACTS-V3 33.2: GET /api/map (the map: the company brain in the middle, the seven departments around
// it, each with its clusters of jobs) and GET /api/map/:department (one department, zoomed). Read-only.
// What a task is (from a job, a question) comes only from the home server's records and the board's own
// records; nothing is taken from an agent's text. With the board off both answer 200, with zeros.
import { basics, brainFileCount } from "../lib/brainfiles.mjs";
import { departmentLoad, loadDepartments } from "../lib/departments.mjs";
import { HomeError } from "../lib/errors.mjs";
import { jobRef, jobView, loadCatalogue, needsState, readiness, runsIndex } from "../lib/jobs.mjs";
import { askedAt, askedQuestion } from "../lib/owner-text.mjs";
import { agentCards, loadRoles } from "../lib/team.mjs";
import { loadTaskContext, taskCard } from "../lib/tasks.mjs";

const RECENT = 10;
const QUESTION_MAX = 300;
const TITLE_MAX = 120;
const RUNNING = new Set(["in_progress", "in_review"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const stamp = (s) => Date.parse(s) || 0;
const cut = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", "on 12 Nov 2026".
export function whenWords(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const d = new Date(t);
  return `on ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// The task model, or { boardOff } when the board cannot be read (off, or the company not set up).
async function taskModel(ctx) {
  try {
    return { tctx: await loadTaskContext(ctx, { withInbox: true, withComments: "open" }), boardOff: null };
  } catch (e) {
    if (!(e instanceof HomeError)) throw e;
    return { tctx: null, boardOff: { reason: e.message, next: e.next } };
  }
}

async function companyName(ctx, tctx) {
  if (tctx?.ids?.companyId) {
    try {
      const c = await ctx.board.get(`/api/companies/${encodeURIComponent(tctx.ids.companyId)}`);
      if (c && typeof c.name === "string" && c.name.trim()) return cut(c.name, 80);
    } catch { /* the configured name below */ }
  }
  return ctx.config.paperclip.companyName;
}

const whoOf = (slugs, roles) => slugs.map((slug) => ({ slug, name: roles.find((r) => r.slug === slug)?.name || slug }));

// The jobs of one department with what the map shows of each.
function mapJobs(dept, catalogue, needs, runs, config) {
  const list = catalogue.byDepartment.get(dept.id) || [];
  const jobs = list.map((job) => {
    const ref = jobRef(job);
    const { ready, why } = readiness(job, needs, config);
    const r = runs.get(ref);
    return { cluster: job.cluster, view: { id: ref, title: job.title, handoff: job.handoff, stage: job.stage, ready, why, working: r ? r.working : 0, needsYou: r ? r.needsYou : 0 } };
  });
  return {
    clusters: dept.clusters.map((c) => ({ id: c.id, title: c.title, jobs: jobs.filter((j) => j.cluster === c.id).map((j) => j.view) })),
    jobs: jobs.length,
    ready: jobs.filter((j) => j.view.ready).length,
  };
}

// The newest open question (a task with an `ask:` record that is not finished and has not become a task, S8
// T1), and the answers waiting. The question is the one in the record (lib/owner-text.mjs askedQuestion).
function brainOf(ctx, tctx) {
  if (!tctx) return { asking: null, unread: 0 };
  const isAsk = (g) => !!ctx.decisions.get(`ask:${g.id}`);
  const open = tctx.goals.find((g) => isAsk(g) && g.status !== "done" && g.status !== "cancelled" && !tctx.stepsOf(g.id).length) || null;
  let asking = null;
  if (open) {
    const rec = ctx.decisions.get(`ask:${open.id}`);
    const since = askedAt(rec) || open.createdAt || null;
    asking = { id: open.id, question: cut(askedQuestion(rec, open).text, QUESTION_MAX), since };
  }
  const asks = new Set(tctx.goals.filter(isAsk).map((g) => g.id));
  const unread = tctx.needsYou.filter((i) => i.taskId && asks.has(i.taskId)).length;
  return { asking, unread };
}

const emptyRuns = () => new Map();

export default function register(app) {
  app.get("/api/map", async (ctx) => {
    const { departments, problems: depProblems } = loadDepartments(ctx.config);
    const catalogue = loadCatalogue(ctx.config);
    const roles = loadRoles(ctx.config, { log: ctx.log });
    const [{ tctx, boardOff }, needs] = await Promise.all([taskModel(ctx), needsState(ctx)]);
    const runs = tctx ? runsIndex(ctx, tctx) : emptyRuns();
    const filled = basics(ctx.config).filter((b) => b.state === "filled").length;
    const brain = brainOf(ctx, tctx);

    return {
      company: { name: await companyName(ctx, tctx) },
      brain: { files: brainFileCount(ctx.config), basics: { filled, total: 9 }, asking: brain.asking, unread: brain.unread },
      departments: departments.map((d) => {
        const m = mapJobs(d, catalogue, needs, runs, ctx.config);
        const load = departmentLoad(d, tctx);
        return {
          id: d.id, title: d.title, line: d.line, dashboard: d.dashboard, agents: whoOf(d.agents, roles),
          counts: { jobs: m.jobs, ready: m.ready, working: load.working, needsYou: load.needsYou },
          clusters: m.clusters,
        };
      }),
      counts: {
        needsYou: tctx ? tctx.needsYou.length : 0,
        running: tctx ? tctx.goals.filter((g) => RUNNING.has(g.status)).length : 0,
      },
      boardOff,
      problems: [...depProblems, ...catalogue.problems],
      generatedAt: new Date().toISOString(),
    };
  });

  app.get("/api/map/:department", async (ctx) => {
    const { departments } = loadDepartments(ctx.config);
    const at = departments.findIndex((d) => d.id === ctx.params.department);
    if (at < 0) throw ctx.fail(404, "There is no such department.", "Go back to the map.", "department_not_found");
    const dept = departments[at];
    const catalogue = loadCatalogue(ctx.config);
    const roles = loadRoles(ctx.config, { log: ctx.log });
    const [{ tctx }, needs] = await Promise.all([taskModel(ctx), needsState(ctx)]);
    const runs = tctx ? runsIndex(ctx, tctx) : emptyRuns();
    const load = departmentLoad(dept, tctx);
    const jobs = catalogue.byDepartment.get(dept.id) || [];
    const views = jobs.map((job) => jobView(job, { needs, runs, config: ctx.config, roles }));

    const cards = agentCards(ctx, tctx);
    const agents = dept.agents.map((slug) => cards.find((c) => c.slug === slug)).filter(Boolean);

    let recent = [];
    let recentTotal = 0;
    if (tctx) {
      const mine = tctx.goals.map((g) => taskCard(g, tctx)).filter((c) => c.department === dept.id)
        .sort((a, b) => stamp(b.createdAt) - stamp(a.createdAt));
      recentTotal = mine.length;
      recent = mine.slice(0, RECENT);
    }

    return {
      department: {
        id: dept.id, title: dept.title, line: dept.line, dashboard: dept.dashboard,
        counts: { jobs: views.length, ready: views.filter((v) => v.ready).length, working: load.working, needsYou: load.needsYou },
        state: stateOf(dept, agents, tctx),
      },
      agents,
      clusters: dept.clusters.map((c) => ({ id: c.id, title: c.title, jobs: views.filter((v) => v.cluster.id === c.id) })),
      recent, recentTotal,
      neighbours: {
        prev: { id: departments[(at - 1 + departments.length) % departments.length].id, title: departments[(at - 1 + departments.length) % departments.length].title },
        next: { id: departments[(at + 1) % departments.length].id, title: departments[(at + 1) % departments.length].title },
      },
      generatedAt: new Date().toISOString(),
    };
  });
}

// waiting (an agent of the department waits for the owner), else working (one has a live run), else idle.
function stateOf(dept, agents, tctx) {
  const waiting = agents.find((a) => a.waitingForYou || a.state === "waiting_for_you");
  if (waiting && tctx) {
    const item = tctx.needsYou.find((i) => i.agent && dept.agents.includes(i.agent.slug) && i.taskId);
    return { id: "waiting", plain: "Waiting for you", taskId: item ? item.taskId : null };
  }
  const busy = tctx ? agents.find((a) => a.state === "working" && a.doingNow) : null;
  if (busy) {
    // doingNow.taskId is the top task of the run (lib/team.mjs); its title is the task's, not a step's.
    const goal = busy.doingNow.taskId ? tctx.goals.find((g) => g.id === busy.doingNow.taskId) : null;
    const title = cut(goal ? goal.title : busy.doingNow.title, TITLE_MAX);
    return { id: "working", plain: `Working on: ${title}`, taskId: goal ? goal.id : null };
  }
  if (tctx && agents.some((a) => a.state === "working")) return { id: "working", plain: "Working", taskId: null };
  const last = agents.map((a) => a.lastActiveAt).filter((t) => Number.isFinite(Date.parse(t))).sort().pop();
  const words = last ? whenWords(last) : null;
  return { id: "idle", plain: words ? `Idle · last active ${words}` : "Idle", taskId: null };
}
