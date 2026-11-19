// Sweep `doors` (PLAN-STRESS T5): the gate, the narrow gate, the relay, the web door, the generation door, the page
// viewer, the App Studio host, the brain door and the remote door's off state, staged and under load, on the fakes only (fake provider, fake
// internet, fake Runway, Runway MCP and Higgsfield). Each section reads its part's own tests' callers and limits.
// One stage (base from --base, normal data, the second App Studio host with its test fixture); every section runs
// even when an earlier one broke, and a section that broke makes the sweep a harness failure (exit 2) at the end.
// --quick: 20 calls a part. --only <id>: the section of that finding's area.
import { appsSweep } from "./apps.mjs";
import { brainSweep } from "./brain.mjs";
import { callersSweep } from "./callers.mjs";
import { gateSweep } from "./gate.mjs";
import { generateSweep } from "./generate.mjs";
import { relaySweep } from "./relay.mjs";
import { remoteSweep } from "./remote.mjs";
import { viewerSweep } from "./viewer.mjs";
import { webSweep } from "./web.mjs";
import { addAgents, areaOfId, setDoors, writeEvidence } from "./util.mjs";

const SECTIONS = [
  ["callers", "doors", callersSweep],
  ["gate", "gate", gateSweep],
  ["relay", "relay", relaySweep],
  ["web", "web", webSweep],
  ["brain", "brain", brainSweep],
  ["viewer", "viewer", viewerSweep],
  ["apps", "apps", appsSweep],
  ["remote", "remote", remoteSweep],
  // Last: it kills and starts the generation door.
  ["generate", "generate", generateSweep],
];

export default async function doors(ctx) {
  const only = ctx.only ? areaOfId(ctx.only) : null;
  const todo = SECTIONS.filter(([, area]) => !only || area === only);
  if (!todo.length) {
    ctx.log(`--only ${ctx.only}: not a finding of this sweep`);
    return;
  }
  const stage = await ctx.startStage({ dataset: "normal", apps: true, appsSpawn: "fixture" });
  ctx.log(`stage ${stage.root}`);
  // The agents the doors' lists name that the seed lacks.
  addAgents(stage, ["researcher", "art-director"]);
  const blocks = {};
  const env = {
    setDoor(name, block) {
      blocks[name] = block;
      setDoors(stage, blocks);
    },
  };
  const evidence = { stage: stage.root, quick: ctx.quick, sections: {} };
  const broke = [];
  for (const [name, , fn] of todo) {
    const t0 = Date.now();
    ctx.log(`${name}: start`);
    try {
      evidence.sections[name] = { ...(await fn(ctx, stage, env)), seconds: Math.round((Date.now() - t0) / 1000) };
      ctx.log(`${name}: done in ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (e) {
      broke.push(`${name}: ${e && e.message}`);
      evidence.sections[name] = { broke: String(e && e.stack ? e.stack : e).slice(0, 2000) };
      ctx.log(`${name}: the section broke: ${e && e.stack ? e.stack : e}`);
    }
    writeEvidence(ctx, "doors", "doors.json", evidence);
  }
  // Outside calls: none at all (the home's known Omega Plus reads aside, README).
  const calls = stage.outsideCalls();
  const known = (c) => c.part === "home" && /omegaplusapi\.com$/.test(String(c.host));
  const other = calls.filter((c) => !known(c));
  evidence.outsideCalls = { total: calls.length, knownHome: calls.length - other.length, other: other.slice(0, 20) };
  ctx.check(1);
  if (other.length) {
    ctx.record({
      severity: "critical", area: "doors", check: "outside-call", target: [...new Set(other.map((c) => `${c.part}:${c.host}`))].join(","),
      title: "A staged part tried to reach past this Mac during the doors sweep", expected: "no outside call", actual: JSON.stringify(other.slice(0, 5)),
    });
  }
  const file = writeEvidence(ctx, "doors", "doors.json", evidence);
  ctx.log(`evidence ${file}`);
  if (broke.length) throw new Error(`sections broke: ${broke.join("; ")}`);
}
