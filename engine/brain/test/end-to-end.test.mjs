// End to end in a temp state (PLAN-BRAIN T16): the home server on the stub board and bench with the fixture's
// files in its brain, the index, brain notes for a question, the switch through Settings, door_mode.py --for-run
// on a temp copy of the engine folder, the brain door on port 0 reading the same temp state, a Customer an agent
// made that never reaches an answer, and a tidy-up in Needs you. Every port is 0; nothing touches the live state,
// a fixed port or W/engine/brain (the READY stand-in is made only in the temp engine copy).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSecret } from "../../doors/common.mjs";
import { indexFor } from "../../home/server/brain/indexer.mjs";
import { brainFor } from "../../home/server/brain/store.mjs";
import { createBench } from "../../home/server/lib/bench.mjs";
import { call, actAsSeen } from "../../home/server/lib/testing.mjs";
import { startV2 } from "../../home/server/lib/testing-v2.mjs";
import { CODES, NOTICE, createBrainDoor } from "../door.mjs";
import { FILES } from "./fixture.mjs";

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The repo's own engine/brain/READY as it was before this file ran: the live branch commits it (0a9e5df), so the test
// asserts it is left as it was, not that it is absent.
const READY_BEFORE = (() => { try { return readFileSync(join(ENGINE, "brain", "READY"), "utf8"); } catch { return null; } })();
const PYTHON = "/usr/bin/python3";
const ADMIN = "Administrator";
const AGENT_USER = "sales@engine.localhost";
const STAMP = "2026-11-11 14:30:00.000000";
const RESEARCHER_ID = "a0000000-0000-4000-8000-000000000011";
const RAVI = {
  doctype: "Contact", name: "Ravi Menon-Acme Interiors", owner: ADMIN, modified_by: ADMIN, docstatus: 0, creation: STAMP,
  modified: STAMP, first_name: "Ravi", last_name: "Menon", company_name: "Acme Interiors",
};
const customer = (name, by) => ({
  doctype: "Customer", name, owner: by, modified_by: by, docstatus: 0, creation: STAMP, modified: STAMP, customer_name: name,
});

let h;          // the stub home
let tmp;        // the temp engine copy and its READY stand-in
let door;       // the brain door on port 0
let ids;        // slug -> agent id of the temp state
const tokens = {};
const homeLines = [];
let offTask;    // the question made with the switch off
let onTask;     // the question made with the switch on

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v || Date.now() > end) return v;
    await tick(20);
  }
}

const home = (method, path, body) => call(h.url, method, path, body === undefined ? {} : { body });
const toDoor = (path, body, token) => call(door.url, "POST", path, {
  body, bare: true, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const refused = (r, code) => {
  assert.equal(r.status, CODES[code][0], `${code}: ${r.text}`);
  assert.deepEqual(r.json, { error: CODES[code][1], code });
};

// door_mode.py as fence-run starts it (python3 -I), from the temp engine copy, whose config.json is the temp
// config: it reads only the temp state. Its lines as { NAME: value }.
function forRun(slug) {
  const out = execFileSync(PYTHON, ["-I", join(tmp, "engine", "fence", "door_mode.py"), "--for-run", "--agent", ids[slug]], {
    encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin" },
  });
  const lines = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const i = line.indexOf("=");
    lines[line.slice(0, i)] = line.slice(i + 1);
  }
  return lines;
}
const brainLines = (lines) => Object.keys(lines).filter((k) => k.startsWith("UUU_BRAIN"));

// A door token minted the way door_mode.py mints one (model_mode.mint with the brain door's secret), for an
// agent door_mode.py would not print one for.
function mintLikeDoorMode(agentId) {
  const fence = join(tmp, "engine", "fence");
  const script = [
    "import sys, time",
    `sys.path.insert(0, ${JSON.stringify(fence)})`,
    "import door_mode, model_mode",
    "cfg = model_mode.load_engine_config(model_mode.owner_home())",
    "secret = door_mode.read_secret(cfg, 'brainSecret')",
    "assert secret is not None",
    `print(model_mode.mint(secret, 'a', ${JSON.stringify(agentId)}, int(time.time()) + door_mode.DOOR_TOKEN_SECONDS))`,
  ].join("\n");
  return execFileSync(PYTHON, ["-I", "-c", script], { encoding: "utf8", timeout: 20_000, env: { PATH: "/usr/bin:/bin" } }).trim();
}

before(async () => {
  h = await startV2({ routes: ["ask", "inbox", "brain-index", "brain-door"], inbox: ["brain"], log: (l) => homeLines.push(String(l)) });
  h.config.minFreeDiskGb = 0;
  // The fixture's files in the temp brain, and the fixture's one Contact in the stub bench.
  for (const [rel, text] of Object.entries(FILES)) {
    const file = join(h.config.paths.knowledgeDocs, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  h.bench.state.docs.Contact = [structuredClone(RAVI)];
  // The temp state's ids gain a Researcher, so its token can be minted and refused.
  const idsFile = h.config.paths.ids;
  const data = JSON.parse(readFileSync(idsFile, "utf8"));
  data.agents.researcher = RESEARCHER_ID;
  writeFileSync(idsFile, JSON.stringify(data, null, 2));
  ids = data.agents;
  // A temp copy of the engine folder: door_mode.py, model_mode.py and the Python loader, with the temp config.
  tmp = mkdtempSync(join(tmpdir(), "uuu-brain-e2e-"));
  for (const d of ["engine/fence", "engine/lib", "engine/brain"]) mkdirSync(join(tmp, d), { recursive: true });
  for (const f of ["fence/door_mode.py", "fence/model_mode.py", "lib/config.py"]) copyFileSync(join(ENGINE, f), join(tmp, "engine", f));
  copyFileSync(join(dirname(h.state), "config.json"), join(tmp, "engine", "config.json"));
  // The index, built once from the files and the books, through the home's own indexer and a bench client
  // made as the home makes its own (the routes' ctx carries that one).
  const bench = createBench({ baseUrl: h.bench.url, site: h.config.bench.site, keyFile: h.config.paths.benchOwnerKey, booksDir: h.config.paths.books });
  await indexFor(h.config).rebuild({ config: h.config, bench, log: () => {} });
});

after(async () => {
  if (door) await door.close();
  if (h) await h.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test("the temp state is not the live one, and the index was built from the fixture's files and the books", async () => {
  assert.ok(h.state.startsWith(tmpdir()) || h.state.includes("uuu-home-stubs-"), h.state);
  assert.ok(!h.config.paths.brainIndex.includes(".paperclip"));
  // With every switch off the Brain page's routes say so and build nothing; the index built above is read directly.
  const off = await home("GET", "/api/brain/index");
  assert.equal(off.status, 409, off.text);
  assert.equal(off.json.error.code, "brain_off");
  const ix = indexFor(h.config).status();
  const listed = brainFor(h.config).list().map((f) => f.path);
  for (const rel of Object.keys(FILES)) assert.ok(listed.includes(rel), rel);
  assert.equal(ix.files, listed.length);
  assert.equal(ix.books, "ok");
  assert.ok(ix.records > 0);
  const cfg = JSON.parse(readFileSync(join(tmp, "engine", "config.json"), "utf8"));
  assert.equal(cfg.stateRoot, h.state);
});

test("switch off: a question makes no notes folder", async () => {
  assert.equal(existsSync(h.config.paths.doorsState), false, "no switches file: every door is off");
  const r = await home("POST", "/api/ask", { text: "What did we promise Acme?" });
  assert.equal(r.status, 201, r.text);
  offTask = r.json.ask.id;
  await tick(400);
  assert.equal(existsSync(h.config.paths.brainNotes), false);
});

test("switch off: door_mode.py --for-run prints no brain line for the Builder", () => {
  assert.deepEqual(brainLines(forRun("builder")), []);
});

test("the brain door starts on port 0 with the same temp state, and the switch goes on through Settings", async () => {
  ensureSecret(h.config.paths.brainSecret);
  door = createBrainDoor({ config: h.config, log: () => {} });
  await door.listen(0);
  writeFileSync(join(tmp, "engine", "brain", "READY"), "ok\n");
  h.config.engineDir = join(tmp, "engine");
  h.app.home.urls.brain = door.url;
  const view = await home("GET", "/api/brain-door");
  assert.equal(view.json.installed, true);
  assert.equal(view.json.answering, true);
  assert.equal(view.json.on, false);
  const r = await home("POST", "/api/brain-door/switch", { on: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.on, true);
  assert.deepEqual(JSON.parse(readFileSync(h.config.paths.doorsState, "utf8")).brain, { on: true });
  const readyNow = existsSync(join(ENGINE, "brain", "READY")) ? readFileSync(join(ENGINE, "brain", "READY"), "utf8") : null;
  assert.equal(readyNow, READY_BEFORE, "nothing was made or changed in the worktree's engine/brain");
});

test("switch on: --for-run prints the two brain lines for the Builder and none for the Researcher", () => {
  const builder = forRun("builder");
  assert.deepEqual(brainLines(builder).sort(), ["UUU_BRAIN_TOKEN", "UUU_BRAIN_URL"]);
  assert.equal(builder.UUU_BRAIN_URL, h.config.urls.brain);
  assert.match(builder.UUU_BRAIN_TOKEN, new RegExp(`^v1\\.a\\.${ids.builder}\\.\\d+\\.[0-9a-f]{64}$`));
  tokens.builder = builder.UUU_BRAIN_TOKEN;
  assert.deepEqual(brainLines(forRun("researcher")), []);
});

test("a question made with the switch on gets notes; the Builder's printed token reads them from the door", async () => {
  const r = await home("POST", "/api/ask", { text: "What did we promise Acme?" });
  assert.equal(r.status, 201, r.text);
  onTask = r.json.ask.id;
  const file = join(h.config.paths.brainNotes, `${onTask}.json`);
  assert.ok(await waitFor(() => existsSync(file)), `notes were written: ${homeLines.join(" | ")}`);
  const n = await toDoor("/brain/notes", { task: onTask }, tokens.builder);
  assert.equal(n.status, 200, n.text);
  assert.equal(n.json.taskId, onTask);
  assert.equal(n.json.notice, NOTICE);
  assert.ok(n.json.results.length > 0);
  assert.ok(n.json.results.some((x) => x.source === "calls/acme-call.md"));
  // The question made with the switch off still has none.
  refused(await toDoor("/brain/notes", { task: offTask }, tokens.builder), "brain_no_notes");
});

test("the door answers B7's first question for the Builder", async () => {
  const r = await toDoor("/brain/ask", { q: "what did we promise Acme" }, tokens.builder);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.notice, NOTICE);
  assert.equal(r.json.results[0].source, "calls/acme-call.md");
  assert.ok(r.json.results.some((x) => x.source === "books:Customer:Acme Interiors"));
  assert.ok(r.json.links.some((l) => l.type === "invoice_of" && l.from.type === "invoice" && l.from.name === "ACC-SINV-2026-00003"
    && l.to.type === "customer" && l.to.name === "Acme Interiors"));
  assert.deepEqual(r.json.notFound, []);
});

test("the Researcher's own token, minted the same way, is refused", async () => {
  tokens.researcher = mintLikeDoorMode(ids.researcher);
  assert.match(tokens.researcher, new RegExp(`^v1\\.a\\.${RESEARCHER_ID}\\.`));
  refused(await toDoor("/brain/ask", { q: "what did we promise Acme" }, tokens.researcher), "brain_no_token");
  refused(await toDoor("/brain/notes", { task: onTask }, tokens.researcher), "brain_no_token");
});

test("switching off through Settings makes the running door refuse the next call", async () => {
  const r = await home("POST", "/api/brain-door/switch", { on: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.on, false);
  refused(await toDoor("/brain/ask", { q: "what did we promise Acme" }, tokens.builder), "brain_off");
  refused(await toDoor("/brain/notes", { task: onTask }, tokens.builder), "brain_off");
  assert.deepEqual(brainLines(forRun("builder")), []);
});

test("a Customer an agent made never reaches an answer; one the owner made does, after a refresh", async () => {
  assert.equal((await home("POST", "/api/brain-door/switch", { on: true })).status, 200);
  const before = (await home("GET", "/api/brain/index")).json;
  h.bench.state.docs.Customer.push(customer("Zorblax Holdings", AGENT_USER), customer("Quillon Traders", ADMIN));
  const r = await home("POST", "/api/brain/index/refresh");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.leftOut, before.leftOut + 1, "the agent's Customer was left out");
  const planted = await toDoor("/brain/ask", { q: "Zorblax Holdings" }, tokens.builder);
  assert.equal(planted.status, 200, planted.text);
  assert.deepEqual(planted.json.results, []);
  assert.deepEqual(planted.json.notFound, ["zorblax", "holdings"]);
  assert.ok(!planted.text.includes("Zorblax"));
  const owners = await toDoor("/brain/ask", { q: "Quillon Traders" }, tokens.builder);
  assert.ok(owners.json.results.some((x) => x.source === "books:Customer:Quillon Traders"), owners.text);
  const find = await home("GET", `/api/brain/find?q=${encodeURIComponent("Zorblax Holdings")}`);
  assert.deepEqual(find.json.results, []);
});

test("Needs you shows the two files that disagree; Not a problem dismisses it for good", async () => {
  const items = async () => (await home("GET", "/api/inbox")).json.items.filter((i) => i.source === "brain");
  const dis = (await items()).find((i) => i.title === "Two files disagree");
  assert.ok(dis, "the disagree item is listed");
  assert.equal(dis.summary, "These two files give different figures for the same thing.");
  assert.deepEqual(dis.details.map((d) => d.label), ["Refunds", "Terms"]);
  const r = await actAsSeen(h.url, { id: dis.id, action: "dismiss" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.message, "This will not be shown again.");
  assert.equal((await items()).some((i) => i.id === dis.id), false);
});

test("what was asked shows the door's calls by agent, with no token in it", async () => {
  const view = await home("GET", "/api/brain-door");
  assert.ok(view.json.asks.some((a) => a.agent === "builder" && a.kind === "ask" && a.q === "what did we promise Acme"));
  assert.ok(view.json.asks.some((a) => a.agent === "builder" && a.kind === "notes"));
  const text = readFileSync(h.config.paths.brainAsks, "utf8");
  for (const t of Object.values(tokens)) assert.ok(!text.includes(t));
  assert.ok(!text.includes("researcher"), "a refused token is not an agent in the asks file");
});
