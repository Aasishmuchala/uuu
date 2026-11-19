// The web door on the fake internet (PLAN-STRESS T5): a page that stalls, drips, is too big or a gzip bomb, and
// redirects to this Mac or to a private address, each refused or cut as the door's tests say, four at once; never
// more than MAX_AT_ONCE (4) fetches running; the door's memory under 300 MB throughout; and its rate.
import { MAX_AT_ONCE } from "../../web/door.mjs";
import { agentToken, idsOf, pool, rawCall, rssOf, secretOf, sleep, tally } from "./util.mjs";

// Host -> the codes its own tests accept (engine/web/test/door.test.mjs rows 10 to 12).
const FAULTS = [
  ["http://stall.test/", ["web_unreachable"]],
  ["http://drip.test/", [null, "web_unreachable", "web_too_big"]],
  ["http://big.test/", ["web_too_big"]],
  ["http://bomb.test/", ["web_too_big"]],
  // A redirect to a bare IP is refused before any lookup (engine/web/test/fetch.test.mjs, to-ip.test).
  ["http://to-loop.test/", ["web_bad_address", "web_private_address"]],
  ["http://to-private.test/", ["web_private_address"]],
  ["http://private.test/", ["web_private_address"]],
  ["http://loop.test/", ["web_private_address"]],
];
const MEMORY_KB = 300 * 1024;

export async function webSweep(ctx, stage, env) {
  const ev = {};
  const ids = idsOf(stage);
  const secret = secretOf(stage, "web");
  const token = agentToken(secret, ids.agents.researcher);
  const port = stage.ports.web;
  env.setDoor("web", { on: true, perHour: 100000, perDay: 100000 });
  const fetchUrl = (url, timeoutMs = 40000) => rawCall(port, "POST", "/web/fetch", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ url }), timeoutMs,
  });

  // Memory, sampled the whole time.
  let peak = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const kb = (await rssOf(stage, "web")) || 0;
      if (kb > peak) peak = kb;
      await sleep(250);
    }
  })();

  try {
    const page = await fetchUrl("https://site.test/");
    ev.page = { status: page.status, notice: Boolean(page.json && page.json.notice) };
    ctx.check(1);
    if (page.status !== 200) {
      ctx.record({ severity: "high", area: "web", check: "page", target: "site.test", title: "The web door did not read a plain page from the fake internet", expected: "200", actual: `${page.status} ${page.text.slice(0, 200)}`, suspectFiles: ["engine/web/door.mjs"] });
    }

    // Each fault, four at once.
    ev.faults = {};
    for (const [url, codes] of FAULTS) {
      const rs = await Promise.all([1, 2, 3, 4].map(() => fetchUrl(url)));
      ev.faults[url] = tally(rs);
      ctx.check(4);
      const wrong = rs.filter((r) => {
        const code = r.json && r.json.code ? r.json.code : (r.status === 200 ? null : `status ${r.status || r.code}`);
        return r.hang || !codes.includes(code);
      });
      if (wrong.length) {
        const leaked = wrong.some((r) => r.status === 200 && /private|loop|to-/.test(url));
        ctx.record({
          severity: leaked ? "critical" : "high", area: "web", check: "fault", target: url, title: `The web door's answer to ${url} at four at once is not the one its tests give`,
          expected: codes.map((c) => c || "200").join(" or "), actual: JSON.stringify(tally(wrong)), suspectFiles: ["engine/web/door.mjs", "engine/web/fetch.mjs"],
        });
      }
    }

    // Never more than MAX_AT_ONCE: many at once to a page that never answers.
    const n = ctx.quick ? 20 : 50;
    const many = await pool(n, n, () => fetchUrl("http://stall.test/"));
    const admitted = many.filter((r) => !(r.json && r.json.code === "web_too_many"));
    ev.atOnce = { sent: n, admitted: admitted.length, statuses: tally(many) };
    ctx.check(n);
    if (admitted.length > MAX_AT_ONCE) {
      ctx.record({
        severity: "critical", area: "web", check: "max-at-once", target: "web", title: `The web door ran ${admitted.length} fetches at once`,
        expected: `at most ${MAX_AT_ONCE}`, actual: JSON.stringify(ev.atOnce.statuses), suspectFiles: ["engine/web/door.mjs"],
      });
    }
    const hung = many.filter((r) => r.hang);
    if (hung.length) {
      ctx.record({ severity: "high", area: "web", check: "hang", target: "stall.test", title: "The web door left calls without an answer", expected: "an answer within 40 s", actual: `${hung.length} hung` });
    }

    // The rate: one an hour, after all those calls, is refused with a wait.
    env.setDoor("web", { on: true, perHour: 1, perDay: 100000 });
    const rate = await fetchUrl("https://site.test/");
    ev.rate = { status: rate.status, code: rate.json && rate.json.code, retryAfterSec: rate.json && rate.json.retryAfterSec };
    ctx.check(1);
    if (!(rate.json && rate.json.code === "web_too_many" && Number(rate.json.retryAfterSec) > 0)) {
      ctx.record({ severity: "high", area: "web", check: "rate", target: "perHour", title: "The web door let a call past its hourly rate", expected: "web_too_many with a wait", actual: JSON.stringify(ev.rate), suspectFiles: ["engine/web/door.mjs"] });
    }
    env.setDoor("web", { on: true, perHour: 100000, perDay: 100000 });
  } finally {
    sampling = false;
    await sampler;
  }
  ev.peakRssKb = peak;
  ctx.check(1);
  if (peak > MEMORY_KB) {
    ctx.record({
      severity: "high", area: "web", check: "memory", target: "web", title: `The web door grew to ${Math.round(peak / 1024)} MB on big pages and bombs`,
      expected: "under 300 MB", actual: `${Math.round(peak / 1024)} MB`, suspectFiles: ["engine/web/fetch.mjs"],
    });
  }
  return ev;
}
