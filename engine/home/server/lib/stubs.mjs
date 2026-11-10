// Stubs mode (`main.mjs --stubs`) and the test harness: the stub board and stub bench in-process,
// a copy of engine/test/stubs/state-seed/ in a new temp folder used as state. Never touches the real
// state, board, gate or bench. Next-wave tests can use startStubsHome({ port: 0 }) the same way.
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../lib/config.mjs";
import { startStubBench } from "../../../test/stubs/bench.mjs";
import { startStubBoard } from "../../../test/stubs/board.mjs";
import { benchSeed, boardSeed } from "../../../test/stubs/seed.mjs";
import { createHome, SERVER_DIR } from "./app.mjs";

const ENGINE_DIR = join(SERVER_DIR, "..", "..");

// options: port (default 3210; 0 = any), boardSeed, benchSeed, moduleDirs, publicDir, proveCommand, log,
// urls (override board/gate/bench addresses), benchInstalled (default true).
export async function startStubsHome(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "uuu-home-stubs-"));
  const state = join(root, "state");
  cpSync(join(ENGINE_DIR, "test", "stubs", "state-seed"), state, { recursive: true });
  const idsFile = join(state, "ids.json");
  writeFileSync(idsFile, readFileSync(idsFile, "utf8").split("{state}").join(state));
  if (options.benchInstalled !== false) mkdirSync(join(state, "books", "bench"), { recursive: true });
  mkdirSync(join(state, "secrets"), { recursive: true, mode: 0o700 });
  chmodSync(join(state, "secrets"), 0o700);
  writeFileSync(join(state, "secrets", "bench-owner-api.txt"), "owner\nowner\n", { mode: 0o600 });

  const board = await startStubBoard({ seed: options.boardSeed || boardSeed() });
  const bench = await startStubBench({ seed: options.benchSeed || benchSeed() });

  const raw = JSON.parse(readFileSync(join(ENGINE_DIR, "config.json"), "utf8"));
  raw.stateRoot = state;
  raw.ports.board = board.port;
  raw.ports.benchWeb = bench.port;
  const configFile = join(root, "config.json");
  writeFileSync(configFile, JSON.stringify(raw, null, 2));
  const config = loadConfig({ path: configFile });

  const app = await createHome({
    config,
    urls: { gate: null, ...(options.urls || {}) },
    moduleDirs: options.moduleDirs,
    publicDir: options.publicDir,
    proveCommand: options.proveCommand || [process.execPath, "-e", "setTimeout(() => {}, 1500)"],
    log: options.log || (() => {}),
  });
  try {
    await app.listen(options.port ?? 3210);
  } catch (e) {
    await board.close(); await bench.close();
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
  return {
    app, board, bench, state, config, port: app.port, url: app.url,
    async close() {
      await app.close();
      await board.close();
      await bench.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
