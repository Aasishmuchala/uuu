// Hostile text against the stage and the drawn studio (PLAN-3D section 3, T7): with the `hostile` fixture, after
// drawing, the DOM holds no script, img, iframe or object it did not hold with the plain fixture; no attribute named
// on*; no href or src holding fixture text; no style holding fixture text; the names are text nodes, cut to their
// cap; the drawn picture holds none of the text at all; sceneOf holds none of it and drops the bad id. And a source
// check: no file under public/world/ (T6's included, later) writes HTML from a string or runs a string as code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FakeElement, html, render, installDom, elements, walkDom, settle } from "../kit/_dom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..");
const WORLD = join(PUBLIC, "world");
const load = (f) => import(pathToFileURL(join(WORLD, f)).href);
const { WorldStage } = await load("stage.js");
const { drawFallback } = await load("fallback.js");
const { worldState, sceneOf, NAME_MAX, TAG_MAX } = await load("state.js");
const F = await load("fixtures.js");

const DANGEROUS = ["script", "img", "iframe", "object", "embed", "image", "foreignObject", "use", "a"];
// The fixture's strings, and the recognisable cores of each (a cut string still carries its start).
const NEEDLES = [...F.HOSTILE.map((s) => s.slice(0, 12)), F.HOSTILE_ID, "alert(1)", "evil.example", "7*7"];
const holds = (v) => NEEDLES.some((n) => String(v).includes(n));

async function stageDom(fixture, props = {}) {
  installDom();
  const root = new FakeElement("div");
  render(html`<${WorldStage} mode="map" state=${worldState(fixture)} label="The studio." ...${props} />`, root);
  await settle(50);
  return root;
}
const count = (root, tag) => elements(root).filter((e) => e.localName === tag).length;

function styleText(el) {
  const s = el.style || {};
  return [s.cssText, ...Object.entries(s).filter(([k, v]) => typeof v === "string" && k !== "cssText").map(([, v]) => v)].join(";");
}

function checkDom(root, plain, where) {
  for (const tag of DANGEROUS) assert.equal(count(root, tag), count(plain, tag), `${where}: no ${tag} beyond the plain fixture's`);
  for (const e of elements(root)) {
    for (const [k, v] of Object.entries(e.attrs)) {
      assert.ok(!/^on/i.test(k), `${where}: no ${k} attribute`);
      if (["href", "src", "xlink:href", "style", "class", "id", "fill", "clip-path", "transform", "d"].includes(k)) assert.ok(!holds(v), `${where}: ${k}="${String(v).slice(0, 40)}" holds no fixture text`);
    }
    assert.ok(!holds(styleText(e)), `${where}: no style holds fixture text`);
  }
}

test("the stage with the hostile fixture: nothing added, nothing run, the text stays text", async () => {
  for (const focus of [null, "h-room-0"]) {
    const plain = await stageDom(F.seed, { focus });
    const root = await stageDom(F.hostile, { focus });
    checkDom(root, plain, `stage (focus ${focus})`);
    const texts = [...walkDom(root)].filter((n) => n.nodeType === 3).map((n) => n.data);
    assert.ok(texts.some((t) => t.includes("<img src=x")), "the img text is shown as text");
    assert.ok(texts.some((t) => t.includes("<script>")), "the script text is shown as text");
    for (const t of texts) assert.ok(t.length <= NAME_MAX, `a text node is cut to its cap (${t.length})`);
    const tagNames = elements(root).filter((e) => (e.getAttribute("class") || "").includes("w-tag__name")).map((e) => [...walkDom(e)].filter((n) => n.nodeType === 3).map((n) => n.data).join(""));
    assert.ok(tagNames.length > 0);
    for (const t of tagNames) assert.ok(t.length <= TAG_MAX, `a tag's name is cut to ${TAG_MAX}`);
    // the long name is whole up to its cap in title, never more
    for (const e of elements(root)) {
      const t = e.getAttribute("title");
      if (t !== null) assert.ok(t.length <= NAME_MAX, "title is cut to the name's cap");
    }
    // the bad department id never reaches a data attribute
    for (const e of elements(root)) for (const [k, v] of Object.entries(e.attrs)) if (k.startsWith("data-")) assert.ok(!String(v).includes(F.HOSTILE_ID), `${k} holds no bad id`);
    render(null, plain);
    render(null, root);
  }
});

test("the drawn studio with the hostile fixture holds none of its text, in any attribute or text node", () => {
  installDom();
  for (const mode of ["map", "desk"]) {
    const host = new FakeElement("div");
    const plainHost = new FakeElement("div");
    const ws = worldState(F.hostile);
    drawFallback(plainHost, { mode, scene: worldState(F.seed).scene });
    drawFallback(host, { mode, plan: ws.scene.plan, scene: ws.scene });
    checkDom(host, plainHost, `fallback ${mode}`);
    for (const n of walkDom(host)) {
      if (n.nodeType === 3) assert.match(n.data, /^\+\d+$/, `${mode}: the only text is a count`);
      else if (n.attrs) for (const v of Object.values(n.attrs)) assert.ok(!holds(v), `${mode}: an attribute holds fixture text`);
    }
  }
  // even a SceneState damaged by hand, with text where ids go, draws no text
  const host = new FakeElement("div");
  const bad = { rooms: [{ id: "<script>", lamps: [{ id: "agent:<img>", lamp: "<b>" }] }], doors: [{ id: "door:\"><x", state: "<i>" }], apps: [{ id: "javascript:alert(1)", on: true }], plan: { rooms: [{ id: "javascript:alert(1)", x0: 0, x1: 4, y: 0.6, desks: [{ slug: "<img src=x>", x: 1 }] }] } };
  drawFallback(host, { scene: bad });
  for (const n of walkDom(host)) if (n.attrs) for (const v of Object.values(n.attrs)) assert.ok(!/[<>"]|javascript:/.test(v), `"${v}" is not written`);
});

test("sceneOf holds none of the hostile strings, and drops the bad id", () => {
  const scene = sceneOf(worldState(F.hostile));
  const all = JSON.stringify(scene);
  for (const n of NEEDLES) assert.ok(!all.includes(n), `the scene holds no "${n}"`);
  assert.ok(!scene.rooms.some((r) => r.id === F.HOSTILE_ID));
});

// ---- the source check ----

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

test("no file under public/world/ writes HTML from a string or runs a string as code", () => {
  const files = filesUnder(WORLD).filter((f) => /\.(m?js|html)$/.test(f));
  assert.ok(files.some((f) => f.endsWith("stage.js")) && files.some((f) => f.endsWith("fallback.js")), "the folder was read");
  const FORBIDDEN = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "dangerouslySetInnerHTML", "eval(", "new Function"];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const word of FORBIDDEN) assert.ok(!src.includes(word), `${relative(PUBLIC, f)} holds "${word}"`);
  }
});
