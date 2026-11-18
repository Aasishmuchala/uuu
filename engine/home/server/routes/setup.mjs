// PLAN-ONBOARD: the guided first-run setup. GET /api/setup is read-only (lib/setup.mjs). The two POSTs change only
// how the setup is shown, kept in ctx.decisions: a step skipped for now, and the setup hidden. Nothing here saves a
// key, flips a switch, starts a task or runs a command.
import { buildSetup, DISMISSED_KEY, SKIPPABLE, SKIPPED_KEY, skippedRecord } from "../lib/setup.mjs";

const bodyOf = (ctx) => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {});

export default function register(app) {
  app.get("/api/setup", (ctx) => buildSetup(ctx));

  app.post("/api/setup/skip", async (ctx) => {
    const { step, skip } = bodyOf(ctx);
    if (typeof step !== "string" || !SKIPPABLE.includes(step) || typeof skip !== "boolean") {
      throw ctx.fail(400, "That step cannot be skipped.", "Do the step, or hide the setup instead.", "bad_step");
    }
    ctx.decisions.set(SKIPPED_KEY, { ...skippedRecord(ctx), [step]: skip });
    return buildSetup(ctx);
  });

  app.post("/api/setup/dismiss", async (ctx) => {
    const { dismissed } = bodyOf(ctx);
    if (typeof dismissed !== "boolean") {
      throw ctx.fail(400, "That is not a choice here.", "Hide the setup or show it again.", "bad_choice");
    }
    ctx.decisions.set(DISMISSED_KEY, dismissed ? new Date().toISOString() : null);
    return buildSetup(ctx);
  });
}
