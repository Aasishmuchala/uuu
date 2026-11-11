// Search source "team": agents whose name or summary contains every word of the search.
import { snippet } from "../lib/format.mjs";
import { loadRoles } from "../lib/team.mjs";

export default {
  id: "team",
  label: "Team",
  async search(ctx, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const roles = loadRoles(ctx.config, { log: ctx.log });
    if (!roles.length) return { notSearched: "The team list could not be read just now." };
    return roles
      .filter((r) => {
        const hay = `${r.name || ""}\n${r.summary || ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 8)
      .map((r) => ({ title: r.name, snippet: snippet(r.summary || r.title || r.name, words), link: { page: "team", id: r.slug } }));
  },
};
