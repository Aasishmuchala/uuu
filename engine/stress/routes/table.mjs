// The home's route table, built at run time (PLAN-STRESS T4): the stage's own copy loads every routes/*.mjs through
// the home's loader against a recording router (list-child.mjs, a child under the guard with the stage's HOME and
// TMPDIR). If that fails, the table is read from the source: every app.get/post/delete("...") in home/server/routes.
// Then the ids the seed holds, read from the staged home's own answers, for the `:name` places.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NODE } from "../lib/stage.mjs";

export const MIN_ROUTES = 140;

export function listRoutes(stage) {
  const serverDir = join(stage.engineDir, "home", "server");
  try {
    const out = execFileSync(NODE, ["--import", join(stage.engineDir, "stress", "lib", "netguard.mjs"), join(stage.engineDir, "stress", "routes", "list-child.mjs"), serverDir], {
      cwd: stage.engineDir, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: `${dirname(NODE)}:/usr/bin:/bin`, HOME: join(stage.root, "home"), TMPDIR: `${join(stage.root, "tmp")}/`, STRESS_PART: "routes-list", STRESS_STAGE_ROOT: stage.root },
    });
    const j = JSON.parse(out.trim().split("\n").pop());
    return { how: "loader", routes: j.routes, failed: j.failed };
  } catch (e) {
    return { how: "source", routes: parseSource(serverDir), failed: [{ file: "(loader)", error: String(e.message || e).split("\n")[0] }] };
  }
}

export function parseSource(serverDir) {
  const out = [];
  const dir = join(serverDir, "routes");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".mjs")).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    const re = /app\.(get|post|delete)\(\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) out.push({ method: m[1].toUpperCase(), pattern: m[2], maxBody: null, file: `routes/${f}` });
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The ids for the `:name` places, read from the staged home: { tasks, agents, slugs, apps, departments, jobs,
// routines, docs, folders, forms, brainTokens, fileTokens }.
export async function discoverIds(hit, port) {
  const get = async (p) => {
    const r = await hit(port, "GET", p, { timeoutMs: 20000 });
    return r.status === 200 && r.json ? r.json : null;
  };
  const ids = { tasks: [], agents: [], slugs: [], apps: [], departments: [], jobs: [], routines: [], docs: [], folders: [], forms: [], brainTokens: [], fileTokens: [] };
  const add = (k, v) => { if (typeof v === "string" && v && !ids[k].includes(v)) ids[k].push(v); };
  const tasks = await get("/api/tasks");
  for (const c of tasks?.columns || []) for (const t of c.tasks || []) add("tasks", t.id);
  const team = await get("/api/team");
  for (const a of team?.agents || []) { add("agents", a.id); add("slugs", a.slug); }
  const apps = await get("/api/apps");
  for (const a of apps?.apps || []) add("apps", a.slug);
  const jobs = await get("/api/jobs");
  for (const d of jobs?.departments || []) {
    add("departments", d.id);
    for (const c of d.clusters || []) for (const j of c.jobs || []) add("jobs", j.id);
  }
  const routines = await get("/api/routines");
  for (const r of routines?.routines || []) add("routines", r.id);
  const docs = await get("/api/knowledge");
  for (const d of docs?.docs || []) add("docs", d.id);
  const brain = await get("/api/brain");
  for (const f of brain?.folders || []) add("folders", f.id);
  for (const folder of ids.folders.slice(0, 4)) {
    const fl = await get(`/api/brain/folder/${encodeURIComponent(folder)}`);
    for (const f of fl?.files || []) { add("brainTokens", f.token); if (f.form) add("forms", f.form); }
  }
  for (const d of ids.docs.slice(0, 2)) add("fileTokens", Buffer.from(`knowledge/docs/${d}`).toString("base64url"));
  ids.tasks = ids.tasks.filter((t) => UUID.test(t)).concat(ids.tasks.filter((t) => !UUID.test(t)));
  return ids;
}

// A concrete path for a pattern, with the seed's ids (or a plain made-up one where the seed has none).
export function fill(pattern, ids) {
  const segs = pattern.split("/");
  const first = (k, dflt) => (ids[k] && ids[k][0]) || dflt;
  const out = segs.map((s, i) => {
    if (!s.startsWith(":")) return s;
    const name = s.slice(1);
    const before = segs[i - 1];
    let v;
    if (name === "taskId" || (name === "id" && ["tasks", "goals", "ask", "films"].includes(before))) v = first("tasks", "e0000000-0000-4000-8000-000000000001");
    else if (name === "id" && before === "agents") v = first("agents", "a0000000-0000-4000-8000-000000000001");
    else if (name === "id" && before === "routines") v = first("routines", "brain-tidy");
    else if (name === "id" && before === "doc") v = first("docs", "payment-terms.md");
    else if (name === "id" && before === "folder") v = first("folders", "brand");
    else if (name === "id" && before === "forms") v = first("forms", "company");
    else if (name === "id" && segs[i - 2] === "jobs") v = (first("jobs", "operations/a-checked-answer").split("/")[1] || "a-checked-answer");
    else if (name === "department") v = (first("jobs", "operations/x").split("/")[0]) || first("departments", "operations");
    else if (name === "slug" && before === "apps") v = first("apps", "render-to-film");
    else if (name === "slug") v = first("slugs", "chief-of-staff");
    else if (name === "token" && before === "files") v = first("fileTokens", "a25vd2xlZGdlL2RvY3MveC5tZA");
    else if (name === "token") v = first("brainTokens", "YnJhbmQvYnJhbmQubWQ");
    else if (name === "n") v = "1";
    else if (name === "key") v = "brand";
    else if (name === "name" && before === "font") v = "stress.ttf";
    else if (name === "name") v = "index.png";
    else if (name === "job") v = "j0000000";
    else if (name === "ref") v = "site";
    else v = "x";
    return encodeURIComponent(v);
  });
  return out.join("/");
}

export const paramCount = (pattern) => pattern.split("/").filter((s) => s.startsWith(":")).length;
