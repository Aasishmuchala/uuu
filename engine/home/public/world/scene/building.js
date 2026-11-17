// The studio building (PLAN-3D D8, T6, REAL-1): a house of board-marked concrete, upright timber boards and glass, built
// from planBuilding's plan, any number of rooms from 0 to 11 on 1 to 4 floors. Every department a room glazed from
// floor to ceiling at the front, every agent a desk with an arm lamp that says what the agent is doing; the annex at
// ground right with the three doors; the roof terrace with App Studio's glazed pavilion, one bench per app. Static
// parts are merged, one draw per material; furniture (Poly Haven models), lamps, chairs and pendants are instanced.
// Everything solid throws and takes shadow (the sun's map, and the ceiling light's own: lamps.js).
//
// Nothing here knows a name or a title: the plan and the SceneState give ids, enums and numbers only (D9).
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { col, ease, rng } from "./dusk.js";
import { CARRY, NR, LAMP_COLOURS, OFF_GLOW, WARM, ZB, ZF, SHADE_DAY, SHADE_DUSK, SHADE_LAYER, lampGeos, lampRig, makeRoomLight, roomLit, shadeLit, shadeOf } from "./lamps.js";

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
// Programs are shared between materials whose shaders are the same: the key names the shader, never the material.
export const keyed = (mat, key) => { mat.customProgramCacheKey = () => key; mat.dithering = true; return mat; };

// The glass: what it shows is the sky and the lamps mirrored in it, strongest at a glancing angle (Fresnel), laid over
// the room behind, which it dims a little. No transmission pass.
export function glassMaterial(env = 1) {
  const m = new THREE.MeshStandardMaterial({ color: col("#ffffff"), roughness: 0.04, metalness: 0, envMapIntensity: env, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", `
      { float gF = pow(1. - abs(dot(normalize(normal), normalize(vViewPosition))), 5.);
        vec3 gS = reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
        gl_FragColor = vec4(gS, .07 + .6 * gF); }`);
  };
  return keyed(m, "b-glass2");
}

// What gives each room its kind of work, by the department's id where it is one of the studio's own, else in turn.
const KINDS = ["longtable", "drawing", "round", "posters", "shelves", "lounge", "plants"];
const KIND_OF = { operations: "longtable", studio: "drawing", sales: "round", marketing: "posters", books: "shelves", support: "lounge", people: "plants" };
const kindOf = (id, i) => KIND_OF[id] || KINDS[i % KINDS.length];
const TIMBER = new Set(["drawing", "shelves", "lounge"]);
const LAMP_SCALE = 1.35; // lamps a little larger than life, so their state reads from across the building
const DOOR_W = 0.8, DOOR_H = 2.35, SLAB = 0.3;
const BENCHES = 4;
const GZ = ZF - 0.24; // the plane of the front's glazing

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
  const tex = A.tex, MD = small ? {} : A.models;
  const std = (o) => new THREE.MeshStandardMaterial(o);

  // board-marked concrete: the boards' seams and each board's own tone, across every upright face
  const concrete = std({ vertexColors: true, map: tex.concrete_floor_02_diff, normalMap: tex.concrete_floor_02_nor, roughnessMap: tex.concrete_floor_02_rough, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0, envMapIntensity: 0.9 });
  concrete.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vBW; varying vec3 vBN;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvBW = position; vBN = objectNormal;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vBW; varying vec3 vBN;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        { float vert = 1. - smoothstep(.5, .8, abs(vBN.y)); float yb = vBW.y / .14;
          float seam = smoothstep(.0, .05, abs(fract(yb) - .5) * 2. - .93); float band = fract(sin(floor(yb) * 91.7) * 4375.5);
          float run = fract(sin(floor(yb) * 37.1 + floor((vBW.x + vBW.z) / 2.4 + band * 3.) * 17.3) * 9631.7);
          diffuseColor.rgb *= 1. - vert * (seam * .22 + (band - .5) * .07 + (run - .5) * .05); }`);
  };
  keyed(lit(grade(concrete, 0.12, 1.0, 0.8), 1), "b-concrete");
  const plaster = keyed(lit(grade(std({ vertexColors: true, map: tex.white_plaster_02_diff, normalMap: tex.white_plaster_02_nor, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.93, envMapIntensity: 0.3 }), 0.25, 0.96, 0.6, "#f4efe6")), "b-plaster");
  // cladding: weathered boards run upright on the end walls and the annex (real board width, about 15 cm)
  const cladTex = tex.weathered_brown_planks_diff ? ["weathered_brown_planks_diff", "weathered_brown_planks_nor", "weathered_brown_planks_rough"] : ["planks_brown_10_diff", "planks_brown_10_nor", "planks_brown_10_rough"];
  const clad = keyed(lit(grade(std({ vertexColors: true, map: tex[cladTex[0]], normalMap: tex[cladTex[1]], roughnessMap: tex[cladTex[2]], normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1, envMapIntensity: 0.6 }), 0.85, 1.25, 1.05, "#e2b78d"), 1), "b-clad");
  const timber = keyed(lit(grade(std({ vertexColors: true, map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughnessMap: tex.planks_brown_10_rough, roughness: 0.85, envMapIntensity: 0.3 }), 0.75, 1.05, 1.0, "#eccba6")), "b-timber");
  const oak = keyed(lit(grade(std({ vertexColors: true, map: tex.wood_floor_diff, normalMap: tex.wood_floor_nor, roughnessMap: tex.wood_floor_rough, roughness: 0.82, envMapIntensity: 0.45 }), 0.8, 1.0, 1.0, "#f0dcc4")), "b-oak");
  const deskOak = keyed(lit(grade(std({ vertexColors: true, map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughnessMap: tex.planks_brown_10_rough, roughness: 0.7, envMapIntensity: 0.4 }), 0.7, 1.2, 1.05, "#f1d3ad")), "b-deskoak");
  const steel = keyed(lit(std({ color: col("#17181a"), roughness: 0.42, metalness: 0.75, envMapIntensity: 0.9 }), 1), "b-plain1");
  const fabric = keyed(lit(std({ vertexColors: true, color: col("#ffffff"), roughness: 0.95, envMapIntensity: 0.2 })), "b-plain");
  const paint = keyed(lit(std({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.25 })), "b-plain");
  const shadeM = keyed(lit(std({ color: col("#232a27"), roughness: 0.45, metalness: 0.3, envMapIntensity: 0.6 })), "b-plain");
  const paperM = keyed(lit(std({ color: col("#efe9de"), roughness: 0.9, envMapIntensity: 0.2 })), "b-plain");
  const glass = glassMaterial(1.0);
  const glazing = glassMaterial(1.15);
  for (const m of [concrete, plaster, clad, timber, oak, deskOak, steel, fabric, paint, shadeM, paperM, glass, glazing]) owned.mats.add(m);

  const cp = [], pp = [], wp = [], tp = [], op = [], fp = [], fab = [], pnt = [], dk = [], pap = [];
  const gp = []; // every pane of glass in the building, one draw
  const wUV = (p, n) => (Math.abs(n.x) >= Math.abs(n.z) ? [p.y / 2.2, p.z / 2.2] : [p.y / 2.2, p.x / 2.2]); // boards upright
  const C_SLAB = "#c9c7c3", C_WALL = "#bdbbb7", C_BASE = "#8f8d89", DARK = "#141516";
  // a slab: its body with a chamfer that catches a line of light, a shadow gap, and the screed that tops it
  const slab = (xa, xb, top, z0, z1, c = C_SLAB) => {
    cp.push(cbx(xa, xb, top - SLAB, top - 0.055, z0, z1, 0.02, c, cUV));
    pnt.push(bx(xa + 0.02, xb - 0.02, top - 0.055, top - 0.04, z0 + 0.02, z1 - 0.02, DARK));
    cp.push(cbx(xa - 0.01, xb + 0.01, top - 0.04, top, z0 - 0.01, z1 + 0.01, 0.008, c, cUV));
  };
  // plinth, floors, roof
  cp.push(cbx(X0 - 0.3, DX1 + 0.3, -0.2, Y0 - SLAB, -4.1, 4.3, 0.02, C_BASE, cUV));
  slab(X0 - 0.2, DX1 + 0.2, Y0, -3.95, 4.05);
  for (let f = 1; f <= topF; f++) slab(X0 - 0.2, X1 + 0.2, yOf(f), -3.95, 4.05);
  {
    const rx1 = terBeside ? T.x0 + 0.2 : X1 + 0.35;
    cp.push(cbx(X0 - 0.35, rx1, roofY - SLAB, roofY + 0.12, -4.1, 4.25, 0.03, C_SLAB, cUV));
    // the roof's edge: a dark folded-metal coping, proud of the concrete by a finger
    for (const [xa, xb, za, zb] of [[X0 - 0.37, rx1 + 0.02, 4.13, 4.27], [X0 - 0.37, rx1 + 0.02, -4.12, -3.98], [X0 - 0.37, X0 - 0.23, -4.12, 4.27], [rx1 - 0.12, rx1 + 0.02, -4.12, 4.27]]) op.push(bx(xa, xb, roofY + 0.12, roofY + 0.145, za, zb));
  }
  if (storeys > 1) slab(X1 - 0.1, DX1 + 0.2, yOf(1) - SLAB + 0.36, -3.95, 4.05); // over the doors
  else cp.push(cbx(X1, DX1 + 0.2, roofY - SLAB, roofY + 0.06, -3.95, 4.05, 0.02, C_SLAB, cUV));
  // end walls: clad in boards, a long window in each with a deep dark frame and a concrete sill
  const endWall = (xa, xb, y, outward) => {
    const h = H - SLAB, w0 = ZB + 0.9, w1 = ZF - 1.3, s0 = y + 0.8, s1 = y + 2.5, z0 = ZB - 0.3, z1 = ZF - 0.46;
    wp.push(bx(xa, xb, y, s0, z0, z1, "#ffffff", wUV), bx(xa, xb, s1, y + h, z0, z1, "#ffffff", wUV));
    wp.push(bx(xa, xb, s0, s1, z0, w0, "#ffffff", wUV), bx(xa, xb, s0, s1, w1, z1, "#ffffff", wUV));
    const xm = (xa + xb) / 2, n = Math.max(2, Math.round((w1 - w0) / 1.5)), xo0 = Math.min(xa, xb) - (outward < 0 ? 0.03 : 0), xo1 = Math.max(xa, xb) + (outward > 0 ? 0.03 : 0);
    gp.push({ geo: new THREE.PlaneGeometry(w1 - w0, s1 - s0), m: at(xm, (s0 + s1) / 2, (w0 + w1) / 2, Math.PI / 2) });
    for (let k = 0; k <= n; k++) { const z = w0 + k * (w1 - w0) / n, e = k === 0 || k === n; op.push(bx(e ? xo0 : xm - 0.035, e ? xo1 : xm + 0.035, s0, s1, z - 0.025, z + 0.025)); }
    for (const yy of [s0 + 0.025, s1 - 0.025]) op.push(bx(xo0, xo1, yy - 0.025, yy + 0.025, w0, w1));
    cp.push(bx(xo0 - (outward < 0 ? 0.05 : 0), xo1 + (outward > 0 ? 0.05 : 0), s0 - 0.07, s0, w0 - 0.06, w1 + 0.06, C_SLAB, cUV)); // the sill
  };
  for (let f = 0; f <= topF; f++) endWall(X0 - 0.2, X0, yOf(f), -1);
  for (let f = 1; f <= topF; f++) if (!(f === topF && terBeside)) endWall(X1, X1 + 0.2, yOf(f), 1);
  // the back wall, one thick leaf a storey; plastered inside
  for (let f = 0; f <= topF; f++) {
    const y = yOf(f), xe = f === topF && terBeside ? T.x0 : f === 0 ? DX1 : X1;
    pp.push(bx(X0 - 0.2, xe + (f === 0 ? 0.2 : 0), y, y + H - SLAB, ZB - 0.3, ZB, "#ffffff", cUV));
  }
  pp.push(bx(X1 - 0.07, X1 + 0.07, Y0, Y0 + H - SLAB, ZB, ZF - 0.46, "#ffffff", cUV));
  // the terrace: beside the top floor's rooms behind a parapet, or on the roof
  let terY = null;
  if (T) {
    terY = terBeside ? yOf(topF) : roofY + 0.12;
    const t0 = T.x0, t1 = T.x1;
    if (terBeside) wp.push(bx(t0, t0 + 0.2, terY, terY + H - SLAB, ZB, ZF - 0.46, "#ffffff", wUV));
    cp.push(bx(t0, t1 + 0.2, terY, terY + 1.0, ZB - 0.3, ZB - 0.1, C_WALL, cUV));
    op.push(bx(t0, t1 + 0.22, terY + 1.0, terY + 1.025, ZB - 0.32, ZB - 0.08));
    // the side and the front: a low kerb and a glass balustrade with a steel rail, so the pavilion reads from below
    const k0 = t0 + (terBeside ? 0.2 : 0), KH = 0.2, RH = 1.05;
    cp.push(bx(t1, t1 + 0.2, terY, terY + KH, ZB - 0.3, ZF + 0.2, C_WALL, cUV));
    cp.push(bx(k0, t1 + 0.2, terY, terY + KH, ZF, ZF + 0.2, C_WALL, cUV));
    gp.push({ geo: new THREE.PlaneGeometry(t1 + 0.1 - k0, RH - KH), m: at((k0 + t1 + 0.1) / 2, terY + (KH + RH) / 2, ZF + 0.1) });
    gp.push({ geo: new THREE.PlaneGeometry(ZF + 0.1 - (ZB - 0.1), RH - KH), m: at(t1 + 0.1, terY + (KH + RH) / 2, (ZF + ZB) / 2, Math.PI / 2) });
    op.push(bx(k0, t1 + 0.13, terY + RH - 0.03, terY + RH, ZF + 0.07, ZF + 0.13), bx(t1 + 0.07, t1 + 0.13, terY + RH - 0.03, terY + RH, ZB - 0.1, ZF + 0.13));
    for (let x = k0 + 0.05; x < t1 + 0.15; x += 1.2) op.push(bx(x - 0.012, x + 0.012, terY + KH, terY + RH, ZF + 0.088, ZF + 0.112));
    // the terrace's floor: boards
    if (!small) fp.push(bx(k0, t1, terY, terY + 0.03, ZB - 0.1, ZF, "#b9aa98", (p) => [p.z / 1.6, p.x / 1.6]));
  }
  // partitions between rooms, with a doorway near the back framed in dark timber; a concrete pier at every room's
  // edge on the front, so the slabs stand on something and the glazing sits between piers
  const DW0 = ZB + 0.5, DW1 = ZB + 1.45, DH = 2.15;
  const withDoorway = (list, xa, xb, y, c, uv) => {
    list.push(bx(xa, xb, y, y + H - SLAB, ZB, DW0, c, uv), bx(xa, xb, y, y + H - SLAB, DW1, ZF - 0.46, c, uv), bx(xa, xb, y + DH, y + H - SLAB, DW0, DW1, c, uv));
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
  for (const k of cols) { const [f, xs] = k.split(":"); const x = Math.min(X1 + 0.07, Math.max(X0 - 0.07, +xs)); const y = yOf(+f); cp.push(cbx(x - 0.13, x + 0.13, y, y + H - SLAB, ZF - 0.46, ZF - 0.02, 0.012, C_WALL, cUV)); }
  // the annex: a closed front clad in dark boards, three tall doors in deep steel frames
  const DXs = plan.annex.doors.map((d) => d.x);
  {
    const z0 = ZF - 0.3, z1 = ZF - 0.1, top = yOf(1) - SLAB, AC = "#6f655c";
    wp.push(bx(X1 + 0.07, DXs[0] - DOOR_W / 2, Y0, top, z0, z1, AC, wUV));
    for (let i = 0; i < DXs.length - 1; i++) wp.push(bx(DXs[i] + DOOR_W / 2, DXs[i + 1] - DOOR_W / 2, Y0, top, z0, z1, AC, wUV));
    wp.push(bx(DXs[DXs.length - 1] + DOOR_W / 2, DX1, Y0, top, z0, z1, AC, wUV));
    wp.push(bx(X1 + 0.07, DX1, Y0 + DOOR_H, top, z0, z1, AC, wUV));
    wp.push(bx(DX1, DX1 + 0.2, Y0, top, ZB - 0.3, ZF - 0.1, AC, wUV));
    for (const x of DXs) {
      for (const sd of [-1, 1]) op.push(bx(x + sd * DOOR_W / 2 - 0.02, x + sd * DOOR_W / 2 + 0.02, Y0, Y0 + DOOR_H + 0.02, z0 - 0.02, z1 + 0.03));
      op.push(bx(x - DOOR_W / 2 - 0.02, x + DOOR_W / 2 + 0.02, Y0 + DOOR_H - 0.02, Y0 + DOOR_H + 0.02, z0 - 0.02, z1 + 0.03));
    }
  }
  // an empty company: the shell stands, one dark hall
  if (plan.empty) fp.push(bx(X0 + 0.07, X1 - 0.07, Y0, Y0 + 0.025, ZB, ZF - 0.05, "#ffffff", (p) => [p.x / 1.6, p.z / 1.6]));

  // ---- rooms: floors, walls in plaster or timber, pendants, desks, and each kind's things ----
  const rooms = {}, agents = {}, pendants = [];
  const prints = [];
  const print = (n, x, y, z, w, h, rx = 0) => { prints.push({ n, x, y, z, w, h, rx }); if (!rx) { pnt.push(bx(x - w / 2 - 0.035, x + w / 2 + 0.035, y - h / 2 - 0.035, y + h / 2 + 0.035, z - 0.02, z + 0.012, "#1d1b19")); pnt.push(bx(x - w / 2 - 0.012, x + w / 2 + 0.012, y - h / 2 - 0.012, y + h / 2 + 0.012, z + 0.002, z + 0.006, "#f4f1ea")); } };
  // furniture: the Poly Haven models where the set has them (the Map), plain joinery in the small model on the desk
  const spots = { chair: [], table: [], plant: [], cabinet: [], sofa: [], lounge: [] };
  const fernSpots = [], chairSpots = [], coffeeSpots = [];
  const spot = (x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  const boxChair = (x, y, z, ry) => {
    const m = (lx, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    for (const [lx, lz, h] of [[-0.19, 0.18, 0.45], [0.19, 0.18, 0.45], [-0.19, -0.18, 0.85], [0.19, -0.18, 0.85]]) { const [px, pz] = m(lx, lz); dk.push({ geo: new THREE.BoxGeometry(0.035, h, 0.035), m: at(px, y + h / 2, pz, ry), c: WHITE, uv: boxUV(1.2) }); }
    dk.push({ geo: new THREE.BoxGeometry(0.44, 0.04, 0.42), m: at(x, y + 0.46, z, ry), c: WHITE, uv: boxUV(1.2) });
    const [bx2, bz2] = m(0, -0.19); dk.push({ geo: new THREE.BoxGeometry(0.42, 0.12, 0.03), m: at(bx2, y + 0.76, bz2, ry), c: WHITE, uv: boxUV(1.2) });
  };
  const chairAt = (x, y, z, ry) => { if (MD.dining_chair_02) spots.chair.push(spot(x, y, z, ry)); else boxChair(x, y, z, ry); };
  const pot = (x, y, z, s = 1) => {
    if (MD.potted_plant_02) { spots.plant.push(spot(x, y, z, x * 7.3 + z, 1.9 * s)); return; }
    pnt.push({ geo: new THREE.CylinderGeometry(0.2 * s, 0.16 * s, 0.42 * s, 20), m: at(x, y + 0.21 * s, z), c: col("#cfc6ba") }); fernSpots.push([x, y + 0.38 * s, z, 1.1 * s]);
  };
  // a table of our own joinery: a thick oak top with an eased edge on a steel trestle frame
  const table = (x0, x1, y, z0, z1) => {
    dk.push(cbx(x0, x1, y + 0.715, y + 0.76, z0, z1, 0.008, "#ffffff", boxUV(1.2)));
    for (const lx of [x0 + 0.14, x1 - 0.14]) { op.push(bx(lx - 0.02, lx + 0.02, y, y + 0.715, z0 + 0.1, z0 + 0.14), bx(lx - 0.02, lx + 0.02, y, y + 0.715, z1 - 0.14, z1 - 0.1), bx(lx - 0.02, lx + 0.02, y + 0.675, y + 0.715, z0 + 0.1, z1 - 0.1)); }
    op.push(bx(x0 + 0.14, x1 - 0.14, y + 0.675, y + 0.715, (z0 + z1) / 2 - 0.02, (z0 + z1) / 2 + 0.02));
  };
  const roundTable = (x, y, z, r, n) => {
    dk.push({ geo: new THREE.CylinderGeometry(r, r - 0.012, 0.04, 56), m: at(x, y + 0.74, z), c: WHITE, uv: boxUV(1.2) });
    op.push({ geo: new THREE.CylinderGeometry(0.035, 0.035, 0.72, 16), m: at(x, y + 0.36, z), c: WHITE });
    op.push({ geo: new THREE.CylinderGeometry(0.3, 0.32, 0.02, 40), m: at(x, y + 0.035, z), c: WHITE });
    for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n + 0.4; chairAt(x + Math.sin(a) * (r + 0.36), y, z + Math.cos(a) * (r + 0.36), a + Math.PI); }
  };
  const cabinet = (x, y, w) => { if (MD.modern_wooden_cabinet && w > 3.2) spots.cabinet.push(spot(x, y, ZB + 0.36, 0)); };
  const bw = ZB + 0.04;
  const furnish = (kind, r, y) => {
    const x0 = r.x0, x1 = r.x1, w = x1 - x0, cx = (x0 + x1) / 2;
    if (kind === "longtable") {
      // the wall board: a dark felt board with cards pinned in columns; the long shared table with its chairs
      const bwid = Math.min(4, w - 1.6), b0 = cx - bwid / 2, nc = Math.max(1, Math.floor(bwid / 0.64));
      pnt.push(bx(b0 - 0.03, b0 + bwid + 0.03, y + 1.02, y + 2.48, bw, bw + 0.02, "#b9a58c"));
      pnt.push(bx(b0, b0 + bwid, y + 1.05, y + 2.45, bw, bw + 0.03, "#2b3431"));
      const rc = rng(5);
      for (let c = 0; c < nc; c++) for (let k = 0; k < 4; k++) if (rc() > 0.2) pnt.push(bx(b0 + 0.15 + c * 0.64 + (rc() - 0.5) * 0.04, b0 + 0.15 + c * 0.64 + 0.42, y + 2.25 - k * 0.32 - 0.22, y + 2.25 - k * 0.32 + (rc() - 0.5) * 0.02, bw + 0.03, bw + 0.034, ["#efe9dc", "#e8c98a", "#d9a48f", "#bfd2c4"][Math.floor(rc() * 4)]));
      const L = Math.min(5, w - 2.2), t0 = cx - L / 2 + 0.4;
      if (L > 1.2) {
        table(t0, t0 + L, y, 1.3, 2.3);
        const n = Math.max(1, Math.floor(L / 1.1));
        for (let k = 0; k < n; k++) { const px = t0 + (k + 0.5) * L / n; chairAt(px, y, 1.02, (k % 3 - 1) * 0.07); chairAt(px + (k % 2 ? 0.05 : -0.03), y, 2.6, Math.PI + (k % 2 ? 0.1 : -0.06)); }
        pap.push({ geo: new THREE.BoxGeometry(0.42, 0.006, 0.3), m: at(t0 + L * 0.3, y + 0.765, 1.75, 0.3) }, { geo: new THREE.BoxGeometry(0.3, 0.012, 0.42), m: at(t0 + L * 0.62, y + 0.768, 1.85, -0.2) });
      }
      pot(x0 + 0.55, y, 2.7, 1.1);
    } else if (kind === "drawing") {
      const np = Math.max(1, Math.min(3, Math.floor((w - 1) / 1.55)));
      ["hero", "materials", "visit"].slice(0, np).forEach((n, i) => print(n, cx + (i - (np - 1) / 2) * 1.55, y + 1.85, bw, 1.25, 1.0));
      cabinet(cx, y, w);
      // a drawing board on a trestle, tilted towards the room; the model table with a white study model
      const bx0 = x0 + 1.3, bz0 = 1.5;
      for (const sd of [-1, 1]) op.push({ geo: new THREE.BoxGeometry(0.035, 0.95, 0.035), m: at(bx0 + sd * 0.6, y + 0.47, bz0, 0, 0.12), c: WHITE });
      dk.push({ geo: new THREE.BoxGeometry(1.4, 0.03, 0.95), m: at(bx0, y + 1.0, bz0 + 0.05, 0, 0.42), c: col("#f6f1e8"), uv: boxUV(1.2) });
      pap.push({ geo: new THREE.BoxGeometry(0.84, 0.004, 0.6), m: at(bx0 - 0.1, y + 1.03, bz0 + 0.05, 0, 0.42) });
      chairAt(bx0, y, bz0 + 0.9, Math.PI);
      if (w > 4.6) {
        const m1 = x1 - 0.6, m0 = Math.max(bx0 + 1.0, m1 - 2.2), mc = (m0 + m1) / 2;
        table(m0, m1, y, 1.2, 2.2);
        pnt.push(bx(mc - 0.55, mc + 0.55, y + 0.76, y + 0.78, 1.45, 2.0, "#d8d2c8")); pnt.push(bx(mc - 0.4, mc + 0.4, y + 0.78, y + 0.93, 1.55, 1.85, "#f3f0ea"));
        pnt.push(bx(mc - 0.3, mc + 0.5, y + 0.93, y + 1.08, 1.5, 1.82, "#f3f0ea")); pnt.push(bx(mc - 0.35, mc + 0.55, y + 1.08, y + 1.1, 1.48, 1.9, "#f8f6f1"));
      }
      pot(x1 - 0.5, y, 2.9, 1);
    } else if (kind === "round") {
      roundTable(cx - Math.min(0.6, w * 0.1), y, 1.6, 0.62, 4);
      print("visit", cx, y + 1.85, bw, 1.3, 0.95);
      cabinet(cx, y, w);
      pot(x1 - 0.55, y, 2.8, 1);
    } else if (kind === "posters") {
      const np = Math.max(1, Math.min(4, Math.floor((w - 0.8) / 1.0)));
      ["interior", "trees", "hero", "materials"].slice(0, np).forEach((n, i) => print(n, cx + (i - (np - 1) / 2) * 1.0, y + 1.9, bw, 0.8, 1.1));
      cabinet(cx, y, w);
      // an easel with the next poster, a worktable
      const ex = x1 - 1.1;
      for (const sd of [-1, 1]) op.push({ geo: new THREE.BoxGeometry(0.03, 1.7, 0.03), m: at(ex + sd * 0.32, y + 0.85, 1.9, 0, -0.12, sd * 0.12), c: WHITE });
      print("visit", ex, y + 1.15, 1.82, 0.7, 0.62, -0.12);
      if (w > 4.6) { const t0 = x0 + 0.6, t1 = Math.min(t0 + 1.9, ex - 0.8); table(t0, t1, y, 1.4, 2.25); chairAt((t0 + t1) / 2, y, 2.6, Math.PI + 0.12); }
    } else if (kind === "shelves") {
      // shelves along the back wall, full of ledgers and binders
      const rc = rng(9), s1 = x1 - 0.4, s0 = Math.max(x0 + 0.4, s1 - 2.25);
      for (let k = 0; k < 5; k++) dk.push(bx(s0, s1, y + 0.3 + k * 0.5, y + 0.33 + k * 0.5, ZB + 0.03, ZB + 0.4, "#ffffff", boxUV(1.2)));
      for (const sx of [s0, (s0 + s1) / 2, s1]) dk.push(bx(sx - 0.015, sx + 0.015, y, y + 2.4, ZB + 0.03, ZB + 0.4, "#ffffff", boxUV(1.2)));
      for (let k = 0; k < 4; k++) { let x = s0 + 0.06; while (x < s1 - 0.1) { const t = 0.035 + rc() * 0.05, h = 0.26 + rc() * 0.14, lean = rc() > 0.9; if (rc() > 0.12) pnt.push({ geo: new THREE.BoxGeometry(t, h, 0.2 + rc() * 0.06), m: at(x + t / 2, y + 0.33 + k * 0.5 + h / 2, ZB + 0.2, 0, 0, lean ? 0.12 : 0), c: col(["#5b2a21", "#2c4033", "#27304a", "#9a7848", "#ddd5c5", "#3d3530", "#c9c2b4", "#1f2326"][Math.floor(rc() * 8)]) }); x += t + 0.004 + (rc() > 0.85 ? 0.12 : 0); } }
      const t0 = x0 + 0.7, t1 = Math.min(t0 + 1.5, x1 - 0.6);
      table(t0, t1, y, 1.4, 2.2);
      chairAt((t0 + t1) / 2 + 0.1, y, 2.6, Math.PI - 0.15);
      pap.push({ geo: new THREE.BoxGeometry(0.45, 0.05, 0.32), m: at(t0 + 0.6, y + 0.785, 1.8, 0.1) }); pnt.push({ geo: new THREE.BoxGeometry(0.3, 0.05, 0.42), m: at(t0 + 1.0, y + 0.79, 1.7, -0.3), c: col("#5b2a21") });
    } else if (kind === "lounge") {
      // a sofa corner with a low table and a rug
      pnt.push(bx(x0 + 0.5, Math.min(x1 - 0.5, x0 + 4.0), y + 0.025, y + 0.04, 0.6, 3.0, "#8d8172"));
      const sx = Math.min(x1 - 1.6, x0 + 2.2);
      if (MD.sofa_02) spots.sofa.push(spot(sx, y, 0.95, 0, 1.15));
      else {
        const S = (cx2, cy, cz, w2, h, d, rr, ry = 0, c = "#cfc7bb") => fab.push({ geo: rbox(w2, h, d, rr), m: at(cx2, y + cy, cz, ry), c: col(c), uv: boxUV(0.4) });
        const sw = Math.min(2.6, w - 2.2);
        S(sx, 0.25, 1.05, sw, 0.22, 0.9, 0.05); S(sx, 0.62, 0.66, sw, 0.45, 0.22, 0.07);
        const nc = Math.max(1, Math.round(sw / 0.85)); for (let k = 0; k < nc; k++) S(sx - sw / 2 + (k + 0.5) * sw / nc, 0.42, 1.15, sw / nc - 0.03, 0.14, 0.7, 0.06);
      }
      if (MD.mid_century_lounge_chair) spots.lounge.push(spot(x0 + 1.0, y, 2.35, 1.9));
      coffeeSpots.push([sx + 0.1, y, 2.05, Math.PI / 2]);
      pot(x1 - 0.6, y, 2.7, 1.1);
      print("trees", cx - 0.2, y + 1.9, bw, 1.6, 0.9);
    } else {
      // a round table and plants
      roundTable(cx - 0.3, y, 1.7, 0.55, 3);
      pot(x0 + 0.5, y, -3.0, 1.2); pot(x0 + 0.65, y, 2.8, 0.9); pot(x1 - 0.55, y, 2.6, 1.05);
      if (MD.mid_century_lounge_chair) spots.lounge.push(spot(x1 - 1.3, y, 0.6, -0.6)); else chairSpots.push([x0 + 0.8, y, 0.2, 0.9]);
      print("interior", cx, y + 1.9, bw, 1.2, 0.85);
    }
  };

  plan.rooms.forEach((r, ri) => {
    const y = r.y, cx = (r.x0 + r.x1) / 2, w = r.x1 - r.x0, kind = kindOf(r.id, ri), walls = TIMBER.has(kind) ? "timber" : "plaster";
    fp.push(bx(r.x0 + 0.07, r.x1 - 0.07, y, y + 0.025, ZB, ZF - 0.05, "#ffffff", (p) => [p.x / 1.6, p.z / 1.6]));
    (walls === "timber" ? tp : pp).push(bx(r.x0 + 0.07, r.x1 - 0.07, y, y + H - SLAB, ZB, ZB + 0.03, "#ffffff", walls === "timber" ? (p) => [p.y / 2.2, p.x / 2.2] : cUV));
    const inner = (x) => x > X0 + 0.01 && x < X1 - 0.01 && !(terBeside && r.floor === topF && Math.abs(x - T.x0) < 0.01); // a partition with a doorway
    // skirting: a dark timber line along the back wall and both ends, broken at a doorway
    const SK = "#46392f", e0 = r.x0 + 0.07, e1 = r.x1 - 0.07;
    pnt.push(bx(e0, e1, y + 0.02, y + 0.11, ZB + 0.03, ZB + 0.05, SK));
    for (const [xa, xb, x] of [[e0, e0 + 0.02, r.x0], [e1 - 0.02, e1, r.x1]]) {
      if (inner(x)) pnt.push(bx(xa, xb, y + 0.02, y + 0.11, ZB + 0.03, DW0 - 0.07, SK), bx(xa, xb, y + 0.02, y + 0.11, DW1 + 0.07, ZF - 0.5, SK));
      else pnt.push(bx(xa, xb, y + 0.02, y + 0.11, ZB + 0.03, ZF - 0.5, SK));
    }
    // the front: floor-to-ceiling glass between the piers in slim dark frames, a mullion about every metre and a half
    {
      const top = y + H - SLAB, g0 = r.x0 + 0.13, g1 = r.x1 - 0.13, n = Math.max(2, Math.round((g1 - g0) / 1.5));
      gp.push({ geo: new THREE.PlaneGeometry(g1 - g0, top - y - 0.1), m: at((g0 + g1) / 2, (y + top) / 2, GZ) });
      op.push(bx(g0, g1, top - 0.07, top, GZ - 0.06, GZ + 0.06), bx(g0, g1, y + 0.02, y + 0.07, GZ - 0.06, GZ + 0.06));
      for (let k = 0; k <= n; k++) { const x = g0 + k * (g1 - g0) / n, e = k === 0 || k === n; op.push(bx(x - (e ? 0.03 : 0.022), x + (e ? 0.03 : 0.022), y + 0.07, top - 0.07, GZ - 0.055, GZ + 0.055)); }
    }
    const ceil = y + H - SLAB;
    const nP = Math.max(2, Math.round(w / 2.6));
    for (let i = 0; i < nP; i++) { const px = r.x0 + (i + 0.5) * w / nP; pendants.push({ room: r.id, x: px, y: ceil, z: 0.9 }); if (!MD.modern_ceiling_lamp_01) op.push(bx(px - 0.004, px + 0.004, ceil - 0.75, ceil, 0.9 - 0.004, 0.9 + 0.004)); }
    const room = { id: r.id, ri, y, cx, w, agents: [], hover: 0, open: 0, hoverT: 0, openT: 0, flash: 0, dim: false,
      label: new THREE.Vector3(r.x0 + 0.3, ceil - 0.25, ZF - 0.1), centre: new THREE.Vector3(cx, y + 1.3, 0), x0: r.x0, x1: r.x1, floor: r.floor,
      box: new THREE.Box3(new THREE.Vector3(r.x0, y, ZB), new THREE.Vector3(r.x1, ceil, ZF + 0.4)) };
    rooms[r.id] = room;
    r.desks.forEach((d, i) => {
      const dx = d.x, dz = d.z, dy = y + 0.025;
      if (MD.wooden_table_02) spots.table.push(spot(dx, dy, dz, 0, 1.32, 0.94, 1.15));
      else { dk.push(bx(dx - 0.75, dx + 0.75, dy + 0.71, dy + 0.75, dz - 0.4, dz + 0.4, "#ffffff", boxUV(1.2))); for (const sd of [-1, 1]) op.push(bx(dx + sd * 0.68 - 0.02, dx + sd * 0.68 + 0.02, dy, dy + 0.71, dz - 0.36, dz + 0.36)); }
      pap.push({ geo: new THREE.BoxGeometry(0.3, 0.006, 0.42), m: at(dx + 0.3, dy + 0.755, dz + 0.1, 0.14 + i * 0.3) });
      pap.push({ geo: new THREE.BoxGeometry(0.3, 0.006, 0.42), m: at(dx + 0.34, dy + 0.761, dz + 0.07, -0.06 + i * 0.2) });
      if (!small) { // a laptop, open toward the chair
        const lr = (i % 2 ? 0.1 : -0.08);
        pnt.push({ geo: new THREE.BoxGeometry(0.33, 0.014, 0.23), m: at(dx - 0.08, dy + 0.759, dz - 0.05, lr), c: col("#8d9094") });
        pnt.push({ geo: new THREE.BoxGeometry(0.33, 0.22, 0.008), m: at(dx - 0.08 + Math.sin(lr) * 0.14, dy + 0.865, dz - 0.05 + Math.cos(lr) * 0.14, lr, 0.28), c: col("#8d9094") });
      }
      const ag = { slug: d.slug, i: Object.keys(agents).length, room, light: 0, target: 0, lightFrom: 0, colourKind: "off", fold: 0, foldTarget: 0, foldFrom: 0, t: 1, wait: 0, boost: 0,
        desk: new THREE.Vector3(dx, dy + 0.78, dz), chair: { x: dx + 0.1, y: dy, z: dz - 0.85, ry: i % 2 ? 0.18 : -0.14 },
        tag: new THREE.Vector3(dx + 0.3, dy + 1.25, dz + 0.3), lampAt: new THREE.Vector3(dx - 0.58, dy + 0.75, dz - 0.22) };
      agents[d.slug] = ag; room.agents.push(ag);
    });
    furnish(kind, r, y);
  });
  // planters on the terrace
  if (T) { const tw = T.x1 - T.x0; for (const [fx, z] of [[0.2, -2.6], [0.8, -2.6], [0.85, 2.6], [0.15, 2.9]]) pot(T.x0 + 0.5 + fx * (tw - 1), terY + 0.03, z, 1.1); }

  // ---- the pavilion: App Studio on the terrace, glazed, one bench per app ----
  let pav = null;
  if (T) {
    const p0 = T.x0 + 0.55, p1 = Math.min(T.x1 - 0.45, p0 + 4.4), pz0 = -2.2, pz1 = 1.7, ph = 2.5, y = terY;
    tp.push(cbx(p0 - 0.25, p1 + 0.25, y + ph, y + ph + 0.12, pz0 - 0.25, pz1 + 0.35, 0.01, "#ffffff", (p) => [p.z / 2.2, p.x / 2.2]));
    op.push(bx(p0 - 0.27, p1 + 0.27, y + ph + 0.12, y + ph + 0.14, pz0 - 0.27, pz1 + 0.37));
    for (const [x, z] of [[p0, pz0], [p1, pz0], [p0, pz1], [p1, pz1]]) op.push(bx(x - 0.035, x + 0.035, y, y + ph, z - 0.035, z + 0.035));
    for (let k = 1; k < 4; k++) { const x = p0 + k * (p1 - p0) / 4; op.push(bx(x - 0.018, x + 0.018, y, y + ph, pz1 - 0.03, pz1 + 0.03)); }
    for (const z of [pz0, pz1]) op.push(bx(p0, p1, y + ph - 0.05, y + ph, z - 0.03, z + 0.03), bx(p0, p1, y + 0.03, y + 0.07, z - 0.03, z + 0.03));
    fp.push(bx(p0, p1, y, y + 0.04, pz0, pz1, "#ffffff", (p) => [p.x / 1.6, p.z / 1.6]));
    const gl = [new THREE.PlaneGeometry(p1 - p0, ph), new THREE.PlaneGeometry(pz1 - pz0, ph)];
    const panes = new THREE.Group();
    const front = new THREE.Mesh(gl[0], glass); front.position.set((p0 + p1) / 2, y + ph / 2, pz1); panes.add(front);
    const back = new THREE.Mesh(gl[0], glass); back.position.set((p0 + p1) / 2, y + ph / 2, pz0); panes.add(back);
    for (const x of [p0, p1]) { const s = new THREE.Mesh(gl[1], glass); s.position.set(x, y + ph / 2, (pz0 + pz1) / 2); s.rotation.y = Math.PI / 2; panes.add(s); }
    panes.traverse((o) => { o.renderOrder = 3; });
    root.add(panes);
    const benches = [];
    const bwid = (p1 - p0 - 0.4) / BENCHES;
    for (let k = 0; k < BENCHES; k++) {
      const x = p0 + 0.2 + (k + 0.5) * bwid;
      benches.push({ x, y: y + 0.04, z: -0.6, on: 0, onT: 0, amber: 0, amberT: 0, shown: false });
    }
    pav = { x0: p0, x1: p1, y, h: ph, benches, bwid, centre: new THREE.Vector3((p0 + p1) / 2, y + 1.2, -0.2) };
  }
  // the stair core: a slim lit slot at the front of the left end, warm while the company brain is asked something
  const coreM = new THREE.MeshBasicMaterial({ color: OFF_GLOW });
  owned.mats.add(coreM);
  { const g = new THREE.BoxGeometry(0.05, roofY - SLAB - Y0 - 0.2, 0.05); const core = new THREE.Mesh(g, coreM); core.position.set(X0 - 0.215, (Y0 + roofY - SLAB) / 2, ZF - 0.7); core.userData.glow = true; root.add(core); }

  // merge the static parts, one draw per material
  const add = (parts, mat) => { if (!parts.length) return null; const m = new THREE.Mesh(merge(parts), mat); root.add(m); return m; };
  add(cp, concrete); add(pp, plaster); add(wp, clad); add(tp, timber); add(fp, oak); add(op, steel); add(dk, deskOak); add(fab, fabric); add(pnt, paint); add(pap, paperM);
  // the glazing: drawn after the rooms behind it
  { const gm = add(gp, glazing); if (gm) gm.renderOrder = 2; }
  const printMats = {};
  const printMat = (n) => printMats[n] || (printMats[n] = keyed(lit(std({ map: A.prints[n], roughness: 0.6, envMapIntensity: 0.3 })), "b-print"));
  for (const p of prints) { if (!A.prints[p.n]) continue; const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), printMat(p.n)); m.position.set(p.x, p.y, p.z + 0.014); if (p.rx) m.rotation.x = p.rx; root.add(m); }
  for (const m of Object.values(printMats)) owned.mats.add(m);

  // furniture models, instanced: one draw per part of each model
  const modelMat = (src, env, spill = 0) => { const m = src.clone(); m.envMapIntensity = env; owned.mats.add(m); return keyed(lit(m, spill), `b-model${spill}${m.alphaTest > 0 ? "a" : ""}`); };
  const meshesOf = (gltf) => { const out = []; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse((o) => { if (o.isMesh) out.push(o); }); return out; };
  // every part of a model at every spot (a Matrix4 each)
  const instAll = (gltf, list, { env = 0.5, tint = null, skip = null, pale = false } = {}) => {
    if (!gltf || !list.length) return [];
    return meshesOf(gltf).filter((n) => !(skip && skip.test(n.material.name || ""))).map((n) => {
      const mat = pale ? keyed(lit(grade(Object.assign(n.material.clone(), { envMapIntensity: env }), 0.4, 1.25, 0.9, "#f3e6d2")), "b-modelpale") : modelMat(n.material, env);
      if (pale) owned.mats.add(mat);
      if (tint) mat.color.multiply(tint);
      const im = new THREE.InstancedMesh(n.geometry, mat, list.length);
      list.forEach((m, j) => im.setMatrixAt(j, M0.multiplyMatrices(m, n.matrixWorld)));
      root.add(im);
      return { im, local: n.matrixWorld.clone() };
    });
  };
  const M0 = new THREE.Matrix4();
  const instanceNodes = (gltf, list, tint, env, seed) => {
    if (!gltf || !list.length) return;
    const nodes = meshesOf(gltf);
    const by = nodes.map(() => []);
    const r2 = rng(seed);
    list.forEach(([x, y, z, s], i) => by[i % nodes.length].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r2() * 6.28, 0)), new THREE.Vector3(s, s, s))));
    nodes.forEach((n, k) => {
      if (!by[k].length) return;
      const mat = modelMat(n.material, env); mat.color.copy(tint); mat.side = THREE.DoubleSide;
      const im = new THREE.InstancedMesh(n.geometry, mat, by[k].length);
      const local = n.matrixWorld.clone().setPosition(0, 0, 0);
      by[k].forEach((m, j) => im.setMatrixAt(j, m.clone().multiply(local)));
      root.add(im);
    });
  };
  instanceNodes(A.models.fern_02, fernSpots, new THREE.Color(0.42, 0.5, 0.36), 0.3, 3);
  instAll(MD.dining_chair_02, spots.chair);
  instAll(MD.wooden_table_02, spots.table, { pale: true });
  instAll(MD.potted_plant_02, spots.plant, { env: 0.4 });
  instAll(MD.modern_wooden_cabinet, spots.cabinet);
  instAll(MD.sofa_02, spots.sofa, { tint: col("#b9b2a8") });
  instAll(MD.mid_century_lounge_chair, spots.lounge);
  const placeModel = (gltf, list) => { if (gltf) instAll(gltf, list.map(([x, y, z, ry]) => spot(x, y, z, ry))); };
  if (!small) {
    placeModel(A.models.modern_arm_chair_01, chairSpots);
    placeModel(A.models.modern_coffee_table_01, coffeeSpots);
  }

  // pendants: an opal globe on a slim stem (the model), or in the small model a dark shade with a glowing underside;
  // either lights up with its room
  const pendGlowM = new THREE.MeshBasicMaterial({ color: WHITE });
  owned.mats.add(pendGlowM);
  let pendGlow = null;
  if (pendants.length) {
    const lamp = MD.modern_ceiling_lamp_01;
    if (lamp) {
      const list = pendants.map((p) => spot(p.x, p.y - 1.17 * 0.9, p.z, 0, 0.9));
      for (const n of meshesOf(lamp)) {
        const name = n.material.name || "";
        if (/globe/.test(name)) continue; // the bulb inside the opal shade: the shade itself glows
        const glow = /glass/.test(name);
        const im = new THREE.InstancedMesh(n.geometry, glow ? pendGlowM : shadeM, list.length);
        list.forEach((m, j) => { im.setMatrixAt(j, M0.multiplyMatrices(m, n.matrixWorld)); if (glow) im.setColorAt(j, OFF_GLOW); });
        im.userData.glow = true;
        if (glow) pendGlow = im;
        root.add(im);
      }
    } else {
      const pend = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.2, 0.16, 24, 1, true), shadeM, pendants.length);
      pendGlow = new THREE.InstancedMesh(new THREE.CircleGeometry(0.19, 24), pendGlowM, pendants.length);
      pendants.forEach((p, i) => { pend.setMatrixAt(i, at(p.x, p.y - 0.82, p.z)); pendGlow.setMatrixAt(i, at(p.x, p.y - 0.899, p.z, 0, Math.PI / 2)); pendGlow.setColorAt(i, OFF_GLOW); });
      pend.userData.glow = pendGlow.userData.glow = true;
      root.add(pend, pendGlow);
    }
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
    lampMeshes = lampGeos().map((g, i) => { if (i === 4) g.setAttribute("aGlow", new THREE.InstancedBufferAttribute(new Float32Array(N), 1)); const im = new THREE.InstancedMesh(g, i === 4 ? lampShadeM : i === 5 ? glowMats[0] : i === 6 ? glowMats[1] : steel, N); if (i >= 5) im.userData.glow = true; root.add(im); return im; });
    for (const im of [lampMeshes[5], lampMeshes[6]]) for (let k = 0; k < N; k++) im.setColorAt(k, OFF_GLOW);
    for (const ag of AG) { ag.rig = lampRig(); ag.rig.g.position.copy(ag.lampAt); ag.rig.g.rotation.y = -0.35; ag.rig.g.scale.setScalar(LAMP_SCALE); rigRoot.add(ag.rig.g); }
    if (MD.dining_chair_02) chairMeshes = instAll(MD.dining_chair_02, AG.map(() => new THREE.Matrix4()));
    else {
      const chairGeos = [new THREE.BoxGeometry(0.48, 0.08, 0.46), new THREE.BoxGeometry(0.46, 0.46, 0.07), new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8), new THREE.CylinderGeometry(0.25, 0.27, 0.03, 20)];
      const locals = [[0, 0.46, 0], [0, 0.74, -0.22], [0, 0.21, 0], [0, 0.02, 0]];
      chairMeshes = chairGeos.map((g, i) => { const im = new THREE.InstancedMesh(g, i < 2 ? chairFab : steel, N); if (i < 2) for (let k = 0; k < N; k++) im.setColorAt(k, col("#3a3532")); root.add(im); return { im, local: new THREE.Matrix4().makeTranslation(...locals[i]) }; });
    }
  }
  const M4 = new THREE.Matrix4(), V = new THREE.Vector3();
  function placeLamp(ag) {
    const f = ease(ag.fold);
    ag.rig.setPose(f);
    ag.rig.g.updateMatrixWorld(true);
    ag.rig.parts.forEach((pt, k) => { lampMeshes[k].setMatrixAt(ag.i, pt.matrixWorld); lampMeshes[k].instanceMatrix.needsUpdate = true; });
    ag.rig.head.getWorldPosition(V); ag.head = V.clone();
    const c = ag.chair, z = c.z + f * 0.5;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(c.x, c.y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, c.ry * (1 - ag.fold), 0)), ONE);
    for (const c2 of chairMeshes) { c2.im.setMatrixAt(ag.i, M4.multiplyMatrices(base, c2.local)); c2.im.instanceMatrix.needsUpdate = true; }
  }

  // ---- the doors: a leaf that slides open, the light behind it, and a small amber mark when Settings would refuse ----
  const doors = {};
  const doorLeaf = keyed(lit(grade(new THREE.MeshStandardMaterial({ map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughness: 0.6, color: col("#ffffff"), envMapIntensity: 0.5 }), 0.7, 1.0, 1.05, "#d6ab82"), 1), "b-doorleaf");
  const doorShut = keyed(lit(grade(new THREE.MeshStandardMaterial({ map: tex.planks_brown_10_diff, normalMap: tex.planks_brown_10_nor, roughness: 0.6, color: col("#ffffff"), envMapIntensity: 0.5 }), 0.5, 0.42, 1.0, "#b89878"), 1), "b-doorleaf");
  owned.mats.add(doorLeaf); owned.mats.add(doorShut);
  const leafGeo = new THREE.BoxGeometry(DOOR_W - 0.02, DOOR_H - 0.02, 0.05), glowGeo = new THREE.PlaneGeometry(DOOR_W - 0.02, DOOR_H - 0.02, 1, 6), markGeo = new THREE.BoxGeometry(0.16, 0.05, 0.03);
  { const p = glowGeo.attributes.position, c = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const t = p.getY(i) / (DOOR_H - 0.02) + 0.5, v = 0.16 + 0.84 * t * t; c.set([v, v * (0.82 + 0.18 * t), v * (0.62 + 0.38 * t)], i * 3); } glowGeo.setAttribute("color", new THREE.BufferAttribute(c, 3)); }
  plan.annex.doors.forEach((d) => {
    const glowM = new THREE.MeshBasicMaterial({ color: WARM.clone(), vertexColors: true }), markM = new THREE.MeshBasicMaterial({ color: LAMP_COLOURS.amber.clone().multiplyScalar(4) });
    owned.mats.add(glowM); owned.mats.add(markM);
    const glow = new THREE.Mesh(glowGeo, glowM); glow.position.set(d.x, Y0 + DOOR_H / 2, ZF - 0.45); glow.userData.glow = true;
    const leaf = new THREE.Mesh(leafGeo, doorShut);
    const mark = new THREE.Mesh(markGeo, markM); mark.userData.glow = true; mark.position.set(d.x, Y0 + DOOR_H + 0.14, ZF - 0.08); mark.visible = false;
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
    bulb.userData.glow = strip.userData.glow = true;
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
      benchMeshes.bulb.setColorAt(k, am > 0.01 ? LAMP_COLOURS.amber.clone().multiplyScalar(9 * am) : OFF_GLOW);
      benchMeshes.strip.setColorAt(k, on > 0.01 ? LAMP_COLOURS.on.clone().multiplyScalar(6 * on) : OFF_GLOW);
      warm += on;
    });
    for (const m of Object.values(benchMeshes)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    const I = Math.min(1.3, warm * 0.6) * (dark ? 0 : 1);
    // the glass takes a warm cast while an app is on, so the pavilion reads from across the forecourt
    glass.emissive.copy(WARM).multiplyScalar(Math.min(1, warm) * 0.05 * (dark ? 0 : 1));
    RL.uRoomCol.value[pavIndex].set(WARM.r * I, WARM.g * I, WARM.b * I);
  }

  // ---- light uniforms: rooms in plan order, then the annex, then the pavilion ----
  const roomList = Object.values(rooms);
  const annexIndex = roomList.length, pavIndex = roomList.length + 1;
  let lampAt = 0;
  roomList.forEach((rm) => {
    RL.uRoomBox.value[rm.ri].set(rm.x0, rm.x1, rm.y, H - SLAB + 0.05);
    RL.uRoomInfo.value[rm.ri].set(lampAt, rm.agents.length);
    rm.agents.forEach((ag, k) => { ag.slot = lampAt + k; });
    lampAt += rm.agents.length;
  });
  RL.uRoomBox.value[annexIndex].set(X1 + 0.07, DX1, Y0, H - SLAB);
  if (plan.empty) RL.uRoomBox.value[NR - 1].set(X0, X1, Y0, H - SLAB + 0.05); // the empty hall: dim, unlit (the spare slot)
  if (pav) RL.uRoomBox.value[pavIndex].set(pav.x0, pav.x1, pav.y, pav.h + 0.12);
  RL.uPavI.value = pavIndex;
  RL.uSpill.value.set(X0 - 4.5, DX1 + 4.5);

  let dark = false, asking = false, day = false;
  function applyRoom(rm) {
    let lit2 = 0; const warm = new THREE.Color(0, 0, 0);
    for (const ag of rm.agents) { lit2 += ag.light; warm.add((LAMP_COLOURS[ag.colourKind] || LAMP_COLOURS.on).clone().multiplyScalar(ag.light)); }
    const n = Math.max(1, rm.agents.length), k = lit2 / n;
    if (lit2 > 0) warm.multiplyScalar(1 / lit2); else warm.copy(WARM);
    warm.lerp(WARM, 0.5);
    const glow = Math.min(1, lit2) * 0.7 + k * 0.5;
    // a room nobody works in keeps a low light on, so the house never reads as a ruin; a working room is bright
    const I = dark ? 0.012 : 0.5 + glow * 1.5 + rm.hover * 0.45 + rm.open * 0.2 + rm.flash * 0.9;
    RL.uRoomCol.value[rm.ri].set(warm.r * I, warm.g * I, warm.b * I);
    if (pendGlow) {
      pendants.forEach((p, i) => { if (p.room === rm.id) pendGlow.setColorAt(i, dark ? OFF_GLOW : WARM.clone().multiplyScalar(1.1 + glow * 5 + rm.hover * 1.5)); });
      pendGlow.instanceColor.needsUpdate = true;
    }
  }
  function applyAgent(ag) {
    placeLamp(ag);
    const c = LAMP_COLOURS[ag.colourKind];
    const k = ag.light * (1 + ag.boost * 1.4);
    lampMeshes[5].setColorAt(ag.i, c && k > 0 ? c.clone().multiplyScalar(2.4 * k) : OFF_GLOW);
    lampMeshes[6].setColorAt(ag.i, c && k > 0 ? c.clone().multiplyScalar(10 * k) : OFF_GLOW);
    lampMeshes[5].instanceColor.needsUpdate = lampMeshes[6].instanceColor.needsUpdate = true;
    // the shade: in the morning its paint follows the light from pale toward the state's colour, and glows with it
    const lk = Math.min(1, ag.light / 0.85), [paint, glow] = shadeOf(c ? ag.colourKind : "off", day);
    lampMeshes[4].setColorAt(ag.i, (day ? SHADE_DAY.off : SHADE_DUSK).clone().lerp(paint, lk));
    lampMeshes[4].instanceColor.needsUpdate = true;
    const ga = lampMeshes[4].geometry.attributes.aGlow; ga.array[ag.i] = glow * lk; ga.needsUpdate = true;
    const L = RL.uLamp.value[ag.slot];
    if (c && k > 0) { L.set(ag.head.x, ag.head.y - 0.08, ag.head.z, 1); RL.uLampCol.value[ag.slot].set(c.r, c.g, c.b).multiplyScalar(4.2 * k); }
    else L.w = 0;
  }
  function applyDoor(d) {
    const o = ease(d.open);
    d.leaf.position.set(d.x - o * (DOOR_W - 0.06), Y0 + DOOR_H / 2, d.z);
    d.leaf.material = o > 0.5 ? doorLeaf : doorShut;
    d.glowM.color.copy(WARM).multiplyScalar(dark ? 0.02 : 0.05 + 1.6 * o);
    d.mark.visible = d.state === "blocked";
  }
  function applyDoors() { let o = 0; for (const id in doors) o += doors[id].open; RL.uRoomCol.value[annexIndex].set(WARM.r, WARM.g, WARM.b).multiplyScalar(dark ? 0.01 : o * 0.5 + 0.02); }
  function applyCore() { coreM.color.copy(asking && !dark ? WARM : OFF_GLOW).multiplyScalar(asking && !dark ? 5 : 1); }

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
  sheet.visible = false; sheet.userData.glow = true; root.add(sheet);
  let pathMesh = null;
  const flights = [];
  const SEG = 80;
  // from and to are { desk point } holders: agents, or any point with `room` to flash
  function fly(p0, p3, { still = false, dur = 900, onArrive, to = null, lift = 0.7 } = {}) {
    const p1 = new THREE.Vector3(p0.x, p0.y + lift, ZF + 1.0), p2 = new THREE.Vector3(p3.x, p3.y + lift, ZF + 1.0);
    const curve = new THREE.CubicBezierCurve3(p0.clone(), p1, p2, p3.clone());
    if (pathMesh) { root.remove(pathMesh); pathMesh.geometry.dispose(); }
    pathMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, SEG, 0.05, 6, false), pathM);
    pathMesh.geometry.setDrawRange(0, 0); pathMesh.visible = !still; pathMesh.userData.glow = true; root.add(pathMesh);
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

  // everything solid throws and takes shadow, and hides the ceiling's light; glass and what glows do neither
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const solid = !o.userData.glow && !(m && (m.transparent || m.isMeshBasicMaterial));
    o.castShadow = solid; o.receiveShadow = solid;
    if (solid) o.layers.enable(SHADE_LAYER);
  });
  // what the ceiling's shadow map covers: the building's footprint, a storey at a time, cut just under the slab above
  const vol = { x0: X0 - 0.3, x1: DX1 + 0.3, z0: ZB - 0.35, z1: ZF + 0.5, floors: Array.from({ length: storeys }, (_, f) => ({ y0: yOf(f), y1: yOf(f) + H - SLAB - 0.03 })) };

  for (const ag of AG) applyAgent(ag);
  for (const rm of roomList) applyRoom(rm);
  for (const id in doors) applyDoor(doors[id]);
  applyDoors(); applyBenches(); applyCore();

  return {
    root, rooms, agents, doors, pav, RL, annexBox, vol,
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
    sync() {
      root.updateMatrixWorld(true);
      RL.uBInv.value.copy(root.matrixWorld).invert();
    },
    geoMoved: () => geo,
    dispose() {
      root.traverse((o) => { if (o.geometry) owned.geos.add(o.geometry); });
      if (pathMesh) owned.geos.add(pathMesh.geometry);
      for (const g of owned.geos) g.dispose();
      for (const m of owned.mats) m.dispose();
      for (const im of lampMeshes) im.dispose();
      root.removeFromParent();
    },
  };
}
