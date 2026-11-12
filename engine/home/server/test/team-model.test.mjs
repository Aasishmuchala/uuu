// The roles (CONTRACTS-V2 16.4): loading the company file, departments, profiles and agent cards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBoard } from "../lib/board.mjs";
import { createDecisions } from "../lib/decisions.mjs";
import { readShape, sameShape } from "../lib/shape.mjs";
import { loadTaskContext } from "../lib/tasks.mjs";
import { agentCards, DEPARTMENTS, loadRoles, profileOf } from "../lib/team.mjs";
import { startV2 } from "../lib/testing-v2.mjs";

const SLUGS = ["chief-of-staff", "builder", "checker", "bookkeeper", "sales", "support", "people", "marketer", "drafter", "artist"];
const DEPT = {
  "chief-of-staff": null, builder: null, checker: null, bookkeeper: "books", sales: "customers",
  support: "support", people: "people", marketer: "marketing", drafter: "studio", artist: "studio",
};

let h;
before(async () => { h = await startV2({ inbox: ["board", "goals"] }); });
after(async () => { await h?.close(); });

function makeCtx(log = () => {}) {
  const config = h.config;
  const ids = () => JSON.parse(readFileSync(config.paths.ids, "utf8"));
  return {
    config, ids, log,
    board: createBoard({ baseUrl: config.urls.board, ids, companyName: config.paperclip.companyName }),
    decisions: createDecisions(join(config.paths.homeData, "decisions.json")),
    home: h.app.home,
  };
}

test("loadRoles: ten roles in file order, with departments and filled instructions", () => {
  const roles = loadRoles(h.config);
  assert.deepEqual(roles.map((r) => r.slug), SLUGS);
  for (const r of roles) {
    for (const k of ["slug", "name", "title", "summary", "department", "reportsTo", "toolId", "model", "limits", "rights", "policy", "instructions"]) {
      assert.ok(k in r, `${r.slug} has ${k}`);
    }
    assert.equal(r.department, DEPT[r.slug], r.slug);
    assert.ok(r.instructions.length > 100, r.slug);
    assert.ok(!r.instructions.includes("{{"), `${r.slug}: no {{ left`);
    assert.ok(["claude", "codex"].includes(r.toolId), r.slug);
  }
  const artist = roles.find((r) => r.slug === "artist");
  assert.equal(artist.name, "Artist");
  assert.equal(artist.reportsTo, "chief-of-staff");
  assert.equal(artist.limits.maxTurns, 60);
  assert.equal(artist.summary, "Draws sprites, animations and simple images by script, with frame data other tools can read.");
  assert.equal(roles.find((r) => r.slug === "chief-of-staff").reportsTo, null);
  assert.equal(loadRoles(h.config), roles, "a second call is served from the cache");
});

test("DEPARTMENTS: the six, in order, with their agents", () => {
  assert.deepEqual(DEPARTMENTS.map((d) => [d.id, d.title]), [
    ["books", "Books"], ["customers", "Customers"], ["support", "Support"], ["people", "People"],
    ["marketing", "Marketing"], ["studio", "Studio"],
  ]);
  assert.deepEqual(DEPARTMENTS.find((d) => d.id === "studio").agents, ["drafter", "artist"]);
  for (const d of DEPARTMENTS) for (const slug of d.agents) assert.equal(DEPT[slug], d.id, slug);
});

test("profileOf: each sentence of the table for the role it belongs to", () => {
  const roles = loadRoles(h.config);
  const ALWAYS = ["Works inside its task folder and nowhere else on this Mac.", "Reads the company's documents and its own lessons before it starts."];
  const NEVER = ["Cannot send anything outside the company.", "Cannot read your own files.", "Cannot create or change agents."];
  const BOOKS_MAY = "Prepares drafts in the books. Nothing is final until you approve it.";
  const BOOKS_NOT = "Cannot make a draft final, cancel it or delete it.";
  const extra = {
    "chief-of-staff": ["Hands tasks to the other agents."],
    builder: [],
    checker: ["Reads the work it checks. It cannot change it."],
    bookkeeper: [BOOKS_MAY], sales: [BOOKS_MAY], support: [BOOKS_MAY], people: [BOOKS_MAY],
    marketer: [],
    drafter: ["Makes CAD parts with its own tools."],
    artist: ["Draws sprites, animations and simple images with its own tools."],
  };
  const labels = {
    "chief-of-staff": "Planning and handing out work", builder: "Documents and files", checker: "Reading and checking",
    bookkeeper: "The books (drafts only)", sales: "The customer records", support: "The support desk",
    people: "The staff records", marketer: "The content calendar", drafter: "CAD tools", artist: "Drawing tools",
  };
  for (const role of roles) {
    const p = profileOf(role, h.config);
    const books = extra[role.slug].includes(BOOKS_MAY);
    assert.deepEqual(p.may, [...ALWAYS, ...extra[role.slug]], role.slug);
    assert.deepEqual(p.mayNot, books ? [...NEVER, BOOKS_NOT] : NEVER, role.slug);
    assert.equal(p.tool.label, labels[role.slug], role.slug);
    assert.equal(p.tool.installed, true, `${role.slug}: the stub state has every tool`);
    assert.deepEqual(p.limits, { runMinutes: role.limits.runMinutes, maxTurns: role.limits.maxTurns, oneAtATime: true }, role.slug);
  }
  const shape = readShape("agent").profile;
  assert.deepEqual(sameShape(shape, profileOf(roles[0], h.config)), []);
});

test("profileOf: tools that are not installed say so", () => {
  const roles = loadRoles(h.config);
  const empty = mkdtempSync(join(tmpdir(), "uuu-team-empty-"));
  try {
    const bare = { ...h.config, paths: { ...h.config.paths, state: empty, books: join(empty, "books"), cadPython: join(empty, "cad", "venv", "bin", "python") } };
    const by = Object.fromEntries(roles.map((r) => [r.slug, profileOf(r, bare).tool.installed]));
    for (const slug of ["bookkeeper", "sales", "support", "people", "drafter", "artist"]) assert.equal(by[slug], false, slug);
    for (const slug of ["chief-of-staff", "builder", "checker", "marketer"]) assert.equal(by[slug], true, slug);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("agentCards: every role in file order, fitting agent-card", async () => {
  const ctx = makeCtx();
  const cards = agentCards(ctx, await loadTaskContext(ctx));
  assert.deepEqual(cards.map((c) => c.slug), SLUGS);
  for (const c of cards) assert.deepEqual(sameShape(readShape("agent-card"), c), [], c.slug);
  const by = Object.fromEntries(cards.map((c) => [c.slug, c]));
  assert.equal(by.artist.id, "a0000000-0000-4000-8000-000000000010");
  assert.equal(by.artist.applied, true);
  assert.equal(by.artist.department, "studio");
  assert.deepEqual(by.artist.reportsTo, { slug: "chief-of-staff", name: "Chief of staff" });
  assert.equal(by["chief-of-staff"].reportsTo, null);
  assert.equal(by.marketer.state, "working");
  assert.equal(by.marketer.plainState, "Working");
  assert.equal(by.marketer.doingNow.taskId, "e0000000-0000-4000-8000-000000000015");
  assert.equal(by.checker.state, "free");
  assert.equal(by.checker.doingNow, null);
  assert.equal(by["chief-of-staff"].waitingForYou, true, "finished tasks wait for the owner");
});

test("agentCards: a role not on the board, and the board off", async () => {
  const ctx = makeCtx();
  const tctx = await loadTaskContext(ctx, { withInbox: false, withComments: false });
  const artistId = "a0000000-0000-4000-8000-000000000010";
  const without = { ...tctx, ids: { ...tctx.ids, agents: { ...tctx.ids.agents, artist: undefined } }, agentList: tctx.agentList.filter((a) => a.id !== artistId) };
  const artist = agentCards(ctx, without).find((c) => c.slug === "artist");
  assert.equal(artist.applied, false);
  assert.equal(artist.id, null);
  assert.equal(artist.state, "free");
  assert.deepEqual(sameShape(readShape("agent-card"), artist), []);

  const off = agentCards(ctx, null);
  assert.equal(off.length, 10);
  for (const c of off) {
    assert.equal(c.state, "free");
    assert.equal(c.plainState, "Not known");
    assert.equal(c.applied, null, "not known while the board is off, so no page says to set it up");
    assert.deepEqual(sameShape(readShape("agent-card"), c), [], c.slug);
  }
});

test("loadRoles: a company file that cannot be read gives an empty list and one logged line", () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-team-bad-"));
  try {
    const lines = [];
    const config = { ...h.config, engineDir: dir };
    assert.deepEqual(loadRoles(config, { log: (l) => lines.push(l) }), []);
    assert.deepEqual(loadRoles(config, { log: (l) => lines.push(l) }), []);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /company file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadRoles: reloads when a file's modified time changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "uuu-team-copy-"));
  try {
    cpSync(join(h.config.engineDir, "company"), join(dir, "company"), { recursive: true, filter: (src) => !src.includes(`${join("company", "test")}`) });
    const config = { ...h.config, engineDir: dir };
    const first = loadRoles(config);
    assert.equal(first.length, 10);
    const file = join(dir, "company", "company.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    doc.agents[1].capabilities = "Changed for the test.";
    writeFileSync(file, JSON.stringify(doc, null, 2));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const second = loadRoles(config);
    assert.notEqual(second, first);
    assert.equal(second[1].summary, "Changed for the test.");
    const role = join(dir, "company", "roles", "builder.md");
    writeFileSync(role, readFileSync(role, "utf8") + "\nOne more line.\n");
    utimesSync(role, new Date(Date.now() + 10000), new Date(Date.now() + 10000));
    assert.match(loadRoles(config)[1].instructions, /One more line\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
