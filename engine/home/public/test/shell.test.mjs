// The shell, the route table and lib/ (CONTRACTS-V2 14): the table names every page, old addresses
// move to new ones, links and words come out right, and every shell/ and lib/ module loads in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routes = await import(pathToFileURL(join(PUBLIC, "routes.js")).href);
const format = await import(pathToFileURL(join(PUBLIC, "lib", "format.js")).href);

const TABLE = {
  home: "./pages/home.js",
  tasks: "./pages/tasks.js",
  task: "./pages/task.js",
  docs: "./pages/docs.js",
  team: "./pages/team.js",
  agent: "./pages/agent.js",
  books: "./pages/department.js",
  customers: "./pages/department.js",
  support: "./pages/department.js",
  people: "./pages/department.js",
  marketing: "./pages/marketing.js",
  studio: "./pages/studio.js",
  routines: "./pages/routines.js",
  gallery: "./pages/gallery.js",
  health: "./pages/health.js",
  settings: "./pages/settings.js",
  search: "./pages/search.js",
};

test("every route of the table is in ROUTES with its file, title, match, nav and icon", () => {
  const ids = routes.ROUTES.map((r) => r.id);
  assert.deepEqual([...ids].sort(), Object.keys(TABLE).sort());
  for (const r of routes.ROUTES) {
    assert.equal(r.file, TABLE[r.id], `${r.id} loads ${TABLE[r.id]}`);
    assert.equal(typeof r.title, "string");
    assert.ok(r.title.length > 0);
    assert.equal(typeof r.match, "function");
    assert.ok(["top", "main", "team", "departments", "bottom", null].includes(r.nav), `${r.id} has a known nav group`);
  }
  const nav = (g) => routes.ROUTES.filter((r) => r.nav === g).map((r) => r.id);
  assert.deepEqual(nav("main"), ["home", "tasks", "docs"]);
  assert.deepEqual(nav("bottom"), ["routines", "health", "settings"]);
  assert.deepEqual(nav("departments"), ["books", "customers", "support", "people", "marketing", "studio"]);
  assert.deepEqual(routes.EXTRA_MODULES, ["./studio/sprite-player.js"]);
});

test("addresses find their page", () => {
  const id = (parts) => routes.findRoute(parts)?.id ?? null;
  assert.equal(id([]), "home");
  assert.equal(id(["home"]), "home");
  assert.equal(id(["tasks"]), "tasks");
  assert.equal(id(["tasks", "STH-8"]), "task");
  assert.equal(id(["docs"]), "docs");
  assert.equal(id(["team"]), "team");
  assert.equal(id(["team", "artist"]), "agent");
  for (const d of ["books", "customers", "support", "people", "marketing", "studio"]) assert.equal(id([d]), d);
  assert.equal(id(["routines"]), "routines");
  assert.equal(id(["routines", "daily-brief"]), "routines");
  assert.equal(id(["gallery"]), "gallery");
  assert.equal(id(["health"]), "health");
  assert.equal(id(["settings"]), "settings");
  assert.equal(id(["search"]), "search");
  assert.equal(id(["nowhere"]), null);
  assert.equal(id(["tasks", "a", "b"]), null);
});

test("old addresses redirect to the new ones", () => {
  assert.deepEqual(routes.REDIRECTS, { inbox: "home", goals: "tasks", company: "team", knowledge: "docs" });
  assert.equal(routes.redirectFor(["inbox"]), "#/home");
  assert.equal(routes.redirectFor(["goals"]), "#/tasks");
  assert.equal(routes.redirectFor(["goals", "e0000000-0000-4000-8000-000000000008"]), "#/tasks/e0000000-0000-4000-8000-000000000008");
  assert.equal(routes.redirectFor(["company"]), "#/team");
  assert.equal(routes.redirectFor(["knowledge"]), "#/docs");
  assert.equal(routes.redirectFor(["goals"], new URLSearchParams("view=list")), "#/tasks?view=list");
  assert.equal(routes.redirectFor(["tasks"]), null);
  assert.equal(routes.redirectFor([]), null);
});

test("the router reads the address, and the empty address is Home", async () => {
  const { parseHash } = await import(pathToFileURL(join(PUBLIC, "lib", "router.js")).href);
  assert.deepEqual(parseHash("").parts, ["home"]);
  assert.deepEqual(parseHash("#/").parts, ["home"]);
  const r = parseHash("#/tasks/STH-8?round=2&check=3");
  assert.deepEqual(r.parts, ["tasks", "STH-8"]);
  assert.equal(r.query.get("round"), "2");
  assert.deepEqual(parseHash("#/docs?doc=Price%20list").query.get("doc"), "Price list");
  assert.deepEqual(parseHash("#/team/chief%2Dof%2Dstaff").parts, ["team", "chief-of-staff"]);
});

test("linkHref gives the address for each kind of link", () => {
  const { linkHref } = format;
  const id = "e0000000-0000-4000-8000-000000000008";
  assert.equal(linkHref({ page: "tasks", id }), `#/tasks/${id}`);
  assert.equal(linkHref({ page: "goals", id }), `#/tasks/${id}`);
  assert.equal(linkHref({ page: "tasks" }), "#/tasks");
  assert.equal(linkHref({ page: "team", id: "artist" }), "#/team/artist");
  assert.equal(linkHref({ page: "docs", id: "price-list.md" }), "#/docs?doc=price-list.md");
  assert.equal(linkHref({ page: "knowledge", id: "Price list" }), "#/docs?doc=Price%20list");
  assert.equal(linkHref({ page: "routines", id: "daily-brief" }), "#/routines/daily-brief");
  assert.equal(linkHref({ page: "gallery", id: "books/draft-an-invoice" }), "#/gallery?open=books%2Fdraft-an-invoice");
  assert.equal(linkHref({ page: "studio", id: "STH-8/walker" }), "#/studio?sprite=STH-8%2Fwalker");
  assert.equal(linkHref({ page: "books", id: "ACC-SINV-0001" }), "#/books");
  assert.equal(linkHref({ page: "health" }), "#/health");
  assert.equal(linkHref(null), null);
  assert.equal(linkHref({}), null);
  // What the address carries reads back the same.
  assert.equal(new URLSearchParams(linkHref({ page: "gallery", id: "books/draft-an-invoice" }).split("?")[1]).get("open"), "books/draft-an-invoice");
});

test("greeting follows the clock", () => {
  const at = (h) => new Date(2026, 10, 11, h, 0, 0);
  assert.equal(format.greeting(at(8)), "Good morning");
  assert.equal(format.greeting(at(13)), "Good afternoon");
  assert.equal(format.greeting(at(19)), "Good evening");
  assert.equal(format.greeting(at(12)), "Good afternoon");
  assert.equal(format.greeting(at(17)), "Good evening");
});

test("duration says how long in words", () => {
  assert.equal(format.duration(45000), "45 seconds");
  assert.equal(format.duration(540000), "9 minutes");
  assert.equal(format.duration(7500000), "2 hours 5 minutes");
  assert.equal(format.duration(1000), "1 second");
  assert.equal(format.duration(60000), "1 minute");
  assert.equal(format.duration(3600000), "1 hour");
  assert.equal(format.duration(0), "0 seconds");
  assert.equal(format.duration(-5), "0 seconds");
});

test("the older format helpers keep their exports", () => {
  for (const name of ["when", "fullWhen", "bytes", "count", "splitCommand", "duration", "greeting", "linkHref"]) {
    assert.equal(typeof format[name], "function", `format.${name}`);
  }
  assert.deepEqual(format.splitCommand("Run: engine start"), { lead: "Run:", command: "engine start" });
});

test("every shell/ and lib/ module loads in Node", async () => {
  const want = {
    "lib/api.js": ["api", "useResource", "useVisibleInterval", "ApiError"],
    "lib/router.js": ["parseHash", "go", "useRoute"],
    "lib/format.js": ["when", "duration", "greeting", "linkHref"],
    "lib/theme.js": ["currentTheme", "setTheme", "nextTheme", "THEME_WORDS", "ACCENTS", "setAccent"],
    "lib/theme-boot.js": [],
    "lib/context.js": ["AppContext", "useApp"],
    "lib/settings.js": ["loadSettings", "saveSettings"],
    "shell/app-shell.js": ["AppShell", "keyAction", "overlayFrom", "isWide"],
    "shell/sidebar.js": ["Sidebar", "agentMark", "engineLine"],
    "shell/work-panel.js": ["WorkPanel"],
    "shell/command-menu.js": ["CommandMenu", "localItems", "searchItems"],
    "shell/compose-dialog.js": ["ComposeDialog", "goalBody", "templatesOf"],
    "shell/lazy-page.js": ["LazyPage", "loadModule", "pageUrl"],
  };
  const found = [
    ...readdirSync(join(PUBLIC, "lib")).map((f) => `lib/${f}`),
    ...readdirSync(join(PUBLIC, "shell")).map((f) => `shell/${f}`),
  ].filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(found, Object.keys(want).sort(), "the shell and lib folders hold exactly these modules");
  for (const [file, names] of Object.entries(want)) {
    const m = await import(pathToFileURL(join(PUBLIC, file)).href);
    for (const n of names) assert.ok(n in m, `${file} exports ${n}`);
  }
});

test("the keys: c, /, ⌘K, Ctrl+K, g then h t d, and none while typing", async () => {
  const { keyAction } = await import(pathToFileURL(join(PUBLIC, "shell", "app-shell.js")).href);
  assert.equal(keyAction({ key: "c" }), "compose");
  assert.equal(keyAction({ key: "/" }), "command");
  assert.equal(keyAction({ key: "k", metaKey: true }), "command");
  assert.equal(keyAction({ key: "k", ctrlKey: true }), "command");
  assert.equal(keyAction({ key: "K", ctrlKey: true, typing: true }), "command");
  assert.equal(keyAction({ key: "g" }), "g");
  assert.equal(keyAction({ key: "h" }, true), "go:home");
  assert.equal(keyAction({ key: "t" }, true), "go:tasks");
  assert.equal(keyAction({ key: "d" }, true), "go:docs");
  assert.equal(keyAction({ key: "h" }), null);
  assert.equal(keyAction({ key: "c", typing: true }), null);
  assert.equal(keyAction({ key: "/", typing: true }), null);
  assert.equal(keyAction({ key: "c", metaKey: true }), null);
});

test("overlays open from the query before the address, and wide pages", async () => {
  const { overlayFrom, isWide } = await import(pathToFileURL(join(PUBLIC, "shell", "app-shell.js")).href);
  assert.equal(overlayFrom("?open=command"), "command");
  assert.equal(overlayFrom("?theme=dark&open=compose"), "compose");
  assert.equal(overlayFrom("?open=menu"), "menu");
  assert.equal(overlayFrom("?open=other"), null);
  assert.equal(overlayFrom(""), null);
  assert.equal(isWide("tasks", new URLSearchParams("")), true);
  assert.equal(isWide("tasks", new URLSearchParams("view=list")), false);
  assert.equal(isWide("studio", new URLSearchParams("")), true);
  assert.equal(isWide("home", new URLSearchParams("")), false);
});

test("the sidebar's marks and the engine line", async () => {
  const { agentMark, engineLine } = await import(pathToFileURL(join(PUBLIC, "shell", "sidebar.js")).href);
  assert.equal(agentMark({ state: "working" }).tone, "live");
  assert.equal(agentMark({ state: "free", waitingForYou: true }).tone, "warn");
  assert.equal(agentMark({ state: "waiting_for_you" }).label, "Waiting for you");
  assert.equal(agentMark({ state: "free" }), null);
  assert.deepEqual(engineLine({ board: "on", books: "on" }), { tone: "ok", text: "Engine on" });
  assert.equal(engineLine({ board: "off", books: "on" }).text, "Engine off");
  assert.equal(engineLine({ board: "on", books: "off" }).text, "Books are off");
  assert.equal(engineLine(null), null);
});

test("the command menu finds pages and agents at once and offers a new task", async () => {
  const { localItems, searchItems } = await import(pathToFileURL(join(PUBLIC, "shell", "command-menu.js")).href);
  const empty = localItems("", []);
  assert.ok(empty.some((i) => i.label === "Home" && i.href === "#/home"));
  assert.ok(empty.some((i) => i.label === "New task" && i.action === "compose"));
  assert.ok(empty.some((i) => i.label === "Ready-made goals" && i.href === "#/gallery"));
  const team = [{ slug: "artist", name: "Artist" }, { slug: "marketer", name: "Marketer" }];
  const typed = localItems("art", team);
  assert.ok(typed.some((i) => i.href === "#/team/artist"));
  assert.ok(!typed.some((i) => i.href === "#/team/marketer"));
  assert.ok(typed.some((i) => i.action === "compose" && i.text === "art"));
  assert.ok(typed.some((i) => i.href === "#/search?q=art"));
  const found = searchItems({ groups: [{ source: "goals", label: "Tasks", results: [{ title: "Walk cycle", snippet: "", link: { page: "goals", id: "e1" } }] }] });
  assert.deepEqual(found.map((i) => [i.group, i.label, i.href]), [["Tasks", "Walk cycle", "#/tasks/e1"]]);
});

test("the compose dialog sends only what was chosen", async () => {
  const { goalBody, templatesOf } = await import(pathToFileURL(join(PUBLIC, "shell", "compose-dialog.js")).href);
  assert.deepEqual(goalBody({ text: "  Draft an invoice  ", to: null, planFirst: false, template: null }), { text: "Draft an invoice" });
  assert.deepEqual(goalBody({ text: "x", to: "chief-of-staff" }), { text: "x" });
  assert.deepEqual(goalBody({ text: "x", to: "artist", planFirst: true, template: "studio/walk" }), { text: "x", to: "artist", planFirst: true, template: "studio/walk" });
  const t = templatesOf({ departments: [{ id: "books", title: "Books", goals: [{ id: "books/a", title: "A" }] }] });
  assert.equal(t.length, 1);
  assert.equal(t[0].department, "books");
});

test("a missing page module loads as nothing, so the shell shows that it is being built", async () => {
  const { loadModule, pageUrl } = await import(pathToFileURL(join(PUBLIC, "shell", "lazy-page.js")).href);
  assert.equal(pageUrl("./pages/home.js"), pathToFileURL(join(PUBLIC, "pages", "home.js")).href);
  assert.equal(await loadModule("./pages/there-is-no-such-page.js"), null);
  assert.equal(await loadModule("./routes.js", "nothing"), null);
});
