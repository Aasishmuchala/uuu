// The one HTTP client every sweep uses to reach a staged part (PLAN-STRESS, pinned interfaces). It throws before a
// byte is sent when the address is not loopback or names a live port, so no sweep can reach the live engine by a
// typo. Built-in modules only; no bare fetch to a part anywhere in the harness.
import http from "node:http";

// The live ports, as netguard.mjs refuses them (kept here too so the harness itself is never patched by the guard).
export function forbiddenPort(port) {
  const p = Number(port);
  return (p >= 3100 && p <= 3299) || p === 5000 || p === 5432 || p === 7000 || p === 8120;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// -> URL, or throws "stage: <why>; not sent".
export function checkUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`stage: ${url} is not an address; not sent`);
  }
  if (u.protocol !== "http:") throw new Error(`stage: ${u.protocol} is not allowed; not sent`);
  if (!LOOPBACK_HOSTS.has(u.hostname)) throw new Error(`stage: ${u.hostname} is not this Mac; not sent`);
  const port = Number(u.port || 80);
  if (forbiddenPort(port)) throw new Error(`stage: port ${port} is a live port; not sent`);
  return u;
}

// call(url, { method, headers, body, timeoutMs }) -> { status, headers, text, json, ms }
//   body: a string, a Buffer or an object (sent as JSON). timeoutMs (default 15000): the whole call; past it the call
//   rejects with code "ETIMEDOUT" and `hang: true`. A part that cuts the answer rejects with the socket's error.
export function call(url, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  const u = checkUrl(url);
  let payload = null;
  if (body !== undefined && body !== null) {
    payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  }
  const h = { ...headers };
  if (payload && !Object.keys(h).some((k) => k.toLowerCase() === "content-length")) h["content-length"] = String(payload.length);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = http.request({
      host: u.hostname.replace(/^\[|\]$/g, ""), port: Number(u.port || 80), method, path: `${u.pathname}${u.search}`, headers: h, agent: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        finish(resolve, { status: res.statusCode, headers: res.headers, text, json, ms: Date.now() - started });
      });
      res.on("error", (e) => finish(reject, e));
      res.on("aborted", () => finish(reject, Object.assign(new Error("the answer was cut off"), { code: "ECONNRESET" })));
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish(reject, Object.assign(new Error(`no answer in ${timeoutMs} ms`), { code: "ETIMEDOUT", hang: true }));
    }, timeoutMs);
    req.on("error", (e) => finish(reject, e));
    if (payload) req.write(payload);
    req.end();
  });
}

// The home server's same-origin rule for anything that changes state (engine/home/server/lib/app.mjs sameOrigin):
// a JSON body, `x-engine: 1`, and the home's own Host.
export function ownerHeaders(port) {
  return { "content-type": "application/json", "x-engine": "1", host: `127.0.0.1:${port}` };
}

// ownerPost(stage, path, body, { method, timeoutMs }) -> call()'s answer, as the owner's browser would send it.
export function ownerPost(stage, path, body = {}, { method = "POST", timeoutMs } = {}) {
  const port = stage.ports.home;
  return call(`http://127.0.0.1:${port}${path}`, { method, headers: ownerHeaders(port), body: body === undefined ? "" : body, timeoutMs });
}

// GET <url> and the parsed JSON or null; never throws.
export async function getJson(url, opts) {
  try {
    const r = await call(url, opts);
    return r;
  } catch (e) {
    return { status: 0, error: e, json: undefined, text: "" };
  }
}
