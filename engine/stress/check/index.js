// `$N --test engine/stress/check/` runs this folder as one file: it loads every *.check.mjs here, one after
// another, so the stages the checks start never overlap.
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  for (const f of readdirSync(__dirname).filter((n) => n.endsWith(".check.mjs")).sort()) {
    await import(pathToFileURL(join(__dirname, f)).href);
  }
})();
