// Restart while busy (PLAN-STRESS T4): 20 calls a second against a mix of GETs and POSTs while the home is stopped
// five times with SIGTERM (stage.restart) and then killed with SIGKILL and started three times. After each: every JSON
// file under the state parses, no temp file older than 5 s is left, the home answers within 10 s, and each POST that
// got no answer either fully happened or did not happen at all (each knowledge document is either listed with all its
// text, or absent; a lesson is one line, so its file parsing is what is checked).
import { sleep, short, stateHealth } from "./common.mjs";

const FILES = ["engine/home/server/main.mjs", "engine/home/server/lib/app.mjs", "engine/home/server/knowledge/store.mjs", "engine/home/server/routes/team-lessons.mjs"];
const GETS = ["/api/tasks", "/api/inbox", "/api/setup", "/api/brain", "/api/knowledge", "/api/map", "/healthz"];

export async function restartWhileBusy(env, { sigterm = 5, sigkill = 3 } = {}) {
  const { st, hit, port } = env;
  // Calls cut by a restart are expected: they are kept out of the sweep's 5xx and hang counts.
  const before = { fiveXX: env.stats.fiveXX, hangs: env.stats.hangs };
  const slug = env.ids.slugs[0] || "chief-of-staff";
  const unanswered = []; // { kind, name, text }
  let n = 0;
  let running = true;
  const posts = [];
  const one = async () => {
    const i = n++;
    const kind = i % 4;
    if (kind === 0) {
      const name = `restart-${env.tag}-${i}.md`;
      const text = `Document ${i} written while the home was restarted. `.repeat(20);
      const res = await hit(port, "POST", "/api/knowledge", { body: { name, text }, timeoutMs: 15000 });
      posts.push({ kind: "doc", name, text, res });
    } else if (kind === 1) {
      const text = `Restart lesson ${env.tag} ${i}.`;
      const res = await hit(port, "POST", `/api/team/${slug}/lessons`, { body: { text }, timeoutMs: 15000 });
      posts.push({ kind: "lesson", name: text, text, res });
    } else if (kind === 2) {
      await hit(port, "POST", "/api/settings", { body: { motion: i % 8 === 2 ? "off" : "on" }, timeoutMs: 15000 });
    } else {
      await hit(port, "GET", GETS[i % GETS.length], { timeoutMs: 15000 });
    }
  };
  // 20 a second, each on its own, so calls that hang during a restart do not slow the rest.
  const inflight = new Set();
  const driver = (async () => {
    while (running) {
      const p = one().catch(() => {});
      inflight.add(p);
      p.finally(() => inflight.delete(p));
      await sleep(50);
    }
  })();

  const rounds = [...Array(sigterm).fill("SIGTERM"), ...Array(sigkill).fill("SIGKILL")];
  for (const [i, sig] of rounds.entries()) {
    await sleep(1500);
    const t0 = Date.now();
    try {
      if (sig === "SIGTERM") await st.restart("home");
      else { await st.kill("home", "SIGKILL"); await st.start("home"); }
    } catch (e) {
      env.issue("high", "restart-start", `restart ${sig}`, { title: `the home did not come back after ${sig} (round ${i + 1})`, expected: "healthy within 10 s", actual: String(e.message).slice(0, 500), files: FILES });
      running = false;
      break;
    }
    // The home answers within 10 s of being started again.
    let back = null;
    while (Date.now() - t0 < 30000) {
      const r = await hit(port, "GET", "/healthz", { timeoutMs: 2000 });
      if (r.status === 200) { back = Date.now() - t0; break; }
      await sleep(100);
    }
    env.check();
    if (back === null || back > 10000) {
      env.issue("high", "restart-slow", `restart ${sig}`, { title: `the home took ${back === null ? "over 30 s" : `${back} ms`} to answer after ${sig}`, expected: "within 10 s", actual: String(back), files: FILES });
    }
    const h = stateHealth(st.state);
    env.check();
    if (h.badJson.length) env.issue("high", "restart-json", `restart ${sig}`, { title: `a state file does not parse after the home was stopped with ${sig}`, expected: "every JSON file parses", actual: h.badJson.slice(0, 10).join(", "), files: FILES });
    if (h.oldTmp.length) env.issue("medium", "restart-tmp", `restart ${sig}`, { title: `temp files left after the home was stopped with ${sig}`, expected: "no *.tmp older than 5 s", actual: h.oldTmp.slice(0, 10).join(", "), files: FILES });
  }
  running = false;
  await driver;
  await Promise.allSettled([...inflight]);

  // Each POST that got no answer: all or nothing.
  for (const p of posts) if (!p.res || p.res.status === 0) unanswered.push(p);
  const docs = await hit(port, "GET", "/api/knowledge", { timeoutMs: 15000 });
  const half = [];
  for (const p of unanswered) {
    if (p.kind === "doc") {
      const listed = (docs.json?.docs || []).some((d) => d.name === p.name);
      if (!listed) continue;
      const one = await hit(port, "GET", `/api/knowledge/doc/${encodeURIComponent(p.name)}`, { timeoutMs: 15000 });
      if (typeof one.json?.text !== "string" || one.json.text.trim() !== p.text.trim()) half.push(`document ${p.name}: ${short(one).slice(0, 120)}`);
    }
  }
  env.check(unanswered.length + 1);
  if (half.length) env.issue("high", "restart-half", "restart", { title: `${half.length} POSTs cut by a restart were half done`, expected: "each either fully done or not at all", actual: half.slice(0, 10).join(" | "), files: FILES });
  const cut = { fiveXX: env.stats.fiveXX - before.fiveXX, hangs: env.stats.hangs - before.hangs };
  Object.assign(env.stats, before);
  env.log(`restart while busy (${cut.fiveXX} 5xx and ${cut.hangs} hangs while it was stopped, not counted): ${n} calls, ${posts.length} checked POSTs, ${unanswered.length} without an answer, ${half.length} half done`);
  return { calls: n, unanswered: unanswered.length, half: half.length, cut };
}
