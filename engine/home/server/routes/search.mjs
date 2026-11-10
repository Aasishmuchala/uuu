// CONTRACTS 9.10: GET /api/search?q=, every search source at once, results grouped by source.
import { HomeError } from "../lib/errors.mjs";

const PER_SOURCE = 8;

export default function register(app) {
  app.get("/api/search", async (ctx) => {
    const q = String(ctx.query.q || "").trim();
    if (q.length < 2) throw ctx.fail(400, "Type at least two letters to search.", "Add a word or two, then search again.", "query_too_short");
    if (q.length > 200) throw ctx.fail(400, "That search is too long.", "Use a few words.", "query_too_long");
    const groups = [];
    const notSearched = [];
    await Promise.all(ctx.home.searchSources.map(async (src, order) => {
      try {
        const out = await src.search(ctx, q);
        if (out && !Array.isArray(out) && out.notSearched) {
          notSearched.push({ source: src.id, reason: String(out.notSearched) });
          return;
        }
        const results = (Array.isArray(out) ? out : []).slice(0, PER_SOURCE);
        if (results.length) groups.push({ source: src.id, label: src.label, results, order });
      } catch (e) {
        if (!(e instanceof HomeError)) ctx.log(`search source ${src.id} failed: ${String(e?.message || e).split("\n")[0]}`);
        notSearched.push({ source: src.id, reason: e instanceof HomeError ? e.message : "This part could not be searched just now." });
      }
    }));
    groups.sort((a, b) => a.order - b.order);
    return { groups: groups.map(({ order, ...g }) => g), notSearched };
  });
}
