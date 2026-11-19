// The page viewer (PLAN-STRESS T5): 20 site checks one after another (--quick: 3) and 4 asked at once, on a small
// site made here. After each, no process is left whose command line holds the viewer's work folder (its Chrome group
// is gone), and the viewer listens on no port but its own, the preview's and the preview's nine (base+61..69).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { writeTar } from "../../viewer/tar.mjs";
import { agentToken, idsOf, rawCall, rssOf, secretOf, sleep, tally } from "./util.mjs";

const SITE = () => writeTar([
  { name: "index.html", data: "<!doctype html><html><head><title>Stress site</title><style>body{font:16px sans-serif}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}}</style></head><body><h1>Stress site</h1><p>A small page.</p><a href=\"about.html\">About</a></body></html>" },
  { name: "about.html", data: "<!doctype html><title>About</title><p>About.</p>" },
]);

function leftovers(workFolder) {
  let text = "";
  try { text = execFileSync("/bin/ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); } catch { return []; }
  return text.split("\n").filter((l) => l.includes(workFolder)).map((l) => l.trim().slice(0, 160));
}

function listening(pid) {
  let text = "";
  try { text = execFileSync("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch { return []; }
  return [...new Set(text.split("\n").map((l) => /:(\d+) \(LISTEN\)/.exec(l)).filter(Boolean).map((m) => Number(m[1])))];
}

export async function viewerSweep(ctx, stage, env) {
  const ev = {};
  const ids = idsOf(stage);
  env.setDoor("viewer", { on: true });
  const token = agentToken(secretOf(stage, "viewer"), ids.agents.builder);
  const port = stage.ports.viewer;
  const work = join(stage.state, "doors", "work", "view");
  const shot = (timeoutMs = 120_000) => rawCall(port, "POST", "/view/shots", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/x-tar" }, body: SITE(), timeoutMs,
  });
  const allowed = new Set([stage.ports.viewer, stage.ports.preview]);
  for (let o = 61; o <= 69; o += 1) allowed.add(stage.base + o);

  const n = ctx.quick ? 3 : 20;
  const one = [];
  const left = [];
  const strayPorts = new Set();
  for (let i = 0; i < n; i += 1) {
    const r = await shot();
    one.push(r);
    await sleep(500);
    const l = leftovers(work);
    if (l.length) left.push({ i, l });
    for (const p of listening(stage.pids.viewer.pid)) if (!allowed.has(p)) strayPorts.add(p);
  }
  ctx.check(n * 3);
  ev.oneByOne = { calls: n, statuses: tally(one), ms: one.map((r) => r.ms) };
  const failed = one.filter((r) => r.status !== 200);
  if (failed.length) {
    ctx.record({ severity: "high", area: "viewer", check: "render", target: "one-by-one", title: "The page viewer did not answer a small site with its shots", expected: "200 with a tar", actual: JSON.stringify(tally(failed)), suspectFiles: ["engine/viewer/viewer.mjs"] });
  }

  // Four at once: one renders, the rest are told it is busy; none hangs.
  const four = await Promise.all([1, 2, 3, 4].map(() => shot()));
  await sleep(800);
  const l4 = leftovers(work);
  if (l4.length) left.push({ i: "four", l: l4 });
  ev.fourAtOnce = tally(four);
  ctx.check(5);
  const rendered = four.filter((r) => r.status === 200).length;
  const busy = four.filter((r) => r.json && r.json.code === "view_busy").length;
  if (rendered > 1 || rendered + busy !== 4) {
    ctx.record({ severity: rendered > 1 ? "high" : "medium", area: "viewer", check: "four-at-once", target: "view_busy", title: "Four renders asked at once were not one rendered and three told busy", expected: "1 x 200, 3 x view_busy", actual: JSON.stringify(ev.fourAtOnce), suspectFiles: ["engine/viewer/viewer.mjs"] });
  }
  ev.leftovers = left;
  if (left.length) {
    ctx.record({ severity: "high", area: "viewer", check: "chrome-left", target: "chrome", title: "Chrome processes were left after a render", expected: "none with the viewer's work folder", actual: JSON.stringify(left.slice(0, 3)), suspectFiles: ["engine/viewer/chrome.mjs", "engine/viewer/viewer.mjs"] });
  }
  ev.strayPorts = [...strayPorts];
  ctx.check(1);
  if (strayPorts.size) {
    ctx.record({ severity: "medium", area: "viewer", check: "ports", target: "viewer", title: "The viewer listened on a port outside its own, the preview's and the preview's nine", expected: [...allowed].join(","), actual: [...strayPorts].join(","), suspectFiles: ["engine/viewer/viewer.mjs", "engine/viewer/preview.mjs"] });
  }
  ev.rssKb = await rssOf(stage, "viewer");
  return ev;
}
