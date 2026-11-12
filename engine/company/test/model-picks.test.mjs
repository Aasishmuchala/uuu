// Checks the ranking file and the pick function (CONTRACTS-V4 C7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRanking, pickModels } from "../lib/model-picks.mjs";

const companyDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const ranking = loadRanking(join(companyDir, "models.json"));
const company = JSON.parse(readFileSync(join(companyDir, "company.json"), "utf8"));
const agents = company.agents.map((a) => ({ slug: a.slug, name: a.name, tool: a.tool, needs: a.needs }));

// The 19 ids of the brief.
const CATALOGUE = [
  "claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5",
  "claude-gpt-6-1-sol", "claude-gpt-6-astra", "claude-gpt-6-sol", "claude-gpt-6",
  "claude-kimi-k3", "claude-qwen-3-8-flash", "claude-omega-ultra", "claude-quantum-lite-1",
  "claude-glm-5", "claude-deepseek-v4", "claude-mistral-large-3", "claude-grok-5", "claude-gemini-3-lite",
];

const pick = (o = {}) => pickModels({ ranking, agents, catalogue: CATALOGUE, overrides: {}, ...o });

test("with all 19 ids the ten Claude agents get Fable 5.1, the Art director Opus 5.5 and the Checker GPT 6.1 Sol", () => {
  assert.equal(CATALOGUE.length, 19);
  const r = pick();
  assert.deepEqual(r.missing, []);
  for (const a of agents) {
    const want = a.slug === "checker" ? "claude-gpt-6-1-sol" : a.slug === "art-director" ? "claude-opus-5-5" : "claude-fable-5-1";
    assert.deepEqual(r.picks[a.slug], { model: want, source: "ranked" }, a.slug);
  }
});

test("without claude-fable-5-1, reasoning and making get fable-5 and writing gets opus-5-5", () => {
  const r = pick({ catalogue: CATALOGUE.filter((id) => id !== "claude-fable-5-1") });
  for (const a of agents) {
    if (a.slug === "art-director") assert.equal(r.picks[a.slug].model, "claude-opus-5-5");
    else if (a.needs === "reasoning" || a.needs === "making") assert.equal(r.picks[a.slug].model, "claude-fable-5", a.slug);
    if (a.needs === "writing") assert.equal(r.picks[a.slug].model, "claude-opus-5-5", a.slug);
  }
  assert.equal(r.picks.checker.model, "claude-gpt-6-1-sol");
});

test("a catalogue of only unranked models leaves all twelve agents missing", () => {
  const r = pick({ catalogue: ["claude-qwen-3-8-flash", "claude-omega-ultra", "claude-quantum-lite-1"] });
  assert.equal(r.missing.length, 12);
  assert.deepEqual(r.picks, {});
  assert.equal(r.options.builder.length, 3);
  assert.ok(r.options.builder.every((o) => o.ranked === false));
});

test("an override in the catalogue is used whatever its name, and its option is not ranked", () => {
  const r = pick({ overrides: { sales: "claude-kimi-k3" } });
  assert.deepEqual(r.picks.sales, { model: "claude-kimi-k3", source: "owner" });
  assert.equal(r.options.sales.find((o) => o.id === "claude-kimi-k3").ranked, false);
  assert.equal(r.picks.marketer.model, "claude-fable-5-1");
});

test("an override that is not in the catalogue is ignored", () => {
  const r = pick({ overrides: { sales: "claude-not-there" } });
  assert.deepEqual(r.picks.sales, { model: "claude-fable-5-1", source: "ranked" });
});

test("options list the whole catalogue in order, ranked only for the agent's own need and program", () => {
  const r = pick();
  assert.deepEqual(r.options.builder.map((o) => o.id), CATALOGUE);
  const ranked = (slug) => r.options[slug].filter((o) => o.ranked).map((o) => o.id);
  assert.deepEqual(ranked("builder"), CATALOGUE.slice(0, 6));
  assert.deepEqual(ranked("checker"), CATALOGUE.slice(6, 10));
  assert.deepEqual(ranked("art-director"), CATALOGUE.slice(0, 6), "its own list ranks the same six, opus first");
});

test("an agent's own list wins over its need's list (PLAN-V5 K8)", () => {
  assert.deepEqual(ranking.agents["art-director"],
    ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-fable-5", "claude-sonnet-5-5", "claude-sonnet-5"]);
  assert.deepEqual(Object.keys(ranking.agents), ["art-director"]);
  const noOpus = pick({ catalogue: CATALOGUE.filter((id) => !id.startsWith("claude-opus-")) });
  assert.deepEqual(noOpus.picks["art-director"], { model: "claude-fable-5-1", source: "ranked" });
  assert.equal(noOpus.picks.artist.model, "claude-fable-5-1");
  const onlyOld = pick({ catalogue: ["claude-opus-5", "claude-fable-5"] });
  assert.equal(onlyOld.picks["art-director"].model, "claude-opus-5");
  assert.equal(onlyOld.picks.artist.model, "claude-fable-5");
  // An owner's choice still wins over the agent's own list.
  assert.deepEqual(pick({ overrides: { "art-director": "claude-sonnet-5" } }).picks["art-director"], { model: "claude-sonnet-5", source: "owner" });
  // A list that does not fit the agent's program picks nothing.
  const codexList = { ...ranking, agents: { "art-director": ["claude-gpt-6"] } };
  const r = pickModels({ ranking: codexList, agents, catalogue: CATALOGUE, overrides: {} });
  assert.ok(r.missing.includes("art-director"));
  // A ranking without the block (as before) uses the need's list.
  const without = pickModels({ ranking: { ...ranking, agents: undefined }, agents, catalogue: CATALOGUE, overrides: {} });
  assert.equal(without.picks["art-director"].model, "claude-fable-5-1");
});

test("an agent without needs is missing unless overridden", () => {
  const loose = [{ slug: "x", name: "X", tool: "claude", needs: null }];
  const r = pickModels({ ranking, agents: loose, catalogue: CATALOGUE, overrides: {} });
  assert.deepEqual(r.missing, ["x"]);
  assert.deepEqual(r.picks, {});
  const o = pickModels({ ranking, agents: loose, catalogue: CATALOGUE, overrides: { x: "claude-sonnet-5" } });
  assert.deepEqual(o.missing, []);
  assert.deepEqual(o.picks.x, { model: "claude-sonnet-5", source: "owner" });
});

test("the real company.json gives every agent a need", () => {
  assert.equal(agents.length, 12);
  for (const a of agents) assert.ok(["reasoning", "making", "writing", "checking"].includes(a.needs), a.slug);
});

test("in the real models.json the lists fit their programs and no ranked id is a small or odd model", () => {
  for (const n of ["reasoning", "making", "writing"]) {
    for (const id of ranking.needs[n]) assert.match(id, ranking.programs.claude, `${n} ${id}`);
  }
  for (const id of ranking.needs.checking) assert.match(id, ranking.programs.codex, id);
  for (const id of ranking.agents["art-director"]) assert.match(id, ranking.programs.claude, id);
  for (const list of [...Object.values(ranking.needs), ...Object.values(ranking.agents)]) {
    for (const id of list) assert.doesNotMatch(id, /flash|lite|omega|quantum/, id);
  }
});

test("loadRanking refuses a file with the wrong shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "ranking-"));
  try {
    const good = { version: 1, programs: { claude: "^a", codex: "^b" }, needs: { reasoning: ["a-1"], making: [], writing: [], checking: ["b-1"] } };
    const bad = (mut) => {
      const doc = JSON.parse(JSON.stringify(good));
      mut(doc);
      const f = join(dir, "r.json");
      writeFileSync(f, JSON.stringify(doc));
      return () => loadRanking(f);
    };
    assert.doesNotThrow(bad(() => {}));
    assert.throws(bad((d) => { d.programs.claude = "("; }), /compiles/);
    assert.throws(bad((d) => { delete d.programs.codex; }), /codex/);
    assert.throws(bad((d) => { d.needs.writing = "x"; }), /writing/);
    assert.throws(bad((d) => { d.needs.making = ["Bad ID"]; }), /bad model id/);
    assert.throws(bad((d) => { delete d.needs.checking; }), /checking/);
    assert.deepEqual({ ...bad(() => {})().agents }, {}, "the agents block is optional");
    assert.doesNotThrow(bad((d) => { d.agents = { "art-director": ["a-1"] }; }));
    assert.throws(bad((d) => { d.agents = ["a-1"]; }), /agents must map/);
    assert.throws(bad((d) => { d.agents = { "Art Director": ["a-1"] }; }), /bad agent name/);
    assert.throws(bad((d) => { d.agents = { "art-director": "a-1" }; }), /agents\.art-director must be a list/);
    assert.throws(bad((d) => { d.agents = { "art-director": ["Bad ID"] }; }), /agents\.art-director has a bad model id/);
    assert.throws(() => loadRanking(join(dir, "none.json")), /does not exist/);
    writeFileSync(join(dir, "junk.json"), "{");
    assert.throws(() => loadRanking(join(dir, "junk.json")), /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
