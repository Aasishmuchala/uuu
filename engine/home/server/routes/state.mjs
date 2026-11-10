// CONTRACTS 9.2: GET /api/state, the counts and on/off words the shell shows on every page.
import { HomeError } from "../lib/errors.mjs";
import { boardState, booksState } from "../lib/health.mjs";
import { goalsOf, isFinished, loadIssues } from "../lib/goals.mjs";
import { mergeInbox } from "../lib/inbox.mjs";

export default function register(app) {
  app.get("/api/state", async (ctx) => {
    const env = { config: ctx.config, urls: ctx.home.urls, bench: ctx.bench, port: ctx.home.port };
    const [board, books, inbox] = await Promise.all([boardState(env), booksState(env), mergeInbox(ctx, ctx.home.inboxSources)]);
    const boardOn = board.state === "on";
    let name = ctx.config.paperclip.companyName;
    let goalsActive = 0;
    let agentsWorking = 0;
    if (boardOn) {
      try {
        const companyId = await ctx.board.companyId();
        const [company, live, issues] = await Promise.all([
          ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}`),
          ctx.board.get(`/api/companies/${encodeURIComponent(companyId)}/live-runs`),
          loadIssues(ctx, companyId),
        ]);
        if (company?.name) name = company.name;
        agentsWorking = new Set((Array.isArray(live) ? live : []).map((r) => r.agentId).filter(Boolean)).size;
        const ids = ctx.ids();
        if (ids?.projectId) goalsActive = goalsOf(issues, ids).filter((g) => !isFinished(g)).length;
      } catch (e) {
        if (!(e instanceof HomeError)) throw e;
      }
    }
    return {
      company: { name },
      counts: { inbox: inbox.counts.total, goalsActive, agentsWorking },
      engine: {
        board: boardOn ? "on" : "off",
        books: books.state === "not_installed" ? "not_installed" : books.state === "on" ? "on" : "off",
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
