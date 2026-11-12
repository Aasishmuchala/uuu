// PLAN-V5 K9: GET /api/tasks/:id/pieces, a task's pieces as the owner judges them. Read-only.
// { kind, round, variants: [{ id, direction: { id, title } | null, preview, brand: { result, lines },
//   review: { scores, total, of, meets, reason } | null }], single, missing, problem }
// What each part rests on:
//   - kind: the job's craft entry (engine/company/brand/craft.json) through the task's `template:` record,
//     the home server's own; never the agent's word;
//   - the versions and their previews: lib/variants.mjs (variants.json read with caps and checked against
//     the kind and the repo's directions; places made by convention, never a path from the file);
//   - brand: the home server's own fenced run of the brand check (lib/brandcheck.mjs), never a report from
//     the task folder; while it runs, or when it cannot, "unknown";
//   - review: the Art director's newest usable review (lib/artreview.mjs; by the board's author id), with
//     `meets` worked out from its numbers, and only when the review is newer than every file of the pieces
//     (so a piece changed after it was scored is not shown as scored).
// A single piece (no variants.json) of a craft job is one entry with the id "piece".
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { loadCraft } from "../../../company/lib/craft-files.mjs";
import { reviewsOf, reviewView } from "../lib/artreview.mjs";
import { brandOfAll, brandOfVariant, runBrandCheck, stampOf } from "../lib/brandcheck.mjs";
import { loadCatalogue } from "../lib/jobs.mjs";
import { findTask, loadTaskContext, treeComments } from "../lib/tasks.mjs";
import { PLACES, previewOf, readVariants } from "../lib/variants.mjs";

// craft.json, read again only when its time or size changes (or the catalogue does).
let craftCache = { key: null, value: null };
function craftOf(ctx) {
  const file = typeof ctx.home?.craftFile === "string" ? ctx.home.craftFile : join(ctx.config.engineDir, "company", "brand", "craft.json");
  let catalogue;
  try { catalogue = loadCatalogue(ctx.config); } catch { return new Map(); }
  let st = null;
  try { st = lstatSync(file); } catch { st = null; }
  const key = `${file}|${st ? `${st.size}|${st.mtimeMs}` : "-"}`;
  if (craftCache.value && craftCache.key === key && craftCache.catalogue === catalogue) return craftCache.value;
  let jobs;
  try { jobs = loadCraft(file, [...catalogue.jobs.keys()]).jobs; } catch { jobs = new Map(); }
  craftCache = { key, catalogue, value: jobs };
  return jobs;
}

// The kind of piece the task's job makes, from the home server's own record; null for any other task.
export function kindOfTask(ctx, goal) {
  const ref = ctx.decisions && typeof ctx.decisions.get === "function" ? ctx.decisions.get(`template:${goal.id}`) : null;
  if (typeof ref !== "string") return null;
  const craft = craftOf(ctx).get(ref);
  return craft && PLACES[craft.kind] ? craft.kind : null;
}

// The newest usable review that is newer than every file of the pieces, or null.
function reviewFor(comments, artDirectorId, round, newestFile) {
  const usable = reviewsOf(comments, artDirectorId)
    .filter((r) => r.outcome && r.seen > 0 && r.pieces.length)
    .filter((r) => { const t = Date.parse(r.at || ""); return Number.isFinite(t) && t > newestFile; })
    .filter((r) => round === null || r.round === round);
  return usable.length ? usable[usable.length - 1] : null;
}

// piecesFor(ctx, goal, comments, { artDirectorId }) -> the K9 answer for one task. Never throws on what an
// agent wrote. Shared with whatever shows the pick (Needs you, the task's page).
export async function piecesFor(ctx, goal, comments, { artDirectorId = null } = {}) {
  const identifier = typeof goal.identifier === "string" ? goal.identifier : null;
  const kind = kindOfTask(ctx, goal);
  const out = { kind, round: null, variants: [], single: true, missing: [], problem: null };
  if (!identifier) return out;
  const v = readVariants(ctx.config, identifier, kind);
  if (v.present && v.problem) return { ...out, single: false, problem: v.problem };
  if (!v.present && !kind) return out;
  const { newest } = stampOf(ctx.config, identifier);
  const run = await runBrandCheck(ctx, identifier);

  if (!v.present) {
    const review = reviewFor(comments, artDirectorId, null, newest);
    const piece = review ? review.pieces.find((p) => p.id === "piece") : null;
    return {
      ...out,
      round: review ? review.round : null,
      variants: [{ id: "piece", direction: null, preview: [], brand: brandOfAll(run), review: reviewView(piece) }],
    };
  }

  const review = reviewFor(comments, artDirectorId, v.round, newest);
  return {
    ...out,
    round: v.round,
    single: false,
    missing: v.missing,
    variants: v.variants.map((x) => ({
      id: x.id,
      direction: x.direction,
      preview: previewOf(ctx.config, identifier, kind, x),
      brand: brandOfVariant(run, x),
      review: reviewView(review ? review.pieces.find((p) => p.id === x.id) : null),
    })),
  };
}

export default function register(app) {
  app.get("/api/tasks/:id/pieces", async (ctx) => {
    const tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
    const goal = findTask(tctx, ctx.params.id);
    if (!goal) throw ctx.fail(404, "There is no such task.", "Go back to Tasks and pick one from the list.", "task_not_found");
    const comments = await treeComments(tctx, goal);
    const artDirectorId = tctx.ids?.agents?.["art-director"] || null;
    return piecesFor(ctx, goal, comments, { artDirectorId });
  });
}
