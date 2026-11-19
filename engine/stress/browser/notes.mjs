// What the browser sweep saw, gathered before it becomes findings (PLAN-STRESS T3). The same fault on one page in
// twelve loads is one finding, not twelve: an observation is keyed by area|check|target, keeps every load it was
// seen in (`cells`) and a few samples, and is written once at the end of a phase through ctx.record, with an
// evidence file OUT/pass-<n>/browser/<id>.json that --only reads to run just that check again.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingId } from "../lib/ledger.mjs";

// A message with its numbers, ids and ports taken out, so the same fault has the same target in every pass.
export function norm(text, n = 90) {
  return String(text || "")
    .replace(/https?:\/\/127\.0\.0\.1:\d+/g, "<home>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

export const cellName = (c) => (c ? `${c.dataset}/${c.theme}/${c.width}` : "");

export function makeNotes(ctx) {
  const obs = new Map();
  const counts = { recorded: 0, skipped: 0 };
  return {
    obs,
    counts,
    // note({ area, check, target, severity, title, expected, actual, cell, phase, page, extra })
    note(o) {
      const key = `${o.area}|${o.check}|${o.target}`;
      let x = obs.get(key);
      if (!x) {
        x = { ...o, cells: [], samples: [], suspectFiles: o.suspectFiles || [] };
        obs.set(key, x);
      }
      if (o.cell && !x.cells.some((c) => cellName(c) === cellName(o.cell))) x.cells.push(o.cell);
      if (o.actual && x.samples.length < 5 && !x.samples.includes(o.actual)) x.samples.push(o.actual);
      if (o.extra) x.extra = { ...(x.extra || {}), ...o.extra };
      // The worst severity seen wins.
      const rank = ["low", "medium", "high", "critical"];
      if (rank.indexOf(o.severity) > rank.indexOf(x.severity)) x.severity = o.severity;
      return x;
    },
    // Writes every observation as a finding (with --only, only the one asked for) and empties the list.
    flush() {
      const dir = join(ctx.passDir, "browser");
      mkdirSync(dir, { recursive: true });
      const written = [];
      for (const x of obs.values()) {
        const id = findingId(x.area, x.check, x.target);
        if (ctx.only && ctx.only !== id) { counts.skipped += 1; continue; }
        const evidence = join(dir, `${id}.json`);
        writeFileSync(evidence, `${JSON.stringify({
          id, phase: x.phase, page: x.page, area: x.area, check: x.check, target: x.target, cells: x.cells, samples: x.samples, extra: x.extra || null,
        }, null, 2)}\n`);
        const where = x.cells.length ? ` Seen in ${x.cells.length} load(s): ${x.cells.slice(0, 6).map(cellName).join(", ")}${x.cells.length > 6 ? ", ..." : ""}.` : "";
        ctx.record({
          id, severity: x.severity, area: x.area, check: x.check, target: x.target, title: x.title,
          expected: x.expected || "", actual: `${x.samples.join(" | ").slice(0, 1500)}${where}`, evidence, suspectFiles: x.suspectFiles,
        });
        counts.recorded += 1;
        written.push(id);
      }
      obs.clear();
      return written;
    },
  };
}
