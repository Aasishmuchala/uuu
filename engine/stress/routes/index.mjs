// The route sweep (PLAN-STRESS T4): every home route and each part's own routes, on one staged engine (`normal`).
//   table      built at run time from the copy's own loader (table.mjs); fewer than 140 routes fails the harness
//   (a)-(d)    per route: the right call, every other method, malformed bodies, sizes (checks.mjs)
//   (e)-(f)    per route: the same-origin refusals with the state unchanged, hostile `:name` values and the canary
//   load       each GET 200 times at 20 at once; each POST 20 at once with one body; the races (load.mjs)
//   restart    the home stopped and killed while 20 calls a second run (restart.mjs)
//   parts      the gates', relay's, doors', viewer's and App Studio host's routes: methods, sizes, bodies (parts.mjs)
//   static     escapes, every public file's headers, HEAD and ranges (statics.mjs)
//   slow       50 silent and 50 dripping connections (slow.mjs)
//   inbox      Needs you on `large`, timed, after the `normal` stage is closed (inbox-large.mjs)
//   desk       the seats: a desk, a view, a waiting and an unknown seat on base+2.. (desk.mjs)
// --quick: ten routes, (a) to (d) only. --only <id>: the part of the sweep that finding came from, recording only it.
// Writes OUT/pass-<n>/routes.json and routes-summary.json { routes, calls, fiveXX, hangs, p95ByRoute }.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { latest } from "../lib/ledger.mjs";
import { testBodies } from "./bodies.mjs";
import { bodies as badBodies, keyOf, methods, names, origin, rightCall, sizes } from "./checks.mjs";
import { changed, digest, makeClient, makeIssue, sleep } from "./common.mjs";
import { deskPass } from "./desk.mjs";
import { inboxLarge } from "./inbox-large.mjs";
import { RACE_NAMES, getLoad, postBurst, races } from "./load.mjs";
import { partsSweep } from "./parts.mjs";
import { restartWhileBusy } from "./restart.mjs";
import { slowClients } from "./slow.mjs";
import { staticSweep } from "./statics.mjs";
import { MIN_ROUTES, discoverIds, listRoutes } from "./table.mjs";

// --quick's ten: reads and writes of each kind, one with its own body limit, one DELETE.
const QUICK = [
  "GET /api/tasks", "GET /api/tasks/:id", "GET /api/setup", "GET /api/brain/file/:token",
  "POST /api/settings", "POST /api/setup/skip", "POST /api/knowledge", "POST /api/brain/files", "POST /api/team/:slug/lessons",
  "DELETE /api/knowledge/doc/:id",
];
const ORDER = { GET: 0, POST: 1, DELETE: 2 };

// What an --only id names: { check, target, sections }.
function onlyPlan(ctx) {
  if (!ctx.only) return null;
  const f = latest({ out: ctx.out }).find((x) => x.id === ctx.only);
  if (!f) throw new Error(`no finding ${ctx.only} in the ledger`);
  if (f.area !== "routes") throw new Error(`${ctx.only} is a finding of area ${f.area}, not the route sweep's`);
  const t = f.target;
  const plan = { check: f.check, target: t, route: null, pattern: null, sections: new Set() };
  let m;
  if ((m = /^(GET|POST|DELETE) (\/\S*)/.exec(t))) { plan.route = `${m[1]} ${m[2]}`; plan.sections = new Set(["a", "b", "c", "d", "e", "f", "load"]); }
  else if ((m = /^(PUT|PATCH|OPTIONS|HEAD) (\/\S*)/.exec(t))) { plan.pattern = m[2]; plan.sections = new Set(["a", "b"]); }
  else if (t === "home router") plan.sections = new Set(["a", "b"]);
  else if ((m = /^race (.+)$/.exec(t))) { plan.race = RACE_NAMES.includes(m[1]) ? m[1] : null; plan.sections = new Set(["a", "races"]); }
  else if (t.startsWith("restart")) plan.sections = new Set(["a", "restart"]);
  else if ((m = /^part (\S+)/.exec(t))) { plan.part = m[1]; plan.sections = new Set(["parts"]); }
  else if (t.startsWith("static")) plan.sections = new Set(["static"]);
  else if (t === "slow clients") plan.sections = new Set(["slow"]);
  else if (t.startsWith("GET /api/inbox") && / on large$/.test(t) || t === "GET /api/shell on large") plan.sections = new Set(["inbox"]);
  else if (/^(desk|view|seat) /.test(t) || t.startsWith("seat")) plan.sections = new Set(["a", "desk"]);
  else if (t === "outside calls") plan.sections = new Set(["outside"]);
  else plan.sections = new Set(["a", "b", "c", "d"]);
  return plan;
}

export default async function routesSweep(ctx) {
  const started = Date.now();
  const plan = onlyPlan(ctx);
  if (plan) { ctx.onlyCheck = plan.check; ctx.onlyTarget = plan.target; ctx.log(`--only ${ctx.only}: ${plan.check} on ${plan.target}`); }
  const want = (s) => (plan ? plan.sections.has(s) : ctx.quick ? ["a", "b", "c", "d", "outside"].includes(s) : true);

  const st = await ctx.startStage({ dataset: "normal", label: "routes" });
  ctx.log(`stage on base ${st.base} at ${st.root}`);
  const tag = randomBytes(4).toString("hex");
  const canaryName = `canary-${tag}.txt`;
  const canaryPath = join(st.root, canaryName);
  const canary = `STRESS-CANARY-${randomBytes(12).toString("hex")}`;
  writeFileSync(canaryPath, `${canary}\n`, { mode: 0o600 });

  const { hit, stats } = makeClient({ canary });
  const table = listRoutes(st);
  const count = { GET: 0, POST: 0, DELETE: 0 };
  for (const r of table.routes) count[r.method] = (count[r.method] || 0) + 1;
  writeFileSync(join(ctx.passDir, "routes.json"), `${JSON.stringify({ at: new Date().toISOString(), how: table.how, count: table.routes.length, byMethod: count, failed: table.failed, routes: table.routes }, null, 2)}\n`);
  ctx.log(`route table (${table.how}): ${table.routes.length} routes, ${JSON.stringify(count)}${table.failed.length ? `, ${table.failed.length} modules failed` : ""}`);
  if (table.routes.length < MIN_ROUTES) throw new Error(`only ${table.routes.length} routes found (at least ${MIN_ROUTES} expected); the table is wrong`);

  const port = st.ports.home;
  const issue = makeIssue(ctx);
  const ids = await discoverIds(hit, port);
  ctx.log(`ids from the seed: ${Object.entries(ids).map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
  const env = {
    st, hit, stats, port, ids, issue, tag, canary, canaryName, canaryPath, dataset: "normal",
    bodies: testBodies(join(st.engineDir, "home", "server", "test"), table.routes),
    paths: new Map(), valid: new Map(), worked: new Set(), upstream: new Map(), skipped: [], no405: [], notCovered: [], p95ByRoute: {},
    log: ctx.log, check: (n = 1) => ctx.check(n), calls: (n = 1) => { stats.calls += n; },
    onlyRace: plan?.race || null, onlyPart: plan?.part || null,
  };

  // Which routes: all of them, --quick's ten, or the one an --only finding names.
  let routes = [...table.routes].sort((a, b) => ORDER[a.method] - ORDER[b.method] || a.pattern.localeCompare(b.pattern));
  if (plan?.route) routes = routes.filter((r) => keyOf(r) === plan.route);
  else if (plan?.pattern) routes = routes.filter((r) => r.pattern === plan.pattern);
  else if (ctx.quick && !plan) {
    const keys = new Set(QUICK);
    routes = routes.filter((r) => keys.has(keyOf(r)));
    for (const r of table.routes) if (routes.length < 10 && !routes.includes(r)) routes.push(r);
  }
  ctx.log(`${routes.length} routes to sweep${ctx.quick ? " (--quick: (a) to (d))" : ""}`);

  // (a) to (d), route by route.
  for (const r of routes) {
    if (want("a")) await rightCall(env, r);
    if (want("b")) await methods(env, r, table.routes);
    if (want("c")) await badBodies(env, r);
    if (want("d")) await sizes(env, r);
  }
  if (env.no405.length) {
    issue("medium", "b-method-405", "home router", {
      title: `${env.no405.length} calls with a method the route does not take were answered 404, not 405`,
      expected: "405 (with an Allow header) when a route of that address exists", actual: env.no405.slice(0, 20).join(" | "),
      files: ["engine/home/server/lib/router.mjs", "engine/home/server/lib/app.mjs"],
    });
  }

  // (e) and (f).
  if (want("e")) {
    // Files that change on their own (the hold sweep, the parts' own writes) do not count against a refusal.
    const a = digest(st.state);
    await sleep(2000);
    const volatile = new Set(changed(a, digest(st.state)));
    for (const r of routes) await origin(env, r, volatile);
  }
  if (want("f")) for (const r of routes) await names(env, r);

  // Many at once.
  if (want("load")) {
    for (const r of routes.filter((x) => x.method === "GET")) await getLoad(env, r);
    for (const r of routes.filter((x) => x.method !== "GET")) await postBurst(env, r);
  }
  if (want("races") || (want("load") && !plan)) await races(env);
  if (want("restart")) env.restart = await restartWhileBusy(env);
  if (want("parts")) await partsSweep(env);
  if (want("static")) await staticSweep(env);
  if (want("slow")) await slowClients(env);
  if (want("desk")) env.desk = await deskPass(env, plan ? table.routes : routes);

  // Any connect from the stage that the guard refused. The home's provider reads to Omega Plus's fixed origin are a
  // known gap of the stage (README), kept in the summary but not a finding.
  const outside = st.outsideCalls();
  const known = (c) => c.part === "home" && /omegaplusapi\.com$/.test(String(c.host || ""));
  const unknown = outside.filter((c) => !known(c));
  ctx.check();
  if (want("outside") || !plan) {
    if (unknown.length) issue("critical", "outside-call", "outside calls", { title: `${unknown.length} outside calls from the stage during the route sweep`, expected: "0", actual: unknown.slice(0, 5).map((c) => `${c.part} ${c.host}:${c.port}`).join(" | "), files: [] });
  }

  // Needs you on large, in its own stage on the same base once this one is closed.
  let inbox = null;
  if (want("inbox") && !ctx.quick) {
    await st.close();
    inbox = await inboxLarge(ctx, issue);
  }

  const p95ByRoute = {};
  for (const [k, l] of stats.byRoute) {
    const s = [...l].sort((x, y) => x - y);
    p95ByRoute[k] = { n: s.length, p50: s[Math.floor(s.length * 0.5)] ?? null, p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? null, max: s[s.length - 1] ?? null };
  }
  for (const [k, v] of Object.entries(env.p95ByRoute)) p95ByRoute[`load ${k}`] = { ...p95ByRoute[`load ${k}`], ...v };
  const summary = {
    at: new Date().toISOString(), quick: ctx.quick, only: ctx.only || null, seconds: Math.round((Date.now() - started) / 1000),
    routes: table.routes.length, swept: routes.length, calls: stats.calls, fiveXX: stats.fiveXX, hangs: stats.hangs,
    upstream5xx: { accepted: "B6, owner's decision 19 Nov: a 502/503/504 in the home's error shape when what is behind it failed", total: [...env.upstream.values()].reduce((a, b) => a + b, 0), byRoute: Object.fromEntries(env.upstream) },
    desk: env.desk || null, inboxLarge: inbox,
    validBodies: env.worked.size, restart: env.restart || null, skipped: env.skipped, notCovered: env.notCovered,
    outsideCalls: { known: outside.length - unknown.length, other: unknown.length },
    parts: env.partsTable || null, p95ByRoute,
  };
  writeFileSync(join(ctx.passDir, "routes-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  ctx.log(`${routes.length} routes swept, ${stats.calls} calls, ${stats.fiveXX} answers 5xx, ${stats.hangs} hangs, ${env.worked.size} valid bodies taken 2xx, ${summary.seconds} s`);
  if (env.skipped.length) ctx.log(`not called: ${env.skipped.map((s) => `${s.route} (${s.why})`).join("; ")}`);
}
