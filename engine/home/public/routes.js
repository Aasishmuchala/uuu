// The route table (CONTRACTS-V3 26.1): every page of the home screen, by address. Frozen after M13.
//
// How a page is added: write pages/<file>.js with `export default function Page({ route })`, where
// route = { id, parts, query }. Start it with <PageHeader/> and wrap the content in
// <div class="p-<id>">. Its stylesheet is styles/pages/<id>.css, already linked from index.html.
// Nothing here changes: the shell loads the file the first time its address is opened, and shows
// "This page is being built." until the file exists.
//
//   id       the page's name, also its stylesheet's name and its root class (p-<id>)
//   file     the module, relative to this folder, loaded with import()
//   title    the page's plain name (the command menu, the tab while it loads)
//   match    (parts) -> true when the address is this page's; parts are the decoded parts after "#/"
//   section  which of the five sections of the top bar is current on it: "map" | "tasks" |
//            "dashboards" | "files" | "apps" | null
//   icon     a kit icon name

import { fileToken } from "./lib/format.js";

const only = (name) => (p) => p.length === 1 && p[0] === name;
const withId = (name) => (p) => p.length === 2 && p[0] === name;
const oneOrTwo = (name) => (p) => (p.length === 1 || p.length === 2) && p[0] === name;

// The four record dashboards share one page until each is rebuilt.
export const RECORD_DASHBOARDS = ["books", "customers", "support", "people"];

export const ROUTES = [
  { id: "map", file: "./pages/map.js", title: "Map", match: (p) => p.length === 0 || ((p.length === 1 || p.length === 2) && p[0] === "map"), section: "map", icon: "map" },
  { id: "needs-you", file: "./pages/needs-you.js", title: "Needs you", match: only("needs-you"), section: null, icon: "needs" },
  { id: "tasks", file: "./pages/tasks.js", title: "Tasks", match: only("tasks"), section: "tasks", icon: "tasks" },
  { id: "task", file: "./pages/task.js", title: "Task", match: withId("tasks"), section: "tasks", icon: "tasks" },
  { id: "dashboards", file: "./pages/dashboards.js", title: "Dashboards", match: only("dashboards"), section: "dashboards", icon: "dashboards" },
  { id: "dashboard", file: "./pages/dashboard.js", title: "Dashboard", match: (p) => p.length === 2 && p[0] === "dashboards" && RECORD_DASHBOARDS.includes(p[1]), section: "dashboards", icon: "dashboards" },
  { id: "marketing", file: "./pages/marketing.js", title: "Marketing", match: (p) => p.length === 2 && p[0] === "dashboards" && p[1] === "marketing", section: "dashboards", icon: "dashboards" },
  { id: "studio", file: "./pages/studio.js", title: "Studio", match: (p) => p.length === 2 && p[0] === "dashboards" && p[1] === "studio", section: "dashboards", icon: "dashboards" },
  { id: "files", file: "./pages/files.js", title: "Files", match: oneOrTwo("files"), section: "files", icon: "files" },
  { id: "jobs", file: "./pages/jobs.js", title: "Jobs", match: only("jobs"), section: "map", icon: "jobs" },
  { id: "job", file: "./pages/job.js", title: "Job", match: (p) => p.length === 3 && p[0] === "jobs", section: "map", icon: "jobs" },
  { id: "dept", file: "./pages/dept.js", title: "Department", match: withId("departments"), section: "map", icon: "map" },
  { id: "team", file: "./pages/team.js", title: "Team", match: only("team"), section: null, icon: "team" },
  { id: "agent", file: "./pages/agent.js", title: "Team", match: withId("team"), section: null, icon: "team" },
  { id: "routines", file: "./pages/routines.js", title: "Routines", match: oneOrTwo("routines"), section: null, icon: "routines" },
  { id: "health", file: "./pages/health.js", title: "Health", match: only("health"), section: null, icon: "health" },
  { id: "settings", file: "./pages/settings.js", title: "Settings", match: only("settings"), section: null, icon: "settings" },
  { id: "search", file: "./pages/search.js", title: "Search", match: only("search"), section: null, icon: "search" },
  // Step 5 (PLAN-V5 K17, K23, T80): App Studio, the apps that run on this Mac, and one app opened inside.
  { id: "apps", file: "./pages/apps.js", title: "App Studio", match: only("apps"), section: "apps", icon: "apps" },
  { id: "app", file: "./pages/app.js", title: "App", match: withId("apps"), section: "apps", icon: "apps" },
];

// The first part of an old address → the new address it moves to. The rest of the old address and its
// query come along ("#/goals/<id>" → "#/tasks/<id>", "#/studio?sprite=x" → "#/dashboards/studio?sprite=x").
export const REDIRECTS = {
  home: "map",
  inbox: "needs-you",
  goals: "tasks",
  company: "team",
  knowledge: "files",
  docs: "files",
  gallery: "jobs",
  books: "dashboards/books",
  customers: "dashboards/customers",
  support: "dashboards/support",
  people: "dashboards/people",
  marketing: "dashboards/marketing",
  studio: "dashboards/studio",
};

// Modules that are not pages but are built in the same waves and checked the same way.
export const EXTRA_MODULES = [
  "./studio/sprite-player.js",
  "./map/layout.js",
  "./map/map-view.js",
  "./map/map-list.js",
  "./brain/new-file.js",
  "./brain/readiness.js",
];

// The five sections of the top bar's capsule (and of the tab bar below 860 px), in order. `short` is the tab bar's
// word where the capsule's is too long for a phone (App Studio is "Apps" there).
export const SECTIONS = [
  { id: "map", title: "Map", href: "#/map", icon: "map" },
  { id: "tasks", title: "Tasks", href: "#/tasks", icon: "tasks" },
  { id: "dashboards", title: "Dashboards", href: "#/dashboards", icon: "dashboards" },
  { id: "files", title: "Files", href: "#/files", icon: "files" },
  { id: "apps", title: "App Studio", short: "Apps", href: "#/apps", icon: "apps" },
];

// The seven departments in the company file's order, for when the server has not answered yet.
// The server's answer (shell.dock, /api/map) is what pages show; these are the fallback names.
export const DEPARTMENTS = [
  { id: "operations", title: "Operations" },
  { id: "sales", title: "Sales" },
  { id: "marketing", title: "Marketing" },
  { id: "studio", title: "Studio" },
  { id: "support", title: "Support" },
  { id: "people", title: "People" },
  { id: "books", title: "Books" },
];

// The route for the address parts, or null when no page has that address.
export function findRoute(parts) {
  const p = Array.isArray(parts) ? parts : [];
  return ROUTES.find((r) => r.match(p)) || null;
}

export const routeById = (id) => ROUTES.find((r) => r.id === id) || null;

// Which section is current on a page, or null.
export const sectionOf = (id) => routeById(id)?.section || null;

// The address an old address moves to, or null when it stays. "#/docs?doc=<name>" opens that file.
export function redirectFor(parts, query) {
  const p = Array.isArray(parts) ? parts : [];
  if (!p.length || !Object.prototype.hasOwnProperty.call(REDIRECTS, p[0])) return null;
  const q = new URLSearchParams(query ? String(query) : "");
  if (p[0] === "docs" && q.get("doc")) {
    const name = q.get("doc");
    q.delete("doc");
    q.set("file", fileToken(name));
  }
  const rest = p.slice(1).map((x) => `/${encodeURIComponent(x)}`).join("");
  const qs = q.toString();
  return `#/${REDIRECTS[p[0]]}${rest}${qs ? `?${qs}` : ""}`;
}
