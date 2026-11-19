// The gate and the narrow gate under load (PLAN-STRESS T5). The gate must refuse every request of its own vectors
// (engine/gate/test/vectors.mjs) at load exactly as it does one at a time, and never refuse what a heartbeat needs.
// The narrow gate's memory (MAX_TOKENS 50 tokens, MAX_ISSUES_PER_TOKEN 100 issues a token) is not seen from outside;
// what is seen is that with more tokens and issues than it keeps, at 50 at once, an agent still reads only its own
// task, every time, and the process does not grow without end.
import { HOSTILE, MUST_PASS, NOT_NEEDED, PROOF, GOOD_BODIES, ALLOWED } from "../../gate/test/vectors.mjs";
import { MAX_ISSUES_PER_TOKEN, MAX_TOKENS } from "../../gate/narrow.mjs";
import { call } from "../lib/http.mjs";
import { idsOf, pool, rawCall, rssOf, tally } from "./util.mjs";

const TOKEN = { authorization: "Bearer stress-not-a-board-key" };

function refusedVectors() {
  const out = [];
  for (const [m, p, rule] of PROOF) out.push({ m, p, rule });
  for (const [m, list] of NOT_NEEDED) for (const p of list) out.push({ m, p, rule: "not-allowed" });
  for (const [m, p] of HOSTILE) out.push({ m, p, rule: "not-allowed" });
  return out;
}

function passVectors() {
  const bodyOf = new Map(ALLOWED.map(([m, p], i) => [`${m} ${p}`, GOOD_BODIES[i]]));
  return MUST_PASS.map(([m, p]) => ({ m, p, body: bodyOf.get(`${m} ${p}`) || null }));
}

const send = (port, v) => {
  const headers = { ...TOKEN };
  let body;
  if (v.body) {
    if (v.body[0]) headers["content-type"] = v.body[0];
    body = v.body[1];
  } else if (!["GET", "HEAD", "OPTIONS", "DELETE"].includes(v.m)) {
    headers["content-type"] = "application/json";
    body = "{}";
  }
  return rawCall(port, v.m, v.p, { headers, body, timeoutMs: 15000 });
};

const isRefusal = (r, rule) => r.status === 403 && r.json && r.json.code === "gate_refused" && (!rule || r.json.rule === rule);

export async function gateSweep(ctx, stage) {
  const ev = { gate: {}, narrow: {} };
  const port = stage.ports.gate;
  const refuse = refusedVectors();
  const passes = passVectors();

  // 1. One at a time: each vector's answer, as the base the load is held to.
  const alone = [];
  for (const v of refuse) alone.push(await send(port, v));
  const aloneRefused = alone.map((r, i) => isRefusal(r, refuse[i].rule));
  ctx.check(refuse.length);
  ev.gate.alone = { vectors: refuse.length, refused: aloneRefused.filter(Boolean).length };
  refuse.forEach((v, i) => {
    if (!aloneRefused[i]) {
      ctx.record({
        severity: "critical", area: "gate", check: "vector-alone", target: `${v.m} ${v.p}`,
        title: `The gate let through a request its own vectors refuse: ${v.m} ${v.p}`, expected: `403 gate_refused ${v.rule}`,
        actual: `${alone[i].status} ${alone[i].json ? JSON.stringify(alone[i].json).slice(0, 200) : alone[i].code || ""}`, suspectFiles: ["engine/gate/rules.mjs"],
      });
    }
  });

  // 2. At load: every refused vector and every needed request, mixed, 50 at once (quick: each once, 20 at once).
  const all = [...refuse.map((v) => ({ ...v, want: "refused" })), ...passes.map((v) => ({ ...v, want: "passed" }))];
  const total = ctx.quick ? all.length : Math.max(500, all.length);
  const atOnce = ctx.quick ? 20 : 50;
  const loaded = await pool(total, atOnce, (i) => send(port, all[i % all.length]).then((r) => ({ i: i % all.length, r })));
  const slipped = new Map();
  const wrongRefused = new Map();
  const broken = [];
  for (const { i, r } of loaded) {
    const v = all[i];
    if (!r.status || r.status >= 500) broken.push({ v: `${v.m} ${v.p}`, got: r.status || r.code });
    if (v.want === "refused" && !isRefusal(r, v.rule)) slipped.set(`${v.m} ${v.p}`, r.status || r.code);
    if (v.want === "passed" && isRefusal(r)) wrongRefused.set(`${v.m} ${v.p}`, r.json.rule);
  }
  ctx.check(total);
  const refusedAtLoad = loaded.filter(({ i }) => all[i].want === "refused");
  ev.gate.load = {
    calls: total, atOnce, refusedRate: refusedAtLoad.filter(({ i, r }) => isRefusal(r, all[i].rule)).length / Math.max(1, refusedAtLoad.length),
    aloneRate: ev.gate.alone.refused / refuse.length, slipped: [...slipped], wrongRefused: [...wrongRefused], broken: broken.slice(0, 20), statuses: tally(loaded.map((x) => x.r)),
  };
  for (const [what, got] of slipped) {
    ctx.record({
      severity: "critical", area: "gate", check: "vector-load", target: what, title: `Under load the gate let through ${what}`,
      expected: "403 gate_refused, as one at a time", actual: String(got), suspectFiles: ["engine/gate/gate.mjs", "engine/gate/rules.mjs"],
    });
  }
  for (const [what, rule] of wrongRefused) {
    ctx.record({
      severity: "high", area: "gate", check: "needed-refused", target: what, title: `Under load the gate refused a request a heartbeat needs: ${what}`,
      expected: "forwarded to the board", actual: `refused ${rule}`, suspectFiles: ["engine/gate/gate.mjs", "engine/gate/body.mjs"],
    });
  }
  if (broken.length) {
    ctx.record({
      severity: "high", area: "gate", check: "load-5xx", target: "gate", title: "The gate answered 5xx or nothing under load",
      expected: "a 4xx refusal or the board's own answer", actual: JSON.stringify(broken.slice(0, 5)), suspectFiles: ["engine/gate/gate.mjs"],
    });
  }

  // 3. The narrow gate: more tokens than it keeps, at 50 at once; each reads only its own task.
  ev.narrow = await narrowSweep(ctx, stage);
  return ev;
}

async function narrowSweep(ctx, stage) {
  const ids = idsOf(stage);
  const slugs = Object.keys(ids.agents).slice(0, 6);
  const board = stage.urls.board;
  const keysPer = Math.ceil((MAX_TOKENS + 10) / slugs.length);
  const tokens = [];
  const issues = new Map();
  for (const slug of slugs) {
    const id = ids.agents[slug];
    const r = await call(`${board}/api/companies/${ids.companyId}/issues`, {
      method: "POST", headers: { "content-type": "application/json" }, body: { title: `Narrow stress ${slug}`, assigneeAgentId: id, projectId: ids.projectId },
    });
    if (r.status !== 201) throw new Error(`the stub board made no task for ${slug} (${r.status})`);
    issues.set(slug, r.json);
    for (let k = 0; k < keysPer; k += 1) {
      const kr = await call(`${board}/api/agents/${id}/keys`, { method: "POST", headers: { "content-type": "application/json" }, body: { name: `narrow-${k}` } });
      if (kr.status !== 201) throw new Error(`the stub board gave no key (${kr.status})`);
      tokens.push({ slug, token: kr.json.token });
    }
  }
  const port = stage.ports.gateNarrow;
  const before = { rssKb: await rssOf(stage, "gate") };
  const n = ctx.quick ? tokens.length : 500;
  const calls = await pool(n, 50, async (i) => {
    const t = tokens[i % tokens.length];
    const mine = i % 2 === 0;
    const other = slugs[(slugs.indexOf(t.slug) + 1) % slugs.length];
    const issue = mine ? issues.get(t.slug) : issues.get(other);
    // Ids alternate with identifiers, so both spellings are remembered and asked.
    const ref = i % 4 < 2 ? issue.id : issue.identifier;
    const r = await rawCall(port, "GET", `/api/issues/${ref}`, { headers: { authorization: `Bearer ${t.token}` } });
    return { mine, r };
  });
  ctx.check(n);
  const ownRefused = calls.filter((c) => c.mine && c.r.status !== 200);
  const otherPassed = calls.filter((c) => !c.mine && c.r.status === 200);
  const otherNotRefused = calls.filter((c) => !c.mine && !(c.r.status === 403 && c.r.json && c.r.json.rule === "narrow-not-yours"));

  // Many issues for one token: more than it keeps, each asked; the first is still its own afterwards.
  let manyIssues = null;
  if (!ctx.quick) {
    const t = tokens[0];
    const id = ids.agents[t.slug];
    const made = [];
    for (let k = 0; k < MAX_ISSUES_PER_TOKEN + 10; k += 1) {
      const r = await call(`${board}/api/companies/${ids.companyId}/issues`, {
        method: "POST", headers: { "content-type": "application/json" }, body: { title: `Narrow many ${k}`, assigneeAgentId: id, projectId: ids.projectId },
      });
      made.push(r.json.id);
    }
    const reads = await pool(made.length, 20, (i) => rawCall(port, "GET", `/api/issues/${made[i]}`, { headers: { authorization: `Bearer ${t.token}` } }));
    const again = await rawCall(port, "GET", `/api/issues/${made[0]}`, { headers: { authorization: `Bearer ${t.token}` } });
    manyIssues = { asked: made.length, ok: reads.filter((r) => r.status === 200).length, firstAgain: again.status };
    ctx.check(made.length + 1);
    if (manyIssues.ok !== made.length || again.status !== 200) {
      ctx.record({
        severity: "high", area: "gate", check: "narrow-many-issues", target: "narrow", title: "The narrow gate refused an agent its own task once it had asked about more than it keeps",
        expected: `${made.length} of ${made.length}, and the first again`, actual: JSON.stringify(manyIssues), suspectFiles: ["engine/gate/narrow.mjs"],
      });
    }
  }
  const after = { rssKb: await rssOf(stage, "gate") };
  const ev = {
    tokens: tokens.length, maxTokens: MAX_TOKENS, calls: n, ownRefused: ownRefused.length, otherPassed: otherPassed.length,
    otherNotRefused: otherNotRefused.length, statuses: tally(calls.map((c) => c.r)), rssKb: { before: before.rssKb, after: after.rssKb }, manyIssues,
  };
  if (otherPassed.length) {
    ctx.record({
      severity: "critical", area: "gate", check: "narrow-other", target: "narrow", title: "Under load the narrow gate let an agent read another agent's task",
      expected: "403 narrow-not-yours", actual: `${otherPassed.length} of ${calls.length / 2} answered 200`, suspectFiles: ["engine/gate/narrow.mjs"],
    });
  } else if (otherNotRefused.length) {
    ctx.record({
      severity: "medium", area: "gate", check: "narrow-other-status", target: "narrow", title: "The narrow gate answered another agent's task with something other than its refusal",
      expected: "403 narrow-not-yours", actual: JSON.stringify(tally(otherNotRefused.map((c) => c.r))), suspectFiles: ["engine/gate/narrow.mjs"],
    });
  }
  if (ownRefused.length) {
    ctx.record({
      severity: "high", area: "gate", check: "narrow-own", target: "narrow", title: "Under load the narrow gate refused an agent its own task",
      expected: "200", actual: JSON.stringify(tally(ownRefused.map((c) => c.r))), suspectFiles: ["engine/gate/narrow.mjs", "engine/gate/gate.mjs"],
    });
  }
  return ev;
}
