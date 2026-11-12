// A stand-in for the model provider (Omega Plus) for tests. Built-in modules only; it listens
// on 127.0.0.1 port 0 and never calls out. It serves the keyless model list, usage and billing,
// and the three model paths with canned "OK" answers, plain or streamed (with `ping` events and
// a `usage`). `behaviour` is read on every request, so a test can change it between calls:
//   status: 400 | 401 | 403 | 429 | 500 | 529 | 302  answer the model paths with that status
//   retryAfter: "30"           the retry-after header of a 429
//   location: "http://..."     where a 302 points
//   hang: true                 never answer a model path
//   key: "<text>"              when set, usage, billing and the model paths need this key
//   gzip: true                 answer the model paths with content-encoding: gzip
//   eventDelayMs: 0            the pause between stream events
//   echoKey: "body401" | "body200" | "header" | "stream" | "split"
//                              quote the key it was sent back: in a 401 or 200 JSON body, in an
//                              answer header, in the middle of a stream, or split across two
//                              writes of a stream
//   echoForm: "json" | "jsonSlash" | "percent"   how the echoed key is spelled (default: as is)
//   encodingLabel: "<text>"    the content-encoding the echo answers claim (the bytes stay plain)
// `seen` records { method, path, rawHeaders, body } of every request (body as text).
import http from "node:http";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OMEGA_MODELS = JSON.parse(readFileSync(join(HERE, "omega-models.json"), "utf8"));
export const STUB_USAGE = { input: 12, output: 3 };

const ERRORS = {
  400: ["invalid_request_error", "Bad request from the stand-in."],
  401: ["authentication_error", "Invalid or missing API key"],
  403: ["permission_error", "This key may not do that."],
  429: ["rate_limit_error", "Rate limit reached: five-hour token window or RPM cap."],
  500: ["api_error", "Internal error in the stand-in."],
  529: ["overloaded_error", "Overloaded."],
};

function keyOf(rawHeaders) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const n = rawHeaders[i].toLowerCase();
    if (n === "x-api-key") out.push(rawHeaders[i + 1]);
    if (n === "authorization") out.push(rawHeaders[i + 1].replace(/^bearer +/i, ""));
  }
  return out;
}

function json(res, status, body, extra = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...extra });
  res.end(text);
}

function messageAnswer(model) {
  return {
    id: "msg_stub", type: "message", role: "assistant", model,
    content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: STUB_USAGE.input, output_tokens: STUB_USAGE.output },
  };
}

function responseAnswer(model) {
  return {
    id: "resp_stub", object: "response", status: "completed", model,
    output: [{ type: "message", id: "msg_stub", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] }],
    usage: { input_tokens: STUB_USAGE.input, output_tokens: STUB_USAGE.output, total_tokens: STUB_USAGE.input + STUB_USAGE.output },
  };
}

function messageEvents(model) {
  const start = messageAnswer(model);
  start.content = [];
  start.stop_reason = null;
  start.usage = { input_tokens: STUB_USAGE.input, output_tokens: 1 };
  return [
    ["message_start", { type: "message_start", message: start }],
    ["ping", { type: "ping" }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } }],
    ["ping", { type: "ping" }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: STUB_USAGE.output } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

function responseEvents(model) {
  const done = responseAnswer(model);
  const created = { ...done, status: "in_progress", output: [], usage: null };
  return [
    ["response.created", { type: "response.created", sequence_number: 0, response: created }],
    ["response.output_text.delta", { type: "response.output_text.delta", sequence_number: 1, item_id: "msg_stub", output_index: 0, content_index: 0, delta: "OK" }],
    ["response.completed", { type: "response.completed", sequence_number: 2, response: done }],
  ];
}

function stream(res, events, delayMs, gzip) {
  const head = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" };
  if (gzip) {
    const text = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
    const body = gzipSync(text);
    res.writeHead(200, { ...head, "Content-Encoding": "gzip", "Content-Length": body.length });
    res.end(body);
    return;
  }
  res.writeHead(200, head);
  res.flushHeaders();
  let i = 0;
  const next = () => {
    if (res.destroyed) return;
    if (i >= events.length) return res.end();
    const [name, data] = events[i];
    i += 1;
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    if (delayMs > 0) setTimeout(next, delayMs);
    else setImmediate(next);
  };
  next();
}

// The key as the stand-in quotes it: as written, JSON-escaped (`json`), JSON-escaped with `/`
// as `\/` (`jsonSlash`), or percent-encoded (`percent`). It is put into the answer's text as
// is, with no further escaping, so the relay sees exactly that form.
function keyShown(key, form) {
  const json = JSON.stringify(key).slice(1, -1);
  if (form === "json") return json;
  if (form === "jsonSlash") return json.replaceAll("/", "\\/");
  if (form === "percent") return encodeURIComponent(key);
  return key;
}

function echoKey(res, b, key) {
  const where = b.echoKey;
  const shown = keyShown(key, b.echoForm);
  const label = b.encodingLabel !== undefined ? { "Content-Encoding": b.encodingLabel } : {};
  const plain = (status, text, extra = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...label, ...extra });
    res.end(text);
  };
  if (where === "body401") return plain(401, `{"type":"error","error":{"type":"authentication_error","message":"Invalid API key: ${shown}"}}`);
  if (where === "body200") return plain(200, `{"type":"message","content":[{"type":"text","text":"your key is ${shown}"}]}`);
  if (where === "header") return plain(200, JSON.stringify(messageAnswer("x")), { "X-Your-Key": shown });
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", ...label });
  res.flushHeaders();
  const event = (text) => `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}\n\n`;
  res.write(`${event("first part, no secret here")}event: ping\ndata: {"type":"ping"}\n\n`);
  if (where === "stream") {
    setTimeout(() => { res.write(event(`the key is ${shown} and more`)); setTimeout(() => res.end(event("after")), 100); }, 100);
    return undefined;
  }
  const whole = event(`the key is ${shown} and more`);
  const at = whole.indexOf(shown) + Math.floor(shown.length / 2);
  setTimeout(() => { res.write(whole.slice(0, at)); setTimeout(() => { res.write(whole.slice(at)); res.end(event("after")); }, 150); }, 100);
  return undefined;
}

export async function startProvider({ models = OMEGA_MODELS.data, behaviour = {} } = {}) {
  const seen = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const q = req.url.indexOf("?");
      const path = q === -1 ? req.url : req.url.slice(0, q);
      seen.push({ method: req.method, path: req.url, rawHeaders: req.rawHeaders, body: text });
      const b = behaviour;
      const keyOk = !b.key || keyOf(req.rawHeaders).includes(b.key);

      if (req.method === "GET" && path === "/v1/models") {
        return json(res, 200, { object: "list", data: models });
      }
      if (req.method === "GET" && (path === "/v1/usage" || path === "/v1/billing")) {
        if (!keyOk) return json(res, 401, { type: "error", error: { type: ERRORS[401][0], message: ERRORS[401][1] } });
        if (path === "/v1/usage") return json(res, 200, { plan: "Stand-in Pro", period: "daily", used_tokens: 1200, limit_tokens: 1000000, requests_today: 4 });
        return json(res, 200, { plan: "Stand-in Pro", status: "active", renews_at: "2026-12-01T00:00:00Z" });
      }
      const modelPath = req.method === "POST" && ["/v1/messages", "/v1/messages/count_tokens", "/v1/responses", "/api/v1/responses"].includes(path);
      if (!modelPath) return json(res, 404, { type: "error", error: { type: "not_found_error", message: "Not found." } });
      if (b.hang) return undefined;
      if (b.echoKey) return echoKey(res, b, keyOf(req.rawHeaders)[0] || "");
      if (!keyOk) return json(res, 401, { type: "error", error: { type: ERRORS[401][0], message: ERRORS[401][1] } });
      if (b.status === 302) {
        res.writeHead(302, { Location: b.location || "http://127.0.0.1:9/elsewhere", "Content-Length": 0 });
        return res.end();
      }
      if (b.status && ERRORS[b.status]) {
        const extra = b.status === 429 && b.retryAfter !== undefined ? { "Retry-After": String(b.retryAfter) } : {};
        return json(res, b.status, { type: "error", error: { type: ERRORS[b.status][0], message: ERRORS[b.status][1] } }, extra);
      }
      let body = {};
      try { body = JSON.parse(text); } catch { /* the relay sends JSON; anything else answers plainly */ }
      const model = typeof body.model === "string" ? body.model : "none";
      if (path === "/v1/messages/count_tokens") return json(res, 200, { input_tokens: STUB_USAGE.input });
      const responses = path !== "/v1/messages";
      if (body.stream === true) return stream(res, responses ? responseEvents(model) : messageEvents(model), b.eventDelayMs || 0, b.gzip);
      const answer = responses ? responseAnswer(model) : messageAnswer(model);
      if (b.gzip) {
        const gz = gzipSync(JSON.stringify(answer));
        res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": gz.length });
        return res.end(gz);
      }
      return json(res, 200, answer);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    seen,
    behaviour,
    close() {
      return new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      });
    },
  };
}
