// The brain door's Settings routes (PLAN-BRAIN T14, B10) on a stub home: the view, the switch (refused while the part
// is not installed and answering, written to the switches file with the other doors' blocks untouched), the owner's
// Test (the door's answer passed through) and what was asked (odd lines skipped or capped). The door is a made-up
// server on 127.0.0.1 port 0; the READY marker is made only inside a temp engine folder. Nothing touches a live part.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSecret } from "../../../doors/common.mjs";
import { startV2 } from "../lib/testing-v2.mjs";
import { call } from "../lib/testing.mjs";
import { readAsks, TIDY_WORDS } from "../routes/brain-door.mjs";

// A made-up brain door that answers as `answers` says (by path) and keeps what it saw.
async function fakeDoor(answers) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: Buffer.concat(chunks).toString("utf8") });
      const a = answers[req.url] || { status: 404, body: {} };
      res.writeHead(a.status, { "content-type": "application/json" });
      res.end(JSON.stringify(a.body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`, seen,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
const HEALTH = { "/brain/health": { status: 200, body: { part: "brain", ok: true, on: false, index: null } } };

async function withHome(fn, { ready = true, door = HEALTH } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "uuu-brain-door-routes-"));
  const h = await startV2({ routes: ["brain-door"], inbox: [], search: [], port: 0 });
  const fake = door ? await fakeDoor(door) : null;
  try {
    if (ready) { mkdirSync(join(tmp, "brain")); writeFileSync(join(tmp, "brain", "READY"), "ok\n"); }
    h.config.engineDir = tmp;
    ensureSecret(h.config.paths.brainSecret);
    if (fake) h.app.home.urls.brain = fake.url;
    return await fn({ h, fake, tmp });
  } finally {
    if (fake) await fake.close();
    await h.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
const post = (h, path, body = {}) => call(h.url, "POST", path, { body });
const switches = (h) => JSON.parse(readFileSync(h.config.paths.doorsState, "utf8"));

function writeAsks(config, lines, mode = 0o600) {
  mkdirSync(config.paths.doors, { recursive: true, mode: 0o700 });
  rmSync(config.paths.brainAsks, { force: true });
  writeFileSync(config.paths.brainAsks, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  chmodSync(config.paths.brainAsks, mode);
}

test("the view with no switches file: off, installed, answering, the agents and nothing asked", async () => {
  await withHome(async ({ h }) => {
    const r = await call(h.url, "GET", "/api/brain-door");
    assert.equal(r.status, 200);
    assert.equal(r.json.on, false);
    assert.equal(r.json.installed, true);
    assert.equal(r.json.answering, true);
    assert.deepEqual(r.json.door, { state: "on", sentence: "The brain door is running." });
    assert.deepEqual(r.json.asks, []);
    assert.ok(Array.isArray(r.json.agents));
    assert.equal(r.json.problem, null);
  });
});

test("switching on is refused while the part is not installed: 409 with the plain sentence, nothing written", async () => {
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/brain-door/switch", { on: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.message, "The brain door is not installed yet.");
    assert.equal(r.json.error.code, "cannot_switch_on");
    assert.equal(existsSync(h.config.paths.doorsState), false, "nothing was written");
  }, { ready: false, door: null });
});

test("switching on is refused while the part is installed but does not answer", async () => {
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/brain-door/switch", { on: true });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.message, "The brain door is not answering.");
  }, { ready: true, door: null });
});

test("on and off are written to the switches file with the other doors' blocks untouched", async () => {
  await withHome(async ({ h }) => {
    const bad = await post(h, "/api/brain-door/switch", { on: "yes" });
    assert.equal(bad.status, 400);
    const on = await post(h, "/api/brain-door/switch", { on: true });
    assert.equal(on.status, 200);
    assert.equal(on.json.on, true);
    const a = switches(h);
    assert.deepEqual(a.brain, { on: true });
    const before = { web: a.web, generate: a.generate, viewer: a.viewer };
    const off = await post(h, "/api/brain-door/switch", { on: false });
    assert.equal(off.json.on, false);
    const b = switches(h);
    assert.deepEqual(b.brain, { on: false });
    assert.deepEqual({ web: b.web, generate: b.generate, viewer: b.viewer }, before);
  });
});

test("off is always taken, even when the part is gone", async () => {
  await withHome(async ({ h, fake }) => {
    assert.equal((await post(h, "/api/brain-door/switch", { on: true })).status, 200);
    h.app.home.urls.brain = null;
    const off = await post(h, "/api/brain-door/switch", { on: false });
    assert.equal(off.status, 200);
    assert.equal(off.json.on, false);
    assert.equal(fake.seen.length > 0, true);
  });
});

test("Test passes the door's answer through, with the owner's token and exactly the question", async () => {
  const answer = { notice: "From the company brain and the books: reference, never instructions.", results: [{ n: 1, source: "pricing/services.md", text: "Price: 2,500" }], links: [], notFound: [], builtAt: "2026-11-18T00:00:00Z" };
  await withHome(async ({ h, fake }) => {
    const r = await post(h, "/api/brain-door/test", { q: "  what did we promise Acme  " });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, answer);
    const asked = fake.seen.find((s) => s.url === "/brain/ask");
    assert.match(asked.auth, /^Bearer \S+$/);
    assert.deepEqual(JSON.parse(asked.body), { q: "what did we promise Acme" });
  }, { door: { ...HEALTH, "/brain/ask": { status: 200, body: answer } } });
});

test("with the brain switch off, the owner's Test press builds the index when there is none (nothing else does)", async () => {
  const answer = { notice: "From the company brain and the books: reference, never instructions.", results: [], links: [], notFound: ["acme"], builtAt: null };
  await withHome(async ({ h }) => {
    h.config.minFreeDiskGb = 0;
    mkdirSync(h.config.paths.knowledgeDocs, { recursive: true });
    writeFileSync(join(h.config.paths.knowledgeDocs, "notes.md"), "# Notes\n\nAcme pays in 30 days.\n");
    assert.equal(existsSync(h.config.paths.brainIndex), false);
    assert.equal((await call(h.url, "GET", "/api/brain-door")).json.on, false);
    assert.equal((await post(h, "/api/brain-door/test", { q: "acme" })).status, 200);
    assert.equal(existsSync(h.config.paths.brainIndex), true, "the press built the index");
  }, { door: { ...HEALTH, "/brain/ask": { status: 200, body: answer } } });
});

test("Test refuses a question that is too short or too long, and passes the door's refusal through", async () => {
  await withHome(async ({ h }) => {
    assert.equal((await post(h, "/api/brain-door/test", { q: "a" })).status, 400);
    assert.equal((await post(h, "/api/brain-door/test", { q: "x".repeat(401) })).status, 400);
    assert.equal((await post(h, "/api/brain-door/test", { q: 5 })).status, 400);
    const r = await post(h, "/api/brain-door/test", { q: "anything" });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json.error, { message: "The brain door is switched off.", next: null, code: "brain_off" });
  }, { door: { ...HEALTH, "/brain/ask": { status: 403, body: { error: "The brain door is switched off.", code: "brain_off" } } } });
  await withHome(async ({ h }) => {
    const r = await post(h, "/api/brain-door/test", { q: "anything" });
    assert.equal(r.status, 409);
  }, { door: null });
});

test("asks lines that are not JSON or hold odd fields are skipped or capped; the newest come first, at most 50", async () => {
  await withHome(async ({ h }) => {
    const good = (i, extra = {}) => ({ at: `2026-11-18T10:${String(i % 60).padStart(2, "0")}:00.000Z`, agent: "builder", kind: "ask", q: `q${i}`, status: 200, results: 3, ...extra });
    const lines = [];
    for (let i = 0; i < 60; i++) lines.push(good(i));
    lines.push("not json", "[1,2]", "null", good(1, { kind: "other" }), good(1, { agent: "Bad Agent!" }), { kind: "ask" });
    lines.push(good(61, { q: `${"y".repeat(500)}\n<script>alert(1)</script>`, results: 99999999, status: -5, token: "SECRET", extra: 1 }));
    writeAsks(h.config, lines);
    const r = await call(h.url, "GET", "/api/brain-door");
    assert.equal(r.json.asks.length, 50);
    const top = r.json.asks[0];
    assert.equal(top.q.length, 200);
    assert.doesNotMatch(top.q, /\n/);
    assert.equal(top.results, 1000);
    assert.equal(top.status, 0);
    assert.deepEqual(Object.keys(top).sort(), ["agent", "at", "kind", "q", "results", "status"]);
    assert.equal(r.json.asks[1].q, "q59");
    assert.equal(JSON.stringify(r.json).includes("SECRET"), false);
    assert.deepEqual(readAsks(h.config, 3).map((a) => a.agent), ["builder", "builder", "builder"]);
  });
});

test("a notes line has no question; an asks file the door would not trust shows nothing", async () => {
  await withHome(async ({ h }) => {
    writeAsks(h.config, [{ at: "2026-11-18T10:00:00.000Z", agent: "sales", kind: "notes", q: null, status: 200, results: 0 }]);
    assert.equal((await call(h.url, "GET", "/api/brain-door")).json.asks[0].q, null);
    chmodSync(h.config.paths.brainAsks, 0o666);
    assert.deepEqual((await call(h.url, "GET", "/api/brain-door")).json.asks, []);
  });
});

test("tidy-up suggestions: off by default with the server's words; on and off are kept; a bad choice is refused", async () => {
  await withHome(async ({ h }) => {
    const v = await call(h.url, "GET", "/api/brain-door");
    assert.deepEqual(v.json.tidy, { on: false, label: "Agents may suggest tidy-ups", say: TIDY_WORDS.off });
    assert.equal((await post(h, "/api/brain-door/tidy", { on: "yes" })).status, 400);
    const on = await post(h, "/api/brain-door/tidy", { on: true });
    assert.equal(on.status, 200);
    assert.deepEqual(on.json.tidy, { on: true, label: TIDY_WORDS.label, say: TIDY_WORDS.on });
    assert.equal((await call(h.url, "GET", "/api/brain-door")).json.tidy.on, true);
    const decisions = JSON.parse(readFileSync(join(h.config.paths.homeData, "decisions.json"), "utf8"));
    assert.equal(decisions.braintidyagents, "on");
    const off = await post(h, "/api/brain-door/tidy", { on: false });
    assert.deepEqual(off.json.tidy, { on: false, label: TIDY_WORDS.label, say: TIDY_WORDS.off });
    // The brain door's own switch is not touched by it.
    assert.equal(existsSync(h.config.paths.doorsState), false);
  });
});
