// The brain door's rate under load (PLAN-STRESS T5): one agent stops at PER_HOUR (120) calls, at 50 at once. The
// staged door is its real entry, which has no clock to move, so PER_DAY (600) is counted only, not reached.
import { PER_DAY, PER_HOUR } from "../../brain/door.mjs";
import { agentToken, idsOf, notCovered, pool, rawCall, secretOf, tally } from "./util.mjs";

export async function brainSweep(ctx, stage, env) {
  const ev = {};
  const ids = idsOf(stage);
  env.setDoor("brain", { on: true });
  const token = agentToken(secretOf(stage, "brain"), ids.agents.builder);
  const n = PER_HOUR + 10;
  const rs = await pool(n, 50, () => rawCall(stage.ports.brain, "POST", "/brain/ask", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ q: "timber prices" }),
  }));
  const over = rs.filter((r) => r.json && r.json.code === "brain_too_many").length;
  const hung = rs.filter((r) => r.hang || !r.status).length;
  ev.hour = { calls: n, overLimit: over, admitted: n - over, statuses: tally(rs) };
  ctx.check(n);
  if (n - over > PER_HOUR) {
    ctx.record({ severity: "critical", area: "brain", check: "per-hour", target: "PER_HOUR", title: `The brain door let ${n - over} calls of one agent through in an hour`, expected: `at most ${PER_HOUR}`, actual: JSON.stringify(ev.hour.statuses), suspectFiles: ["engine/brain/door.mjs"] });
  } else if (n - over < PER_HOUR) {
    ctx.record({ severity: "medium", area: "brain", check: "per-hour-early", target: "PER_HOUR", title: `The brain door stopped one agent at ${n - over} calls, before its hourly limit`, expected: String(PER_HOUR), actual: JSON.stringify(ev.hour.statuses), suspectFiles: ["engine/brain/door.mjs"] });
  }
  if (hung) {
    ctx.record({ severity: "high", area: "brain", check: "hang", target: "ask", title: "The brain door left calls without an answer under load", expected: "an answer", actual: `${hung} of ${n}` });
  }
  notCovered(ctx, `doors: the brain door's PER_DAY (${PER_DAY}) is not reached in the stage (its real entry has no clock to move); its own tests cover it`);
  return ev;
}
