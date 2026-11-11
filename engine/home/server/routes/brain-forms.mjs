// The company brain's forms and starter packs (CONTRACTS-V3 32.3, 32.5, 33.6, the last three rows): open a
// form with the answers its file holds, save the owner's answers into that file at the version the owner
// saw, and copy starter pages into Packs. The form and starter files come from the repo
// (engine/company/brain, read by the company's loaders); with that folder missing a form is not found and
// there are no starters. Every write goes through brain/store.mjs; answers become plain text in brain/forms.mjs.
import { join } from "node:path";
import { loadBrainForms, loadStarters } from "../../../company/lib/brain-files.mjs";
import { FormError, readForm, saveForm } from "../brain/forms.mjs";
import { BrainError, brainFor, brainRun } from "../brain/store.mjs";

const STARTER_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const MAX_STARTERS = 20;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const badRequest = (ctx) => ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");
const brainDir = (ctx, ...parts) => join(ctx.config.engineDir, "company", "brain", ...parts);

function formOf(ctx, id) {
  let forms = [];
  try { forms = loadBrainForms(brainDir(ctx, "forms")).forms; } catch { forms = []; }
  const form = typeof id === "string" ? forms.find((f) => f.id === id) : null;
  if (!form) throw ctx.fail(404, "That form is not here.", "Go back to Files and pick one of the forms there.", "form_not_found");
  return form;
}

// A form's own refusals become the core's plain error; the store's go through brainRun.
function formRun(ctx, fn) {
  return brainRun(ctx, () => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof FormError) throw ctx.fail(e.status, e.message, e.next, e.code);
      throw e;
    }
  });
}

export default function register(app) {
  app.get("/api/brain/forms/:id", (ctx) => {
    const form = formOf(ctx, ctx.params.id);
    return formRun(ctx, () => {
      const read = readForm(brainFor(ctx.config), form);
      return { form, values: read.values, exists: read.exists, version: read.version, unknown: read.unknown.map((u) => u.heading) };
    });
  });

  app.post("/api/brain/forms/:id", (ctx) => {
    const form = formOf(ctx, ctx.params.id);
    const b = obj(ctx.body) ? ctx.body : null;
    if (!b || !obj(b.values)) throw badRequest(ctx);
    if (b.version !== undefined && b.version !== null && typeof b.version !== "string") throw badRequest(ctx);
    return formRun(ctx, () => saveForm(brainFor(ctx.config), form, b.values, b.version));
  });

  app.post("/api/brain/starters", (ctx) => {
    const b = obj(ctx.body) ? ctx.body : null;
    const ids = b && Array.isArray(b.ids) ? b.ids : null;
    if (!ids || ids.length < 1 || ids.length > MAX_STARTERS || !ids.every((x) => typeof x === "string" && STARTER_ID.test(x))) throw badRequest(ctx);
    let starters = [];
    try { starters = loadStarters(brainDir(ctx, "starters")).starters; } catch { starters = []; }
    return brainRun(ctx, () => {
      const store = brainFor(ctx.config);
      const added = [];
      const skipped = [];
      for (const id of [...new Set(ids)]) {
        const s = starters.find((x) => x.folder === "packs" && x.id === id);
        if (!s) { skipped.push({ id, why: "That starter page is not there." }); continue; }
        if (store.find(`packs/${s.file}`)) { skipped.push({ id, why: "It is already in Packs." }); continue; }
        try {
          store.add({ folder: "packs", name: s.file, text: s.text });
          added.push(id);
        } catch (e) {
          if (!(e instanceof BrainError)) throw e;
          skipped.push({ id, why: e.code === "file_exists" ? "It is already in Packs." : e.message });
        }
      }
      return { added, skipped };
    });
  });
}
