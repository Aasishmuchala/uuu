// The light inside the studio (PLAN-3D T6, from the approved prototype's world.js): each room's light and each desk
// lamp reach only their own room, and the arm lamp that says what an agent is doing.
//
// A point light would shine through partitions and slabs. Here every interior surface asks which room it is in and
// takes light only from that room's ceiling glow and its own desk lamps; the forecourt takes the light that falls out
// of the open fronts on the ground floor. The same code lights the small model on the owner's desk.
//
// There are no shadow maps (D21). The sun's shadow of the building is found per pixel instead: a ray toward the sun
// against the building's solid boxes (the body, the top floor beside the terrace, the annex), and nothing inside a room is reached by the sun.
// Shader text is built from constants only; the state enters as uniforms (D9).
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { ROOM_Z, MAX_ROOMS, MAX_DESKS } from "../layout.js";

export const NR = MAX_ROOMS + 3;               // the rooms, the annex, the pavilion, one spare
export const NL = MAX_ROOMS * MAX_DESKS + 1;   // every desk lamp, and the sheet in flight (the last)
export const CARRY = NL - 1;
export const [ZB, ZF] = ROOM_Z;

const col = (h) => new THREE.Color(h);
export const LAMP_COLOURS = { on: col("#ffcf96"), amber: col("#ff9a36"), red: col("#ff4f36") };
export const OFF_GLOW = col("#2b2622");
export const WARM = col("#ffb070");
// In the morning (T12) a lamp's state has to read without darkness: the shade itself takes the state's colour and
// glows a little (on, amber, red); off is a pale shade; down is a pale shade on the folded arm. At dusk every shade
// stays the dark lacquer it has always had, and only the light inside it speaks.
export const SHADE_DUSK = col("#2f3a35");
// (the paints are kept below white, so the tone mapping cannot wash amber and red to the same pale yellow)
export const SHADE_DAY = { on: col("#e3a43a"), amber: col("#d4520a"), red: col("#b01a10"), off: col("#d9d3c9") };
export const SHADE_GLOW = { on: 0.3, amber: 0.45, red: 0.5, off: 0 };

export function makeRoomLight() {
  return {
    uBInv: { value: new THREE.Matrix4() },
    uRoomBox: { value: Array.from({ length: NR }, () => new THREE.Vector4(0, -1, -100, 0)) },
    uRoomPos: { value: Array.from({ length: NR }, () => new THREE.Vector3()) },
    uRoomCol: { value: Array.from({ length: NR }, () => new THREE.Vector3()) },
    uRoomInfo: { value: Array.from({ length: NR }, () => new THREE.Vector2(0, 0)) },
    uLamp: { value: Array.from({ length: NL }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLampCol: { value: Array.from({ length: NL }, () => new THREE.Vector3()) },
    uSunL: { value: new THREE.Vector3(0, 1, 0) },
    uSolidA: { value: Array.from({ length: 3 }, () => new THREE.Vector3(0, -100, 0)) },
    uSolidB: { value: Array.from({ length: 3 }, () => new THREE.Vector3(0, -99, 0)) },
    uSpill: { value: new THREE.Vector2(-14, 15) },
    // the key's inside (dusk.js): x how far an unlit room's daylight falls, y a lamp pool's strength, z the sun into the rooms
    uDay: { value: new THREE.Vector3(0.35, 1, 0) },
  };
}

const RL_HEAD = `
uniform mat4 uBInv; uniform vec4 uRoomBox[${NR}]; uniform vec3 uRoomPos[${NR}]; uniform vec3 uRoomCol[${NR}]; uniform vec2 uRoomInfo[${NR}];
uniform vec4 uLamp[${NL}]; uniform vec3 uLampCol[${NL}];
uniform vec3 uSunL; uniform vec3 uSolidA[3]; uniform vec3 uSolidB[3]; uniform vec2 uSpill; uniform vec3 uDay;
varying vec3 vRW;
int roomOf(vec3 p){
  int ri = -1;
  for (int i = 0; i < ${NR}; i++) { vec4 b = uRoomBox[i]; if (p.x > b.x - .09 && p.x < b.y + .09 && p.y > b.z - .06 && p.y < b.z + b.w && p.z > ${(ZB - 0.45).toFixed(2)} && p.z < ${(ZF + 0.3).toFixed(2)}) ri = i; }
  return ri;
}
float sunVis(vec3 p, int ri){
  // inside a room the sun reaches only what sees it through the open front: the ray toward the sun must leave the
  // room's box through the cut before it meets the ceiling or an end wall (the morning's sun patches, T12)
  if (ri >= 0) {
    if (uDay.z < .01 || uSunL.z <= 0.) return 0.;
    vec4 b = uRoomBox[ri];
    float tz = (${ZF.toFixed(2)} - p.z) / uSunL.z;
    float tx = uSunL.x > 0. ? (b.y - p.x) / uSunL.x : uSunL.x < 0. ? (b.x - p.x) / uSunL.x : 1e5;
    float ty = uSunL.y > 0. ? (b.z + b.w - .3 - p.y) / uSunL.y : 1e5;
    return (tz < tx + .02 && tz < ty) ? uDay.z : 0.;
  }
  vec3 inv = 1. / (uSunL + vec3(1e-5));
  for (int i = 0; i < 3; i++) {
    vec3 t0 = (uSolidA[i] - p) * inv, t1 = (uSolidB[i] - p) * inv;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float a = max(max(tn.x, tn.y), tn.z), b = min(min(tf.x, tf.y), tf.z);
    if (b > max(a, .04)) return 0.;
  }
  return 1.;
}
// The corners of a room fall dark (T11, analytic, no shadow map): of the distances to the room's floor or ceiling,
// its two ends and its back wall, the smallest is the surface's own plane; the second smallest is the nearest corner.
// The far ends of a long room fall off a little too, so the light pools at its middle and under its lamps.
float roomAO(vec3 p, int ri){
  vec4 b = uRoomBox[ri];
  float dx = min(p.x - b.x, b.y - p.x), dy = min(p.y - b.z, b.z + b.w - p.y), dz = p.z - ${ZB.toFixed(2)};
  float s2 = max(min(dx, dy), min(max(dx, dy), dz));
  float ends = smoothstep(.3, .5, abs(p.x - (b.x + b.y) * .5) / max(b.y - b.x, 1.));
  return mix(.42, 1., smoothstep(.0, .85, s2)) * (1. - .3 * ends);
}
vec3 roomLight(vec3 p, vec3 n, int ri, float spill){
  vec3 acc = vec3(0.);
  // the sheet in flight carries its own light, everywhere
  vec4 c = uLamp[${CARRY}];
  if (c.w > .5) { vec3 L = c.xyz - p; float d2 = dot(L, L); acc += uLampCol[${CARRY}] * max(dot(n, L * inversesqrt(d2)), 0.) / (1. + d2 * 1.2); }
  if (ri >= 0) {
    vec3 L = uRoomPos[ri] - p; float d2 = dot(L, L); acc += uRoomCol[ri] * (max(dot(n, L * inversesqrt(d2)), 0.) * .7 + .3) / (1. + d2 * .09);
    int s = int(uRoomInfo[ri].x + .5), m = int(uRoomInfo[ri].y + .5);
    for (int k = 0; k < ${MAX_DESKS}; k++) {
      if (k >= m) break;
      vec4 l = uLamp[s + k]; if (l.w < .5) continue;
      vec3 Lj = l.xyz - p; float e2 = dot(Lj, Lj); vec3 Ld = Lj * inversesqrt(e2);
      acc += uLampCol[s + k] * uDay.y * max(dot(n, Ld), 0.) * smoothstep(.42, .72, Ld.y) / (1. + e2 * 1.8);
    }
  } else if (spill > .5 && p.z > ${(ZF - 0.3).toFixed(2)} && p.z < ${(ZF + 16).toFixed(2)} && p.x > uSpill.x && p.x < uSpill.y) {
    for (int i = 0; i < ${NR}; i++) { vec4 b = uRoomBox[i]; if (b.y < b.x || b.z > 1.) continue;
      vec3 q = vec3(clamp(p.x, b.x, b.y), b.z + 1.4, ${ZF.toFixed(2)}); vec3 L = q - p; float d2 = dot(L, L);
      acc += uRoomCol[i] * .5 * max(dot(n, L * inversesqrt(d2)), 0.) / (1. + d2 * .1); }
  }
  return acc;
}`;

// Make a material take the room light, and the sun only where the building does not hide it.
export function roomLit(mat, RL, spill = 0) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, RL);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vRW;").replace("#include <project_vertex>", `#include <project_vertex>
      { vec4 rw = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        rw = instanceMatrix * rw;
      #endif
      vRW = (modelMatrix * rw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\n${RL_HEAD}`).replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
      { vec3 bp = (uBInv * vec4(vRW, 1.)).xyz; vec3 bn = normalize(mat3(uBInv) * inverseTransformDirection(normal, viewMatrix));
        int ri = roomOf(bp); float sv = sunVis(bp, ri);
        reflectedLight.directDiffuse *= sv; reflectedLight.directSpecular *= sv;
        // a room whose lamps are off falls dim: the sky's light inside it follows the room's own glow
        float ao = 1.;
        if (ri >= 0) { ao = roomAO(bp, ri); float k = mix(uDay.x, 1., clamp(length(uRoomCol[ri]) * .5, 0., 1.)) * ao; reflectedLight.indirectDiffuse *= k; reflectedLight.indirectSpecular *= k; }
        reflectedLight.directDiffuse += roomLight(bp, bn, ri, ${spill.toFixed(1)}) * diffuseColor.rgb * ao; }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => "";
  mat.customProgramCacheKey = () => `rl${spill}|${key()}`;
  return mat;
}

// The shade of the instanced lamps: the instance colour is the shade's paint, and `aGlow` (one number a lamp) how
// much of it glows. Its own program key, since the shader differs from the plain one.
export function shadeLit(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aGlow; varying float vGlow;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vGlow;").replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      #ifdef USE_COLOR
      totalEmissiveRadiance += vColor * vGlow;
      #endif`);
  };
  return mat;
}
export function shadeOf(kind, day) {
  if (!day) return [SHADE_DUSK, 0];
  return [SHADE_DAY[kind] || SHADE_DAY.off, SHADE_GLOW[kind] || 0];
}

// ---------- the desk lamp: an articulated arm lamp ----------
export function lampRig() {
  const g = new THREE.Group();
  const j1 = new THREE.Group(); j1.position.y = 0.03; g.add(j1);
  const a1 = new THREE.Object3D(); a1.position.y = 0.23; j1.add(a1);
  const j2 = new THREE.Group(); j2.position.y = 0.46; j1.add(j2);
  const kn = new THREE.Object3D(); j2.add(kn);
  const a2 = new THREE.Object3D(); a2.position.y = 0.21; j2.add(a2);
  const j3 = new THREE.Group(); j3.position.y = 0.42; j2.add(j3);
  const sh = new THREE.Object3D(); sh.position.y = -0.06; j3.add(sh);
  const bulb = new THREE.Object3D(); bulb.position.y = -0.1; j3.add(bulb);
  const base = new THREE.Object3D(); base.position.y = 0.0125; g.add(base);
  const pose = { up: [0.32, -2.05], down: [-1.28, 2.45] };
  return {
    g, parts: [base, a1, kn, a2, sh, sh, bulb], head: j3,
    setPose(p) {
      j1.rotation.z = pose.up[0] + (pose.down[0] - pose.up[0]) * p;
      j2.rotation.z = pose.up[1] + (pose.down[1] - pose.up[1]) * p;
      j3.rotation.z = -(j1.rotation.z + j2.rotation.z) + p * 0.9;
    },
  };
}
export function lampGeos() {
  return [
    new THREE.CylinderGeometry(0.085, 0.095, 0.025, 24), new THREE.CylinderGeometry(0.01, 0.01, 0.46, 8), new THREE.SphereGeometry(0.02, 12, 8),
    new THREE.CylinderGeometry(0.009, 0.009, 0.42, 8), new THREE.CylinderGeometry(0.04, 0.1, 0.16, 28, 1, true), new THREE.CylinderGeometry(0.038, 0.097, 0.158, 28, 1, true),
    new THREE.SphereGeometry(0.034, 14, 10),
  ];
}

// A single lamp as plain meshes (the owner's desk lamp).
export function makeLamp(mats) {
  const rig = lampRig();
  const geos = lampGeos();
  const inner = new THREE.MeshBasicMaterial({ color: OFF_GLOW, side: THREE.BackSide });
  const bulbM = new THREE.MeshBasicMaterial({ color: OFF_GLOW });
  const ms = [mats.steel, mats.steel, mats.steel, mats.steel, mats.shade, inner, bulbM];
  rig.parts.forEach((pt, i) => pt.add(new THREE.Mesh(geos[i], ms[i])));
  rig.setPose(0);
  return {
    group: rig.g, head: rig.head, setPose: rig.setPose,
    setLight(kind, k = 1) {
      const c = LAMP_COLOURS[kind];
      if (!c || k <= 0) { inner.color.copy(OFF_GLOW); bulbM.color.copy(OFF_GLOW); return; }
      inner.color.copy(c).multiplyScalar(1.4 * k); bulbM.color.copy(c).multiplyScalar(3 * k);
    },
  };
}
