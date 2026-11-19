// The generation door and the money, on fake Runway only (PLAN-STRESS T5). Many jobs at once, from the Artist and two
// apps, against a daily limit worth 10 jobs (--quick: 20 jobs against 4): the ledger (doors/generate-ledger.jsonl) must
// never show more spent than the limit or an app's allowance, no job charged twice, never more than MAX_RUNNING (2) a
// caller or MAX_RUNNING_ALL (4) in all; a 429 is not charged; an answer Runway cut is counted at the door's estimate at
// most (the door's own rule: it may have started a task the door cannot see); and the ledger parses after the door is
// killed in the middle of jobs and started again. Any overspend against the fake is critical.
import { join } from "node:path";
import { MAX_RUNNING, MAX_RUNNING_ALL } from "../../generate/door.mjs";
import { readLedger, summarize, totalsOf } from "../../generate/ledger.mjs";
import { pngBytes } from "../../test/stubs/runway.mjs";
import { agentToken, appToken, idsOf, put, rawCall, rssOf, secretOf, sleep, tally } from "./util.mjs";
import { mkdirSync, chmodSync } from "node:fs";

const JOB_CENTS = 25; // gen4_turbo, 5 seconds, by the door's own table (engine/generate/test/door.test.mjs row 8)
const APPS = ["render-to-film", "arch-film-studio"];
const ENDED = new Set(["done", "failed", "refused"]);

export async function generateSweep(ctx, stage, env) {
  const ev = {};
  const ids = idsOf(stage);
  const secret = secretOf(stage, "generate");
  const port = stage.ports.generate;
  const jobsWorth = ctx.quick ? 4 : 10;
  const limit = JOB_CENTS * jobsWorth;
  const total = ctx.quick ? 20 : 100;
  const ledgerPath = join(stage.state, "doors", "generate-ledger.jsonl");
  const gen = (extra = {}) => env.setDoor("generate", { on: true, dailyCredits: limit, monthlyCredits: 1_000_000, autoUnderCredits: 1_000_000, ...extra });
  gen();
  // The apps' allowances: two jobs' worth each.
  const allowDir = join(stage.state, "doors", "allowances");
  mkdirSync(allowDir, { recursive: true, mode: 0o700 });
  chmodSync(allowDir, 0o700);
  const allowance = {};
  APPS.forEach((app, i) => {
    const now = Date.now();
    allowance[app] = { id: `a${String(i + 1).repeat(20)}`, budgetCents: JOB_CENTS * 2 };
    put(join(allowDir, `${app}.json`), {
      version: 1, id: allowance[app].id, app, approvedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 6 * 3600_000).toISOString(), budgetCents: allowance[app].budgetCents,
    });
  });
  await stage.setBehaviour("runway", { steps: ["SUCCEEDED"] });

  const callers = [
    { name: "artist", token: agentToken(secret, ids.agents.artist), inputs: "/gen/inputs", jobs: "/gen/jobs", job: "/gen/jobs/" },
    ...APPS.map((app) => ({ name: `app-${app}`, app, token: appToken(secret, app), inputs: "/gen/app/inputs", jobs: "/gen/app/jobs", job: "/gen/app/jobs/" })),
  ];
  const post = (c, path, body, type = "application/json") => rawCall(port, "POST", path, { headers: { authorization: `Bearer ${c.token}`, "content-type": type }, body, timeoutMs: 30000 });
  let pic = 0;
  for (const c of callers) {
    const r = await post(c, c.inputs, pngBytes(1280, 720, 4096 + (pic += 1)), "image/png");
    if (r.status !== 201 || !r.json || !r.json.input) throw new Error(`the generation door took no picture from ${c.name} (${r.status} ${r.text.slice(0, 200)})`);
    c.input = r.json.input;
  }
  let prompt = 0;
  const body = (c) => {
    prompt += 1;
    const words = `stress shot ${prompt}, a slow push towards the stair`;
    return c.app
      ? JSON.stringify({ model: "gen4_turbo", kind: "image_to_video", inputs: [{ input: c.input, role: "first" }], prompt: words, seconds: 5, ratio: "1280:720" })
      : JSON.stringify({ batch: null, kind: "image_to_video", input: c.input, promptText: words, seconds: 5, ratio: "1280:720" });
  };
  const accepted = [];
  const answers = [];
  const send = async (c) => {
    const r = await post(c, c.jobs, body(c));
    answers.push(r);
    if (r.status === 202 && r.json && r.json.job) accepted.push({ caller: c, job: r.json.job });
    return r;
  };

  // 1. All at once, then waves while anything is still admitted.
  let sent = 0;
  const first = await Promise.all(Array.from({ length: total }, (_, i) => send(callers[i % callers.length])));
  sent += first.length;
  ev.firstWave = tally(first);
  let quiet = 0;
  for (let wave = 0; wave < 80 && quiet < 3; wave += 1) {
    await sleep(2000);
    const rs = await Promise.all(Array.from({ length: callers.length * 2 }, (_, i) => send(callers[i % callers.length])));
    sent += rs.length;
    const moving = rs.some((r) => r.status === 202 || (r.json && r.json.code === "gen_busy"));
    quiet = moving ? 0 : quiet + 1;
  }
  ctx.check(sent);
  await waitEnded(port, accepted, 180_000);
  ev.sent = sent;
  ev.accepted = accepted.length;
  ev.answers = tally(answers);
  const broken = answers.filter((r) => !r.status || r.status >= 500);
  if (broken.length) {
    ctx.record({ severity: "high", area: "generate", check: "5xx", target: "jobs", title: "The generation door answered 5xx or nothing to a job", expected: "202 or its own 4xx refusal", actual: JSON.stringify(tally(broken)), suspectFiles: ["engine/generate/door.mjs"] });
  }

  // 2. The ledger: the money, the allowances, no double charge, the running limits.
  ev.money = checkLedger(ctx, ledgerPath, { limit, allowance, label: "money" });
  if (ev.money.today < Math.min(limit, JOB_CENTS * 2)) {
    ctx.record({ severity: "medium", area: "generate", check: "money-no-spend", target: "jobs", title: "Almost nothing was made against the daily limit; the money checks proved little", expected: `about ${limit} cents spent`, actual: `${ev.money.today} cents`, suspectFiles: [] });
  }
  const seen = await fakeCreates(stage);
  ev.runwayCreates = seen;

  // 3. A 429 from Runway is not charged.
  gen({ dailyCredits: limit + 200 });
  await stage.setBehaviour("runway", { create: 429, retryAfter: 1 });
  const lim = await send(callers[0]);
  ev.limited = { status: lim.status, code: lim.json && lim.json.code };
  await sleep(1500);
  // 4. An answer Runway cut (not JSON): the door's estimate stays counted, never more.
  await stage.setBehaviour("runway", { create: "garbage" });
  const cut = await send(callers[0]);
  ev.cut = { status: cut.status, code: cut.json && cut.json.code };
  await stage.setBehaviour("runway", { steps: ["SUCCEEDED"] });
  ctx.check(2);
  const after = readLedger(ledgerPath);
  if (after.ok) {
    const { jobs } = summarize(after.lines);
    const ends = after.lines.filter((l) => l.verdict === "not_started_429");
    ev.limited.ledger = ends.map((l) => ({ state: l.state, credits: l.credits }));
    if (ends.some((l) => l.credits !== 0 || l.state !== "released")) {
      ctx.record({ severity: "critical", area: "generate", check: "429-charged", target: "runway 429", title: "A job Runway refused with 429 was charged", expected: "released, 0", actual: JSON.stringify(ev.limited.ledger), suspectFiles: ["engine/generate/door.mjs", "engine/generate/ledger.mjs"] });
    }
    const lastJobs = [...jobs.values()].sort((a, b) => b.at - a.at).slice(0, 1);
    ev.cut.charge = lastJobs.map((j) => ({ charge: j.charge, estimate: j.estimate, end: j.end && j.end.state }));
    if (lastJobs.some((j) => j.charge > j.estimate)) {
      ctx.record({ severity: "critical", area: "generate", check: "cut-overcharged", target: "runway garbage", title: "A job whose answer Runway cut was charged more than its estimate", expected: `at most ${JOB_CENTS}`, actual: JSON.stringify(ev.cut.charge), suspectFiles: ["engine/generate/door.mjs"] });
    }
  }
  if (!(lim.json && lim.json.code === "gen_limited")) {
    ctx.record({ severity: "medium", area: "generate", check: "429-answer", target: "runway 429", title: "Runway's 429 did not come back as gen_limited", expected: "403 gen_limited", actual: JSON.stringify(ev.limited), suspectFiles: ["engine/generate/door.mjs"] });
  }

  // 5. Killed in the middle of jobs, started again: the ledger parses and holds no double charge.
  gen({ dailyCredits: limit + 400 });
  await stage.setBehaviour("runway", { steps: ["RUNNING", "RUNNING", "SUCCEEDED"] });
  const mid = await Promise.all([send(callers[0]), send(callers[1])]);
  ev.kill = { sent: tally(mid) };
  await sleep(300);
  await stage.kill("generate", "SIGKILL");
  const parsedDead = readLedger(ledgerPath).ok;
  await stage.start("generate");
  const parsedAfter = readLedger(ledgerPath).ok;
  ev.kill.parsedWhileDown = parsedDead;
  ev.kill.parsedAfterStart = parsedAfter;
  // The door polls what it had open again (the fake Runway started over, so it knows none of them).
  const end = Date.now() + 60_000;
  let open = null;
  while (Date.now() < end) {
    const r = readLedger(ledgerPath);
    open = r.ok ? totalsOf(r.lines, Date.now()).open.length : null;
    if (open === 0) break;
    await sleep(2000);
  }
  ev.kill.openAfterMinute = open;
  ctx.check(2);
  if (!parsedDead || !parsedAfter) {
    ctx.record({ severity: "critical", area: "generate", check: "ledger-after-kill", target: "generate-ledger.jsonl", title: "The spending ledger did not parse after the door was killed in the middle of jobs", expected: "every line readable", actual: JSON.stringify(ev.kill), suspectFiles: ["engine/generate/ledger.mjs"] });
  }
  ev.afterKill = checkLedger(ctx, ledgerPath, { limit: limit + 400, allowance, label: "after-kill" });
  const health = await rawCall(port, "GET", "/gen/health");
  ev.healthAfter = health.status;
  ev.rssKb = await rssOf(stage, "generate");
  ctx.check(1);
  if (health.status !== 200) {
    ctx.record({ severity: "high", area: "generate", check: "health-after-kill", target: "generate", title: "The generation door was not healthy after it was killed and started again", expected: "200", actual: String(health.status || health.code) });
  }
  return ev;
}

async function waitEnded(port, accepted, ms) {
  const end = Date.now() + ms;
  const left = new Set(accepted);
  while (left.size && Date.now() < end) {
    for (const a of [...left]) {
      const r = await rawCall(port, "GET", `${a.caller.job}${a.job}`, { headers: { authorization: `Bearer ${a.caller.token}` } });
      if (r.json && ENDED.has(r.json.state)) { a.state = r.json.state; a.credits = r.json.credits ?? r.json.cents; left.delete(a); }
    }
    if (left.size) await sleep(1500);
  }
  return left.size;
}

async function fakeCreates(stage) {
  const f = stage.fakes.generate;
  if (!f) return null;
  const { call } = await import("../lib/http.mjs");
  const r = await call(`${f.control}/seen/runway`).catch(() => null);
  const seen = r && r.json && Array.isArray(r.json.seen) ? r.json.seen : [];
  return { creates: seen.filter((s) => s.method === "POST").length, polls: seen.filter((s) => s.method === "GET").length };
}

// The ledger against the limits. Records what breaks them; returns what it found.
function checkLedger(ctx, path, { limit, allowance, label }) {
  const r = readLedger(path);
  ctx.check(1);
  if (!r.ok) {
    ctx.record({ severity: "critical", area: "generate", check: `ledger-unreadable-${label}`, target: "generate-ledger.jsonl", title: "The spending ledger cannot be read after many jobs at once", expected: "every line readable", actual: "readLedger ok: false", suspectFiles: ["engine/generate/ledger.mjs"] });
    return { ok: false };
  }
  const now = Date.now();
  const t = totalsOf(r.lines, now);
  const { jobs } = summarize(r.lines);
  // Charged twice: more than one end line for one job.
  const ends = new Map();
  for (const l of r.lines) if (l.job && (l.state === "spent" || l.state === "released")) ends.set(l.job, (ends.get(l.job) || 0) + 1);
  const twice = [...ends].filter(([, n]) => n > 1).map(([j]) => j);
  // The running limits, from the reservations and the ends.
  const spans = [];
  for (const l of r.lines) {
    if (!l.job) continue;
    const at = Date.parse(l.at);
    let s = spans.find((x) => x.job === l.job);
    if (!s) { s = { job: l.job, who: l.app ? `app-${l.app}` : l.slug, from: at, to: Infinity }; spans.push(s); }
    if (l.state === "spent" || l.state === "released") s.to = Math.min(s.to, at);
  }
  let most = 0;
  const mostBy = {};
  for (const s of spans) {
    const live = spans.filter((x) => x.from <= s.from && x.to > s.from);
    most = Math.max(most, live.length);
    const mine = live.filter((x) => x.who === s.who).length;
    mostBy[s.who] = Math.max(mostBy[s.who] || 0, mine);
  }
  const apps = {};
  for (const [app, a] of Object.entries(allowance)) {
    apps[app] = [...jobs.values()].filter((j) => j.batch === a.id).reduce((s, j) => s + j.charge, 0);
  }
  const out = { today: t.day, limit, jobs: jobs.size, chargedTwice: twice, mostAtOnce: most, mostBy, apps, open: t.open.length };
  ctx.check(4 + Object.keys(apps).length);
  if (t.day > limit) {
    ctx.record({ severity: "critical", area: "generate", check: `overspend-${label}`, target: "dailyCredits", title: `The ledger shows ${t.day} cents spent today against a daily limit of ${limit}`, expected: `at most ${limit}`, actual: String(t.day), suspectFiles: ["engine/generate/door.mjs", "engine/generate/ledger.mjs"] });
  }
  if (twice.length) {
    ctx.record({ severity: "critical", area: "generate", check: `charged-twice-${label}`, target: "ledger", title: "A job was charged twice in the ledger", expected: "one end line a job", actual: twice.slice(0, 5).join(", "), suspectFiles: ["engine/generate/door.mjs", "engine/generate/ledger.mjs"] });
  }
  if (most > MAX_RUNNING_ALL || Object.values(mostBy).some((n) => n > MAX_RUNNING)) {
    ctx.record({ severity: "critical", area: "generate", check: `running-limit-${label}`, target: "MAX_RUNNING", title: "More jobs ran at once than the generation door allows", expected: `at most ${MAX_RUNNING} a caller, ${MAX_RUNNING_ALL} in all`, actual: JSON.stringify({ most, mostBy }), suspectFiles: ["engine/generate/door.mjs"] });
  }
  for (const [app, spent] of Object.entries(apps)) {
    if (spent > allowance[app].budgetCents) {
      ctx.record({ severity: "critical", area: "generate", check: `allowance-${label}`, target: app, title: `The app ${app} spent ${spent} cents against an allowance of ${allowance[app].budgetCents}`, expected: `at most ${allowance[app].budgetCents}`, actual: String(spent), suspectFiles: ["engine/generate/door.mjs"] });
    }
  }
  return out;
}
