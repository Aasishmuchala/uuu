// Test helpers for version 2 (CONTRACTS-V2 16.5). Not used by the running server.
// A feature test loads only its own modules, so files other builders are still writing cannot disturb it.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../../lib/config.mjs";
import { startStubBench } from "../../../test/stubs/bench.mjs";
import { startStubBoard } from "../../../test/stubs/board.mjs";
import { createHome, SERVER_DIR } from "./app.mjs";
import { startStubsHome } from "./stubs.mjs";

const ENGINE_DIR = join(SERVER_DIR, "..", "..");

const KINDS = ["routes", "inbox", "search"];

function fileName(name) {
  const n = String(name);
  if (!/^[A-Za-z0-9_.-]+$/.test(n) || n.includes("..")) throw new Error(`modulesOnly: bad module name ${n}`);
  return n.endsWith(".mjs") ? n : `${n}.mjs`;
}

// modulesOnly({ routes: [], inbox: [], search: [] }) -> a temp folder holding links to only the named
// files of engine/home/server/ (plus every routes/_*.mjs helper). Pass it as moduleDirs: [dir].
export function modulesOnly({ routes = [], inbox = [], search = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-home-modules-"));
  const wanted = { routes, inbox, search };
  for (const kind of KINDS) {
    mkdirSync(join(dir, kind));
    const names = new Set(wanted[kind].map(fileName));
    if (kind === "routes") {
      let all = [];
      try { all = readdirSync(join(SERVER_DIR, "routes")); } catch { all = []; }
      for (const f of all) if (f.startsWith("_") && f.endsWith(".mjs")) names.add(f);
    }
    for (const f of names) {
      const src = join(SERVER_DIR, kind, f);
      if (!existsSync(src)) {
        rmSync(dir, { recursive: true, force: true });
        throw new Error(`modulesOnly: ${kind}/${f} does not exist`);
      }
      symlinkSync(src, join(dir, kind, f));
    }
  }
  return dir;
}

// startV2({ routes, inbox, search, ...options }) -> a stub home as startStubsHome makes it (port 0 unless
// given; options as there), loading only the named modules, on the version 2 seed (CONTRACTS-V2 22) when
// the stubs offer one (boardSeedV2 and copyStateSeedV2), else on the plain seed. close() also removes the
// module folder.
export async function startV2({ routes = [], inbox = [], search = [], ...options } = {}) {
  const dir = modulesOnly({ routes, inbox, search });
  let home;
  try {
    const seeds = await import("../../../test/stubs/seed.mjs");
    home = typeof seeds.boardSeedV2 === "function" && typeof seeds.copyStateSeedV2 === "function"
      ? await startOnV2Seed(seeds, { port: 0, ...options, moduleDirs: [dir] })
      : await startStubsHome({ port: 0, ...options, moduleDirs: [dir] });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const close = home.close.bind(home);
  home.modulesDir = dir;
  home.close = async () => {
    try { await close(); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  return home;
}

// startStubsHome's steps, with the version 2 board seed and state files.
// Exported so that `main.mjs --stubs` can serve the version 2 seed to a browser.
export async function startOnV2Seed(seeds, options) {
  const root = mkdtempSync(join(tmpdir(), "uuu-home-stubs-"));
  const state = join(root, "state");
  seeds.copyStateSeedV2(state);
  if (options.benchInstalled !== false) mkdirSync(join(state, "books", "bench"), { recursive: true });
  mkdirSync(join(state, "secrets"), { recursive: true, mode: 0o700 });
  chmodSync(join(state, "secrets"), 0o700);
  writeFileSync(join(state, "secrets", "bench-owner-api.txt"), "owner\nowner\n", { mode: 0o600 });

  let board = null;
  let bench = null;
  let app = null;
  try {
    board = await startStubBoard({ seed: options.boardSeed || seeds.boardSeedV2() });
    bench = await startStubBench({ seed: options.benchSeed || seeds.benchSeed() });
    const raw = JSON.parse(readFileSync(join(ENGINE_DIR, "config.json"), "utf8"));
    raw.stateRoot = state;
    raw.ports.board = board.port;
    raw.ports.benchWeb = bench.port;
    const configFile = join(root, "config.json");
    writeFileSync(configFile, JSON.stringify(raw, null, 2));
    const config = loadConfig({ path: configFile });
    app = await createHome({
      config,
      urls: { gate: null, ...(options.urls || {}) },
      moduleDirs: options.moduleDirs,
      publicDir: options.publicDir,
      proveCommand: options.proveCommand || [process.execPath, "-e", "setTimeout(() => {}, 1500)"],
      log: options.log || (() => {}),
    });
    await app.listen(options.port ?? 0);
    return {
      app, board, bench, state, config, port: app.port, url: app.url,
      async close() {
        await app.close();
        await board.close();
        await bench.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (e) {
    if (app) await app.close().catch(() => {});
    if (board) await board.close().catch(() => {});
    if (bench) await bench.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
    throw e;
  }
}
