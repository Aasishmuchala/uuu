// CONTRACTS 9.3: the merged inbox and one action on one item.
import { createActor, mergeInbox } from "../lib/inbox.mjs";

export default function register(app) {
  let actor = null;

  app.get("/api/inbox", async (ctx) => {
    const { items, counts, notConnected } = await mergeInbox(ctx, ctx.home.inboxSources);
    return { items, counts, notConnected, generatedAt: new Date().toISOString() };
  });

  app.post("/api/inbox/act", async (ctx) => {
    actor ||= createActor(ctx.home.inboxSources);
    const b = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
    return actor(ctx, { id: b.id, action: b.action, note: b.note, version: b.version });
  });
}
