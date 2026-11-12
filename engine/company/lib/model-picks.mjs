// Reads engine/company/models.json (CONTRACTS-V4 C7) and picks a model for each agent from the
// provider's list. Pure: nothing here touches the network, the board or a file but the ranking.
import { readFileSync } from "node:fs";

const ID = /^[a-z0-9.-]{1,80}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NEEDS = ["reasoning", "making", "writing", "checking"];
const PROGRAMS = ["claude", "codex"];

function problem(what) {
  throw new Error(`The ranking file is not usable: ${what}.`);
}

// Returns { version, programs: { claude: RegExp, codex: RegExp }, needs: { <need>: [id] }, agents: { <slug>: [id] } }.
// agents (PLAN-V5 K8) is optional: an agent's own list, used in place of its need's list.
export function loadRanking(file) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    problem(e.code === "ENOENT" ? `${file} does not exist` : `${file} is not valid JSON`);
  }
  const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!obj(doc)) problem("it is not an object");
  if (doc.version !== 1) problem("version must be 1");
  if (!obj(doc.programs)) problem("programs is missing");
  const programs = {};
  for (const p of PROGRAMS) {
    if (typeof doc.programs[p] !== "string" || !doc.programs[p]) problem(`programs.${p} needs a pattern`);
    try {
      programs[p] = new RegExp(doc.programs[p]);
    } catch {
      problem(`programs.${p} is not a pattern that compiles`);
    }
  }
  if (!obj(doc.needs)) problem("needs is missing");
  const needs = {};
  for (const n of NEEDS) {
    const list = doc.needs[n];
    if (!Array.isArray(list)) problem(`needs.${n} must be a list of model ids`);
    for (const id of list) if (typeof id !== "string" || !ID.test(id)) problem(`needs.${n} has a bad model id (${id})`);
    needs[n] = [...list];
  }
  const agents = Object.create(null);
  if (doc.agents !== undefined) {
    if (!obj(doc.agents)) problem("agents must map agent names to lists of model ids");
    for (const [slug, list] of Object.entries(doc.agents)) {
      if (!SLUG.test(slug)) problem(`agents has a bad agent name (${slug})`);
      if (!Array.isArray(list)) problem(`agents.${slug} must be a list of model ids`);
      for (const id of list) if (typeof id !== "string" || !ID.test(id)) problem(`agents.${slug} has a bad model id (${id})`);
      agents[slug] = [...list];
    }
  }
  return { version: 1, programs, needs, agents };
}

// ranking is the result of loadRanking. Returns { picks: { slug: { model, source } }, missing: [slug],
// options: { slug: [{ id, ranked }] } }.
export function pickModels({ ranking, agents, catalogue, overrides }) {
  const inCatalogue = new Set(catalogue);
  const own = overrides || {};
  const picks = {};
  const missing = [];
  const options = {};
  for (const a of agents) {
    const ownList = ranking.agents && Object.hasOwn(ranking.agents, a.slug) ? ranking.agents[a.slug] : null;
    const list = ownList || (a.needs && ranking.needs[a.needs]) || [];
    const pattern = ranking.programs[a.tool];
    const fits = (id) => list.includes(id) && !!pattern && pattern.test(id);
    options[a.slug] = catalogue.map((id) => ({ id, ranked: fits(id) }));
    const o = Object.prototype.hasOwnProperty.call(own, a.slug) ? own[a.slug] : undefined;
    if (typeof o === "string" && inCatalogue.has(o)) {
      picks[a.slug] = { model: o, source: "owner" };
      continue;
    }
    const first = list.find((id) => inCatalogue.has(id) && fits(id));
    if (first === undefined) missing.push(a.slug);
    else picks[a.slug] = { model: first, source: "ranked" };
  }
  return { picks, missing, options };
}
