// The studio building (PLAN-3D D8, T6; from the approved prototype's world.js): a cut-away model built from
// planBuilding's plan, any number of rooms from 0 to 11 on 1 to 4 floors. Every department a room open at the front,
// every agent a desk with an arm lamp that says what the agent is doing; the annex at ground right with the three
// doors; the roof terrace with App Studio's glazed pavilion, one bench per app. Static parts are merged, one draw per
// material; lamps, chairs and pendants are instanced.
//
// Nothing here knows a name or a title: the plan and the SceneState give ids, enums and numbers only (D9).
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { col, ease, rng } from "./dusk.js";
import { CARRY, NR, LAMP_COLOURS, OFF_GLOW, WARM, ZB, ZF, SHADE_DAY, lampGeos, lampRig, makeRoomLight, roomLit, shadeLit, shadeOf } from "./lamps.js";

// ---------- geometry helpers: uv in world metres, boxes, chamfered boxes, soft boxes, one merge per material ----------
export const boxUV = (S) => (p, n) => {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return [p.x / S, p.z / S];
  if (ax >= az) return [p.z / S, p.y / S];
  return [p.x / S, p.y / S];
};
const WHITE = new THREE.Color(1, 1, 1);
const Q = new THREE.Quaternion(), E = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1);
export const at = (x, y, z, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.clone().setFromEuler(E.set(rx, ry, rz)), ONE);
const I4 = new THREE.Matrix4();
export function bx(x0, x1, y0, y1, z0, z1, c, uv) {
  return { geo: new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0)), m: at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), c: c === undefined ? WHITE : col(c), uv };
}
export function rbox(w, h, d, r, seg = 4) {
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position, n = g.attributes.normal, hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
    o.subVectors(v, c);
    if (o.lengthSq() > 1e-10) { o.normalize(); p.setXYZ(i, c.x + o.x * r, c.y + o.y * r, c.z + o.z * r); n.setXYZ(i, o.x, o.y, o.z); }
  }
  return g;
}
export function cbx(x0, x1, y0, y1, z0, z1, ch, c, uv) {
  const s = new THREE.Shape();
  s.moveTo(x0 + ch, -z1 + ch); s.lineTo(x1 - ch, -z1 + ch); s.lineTo(x1 - ch, -z0 - ch); s.lineTo(x0 + ch, -z0 - ch); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0 - 2 * ch, bevelEnabled: true, bevelThickness: ch, bevelSize: ch, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0 + ch, 0); g.computeVertexNormals();
  return { geo: g, m: I4, c: c === undefined ? WHITE : col(c), uv };
}
export function merge(parts, uvFn = null) {
  let count = 0;
  const prepared = parts.map((p) => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); g.applyMatrix4(p.m); count += g.attributes.position.count; p.geo.dispose(); return [g, p.c || WHITE, p.uv || uvFn]; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), cc = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  let o = 0;
  for (const [g, c, fn] of prepared) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    const guv = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      cc[(o + i) * 3] = c.r; cc[(o + i) * 3 + 1] = c.g; cc[(o + i) * 3 + 2] = c.b;
      if (fn) { P.fromBufferAttribute(g.attributes.position, i); N.fromBufferAttribute(g.attributes.normal, i); const [u, v] = fn(P, N); uv[(o + i) * 2] = u; uv[(o + i) * 2 + 1] = v; }
      else if (guv) { uv[(o + i) * 2] = guv.getX(i); uv[(o + i) * 2 + 1] = guv.getY(i); }
    }
    o += n; g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.BufferAttribute(cc, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
// The grade: saturation, gain, contrast and a tint applied to a material's picture. Numbers only enter the shader.
export function grade(mat, sat, gain = 1, contrast = 1, tint = "#ffffff") {
  const tc = new THREE.Color(tint), prev = mat.onBeforeCompile;
  const f = (v) => Number(v).toFixed(4);
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      { float l = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, ${f(sat)});
        diffuseColor.rgb = max(vec3(0.), (vec3(.22) + (diffuseColor.rgb - vec3(.22)) * ${f(contrast)}) * ${f(gain)}) * vec3(${f(tc.r)}, ${f(tc.g)}, ${f(tc.b)}); }`);
  };
  return mat;
}
// A soft dark blot as a small data texture (no canvas, no file): the contact shade under furniture.
export function blotTexture() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // a rounded rectangle, dense at its heart and soft at its rim
    const u = Math.abs(x - S / 2 + 0.5) / (S / 2), v = Math.abs(y - S / 2 + 0.5) / (S / 2);
    const r = Math.min(1, Math.pow(Math.pow(u, 4) + Math.pow(v, 4), 0.25));
    const a = 1 - r;
    d[(y * S + x) * 4 + 3] = Math.round(255 * Math.min(1, a * 1.6) * Math.min(1, a * 1.6) * (3 - 2 * Math.min(1, a * 1.6)) * 0.5 + 255 * 0.5 * a * a);
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter;
  return t;
}

// Programs are shared between materials whose shaders are the same: the key names the shader, never the material.
export const keyed = (mat, key) => { mat.customProgramCacheKey = () => key; mat.dithering = true; return mat; };

// What gives each room its kind of work, by the department's id where it is one of the studio's own, else in turn.
const KINDS = ["longtable", "drawing", "round", "posters", "shelves", "lounge", "plants"];
const KIND_OF = { operations: "longtable", studio: "drawing", sales: "round", marketing: "posters", books: "shelves", support: "lounge", people: "plants" };
const kindOf = (id, i) => KIND_OF[id] || KINDS[i % KINDS.length];
const TIMBER = new Set(["drawing", "shelves"]);
const LAMP_SCALE = 1.35; // lamps a little larger than life, so their state reads from across the building
const DOOR_W = 0.8, DOOR_H = 2.35, SLAB = 0.3;
const BENCHES = 4;

// makeBuilding(A, plan, { small }) -> the building's root and the calls that move it.
export function makeBuilding(A, plan, { small = false } = {}) {
  const root = new THREE.Group();
  const RL = makeRoomLight();
  const owned = { geos: new Set(), mats: new Set() };
  const lit = (m, spill = 0) => roomLit(m, RL, spill);
  const cUV = boxUV(2.6);
  const B = plan.building;
  const H = B.floorH, Y0 = B.groundY;
  const yOf = (f) => Y0 + f * H;
  const storeys = Math.max(1, B.storeys | 0), topF = storeys - 1;
  const X0 = B.x0, X1 = B.x1, DX1 = plan.annex.x1;
  const ter = plan.terrace;
  const terBeside = !!(ter && !ter.onRoof);
  const T = ter || null;
  const roofY = yOf(storeys);
  const tex = A.tex;

  const concrete = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.concrete_floor_02_diff, normalMap: tex.concrete_floor_02_nor, roughnessMap: tex.concrete_floor_02_rough, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, metalness: 0, envMapIntensity: 0.8 });
  concrete.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vBW; varying vec3 vBN;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvBW = position; vBN = objectNormal;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vBW; varying vec3 vBN;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        { float vert = 1. - smoothstep(.5, .8, abs(vBN.y)); float yb = vBW.y / .15;
          float seam = smoothstep(.0, .06, abs(fract(yb) - .5) * 2. - .9); float band = fract(sin(floor(yb) * 91.7) * 4375.5);
          diffuseColor.rgb *= 1. - vert * (seam * .14 + (band - .5) * .05); }`);
  };
  keyed(lit(grade(concrete, 0.2, 1.4, 0.5), 1), "b-concrete");
  const plaster = keyed(lit(grade(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.white_plaster_02_diff, normalMap: tex.white_plaster_02_nor, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.95, envMapIntensity: 0.05 }), 0.3, 1.22, 0.5, "#e9d4bb")), "b-plaster");
  const timber = keyed(lit(grade(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughnessMap: tex.planks_brown_10_rough, roughness: 0.85, envMapIntensity: 0.05 }), 0.7, 1.1, 1.0, "#e8c7a0")), "b-timber");
  const oak = keyed(lit(grade(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.wood_floor_diff, normalMap: tex.wood_floor_nor, roughnessMap: tex.wood_floor_rough, roughness: 1, envMapIntensity: 0.05 }), 0.85, 1.05, 1.0, "#f4dcc0")), "b-oak");
  const deskOak = keyed(lit(grade(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughnessMap: tex.planks_brown_10_rough, roughness: 0.75, envMapIntensity: 0.15 }), 0.7, 1.3, 1.05, "#f1cfa6")), "b-deskoak");
  const steel = keyed(lit(new THREE.MeshStandardMaterial({ color: col("#2a2724"), roughness: 0.42, metalness: 0.55, envMapIntensity: 0.5 })), "b-plain");
  const fabric = keyed(lit(new THREE.MeshStandardMaterial({ vertexColors: true, color: col("#ffffff"), roughness: 0.95, envMapIntensity: 0.1 })), "b-plain");
  const paint = keyed(lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.1 })), "b-plain");
  const shadeM = keyed(lit(new THREE.MeshStandardMaterial({ color: col("#2f3a35"), roughness: 0.45, metalness: 0.3, envMapIntensity: 0.4 })), "b-plain");
  const paperM = keyed(lit(new THREE.MeshStandardMaterial({ color: col("#efe9de"), roughness: 0.9, envMapIntensity: 0.15 })), "b-plain");
  const glass = keyed(new THREE.MeshStandardMaterial({ color: col("#9fb2b8"), roughness: 0.06, metalness: 0, envMapIntensity: 1.2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }), "b-glass");
  const glazing = keyed(new THREE.MeshStandardMaterial({ color: col("#c9d3d2"), roughness: 0.04, metalness: 0, envMapIntensity: 1.5, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }), "b-glass");
  const blotT = blotTexture();
  const blotM = new THREE.MeshBasicMaterial({ map: blotT, color: col("#000000"), transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const m of [concrete, plaster, timber, oak, deskOak, steel, fabric, paint, shadeM, paperM, glass, glazing, blotM]) owned.mats.add(m);

  const cp = [], pp = [], tp = [], op = [], fp = [], fab = [], pnt = [], dk = [], pap = [];
  // plinth, slabs, roof: chamfered so their edges catch a line of light
  cp.push(cbx(X0 - 0.3, DX1 + 0.3, -0.2, Y0 - SLAB, -4.1, 4.3, 0.02, "#a29e98", cUV));
  cp.push(cbx(X0 - 0.2, DX1 + 0.2, Y0 - SLAB, Y0, -3.95, 4.05, 0.025, "#ece8e2", cUV));
  for (let f = 1; f <= topF; f++) cp.push(cbx(X0 - 0.2, X1 + 0.2, yOf(f) - SLAB, yOf(f), -3.95, 4.05, 0.025, "#ffffff", cUV));
  cp.push(cbx(X0 - 0.35, terBeside ? T.x0 + 0.2 : X1 + 0.35, roofY - SLAB, roofY + 0.12, -4.1, 4.25, 0.03, "#ffffff", cUV));
  if (storeys > 1) cp.push(cbx(X1 - 0.1, DX1 + 0.2, yOf(1) - SLAB, yOf(1) - SLAB + 0.36, -3.95, 4.05, 0.02, "#ffffff", cUV)); // over the doors
  else cp.push(cbx(X1, DX1 + 0.2, roofY - SLAB, roofY + 0.06, -3.95, 4.05, 0.02, "#ffffff", cUV));
  // end walls with a long window each (T11: side windows on the two end walls), back walls
  const gp = []; // every pane of glass in the building, one draw
  const endWall = (xa, xb, y, outward) => {
    const h = H - SLAB, w0 = ZB + 0.9, w1 = ZF - 1.0, s0 = y + 0.85, s1 = y + 2.45;
    cp.push(bx(xa, xb, y, s0, ZB - 0.3, ZF - 0.1, "#f2efea", cUV), bx(xa, xb, s1, y + h, ZB - 0.3, ZF - 0.1, "#f2efea", cUV));
    cp.push(bx(xa, xb, s0, s1, ZB - 0.3, w0, "#f2efea", cUV), bx(xa, xb, s0, s1, w1, ZF - 0.1, "#f2efea", cUV));
    const xm = (xa + xb) / 2, n = Math.max(2, Math.round((w1 - w0) / 1.3));
    gp.push({ geo: new THREE.PlaneGeometry(w1 - w0, s1 - s0), m: at(xm, (s0 + s1) / 2, (w0 + w1) / 2, Math.PI / 2) });
    for (let k = 0; k <= n; k++) { const z = w0 + k * (w1 - w0) / n; op.push(bx(xm - 0.03, xm + 0.03, s0, s1, z - 0.025, z + 0.025)); }
    for (const yy of [s0, s1]) op.push(bx(xm - 0.03, xm + 0.03, yy - 0.025, yy + 0.025, w0, w1));
    cp.push(bx(Math.min(xa, xb) - (outward < 0 ? 0.06 : 0), Math.max(xa, xb) + (outward > 0 ? 0.06 : 0), s0 - 0.06, s0, w0 - 0.05, w1 + 0.05, "#d9d4cc", cUV)); // the sill
  };
  for (let f = 0; f <= topF; f++) endWall(X0 - 0.2, X0, yOf(f), -1);
  cp.push(bx(DX1, DX1 + 0.2, Y0, yOf(1) - SLAB, ZB - 0.3, ZF - 0.1, "#f2efea", cUV));
  for (let f = 0; f <= topF; f++) {
    const y = yOf(f), xe = f === topF && terBeside ? T.x0 : f === 0 ? DX1 : X1;
    pp.push(bx(X0, xe, y, y + H - SLAB, ZB - 0.3, ZB, "#ffffff", cUV));
  }
  for (let f = 1; f <= topF; f++) if (!(f === topF && terBeside)) endWall(X1, X1 + 0.2, yOf(f), 1);
  pp.push(bx(X1 - 0.07, X1 + 0.07, Y0, Y0 + H - SLAB, ZB, ZF - 0.35, "#ffffff", cUV));
  // the terrace: beside the top floor's rooms behind a parapet, or on the roof
  let terY = null;
  if (T) {
    terY = terBeside ? yOf(topF) : roofY + 0.12;
    const t0 = T.x0, t1 = T.x1;
    if (terBeside) pp.push(bx(t0, t0 + 0.14, terY, terY + H - SLAB, ZB, ZF - 0.35, "#ffffff", cUV));
    cp.push(bx(t0, t1 + 0.2, terY, terY + 1.0, ZB - 0.3, ZB - 0.1, "#f2efea", cUV));
    // the side and the front: a low kerb and a glass balustrade with a steel rail, so the pavilion reads from below
    const k0 = t0 + (terBeside ? 0.14 : 0), KH = 0.28, RH = 1.0;
    cp.push(bx(t1, t1 + 0.2, terY, terY + KH, ZB - 0.3, ZF + 0.2, "#f2efea", cUV));
    cp.push(bx(k0, t1 + 0.2, terY, terY + KH, ZF, ZF + 0.2, "#f2efea", cUV));
    gp.push({ geo: new THREE.PlaneGeometry(t1 + 0.1 - k0, RH - KH), m: at((k0 + t1 + 0.1) / 2, terY + (KH + RH) / 2, ZF + 0.1) });
    gp.push({ geo: new THREE.PlaneGeometry(ZF + 0.1 - (ZB - 0.1), RH - KH), m: at(t1 + 0.1, terY + (KH + RH) / 2, (ZF + ZB) / 2, Math.PI / 2) });
    op.push(bx(k0, t1 + 0.2, terY + RH - 0.04, terY + RH, ZF + 0.06, ZF + 0.14), bx(t1 + 0.06, t1 + 0.14, terY + RH - 0.04, terY + RH, ZB - 0.1, ZF + 0.14));
    for (let x = k0 + 0.05; x < t1 + 0.15; x += 1.2) op.push(bx(x - 0.02, x + 0.02, terY + KH, terY + RH, ZF + 0.08, ZF + 0.12));
  }
  // partitions, stopped short of the cut so their thickness reads; slim steel columns at the cut, at every room edge
  // between two rooms a doorway near the back, with a dark frame on both faces (T11)
  const DW0 = ZB + 0.5, DW1 = ZB + 1.45, DH = 2.15;
  const withDoorway = (list, xa, xb, y, c, uv) => {
    list.push(bx(xa, xb, y, y + H - SLAB, ZB, DW0, c, uv), bx(xa, xb, y, y + H - SLAB, DW1, ZF - 0.35, c, uv), bx(xa, xb, y + DH, y + H - SLAB, DW0, DW1, c, uv));
  };
  const cols = new Set(), walls = new Set();
  for (const r of plan.rooms) {
    for (const x of [r.x0, r.x1]) {
      const y = yOf(r.floor);
      cols.add(`${r.floor}:${x}`);
      if (walls.has(`${r.floor}:${x}`)) continue;
      walls.add(`${r.floor}:${x}`);
      if (x > X0 + 0.01 && x < X1 - 0.01 && !(terBeside && r.floor === topF && Math.abs(x - T.x0) < 0.01)) {
        withDoorway(pp, x - 0.07, x + 0.07, y, "#ffffff", cUV);
        for (const z of [DW0 - 0.03, DW1 + 0.03]) pnt.push(bx(x - 0.1, x + 0.1, y, y + DH + 0.05, z - 0.04, z + 0.04, "#3b322b"));
        pnt.push(bx(x - 0.1, x + 0.1, y + DH, y + DH + 0.07, DW0 - 0.07, DW1 + 0.07, "#3b322b"));
      }
    }
  }
  for (const k of cols) { const [f, xs] = k.split(":"); const x = Math.min(X1 + 0.1, Math.max(X0 - 0.1, +xs)); const y = yOf(+f); op.push(bx(x - 0.07, x + 0.07, y, y + H - SLAB, ZF - 0.25, ZF - 0.11)); }
  // the annex: a closed front with three tall doors
  const DXs = plan.annex.doors.map((d) => d.x);
  {
    const z0 = ZF - 0.3, z1 = ZF - 0.1, top = yOf(1) - SLAB;
    cp.push(bx(X1 + 0.07, DXs[0] - DOOR_W / 2, Y0, top, z0, z1, "#f2efea", cUV));
    for (let i = 0; i < DXs.length - 1; i++) cp.push(bx(DXs[i] + DOOR_W / 2, DXs[i + 1] - DOOR_W / 2, Y0, top, z0, z1, "#f2efea", cUV));
    cp.push(bx(DXs[DXs.length - 1] + DOOR_W / 2, DX1, Y0, top, z0, z1, "#f2efea", cUV));
    cp.push(bx(X1 + 0.07, DX1, Y0 + DOOR_H, top, z0, z1, "#f2efea", cUV));
  }
  // an empty company: the shell stands, one dark hall
  if (plan.empty) fp.push(bx(X0 + 0.07, X1 - 0.07, Y0, Y0 + 0.025, ZB, ZF - 0.05, "#ffffff", (p) => [p.x / 1.6, p.z / 1.6]));

  // ---- rooms: floors, walls in plaster or timber, a ceiling line with pendants, desks, and each kind's things ----
  const rooms = {}, agents = {}, pendants = [];
  const prints = [];
  const print = (n, x, y, z, w, h, rx = 0) => { prints.push({ n, x, y, z, w, h, rx }); if (!rx) pnt.push(bx(x - w / 2 - 0.03, x + w / 2 + 0.03, y - h / 2 - 0.03, y + h / 2 + 0.03, z - 0.02, z + 0.005, "#f4f1ea")); };
  // contact shade: a soft dark blot on the floor under each thing that stands on it (no shadow maps: D21)
  const blots = [];
  const blot = (x, y, z, w, d, ry = 0) => blots.push([x, y, z, w, d, ry]);
  const chairAt = (x, y, z, ry) => { // a plain oak chair, static
    blot(x, y, z, 0.75, 0.72, ry);
    const m = (lx, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    for (const [lx, lz, h] of [[-0.19, 0.18, 0.45], [0.19, 0.18, 0.45], [-0.19, -0.18, 0.85], [0.19, -0.18, 0.85]]) { const [px, pz] = m(lx, lz); dk.push({ geo: new THREE.BoxGeometry(0.035, h, 0.035), m: at(px, y + h / 2, pz, ry), c: WHITE, uv: boxUV(1.2) }); }
    dk.push({ geo: new THREE.BoxGeometry(0.44, 0.04, 0.42), m: at(x, y + 0.46, z, ry), c: WHITE, uv: boxUV(1.2) });
    const [bx2, bz2] = m(0, -0.19); dk.push({ geo: new THREE.BoxGeometry(0.42, 0.12, 0.03), m: at(bx2, y + 0.76, bz2, ry), c: WHITE, uv: boxUV(1.2) });
  };
  const fernSpots = [], chairSpots = [], coffeeSpots = [];
  const pot = (x, y, z, s = 1) => { blot(x, y, z, 0.75 * s, 0.75 * s); pnt.push({ geo: new THREE.CylinderGeometry(0.2 * s, 0.16 * s, 0.42 * s, 20), m: at(x, y + 0.21 * s, z), c: col("#cfc6ba") }); fernSpots.push([x, y + 0.38 * s, z, 1.1 * s]); };
  const table = (x0, x1, y, z0, z1) => { blot((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0 + 0.5, z1 - z0 + 0.5); dk.push(bx(x0, x1, y + 0.72, y + 0.76, z0, z1, "#ffffff", boxUV(1.2))); for (const lx of [x0 + 0.1, x1 - 0.1]) op.push(bx(lx - 0.03, lx + 0.03, y, y + 0.72, z0 + 0.1, z1 - 0.1)); };
  const roundTable = (x, y, z, r, n) => {
    blot(x, y, z, 2 * r + 0.5, 2 * r + 0.5);
    dk.push({ geo: new THREE.CylinderGeometry(r, r, 0.045, 40), m: at(x, y + 0.74, z), c: WHITE, uv: boxUV(1.2) });
    op.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, 0.72, 10), m: at(x, y + 0.36, z), c: WHITE });
    op.push({ geo: new THREE.CylinderGeometry(0.32, 0.34, 0.03, 24), m: at(x, y + 0.015, z), c: WHITE });
    for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n + 0.4; chairAt(x + Math.sin(a) * (r + 0.33), y, z + Math.cos(a) * (r + 0.33), a + Math.PI); }
  };
  const bw = ZB + 0.04;
  const furnish = (kind, r, y) => {
    const x0 = r.x0, x1 = r.x1, w = x1 - x0, cx = (x0 + x1) / 2;
    if (kind === "longtable") {
      // the wall board: a dark felt board with cards pinned in columns; the long shared table with its chairs
      const bwid = Math.min(4, w - 1.6), b0 = cx - bwid / 2, nc = Math.max(1, Math.floor(bwid / 0.64));
      pnt.push(bx(b0, b0 + bwid, y + 1.05, y + 2.45, bw, bw + 0.03, "#2f3a36"));
      const rc = rng(5);
      for (let c = 0; c < nc; c++) for (let k = 0; k < 4; k++) if (rc() > 0.2) pnt.push(bx(b0 + 0.15 + c * 0.64, b0 + 0.15 + c * 0.64 + 0.42, y + 2.25 - k * 0.32 - 0.22, y + 2.25 - k * 0.32, bw + 0.03, bw + 0.035, ["#f4efe4", "#f2d79a", "#e9b5a1", "#cfe0d3"][Math.floor(rc() * 4)]));
      const L = Math.min(5, w - 2.2), t0 = cx - L / 2 + 0.4;
      if (L > 1.2) {
        blot(t0 + L / 2, y, 1.75, L + 0.5, 1.5);
        dk.push(bx(t0, t0 + L, y + 0.72, y + 0.77, 1.25, 2.25, "#ffffff", boxUV(1.2)));
        for (const lx of [t0 + 0.2, t0 + L - 0.2]) op.push(bx(lx - 0.03, lx + 0.03, y, y + 0.72, 1.35, 2.15));
        const n = Math.max(1, Math.floor(L / 1.2));
        for (let k = 0; k < n; k++) { const px = t0 + (k + 0.5) * L / n; chairAt(px, y, 1.0, 0); chairAt(px, y, 2.5, Math.PI); }
      }
      pot(x0 + 0.5, y, 2.6, 1.15);
    } else if (kind === "drawing") {
      const np = Math.max(1, Math.min(3, Math.floor((w - 1) / 1.55)));
      ["hero", "materials", "visit"].slice(0, np).forEach((n, i) => print(n, cx + (i - (np - 1) / 2) * 1.55, y + 1.75, bw, 1.25, 1.12));
      // a drawing board on a trestle, tilted towards the room; the model table with a white study model
      const bx0 = x0 + 1.3, bz0 = 1.4;
      blot(bx0, y, bz0, 1.7, 1.2);
      for (const sd of [-1, 1]) op.push({ geo: new THREE.BoxGeometry(0.04, 0.95, 0.04), m: at(bx0 + sd * 0.6, y + 0.47, bz0, 0, 0.12), c: WHITE });
      dk.push({ geo: new THREE.BoxGeometry(1.4, 0.035, 0.95), m: at(bx0, y + 1.0, bz0 + 0.05, 0, 0.42), c: col("#f6f1e8"), uv: boxUV(1.2) });
      pap.push({ geo: new THREE.BoxGeometry(0.84, 0.004, 0.6), m: at(bx0 - 0.1, y + 1.03, bz0 + 0.05, 0, 0.42) });
      chairAt(bx0, y, bz0 + 0.85, Math.PI);
      if (w > 4.6) {
        const m1 = x1 - 0.5, m0 = Math.max(bx0 + 1.0, m1 - 2.2), mc = (m0 + m1) / 2;
        table(m0, m1, y, 1.0, 2.0);
        pnt.push(bx(mc - 0.55, mc + 0.55, y + 0.76, y + 0.78, 1.25, 1.8, "#d8d2c8")); pnt.push(bx(mc - 0.4, mc + 0.4, y + 0.78, y + 0.93, 1.35, 1.65, "#f7f4ee"));
        pnt.push(bx(mc - 0.3, mc + 0.5, y + 0.93, y + 1.08, 1.3, 1.62, "#f7f4ee")); pnt.push(bx(mc - 0.35, mc + 0.55, y + 1.08, y + 1.1, 1.28, 1.7, "#ffffff"));
      }
      pot(x1 - 0.5, y, -3.0, 1);
    } else if (kind === "round") {
      roundTable(cx - Math.min(0.6, w * 0.1), y, 1.4, 0.62, 4);
      print("visit", cx, y + 1.8, bw, 1.0, 0.9);
      pot(x1 - 0.5, y, -3.0, 0.9);
    } else if (kind === "posters") {
      const np = Math.max(1, Math.min(4, Math.floor((w - 0.8) / 1.0)));
      ["interior", "trees", "hero", "materials"].slice(0, np).forEach((n, i) => print(n, cx + (i - (np - 1) / 2) * 1.0, y + 1.9, bw, 0.8, 1.1));
      // an easel with the next poster, a worktable
      const ex = x1 - 1.1;
      blot(ex, y, 1.7, 1.0, 0.8);
      for (const sd of [-1, 1]) op.push({ geo: new THREE.BoxGeometry(0.035, 1.7, 0.035), m: at(ex + sd * 0.32, y + 0.85, 1.7, 0, -0.12, sd * 0.12), c: WHITE });
      print("visit", ex, y + 1.15, 1.62, 0.7, 0.62, -0.12);
      if (w > 4.6) { const t0 = x0 + 0.6, t1 = Math.min(t0 + 1.7, ex - 0.8); table(t0, t1, y, 1.3, 2.1); chairAt((t0 + t1) / 2, y, 2.55, Math.PI); }
    } else if (kind === "shelves") {
      // shelves along the back wall, full of ledgers and binders
      const rc = rng(9), s1 = x1 - 0.4, s0 = Math.max(x0 + 0.4, s1 - 2.25);
      blot((s0 + s1) / 2, y, ZB + 0.25, s1 - s0 + 0.5, 0.75);
      for (let k = 0; k < 5; k++) dk.push(bx(s0, s1, y + 0.3 + k * 0.5, y + 0.33 + k * 0.5, ZB + 0.03, ZB + 0.4, "#ffffff", boxUV(1.2)));
      for (const sx of [s0, s1]) dk.push(bx(sx - 0.02, sx + 0.02, y, y + 2.4, ZB + 0.03, ZB + 0.4, "#ffffff", boxUV(1.2)));
      for (let k = 0; k < 4; k++) { let x = s0 + 0.06; while (x < s1 - 0.1) { const t = 0.05 + rc() * 0.05, h = 0.3 + rc() * 0.12; if (rc() > 0.08) pnt.push(bx(x, x + t, y + 0.33 + k * 0.5, y + 0.33 + k * 0.5 + h, ZB + 0.07, ZB + 0.36, ["#6b2f24", "#2f4a3a", "#2a3550", "#b28a52", "#efe8da", "#4a4038"][Math.floor(rc() * 6)])); x += t + 0.006; } }
      const t0 = x0 + 0.7, t1 = Math.min(t0 + 1.4, x1 - 0.6);
      table(t0, t1, y, 1.3, 2.1);
      pap.push({ geo: new THREE.BoxGeometry(0.45, 0.05, 0.32), m: at(t0 + 0.6, y + 0.785, 1.7, 0.1) }); pnt.push({ geo: new THREE.BoxGeometry(0.3, 0.05, 0.42), m: at(t0 + 1.0, y + 0.79, 1.6, -0.3), c: col("#6b2f24") });
    } else if (kind === "lounge") {
      // a sofa corner with a low table and a rug
      const S = (cx2, cy, cz, w2, h, d, rr, ry = 0, c = "#cfc7bb") => (cy < 0.3 && blot(cx2, y, cz, w2 + 0.45, d + 0.45, ry), fab.push({ geo: rbox(w2, h, d, rr), m: at(cx2, y + cy, cz, ry), c: col(c), uv: boxUV(0.4) }));
      const sw = Math.min(2.6, w - 2.2), sx = x0 + 0.5 + 0.45 + sw / 2 + 0.1;
      pnt.push(bx(x0 + 0.4, Math.min(x1 - 0.4, x0 + 4.1), y + 0.025, y + 0.035, 0.4, 2.9, "#7b6a58"));
      S(sx, 0.25, 1.05, sw, 0.22, 0.9, 0.05); S(sx, 0.62, 0.66, sw, 0.45, 0.22, 0.07);
      const nc = Math.max(1, Math.round(sw / 0.85)); for (let k = 0; k < nc; k++) S(sx - sw / 2 + (k + 0.5) * sw / nc, 0.42, 1.15, sw / nc - 0.03, 0.14, 0.7, 0.06);
      S(x0 + 0.95, 0.25, 2.2, 0.9, 0.22, 1.6, 0.05); S(x0 + 0.58, 0.62, 2.2, 0.22, 0.45, 1.6, 0.07); S(x0 + 0.95, 0.42, 2.2, 0.7, 0.14, 1.4, 0.06);
      coffeeSpots.push([sx + 0.2, y, 2.15, 0]);
      pot(x1 - 0.6, y, 0.4, 1);
      print("trees", cx - 0.4, y + 1.85, bw, 1.4, 0.8);
    } else {
      // a round table and plants
      roundTable(cx - 0.3, y, 1.5, 0.55, 3);
      pot(x0 + 0.5, y, -3.0, 1.2); pot(x0 + 0.6, y, 2.8, 0.9); pot(x1 - 0.5, y, 2.5, 1.0);
      chairSpots.push([x0 + 0.8, y, 0.2, 0.9]);
    }
  };

  plan.rooms.forEach((r, ri) => {
    const y = r.y, cx = (r.x0 + r.x1) / 2, w = r.x1 - r.x0, kind = kindOf(r.id, ri), walls = TIMBER.has(kind) ? "timber" : "plaster";
    fp.push(bx(r.x0 + 0.07, r.x1 - 0.07, y, y + 0.025, ZB, ZF - 0.05, "#ffffff", (p) => [p.x / 1.6, p.z / 1.6]));
    (walls === "timber" ? tp : pp).push(bx(r.x0 + 0.07, r.x1 - 0.07, y, y + H - SLAB, ZB, ZB + 0.03, "#ffffff", walls === "timber" ? (p) => [p.y / 2.2, p.x / 2.2] : cUV));
    const inner = (x) => x > X0 + 0.01 && x < X1 - 0.01 && !(terBeside && r.floor === topF && Math.abs(x - T.x0) < 0.01); // a partition with a doorway
    if (walls === "timber") {
      const tuv = (p) => [p.y / 2.2, p.z / 2.2];
      for (const [xa, xb, x] of [[r.x0 + 0.07, r.x0 + 0.1, r.x0], [r.x1 - 0.1, r.x1 - 0.07, r.x1]]) {
        if (inner(x)) withDoorway(tp, xa, xb, y, "#ffffff", tuv); else tp.push(bx(xa, xb, y, y + H - SLAB, ZB, ZF - 0.35, "#ffffff", tuv));
      }
    }
    // skirting: a dark timber line along the back wall and both ends, broken at a doorway
    const SK = "#46392f", e0 = r.x0 + (walls === "timber" ? 0.1 : 0.07), e1 = r.x1 - (walls === "timber" ? 0.1 : 0.07);
    pnt.push(bx(e0, e1, y + 0.02, y + 0.13, ZB + 0.03, ZB + 0.055, SK));
    for (const [xa, xb, x] of [[e0, e0 + 0.025, r.x0], [e1 - 0.025, e1, r.x1]]) {
      if (inner(x)) pnt.push(bx(xa, xb, y + 0.02, y + 0.13, ZB + 0.03, DW0 - 0.07, SK), bx(xa, xb, y + 0.02, y + 0.13, DW1 + 0.07, ZF - 0.4, SK));
      else pnt.push(bx(xa, xb, y + 0.02, y + 0.13, ZB + 0.03, ZF - 0.4, SK));
    }
    // the front's glazing: mullioned sliding panes parked at both ends of the cut, so the room still reads (T11)
    {
      const pw = Math.min(0.95, (r.x1 - r.x0) * 0.15), top = y + H - SLAB - 0.14, g0 = y + 0.04;
      for (const [side, xe] of [[1, r.x0 + 0.1], [-1, r.x1 - 0.1]]) {
        for (let k = 0; k < 1; k++) {
          const xa = xe + side * k * pw * 0.82, xb = xa + side * pw, z = ZF - 0.22 + k * 0.06;
          const x0p = Math.min(xa, xb), x1p = Math.max(xa, xb), xm = (x0p + x1p) / 2;
          gp.push({ geo: new THREE.PlaneGeometry(x1p - x0p, top - g0), m: at(xm, (g0 + top) / 2, z) });
          op.push(bx(x0p, x0p + 0.035, g0, top, z - 0.015, z + 0.015), bx(x1p - 0.035, x1p, g0, top, z - 0.015, z + 0.015));
          op.push(bx(x0p, x1p, g0, g0 + 0.06, z - 0.015, z + 0.015), bx(x0p, x1p, top - 0.035, top, z - 0.015, z + 0.015));
        }
      }
      op.push(bx(r.x0 + 0.07, r.x1 - 0.07, top, top + 0.06, ZF - 0.27, ZF - 0.1)); // the head track
      op.push(bx(r.x0 + 0.07, r.x1 - 0.07, y + 0.025, y + 0.04, ZF - 0.27, ZF - 0.1)); // the floor track
    }
    // a ceiling line: a shallow bulkhead along the front, and pendants over the room
    const ceil = y + H - SLAB;
    pp.push(bx(r.x0 + 0.07, r.x1 - 0.07, ceil - 0.12, ceil, ZF - 0.7, ZF - 0.35, "#ffffff", cUV));
    const nP = Math.max(2, Math.round(w / 2.6));
    for (let i = 0; i < nP; i++) { const px = r.x0 + (i + 0.5) * w / nP; op.push(bx(px - 0.004, px + 0.004, ceil - 0.75, ceil, 0.9 - 0.004, 0.9 + 0.004)); pendants.push({ room: r.id, x: px, y: ceil - 0.82, z: 0.9 }); }
    const room = { id: r.id, ri, y, cx, w, agents: [], hover: 0, open: 0, hoverT: 0, openT: 0, flash: 0, dim: false,
      label: new THREE.Vector3(r.x0 + 0.3, ceil - 0.25, ZF - 0.1), centre: new THREE.Vector3(cx, y + 1.3, 0), x0: r.x0, x1: r.x1, floor: r.floor,
      box: new THREE.Box3(new THREE.Vector3(r.x0, y, ZB), new THREE.Vector3(r.x1, ceil, ZF + 0.4)) };
    rooms[r.id] = room;
    r.desks.forEach((d, i) => {
      const dx = d.x, dz = d.z, dy = y + 0.025;
      blot(dx, y, dz, 1.95, 1.15); blot(dx + 0.1, y, dz - 0.85, 0.75, 0.75);
      dk.push(bx(dx - 0.75, dx + 0.75, dy + 0.71, dy + 0.75, dz - 0.4, dz + 0.4, "#ffffff", boxUV(1.2)));
      for (const sd of [-1, 1]) op.push(bx(dx + sd * 0.68 - 0.02, dx + sd * 0.68 + 0.02, dy, dy + 0.71, dz - 0.36, dz + 0.36));
      pap.push({ geo: new THREE.BoxGeometry(0.3, 0.006, 0.42), m: at(dx + 0.2, dy + 0.755, dz + 0.08, 0.14 + i * 0.3) });
      pap.push({ geo: new THREE.BoxGeometry(0.3, 0.006, 0.42), m: at(dx + 0.24, dy + 0.761, dz + 0.05, -0.06 + i * 0.2) });
      dk.push(bx(dx + 0.32, dx + 0.64, dy + 0.75, dy + 0.8, dz + 0.33, dz + 0.39, "#c9a27a", boxUV(1.2))); // name plate, blank
      const ag = { slug: d.slug, i: Object.keys(agents).length, room, light: 0, target: 0, lightFrom: 0, colourKind: "off", fold: 0, foldTarget: 0, foldFrom: 0, t: 1, wait: 0, boost: 0,
        desk: new THREE.Vector3(dx, dy + 0.78, dz), chair: { x: dx + 0.1, y: dy, z: dz - 0.85, ry: i % 2 ? 0.18 : -0.14 },
        tag: new THREE.Vector3(dx + 0.3, dy + 1.25, dz + 0.3), lampAt: new THREE.Vector3(dx - 0.58, dy + 0.75, dz - 0.22) };
      agents[d.slug] = ag; room.agents.push(ag);
    });
    furnish(kind, r, y);
  });
  // planters on the terrace
  if (T) { const tw = T.x1 - T.x0; for (const [fx, z] of [[0.2, -2.6], [0.8, -2.6], [0.85, 2.6], [0.15, 2.9]]) pot(T.x0 + 0.5 + fx * (tw - 1), terY, z, 1.1); }

  // ---- the pavilion: App Studio on the terrace, glazed, one bench per app ----
  let pav = null;
  if (T) {
    const p0 = T.x0 + 0.55, p1 = Math.min(T.x1 - 0.45, p0 + 4.4), pz0 = -2.2, pz1 = 1.7, ph = 2.5, y = terY;
    cp.push(bx(p0 - 0.1, p1 + 0.1, y + ph, y + ph + 0.14, pz0 - 0.1, pz1 + 0.1, "#f2efea", cUV));
    for (const [x, z] of [[p0, pz0], [p1, pz0], [p0, pz1], [p1, pz1]]) op.push(bx(x - 0.04, x + 0.04, y, y + ph, z - 0.04, z + 0.04));
    for (let k = 1; k < 4; k++) { const x = p0 + k * (p1 - p0) / 4; op.push(bx(x - 0.02, x + 0.02, y, y + ph, pz1 - 0.02, pz1 + 0.02)); }
    fp.push(bx(p0, p1, y, y + 0.03, pz0, pz1, "#ffffff", (p) => [p.x / 1.6, p.z / 1.6]));
    const gl = [new THREE.PlaneGeometry(p1 - p0, ph), new THREE.PlaneGeometry(pz1 - pz0, ph)];
    const panes = new THREE.Group();
    const front = new THREE.Mesh(gl[0], glass); front.position.set((p0 + p1) / 2, y + ph / 2, pz1); panes.add(front);
    const back = new THREE.Mesh(gl[0], glass); back.position.set((p0 + p1) / 2, y + ph / 2, pz0); panes.add(back);
    for (const x of [p0, p1]) { const s = new THREE.Mesh(gl[1], glass); s.position.set(x, y + ph / 2, (pz0 + pz1) / 2); s.rotation.y = Math.PI / 2; panes.add(s); }
    panes.renderOrder = 2;
    root.add(panes);
    const benches = [];
    const bwid = (p1 - p0 - 0.4) / BENCHES;
    for (let k = 0; k < BENCHES; k++) {
      const x = p0 + 0.2 + (k + 0.5) * bwid;
      benches.push({ x, y: y + 0.03, z: -0.6, on: 0, onT: 0, amber: 0, amberT: 0, shown: false });
    }
    pav = { x0: p0, x1: p1, y, h: ph, benches, bwid, centre: new THREE.Vector3((p0 + p1) / 2, y + 1.2, -0.2) };
  }
  // the stair core: a slim lit slot at the front of the left end, warm while the company brain is asked something
  const coreM = new THREE.MeshBasicMaterial({ color: OFF_GLOW });
  owned.mats.add(coreM);
  { const g = new THREE.BoxGeometry(0.12, roofY - SLAB - Y0 - 0.2, 0.06); const core = new THREE.Mesh(g, coreM); core.position.set(X0 - 0.1, (Y0 + roofY - SLAB) / 2, ZF - 0.06); root.add(core); }

  // merge the static parts, one draw per material
  const add = (parts, mat) => { if (!parts.length) return null; const m = new THREE.Mesh(merge(parts), mat); root.add(m); return m; };
  add(cp, concrete); add(pp, plaster); add(tp, timber); add(fp, oak); add(op, steel); add(dk, deskOak); add(fab, fabric); add(pnt, paint); add(pap, paperM);
  // the glazing: plain alpha with the sky's reflection, no transmission (D21); drawn after the rooms behind it
  { const gm = add(gp, glazing); if (gm) gm.renderOrder = 2; }
  // the contact shade, one instanced draw: a blot just over the floor under every desk, chair, table and pot
  if (blots.length) {
    const bm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), blotM, blots.length);
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
    blots.forEach(([x, y, z, w, d, ry], i) => bm.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.029, z), q.setFromEuler(e.set(-Math.PI / 2, ry, 0, "YXZ")), s.set(w, d, 1))));
    bm.renderOrder = 1;
    root.add(bm);
  }
  const printMats = {};
  const printMat = (n) => printMats[n] || (printMats[n] = keyed(lit(new THREE.MeshStandardMaterial({ map: A.prints[n], roughness: 0.7, envMapIntensity: 0.15 })), "b-print"));
  for (const p of prints) { if (!A.prints[p.n]) continue; const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), printMat(p.n)); m.position.set(p.x, p.y, p.z + 0.008); if (p.rx) m.rotation.x = p.rx; root.add(m); }
  for (const m of Object.values(printMats)) owned.mats.add(m);

  // furniture models, instanced: ferns in the pots; lounge chairs and the coffee table where the set has them
  const modelMat = (src, env, spill = 0) => { const m = src.clone(); m.envMapIntensity = env; owned.mats.add(m); return keyed(lit(m, spill), `b-model${spill}`); };
  const instanceNodes = (gltf, spots, tint, env, seed) => {
    if (!gltf || !spots.length) return;
    const nodes = []; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse((o) => { if (o.isMesh) nodes.push(o); });
    const by = nodes.map(() => []);
    const r2 = rng(seed);
    spots.forEach(([x, y, z, s], i) => by[i % nodes.length].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r2() * 6.28, 0)), new THREE.Vector3(s, s, s))));
    nodes.forEach((n, k) => {
      if (!by[k].length) return;
      const mat = modelMat(n.material, env); mat.color.copy(tint); mat.side = THREE.DoubleSide;
      const im = new THREE.InstancedMesh(n.geometry, mat, by[k].length);
      const local = n.matrixWorld.clone().setPosition(0, 0, 0);
      by[k].forEach((m, j) => im.setMatrixAt(j, m.clone().multiply(local)));
      root.add(im);
    });
  };
  instanceNodes(A.models.fern_02, fernSpots, new THREE.Color(0.42, 0.5, 0.36), 0.2, 3);
  const placeModel = (gltf, spots) => {
    if (!gltf || !spots.length) return;
    const mats = new Map();
    for (const [x, y, z, ry] of spots) {
      const o = gltf.scene.clone(true); o.position.set(x, y, z); o.rotation.y = ry;
      o.traverse((c) => { if (c.isMesh) { if (!mats.has(c.material)) mats.set(c.material, modelMat(c.material, 0.2)); c.material = mats.get(c.material); } });
      root.add(o);
    }
  };
  if (!small) {
    placeModel(A.models.modern_arm_chair_01, chairSpots);
    placeModel(A.models.modern_coffee_table_01, coffeeSpots);
  }

  // pendants: a dark shade with a glowing underside that lights up with the room
  const pendGlowM = new THREE.MeshBasicMaterial({ color: WHITE });
  owned.mats.add(pendGlowM);
  let pendGlow = null;
  if (pendants.length) {
    const pend = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.2, 0.16, 24, 1, true), shadeM, pendants.length);
    pendGlow = new THREE.InstancedMesh(new THREE.CircleGeometry(0.19, 24), pendGlowM, pendants.length);
    pendants.forEach((p, i) => { pend.setMatrixAt(i, at(p.x, p.y, p.z)); pendGlow.setMatrixAt(i, at(p.x, p.y - 0.079, p.z, 0, Math.PI / 2)); pendGlow.setColorAt(i, OFF_GLOW); });
    root.add(pend, pendGlow);
  }

  // lamps and chairs, one instanced draw per part
  const AG = Object.values(agents), N = AG.length;
  const glowMats = [new THREE.MeshBasicMaterial({ color: WHITE, side: THREE.BackSide }), new THREE.MeshBasicMaterial({ color: WHITE })];
  for (const m of glowMats) owned.mats.add(m);
  const chairFab = keyed(lit(new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.95, envMapIntensity: 0.1 })), "b-plain");
  // the arm lamps' shades: painted per lamp, dark lacquer at dusk, the state's colour in the morning (T12)
  const lampShadeM = keyed(lit(shadeLit(new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.45, metalness: 0.3, envMapIntensity: 0.4 }))), "b-lampshade");
  owned.mats.add(chairFab); owned.mats.add(lampShadeM);
  let lampMeshes = [], chairMeshes = [];
  const rigRoot = new THREE.Object3D();
  if (N) {
    lampMeshes = lampGeos().map((g, i) => { if (i === 4) g.setAttribute("aGlow", new THREE.InstancedBufferAttribute(new Float32Array(N), 1)); const im = new THREE.InstancedMesh(g, i === 4 ? lampShadeM : i === 5 ? glowMats[0] : i === 6 ? glowMats[1] : steel, N); root.add(im); return im; });
    for (const im of [lampMeshes[5], lampMeshes[6]]) for (let k = 0; k < N; k++) im.setColorAt(k, OFF_GLOW);
    for (const ag of AG) { ag.rig = lampRig(); ag.rig.g.position.copy(ag.lampAt); ag.rig.g.rotation.y = -0.35; ag.rig.g.scale.setScalar(LAMP_SCALE); rigRoot.add(ag.rig.g); }
    const chairGeos = [new THREE.BoxGeometry(0.48, 0.08, 0.46), new THREE.BoxGeometry(0.46, 0.46, 0.07), new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8), new THREE.CylinderGeometry(0.25, 0.27, 0.03, 20)];
    chairMeshes = chairGeos.map((g, i) => { const im = new THREE.InstancedMesh(g, i < 2 ? chairFab : steel, N); if (i < 2) for (let k = 0; k < N; k++) im.setColorAt(k, col("#3a3532")); root.add(im); return im; });
  }
  const M4 = new THREE.Matrix4(), V = new THREE.Vector3(), T4 = new THREE.Matrix4();
  function placeLamp(ag) {
    const f = ease(ag.fold);
    ag.rig.setPose(f);
    ag.rig.g.updateMatrixWorld(true);
    ag.rig.parts.forEach((pt, k) => { lampMeshes[k].setMatrixAt(ag.i, pt.matrixWorld); lampMeshes[k].instanceMatrix.needsUpdate = true; });
    ag.rig.head.getWorldPosition(V); ag.head = V.clone();
    const c = ag.chair, z = c.z + f * 0.5;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.ry * (1 - ag.fold), 0)), ONE);
    [[0, 0.46, 0], [0, 0.74, -0.22], [0, 0.21, 0], [0, 0.02, 0]].forEach(([lx, ly, lz], k) => { chairMeshes[k].setMatrixAt(ag.i, M4.copy(base).multiply(T4.makeTranslation(lx, ly, lz))); chairMeshes[k].instanceMatrix.needsUpdate = true; });
  }

  // ---- the doors: a leaf that slides open, the light behind it, and a small amber mark when Settings would refuse ----
  const doors = {};
  const doorLeaf = keyed(lit(grade(new THREE.MeshStandardMaterial({ map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughness: 0.7, color: col("#ffffff") }), 0.6, 0.9, 1.05, "#c9a07a")), "b-doorleaf");
  const doorShut = keyed(lit(new THREE.MeshStandardMaterial({ color: col("#3a2f29"), roughness: 0.55, metalness: 0.2 })), "b-plain");
  owned.mats.add(doorLeaf); owned.mats.add(doorShut);
  const leafGeo = new THREE.BoxGeometry(DOOR_W - 0.02, DOOR_H - 0.02, 0.05), glowGeo = new THREE.PlaneGeometry(DOOR_W - 0.02, DOOR_H - 0.02), markGeo = new THREE.BoxGeometry(0.16, 0.05, 0.03);
  plan.annex.doors.forEach((d) => {
    const glowM = new THREE.MeshBasicMaterial({ color: col("#ffb36b") }), markM = new THREE.MeshBasicMaterial({ color: col("#ff9a36") });
    owned.mats.add(glowM); owned.mats.add(markM);
    const glow = new THREE.Mesh(glowGeo, glowM); glow.position.set(d.x, Y0 + DOOR_H / 2, ZF - 0.45);
    const leaf = new THREE.Mesh(leafGeo, doorShut);
    const mark = new THREE.Mesh(markGeo, markM); mark.position.set(d.x, Y0 + DOOR_H + 0.14, ZF - 0.08); mark.visible = false;
    root.add(glow, leaf, mark);
    doors[d.id] = { id: d.id, leaf, glowM, mark, z: ZF - 0.16, x: d.x, open: 0, target: 0, from: 0, t: 1, state: "shut",
      box: new THREE.Box3(new THREE.Vector3(d.x - DOOR_W / 2, Y0, ZF - 0.6), new THREE.Vector3(d.x + DOOR_W / 2, Y0 + DOOR_H, ZF + 0.3)) };
  });
  const annexBox = new THREE.Box3(new THREE.Vector3(X1, Y0, ZB), new THREE.Vector3(DX1, yOf(1) - SLAB, ZF + 0.3));

  // ---- the bench lamps of the pavilion, instanced ----
  let benchMeshes = null;
  if (pav) {
    const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(pav.bwid * 0.8, 0.06, 0.55), deskOak, BENCHES);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(pav.bwid * 0.7, 0.4, 0.45), steel, BENCHES);
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 14, 10), glowMats[1], BENCHES);
    const strip = new THREE.InstancedMesh(new THREE.PlaneGeometry(pav.bwid * 0.7, 0.04), glowMats[1], BENCHES);
    benchMeshes = { seat, legs, bulb, strip };
    root.add(seat, legs, bulb, strip);
  }
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  function applyBenches() {
    if (!pav) return;
    let warm = 0;
    pav.benches.forEach((b, k) => {
      const show = b.shown;
      benchMeshes.seat.setMatrixAt(k, show ? at(b.x, b.y + 0.43, b.z) : hidden);
      benchMeshes.legs.setMatrixAt(k, show ? at(b.x, b.y + 0.2, b.z) : hidden);
      benchMeshes.bulb.setMatrixAt(k, show ? at(b.x + pav.bwid * 0.3, b.y + 0.62, b.z - 0.12) : hidden);
      benchMeshes.strip.setMatrixAt(k, show ? at(b.x, b.y + 0.39, b.z + 0.28) : hidden);
      const on = ease(b.on), am = ease(b.amber);
      benchMeshes.bulb.setColorAt(k, am > 0.01 ? LAMP_COLOURS.amber.clone().multiplyScalar(3 * am) : OFF_GLOW);
      benchMeshes.strip.setColorAt(k, on > 0.01 ? LAMP_COLOURS.on.clone().multiplyScalar(2.2 * on) : OFF_GLOW);
      warm += on;
    });
    for (const m of Object.values(benchMeshes)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    const I = Math.min(1.6, warm * 0.7) * (dark ? 0 : 1);
    // the glass takes a warm cast while an app is on, so the pavilion reads from across the forecourt
    glass.emissive.copy(WARM).multiplyScalar(Math.min(1, warm) * 0.35 * (dark ? 0 : 1));
    RL.uRoomCol.value[pavIndex].set(WARM.r * I, WARM.g * I, WARM.b * I);
  }

  // ---- light uniforms: rooms in plan order, then the annex, then the pavilion ----
  const roomList = Object.values(rooms);
  const annexIndex = roomList.length, pavIndex = roomList.length + 1;
  let lampAt = 0;
  roomList.forEach((rm) => {
    RL.uRoomBox.value[rm.ri].set(rm.x0, rm.x1, rm.y, H - SLAB + 0.05); RL.uRoomPos.value[rm.ri].set(rm.cx, rm.y + 2.35, 0.6);
    RL.uRoomInfo.value[rm.ri].set(lampAt, rm.agents.length);
    rm.agents.forEach((ag, k) => { ag.slot = lampAt + k; });
    lampAt += rm.agents.length;
  });
  RL.uRoomBox.value[annexIndex].set(X1 + 0.07, DX1, Y0, H - SLAB); RL.uRoomPos.value[annexIndex].set((X1 + DX1) / 2, Y0 + 2.0, 0);
  if (plan.empty) RL.uRoomBox.value[NR - 1].set(X0, X1, Y0, H - SLAB + 0.05); // the empty hall: dim, unlit (the spare slot)
  if (pav) { RL.uRoomBox.value[pavIndex].set(pav.x0, pav.x1, pav.y, pav.h + 0.12); RL.uRoomPos.value[pavIndex].copy(pav.centre).setY(pav.y + 2.1); }
  // the solids that throw the sun's shadow: the body (below the terrace, when the terrace is beside the top floor),
  // the top floor's rooms beside the terrace, the annex
  RL.uSolidA.value[0].set(X0 - 0.2, -0.2, ZB - 0.3); RL.uSolidB.value[0].set(X1 + 0.2, terBeside ? yOf(topF) : roofY + 0.12, ZF + 0.3);
  if (terBeside) { RL.uSolidA.value[1].set(X0 - 0.2, yOf(topF), ZB - 0.3); RL.uSolidB.value[1].set(T.x0 + 0.2, roofY + 0.12, ZF + 0.3); }
  RL.uSolidA.value[2].set(X1, -0.2, ZB - 0.3); RL.uSolidB.value[2].set(DX1 + 0.2, yOf(1) - SLAB + 0.36, ZF + 0.3);
  RL.uSpill.value.set(X0 - 4.5, DX1 + 4.5);

  let dark = false, asking = false, day = false;
  function applyRoom(rm) {
    let lit2 = 0; const warm = new THREE.Color(0, 0, 0);
    for (const ag of rm.agents) { lit2 += ag.light; warm.add((LAMP_COLOURS[ag.colourKind] || LAMP_COLOURS.on).clone().multiplyScalar(ag.light)); }
    const n = Math.max(1, rm.agents.length), k = lit2 / n;
    if (lit2 > 0) warm.multiplyScalar(1 / lit2); else warm.copy(WARM);
    warm.lerp(WARM, 0.5);
    const glow = Math.min(1, lit2) * 0.7 + k * 0.5;
    const I = dark ? 0.01 : (glow * 3.6 + rm.hover * 1.2 + rm.open * 0.5 + rm.flash * 2.0) + 0.01;
    RL.uRoomCol.value[rm.ri].set(warm.r * I, warm.g * I, warm.b * I);
    if (pendGlow) {
      pendants.forEach((p, i) => { if (p.room === rm.id) pendGlow.setColorAt(i, !dark && (glow > 0 || rm.hover > 0) ? WARM.clone().multiplyScalar(0.25 + glow * 2.2 + rm.hover * 1.2) : OFF_GLOW); });
      pendGlow.instanceColor.needsUpdate = true;
    }
  }
  function applyAgent(ag) {
    placeLamp(ag);
    const c = LAMP_COLOURS[ag.colourKind];
    const k = ag.light * (1 + ag.boost * 1.4);
    lampMeshes[5].setColorAt(ag.i, c && k > 0 ? c.clone().multiplyScalar(1.3 * k) : OFF_GLOW);
    lampMeshes[6].setColorAt(ag.i, c && k > 0 ? c.clone().multiplyScalar(3 * k) : OFF_GLOW);
    lampMeshes[5].instanceColor.needsUpdate = lampMeshes[6].instanceColor.needsUpdate = true;
    // the shade: in the morning its paint follows the light from pale toward the state's colour, and glows with it
    const lk = Math.min(1, ag.light / 0.85), [paint, glow] = shadeOf(c ? ag.colourKind : "off", day);
    lampMeshes[4].setColorAt(ag.i, day ? SHADE_DAY.off.clone().lerp(paint, lk) : paint);
    lampMeshes[4].instanceColor.needsUpdate = true;
    const ga = lampMeshes[4].geometry.attributes.aGlow; ga.array[ag.i] = glow * lk; ga.needsUpdate = true;
    const L = RL.uLamp.value[ag.slot];
    if (c && k > 0) { L.set(ag.head.x, ag.head.y - 0.08, ag.head.z, 1); RL.uLampCol.value[ag.slot].set(c.r, c.g, c.b).multiplyScalar(5 * k); }
    else L.w = 0;
  }
  function applyDoor(d) {
    const o = ease(d.open);
    d.leaf.position.set(d.x - o * (DOOR_W - 0.06), Y0 + DOOR_H / 2, d.z);
    d.leaf.material = o > 0.5 ? doorLeaf : doorShut;
    d.glowM.color.set("#ffb36b").multiplyScalar(dark ? 0.04 : 0.12 + 0.9 * o);
    d.mark.visible = d.state === "blocked";
  }
  function applyDoors() { let o = 0; for (const id in doors) o += doors[id].open; RL.uRoomCol.value[annexIndex].set(WARM.r, WARM.g, WARM.b).multiplyScalar(dark ? 0.01 : o * 0.8 + 0.02); }
  function applyCore() { coreM.color.copy(asking && !dark ? WARM : OFF_GLOW).multiplyScalar(asking && !dark ? 1.6 : 1); }

  // ---- state in: lamps, doors, apps (ids and enums only) ----
  const LAMP = { on: [1, 0, "on"], amber: [1, 0, "amber"], red: [0.85, 0, "red"], off: [0, 0, "off"], down: [0, 1, "off"] };
  function setLamp(slug, lamp, { animate = false, delay = 0 } = {}) {
    const ag = agents[slug]; if (!ag) return false;
    const [light, fold, kind] = LAMP[lamp] || LAMP.off;
    // already there, or already on its way there: a scene that arrives while the lamp animates leaves it to finish
    if (ag.target === light && ag.foldTarget === fold && (ag.pendingKind || ag.colourKind) === kind) return false;
    // a lamp going dark keeps its colour while it fades
    if (light > 0 || ag.light <= 0 || !animate) { ag.colourKind = kind; ag.pendingKind = null; } else ag.pendingKind = kind;
    ag.lightFrom = ag.light; ag.foldFrom = ag.fold; ag.target = light; ag.foldTarget = fold;
    if (animate) { ag.t = 0; ag.wait = delay; } else { ag.t = 1; ag.wait = 0; ag.light = light; ag.fold = fold; applyAgent(ag); applyRoom(ag.room); }
    return true;
  }
  function setDoor(id, state, { animate = false } = {}) {
    const d = doors[id]; if (!d) return false;
    const target = state === "open" ? 1 : 0;
    if (d.target === target && d.state === state) return false;
    d.state = state; d.from = d.open; d.target = target;
    if (animate) d.t = 0; else { d.t = 1; d.open = target; }
    applyDoor(d); applyDoors();
    return true;
  }
  function setApps(list, { animate = false } = {}) {
    if (!pav) return false;
    let changed = false;
    pav.benches.forEach((b, k) => {
      const a = list[k];
      const shown = !!a, onT = a && a.on ? 1 : 0, amberT = a && a.allowance ? 1 : 0;
      if (b.shown !== shown || b.onT !== onT || b.amberT !== amberT) changed = true;
      b.shown = shown; b.onT = onT; b.amberT = amberT;
      if (!animate) { b.on = onT; b.amber = amberT; }
    });
    if (changed) applyBenches();
    return changed;
  }

  // ---- work moving: a lit sheet on a tray, a line of light along its path, a glow when it lands ----
  const sheetM = new THREE.MeshStandardMaterial({ color: col("#f6f2ea"), roughness: 0.85, emissive: col("#ffdcae"), emissiveIntensity: 1.1, transparent: true });
  const pathM = new THREE.MeshBasicMaterial({ color: col("#ffc98a"), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  owned.mats.add(sheetM); owned.mats.add(pathM);
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.014, 1.06), sheetM);
  sheet.visible = false; root.add(sheet);
  let pathMesh = null;
  const flights = [];
  const SEG = 80;
  // from and to are { desk point } holders: agents, or any point with `room` to flash
  function fly(p0, p3, { still = false, dur = 900, onArrive, to = null, lift = 0.7 } = {}) {
    const p1 = new THREE.Vector3(p0.x, p0.y + lift, ZF + 1.0), p2 = new THREE.Vector3(p3.x, p3.y + lift, ZF + 1.0);
    const curve = new THREE.CubicBezierCurve3(p0.clone(), p1, p2, p3.clone());
    if (pathMesh) { root.remove(pathMesh); pathMesh.geometry.dispose(); }
    pathMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.05, 6, false), pathM);
    pathMesh.geometry.setDrawRange(0, 0); pathMesh.visible = !still; root.add(pathMesh);
    flights.length = 0;
    flights.push({ curve, t: 0, dur: still ? 240 : dur, still, onArrive, to, after: 0 });
  }
  function sendSheet(from, to, opts = {}) {
    const a = agents[from], b = agents[to]; if (!a || !b) return false;
    fly(a.desk, b.desk, { ...opts, to: b });
    return true;
  }

  // ---- the frame's step: true while anything still moves ----
  let geo = false;
  function update(dt) {
    let moving = false; geo = false;
    for (const ag of AG) {
      let ch = false;
      if (ag.t < 1) {
        if (ag.wait > 0) { ag.wait -= dt; moving = true; continue; }
        ag.t = Math.min(1, ag.t + dt / 450);
        const e = ease(ag.t);
        ag.light = ag.lightFrom + (ag.target - ag.lightFrom) * e;
        ag.fold = ag.foldFrom + (ag.foldTarget - ag.foldFrom) * e;
        if (ag.t >= 1 && ag.pendingKind) { ag.colourKind = ag.pendingKind; ag.pendingKind = null; }
        ch = true; geo = true;
      }
      if (ag.boost > 0) { ag.boost = Math.max(0, ag.boost - dt / 900); ch = true; }
      if (ch) { applyAgent(ag); moving = true; }
    }
    for (const rm of roomList) {
      let ch = false;
      if (rm.hover !== rm.hoverT) { rm.hover += Math.sign(rm.hoverT - rm.hover) * Math.min(Math.abs(rm.hoverT - rm.hover), dt / 240); ch = true; }
      if (rm.open !== rm.openT) { rm.open += Math.sign(rm.openT - rm.open) * Math.min(Math.abs(rm.openT - rm.open), dt / 300); ch = true; }
      if (rm.flash > 0) { rm.flash = Math.max(0, rm.flash - dt / 900); ch = true; }
      if (ch || moving) { applyRoom(rm); if (ch) moving = true; }
    }
    for (const id in doors) {
      const d = doors[id];
      if (d.t < 1) { d.t = Math.min(1, d.t + dt / 600); d.open = d.from + (d.target - d.from) * ease(d.t); applyDoor(d); applyDoors(); moving = true; }
    }
    if (pav) {
      let ch = false;
      for (const b of pav.benches) for (const [k, kt] of [["on", "onT"], ["amber", "amberT"]]) if (b[k] !== b[kt]) { b[k] += Math.sign(b[kt] - b[k]) * Math.min(Math.abs(b[kt] - b[k]), dt / 450); ch = true; }
      if (ch) { applyBenches(); moving = true; }
    }
    const C = RL.uLamp.value[CARRY];
    if (flights.length) {
      const f = flights[0];
      f.t += dt / f.dur;
      const t = Math.min(1, f.t);
      if (f.t <= 1 || !f.landed) {
        sheet.visible = true;
        if (f.still) { const first = t < 0.5; sheet.position.copy(first ? f.curve.v0 : f.curve.v3).y += 0.05; sheetM.opacity = first ? 1 - t * 2 : (t - 0.5) * 2; sheet.rotation.set(0, 0, 0); C.w = 0; }
        else {
          const e = ease(t);
          f.curve.getPoint(e, sheet.position); sheetM.opacity = 1;
          sheet.rotation.set(Math.sin(e * Math.PI) * 0.35, e * 1.2, Math.sin(e * Math.PI) * 0.2);
          pathMesh.geometry.setDrawRange(0, Math.floor(e * SEG) * 6 * 6); pathM.opacity = 0.85;
          C.set(sheet.position.x, sheet.position.y + 0.3, sheet.position.z + 0.2, 1); RL.uLampCol.value[CARRY].set(1, 0.78, 0.5).multiplyScalar(1.2 + 1.6 * Math.sin(t * Math.PI));
        }
        if (t >= 1) { f.landed = true; sheet.visible = false; C.w = 0; if (f.to) { f.to.boost = 1; f.to.room.flash = 1; } if (f.onArrive) f.onArrive(); }
      } else {
        // the path fades after the sheet has landed
        f.after += dt / 420; pathM.opacity = 0.85 * Math.max(0, 1 - f.after);
        if (f.after >= 1) { flights.shift(); if (pathMesh) pathMesh.visible = false; }
      }
      moving = true;
    }
    return moving;
  }
  // Every motion to its end at once (reduced motion, a hidden tab coming back).
  function snap() {
    for (const ag of AG) { if (ag.t < 1 || ag.boost) { ag.t = 1; ag.wait = 0; ag.light = ag.target; ag.fold = ag.foldTarget; ag.boost = 0; if (ag.pendingKind) { ag.colourKind = ag.pendingKind; ag.pendingKind = null; } applyAgent(ag); } }
    for (const rm of roomList) { rm.hover = rm.hoverT; rm.open = rm.openT; rm.flash = 0; applyRoom(rm); }
    for (const id in doors) { const d = doors[id]; d.t = 1; d.open = d.target; applyDoor(d); }
    applyDoors();
    if (pav) { for (const b of pav.benches) { b.on = b.onT; b.amber = b.amberT; } applyBenches(); }
    if (flights.length) { const f = flights[0]; if (f.onArrive && !f.landed) f.onArrive(); flights.length = 0; sheet.visible = false; RL.uLamp.value[CARRY].w = 0; if (pathMesh) pathMesh.visible = false; }
  }

  for (const ag of AG) applyAgent(ag);
  for (const rm of roomList) applyRoom(rm);
  for (const id in doors) applyDoor(doors[id]);
  applyDoors(); applyBenches(); applyCore();

  return {
    root, rooms, agents, doors, pav, RL, annexBox,
    lit: (m, spill) => roomLit(m, RL, spill),
    setLamp, setDoor, setApps,
    setDark(v) { if (dark === !!v) return false; dark = !!v; for (const rm of roomList) applyRoom(rm); for (const id in doors) applyDoor(doors[id]); applyDoors(); applyBenches(); applyCore(); return true; },
    // the morning's lamps (T12): shades painted by state; nothing else changes here
    setDay(v) { if (day === !!v) return false; day = !!v; for (const ag of AG) applyAgent(ag); return true; },
    setAsking(v) { if (asking === !!v) return false; asking = !!v; applyCore(); return true; },
    setHover(id, still) { let ch = false; for (const k in rooms) { const t = k === id ? 1 : 0; if (rooms[k].hoverT !== t) { rooms[k].hoverT = t; ch = true; if (still) { rooms[k].hover = t; applyRoom(rooms[k]); } } } return ch; },
    setOpen(id, still) { let ch = false; for (const k in rooms) { const t = k === id ? 1 : 0; if (rooms[k].openT !== t) { rooms[k].openT = t; ch = true; if (still) { rooms[k].open = t; applyRoom(rooms[k]); } } } return ch; },
    flash(id) { if (rooms[id]) rooms[id].flash = 1; },
    sendSheet, fly, update, snap,
    sync(sunDirWorld) {
      root.updateMatrixWorld(true);
      RL.uBInv.value.copy(root.matrixWorld).invert();
      if (sunDirWorld) RL.uSunL.value.copy(sunDirWorld).transformDirection(RL.uBInv.value);
    },
    geoMoved: () => geo,
    dispose() {
      root.traverse((o) => { if (o.geometry) owned.geos.add(o.geometry); });
      if (pathMesh) owned.geos.add(pathMesh.geometry);
      for (const g of owned.geos) g.dispose();
      for (const m of owned.mats) m.dispose();
      blotT.dispose();
      for (const im of [...lampMeshes, ...chairMeshes]) im.dispose();
      root.removeFromParent();
    },
  };
}
