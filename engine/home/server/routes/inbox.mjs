// CONTRACTS 9.3: the merged inbox and one action on one item. Each listed item also carries `agent` and
// `department` (additive keys; lib/tasks.mjs inboxView), so the Needs you page filters by the same rule the map
// and the dock count by. The task model is read without its inbox and comments; when the board cannot be read
// the items are still listed, placed by their agent's name and their source.
import { createActor, mergeInbox } from "../lib/inbox.mjs";
import { inboxView, loadTaskContext } from "../lib/tasks.mjs";
import { loadRoles } from "../lib/team.mjs";

export default function register(app) {
  let actor = null;

  app.get("/api/inbox", async (ctx) => {
    const [{ items, counts, notConnected }, tctx] = await Promise.all([
      mergeInbox(ctx, ctx.home.inboxSources),
      loadTaskContext(ctx, { withInbox: false, withComments: false }).catch(() => null),
    ]);
    const roles = tctx ? [] : loadRoles(ctx.config, { log: ctx.log });
    return { items: inboxView(items, tctx, roles), counts, notConnected, generatedAt: new Date().toISOString() };
  });

  app.post("/api/inbox/act", async (ctx) => {
    actor ||= createActor(ctx.home.inboxSources);
    const b = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
    return actor(ctx, { id: b.id, action: b.action, note: b.note, version: b.version });
  });
}
