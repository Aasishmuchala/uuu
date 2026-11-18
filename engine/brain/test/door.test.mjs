// The brain door (PLAN-BRAIN B9) on port 0 with a temp state folder, a made-up secret, made-up
// agent ids and the fixture's index. Nothing here touches the live engine or a fixed port.
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintToken } from "../../relay/token.mjs";
import { ASKS_KEEP, ASKS_MAX, CODES, NOTICE, PER_DAY, PER_HOUR, createBrainDoor, notesWithoutRecords } from "../door.mjs";
import { BUILT_AT, buildFixtureIndex } from "./fixture.mjs";

const BRAIN_SECRET = "3".repeat(64);
const WEB_SECRET = "1".repeat(64);
const BUILDER = "11111111-2222-4333-8444-000000000001";
const SALES = "11111111-2222-4333-8444-000000000002";
const RESEARCHER = "11111111-2222-4333-8444-000000000003";
const STRANGER = "11111111-2222-4333-8444-000000000004"; // in the company, not on the list
const ARTIST = "11111111-2222-4333-8444-000000000005"; // on the list, but not to see books records
const BOOKKEEPER = "11111111-2222-4333-8444-000000000006";
const HOUR = 3600_000;

let dir;
let paths;
let door;
let port;
let clock;
let lines;
let seen; // every response body text, to look for the state folder's path

const exp = () => Math.floor(clock / 1000) + 3600;
const agent = (id = BUILDER, secret = BRAIN_SECRET) => mintToken(secret, "a", id, exp());
const owner = (secret = BRAIN_SECRET) => mintToken(secret, "t", "owner", exp());

function put(path, text, mode = 0o600) {
  rmSync(path, { force: true });
  writeFileSync(path, text);
  chmodSync(path, mode);
}
const setSwitches = (data, mode = 0o600) => put(paths.doorsState, JSON.stringify(data), mode);
const setBrain = (on) => setSwitches({ version: 1, web: { on: false }, viewer: { on: false }, brain: { on } });

function makeConfig(agents = ["chief-of-staff", "builder", "sales"], records = agents) {
  return { ports: { brain: 0 }, paths, doors: { brain: { agents, records } } };
}

async function startDoor(agents, records) {
  if (door) await door.close();
  door = createBrainDoor({ config: makeConfig(agents, records), log: (l) => lines.push(l), now: () => clock });
  port = await door.listen(0);
}

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        seen.push(text);
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const call = (path, body, token = agent(), method = "POST", headers = {}) => request(method, path, {
  headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), "Content-Type": "application/json", ...headers },
  body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});
const askQ = (q, token) => call("/brain/ask", { q }, token);
const notesOf = (task, token) => call("/brain/notes", { task }, token);
const raw = (text) => new Promise((resolve) => {
  const sock = net.connect(port, "127.0.0.1");
  const chunks = [];
  const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
  const timer = setTimeout(() => { sock.destroy(); done(); }, 1500);
  sock.on("data", (c) => chunks.push(c));
  sock.on("close", () => { clearTimeout(timer); done(); });
  sock.on("error", () => {});
  sock.write(text);
});
const asks = () => (existsSync(paths.brainAsks)
  ? readFileSync(paths.brainAsks, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
function refused(r, code) {
  assert.equal(r.status, CODES[code][0], `${code}: ${r.text}`);
  assert.deepEqual(r.json, { error: CODES[code][1], code });
}

const NOTES = (task, extra = {}) => ({
  version: 1, taskId: task, at: "2026-11-18T06:10:00.000Z", notice: NOTICE,
  results: [{ n: 1, kind: "file", source: "pricing/services.md", title: "Services", locator: "Services > Site visit", text: "Price: ₹2,500 per visit.", at: null }],
  links: [{ from: { type: "invoice", name: "ACC-SINV-2026-00003" }, type: "invoice_of", to: { type: "customer", name: "Acme Interiors" } }],
  notFound: ["warranty"],
  ...extra,
});
const writeNotes = (task, data, mode = 0o600) => put(join(paths.brainNotes, `${task}.json`), typeof data === "string" ? data : JSON.stringify(data), mode);

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "brain-door-")));
  paths = {
    doorsState: join(dir, "doors", "state.json"),
    ids: join(dir, "ids.json"),
    brainSecret: join(dir, "secrets", "doors", "brain-secret"),
    webSecret: join(dir, "secrets", "doors", "web-secret"),
    brainStatus: join(dir, "doors", "brain-status.json"),
    brainAsks: join(dir, "doors", "brain-asks.jsonl"),
    brainDir: join(dir, "brain"),
    brainIndex: join(dir, "brain", "index.sqlite"),
    brainNotes: join(dir, "brain", "notes"),
  };
  for (const d of ["doors", "secrets/doors", "brain", "brain/notes"]) mkdirSync(join(dir, d), { recursive: true, mode: 0o700 });
  put(paths.brainSecret, `${BRAIN_SECRET}\n`);
  put(paths.webSecret, `${WEB_SECRET}\n`);
  put(paths.ids, JSON.stringify({ agents: { builder: BUILDER, sales: SALES, researcher: RESEARCHER, stranger: STRANGER, artist: ARTIST, bookkeeper: BOOKKEEPER } }), 0o644);
  setBrain(true);
  buildFixtureIndex(paths.brainIndex);
  clock = Date.now();
  lines = [];
  seen = [];
  await startDoor();
});

afterEach(async () => {
  if (door) await door.close();
  door = null;
  for (const text of seen) assert.ok(!text.includes(dir), `a response named the state folder: ${text.slice(0, 200)}`);
  rmSync(dir, { recursive: true, force: true });
});

// ---- health

test("health answers with no token and gives only B9's fields", async () => {
  const r = await request("GET", "/brain/health");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { part: "brain", ok: true, on: true, index: { builtAt: BUILT_AT, passages: 20 } });
});

test("health says off and no index when there is neither", async () => {
  setBrain(false);
  rmSync(paths.brainIndex);
  const r = await request("GET", "/brain/health");
  assert.deepEqual(r.json, { part: "brain", ok: true, on: false, index: null });
});

// ---- 1. upgrades and CONNECT

test("an upgrade is refused before anything else, even with no token", async () => {
  const text = await raw("GET /brain/ask HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
  assert.match(text, /^HTTP\/1\.1 400 /);
  assert.ok(text.includes('"code":"brain_bad_request"'));
  assert.ok(text.includes(CODES.brain_bad_request[1]));
});

test("CONNECT is refused as a plain-requests-only refusal", async () => {
  const text = await raw("CONNECT 127.0.0.1:22 HTTP/1.1\r\nHost: 127.0.0.1:22\r\n\r\n");
  assert.match(text, /^HTTP\/1\.1 400 /);
  assert.ok(text.includes('"code":"brain_bad_request"'));
});

// ---- 2. the token

test("no token, a broken token or two tokens are refused", async () => {
  refused(await askQ("refunds", null), "brain_no_token");
  refused(await askQ("refunds", "v1.a.nope"), "brain_no_token");
  refused(await call("/brain/ask", { q: "refunds" }, agent(), "POST", { Authorization: [`Bearer ${agent()}`, `Bearer ${agent()}`] }), "brain_no_token");
});

test("the Researcher's token is refused, even when the config lists it", async () => {
  refused(await askQ("refunds", agent(RESEARCHER)), "brain_no_token");
  await startDoor(["builder", "researcher"]);
  refused(await askQ("refunds", agent(RESEARCHER)), "brain_no_token");
  assert.equal((await askQ("refunds", agent(BUILDER))).status, 200);
});

test("an app's token is refused", async () => {
  refused(await askQ("refunds", mintToken(BRAIN_SECRET, "t", "app-notes", exp())), "brain_no_token");
});

test("an agent not on the list, and a test token for an agent, are refused", async () => {
  refused(await askQ("refunds", agent(STRANGER)), "brain_no_token");
  refused(await askQ("refunds", mintToken(BRAIN_SECRET, "t", "builder", exp())), "brain_no_token");
});

test("a token made with the web door's secret is nothing here", async () => {
  refused(await askQ("refunds", agent(BUILDER, WEB_SECRET)), "brain_no_token");
  refused(await askQ("refunds", owner(WEB_SECRET)), "brain_no_token");
});

test("an expired token is refused", async () => {
  const old = mintToken(BRAIN_SECRET, "a", BUILDER, Math.floor(clock / 1000) + 10);
  clock += 60_000;
  refused(await askQ("refunds", old), "brain_no_token");
});

// ---- 3. the switch

test("the switch off is 403 even with a good token, and a switch-off after start counts at once", async () => {
  assert.equal((await askQ("refunds")).status, 200);
  setBrain(false);
  refused(await askQ("refunds"), "brain_off");
  refused(await notesOf("task-1"), "brain_off");
  refused(await notesOf("task-1", owner()), "brain_off");
  // The owner's Test question is the one exception (see below).
  assert.equal((await askQ("refunds", owner())).status, 200);
});

test("a switches file with no brain block is off", async () => {
  setSwitches({ version: 1, web: { on: true }, viewer: { on: true } });
  refused(await askQ("refunds"), "brain_off");
  rmSync(paths.doorsState);
  refused(await askQ("refunds"), "brain_off");
});

test("a switches file that cannot be trusted is off", async () => {
  setSwitches({ version: 1, brain: { on: true, extra: 1 } });
  refused(await askQ("refunds"), "brain_off");
  setSwitches({ version: 1, brain: { on: "yes" } });
  refused(await askQ("refunds"), "brain_off");
  setSwitches({ version: 1, brain: { on: true } }, 0o666);
  refused(await askQ("refunds"), "brain_off");
  put(paths.doorsState, "not json");
  refused(await askQ("refunds"), "brain_off");
});

// ---- 4. the path

test("any other method, path or a query string is no such address", async () => {
  refused(await call("/brain/ask", undefined, agent(), "GET"), "brain_bad_path");
  refused(await call("/brain/ask?q=refunds", { q: "refunds" }), "brain_bad_path");
  refused(await call("/brain/notes/", { task: "a" }), "brain_bad_path");
  refused(await call("/brain/%61sk", { q: "refunds" }), "brain_bad_path");
  refused(await call("/brain/health", undefined, agent(), "POST"), "brain_bad_path");
  refused(await call("/web/fetch", { url: "https://example.com/" }), "brain_bad_path");
});

test("a request that fails two rules gets the earlier one", async () => {
  // token before path
  refused(await call("/nowhere", { q: "x" }, null), "brain_no_token");
  // token before switch
  setBrain(false);
  refused(await askQ("refunds", agent(STRANGER)), "brain_no_token");
  // switch before path and body
  refused(await call("/nowhere", "not json"), "brain_off");
  setBrain(true);
  // path before body
  refused(await call("/nowhere", "not json"), "brain_bad_path");
  // body before index
  rmSync(paths.brainIndex);
  refused(await call("/brain/ask", "not json"), "brain_bad_body");
});

// ---- 5. the body

test("a body that is too big, not one object, or has other keys or kinds is refused", async () => {
  const bad = [
    JSON.stringify({ q: "a".repeat(3000) }), "not json", "[]", "null", JSON.stringify("refunds"),
    JSON.stringify({}), JSON.stringify({ q: "refunds", limit: 3 }), JSON.stringify({ q: 7 }),
    JSON.stringify({ q: "a" }), JSON.stringify({ q: "a".repeat(401) }), JSON.stringify({ task: "x" }),
  ];
  for (const body of bad) refused(await call("/brain/ask", body), "brain_bad_body");
  for (const body of [JSON.stringify({ task: 7 }), JSON.stringify({ q: "refunds" }), JSON.stringify({ task: "a", q: "b" })]) {
    refused(await call("/brain/notes", body), "brain_bad_body");
  }
});

test("a task id of ../x, a slash, a dot or a long id is refused as the body", async () => {
  for (const task of ["../x", "a/b", ".hidden", "-a", "a.json", "a".repeat(65), ""]) {
    refused(await notesOf(task), "brain_bad_body");
  }
});

// ---- answers

test("a listed agent gets the fixture's answer, notice first", async () => {
  const r = await askQ("what did we promise Acme");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ["notice", "results", "links", "notFound", "builtAt"]);
  assert.equal(r.json.notice, NOTICE);
  assert.ok(r.text.startsWith(`{"notice":${JSON.stringify(NOTICE)}`));
  assert.equal(r.json.results[0].source, "calls/acme-call.md");
  assert.ok(r.json.results.some((x) => x.source === "books:Customer:Acme Interiors"));
  assert.ok(r.json.links.some((l) => l.type === "invoice_of" && l.from.name === "ACC-SINV-2026-00003" && l.to.name === "Acme Interiors"));
  assert.deepEqual(r.json.notFound, []);
  assert.equal(r.json.builtAt, BUILT_AT);
  assert.ok(r.json.results.length <= 8);
  assert.ok(!r.text.includes("PLANTED"));
});

test("what is not in the brain is said", async () => {
  const r = await askQ("zebra quantum");
  assert.deepEqual(r.json.results, []);
  assert.deepEqual(r.json.notFound, ["zebra", "quantum"]);
});

test("a hostile question never acts as syntax", async () => {
  for (const q of ['") OR 1=1 --', "NEAR(", "**", '""', "(".repeat(400)]) {
    const r = await askQ(q);
    assert.equal(r.status, 200, q);
    assert.ok(!r.text.includes("PLANTED"));
  }
});

test("the owner's test token may ask and read notes, and is not counted as an agent", async () => {
  writeNotes("task-1", NOTES("task-1"));
  assert.equal((await askQ("refunds", owner())).status, 200);
  assert.equal((await notesOf("task-1", owner())).status, 200);
  assert.equal(asks().at(-1).agent, "owner");
});

// ---- 6. the rate

test("the 121st call in an hour is too many; the next hour is fine", async () => {
  writeNotes("task-1", NOTES("task-1"));
  for (let i = 0; i < PER_HOUR; i += 1) {
    const r = i % 2 ? await askQ("refunds") : await notesOf("task-1");
    assert.equal(r.status, 200, `call ${i + 1}`);
  }
  refused(await askQ("refunds"), "brain_too_many");
  // Another agent is counted on its own.
  assert.equal((await askQ("refunds", agent(SALES))).status, 200);
  // The rate is checked before the body is read: a bad body over the limit is too many.
  refused(await call("/brain/ask", "{}"), "brain_too_many");
  clock += HOUR + 1;
  assert.equal((await askQ("refunds")).status, 200);
});

test("a bad body counts toward the rate, so it cannot be sent without end", async () => {
  for (let i = 0; i < PER_HOUR; i += 1) refused(await call("/brain/ask", "{}"), "brain_bad_body");
  refused(await askQ("refunds"), "brain_too_many");
  refused(await call("/brain/ask", "{}"), "brain_too_many");
  assert.equal((await askQ("refunds", agent(SALES))).status, 200, "another agent is counted on its own");
});

// T18's finding 2: bad bodies and refusals over the limit used to push real questions out of the asks file.
test("an agent flooding the door with bad bodies cannot push a real question out of the asks file", async () => {
  assert.equal((await askQ("what does Acme Interiors owe us SECRETMARK")).status, 200);
  const N = 2600;
  const statuses = [];
  for (let i = 0; i < N; i += 50) {
    const got = await Promise.all(Array.from({ length: 50 }, () => call("/brain/ask", "{}")));
    statuses.push(...got.map((r) => r.status));
  }
  assert.equal(statuses.filter((st) => st === 400).length, PER_HOUR - 1, "only the rest of the hour's calls reach the body");
  assert.equal(statuses.filter((st) => st === 429).length, N - (PER_HOUR - 1));
  const got = asks();
  assert.ok(got.some((l) => l.q === "what does Acme Interiors owe us SECRETMARK"), "the real question is still there");
  // The question, the bad bodies within the limit, and one line for all the calls over it.
  assert.equal(got.length, PER_HOUR + 1);
  assert.equal(got.filter((l) => l.status === "brain_too_many").length, 1);
});

test("over the limit, at most one asks line an agent an hour; each agent gets its own", async () => {
  for (let i = 0; i < PER_HOUR; i += 1) await askQ("refunds");
  for (let i = 0; i < 5; i += 1) refused(await askQ("refunds"), "brain_too_many");
  for (let i = 0; i < PER_HOUR; i += 1) await askQ("refunds", agent(SALES));
  refused(await askQ("refunds", agent(SALES)), "brain_too_many");
  const over = () => asks().filter((l) => l.status === "brain_too_many").map((l) => l.agent);
  assert.deepEqual(over(), ["builder", "sales"]);
  // Still over (the day's limit is not reached, but the next hour's first calls are fine): a new hour, a new line.
  clock += HOUR + 1;
  for (let i = 0; i < PER_HOUR; i += 1) await askQ("refunds");
  refused(await askQ("refunds"), "brain_too_many");
  refused(await askQ("refunds"), "brain_too_many");
  assert.deepEqual(over(), ["builder", "sales", "builder"]);
  assert.equal(asks().find((l) => l.status === "brain_too_many").q, null, "the body of a call over the limit is never read");
});

test("600 calls in a day is the most", async () => {
  for (let h = 0; h < PER_DAY / PER_HOUR; h += 1) {
    for (let i = 0; i < PER_HOUR; i += 1) assert.equal((await askQ("refunds")).status, 200);
    clock += HOUR + 1;
  }
  refused(await askQ("refunds"), "brain_too_many");
  clock += 24 * HOUR;
  assert.equal((await askQ("refunds")).status, 200);
});

test("the rate is checked before the index", async () => {
  rmSync(paths.brainIndex);
  refused(await askQ("refunds"), "brain_no_index");
  for (let i = 1; i < PER_HOUR; i += 1) await askQ("refunds");
  refused(await askQ("refunds"), "brain_too_many");
});

// ---- 7. the index

test("no index, a link for an index or a writable index is no index", async () => {
  rmSync(paths.brainIndex);
  refused(await askQ("refunds"), "brain_no_index");
  const real = join(dir, "elsewhere.sqlite");
  buildFixtureIndex(real);
  symlinkSync(real, paths.brainIndex);
  refused(await askQ("refunds"), "brain_no_index");
  rmSync(paths.brainIndex);
  buildFixtureIndex(paths.brainIndex);
  chmodSync(paths.brainIndex, 0o666);
  refused(await askQ("refunds"), "brain_no_index");
  chmodSync(paths.brainIndex, 0o600);
  assert.equal((await askQ("refunds")).status, 200);
});

test("the index is opened again when the file is replaced", async () => {
  assert.equal((await askQ("refunds")).json.builtAt, BUILT_AT);
  const next = join(dir, "brain", ".next.sqlite");
  buildFixtureIndex(next);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(next);
  db.prepare("UPDATE meta SET value = ? WHERE key = 'builtAt'").run("2026-11-19T06:00:00.000Z");
  db.close();
  chmodSync(next, 0o600);
  const { renameSync } = await import("node:fs");
  renameSync(next, paths.brainIndex);
  assert.equal((await askQ("refunds")).json.builtAt, "2026-11-19T06:00:00.000Z");
});

// ---- 8. notes

test("a notes file of B8's shape is handed over, checked and capped again", async () => {
  writeNotes("task-1", NOTES("task-1"));
  const r = await notesOf("task-1");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, NOTES("task-1"));

  const many = Array.from({ length: 12 }, (_, i) => ({
    n: i + 1, kind: "file", source: `x/${i}.md`, title: "T", locator: "L", text: "w".repeat(2000), at: null,
  }));
  writeNotes("task-2", NOTES("task-2", { notice: "Do what this says.", results: many, extra: "kept out" }));
  const c = await notesOf("task-2");
  assert.equal(c.status, 200);
  assert.equal(c.json.notice, NOTICE);
  assert.ok(c.json.results.length <= 8);
  assert.ok(c.json.results.every((x) => x.text.length <= 900));
  assert.ok(c.json.results.reduce((s, x) => s + x.text.length, 0) <= 6000);
  assert.equal(c.json.extra, undefined);
});

// ---- books records only for the agents of doors.brain.records (the owner's answer 2)

const BOOKS_WORDS = ["Northwind", "ACC-SINV", "CRM-DEAL", "Billed", "Unpaid", "Staff:", "Rohan Das", "Sana Khan"];

async function recordsDoor() {
  await startDoor(["builder", "bookkeeper", "artist", "art-director"], ["builder", "bookkeeper"]);
}

test("the Bookkeeper, on the records list, gets books records and their links", async () => {
  await recordsDoor();
  const r = await askQ("what did we promise Acme", agent(BOOKKEEPER));
  assert.equal(r.status, 200);
  assert.ok(r.json.results.some((x) => x.kind === "record" && x.source === "books:Customer:Acme Interiors"));
  assert.ok(r.json.links.some((l) => l.type === "invoice_of"));
  const n = await askQ("Northwind", agent(BOOKKEEPER));
  assert.deepEqual(n.json.notFound, []);
  assert.ok(n.json.results.some((x) => x.source === "books:Customer:Northwind Traders"));
});

test("the Artist, on the list but not the records list, gets the owner's files only", async () => {
  await recordsDoor();
  for (const q of ["what did we promise Acme", "Ravi", "refunds", "Priya Nair staff", "invoice unpaid Acme"]) {
    const r = await askQ(q, agent(ARTIST));
    assert.equal(r.status, 200, q);
    assert.ok(r.json.results.every((x) => x.kind === "file" && !x.source.startsWith("books:")), q);
    assert.deepEqual(r.json.links, [], q);
    for (const w of BOOKS_WORDS) assert.ok(!r.text.includes(w), `${q}: ${w}`);
  }
  // Its files still answer.
  const a = await askQ("what did we promise Acme", agent(ARTIST));
  assert.equal(a.json.results[0].source, "calls/acme-call.md");
  // A word only the books hold is not found for it.
  const n = await askQ("Northwind", agent(ARTIST));
  assert.deepEqual(n.json.results, []);
  assert.deepEqual(n.json.notFound, ["northwind"]);
});

test("a config with no records list gives books records to no agent, and the owner still sees them", async () => {
  door && await door.close();
  door = createBrainDoor({ config: { ports: { brain: 0 }, paths, doors: { brain: { agents: ["builder"] } } }, log: () => {}, now: () => clock });
  port = await door.listen(0);
  const r = await askQ("what did we promise Acme");
  assert.ok(r.json.results.every((x) => x.kind === "file"));
  assert.deepEqual(r.json.links, []);
  const o = await askQ("what did we promise Acme", owner());
  assert.ok(o.json.results.some((x) => x.kind === "record"));
});

test("notes: the Artist gets the plain part, or the notes without record passages and links; the Bookkeeper gets them whole", async () => {
  await recordsDoor();
  const record = { n: 2, kind: "record", source: "books:Customer:Acme Interiors", title: "Acme Interiors", locator: "", text: "Customer: Acme Interiors. Invoices: 2.", at: null };
  const file = NOTES("t").results[0];
  const plainFile = { ...file, text: "Price: ₹2,500 per visit. (plain)" };
  writeNotes("task-p", NOTES("task-p", {
    results: [file, record], notFound: [],
    plain: { results: [plainFile], links: [], notFound: ["acme"] },
  }));
  const whole = await notesOf("task-p", agent(BOOKKEEPER));
  assert.equal(whole.status, 200);
  assert.equal(whole.json.results.length, 2);
  assert.equal(whole.json.links.length, 1);
  assert.equal(whole.json.plain, undefined);
  const plain = await notesOf("task-p", agent(ARTIST));
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.json.results, [plainFile]);
  assert.deepEqual(plain.json.links, []);
  assert.deepEqual(plain.json.notFound, ["acme"]);
  assert.equal(plain.json.plain, undefined);
  // Notes written before the plain part, or with a plain part holding a record: no record, no link.
  writeNotes("task-o", NOTES("task-o", { results: [record, file] }));
  const old = await notesOf("task-o", agent(ARTIST));
  assert.equal(old.status, 200);
  assert.deepEqual(old.json.results, [{ ...file, n: 1 }]);
  assert.deepEqual(old.json.links, []);
  writeNotes("task-q", NOTES("task-q", { plain: { results: [record], links: NOTES("x").links, notFound: [] } }));
  const q = await notesOf("task-q", agent(ARTIST));
  assert.deepEqual(q.json.results, []);
  assert.deepEqual(q.json.links, []);
  for (const r of [plain, old, q]) for (const w of ["Acme Interiors", "ACC-SINV"]) assert.ok(!r.text.includes(w), w);
  // The pure helper agrees.
  assert.equal(notesWithoutRecords(NOTES("task-z"), "task-y"), null);
});

test("notes that are not there are no notes", async () => {
  refused(await notesOf("task-404"), "brain_no_notes");
});

test("a notes file that is a link, over 64 KB, writable by others or the wrong shape is no notes", async () => {
  const elsewhere = join(dir, "elsewhere.json");
  put(elsewhere, JSON.stringify(NOTES("task-l")));
  symlinkSync(elsewhere, join(paths.brainNotes, "task-l.json"));
  refused(await notesOf("task-l"), "brain_no_notes");

  writeNotes("task-big", NOTES("task-big", { notFound: ["x".repeat(70 * 1024)] }));
  refused(await notesOf("task-big"), "brain_no_notes");

  writeNotes("task-w", NOTES("task-w"), 0o666);
  refused(await notesOf("task-w"), "brain_no_notes");

  const shapes = {
    "task-a": NOTES("someone-else"),
    "task-b": NOTES("task-b", { version: 2 }),
    "task-c": NOTES("task-c", { results: [{ n: 1, kind: "file", source: "a", title: "b", locator: "c", text: 4, at: null }] }),
    "task-d": NOTES("task-d", { results: "lots" }),
    "task-e": NOTES("task-e", { links: [{ from: "x", type: "invoice_of", to: "y" }] }),
    "task-f": NOTES("task-f", { notFound: [1] }),
    "task-g": "not json",
    "task-h": "[]",
  };
  for (const [task, data] of Object.entries(shapes)) {
    writeNotes(task, data);
    refused(await notesOf(task), "brain_no_notes");
  }
});

test("a notes folder that is a link is no notes", async () => {
  const other = join(dir, "other-notes");
  mkdirSync(other, { mode: 0o700 });
  put(join(other, "task-1.json"), JSON.stringify(NOTES("task-1")));
  rmSync(paths.brainNotes, { recursive: true });
  symlinkSync(other, paths.brainNotes);
  refused(await notesOf("task-1"), "brain_no_notes");
});

// ---- the asks file

test("the asks file gets one line a call, with no token, header or result text", async () => {
  writeNotes("task-1", NOTES("task-1"));
  const token = agent();
  await askQ("what did we promise Acme", token);
  await askQ("zebra   quantum\tnow", token);
  await notesOf("task-1", token);
  await notesOf("task-404", token);
  await call("/brain/ask", "{}", token);
  const got = asks();
  assert.equal(got.length, 5);
  for (const l of got) {
    assert.deepEqual(Object.keys(l), ["at", "agent", "kind", "q", "status", "results"]);
    assert.equal(l.agent, "builder");
  }
  assert.equal(got[0].kind, "ask");
  assert.equal(got[0].q, "what did we promise Acme");
  assert.equal(got[0].status, 200);
  assert.ok(got[0].results > 0);
  assert.equal(got[1].q, "zebra quantum now");
  assert.equal(got[1].results, 0);
  assert.deepEqual([got[2].kind, got[2].q, got[2].status, got[2].results], ["notes", null, 200, 1]);
  assert.equal(got[3].status, "brain_no_notes");
  assert.equal(got[4].status, "brain_bad_body");
  const text = readFileSync(paths.brainAsks, "utf8");
  assert.ok(!text.includes(token) && !text.includes(token.split(".").at(-1)));
  assert.ok(!text.includes("Bearer") && !text.includes("drawings") && !text.includes(dir));
  assert.equal((await import("node:fs")).statSync(paths.brainAsks).mode & 0o777, 0o600);
});

test("a long question is kept to its first 200 characters on one line", async () => {
  await askQ(`refunds\n${"b ".repeat(190)}`);
  const l = asks().at(-1);
  assert.ok(l.q.length <= 200);
  assert.ok(!/[\n\r]/.test(l.q));
});

test("the asks file is cut to the newest 2,000 lines when it reaches 2,500", async () => {
  await door.close();
  const old = Array.from({ length: ASKS_MAX - 1 }, (_, i) => JSON.stringify({ at: "x", agent: "builder", kind: "ask", q: `old ${i}`, status: 200, results: 0 }));
  put(paths.brainAsks, `${old.join("\n")}\n`);
  await startDoor();
  await askQ("refunds");
  const got = asks();
  assert.equal(got.length, ASKS_KEEP);
  assert.equal(got.at(-1).q, "refunds");
  assert.equal(got[0].q, `old ${ASKS_MAX - ASKS_KEEP}`);
  await askQ("refunds again");
  assert.equal(asks().length, ASKS_KEEP + 1);
});

// ---- the status file and what is never said

test("the status file counts answers and refusals, with no question in it", async () => {
  await askQ("what did we promise Acme");
  await askQ("refunds", null);
  await door.close();
  door = null;
  const st = JSON.parse(readFileSync(paths.brainStatus, "utf8"));
  assert.equal(st.today.asks, 1);
  assert.equal(st.today.refused, 1);
  assert.ok(!JSON.stringify(st).includes("Acme"));
});

test("no answer or log line names a file of the state folder", async () => {
  rmSync(paths.brainIndex);
  await askQ("refunds");
  await notesOf("task-1");
  await request("GET", "/brain/health");
  buildFixtureIndex(paths.brainIndex);
  await askQ("refunds");
  for (const l of lines) assert.ok(!l.includes(dir), l);
  // afterEach checks every response body.
});

// ---- the owner's Test while the switch is off (as the web door's Test)

test("switch off: the owner's Test question is answered; the owner's notes, every agent, and an untrusted switches file are still refused", async () => {
  writeNotes("task-1", NOTES("task-1"));
  setBrain(false);
  const r = await askQ("what did we promise Acme", owner());
  assert.equal(r.status, 200);
  assert.equal(r.json.notice, NOTICE);
  assert.equal(r.json.results[0].source, "calls/acme-call.md");
  assert.equal(asks().at(-1).agent, "owner");
  refused(await notesOf("task-1", owner()), "brain_off");
  refused(await askQ("what did we promise Acme"), "brain_off");
  refused(await askQ("what did we promise Acme", agent(SALES)), "brain_off");
  // Another address with the owner's token is still refused at the switch, before the path (B9's order).
  refused(await call("/brain/other", { q: "acme" }, owner()), "brain_off");
  // A token of another door's secret is still no token.
  refused(await askQ("acme", owner(WEB_SECRET)), "brain_no_token");
  // A switches file that cannot be trusted refuses the owner too.
  setSwitches({ version: 1, brain: { on: false, extra: 1 } });
  refused(await askQ("acme", owner()), "brain_off");
  setSwitches({ version: 1, brain: { on: false } }, 0o666);
  refused(await askQ("acme", owner()), "brain_off");
  // No brain block at all is a trusted "off": the owner's Test is answered.
  setSwitches({ version: 1, web: { on: false } });
  assert.equal((await askQ("refunds", owner())).status, 200);
});
