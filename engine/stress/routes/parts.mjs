// The parts' own routes (PLAN-STRESS T4): method, size and malformed-input checks only (load on them is T5's). Each
// part's routes are read from its own code: `ENGINE_ROUTES` in apps/host.mjs, `ROUTES` in web/door.mjs,
// generate/door.mjs and brain/door.mjs, `PATHS` in relay/relay.mjs, the viewer's `/view/shots`, and the gates'
// health and agent paths (gate/rules.mjs, gate/narrow.mjs). Calls carry no token, or a made-up one: every answer
// must be 4xx (health 200), never 5xx, never a hang, and the part must still be healthy afterwards.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HANG_MS, METHODS, hasStack, send, short } from "./common.mjs";

const MB = 1024 * 1024;

// Each part: { port key, health path, routes: [[method, path]], file }. Routes are read from source where the part
// keeps a table; the rest are named here.
export function partRoutes(engineDir) {
  const read = (rel) => { try { return readFileSync(join(engineDir, rel), "utf8"); } catch { return ""; } };
  const fromTable = (text, prefix) => {
    const out = [];
    const re = /method:\s*"(GET|POST)",\s*re:\s*(?:\/\^((?:\\\/|[^/])+)\$\/|new RegExp\(`\^([^`]+)\$`\))/g;
    let m;
    while ((m = re.exec(text))) {
      const path = (m[2] || m[3]).replace(/\\\//g, "/").replace(/\$\{JOB\}/g, "j0000000000000000").replace(/\(\[0-9\]\{1,2\}\)/g, "1");
      if (path.startsWith(prefix)) out.push([m[1], path]);
    }
    return out;
  };
  const relayPaths = (/const PATHS = new Set\(\[([^\]]+)\]\)/.exec(read("relay/relay.mjs")) || [, ""])[1].match(/"[^"]+"/g)?.map((s) => ["POST", s.slice(1, -1)]) || [];
  const brainPaths = (/const ROUTES = \{([^}]+)\}/.exec(read("brain/door.mjs")) || [, ""])[1].match(/"\/brain\/[a-z]+"/g)?.map((s) => ["POST", s.slice(1, -1)]) || [];
  return {
    gate: { port: "gate", health: "/gate/health", file: "engine/gate/gate.mjs", routes: [["GET", "/api/agents/me"], ["GET", "/api/companies"], ["POST", "/api/issues"]] },
    gateNarrow: { port: "gateNarrow", health: "/gate/health", file: "engine/gate/narrow.mjs", routes: [["GET", "/api/agents/me"], ["POST", "/api/issues"]] },
    relay: { port: "relay", health: "/relay/health", file: "engine/relay/relay.mjs", routes: relayPaths },
    web: { port: "web", health: "/web/health", file: "engine/web/door.mjs", routes: fromTable(read("web/door.mjs"), "/web/") },
    generate: { port: "generate", health: "/gen/health", file: "engine/generate/door.mjs", routes: fromTable(read("generate/door.mjs"), "/gen/") },
    viewer: { port: "viewer", health: "/view/health", file: "engine/viewer/viewer.mjs", routes: [["POST", "/view/shots"], ["POST", "/view/shots?pages=index.html"]] },
    brain: { port: "brain", health: "/brain/health", file: "engine/brain/door.mjs", routes: brainPaths },
    apps: { port: "apps", health: "/apps/health", file: "engine/apps/host.mjs", routes: [["GET", "/apps/nothing"]] },
  };
}

export async function partsSweep(env) {
  const { st, hit } = env;
  const table = partRoutes(st.engineDir);
  env.partsTable = Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.routes.map(([m, p]) => `${m} ${p}`)]));
  for (const [part, def] of Object.entries(table)) {
    if (env.onlyPart && env.onlyPart !== part) continue;
    const port = st.ports[def.port];
    const files = [def.file];
    const t = (what) => `part ${part} ${what}`;
    const bad = (res, what, check) => {
      if (res.hang) { env.issue("high", `${check}-hang`, t(what), { title: `${part}: ${what} gave no answer in 10 s`, expected: "an answer", actual: short(res), files }); return true; }
      if (res.status >= 500) { env.issue("high", `${check}-5xx`, t(what), { title: `${part}: ${what} answered ${res.status}`, expected: "never 5xx", actual: short(res), files }); return true; }
      if (res.status && hasStack(res.text)) { env.issue("high", `${check}-stack`, t(what), { title: `${part}: ${what} put a stack in its answer`, expected: "no stack", actual: short(res), files }); return true; }
      return false;
    };
    const health = await hit(port, "GET", def.health, { owner: false });
    env.check();
    if (health.status !== 200) env.issue("high", "part-health", t("health"), { title: `${part} is not healthy before its checks`, expected: "200", actual: short(health), files });
    // Every other method on the health path, and an unknown path.
    for (const m of METHODS.filter((x) => x !== "GET")) {
      const res = await hit(port, m, def.health, { owner: false, body: m === "HEAD" ? undefined : "{}", headers: { "content-type": "application/json" }, raw: true });
      env.check();
      if (bad(res, `${m} ${def.health}`, "part-method")) continue;
      if (res.status >= 200 && res.status < 300 && m !== "HEAD") env.issue("medium", "part-method-accepted", t(`${m} ${def.health}`), { title: `${part}: ${m} ${def.health} answered ${res.status}`, expected: "4xx", actual: short(res), files });
    }
    const unknown = await hit(port, "GET", `/${part}-nothing-here/../../etc/passwd`, { owner: false });
    env.check();
    if (!bad(unknown, "an unknown path", "part-unknown") && unknown.status >= 200 && unknown.status < 300) {
      env.issue("medium", "part-unknown-accepted", t("unknown path"), { title: `${part} answered ${unknown.status} to an unknown path`, expected: "404", actual: short(unknown), files });
    }
    for (const [method, path] of def.routes) {
      for (const auth of [null, "Bearer stress-made-up-token"]) {
        const headers = { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) };
        // The right method with no token (or a made-up one), then every other method.
        for (const m of METHODS) {
          const res = await hit(port, m, path, { owner: false, headers, body: m === "GET" || m === "HEAD" ? undefined : "{}", raw: true });
          env.check();
          if (bad(res, `${m} ${path}${auth ? " (made-up token)" : ""}`, "part-call")) continue;
          if (res.status >= 200 && res.status < 300 && m !== "HEAD") {
            env.issue(m === method ? "high" : "medium", "part-call-accepted", t(`${m} ${path}${auth ? " token" : ""}`), { title: `${part}: ${m} ${path} answered ${res.status} with ${auth ? "a made-up token" : "no token"}`, expected: "4xx", actual: short(res), files });
          }
        }
        if (method !== "POST") continue;
        for (const [what, text] of [["no body", ""], ["[]", "[]"], ["null", "null"], ["a string", '"words"'], ["invalid JSON", '{"oops'], ["__proto__", '{"__proto__":{"x":1}}'], ["a NUL byte", '{"q":"a\\u0000b"}']]) {
          const res = await hit(port, "POST", path, { owner: false, headers, body: text, raw: true });
          env.check();
          if (bad(res, `POST ${path} ${what}`, "part-body")) continue;
          if (res.status >= 200 && res.status < 300) env.issue("medium", "part-body-accepted", t(`POST ${path} ${what}${auth ? " token" : ""}`), { title: `${part}: POST ${path} took ${what} (${res.status})`, expected: "4xx", actual: short(res), files });
        }
        // 17 MB, declared and chunked: refused, never a hang.
        for (const length of [true, false]) {
          const res = await send(`http://127.0.0.1:${port}${path}`, { method: "POST", headers, total: 17 * MB, size: 256 * 1024, length, timeoutMs: 30000 });
          env.calls(1);
          env.check();
          const what = `POST ${path} 17 MB ${length ? "with length" : "chunked"}${auth ? " token" : ""}`;
          if (res.error && res.error.hang) env.issue("high", "part-size-hang", t(what), { title: `${part}: ${what} hung`, expected: "refused within seconds", actual: res.error.message, files });
          else if (res.status >= 500) env.issue("high", "part-size-5xx", t(what), { title: `${part}: ${what} answered ${res.status}`, expected: "4xx", actual: res.text.slice(0, 200), files });
          else if (res.status >= 200 && res.status < 300) env.issue("high", "part-size-taken", t(what), { title: `${part}: ${what} was taken`, expected: "4xx or the connection closed", actual: `${res.status} ${res.text.slice(0, 200)}`, files });
        }
      }
    }
    const after = await hit(port, "GET", def.health, { owner: false, timeoutMs: HANG_MS });
    env.check();
    if (after.status !== 200) {
      env.issue("high", "part-after", t("after"), { title: `${part} is not healthy after its route checks`, expected: "200 on its health", actual: short(after), files });
      await st.restart(part === "gateNarrow" ? "gate" : part).catch(() => {});
    }
  }
}
