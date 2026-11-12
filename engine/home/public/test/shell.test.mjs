// The shell, the route table and lib/ (CONTRACTS-V3 26): the table names every page and address of 26.1,
// old addresses move to new ones, links come out right, the keys, the current section of each page, the
// dock's marks from shell.dock, the overlays from the query, and every shell/ and lib/ module loads in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = (p) => import(pathToFileURL(join(PUBLIC, p)).href);
const routes = await load("routes.js");
const format = await load("lib/format.js");
const shellMod = await load("shell/app-shell.js");
const dockMod = await load("shell/dock.js");
const topbar = await load("shell/topbar.js");
const needs = await load("shell/needs-drawer.js");
const menu = await load("shell/command-menu.js");
const compose = await load("shell/compose-dialog.js");
const { html, render } = await load("vendor/preact-htm.js");

const TABLE = {
  map: "./pages/map.js",
  "needs-you": "./pages/needs-you.js",
  tasks: "./pages/tasks.js",
  task: "./pages/task.js",
  dashboards: "./pages/dashboards.js",
  dashboard: "./pages/dashboard.js",
  marketing: "./pages/marketing.js",
  studio: "./pages/studio.js",
  files: "./pages/files.js",
  jobs: "./pages/jobs.js",
  job: "./pages/job.js",
  dept: "./pages/dept.js",
  team: "./pages/team.js",
  agent: "./pages/agent.js",
  routines: "./pages/routines.js",
  health: "./pages/health.js",
  settings: "./pages/settings.js",
  search: "./pages/search.js",
};

const id = (parts) => routes.findRoute(parts)?.id ?? null;

test("every route of 26.1 is in ROUTES with its file, title, match, section and icon", () => {
  assert.deepEqual(routes.ROUTES.map((r) => r.id).sort(), Object.keys(TABLE).sort());
  for (const r of routes.ROUTES) {
    assert.equal(r.file, TABLE[r.id], `${r.id} loads ${TABLE[r.id]}`);
    assert.ok(typeof r.title === "string" && r.title.length > 0);
    assert.equal(typeof r.match, "function");
    assert.ok(["map", "tasks", "dashboards", "files", null].includes(r.section), `${r.id} has a known section`);
    assert.ok(typeof r.icon === "string" && r.icon.length > 0);
  }
  assert.deepEqual(routes.SECTIONS.map((s) => [s.id, s.title, s.href]), [
    ["map", "Map", "#/map"], ["tasks", "Tasks", "#/tasks"], ["dashboards", "Dashboards", "#/dashboards"], ["files", "Files", "#/files"],
  ]);
  assert.deepEqual(routes.DEPARTMENTS.map((d) => d.id), ["operations", "sales", "marketing", "studio", "support", "people", "books"]);
});

test("the extra modules are the six of 26.1", () => {
  assert.deepEqual(routes.EXTRA_MODULES, [
    "./studio/sprite-player.js", "./map/layout.js", "./map/map-view.js", "./map/map-list.js", "./brain/new-file.js", "./brain/readiness.js",
  ]);
});

test("the map's addresses, and the empty address is the map", () => {
  assert.equal(id([]), "map");
  assert.equal(id(["map"]), "map");
  assert.equal(id(["map", "sales"]), "map");
  assert.equal(id(["map", "sales", "x"]), null);
});

test("Needs you, Tasks and a task", () => {
  assert.equal(id(["needs-you"]), "needs-you");
  assert.equal(id(["tasks"]), "tasks");
  assert.equal(id(["tasks", "STH-8"]), "task");
  assert.equal(id(["tasks", "e0000000-0000-4000-8000-000000000008"]), "task");
  assert.equal(id(["tasks", "a", "b"]), null);
});

test("Dashboards, the four record dashboards, Marketing and the Studio", () => {
  assert.equal(id(["dashboards"]), "dashboards");
  for (const d of ["books", "customers", "support", "people"]) assert.equal(id(["dashboards", d]), "dashboard", d);
  assert.equal(id(["dashboards", "marketing"]), "marketing");
  assert.equal(id(["dashboards", "studio"]), "studio");
  assert.equal(id(["dashboards", "sales"]), null);
  assert.equal(id(["dashboards", "books", "x"]), null);
});

test("Files, Jobs, a job, a department, Team and an agent", () => {
  assert.equal(id(["files"]), "files");
  assert.equal(id(["files", "brand"]), "files");
  assert.equal(id(["jobs"]), "jobs");
  assert.equal(id(["jobs", "sales", "call-write-up"]), "job");
  assert.equal(id(["jobs", "sales"]), null);
  assert.equal(id(["departments", "sales"]), "dept");
  assert.equal(id(["departments"]), null);
  assert.equal(id(["team"]), "team");
  assert.equal(id(["team", "artist"]), "agent");
});

test("Routines, Health, Settings and Search, and nothing else", () => {
  assert.equal(id(["routines"]), "routines");
  assert.equal(id(["routines", "daily-brief"]), "routines");
  assert.equal(id(["health"]), "health");
  assert.equal(id(["settings"]), "settings");
  assert.equal(id(["search"]), "search");
  for (const old of ["home", "docs", "gallery", "inbox", "books", "studio", "nowhere"]) assert.equal(id([old]), null, old);
});

test("which section is current for each page", () => {
  const want = {
    map: "map", dept: "map", jobs: "map", job: "map",
    tasks: "tasks", task: "tasks",
    // M63 item 6: on the Needs you page no section is current; the Needs you pill is (topbar).
    "needs-you": null,
    dashboards: "dashboards", dashboard: "dashboards", marketing: "dashboards", studio: "dashboards",
    files: "files",
    team: null, agent: null, routines: null, health: null, settings: null, search: null,
  };
  for (const [page, section] of Object.entries(want)) assert.equal(routes.sectionOf(page), section, page);
  assert.equal(routes.sectionOf("nowhere"), null);
});

test("the redirects of 26.1", () => {
  assert.deepEqual(routes.REDIRECTS, {
    home: "map", inbox: "needs-you", goals: "tasks", company: "team", knowledge: "files", docs: "files", gallery: "jobs",
    books: "dashboards/books", customers: "dashboards/customers", support: "dashboards/support", people: "dashboards/people",
    marketing: "dashboards/marketing", studio: "dashboards/studio",
  });
  const r = routes.redirectFor;
  assert.equal(r(["home"]), "#/map");
  assert.equal(r(["inbox"]), "#/needs-you");
  assert.equal(r(["goals"]), "#/tasks");
  assert.equal(r(["goals", "e0000000-0000-4000-8000-000000000008"]), "#/tasks/e0000000-0000-4000-8000-000000000008");
  assert.equal(r(["goals"], new URLSearchParams("view=board")), "#/tasks?view=board");
  assert.equal(r(["company"]), "#/team");
  assert.equal(r(["knowledge"]), "#/files");
  assert.equal(r(["docs"]), "#/files");
  assert.equal(r(["gallery"], new URLSearchParams("d=books")), "#/jobs?d=books");
  for (const d of ["books", "customers", "support", "people", "marketing"]) assert.equal(r([d]), `#/dashboards/${d}`);
  assert.equal(r(["studio"], new URLSearchParams("sprite=STH-8/walker")), "#/dashboards/studio?sprite=STH-8%2Fwalker");
  for (const stays of [["map"], ["tasks"], ["dashboards", "books"], ["files"], []]) assert.equal(r(stays), null);
});

test("#/docs?doc=<name> opens that file in Files, by its token", () => {
  assert.equal(routes.redirectFor(["docs"], new URLSearchParams("doc=Price%20list.md")), `#/files?file=${format.fileToken("Price list.md")}`);
  const to = routes.redirectFor(["docs"], "doc=brand.md&theme=dark");
  assert.equal(new URLSearchParams(to.split("?")[1]).get("file"), "YnJhbmQubWQ");
  assert.equal(new URLSearchParams(to.split("?")[1]).get("doc"), null);
});

test("a file's token is the base64url of its path, as the server makes it", () => {
  assert.equal(format.fileToken("brand/brand.md"), "YnJhbmQvYnJhbmQubWQ");
  assert.equal(format.fileToken("pricing/services.md"), "cHJpY2luZy9zZXJ2aWNlcy5tZA");
  for (const name of ["Price list.md", "Café menu ✓.md", "a?b>c.md"]) {
    const t = format.fileToken(name);
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(t, "base64url").toString("utf8"), name);
  }
});

test("the router reads the address, and the empty address is the map", async () => {
  const { parseHash } = await load("lib/router.js");
  assert.deepEqual(parseHash("").parts, ["map"]);
  assert.deepEqual(parseHash("#/").parts, ["map"]);
  const r = parseHash("#/tasks/STH-8?round=2&check=3");
  assert.deepEqual(r.parts, ["tasks", "STH-8"]);
  assert.equal(r.query.get("round"), "2");
  assert.deepEqual(parseHash("#/jobs/sales/call-write-up?from=STH-20").parts, ["jobs", "sales", "call-write-up"]);
  assert.equal(parseHash("#/files?file=YnJhbmQvYnJhbmQubWQ").query.get("file"), "YnJhbmQvYnJhbmQubWQ");
  assert.deepEqual(parseHash("#/team/chief%2Dof%2Dstaff").parts, ["team", "chief-of-staff"]);
});

test("linkHref gives the address for each new kind of link", () => {
  const { linkHref } = format;
  assert.equal(linkHref({ page: "files", id: "YnJhbmQvYnJhbmQubWQ" }), "#/files?file=YnJhbmQvYnJhbmQubWQ");
  assert.equal(linkHref({ page: "files" }), "#/files");
  assert.equal(linkHref({ page: "jobs", id: "sales/call-write-up" }), "#/jobs/sales/call-write-up");
  assert.equal(linkHref({ page: "jobs" }), "#/jobs");
  assert.equal(linkHref({ page: "departments", id: "sales" }), "#/departments/sales");
  assert.equal(linkHref({ page: "map", id: "sales" }), "#/map/sales");
  assert.equal(linkHref({ page: "map" }), "#/map");
  assert.equal(linkHref({ page: "dashboards", id: "books" }), "#/dashboards/books");
  assert.equal(linkHref({ page: "needs-you" }), "#/needs-you");
  assert.equal(linkHref({ page: "tasks", id: "STH-8" }), "#/tasks/STH-8");
  assert.equal(linkHref({ page: "team", id: "artist" }), "#/team/artist");
  assert.equal(linkHref({ page: "routines", id: "daily-brief" }), "#/routines/daily-brief");
  assert.equal(linkHref({ page: "health" }), "#/health");
  assert.equal(linkHref(null), null);
  assert.equal(linkHref({}), null);
  // A job's address reads back as its id.
  assert.equal(linkHref({ page: "jobs", id: "sales/x y" }), "#/jobs/sales/x%20y");
});

test("linkHref maps the old page names as the redirects do", () => {
  const { linkHref, fileToken } = format;
  const id = "e0000000-0000-4000-8000-000000000008";
  assert.equal(linkHref({ page: "goals", id }), `#/tasks/${id}`);
  assert.equal(linkHref({ page: "docs", id: "Price list.md" }), `#/files?file=${fileToken("Price list.md")}`);
  assert.equal(linkHref({ page: "knowledge", id: "brand.md" }), "#/files?file=YnJhbmQubWQ");
  assert.equal(linkHref({ page: "knowledge" }), "#/files");
  assert.equal(linkHref({ page: "gallery", id: "books/draft-an-invoice" }), "#/jobs/books/draft-an-invoice");
  assert.equal(linkHref({ page: "gallery" }), "#/jobs");
  for (const d of ["books", "customers", "support", "people", "marketing"]) assert.equal(linkHref({ page: d, id: "ACC-SINV-0001" }), `#/dashboards/${d}`);
  assert.equal(linkHref({ page: "studio", id: "STH-8/walker" }), "#/dashboards/studio?sprite=STH-8%2Fwalker");
  assert.equal(linkHref({ page: "studio" }), "#/dashboards/studio");
  assert.equal(linkHref({ page: "home" }), "#/map");
  assert.equal(linkHref({ page: "inbox" }), "#/needs-you");
  assert.equal(linkHref({ page: "company", id: "sales" }), "#/team/sales");
  // Every link of these kinds lands on a page of the table.
  for (const l of [{ page: "files", id: "x" }, { page: "jobs", id: "a/b" }, { page: "departments", id: "a" }, { page: "dashboards", id: "books" }, { page: "docs", id: "x" }, { page: "books" }]) {
    const href = linkHref(l);
    const parts = href.replace(/^#\//, "").split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
    assert.ok(routes.findRoute(parts), `${href} has a page`);
  }
});

test("the format helpers keep their exports and their words", () => {
  for (const name of ["when", "fullWhen", "bytes", "count", "splitCommand", "duration", "greeting", "linkHref", "fileToken"]) {
    assert.equal(typeof format[name], "function", `format.${name}`);
  }
  assert.deepEqual(format.splitCommand("Run: engine start"), { lead: "Run:", command: "engine start" });
  assert.equal(format.duration(7500000), "2 hours 5 minutes");
  assert.equal(format.duration(-5), "0 seconds");
  const at = (h) => new Date(2026, 10, 11, h, 0, 0);
  assert.equal(format.greeting(at(8)), "Good morning");
  assert.equal(format.greeting(at(12)), "Good afternoon");
  assert.equal(format.greeting(at(17)), "Good evening");
});

test("every shell/ and lib/ module loads in Node", async () => {
  const want = {
    "lib/api.js": ["api", "useResource", "useVisibleInterval", "ApiError"],
    "lib/router.js": ["parseHash", "go", "useRoute"],
    "lib/format.js": ["when", "duration", "greeting", "linkHref", "fileToken"],
    "lib/theme.js": ["currentTheme", "setTheme", "nextTheme", "THEME_WORDS", "ACCENTS", "setAccent", "currentBackdrop", "currentMotion"],
    "lib/theme-boot.js": [],
    "lib/context.js": ["AppContext", "useApp"],
    "lib/settings.js": ["loadSettings", "saveSettings", "cleanAppearance"],
    "shell/app-shell.js": ["AppShell", "keyAction", "overlayFrom", "paneOf", "isWide"],
    "shell/topbar.js": ["Topbar", "Capsule", "NeedsPill", "MenuSheet", "engineDot", "needsLabel", "commandKey", "switchedTheme"],
    "shell/dock.js": ["Dock", "dockItems", "dockCurrent", "showsDock", "DOCK_PAGES"],
    "shell/tabbar.js": ["TabBar"],
    "shell/needs-drawer.js": ["NeedsDrawer", "sortNeeds", "needsFor", "needsTitle"],
    "shell/work-panel.js": ["WorkPanel"],
    "shell/command-menu.js": ["CommandMenu", "localItems", "searchItems"],
    "shell/compose-dialog.js": ["ComposeDialog", "goalBody", "jobsOf", "jobHref"],
    "shell/lazy-page.js": ["LazyPage", "loadModule", "pageUrl"],
  };
  const found = [
    ...readdirSync(join(PUBLIC, "lib")).map((f) => `lib/${f}`),
    ...readdirSync(join(PUBLIC, "shell")).map((f) => `shell/${f}`),
  ].filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(found, Object.keys(want).sort(), "the shell and lib folders hold exactly these modules");
  for (const [file, names] of Object.entries(want)) {
    const m = await load(file);
    for (const n of names) assert.ok(n in m, `${file} exports ${n}`);
  }
});

test("the keys: c, ⌘K, Ctrl+K, / outside the map and on it, g then m t d f n j, Esc on a zoomed map, none while typing", () => {
  const { keyAction } = shellMod;
  assert.equal(keyAction({ key: "c" }), "compose");
  assert.equal(keyAction({ key: "k", metaKey: true }), "command");
  assert.equal(keyAction({ key: "k", ctrlKey: true }), "command");
  assert.equal(keyAction({ key: "K", ctrlKey: true, typing: true }), "command");
  assert.equal(keyAction({ key: "/", page: "tasks" }), "command");
  assert.equal(keyAction({ key: "/", page: "map" }), "box");
  assert.equal(keyAction({ key: "g" }), "g");
  const go = { m: "map", t: "tasks", d: "dashboards", f: "files", n: "needs-you", j: "jobs" };
  for (const [k, page] of Object.entries(go)) {
    assert.equal(keyAction({ key: k }, true), `go:${page}`, `g then ${k}`);
    assert.ok(routes.findRoute([page]), `${page} is a page`);
  }
  assert.equal(keyAction({ key: "h" }, true), null, "Home is gone");
  assert.equal(keyAction({ key: "m" }), null);
  assert.equal(keyAction({ key: "Escape", page: "map", zoomed: true }), "map-back");
  assert.equal(keyAction({ key: "Escape", page: "map", zoomed: false }), null);
  assert.equal(keyAction({ key: "Escape", page: "tasks" }), null);
  for (const key of ["c", "/", "g", "Escape"]) assert.equal(keyAction({ key, typing: true, page: "map", zoomed: true }), null, `${key} while typing`);
  assert.equal(keyAction({ key: "c", metaKey: true }), null);
});

test("overlays open from the query before the address", () => {
  const { overlayFrom } = shellMod;
  assert.equal(overlayFrom("?open=command"), "command");
  assert.equal(overlayFrom("?theme=dark&open=compose"), "compose");
  assert.equal(overlayFrom("?open=needs"), "needs");
  assert.equal(overlayFrom("?open=menu&theme=light"), "menu");
  assert.equal(overlayFrom("?open=other"), null);
  assert.equal(overlayFrom(""), null);
});

test("how the main pane holds each page", () => {
  const { paneOf, isWide } = shellMod;
  const q = (s) => new URLSearchParams(s);
  assert.equal(paneOf("map", q("")), "map");
  assert.equal(paneOf("tasks", q("")), "normal");
  assert.equal(paneOf("tasks", q("view=board")), "full");
  assert.equal(paneOf("studio", q("")), "full");
  for (const p of ["task", "dept", "job", "agent"]) assert.equal(paneOf(p, q("")), "column", p);
  for (const p of ["needs-you", "dashboards", "dashboard", "marketing", "files", "jobs", "team", "routines", "health", "settings", "search"]) assert.equal(paneOf(p, q("")), "normal", p);
  assert.equal(isWide("tasks", q("view=board")), true);
  assert.equal(isWide("tasks", q("")), false);
});

test("the dock shows on the pages of work, with the brain and the seven departments", () => {
  assert.deepEqual([...dockMod.DOCK_PAGES].sort(), ["agent", "dept", "job", "jobs", "needs-you", "task", "tasks", "team"]);
  for (const p of ["map", "dashboards", "files", "settings", "health", "routines", "search", "studio"]) assert.equal(dockMod.showsDock(p), false, p);
  const fallback = dockMod.dockItems(undefined);
  assert.deepEqual(fallback.map((i) => i.id), ["brain", "operations", "sales", "marketing", "studio", "support", "people", "books"]);
  assert.ok(fallback.every((i) => !i.live && !i.warm));
  assert.equal(fallback[0].href, "#/files");
  assert.equal(fallback[2].href, "#/departments/sales");
});

test("the dock's marks come from shell.dock", () => {
  const items = dockMod.dockItems([
    { id: "brain", title: "Company brain", creature: "brain", colour: "brain", working: 1, needsYou: 0 },
    { id: "sales", title: "Sales", creature: "sales", colour: "sales", working: 0, needsYou: 2 },
    { id: "books", title: "Books", creature: "books", colour: "books", working: 3, needsYou: 1 },
    { id: "../evil", title: "x", working: 1 },
    { id: "studio", title: "S".repeat(300), creature: "not-a-creature", working: "a lot", needsYou: -4 },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["brain", "sales", "books", "studio"]);
  const [brain, sales, books, studio] = items;
  assert.deepEqual([brain.live, brain.warm, brain.label], [true, false, "Company brain, 1 working"]);
  assert.deepEqual([sales.live, sales.warm, sales.label], [false, true, "Sales, 2 need you"]);
  assert.equal(books.label, "Books, 3 working, 1 needs you");
  assert.equal(studio.creature, "studio", "an unknown creature falls back to the department's own");
  assert.ok(studio.title.length <= 40);
  assert.deepEqual([studio.live, studio.warm], [false, false]);
});

test("the dock marks the department the page is about", () => {
  const { dockCurrent } = dockMod;
  const q = (s) => new URLSearchParams(s);
  assert.equal(dockCurrent("dept", ["departments", "sales"], q("")), "sales");
  assert.equal(dockCurrent("job", ["jobs", "books", "draft-an-invoice"], q("")), "books");
  assert.equal(dockCurrent("jobs", ["jobs"], q("d=studio")), "studio");
  assert.equal(dockCurrent("tasks", ["tasks"], q("d=people")), "people");
  assert.equal(dockCurrent("needs-you", ["needs-you"], q("")), null);
  assert.equal(dockCurrent("team", ["team"], q("d=sales")), null);
});

// M63 item 6: on the Needs you page the pill is the current place, and no capsule section is.
test("the Needs you pill shows as current on the Needs you page only", () => {
  const props = (current) => topbar.NeedsPill({ count: 2, onOpen: () => {}, current }).props;
  assert.match(props(true).class, /\bis-current\b/);
  assert.equal(props(true)["aria-current"], "page");
  assert.doesNotMatch(props(false).class, /is-current/);
  assert.equal(props(false)["aria-current"], undefined);
  assert.equal(routes.sectionOf("needs-you"), null);
  const flat = (routeId) => JSON.stringify(topbar.Capsule({ routeId }), (k, v) => (k === "__" || k === "_parent" || typeof v === "function" ? undefined : v));
  assert.doesNotMatch(flat("needs-you"), /is-current/, "no section of the capsule is current");
  assert.match(flat("tasks"), /is-current/, "on Tasks, Tasks is");
});

test("the top bar's words: the Needs you pill, the Health dot, the theme switch", () => {
  assert.equal(topbar.needsLabel(5), "Needs you, 5 waiting");
  assert.equal(topbar.needsLabel(0), "Needs you, nothing waiting");
  assert.equal(topbar.needsLabel("x"), "Needs you, nothing waiting");
  assert.equal(topbar.engineDot({ board: "on", books: "on" }).tone, "ok");
  assert.equal(topbar.engineDot({ board: "off", books: "on" }).tone, "bad");
  assert.equal(topbar.engineDot({ board: "on", books: "off" }).tone, "warn");
  assert.equal(topbar.engineDot(null), null);
  assert.equal(topbar.switchedTheme("dark", false), "light");
  assert.equal(topbar.switchedTheme("light", true), "dark");
  assert.equal(topbar.switchedTheme("auto", true), "light");
  assert.equal(topbar.switchedTheme("auto", false), "dark");
  assert.equal(topbar.switchedTheme(undefined, false), "light", "no choice means dark, so the switch offers light");
});

test("the Needs you drawer: urgent first, then newest; one department by its agents or its dashboard", () => {
  const items = [
    { id: "a", severity: "normal", when: "2026-11-11T08:00:00.000Z", source: "goal", agent: { slug: "sales" } },
    { id: "b", severity: "high", when: "2026-11-11T07:00:00.000Z", source: "board" },
    { id: "c", severity: "normal", when: "2026-11-11T09:00:00.000Z", source: "customers" },
    { id: "d", severity: "high", when: "2026-11-11T09:30:00.000Z", source: "books" },
    { id: "e", severity: "normal", when: "broken", source: "marketing" },
    null,
  ];
  assert.deepEqual(needs.sortNeeds(items).map((i) => i.id), ["d", "b", "c", "a", "e"]);
  const departments = [{ id: "sales", title: "Sales", agents: [{ slug: "sales", name: "Sales" }] }];
  assert.deepEqual(needs.needsFor(items.filter(Boolean), "sales", departments).map((i) => i.id), ["a", "c"]);
  assert.deepEqual(needs.needsFor(items.filter(Boolean), "sales", null).map((i) => i.id), ["c"], "without the map, by source alone");
  assert.deepEqual(needs.needsFor(items.filter(Boolean), "books", departments).map((i) => i.id), ["d"]);
  assert.equal(needs.needsFor(items.filter(Boolean), null).length, 5);
  assert.equal(needs.needsTitle(null), "Needs you");
  assert.equal(needs.needsTitle("sales", departments), "Needs you: Sales");
  assert.equal(needs.needsTitle("people", null), "Needs you: People");
});

const JOBS = {
  departments: [
    { id: "sales", title: "Sales", clusters: [{ id: "calls", title: "Calls", jobs: [
      { id: "sales/call-write-up", title: "Call write-up", summary: "Notes from a call.", department: { id: "sales", title: "Sales" }, ready: true },
      { id: "sales/proposal-from-a-call", title: "Proposal from a call write-up", summary: "A written proposal.", department: { id: "sales", title: "Sales" }, ready: false },
    ] }] },
    { id: "books", title: "Books", clusters: [{ id: "selling", title: "Selling", jobs: [
      { id: "books/draft-an-invoice", title: "Draft an invoice", summary: "", department: { id: "books", title: "Books" }, ready: true },
      { id: "../x", title: "Bad" }, { title: "No id" },
    ] }] },
  ],
};

test("the compose dialog offers jobs and sends only what was chosen", () => {
  const jobs = compose.jobsOf(JOBS);
  assert.deepEqual(jobs.map((j) => j.id), ["sales/call-write-up", "sales/proposal-from-a-call", "books/draft-an-invoice"]);
  assert.deepEqual(compose.jobsOf(null), []);
  assert.equal(compose.jobHref(jobs[0]), "#/jobs/sales/call-write-up");
  assert.deepEqual(compose.goalBody({ text: "  Draft an invoice  ", to: null, planFirst: false, template: null }), { text: "Draft an invoice" });
  assert.deepEqual(compose.goalBody({ text: "x", to: "chief-of-staff" }), { text: "x" });
  assert.deepEqual(compose.goalBody({ text: "x", to: "artist", planFirst: true, template: "studio/walk" }), { text: "x", to: "artist", planFirst: true, template: "studio/walk" });
});

test("the command menu lists the pages and the seven departments, and finds jobs and agents at once", () => {
  const { localItems, searchItems } = menu;
  const empty = localItems("", []);
  for (const [label, href] of [["Map", "#/map"], ["Tasks", "#/tasks"], ["Dashboards", "#/dashboards"], ["Files", "#/files"], ["Needs you", "#/needs-you"], ["Jobs", "#/jobs"], ["Team", "#/team"]]) {
    assert.ok(empty.some((i) => i.label === label && i.href === href), label);
  }
  assert.deepEqual(empty.filter((i) => i.group === "Departments").map((i) => i.href), routes.DEPARTMENTS.map((d) => `#/departments/${d.id}`));
  assert.ok(empty.some((i) => i.label === "New task" && i.action === "compose"));
  assert.ok(!empty.some((i) => /ready-made|gallery|home|docs/i.test(`${i.label} ${i.href || ""}`)), "no old page is offered");
  for (const i of empty.filter((x) => x.href)) {
    const parts = i.href.replace(/^#\//, "").split("?")[0].split("/").filter(Boolean);
    assert.ok(routes.findRoute(parts), `${i.href} has a page`);
  }
  const team = [{ slug: "artist", name: "Artist" }, { slug: "marketer", name: "Marketer" }];
  const typed = localItems("art", team);
  assert.ok(typed.some((i) => i.href === "#/team/artist"));
  assert.ok(!typed.some((i) => i.href === "#/team/marketer"));
  assert.ok(typed.some((i) => i.action === "compose" && i.text === "art"));
  assert.ok(typed.some((i) => i.href === "#/search?q=art"));
  const jobs = compose.jobsOf(JOBS);
  const call = localItems("call", team, jobs);
  assert.deepEqual(call.filter((i) => i.group === "Jobs").map((i) => [i.label, i.href, i.hint]), [
    ["Call write-up", "#/jobs/sales/call-write-up", "Sales"],
    ["Proposal from a call write-up", "#/jobs/sales/proposal-from-a-call", "Cannot start yet"],
  ]);
  assert.ok(localItems("sales", [], jobs).some((i) => i.group === "Departments" && i.href === "#/departments/sales"));
  const found = searchItems({ groups: [
    { source: "goals", label: "Tasks", results: [{ title: "Walk cycle", snippet: "", link: { page: "goals", id: "e1" } }] },
    { source: "jobs", label: "Jobs", results: [{ title: "Call write-up", snippet: "", link: { page: "jobs", id: "sales/call-write-up" } }] },
    { source: "brain", label: "Files", results: [{ title: "brand.md", snippet: "", link: { page: "files", id: "YnJhbmQvYnJhbmQubWQ" } }] },
  ] });
  assert.deepEqual(found.map((i) => [i.group, i.label, i.href]), [
    ["Tasks", "Walk cycle", "#/tasks/e1"], ["Jobs", "Call write-up", "#/jobs/sales/call-write-up"], ["Files", "brand.md", "#/files?file=YnJhbmQvYnJhbmQubWQ"],
  ]);
});

test("the settings carry the background and the motion", async () => {
  const { cleanAppearance } = await load("lib/settings.js");
  assert.deepEqual(cleanAppearance({ theme: "light", accent: "blue", backdrop: "stars", motion: "off" }), { theme: "light", accent: "blue", backdrop: "stars", motion: "off" });
  assert.deepEqual(cleanAppearance({ theme: "neon", backdrop: "lava", motion: "fast" }), { theme: "dark", backdrop: "aurora", motion: "on" });
  assert.deepEqual(cleanAppearance({ theme: "auto" }), { theme: "auto" }, "a key the server did not send is left to this browser");
  assert.deepEqual(cleanAppearance(null), {});
});

test("a missing page module loads as nothing, so the shell shows that it is being built", async () => {
  const { loadModule, pageUrl } = await load("shell/lazy-page.js");
  assert.equal(pageUrl("./pages/map.js"), pathToFileURL(join(PUBLIC, "pages", "map.js")).href);
  assert.equal(await loadModule("./pages/there-is-no-such-page.js"), null);
  assert.equal(await loadModule("./routes.js", "nothing"), null);
});

// ---- A very small DOM, enough for Preact to render into and for us to walk (as in pages-u2). ----
class FakeNode {
  constructor() { this.childNodes = []; this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}
class FakeText extends FakeNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.style = { cssText: "", setProperty(k, v) { this[k] = v; } }; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function show(Component, props) {
  globalThis.document = { createElement: (t) => new FakeElement(t), createElementNS: (_n, t) => new FakeElement(t), createTextNode: (x) => new FakeText(x), addEventListener() {}, removeEventListener() {} };
  const root = new FakeElement("div");
  render(html`<${Component} ...${props} />`, root);
  return root;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const classOf = (el) => String(el.getAttribute("class") ?? el.className ?? "");
const attr = (el, k) => el.getAttribute(k) ?? el[k] ?? null;
const withClass = (root, c) => elements(root).filter((e) => classOf(e).split(/\s+/).includes(c));
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");

test("the top bar draws the capsule with the current section, the Needs you pill and the three squares", () => {
  const shell = { company: { name: "Sthyra" }, counts: { needsYou: 5 }, engine: { board: "on", books: "off" } };
  const root = show(topbar.Topbar, { routeId: "task", shell, narrow: false, settings: { theme: "dark" }, onSaveSettings() {}, onNeeds() {}, onMenu() {} });
  const tabs = withClass(root, "s-capsule-item");
  assert.deepEqual(tabs.map((t) => attr(t, "href")), ["#/map", "#/tasks", "#/dashboards", "#/files"]);
  assert.deepEqual(tabs.map((t) => attr(t, "aria-current")), [null, "page", null, null]);
  const pill = withClass(root, "s-needs")[0];
  assert.equal(attr(pill, "aria-label"), "Needs you, 5 waiting");
  assert.ok(classOf(pill).includes("is-warm"));
  assert.equal(withClass(root, "s-square").length, 3);
  assert.ok(withClass(root, "s-square-dot--warn").length === 1);
  assert.deepEqual(withClass(root, "s-word").map((a) => attr(a, "href")), ["#/jobs", "#/routines"]);
  assert.match(textOf(root), /Sthyra/);
  const narrow = show(topbar.Topbar, { routeId: "map", shell: { counts: { needsYou: 0 } }, narrow: true, settings: {}, onNeeds() {}, onMenu() {} });
  assert.equal(withClass(narrow, "s-capsule").length, 0, "below 860 px the sections move to the tab bar");
  assert.equal(attr(withClass(narrow, "s-needs")[0], "aria-label"), "Needs you, nothing waiting");
  assert.ok(elements(narrow).some((e) => attr(e, "aria-label") === "Menu"));
});

test("the dock draws a creature, a link and screen-reader words for each item", () => {
  const dock = [{ id: "brain", title: "Company brain", creature: "brain", working: 1, needsYou: 0 }, { id: "sales", title: "Sales", creature: "sales", working: 0, needsYou: 2 }];
  const root = show(dockMod.Dock, { dock, current: "sales", onCompose() {} });
  const items = withClass(root, "s-dock-item");
  assert.deepEqual(items.map((i) => [attr(i, "href"), attr(i, "aria-label"), attr(i, "aria-current")]), [
    ["#/files", "Company brain, 1 working", null], ["#/departments/sales", "Sales, 2 need you", "page"],
  ]);
  assert.equal(withClass(root, "k-creature").length, 2);
  assert.equal(withClass(root, "s-dock-live").length, 1);
  assert.equal(withClass(root, "s-dock-warm").length, 1);
  assert.equal(attr(withClass(root, "s-dock-book")[0], "href"), "#/jobs");
  assert.equal(attr(withClass(root, "s-dock-new")[0], "aria-label"), "New task");
});

test("the tab bar holds the four sections, the current one marked", async () => {
  const { TabBar } = await load("shell/tabbar.js");
  const root = show(TabBar, { routeId: "dashboard" });
  const tabs = withClass(root, "s-tab");
  assert.deepEqual(tabs.map((t) => [attr(t, "href"), attr(t, "aria-current")]), [["#/map", null], ["#/tasks", null], ["#/dashboards", "page"], ["#/files", null]]);
});

// M63: once a task is given, the dialog says how long it takes, unless other work is ahead in the Chief of staff's
// line (`queue` of GET /api/shell); then it names the line with the words the map and the jobs use.
test("the compose dialog's words follow the Chief of staff's line", () => {
  assert.equal(compose.givenLine(null), "Given to the Chief of staff. It takes a few minutes and is checked before it reaches you.");
  assert.equal(compose.givenLine({ ahead: 0 }), "Given to the Chief of staff. It takes a few minutes and is checked before it reaches you.");
  assert.equal(compose.givenLine({ ahead: 3 }), "Given to the Chief of staff. 3 tasks are ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(compose.givenLine({ ahead: 1 }), "Given to the Chief of staff. 1 task is ahead, so it waits its turn. It is checked before it reaches you.");
  assert.equal(compose.givenLine({ ahead: -2 }), compose.givenLine(null));
  const src = readFileSync(join(PUBLIC, "shell", "app-shell.js"), "utf8");
  assert.match(src, /<\$\{ComposeDialog\}[^>]*queue=\$\{shell\.data\?\.queue/, "the shell passes its queue to the dialog");
});
