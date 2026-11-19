// Needs you on `large` (REVIEW-STRESS 2, measured in pass 2): each listing source of the inbox has 4 s
// (lib/inbox.mjs SOURCE_DEADLINE_MS) before it is said as not answering and the shell's count is marked partial.
// On the large seed (120 Needs you items, 500 tasks) the staged listing reads the most; this times GET /api/inbox
// cold (the first call of a fresh home) and 20 times after, one at a time and then 10 at once, and reads the
// shell's count. A source missing from a cold or warm answer, a partial count, or a p95 over the deadline is a finding.
// -> { cold, warm, atOnce, items, bySource, notConnected, partial }
import { percentile, short } from "./common.mjs";

const DEADLINE_MS = 4000;

export async function inboxLarge(ctx, issue) {
  const st = await ctx.startStage({ dataset: "large", label: "inbox" });
  const files = ["engine/home/server/lib/inbox.mjs", "engine/home/server/inbox/staged.mjs"];
  try {
    const { call } = await import("../lib/http.mjs");
    const url = `${st.urls.home}/api/inbox`;
    const once = async () => {
      try { return await call(url, { timeoutMs: 20000 }); } catch (e) { return { status: 0, ms: 20000, error: e, json: undefined, text: "" }; }
    };
    const first = await once();
    ctx.check();
    const warm = [];
    let last = first;
    for (let i = 0; i < 20; i += 1) { last = await once(); warm.push(last.ms); ctx.check(); }
    const burst = await Promise.all(Array.from({ length: 10 }, once));
    ctx.check(10);
    const shell = await call(`${st.urls.home}/api/shell`, { timeoutMs: 20000 }).catch((e) => ({ status: 0, error: e }));
    const out = {
      dataset: "large",
      cold: { ms: first.ms, status: first.status, notConnected: first.json?.notConnected ?? null },
      warm: { p50: percentile(warm, 50), p95: percentile(warm, 95), max: Math.max(...warm) },
      atOnce: { n: burst.length, p95: percentile(burst.map((b) => b.ms), 95), max: Math.max(...burst.map((b) => b.ms)), statuses: [...new Set(burst.map((b) => b.status))] },
      items: Array.isArray(last.json?.items) ? last.json.items.length : null,
      bySource: last.json?.counts?.bySource ?? null,
      notConnected: last.json?.notConnected ?? null,
      partial: shell.json?.counts?.partial ?? null,
      shellMs: shell.ms ?? null,
      deadlineMs: DEADLINE_MS,
    };
    ctx.log(`Needs you on large: cold ${out.cold.ms} ms, warm p50 ${out.warm.p50} p95 ${out.warm.p95} max ${out.warm.max} ms, 10 at once p95 ${out.atOnce.p95} ms; ${out.items} items ${JSON.stringify(out.bySource)}; not connected ${JSON.stringify(out.notConnected)}; partial ${out.partial}`);
    const missing = [first, last, ...burst].filter((r) => r.status !== 200 || (Array.isArray(r.json?.notConnected) && r.json.notConnected.length));
    if (missing.length) {
      issue("medium", "inbox-large", "GET /api/inbox on large", {
        title: `Needs you on large data left a source out (${missing.length} of ${2 + burst.length} answers)`,
        expected: "every source listed in time, nothing said as not answering", actual: missing.slice(0, 3).map((r) => `${short(r)}`).join(" | "), files,
      });
    }
    if (out.partial === true) issue("medium", "inbox-large-partial", "GET /api/shell on large", { title: "The shell's Needs you count was marked partial on large data", expected: "partial false", actual: JSON.stringify(shell.json?.counts || null), files });
    if (Math.max(out.warm.p95 ?? 0, out.atOnce.p95 ?? 0, out.cold.ms) > DEADLINE_MS) {
      issue("medium", "inbox-large-slow", "GET /api/inbox timing on large", { title: `Needs you on large took over ${DEADLINE_MS} ms`, expected: `under ${DEADLINE_MS} ms`, actual: JSON.stringify({ cold: out.cold.ms, warm: out.warm, atOnce: out.atOnce }), files });
    }
    return out;
  } finally {
    await st.close();
  }
}
