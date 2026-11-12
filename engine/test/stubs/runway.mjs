// A stand-in Runway for the generation door's tests (PLAN-V5 T30), shaped as
// `.router/V5-RUNWAY.md` says. Nothing leaves 127.0.0.1.
//
//   const rw = await startRunway({ key, behaviour: { steps: ["PENDING", "RUNNING", "SUCCEEDED"] } });
//   createGenerateDoor({ upstream: rw.url, net: rw.net, ... })
//
// Two servers: the API (rw.url, http://127.0.0.1:<port>) and "another host" for outputs
// (rw.outputsUrl). Output addresses are https://outputs.runway.test/... ; `rw.net` resolves
// that name to a public-looking address and lands it on the outputs server, so the door's
// real address checks run unchanged. `private.runway.test` resolves to 10.0.0.5.
// `behaviour` is read on every request, so a test may change it between calls:
//   create    "ok" (default) | 400 | 401 | 404 | 429 | 500 | 502 | "keyText" (400 quoting the
//             key) | "garbage" (200, not JSON) | "badId" (200, an id that is not one) | "stall"
//   estimate  estimatedCost.credits on the create answer and the task (omitted when undefined)
//   steps     statuses a task goes through, one per poll (the last repeats); "never" = RUNNING
//   failureCode, failure   on a FAILED task
//   cost      cost.credits on a finished task (omitted when undefined; any value is sent as is)
//   output    "mp4" (default) | "png" | "ip" | "private" | "redirect" | "huge" | "hugeStream"
//             | "html" | "keyed" (the address carries the key) | "http"
//   poll      "ok" (default) | 500 | 404 | "garbage" | "huge" (an endless answer)
//   organization   the answer to GET /v1/organization
//   onCreate(info) called when a create call arrives, before it is answered
// `seen.api` holds every API request (method, path, rawHeaders, body); `seen.outputs` every
// request to the outputs host; `seen.lookups` and `seen.connects` what `net` was asked.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { connect as tcpConnect } from "node:net";

export const OUTPUT_HOST = "outputs.runway.test";
export const PRIVATE_HOST = "private.runway.test";
const OUTPUT_ADDRESS = "13.32.0.10";
const PRIVATE_ADDRESS = "10.0.0.5";
const MB = 1024 * 1024;

export function mp4Bytes(size = 4096) {
  const b = Buffer.alloc(size, 0);
  b.writeUInt32BE(32, 0);
  b.write("ftypisom", 4, "latin1");
  return b;
}
export function pngBytes(width = 64, height = 64, size = 2048) {
  const b = Buffer.alloc(size, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

function readAll(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(""));
  });
}

function stream(res, bytes, type, declare) {
  res.writeHead(200, { "Content-Type": type, ...(declare ? { "Content-Length": bytes } : {}) });
  const chunk = mp4Bytes(64 * 1024);
  let left = bytes;
  const pump = () => {
    while (left > 0) {
      const n = Math.min(left, chunk.length);
      left -= n;
      if (!res.write(n === chunk.length ? chunk : chunk.subarray(0, n))) return void res.once("drain", pump);
    }
    res.end();
  };
  res.on("error", () => {});
  pump();
}

export async function startRunway({ behaviour = {}, key } = {}) {
  const seen = { api: [], outputs: [], lookups: [], connects: [] };
  const tasks = new Map();
  const b = behaviour;
  const sockets = new Set();
  let outputsPort = 0;

  const outputUrl = (task, ext) => {
    const kind = b.output || (ext === "png" ? "png" : "mp4");
    if (kind === "ip") return `https://${OUTPUT_ADDRESS}/out/${task}.mp4`;
    if (kind === "private") return `https://${PRIVATE_HOST}/out/${task}.mp4`;
    if (kind === "keyed") return `https://${OUTPUT_HOST}/out/${task}.mp4?k=${key}`;
    if (kind === "http") return `http://${OUTPUT_HOST}/out/${task}.mp4`;
    if (kind === "redirect" || kind === "huge" || kind === "hugeStream" || kind === "html") return `https://${OUTPUT_HOST}/${kind}/${task}`;
    return `https://${OUTPUT_HOST}/out/${task}.${kind === "png" ? "png" : "mp4"}?_jwt=signed`;
  };

  function taskAnswer(t) {
    const steps = b.steps === "never" ? ["RUNNING"] : Array.isArray(b.steps) ? b.steps : ["PENDING", "THROTTLED", "RUNNING", "SUCCEEDED"];
    const status = t.cancelled ? "CANCELLED" : steps[Math.min(t.polls, steps.length - 1)];
    t.polls += 1;
    const out = { id: t.id, status, createdAt: t.createdAt };
    if (b.estimate !== undefined) out.estimatedCost = { credits: b.estimate };
    if (status === "RUNNING") out.progress = 0.4;
    if (status === "SUCCEEDED") out.output = [outputUrl(t.id, t.ext)];
    if (status === "FAILED") {
      out.failure = b.failure === undefined ? "The provided image was flagged by content moderation." : b.failure;
      out.failureCode = b.failureCode === undefined ? "SAFETY.INPUT.IMAGE" : b.failureCode;
    }
    if ((status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED") && b.cost !== undefined) out.cost = { credits: b.cost };
    return out;
  }

  const api = http.createServer(async (req, res) => {
    const text = await readAll(req);
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    seen.api.push({ method: req.method, path: req.url, rawHeaders: [...req.rawHeaders], body });
    const auth = req.headers.authorization;
    if (key !== undefined && auth !== `Bearer ${key}`) return send(res, 401, { error: "The provided API key is not valid." });
    if (req.headers["x-runway-version"] !== "2024-11-06") return send(res, 400, { error: "Missing or wrong X-Runway-Version." });

    if (req.method === "GET" && req.url === "/v1/organization") {
      return send(res, 200, b.organization || { creditBalance: 1000, tier: { maxMonthlyCreditSpend: 100000, models: {} }, usage: { models: {} } });
    }
    const tm = /^\/v1\/tasks\/([^/]+)$/.exec(req.url);
    if (tm) {
      const t = tasks.get(tm[1]);
      if (req.method === "DELETE") {
        if (!t || t.deleted) return send(res, 404, { error: "The task does not exist, or was deleted or canceled." });
        t.cancelled = true;
        t.deleted = true;
        res.writeHead(204);
        return res.end();
      }
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed." });
      if (!t || (t.deleted && !t.cancelled)) return send(res, 404, { error: "The task does not exist, or was deleted or canceled." });
      const poll = b.poll || "ok";
      if (poll === 500) return send(res, 500, { error: "Internal" });
      if (poll === 404) return send(res, 404, { error: "The task does not exist, or was deleted or canceled." });
      if (poll === "garbage") return send(res, 200, "<html>not json</html>");
      if (poll === "huge") return stream(res, 64 * MB, "application/json", false);
      return send(res, 200, taskAnswer(t));
    }
    const paths = { "/v1/image_to_video": "mp4", "/v1/text_to_video": "mp4", "/v1/text_to_image": "png", "/v1/image_upscale": "png" };
    if (req.method !== "POST" || !paths[req.url]) return send(res, 404, { error: "Not found." });
    if (typeof b.onCreate === "function") {
      try { b.onCreate({ path: req.url, body }); } catch { /* the test's own check */ }
    }
    const c = b.create === undefined ? "ok" : b.create;
    if (c === "stall") return undefined;
    if (c === 400) {
      return send(res, 400, { error: "Validation of body failed", docUrl: "https://docs.dev.runwayml.com/api",
        issues: [{ code: "custom", path: ["promptImage"], message: "Assets must use an approved Content-Type response header." }] });
    }
    if (c === "keyText") return send(res, 400, { error: `Your key ${key} is not allowed for this model`, issues: [] });
    if (c === 401) return send(res, 401, { error: "The provided API key is not valid." });
    if (c === 404) return send(res, 404, { error: "Not found." });
    if (c === 429) return send(res, 429, { error: "You have exceeded your daily limit." }, b.retryAfter ? { "Retry-After": String(b.retryAfter) } : {});
    if (c === 500 || c === 502) return send(res, c, { error: "Busy." });
    if (c === "garbage") return send(res, 200, "<html>hello</html>");
    if (c === "badId") return send(res, 200, { id: "../../etc/passwd" });
    const id = randomUUID();
    tasks.set(id, { id, polls: 0, ext: paths[req.url], createdAt: new Date().toISOString(), cancelled: false, deleted: false });
    const out = { id };
    if (b.estimate !== undefined) out.estimatedCost = { credits: b.estimate };
    return send(res, 200, out);
  });

  const outputs = http.createServer((req, res) => {
    seen.outputs.push({ method: req.method, url: req.url, rawHeaders: [...req.rawHeaders] });
    req.resume();
    if (req.url.startsWith("/redirect/")) {
      res.writeHead(302, { Location: `https://${OUTPUT_HOST}/out/x.mp4`, "Content-Length": 0 });
      return res.end();
    }
    if (req.url.startsWith("/huge/")) return stream(res, 300 * MB, "video/mp4", true);
    if (req.url.startsWith("/hugeStream/")) return stream(res, 3 * MB, "video/mp4", false);
    if (req.url.startsWith("/html/")) {
      const page = Buffer.from(`<html><body>${"x".repeat(200)}</body></html>`);
      res.writeHead(200, { "Content-Type": "text/html", "Content-Length": page.length });
      return res.end(page);
    }
    const png = /\.png(\?|$)/.test(req.url);
    const bytes = png ? pngBytes() : mp4Bytes();
    res.writeHead(200, { "Content-Type": png ? "image/png" : "video/mp4", "Content-Length": bytes.length });
    return res.end(bytes);
  });

  for (const s of [api, outputs]) {
    s.on("connection", (sock) => { sockets.add(sock); sock.on("close", () => sockets.delete(sock)); });
    await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  }
  outputsPort = outputs.address().port;

  const net = {
    async resolve(host) {
      seen.lookups.push(host);
      if (host === OUTPUT_HOST) return [{ address: OUTPUT_ADDRESS, family: 4 }];
      if (host === PRIVATE_HOST) return [{ address: PRIVATE_ADDRESS, family: 4 }];
      const err = new Error("not found");
      err.code = "ENOTFOUND";
      throw err;
    },
    connect({ address, port, hostname, secure }) {
      seen.connects.push({ address, port, hostname, secure });
      const ours = address === OUTPUT_ADDRESS || address === PRIVATE_ADDRESS;
      return tcpConnect({ host: "127.0.0.1", port: ours ? outputsPort : 1 });
    },
  };

  return {
    url: `http://127.0.0.1:${api.address().port}`,
    outputsUrl: `http://127.0.0.1:${outputsPort}`,
    outputsHost: OUTPUT_HOST,
    net,
    seen,
    behaviour: b,
    tasks,
    close() {
      for (const s of sockets) s.destroy();
      return Promise.all([api, outputs].map((s) => new Promise((resolve) => s.close(() => resolve()))));
    },
  };
}
