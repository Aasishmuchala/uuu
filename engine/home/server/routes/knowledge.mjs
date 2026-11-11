// CONTRACTS 9.7: the company knowledge folder (list, add, read, delete, search) and the lessons per role.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { run, storeFor } from "../knowledge/glue.mjs";
import { readChecked } from "../lib/taskfiles.mjs";

const MAX_LESSONS_BYTES = 1024 * 1024;

const roleName = (slug) => {
  const s = slug.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function register(app) {
  app.get("/api/knowledge", (ctx) => ({ docs: run(ctx, () => storeFor(ctx).list()) }));

  app.post("/api/knowledge", (ctx) => {
    const b = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
    return { status: 201, body: { doc: run(ctx, () => storeFor(ctx).add(b.name, b.text)) } };
  });

  app.get("/api/knowledge/search", (ctx) => ({ results: run(ctx, () => storeFor(ctx).search(String(ctx.query.q || ""), 20)) }));

  app.get("/api/knowledge/doc/:id", (ctx) => run(ctx, () => storeFor(ctx).get(ctx.params.id)));

  app.delete("/api/knowledge/doc/:id", (ctx) => run(ctx, () => storeFor(ctx).remove(ctx.params.id)));

  app.get("/api/lessons", (ctx) => {
    const dir = ctx.config.paths.lessons;
    const roles = [];
    let names = [];
    try { names = readdirSync(dir); } catch { names = []; }
    for (const file of names.sort()) {
      const m = /^([a-z0-9][a-z0-9-]{0,60})\.md$/.exec(file);
      if (!m) continue;
      // Agents write these files: O_NOFOLLOW and O_NONBLOCK, a regular file, at most 1 MB (a larger file is left out).
      const read = readChecked(join(dir, file), dir, { maxBytes: MAX_LESSONS_BYTES });
      if (!read || read.truncated) continue;
      const text = read.bytes.toString("utf8");
      const lessons = text.split(/\r?\n/).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()).filter(Boolean);
      roles.push({ slug: m[1], name: roleName(m[1]), lessons });
    }
    return { roles };
  });
}
