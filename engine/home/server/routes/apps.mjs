// PLAN-V5 K17, K22, K23 (the home server's part, T78): App Studio. The list of apps with their state, the owner's
// switch for each, the daily allowance an app may spend inside, the model an app thinks with, and its icon. Every
// change is the owner's same-origin POST (the core refuses any other) and goes through lib/apps.mjs, the only writer
// of the switches file and the allowances. A `:slug` is matched only against the apps' manifests: anything else is
// 404 before a file is named. Off and "Stop spending" are always taken; on and an allowance only when they can work.
import { fileResponse } from "../lib/static.mjs";
import {
  ALLOWANCE_MAX_CENTS, ALLOWANCE_MIN_CENTS, LEDGER_UNREADABLE, NO_PROVIDER, appOf, buildAppsView, capsLeft, copyFirstPick, dollars,
  providersReady, readIcon, saveAppModel, saveSwitch, stopAllowance, switchOnBlocker, writeAllowance,
} from "../lib/apps.mjs";

// The icon is shown as a picture only: no script, nothing loaded, even when opened on its own.
export const ICON_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "x-content-type-options": "nosniff",
});

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const bodyOf = (ctx) => (obj(ctx.body) ? ctx.body : {});

export default function register(app) {
  app.get("/api/apps", (ctx) => buildAppsView(ctx));

  app.post("/api/apps/:slug/switch", async (ctx) => {
    const entry = appOf(ctx.config, ctx.params.slug);
    const on = bodyOf(ctx).on;
    if (typeof on !== "boolean") throw ctx.fail(400, "That is not a choice here.", "Turn the app on or off.", "bad_switch");
    if (on) {
      const blocker = await switchOnBlocker(ctx, entry);
      if (blocker) {
        return {
          status: 409,
          body: { error: { message: `${entry.ok ? entry.app.name : "This app"} cannot be turned on yet.`, next: blocker.sentence, code: "cannot_switch_on", why: blocker.code } },
        };
      }
      // An app that thinks starts on the Art director's model, once; the owner can change it in the bar.
      if (entry.app.engine.includes("relay") && copyFirstPick(ctx.config, entry.slug)) ctx.log(`apps: ${entry.slug} thinks with the Art director's model`);
    }
    saveSwitch(ctx.config, entry.slug, on);
    ctx.log(`apps: ${entry.slug} switched ${on ? "on" : "off"}`);
    return buildAppsView(ctx);
  });

  app.post("/api/apps/:slug/allowance", async (ctx) => {
    const entry = appOf(ctx.config, ctx.params.slug);
    if (!entry.ok || !entry.app.engine.includes("generate")) {
      throw ctx.fail(409, "This app does not make pictures or clips, so it has nothing to spend.", "Nothing was allowed.", "cannot_spend");
    }
    const now = Date.now();
    const caps = capsLeft(ctx.config, now);
    if (!caps.ok) throw ctx.fail(409, LEDGER_UNREADABLE, "Open Health to see what to do.", "ledger_unreadable");
    const ready = providersReady(ctx.config, now);
    if (!ready.runway && !ready.higgsfield) throw ctx.fail(409, "Nothing can be made yet.", NO_PROVIDER, "no_provider");
    const cents = bodyOf(ctx).cents;
    const most = Math.min(caps.left, ALLOWANCE_MAX_CENTS);
    if (!Number.isInteger(cents) || cents < ALLOWANCE_MIN_CENTS || cents > ALLOWANCE_MAX_CENTS || cents > most) {
      throw ctx.fail(400, "That amount cannot be allowed.", `Choose up to ${dollars(most)}, what is left of today's limit.`, "bad_amount");
    }
    const a = writeAllowance(ctx.config, entry.slug, cents, now);
    ctx.log(`apps: ${entry.slug} may spend ${dollars(cents)} until ${a.expiresAt}`);
    return buildAppsView(ctx);
  });

  app.post("/api/apps/:slug/allowance/stop", async (ctx) => {
    const entry = appOf(ctx.config, ctx.params.slug);
    if (stopAllowance(ctx.config, entry.slug)) ctx.log(`apps: ${entry.slug} may no longer spend`);
    return buildAppsView(ctx);
  });

  app.post("/api/apps/:slug/thinks", async (ctx) => {
    const entry = appOf(ctx.config, ctx.params.slug);
    const model = bodyOf(ctx).model;
    if (!entry.ok || !entry.app.engine.includes("relay")) {
      throw ctx.fail(400, "This app does not think with a model.", "Nothing was changed.", "bad_model");
    }
    if (!saveAppModel(ctx.config, entry.slug, model)) {
      throw ctx.fail(400, "That model is not in the list.", "Choose a model from the list.", "bad_model");
    }
    ctx.log(`apps: ${entry.slug} thinks with a model the owner chose`);
    return buildAppsView(ctx);
  });

  app.get("/api/apps/:slug/icon", (ctx) => {
    const entry = appOf(ctx.config, ctx.params.slug);
    const icon = readIcon(ctx.config, entry);
    if (!icon) throw ctx.fail(404, "This app has no picture.", "Open App Studio again.", "no_icon");
    return fileResponse({ bytes: icon.bytes, size: icon.bytes.length, type: icon.type }, { ...ICON_HEADERS });
  });
}
