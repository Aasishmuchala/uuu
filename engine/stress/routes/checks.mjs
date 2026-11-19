// The per-route checks of the route sweep (PLAN-STRESS T4 (a) to (f)) on the staged home:
//   (a) the right call answers under 10 s and not 5xx
//   (b) every other method is 405 (404 counts as a miss of the target, kept for one finding on the router), never 5xx
//   (c) POST and DELETE: malformed bodies and each field of a valid body swapped in turn: 4xx with the error shape
//   (d) a body one byte over the limit (declared, then chunked) is 413 with the answer received; a 64 MB stream is cut
//       off and the home answers the next call
//   (e) a POST without the same-origin headers is refused and the state did not change
//   (f) hostile `:name` values: 4xx, never 5xx, never the canary planted beside the state folder
import { OVERRIDES, SKIP, fits } from "./bodies.mjs";
import { HANG_MS, changed, digest, homeErrorShape, send, short } from "./common.mjs";
import { fill, paramCount } from "./table.mjs";

const SENT = "__stress_field__";
// Fields that name a file, a folder, a record or a key: a path or a NUL in them is refused, not kept.
const NAMING = /name|folder|path|file|token|^id$|slug|ref|key|font/i;
const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
// The home's default body limit (engine/home/server/lib/app.mjs MAX_BODY) for a route that names none.
export const MAX_ROUTE_BODY_DEFAULT = 2 * 1024 * 1024;

// The methods the home has a route for at this concrete path (any pattern that fits it, as the router matches).
export function METHODS_FOR(routes, path) {
  return new Set(routes.filter((r) => fits(r.pattern, path)).map((r) => r.method));
}
const MB = 1024 * 1024;

export const keyOf = (r) => `${r.method} ${r.pattern}`;
const fileOf = (r) => [`engine/home/server/${r.file}`];

// The usual answer checks: hang, 5xx, a stack, the canary. -> true when the answer was a plain one.
export function judge(env, r, res, check, target, what) {
  const { issue } = env;
  if (res.canary) {
    issue("critical", "canary", target, { title: `${target} answered with the canary file planted beside the state folder`, expected: "never a file outside the stage's state", actual: `${what}: ${short(res)}`, files: fileOf(r) });
  }
  if (res.hang) {
    issue("high", `${check}-hang`, target, { title: `${target} gave no answer in 10 s (${what})`, expected: "an answer under 10 s", actual: short(res), files: fileOf(r) });
    return false;
  }
  if (res.error) {
    issue("high", `${check}-cut`, target, { title: `${target} closed the connection without an answer (${what})`, expected: "an answer", actual: short(res), files: fileOf(r) });
    return false;
  }
  if (res.status >= 500) {
    // A 502/503/504 in the home's error shape is the home saying a part or provider behind it failed (on the stage,
    // Omega Plus is out of reach and the sign-in fakes do not start a sign-in): one medium finding per route. Any
    // other 5xx is the home itself failing.
    const upstream = [502, 503, 504].includes(res.status) && homeErrorShape(res.json) && res.json.error.code !== "internal";
    if (upstream) {
      issue("medium", "upstream-5xx", target, { title: `${target} answered ${res.status} ${res.json.error.code} when what is behind it failed (${what})`, expected: "never 5xx (a 4xx or a 200 that says the part is down)", actual: short(res), files: fileOf(r) });
    } else {
      issue("high", `${check}-5xx`, target, { title: `${target} answered ${res.status} (${what})`, expected: "never 5xx", actual: short(res), files: fileOf(r) });
    }
    return false;
  }
  if (res.stack) {
    issue("high", `${check}-stack`, target, { title: `${target} put a stack in its answer (${what})`, expected: "no stack in any answer", actual: short(res), files: fileOf(r) });
    return false;
  }
  return true;
}

// (a): the right call. Keeps the body that worked (or the first) in env.valid for (c), (e) and the load.
export async function rightCall(env, r) {
  const { hit, port, bodies, ids } = env;
  const key = keyOf(r);
  const path = fill(r.pattern, ids);
  env.paths.set(key, path);
  if (SKIP[key]) {
    env.log(`(a) ${key}: not called (${SKIP[key]})`);
    env.skipped.push({ route: key, why: SKIP[key] });
    return;
  }
  if (r.method === "GET") {
    const res = await hit(port, "GET", path, { route: key, timeoutMs: HANG_MS });
    env.check();
    judge(env, r, res, "a-right-call", key, `GET ${path}`);
    return;
  }
  const cands = (bodies[key] && bodies[key].length ? bodies[key] : [r.method === "DELETE" ? null : {}]).slice(0, 4);
  let chosen = cands[0];
  for (const b of cands) {
    const res = await hit(port, r.method, path, { body: b === null ? "" : b, route: key, timeoutMs: HANG_MS });
    env.check();
    if (!judge(env, r, res, "a-right-call", key, `${r.method} ${path} ${JSON.stringify(b)}`.slice(0, 300))) break;
    if (res.status >= 200 && res.status < 300) { chosen = b; env.worked.add(key); break; }
  }
  env.valid.set(key, chosen);
}

// (b): every other method.
export async function methods(env, r, shapes) {
  const { hit, port } = env;
  const key = keyOf(r);
  const path = env.paths.get(key) || fill(r.pattern, env.ids);
  const taken = METHODS_FOR(shapes, path);
  for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    if (taken.has(m)) continue;
    if (m !== "GET" && m !== "HEAD" && SKIP[`POST ${r.pattern}`]) continue; // never a same-origin POST to a skipped route
    // A wrong method with the owner's headers, so the answer is the router's, not the same-origin refusal.
    const res = await hit(port, m, path, { body: m === "GET" || m === "HEAD" ? undefined : "{}", owner: true });
    env.check();
    if (!judge(env, r, res, "b-method", `${m} ${r.pattern}`, `${m} ${path}`)) continue;
    if (m === "HEAD" && taken.has("GET") && res.status === 200) continue;
    if (res.status === 405) continue;
    if (res.status === 404) env.no405.push(`${m} ${r.pattern}`);
    else if (res.status >= 200 && res.status < 300) {
      env.issue("high", "b-method-accepted", `${m} ${r.pattern}`, { title: `${m} ${r.pattern} was answered ${res.status} though the route takes only ${[...taken].join(", ")}`, expected: "405", actual: short(res), files: fileOf(r) });
    } else env.no405.push(`${m} ${r.pattern} (${res.status})`);
  }
}

// The bodies of (c): [{ what, text, invalidJson }].
export function malformed(r, valid) {
  const key = keyOf(r);
  const out = [
    { what: "no body", text: "" },
    { what: "{}", text: "{}" },
    { what: "[]", text: "[]" },
    { what: "null", text: "null" },
    { what: "a string", text: '"just some words"' },
    { what: "invalid JSON", text: '{"oops', invalidJson: true },
    { what: "__proto__ at the top", text: '{"__proto__":{"x":1}}' },
  ];
  if (!valid || typeof valid !== "object" || Array.isArray(valid)) return out;
  const swaps = OVERRIDES[key]?.fieldsOnly
    ? OVERRIDES[key].fieldsOnly.map((v) => ({ what: JSON.stringify(v), raw: JSON.stringify(v) }))
    : [
      { what: "null", raw: "null" },
      { what: "a number", raw: "12345" },
      { what: '""', raw: '""' },
      { what: "a 1 MB string", raw: JSON.stringify("x".repeat(MB)), big: true },
      { what: "an array", raw: "[1,2,3]" },
      { what: '{"__proto__":{"x":1}}', raw: '{"__proto__":{"x":1}}' },
      { what: "../../etc/passwd", raw: '"../../etc/passwd"', pathy: true },
      { what: "a NUL byte", raw: '"a\\u0000b"', pathy: true },
    ];
  for (const field of Object.keys(valid)) {
    for (const s of swaps) {
      const text = JSON.stringify({ ...valid, [field]: SENT }).replace(`"${SENT}"`, s.raw);
      out.push({ what: `${field} = ${s.what}`, text, big: !!s.big, field, same: s.raw !== "null" && typeOf(JSON.parse(s.raw)) === typeOf(valid[field]), pathy: !!s.pathy });
    }
  }
  return out;
}

// (c): malformed bodies.
export async function bodies(env, r) {
  const { hit, port } = env;
  const key = keyOf(r);
  if (r.method === "GET" || SKIP[key]) return;
  const path = env.paths.get(key) || fill(r.pattern, env.ids);
  const valid = env.valid.get(key);
  const validText = valid === null || valid === undefined ? "" : JSON.stringify(valid);
  const noShape = [];
  const accepted = [];
  for (const v of malformed(r, valid)) {
    if (v.text === validText) continue;
    const res = await hit(port, r.method, path, { body: v.text, raw: true, timeoutMs: v.big ? 20000 : HANG_MS });
    env.check();
    if (!judge(env, r, res, "c-body", key, `${v.what}`)) continue;
    if (res.status >= 400 && res.status < 500) {
      if (!homeErrorShape(res.json)) noShape.push(`${v.what}: ${short(res)}`);
      continue;
    }
    if (v.invalidJson) {
      env.issue("medium", "c-invalid-json", key, { title: `${key} took a body that is not JSON (${res.status})`, expected: "400 bad_json", actual: short(res), files: fileOf(r) });
      continue;
    }
    // An empty or `{}` body is the right one for a route whose valid body has no fields.
    // Not a miss: a route whose valid body has no fields ignores its body; a value of the field's own kind (a number
    // for a number, text for text) unless it is a path or a NUL in a field that names something.
    const noFields = !valid || (typeof valid === "object" && !Object.keys(valid).length);
    const fine = (!v.field && noFields) || (v.field && !v.big && v.same && !(v.pathy && NAMING.test(v.field)));
    if (!fine) accepted.push({ what: v.what, status: res.status, big: !!v.big });
  }
  if (noShape.length) {
    env.issue("medium", "c-error-shape", key, { title: `${key} answered ${noShape.length} malformed bodies without the home's error shape`, expected: "{ error: { message, next, code } }", actual: noShape.slice(0, 5).join(" | "), files: [...fileOf(r), "engine/home/server/lib/errors.mjs"] });
  }
  const big = accepted.filter((a) => a.big);
  if (big.length) {
    env.issue("medium", "c-big-field", key, { title: `${key} kept a 1 MB string in a field (${big.map((a) => a.what).join(", ")})`, expected: "4xx: a field has a size limit", actual: big.map((a) => `${a.what} -> ${a.status}`).join(" | "), files: fileOf(r) });
  }
  const small = accepted.filter((a) => !a.big);
  if (small.length) {
    env.issue("low", "c-accepted", key, { title: `${key} took ${small.length} malformed bodies with a 2xx`, expected: "4xx for each", actual: small.slice(0, 12).map((a) => `${a.what} -> ${a.status}`).join(" | "), files: fileOf(r) });
  }
}

// (d): sizes.
export async function sizes(env, r) {
  const key = keyOf(r);
  if (r.method === "GET" || SKIP[key]) return;
  const { port, st } = env;
  const path = env.paths.get(key) || fill(r.pattern, env.ids);
  const url = `http://127.0.0.1:${port}${path}`;
  const headers = { "content-type": "application/json", "x-engine": "1", host: `127.0.0.1:${port}` };
  const limit = r.maxBody ?? MAX_ROUTE_BODY_DEFAULT;
  const tries = [
    { what: `${limit + 1} bytes with content-length`, length: true, total: limit + 1 },
    { what: `${limit + 1} bytes chunked, no length`, length: false, total: limit + 1 },
  ];
  for (const t of tries) {
    const res = await send(url, { method: r.method, headers, total: t.total, length: t.length, timeoutMs: 30000 });
    env.calls(1);
    env.check();
    if (res.error && res.error.hang) {
      env.issue("high", "d-oversize-hang", key, { title: `${key} hung on a body one byte over its limit (${t.what})`, expected: "413 within seconds", actual: res.error.message, files: fileOf(r) });
      continue;
    }
    if (res.status >= 500) env.issue("high", "d-oversize-5xx", key, { title: `${key} answered ${res.status} to an oversize body`, expected: "413", actual: `${res.status} ${res.text.slice(0, 200)}`, files: fileOf(r) });
    else if (!res.received) {
      env.issue("medium", "d-oversize-lost", `${key} ${t.length ? "length" : "chunked"}`, { title: `${key}: the client never saw the answer to an oversize body (${t.what})`, expected: "413 received before the connection closed", actual: String(res.error && res.error.message), files: [...fileOf(r), "engine/home/server/lib/app.mjs"] });
    } else if (res.status !== 413) {
      env.issue("medium", "d-oversize-status", `${key} ${t.length ? "length" : "chunked"}`, { title: `${key} answered ${res.status} to a body one byte over its limit (${t.what})`, expected: "413", actual: `${res.status} ${res.text.slice(0, 200)}`, files: fileOf(r) });
    } else if (!homeErrorShape(res.json)) {
      env.issue("medium", "c-error-shape", `${key} 413`, { title: `${key}: its 413 is not in the home's error shape`, expected: "{ error: { message, next, code } }", actual: res.text.slice(0, 200), files: fileOf(r) });
    }
  }
  // 64 MB, chunked: cut off, and the home still answers.
  const res = await send(url, { method: r.method, headers, total: 64 * MB, size: 256 * 1024, length: false, timeoutMs: 60000 });
  env.calls(1);
  env.check();
  if (res.error && res.error.hang) {
    env.issue("high", "d-stream-hang", key, { title: `${key} neither cut off nor answered a 64 MB stream in 60 s`, expected: "cut off or 413", actual: `${res.sent} bytes sent`, files: fileOf(r) });
  } else if (res.status >= 200 && res.status < 300) {
    env.issue("high", "d-stream-taken", key, { title: `${key} took a 64 MB body`, expected: "413 or the connection closed", actual: `${res.status} after ${res.sent} bytes`, files: fileOf(r) });
  }
  const after = await env.hit(port, "GET", "/healthz", { timeoutMs: 5000 });
  env.check();
  if (after.status !== 200) {
    env.issue("high", "d-stream-after", key, { title: `the home did not answer after a 64 MB stream to ${key}`, expected: "200 on /healthz", actual: short(after), files: ["engine/home/server/lib/app.mjs"] });
    await st.restart("home").catch(() => {});
  }
}

// (e): same-origin refusals, and the state did not change. `volatile` holds files that change on their own.
export async function origin(env, r, volatile) {
  const key = keyOf(r);
  if (r.method === "GET" || SKIP[key]) return;
  const { hit, port, st } = env;
  const path = env.paths.get(key) || fill(r.pattern, env.ids);
  const valid = env.valid.get(key);
  const body = valid === null || valid === undefined ? "{}" : JSON.stringify(valid);
  const own = `127.0.0.1:${port}`;
  const tries = [
    { what: "no x-engine", headers: { "content-type": "application/json", host: own } },
    { what: "content-type text/plain", headers: { "content-type": "text/plain", "x-engine": "1", host: own } },
    { what: "Origin http://evil.test", headers: { "content-type": "application/json", "x-engine": "1", host: own, origin: "http://evil.test" } },
    { what: "Host evil.test", headers: { "content-type": "application/json", "x-engine": "1", host: "evil.test" } },
  ];
  const before = digest(st.state);
  for (const t of tries) {
    const res = await hit(port, r.method, path, { headers: t.headers, body, raw: true, owner: false });
    env.check();
    if (!judge(env, r, res, "e-origin", key, t.what)) continue;
    const want = t.what.startsWith("Host") ? [421, 403] : [403];
    if (res.status >= 200 && res.status < 300) {
      env.issue("critical", "e-origin-accepted", `${key} ${t.what}`, { title: `${key} did what it was asked with ${t.what}`, expected: `${want.join(" or ")}, nothing changed`, actual: short(res), files: ["engine/home/server/lib/app.mjs", ...fileOf(r)] });
    } else if (!want.includes(res.status)) {
      env.issue("medium", "e-origin-status", `${key} ${t.what}`, { title: `${key} refused ${t.what} with ${res.status}`, expected: want.join(" or "), actual: short(res), files: ["engine/home/server/lib/app.mjs"] });
    }
  }
  const moved = changed(before, digest(st.state), volatile);
  if (moved.length) {
    env.issue("critical", "e-origin-state", key, { title: `the state changed while ${key} was refused`, expected: "no file changed", actual: moved.slice(0, 10).join(", "), files: ["engine/home/server/lib/app.mjs", ...fileOf(r)] });
  }
}

// (f): hostile `:name` values, and tokens that point at the canary.
export async function names(env, r) {
  const key = keyOf(r);
  if (!paramCount(r.pattern) || SKIP[key]) return;
  const { hit, port } = env;
  const valid = env.valid.get(key);
  const body = r.method === "GET" ? undefined : valid === null || valid === undefined ? "" : valid;
  const segs = r.pattern.split("/");
  const good = (env.paths.get(key) || fill(r.pattern, env.ids)).split("/");
  const values = ["..", "%2e%2e", "%00", "a".repeat(5000), "%3Cscript%3E"];
  const tokens = [];
  if (/\/:token$/.test(r.pattern)) {
    for (let up = 1; up <= 6; up += 1) tokens.push(Buffer.from(`${"../".repeat(up)}${env.canaryName}`).toString("base64url"));
    tokens.push(Buffer.from(env.canaryPath).toString("base64url"));
  }
  const accepted = [];
  for (let i = 0; i < segs.length; i += 1) {
    if (!segs[i].startsWith(":")) continue;
    const list = i === segs.length - 1 ? [...values, ...tokens] : values;
    for (const v of list) {
      const p = good.map((s, j) => (j === i ? v : s)).join("/");
      const res = await hit(port, r.method, p, { body, raw: false });
      env.check();
      if (!judge(env, r, res, "f-name", key, `${segs[i]} = ${v.slice(0, 40)}`)) continue;
      if (res.status >= 200 && res.status < 300) accepted.push(`${segs[i]} = ${v.length > 40 ? `${v.slice(0, 10)}..(${v.length})` : v} -> ${res.status}`);
    }
  }
  if (accepted.length) {
    env.issue("low", "f-name-accepted", key, { title: `${key} answered 2xx to ${accepted.length} hostile ids`, expected: "4xx", actual: accepted.slice(0, 10).join(" | "), files: fileOf(r) });
  }
}
