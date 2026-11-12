// Search source "goals": goals whose title and description together contain every word of the search.
import { snippet } from "../lib/format.mjs";
import { goalsOf, loadIssues, needIds } from "../lib/goals.mjs";
import { loadCatalogue } from "../lib/jobs.mjs";
import { textOf } from "../lib/staged.mjs";

// What a task's result says about it, for the owner (M52 F6): a task started from a job shows the job's own
// summary, not the text the job sends the agent (which names folders); any other task shows the owner's own words.
function taskWords(ctx, g, catalogue) {
  const ref = ctx.decisions?.get?.(`template:${g.id}`);
  const job = typeof ref === "string" ? catalogue?.jobs?.get(ref) : null;
  if (job?.summary) return job.summary;
  return textOf(g.description || "").text || g.title;
}

export default {
  id: "goals",
  label: "Tasks",
  async search(ctx, q) {
    const ids = needIds(ctx);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const issues = await loadIssues(ctx, ids.companyId);
    let catalogue = null;
    try { catalogue = loadCatalogue(ctx.config); } catch { catalogue = null; }
    return goalsOf(issues, ids)
      .filter((g) => {
        const hay = `${g.title || ""}\n${g.description || ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((g) => ({ title: g.title, snippet: snippet(taskWords(ctx, g, catalogue), words), link: { page: "goals", id: g.id } }));
  },
};
