// The brand kit (PLAN-V5 K5): read it, save it, add and remove a font. Only the owner's same-origin
// requests reach the writes (the core refuses any other); every rule and every write is in brain/kit.mjs.
// A refusal of a rule answers 400 with `field` beside the error (such as "colours.2.hex"), so the page can
// show it at its field. `?proposal=<task id or identifier>` lays an agent's brand-proposal.json beside the
// kit, through the same rules; nothing of it is saved until the owner saves.
import { join } from "node:path";
import { loadBrainForms } from "../../../company/lib/brain-files.mjs";
import { brainFor, brainRun } from "../brain/store.mjs";
import {
  FONT_MAX_BYTES, KitError, addFont, fillerCount, fontsOnThisMac, listFonts, proposalIdentifier, readKit, readPlaybooks,
  readProposal, removeFont, saveKit,
} from "../brain/kit.mjs";

// A 5 MB font as base64 is about 6.7 MB; the body may hold more, so a somewhat larger font gets the plain refusal.
const FONT_MAX_BODY = 9 * 1024 * 1024;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const badRequest = (ctx) => ctx.fail(400, "The home screen sent something it could not read.", "Refresh the page and try again.", "bad_request");

function formsOf(ctx) {
  let forms = [];
  try { forms = loadBrainForms(join(ctx.config.engineDir, "company", "brain", "forms")).forms; } catch { forms = []; }
  return { brandForm: forms.find((f) => f.id === "brand") || null, aboutForm: forms.find((f) => f.id === "about") || null };
}

// A KitError becomes the core's plain error; a rule's refusal also says its field. The store's go through brainRun.
function kitRun(ctx, fn) {
  return brainRun(ctx, () => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof KitError)) throw e;
      if (!e.field) throw ctx.fail(e.status, e.message, e.next, e.code);
      return { status: e.status, body: { error: { message: e.message, next: e.next, code: e.code }, field: e.field } };
    }
  });
}

// Base64 from the browser -> bytes, or null when it is not plain base64.
function decodeBase64(s) {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, "");
  if (!t.length || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return null;
  return Buffer.from(t, "base64");
}

export default function register(app) {
  app.get("/api/brand/kit", async (ctx) => {
    const forms = formsOf(ctx);
    const wanted = typeof ctx.query.proposal === "string" && ctx.query.proposal ? ctx.query.proposal : null;
    const identifier = wanted ? await proposalIdentifier(ctx, wanted.slice(0, 64)) : null;
    return kitRun(ctx, () => {
      const store = brainFor(ctx.config);
      const read = readKit(ctx.config, store, forms);
      return {
        kit: read.kit,
        exists: read.exists,
        version: read.version,
        fromOldForm: read.fromOldForm,
        problem: read.problem,
        fontsOnThisMac: fontsOnThisMac(ctx.config),
        fontsUploaded: listFonts(ctx.config),
        fillerCount: fillerCount(ctx.config),
        playbooks: readPlaybooks(ctx.config),
        proposal: wanted ? readProposal(ctx.config, identifier, read.env) : null,
      };
    });
  });

  app.post("/api/brand/kit", (ctx) => {
    const b = obj(ctx.body) ? ctx.body : null;
    if (!b || !obj(b.kit)) throw badRequest(ctx);
    if (b.version !== undefined && b.version !== null && typeof b.version !== "string") throw badRequest(ctx);
    const { brandForm } = formsOf(ctx);
    return kitRun(ctx, () => {
      const saved = saveKit(ctx.config, brainFor(ctx.config), b.kit, b.version ?? null, { brandForm });
      return { kit: saved.kit, exists: true, version: saved.version };
    });
  });

  app.post("/api/brand/kit/font", (ctx) => {
    const b = obj(ctx.body) ? ctx.body : null;
    if (!b || typeof b.name !== "string" || b.name.length > 200) throw badRequest(ctx);
    if (typeof b.base64 === "string" && b.base64.length > Math.ceil(FONT_MAX_BYTES / 3) * 4 + 1024) {
      throw ctx.fail(413, "That font file is too large.", "A font file can be up to 5 MB.", "font_too_large");
    }
    const bytes = decodeBase64(b.base64);
    if (!bytes) throw badRequest(ctx);
    return kitRun(ctx, () => ({ status: 201, body: { font: addFont(ctx.config, b.name, bytes), fonts: listFonts(ctx.config) } }));
  }, { maxBody: FONT_MAX_BODY });

  app.delete("/api/brand/kit/font/:name", (ctx) => kitRun(ctx, () => {
    removeFont(ctx.config, ctx.params.name);
    return { ok: true, fonts: listFonts(ctx.config) };
  }));
}
