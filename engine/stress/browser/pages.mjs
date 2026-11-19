// The pages the browser sweep opens (PLAN-STRESS T3), read from the home's own route table and the stage's data:
// every ROUTES entry (with real ids from the seed where a page takes one), every REDIRECTS address, an address that
// matches nothing, the bare address (the first-run opening of Setup), every Settings section, the brand kit, a file
// opened, and the shell's command menu, queue, compose dialog and phone menu (by the shell's own "?open=").
//   pagesFor(stage) -> [{ key, hash, open, route, expect, owner, missingId }]
//   urlOf(stage, page, theme) -> the address Chrome opens
// `expect`: "page" (a page of that route draws), "notfound", "redirect:<hash>", "bare". A page whose id the dataset
// does not have (the empty seed has no task) is opened with a made-up id and `missingId: true`: it must still draw.
import { call } from "../lib/http.mjs";
import { REDIRECTS, ROUTES, findRoute, redirectFor } from "../../home/public/routes.js";

export const SETTINGS_SECTIONS = ["models", "web", "generation", "viewer", "brain", "later"];
export const OVERLAYS = [
  { key: "overlay-command", open: "command", hash: "#/tasks" },
  { key: "overlay-queue", open: "needs", hash: "#/tasks" },
  { key: "overlay-compose", open: "compose", hash: "#/tasks" },
  { key: "overlay-menu", open: "menu", hash: "#/tasks", narrowOnly: true },
];
// The page that owns each part, for the faults (Settings sections by their key in pagesFor).
export const OWNER_PAGE = {
  board: "tasks", books: "dashboard-books", gate: "health", relay: "settings-models", web: "settings-web",
  generate: "settings-generation", viewer: "settings-viewer", apps: "apps", brain: "settings-brain",
};
export const FAULT_PAGES = ["map", "needs-you", "tasks", "health", "settings", "setup", "jobs"];
export const QUICK_PAGES = ["map", "tasks", "settings"];
const MISSING = "stress-no-such-id";

async function get(stage, path) {
  try {
    const r = await call(`${stage.urls.home}${path}`, { timeoutMs: 20000 });
    return r.status === 200 && r.json ? r.json : null;
  } catch {
    return null;
  }
}

// Real ids from the stage, each null when the dataset has none.
export async function idsOf(stage) {
  const [tasks, jobs, map, team, routines, folder, apps, setup] = await Promise.all([
    get(stage, "/api/tasks"), get(stage, "/api/jobs"), get(stage, "/api/map"), get(stage, "/api/team"),
    get(stage, "/api/routines"), get(stage, "/api/brain/folder/company"), get(stage, "/api/apps"), get(stage, "/api/setup"),
  ]);
  const allTasks = (tasks && Array.isArray(tasks.columns) ? tasks.columns : []).flatMap((c) => (Array.isArray(c.tasks) ? c.tasks : []));
  // On the large seed the task page opens the planted <script> title, so the page itself is the text-safety check.
  const task = allTasks.find((t) => /<script>/.test(String(t.title || ""))) || allTasks.find((t) => t.waitingForYou) || allTasks[0] || null;
  const job = (jobs && Array.isArray(jobs.departments) ? jobs.departments : [])
    .flatMap((d) => (d.clusters || []).flatMap((c) => c.jobs || []))[0] || null;
  const dept = (map && Array.isArray(map.departments) ? map.departments : [])[0] || null;
  const agent = (team && Array.isArray(team.agents) ? team.agents : [])[0] || null;
  const routine = (routines && Array.isArray(routines.routines) ? routines.routines : [])[0] || null;
  const file = (folder && Array.isArray(folder.files) ? folder.files : [])[0] || null;
  const app = (apps && Array.isArray(apps.apps) ? apps.apps : [])[0] || null;
  return {
    task: task ? task.id : null,
    job: job && typeof job.id === "string" && job.id.includes("/") ? job.id : null,
    dept: dept ? dept.id : null,
    agent: agent ? agent.slug : null,
    routine: routine ? routine.id : null,
    file: file ? file.token : null,
    app: app ? app.slug : null,
    setupOpen: !!(setup && setup.open === true),
    taskCount: allTasks.length,
  };
}

const enc = encodeURIComponent;

export async function pagesFor(stage) {
  const ids = await idsOf(stage);
  const out = [];
  const add = (p) => out.push({ open: null, expect: "page", owner: null, missingId: false, ...p });
  const idPage = (key, route, id, make) => add({ key, route, hash: make(id || MISSING), missingId: !id });
  for (const r of ROUTES) {
    switch (r.id) {
      case "task": idPage("task", r.id, ids.task, (id) => `#/tasks/${enc(id)}`); break;
      case "job": {
        const [d, j] = (ids.job || `operations/${MISSING}`).split("/");
        add({ key: "job", route: r.id, hash: `#/jobs/${enc(d)}/${enc(j)}`, missingId: !ids.job });
        break;
      }
      case "dept": idPage("dept", r.id, ids.dept, (id) => `#/departments/${enc(id)}`); break;
      case "agent": idPage("agent", r.id, ids.agent, (id) => `#/team/${enc(id)}`); break;
      case "app": idPage("app", r.id, ids.app, (id) => `#/apps/${enc(id)}`); break;
      case "dashboard":
        for (const d of ["books", "customers", "support", "people"]) add({ key: `dashboard-${d}`, route: r.id, hash: `#/dashboards/${d}` });
        break;
      case "marketing": add({ key: "marketing", route: r.id, hash: "#/dashboards/marketing" }); break;
      case "studio": add({ key: "studio", route: r.id, hash: "#/dashboards/studio" }); break;
      case "routines":
        add({ key: "routines", route: r.id, hash: "#/routines" });
        idPage("routine", r.id, ids.routine, (id) => `#/routines/${enc(id)}`);
        break;
      case "files":
        add({ key: "files", route: r.id, hash: "#/files" });
        add({ key: "files-folder", route: r.id, hash: "#/files/company" });
        idPage("file", r.id, ids.file, (id) => `#/files?file=${enc(id)}`);
        add({ key: "brand-kit", route: r.id, hash: "#/files/brand-kit" });
        break;
      case "settings":
        add({ key: "settings", route: r.id, hash: "#/settings" });
        for (const s of SETTINGS_SECTIONS) add({ key: `settings-${s}`, route: r.id, hash: `#/settings?s=${s}` });
        break;
      case "map":
        add({ key: "map", route: r.id, hash: "#/map" });
        if (ids.dept) add({ key: "map-dept", route: r.id, hash: `#/map/${enc(ids.dept)}` });
        break;
      case "search": add({ key: "search", route: r.id, hash: "#/search?q=price" }); break;
      default: add({ key: r.id, route: r.id, hash: `#/${r.id}` });
    }
  }
  for (const from of Object.keys(REDIRECTS)) {
    const to = redirectFor([from], "");
    add({ key: `redirect-${from}`, route: (findRoute(to.slice(2).split("?")[0].split("/")) || {}).id || null, hash: `#/${from}`, expect: `redirect:${to}` });
  }
  add({ key: "nomatch", route: null, hash: "#/stress-no-such-page", expect: "notfound" });
  add({ key: "bare", route: ids.setupOpen ? "setup" : "map", hash: "", expect: ids.setupOpen ? "redirect:#/setup" : "bare" });
  for (const o of OVERLAYS) add({ key: o.key, route: "tasks", hash: o.hash, open: o.open, narrowOnly: !!o.narrowOnly });
  return { pages: out, ids };
}

export function urlOf(stage, page, theme = "light") {
  const q = new URLSearchParams();
  q.set("theme", theme);
  if (page.open) q.set("open", page.open);
  return `${stage.urls.home}/?${q.toString()}${page.hash || ""}`;
}
