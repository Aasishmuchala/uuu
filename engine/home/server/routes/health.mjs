// CONTRACTS 9.2 (/healthz) and 9.9: the parts (with the model relay, CONTRACTS-V4 T8), the fence, what is not connected, disk.
// PLAN-V5 K12: after the model relay, the web door, the generation door and the page viewer, then App Studio (K17,
// T78), then the playbooks.
import { join } from "node:path";
import {
  appsState, boardState, booksState, doorStates, freeDisk, gateState, homeState, notConnected, playbooksState, proofSentence, readProof, relayState,
} from "../lib/health.mjs";

export default function register(app) {
  app.get("/healthz", () => ({ status: "ok", part: "home" }));

  app.get("/api/health", async (ctx) => {
    const env = { config: ctx.config, urls: ctx.home.urls, bench: ctx.bench, port: ctx.home.port };
    const [books, board, gate, relay, doors, apps, disk] = await Promise.all([
      booksState(env), boardState(env), gateState(env), relayState(env), doorStates(env), appsState(env),
      freeDisk(ctx.config.paths.state, ctx.config.minFreeDiskGb),
    ]);
    const lastProof = readProof(ctx.config.paths.proofLast);
    return {
      parts: [books, board, gate, relay, ...doors, apps, playbooksState(env), homeState(env)],
      fence: { lastProof, sentence: proofSentence(lastProof), running: ctx.home.prove.running },
      notConnected: notConnected(join(ctx.config.paths.books, "skipped-apps.txt")),
      disk,
      modulesFailed: ctx.home.modulesFailed,
    };
  });

  app.post("/api/health/prove", (ctx) => {
    ctx.home.prove.start();
    return { status: 202, body: { started: true } };
  });
}
