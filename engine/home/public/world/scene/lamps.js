// The light inside the studio (PLAN-3D T6, REAL-1): each room's light and each desk lamp reach only their own room,
// and the arm lamp that says what an agent is doing.
//
// A point light would shine through partitions and slabs. Here every interior surface asks which room it is in and
// takes light only from that room: its ceiling's soft light (shadowed by what stands in the room: makeFloorShade), a
// pool under each pendant, a wash down the back wall, and its own desk lamps; the forecourt takes the light that
// falls out of the glazed fronts on the ground floor. The same code lights the small model on the owner's desk.
//
// The sun's shadows are a shadow map (REAL-1 revisits D21: the map is drawn only when something moved, never per
// frame). The ceiling's shadows are a second, cheaper map: each storey seen from above along the light, one tile a
// storey; while the picture settles the light's direction is moved over the ceiling frame by frame (world.js), so
// the settled shadows are those of a wide soft source.
// Shader text is built from constants only; the state enters as uniforms (D9).
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { ROOM_Z, MAX_ROOMS, MAX_DESKS, MAX_FLOORS, FLOOR_H, GROUND_Y } from "../layout.js";

export const NR = MAX_ROOMS + 3;               // the rooms, the annex, the pavilion, one spare
export const NL = MAX_ROOMS * MAX_DESKS + 1;   // every desk lamp, and the sheet in flight (the last)
export const CARRY = NL - 1;
export const [ZB, ZF] = ROOM_Z;
export const SHADE_LAYER = 2;                  // what the ceiling's light is hidden by

// Colours of light are written as the camera sees them, white-balanced between the lamps and the dusk sky (linear).
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const col = (h) => new THREE.Color(h);
export const LAMP_COLOURS = { on: lin(1, 0.8, 0.56), amber: lin(1, 0.42, 0.07), red: lin(1, 0.1, 0.05) };
export const OFF_GLOW = lin(0.022, 0.02, 0.018);
export const WARM = lin(1, 0.76, 0.5);
// In the morning (T12) a lamp's state has to read without darkness: the shade itself takes the state's colour and
// glows a little (on, amber, red); off is a pale shade; down is a pale shade on the folded arm. At dusk every shade
// stays the dark lacquer it has always had, and only the light inside it speaks.
export const SHADE_DUSK = col("#2f3a35");
// (the paints are kept below white, so the tone mapping cannot wash amber and red to the same pale yellow)
export const SHADE_DAY = { on: col("#e3a43a"), amber: col("#d4520a"), red: col("#b01a10"), off: col("#d9d3c9") };
export const SHADE_GLOW = { on: 0.3, amber: 0.45, red: 0.5, off: 0 };
// At dusk (REAL-1) a lit lamp's shade is opal glass that glows in the state's colour, so the state reads from above
// and from across the forecourt, with the camera's bloom round it; an unlit shade is the dark lacquer.
// (amber and red glow less than white does: brighter, the film curve would wash both toward the same pale cream)
export const SHADE_NIGHT = { on: 2.2, amber: 1.5, red: 1.3, off: 0 };
export const GLOW_K = { on: 1, amber: 0.42, red: 0.36 };

export function makeRoomLight() {
  return {
    uBInv: { value: new THREE.Matrix4() },
    uRoomBox: { value: Array.from({ length: NR }, () => new THREE.Vector4(0, -1, -100, 0)) },
    uRoomCol: { value: Array.from({ length: NR }, () => new THREE.Vector3()) },
    uRoomInfo: { value: Array.from({ length: NR }, () => new THREE.Vector2(0, 0)) },
    uLamp: { value: Array.from({ length: NL }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLampCol: { value: Array.from({ length: NL }, () => new THREE.Vector3()) },
    uSpill: { value: new THREE.Vector2(-14, 15) },
    // the key's inside (dusk.js): x how far an unlit room's daylight falls, y a lamp pool's strength, z unused
    uDay: { value: new THREE.Vector3(0.35, 1, 0) },
    // the ceiling's shadow: the storeys' tiles, each storey's matrix from the building's metres to its tile, and
    // x, y the blur's reach in the tile, z the least light under cover, w the blur's turn this frame
    uFloorTex: { value: null },
    uFloorMat: { value: Array.from({ length: MAX_FLOORS }, () => new THREE.Matrix4()) },
    uFloorSoft: { value: new THREE.Vector4(0.004, 0.02, 0.4, 0) },
    uPavI: { value: NR },
  };
}

const RL_HEAD = `
uniform mat4 uBInv; uniform vec4 uRoomBox[${NR}]; uniform vec3 uRoomCol[${NR}]; uniform vec2 uRoomInfo[${NR}];
uniform vec4 uLamp[${NL}]; uniform vec3 uLampCol[${NL}];
uniform vec2 uSpill; uniform vec3 uDay;
uniform sampler2D uFloorTex; uniform mat4 uFloorMat[${MAX_FLOORS}]; uniform vec4 uFloorSoft; uniform float uPavI;
varying vec3 vRW;
int roomOf(vec3 p){
  int ri = -1;
  // (most of the picture is ground and trees: outside the building's own box no room is asked)
  if (p.x < uSpill.x + 4. || p.x > uSpill.y - 4. || p.y < 0. || p.z < ${(ZB - 0.45).toFixed(2)} || p.z > ${(ZF + 0.3).toFixed(2)}) return ri;
  for (int i = 0; i < ${NR}; i++) { vec4 b = uRoomBox[i]; if (p.x > b.x - .09 && p.x < b.y + .09 && p.y > b.z - .06 && p.y < b.z + b.w && p.z > ${(ZB - 0.45).toFixed(2)} && p.z < ${(ZF + 0.3).toFixed(2)}) ri = i; }
  return ri;
}
float rlNoise(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
// How much of the ceiling's light reaches p: the storey's tile, a few taps in a turned spiral.
float floorVis(vec3 p, vec3 n, int ri){
  if (float(ri) > uPavI - .5) return 1.;
  float fl = floor((uRoomBox[ri].z - ${GROUND_Y.toFixed(2)}) / ${FLOOR_H.toFixed(2)} + .5);
  if (fl < 0. || fl > ${(MAX_FLOORS - 0.5).toFixed(1)}) return 1.;
  vec4 q = uFloorMat[int(fl)] * vec4(p + n * .035, 1.);
  float z = q.z - .004, a = (rlNoise(gl_FragCoord.xy) + uFloorSoft.w) * 6.2831853, s = 0.;
  for (int i = 0; i < 4; i++) {
    float t = sqrt((float(i) + .5) / 4.), b = a + float(i) * 2.3999632;
    vec2 u = clamp(q.xy + vec2(cos(b), sin(b)) * t * uFloorSoft.xy, vec2(.002), vec2(.998));
    s += step(z, texture2D(uFloorTex, vec2(u.x, (u.y + fl) * ${(1 / MAX_FLOORS).toFixed(4)})).x);
  }
  return mix(uFloorSoft.z, 1., s / 4.);
}
// The corners of a room fall a little dark (analytic): of the distances to the room's floor or ceiling, its two ends
// and its back wall, the smallest is the surface's own plane; the second smallest is the nearest corner.
float roomAO(vec3 p, int ri){
  vec4 b = uRoomBox[ri];
  float dx = min(p.x - b.x, b.y - p.x), dy = min(p.y - b.z, b.z + b.w - p.y), dz = p.z - ${ZB.toFixed(2)};
  float s2 = max(min(dx, dy), min(max(dx, dy), dz));
  return mix(.62, 1., smoothstep(.0, .7, s2));
}
vec3 roomLight(vec3 p, vec3 n, int ri, float spill){
  vec3 acc = vec3(0.);
  // the sheet in flight carries its own light, everywhere
  vec4 c = uLamp[${CARRY}];
  if (c.w > .5) { vec3 L = c.xyz - p; float d2 = dot(L, L); acc += uLampCol[${CARRY}] * max(dot(n, L * inversesqrt(d2)), 0.) / (1. + d2 * 1.2); }
  if (ri >= 0) {
    vec4 b = uRoomBox[ri]; vec3 rc = uRoomCol[ri];
    float V = floorVis(p, n, ri), w = b.y - b.x, top = b.z + b.w - .05;
    // the ceiling's soft light: floors and table tops take it whole, walls less; the back wall is washed from above
    float up = clamp((p.y - b.z) / b.w, 0., 1.);
    float wash = (n.z > .5 && p.z < ${(ZB + 0.6).toFixed(2)}) ? .7 + 1.1 * up * up * (.95 + .05 * cos(p.x * 5.2)) : 1.;
    acc += rc * ((.78 + .22 * max(n.y, 0.)) * V * wash + .16);
    // a pool under each pendant
    float nP = max(2., floor(w / 2.6 + .5));
    for (int i = 0; i < 6; i++) {
      if (float(i) >= nP) break;
      vec3 L = vec3(b.x + (float(i) + .5) * w / nP, top - .95, .9) - p; float d2 = dot(L, L); vec3 Ld = L * inversesqrt(d2);
      acc += rc * 2.2 * max(dot(n, Ld), 0.) * smoothstep(.1, .75, Ld.y) / (1. + d2 * .75) * V;
    }
    int s = int(uRoomInfo[ri].x + .5), m = int(uRoomInfo[ri].y + .5);
    for (int k = 0; k < ${MAX_DESKS}; k++) {
      if (k >= m) break;
      vec4 l = uLamp[s + k]; if (l.w < .5) continue;
      vec3 Lj = l.xyz - p; float e2 = dot(Lj, Lj); vec3 Ld = Lj * inversesqrt(e2);
      acc += uLampCol[s + k] * uDay.y * max(dot(n, Ld), 0.) * smoothstep(.38, .75, Ld.y) / (1. + e2 * 2.2);
    }
  } else if (spill > .5 && p.z > ${(ZF - 0.3).toFixed(2)} && p.z < ${(ZF + 18).toFixed(2)} && p.x > uSpill.x && p.x < uSpill.y) {
    // the light that falls out of the ground floor's glazed fronts, over the deck and the lawn
    for (int i = 0; i < ${NR}; i++) { vec4 b = uRoomBox[i]; if (b.y < b.x || b.z > 1.) continue;
      vec3 q = vec3(clamp(p.x, b.x + .4, b.y - .4), b.z + 1.5, ${(ZF - 0.2).toFixed(2)}); vec3 L = q - p; float d2 = dot(L, L);
      acc += uRoomCol[i] * .55 * max(dot(n, L * inversesqrt(d2)), 0.) / (1. + d2 * .16); }
  }
  return acc;
}`;

// Make a material take the room light. Inside a room the sky's own light is dimmed: the room's lamps are its light.
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
        int ri = roomOf(bp);
        float ao = 1.;
        if (ri >= 0) { ao = roomAO(bp, ri); float k = uDay.x * ao; reflectedLight.indirectDiffuse *= k; reflectedLight.indirectSpecular *= k; }
        reflectedLight.directDiffuse += roomLight(bp, bn, ri, ${spill.toFixed(1)}) * diffuseColor.rgb * ao; }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => "";
  mat.customProgramCacheKey = () => `rl${spill}|${key()}`;
  return mat;
}

// The ceiling's shadow map: one square of depth, a tile a storey. render() draws every storey of a building as the
// ceiling's light sees it along `dir` (the building's own axes, pointing up to the light), cut just under the slab
// above, and writes each storey's matrix and the blur's reach into the building's light uniforms.
export function makeFloorShade(size = 2048) {
  const depth = new THREE.DepthTexture(size, size);
  depth.type = THREE.UnsignedIntType; depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const rt = new THREE.WebGLRenderTarget(size, size, { depthTexture: depth, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.layers.set(SHADE_LAYER);
  const depthM = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  const plane = new THREE.Plane(), under = new THREE.Plane(), L = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3(), up = new THREE.Vector3();
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const tile = size / MAX_FLOORS;
  return {
    depth,
    // vol: { x0, x1, z0, z1, floors: [{ y0, y1 }] } in the building's metres; soft: the blur's reach in metres
    render(renderer, scene, root, RL, vol, dir, soft, least, turn) {
      const prevRT = renderer.getRenderTarget(), prevOv = scene.overrideMaterial, prevClip = renderer.clippingPlanes, prevNeeds = renderer.shadowMap.needsUpdate, prevAuto = renderer.autoClear;
      renderer.shadowMap.needsUpdate = false; renderer.autoClear = true;
      scene.overrideMaterial = depthM;
      root.updateMatrixWorld(true);
      const MW = root.matrixWorld;
      L.copy(dir).transformDirection(MW);
      up.set(0, 0, -1).transformDirection(MW);
      vol.floors.slice(0, MAX_FLOORS).forEach((f, i) => {
        C.set((vol.x0 + vol.x1) / 2, (f.y0 + f.y1) / 2, (vol.z0 + vol.z1) / 2).applyMatrix4(MW);
        cam.position.copy(C).addScaledVector(L, 100); cam.up.copy(up); cam.lookAt(C); cam.updateMatrixWorld(true);
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (let k = 0; k < 8; k++) {
          P.set(k & 1 ? vol.x1 : vol.x0, k & 2 ? f.y1 : f.y0, k & 4 ? vol.z1 : vol.z0).applyMatrix4(MW).applyMatrix4(cam.matrixWorldInverse);
          x0 = Math.min(x0, P.x); x1 = Math.max(x1, P.x); y0 = Math.min(y0, P.y); y1 = Math.max(y1, P.y); z0 = Math.min(z0, P.z); z1 = Math.max(z1, P.z);
        }
        cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1; cam.near = -z1 - (z1 - z0) * 0.02; cam.far = -z0 + (z1 - z0) * 0.02;
        cam.updateProjectionMatrix();
        // cut just under the slab above, and just over the floor: the floor takes the shadow and throws none
        plane.set(P.set(0, -1, 0), f.y1).applyMatrix4(MW);
        under.set(P.set(0, 1, 0), -(f.y0 + 0.05)).applyMatrix4(MW);
        renderer.clippingPlanes = [plane, under];
        rt.viewport.set(0, i * tile, size, tile); rt.scissor.set(0, i * tile, size, tile); rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        RL.uFloorMat.value[i].copy(BIAS).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(MW);
        if (i === 0) { const sc = MW.getMaxScaleOnAxis(); RL.uFloorSoft.value.set(soft * sc / (x1 - x0), soft * sc / (y1 - y0), least, turn); }
      });
      RL.uFloorTex.value = depth;
      renderer.clippingPlanes = prevClip; scene.overrideMaterial = prevOv; renderer.autoClear = prevAuto;
      renderer.setRenderTarget(prevRT); renderer.shadowMap.needsUpdate = prevNeeds;
    },
    dispose() { rt.dispose(); depth.dispose(); depthM.dispose(); },
  };
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
  if (!day) return LAMP_COLOURS[kind] ? [LAMP_COLOURS[kind], SHADE_NIGHT[kind]] : [SHADE_DUSK, 0];
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
      inner.color.copy(c).multiplyScalar(2.2 * k); bulbM.color.copy(c).multiplyScalar(9 * k);
    },
  };
}
