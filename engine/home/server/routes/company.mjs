// CONTRACTS 9.5: the agents, what each is doing, pause and resume.
import { HomeError } from "../lib/errors.mjs";
import { isGoal, loadIssues, rootOf } from "../lib/goals.mjs";

const PLAIN = { free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval" };

function stateOf(agent, live) {
  if (agent.status === "pending_approval") return "waiting_for_you";
  if (agent.status === "error") return "problem";
  if (agent.status === "paused") return "paused";
  if (live || agent.status === "running") return "working";
  return "free";
}

function toolOf(agent) {
  if (agent.adapterType === "claude_local") return "claude";
  if (agent.adapterType === "codex_local") return "codex";
  return agent.adapterType || null;
}

function mapAgent(agent, { slugs, names, liveByAgent, issues, ids }) {
  const live = liveByAgent.get(agent.id) || null;
  const state = stateOf(agent, live);
  let doingNow = null;
  if (live?.issueId) {
    const issue = issues.find((i) => i.id === live.issueId);
    const root = issue ? rootOf(issues, issue.id) : null;
    doingNow = {
      title: issue?.title || "A task",
      goalId: root && ids && isGoal(root, ids) ? root.id : null,
    };
  }
  return {
    id: agent.id,
    slug: slugs.get(agent.id) || agent.urlKey || null,
    name: agent.name,
    title: agent.title || agent.name,
    tool: toolOf(agent),
    reportsTo: agent.reportsTo ? names.get(agent.reportsTo) || null : null,
    state,
    plainState: PLAIN[state],
    doingNow,
    lastActiveAt: agent.lastHeartbeatAt || null,
    problem: state === "problem" ? "It stopped with an error. Try Resume; if it stops again, look at Health." : null,
  };
}

async function context(ctx, companyId) {
  const ids = ctx.ids();
  const [agents, liveRuns, issues] = await Promise.all([
    ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/agents`),
    ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/live-runs`).catch(() => []),
    loadIssues(ctx, companyId).catch(() => []),
  ]);
  const list = Array.isArray(agents) ? agents : [];
  const slugs = new Map(Object.entries(ids?.agents || {}).map(([slug, id]) => [id, slug]));
  const names = new Map(list.map((a) => [a.id, a.name]));
  const liveByAgent = new Map();
  for (const r of Array.isArray(liveRuns) ? liveRuns : []) if (r?.agentId && !liveByAgent.has(r.agentId)) liveByAgent.set(r.agentId, r);
  return { list, slugs, names, liveByAgent, issues, ids };
}

export default function register(app) {
  app.get("/api/company", async (ctx) => {
    let companyId, company;
    try {
      companyId = await ctx.board.companyId();
      company = await ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}`);
    } catch (e) {
      if (!(e instanceof HomeError)) throw e;
      return {
        connected: false,
        notConnected: { reason: e.message, next: e.next },
        company: { name: ctx.config.paperclip.companyName },
        agents: [],
      };
    }
    const c = await context(ctx, companyId);
    return {
      connected: true,
      company: { name: company?.name || ctx.config.paperclip.companyName },
      agents: c.list.map((a) => mapAgent(a, c)),
    };
  });

  const toggle = (verb) => async (ctx) => {
    const companyId = await ctx.board.companyId();
    const c = await context(ctx, companyId);
    const agent = c.list.find((a) => a.id === ctx.params.id);
    if (!agent) throw ctx.fail(404, "That agent is not in the company.", "Refresh the Company page.", "agent_not_found");
    const updated = await ctx.board.post(`/api/agents/${encodeURIComponent(agent.id)}/${verb}`, {});
    const merged = { ...agent, ...(updated && typeof updated === "object" ? updated : {}) };
    if (verb === "pause") c.liveByAgent.delete(agent.id);
    return { ok: true, agent: mapAgent(merged, c) };
  };
  app.post("/api/company/agents/:id/pause", toggle("pause"));
  app.post("/api/company/agents/:id/resume", toggle("resume"));
}
