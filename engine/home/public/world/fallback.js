// The drawn studio (PLAN-3D D7): what shows without WebGL, while the world loads, and on a stage under 240 px. The
// same plan and the same SceneState as the 3D world, drawn as an architect's elevation at dusk in SVG (the house as
// the world builds it since REAL-1: concrete slabs with a shadow gap, a pier at every room's edge, glass from floor
// to ceiling in slim frames, an opal globe over each room): the
// sky, the hills and the forest, the building with a room per department, a desk and a lamp per agent, the annex
// with its three doors, the roof terrace's pavilion with a bench per app, the deck, the path and its lights. In
// desk mode (Needs you) the owner's desk drawn flat with the stack of blank sheets, and the same elevation small in
// the window behind.
//
// Safety: built with createElementNS and text nodes only. It receives no server text: every id it writes is a
// plain slug from the SceneState, every other attribute a number or a constant, and its only text is "+N". Colours
// are classes read by styles/world.css from the --w-* tokens, so this file holds none.
//
// drawFallback(svgHost, { mode, plan, scene, theme, onPick, onHover }) -> { svg, frame, point, setHover, setFocus }
// - frame({ width, height, safe, focus }): frames the building (or the chosen room) inside `safe`, the stage's free
//   rectangle in pixels, and remembers the scale so point() can answer;
// - point(anchor): where a room (its top left inside), an agent (`agent:<slug>`, above its lamp), a door
//   (`door:<id>`) or the stack sits on the stage, in pixels: { x, y, visible } or null.
import { MAX_DESKS } from "./layout.js";
import { LAMPS } from "./state.js";

const NS = "http://www.w3.org/2000/svg";
const ID = /^[a-z][a-z0-9-]{0,40}$/;
const DOORS = ["web", "generation", "higgsfield"];
const DOOR_STATES = ["open", "shut", "blocked"];
const LIT = new Set(["on", "amber", "red"]);
const BENCHES = 4;
// When no size is known yet (the first paint, the test DOM), the stage is taken to be this.
export const DEFAULT_SIZE = Object.freeze({ width: 1280, height: 800 });

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const n = (v) => Math.round(v * 100) / 100;
// A fixed scatter (no randomness: the same picture every time).
const scatter = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

let seq = 0;

// The drawn studio in the golden morning (T12): a pale sky warming to the horizon, daylit rooms, the firs in sun.
const MORNING = Object.freeze({
  "--w-sky-0": "#86a9c8", "--w-sky-1": "#c4d3db", "--w-sky-2": "#f2dcbd", "--w-glow": "#ffd49a", "--w-hill": "#97a5a4",
  "--w-trees-far": "#617467", "--w-trees": "#34463a", "--w-ground": "#7b7858", "--w-forecourt": "#a49d8b", "--w-deck": "#9a7354",
  "--w-stone": "#bfb7aa", "--w-shell": "#efe9df", "--w-shell-2": "#c8bfb2", "--w-frame": "#3b3631", "--w-room": "#d6cbbb",
  "--w-room-lit": "#f2b56e", "--w-glass": "#b7c7cf", "--w-desk": "#b98d63", "--w-door": "#5a4a3e", "--w-shrub": "#4f603f",
});

export function drawFallback(svgHost, options = {}) {
  const o = obj(options) ? options : {};
  const mode = o.mode === "desk" ? "desk" : "map";
  const scene = obj(o.scene) ? o.scene : {};
  const plan = obj(o.plan) ? o.plan : obj(scene.plan) ? scene.plan : { rooms: [], empty: true };
  const theme = o.theme === "light" ? "light" : "dark";
  const pick = typeof o.onPick === "function" ? o.onPick : () => {};
  const hover = typeof o.onHover === "function" ? o.onHover : () => {};
  const uid = `w-fb-${++seq}`;
  const doc = globalThis.document;

  const el = (tag, attrs, parent) => {
    const e = doc.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  };
  // y is up in the plan and down in SVG.
  const Y = (y) => n(-y);
  const rect = (x0, y0, x1, y1, cls, parent, extra = {}) =>
    el("rect", { x: n(Math.min(x0, x1)), y: Y(Math.max(y0, y1)), width: n(Math.abs(x1 - x0)), height: n(Math.abs(y1 - y0)), class: cls, ...extra }, parent);
  const pathOf = (pts) => `M${pts.map(([x, y]) => `${n(x)} ${Y(y)}`).join(" L")}`;

  while (svgHost && svgHost.firstChild) svgHost.removeChild(svgHost.firstChild);
  const svg = el("svg", { class: `w-fb w-fb--${mode}`, "data-theme": theme, preserveAspectRatio: "xMidYMid meet", focusable: "false", "aria-hidden": "true" });
  if (svgHost) svgHost.appendChild(svg);
  // the morning (T12): the drawing's own light values, constants only, over the stylesheet's dusk
  if (theme === "light" && svg.style && typeof svg.style.setProperty === "function") for (const k in MORNING) svg.style.setProperty(k, MORNING[k]);

  // ---- shared paints: the sky, the glow at the horizon, a lit room's wash, a lamp's pool ----
  const defs = el("defs", {}, svg);
  let made = null;
  const gradient = (kind, id, attrs, stops) => {
    made = el(kind, { id: `${uid}-${id}`, ...attrs }, defs);
    for (const [offset, cls] of stops) el("stop", { offset, class: cls }, made);
    return `url(#${uid}-${id})`;
  };
  const SKY = gradient("linearGradient", "sky", { gradientUnits: "userSpaceOnUse", x1: 0, y1: -20, x2: 0, y2: 0 }, [[0, "w-fb-sky-0"], [0.58, "w-fb-sky-1"], [1, "w-fb-sky-2"]]);
  const skyGrad = made;
  const GLOW = gradient("radialGradient", "glow", { cx: 0.5, cy: 0.5, r: 0.5 }, [[0, "w-fb-glow-0"], [1, "w-fb-glow-1"]]);
  const WASH = gradient("linearGradient", "wash", { x1: 0, y1: 1, x2: 0, y2: 0 }, [[0, "w-fb-wash-0"], [1, "w-fb-wash-1"]]);
  const POOL = { on: "", amber: "", red: "" };
  for (const k of Object.keys(POOL)) POOL[k] = gradient("radialGradient", `pool-${k}`, { cx: 0.5, cy: 0.5, r: 0.5 }, [[0, `w-fb-pool-${k}`], [1, `w-fb-pool-${k} w-fb-stop-clear`]]);
  const SPILL = gradient("radialGradient", "spill", { cx: 0.5, cy: 0.5, r: 0.5 }, [[0, "w-fb-spill-0"], [1, "w-fb-spill-1"]]);

  const anchors = new Map();
  const rooms = new Map();
  let inner = { s: 1, tx: 0, ty: 0 }; // the elevation's place inside the desk scene (desk mode)

  // ---- the elevation: sky, forest, building, ground; into `root`, in metres ----
  function elevation(root, { small }) {
    const b = obj(plan.building) ? plan.building : { x0: -6.35, x1: 3.25, storeys: 1, floorH: 3.3, groundY: 0.6 };
    const floorH = fin(b.floorH, 3.3);
    const groundY = fin(b.groundY, 0.6);
    const storeys = Math.max(1, fin(b.storeys, 1));
    const x0 = fin(b.x0, -6);
    const x1 = fin(b.x1, 6);
    const annex = obj(plan.annex) ? plan.annex : { x0: x1, x1: x1 + 3.1, doors: [] };
    const ax1 = fin(annex.x1, x1 + 3.1);
    const top = groundY + storeys * floorH;
    const terrace = obj(plan.terrace) ? plan.terrace : null;
    const peak = top + (terrace && terrace.onRoof ? 2.8 : 0);
    const coreX = x0 - 1.3;
    const mid = (coreX + ax1) / 2;

    // the sky, far wider and taller than any frame, so a wide or tall stage never shows its edge
    rect(-400, 0, 400, 260, "w-fb-sky", root, { fill: SKY, "data-part": "sky" });
    // the sky's gradient runs from well above the roof to the horizon
    skyGrad.setAttribute("y1", Y(peak + 14));
    el("ellipse", { cx: n(mid + 9), cy: Y(1.2), rx: 26, ry: 9, fill: GLOW, class: "w-fb-glow" }, root);

    // far hills, then two rows of forest
    const hills = [[-400, 0]];
    for (let x = -80; x <= 80; x += 4) hills.push([x, 3.2 + Math.sin(x * 0.07) * 1.6 + Math.sin(x * 0.023 + 1) * 2.4]);
    hills.push([400, 0]);
    el("path", { d: `${pathOf(hills)} Z`, class: "w-fb-hill" }, root);
    const forest = (from, to, step, base, tall, salt) => {
      let d = "";
      for (let i = 0, x = from; x <= to; x += step, i++) {
        const h = tall * (0.62 + 0.5 * scatter(i + salt));
        const w = h * (0.32 + 0.08 * scatter(i * 3 + salt));
        const tx = x + (scatter(i * 7 + salt) - 0.5) * step;
        const y0 = base - 0.4 * scatter(i * 5 + salt);
        // a spruce: three tiers narrowing to the tip
        d += pathOf([[tx - w / 2, y0], [tx - w * 0.18, y0 + h * 0.34], [tx - w * 0.36, y0 + h * 0.3], [tx - w * 0.1, y0 + h * 0.64],
          [tx - w * 0.24, y0 + h * 0.6], [tx, y0 + h], [tx + w * 0.24, y0 + h * 0.6], [tx + w * 0.1, y0 + h * 0.64],
          [tx + w * 0.36, y0 + h * 0.3], [tx + w * 0.18, y0 + h * 0.34], [tx + w / 2, y0]]) + " Z ";
      }
      return d;
    };
    el("path", { d: forest(-70, 70, 1.6, 0.2, 9.5, 11), class: "w-fb-trees-far" }, root);
    el("path", { d: forest(-70, coreX - 1.5, 2.3, 0, 12, 41) + forest(ax1 + 1.5, 70, 2.3, 0, 12, 73), class: "w-fb-trees" }, root);

    // the ground, the forecourt before the building, the deck at the left, the path to the doors
    rect(-400, 0, 400, -200, "w-fb-ground", root);
    el("path", { d: `${pathOf([[coreX - 7, 0], [ax1 + 6, 0], [ax1 + 9, -2.2], [coreX - 10, -2.2]])} Z`, class: "w-fb-forecourt" }, root);
    const deckX1 = Math.min(x1, x0 + 7);
    el("path", { d: `${pathOf([[coreX - 4.2, groundY - 0.05], [deckX1, groundY - 0.05], [deckX1 + 0.5, -0.9], [coreX - 4.9, -0.9]])} Z`, class: "w-fb-deck" }, root);
    let seams = "";
    for (let x = coreX - 4.2 + 0.45; x < deckX1; x += 0.45) {
      const k = (x - (coreX - 4.2)) / (deckX1 - (coreX - 4.2));
      seams += `${pathOf([[x, groundY - 0.05], [x - 0.7 + k * 1.2, -0.9]])} `;
    }
    el("path", { d: seams, class: "w-fb-seam" }, root);
    el("path", { d: `${pathOf([[annex.x0 + 0.2, 0], [ax1 - 0.2, 0], [ax1 + 0.8, -2.2], [annex.x0 + 0.6, -2.2]])} Z`, class: "w-fb-path" }, root);

    // the building
    const bld = el("g", { class: "w-fb-building", "data-part": "building" }, root);
    // the plinth, and the outline that stands even when there is no department
    rect(coreX - 0.3, 0, ax1 + 0.3, groundY, "w-fb-plinth", bld);
    el("path", { d: `${pathOf([[coreX, groundY], [coreX, top], [x1, top], [x1, groundY]])}`, class: "w-fb-outline", "data-part": "outline" }, bld);

    // the stair core at the left, lit while a question is open
    const core = el("g", { class: `w-fb-core${scene.asking === true ? " is-on" : ""}` }, bld);
    rect(coreX, groundY, x0, top, "w-fb-core-wall", core);
    let stairs = "";
    for (let f = 0; f < storeys; f++) {
      const y = groundY + f * floorH;
      stairs += `${pathOf([[coreX + 0.15, y + 0.1], [x0 - 0.15, y + floorH * 0.5], [coreX + 0.15, y + floorH - 0.35]])} `;
    }
    el("path", { d: stairs, class: "w-fb-stair" }, core);

    const sceneRooms = new Map(arr(scene.rooms).filter((r) => obj(r) && ID.test(String(r.id))).map((r) => [r.id, r]));
    const planRooms = arr(plan.rooms).filter((r) => obj(r) && ID.test(String(r.id)));
    if (!planRooms.length) {
      // no department, or the board off: the dark shell of one storey, furnished with nothing
      rect(x0, groundY, x1, top - 0.3, "w-fb-room-back is-dark", bld);
      rect(x0 - 0.05, top - 0.3, x1 + 0.05, top, "w-fb-slab", bld);
    }
    planRooms.forEach((pr, index) => drawRoom(bld, pr, sceneRooms.get(pr.id) || { lamps: [] }, index, floorH));
    // a concrete pier at every room's edge (each once), and the top slab's cap
    const piers = new Set();
    for (const pr of planRooms) for (const x of [pr.x0, pr.x1]) {
      const k = `${n(x)}:${n(pr.y)}`;
      if (piers.has(k)) continue;
      piers.add(k);
      rect(fin(x) - 0.13, fin(pr.y), fin(x) + 0.13, fin(pr.y) + floorH - 0.3, "w-fb-slab", bld, { "data-part": "pier" });
    }
    const roofTo = terrace && !terrace.onRoof ? fin(terrace.x0, x1) : x1;
    rect(coreX - 0.15, top - 0.08, roofTo + 0.15, top + 0.12, "w-fb-cap", bld);

    if (terrace) drawTerrace(bld, terrace, floorH, groundY);
    drawAnnex(bld, annex, groundY, floorH);

    // path lights along the front, and the planting at the plinth
    const lights = el("g", { class: "w-fb-lights" }, root);
    for (let x = coreX - 3.5; x <= ax1 + 2; x += 3.1) {
      el("ellipse", { cx: n(x), cy: Y(-0.55), rx: 0.9, ry: 0.32, fill: SPILL, class: "w-fb-spill" }, lights);
      rect(x - 0.05, -0.55, x + 0.05, -0.15, "w-fb-post", lights);
      el("circle", { cx: n(x), cy: Y(-0.12), r: 0.08, class: "w-fb-post-light" }, lights);
    }
    let shrubs = "";
    const bush = (x, y, r) => `M${n(x - r)} ${Y(y)} a${n(r)} ${n(r * 0.8)} 0 0 1 ${n(2 * r)} 0 Z `;
    for (let i = 0, x = coreX - 0.6; x < ax1 + 0.4; x += 1.15, i++) {
      if (x > annex.x0 - 0.2 && x < ax1 + 0.2) continue;
      if (scatter(i + 5) < 0.35) continue;
      shrubs += bush(x, -0.25, 0.32 + 0.22 * scatter(i + 9)) + bush(x + 0.35, -0.3, 0.22 + 0.15 * scatter(i + 13));
    }
    if (shrubs) el("path", { d: shrubs, class: "w-fb-shrub" }, root);

    const frameBox = small
      ? null
      : { x: coreX - 2.2, y: -1.4, w: ax1 + 1.8 - (coreX - 2.2), h: peak + 1.6 };
    return { box: { x: coreX - 3, y: -1.6, w: ax1 + 2.4 - (coreX - 3), h: peak + 3 }, frameBox };
  }

  function drawRoom(parent, pr, sr, index, floorH) {
    const x0 = fin(pr.x0);
    const x1 = fin(pr.x1);
    const y = fin(pr.y);
    const h = floorH - 0.3;
    const lamps = arr(sr.lamps).filter((l) => obj(l) && typeof l.id === "string");
    const lampOfSlug = new Map(lamps.map((l) => [l.id.replace(/^agent:/, ""), LAMPS.includes(l.lamp) ? l.lamp : "off"]));
    const desks = arr(pr.desks).slice(0, MAX_DESKS);
    const lit = desks.filter((d) => LIT.has(lampOfSlug.get(d.slug))).length;
    const dim = !desks.length;
    const g = el("g", { class: `w-fb-room${dim ? " is-dim" : ""}${scene.dark ? " is-dark" : ""}`, "data-room": pr.id }, parent);
    rooms.set(pr.id, { g, x0, x1, y, h });
    anchors.set(pr.id, { x: x0 + 0.18, y: y + h - 0.2 });

    rect(x0, y, x1, y + h, "w-fb-room-back", g);
    // windows in the back wall: the dusk seen through the building
    const winY0 = y + 1.25;
    const winY1 = y + h - 0.45;
    const panes = Math.max(1, Math.round((x1 - x0 - 1.2) / 1.25));
    const pw = (x1 - x0 - 1.2) / panes;
    const win = el("g", { class: "w-fb-window" }, g);
    rect(x0 + 0.6, winY0, x1 - 0.6, winY1, "w-fb-glass", win);
    let mullions = "";
    for (let i = 1; i < panes; i++) mullions += `${pathOf([[x0 + 0.6 + i * pw, winY0], [x0 + 0.6 + i * pw, winY1]])} `;
    mullions += `${pathOf([[x0 + 0.6, winY0], [x1 - 0.6, winY0]])} ${pathOf([[x0 + 0.6, winY1], [x1 - 0.6, winY1]])}`;
    el("path", { d: mullions, class: "w-fb-mullion" }, win);
    // the warm wash of the room's lamps over the wall
    rect(x0, y, x1, y + h, "w-fb-wash", g, { fill: WASH, opacity: n(scene.dark ? 0 : desks.length ? 0.15 + 0.7 * (lit / desks.length) : 0) });
    // a shelf or a pinned board at one end, by the room's place
    if (index % 2 === 0) {
      const sx = x1 - 1.35;
      rect(sx, y + 1.55, sx + 0.95, y + 1.6, "w-fb-shelf", g);
      let books = "";
      for (let i = 0; i < 6; i++) {
        const bx = sx + 0.06 + i * 0.14;
        const bh = 0.22 + 0.12 * scatter(index * 9 + i);
        books += `${pathOf([[bx, y + 1.6], [bx, y + 1.6 + bh], [bx + 0.1, y + 1.6 + bh], [bx + 0.1, y + 1.6]])} Z `;
      }
      el("path", { d: books, class: "w-fb-books" }, g);
    } else {
      rect(x0 + 0.25, y + 1.4, x0 + 0.95, y + 2.15, "w-fb-board", g);
      rect(x0 + 0.33, y + 1.5, x0 + 0.6, y + 1.75, "w-fb-print", g);
      rect(x0 + 0.66, y + 1.82, x0 + 0.87, y + 2.05, "w-fb-print", g);
    }
    // opal globes over the room, as the world hangs them (one about every 2.6 m, at least two)
    const globes = Math.max(2, Math.round((x1 - x0) / 2.6));
    for (let i = 0; i < globes; i++) {
      const px = x0 + (i + 0.5) * (x1 - x0) / globes;
      el("path", { d: pathOf([[px, y + h], [px, y + h - 0.62]]), class: "w-fb-cord" }, g);
      el("circle", { cx: n(px), cy: Y(y + h - 0.78), r: 0.17, class: `w-fb-pendant${lit && !scene.dark ? " is-on" : ""}` }, g);
    }
    // the floor
    rect(x0, y - 0.02, x1, y + 0.05, "w-fb-floor", g);
    // the front: glass from floor to ceiling between the piers, a slim frame round it and a mullion about every
    // metre and a half
    {
      const g0 = x0 + 0.13, g1 = x1 - 0.13, bays = Math.max(2, Math.round((g1 - g0) / 1.5));
      const front = el("g", { class: "w-fb-window", "data-part": "glazing" }, g);
      rect(g0, y + 0.05, g1, y + h, "w-fb-glass", front, { opacity: 0.07 });
      let frame = `${pathOf([[g0, y + 0.07], [g1, y + 0.07], [g1, y + h - 0.04], [g0, y + h - 0.04]])} Z `;
      for (let i = 1; i < bays; i++) frame += `${pathOf([[g0 + i * (g1 - g0) / bays, y + 0.07], [g0 + i * (g1 - g0) / bays, y + h - 0.04]])} `;
      el("path", { d: frame, class: "w-fb-seam" }, front);
    }

    if (dim) {
      // furnished and dim: two empty desks
      for (const k of [1 / 3, 2 / 3]) drawDesk(g, x0 + (x1 - x0) * k, y, 1.3);
    }
    const pitch = desks.length ? (x1 - x0 - 1.4) / desks.length : 1.7;
    const deskW = Math.max(0.8, Math.min(1.3, pitch * 0.78));
    desks.forEach((d, i) => {
      const dx = fin(d.x, x0 + 1);
      const lamp = lampOfSlug.get(d.slug) || "off";
      drawDesk(g, dx, y, deskW);
      drawLamp(g, d.slug, dx - deskW / 2 + 0.18, y, lamp);
      if (i === desks.length - 1 && fin(pr.more) > 0) {
        const t = el("text", { x: n(dx + deskW / 2 - 0.05), y: Y(y + 0.98), class: "w-fb-more", "text-anchor": "end", "font-size": 0.34 }, g);
        t.appendChild(doc.createTextNode(`+${Math.floor(fin(pr.more))}`));
      }
    });

    // the slab over the room, with the shadow gap under its screed
    rect(x0 - 0.03, y + h, x1 + 0.03, y + floorH, "w-fb-slab", g);
    el("path", { d: pathOf([[x0 - 0.03, y + floorH - 0.05], [x1 + 0.03, y + floorH - 0.05]]), class: "w-fb-seam" }, g);
    // the room answers the pointer over its whole face
    const hit = rect(x0, y, x1, y + floorH, "w-fb-hit", g);
    hit.setAttribute("data-hit", pr.id);
    g.addEventListener("click", () => pick(pr.id));
    g.addEventListener("pointerenter", () => hover(pr.id));
    g.addEventListener("pointerleave", () => hover(null));
  }

  function drawDesk(g, dx, y, w) {
    // the chair behind, the top, two legs
    el("path", { d: `${pathOf([[dx + 0.05, y + 0.05], [dx + 0.05, y + 0.46], [dx + 0.42, y + 0.46], [dx + 0.42, y + 0.05]])} M${n(dx + 0.38)} ${Y(y + 0.46)} L${n(dx + 0.42)} ${Y(y + 0.95)}`, class: "w-fb-chair" }, g);
    rect(dx - w / 2, y + 0.72, dx + w / 2, y + 0.78, "w-fb-desk", g);
    el("path", { d: `${pathOf([[dx - w / 2 + 0.06, y + 0.72], [dx - w / 2 + 0.06, y + 0.04]])} ${pathOf([[dx + w / 2 - 0.06, y + 0.72], [dx + w / 2 - 0.06, y + 0.04]])}`, class: "w-fb-leg" }, g);
  }

  // A lamp glyph (D7): on, a filled warm disc with a pool; amber, a ringed disc; red, a ringed disc with a bar;
  // off, hollow; down, a short low line (the arm folded on the desk).
  function drawLamp(g, slug, bx, y, lamp) {
    const top = y + 0.78;
    const lg = el("g", { class: `w-lamp w-lamp--${lamp}`, "data-lamp": `agent:${slug}` }, g);
    if (lamp === "down") {
      el("path", { d: pathOf([[bx - 0.05, top + 0.03], [bx + 0.55, top + 0.06]]), class: "w-lamp__line" }, lg);
      anchors.set(`agent:${slug}`, { x: bx + 0.25, y: top + 0.5 });
      return;
    }
    const head = [bx + 0.36, top + 0.44];
    if (LIT.has(lamp)) el("ellipse", { cx: n(head[0] + 0.1), cy: Y(top + 0.05), rx: 1.05, ry: 0.62, fill: POOL[lamp], class: "w-lamp__pool" }, lg);
    el("path", { d: pathOf([[bx - 0.12, top], [bx + 0.12, top]]) + ` ${pathOf([[bx, top], [bx - 0.08, top + 0.5], [head[0], head[1] + 0.06]])}`, class: "w-lamp__arm" }, lg);
    el("path", { d: `${pathOf([[head[0] - 0.07, head[1] + 0.1], [head[0] + 0.07, head[1] + 0.1], [head[0] + 0.16, head[1] - 0.06], [head[0] - 0.16, head[1] - 0.06]])} Z`, class: "w-lamp__shade" }, lg);
    const cy = head[1] - 0.17;
    if (lamp === "amber" || lamp === "red") el("circle", { cx: n(head[0]), cy: Y(cy), r: 0.2, class: "w-lamp__ring" }, lg);
    el("circle", { cx: n(head[0]), cy: Y(cy), r: 0.1, class: "w-lamp__disc" }, lg);
    if (lamp === "red") rect(head[0] - 0.2, cy - 0.38, head[0] + 0.2, cy - 0.31, "w-lamp__bar", lg);
    anchors.set(`agent:${slug}`, { x: head[0], y: head[1] + 0.32 });
  }

  function drawTerrace(parent, t, floorH, groundY) {
    const y = t.onRoof ? groundY + fin(plan.building && plan.building.storeys, 1) * floorH : groundY + fin(t.floor) * floorH;
    const x0 = fin(t.x0) + 0.15;
    const x1 = fin(t.x1) - 0.1;
    const g = el("g", { class: "w-fb-terrace", "data-part": "terrace" }, parent);
    if (t.onRoof) rect(x0 - 0.15, y, x1 + 0.1, y + 0.12, "w-fb-cap", g);
    // the pavilion: a glazed box with a bench per app
    const apps = arr(scene.apps).filter((a) => obj(a) && ID.test(String(a.id))).slice(0, BENCHES);
    const pw = Math.min(3.6, Math.max(2.4, x1 - x0 - 1.4));
    const p0 = x1 - pw - 0.2;
    const ph = 2.35;
    const anyOn = apps.some((a) => a.on === true);
    rect(p0, y, p0 + pw, y + ph, `w-fb-pavilion${anyOn ? " is-on" : ""}`, g);
    if (anyOn) rect(p0, y, p0 + pw, y + ph, "w-fb-wash", g, { fill: WASH, opacity: 0.6 });
    apps.forEach((a, i) => {
      const slot = pw / Math.max(1, apps.length);
      const bx = p0 + slot * (i + 0.5);
      const bg = el("g", { class: `w-fb-bench${a.on === true ? " is-on" : ""}`, "data-app": a.id }, g);
      rect(bx - Math.min(0.42, slot * 0.38), y + 0.38, bx + Math.min(0.42, slot * 0.38), y + 0.46, "w-fb-bench-top", bg);
      el("path", { d: `${pathOf([[bx - 0.3, y + 0.38], [bx - 0.3, y + 0.02]])} ${pathOf([[bx + 0.3, y + 0.38], [bx + 0.3, y + 0.02]])}`, class: "w-fb-leg" }, bg);
      if (a.allowance === true) el("circle", { cx: n(bx), cy: Y(y + 0.75), r: 0.09, class: "w-fb-allowance" }, bg);
    });
    let mull = "";
    for (let i = 0; i <= 3; i++) mull += `${pathOf([[p0 + (pw * i) / 3, y], [p0 + (pw * i) / 3, y + ph]])} `;
    el("path", { d: mull, class: "w-fb-mullion" }, g);
    rect(p0 - 0.12, y + ph, p0 + pw + 0.12, y + ph + 0.14, "w-fb-slab", g);
    // the glass parapet and its posts, a planter at the open end
    el("path", { d: pathOf([[x0, y + 1.0], [x1, y + 1.0]]), class: "w-fb-rail" }, g);
    let posts = "";
    for (let x = x0; x <= x1 + 0.01; x += Math.max(0.6, (x1 - x0) / 6)) posts += `${pathOf([[x, y], [x, y + 1.0]])} `;
    el("path", { d: posts, class: "w-fb-post-line" }, g);
    if (p0 - x0 > 0.9) {
      rect(x0 + 0.15, y, x0 + 0.85, y + 0.4, "w-fb-planter", g);
      el("path", { d: `M${n(x0 + 0.1)} ${Y(y + 0.4)} a0.4 0.42 0 0 1 0.8 0 Z M${n(x0 + 0.3)} ${Y(y + 0.55)} a0.22 0.3 0 0 1 0.44 0 Z`, class: "w-fb-shrub" }, g);
    }
  }

  function drawAnnex(parent, annex, groundY, floorH) {
    const x0 = fin(annex.x0);
    const x1 = fin(annex.x1, x0 + 3.1);
    const g = el("g", { class: "w-fb-annex", "data-part": "annex" }, parent);
    const top = groundY + floorH - 0.3;
    rect(x0, groundY, x1, top, "w-fb-annex-wall", g);
    rect(x0 - 0.05, top, x1 + 0.15, top + 0.3, "w-fb-slab", g);
    anchors.set("doors", { x: x0 + 0.15, y: top - 0.15 }); // the doors' one tag, at the annex's top-left (T11)
    const doorState = new Map(arr(scene.doors).filter((d) => obj(d) && typeof d.id === "string").map((d) => [d.id.replace(/^door:/, ""), DOOR_STATES.includes(d.state) ? d.state : "shut"]));
    const places = new Map(arr(annex.doors).filter((d) => obj(d)).map((d) => [d.id, fin(d.x)]));
    DOORS.forEach((id, i) => {
      const state = doorState.get(id) || "shut";
      const cx = places.has(id) ? places.get(id) : x0 + 0.55 + i;
      const dg = el("g", { class: `w-door w-door--${state}`, "data-door": id }, g);
      const d0 = cx - 0.39;
      const d1 = cx + 0.39;
      const dt = groundY + 2.35;
      rect(d0 - 0.05, groundY, d1 + 0.05, dt + 0.06, "w-door__frame", dg);
      rect(d0, groundY, d1, dt, "w-door__light", dg);
      // open: the leaf swung in to a sliver at the side, the light out on the path; shut: the leaf across
      if (state === "open") {
        rect(d0, groundY, d0 + 0.08, dt, "w-door__leaf", dg);
        el("ellipse", { cx: n(cx), cy: Y(-0.6), rx: 0.75, ry: 0.5, fill: SPILL, class: "w-door__spill" }, dg);
      } else {
        rect(d0, groundY, d1, dt, "w-door__leaf", dg);
        el("circle", { cx: n(d1 - 0.12), cy: Y(groundY + 1.1), r: 0.035, class: "w-door__handle" }, dg);
      }
      // blocked: Settings would refuse to open it; a small amber mark over the door
      if (state === "blocked") el("path", { d: `${pathOf([[cx - 0.13, dt + 0.14], [cx + 0.13, dt + 0.14], [cx, dt + 0.36]])} Z`, class: "w-door__mark" }, dg);
      anchors.set(`door:${id}`, { x: d0, y: dt + 0.5 });
      if (mode === "map") {
        dg.addEventListener("click", () => pick(`door:${id}`));
        dg.addEventListener("pointerenter", () => hover(`door:${id}`));
        dg.addEventListener("pointerleave", () => hover(null));
      }
    });
  }

  // ---- the desk (Needs you): the owner's desk drawn flat, the stack, the elevation small in the window ----
  function desk(root) {
    // the room and the desk run past every edge of the stage, so the drawing fills it however it is framed (T11)
    rect(-200, -0.6, 200, 200, "w-fb-room-back w-fb-office", root);
    rect(-200, -0.6, 200, 200, "w-fb-wash", root, { fill: WASH, opacity: 0.45 });
    // the window and the studio beyond it
    const W = { x0: -4.8, x1: 4.8, y0: 3.3, y1: 8.4 };
    const clip = el("clipPath", { id: `${uid}-win` }, defs);
    rect(W.x0, W.y0, W.x1, W.y1, "", clip);
    const view = el("g", { "clip-path": `url(#${uid}-win)` }, root);
    const holder = el("g", {}, view);
    const { box } = elevation(holder, { small: true });
    const s = Math.min((W.x1 - W.x0) / box.w, (W.y1 - W.y0) / box.h) * 0.98;
    const tx = (W.x0 + W.x1) / 2 - s * (box.x + box.w / 2);
    const ty = Y(W.y0) - s * Y(box.y) - (W.y1 - W.y0 - s * box.h) * 0.15;
    holder.setAttribute("transform", `translate(${n(tx)} ${n(ty)}) scale(${n(s * 1000) / 1000})`);
    inner = { s: n(s * 1000) / 1000, tx: n(tx), ty: n(ty) };
    rect(W.x0 - 0.12, W.y0 - 0.12, W.x1 + 0.12, W.y1 + 0.12, "w-fb-sash", root, { fill: "none" });
    el("path", { d: `${pathOf([[0, W.y0], [0, W.y1]])}`, class: "w-fb-sash-line" }, root);
    rect(W.x0 - 0.35, W.y0 - 0.3, W.x1 + 0.35, W.y0 - 0.12, "w-fb-slab", root);

    // the desk's top, seen from the chair, and its front edge
    el("path", { d: `${pathOf([[-200, 2.3], [200, 2.3], [200, 0], [-200, 0]])} Z`, class: "w-fb-desk" }, root);
    rect(-200, -0.55, 200, 0, "w-fb-desk-edge", root);
    rect(-200, -200, 200, -0.55, "w-fb-desk-edge", root, { opacity: 0.85 });
    // the lamp at the left, its pool on the desk
    el("ellipse", { cx: -3.2, cy: Y(1.05), rx: 4.4, ry: 1.25, fill: POOL.on, class: "w-lamp__pool" }, root);
    el("path", { d: `${pathOf([[-6.6, 1.25], [-5.6, 1.25]])} ${pathOf([[-6.1, 1.25], [-6.5, 3.6], [-4.7, 4.1]])}`, class: "w-lamp__arm w-fb-desk-lamp" }, root);
    el("path", { d: `${pathOf([[-5.0, 4.35], [-4.4, 4.35], [-4.0, 3.75], [-5.4, 3.75]])} Z`, class: "w-lamp__shade" }, root);
    el("circle", { cx: -4.7, cy: Y(3.62), r: 0.16, class: "w-fb-bulb" }, root);
    // the stack: blank ruled sheets, at most twelve, the rest counted
    const st = obj(scene.stack) ? scene.stack : {};
    const sheets = Math.max(0, Math.min(12, Math.floor(fin(st.sheets))));
    const more = Math.max(0, Math.floor(fin(st.more)));
    const stack = el("g", { class: "w-fb-stack", "data-part": "stack", "data-sheets": sheets }, root);
    const sheet = (k, cls) => {
      const lift = k * 0.07;
      const sx = -2.2 + ((k * 37) % 5) * 0.03;
      return el("path", { d: `${pathOf([[sx - 0.15, 0.55 + lift], [sx + 2.65, 0.55 + lift], [sx + 2.35, 2.0 + lift], [sx + 0.05, 2.0 + lift]])} Z`, class: cls }, stack);
    };
    if (!sheets) el("path", { d: `${pathOf([[-2.35, 0.55], [0.45, 0.55], [0.15, 2.0], [-2.15, 2.0]])} Z`, class: "w-fb-sheet-spot" }, stack);
    for (let k = 0; k < sheets; k++) {
      rect(-2.4 + ((k * 37) % 5) * 0.03, 0.5 + k * 0.07, 0.5 + ((k * 37) % 5) * 0.03, 0.55 + k * 0.07, "w-fb-sheet-edge", stack);
      sheet(k, "w-fb-sheet");
    }
    if (sheets) {
      const lift = (sheets - 1) * 0.07;
      let rules = "";
      for (let r = 1; r <= 5; r++) {
        const yy = 0.55 + lift + r * 0.24;
        rules += `${pathOf([[-2.1 + r * 0.05, yy], [0.25 - r * 0.05, yy]])} `;
      }
      el("path", { d: rules, class: "w-fb-rule" }, stack);
    }
    if (more) {
      const t = el("text", { x: 0.95, y: Y(1.0 + sheets * 0.07), class: "w-fb-more w-fb-more--stack", "font-size": 0.6 }, stack);
      t.appendChild(doc.createTextNode(`+${more}`));
    }
    anchors.set("stack", { x: -2.2, y: 2.4 + sheets * 0.07 });
    // the tray at the right, and a small plant
    el("path", { d: `${pathOf([[3.4, 0.6], [6.4, 0.6], [6.1, 1.9], [3.7, 1.9]])} Z`, class: "w-fb-tray" }, root);
    rect(3.4, 0.45, 6.4, 0.6, "w-fb-tray-edge", root);
    rect(7.1, 0.5, 7.8, 1.25, "w-fb-planter", root);
    el("path", { d: "M6.85 -1.25 a0.6 0.75 0 0 1 1.2 0 Z M7.05 -1.6 a0.4 0.6 0 0 1 0.8 0 Z", class: "w-fb-shrub" }, root);
    return { box: { x: -7.6, y: -0.7, w: 15.2, h: 9.6 } };
  }

  const world = el("g", { class: "w-fb-world" }, svg);
  const { box, frameBox } = mode === "desk" ? desk(world) : elevation(world, { small: false });
  const whole = frameBox || box;

  let view = { k: 1, vx: 0, vy: 0, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height };

  // Frame the building (or the chosen room) inside the free rectangle of a stage of the given size.
  function frame(f = {}) {
    const width = fin(f.width) > 0 ? f.width : DEFAULT_SIZE.width;
    const height = fin(f.height) > 0 ? f.height : DEFAULT_SIZE.height;
    const s = obj(f.safe) ? f.safe : null;
    let S = { x: 0, y: 0, w: width, h: height };
    if (s && fin(s.w) >= 120 && fin(s.h) >= 120) {
      const x = Math.max(0, Math.min(width - 120, fin(s.x)));
      const y = Math.max(0, Math.min(height - 120, fin(s.y)));
      S = { x, y, w: Math.min(fin(s.w), width - x), h: Math.min(fin(s.h), height - y) };
    }
    const r = mode === "map" && typeof f.focus === "string" ? rooms.get(f.focus) : null;
    const B = r ? { x: r.x0 - 1.0, y: r.y - 0.8, w: r.x1 - r.x0 + 2.0, h: r.h + 1.8 } : whole;
    const pad = Math.min(S.w, S.h) < 360 ? 0.04 : 0.07;
    // the desk fills the free area by its height and may run under the sheet and the list beside it (T11)
    const k = Math.max(0.0001, Math.min(mode === "desk" ? (S.w / B.w) * 1.9 : S.w / B.w, S.h / B.h) * (1 - 2 * pad));
    // the box's centre lands on the free rectangle's centre
    const cx = B.x + B.w / 2;
    const cy = -(B.y + B.h / 2);
    const vx = cx - (S.x + S.w / 2) / k;
    const vy = cy - (S.y + S.h / 2) / k;
    svg.setAttribute("viewBox", `${n(vx * 100) / 100} ${n(vy * 100) / 100} ${n((width / k) * 100) / 100} ${n((height / k) * 100) / 100}`);
    view = { k, vx, vy, width, height };
    return view;
  }

  // Where an anchor sits on the stage, in pixels.
  function point(anchor) {
    const a = anchors.get(anchor);
    if (!a) return null;
    const sx = mode === "desk" ? inner.tx + inner.s * a.x : a.x;
    const sy = mode === "desk" ? inner.ty + inner.s * -a.y : -a.y;
    const x = (sx - view.vx) * view.k;
    const y = (sy - view.vy) * view.k;
    return { x, y, visible: x >= 0 && y >= 0 && x <= view.width && y <= view.height };
  }

  const mark = (g, cls, on) => {
    const now = (g.getAttribute("class") || "").split(/\s+/).filter((c) => c && c !== cls);
    if (on) now.push(cls);
    g.setAttribute("class", now.join(" "));
  };
  function setHover(id) {
    for (const [rid, r] of rooms) mark(r.g, "is-hover", rid === id);
  }
  function setFocus(id) {
    const any = typeof id === "string" && rooms.has(id);
    for (const [rid, r] of rooms) {
      mark(r.g, "is-focus", any && rid === id);
      mark(r.g, "is-away", any && rid !== id);
    }
  }

  frame();
  return { svg, frame, point, setHover, setFocus, mode };
}
