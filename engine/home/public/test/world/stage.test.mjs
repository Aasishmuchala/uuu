// The stage (PLAN-3D T7, D2, D3): the drawn picture at once; data-world "fallback" when the world may not load (no
// WebGL2, world=off, a narrow stage, save-data) or when its import fails; "loading" with the status line meanwhile,
// "ready" once a world is acquired; picking; nothing focusable; the tags; the gallery's choice of fixture.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, classesOf, fire, textOf, settle } from "../kit/_dom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..");
const load = (f) => import(pathToFileURL(join(PUBLIC, "world", f)).href);
const { WorldStage, worldAllowed, worldOff, tagsOf } = await load("stage.js");
const { worldState } = await load("state.js");
const WORDS_MOD = await load("words.js");
const { WORDS } = WORDS_MOD;
const { galleryChoice } = await load("gallery.boot.js");
const F = await load("fixtures.js");

const SEED = worldState(F.seed);

// A page that may load the world: WebGL2, a wide stage, no world=off.
function allowWorld({ width = 1280, search = "" } = {}) {
  globalThis.WebGL2RenderingContext = function WebGL2RenderingContext() {};
  globalThis.location = { search, hash: "#/map" };
  FakeElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width, height: 800 }; };
}
afterEach(() => {
  delete globalThis.WebGL2RenderingContext;
  delete globalThis.location;
  delete FakeElement.prototype.getBoundingClientRect;
});

async function mountStage(props) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${WorldStage} ...${props} />`, root);
  await settle(50);
  return root;
}
const stageOf = (root) => elements(root).find((e) => classesOf(e).includes("w-stage"));
const statusOf = (root) => elements(root).find((e) => e.getAttribute("role") === "status");
const never = () => new Promise(() => {});

test("the conditions of D3: WebGL2, no world=off, at least 240 px wide, no save-data", () => {
  const ok = { webgl2: true, query: "?fixture=seed", width: 1280, saveData: false };
  assert.equal(worldAllowed(ok), true);
  assert.equal(worldAllowed({ ...ok, webgl2: false }), false);
  assert.equal(worldAllowed({ ...ok, query: "?world=off" }), false);
  assert.equal(worldAllowed({ ...ok, query: "?fixture=seed&world=off&mode=map" }), false);
  assert.equal(worldAllowed({ ...ok, width: 239 }), false);
  assert.equal(worldAllowed({ ...ok, width: 240 }), true);
  assert.equal(worldAllowed({ ...ok, width: NaN }), false);
  assert.equal(worldAllowed({ ...ok, saveData: true }), false);
  assert.equal(worldAllowed(), false);
  assert.equal(worldOff("&view=list&world=off"), true);
  assert.equal(worldOff("?world=office"), false);
});

test("without WebGL2 the stage is the drawn picture: data-world fallback, and the world is never loaded", async () => {
  let loads = 0;
  const root = await mountStage({ mode: "map", state: SEED, load: () => { loads++; return never(); } });
  const stage = stageOf(root);
  assert.equal(stage.getAttribute("data-world"), "fallback");
  assert.equal(loads, 0);
  assert.equal(elements(stage).filter((e) => e.getAttribute("data-room") !== null).length, 7, "the picture is drawn");
  render(null, root);
});

test("with world=off in the address the world is never loaded", async () => {
  allowWorld({ search: "?world=off" });
  let loads = 0;
  const root = await mountStage({ mode: "map", state: SEED, load: () => { loads++; return never(); } });
  assert.equal(stageOf(root).getAttribute("data-world"), "fallback");
  assert.equal(loads, 0);
  render(null, root);
});

test("a stage under 240 px wide keeps the drawn picture", async () => {
  allowWorld({ width: 200 });
  let loads = 0;
  const root = await mountStage({ mode: "map", state: SEED, load: () => { loads++; return never(); } });
  assert.equal(stageOf(root).getAttribute("data-world"), "fallback");
  assert.equal(loads, 0);
  render(null, root);
});

test("while the world loads: data-world loading, the status line says Lighting the studio (map) or the desk", async () => {
  for (const [mode, words] of [["map", WORDS.lightingStudio], ["desk", WORDS.lightingDesk]]) {
    allowWorld();
    const root = await mountStage({ mode, state: SEED, load: never });
    assert.equal(stageOf(root).getAttribute("data-world"), "loading");
    assert.equal(textOf(statusOf(root)), words);
    assert.ok(!stageOf(root).contains(statusOf(root)), "the status line is outside the hidden stage, so it is spoken");
    render(null, root);
  }
  assert.equal(WORDS.lightingStudio, "Lighting the studio");
  assert.equal(WORDS.lightingDesk, "Lighting the desk");
});

test("an import that fails leaves the drawn picture: data-world fallback, the status line quiet", async () => {
  allowWorld();
  const root = await mountStage({ mode: "map", state: SEED, load: () => Promise.reject(new Error("404")) });
  const stage = stageOf(root);
  assert.equal(stage.getAttribute("data-world"), "fallback");
  assert.equal(textOf(statusOf(root)), "");
  assert.equal(elements(stage).filter((e) => e.getAttribute("data-room") !== null).length, 7);
  render(null, root);
});

test("the real import of ./world.js failing (before T6) or a module without acquire also falls back", async () => {
  allowWorld();
  const root = await mountStage({ mode: "map", state: SEED, load: async () => ({}) });
  assert.equal(stageOf(root).getAttribute("data-world"), "fallback");
  render(null, root);
});

test("a world acquired: data-world ready, the scene handed over as data only, released on leaving", async () => {
  allowWorld();
  const calls = [];
  const handle = {
    setScene: (s) => calls.push(["scene", s]), play: () => {}, focus: (r) => calls.push(["focus", r]), hover: () => {},
    setSafeRect: () => {}, setTheme: (t) => calls.push(["theme", t]), setStill: () => {},
    project: () => ({ x: 400, y: 300, visible: true }), onFrame: () => {}, frames: 0, release: () => calls.push(["release"]),
  };
  let opts = null;
  const root = await mountStage({ mode: "map", state: SEED, focus: "sales", theme: "light", load: async () => ({ acquire: async (host, o) => { opts = o; return handle; } }) });
  await settle(50);
  assert.equal(stageOf(root).getAttribute("data-world"), "ready");
  assert.equal(opts.mode, "map");
  assert.equal(opts.tier, "desktop");
  assert.equal(opts.theme, "light");
  const scene = calls.find((c) => c[0] === "scene")[1];
  assert.deepEqual(scene, SEED.scene, "the world receives the SceneState and nothing else");
  assert.ok(calls.some((c) => c[0] === "focus" && c[1] === "sales"));
  assert.equal(textOf(statusOf(root)), "");
  render(null, root);
  assert.ok(calls.some((c) => c[0] === "release"), "the world is released when the stage goes");
});

test("a lost context returns to the drawn picture, once", async () => {
  allowWorld();
  let lost = null;
  let loads = 0;
  const handle = { setScene() {}, focus() {}, hover() {}, setSafeRect() {}, setTheme() {}, setStill() {}, project: () => null, onFrame() {}, release() {} };
  const root = await mountStage({ mode: "map", state: SEED, load: async () => { loads++; return { acquire: async (h, o) => { lost = o.onLost; return handle; } }; } });
  await settle(50);
  assert.equal(stageOf(root).getAttribute("data-world"), "ready");
  lost();
  await settle(50);
  assert.equal(stageOf(root).getAttribute("data-world"), "fallback");
  await settle(100);
  assert.equal(loads, 1, "no retry loop");
  render(null, root);
});

test("picking a room in the drawn picture calls onPick with its id", async () => {
  const picks = [];
  const root = await mountStage({ mode: "map", state: SEED, onPick: (id) => picks.push(id) });
  const room = elements(root).find((e) => e.getAttribute("data-room") === "support");
  fire(room, "click");
  assert.deepEqual(picks, ["support"]);
  render(null, root);
});

test("the stage is aria-hidden and nothing in it takes focus; its label is a hidden line outside it", async () => {
  for (const mode of ["map", "desk"]) {
    const root = await mountStage({ mode, state: SEED, label: "The studio at dusk." });
    const stage = stageOf(root);
    assert.equal(stage.getAttribute("aria-hidden"), "true");
    for (const e of elements(stage)) {
      assert.ok(!["a", "button", "input", "select", "textarea", "iframe", "summary"].includes(e.localName), `no ${e.localName} in the stage`);
      assert.equal(e.getAttribute("tabindex"), null, "no tabindex");
      assert.equal(e.getAttribute("contenteditable"), null);
    }
    const line = elements(root).find((e) => !stage.contains(e) && classesOf(e).includes("u-visually-hidden") && textOf(e) === "The studio at dusk.");
    assert.ok(line, "the label is spoken from outside the stage");
    render(null, root);
  }
});

test("the stage's parts: the fallback, the canvas host, the tag layer, the progress line", async () => {
  const root = await mountStage({ mode: "map", state: SEED });
  const stage = stageOf(root);
  for (const c of ["w-fallback", "w-canvas", "w-tags", "w-line"]) assert.equal(elements(stage).filter((e) => classesOf(e).includes(c)).length, 1, c);
  render(null, root);
});

// T11 changed this deliberately: every agent with an item in the queue was tagged (the server marks each as waiting),
// thirteen tags over seven rooms in the seed. At overview only the stuck and those waiting on an approval are tagged;
// the rest show their amber lamp and their room's count, and their tag on hover or open.
test("tags at overview: every room's title with its count words, and every agent who is stuck or waits on an approval", async () => {
  const tags = tagsOf(SEED, { mode: "map" });
  const rooms = tags.filter((t) => t.kind === "room");
  assert.deepEqual(rooms.map((t) => t.id), SEED.rooms.map((r) => r.id));
  assert.equal(rooms.find((t) => t.id === "operations").sub, "3 working, 1 needs you");
  const agents = tags.filter((t) => t.kind === "agent").map((t) => t.id).sort();
  assert.deepEqual(agents, ["agent:builder"]);
  const root = await mountStage({ mode: "map", state: SEED });
  const spans = elements(root).filter((e) => classesOf(e).includes("w-tag"));
  assert.equal(spans.length, tags.length);
  const ops = spans.find((s) => s.getAttribute("data-tag") === "operations");
  assert.equal(textOf(ops), "Operations3 working, 1 needs you");
  assert.equal(ops.getAttribute("title"), "Operations");
  assert.ok(spans.every((s) => ["shown", "hidden"].includes(s.getAttribute("data-placed"))), "every tag is placed or hidden");
  assert.ok(spans.filter((s) => s.getAttribute("data-placed") === "shown").length >= 7, "the drawn picture places them");
  for (const s of spans.filter((x) => x.getAttribute("data-placed") === "shown")) assert.match(s.style.transform, /^translate\(-?\d+px, -?\d+px\)$/);
  render(null, root);
});

// T11: the overview was crowded and an agent with something in the queue read "Free". Rooms come first so each holds
// its own corner; an amber agent reads "Needs you"; a red one keeps the server's word; free and plain working agents
// get no tag; a hovered room shows all its agents; one tag at the doors names the shut ones, none when all are open.
test("tags at overview: rooms first, amber reads Needs you, the doors' one tag, a hovered room's agents", () => {
  const { TAG_WORDS, doorsTagLine } = WORDS_MOD;
  assert.deepEqual(TAG_WORDS, { needsYou: "Needs you", shut: "shut", allShut: "All shut", door: { web: "Web", generation: "Generation", higgsfield: "Higgsfield" } });
  const tags = tagsOf(SEED, { mode: "map" });
  const kinds = tags.map((t) => t.kind);
  assert.equal(kinds.lastIndexOf("room"), SEED.rooms.length - 1, "every room's tag before any other");
  assert.ok(!tags.some((t) => t.kind === "door"), "every door open in the seed: no door tag");
  const amber = SEED.rooms.flatMap((r) => r.agents).find((a) => a.lamp === "amber" && a.state === "free");
  assert.ok(!tags.some((t) => t.id === `agent:${amber.slug}`), "an agent with only an item in the queue: no tag at overview");
  const room = SEED.rooms.find((r) => r.agents.includes(amber));
  assert.equal(tagsOf(SEED, { mode: "map", hover: room.id }).find((t) => t.id === `agent:${amber.slug}`).sub, "Needs you");
  assert.equal(tags.find((t) => t.id === "agent:builder").sub, "Has a problem");
  const free = SEED.rooms.flatMap((r) => r.agents).filter((a) => a.lamp === "on" || a.lamp === "off");
  for (const a of free) assert.ok(!tags.some((t) => t.id === `agent:${a.slug}`), a.slug);
  const hovered = tagsOf(SEED, { mode: "map", hover: "operations" });
  for (const a of SEED.rooms.find((r) => r.id === "operations").agents) assert.ok(hovered.some((t) => t.id === `agent:${a.slug}`), a.slug);
  const off = tagsOf(worldState(F.doorOff), { mode: "map" });
  const d = off.find((t) => t.kind === "door");
  assert.deepEqual([d.id, d.text, d.sub], ["doors", "Doors", "Web shut"]);
  assert.equal(doorsTagLine([{ id: "web", state: "shut" }, { id: "generation", state: "blocked" }, { id: "higgsfield", state: "open" }]), "Web, Generation shut");
  assert.equal(doorsTagLine([{ id: "web", state: "shut" }, { id: "generation", state: "shut" }, { id: "higgsfield", state: "blocked" }]), "All shut");
  assert.equal(doorsTagLine(["web", "generation", "higgsfield"].map((id) => ({ id, state: "open" }))), "");
  assert.ok(!tagsOf(worldState(F.empty), { mode: "map" }).some((t) => t.kind === "door"), "no doors read: no door tag");
});

test("tags in a chosen room: that room and every agent in it, no other room's tags; none in desk mode", () => {
  const tags = tagsOf(SEED, { mode: "map", focus: "operations" });
  assert.deepEqual(tags.map((t) => t.id), ["operations", "agent:chief-of-staff", "agent:builder", "agent:checker", "agent:art-director"]);
  assert.equal(tags[2].sub, "Has a problem");
  assert.deepEqual(tagsOf(SEED, { mode: "desk" }), []);
  assert.deepEqual(tagsOf(null), []);
});

test("long names: a tag is cut to 24 characters and carries the whole name in title", () => {
  const big = worldState(F.big);
  const tags = tagsOf(big, { mode: "map", focus: "dept-0" });
  for (const t of tags) {
    assert.ok(t.text.length <= 24, t.text);
    assert.ok(t.title.length > 24 && t.title.startsWith(t.text.slice(0, -1)), "the whole name is in title");
  }
});

test("empty, allOff and big draw as stages without throwing", async () => {
  for (const name of ["empty", "allOff", "big", "app", "doorOff", "doorBlocked", "one"]) {
    for (const mode of ["map", "desk"]) {
      const root = await mountStage({ mode, state: worldState(F[name]) });
      assert.equal(stageOf(root).getAttribute("data-world"), "fallback", `${name} ${mode}`);
      render(null, root);
    }
  }
  const root = await mountStage({ mode: "map", state: null });
  assert.equal(stageOf(root).getAttribute("data-world"), "fallback");
  render(null, root);
});

test("the gallery: a fixture by name, a wrong name shows the seed, the mode and the focus checked", () => {
  assert.deepEqual(galleryChoice("?fixture=big&mode=desk"), { fixture: "big", mode: "desk", focus: null });
  assert.deepEqual(galleryChoice("?fixture=nope"), { fixture: "seed", mode: "map", focus: null });
  assert.deepEqual(galleryChoice("?fixture=__proto__&mode=x"), { fixture: "seed", mode: "map", focus: null });
  assert.deepEqual(galleryChoice("?focus=sales"), { fixture: "seed", mode: "map", focus: "sales" });
  assert.deepEqual(galleryChoice("?focus=../../x"), { fixture: "seed", mode: "map", focus: null });
  assert.deepEqual(galleryChoice(undefined), { fixture: "seed", mode: "map", focus: null });
});
