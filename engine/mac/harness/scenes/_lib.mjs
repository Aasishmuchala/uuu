// What the Mac harness's own scenes share (the cook harness's scenes/_lib.mjs, kept here so these scenes do not reach
// into another checkout's folder): the engine they import from, never the live one, and a free port from 3300 up.
import net from "node:net";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const LIVE_ENGINE = "/Users/aasish/uuu/engine";

// The engine folder to read (COOK_ENGINE, which run-webkit.mjs sets to this worktree's engine), refused when it is the
// live checkout's.
export function engineDir(engine = process.env.COOK_ENGINE) {
  if (!engine) throw new Error("COOK_ENGINE is not set");
  let real;
  try { real = realpathSync(engine); } catch { throw new Error(`no engine at ${engine}`); }
  if (real === LIVE_ENGINE || real.startsWith(`${LIVE_ENGINE}/`)) throw new Error(`refused: ${engine} is the live engine`);
  return real;
}

// imp(engine)("home/server/lib/doors.mjs") -> the module, from that engine only.
export const imp = (engine) => (path) => import(`file://${join(engine, path)}`);

// The engine's own ports and the ones the plan keeps clear (PLAN-MAC-2 rule 3): never bound or called here.
export const kept = (p) => (p >= 3100 && p <= 3299) || [5000, 5432, 7000, 8120].includes(p);

// The first port from `from` to `to` that nothing listens on (127.0.0.1) and that is not kept, or null.
export async function freePort(from = 3300, to = 65535) {
  for (let p = Math.max(from, 3300); p <= to; p++) {
    if (kept(p)) continue;
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once("error", () => r(false));
      s.listen(p, "127.0.0.1", () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  return null;
}
