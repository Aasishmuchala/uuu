// The home screen's server: node engine/home/server/main.mjs [--port N] [--stubs]
// Listens on 127.0.0.1 only. The `engine` command points stdout at state/logs/home.log.
import { loadConfig } from "../../lib/config.mjs";
import { createHome } from "./lib/app.mjs";
import { startStubsHome } from "./lib/stubs.mjs";

function usage(msg) {
  process.stderr.write(`${msg}\nUsage: node engine/home/server/main.mjs [--port N] [--stubs]\n`);
  process.exit(64);
}

const args = process.argv.slice(2);
let port = null;
let stubs = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--stubs") stubs = true;
  else if (args[i] === "--port") {
    const n = Number(args[++i]);
    if (!Number.isInteger(n) || n < 0 || n > 65535) usage("--port needs a number from 0 to 65535.");
    port = n;
  } else usage(`Unknown option: ${args[i]}`);
}

const log = (line) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);

let running;
try {
  if (stubs) {
    // The version 2 seed (ten roles, staged tasks, routines, sprites) when the stubs have it.
    const seeds = await import("../../test/stubs/seed.mjs");
    const v2 = await import("./lib/testing-v2.mjs");
    running = typeof seeds.boardSeedV2 === "function" && typeof v2.startOnV2Seed === "function"
      ? await v2.startOnV2Seed(seeds, { port: port ?? 3210, log })
      : await startStubsHome({ port: port ?? 3210, log });
    log(`home screen (stubs mode, temp state ${running.state}) on ${running.url}`);
  } else {
    const config = loadConfig();
    const app = await createHome({ config, log });
    await app.listen(port ?? config.ports.home);
    running = app;
    log(`home screen on ${app.url}`);
  }
  const failed = (running.app || running).home.modulesFailed;
  for (const f of failed) log(`module skipped: ${f.file}`);
} catch (e) {
  const inUse = e && e.code === "EADDRINUSE";
  process.stderr.write(inUse
    ? "The home screen could not start: its port is already in use. Run: engine status\n"
    : `The home screen could not start: ${String(e?.message || e).split("\n")[0]}\n`);
  process.exit(1);
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`stopping (${signal})`);
  await running.close();
  process.exit(0);
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
