// Wrong callers at every door, at load (PLAN-STRESS T5): no token, a token made with another part's secret, an agent
// that is not on the door's list in the staged config, and an app's name (`app-<name>`) on an agents' route. Each door
// gets 500 such calls at 50 at once (--quick: 20); every one must be the door's own refusal, never a 2xx.
import { agentToken, appToken, idsOf, pool, rawCall, secretOf, tally } from "./util.mjs";
import { writeTar } from "../../viewer/tar.mjs";

export async function callersSweep(ctx, stage, env) {
  const ids = idsOf(stage);
  for (const d of ["web", "generate", "viewer", "brain"]) env.setDoor(d, { on: true });
  const relaySecret = secretOf(stage, "relay");
  const tar = writeTar([{ name: "index.html", data: "<!doctype html><title>x</title>" }]);
  const doors = [
    { door: "web", port: stage.ports.web, path: "/web/fetch", type: "application/json", body: JSON.stringify({ url: "https://site.test/" }), code: "web_no_token", listed: "researcher", notListed: "builder" },
    { door: "generate", port: stage.ports.generate, path: "/gen/jobs", type: "application/json", body: JSON.stringify({ batch: null, kind: "still_variation", inputs: ["x"], promptText: "x", ratio: "1280:720" }), code: "gen_no_token", listed: "artist", notListed: "builder" },
    { door: "generate-app", port: stage.ports.generate, path: "/gen/app/jobs", type: "application/json", body: JSON.stringify({ model: "gen4_turbo" }), code: "gen_no_token", listed: "artist", notListed: "builder", agentOnAppRoute: true },
    { door: "viewer", port: stage.ports.viewer, path: "/view/shots", type: "application/x-tar", body: tar, code: "view_no_token", listed: "builder", notListed: "checker" },
    { door: "brain", port: stage.ports.brain, path: "/brain/ask", type: "application/json", body: JSON.stringify({ q: "x" }), code: "brain_no_token", listed: "builder", notListed: "researcher" },
  ];
  const ev = {};
  const n = ctx.quick ? 20 : 500;
  for (const d of doors) {
    const own = secretOf(stage, d.door.startsWith("generate") ? "generate" : d.door);
    const kinds = [
      ["no token", null],
      ["another part's secret", agentToken(relaySecret, ids.agents[d.listed])],
      ["an agent not on the list", agentToken(own, ids.agents[d.notListed])],
      [d.agentOnAppRoute ? "an agent on an app's route" : "an app's name", d.agentOnAppRoute ? agentToken(own, ids.agents[d.listed]) : appToken(own, "render-to-film")],
    ];
    const rs = await pool(n, 50, async (i) => {
      const [kind, token] = kinds[i % kinds.length];
      const headers = { "content-type": d.type };
      if (token) headers.authorization = `Bearer ${token}`;
      const r = await rawCall(d.port, "POST", d.path, { headers, body: d.body, timeoutMs: 20000 });
      return { kind, r };
    });
    ctx.check(n);
    const byKind = {};
    for (const { kind, r } of rs) (byKind[kind] = byKind[kind] || []).push(r);
    ev[d.door] = Object.fromEntries(Object.entries(byKind).map(([k, list]) => [k, tally(list)]));
    for (const [kind, list] of Object.entries(byKind)) {
      const passed = list.filter((r) => r.status >= 200 && r.status < 300);
      const broken = list.filter((r) => !r.status || r.status >= 500);
      const other = list.filter((r) => !(r.status === 401 && r.json && r.json.code === d.code));
      if (passed.length) {
        ctx.record({ severity: "critical", area: "doors", check: "wrong-caller-passed", target: `${d.door} ${kind}`, title: `The ${d.door} door let in ${kind}`, expected: `401 ${d.code}`, actual: `${passed.length} of ${list.length} answered ${passed[0].status}`, suspectFiles: ["engine/doors/common.mjs"] });
      } else if (broken.length) {
        ctx.record({ severity: "high", area: "doors", check: "wrong-caller-5xx", target: `${d.door} ${kind}`, title: `The ${d.door} door answered ${kind} with 5xx or nothing under load`, expected: `401 ${d.code}`, actual: JSON.stringify(tally(broken)) });
      } else if (other.length) {
        ctx.record({ severity: "medium", area: "doors", check: "wrong-caller-code", target: `${d.door} ${kind}`, title: `The ${d.door} door refused ${kind} with another answer than its own`, expected: `401 ${d.code}`, actual: JSON.stringify(tally(other)), suspectFiles: ["engine/doors/common.mjs"] });
      }
    }
  }
  return ev;
}
