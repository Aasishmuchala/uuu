// The stage as a photograph (office/stage.js; the owner chose photographs over 3D on 18 Nov 2026), in the test DOM:
// the loft's picture by the theme and the tier; a marker per room placed (a link with a name), its lamps and the tag
// rule (one per room, plus the agents stuck or waiting on an approval; all of them hovered or opened); the doors'
// marker lists the three doors and choosing one asks the page for that door's panel and nothing more; the light over
// the zones; a hand-off's travelling light and the desk's sheet; a picture that fails; no moving picture until there
// is one; hostile text stays text. And the Map and Needs you no longer reach three.js, the world or its assets.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, classesOf, textOf, walkDom, settle } from "./kit/_dom.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => import(pathToFileURL(join(PUBLIC, f)).href);
const S = await load("office/stage.js");
const { worldState } = await load("world/state.js");
const F = await load("world/fixtures.js");
const { TAG_WORDS, WORDS } = await load("world/words.js");

Object.defineProperty(FakeElement.prototype, "innerHTML", { set(v) { throw new Error(`innerHTML was set: ${v}`); }, configurable: true });

const withClass = (root, c) => elements(root).filter((e) => classesOf(e).includes(c));
const textNodes = (root) => [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
function fire(el, type, extra = {}) {
  const key = Object.keys(el.listeners).find((k) => k.toLowerCase() === type);
  assert.ok(key, `${el.localName}.${classesOf(el).join(".")} listens for ${type}`);
  const ev = { type: key, target: el, currentTarget: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  for (const f of el.listeners[key]) f.call(el, ev);
  return ev;
}

const roots = [];
afterEach(() => { while (roots.length) render(null, roots.pop()); delete globalThis.innerWidth; delete globalThis.matchMedia; });

async function mount(props, { width } = {}) {
  installDom();
  if (width) globalThis.innerWidth = width;
  else delete globalThis.innerWidth;
  const root = new FakeElement("div");
  render(html`<${S.OfficeStage} ...${props} />`, root);
  roots.push(root);
  await settle(150);
  return root;
}
const seed = () => worldState(F.seed);

test("the stage's own words are pinned", () => {
  assert.deepEqual({ ...S.OFFICE_WORDS }, { open: "Open", shut: "Shut", doorsList: "The three doors" });
  assert.ok(Object.isFrozen(S.OFFICE_WORDS));
  assert.equal(S.MOVE_MS, 650);
});

test("the loft by the theme: dusk for dark, the golden morning for light; a phone asks only for the 900 px file", async () => {
  const dark = await mount({ mode: "map", state: seed(), theme: "dark" });
  const img = withClass(dark, "o-img")[0];
  assert.equal(img.getAttribute("src"), "/assets/office/v1/loft-dusk-1600.webp");
  assert.equal(img.getAttribute("srcset"), "/assets/office/v1/loft-dusk-1600.webp 1600w, /assets/office/v1/loft-dusk-2560.webp 2560w");
  assert.equal(img.getAttribute("alt"), "");
  assert.equal(withClass(dark, "o-ground")[0].getAttribute("src"), "/assets/office/v1/loft-dusk-ground.webp");
  assert.equal(withClass(dark, "o-frame")[0].getAttribute("aria-hidden"), "true", "the picture is hidden from readers");
  const light = await mount({ mode: "map", state: seed(), theme: "light" });
  assert.match(withClass(light, "o-img")[0].getAttribute("src"), /loft-morning-1600\.webp$/);
  const phone = await mount({ mode: "map", state: seed(), theme: "dark" }, { width: 390 });
  assert.equal(withClass(phone, "o-img")[0].getAttribute("src"), "/assets/office/v1/loft-dusk-900.webp");
  assert.doesNotMatch(withClass(phone, "o-img")[0].getAttribute("srcset"), /1600|2560/);
  const desk = await mount({ mode: "desk", state: seed(), theme: "light" });
  assert.match(withClass(desk, "o-img")[0].getAttribute("src"), /desk-morning-1600\.webp$/);
  assert.equal(withClass(desk, "o-mark").length, 0, "the desk has no markers");
  // no canvas, no WebGL stage, no drawn fallback
  for (const r of [dark, light, phone, desk]) {
    assert.equal(elements(r).filter((e) => e.localName === "canvas").length, 0);
    assert.equal(withClass(r, "w-stage").length + withClass(r, "w-fallback").length, 0);
  }
});

test("a marker per room placed: a link to the room with a name, its lamps, its tag; seven at most", async () => {
  const root = await mount({ mode: "map", state: seed() });
  const marks = withClass(root, "o-mark--room");
  assert.equal(marks.length, 7);
  const ops = marks.find((m) => m.getAttribute("data-room") === "operations");
  assert.equal(ops.localName, "a");
  assert.equal(ops.getAttribute("href"), "#/map/operations");
  assert.equal(ops.getAttribute("aria-label"), "Operations, 6 jobs, 3 working, 1 needs you");
  assert.equal(withClass(ops, "k-lamp").length >= 4, true, "a lamp per agent");
  assert.ok(textNodes(ops).includes("Operations"));
  // each tag and lamp is hidden from readers: the link's name says it
  for (const part of [...withClass(ops, "o-mark__pin"), ...withClass(ops, "o-mark__tag")]) assert.equal(part.getAttribute("aria-hidden"), "true");
  const big = await mount({ mode: "map", state: worldState(F.big) });
  assert.equal(withClass(big, "o-mark--room").length, 7, "the eighth to the twelfth are in the list only");
  const more = withClass(big, "o-mark__more");
  assert.ok(more.some((m) => textOf(m) === "+7"), "the thirteen-agent room shows six lamps and +7");
  const one = await mount({ mode: "map", state: worldState(F.one) });
  assert.equal(withClass(one, "o-mark--room").length, 1);
  // the zones no room has are lit dim and carry no marker
  assert.equal(withClass(one, "o-zone--empty").length, 6);
});

test("the tag rule: rooms, plus the agents stuck or waiting on an approval; all of a room hovered or opened", () => {
  const ws = seed();
  const marks = S.marksOf(ws);
  const urgent = ws.rooms.flatMap((r) => r.agents.filter((a) => a.lamp === "red" || a.state === "waiting_for_you").map((a) => a.slug));
  assert.deepEqual(marks.flatMap((m) => m.agents.map((a) => a.slug)), urgent);
  assert.ok(urgent.length > 0);
  const ops = ws.rooms.find((r) => r.id === "operations");
  const hovered = S.marksOf(ws, { hover: "operations" }).find((m) => m.id === "operations");
  assert.deepEqual(hovered.agents.map((a) => a.slug), ops.agents.map((a) => a.slug));
  const opened = S.marksOf(ws, { focus: "operations" });
  assert.deepEqual(opened.find((m) => m.id === "operations").agents.map((a) => a.slug), ops.agents.map((a) => a.slug));
  assert.ok(opened.filter((m) => m.id !== "operations").every((m) => m.bare), "with a room open the others show their lamps alone");
  // an amber lamp reads "Needs you" on the picture, as the 3D tags did
  const amber = S.marksOf(ws, { hover: "operations" }).flatMap((m) => m.agents).filter((a) => a.lamp === "amber");
  for (const a of amber) assert.equal(a.words, TAG_WORDS.needsYou);
  assert.deepEqual(S.marksOf(null), []);
});

test("the light over the zones: working warm, idle dim, stuck a red-amber edge, unused dim", () => {
  const ws = seed();
  const lights = S.zoneLights(ws.rooms, new Map(ws.rooms.map((r) => [r.id, r.id])));
  for (const r of ws.rooms) {
    const lamps = r.agents.map((a) => a.lamp);
    assert.equal(lights[r.id], lamps.includes("red") ? "stuck" : lamps.includes("on") ? "working" : "idle", r.id);
  }
  assert.equal(lights.operations, "stuck", "the seed's Builder is stuck");
  const none = S.zoneLights([], new Map());
  assert.ok(Object.values(none).every((v) => v === "empty"));
});

test("the doors' marker: a button that lists the three doors; choosing one asks for its panel and nothing more", async () => {
  const picked = [];
  const root = await mount({ mode: "map", state: worldState(F.doorOff), onPick: (id) => picked.push(id) });
  const btn = withClass(root, "o-mark--doors")[0];
  assert.equal(btn.localName, "button");
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(btn.getAttribute("aria-label"), `${WORDS.doors}: Web shut`);
  fire(btn, "click");
  await settle(150);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  const picks = elements(root).filter((e) => e.getAttribute("data-door-pick"));
  assert.deepEqual(picks.map((p) => p.getAttribute("data-door-pick")), ["web", "generation", "higgsfield"]);
  assert.deepEqual(picks.map((p) => p.getAttribute("aria-label")), ["Web door, Shut", "Generation door, Open", "Higgsfield door, Open"]);
  fire(picks[0], "click");
  await settle(150);
  assert.deepEqual(picked, ["door:web"]);
  assert.equal(elements(root).filter((e) => e.getAttribute("data-door-pick")).length, 0, "the list closes");
  // a room's marker asks for the room
  fire(withClass(root, "o-mark--room").find((m) => m.getAttribute("data-room") === "sales"), "click");
  assert.deepEqual(picked, ["door:web", "sales"]);
});

test("a room opened: the stage marks it, the other zones fall away, the others' markers show their lamps alone", async () => {
  const root = await mount({ mode: "map", state: seed(), focus: "sales" });
  const marks = withClass(root, "o-mark--room");
  assert.equal(marks.find((m) => m.getAttribute("data-room") === "sales").getAttribute("aria-current"), "true");
  assert.equal(withClass(root, "o-zone").filter((z) => classesOf(z).includes("is-away")).length, 6);
  assert.equal(marks.filter((m) => withClass(m, "o-mark__tag").length).length, 1, "one room's tag");
});

test("a hand-off draws a light between two zones; a lamp's change pulses its room; the desk's sheet goes to the model or the tray", async () => {
  const ws = seed();
  const events = [{ type: "handoff", from: "chief-of-staff", to: "sales", animate: true }, { type: "lamp", slug: "sales", room: "sales", from: "off", to: "on", animate: true }];
  const root = await mount({ mode: "map", state: ws, events });
  await settle(150);
  const paths = elements(root).filter((e) => e.localName === "path");
  assert.equal(paths.length, 3, "the trail, its glow and the spark");
  assert.match(paths[0].getAttribute("d"), /^M 52\.5 69 Q [\d.]+ [\d.]+ 61\.2 33\.5$/, "from Operations' anchor to Sales'");
  assert.ok(withClass(root, "o-mark--room").find((m) => m.getAttribute("data-room") === "sales").getAttribute("class").includes("is-pulse"));
  // nothing for an event that does not animate (a hidden tab)
  const quiet = await mount({ mode: "map", state: ws, events: events.map((e) => ({ ...e, animate: false })) });
  assert.equal(elements(quiet).filter((e) => e.localName === "path").length, 0);
  const desk = await mount({ mode: "desk", state: ws, events: [{ type: "approve", room: "books", animate: true }] });
  await settle(150);
  assert.equal(withClass(desk, "o-sheet--model").length, 1);
  const aside = await mount({ mode: "desk", state: ws, events: [{ type: "aside", animate: true }] });
  await settle(150);
  assert.equal(withClass(aside, "o-sheet--tray").length, 1);
});

test("a picture that cannot load leaves the plain ground: no markers, no light; the list does the rest", async () => {
  const root = await mount({ mode: "map", state: seed() });
  fire(withClass(root, "o-img")[0], "error");
  await settle(150);
  const stage = withClass(root, "o-stage")[0];
  assert.equal(stage.getAttribute("data-office"), "failed");
  assert.equal(withClass(root, "o-mark").length, 0);
  assert.equal(withClass(root, "o-zone").length, 0);
  assert.equal(withClass(root, "o-ground").length, 1);
  const ok = await mount({ mode: "map", state: seed() });
  fire(withClass(ok, "o-img")[0], "load");
  await settle(150);
  assert.equal(withClass(ok, "o-stage")[0].getAttribute("data-office"), "ready");
});

test("the moving picture: none until it is in the set; given one, the dusk loft on a desktop plays it muted and looped", async () => {
  const none = await mount({ mode: "map", state: seed() });
  assert.equal(elements(none).filter((e) => e.localName === "video").length, 0);
  const video = "/assets/office/v1/loop-dusk.mp4";
  const on = await mount({ mode: "map", state: seed(), video });
  const v = elements(on).filter((e) => e.localName === "video");
  assert.equal(v.length, 1);
  assert.equal(v[0].getAttribute("src"), video);
  assert.equal(v[0].getAttribute("poster"), "/assets/office/v1/loft-dusk-1600.webp");
  for (const p of ["muted", "autoplay", "loop", "playsinline"]) assert.ok(v[0].getAttribute(p) !== null || v[0][p] === true, p);
  for (const props of [{ still: true }, { theme: "light" }, { mode: "desk" }]) {
    const r = await mount({ mode: "map", state: seed(), video, ...props });
    assert.equal(elements(r).filter((e) => e.localName === "video").length, 0, JSON.stringify(props));
  }
  globalThis.matchMedia = (q) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} });
  const reduced = await mount({ mode: "map", state: seed(), video });
  assert.equal(elements(reduced).filter((e) => e.localName === "video").length, 0, "never under reduced motion");
  const phone = await mount({ mode: "map", state: seed(), video }, { width: 390 });
  assert.equal(elements(phone).filter((e) => e.localName === "video").length, 0, "never on a phone");
});

test("hostile text stays text: no fixture text in an address, a source or a style; no innerHTML", async () => {
  for (const props of [{}, { focus: "h-room-0" }, { hover: "h-room-2" }]) {
    const root = await mount({ mode: "map", state: worldState(F.hostile), ...props });
    for (const e of elements(root)) {
      for (const k of Object.keys(e.attrs)) assert.ok(!/^on/i.test(k), `no ${k}`);
      for (const a of ["href", "src", "srcset", "style", "d", "data-room", "data-zone"]) {
        for (const h of F.HOSTILE) assert.ok(!String(e.getAttribute(a) || "").includes(h), `${a} holds no fixture text`);
      }
    }
    assert.equal(elements(root).filter((e) => ["script", "iframe", "object"].includes(e.localName)).length, 0);
    assert.ok(!elements(root).some((e) => String(e.getAttribute("href") || "").includes("..")), "the bad id is never a marker");
  }
});

// ---- The Map and Needs you no longer reach three.js, the 3D world or its assets ----

const STATIC = /\bfrom\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']/g;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const code = (src) => String(src).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/[^\n]*/g, "$1");
function reach(start) {
  const seen = new Set();
  const todo = [resolve(PUBLIC, start)];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = code(readFileSync(f, "utf8"));
    for (const m of [...src.matchAll(STATIC), ...src.matchAll(DYNAMIC)]) {
      const spec = m[1] || m[2];
      if (spec && spec.startsWith(".")) todo.push(resolve(dirname(f), spec));
    }
  }
  return [...seen].map((f) => relative(PUBLIC, f).split("\\").join("/"));
}

test("the Map and Needs you load no three.js, no world.js, no drawn fallback and nothing from assets/world", () => {
  for (const page of ["pages/map.js", "pages/needs-you.js"]) {
    const files = reach(page);
    assert.ok(files.includes("office/stage.js"), `${page} reaches the photograph's stage`);
    for (const f of files) {
      assert.ok(!/^vendor\/three-/.test(f), `${page} reaches ${f}`);
      assert.ok(!["world/world.js", "world/stage.js", "world/fallback.js", "world/assets.js", "world/hdr.js"].includes(f) && !f.startsWith("world/scene/"), `${page} reaches ${f}`);
      const src = code(readFileSync(join(PUBLIC, f), "utf8"));
      assert.doesNotMatch(src, /assets\/world\/|vendor\/three/, `${f} names the 3D world's files`);
    }
  }
});

test("office.css: the stage's classes, tokens only, no blur, transitions on transform and opacity", () => {
  const css = readFileSync(join(PUBLIC, "styles", "office.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const c of ["o-stage", "o-ground", "o-frame", "o-img", "o-zone--working", "o-zone--idle", "o-zone--stuck", "o-zone--empty", "o-mark", "o-mark__tag", "o-flow", "o-doors__pick", "o-sheet", "o-note"]) {
    assert.match(css, new RegExp(`\\.${c}\\b`), `.${c} is styled`);
  }
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "no hex colour");
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/, "no colour function");
  assert.doesNotMatch(css, /blur|backdrop-filter|will-change|url\(/);
  for (const m of css.matchAll(/transition\s*:\s*([^;}]+)/g)) {
    for (const item of m[1].split(",")) assert.ok(["transform", "opacity", "none"].includes(item.trim().split(/\s+/)[0]), item.trim());
  }
  assert.match(css, /\.o-stage\.is-settled \.o-frame\s*\{\s*transition:\s*transform 650ms/, "the picture glides in 650 ms");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:root\[data-motion="off"\]/);
  assert.match(css, /@media \(max-width: 859px\)[\s\S]*\.o-doors__pick\s*\{\s*min-height:\s*44px/, "a phone's door is 44 px to the touch");
  assert.match(css, /\.o-mark__pin::before\s*\{[^}]*inset:\s*-14px/, "a marker's reach is at least 44 px");
});
