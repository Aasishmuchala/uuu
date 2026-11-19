// The model relay under load (PLAN-STRESS T5): 200 streamed answers at 20 at once from the fake provider; a provider
// that stalls, cuts its stream, answers 500 or 429, or quotes the key back; the relay's own limits (DEFAULT_LIMITS);
// and the made-up key in no answer, no log line and no status file.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LIMITS, keyForms } from "../../relay/relay.mjs";
import { PROVIDER_KEY } from "../lib/stage.mjs";
import { agentToken, idsOf, notCovered, pool, rawCall, readText, rssOf, secretOf, setModels, tally } from "./util.mjs";

const BODY = (stream = true) => JSON.stringify({ model: "x", max_tokens: 16, stream, messages: [{ role: "user", content: "stress" }] });

// Every file under a folder (no link followed).
function walk(dir, out = []) {
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of names) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export async function relaySweep(ctx, stage) {
  const ev = {};
  const ids = idsOf(stage);
  setModels(stage, ["builder", "checker"]);
  const secret = secretOf(stage, "relay");
  if (!secret) throw new Error("the staged relay has no secret");
  const token = agentToken(secret, ids.agents.builder);
  const port = stage.ports.relay;
  const ask = (stream = true, timeoutMs = 20000) => rawCall(port, "POST", "/v1/messages", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "anthropic-version": "2023-06-01" }, body: BODY(stream), timeoutMs,
  });
  const forms = keyForms(PROVIDER_KEY).map((f) => f.toLowerCase());
  const answers = [];
  const keep = (r) => { answers.push(r); return r; };

  // 1. Streamed answers at 20 at once.
  const n = ctx.quick ? 20 : 200;
  const streamed = await pool(n, 20, () => ask().then(keep));
  const good = streamed.filter((r) => r.status === 200 && /event: message_stop/.test(r.text || ""));
  const ms = streamed.map((r) => r.ms).sort((a, b) => a - b);
  ev.streamed = { calls: n, whole: good.length, statuses: tally(streamed), p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)] };
  ctx.check(n);
  if (good.length !== n) {
    ctx.record({
      severity: "high", area: "relay", check: "streamed-load", target: "relay", title: "Streamed answers through the relay failed at 20 at once",
      expected: `${n} whole streams`, actual: JSON.stringify(ev.streamed.statuses), suspectFiles: ["engine/relay/relay.mjs"],
    });
  }

  // 2. A provider that misbehaves: four calls at once each; the relay answers, stays up, and passes no key.
  const behaviours = [
    ["500", { status: 500 }], ["429", { status: 429, retryAfter: "30" }], ["key in the stream", { echoKey: "stream" }],
    ["key split across writes", { echoKey: "split" }], ["key in a 200 body", { echoKey: "body200" }], ["key in a header", { echoKey: "header" }],
    ["key in a 401 body", { echoKey: "body401" }], ["key escaped in a body", { echoKey: "body200", echoForm: "jsonSlash" }],
    ["slow events", { eventDelayMs: 400 }],
  ];
  ev.behaviours = {};
  for (const [name, b] of behaviours) {
    await stage.setBehaviour("provider", b);
    const rs = await Promise.all([1, 2, 3, 4].map(() => ask(true, 20000).then(keep)));
    ev.behaviours[name] = tally(rs);
    ctx.check(4);
    const hung = rs.filter((r) => r.hang);
    if (hung.length) {
      ctx.record({
        severity: "high", area: "relay", check: "provider-fault-hang", target: name, title: `The relay gave no answer in 20 s when the provider ${name}`,
        expected: "an answer or a refusal", actual: `${hung.length} of 4 hung`, suspectFiles: ["engine/relay/relay.mjs"],
      });
    }
  }
  // A provider that never answers: the caller gives up; the relay must keep serving everyone else.
  await stage.setBehaviour("provider", { hang: true });
  const stalled = await Promise.all([1, 2, 3, 4].map(() => ask(true, 4000)));
  await stage.setBehaviour("provider", {});
  const after = await ask();
  ev.stall = { stalled: tally(stalled), after: after.status };
  ctx.check(2);
  if (after.status !== 200) {
    ctx.record({
      severity: "high", area: "relay", check: "after-stall", target: "relay", title: "After callers gave up on a stalled provider, the relay did not answer the next call",
      expected: "200", actual: String(after.status || after.code), suspectFiles: ["engine/relay/relay.mjs"],
    });
  }
  if (!ctx.quick) {
    // The first-byte limit itself (DEFAULT_LIMITS.firstByteMs, 120 s): the relay answers by then.
    await stage.setBehaviour("provider", { hang: true });
    const long = await ask(true, DEFAULT_LIMITS.firstByteMs + 20000);
    await stage.setBehaviour("provider", {});
    ev.firstByte = { status: long.status || long.code, ms: long.ms, code: long.json && long.json.code };
    ctx.check(1);
    if (long.hang || long.ms > DEFAULT_LIMITS.firstByteMs + 10000) {
      ctx.record({
        severity: "high", area: "relay", check: "first-byte-limit", target: "relay", title: "The relay did not end a call to a silent provider at its first-byte limit",
        expected: `an answer within ${DEFAULT_LIMITS.firstByteMs / 1000} s`, actual: JSON.stringify(ev.firstByte), suspectFiles: ["engine/relay/relay.mjs"],
      });
    }
  }

  // 3. The relay's own limits and refusals.
  const limits = {
    tooBig: await rawCall(port, "POST", "/v1/messages", { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, declare: DEFAULT_LIMITS.bodyBytes + 1 }),
    noToken: await rawCall(port, "POST", "/v1/messages", { headers: { "content-type": "application/json" }, body: BODY() }),
    wrongPath: await rawCall(port, "POST", "/v1/complete", { headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: BODY() }),
    get: await rawCall(port, "GET", "/v1/messages", { headers: { authorization: `Bearer ${token}` } }),
    upgrade: await rawCall(port, "GET", "/v1/messages", { headers: { authorization: `Bearer ${token}`, connection: "upgrade", upgrade: "websocket" } }),
    notJson: await rawCall(port, "POST", "/v1/messages", { headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: "hello" }),
  };
  const wantLimits = { tooBig: [413, "relay_too_big"], noToken: [401, "relay_no_token"], wrongPath: [404, "relay_not_found"], get: [404, "relay_not_found"], upgrade: [403, "relay_refused"], notJson: [400, "relay_bad_body"] };
  ev.limits = {};
  for (const [k, [status, code]] of Object.entries(wantLimits)) {
    const r = limits[k];
    ev.limits[k] = `${r.status || r.code} ${r.json ? r.json.code : ""}`.trim();
    ctx.check(1);
    if (r.status !== status || !r.json || r.json.code !== code) {
      ctx.record({
        severity: "medium", area: "relay", check: "limit", target: k, title: `The relay's answer to ${k} is not its own refusal`,
        expected: `${status} ${code}`, actual: ev.limits[k], suspectFiles: ["engine/relay/relay.mjs"],
      });
    }
  }

  // 4. The key: in no answer, and nowhere in the logs, the models folder or the doors folder.
  const leaks = [];
  for (const r of answers) {
    const text = `${r.text || ""}\n${JSON.stringify(r.headers || {})}`.toLowerCase();
    if (forms.some((f) => text.includes(f))) leaks.push(`answer ${r.status}`);
  }
  const files = [...walk(join(stage.state, "logs")), ...walk(join(stage.state, "models")), ...walk(join(stage.state, "doors"))];
  for (const f of files) {
    if (statSync(f).size > 64 * 1024 * 1024) continue;
    if (readText(f).includes("sk-stress-fake")) leaks.push(f.replace(stage.root, "<stage>"));
  }
  ev.keyLeaks = leaks;
  ctx.check(answers.length + files.length);
  if (leaks.length) {
    ctx.record({
      severity: "critical", area: "relay", check: "key-leak", target: leaks[0], title: "The provider key reached an answer, a log line or a status file",
      expected: "nowhere outside secrets/", actual: leaks.slice(0, 10).join("; "), suspectFiles: ["engine/relay/relay.mjs"],
    });
  }
  notCovered(ctx, "doors: the fake provider cannot stop halfway through a stream by itself; the relay's own cut of a stream (the key in it) is covered instead");
  notCovered(ctx, `doors: the relay's idle (${DEFAULT_LIMITS.idleMs / 1000} s) and total (${DEFAULT_LIMITS.totalMs / 1000} s) limits are not waited out; the first-byte limit is, on full runs`);
  const health = await rawCall(port, "GET", "/relay/health");
  ev.healthAfter = health.status;
  ev.rssKb = await rssOf(stage, "relay");
  ctx.check(1);
  if (health.status !== 200) {
    ctx.record({ severity: "high", area: "relay", check: "health-after", target: "relay", title: "The relay's health did not answer after the load", expected: "200", actual: String(health.status || health.code) });
  }
  return ev;
}
