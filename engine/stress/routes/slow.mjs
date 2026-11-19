// Slow clients (PLAN-STRESS T4): 50 connections that send a POST's headers and then nothing, and 50 that send its body
// at one byte a second. The home must still answer a normal GET in under 1 s while they hang on, and close every slow
// one in the end (its headersTimeout and requestTimeout, engine/home/server/lib/app.mjs).
import net from "node:net";
import { checkUrl } from "../lib/http.mjs";
import { sleep } from "./common.mjs";

const FILES = ["engine/home/server/lib/app.mjs"];

function slowSocket(port, { drip }) {
  checkUrl(`http://127.0.0.1:${port}/`);
  const s = net.connect({ host: "127.0.0.1", port });
  const state = { closed: false, closedAt: null, sent: 0, answered: false };
  const started = Date.now();
  let timer = null;
  s.on("connect", () => {
    s.write(`POST /api/settings HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nX-Engine: 1\r\nContent-Length: 1000\r\n\r\n`);
    if (drip) {
      timer = setInterval(() => {
        if (state.closed) return;
        state.sent += 1;
        s.write(" ");
      }, 1000);
    }
  });
  s.on("data", () => { state.answered = true; });
  const end = () => { if (!state.closed) { state.closed = true; state.closedAt = Date.now() - started; clearInterval(timer); } };
  s.on("close", end);
  s.on("error", end);
  return { state, destroy: () => { clearInterval(timer); s.destroy(); } };
}

export async function slowClients(env, { each = 50, waitMs = 120000 } = {}) {
  const { hit, port } = env;
  const socks = [
    ...Array.from({ length: each }, () => slowSocket(port, { drip: false })),
    ...Array.from({ length: each }, () => slowSocket(port, { drip: true })),
  ];
  await sleep(2000);
  // Normal GETs while they hang on.
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await hit(port, "GET", "/api/setup", { timeoutMs: 10000 });
    env.check();
    times.push(r.status === 200 ? r.ms : Infinity);
    await sleep(500);
  }
  const worst = Math.max(...times);
  if (worst >= 1000) {
    env.issue("high", "slow-client-get", "slow clients", { title: `with ${socks.length} slow clients a normal GET took ${worst === Infinity ? "no answer" : `${worst} ms`}`, expected: "under 1 s", actual: times.join(", "), files: FILES });
  }
  // The home closes them in the end.
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs && socks.some((s) => !s.state.closed)) await sleep(1000);
  const open = socks.filter((s) => !s.state.closed);
  env.check(socks.length);
  if (open.length) {
    env.issue("medium", "slow-client-open", "slow clients", { title: `${open.length} of ${socks.length} slow connections were still open after ${Math.round(waitMs / 1000)} s`, expected: "each closed by the home's timeouts", actual: `${open.filter((s) => s.state.sent === 0).length} silent, ${open.filter((s) => s.state.sent > 0).length} dripping`, files: FILES });
  }
  for (const s of socks) s.destroy();
  const closedAt = socks.filter((s) => s.state.closedAt !== null).map((s) => s.state.closedAt);
  env.log(`slow clients: normal GETs ${times.join(", ")} ms; ${socks.length - open.length} closed by the home, the last after ${closedAt.length ? Math.max(...closedAt) : "-"} ms`);
  return { worstGetMs: worst, open: open.length };
}
