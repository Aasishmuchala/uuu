// The world (PLAN-3D D1, D3, D4, D6, D9, D21, 2.4; T6): one renderer, one canvas and one scene graph for the whole
// home screen, a module-level singleton that the Map (mode "map") and Needs you (mode "desk") acquire in turn. Changing
// page moves the same canvas into the new page's stage; the WebGL context is not rebuilt. 60 s after the last release
// every GPU resource is let go (the next visit loads again, from the browser's cache).
//
// Only stage.js reaches this module, by import(). Everything the page tells it is a SceneState (ids, enums, numbers:
// D9) or a plain number; no name, title or sentence enters, and nothing here draws text. Pictures and models come only
// from the manifest through assets.js. Frames are drawn on demand (D4): while something moves, and once after a
// change; at rest nothing is drawn and `frames` stands still.
//
// acquire(host, { mode, tier, theme, still, onProgress, onPick, onHover, onLost }) -> Promise<handle>
// handle: setScene(scene), play(events), focus(roomId|null), hover(roomId|null), setSafeRect({x,y,w,h}), setTheme(t),
//         setStill(b), project(anchorId) -> {x,y,visible}|null, onFrame(fn), frames, release().
// With worldbench=1 in the page's query: window.__world = { ready, frames, bench() -> {mean, median, p95, calls} }.
import * as THREE from "../vendor/three-0.169.0/three.module.min.js";
import { GLTFLoader } from "../vendor/three-0.169.0/jsm/GLTFLoader.js";
import { loadManifest, assetUrl, familyOf, bytesOf, entryOf, fetchBytes, fetchJson, fetchPicture } from "./assets.js";
import { decodeHDR } from "./hdr.js";
import { benchOn } from "./support.js";
import { planBuilding } from "./layout.js";
import { KEYS, ease, makeRenderer, makeDusk, makeEnvironment, makeRidges, makeTerrain, makeForest, hdrTexture, orient, lookAt, aimSun } from "./scene/dusk.js";
import { makeFloorShade } from "./scene/lamps.js";
import { makePost, halton, disc } from "./scene/post.js";
import { makeBuilding } from "./scene/building.js";
import { makeForecourt } from "./scene/forecourt.js";
import { makeDesk, DESK_AT } from "./scene/desk.js";
import { mapView, deskView, applyView, makeGlide } from "./scene/camera.js";

export const RELEASE_AFTER = 60_000;
const CAP = { desktop: 1.5, phone: 2 };
const STEPS = [1.25, 1.0];
const ID = /^[a-z][a-z0-9-]{0,40}$/;
const LAMPS = new Set(["on", "amber", "red", "off", "down"]);
const DOOR_STATES = new Set(["open", "shut", "blocked"]);
const DOORS = ["web", "generation", "higgsfield"];

// ---------- what each mode needs from the manifest ----------
const BUILDING_TEX = [
  ["wood_floor", ["diff", "nor", "rough"]], ["concrete_floor_02", ["diff", "nor", "rough"]], ["planks_brown_10", ["diff", "nor", "rough"]], ["white_plaster_02", ["diff", "nor"]],
  ["weathered_brown_planks", ["diff", "nor", "rough"]],
];
// the furniture of the Map's rooms (the small model on the desk is joinery of our own); the plant is the desktop's
const FURNITURE = ["dining_chair_02", "wooden_table_02", "sofa_02", "mid_century_lounge_chair", "modern_wooden_cabinet", "modern_ceiling_lamp_01"];
// The settled picture (REAL-1): how many frames are averaged once nothing moves, the lens's radius in metres and the
// sun's in radians. After them nothing is drawn (D4).
const SETTLE = { desktop: 32, phone: 16 };
const LENS = { map: 0.085, desk: 0.0055 };
const SUN_R = 0.022;
// While something moves the picture is drawn a little smaller and stretched (as games do); the first frame at rest
// is drawn whole again, and the settled picture is all at full size. A machine that cannot keep up at the first
// size (a Mac in Low Power Mode, a busy one) takes the second, before the pixel ratio itself steps down (D21).
const MOVING = { desktop: [0.84, 0.7], phone: [0.76, 0.66] };
const SAMPLES = { desktop: [4, 4], phone: [2, 2] }; // the scene's samples a pixel: moving, at rest
const SLOW_MS = 13; // a moving frame's work over this (the bench's own clock) is "cannot keep up"
const GROUND_TEX = [["forest_ground_04", ["diff", "nor"]], ["forrest_ground_01", ["diff"]], ["wood_floor_deck", ["diff", "nor"]]];
const PRINTS = ["hero", "materials", "visit", "interior", "trees"];
const SKY_OF = { dark: "dusk", light: "morning" }; // one sky per theme (D5, D20): only the theme's own is loaded
const skyNeeds = (theme) => [{ key: `sky.${SKY_OF[theme]}.jpg`, kind: "sky", theme }, { key: `sky.${SKY_OF[theme]}.hdr`, kind: "hdr", theme }];
function needsOf(mode, theme, tier) {
  const tex = (list) => list.flatMap(([n, maps]) => maps.map((m) => ({ key: `tex.${n}.${m}`, kind: "tex", name: `${n}_${m}`, srgb: m === "diff" })));
  const out = [...tex(BUILDING_TEX), ...PRINTS.map((n) => ({ key: `print.${n}`, kind: "print", name: n })),
    ...skyNeeds(theme), { key: "model.fern_02", kind: "model", name: "fern_02" }];
  if (mode === "map") {
    out.push(...tex(GROUND_TEX), { key: "trees.color", kind: "trees", name: "treesColor", srgb: true }, { key: "trees.normal", kind: "trees", name: "treesNormal", srgb: false },
      { key: "trees.info", kind: "json" }, ...["grass_medium_01", "modern_arm_chair_01", "modern_coffee_table_01", ...FURNITURE, ...(tier === "phone" ? [] : ["potted_plant_02"])].map((n) => ({ key: `model.${n}`, kind: "model", name: n })));
  }
  return out;
}

// ---------- the singleton ----------
let W = null;

function emptyAssets() { return { tex: {}, prints: {}, models: {}, skies: { dark: {}, light: {} }, treesColor: null, treesNormal: null, treesInfo: null, loaded: new Set(), textures: [] }; }

function createWorld(tier) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const renderer = makeRenderer(canvas);
  const cap = CAP[tier] || 1.5;
  const w = {
    canvas, renderer, tier, cap, ratio: Math.min(globalThis.devicePixelRatio || 1, cap), steps: STEPS.filter((s) => s < cap),
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(30, 1, 0.05, 5000),
    A: emptyAssets(), mode: null, dusk: null, looks: {}, lit: null, L: null, day: false, sunI: 0, fadeL: null, themeSeq: 0, ridges: null, map: null, desk: null,
    handles: new Set(), active: null, releaseTimer: 0, raf: 0, last: 0, frames: 0, ready: false, lost: false, disposed: false,
    scn: null, focus: null, hover: null, pointer: null, safe: null, still: false, theme: "dark", size: { w: 0, h: 0 },
    glide: makeGlide(), viewMode: null, fading: false, intervals: [], frameFns: new Set(), ro: null, building: null,
    moving: (MOVING[tier] || MOVING.desktop)[0], post: makePost(renderer, { phone: tier === "phone" }), settle: SETTLE[tier] || 32, acc: 0, dirty: false, lights: true, haired: false,
  };
  renderer.setPixelRatio(w.ratio);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); lose(w); }, false);
  canvas.addEventListener("pointermove", (e) => pointerMove(w, e));
  canvas.addEventListener("pointerleave", () => pointerHover(w, null));
  canvas.addEventListener("click", (e) => pointerClick(w, e));
  if (typeof ResizeObserver === "function") w.ro = new ResizeObserver(() => { reframe(w, false); invalidate(w); });
  document.addEventListener("visibilitychange", w.onVisible = () => { if (!document.hidden && w === W) { snapAll(w); invalidate(w); } });
  return w;
}

// The context went away: every page returns to its drawing, once, and the world is let go.
function lose(w) {
  if (w.lost || w.disposed) return;
  w.lost = true;
  for (const h of [...w.handles]) { try { h._lost(); } catch { /* the page is gone */ } }
  disposeWorld(w);
}

function disposeWorld(w) {
  if (w.disposed) return;
  w.disposed = true;
  if (w.raf) cancelAnimationFrame(w.raf);
  clearTimeout(w.releaseTimer);
  if (w.ro) w.ro.disconnect();
  document.removeEventListener("visibilitychange", w.onVisible);
  if (w.map) { w.map.building.dispose(); w.map.shade.dispose(); w.map.forecourt.userData.dispose(); w.map.forest.userData.dispose(); for (const m of [w.map.terrain, w.map.forest]) { m.geometry.dispose(); m.material.dispose(); } }
  if (w.desk) { w.desk.dispose(); w.desk.shade.dispose(); }
  w.post.dispose();
  if (w.dusk && w.dusk.sun.shadow.map) w.dusk.sun.shadow.map.dispose();
  if (w.ridges) w.ridges.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  if (w.dusk) { w.dusk.sky.geometry.dispose(); w.dusk.sky.material.dispose(); }
  for (const t in w.looks) w.looks[t].env.dispose();
  for (const t of w.A.textures) { t.dispose(); if (t.image && typeof t.image.close === "function") t.image.close(); }
  for (const g of Object.values(w.A.models)) g.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) if (o.material[k]) o.material[k].dispose(); o.material.dispose(); } });
  try { w.renderer.dispose(); } catch { /* gone */ }
  if (!w.lost) { try { w.renderer.forceContextLoss(); } catch { /* gone */ } }
  w.canvas.remove();
  if (W === w) W = null;
  if (globalThis.__world && globalThis.__world._w === w) delete globalThis.__world;
}

// ---------- loading ----------
// Everything a mode needs in the current theme; with `skyOnly`, only the theme's sky (a theme change, T12).
async function loadMode(w, mode, onProgress, { skyOnly = false } = {}) {
  await loadManifest();
  const where = { tier: w.tier, mode, theme: w.theme };
  const needs = skyOnly ? skyNeeds(w.theme) : needsOf(mode, w.theme, w.tier);
  const total = Math.max(1, skyOnly ? needs.reduce((s, n) => s + (entryOf(n.key, where).bytes | 0), 0) : bytesOf(where));
  let done = 0;
  const count = (key, model) => {
    done += (model ? familyOf(key, where) : [entryOf(key, where)]).reduce((s, f) => s + (f.bytes | 0), 0);
    if (typeof onProgress === "function") onProgress(Math.min(1, done / total));
  };
  const A = w.A;
  const texOf = (bmp, { srgb, repeat }) => {
    const t = new THREE.Texture(bmp);
    t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4; t.needsUpdate = true;
    A.textures.push(t);
    return t;
  };
  const gltf = new GLTFLoader();
  await Promise.all(needs.map(async (n) => {
    if (A.loaded.has(n.key)) { count(n.key, n.kind === "model"); return; }
    if (n.kind === "model") {
      const g = await gltf.loadAsync(assetUrl(n.key, where));
      A.models[n.name] = g;
    } else if (n.kind === "json") {
      A.treesInfo = await fetchJson(n.key, where);
    } else if (n.kind === "hdr") {
      const t = hdrTexture(decodeHDR(await fetchBytes(n.key, where)));
      A.skies[n.theme].hdr = t;
      A.textures.push(t);
    } else {
      const bmp = await fetchPicture(n.key, where);
      if (n.kind === "tex") A.tex[n.name] = texOf(bmp, { srgb: n.srgb, repeat: true });
      else if (n.kind === "print") A.prints[n.name] = texOf(bmp, { srgb: true, repeat: false });
      else if (n.kind === "sky") A.skies[n.theme].sky = texOf(bmp, { srgb: true, repeat: true });
      else if (n.kind === "trees") A[n.name] = texOf(bmp, { srgb: n.srgb, repeat: false });
    }
    A.loaded.add(n.key);
    count(n.key, n.kind === "model");
  }));
  if (skyOnly) return;
  if (!A.treesInfo && mode === "map") throw new Error("no trees");
  const info = A.treesInfo;
  if (mode === "map" && !(info && Number.isFinite(info.frames) && Array.isArray(info.types) && info.types.length)) throw new Error("bad trees");
}

// A plan with one room and one desk, so every shader the building uses is compiled before the first frame.
const WARM_PLAN = planBuilding([{ id: "warm", agents: ["warm"] }]);

// ---------- the light: dusk in the dark theme, morning in the light (D5, T12) ----------
// A look is a key with its photograph, its HDR, their turn and the environment prefiltered from them, made once per
// theme and kept while the world lives.
function lookOf(w, theme) {
  if (w.looks[theme]) return w.looks[theme];
  const s = w.A.skies[theme];
  if (!s || !s.sky || !s.hdr) return null;
  const key = KEYS[theme];
  const { rot, sunDir } = orient(key, s.hdr);
  const look = { theme, key, sky: s.sky, hdr: s.hdr, rot, sunDir };
  look.env = makeEnvironment(w.renderer, look, { phone: w.tier === "phone" });
  return (w.looks[theme] = look);
}
// The light part way from look a to look b; the environment, the lamps' paint and the desk's window change halfway.
function applyLook(w, a, b, f) {
  const L = lookAt(w.dusk, a, b, f);
  w.L = L; w.sunI = w.dusk.sun.intensity;
  w.renderer.toneMappingExposure = w.dusk.exp;
  const at = f < 0.5 ? a : b;
  w.scene.environment = at.env.texture;
  w.day = at.theme === "light";
  w.lights = true;
  if (w.ridges) for (const m of w.ridges.children) { m.material.uniforms.uFog.value.copy(L.fog); m.material.uniforms.uDark.value.copy(L.ridge).multiplyScalar(0.6); }
  dress(w);
}
// A building made or re-made takes the light that stands now.
function dress(w) {
  const L = w.L;
  if (!L) return;
  for (const b of [w.map && w.map.building, w.desk && w.desk.building]) if (b) { b.RL.uDay.value.set(L.dim, L.lampK, L.sunIn); b.setDay(w.day); }
  if (w.map) { w.map.building.sync(); w.map.forest.userData.setSun(w.dusk.sunDir); if (w.map.forecourt.userData.look) w.map.forecourt.userData.look(L.paths, w.day); }
  if (w.desk) { w.desk.look(L, w.day); w.desk.sync(); }
  w.lights = true;
  sunFor(w);
}
// At dusk the sun is behind the firs at the desk: only the lamp and the sky light it (e2's look, without a shadow map).
// In the morning it comes in low over the owner's shoulder, softer than outside.
function sunFor(w) {
  if (!w.dusk || !w.L) return;
  const desk = w.mode === "desk";
  w.dusk.sun.visible = !desk || w.L.deskSun > 0.001;
  w.dusk.sun.intensity = w.sunI * (desk ? w.L.deskSun : 1);
  w.lights = true;
}
// The lights for one frame. hair = null: where they stand (drawn only when something changed). Else the nth hair of
// the settled picture: the sun turned inside its disc, the lamp moved inside its shade, and the ceiling's light
// coming from another part of the ceiling, so the averaged shadows are those of wide soft sources.
const CENTRE = new THREE.Vector3(0, 5, 2), UPISH = new THREE.Vector3(0.04, 1, 0.07).normalize(), DIR = new THREE.Vector3();
function lightsFor(w, n) {
  const hair = n > 1;
  if (!hair && !w.lights && !w.haired) return;
  const desk = w.mode === "desk", b = w.building, holder = desk ? w.desk : w.map;
  const [jx, jy] = hair ? disc(halton(n, 2), halton(n, 3)) : [0, 0];
  if (desk) aimSun(w.dusk, w.renderer, DESK_AT, 1.8, 1024, jx * SUN_R, jy * SUN_R);
  else aimSun(w.dusk, w.renderer, CENTRE, 36, w.tier === "phone" ? 1024 : 2048, jx * SUN_R, jy * SUN_R);
  if (desk && w.desk) w.desk.hairLamp(hair ? disc(halton(n, 5), halton(n, 7)) : [0, 0]);
  if (b && holder && holder.shade) {
    if (hair) { const u = halton(n, 5), v = halton(n, 7) * 6.2831853, r = Math.sqrt(u) * 0.86; DIR.set(r * Math.cos(v), Math.sqrt(1 - r * r), r * Math.sin(v)); }
    else DIR.copy(UPISH);
    holder.shade.render(w.renderer, w.scene, b.root, b.RL, b.vol, DIR, hair ? 0.09 : 0.17, hair ? 0 : 0.36, hair ? halton(n, 11) : 0);
  }
  w.lights = false; w.haired = hair;
}

function buildShared(w) {
  if (w.dusk) return;
  const look = lookOf(w, w.theme);
  w.dusk = makeDusk(w.scene, look);
  w.ridges = makeRidges(w.dusk.fog);
  w.scene.add(w.ridges);
  w.lit = w.theme;
  applyLook(w, look, look, 1);
}

// The theme changed: the other sky is loaded on demand behind the progress line, then the light cross-fades in
// 400 ms (at once in still mode or a hidden tab). A failed load keeps the light that stands.
async function switchTheme(w, theme) {
  const seq = ++w.themeSeq;
  if (!w.ready || !w.dusk || w.disposed) return;
  if (w.fadeL) { applyLook(w, w.fadeL.a, w.fadeL.b, 1); w.lit = w.fadeL.b.theme; w.fadeL = null; }
  if (w.lit === theme) { invalidate(w); return; }
  let look = lookOf(w, theme);
  if (!look) {
    const h = w.active, progress = h && typeof h._opts.onProgress === "function" ? h._opts.onProgress : null;
    w.canvas.setAttribute("data-sky", "loading");
    try { await loadMode(w, w.mode, progress, { skyOnly: true }); } catch { /* the light that stands stays */ }
    w.canvas.removeAttribute("data-sky");
    if (seq !== w.themeSeq || w.disposed || w.theme !== theme) return;
    look = lookOf(w, theme);
    if (!look) return;
    if (w.fadeL) { applyLook(w, w.fadeL.a, w.fadeL.b, 1); w.lit = w.fadeL.b.theme; w.fadeL = null; }
  }
  const from = w.looks[w.lit];
  if (w.still || (typeof document !== "undefined" && document.hidden)) { applyLook(w, from, look, 1); w.lit = theme; invalidate(w); return; }
  w.fadeL = { a: from, b: look, t: 0 };
  invalidate(w);
}

function buildMap(w, plan) {
  const old = w.map;
  const group = old ? old.group : new THREE.Group();
  if (old) { old.building.dispose(); old.forecourt.userData.dispose(); old.forecourt.removeFromParent(); }
  const building = makeBuilding(w.A, plan);
  const forecourt = makeForecourt(w.A, building, plan, { phone: w.tier === "phone" });
  building.root.add(forecourt);
  group.add(building.root);
  let forest = old && old.forest;
  const foot = forecourt.userData.foot;
  // the meadow takes the light of the building that stands on it, so it is made again with it
  if (old) { old.terrain.removeFromParent(); old.terrain.geometry.dispose(); old.terrain.material.dispose(); }
  const terrain = makeTerrain(w.A, { phone: w.tier === "phone", foot });
  building.lit(terrain.material, 1);
  group.add(terrain);
  if (!forest) { forest = makeForest(w.A, { phone: w.tier === "phone", sunDir: w.dusk.sunDir }); group.add(forest); }
  if (!old) w.scene.add(group);
  w.map = { group, building, forecourt, terrain, forest, plan, planKey: JSON.stringify(plan), shade: old ? old.shade : makeFloorShade(w.tier === "phone" ? 1024 : 2048) };
  dress(w);
}

function buildDesk(w, plan) {
  const shade = w.desk ? w.desk.shade : makeFloorShade(1024);
  if (w.desk) w.desk.dispose();
  const d = makeDesk(w.A, plan, { fog: w.dusk.fog });
  w.scene.add(d.group, d.lights);
  d.planKey = JSON.stringify(plan); d.shade = shade;
  w.desk = d;
  dress(w);
}

function showMode(w, mode) {
  w.mode = mode;
  if (w.map) w.map.group.visible = mode === "map";
  if (w.desk) { w.desk.group.visible = mode === "desk"; w.desk.lights.visible = mode === "desk"; }
  w.building = mode === "map" ? (w.map && w.map.building) : (w.desk && w.desk.building);
  w.post.look.ao.uRadius.value = mode === "desk" ? 0.045 : 0.7;
  // the Map's camera stands well back: a far near plane keeps the depth fine enough to find occlusion from
  w.camera.near = mode === "desk" ? 0.05 : 2; w.camera.far = 3200;
  sunFor(w);
}

// ---------- the scene's state (ids, enums, numbers only) ----------
const fin = (v) => Number.isFinite(v);
function planOf(s) {
  const p = s && s.plan;
  const okRoom = (r) => r && ID.test(r.id) && [r.floor, r.y, r.x0, r.x1].every(fin) && Array.isArray(r.desks) && r.desks.every((d) => d && ID.test(d.slug) && fin(d.x) && fin(d.z));
  if (p && p.building && [p.building.x0, p.building.x1, p.building.storeys, p.building.floorH, p.building.groundY].every(fin) && Array.isArray(p.rooms) && p.rooms.every(okRoom)
    && p.annex && fin(p.annex.x1) && Array.isArray(p.annex.doors) && p.annex.doors.length === 3 && p.annex.doors.every((d) => fin(d.x))) return p;
  return planBuilding(Array.isArray(s && s.rooms) ? s.rooms.filter((r) => r && ID.test(r.id)).map((r) => ({ id: r.id, agents: (Array.isArray(r.lamps) ? r.lamps : []).map((l) => String(l && l.id).slice(6)) })) : []);
}

function applyScene(w, { animate = false } = {}) {
  const s = w.scn;
  if (!s) return;
  const plan = planOf(s);
  const key = JSON.stringify(plan);
  let rebuilt = false;
  if (w.mode === "map" && (!w.map || w.map.planKey !== key)) { buildMap(w, plan); rebuilt = true; }
  if (w.mode === "desk" && (!w.desk || w.desk.planKey !== key)) { buildDesk(w, plan); rebuilt = true; }
  showMode(w, w.mode);
  const b = w.building;
  const snapNow = rebuilt || !animate;
  for (const r of Array.isArray(s.rooms) ? s.rooms : []) {
    for (const l of Array.isArray(r && r.lamps) ? r.lamps : []) {
      if (!l || typeof l.id !== "string" || !l.id.startsWith("agent:")) continue;
      b.setLamp(l.id.slice(6), LAMPS.has(l.lamp) ? l.lamp : "off", { animate: !snapNow });
    }
  }
  for (const d of Array.isArray(s.doors) ? s.doors : []) {
    const id = d && typeof d.id === "string" ? d.id.replace(/^door:/, "") : "";
    if (DOORS.includes(id)) b.setDoor(id, DOOR_STATES.has(d.state) ? d.state : "shut");
  }
  b.setApps((Array.isArray(s.apps) ? s.apps : []).slice(0, 4).map((a) => ({ on: !!(a && a.on === true), allowance: !!(a && a.allowance === true) })));
  b.setDark(s.dark === true);
  b.setAsking(s.asking === true);
  if (w.mode === "desk" && w.desk) {
    const sheets = s.stack && fin(s.stack.sheets) ? s.stack.sheets : 0;
    if (w.desk.setStack(sheets, { animate: !rebuilt && w.pendingDrop > 0 && !w.still })) w.lights = true;
    w.pendingDrop = 0;
  }
  w.lights = true;
  if (rebuilt) { w.pickables = null; reframe(w, true); }
}

// ---------- the camera ----------
function sizeOf(w) {
  const host = w.canvas.parentElement;
  const r = host ? host.getBoundingClientRect() : null;
  return { w: Math.max(1, Math.round(r ? r.width : 1)), h: Math.max(1, Math.round(r ? r.height : 1)) };
}
function targetView(w) {
  if (w.mode === "desk") return deskView(DESK_AT, w.size, w.safe, w.tier, { empty: !(w.scn && w.scn.stack && w.scn.stack.sheets > 0) });
  const plan = w.map ? w.map.plan : WARM_PLAN;
  return mapView(plan, w.focus, w.size, w.safe, w.tier);
}
// Frame again: `jump` puts the camera there at once; otherwise a glide (or, in still mode, a quick cross-fade).
function reframe(w, jump, glide = false) {
  const size = sizeOf(w);
  const resized = size.w !== w.size.w || size.h !== w.size.h;
  w.size = size;
  if (resized) w.renderer.setSize(size.w, size.h, false);
  const v = targetView(w);
  if (jump || w.viewMode !== w.mode) { w.glide.jump(v); w.viewMode = w.mode; return; }
  if (!glide) { w.glide.retarget(v); return; }
  if (w.still) { fade(w, () => w.glide.jump(v)); return; }
  w.glide.go(v, w.mode === "desk" ? 900 : 650);
}
// Reduced motion: a camera move becomes 120 ms out and 120 ms in (D6).
function fade(w, change) {
  const c = w.canvas;
  c.style.transition = "opacity 120ms linear";
  c.style.opacity = "0";
  clearTimeout(w.fadeT);
  w.fadeT = setTimeout(() => { change(); draw(w); while (w.acc < w.settle) settle(w); c.style.opacity = "1"; }, 120);
}

// ---------- drawing on demand ----------
// A change asks for a whole new picture; once nothing moves, the frames of the settled picture follow, then rest.
function schedule(w) {
  if (!w || w.disposed || w.raf || !w.ready || (typeof document !== "undefined" && document.hidden)) return;
  w.raf = requestAnimationFrame((now) => tick(w, now));
}
function invalidate(w) {
  if (w) w.dirty = true;
  schedule(w);
}
function tick(w, now) {
  w.raf = 0;
  if (w.disposed) return;
  // (the settled picture comes two frames at a time, so it is done in about half a second and the page is at rest;
  // with motion off, in a few steps)
  if (!w.dirty) { for (let k = w.still ? 8 : 2; k > 0 && w.acc < w.settle; k--) settle(w); if (w.acc < w.settle) schedule(w); return; }
  w.dirty = false;
  const dt = w.last ? Math.min(100, now - w.last) : 16;
  if (w.last) stepDown(w, now - w.last);
  w.last = now;
  let moving = w.glide.step(dt);
  if (w.fadeL) {
    const F = w.fadeL;
    F.t = Math.min(1, F.t + dt / 400);
    applyLook(w, F.a, F.b, ease(F.t));
    if (F.t >= 1) { w.lit = F.b.theme; w.fadeL = null; } else moving = true;
  }
  let things = false;
  if (w.mode === "map" && w.map) things = w.map.building.update(dt);
  if (w.mode === "desk" && w.desk) things = w.desk.update(dt);
  if (things) { w.lights = true; moving = true; }
  draw(w);
  if (moving) w.dirty = true; else w.last = 0;
  // with motion off a change is one new still: a first dozen settled frames come with it, the rest follow
  if (!moving && w.still) while (w.acc < Math.min(12, w.settle)) settle(w);
  schedule(w);
}
// If the first 30 moving frames come slower than the screen can show (over 14 ms of work makes a frame miss), the
// pixel ratio steps to 1.25, then 1.0, and stays (D21). The interval between frames is what the page can see.
function stepDown(w, interval) {
  if (!w.steps.length || w.stepped) return;
  w.intervals.push(interval);
  if (w.intervals.length < 30) return;
  const sorted = w.intervals.slice().sort((a, b) => a - b);
  w.intervals = [];
  if (sorted[15] > 1000 / 60 + 4) {
    const small = (MOVING[w.tier] || MOVING.desktop)[1];
    if (w.moving > small) w.moving = small; // first the moving picture's size, then the pixel ratio
    else if (w.steps.length) { w.ratio = w.steps.shift(); w.renderer.setPixelRatio(w.ratio); w.renderer.setSize(w.size.w, w.size.h, false); }
    else w.stepped = true;
  } else w.stepped = true;
}
function draw(w) {
  if (w.disposed) return;
  const size = sizeOf(w);
  if (size.w !== w.size.w || size.h !== w.size.h) reframe(w, false);
  applyView(w.camera, w.glide.cur, w.size);
  shoot(w, 1, w.moving);
  w.acc = 1; w.small = true;
  for (const fn of w.frameFns) { try { fn(); } catch { /* a page's tag layer */ } }
}
// One more frame of the settled picture: the same view through another hair of the pixel, the lens and the lights.
function settle(w) {
  if (w.disposed) return;
  if (w.small) { w.small = false; applyView(w.camera, w.glide.cur, w.size); shoot(w, 1); return; } // the same frame, whole
  const n = ++w.acc;
  const [lx, ly] = disc(halton(n, 2), halton(n, 3)), a = LENS[w.mode] || 0;
  applyView(w.camera, w.glide.cur, w.size, { px: halton(n, 2) - 0.5, py: halton(n, 3) - 0.5, lx: lx * a, ly: ly * a });
  shoot(w, n);
  if (n >= w.settle) applyView(w.camera, w.glide.cur, w.size); // the tags and the pointer read the plain view
}
function shoot(w, n, scale = 1) {
  w.renderer.info.reset();
  lightsFor(w, n);
  w.post.setSize(Math.round(w.canvas.width * scale), Math.round(w.canvas.height * scale), (SAMPLES[w.tier] || SAMPLES.desktop)[scale < 1 ? 0 : 1]);
  w.post.render(w.scene, w.camera, n);
  w.frames++;
}
function snapAll(w) {
  if (w.map) w.map.building.snap();
  if (w.desk) w.desk.snap();
  const v = targetView(w); w.glide.jump(v);
}

// ---------- the pointer: hover and pick rooms and doors in the Map ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
function pickAt(w, e) {
  if (w.mode !== "map" || !w.map) return null;
  const b = w.canvas.getBoundingClientRect();
  ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
  ray.setFromCamera(ndc, w.camera);
  let best = null, bd = Infinity;
  const B = w.map.building;
  const test = (box, id) => { const p = ray.ray.intersectBox(box, hit); if (p) { const d = p.distanceTo(ray.ray.origin); if (d < bd) { bd = d; best = id; } } };
  for (const id in B.rooms) test(B.rooms[id].box, id);
  for (const id in B.doors) test(B.doors[id].box, `door:${id}`);
  return best;
}
function pointerHover(w, id) {
  if (w.pointer === id) return;
  w.pointer = id;
  w.canvas.style.cursor = id ? "pointer" : "";
  const h = w.active;
  if (h && typeof h._opts.onHover === "function") { try { h._opts.onHover(id); } catch { /* the page's */ } }
}
function pointerMove(w, e) { if (e.pointerType === "touch" || !w.ready) return; pointerHover(w, pickAt(w, e)); }
function pointerClick(w, e) {
  if (!w.ready) return;
  const id = pickAt(w, e);
  const h = w.active;
  if (id && h && typeof h._opts.onPick === "function") { try { h._opts.onPick(id); } catch { /* the page's */ } }
}

// ---------- events (diffWorld's, and the desk's approve and set-aside) ----------
function play(w, events) {
  if (!Array.isArray(events) || !w.building) return;
  const b = w.building;
  let lampN = 0, moved = false;
  for (const ev of events.slice(0, 200)) {
    if (!ev || typeof ev !== "object") continue;
    const anim = ev.animate === true && !w.still && !(typeof document !== "undefined" && document.hidden);
    if (ev.type === "lamp" && ID.test(ev.slug || "") && LAMPS.has(ev.to)) {
      moved = b.setLamp(ev.slug, ev.to, { animate: anim, delay: anim ? 120 * lampN : 0 }) || moved;
      if (anim) lampN++;
    } else if (ev.type === "door") {
      const id = typeof ev.id === "string" ? ev.id.replace(/^door:/, "") : "";
      if (DOORS.includes(id) && DOOR_STATES.has(ev.to)) moved = b.setDoor(id, ev.to, { animate: anim }) || moved;
    } else if (ev.type === "handoff" && w.mode === "map" && ID.test(ev.from || "") && ID.test(ev.to || "")) {
      moved = b.sendSheet(ev.from, ev.to, { still: !anim }) || moved;
    } else if (ev.type === "app" && ID.test(ev.slug || "") && b.pav) {
      const apps = (w.scn && Array.isArray(w.scn.apps) ? w.scn.apps : []).slice(0, 4);
      const k = apps.findIndex((a) => a && a.id === ev.slug);
      if (k >= 0) {
        const bench = b.pav.benches[k];
        bench.shown = true; bench.onT = ev.on === true ? 1 : 0; bench.amberT = ev.allowance === true ? 1 : 0;
        if (!anim) { bench.on = bench.onT; bench.amber = bench.amberT; }
        moved = true;
      }
    } else if (ev.type === "sheet" && fin(ev.delta)) {
      if (ev.delta > 0 && anim) w.pendingDrop = ev.delta;
    } else if (ev.type === "approve" && w.mode === "desk" && w.desk) {
      moved = w.desk.approve(typeof ev.room === "string" && ID.test(ev.room) ? ev.room : null, { still: !anim }) || moved;
    } else if (ev.type === "aside" && w.mode === "desk" && w.desk) {
      moved = w.desk.aside({ still: !anim }) || moved;
    }
  }
  if (moved) invalidate(w);
}

// ---------- the bench (2.4; only with worldbench=1) ----------
function bench(w) {
  if (!w.ready || w.disposed) return { mean: null, median: null, p95: null, calls: null };
  const gl = w.renderer.getContext(), px = new Uint8Array(4);
  const base = w.glide.cur, pos = base.pos.clone();
  const once = (i) => {
    base.pos.copy(pos).add(new THREE.Vector3(Math.sin(i * 0.05) * 0.02, 0, 0));
    applyView(w.camera, base, w.size);
    shoot(w, 1, w.moving);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  for (let i = 0; i < 20; i++) once(i);
  // the same step a slow machine takes on the page, by this bench's own clock: thirty frames, and the smaller
  // moving picture if their median is over SLOW_MS
  { const t = []; for (let i = 0; i < 30; i++) { const t0 = performance.now(); once(i); t.push(performance.now() - t0); } t.sort((a, b) => a - b);
    const small = (MOVING[w.tier] || MOVING.desktop)[1]; if (t[15] > SLOW_MS && w.moving > small) { w.moving = small; for (let i = 0; i < 10; i++) once(i); } }
  const times = [];
  for (let i = 0; i < 240; i++) { const t0 = performance.now(); once(i); times.push(performance.now() - t0); }
  base.pos.copy(pos);
  const calls = w.renderer.info.render.calls;
  draw(w); schedule(w);
  times.sort((a, b) => a - b);
  return { mean: times.reduce((a, b) => a + b, 0) / times.length, median: times[120], p95: times[228], calls, ratio: w.ratio, moving: w.moving, width: w.canvas.width, height: w.canvas.height };
}

// ---------- acquire and release ----------
export async function acquire(host, opts = {}) {
  if (!host || typeof host.appendChild !== "function") throw new Error("no host");
  const mode = opts.mode === "desk" ? "desk" : "map";
  const tier = opts.tier === "phone" ? "phone" : "desktop";
  if (W && (W.lost || W.disposed)) W = null;
  if (!W) W = createWorld(tier);
  const w = W;
  clearTimeout(w.releaseTimer);
  const handle = makeHandle(w, opts);
  w.handles.add(handle);
  w.active = handle;
  w.still = opts.still === true;
  w.theme = opts.theme === "light" ? "light" : "dark";
  host.appendChild(w.canvas);
  w.canvas.style.opacity = "";
  if (w.ro) { w.ro.disconnect(); w.ro.observe(host); }
  try {
    await loadMode(w, mode, opts.onProgress);
    if (w.disposed || !handle._alive) throw new Error("released");
    buildShared(w);
    // a world already lit in the other theme takes this page's at once (its sky was loaded above)
    if (w.lit !== w.theme && lookOf(w, w.theme)) { const from = w.looks[w.lit]; w.fadeL = null; applyLook(w, from, w.looks[w.theme], 1); w.lit = w.theme; }
    w.mode = mode;
    if (mode === "map" && !w.map) buildMap(w, w.scn ? planOf(w.scn) : WARM_PLAN);
    if (mode === "desk" && !w.desk) buildDesk(w, w.scn ? planOf(w.scn) : WARM_PLAN);
    showMode(w, mode);
    if (w.scn) applyScene(w);
    reframe(w, true);
    applyView(w.camera, w.glide.cur, w.size);
    for (const t of w.A.textures) w.renderer.initTexture(t);
    // compiled for the picture the scene is drawn into (post.js), so the first frame does not compile again
    w.post.setSize(w.canvas.width, w.canvas.height);
    w.renderer.setRenderTarget(w.post.target);
    await w.renderer.compileAsync(w.scene, w.camera);
    w.renderer.setRenderTarget(null);
    if (w.disposed || !handle._alive) throw new Error("released");
    w.ready = true;
    // the first picture is shown finished: the settled frames are drawn before the canvas fades in
    draw(w);
    while (w.acc < w.settle) settle(w);
    w.dirty = false;
    if (typeof opts.onProgress === "function") opts.onProgress(1);
  } catch (err) {
    w.handles.delete(handle);
    if (w.active === handle) w.active = null;
    if (!w.handles.size && !w.disposed) disposeWorld(w);
    throw err;
  }
  if (benchOn()) {
    globalThis.__world = { _w: w, get ready() { return w.ready && !w.disposed; }, get frames() { return w.frames; }, bench: () => bench(w) };
  }
  return handle;
}

function makeHandle(w, opts) {
  const h = {
    _opts: { onPick: opts.onPick, onHover: opts.onHover, onLost: opts.onLost, onProgress: opts.onProgress },
    _alive: true,
    _lost() { if (!h._alive) return; h._alive = false; w.handles.delete(h); if (typeof opts.onLost === "function") opts.onLost(); },
    get frames() { return w.frames; },
    setScene(scene) {
      if (!h._alive || w !== W || !scene || typeof scene !== "object") return;
      // the same state again (the pages poll): the settled picture stands, nothing is drawn
      let key = null;
      try { key = JSON.stringify(scene); } catch { key = null; }
      if (key !== null && key === w.scnKey && w.scnMode === w.mode) return;
      w.scnKey = key; w.scnMode = w.mode;
      w.scn = scene;
      applyScene(w);
      invalidate(w);
    },
    play(events) { if (h._alive && w === W) play(w, events); },
    focus(id) {
      if (!h._alive) return;
      const f = typeof id === "string" && ID.test(id) ? id : null;
      if (f === w.focus && w.focusSet) return;
      const first = !w.focusSet;
      w.focus = f; w.focusSet = true;
      if (w.map) { w.map.building.setOpen(f, w.still); }
      if (w.mode === "map") reframe(w, first, !first);
      invalidate(w);
    },
    hover(id) {
      if (!h._alive) return;
      const f = typeof id === "string" && ID.test(id) ? id : null;
      if (f === w.hover) return;
      w.hover = f;
      if (w.map && w.map.building.setHover(f, w.still)) invalidate(w);
    },
    setSafeRect(r) {
      if (!h._alive || !r || typeof r !== "object") return;
      const s = { x: +r.x || 0, y: +r.y || 0, w: +r.w || 0, h: +r.h || 0 };
      if (w.safe && ["x", "y", "w", "h"].every((k) => Math.round(w.safe[k]) === Math.round(s[k]))) return;
      w.safe = s;
      reframe(w, false);
      invalidate(w);
    },
    setTheme(t) {
      if (!h._alive || w !== W) return;
      const theme = t === "light" ? "light" : "dark";
      if (theme === w.theme && !w.fadeL && w.lit === theme) return;
      w.theme = theme;
      switchTheme(w, theme);
    },
    setStill(b) {
      if (!h._alive) return;
      const s = b === true;
      if (s === w.still) return;
      w.still = s;
      if (s) { snapAll(w); invalidate(w); }
    },
    project(anchor) {
      if (!h._alive || !w.ready || typeof anchor !== "string") return null;
      const p = anchorPoint(w, anchor);
      if (!p) return null;
      const v = p.project(w.camera);
      const x = (v.x * 0.5 + 0.5) * w.size.w, y = (-v.y * 0.5 + 0.5) * w.size.h;
      return { x, y, visible: v.z > -1 && v.z < 1 && x >= 0 && y >= 0 && x <= w.size.w && y <= w.size.h };
    },
    onFrame(fn) { if (typeof fn === "function") { w.frameFns.add(fn); h._frameFns.push(fn); } },
    _frameFns: [],
    release() {
      if (!h._alive) return;
      h._alive = false;
      w.handles.delete(h);
      for (const fn of h._frameFns) w.frameFns.delete(fn);
      if (w.active === h) w.active = null;
      if (!w.handles.size && !w.disposed) {
        if (w.raf) { cancelAnimationFrame(w.raf); w.raf = 0; w.last = 0; }
        w.releaseTimer = setTimeout(() => { if (!w.handles.size) disposeWorld(w); }, RELEASE_AFTER);
      }
    },
  };
  return h;
}

// Where an anchor stands in the world: a room's label corner, an agent's desk, a door, the stack.
function anchorPoint(w, id) {
  const b = w.building;
  if (!b) return null;
  const world = (v) => b.root.localToWorld(v.clone());
  if (id === "stack" || id === "tray") return w.mode === "desk" && w.desk ? w.desk.anchor(id) : null;
  if (id.startsWith("agent:")) { const ag = b.agents[id.slice(6)]; return ag ? world(ag.tag) : null; }
  if (id === "doors") { const a = b.annexBox; return world(new THREE.Vector3(a.min.x + 0.25, a.max.y - 0.15, a.max.z - 0.4)); } // the annex's top-left
  if (id.startsWith("door:")) { const d = b.doors[id.slice(5)]; return d ? world(new THREE.Vector3(d.x, d.box.max.y + 0.45, d.box.max.z - 0.3)) : null; }
  const rm = b.rooms[id];
  return rm ? world(rm.label) : null;
}
