// The drawn studio (PLAN-3D T7, D7): the seed's seven rooms, twelve lamps in their states, the three doors, the
// empty and all-off companies still a picture, picking a room or a door, framing, the desk, and the stylesheet's
// rules (tokens only, no blur, only transform and opacity move).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, installDom, elements, classesOf, fire, textOf } from "../kit/_dom.mjs";
import { THEMED } from "../tokens.pinned.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..");
const load = (f) => import(pathToFileURL(join(PUBLIC, "world", f)).href);
const { drawFallback } = await load("fallback.js");
const { worldState } = await load("state.js");
const F = await load("fixtures.js");

function draw(name, opts = {}) {
  installDom();
  const host = new FakeElement("div");
  const ws = worldState(F[name]);
  const fb = drawFallback(host, { mode: "map", plan: ws.scene.plan, scene: ws.scene, theme: "dark", ...opts });
  return { host, ws, fb };
}
const all = (root, sel) => elements(root).filter(sel);
const attr = (k) => (e) => e.getAttribute(k) !== null;
const cls = (c) => (e) => classesOf(e).includes(c);

test("the seed: seven rooms, each with its id in data-room, in the server's order", () => {
  const { host, ws } = draw("seed");
  const rooms = all(host, attr("data-room"));
  assert.equal(rooms.length, 7);
  assert.deepEqual(rooms.map((r) => r.getAttribute("data-room")), ws.rooms.map((r) => r.id));
});

test("the seed: twelve lamp glyphs, each carrying the class of its lamp state", () => {
  const { host, ws } = draw("seed");
  const lamps = all(host, cls("w-lamp"));
  assert.equal(lamps.length, 12);
  const want = new Map(ws.rooms.flatMap((r) => r.agents).map((a) => [`agent:${a.slug}`, a.lamp]));
  for (const l of lamps) {
    const lamp = want.get(l.getAttribute("data-lamp"));
    assert.ok(lamp, `${l.getAttribute("data-lamp")} is an agent of the seed`);
    assert.ok(classesOf(l).includes(`w-lamp--${lamp}`), `${l.getAttribute("data-lamp")} is drawn ${lamp}`);
  }
  const states = lamps.map((l) => classesOf(l).find((c) => c.startsWith("w-lamp--")));
  for (const s of ["on", "amber", "red", "off", "down"]) assert.ok(states.includes(`w-lamp--${s}`), `a ${s} lamp is drawn`);
  // each state is told by its shape, not its colour alone
  const by = (s) => lamps.find((l) => classesOf(l).includes(`w-lamp--${s}`));
  assert.ok(all(by("on"), cls("w-lamp__pool")).length === 1 && all(by("on"), cls("w-lamp__ring")).length === 0);
  assert.equal(all(by("amber"), cls("w-lamp__ring")).length, 1);
  assert.equal(all(by("red"), cls("w-lamp__ring")).length, 1);
  assert.equal(all(by("red"), cls("w-lamp__bar")).length, 1);
  assert.equal(all(by("off"), cls("w-lamp__pool")).length, 0);
  assert.equal(all(by("down"), cls("w-lamp__line")).length, 1);
});

test("three doors; in doorOff the web door is shut and the other two open; doorBlocked marks generation", () => {
  const doorsOf = (name) => Object.fromEntries(all(draw(name).host, attr("data-door")).map((d) => [d.getAttribute("data-door"), classesOf(d)]));
  const seed = doorsOf("seed");
  assert.deepEqual(Object.keys(seed), ["web", "generation", "higgsfield"]);
  const off = doorsOf("doorOff");
  assert.ok(off.web.includes("w-door--shut"));
  assert.ok(off.generation.includes("w-door--open") && off.higgsfield.includes("w-door--open"));
  const blocked = draw("doorBlocked").host;
  const gen = all(blocked, attr("data-door")).find((d) => d.getAttribute("data-door") === "generation");
  assert.ok(classesOf(gen).includes("w-door--blocked"));
  assert.equal(all(gen, cls("w-door__mark")).length, 1, "a blocked door carries the small amber mark");
});

test("empty and allOff draw without throwing and are not blank: the sky and the building's outline", () => {
  for (const name of ["empty", "allOff"]) {
    const { host } = draw(name);
    const parts = all(host, attr("data-part")).map((e) => e.getAttribute("data-part"));
    for (const p of ["sky", "building", "outline", "annex"]) assert.ok(parts.includes(p), `${name} draws its ${p}`);
    assert.ok(elements(host).length > 60, `${name} is a picture, not a few lines`);
  }
  const { host } = draw("allOff");
  const lamps = all(host, cls("w-lamp"));
  assert.ok(lamps.length > 0 && lamps.every((l) => /w-lamp--(off|down)/.test(classesOf(l).join(" "))), "all off: every lamp off or down");
  assert.equal(all(host, cls("w-door--open")).length, 0, "all off: every door shut");
  assert.ok(all(host, cls("w-fb-post-light")).length > 0, "all off: the path lights still burn");
});

test("drawing takes wrong input without throwing", () => {
  installDom();
  for (const o of [undefined, null, {}, { scene: null }, { scene: { rooms: "x" }, plan: 7 }, { mode: "desk" }, { mode: "desk", scene: { stack: { sheets: 99, more: -3 } } }]) {
    assert.doesNotThrow(() => drawFallback(new FakeElement("div"), o));
  }
});

test("picking a room calls onPick with its id; a door with door:<id>; hovering says so", () => {
  const picks = [];
  const hovers = [];
  const { host } = draw("seed", { onPick: (id) => picks.push(id), onHover: (id) => hovers.push(id) });
  const room = all(host, attr("data-room")).find((r) => r.getAttribute("data-room") === "marketing");
  fire(room, "click");
  fire(room, "pointerenter");
  fire(room, "pointerleave");
  const door = all(host, attr("data-door")).find((d) => d.getAttribute("data-door") === "web");
  fire(door, "click");
  assert.deepEqual(picks, ["marketing", "door:web"]);
  assert.deepEqual(hovers, ["marketing", null]);
});

test("redrawing into the same host replaces the picture", () => {
  installDom();
  const host = new FakeElement("div");
  const ws = worldState(F.seed);
  drawFallback(host, { scene: ws.scene });
  drawFallback(host, { scene: ws.scene });
  assert.equal(host.childNodes.length, 1);
});

test("framing: the building inside the free rectangle; a chosen room fills it; points follow", () => {
  const { fb } = draw("seed");
  const svg = fb.svg;
  fb.frame({ width: 1280, height: 800 });
  const whole = svg.getAttribute("viewBox").split(" ").map(Number);
  assert.equal(whole.length, 4);
  assert.ok(Math.abs(whole[2] / whole[3] - 1280 / 800) < 0.01, "the view keeps the stage's shape");
  const ops = fb.point("operations");
  assert.ok(ops && ops.visible);
  // with a 340 px rail at the left, every room's corner moves right of it
  fb.frame({ width: 1280, height: 800, safe: { x: 340, y: 0, w: 940, h: 800 } });
  for (const id of ["operations", "sales", "marketing", "studio", "support", "people", "books"]) assert.ok(fb.point(id).x > 340, `${id} clears the rail`);
  const k1 = 1280 / Number(svg.getAttribute("viewBox").split(" ")[2]);
  fb.frame({ width: 1280, height: 800, focus: "sales" });
  const k2 = 1280 / Number(svg.getAttribute("viewBox").split(" ")[2]);
  assert.ok(k2 > k1 * 1.5, "a chosen room is drawn larger");
  assert.equal(fb.point("nobody"), null);
  // a phone
  fb.frame({ width: 390, height: 300 });
  const p = fb.point("agent:builder");
  assert.ok(p && p.x > 0 && p.x < 390 && p.y > 0 && p.y < 300);
});

test("focus dims the other rooms; hover marks one", () => {
  const { host, fb } = draw("seed");
  fb.setFocus("studio");
  const rooms = all(host, attr("data-room"));
  for (const r of rooms) assert.equal(classesOf(r).includes("is-away"), r.getAttribute("data-room") !== "studio");
  fb.setFocus(null);
  assert.ok(rooms.every((r) => !classesOf(r).includes("is-away")));
  fb.setHover("books");
  assert.deepEqual(rooms.filter((r) => classesOf(r).includes("is-hover")).map((r) => r.getAttribute("data-room")), ["books"]);
});

test("big: eleven rooms drawn, at most six desks a room, the rest a +N count", () => {
  const { host, ws } = draw("big");
  assert.equal(all(host, attr("data-room")).length, 11);
  assert.equal(ws.overflow.length, 1);
  const first = all(host, attr("data-room"))[0];
  assert.equal(all(first, cls("w-lamp")).length, 6);
  assert.equal(textOf(first), "+7");
});

test("the app: a lit bench with the allowance lamp on the terrace", () => {
  const { host } = draw("app");
  const benches = all(host, attr("data-app"));
  assert.equal(benches.length, 1);
  assert.ok(classesOf(benches[0]).includes("is-on"));
  assert.equal(all(benches[0], cls("w-fb-allowance")).length, 1);
});

test("desk mode: the stack of blank sheets, at most twelve, the count of the rest, and the studio small behind", () => {
  installDom();
  const ws = worldState(F.seed);
  const host = new FakeElement("div");
  drawFallback(host, { mode: "desk", scene: { ...ws.scene, stack: { sheets: 12, more: 5 } } });
  const stack = all(host, (e) => e.getAttribute("data-part") === "stack")[0];
  assert.equal(stack.getAttribute("data-sheets"), "12");
  assert.equal(all(stack, cls("w-fb-sheet")).length, 12);
  assert.equal(textOf(stack), "+5");
  assert.equal(all(host, attr("data-room")).length, 7, "the elevation stands in the window");
  const empty = new FakeElement("div");
  drawFallback(empty, { mode: "desk", scene: worldState(F.empty).scene });
  assert.equal(all(empty, cls("w-fb-sheet")).length, 0);
  assert.equal(all(empty, cls("w-fb-sheet-spot")).length, 1);
});

test("the picture holds no text but the +N counts", () => {
  for (const name of Object.keys(F.fixtures)) {
    const { host } = draw(name);
    const words = elements(host).filter((e) => e.localName === "text").map((e) => textOf(e));
    for (const w of words) assert.match(w, /^\+\d+$/, `${name}: "${w}"`);
  }
});

// ---- the stylesheet ----

const CSS = readFileSync(join(PUBLIC, "styles", "world.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

test("world.css: the stage's classes, tokens only, no blur, transitions on transform and opacity", () => {
  for (const c of ["w-stage", "w-canvas", "w-fallback", "w-tags", "w-tag", "w-line", "w-scrim"]) assert.match(CSS, new RegExp(`\\.${c}\\b`), `.${c} is styled`);
  assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,8}\b/, "no hex colour");
  assert.doesNotMatch(CSS, /\brgba?\(|\bhsla?\(/, "no colour function");
  assert.doesNotMatch(CSS, /blur|backdrop-filter|will-change/);
  for (const m of CSS.matchAll(/transition\s*:\s*([^;}]+)/g)) {
    for (const item of m[1].split(",")) {
      const prop = item.trim().split(/\s+/)[0];
      assert.ok(["transform", "opacity", "none"].includes(prop), `moves only transform and opacity ("${item.trim()}")`);
    }
  }
  for (const m of CSS.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(!m[1].startsWith("--w-") || THEMED[m[1]], `${m[1]} is a pinned token`);
  assert.match(CSS, /\.w-line\s*\{[^}]*height:\s*2px/, "the progress line is 2 px");
  assert.match(CSS, /\.w-line\s*\{[^}]*transform:\s*scaleX/, "and grows by transform");
  assert.match(CSS, /:root\[data-motion="off"\][^{]*\.w-canvas/, "reduced motion: the cross-over is instant");
});

// WCAG contrast of the tag's inks on its ground laid over the lightest and the darkest sky, in both themes.
const rgb = (s) => {
  const h = s.match(/^#([0-9a-f]{6})$/i);
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)).concat(1);
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
};
const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
const lum = (c) => {
  const [r, g, b] = c.slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("a tag reads at 4.5 to 1 over any sky, in both themes; the paper's ink on the paper too", () => {
  for (const i of [0, 1]) {
    for (const sky of ["--w-sky-0", "--w-sky-2", "--w-room-lit"]) {
      const ground = over(rgb(THEMED["--w-tag"][i]), rgb(THEMED[sky][i]));
      for (const ink of ["--w-tag-ink", "--w-tag-ink-2"]) {
        const r = ratio(rgb(THEMED[ink][i]), ground);
        assert.ok(r >= 4.5, `${ink} on the tag over ${sky} (${i ? "light" : "dark"}): ${r.toFixed(2)}`);
      }
    }
    const r = ratio(rgb(THEMED["--w-paper-ink"][i]), rgb(THEMED["--w-paper"][i]));
    assert.ok(r >= 7, `paper ink on paper: ${r.toFixed(2)}`);
  }
});
