// CONTRACTS-V4 C8: the Models section of Settings. The provider key comes in here from the owner's
// typing and goes out nowhere: no answer, no error and no log line holds it. Nothing is sent to the
// board and nothing is restarted: the next run of every agent reads the state file.
import {
  buildView, keySaved, readAgents, readCatalogue, readState, recompute, removeKey, runTest, saveKey, updateState, validKey,
} from "../lib/models.mjs";

const bodyOf = (ctx) => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {});

export default function register(app) {
  app.get("/api/models", (ctx) => buildView(ctx));

  app.post("/api/models/key", async (ctx) => {
    const key = validKey(bodyOf(ctx).key);
    if (key === null) {
      throw ctx.fail(400, "That does not look like a provider key.", "Copy the whole key from your Omega Plus account and paste it again.", "bad_key");
    }
    saveKey(ctx.config, key);
    updateState(ctx.config, (s) => {
      const at = new Date().toISOString();
      s.key = { savedAt: at, state: "unknown", checkedAt: null };
      s.lastTest = null;
    });
    ctx.log("models: a provider key was saved");
    return buildView(ctx);
  });

  app.post("/api/models/key/remove", async (ctx) => {
    // Plans mode first, so no agent run ever finds the provider on without a key.
    if (readState(ctx.config).state.mode === "provider") updateState(ctx.config, (s) => { s.mode = "plans"; });
    removeKey(ctx.config);
    updateState(ctx.config, (s) => {
      s.key = { savedAt: null, state: "none", checkedAt: null };
      s.lastTest = null;
    });
    ctx.log("models: the provider key was removed");
    return buildView(ctx);
  });

  app.post("/api/models/refresh", async (ctx) => {
    let models;
    try {
      models = await readCatalogue(ctx.home.urls);
    } catch {
      throw ctx.fail(502, "Omega Plus is not answering. Nothing was changed.", "Try again in a minute.", "provider_unreachable");
    }
    const { agents } = readAgents(ctx.config);
    updateState(ctx.config, (s) => {
      s.catalogue = { readAt: new Date().toISOString(), models };
      recompute(ctx.config, s, agents);
    });
    ctx.log(`models: the list of models was read (${models.length})`);
    return buildView(ctx);
  });

  app.post("/api/models/pick", async (ctx) => {
    const b = bodyOf(ctx);
    const { agents } = readAgents(ctx.config);
    const { state } = readState(ctx.config);
    const agentOk = typeof b.agent === "string" && agents.some((a) => a.slug === b.agent);
    const modelOk = b.model === null || (typeof b.model === "string" && state.catalogue.models.some((m) => m.id === b.model));
    if (!agentOk || !modelOk || !Object.hasOwn(b, "model")) {
      throw ctx.fail(400, "That model cannot be picked for that agent.", "Choose a model from the list.", "bad_pick");
    }
    updateState(ctx.config, (s) => {
      if (b.model === null) delete s.overrides[b.agent];
      else s.overrides[b.agent] = b.model;
      recompute(ctx.config, s, agents);
    });
    ctx.log(`models: the pick for ${b.agent} was ${b.model === null ? "reset" : "changed"}`);
    return buildView(ctx);
  });

  app.post("/api/models/test", async (ctx) => {
    const noKey = () => ctx.fail(409, "No key yet. Paste the one from your Omega Plus account.", "Save a key, then test it.", "no_key");
    if (!keySaved(ctx.config)) throw noKey();
    const lastTest = await runTest(ctx);
    if (lastTest === null) throw noKey();
    updateState(ctx.config, (s) => {
      s.lastTest = lastTest;
      s.key = { savedAt: s.key.savedAt, state: lastTest.key, checkedAt: lastTest.at };
    });
    ctx.log(`models: the key was tested (${lastTest.key})`);
    return buildView(ctx);
  });

  app.post("/api/models/mode", async (ctx) => {
    const mode = bodyOf(ctx).mode;
    if (mode !== "provider" && mode !== "plans") {
      throw ctx.fail(400, "That is not a choice here.", "Switch Omega Plus on or off.", "bad_mode");
    }
    if (mode === "provider") {
      const view = await buildView(ctx);
      if (!view.canSwitchOn) {
        return {
          status: 409,
          body: { error: { message: "Omega Plus cannot be switched on yet.", next: "Do what the Models section asks first.", code: "cannot_switch_on", blockers: view.blockers } },
        };
      }
    }
    updateState(ctx.config, (s) => { s.mode = mode; });
    ctx.log(`models: switched to ${mode} mode`);
    return buildView(ctx);
  });
}
