// Checks the company file (CONTRACTS section 5, CONTRACTS-V2 21.2), the shared staged text
// (21.3) and what loadCompanyFile makes of them. The role files are checked in roles.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../lib/config.mjs";
import { FileProblem, loadCompanyFile } from "../lib/company-file.mjs";

const companyDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = join(companyDir, "..");
const file = JSON.parse(readFileSync(join(companyDir, "company.json"), "utf8"));
const bySlug = Object.fromEntries(file.agents.map((a) => [a.slug, a]));

// The ten agents as pinned in CONTRACTS section 5 and CONTRACTS-V2 21.2.
const PINNED = [
  { slug: "chief-of-staff", name: "Chief of staff", paperclipRole: "pm", tool: "claude", model: "opus", reportsTo: null, department: null },
  { slug: "builder", name: "Builder", paperclipRole: "engineer", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: null },
  { slug: "checker", name: "Checker", paperclipRole: "qa", tool: "codex", model: null, reportsTo: "chief-of-staff", department: null },
  { slug: "bookkeeper", name: "Bookkeeper", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "books" },
  { slug: "sales", name: "Sales", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "customers" },
  { slug: "support", name: "Support", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "support" },
  { slug: "people", name: "People", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "people" },
  { slug: "marketer", name: "Marketer", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "marketing" },
  { slug: "drafter", name: "Drafter", paperclipRole: "designer", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "studio" },
  { slug: "artist", name: "Artist", paperclipRole: "designer", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff", department: "studio" },
];
const BENCH = { bookkeeper: "Engine Bookkeeper", sales: "Engine Sales", support: "Engine Support", people: "Engine People" };
// The markers of CONTRACTS-V2 15.1 and the document names of 15.2 to 15.4.
const MARKERS = ["SIZE:", "PLAN READY:", "PLAN ACCEPTED", "ANSWER:", "STOPPED:", "RESULT:", "VERDICT: PASS", "VERDICT: FAIL", "FOR:", "PLAN FIRST", "ROUTINE:"];
const DOCUMENTS = ["00-brief.md", "01-plan.md", "04-summary.md"];
const HEADINGS = [
  "# Brief: {title}", "## The goal in the owner's words", "## What done looks like", "## Must-haves", "## Nice-to-haves", "## Anything unclear",
  "# Plan: {title}", "## Approach", "## What will be produced", "## Steps", "needs:",
  "# Summary: {title}", "## What was done", "## Files", "## What is left",
];

// What an agent ends up with once its overrides are laid over the defaults, key by key.
function effective(agent) {
  const d = file.defaults;
  return {
    limits: { ...d.limits, ...(agent.limits || {}) },
    rights: { ...d.rights, ...(agent.rights || {}) },
    fencePolicy: { ...d.fencePolicy, ...(agent.fencePolicy || {}) },
  };
}

// A config whose state folder is a temp path, so nothing here points at the live engine.
function tempConfig(dir) {
  const cfg = JSON.parse(readFileSync(join(engineDir, "config.json"), "utf8"));
  cfg.stateRoot = join(dir, "state");
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(cfg));
  return loadConfig({ path });
}

// A copy of the company folder (without its tests) that a test may change.
function withCopy(fn) {
  const dir = mkdtempSync(join(tmpdir(), "uuu-company-file-"));
  try {
    cpSync(companyDir, join(dir, "company"), { recursive: true, filter: (src) => !src.startsWith(join(companyDir, "test")) });
    return fn(join(dir, "company"), tempConfig(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("company, project and defaults are as pinned", () => {
  assert.deepEqual(file.company, { name: "Sthyra", requireOwnerApprovalForNewAgents: true });
  assert.deepEqual(file.project, { name: "Company work", folder: "{state}/tasks/company-work" });
  assert.deepEqual(file.defaults.limits, { maxConcurrentRuns: 1, runMinutes: 15, maxTurns: 40 });
  assert.deepEqual(file.defaults.rights, { canAssignTasks: false, canCreateAgents: false, canCreateSkills: false });
  assert.deepEqual(file.defaults.fencePolicy, {
    localServices: [], readFolders: ["{state}/knowledge/docs"],
    lessonsFile: "{state}/lessons/{slug}.md", envFile: null, taskFolder: "read-write",
  });
});

test("ten agents, bosses first, with the pinned slugs, tools, models, bosses and departments", () => {
  assert.deepEqual(file.agents.map((a) => a.slug), PINNED.map((p) => p.slug));
  for (const p of PINNED) {
    const a = bySlug[p.slug];
    for (const key of ["name", "paperclipRole", "tool", "model", "reportsTo", "department"]) {
      assert.ok(key in a, `${p.slug}.${key} is written out`);
      assert.equal(a[key], p[key], `${p.slug}.${key}`);
    }
    assert.equal(a.role, p.name, `${p.slug}.role`);
    assert.equal(a.title, p.name, `${p.slug}.title`);
    assert.equal(a.instructions, `roles/${p.slug}.md`);
    assert.ok(typeof a.capabilities === "string" && a.capabilities.length > 10, `${p.slug} capabilities`);
  }
  assert.equal(bySlug.artist.capabilities, "Draws sprites, animations and simple images by script, with frame data other tools can read.");
});

test("overrides are as pinned and nothing else differs from the defaults", () => {
  const e = Object.fromEntries(file.agents.map((a) => [a.slug, effective(a)]));
  const base = effective({});
  const expected = {
    "chief-of-staff": { ...base, rights: { ...base.rights, canAssignTasks: true } },
    builder: base,
    checker: { ...base, fencePolicy: { ...base.fencePolicy, taskFolder: "read-only" } },
    marketer: base,
    drafter: { ...base, limits: { ...base.limits, maxTurns: 60 },
      fencePolicy: { ...base.fencePolicy, readFolders: ["{state}/knowledge/docs", "{state}/cad"],
        envFile: "{state}/secrets/agents/drafter.env" } },
    artist: { ...base, limits: { ...base.limits, maxTurns: 60 },
      fencePolicy: { ...base.fencePolicy, readFolders: ["{state}/knowledge/docs", "{state}/art", "{state}/media"],
        envFile: "{state}/secrets/agents/artist.env" } },
  };
  for (const slug of Object.keys(BENCH)) {
    expected[slug] = { ...base, fencePolicy: { ...base.fencePolicy,
      localServices: ["127.0.0.1:8120"], envFile: `{state}/secrets/agents/${slug}.env` } };
  }
  assert.deepEqual(Object.keys(expected).sort(), PINNED.map((p) => p.slug).sort());
  for (const slug of Object.keys(expected)) assert.deepEqual(e[slug], expected[slug], slug);
});

test("bench logins only for the four department agents", () => {
  for (const a of file.agents) {
    if (BENCH[a.slug]) assert.deepEqual(a.bench, { user: `${a.slug}@engine.localhost`, role: BENCH[a.slug] });
    else assert.equal(a.bench, null, a.slug);
  }
});

test("only the Chief of staff can assign tasks; nobody can create agents or skills", () => {
  for (const a of file.agents) {
    const r = effective(a).rights;
    assert.equal(r.canAssignTasks, a.slug === "chief-of-staff", a.slug);
    assert.equal(r.canCreateAgents, false, a.slug);
    assert.equal(r.canCreateSkills, false, a.slug);
  }
});

test("the file lists no grants: paperclip's grants are not applied, the gate blocks them", () => {
  assert.equal("grants" in file.defaults, false);
  for (const a of file.agents) assert.equal("grants" in a, false, a.slug);
  assert.ok(!readFileSync(join(companyDir, "company.json"), "utf8").includes('"grants"'));
});

test("a fence policy may read the art and media folders, and nothing else changed in the allowed list", () => {
  const cfg = JSON.parse(readFileSync(join(engineDir, "config.json"), "utf8"));
  assert.deepEqual(cfg.fence.readRootsAllowed, ["knowledge/docs", "lessons", "cad", "art", "media"]);
});

test("every agent has its instructions file, and there is no other", () => {
  const files = readdirSync(join(companyDir, "roles")).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(files, PINNED.map((p) => `${p.slug}.md`).sort());
  for (const a of file.agents) assert.ok(existsSync(join(companyDir, a.instructions)), a.slug);
});

test("shared/staged.md names every marker and every document, with the pinned headings", () => {
  const text = readFileSync(join(companyDir, "shared", "staged.md"), "utf8");
  for (const m of MARKERS) assert.ok(text.includes(m), `marker ${m}`);
  for (const d of DOCUMENTS) assert.ok(text.includes(d), `document ${d}`);
  for (const h of HEADINGS) assert.ok(text.includes(h), `heading ${h}`);
  const lines = text.replace(/\n$/, "").split("\n").length;
  assert.ok(lines >= 35 && lines <= 50, `${lines} lines`);
  assert.ok(text.includes("current working folder"));
  assert.ok(!text.includes("/Users/") && !text.includes("~/"), "no absolute path");
  assert.ok(!text.includes("{{"), "no placeholder of its own");
  for (const tool of ["paperclip", "Frappe", "ERPNext", "Claude", "Codex", "CadQuery", "Pillow", "Aseprite"]) {
    assert.ok(!text.toLowerCase().includes(tool.toLowerCase()), `names no tool: ${tool}`);
  }
});

test("loadCompanyFile returns ten agents with their departments and the Artist's policy", () => {
  withCopy((dir, config) => {
    const c = loadCompanyFile(join(dir, "company.json"), config);
    assert.deepEqual(c.agents.map((a) => [a.slug, a.department]), PINNED.map((p) => [p.slug, p.department]));
    const artist = c.agents.find((a) => a.slug === "artist");
    assert.equal(artist.role, "designer");
    assert.equal(artist.limits.maxTurns, 60);
    assert.deepEqual(artist.policy.readFolders, [join(config.paths.state, "knowledge", "docs"), join(config.paths.state, "art"),
      join(config.paths.state, "media")]);
    assert.equal(artist.policy.envFile, join(config.paths.state, "secrets", "agents", "artist.env"));
    assert.equal(artist.reportsTo, "chief-of-staff");
  });
});

test("only the Artist's policy may read the media folder (the owner's footage and the speech model)", () => {
  withCopy((dir, config) => {
    const c = loadCompanyFile(join(dir, "company.json"), config);
    const media = join(config.paths.state, "media").toLowerCase();
    // Any read folder at or under state/media, in any letter case (this disk ignores case).
    const readsMedia = (a) => (a.policy?.readFolders || []).some((f) => {
      const x = String(f).toLowerCase().replace(/\/+$/, "");
      return x === media || x.startsWith(`${media}/`);
    });
    assert.deepEqual(c.agents.filter(readsMedia).map((a) => a.slug), ["artist"]);
  });
  // And in the file itself, every agent but the Artist names no folder under {state}/media.
  for (const a of file.agents) {
    if (a.slug === "artist") continue;
    for (const f of a.fencePolicy?.readFolders || []) assert.doesNotMatch(String(f), /\{state\}\/media(\/|$)/i, a.slug);
  }
});

test("loadCompanyFile refuses a department that is not one of the six", () => {
  withCopy((dir, config) => {
    const f = join(dir, "company.json");
    const doc = JSON.parse(readFileSync(f, "utf8"));
    for (const bad of ["finance", "", 3, true, ["books"]]) {
      doc.agents[3].department = bad;
      writeFileSync(f, JSON.stringify(doc));
      assert.throws(() => loadCompanyFile(f, config), (e) => e instanceof FileProblem && /department/.test(e.message), String(bad));
    }
    delete doc.agents[3].department;
    writeFileSync(f, JSON.stringify(doc));
    assert.equal(loadCompanyFile(f, config).agents[3].department, null);
  });
});

test("loadCompanyFile folds the shared staged text into {{STAGED}}, and a role without it still loads", () => {
  withCopy((dir, config) => {
    const staged = readFileSync(join(dir, "shared", "staged.md"), "utf8").replace(/\n+$/, "");
    writeFileSync(join(dir, "roles", "builder.md"), "# Builder\n\nBefore.\n\n{{STAGED}}\n\nAfter.\n");
    writeFileSync(join(dir, "roles", "checker.md"), "# Checker\n\nNo shared text here.\n");
    const c = loadCompanyFile(join(dir, "company.json"), config);
    const by = Object.fromEntries(c.agents.map((a) => [a.slug, a]));
    assert.equal(by.builder.instructions, `# Builder\n\nBefore.\n\n${staged}\n\nAfter.\n`);
    assert.equal(by.checker.instructions, "# Checker\n\nNo shared text here.\n");
    assert.ok(!by.artist.instructions.includes("{{STAGED}}"));
    assert.ok(by.artist.instructions.includes(staged));
  });
});

test("loadCompanyFile refuses the file when a role asks for the shared text and it is missing", () => {
  withCopy((dir, config) => {
    rmSync(join(dir, "shared"), { recursive: true, force: true });
    assert.throws(() => loadCompanyFile(join(dir, "company.json"), config), (e) => e instanceof FileProblem && /staged\.md/.test(e.message));
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "shared", "staged.md"), "Shared.\n");
    const c = loadCompanyFile(join(dir, "company.json"), config);
    assert.ok(c.agents.find((a) => a.slug === "artist").instructions.includes("\nShared.\n"));
  });
});
