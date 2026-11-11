// Checks the company file and the nine role instructions (CONTRACTS section 5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const companyDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = JSON.parse(readFileSync(join(companyDir, "company.json"), "utf8"));
const bySlug = Object.fromEntries(file.agents.map((a) => [a.slug, a]));

// The nine agents as pinned in CONTRACTS section 5.
const PINNED = [
  { slug: "chief-of-staff", name: "Chief of staff", paperclipRole: "pm", tool: "claude", model: "opus", reportsTo: null },
  { slug: "builder", name: "Builder", paperclipRole: "engineer", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
  { slug: "checker", name: "Checker", paperclipRole: "qa", tool: "codex", model: null, reportsTo: "chief-of-staff" },
  { slug: "bookkeeper", name: "Bookkeeper", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
  { slug: "sales", name: "Sales", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
  { slug: "support", name: "Support", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
  { slug: "people", name: "People", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
  { slug: "marketer", name: "Marketer", paperclipRole: "general", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
  { slug: "drafter", name: "Drafter", paperclipRole: "designer", tool: "claude", model: "sonnet", reportsTo: "chief-of-staff" },
];
const BENCH = { bookkeeper: "Engine Bookkeeper", sales: "Engine Sales", support: "Engine Support", people: "Engine People" };

// What an agent ends up with once its overrides are laid over the defaults, key by key.
function effective(agent) {
  const d = file.defaults;
  return {
    limits: { ...d.limits, ...(agent.limits || {}) },
    rights: { ...d.rights, ...(agent.rights || {}) },
    fencePolicy: { ...d.fencePolicy, ...(agent.fencePolicy || {}) },
  };
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

test("nine agents, bosses first, with the pinned slugs, tools, models and bosses", () => {
  assert.deepEqual(file.agents.map((a) => a.slug), PINNED.map((p) => p.slug));
  for (const p of PINNED) {
    const a = bySlug[p.slug];
    for (const key of ["name", "paperclipRole", "tool", "model", "reportsTo"]) {
      assert.equal(a[key], p[key], `${p.slug}.${key}`);
    }
    assert.equal(a.role, p.name, `${p.slug}.role`);
    assert.equal(a.title, p.name, `${p.slug}.title`);
    assert.equal(a.instructions, `roles/${p.slug}.md`);
    assert.ok(typeof a.capabilities === "string" && a.capabilities.length > 10, `${p.slug} capabilities`);
  }
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
  };
  for (const slug of Object.keys(BENCH)) {
    expected[slug] = { ...base, fencePolicy: { ...base.fencePolicy,
      localServices: ["127.0.0.1:8120"], envFile: `{state}/secrets/agents/${slug}.env` } };
  }
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
});

test("every instructions file exists, is 60 to 120 lines and names no absolute path", () => {
  const files = readdirSync(join(companyDir, "roles")).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(files, PINNED.map((p) => `${p.slug}.md`).sort());
  for (const a of file.agents) {
    const path = join(companyDir, a.instructions);
    assert.ok(existsSync(path), path);
    const text = readFileSync(path, "utf8");
    const lines = text.replace(/\n$/, "").split("\n").length;
    assert.ok(lines >= 60 && lines <= 120, `${a.slug}: ${lines} lines`);
    assert.ok(text.includes("current working folder"), `${a.slug}: current working folder`);
    assert.ok(!text.includes("/Users/"), `${a.slug}: /Users/`);
    assert.ok(!text.includes("~/"), `${a.slug}: ~/`);
    assert.ok(text.includes("$UUU_LESSONS_FILE"), `${a.slug}: lessons file`);
    assert.ok(text.includes("$UUU_KNOWLEDGE_DIR"), `${a.slug}: knowledge folder`);
    assert.ok(text.includes("blocked"), `${a.slug}: blocked`);
  }
});

test("the parts every file has come in the pinned order", () => {
  const parts = ["## Who you are", "## Standing rules", "## How you start", "## Your job", "## How you finish", "## When you are stuck"];
  for (const a of file.agents) {
    const text = readFileSync(join(companyDir, a.instructions), "utf8");
    const at = parts.map((p) => text.indexOf(p));
    assert.ok(at.every((i) => i >= 0), `${a.slug}: missing a part`);
    assert.deepEqual([...at].sort((x, y) => x - y), at, `${a.slug}: parts out of order`);
  }
});

test("each role teaches its formats", () => {
  const read = (slug) => readFileSync(join(companyDir, "roles", `${slug}.md`), "utf8");
  const checker = read("checker");
  assert.ok(checker.includes("VERDICT: PASS"));
  assert.ok(checker.includes("VERDICT: FAIL"));
  const chief = read("chief-of-staff");
  assert.ok(chief.includes("RESULT:"));
  assert.ok(chief.includes("{{TEAM}}"));
  for (const slug of Object.keys(BENCH)) {
    const t = read(slug);
    assert.ok(t.includes("DRAFT:"), `${slug}: DRAFT:`);
    assert.ok(t.includes("UUU_BENCH_URL"), `${slug}: UUU_BENCH_URL`);
    assert.ok(t.includes("X-Frappe-Site-Name: $UUU_BENCH_SITE"), `${slug}: site header`);
    assert.ok(t.includes("Authorization: token $UUU_BENCH_API_KEY:$UUU_BENCH_API_SECRET"), `${slug}: auth header`);
  }
  assert.ok(read("support").includes("DRAFT REPLY:"));
  const marketer = read("marketer");
  for (const s of ["title:", "channel:", "planned:", "content/<slug>.md"]) assert.ok(marketer.includes(s), `marketer: ${s}`);
  const drafter = read("drafter");
  for (const s of ['"$UUU_CAD_PYTHON" "$UUU_CAD_EXPORT" <name>.py', "result", "millimetres"]) assert.ok(drafter.includes(s), `drafter: ${s}`);
});
