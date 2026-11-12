// The home server's one outside client (CONTRACTS-V4 C8): GET only, three paths, the pinned origin of
// C1 (engine/relay/upstream.mjs), no redirect followed, 10 seconds, 1 MB. The provider key goes only in
// `x-api-key`; it is never logged and never put in an error. Nothing else in the home server calls out.
import http from "node:http";
import https from "node:https";
import { PROVIDER_ORIGIN, checkOrigin } from "../../../relay/upstream.mjs";

export const PROVIDER_PATHS = new Set(["/v1/models", "/v1/usage", "/v1/billing"]);
const TIMEOUT_MS = 10000;
const MAX_BYTES = 1024 * 1024;

// The origin the home server may call: `urls.provider` when the key exists (null means "never call
// out"; stub homes set it), else the provider's own origin.
export function providerOrigin(urls) {
  return urls && Object.hasOwn(urls, "provider") ? urls.provider : PROVIDER_ORIGIN;
}

const unreachable = (why) => Object.assign(new Error(`the provider could not be read (${why})`), { unreachable: true });

// -> { status, json } (json is undefined when the answer is not JSON). Throws { unreachable: true }
// when nothing answers, the call times out, the answer is too large, or the origin may not be called.
export function providerGet(origin, path, { key = null, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (origin === null || origin === undefined) return reject(unreachable("no outside calls here"));
    if (!PROVIDER_PATHS.has(path)) return reject(unreachable("not one of the provider's paths"));
    let up;
    try {
      up = checkOrigin(origin);
    } catch {
      return reject(unreachable("not the provider's address"));
    }
    const headers = { host: up.port === 443 && up.protocol === "https:" ? up.hostname : `${up.hostname}:${up.port}`, accept: "application/json" };
    if (key !== null) headers["x-api-key"] = key;
    const mod = up.protocol === "https:" ? https : http;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    // agent: false: a fresh connection that honours no proxy variable; redirects are never followed by node.
    const req = mod.request({
      host: up.hostname, port: up.port, servername: up.protocol === "https:" ? up.hostname : undefined,
      method: "GET", path, headers, agent: false, setHost: false,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); finish(reject, unreachable("the answer is too large")); return; }
        chunks.push(c);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        finish(resolve, { status: res.statusCode, json });
      });
      res.on("error", () => finish(reject, unreachable("the connection was lost")));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, unreachable("no answer in time")); }, timeoutMs);
    req.on("error", () => finish(reject, unreachable("no connection")));
    req.end();
  });
}
