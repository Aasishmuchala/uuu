// ctx.decisions: small owner decisions kept by the home screen (dismissed items, acknowledged goals).
// Persisted in state/home/decisions.json, written whole through a temp file.
// The records that say what a task is (`template:`, `asked:`, `from:`, `ask:`; CONTRACTS-V3 31.3, 33.5) are
// written once, when the board has made the task: a second write for the same task is refused and logged, never
// applied, so a replayed start can never change what the owner asked for (M63 item 22).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const WRITE_ONCE = /^(template|asked|from|ask):/;

export function createDecisions(file, { log = () => {} } = {}) {
  let data = {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = {};
  }
  return {
    get: (key) => (Object.hasOwn(data, key) ? data[key] : null),
    // -> the value now kept: the new one, or for a write-once record that is already there, the old one.
    set(key, value) {
      if (WRITE_ONCE.test(key) && Object.hasOwn(data, key)) {
        try { log(`decisions: refused a second write of the record ${String(key).slice(0, 120)}`); } catch { /* never fail the caller */ }
        return data[key];
      }
      data[key] = value;
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmp, file);
      return value;
    },
  };
}
