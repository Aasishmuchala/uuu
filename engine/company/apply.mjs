#!/usr/bin/env node
// Applies the company file to the board and writes the fence policy (CONTRACTS 5.2).
//   node engine/company/apply.mjs [--check] [--file <company.json>]
// Talks to the board with no Authorization header. Never deletes an agent, a project or a
// company. A second run sends no write and rewrites no file. --check writes nothing and
// exits 3 when something would change.
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../lib/config.mjs";
import { boardClient, BoardDown, BoardRefused } from "./lib/board.mjs";
import { loadCompanyFile, desiredAdapterConfig, FileProblem } from "./lib/company-file.mjs";
import { ensureDir, ensureFile, writeIfChanged } from "./lib/state-files.mjs";

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

// Scopes the board gives these grants by default; kept when a grant is added back.
function defaultScope(key, agentId) {
  if (key === "inbox:manage") return { responsibleUserOnly: true };
  if (key === "tasks:assign_scope") return { subtreeRootAgentId: agentId };
  return null;
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

async function apply({ check, file }) {
  const config = loadConfig();
  const plan = loadCompanyFile(file, config);
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

  // Rights, then grants (whole-set replace through the member id).
  const known = plan.agents.filter((a) => !fresh.has(a.slug) || !check);
  const details = {};
  for (const a of known) {
    let detail = await board.get(`/api/agents/${enc(ids[a.slug])}`, { what: `show the agent ${a.name}` });
    const perms = detail.permissions || {};
    if (Object.keys(a.rights).some((k) => !!perms[k] !== a.rights[k])) {
      if (!check) {
        await board.patch(`/api/agents/${enc(ids[a.slug])}/permissions`, a.rights, { what: `set the rights of ${a.name}` });
        detail = await board.get(`/api/agents/${enc(ids[a.slug])}`, { what: `show the agent ${a.name}` });
      }
      say("updated", `rights of ${a.name}`);
    } else say("unchanged", `rights of ${a.name}`);
    details[a.slug] = detail;
  }
  for (const a of known) {
    const access = details[a.slug].access || {};
    const current = (access.grants || []).map((g) => g.permissionKey);
    if (sameSet(current, a.grants)) { say("unchanged", `grants of ${a.name}`); continue; }
    const memberId = access.membership?.id;
    if (!memberId) throw new Stop(`The board did not show the membership of ${a.name}, so its grants could not be set. Nothing more was changed.`);
    if (!check) {
      const scopes = Object.fromEntries((access.grants || []).map((g) => [g.permissionKey, g.scope ?? null]));
      const grants = a.grants.map((k) => ({ permissionKey: k, scope: k in scopes ? scopes[k] : defaultScope(k, ids[a.slug]) }));
      await board.patch(`/api/companies/${enc(company.id)}/members/${enc(memberId)}/permissions`, { grants },
        { what: `set the grants of ${a.name}` });
    }
    const removed = current.filter((k) => !a.grants.includes(k));
    const added = a.grants.filter((k) => !current.includes(k));
    say("updated", `grants of ${a.name}`, [removed.length ? `removed ${removed.join(", ")}` : "", added.length ? `added ${added.join(", ")}` : ""].filter(Boolean).join("; "));
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

  // Empty lessons files, ids.json and one fence policy per agent.
  for (const a of plan.agents) {
    if (a.policy.lessonsFile) say(ensureFile(a.policy.lessonsFile, { check }), `lessons file of ${a.name}`);
  }
  if (check && (!company || !project || fresh.size)) {
    say(existsSync(config.paths.ids) ? "updated" : "created", "ids file");
  } else {
    const idsDoc = { companyId: company.id, projectId: project.id, projectFolder: plan.project.folder, agents: ids };
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
  if (e instanceof BoardDown || e instanceof BoardRefused || e instanceof FileProblem || e instanceof Stop) {
    console.error(e.message);
  } else if (e && /^engine config: /.test(e.message)) {
    console.error(e.message);
  } else {
    console.error(`Apply stopped before it finished: ${e && e.message ? e.message.split("\n")[0] : "unknown problem"}`);
  }
  process.exitCode = 1;
}
