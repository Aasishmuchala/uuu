// CONTRACTS 9.2 (/healthz) and 9.9: the parts, the fence, what is not connected, disk.
import { join } from "node:path";
import { boardState, booksState, freeDisk, gateState, homeState, notConnected, proofSentence, readProof } from "../lib/health.mjs";

export default function register(app) {
  app.get("/healthz", () => ({ status: "ok", part: "home" }));

  app.get("/api/health", async (ctx) => {
    const env = { config: ctx.config, urls: ctx.home.urls, bench: ctx.bench, port: ctx.home.port };
    const [books, board, gate, disk] = await Promise.all([
      booksState(env), boardState(env), gateState(env),
      freeDisk(ctx.config.paths.state, ctx.config.minFreeDiskGb),
    ]);
    const lastProof = readProof(ctx.config.paths.proofLast);
    return {
      parts: [books, board, gate, homeState(env)],
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
