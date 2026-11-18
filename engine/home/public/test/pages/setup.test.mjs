// Setup page (PLAN-ONBOARD T2): the pure helpers, then the page mounted in the shared test DOM with a fake fetch.
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

const step = (id, title, over = {}) => ({ id, title, state: "todo", canSkip: false, skipped: false, line: "", why: null, notes: [], links: [], commands: [], facts: {}, ...over });
const sw = (id, title, href = "#/settings") => ({ id, title, on: false, line: `${title} is off.`, href });

// A first run: nothing done yet, the books connected and empty.
const FIRST_RUN = Object.freeze({
  open: true,
  show: true,
  dismissed: false,
  finished: false,
  counts: { done: 0, skipped: 0, total: 5 },
  steps: [
    step("basics", "Company basics", { canSkip: true, line: "0 of 9 basics filled.", why: "Every agent reads these before it works, so what it makes sounds like your company. Filling them takes about 20 minutes.", links: [{ label: "Open Files", href: "#/files" }] }),
    step("brand", "Brand kit", { canSkip: true, line: "No brand kit yet.", why: "Your colours, fonts and logo. Posters, pages and apps are made in this look.", links: [{ label: "Open the brand kit", href: "#/files/brand-kit" }] }),
    step("models", "Models", { line: "Plans mode is on, but the Claude agents have no login of their own yet.", why: "Your agents think with these.", links: [{ label: "Open Settings", href: "#/settings" }], commands: [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/fence/login-wizard.sh" }] }),
    step("books", "The books", { canSkip: true, line: "The books are connected. Your company's details are not in them yet.", why: "Invoices, customers, support and leave are kept in the books.", notes: [BOOKS_ASKS, NIL_RATED], links: [{ label: "Open the Books dashboard", href: "#/dashboards/books" }], commands: [{ lead: "Only you can do this. Open Terminal and run:", command: "engine/books/setup-wizard.sh" }] }),
    step("task", "A first real task", { line: "No task yet.", why: "Say what you want done in your own words.", links: [{ label: "Choose a job", href: "#/jobs" }] }),
  ],
  switches: [sw("web", "The web"), sw("generation", "Generation"), sw("viewer", "The page viewer"), sw("apps", "App Studio", "#/apps"), sw("brain", "The brain")],
  generatedAt: "2026-11-18T10:00:00.000Z",
});
const copy = (x) => JSON.parse(JSON.stringify(x));

// ---- the pure helpers ----

test("setup: the default export is a component; the page's words are pinned", () => {
  assert.equal(typeof page.default, "function");
  assert.ok(Object.isFrozen(page.WORDS));
  assert.deepEqual({ ...page.WORDS }, {
    title: "Setup",
    steps: "Steps",
    switches: "Switches you may want later",
    switchesSay: "Each of these is off until you switch it on in Settings. Nothing here changes them.",
    done: "Done",
    todo: "To do",
    skipped: "Skipped for now",
    unknown: "Not known",
    on: "On",
    off: "Off",
    finished: "Setup is done.",
    newTask: "New task",
    skip: "Skip for now",
    bringBack: "Bring back",
    openSettings: "Open Settings",
    openApps: "Open App Studio",
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
});

test("setup: the lead line counts what is done and skipped", () => {
  assert.equal(page.leadOf({ counts: { done: 0, skipped: 0 } }), "0 of 5 done.");
  assert.equal(page.leadOf({ counts: { done: 2, skipped: 1 } }), "2 of 5 done, 1 skipped for now.");
  assert.equal(page.leadOf({ finished: true, counts: { done: 3, skipped: 2 } }), "Setup is done.");
  assert.equal(page.leadOf({ counts: { done: "x", skipped: -4 } }), "0 of 5 done.");
  assert.equal(page.leadOf(null), "0 of 5 done.");
});

test("setup: the next step is the first one still to do", () => {
  const ids = ["basics", "brand", "models", "books", "task"];
  const states = ["done", "skipped", "todo", "todo", "unknown"];
  assert.equal(page.nextStepId(ids.map((id, i) => ({ id, state: states[i] }))), "models");
  assert.equal(page.nextStepId(ids.map((id) => ({ id, state: "done" }))), null);
  assert.equal(page.nextStepId(null), null);
});

test("setup: only the home screen's own addresses and the three fixed commands pass", () => {
  for (const ok of ["#/files", "#/files/brand-kit", "#/dashboards/books"]) assert.equal(page.safeHref(ok), ok);
  for (const bad of ["javascript:alert(1)", ["http:", "//example.com"].join(""), "//x", "#/a b", "", null, 3]) assert.equal(page.safeHref(bad), null, String(bad));
  for (const ok of ["engine/fence/login-wizard.sh", "engine/fence/login-wizard.sh codex", "engine/books/setup-wizard.sh"]) assert.equal(page.safeCommand(ok), ok);
  for (const bad of ["rm -rf ~", "engine/books/setup-wizard.sh; curl x", "", null]) assert.equal(page.safeCommand(bad), null, String(bad));
});

test("setup: cleanSetup keeps known ids once, in order, and drops what is not safe", () => {
  const d = copy(FIRST_RUN);
  d.steps[0].state = "weird";
  d.steps[1].links.push({ label: "Bad", href: "javascript:alert(1)" }, { label: "A", href: "#/a" }, { label: "B", href: "#/b" }, { label: "C", href: "#/c" });
  d.steps[2].commands.push({ lead: "Run:", command: "rm -rf ~" }, { lead: "x", command: "engine/fence/login-wizard.sh codex" }, { lead: "y", command: "engine/books/setup-wizard.sh" });
  d.steps[3].notes.push("three", "four", "five");
  d.steps.push(step("other", "Not a step"), step("basics", "Again"));
  d.switches.push(sw("other", "Not a switch"));
  d.switches[0].on = "yes";
  const s = page.cleanSetup(d);
  assert.deepEqual(s.steps.map((x) => x.id), ["basics", "brand", "models", "books", "task"]);
  assert.equal(s.steps[0].state, "unknown");
  assert.deepEqual(s.steps[1].links.map((l) => l.href), ["#/files/brand-kit", "#/a", "#/b"]);
  assert.deepEqual(s.steps[2].commands.map((c) => c.command), ["engine/fence/login-wizard.sh", "engine/fence/login-wizard.sh codex"]);
  assert.equal(s.steps[3].notes.length, 4);
  assert.equal(s.steps[3].notes[1], NIL_RATED, "a note is kept whole");
  assert.deepEqual(s.switches.map((x) => x.id), ["web", "generation", "viewer", "apps", "brain"]);
  assert.equal(s.switches[0].on, null);
  assert.deepEqual(page.cleanSetup(null).steps, []);
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

test("setup: a first run shows five numbered steps, the books' command once, whole sentences and five switches", async () => {
  const m = await mountSetup(ONLY(copy(FIRST_RUN)));
  try {
    const rows = byCls(m.root, "p-setup__row");
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((r) => r.getAttribute("data-step")), ["basics", "brand", "models", "books", "task"]);
    const titles = byCls(m.root, "k-rows__title").slice(0, 5).map((t) => dom.textOf(t.childNodes[0]));
    assert.deepEqual(titles, ["1. Company basics", "2. Brand kit", "3. Models", "4. The books", "5. A first real task"]);
    const words = textNodes(m.root);
    assert.equal(words.filter((w) => w.includes("engine/books/setup-wizard.sh")).length, 1);
    assert.ok(words.includes(NIL_RATED), "the sentence is one whole text node");
    assert.ok(words.includes(BOOKS_ASKS));
    const skips = buttonsNamed(m.root, "Skip for now");
    assert.equal(skips.length, 3);
    const skipRows = rows.filter((r) => buttonsNamed(r, "Skip for now").length).map((r) => r.getAttribute("data-step"));
    assert.deepEqual(skipRows, ["basics", "brand", "books"]);
    assert.equal(buttonsNamed(m.root, "New task").length, 1);
    assert.equal(buttonsNamed(rows[4], "New task").length, 1, "New task is on the task's row");
    assert.equal(byCls(m.root, "p-setup__switch").length, 5);
    assert.equal(buttonsNamed(m.root, "Open App Studio").length, 1);
    assert.equal(buttonsNamed(m.root, "Open Settings").length, 5, "the models' link and four switches");
    // The first step to do is the next one, and its main link is the primary.
    assert.ok(dom.classesOf(rows[0]).includes("p-setup__row--next"));
    assert.equal(byCls(m.root, "p-setup__row--next").length, 1);
    const files = dom.elements(rows[0]).find((e) => e.localName === "a" && e.getAttribute("href") === "#/files");
    assert.ok(dom.classesOf(files).includes("k-btn--primary"));
    // The header's line and the hide button.
    assert.ok(words.includes("0 of 5 done."));
    assert.equal(buttonsNamed(m.root, "Hide the setup").length, 1);
    assert.ok(words.includes("You can open it again any time: press Cmd+K and type Setup."));
    // New task only opens the existing form.
    dom.fire(buttonsNamed(m.root, "New task")[0], "click");
    assert.deepEqual(m.composed, [{}]);
    assert.ok(m.calls.every((c) => c.method === "GET" && c.path === "/api/setup"));
  } finally { await m.done(); }
});

test("setup: hostile server text stays text, and unsafe links and commands are dropped", async () => {
  const d = copy(FIRST_RUN);
  d.steps[0].links = [{ label: "Click", href: "javascript:alert(1)" }];
  d.steps[2].commands = [{ lead: "Run:", command: "rm -rf ~" }];
  d.steps[3].notes = ["<img src=x onerror=1>"];
  d.steps.push(step("sixth", "Six"), step("task", "Seventh"));
  d.switches[1].href = "javascript:alert(1)";
  const m = await mountSetup(ONLY(d));
  try {
    for (const e of dom.elements(m.root)) {
      assert.ok(!/^javascript:/i.test(String(e.getAttribute("href") || "")), "no javascript: address");
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
    }
    assert.ok(!dom.textOf(m.root).includes("rm -rf"));
    assert.equal(dom.elements(m.root).filter((e) => e.localName === "img").length, 0);
    assert.ok(textNodes(m.root).includes("<img src=x onerror=1>"), "the note is shown as text");
    assert.ok(byCls(m.root, "p-setup__row").length <= 5);
  } finally { await m.done(); }
});

test("setup: Skip for now and Hide the setup each send one POST with the right body", async () => {
  const skipped = copy(FIRST_RUN);
  skipped.steps[1].state = "skipped";
  skipped.steps[1].skipped = true;
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
    assert.ok(textNodes(m.root).includes("0 of 5 done, 1 skipped for now."));

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
