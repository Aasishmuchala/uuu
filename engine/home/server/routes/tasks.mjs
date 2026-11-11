// CONTRACTS-V2 17.2: GET /api/tasks, the Tasks board in six columns. Read-only.
import { loadTaskContext, columnOf, taskCard } from "../lib/tasks.mjs";
import { loadDepartments } from "../lib/departments.mjs";
import { loadRoles } from "../lib/team.mjs";

const COLUMNS = [
  ["backlog", "Backlog"], ["in_progress", "In progress"], ["pending_review", "Pending review"],
  ["done", "Done"], ["failed", "Failed"], ["canceled", "Canceled"],
];
const CAPPED = new Set(["done", "canceled"]);
const CAP = 20;

const stamp = (c) => Date.parse(c.createdAt) || 0;

export default function register(app) {
  app.get("/api/tasks", async (ctx) => {
    const who = typeof ctx.query.who === "string" && ctx.query.who ? ctx.query.who : null;
    if (who) {
      const slugs = new Set(loadRoles(ctx.config).map((r) => r.slug));
      slugs.add("you");
      if (!slugs.has(who)) throw ctx.fail(400, "There is no such agent.", "Pick an agent from the list.", "bad_who");
    }
    const dept = typeof ctx.query.d === "string" && ctx.query.d ? ctx.query.d : null;
    if (dept && !loadDepartments(ctx.config).departments.some((d) => d.id === dept)) {
      throw ctx.fail(400, "There is no such department.", "Pick a department from the list.", "bad_department");
    }
    const tctx = await loadTaskContext(ctx, { withInbox: true, withComments: "open" });
    let cards = tctx.goals.map((g) => taskCard(g, tctx));
    if (who) cards = cards.filter((c) => c.who && c.who.slug === who);
    if (dept) cards = cards.filter((c) => c.department === dept);
    cards.sort((a, b) => stamp(b) - stamp(a) || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    const columns = COLUMNS.map(([id, label]) => {
      const all = cards.filter((c) => c.column === id);
      return { id, label, count: all.length, tasks: CAPPED.has(id) ? all.slice(0, CAP) : all };
    });
    return { columns, total: cards.length, generatedAt: new Date().toISOString() };
  });
}
