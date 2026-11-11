#!/usr/bin/env node
// Applies the company file to the board and writes the fence policy (CONTRACTS 5.2).
//   node engine/company/apply.mjs [--check] [--file <company.json>]
// Talks to the board with no Authorization header. Never deletes an agent, a project or a
// company. A second run sends no write and rewrites no file. --check writes nothing and
// exits 3 when something would change.
// Paperclip's grants are not managed: the board gives every agent its default grants and
// refuses to let the owner remove them, so the gate blocks what they would open. Apply sets
// only the three rights, and checks the one grant they move, tasks:assign.
// Routines (CONTRACTS-V2 section 18) come from the routines folder beside the company file.
// They are made paused; apply never switches one on or off afterwards and never deletes one.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { boardClient, BoardDown, BoardRefused } from "./lib/board.mjs";
import { loadCompanyFile, desiredAdapterConfig, FileProblem } from "./lib/company-file.mjs";
import { ensureDir, ensureFile, writeIfChanged } from "./lib/state-files.mjs";
import { loadRoutineFiles } from "./lib/routine-files.mjs";
import { applyRoutines, CHIEF, RoutineStop } from "./lib/routines.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

class Stop extends Error {}

function parseArgs(argv) {
  const out = { check: false, file: join(HERE, "company.json") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") out.check = true;
    else if (argv[i] === "--file" && argv[i + 1]) out.file = argv[++i];
    else throw new Stop("Usage: node engine/company/apply.mjs [--check] [--file <company.json>]");
  }
  return out;
}

const PLAIN = {
  role: "role", title: "title", capabilities: "job description", adapterType: "tool",
  cwd: "default folder", model: "model", engine: "engine", command: "command",
  timeoutSec: "run time limit", maxTurnsPerRun: "turn limit", heartbeat: "runs at once", approve: "approved as the owner",
};

// Whether the board lets an agent assign tasks, read from its grants: access.canAssignTasks
// is true for every active member, so only the tasks:assign grant itself tells.
const mayAssign = (detail) => (detail?.access?.grants || []).some((g) => g.permissionKey === "tasks:assign");

async function apply({ check, file }) {
  const config = loadConfig();
  const plan = loadCompanyFile(file, config);
  // A routine file that is not usable stops everything before the board is asked anything.
  const routineFiles = loadRoutineFiles(join(dirname(file), "routines"), plan.agents);
  if (routineFiles.problems.length) {
    const { file: bad, problem } = routineFiles.problems[0];
    throw new Stop(`The routine file ${bad} is not usable: ${problem.charAt(0).toLowerCase()}${problem.slice(1).replace(/\.$/, "")}.`);
  }
  if (routineFiles.routines.length && !plan.agents.some((a) => a.slug === CHIEF)) {
    throw new Stop("The routines need the Chief of staff in the company file, so nothing was changed.");
  }
  const board = boardClient(config.urls.board, { portLabel: config.ports.board });
  const state = config.paths.state;
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const say = (verb, thing, detail) => {
    if (verb !== "left alone") counts[verb] += 1;
    const word = check && verb === "created" ? "would create" : check && verb === "updated" ? "would update" : verb;
    console.log(`${word} ${thing}${detail ? `: ${detail}` : ""}`);
  };
  const enc = encodeURIComponent;

  await board.get("/api/health", { what: "say whether it is up" });

  // Folders first: the board is given the project folder and each agent's default folder.
  const rel = (p) => relative(state, p) || ".";
  const folders = [config.paths.tasks, plan.project.folder, config.paths.agentFolders,
    ...plan.agents.map((a) => a.cwd), config.paths.lessons, config.paths.knowledgeDocs, config.paths.policy];
  for (const f of folders) say(ensureDir(f, { check }), `folder ${rel(f)}`);

  // Company and its switch.
  const companies = await board.get("/api/companies", { what: "list the companies" });
  let company = (companies || []).find((c) => c.name === plan.company.name) || null;
  if (!company) {
    if (check) say("created", `company ${plan.company.name}`);
    else {
      company = await board.post("/api/companies", { name: plan.company.name }, { what: `create the company ${plan.company.name}` });
      say("created", `company ${plan.company.name}`);
    }
  } else say("unchanged", `company ${plan.company.name}`);
  const switchThing = `company switch: ${plan.company.requireApproval ? "the owner approves new agents" : "new agents need no approval"}`;
  if (!company || company.requireBoardApprovalForNewAgents !== plan.company.requireApproval) {
    if (!check) {
      company = await board.patch(`/api/companies/${enc(company.id)}`, { requireBoardApprovalForNewAgents: plan.company.requireApproval },
        { what: "turn on owner approval for new agents" });
    }
    say("updated", switchThing);
  } else say("unchanged", switchThing);

  // Project and its folder.
  let project = null;
  if (company) {
    const projects = await board.get(`/api/companies/${enc(company.id)}/projects`, { what: "list the projects" });
    project = (projects || []).find((p) => p.name === plan.project.name) || null;
  }
  if (project) {
    const folder = project.primaryWorkspace?.cwd ?? project.codebase?.localFolder ?? project.workspaces?.[0]?.cwd ?? null;
    if (folder !== plan.project.folder) {
      throw new Stop(`The project "${plan.project.name}" on the board uses another folder (${folder || "none"}), so nothing more was changed. Point it at ${plan.project.folder} on the board, then run this again.`);
    }
    say("unchanged", `project ${plan.project.name}`);
  } else if (check) say("created", `project ${plan.project.name}`);
  else {
    project = await board.post(`/api/companies/${enc(company.id)}/projects`, {
      name: plan.project.name,
      workspace: { sourceType: "local_path", cwd: plan.project.folder, isPrimary: true },
    }, { what: `create the project ${plan.project.name}` });
    say("created", `project ${plan.project.name}`);
  }

  // Agents, in file order (bosses first). Matched by name; others are left alone.
  const onBoard = company ? await board.get(`/api/companies/${enc(company.id)}/agents`, { what: "list the agents" }) : [];
  const live = (onBoard || []).filter((x) => x.status !== "terminated");
  const ids = {};
  const fresh = new Set();
  for (const a of plan.agents) {
    const want = desiredAdapterConfig(a);
    const heartbeat = { enabled: false, maxConcurrentRuns: a.limits.maxConcurrentRuns };
    const found = live.find((x) => x.name === a.name && !Object.values(ids).includes(x.id));
    if (!found) {
      fresh.add(a.slug);
      if (check) { say("created", `agent ${a.name}`); continue; }
      const body = {
        name: a.name, role: a.role, title: a.title, capabilities: a.capabilities,
        adapterType: a.adapterType, runner: "legacy", adapterConfig: want,
        runtimeConfig: { heartbeat }, permissions: a.rights,
        reportsTo: a.reportsTo ? ids[a.reportsTo] : null,
      };
      const what = `create the agent ${a.name}`;
      let made;
      try {
        made = await board.post(`/api/companies/${enc(company.id)}/agents`, body, { what });
      } catch (e) {
        // With owner approval switched on, the board takes new agents only as hires.
        if (!(e instanceof BoardRefused) || e.status !== 409) throw e;
        made = await board.post(`/api/companies/${enc(company.id)}/agent-hires`, body, { what });
      }
      const agent = made && made.agent ? made.agent : made;
      if (!agent || !agent.id) throw new Stop(`The board did not say which agent it made for ${a.name}, so nothing more was changed.`);
      if (agent.status === "pending_approval") {
        await board.post(`/api/agents/${enc(agent.id)}/approve`, {}, { what: `approve the new agent ${a.name}` });
      }
      ids[a.slug] = agent.id;
      say("created", `agent ${a.name}`);
      continue;
    }
    ids[a.slug] = found.id;
    const patch = {};
    const changed = [];
    for (const k of ["role", "title", "capabilities"]) if (found[k] !== a[k]) { patch[k] = a[k]; changed.push(k); }
    const have = found.adapterConfig || {};
    if (found.adapterType !== a.adapterType) {
      patch.adapterType = a.adapterType; patch.runner = "legacy"; patch.adapterConfig = want; changed.push("adapterType");
    } else {
      const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => have[k] !== v));
      if (Object.keys(diff).length) { patch.adapterConfig = diff; changed.push(...Object.keys(diff)); }
    }
    const rc = found.runtimeConfig || {};
    if (rc.heartbeat?.enabled !== false || rc.heartbeat?.maxConcurrentRuns !== heartbeat.maxConcurrentRuns) {
      patch.runtimeConfig = { ...rc, heartbeat: { ...(rc.heartbeat || {}), ...heartbeat } };
      changed.push("heartbeat");
    }
    const pending = found.status === "pending_approval";
    if (!changed.length && !pending) { say("unchanged", `agent ${a.name}`); continue; }
    if (!check) {
      if (changed.length) await board.patch(`/api/agents/${enc(found.id)}`, patch, { what: `update the agent ${a.name}` });
      if (pending) await board.post(`/api/agents/${enc(found.id)}/approve`, {}, { what: `approve the agent ${a.name}` });
    }
    say("updated", `agent ${a.name}`, [...changed, ...(pending ? ["approve"] : [])].map((k) => PLAIN[k] || k).join(", "));
  }
  for (const x of live) {
    if (!Object.values(ids).includes(x.id)) say("left alone", `agent ${x.name}`, "not in the company file");
  }

  // Rights, set through /permissions, then read back from the agent's own grants.
  const known = plan.agents.filter((a) => !fresh.has(a.slug) || !check);
  const details = {};
  for (const a of known) {
    let detail = await board.get(`/api/agents/${enc(ids[a.slug])}`, { what: `show the agent ${a.name}` });
    const perms = detail.permissions || {};
    const rightsDiffer = Object.keys(a.rights).some((k) => !!perms[k] !== a.rights[k]);
    const assignDiffers = mayAssign(detail) !== a.rights.canAssignTasks;
    if (!rightsDiffer && !assignDiffers) { say("unchanged", `rights of ${a.name}`); details[a.slug] = detail; continue; }
    if (!check) {
      await board.patch(`/api/agents/${enc(ids[a.slug])}/permissions`, a.rights, { what: `set the rights of ${a.name}` });
      detail = await board.get(`/api/agents/${enc(ids[a.slug])}`, { what: `show the agent ${a.name}` });
      if (mayAssign(detail) !== a.rights.canAssignTasks) {
        throw new Stop(a.rights.canAssignTasks
          ? `The board still does not let ${a.name} assign tasks after its rights were set, so nothing more was changed; check the agent on the board, then run this again.`
          : `The board still lets ${a.name} assign tasks after that right was switched off, so nothing more was changed; check the agent's role and rights on the board, then run this again.`);
      }
    }
    say("updated", `rights of ${a.name}`, assignDiffers ? (a.rights.canAssignTasks ? "may assign tasks" : "may not assign tasks") : "");
    details[a.slug] = detail;
  }

  // Instructions (AGENTS.md), sent with the revision they replace.
  for (const a of known) {
    const path = `/api/agents/${enc(ids[a.slug])}/instructions-bundle/file?path=AGENTS.md`;
    const cur = await board.get(path, { what: `show the instructions of ${a.name}`, allow404: true });
    if (cur && cur.content === a.instructions) { say("unchanged", `instructions of ${a.name}`); continue; }
    if (!check) {
      await board.put(path, { path: "AGENTS.md", content: a.instructions, baseRevisionId: cur?.revision?.id ?? null },
        { what: `save the instructions of ${a.name}` });
    }
    say(cur ? "updated" : "created", `instructions of ${a.name}`);
  }

  // Who each agent reports to.
  for (const a of known) {
    const boss = a.reportsTo ? ids[a.reportsTo] ?? null : null;
    const bossName = a.reportsTo ? plan.agents.find((x) => x.slug === a.reportsTo).name : "the owner";
    const have = details[a.slug].reportsTo ?? null;
    if (have === boss) { say("unchanged", `boss of ${a.name}`, bossName); continue; }
    if (!check) await board.patch(`/api/agents/${enc(ids[a.slug])}`, { reportsTo: boss }, { what: `set who ${a.name} reports to` });
    say("updated", `boss of ${a.name}`, bossName);
  }

  // Routines, as the owner, after the instructions and before ids.json.
  let routineIds = {};
  if (routineFiles.routines.length) {
    let known = {};
    try { known = JSON.parse(readFileSync(config.paths.ids, "utf8")).routines || {}; } catch { known = {}; }
    routineIds = await applyRoutines({
      board, company, project, agents: plan.agents, routines: routineFiles.routines, known,
      chiefId: ids[CHIEF] ?? null, check, say,
    });
  }

  // Empty lessons files, ids.json and one fence policy per agent.
  for (const a of plan.agents) {
    if (a.policy.lessonsFile) say(ensureFile(a.policy.lessonsFile, { check }), `lessons file of ${a.name}`);
  }
  if (check && (!company || !project || fresh.size)) {
    say(existsSync(config.paths.ids) ? "updated" : "created", "ids file");
  } else {
    const idsDoc = { companyId: company.id, projectId: project.id, projectFolder: plan.project.folder, agents: ids };
    if (routineFiles.routines.length) idsDoc.routines = routineIds;
    say(writeIfChanged(config.paths.ids, JSON.stringify(idsDoc, null, 2) + "\n", { check }), "ids file");
  }
  for (const a of plan.agents) {
    if (!ids[a.slug]) { say("created", `fence policy of ${a.name}`); continue; }
    const p = a.policy;
    const doc = {
      agentId: ids[a.slug], slug: a.slug, localServices: p.localServices, readFolders: p.readFolders,
      lessonsFile: p.lessonsFile, envFile: p.envFile, taskFolder: p.taskFolder,
    };
    say(writeIfChanged(join(config.paths.policy, `${ids[a.slug]}.json`), JSON.stringify(doc, null, 2) + "\n", { check }), `fence policy of ${a.name}`);
  }

  const changes = counts.created + counts.updated;
  if (check) {
    console.log("Default rights that paperclip gives every agent remain on the board and are blocked at the gate.");
    console.log(changes ? `Would change: ${counts.created} to create, ${counts.updated} to update, ${counts.unchanged} unchanged. Run: engine setup`
      : `Nothing would change: ${counts.unchanged} unchanged.`);
    return changes ? 3 : 0;
  }
  console.log(`Applied: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged.`);
  return 0;
}

try {
  process.exitCode = await apply(parseArgs(process.argv.slice(2)));
} catch (e) {
  if (e instanceof BoardDown || e instanceof BoardRefused || e instanceof FileProblem || e instanceof Stop || e instanceof RoutineStop) {
    console.error(e.message);
  } else if (e && /^engine config: /.test(e.message)) {
    console.error(e.message);
  } else {
    console.error(`Apply stopped before it finished: ${e && e.message ? e.message.split("\n")[0] : "unknown problem"}`);
  }
  process.exitCode = 1;
}
