// Setup page (PLAN-ONBOARD T2, reworked in S2 for the three groups): the pure helpers, then the page mounted in the shared test DOM with a fake fetch.
// The fixtures are written here, in the contract's shape (not read from the server's shape file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = await import("../../pages/setup.js");
const dom = await import("../kit/_dom.mjs");
const { html, render } = dom;
const { AppContext } = await import("../../lib/context.js");

const SOURCE = readFileSync(new URL("../../pages/setup.js", import.meta.url), "utf8");
const TOOLS = ["paperclip", "Frappe", "ERPNext", "MariaDB", "sandbox-runtime", "Claude", "Codex", "CadQuery", "Pillow", "Ollama", "Kestra", "Aseprite", "Piskel", "ffmpeg", "whisper", "Blender"];
const NIL_RATED = "Until then invoices say \"Nil-Rated\" even where tax is charged, and leave can be drafted but not made final.";
const BOOKS_ASKS = "It asks whether the company is registered for GST, the company's address, and the weekly days off and public holidays, then shows it all and saves it in one go.";

const RESEARCHER = "When this is on, the addresses the Researcher opens and the words it searches for leave this Mac.";
const TERMS = "Runway's terms say it may use what you send to train its models unless you have an Enterprise agreement. Do not use Generation for client work you may not share.";
const SETTINGS = [{ label: "Open Settings", href: "#/settings" }];

const step = (id, title, over = {}) => ({ id, group: "start", title, state: "todo", canSkip: false, skipped: false, line: "", why: null, notes: [], links: [], commands: [], facts: {}, opens: null, costs: [], ...over });
const later = (id, title, over = {}) => step(id, title, { group: "later", line: `${title} is not set up.`, opens: `${title} opens something up.`, links: SETTINGS, ...over });

// A first run in plans mode: nothing done yet, the books connected and empty.
const FIRST_RUN = Object.freeze({
  open: true,
  show: true,
  dismissed: false,
  finished: false,
  mode: "plans",
  counts: { done: 0, skipped: 0, total: 6 },
  later: { done: 1, total: 8 },
  groups: [
    { id: "start", title: "Needed to start", say: "Do these and the engine can do real work for you." },
    { id: "later", title: "When you want it", say: "Each of these is off until you choose it. Each line says what it opens up and what it costs or sends off this Mac." },
    { id: "notyet", title: "Not possible yet", say: "These cannot be set up yet. Nothing can be published or sent from here until they exist." },
  ],
  steps: [
    step("models", "Models", { line: "Plans mode is on, but the agents have no login of their own yet.", why: "Your agents think with these.", links: SETTINGS, commands: [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/fence/login-wizard.sh" }] }),
    step("proof", "The fence check", { line: "The fence has not been checked yet. Run the proof to check it.", why: "The fence is what keeps agents away from the internet, your files and your logins. The proof checks that it holds.", links: [{ label: "Open Health", href: "#/health" }] }),
    step("basics", "Company basics", { canSkip: true, line: "0 of 9 basics filled.", why: "Every agent reads these before it works, so what it makes sounds like your company. Filling them takes about 20 minutes.", links: [{ label: "Open Files", href: "#/files" }] }),
    step("brand", "Brand kit", { canSkip: true, line: "No brand kit yet.", why: "Your colours, fonts and logo. Posters, pages and apps are made in this look.", links: [{ label: "Open the brand kit", href: "#/files/brand-kit" }] }),
    step("books", "The books", { canSkip: true, line: "The books are connected. Your company's details are not in them yet.", why: "Invoices, customers, support and leave are kept in the books.", notes: [BOOKS_ASKS, NIL_RATED], links: [{ label: "Open the Books dashboard", href: "#/dashboards/books" }], commands: [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/books/setup-wizard.sh" }] }),
    step("task", "A first real task", { line: "No task yet.", why: "Say what you want done in your own words.", links: [{ label: "Choose a job", href: "#/jobs" }] }),
    later("checker-login", "The Checker's own login", { line: "The Checker has no login yet.", links: [], commands: [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/fence/login-wizard.sh codex" }] }),
    later("routines", "Routines", { state: "done", line: "1 of 2 routines are switched on.", costs: ["Each run costs one run of that agent on your plan."], links: [{ label: "Open Routines", href: "#/routines" }] }),
    later("web", "The web for the Researcher", { line: "Off. No agent can reach the internet.", costs: [RESEARCHER] }),
    later("viewer", "The page viewer", { line: "Off. A page job stops until it is switched on." }),
    later("generation", "Runway: clips and pictures", { line: "No Runway key is saved.", notes: ["Most to spend in a day: $3.00. Most to spend in a month: $10.00. A limit of 0 stops all making."], costs: ["This costs money beyond your plans. Nothing is spent until you approve a cost.", TERMS] }),
    later("higgsfield", "Higgsfield", { line: "Not signed in. Higgsfield is off." }),
    later("apps", "App Studio", { state: "unknown", line: "Its switch could not be read. Open Settings.", links: [{ label: "Open App Studio", href: "#/apps" }] }),
    later("brain", "The brain", { line: "Off. The books keep a history for Project and Contact, so it can be switched on." }),
  ],
  notYet: [
    { id: "publishing", title: "Publishing", line: "Nothing is published from here yet.", how: "It needs a place to publish to." },
    { id: "email", title: "Email", line: "No email is sent from here yet.", how: "It needs a mail account." },
    { id: "whatsapp", title: "WhatsApp", line: "No message is sent yet.", how: "It needs a business account." },
    { id: "gst_portal", title: "The GST portal", line: "Returns are not filed from here.", how: "It needs the portal's access." },
    { id: "board_login", title: "The board's sign-in", line: "The board has no sign-in of its own.", how: "It runs on this Mac only." },
  ],
  generatedAt: "2026-11-18T10:00:00.000Z",
});
const copy = (x) => JSON.parse(JSON.stringify(x));
const START = ["models", "proof", "basics", "brand", "books", "task"];
const LATER = ["checker-login", "routines", "web", "viewer", "generation", "higgsfield", "apps", "brain"];

// ---- the pure helpers ----

test("setup: the default export is a component; the page's words are pinned", () => {
  assert.equal(typeof page.default, "function");
  assert.ok(Object.isFrozen(page.WORDS));
  assert.deepEqual({ ...page.WORDS }, {
    title: "Setup",
    start: "Needed to start",
    startSay: "Do these and the engine can do real work for you.",
    later: "When you want it",
    laterSay: "Each of these is off until you choose it. Each line says what it opens up and what it costs or sends off this Mac.",
    notyet: "Not possible yet",
    notyetSay: "These cannot be set up yet. Nothing can be published or sent from here until they exist.",
    done: "Done",
    todo: "To do",
    skipped: "Skipped for now",
    unknown: "Not known",
    setUp: "Set up",
    notSetUp: "Not set up",
    opensUp: "Opens up",
    costs: "Costs and cautions",
    canSkip: "You can skip this for now.",
    finished: "Setup is done.",
    newTask: "New task",
    skip: "Skip for now",
    bringBack: "Bring back",
    hide: "Hide the setup",
    hideLine: "You can open it again any time: press Cmd+K and type Setup.",
    hidden: "The setup is hidden from the sidebar.",
    showAgain: "Show it in the sidebar again",
    saidSkipped: "Skipped for now.",
    saidBack: "Brought back.",
    saidHidden: "The setup is hidden.",
    saidShown: "The setup is shown again.",
    loading: "Loading the setup",
  });
  assert.equal(page.stateWords("done"), "Done");
  assert.equal(page.stateWords("todo"), "To do");
  assert.equal(page.stateWords("skipped"), "Skipped for now");
  assert.equal(page.stateWords("unknown"), "Not known");
  assert.equal(page.stateWords("<b>odd</b>"), "Not known");
  assert.equal(page.laterWords("done"), "Set up");
  assert.equal(page.laterWords("todo"), "Not set up");
  assert.equal(page.laterWords("unknown"), "Not known");
  assert.equal(page.laterWords("skipped"), "Not known");
});

test("setup: the lead line counts what is done and skipped, out of the server's total", () => {
  assert.equal(page.leadOf({ counts: { done: 0, skipped: 0, total: 6 } }), "0 of 6 done.");
  assert.equal(page.leadOf({ counts: { done: 3, skipped: 1, total: 6 } }), "3 of 6 done, 1 skipped for now.");
  assert.equal(page.leadOf({ counts: { done: 2, skipped: 1, total: 5 } }), "2 of 5 done, 1 skipped for now.");
  for (const bad of [0, 13, 2.5, "6", -1, null, undefined]) assert.equal(page.leadOf({ counts: { done: 1, skipped: 0, total: bad } }), "1 of 6 done.", String(bad));
  assert.equal(page.leadOf({ counts: { done: 9, skipped: 0, total: 6 } }), "6 of 6 done.");
  assert.equal(page.leadOf({ finished: true, counts: { done: 3, skipped: 3, total: 6 } }), "Setup is done.");
  assert.equal(page.leadOf({ finished: true, counts: { done: 6, skipped: 0, total: 6 }, later: { done: 2, total: 8 } }), "Setup is done. 2 of 8 extras are set up.");
  assert.equal(page.leadOf({ finished: true, later: { done: 0, total: 0 } }), "Setup is done.");
  assert.equal(page.leadOf({ counts: { done: "x", skipped: -4 } }), "0 of 6 done.");
  assert.equal(page.leadOf(null), "0 of 6 done.");
});

test("setup: the next step is the first one still to do", () => {
  const states = ["done", "skipped", "todo", "todo", "unknown", "todo"];
  assert.equal(page.nextStepId(START.map((id, i) => ({ id, state: states[i] }))), "basics");
  assert.equal(page.nextStepId(START.map((id) => ({ id, state: "done" }))), null);
  assert.equal(page.nextStepId(null), null);
});

test("setup: only the home screen's own addresses and the three fixed commands pass", () => {
  for (const ok of ["#/files", "#/files/brand-kit", "#/dashboards/books"]) assert.equal(page.safeHref(ok), ok);
  for (const bad of ["javascript:alert(1)", ["http:", "//example.com"].join(""), "//x", "#/a b", "", null, 3]) assert.equal(page.safeHref(bad), null, String(bad));
  for (const ok of ["engine/fence/login-wizard.sh", "engine/fence/login-wizard.sh codex", "engine/books/setup-wizard.sh"]) assert.equal(page.safeCommand(ok), ok);
  for (const bad of ["rm -rf ~", "engine/books/setup-wizard.sh; curl x", "", null]) assert.equal(page.safeCommand(bad), null, String(bad));
});

test("setup: cleanSetup keeps known ids once, in order, in their groups, and drops what is not safe", () => {
  const d = copy(FIRST_RUN);
  const at = (id) => d.steps.find((x) => x.id === id);
  at("basics").state = "weird";
  at("brand").links.push({ label: "Bad", href: "javascript:alert(1)" }, { label: "A", href: "#/a" }, { label: "B", href: "#/b" }, { label: "C", href: "#/c" });
  at("models").commands.push({ lead: "Run:", command: "rm -rf ~" }, { lead: "x", command: "engine/fence/login-wizard.sh codex" }, { lead: "y", command: "engine/books/setup-wizard.sh" });
  at("books").notes.push("three", "four", "five");
  at("generation").costs.push("three", "four", 5);
  at("web").canSkip = true;
  at("web").why = "Not for an optional step.";
  at("viewer").state = "skipped";
  d.steps.push(step("other", "Not a step"), step("basics", "Again"), later("routines", "Again"));
  d.steps.splice(2, 0, { ...step("brain", "The brain in the wrong place"), group: "elsewhere" });
  d.notYet.push({ id: "other", title: "Not a row", line: "", how: "" }, { id: "email", title: "Again", line: "", how: "" });
  d.groups = [{ id: "start", title: 3 }, { id: "notyet", title: "Odd title", say: "Odd say." }];
  const s = page.cleanSetup(d);
  assert.deepEqual(s.steps.map((x) => x.id), [...START, ...LATER]);
  assert.deepEqual(s.steps.map((x) => x.group), [...START.map(() => "start"), ...LATER.map(() => "later")]);
  const got = (id) => s.steps.find((x) => x.id === id);
  assert.equal(got("basics").state, "unknown");
  assert.deepEqual(got("brand").links.map((l) => l.href), ["#/files/brand-kit", "#/a", "#/b"]);
  assert.deepEqual(got("models").commands.map((c) => c.command), ["engine/fence/login-wizard.sh", "engine/fence/login-wizard.sh codex"]);
  assert.equal(got("books").notes.length, 4);
  assert.equal(got("books").notes[1], NIL_RATED, "a note is kept whole");
  assert.equal(got("generation").costs.length, 3);
  assert.equal(got("generation").costs[1], TERMS, "a caution is kept whole");
  assert.equal(got("web").canSkip, false, "no optional step can be skipped");
  assert.equal(got("web").why, "");
  assert.equal(got("viewer").state, "unknown");
  assert.equal(got("brain").title, "The brain", "the step in an unknown group was dropped, the real one kept");
  assert.deepEqual(s.notYet.map((x) => x.id), ["publishing", "email", "whatsapp", "gst_portal", "board_login"]);
  assert.deepEqual(s.groups, {
    start: { title: "Needed to start", say: "Do these and the engine can do real work for you." },
    later: { title: "When you want it", say: page.WORDS.laterSay },
    notyet: { title: "Odd title", say: "Odd say." },
  });
  assert.deepEqual(s.counts, { done: 0, skipped: 0, total: 6 });
  assert.deepEqual(s.later, { done: 1, total: 8 });
  assert.equal(s.mode, "plans");
  const empty = page.cleanSetup(null);
  assert.deepEqual(empty.steps, []);
  assert.deepEqual(empty.notYet, []);
  assert.equal(empty.counts.total, 6);
});

test("setup: cleanSetup draws at most 8 needed and 10 optional steps, and 6 rows not possible yet", () => {
  // Only fourteen ids are known, so the caps are reached only through the known ids; a long list of unknown ones
  // adds nothing.
  const d = copy(FIRST_RUN);
  for (let i = 0; i < 40; i++) d.steps.push(step(`extra-${i}`, "Extra"), later(`later-${i}`, "Later"));
  for (let i = 0; i < 40; i++) d.notYet.push({ id: `n${i}`, title: "N", line: "", how: "" });
  const s = page.cleanSetup(d);
  assert.ok(s.steps.filter((x) => x.group === "start").length <= 8);
  assert.ok(s.steps.filter((x) => x.group === "later").length <= 10);
  assert.ok(s.notYet.length <= 6);
});

// ---- mounted ----

const textNodes = (root) => [...dom.walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
const byCls = (root, c) => dom.elements(root).filter((e) => dom.classesOf(e).includes(c));
const buttonsNamed = (root, words) => dom.elements(root).filter((e) => (e.localName === "button" || e.localName === "a") && dom.textOf(e).trim() === words);

// Every path the fake fetch saw, over the whole file.
const SEEN = new Set();

// Mounts #/setup; `answers(path, method, body)` gives the answer (undefined: never answered).
async function mountSetup(answers) {
  dom.installDom();
  globalThis.document.visibilityState = "visible";
  globalThis.location = { hash: "#/setup", href: "/#/setup?glimpse=off", search: "" };
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    const method = opts.method || "GET";
    const body = opts.body === undefined ? null : JSON.parse(opts.body);
    calls.push({ path: String(path), method, body });
    SEEN.add(String(path));
    const data = answers(String(path), method, body);
    if (data === undefined) return new Promise(() => {});
    return data ? { ok: true, status: 200, json: async () => data } : { ok: false, status: 500, json: async () => ({}) };
  };
  const said = [];
  const composed = [];
  const nothing = () => {};
  const ctx = { shell: null, refreshShell: nothing, announce: (t) => said.push(t), openComposer: (x) => composed.push(x), openNeeds: nothing, dock: [], setTop: nothing, settings: { motion: "off", theme: "dark" } };
  const root = new dom.FakeElement("div");
  globalThis.document.body.appendChild(root);
  render(html`<${AppContext.Provider} value=${ctx}><${page.default} route=${{ id: "setup", parts: ["setup"], query: new URLSearchParams("") }} /><//>`, root);
  await dom.settle();
  return { root, calls, said, composed, done: async () => { render(null, root); root.remove(); await dom.settle(50); globalThis.fetch = real; delete globalThis.location; } };
}

const ONLY = (data) => (path, method) => (path === "/api/setup" && method === "GET" ? data : null);

const sections = (root) => dom.elements(root).filter((e) => e.localName === "section" && dom.classesOf(e).includes("k-group"));
const groupTitle = (sec) => dom.textOf(byCls(sec, "k-group__title")[0] || { childNodes: [] }).trim();
const groupNamed = (root, title) => sections(root).find((sec) => groupTitle(sec) === title);
const folds = (root) => dom.elements(root).filter((e) => e.localName === "details");

test("setup: a first run shows the three groups, six numbered steps, whole sentences and the folds", async () => {
  const m = await mountSetup(ONLY(copy(FIRST_RUN)));
  try {
    assert.deepEqual(sections(m.root).map(groupTitle), ["Needed to start", "When you want it", "Not possible yet"]);
    const start = groupNamed(m.root, "Needed to start");
    const laterGroup = groupNamed(m.root, "When you want it");
    const notYet = groupNamed(m.root, "Not possible yet");
    const rows = byCls(m.root, "p-setup__row");
    assert.equal(rows.length, 6);
    assert.ok(rows.every((r) => start.contains(r)), "the numbered rows are in the first group");
    assert.deepEqual(rows.map((r) => r.getAttribute("data-step")), START);
    const titles = byCls(start, "k-rows__title").map((t) => dom.textOf(t.childNodes[0]));
    assert.deepEqual(titles, ["1. Models", "2. The fence check", "3. Company basics", "4. Brand kit", "5. The books", "6. A first real task"]);
    // Numbers only on the needed steps.
    for (const sec of [laterGroup, notYet]) assert.ok(!/(^|\s)\d+\. /.test(dom.textOf(sec)), "no number outside the needed steps");
    const words = textNodes(m.root);
    assert.equal(words.filter((w) => w.includes("engine/books/setup-wizard.sh")).length, 1);
    assert.ok(words.includes(NIL_RATED), "the sentence is one whole text node");
    assert.ok(words.includes(BOOKS_ASKS));
    assert.ok(words.includes(RESEARCHER), "the web's caution is one whole text node");
    assert.ok(words.includes(TERMS), "Runway's terms are one whole text node");
    // Skip only on the three needed steps that allow it, each with its quiet line; none among the optional ones.
    const skips = buttonsNamed(m.root, "Skip for now");
    assert.equal(skips.length, 3);
    const skipRows = rows.filter((r) => buttonsNamed(r, "Skip for now").length).map((r) => r.getAttribute("data-step"));
    assert.deepEqual(skipRows, ["basics", "brand", "books"]);
    assert.equal(buttonsNamed(laterGroup, "Skip for now").length, 0);
    assert.equal(words.filter((w) => w === "You can skip this for now.").length, 3);
    assert.equal(buttonsNamed(m.root, "New task").length, 1);
    assert.equal(buttonsNamed(rows[5], "New task").length, 1, "New task is on the task's row");
    // The optional steps: one fold each, in order, closed unless still to do with a command.
    const f = folds(m.root);
    assert.deepEqual(f.map((e) => e.getAttribute("data-step")), LATER);
    assert.ok(f.every((e) => laterGroup.contains(e)));
    assert.deepEqual(f.filter((e) => e.getAttribute("open") !== null).map((e) => e.getAttribute("data-step")), ["checker-login"]);
    const summaryOf = (id) => dom.elements(f.find((e) => e.getAttribute("data-step") === id)).find((e) => e.localName === "summary");
    assert.ok(dom.textOf(summaryOf("routines")).includes("Set up"));
    assert.ok(dom.textOf(summaryOf("routines")).includes("1 of 2 routines are switched on."));
    assert.ok(dom.textOf(summaryOf("web")).includes("Not set up"));
    assert.ok(dom.textOf(summaryOf("apps")).includes("Not known"));
    // Inside a fold: "Opens up", then "Costs and cautions" only where there are costs.
    const web = f.find((e) => e.getAttribute("data-step") === "web");
    const viewer = f.find((e) => e.getAttribute("data-step") === "viewer");
    assert.ok(textNodes(web).includes("Opens up"));
    assert.ok(textNodes(web).includes("Costs and cautions"));
    assert.ok(!textNodes(viewer).includes("Costs and cautions"));
    assert.equal(buttonsNamed(m.root, "Open App Studio").length, 1);
    // Not possible yet: plain rows, no chip, no button, no link.
    const plain = byCls(notYet, "p-setup__notyet");
    assert.deepEqual(plain.map((r) => r.getAttribute("data-notyet")), ["publishing", "email", "whatsapp", "gst_portal", "board_login"]);
    assert.equal(byCls(notYet, "k-rows__state").length, 0);
    assert.equal(dom.elements(notYet).filter((e) => e.localName === "button" || e.localName === "a").length, 0);
    assert.ok(textNodes(notYet).includes("It needs a mail account."));
    // The first step to do is the next one, and its main link is the primary.
    assert.ok(dom.classesOf(rows[0]).includes("p-setup__row--next"));
    assert.equal(byCls(m.root, "p-setup__row--next").length, 1);
    const settings = dom.elements(rows[0]).find((e) => e.localName === "a" && e.getAttribute("href") === "#/settings");
    assert.ok(dom.classesOf(settings).includes("k-btn--primary"));
    // The header's line and the hide button.
    assert.ok(words.includes("0 of 6 done."));
    assert.equal(buttonsNamed(m.root, "Hide the setup").length, 1);
    assert.ok(words.includes("You can open it again any time: press Cmd+K and type Setup."));
    // New task only opens the existing form.
    dom.fire(buttonsNamed(m.root, "New task")[0], "click");
    assert.deepEqual(m.composed, [{}]);
    assert.ok(m.calls.every((c) => c.method === "GET" && c.path === "/api/setup"));
  } finally { await m.done(); }
});

test("setup: in provider mode there is no row for the Checker's own login", async () => {
  const d = copy(FIRST_RUN);
  d.mode = "provider";
  d.later.total = 7;
  d.steps = d.steps.filter((x) => x.id !== "checker-login");
  const m = await mountSetup(ONLY(d));
  try {
    assert.deepEqual(folds(m.root).map((e) => e.getAttribute("data-step")), LATER.filter((id) => id !== "checker-login"));
  } finally { await m.done(); }
  // Even if the server sent it, the page leaves it out in provider mode.
  const sent = copy(FIRST_RUN);
  sent.mode = "provider";
  assert.ok(!page.cleanSetup(sent).steps.some((x) => x.id === "checker-login"));
});

test("setup: when finished, the lead says so and counts the extras", async () => {
  const d = copy(FIRST_RUN);
  d.finished = true;
  d.show = false;
  d.counts = { done: 5, skipped: 1, total: 6 };
  for (const x of d.steps) if (x.group === "start") x.state = x.id === "brand" ? "skipped" : "done";
  const m = await mountSetup(ONLY(d));
  try {
    assert.ok(textNodes(m.root).includes("Setup is done. 1 of 8 extras are set up."));
    assert.equal(byCls(m.root, "p-setup__row--next").length, 0);
    const brand = byCls(m.root, "p-setup__row").find((r) => r.getAttribute("data-step") === "brand");
    assert.equal(buttonsNamed(brand, "Bring back").length, 1);
  } finally { await m.done(); }
});

test("setup: hostile server text stays text, and unsafe links, commands, groups and rows are dropped", async () => {
  const d = copy(FIRST_RUN);
  const at = (id) => d.steps.find((x) => x.id === id);
  at("basics").links = [{ label: "Click", href: "javascript:alert(1)" }];
  at("models").commands = [{ lead: "Run:", command: "rm -rf ~" }];
  at("books").notes = ["<img src=x onerror=1>"];
  at("web").links = [{ label: "Away", href: "javascript:alert(2)" }];
  at("web").costs = ["<img src=y onerror=2>"];
  d.steps.push(step("seventh", "Seven"), { ...later("fifteenth", "Fifteen"), links: [{ label: "Away", href: "javascript:alert(3)" }] }, { ...step("task", "Again"), group: "start" });
  d.steps.push({ ...later("routines", "In another group"), group: "<b>odd</b>" });
  d.groups.push({ id: "odd", title: "An odd group", say: "javascript:alert(4)" });
  d.notYet.push({ id: "publishing", title: "Again", line: "javascript:alert(5)", how: "x" });
  d.notYet[0].how = "javascript:alert(6)";
  const m = await mountSetup(ONLY(d));
  try {
    for (const e of dom.elements(m.root)) {
      assert.ok(!/^javascript:/i.test(String(e.getAttribute("href") || "")), "no javascript: address");
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
    }
    assert.ok(!dom.textOf(m.root).includes("rm -rf"));
    assert.equal(dom.elements(m.root).filter((e) => e.localName === "img").length, 0);
    assert.ok(textNodes(m.root).includes("<img src=x onerror=1>"), "the note is shown as text");
    assert.ok(textNodes(m.root).includes("<img src=y onerror=2>"), "the caution is shown as text");
    assert.ok(byCls(m.root, "p-setup__row").length <= 6);
    assert.deepEqual(folds(m.root).map((e) => e.getAttribute("data-step")), LATER, "no 15th step, no step from another group");
    assert.ok(!dom.textOf(m.root).includes("An odd group"));
    assert.ok(!dom.textOf(m.root).includes("javascript:alert(4)"));
    assert.ok(!dom.textOf(m.root).includes("javascript:alert(5)"), "a second row with a known id is dropped");
    // The not-yet entry's address is plain text in a paragraph's span, never a link or any other element of its own.
    const holders = dom.elements(m.root).filter((e) => e.childNodes.some((n) => n.nodeType === 3 && n.data.includes("javascript:")));
    assert.equal(holders.length, 1);
    assert.equal(holders[0].localName, "span");
    assert.ok(byCls(m.root, "p-setup__notyet").length <= 6);
    assert.equal(sections(m.root).length, 3);
  } finally { await m.done(); }
});

test("setup: Skip for now and Hide the setup each send one POST with the right body", async () => {
  const skipped = copy(FIRST_RUN);
  const brandStep = skipped.steps.find((x) => x.id === "brand");
  brandStep.state = "skipped";
  brandStep.skipped = true;
  skipped.counts.skipped = 1;
  const hidden = { ...copy(skipped), dismissed: true, show: false, open: false };
  const answers = (path, method) => {
    if (path === "/api/setup" && method === "GET") return copy(FIRST_RUN);
    if (path === "/api/setup/skip" && method === "POST") return skipped;
    if (path === "/api/setup/dismiss" && method === "POST") return hidden;
    return null;
  };
  const m = await mountSetup(answers);
  try {
    const brand = byCls(m.root, "p-setup__row").find((r) => r.getAttribute("data-step") === "brand");
    dom.fire(buttonsNamed(brand, "Skip for now")[0], "click");
    await dom.settle();
    const skips = m.calls.filter((c) => c.method === "POST" && c.path === "/api/setup/skip");
    assert.equal(skips.length, 1);
    assert.deepEqual(skips[0].body, { step: "brand", skip: true });
    assert.deepEqual(m.said, ["Skipped for now."]);
    const brandAfter = byCls(m.root, "p-setup__row").find((r) => r.getAttribute("data-step") === "brand");
    assert.equal(buttonsNamed(brandAfter, "Bring back").length, 1, "the answer is shown at once");
    assert.ok(textNodes(m.root).includes("0 of 6 done, 1 skipped for now."));

    dom.fire(buttonsNamed(m.root, "Hide the setup")[0], "click");
    await dom.settle();
    const hides = m.calls.filter((c) => c.method === "POST" && c.path === "/api/setup/dismiss");
    assert.equal(hides.length, 1);
    assert.deepEqual(hides[0].body, { dismissed: true });
    assert.deepEqual(m.said, ["Skipped for now.", "The setup is hidden."]);
    assert.ok(textNodes(m.root).includes("The setup is hidden from the sidebar."));
    assert.equal(buttonsNamed(m.root, "Show it in the sidebar again").length, 1);
    assert.equal(m.calls.filter((c) => c.method !== "GET").length, 2, "exactly two writes");
  } finally { await m.done(); }
});

test("setup: a write that fails shows its own message", async () => {
  const answers = (path, method) => (path === "/api/setup" && method === "GET" ? copy(FIRST_RUN) : undefined);
  const m = await mountSetup(answers);
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts = {}) => {
    SEEN.add(String(path));
    if ((opts.method || "GET") === "POST") return { ok: false, status: 400, json: async () => ({ error: { message: "That step cannot be skipped.", next: "Do the step, or hide the setup instead.", code: "bad_step" } }) };
    return real(path, opts);
  };
  try {
    const basics = byCls(m.root, "p-setup__row").find((r) => r.getAttribute("data-step") === "basics");
    dom.fire(buttonsNamed(basics, "Skip for now")[0], "click");
    await dom.settle();
    const words = textNodes(m.root);
    assert.ok(words.includes("That step cannot be skipped."));
    assert.ok(words.includes("Do the step, or hide the setup instead."));
  } finally { globalThis.fetch = real; await m.done(); }
});

test("setup: over the whole file the page asked only for the setup's own addresses", () => {
  assert.ok(SEEN.has("/api/setup"));
  for (const p of SEEN) assert.ok(["/api/setup", "/api/setup/skip", "/api/setup/dismiss"].includes(p), p);
});

test("setup: the page's source names no tool", () => {
  const found = TOOLS.filter((t) => new RegExp(`(^|[^\\w-])${t.replace(/[-]/g, "\\-")}(?![\\w-])`).test(SOURCE));
  assert.deepEqual(found, []);
  // As the shared page test reads it once the page is listed: comments taken out, in any case.
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
  const anyCase = TOOLS.filter((t) => new RegExp(`(^|[^\\w-])${t.replace(/[-]/g, "\\-")}(?![\\w-])`, "i").test(code));
  assert.deepEqual(anyCase, []);
  assert.doesNotMatch(SOURCE, /https?:\/\//, "names no other host");
});
