// ctx.decisions: small owner decisions kept by the home screen (dismissed items, acknowledged goals).
// Persisted in state/home/decisions.json, written whole through a temp file.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createDecisions(file) {
  let data = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return {
    get: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    set(key, value) {
      data[key] = value;
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, file);
      return value;
    },
  };
}
