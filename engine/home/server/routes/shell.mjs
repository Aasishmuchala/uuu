// CONTRACTS-V2 17.9: GET /api/shell, what the sidebar and the top bar show on every page. It stands on
// its own and answers 200 with the board off: the team then comes from the company file alone.
import { join } from "node:path";
import { loadCompanyFile } from "../../../company/lib/company-file.mjs";
import { HomeError } from "../lib/errors.mjs";
import { goalsOf, loadIssues } from "../lib/goals.mjs";
import { boardState, booksState } from "../lib/health.mjs";
import { mergeInbox } from "../lib/inbox.mjs";

const PLAIN = { free: "Free", working: "Working", paused: "Paused", problem: "Has a problem", waiting_for_you: "Waiting for your approval" };
const DEPARTMENTS = [
  ["books", "Books"], ["customers", "Customers"], ["support", "Support"],
  ["people", "People"], ["marketing", "Marketing"], ["studio", "Studio"],
];
const BENCH = new Set(["books", "customers", "support", "people"]);
const CACHE_MS = 1000;
const cache = new WeakMap(); // board client -> { at, data, inbox }, so a second request in a second adds no board calls

function stateOf(agent, live) {
  if (agent.status === "pending_approval") return "waiting_for_you";
  if (agent.status === "error") return "problem";
  if (agent.status === "paused") return "paused";
  if (live || agent.status === "running") return "working";
  return "free";
}

async function readBoard(ctx) {
  const companyId = await ctx.board.companyId();
  const base = `/api/companies/${encodeURIComponent(companyId)}`;
  const [company, agents, live, issues] = await Promise.all([
    ctx.board.get(base).catch(() => null),
    ctx.board.get(`${base}/agents`).catch(() => []),
    ctx.board.get(`${base}/live-runs`).catch(() => []),
    loadIssues(ctx, companyId).catch(() => []),
  ]);
  return { company, agents: Array.isArray(agents) ? agents : [], live: Array.isArray(live) ? live : [], issues };
}

// The board's answers and the merged inbox, kept for one second.
async function snapshot(ctx, boardOn) {
  const hit = cache.get(ctx.board);
  if (hit && hit.boardOn === boardOn && Date.now() - hit.at < CACHE_MS) return hit;
  let data = null;
  if (boardOn) {
    try {
      data = await readBoard(ctx);
    } catch (e) {
      if (!(e instanceof HomeError)) throw e;
    }
  }
  const inbox = await mergeInbox(ctx, ctx.home.inboxSources);
  const fresh = { at: Date.now(), boardOn, data, inbox };
  cache.set(ctx.board, fresh);
  return fresh;
}

function companyAgents(ctx) {
  try {
    return loadCompanyFile(join(ctx.config.engineDir, "company", "company.json"), ctx.config).agents;
  } catch (e) {
    ctx.log(`shell: the company file could not be read: ${String(e?.message || e).split("\n")[0]}`);
    return [];
  }
}

export default function register(app) {
  app.get("/api/shell", async (ctx) => {
    const env = { config: ctx.config, urls: ctx.home.urls, bench: ctx.bench, port: ctx.home.port };
    const [board, books] = await Promise.all([boardState(env), booksState(env)]);
    const engine = {
      board: board.state === "on" ? "on" : "off",
      books: books.state === "not_installed" ? "not_installed" : books.state === "on" ? "on" : "off",
    };
    const { data, inbox } = await snapshot(ctx, engine.board === "on");

    const counts = { needsYou: inbox.counts.total, running: 0, tasksOpen: 0 };
    if (data) {
      const ids = ctx.ids();
      if (ids?.projectId) {
        for (const g of goalsOf(data.issues, ids)) {
          if (g.status === "in_progress" || g.status === "in_review") counts.running += 1;
          if (g.status !== "done" && g.status !== "cancelled" && g.status !== "canceled") counts.tasksOpen += 1;
        }
      }
    }

    const waiting = new Set(inbox.items.map((i) => i.raisedBy));
    const agentIds = ctx.ids()?.agents || {};
    const liveAgents = new Set((data?.live || []).map((r) => r.agentId));
    const team = companyAgents(ctx).map((a) => {
      let state = "free";
      let plainState = "Not known";
      if (data) {
        const id = agentIds[a.slug];
        const rec = data.agents.find((x) => x.id === id || x.urlKey === a.slug);
        state = rec ? stateOf(rec, liveAgents.has(rec.id)) : "free";
        plainState = PLAIN[state];
      }
      return { slug: a.slug, name: a.name, state, plainState, waitingForYou: waiting.has(a.name) };
    });

    return {
      company: { name: data?.company?.name || ctx.config.paperclip.companyName },
      counts,
      team,
      departments: DEPARTMENTS.map(([id, title]) => ({ id, title, connected: BENCH.has(id) ? engine.books === "on" : true })),
      engine,
      generatedAt: new Date().toISOString(),
    };
  });
}
