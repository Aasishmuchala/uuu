// The App Studio host (PLAN-STRESS T5), on the stage's second host (stage option apps: true). First: can an app's own
// program start inside its fence in the stage? The copy's apps/app-exec is asked to run a real app; the app ports are
// a fixed range in code (3171-3189), so on a staged port it is expected to refuse before anything starts. If it
// refuses, no app program is started unfenced: the host is tested with its own test fixture (engine/apps/test/
// fixture-app, our own test code, through the stage's appsSpawn "fixture"), and the line
// `apps: real apps not started in the stage (fence needs the fixed port range)` goes to OUT/pass-<n>/not-covered.txt.
// Then: on and off 30 times (--quick: 3), the app's group killed until the host says `failed` and started again,
// 200 page calls at 20 at once, an engine route not in the manifest's `engine` list refused, a body over
// HOST_LIMITS.bodyBytes refused.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_LIMITS } from "../../apps/host.mjs";
import { notCovered, pool, put, rawCall, readJson, rssOf, sleep, tally } from "./util.mjs";

const NOT_STARTED = "apps: real apps not started in the stage (fence needs the fixed port range)";
const DATABASES = /postgres|mysqld|mariadbd|redis-server/;

// Runs the copy's app-exec for one real app, in its own process group, for at most 30 s. The group is ended only
// when its first process's command line holds the stage root.
function tryFenced(stage, slug) {
  return new Promise((resolve) => {
    const child = spawn(join(stage.engineDir, "apps", "app-exec"), [slug, "--run"], {
      cwd: stage.engineDir, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(stage.root, "home"), LANG: "en_US.UTF-8" },
    });
    const out = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => out.push(c));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      let cmd = "";
      try { cmd = execFileSync("/bin/ps", ["-o", "command=", "-p", String(child.pid)], { encoding: "utf8" }); } catch { cmd = ""; }
      if (cmd.includes(stage.root) && !DATABASES.test(cmd)) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } }
    }, 30000);
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      resolve({ code, signal: sig, timedOut, said: Buffer.concat(out).toString("utf8").trim().split("\n").slice(-3).join(" | ").slice(0, 400) });
    });
  });
}

const health = async (stage) => {
  const r = await rawCall(stage.ports.apps, "GET", "/apps/health", { timeoutMs: 5000 });
  return r.json && Array.isArray(r.json.apps) ? r.json.apps : [];
};
const stateOf = async (stage, slug) => ((await health(stage)).find((a) => a.slug === slug) || {}).state;
async function waitState(stage, slug, want, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await stateOf(stage, slug)) === want) return Date.now() - t0;
    await sleep(200);
  }
  return null;
}
function switches(stage, on) {
  put(join(stage.state, "apps", "state.json"), { version: 1, apps: Object.fromEntries(Object.entries(on).map(([k, v]) => [k, { on: v }])), changedAt: new Date().toISOString() });
}

// The app's pid from the host's status file, and the check that it is ours: its command line holds the stage root and
// its parent is the stage's apps runner.
function appPid(stage, slug) {
  const st = readJson(join(stage.state, "apps", "host-status.json"), { apps: [] });
  const a = (st.apps || []).find((x) => x.slug === slug);
  if (!a || !a.pid) return null;
  let line = "";
  try { line = execFileSync("/bin/ps", ["-o", "ppid=,command=", "-p", String(a.pid)], { encoding: "utf8" }).trim(); } catch { return null; }
  const m = /^(\d+)\s+(.*)$/.exec(line);
  const host = stage.pids.apps && stage.pids.apps.pid;
  if (!m || Number(m[1]) !== host || !m[2].includes(stage.root) || DATABASES.test(m[2])) return null;
  return a.pid;
}

export async function appsSweep(ctx, stage) {
  const ev = {};
  // 1. Can a real app start fenced on a staged port?
  ev.fenced = await tryFenced(stage, "render-to-film");
  ctx.check(1);
  const started = ev.fenced.code === 0 || ev.fenced.timedOut;
  ev.realAppsStarted = started;
  ctx.log(`apps: the copy's app-exec on a staged port: exit ${ev.fenced.code}${ev.fenced.timedOut ? " (kept running, ended)" : ""}: ${ev.fenced.said}`);
  if (!started) notCovered(ctx, NOT_STARTED);

  // 2. The host with its test fixture as app `fix`.
  const fixFile = join(stage.root, "root", "apps", "fix", "app.json");
  const manifest = JSON.parse(readFileSync(fixFile, "utf8"));
  // Only the generation door in its engine list, so the relay's route must be refused.
  manifest.engine = ["generate"];
  writeFileSync(fixFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const port = manifest.port;
  const own = { host: `127.0.0.1:${port}`, "sec-fetch-site": "same-origin" };
  const flips = ctx.quick ? 3 : 30;
  ev.flips = [];
  for (let i = 0; i < flips; i += 1) {
    switches(stage, { fix: true });
    const on = await waitState(stage, "fix", "on", 15000);
    switches(stage, { fix: false });
    const off = await waitState(stage, "fix", "off", 15000);
    ev.flips.push([on, off]);
  }
  ctx.check(flips * 2);
  const slow = ev.flips.filter(([a, b]) => a === null || b === null);
  if (slow.length) {
    ctx.record({ severity: "high", area: "apps", check: "on-off", target: "fix", title: "An app did not come on or go off within 15 s of the owner's switch", expected: "on and off within a few seconds each time", actual: JSON.stringify(ev.flips.slice(0, 10)), suspectFiles: ["engine/apps/host.mjs"] });
  }

  switches(stage, { fix: true });
  if ((await waitState(stage, "fix", "on", 15000)) === null) throw new Error(`the fixture app did not come on in the stage (${await stateOf(stage, "fix")})`);

  // 3. Page calls at 20 at once.
  const n = ctx.quick ? 20 : 200;
  const pages = await pool(n, 20, (i) => rawCall(port, "GET", `/echo?n=${i}`, { headers: own, timeoutMs: 15000 }));
  ev.pages = tally(pages);
  ctx.check(n);
  if (pages.some((r) => r.status !== 200)) {
    ctx.record({ severity: "high", area: "apps", check: "pages", target: "fix", title: "Page calls to an app at 20 at once failed", expected: "200", actual: JSON.stringify(ev.pages), suspectFiles: ["engine/apps/host.mjs"] });
  }

  // 4. The engine socket: a route not in the manifest's list, and one that is not the engine's at all.
  const x = (req) => rawCall(port, "POST", "/x", { headers: { ...own, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" }, body: JSON.stringify(req) });
  const relay = await x({ method: "POST", path: "/v1/messages", body: { model: "x", max_tokens: 5, messages: [{ role: "user", content: "x" }] } });
  const other = await x({ method: "GET", path: "/api/tasks" });
  const listed = await x({ method: "GET", path: "/gen/app/models" });
  const inner = (r) => (r.json ? r.json.status : null);
  ev.engine = { relayNotListed: inner(relay), notEngine: inner(other), listed: inner(listed) };
  ctx.check(3);
  for (const [what, r] of [["the relay, not in its list", relay], ["an address that is not the engine's", other]]) {
    if (!(inner(r) === 404 || inner(r) === 403)) {
      ctx.record({ severity: "critical", area: "apps", check: "engine-route", target: what, title: `An app reached ${what} through its engine socket`, expected: "404 app_not_found or 403", actual: `${inner(r)} ${r.text.slice(0, 200)}`, suspectFiles: ["engine/apps/host.mjs"] });
    }
  }

  // 5. A body over the host's limit, declared.
  const big = await rawCall(port, "POST", "/echo", { headers: { ...own, origin: `http://127.0.0.1:${port}`, "content-type": "application/octet-stream" }, declare: HOST_LIMITS.bodyBytes + 1 });
  ev.tooBig = big.status || big.code;
  ctx.check(1);
  if (big.status !== 413) {
    ctx.record({ severity: "medium", area: "apps", check: "too-big", target: "fix", title: "A body over App Studio's limit was not refused with 413", expected: "413", actual: String(ev.tooBig), suspectFiles: ["engine/apps/host.mjs"] });
  }

  // 6. The app's group killed until the host says failed; then started again by the owner's switch.
  ev.kills = [];
  let failed = null;
  for (let k = 0; k < 4 && failed === null; k += 1) {
    const pid = appPid(stage, "fix");
    if (!pid) { ev.kills.push({ k, pid: null }); break; }
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
    const t0 = Date.now();
    let st = null;
    while (Date.now() - t0 < 20000) {
      st = await stateOf(stage, "fix");
      if (st === "failed") { failed = Date.now() - t0; break; }
      const again = appPid(stage, "fix");
      if (st === "on" && again && again !== pid) break;
      await sleep(250);
    }
    ev.kills.push({ k, pid, state: st });
  }
  ctx.check(1);
  ev.failedAfter = failed;
  if (failed === null) {
    ctx.record({ severity: "high", area: "apps", check: "failed-state", target: "fix", title: `App Studio did not report an app failed after its group was killed ${HOST_LIMITS.exitsToFail} times`, expected: "failed", actual: JSON.stringify(ev.kills), suspectFiles: ["engine/apps/host.mjs"] });
  }
  switches(stage, { fix: false });
  await waitState(stage, "fix", "off", 15000);
  switches(stage, { fix: true });
  const back = await waitState(stage, "fix", "on", 20000);
  ev.backOn = back;
  ctx.check(1);
  if (back === null) {
    ctx.record({ severity: "high", area: "apps", check: "restart-after-failed", target: "fix", title: "An app that failed did not come back when the owner switched it off and on", expected: "on", actual: String(await stateOf(stage, "fix")), suspectFiles: ["engine/apps/host.mjs"] });
  }
  switches(stage, { fix: false });
  await waitState(stage, "fix", "off", 15000);
  ev.rssKb = await rssOf(stage, "apps");
  return ev;
}
