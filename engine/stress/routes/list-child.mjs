// The home's route table as the home itself builds it (PLAN-STRESS T4): run inside the stage's copy, under the guard,
//   $N --import <copy>/stress/lib/netguard.mjs <copy>/stress/routes/list-child.mjs <copy>/home/server
// It loads every routes/*.mjs through the home's own loader against a recording router (no server, no handler run)
// and prints one JSON line: { routes: [{ method, pattern, maxBody, file }], failed: [{ file, error }] }.
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const serverDir = process.argv[2];
if (!serverDir) {
  console.error("usage: list-child.mjs <home/server folder>");
  process.exit(64);
}
const { loadModules } = await import(pathToFileURL(join(serverDir, "lib", "loader.mjs")).href);
const routes = [];
const router = {
  add(method, pattern, handler, owner, options) {
    routes.push({ method, pattern, maxBody: options && Number.isInteger(options.maxBody) ? options.maxBody : null, file: `routes/${basename(String(owner))}` });
  },
  removeOwner(owner) {
    for (let i = routes.length - 1; i >= 0; i -= 1) if (routes[i].file === `routes/${basename(String(owner))}`) routes.splice(i, 1);
  },
};
const loaded = await loadModules({ dirs: [serverDir], router, log: () => {} });
process.stdout.write(`${JSON.stringify({ routes, failed: loaded.failed.filter((f) => f.file.startsWith("routes/")) })}\n`);
process.exit(0);
