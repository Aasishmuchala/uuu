// Reads engine/company/departments.json (CONTRACTS-V3 31.1): the seven departments around the
// map, their agents and their clusters. A department that breaks a rule is left out; each
// problem is one plain sentence, with the file it is in. Nothing here touches the board.
import { lstatSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { plainList } from "./routine-files.mjs";

const KEYS = ["id", "title", "line", "agents", "dashboard", "clusters"];
const CLUSTER_KEYS = ["id", "title"];
export const DEPARTMENT_ID = /^[a-z][a-z0-9-]{1,30}$/;
// The six department pages of version 2 (CONTRACTS-V2 21.2); a department's dashboard is one of them.
export const DASHBOARDS = ["books", "customers", "support", "people", "marketing", "studio"];
const MAX_BYTES = 64 * 1024;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, most) => typeof v === "string" && v.trim().length >= 1 && v.length <= most;

// Every problem of one department (n counts from 1), as plain sentences.
function departmentProblems(d, n, slugs) {
  const out = [];
  const label = obj(d) && typeof d.id === "string" && DEPARTMENT_ID.test(d.id) ? `The department ${d.id}` : `Department ${n}`;
  if (!obj(d)) return [`${label} is not a department.`];
  const missing = KEYS.filter((k) => !(k in d));
  const extra = Object.keys(d).filter((k) => !KEYS.includes(k));
  if (missing.length) out.push(`${label} has no ${plainList(missing)}.`);
  if (extra.length) out.push(`${label} has keys a department does not take: ${plainList(extra, "and")}.`);
  if ("id" in d && (typeof d.id !== "string" || !DEPARTMENT_ID.test(d.id))) out.push(`${label} needs an id of 2 to 31 lower-case letters, digits and dashes, starting with a letter.`);
  if ("title" in d && !text(d.title, 40)) out.push(`${label} needs a title of 1 to 40 characters.`);
  if ("line" in d && !text(d.line, 60)) out.push(`${label} needs a line of 1 to 60 characters.`);
  if ("agents" in d) {
    if (!Array.isArray(d.agents) || !d.agents.every((a) => typeof a === "string")) out.push(`${label} needs its agents as a list of names from the company file.`);
    else {
      const unknown = d.agents.filter((a) => !slugs.includes(a));
      if (unknown.length) out.push(`${label} names agents that are not in the company file: ${plainList(unknown, "and")}.`);
      if (new Set(d.agents).size !== d.agents.length) out.push(`${label} names the same agent twice.`);
    }
  }
  if ("dashboard" in d && d.dashboard !== null && !DASHBOARDS.includes(d.dashboard)) {
    out.push(`${label} needs a dashboard of ${plainList(DASHBOARDS)}, or none.`);
  }
  if ("clusters" in d) {
    const c = d.clusters;
    if (!Array.isArray(c) || c.length < 1 || c.length > 5) out.push(`${label} must have 1 to 5 clusters.`);
    else {
      const ids = new Set();
      c.forEach((x, i) => {
        const cl = `${label}'s cluster ${i + 1}`;
        if (!obj(x)) { out.push(`${cl} is not a cluster.`); return; }
        const cMissing = CLUSTER_KEYS.filter((k) => !(k in x));
        const cExtra = Object.keys(x).filter((k) => !CLUSTER_KEYS.includes(k));
        if (cMissing.length) out.push(`${cl} has no ${plainList(cMissing)}.`);
        if (cExtra.length) out.push(`${cl} has keys a cluster does not take: ${plainList(cExtra, "and")}.`);
        if ("id" in x && (typeof x.id !== "string" || !DEPARTMENT_ID.test(x.id))) out.push(`${cl} needs an id of 2 to 31 lower-case letters, digits and dashes, starting with a letter.`);
        else if ("id" in x && ids.has(x.id)) out.push(`${cl} has the same id as another cluster.`);
        if ("title" in x && !text(x.title, 40)) out.push(`${cl} needs a title of 1 to 40 characters.`);
        ids.add(x.id);
      });
    }
  }
  return out;
}

// roles: the agents of the company file ({ slug, ... }).
export function loadDepartmentFile(file, roles = []) {
  const departments = [];
  const problems = [];
  const name = basename(file);
  const say = (problem) => problems.push({ file: name, problem });
  let doc;
  try {
    const st = lstatSync(file);
    if (!st.isFile()) { say("It is not a plain file."); return { departments, problems }; }
    if (st.size > MAX_BYTES) { say("It is too large for a department file."); return { departments, problems }; }
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    say(e.code === "ENOENT" ? "It does not exist." : "It is not valid JSON.");
    return { departments, problems };
  }
  if (!obj(doc) || Object.keys(doc).length !== 1 || !Array.isArray(doc.departments)) {
    say("It should be one object with the departments as a list, and nothing else.");
    return { departments, problems };
  }
  if (doc.departments.length < 1) { say("It has no departments."); return { departments, problems }; }

  const slugs = roles.map((r) => r.slug);
  const ids = new Set();
  const owner = new Map();
  // Who is named where, counted even for a department left out, so one mistake is one sentence.
  const named = new Set();
  doc.departments.forEach((d, i) => {
    const found = departmentProblems(d, i + 1, slugs);
    const agents = obj(d) && Array.isArray(d.agents) ? d.agents.filter((a) => typeof a === "string") : [];
    for (const a of agents) named.add(a);
    if (!found.length && ids.has(d.id)) found.push(`The department ${d.id} is listed twice.`);
    if (!found.length) {
      const twice = d.agents.filter((a) => owner.has(a));
      for (const a of twice) found.push(`The agent ${a} is in the department ${owner.get(a)} and in the department ${d.id}; an agent works in one department.`);
    }
    if (found.length) { for (const p of found) say(p); return; }
    ids.add(d.id);
    for (const a of d.agents) owner.set(a, d.id);
    departments.push({
      id: d.id, title: d.title, line: d.line, agents: [...d.agents], dashboard: d.dashboard,
      clusters: d.clusters.map((c) => ({ id: c.id, title: c.title })),
    });
  });
  const homeless = slugs.filter((s) => !named.has(s));
  if (homeless.length) say(`These agents of the company file are in no department: ${plainList(homeless, "and")}.`);
  return { departments, problems };
}
