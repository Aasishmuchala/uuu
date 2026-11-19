// The stand-in for Claude Code in the stage (PLAN-STRESS T5, sweep `agents`). The stage writes it into
// <stage>/root/fake-claude.mjs, beside the launcher <stage>/root/fake-claude that the copy's config names as
// `fence.realClaude`, so it runs where the real program would: started by the copy's wrapper (fence/bin/claude), inside
// the copy's real fence (fence/fence-run, the sandbox tool). It does what one turn of an agent does, through the same
// doors, then tries what must fail and says what happened. No model is asked: the relay answers from the fake provider.
//
// stdin: one JSON object { role: "builder"|"checker", task: { id, identifier, title }, companyId, tag, round,
//   ports: { board, home, generate, gate }, outside: { host, port }, secretFile, otherTask, escapes: [path...] }
// env (from the wrapper and the fence): ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, PAPERCLIP_API_URL,
//   PAPERCLIP_API_KEY, HTTP_PROXY
// stdout: its last line is `STRESS-RESULT <json>`. Built-in modules only.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const out = { role: input.role, tag: input.tag, argv: process.argv.slice(2), env: {}, steps: {}, tries: [], cwd: process.cwd() };
for (const k of ["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "PAPERCLIP_API_URL"]) out.env[k] = process.env[k] || null;
out.env.hasRelayToken = /^v1\.a\./.test(process.env.ANTHROPIC_AUTH_TOKEN || "");
out.env.hasProxy = Boolean(process.env.HTTP_PROXY);

const PROXY = (() => {
  try {
    const u = new URL(process.env.HTTP_PROXY || "");
    const auth = u.username ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}` : null;
    return { host: u.hostname, port: Number(u.port), auth };
  } catch {
    return null;
  }
})();

// One request through the fence's proxy, as every program in the fence makes it: { status, body } or { error }.
function viaProxy(method, url, { headers = {}, body, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!PROXY) return resolve({ error: "no proxy" });
    const u = new URL(url);
    const h = { host: u.host, ...headers };
    if (PROXY.auth) h["proxy-authorization"] = PROXY.auth;
    if (body !== undefined) h["content-length"] = Buffer.byteLength(body);
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const req = http.request({ host: PROXY.host, port: PROXY.port, method, path: url, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => finish({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8").slice(0, 20000) }));
      res.on("error", (e) => finish({ error: e.code || e.message }));
    });
    const t = setTimeout(() => { req.destroy(); finish({ error: "timeout" }); }, timeoutMs);
    req.on("error", (e) => finish({ error: e.code || e.message }));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// One TCP connect around the proxy: "connected", "timeout" or the error code.
function direct(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let s;
    const t = setTimeout(() => { if (s) s.destroy(); resolve("timeout"); }, timeoutMs);
    try {
      s = net.connect({ host, port });
    } catch (e) {
      clearTimeout(t);
      return resolve(e.code || "error");
    }
    s.once("connect", () => { clearTimeout(t); s.destroy(); resolve("connected"); });
    s.once("error", (e) => { clearTimeout(t); resolve(e.code || "error"); });
  });
}

const json = (v) => JSON.stringify(v);
const gate = process.env.PAPERCLIP_API_URL || "";
const key = process.env.PAPERCLIP_API_KEY || "";
const auth = { authorization: `Bearer ${key}`, accept: "application/json" };

async function relayTurn() {
  const base = process.env.ANTHROPIC_BASE_URL || "";
  const r = await viaProxy("POST", `${base}/v1/messages`, {
    headers: { authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN || ""}`, "content-type": "application/json", "anthropic-version": "2023-06-01" },
    body: json({ model: "anything", max_tokens: 64, stream: true, messages: [{ role: "user", content: `stress ${input.tag}` }] }),
    timeoutMs: 20000,
  });
  return { status: r.status || 0, error: r.error || null, ok: r.status === 200 && /"text":"OK"/.test(r.body || ""), streamed: /event: message_stop/.test(r.body || "") };
}

const BRIEF = (t) => `# Brief: ${t}\n\n## The goal in the owner's words\nA price list for the kitchen ranges (${input.tag}).\n\n` +
  "## What done looks like\nA short list with every price checked.\n\n## Must-haves\n- Every range\n\n## Nice-to-haves\n- None\n\n## Anything unclear\nNone.\n";
const PLAN = (t) => `# Plan: ${t}\n\n## Approach\nRead the catalogue and write the list.\n\n## What will be produced\n- 04-summary.md\n\n` +
  "## Steps\n1. Write the list - builder\n\n## Anything unclear\nNone.\n";
const SUMMARY = (t) => `# Summary: ${t}\n\n## What was done\nWrote the list (${input.tag}).\n\n## Files\n- 00-brief.md\n- 01-plan.md\n\n## What is left\nNothing.\n`;
const CHECK = (round) => [
  "VERDICT: PASS - the brief, the plan and the summary are there and say the same thing.",
  `# Check: round ${round}`,
  "",
  "## Questions",
  "1. Is there a brief? YES - 00-brief.md is in the folder.",
  "2. Is there a plan? YES - 01-plan.md is in the folder.",
  "3. Is there a summary? YES - 04-summary.md is in the folder.",
  "4. Does the summary match the plan? YES - the one step is done.",
  "5. Is every question answered? YES - every section says None.",
  "6. Did the work stay in the task? YES - only the three files.",
  "",
  "## Actions",
  "None.",
  "",
  "## Anything unclear",
  "None.",
  "",
  "Verdict: PASS",
].join("\n");

async function work() {
  out.steps.relay = await relayTurn();
  const task = await viaProxy("GET", `${gate}/api/issues/${input.task.id}`, { headers: auth });
  let issue = null;
  try { issue = JSON.parse(task.body); } catch { issue = null; }
  out.steps.readTask = { status: task.status || 0, error: task.error || null, ok: task.status === 200 && issue && issue.id === input.task.id };
  if (input.role === "builder") {
    const files = {};
    for (const [name, text] of [["00-brief.md", BRIEF], ["01-plan.md", PLAN], ["04-summary.md", SUMMARY]]) {
      try { writeFileSync(join(process.cwd(), name), text(input.task.title)); files[name] = "ok"; } catch (e) { files[name] = e.code || "error"; }
    }
    out.steps.files = files;
    const c = await viaProxy("POST", `${gate}/api/issues/${input.task.id}/comments`, {
      headers: { ...auth, "content-type": "application/json" },
      body: json({ body: `Wrote the brief, the plan and the summary (${input.tag}).` }),
    });
    out.steps.comment = { status: c.status || 0, error: c.error || null };
  } else {
    const seen = {};
    for (const name of ["00-brief.md", "01-plan.md", "04-summary.md"]) {
      try { seen[name] = readFileSync(join(process.cwd(), name), "utf8").includes(input.tag) ? "ok" : "other"; } catch (e) { seen[name] = e.code || "error"; }
    }
    out.steps.readFiles = seen;
    // Its folder is read-only: a write there must fail.
    try { writeFileSync(join(process.cwd(), "checker-wrote.txt"), "x"); out.steps.checkerWrite = "written"; } catch (e) { out.steps.checkerWrite = e.code || "error"; }
    const c = await viaProxy("POST", `${gate}/api/issues/${input.task.id}/comments`, {
      headers: { ...auth, "content-type": "application/json" }, body: json({ body: CHECK(input.round || 1) }),
    });
    out.steps.comment = { status: c.status || 0, error: c.error || null };
  }
  // A request the gate refuses (its refusal list: the company's secrets), so its refusal log gets one line.
  const g = await viaProxy("GET", `${gate}/api/companies/${input.companyId}/secrets`, { headers: auth });
  let code = null;
  try { code = JSON.parse(g.body).code; } catch { code = null; }
  out.steps.gateRefused = { status: g.status || 0, code };
}

// The seven tries that must fail. `refused` is true only when the fence stopped it.
async function tries() {
  const t = (name, refused, detail) => out.tries.push({ try: name, refused, detail });
  const fsTry = (fn) => { try { fn(); return "done"; } catch (e) { return e.code || "error"; } };
  const denied = (c) => c === "EPERM" || c === "EACCES";

  const w = input.escapes.map((p) => fsTry(() => writeFileSync(p, `escape ${input.tag}`)));
  t("write outside its task folder", w.every((c) => c !== "done"), { results: w });

  const s = [fsTry(() => readFileSync(input.secretFile)), fsTry(() => readdirSync(input.secretDir))];
  t("read the state's secrets", s.every(denied), { results: s });

  const o = [fsTry(() => readdirSync(input.otherTask)), fsTry(() => readFileSync(join(input.otherTask, "marker.txt")))];
  t("read another task's folder", o.every(denied), { results: o });

  const { host, port } = input.outside;
  const op = await viaProxy("GET", `http://${host}:${port}/`, { timeoutMs: 6000 });
  const od = await direct(host, port);
  // Through the proxy: its own refusal (403) or a refused connect; around it: the sandbox's EPERM. A connect that
  // waits (the address is TEST-NET, nothing answers there) left the Mac, so it was not refused.
  const proxyRefused = op.status === 403 || (op.error && op.error !== "timeout");
  t("connect to an outside address", Boolean(proxyRefused) && od !== "connected" && od !== "timeout", { proxy: op.status || op.error, direct: od });

  const local = async (name, port_, path, mark) => {
    const p = await viaProxy("GET", `http://127.0.0.1:${port_}${path}`, { timeoutMs: 6000 });
    const p2 = await viaProxy("GET", `http://localhost:${port_}${path}`, { timeoutMs: 6000 });
    const d = await direct("127.0.0.1", port_);
    const answered = (r) => r.status === 200 && mark.test(r.body || "");
    t(name, !answered(p) && !answered(p2) && d !== "connected", { proxy: p.status || p.error, proxyLocalhost: p2.status || p2.error, direct: d });
  };
  await local("connect to the board directly", input.ports.board, "/api/health", /"status":"ok"/);
  await local("connect to the home", input.ports.home, "/healthz", /"ok"\s*:\s*true|"part":"home"/);
  await local("connect to a door it is not on the list for", input.ports.generate, "/gen/health", /"part":"generate"/);
}

try {
  await work();
  if (input.role === "builder") await tries();
} catch (e) {
  out.crash = String(e && e.stack ? e.stack : e).slice(0, 2000);
}
process.stdout.write(`STRESS-RESULT ${json(out)}\n`);
