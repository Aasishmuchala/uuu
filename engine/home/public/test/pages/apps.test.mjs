// App Studio's list (PLAN-V5 K17, K22, K23, T80): K23's words as written, the pure helpers (the frame's address, the
// state the owner sees, the spending words, the sheet's amounts), and the list mounted in a very small DOM in each
// state: empty, one app off, on, starting, failed, not ready, damaged, App Studio off, the switch's two POSTs and a
// refusal, and a 404 that says to restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Page, {
  AMOUNTS, APP_PORTS, FILTERS, FIRST_AMOUNT, STATE_WORDS, WORDS, allowLabel, amountChoices, appAddress, appHref, appsOf, dollarWord, filterApps,
  firstAmount, iconHref, initials, moneyParts, plain, sheetTitle, shownState, sitesOfView, spendingLine, spends, stateSentence, stateSt, stateTag,
  stateTone, stateWord, thinksLabel, thinksShort,
} from "../../pages/apps.js";

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = readFileSync(join(PUBLIC, "pages", "apps.js"), "utf8");
// The shape files sit beside the server, outside this tree: found by walking up from this file.
const SHAPES = (() => { let d = dirname(fileURLToPath(import.meta.url)); for (;;) { const c = join(d, "server", "test", "shapes"); if (existsSync(c)) return c; const p = dirname(d); if (p === d) throw new Error("shape files not found"); d = p; } })();
const SHAPE = JSON.parse(readFileSync(join(SHAPES, "apps.json"), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
// Addresses are built from parts, so this file names no host (test/static.test.mjs).
const HTTP = "http:" + "//";
const LOOP = ["127", "0", "0", "1"].join(".");
const NOSPEND = { open: false, budget: 0, spent: 0, left: 0, expiresAt: null, words: "This app cannot spend anything right now.", limitLeft: 2880, limitWords: "What is left of today's limit: $28.80." };
const app = (over = {}) => ({ ...clone(SHAPE.apps[0]), ...over });
const view = (apps, over = {}) => ({ ...clone(SHAPE), apps, sites: [], ...over });

test("apps: K23's words are used as written", () => {
  assert.equal(WORDS.title, "App Studio");
  assert.equal(WORDS.intro, "Apps that run on this Mac. They reach Runway and Higgsfield only through the engine, inside the limits in Settings.");
  assert.deepEqual(STATE_WORDS, {
    off: "Off", starting: "Starting…", on: "On", failed: "Stopped. It could not start.", not_installed: "Not ready yet.", damaged: "This app's description is damaged.",
  });
  assert.equal(WORDS.open, "Open");
  assert.equal(WORDS.turnOn, "Turn on");
  assert.equal(WORDS.turnOff, "Turn off");
  assert.equal(WORDS.ownWindow, "Open in its own window");
  assert.equal(WORDS.noSpending, "This app cannot spend anything right now.");
  assert.equal(WORDS.allow, "Allow spending");
  assert.equal(WORDS.stop, "Stop spending");
  assert.equal(WORDS.sheetBody, "Each picture or clip shows its price before you make it. This ends at midnight.");
  assert.equal(WORDS.team, "Made by the team");
  assert.equal(WORDS.teamEmpty, "Sites the Builder makes appear here after you accept them.");
  assert.equal(WORDS.restart, "This page appears after the home screen is restarted: engine stop, then engine start.");
  assert.equal(sheetTitle("Render to Film"), "Let Render to Film spend today");
  assert.equal(allowLabel(500), "Allow $5 today");
  assert.deepEqual(AMOUNTS.map(dollarWord), ["$2", "$5", "$10", "$20"]);
  assert.equal(FIRST_AMOUNT, 500, "$5 is the first suggestion (the owner's answer to S5)");
  assert.equal(thinksLabel({ model: "claude-opus-5-5", name: "Claude Opus 5.5" }), "Thinks with Claude Opus 5.5.");
});

test("apps: the frame's address is the home's own hostname and the app's own port, 3171 to 3189, nothing else", () => {
  assert.deepEqual(APP_PORTS, { first: 3171, last: 3189 });
  assert.equal(appAddress(LOOP, 3171), `${HTTP}${LOOP}:3171/`);
  assert.equal(appAddress("localhost", 3189), `${HTTP}localhost:3189/`);
  for (const port of [3170, 3190, 3100, 80, 0, -1, 3171.5, "3171", null, undefined, NaN]) assert.equal(appAddress(LOOP, port), null, String(port));
  for (const host of ["", "evil.test", "127.0.0.2", "[::1]", "LOCALHOST", `${LOOP}.evil.test`, null]) assert.equal(appAddress(host, 3171), null, String(host));
  assert.equal(appHref("render-to-film"), "#/apps/render-to-film");
  assert.equal(appHref("../x"), null);
  assert.equal(appHref("Render"), null);
  assert.equal(iconHref("render-to-film"), "/api/apps/render-to-film/icon");
  assert.equal(iconHref("a/b"), null);
});

test("apps: the state the owner sees, read with the switch and App Studio's own state", () => {
  const on = { state: "on", sentence: "App Studio is on." };
  const off = { state: "off", sentence: "App Studio is off. Run: engine start" };
  assert.equal(shownState(app({ state: "on", on: true }), on), "on");
  assert.equal(shownState(app({ state: "off", on: false }), on), "off");
  assert.equal(shownState(app({ state: "on", on: false }), on), "off", "switched off: off, though the host is still stopping it");
  assert.equal(shownState(app({ state: "off", on: true }), on), "starting", "switched on, not started yet");
  assert.equal(shownState(app({ state: "starting", on: true }), on), "starting");
  assert.equal(shownState(app({ state: "failed", on: true }), on), "failed");
  assert.equal(shownState(app({ state: "not_installed", on: false }), on), "not_installed");
  assert.equal(shownState(app({ state: "damaged", on: true }), on), "damaged");
  assert.equal(shownState(app({ state: "off", on: true }), off), "host_off");
  assert.equal(shownState(app({ state: "made up", on: false }), on), "off");
  assert.equal(shownState(null, null), "off");
  assert.equal(stateSentence("host_off", off), "App Studio is off. Run: engine start");
  assert.equal(stateWord("host_off"), "Waits for App Studio.");
  assert.equal(stateWord("failed"), "Stopped. It could not start.");
  for (const s of Object.keys(STATE_WORDS)) assert.equal(stateSentence(s, on), STATE_WORDS[s]);
  assert.equal(stateTone("on"), "ok");
  assert.equal(stateTone("failed"), "bad");
  assert.notEqual(stateTone("starting"), stateTone("on"), "starting does not look like on");
});

test("apps: the spending words, and which apps can spend", () => {
  assert.equal(spendingLine(app()), "Allowed today: $5.00. Spent: $1.20.");
  assert.equal(spendingLine(app({ spending: NOSPEND })), "This app cannot spend anything right now.");
  assert.equal(spendingLine(app({ spending: null })), "This app cannot spend anything right now.");
  assert.equal(spends(app()), true);
  assert.equal(spends(app({ spending: { ...NOSPEND, limitWords: null } })), false, "an app that makes nothing has no allowance");
  assert.equal(plain("a‮b\u0000c", 10), "abc");
});

test("apps: the sheet's amounts: over what is left of today's limit is disabled; $5 first when it fits", () => {
  assert.deepEqual(amountChoices(2880).map((c) => [c.label, c.disabled]), [["$2", false], ["$5", false], ["$10", false], ["$20", false]]);
  assert.deepEqual(amountChoices(640).map((c) => [c.label, c.disabled]), [["$2", false], ["$5", false], ["$10", true], ["$20", true]]);
  assert.deepEqual(amountChoices(1000).map((c) => c.disabled), [false, false, false, true]);
  assert.equal(firstAmount(2880), 500);
  assert.equal(firstAmount(640), 500);
  assert.equal(firstAmount(300), 200);
  assert.equal(firstAmount(150), null);
  assert.equal(firstAmount(undefined), null);
});

test("apps: an app's text is plain text; nothing is set as HTML; the frame's address never comes from the view's text", () => {
  assert.doesNotMatch(SRC, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(SRC, /api\.post\(`\/api\/apps\/\$\{slug\}\/\$\{what\}`/);
  assert.deepEqual(appsOf({ apps: [{ slug: "../x" }, { slug: "ok-app" }, null, { slug: 3 }] }).map((a) => a.slug), ["ok-app"]);
});

// ---- Mounted ----

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
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}
class FakeText extends FakeNode { constructor(d) { super(); this.nodeType = 3; this.data = String(d); } }
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.nodeType = 1; this.localName = tag; this.attrs = {}; this.style = { cssText: "", setProperty(k, v) { this[k] = v; } }; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  focus() { globalThis.document.activeElement = this; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  set innerHTML(v) { throw new Error(`innerHTML was set: ${v}`); }
}
const { html, render } = await import(pathToFileURL(join(PUBLIC, "vendor", "preact-htm.js")).href);
function installDom() {
  const doc = { title: "", activeElement: null, visibilityState: "visible", createElement: (t) => new FakeElement(t), createElementNS: (_n, t) => new FakeElement(t), createTextNode: (d) => new FakeText(d), addEventListener() {}, removeEventListener() {} };
  doc.body = new FakeElement("body");
  globalThis.document = doc;
}
function* walk(node) { yield node; for (const c of node.childNodes) yield* walk(c); }
const elements = (root) => [...walk(root)].filter((n) => n.nodeType === 1);
const textOf = (root) => [...walk(root)].filter((n) => n.nodeType === 3).map((n) => n.data).join("");
const cls = (e) => e.getAttribute("class") || e.className || "";
// Effects run 100 ms after the render that asks for them in this small DOM (no animation frame), so a wait of 300 ms
// lets an answer, its render and its effects land even on a busy machine.
const settle = () => new Promise((r) => setTimeout(r, 300));
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName} listens for ${type}`);
  for (const f of el.listeners[key]) f.call(el, { type: key, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {}, ...extra });
}
const buttons = (root, words) => elements(root).filter((e) => (e.localName === "button" || e.localName === "a") && textOf(e).trim() === words);
function stubFetch(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    const a = answers(path, opts.method);
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}
async function mount(answers) {
  installDom();
  const f = stubFetch(answers);
  const root = new FakeElement("div");
  render(html`<${Page} route=${{ id: "apps", parts: ["apps"], query: new URLSearchParams("") }} />`, root);
  await settle();
  return { root, f, done: () => { render(null, root); f.restore(); } };
}
const fixed = (body, status = 200) => () => ({ status, body });

test("apps mounted: the intro, the tiles' root class, and the team's group with its empty sentence", async () => {
  const m = await mount(fixed(view([])));
  try {
    const all = textOf(m.root);
    assert.match(all, /App Studio/);
    assert.ok(all.includes(WORDS.intro));
    assert.ok(all.includes(WORDS.noApps), "no app: says so");
    assert.ok(all.includes("Made by the team"));
    assert.ok(all.includes("Sites the Builder makes appear here after you accept them."));
    assert.ok(elements(m.root).some((e) => cls(e).split(/\s+/).includes("p-apps")));
  } finally { m.done(); }
});

test("apps mounted: an app that is on has its picture at 32 px, its line, its state, Open to its page and Turn off", async () => {
  const m = await mount(fixed(view([app()])));
  try {
    const all = textOf(m.root);
    assert.ok(all.includes("Render to Film"));
    assert.ok(all.includes("Turn a render into cinematic stills, clips and a finished film."));
    assert.ok(all.includes("On"));
    assert.ok(all.includes("Allowed today: $5.00. Spent: $1.20."));
    const img = elements(m.root).find((e) => e.localName === "img");
    assert.equal(img.getAttribute("src"), "/api/apps/render-to-film/icon");
    assert.equal(img.getAttribute("width"), "32");
    assert.equal(img.getAttribute("alt"), "");
    assert.equal(buttons(m.root, "Open")[0].getAttribute("href"), "#/apps/render-to-film");
    assert.match(cls(buttons(m.root, "Open")[0]), /k-btn--primary/, "Open is the filled one on an app that is on");
    assert.match(cls(buttons(m.root, "Turn off")[0]), /k-btn--ghost/, "Turn off a small ghost");
    assert.equal(buttons(m.root, "Turn off").length, 1);
    assert.equal(buttons(m.root, "Turn on").length, 0);
  } finally { m.done(); }
});

test("apps mounted: off shows Turn on, which posts { on: true } and shows the answer; a refusal shows its sentence", async () => {
  let current = view([app({ state: "off", on: false, sentence: "Off", spending: NOSPEND })]);
  let refuse = false;
  const m = await mount((path, method) => {
    if (method === "POST" && path === "/api/apps/render-to-film/switch") {
      if (refuse) return { status: 409, body: { error: { message: "Render to Film cannot be turned on yet.", next: "Not ready yet.", code: "cannot_switch_on" } } };
      current = view([app({ state: "starting", on: true, sentence: "Starting…", spending: NOSPEND })]);
      return { status: 200, body: current };
    }
    return { status: 200, body: current };
  });
  try {
    assert.ok(textOf(m.root).includes("Off"));
    assert.equal(buttons(m.root, "Open").length, 0, "no Open while off");
    fire(buttons(m.root, "Turn on")[0], "click");
    await settle();
    assert.deepEqual(m.f.calls.find((c) => c.method === "POST").body, { on: true });
    assert.ok(textOf(m.root).includes("Starting…"));
    assert.equal(buttons(m.root, "Open").length, 1, "starting: Open goes to its page, which waits for it");
    fire(buttons(m.root, "Turn off")[0], "click");
    await settle();
    assert.deepEqual(m.f.calls.filter((c) => c.method === "POST").at(-1).body, { on: false });
  } finally { m.done(); }
  refuse = true;
  current = view([app({ state: "off", on: false, sentence: "Off", spending: NOSPEND })]);
  const n = await mount((path, method) => (method === "POST" ? { status: 409, body: { error: { message: "Render to Film cannot be turned on yet.", next: "Not ready yet.", code: "cannot_switch_on" } } } : { status: 200, body: current }));
  try {
    fire(buttons(n.root, "Turn on")[0], "click");
    await settle();
    assert.match(textOf(n.root), /Render to Film cannot be turned on yet\.Not ready yet\./);
    assert.ok(elements(n.root).some((e) => e.getAttribute("role") === "alert"));
  } finally { n.done(); }
});

test("apps mounted: every state has its words; App Studio off says so with its command; the switches' problem is shown", async () => {
  const apps = [
    app({ slug: "a-failed", state: "failed", on: true }),
    app({ slug: "b-new", state: "not_installed", on: false }),
    app({ slug: "c-bad", state: "damaged", on: false, name: "c-bad", about: "" }),
  ];
  const m = await mount(fixed(view(apps, { problem: "apps_state_unreadable", problemSentence: "Your app switches could not be read, so every app is off. Turning an app on or off writes them again." })));
  try {
    const all = textOf(m.root);
    assert.ok(all.includes("Stopped. It could not start."));
    assert.ok(all.includes("Turn it off, then on, to try again."));
    assert.ok(elements(m.root).some((e) => e.localName === "a" && e.getAttribute("href") === "#/health"), "a stopped app links to Health");
    assert.ok(all.includes("Not ready yet."));
    assert.ok(all.includes("This app's description is damaged."));
    assert.ok(all.includes("Your app switches could not be read"));
    assert.equal(buttons(m.root, "Turn on").length, 0, "not ready and damaged cannot be turned on");
    assert.equal(buttons(m.root, "Turn off").length, 1, "the stopped one can be turned off");
  } finally { m.done(); }
  const n = await mount(fixed(view([app({ state: "off", on: true })], { host: { state: "off", sentence: "App Studio is off. Run: engine start" } })));
  try {
    assert.match(textOf(n.root), /App Studio is off\. Run: engine start/);
    assert.ok(elements(n.root).some((e) => e.localName === "code" && textOf(e) === "engine start"));
    assert.equal(textOf(n.root).split("Run:").length, 2, "the command is said once, above the apps");
    assert.ok(textOf(n.root).includes("Waits for App Studio."), "the tile says it waits for App Studio");
  } finally { n.done(); }
});

test("apps mounted: a 404 says to restart the home screen; another failure offers Try again", async () => {
  const m = await mount(fixed({ error: { message: "Not found." } }, 404));
  try {
    assert.equal(textOf(m.root).replace(/\s+/g, " ").trim().endsWith(WORDS.restart), true);
  } finally { m.done(); }
  const n = await mount(fixed({ error: { message: "Something broke.", next: "" } }, 500));
  try {
    assert.match(textOf(n.root), /This could not be loaded\./);
    assert.equal(buttons(n.root, "Try again").length, 1);
  } finally { n.done(); }
});

// ---- Made by the team (T88) ----

const KEY = "0123456789abcdef".repeat(4);
const SITE = {
  task: { id: "e0000000-0000-4000-8000-000000000002", identifier: "STH-2", title: "A landing page for the November launch" },
  ref: "launch-a", name: "launch", direction: "Editorial", finishedAt: "2026-11-13T09:00:00.000Z", pages: ["index.html"], files: 4,
  picture: `/api/sites/shot/${KEY}/shot-index-1280-light.png`, state: "ready", sentence: "Pictures ready", opens: "#/tasks/e0000000-0000-4000-8000-000000000002",
};
const site = (over = {}) => ({ ...clone(SITE), ...over });
const imgs = (root) => elements(root).filter((e) => e.localName === "img");

test("apps team: the group's helper keeps only sites with a task id and a ref the route accepts, at most 30, a picture only at the server's own address", () => {
  assert.equal(sitesOfView(null).length, 0);
  const good = sitesOfView({ sites: [site()] });
  assert.equal(good.length, 1);
  assert.equal(good[0].href, "#/tasks/e0000000-0000-4000-8000-000000000002");
  assert.equal(good[0].name, "Editorial");
  assert.equal(good[0].picture, SITE.picture);
  const bad = sitesOfView({ sites: [
    site({ ref: "../x" }), site({ ref: "A" }), site({ task: { id: "a/b", identifier: "X", title: "t" } }), site({ task: null }), null, 3,
    site({ picture: `${HTTP}evil.test/a.png` }), site({ picture: `/api/sites/shot/${KEY}/shot-index-1280-light.png?x=1` }), site({ picture: "/api/view/../x.png" }),
    site({ picture: "javascript:alert(1)" }),
  ] });
  assert.equal(bad.length, 4, "the four with a good task and ref remain");
  assert.deepEqual(bad.map((s) => s.picture), [null, null, null, null], "every other picture address is dropped");
  assert.equal(sitesOfView({ sites: Array.from({ length: 40 }, (_, i) => site({ task: { id: `t${i}`, identifier: `STH-${i}`, title: "t" } })) }).length, 30);
  assert.match(SRC, /<img src=\$\{site\.picture\}/, "the group's img src is the checked picture");
  assert.equal((SRC.match(/<img /g) || []).length, 2, "this page has two pictures: an app's icon and a site's");
});

test("apps team mounted: no sites keeps the empty sentence and renders no tile", async () => {
  const m = await mount(fixed(view([], { sites: [] })));
  try {
    assert.ok(textOf(m.root).includes(WORDS.teamEmpty));
    assert.equal(elements(m.root).filter((e) => cls(e).split(/\s+/).includes("p-apps__site")).length, 0);
  } finally { m.done(); }
});

test("apps team mounted: two sites show their picture, name, task identifier and title, date and Open; the empty sentence is gone", async () => {
  const two = [site(), site({ task: { id: "e0000000-0000-4000-8000-000000000009", identifier: "STH-9", title: "A small site" }, ref: "studio", name: "studio", direction: null, picture: null, sentence: "No pictures yet", state: "none" })];
  const m = await mount(fixed(view([], { sites: two })));
  try {
    const all = textOf(m.root);
    assert.ok(!all.includes(WORDS.teamEmpty));
    assert.ok(all.includes("Editorial") && all.includes("studio"));
    assert.ok(all.includes("STH-2: A landing page for the November launch"));
    assert.ok(all.includes("STH-9: A small site"));
    assert.ok(all.includes(WORDS.noPicture), "the site with no picture says so");
    assert.equal(imgs(m.root).length, 1, "only the picture the server has taken");
    assert.equal(imgs(m.root)[0].getAttribute("src"), SITE.picture);
    assert.equal(buttons(m.root, "Open").length, 2);
    const link = elements(m.root).find((e) => e.localName === "a" && textOf(e).startsWith("STH-2"));
    assert.equal(link.getAttribute("href"), "#/tasks/e0000000-0000-4000-8000-000000000002");
  } finally { m.done(); }
});

test("apps team mounted: agent-written words stay text; a bad picture address reaches no img", async () => {
  const evil = site({ direction: "<img src=x onerror=alert(1)>", picture: `${HTTP}evil.test/p.png`, task: { id: "e0000000-0000-4000-8000-000000000002", identifier: "STH-2", title: "<script>1</script>" } });
  const m = await mount(fixed(view([], { sites: [evil] })));
  try {
    assert.ok(textOf(m.root).includes("<img src=x onerror=alert(1)>"));
    assert.ok(textOf(m.root).includes("<script>1</script>"));
    assert.equal(imgs(m.root).length, 0);
    assert.equal(elements(m.root).filter((e) => e.localName === "script").length, 0);
  } finally { m.done(); }
});

test("apps team mounted: Open posts the site's preview route and opens only the preview's own address, in a new tab with noopener", async () => {
  const opened = [];
  globalThis.window = { open: (...a) => opened.push(a) };
  try {
    const answers = (path, method) => (method === "POST" ? { status: 200, body: { url: `${HTTP}${LOOP}:3160/` } } : { status: 200, body: view([], { sites: [site()] }) });
    const m = await mount(answers);
    try {
      fire(buttons(m.root, "Open")[0], "click");
      await settle();
      const post = m.f.calls.find((c) => c.method === "POST");
      assert.equal(post.path, "/api/tasks/STH-2/sites/launch-a/preview");
      assert.deepEqual(opened, [[`${HTTP}${LOOP}:3160/`, "_blank", "noopener,noreferrer"]]);
    } finally { m.done(); }
    for (const url of [`${HTTP}${LOOP}:3160/?x=1`, `${HTTP}${LOOP}:3171/x`, `${HTTP}evil.test:3160/`, `https://${LOOP}:3160/`, "javascript:alert(1)"]) {
      opened.length = 0;
      const n = await mount((path, method) => (method === "POST" ? { status: 200, body: { url } } : { status: 200, body: view([], { sites: [site()] }) }));
      try {
        fire(buttons(n.root, "Open")[0], "click");
        await settle();
        assert.deepEqual(opened, [], `refused: ${url}`);
        assert.ok(textOf(n.root).includes(WORDS.badPreview));
        assert.equal(buttons(n.root, WORDS.openTask).length, 1, "the task's page is offered instead");
      } finally { n.done(); }
    }
    const r = await mount((path, method) => (method === "POST" ? { status: 409, body: { error: { message: "The preview is off.", next: "Switch it on in Settings." } } } : { status: 200, body: view([], { sites: [site()] }) }));
    try {
      fire(buttons(r.root, "Open")[0], "click");
      await settle();
      assert.match(textOf(r.root), /The preview is off\./);
      assert.equal(opened.length, 0);
    } finally { r.done(); }
  } finally { delete globalThis.window; }
});

// ---- T86: what the fence does not cover, and whole dollars ----

const TRUST = "This app's own program runs inside the fence: it cannot reach the internet or your files. Its page runs in your browser, and a page in your browser can still reach the internet, as any web page can. Turn on only an app whose code you trust.";
const TRUST_SHORT = "This app's page runs in your browser and can reach the internet. Its program cannot.";

test("apps: the sheet's amounts are whole dollars only, as K22 and the server take them", () => {
  assert.deepEqual([...AMOUNTS], [200, 500, 1000, 2000]);
  assert.ok(AMOUNTS.every((c) => Number.isInteger(c) && c % 100 === 0 && c >= 100 && c <= 10000));
  assert.ok(amountChoices(10000).every((c) => /^\$\d+$/.test(c.label)), "every choice reads as whole dollars");
  assert.equal(FIRST_AMOUNT % 100, 0);
});

test("apps mounted: beside each app's switch, the long sentence while it is off and the short one while it is on; quiet", async () => {
  const apps = [
    app({ slug: "a-off", name: "Off app", state: "off", on: false, spending: NOSPEND }),
    app({ slug: "b-on", name: "On app" }),
    app({ slug: "c-new", name: "New app", state: "not_installed", on: false }),
  ];
  const m = await mount(fixed(view(apps)));
  try {
    const tiles = elements(m.root).filter((e) => cls(e).split(/\s+/).includes("p-apps__tile"));
    assert.equal(tiles.length, 3);
    const trustOf = (t) => elements(t).filter((e) => cls(e) === "p-apps__trust").map(textOf);
    assert.deepEqual(trustOf(tiles[0]), [TRUST], "off: the long one, beside Turn on");
    assert.equal(buttons(tiles[0], "Turn on").length, 1);
    assert.deepEqual(trustOf(tiles[1]), [TRUST_SHORT], "on: the short one, beside Turn off");
    assert.equal(buttons(tiles[1], "Turn off").length, 1);
    assert.deepEqual(trustOf(tiles[2]), [], "no switch, no sentence");
    assert.equal(WORDS.trust, TRUST);
    assert.equal(WORDS.trustShort, TRUST_SHORT);
    const css = readFileSync(join(PUBLIC, "styles", "pages", "apps.css"), "utf8");
    assert.match(css, /\.p-apps \.p-apps__trust \{[^}]*color: var\(--ink-3\);[^}]*font-size: var\(--fs-label\);/, "12 px, third ink: quieter, still whole");
    assert.doesNotMatch(css, /\.p-apps__trust[^{]*\{[^}]*(display: none|text-overflow|-webkit-line-clamp|visibility: hidden)/, "never cut or hidden");
  } finally { m.done(); }
});

// ---- T60: the filter, the state as the kit's St, one button a card ----

test("apps: the filter's words and what it keeps; the state as the kit's St, starting never looking like on", () => {
  assert.deepEqual([WORDS.show, WORDS.all, WORDS.onlyOn, WORDS.onlyOff], ["Show apps", "All", "On", "Off"]);
  assert.equal(WORDS.noneOn, "No app is on.");
  assert.equal(WORDS.noneOff, "Every app is on.");
  assert.equal(WORDS.overLeft, "More than is left today");
  assert.deepEqual([...FILTERS], ["all", "on", "off"]);
  const list = [app({ slug: "a", on: true }), app({ slug: "b", on: false }), app({ slug: "c", on: true, state: "failed" }), null];
  assert.deepEqual(filterApps(list, "on").map((a) => a.slug), ["a", "c"]);
  assert.deepEqual(filterApps(list, "off").map((a) => a.slug), ["b"]);
  assert.equal(filterApps(list, "all").length, 4);
  assert.deepEqual(filterApps(null, "on"), []);
  assert.equal(stateSt("on").tone, "good");
  assert.equal(stateSt("failed").tone, "bad");
  assert.equal(stateSt("damaged").tone, "bad");
  assert.equal(stateSt("host_off").tone, "warn");
  assert.notEqual(stateSt("starting").tone, stateSt("on").tone, "starting does not look like on");
  assert.deepEqual(stateSt("made up"), stateSt("off"));
});

test("apps mounted: the filter sits in a bar under the title; On and Off keep their apps, and say so when none is left", async () => {
  const m = await mount(fixed(view([app({ slug: "a-on", name: "On app" }), app({ slug: "b-off", name: "Off app", state: "off", on: false, spending: NOSPEND })])));
  try {
    const group = elements(m.root).find((e) => e.getAttribute("role") === "group" && e.getAttribute("aria-label") === "Show apps");
    assert.ok(group, "the kit's segmented filter");
    const seg = (w) => elements(group).find((e) => e.localName === "button" && textOf(e).startsWith(w));
    assert.equal(seg("All").getAttribute("aria-pressed"), "true");
    assert.equal(textOf(seg("All")), "All2");
    fire(seg("On"), "click");
    await settle();
    const names = () => elements(m.root).filter((e) => cls(e) === "p-apps__name").map(textOf);
    assert.deepEqual(names(), ["On app"]);
    fire(seg("Off"), "click");
    await settle();
    assert.deepEqual(names(), ["Off app"]);
  } finally { m.done(); }
  const n = await mount(fixed(view([app()])));
  try {
    const group = elements(n.root).find((e) => e.getAttribute("aria-label") === "Show apps");
    fire(elements(group).find((e) => e.localName === "button" && textOf(e).startsWith("Off")), "click");
    await settle();
    assert.ok(textOf(n.root).includes(WORDS.noneOff));
  } finally { n.done(); }
  const e = await mount(fixed(view([])));
  try {
    assert.ok(!elements(e.root).some((x) => x.getAttribute("aria-label") === "Show apps"), "no apps, no filter");
  } finally { e.done(); }
});

test("apps mounted: a row's right holds Open while it runs or starts, then its switch (Turn on, Turn off) as a small ghost; the sentence under them", async () => {
  const apps = [
    app({ slug: "a-on", name: "On app" }),
    app({ slug: "b-off", name: "Off app", state: "off", on: false, spending: NOSPEND }),
    app({ slug: "c-failed", name: "Stopped app", state: "failed", on: true }),
    app({ slug: "d-new", name: "New app", state: "not_installed", on: false }),
  ];
  const m = await mount(fixed(view(apps)));
  try {
    const tiles = elements(m.root).filter((e) => cls(e).split(/\s+/).includes("p-apps__tile"));
    assert.ok(tiles.every((t) => t.localName === "li"), "the apps are rows of one list");
    const acts = (t) => {
      const el = elements(t).find((e) => cls(e) === "p-apps__acts");
      return el ? elements(el).filter((e) => (e.localName === "a" || e.localName === "button")).map((e) => textOf(e).trim()) : [];
    };
    assert.deepEqual(tiles.map(acts), [["Open", "Turn off"], ["Turn on"], ["Turn off"], []]);
    for (const t of tiles.slice(0, 3)) assert.match(cls(elements(t).find((e) => e.localName === "button")), /k-btn--ghost k-btn--sm/);
    const open = elements(tiles[0]).find((e) => e.localName === "a");
    assert.match(cls(open), /k-btn--primary/, "Open is the filled one on an app that is on");
    const kids = (t) => t.childNodes.filter((c) => c.nodeType === 1).map((c) => cls(c).split(/\s+/)[0]);
    assert.deepEqual(kids(tiles[0]).slice(-2), ["p-apps__acts", "p-apps__trust"], "the sentence comes after the buttons, across the row");
    const chip = (t) => elements(t).find((e) => cls(e).split(/\s+/).includes("k-tag"));
    assert.deepEqual(tiles.map((t) => cls(chip(t)).split(/\s+/)[1]), ["k-tag--good", "k-tag--neutral", "k-tag--bad", "k-tag--neutral"], "the state is a one-line chip in its tone");
  } finally { m.done(); }
});

// ---- TB2: the tile's initials, the state's chip, the money's figures, the model's label ----

test("apps: an app with no picture shows its initials; the state's chip tones; amounts cut out without a word changing", () => {
  assert.equal(initials("Render to Film"), "RF");
  assert.equal(initials("broken-app"), "BA");
  assert.equal(initials("Storyboard"), "S");
  assert.equal(initials("  "), "?");
  assert.equal(initials(null), "?");
  assert.deepEqual(["on", "starting", "off", "failed", "not_installed", "damaged", "host_off", "made up"].map(stateTag),
    ["good", "info", "neutral", "bad", "neutral", "bad", "warn", "neutral"]);
  const parts = moneyParts("Allowed today: $5.00. Spent: $1.20.");
  assert.deepEqual(parts.filter((p) => p.money).map((p) => p.text), ["$5.00", "$1.20"]);
  assert.equal(parts.map((p) => p.text).join(""), "Allowed today: $5.00. Spent: $1.20.", "shown as sent");
  assert.equal(moneyParts("This app cannot spend anything right now.").length, 1);
  assert.equal(thinksShort({ name: "Claude Opus 5.5" }), "Thinks with Claude Opus 5.5");
  assert.equal(thinksShort(null), "Choose how it thinks");
});

test("apps mounted: a picture that cannot be loaded gives way to the initials, never an empty square", async () => {
  const m = await mount(fixed(view([app({ slug: "colour-room", name: "Colour Room" })])));
  try {
    const img = elements(m.root).find((e) => e.localName === "img");
    fire(img, "error");
    await settle();
    assert.equal(elements(m.root).filter((e) => e.localName === "img").length, 0);
    const none = elements(m.root).find((e) => cls(e).includes("p-apps__icon--none"));
    assert.equal(textOf(none), "CR");
    assert.equal(none.getAttribute("aria-hidden"), "true");
    // R5-F: the initials stand on the kit's 32 px Tile, in the app's own quiet tint (the same every time).
    const tile = elements(none).find((e) => cls(e).split(/\s+/).includes("k-tile"));
    assert.ok(tile, "the kit's Tile");
    const { tintFor } = await import(pathToFileURL(join(PUBLIC, "kit", "tile.js")).href);
    assert.ok(cls(tile).split(/\s+/).includes(`k-tile--${tintFor("colour-room")}`));
    assert.ok(cls(tile).split(/\s+/).includes("k-tile--32"));
  } finally { m.done(); }
});

test("apps: the apps are rows in one card, each as tall as it holds; the sentence spans the row; the meta row 13 px in the second ink with the amounts in tabular figures", () => {
  const css = readFileSync(join(PUBLIC, "styles", "pages", "apps.css"), "utf8");
  assert.doesNotMatch(css, /p-apps__grid/, "no grid of cards");
  assert.match(css, /\.p-apps \.p-apps__tile \{[^}]*display: grid; grid-template-columns: 32px minmax\(0, 1fr\) auto; align-items: start;/);
  assert.doesNotMatch(css, /\.p-apps__tile \{[^}]*(height|align-items: stretch)/, "no row stretches to match another");
  assert.match(css, /\.p-apps \.p-apps__tile \+ \.p-apps__tile \{ border-top: 1px solid var\(--line\); \}/);
  assert.match(css, /\.p-apps \.p-apps__trust \{ grid-column: 2 \/ -1;/);
  assert.match(css, /\.p-apps \.p-apps__icon \{[^}]*width: 32px; height: 32px;/);
  assert.match(css, /\.p-apps \.p-apps__facts \{[^}]*color: var\(--ink-2\); font-size: var\(--fs-note\);/);
  assert.match(css, /\.p-apps \.p-apps__spend \{[^}]*font-variant-numeric: tabular-nums;/);
});

// ---- PLAN-3D-ALL U14: the room header, the wire, hostile text, whole sentences ----

const wire = (calls) => calls.map((c) => `${c.method || "GET"} ${c.path}${c.body == null ? "" : ` ${JSON.stringify(c.body)}`}`);

test("apps: the page sends what it sent before (PLAN-3D-ALL)", async () => {
  const seen = [];
  // As seeded: none, one on, one off, and the team's sites.
  for (const v of [view([]), view([app()]), view([app({ slug: "a-off", name: "Off app", state: "off", on: false, spending: NOSPEND })]), view([], { sites: [site()] })]) {
    const m = await mount(fixed(v));
    try { seen.push(...wire(m.f.calls)); } finally { m.done(); }
  }
  // Turn on, then Turn off, the answers shown.
  let current = view([app({ state: "off", on: false, sentence: "Off", spending: NOSPEND })]);
  const s = await mount((path, method) => {
    if (method === "POST") current = view([app({ state: "starting", on: true, sentence: "Starting…", spending: NOSPEND })]);
    return { status: 200, body: current };
  });
  try {
    fire(buttons(s.root, "Turn on")[0], "click");
    await settle();
    fire(buttons(s.root, "Turn off")[0], "click");
    await settle();
    seen.push(...wire(s.f.calls));
  } finally { s.done(); }
  // A site's Open: its preview route, then a new tab.
  globalThis.window = { open() {} };
  try {
    const o = await mount((path, method) => (method === "POST" ? { status: 200, body: { url: `${HTTP}${LOOP}:3160/` } } : { status: 200, body: view([], { sites: [site()] }) }));
    try {
      fire(buttons(o.root, "Open")[0], "click");
      await settle();
      seen.push(...wire(o.f.calls));
    } finally { o.done(); }
  } finally { delete globalThis.window; }
  // Not answered, then failed: the 404 and Try again.
  for (const status of [404, 500]) {
    const f = await mount(fixed({ error: { message: "No." } }, status));
    try {
      const again = buttons(f.root, "Try again")[0];
      if (again) { fire(again, "click"); await settle(); }
      seen.push(...wire(f.f.calls));
    } finally { f.done(); }
  }
  // Recorded on the page before PLAN-3D-ALL U14 changed it.
  const RECORDED = [
    "GET /api/apps", "GET /api/apps", "GET /api/apps", "GET /api/apps",
    "GET /api/apps", 'POST /api/apps/render-to-film/switch {"on":true}', 'POST /api/apps/render-to-film/switch {"on":false}',
    "GET /api/apps", "POST /api/tasks/STH-2/sites/launch-a/preview {}",
    "GET /api/apps",
    "GET /api/apps", "GET /api/apps",
  ];
  assert.deepEqual(seen, RECORDED);
  for (const c of seen) assert.ok(!/\/assets\/world\/|\/vendor\/three-/.test(c), c);
});

const { glimpseSrc, GLIMPSES } = await import("../../kit/room.js");
const { HOSTILE } = await import("../../world/fixtures.js");
const hasCls = (e, c) => cls(e).split(/\s+/).includes(c);
const byCls = (root, c) => elements(root).filter((e) => hasCls(e, c));
const inside = (el, root) => { for (let x = el; x; x = x.parentNode) if (x === root) return true; return false; };
// A window the page can ask: wide (1280) or a phone (390).
async function mountAt(wide, answers) {
  globalThis.matchMedia = (q) => ({ matches: /min-width: 860px/.test(q) ? wide : /max-width: 859px/.test(q) ? !wide : false, addEventListener() {}, removeEventListener() {} });
  try {
    const m = await mount(answers);
    return { ...m, done: () => { m.done(); delete globalThis.matchMedia; } };
  } catch (e) { delete globalThis.matchMedia; throw e; }
}

test("apps: the title, its line and the bar stand in the room header with the terrace's glimpse; one h1; the rows and their sentences under it (PLAN-3D-ALL U14)", async () => {
  const apps = [app({ slug: "a-off", name: "Off app", state: "off", on: false, spending: NOSPEND }), app({ slug: "b-on", name: "On app" })];
  const m = await mountAt(true, fixed(view(apps)));
  try {
    const band = elements(m.root).filter((e) => e.localName === "header" && hasCls(e, "k-room"));
    assert.equal(band.length, 1);
    assert.equal(band[0].getAttribute("data-glimpse"), "terrace");
    const h1 = elements(m.root).filter((e) => e.localName === "h1");
    assert.equal(h1.length, 1);
    assert.equal(h1[0].getAttribute("id"), "page-title");
    assert.equal(textOf(h1[0]), WORDS.title);
    assert.ok(inside(h1[0], band[0]));
    assert.ok(textOf(band[0]).includes(WORDS.intro), "the line under the title, as written");
    assert.equal(byCls(band[0], "p-apps__bar").length, 1, "the filter is in the band");
    assert.equal(byCls(m.root, "k-page-header").length, 0, "PageHeader is replaced");
    const pics = imgs(band[0]);
    assert.equal(pics.length, 1, "one picture in the band");
    assert.equal(pics[0].getAttribute("src"), glimpseSrc("terrace", { theme: "dark", width: 1280 }));
    assert.equal(pics[0].getAttribute("alt"), "");
    assert.equal(pics[0].getAttribute("aria-hidden"), "true");
    assert.equal(elements(m.root).filter((e) => e.localName === "canvas").length, 0, "a surface screen has no canvas");
    // ADR 0016: each sentence stays in its row, beside its switch, never in the band over the picture.
    for (const t of byCls(m.root, "p-apps__trust")) assert.ok(!inside(t, band[0]));
    for (const t of byCls(m.root, "p-apps__tile")) assert.ok(!inside(t, band[0]));
  } finally { m.done(); }
  const phone = await mountAt(false, fixed(view(apps)));
  try {
    assert.equal(byCls(phone.root, "k-room").length, 1, "a phone keeps the band as a title strip");
    assert.equal(byCls(phone.root, "k-room--strip").length, 1, "the kit's title strip (PLAN-3D-ALL U17)");
    assert.equal(imgs(phone.root).filter((e) => /glimpse/.test(e.getAttribute("src") || "")).length, 0, "a phone asks for no picture");
    assert.equal(byCls(phone.root, "k-room--bare").length, 1);
  } finally { phone.done(); }
  const css = readFileSync(join(PUBLIC, "styles", "pages", "apps.css"), "utf8");
  // PLAN-3D-ALL U17: the layer, the pull into the pane's margin and the phone's title strip are the kit's (U16): the
  // band is given `pull` and `strip` instead of the sheet copying "z-index: 1; margin-top: …" and "min-height: 56px".
  assert.match(readFileSync(join(PUBLIC, "pages", "apps.js"), "utf8"), /<\$\{RoomHeader\} glimpse=\$\{[^}]*\} pull strip\b/, "up into the pane's margin; a title strip on a phone");
  assert.match(css, /\.p-apps > \.k-room \{ margin-bottom: calc\(-1 \* var\(--s-2\)\); \}/, "16 px over the first group (D9)");
  assert.ok(!/paper/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no paper on the list: rows are never on paper (D4)");
});

test("apps: each app's full sentence beside Turn on is one whole text node, exactly as written, and no sheet can cut it (PLAN-3D-ALL U14, S1, ADR 0016)", async () => {
  const apps = [app({ slug: "a-off", name: "Off app", state: "off", on: false, spending: NOSPEND }), app({ slug: "b-on", name: "On app" })];
  const m = await mountAt(true, fixed(view(apps)));
  try {
    const nodes = [...walk(m.root)].filter((n) => n.nodeType === 3);
    const long = nodes.filter((n) => n.data === TRUST);
    assert.equal(long.length, 1, "the long sentence, one text node");
    const row = byCls(m.root, "p-apps__tile").find((t) => inside(long[0], t));
    assert.ok(row && buttons(row, "Turn on").length === 1, "beside Turn on, in the same row");
    assert.equal(nodes.filter((n) => n.data === TRUST_SHORT).length, 1, "the short sentence, one text node");
    const spend = byCls(m.root, "p-apps__spend");
    assert.equal(spend.length, 1);
    assert.equal(textOf(spend[0]), "Allowed today: $5.00. Spent: $1.20.", "the money words as sent, whole");
  } finally { m.done(); }
  const css = readFileSync(join(PUBLIC, "styles", "pages", "apps.css"), "utf8");
  for (const sel of ["p-apps__trust", "p-apps__spend", "p-apps__facts", "p-apps__list", "p-apps__rows", "p-apps__tile", "p-apps__info"]) {
    for (const m of css.matchAll(new RegExp(`\\.${sel}(?![\\w-])[^{]*\\{([^}]*)\\}`, "g"))) {
      assert.doesNotMatch(m[1], /text-overflow|line-clamp|overflow: hidden|(^|[;\s])(max-)?height:/, `${sel}: nothing cuts the sentence's box`);
    }
  }
});

test("apps: hostile server text stays text: no script, iframe or object; no img beyond the band's and the page's own; no on* attribute; no fixture text in href, src or style (PLAN-3D-ALL)", async () => {
  const tags = (root) => ["script", "img", "iframe", "object"].map((t) => elements(root).filter((e) => e.localName === t).length);
  const bad = (i) => HOSTILE[i % HOSTILE.length];
  const hostileApp = (i, over) => app({
    slug: `h-${i}`, name: bad(i), about: bad(i + 1), sentence: bad(i + 2),
    spending: { ...clone(SHAPE.apps[0].spending), words: bad(i + 3), limitWords: bad(i + 4) },
    thinks: { model: bad(i), name: bad(i + 5), choices: [{ id: bad(i), name: bad(i + 6) }] }, ...over,
  });
  const hostile = () => view([hostileApp(0), hostileApp(1, { state: "off", on: false }), hostileApp(2, { state: "failed" })], {
    host: { state: "on", sentence: bad(3) }, problemSentence: bad(4),
    sites: HOSTILE.map((h, i) => site({ task: { ...SITE.task, title: h }, name: h, direction: bad(i + 1), sentence: bad(i + 2) })),
  });
  const seeded = () => view([app({ slug: "h-0" }), app({ slug: "h-1", state: "off", on: false }), app({ slug: "h-2", state: "failed" })], {
    problemSentence: "A problem.", sites: HOSTILE.map(() => site()),
  });
  const s = await mountAt(true, fixed(seeded()));
  let base;
  try { base = tags(s.root); } finally { s.done(); }
  const m = await mountAt(true, fixed(hostile()));
  try {
    assert.deepEqual(tags(m.root), base);
    for (const e of elements(m.root)) {
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
      for (const h of HOSTILE) {
        for (const a of ["href", "src", "style"]) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
      }
      if (e.localName === "img") {
        const src = e.getAttribute("src");
        const band = GLIMPSES.some((k) => [1280, 390].some((w) => ["dark", "light"].some((theme) => glimpseSrc(k, { theme, width: w }) === src)));
        assert.ok(band || /^\/api\/apps\/h-[0-2]\/icon$/.test(src) || src === SITE.picture, `an img only at a fixed address: ${src}`);
      }
    }
    const nodes = [...walk(m.root)].filter((n) => n.nodeType === 3).map((n) => n.data);
    assert.ok(nodes.includes(bad(1)), "a hostile line is a text node");
    assert.ok(nodes.includes(bad(0)), "a hostile name is a text node");
  } finally { m.done(); }
});
