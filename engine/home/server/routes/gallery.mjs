// CONTRACTS-V2 17.7 (V30): GET /api/gallery, the ready-made goals from engine/company/goals/*.json.
import { join } from "node:path";
import { loadGoalFiles } from "../../../company/lib/goal-files.mjs";
import { loadRoles } from "../lib/team.mjs";

const ORDER = ["general", "books", "customers", "support", "people", "marketing", "studio"];

// The words inside [ ], in order, without repeats.
export function blanksOf(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/\[([^\[\]]{1,80})\]/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// loadGallery(ctx) -> { departments, problems }. A missing folder gives an empty list.
export function loadGallery(ctx) {
  const dir = ctx.config.goalsDir || join(ctx.config.engineDir, "company", "goals");
  const roles = loadRoles(ctx.config, { log: ctx.log });
  let loaded;
  try {
    loaded = loadGoalFiles(dir, roles) || {};
  } catch (e) {
    ctx.log(`the ready-made goals could not be read: ${String(e?.message || e).split("\n")[0].slice(0, 300)}`);
    return { departments: [], problems: [] };
  }
  const list = Array.isArray(loaded.departments) ? loaded.departments : [];
  const byId = new Map(list.map((d) => [d.department ?? d.id, d]));
  const departments = [];
  for (const id of ORDER) {
    const d = byId.get(id);
    if (!d || !Array.isArray(d.goals)) continue;
    departments.push({
      id,
      title: d.title,
      goals: d.goals.map((g) => ({
        id: `${id}/${g.id}`,
        title: g.title,
        summary: g.summary,
        text: g.text,
        to: g.to ?? null,
        toName: g.to ? (roles.find((r) => r.slug === g.to)?.name ?? null) : null,
        planFirst: g.planFirst === true,
        size: g.size,
        blanks: blanksOf(g.text),
      })),
    });
  }
  const problems = (Array.isArray(loaded.problems) ? loaded.problems : [])
    .map((p) => ({ file: String(p.file ?? ""), problem: String(p.problem ?? "") }));
  return { departments, problems };
}

export default function register(app) {
  app.get("/api/gallery", async (ctx) => loadGallery(ctx));
}
