// Marketing page (CONTRACTS 9.6) and one draft (9.8). Publishing is switched off and there is no route,
// and no code, that turns it on: approving a draft only changes its status.
import { storeOf } from "../content/context.mjs";
import { indiaToday, plainRange } from "../content/plain-date.mjs";
import { isDraftId } from "../content/store.mjs";
import { descendants, isGoal, loadIssues, rootOf } from "../lib/goals.mjs";
import { plainState } from "../lib/goals.mjs";

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

export default function register(app) {
  app.get("/api/departments/marketing", async (ctx) => {
    const { drafts, problems } = storeOf(ctx).sync();
    const [from, to] = thisWeek();
    const { agent, inFlight } = await agentAndWork(ctx);
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
    }];
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
