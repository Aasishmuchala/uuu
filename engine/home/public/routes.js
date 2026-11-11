// The route table (CONTRACTS-V2 14.1): every page of the home screen, by address. Frozen after V11.
//
// How a page is added: write pages/<file>.js with `export default function Page({ route })`, where
// route = { id, parts, query }. Start it with <PageHeader/> and wrap the content in
// <div class="p-<id>">. Its stylesheet is styles/pages/<id>.css, already linked from index.html.
// Nothing here changes: the shell loads the file the first time its address is opened, and shows
// "This page is being built." until the file exists.
//
//   id     the page's name, also its stylesheet's name and its root class (p-<id>)
//   file   the module, relative to this folder, loaded with import()
//   title  the page's plain name (the sidebar, the command menu, the tab while it loads)
//   match  (parts) -> true when the address is this page's; parts are the decoded parts after "#/"
//   nav    where the sidebar shows it: "top" | "main" | "team" | "departments" | "bottom" | null
//   icon   a kit icon name, or null

const only = (name) => (p) => p.length === 1 && p[0] === name;
const withId = (name) => (p) => p.length === 2 && p[0] === name;
const oneOrTwo = (name) => (p) => (p.length === 1 || p.length === 2) && p[0] === name;

export const ROUTES = [
  { id: "home", file: "./pages/home.js", title: "Home", match: (p) => p.length === 0 || (p.length === 1 && p[0] === "home"), nav: "main", icon: "home" },
  { id: "tasks", file: "./pages/tasks.js", title: "Tasks", match: only("tasks"), nav: "main", icon: "tasks" },
  { id: "task", file: "./pages/task.js", title: "Task", match: withId("tasks"), nav: null, icon: "tasks" },
  { id: "docs", file: "./pages/docs.js", title: "Docs", match: only("docs"), nav: "main", icon: "docs" },
  { id: "team", file: "./pages/team.js", title: "Team", match: only("team"), nav: null, icon: "team" },
  { id: "agent", file: "./pages/agent.js", title: "Team", match: withId("team"), nav: "team", icon: "team" },
  { id: "books", file: "./pages/department.js", title: "Books", match: only("books"), nav: "departments", icon: "layers" },
  { id: "customers", file: "./pages/department.js", title: "Customers", match: only("customers"), nav: "departments", icon: "layers" },
  { id: "support", file: "./pages/department.js", title: "Support", match: only("support"), nav: "departments", icon: "layers" },
  { id: "people", file: "./pages/department.js", title: "People", match: only("people"), nav: "departments", icon: "layers" },
  { id: "marketing", file: "./pages/marketing.js", title: "Marketing", match: only("marketing"), nav: "departments", icon: "layers" },
  { id: "studio", file: "./pages/studio.js", title: "Studio", match: only("studio"), nav: "departments", icon: "image" },
  { id: "routines", file: "./pages/routines.js", title: "Routines", match: oneOrTwo("routines"), nav: "bottom", icon: "routines" },
  { id: "gallery", file: "./pages/gallery.js", title: "Ready-made goals", match: only("gallery"), nav: null, icon: "layers" },
  { id: "health", file: "./pages/health.js", title: "Health", match: only("health"), nav: "bottom", icon: "health" },
  { id: "settings", file: "./pages/settings.js", title: "Settings", match: only("settings"), nav: "bottom", icon: "settings" },
  { id: "search", file: "./pages/search.js", title: "Search", match: only("search"), nav: "top", icon: "search" },
];

export const REDIRECTS = { inbox: "home", goals: "tasks", company: "team", knowledge: "docs" };

// Modules that are not pages but are built in the same wave and checked the same way.
export const EXTRA_MODULES = ["./studio/sprite-player.js"];

// The six departments, in the sidebar's order.
export const DEPARTMENT_IDS = ["books", "customers", "support", "people", "marketing", "studio"];

// The route for the address parts, or null when no page has that address.
export function findRoute(parts) {
  const p = Array.isArray(parts) ? parts : [];
  return ROUTES.find((r) => r.match(p)) || null;
}

export const routeById = (id) => ROUTES.find((r) => r.id === id) || null;

// The address an old address moves to ("#/goals/<id>" → "#/tasks/<id>"), or null when it stays.
export function redirectFor(parts, query) {
  const p = Array.isArray(parts) ? parts : [];
  if (!p.length || !Object.prototype.hasOwnProperty.call(REDIRECTS, p[0])) return null;
  const rest = p.slice(1).map((x) => `/${encodeURIComponent(x)}`).join("");
  const qs = query && String(query) ? `?${query}` : "";
  return `#/${REDIRECTS[p[0]]}${rest}${qs}`;
}
