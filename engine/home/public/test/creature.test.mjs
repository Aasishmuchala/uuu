// The eight creatures (CONTRACTS-V3 28): every id has a sheet and a data file, CREATURES matches them,
// Creature renders in Node as pinned, and the stylesheet idles by CSS alone and stops when motion is off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TREE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(TREE, "assets", "creatures");
const IDS = "brain operations sales marketing studio support people books".split(" ");

// Load before any fake document exists: nothing may touch document or window at load.
const { CREATURES, CREATURE_IDS } = await import(pathToFileURL(join(TREE, "kit", "creature-data.js")).href);
const { Creature } = await import(pathToFileURL(join(TREE, "kit", "creature.js")).href);
const css = readFileSync(join(TREE, "styles", "creature.css"), "utf8");
const script = readFileSync(join(TREE, "kit", "creature.js"), "utf8");

// The width and height in a PNG's header.
function pngSize(file) {
  const b = readFileSync(file);
  assert.equal(b.subarray(1, 4).toString("latin1"), "PNG", `${file} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const classes = (v) => String(v?.props?.class ?? "").split(/\s+/).filter(Boolean);

test("CREATURES holds exactly the eight ids, in the pinned order", () => {
  assert.deepEqual(Object.keys(CREATURES), IDS);
  assert.deepEqual([...CREATURE_IDS], IDS);
});

test("each creature's line in CREATURES matches its data file and its sheet", () => {
  for (const id of IDS) {
    const sheet = join(ASSETS, `${id}-sheet.png`);
    const dataFile = join(ASSETS, `${id}.json`);
    assert.ok(existsSync(sheet), `${id}: the sheet exists`);
    assert.ok(existsSync(dataFile), `${id}: the data file exists`);
    const data = JSON.parse(readFileSync(dataFile, "utf8"));
    const c = CREATURES[id];
    assert.equal(c.frames, data.frames.length, `${id}: frame count`);
    assert.ok(c.frames >= 4 && c.frames <= 6, `${id}: 4 to 6 frames`);
    assert.equal(c.w, 16, `${id}: 16 pixels wide`);
    assert.equal(c.h, 16, `${id}: 16 pixels high`);
    for (const f of data.frames) {
      assert.deepEqual([f.frame.w, f.frame.h], [c.w, c.h], `${id}: every frame is the pinned size`);
    }
    assert.deepEqual([...c.durations], data.frames.map((f) => f.duration), `${id}: durations`);
    assert.equal(c.durations.reduce((n, d) => n + d, 0), 1600, `${id}: the idle lasts 1.6 s`);
    const tags = data.meta.frameTags;
    assert.deepEqual(tags.map((t) => t.name), ["idle"], `${id}: one tag, idle`);
    assert.deepEqual([tags[0].from, tags[0].to], [0, c.frames - 1], `${id}: idle covers every frame`);
    // One row, left to right, so the stylesheet can step through it.
    data.frames.forEach((f, i) => assert.deepEqual([f.frame.x, f.frame.y], [i * c.w, 0], `${id}: frame ${i} place`));
    assert.deepEqual(pngSize(sheet), { w: c.w * c.frames, h: c.h }, `${id}: the sheet is one row of frames`);
  }
});

test("Creature loads in Node and renders the pinned span", () => {
  const v = Creature({ id: "sales" });
  assert.equal(v.type, "span");
  assert.ok(classes(v).includes("k-creature"));
  assert.ok(!classes(v).includes("k-creature--still"));
  assert.equal(v.props["data-creature"], "sales");
  assert.match(v.props.style, /--k-creature-size: 32px;/);
  assert.match(v.props.style, new RegExp(`--k-creature-frames: ${CREATURES.sales.frames};`));
  assert.match(v.props.style, /--k-creature-time: 1600ms;/);
  // Without a label it is hidden from screen readers.
  assert.equal(v.props["aria-hidden"], "true");
  assert.equal(v.props["aria-label"], null);
  const kids = [].concat(v.props.children).filter((k) => k && typeof k === "object");
  assert.equal(kids.length, 1);
  assert.ok(classes(kids[0]).includes("k-creature__sheet"));
});

test("Creature: label, still, sizes, and an unknown id", () => {
  const v = Creature({ id: "brain", label: "Company brain", still: true, size: 96 });
  assert.equal(v.props.role, "img");
  assert.equal(v.props["aria-label"], "Company brain");
  assert.equal(v.props["aria-hidden"], null);
  assert.ok(classes(v).includes("k-creature--still"));
  assert.match(v.props.style, /--k-creature-size: 96px;/);
  for (const s of [16, 32, 48, 64, 96]) assert.match(Creature({ id: "books", size: s }).props.style, new RegExp(`--k-creature-size: ${s}px;`));
  for (const s of [20, 0, -16, "x", 128]) assert.match(Creature({ id: "books", size: s }).props.style, /--k-creature-size: 32px;/);
  for (const id of ["ghost", "", null, undefined, "__proto__", "toString", 7]) assert.equal(Creature({ id }), null, `unknown id ${String(id)}`);
  assert.equal(Creature(), null);
  for (const id of IDS) assert.equal(Creature({ id }).props["data-creature"], id);
});

test("the idle is CSS alone: no canvas, no timer, no frame loop in the script", () => {
  assert.doesNotMatch(script, /requestAnimationFrame|setInterval|setTimeout|<canvas|getContext/);
});

test("the stylesheet steps through the sheet, pixelated, for ever, by transform only", () => {
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(css, /animation:\s*k-creature-idle\s+var\(--k-creature-time[^;]*steps\(var\(--k-creature-frames[^;]*infinite;/);
  const frames = css.match(/@keyframes k-creature-idle\s*\{([\s\S]*?)\n\}/);
  assert.ok(frames, "the keyframes are there");
  const props = [...frames[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  assert.ok(props.length && props.every((p) => p === "transform"), "the keyframes move transform only");
  // Tokens-only rules of 27.3 for a stylesheet that is not tokens.css or canvas.css.
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|font-family|font-size|backdrop-filter|will-change|filter\s*:/i);
  for (const id of IDS) {
    assert.match(css, new RegExp(`\\[data-creature="${id}"\\][^{]*\\{[^}]*url\\("\\.\\./assets/creatures/${id}-sheet\\.png"\\)`), `${id}: its sheet`);
  }
});

test("the stylesheet stops the idle for still, data-motion off and reduced motion", () => {
  const rule = css.match(/([^{}]+)\{\s*animation:\s*none;\s*\}/);
  assert.ok(rule, "one rule stops the animation");
  const sel = rule[1];
  assert.match(sel, /\.k-creature--still \.k-creature__sheet/);
  assert.match(sel, /\[data-motion="off"\] \.k-creature__sheet/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.k-creature__sheet\s*\{\s*animation:\s*none;\s*\}\s*\}/);
});
