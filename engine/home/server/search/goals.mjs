// Search source "goals": goals whose title and description together contain every word of the search.
import { snippet } from "../lib/format.mjs";
import { goalsOf, loadIssues, needIds } from "../lib/goals.mjs";

export default {
  id: "goals",
  label: "Tasks",
  async search(ctx, q) {
    const ids = needIds(ctx);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const issues = await loadIssues(ctx, ids.companyId);
    return goalsOf(issues, ids)
      .filter((g) => {
        const hay = `${g.title || ""}\n${g.description || ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((g) => ({ title: g.title, snippet: snippet(g.description || g.title, words), link: { page: "goals", id: g.id } }));
  },
};
