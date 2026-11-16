// The owner's desk (PLAN-3D D1, D10, T6; from the approved prototype's needs.js): a desk by a window at dusk, the
// arm lamp and its light, the stack of what waits (blank ruled sheets, never a title: D9), the tray for what is set
// aside, and the studio at model scale on a walnut board, built by the same code as the Map's building (`small`).
// Approved, the top sheet travels into its department's room in the model; set aside, it slides to the tray.
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { col, ease } from "./dusk.js";
import { keyed, makeBuilding } from "./building.js";
import { makeLamp } from "./lamps.js";
import { STACK_MAX } from "../state.js";

// The desk stands in an upper room high on the hill (T11), so its window looks over the firs, not into their trunks.
export const DESK_AT = new THREE.Vector3(0, 16, 14);
const SW = 0.21, SL = 0.297, STEP = 0.0026;

// A soft dark blot for the contact shade under things on the desk (no shadow maps: D21).
function blotTexture() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.min(1, Math.hypot((x - S / 2 + 0.5) / (S / 2), (y - S / 2 + 0.5) / (S / 2)));
    const v = 1 - r;
    const o = (y * S + x) * 4; d[o + 3] = Math.round(255 * Math.pow(v, 1.6));
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter;
  return t;
}
// Ruled paper: a pale sheet with grey rules, numbers only.
function ruledTexture() {
  const W = 64, H = 96, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const rule = y < H - 18 && y > 10 && (H - y) % 7 === 0 && x > 7 && x < W - 7 - ((y / 7) % 4) * 4;
    const c = rule ? [201, 193, 181] : [243, 239, 231];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  return t;
}

// Beyond the window (T11): the room stands high on the hill, so the owner looks out over the tops of the firs into
// the dusk haze of the valley. Three layers of firs at three distances, drawn from numbers in the shader on one
// cylinder (desk mode loads no tree or ground file, D20): the near crowns dark with tiered branches, the farther ones
// paler into the haze, and between them the glow of the evening low over the valley. Edges are smoothed per pixel.
const RING_R = 60, RING_H = 60;
function makeFirRing(fog) {
  const g = new THREE.Group();
  const eye = DESK_AT.y + 0.6;
  // a tree at true distance d and true height y appears on the ring at eye + (y - eye) * RING_R / d
  const onRing = (d, y) => (eye + (y - eye) * RING_R / d).toFixed(2);
  const ringM = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, transparent: false,
    uniforms: { uFog: { value: fog.clone() }, uDark: { value: col("#0e1411") }, uGlow: { value: col("#c98f6e") } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
    fragmentShader: `uniform vec3 uFog, uDark, uGlow; varying vec3 vP;
      float h1(float n){ return fract(sin(n * 91.345) * 47453.5453); }
      // a fir in a row of cells: u in cells, y in metres on the ring, the row standing from y0 with tips up to y1
      float fir(float u, float y, float seed, float y0, float y1){
        float c = floor(u), f = fract(u) - .5 + (h1(c + seed) - .5) * .55;
        float top = mix(mix(y0, y1, .62), y1, h1(c * 1.7 + seed));
        float t = clamp((top - y) / max(top - y0, .01), 0., 1.);
        float tiers = fract(t * (6. + 4. * h1(c * 3.1 + seed)) + h1(c + seed * 2.));
        float w = .46 * pow(t, .8) * (.68 + .32 * tiers) + .02;
        float aa = fwidth(u) * 1.3 + .004;
        return (1. - smoothstep(w - aa, w + aa, abs(f))) * (1. - smoothstep(top - .05, top + .25, y));
      }
      void main(){
        float a = atan(vP.z, vP.x), y = vP.y + ${(RING_H / 2).toFixed(1)};
        float horizon = ${eye.toFixed(2)};
        // the evening low over the valley: warm near the horizon, falling to the haze below
        float lift = smoothstep(horizon - 26., horizon + 2., y);
        vec3 haze = mix(uFog, vec3(.3, .31, .36), .45);
        vec3 c = mix(haze * .42, mix(haze, uGlow, .38) * .9, lift * lift);
        float far = fir(a * 34., y, 7., ${onRing(140, 0)}, ${onRing(140, 15)});
        c = mix(c, mix(uDark, haze, .68), far);
        float mid = fir(a * 17., y, 19., ${onRing(70, 0)}, ${onRing(70, 15)});
        c = mix(c, mix(uDark, haze, .4), mid);
        float near = fir(a * 8.5, y, 3., ${onRing(34, 0)}, ${onRing(34, 14)});
        float rim = near * (1. - fir(a * 8.5 + .012, y - .25, 3., ${onRing(34, 0)}, ${onRing(34, 14)}));
        c = mix(c, mix(uDark, haze, .12) + uGlow * .06 * rim, near);
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(RING_R, RING_R, RING_H, 220, 1, true), ringM);
  ring.position.y = RING_H / 2; ring.renderOrder = -7;
  g.add(ring);
  g.userData.mats = [ringM];
  return g;
}

export function makeDesk(A, plan, { fog } = {}) {
  const g = new THREE.Group();
  g.position.copy(DESK_AT);
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  const tex = A.tex;

  const top = own(keyed(new THREE.MeshStandardMaterial({ map: tex.wood_floor_diff, normalMap: tex.wood_floor_nor, roughnessMap: tex.wood_floor_rough, roughness: 1, envMapIntensity: 0.6, color: col("#e9cfb0") }), "d-std"));
  // the top runs on toward the owner past the stage's lower edge, so no dark band shows under it (T11)
  const dg = new THREE.BoxGeometry(4.4, 0.045, 3.2);
  { const uv = dg.attributes.uv, p = dg.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (p.getX(i) + 2.2) / 2.6, (p.getZ(i) + 1.6) / 2.6); }
  const deskTop = new THREE.Mesh(dg, top); deskTop.position.set(0, -0.0225, 0.7); g.add(deskTop);
  // the window behind the desk: dark steel mullions, a concrete sill, the dusk beyond
  const steel = own(keyed(new THREE.MeshStandardMaterial({ color: col("#1f1c1a"), roughness: 0.45, metalness: 0.6 }), "d-std"));
  const sillM = own(keyed(new THREE.MeshStandardMaterial({ map: tex.concrete_floor_02_diff, roughness: 0.9, color: col("#bdb6ad") }), "d-std"));
  const sill = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 0.3), sillM); sill.position.set(0, -0.1, -1.25); g.add(sill);
  for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 3, 0.08), steel); m.position.set(x + 0.35, 1.4, -1.36); g.add(m); }
  { const m = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 0.08), steel); m.position.set(0, -0.05, -1.36); g.add(m); }
  if (fog) { const ring = makeFirRing(fog); ring.position.set(0, -DESK_AT.y, 0); g.add(ring); owned.push(...ring.userData.mats); }
  // the lamp and the light it throws
  const lamp = makeLamp({ steel, shade: own(keyed(new THREE.MeshStandardMaterial({ color: col("#26302c"), roughness: 0.5, metalness: 0.35 }), "d-std")) });
  lamp.group.position.set(-0.2, 0, -0.62); lamp.group.rotation.y = -1.0; lamp.group.scale.setScalar(1.15);
  lamp.setPose(0); lamp.setLight("on", 1); g.add(lamp.group);
  g.updateMatrixWorld(true);
  const head = new THREE.Vector3(); lamp.head.getWorldPosition(head);
  const spot = new THREE.SpotLight(col("#ffc98e"), 7, 3.2, 0.95, 0.55, 1.6);
  spot.position.copy(head).add(new THREE.Vector3(0, -0.05, 0));
  spot.target.position.copy(DESK_AT).add(new THREE.Vector3(-0.05, 0, -0.05));
  const fill = new THREE.PointLight(col("#ffb070"), 1.2, 4, 1.6); fill.position.copy(DESK_AT).add(new THREE.Vector3(0.4, 1.2, 0.9));
  const lights = new THREE.Group(); lights.add(spot, spot.target, fill);

  // the studio model at the back of the desk, on a walnut board, sized to the plan
  const span = Math.max(4, plan.annex.x1 - plan.building.x0 + 0.6);
  const SC = Math.min(0.027, 0.56 / span);
  const b = makeBuilding(A, plan, { small: true });
  b.root.scale.setScalar(SC);
  const model = new THREE.Group(); model.position.set(0.24, 0, -0.64); model.rotation.y = -0.34; g.add(model);
  const boardM = own(keyed(new THREE.MeshStandardMaterial({ color: col("#5b4030"), roughness: 0.5, map: tex.planks_brown_10_diff }), "d-std"));
  const bw = span * SC + 0.1;
  const board = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.016, 0.34), boardM); board.position.set(0.01, 0.008, 0.02); model.add(board);
  b.root.position.set(-((plan.building.x0 + plan.annex.x1) / 2) * SC, 0.016 + 0.2 * SC, 0); model.add(b.root);

  // paper: the stack of what waits, the tray of what is set aside; blank ruled sheets, drawn as instances
  const ruled = ruledTexture();
  const blank = own(keyed(new THREE.MeshStandardMaterial({ color: col("#f1ece3"), roughness: 0.92, envMapIntensity: 0.5 }), "d-std"));
  const face = own(keyed(new THREE.MeshStandardMaterial({ map: ruled, roughness: 0.9, envMapIntensity: 0.5 }), "d-std"));
  const sheetGeo = new THREE.BoxGeometry(SW, 0.0012, SL);
  const sheetMats = [blank, blank, face, blank, blank, blank];
  const stackG = new THREE.Group(); stackG.position.set(0.06, 0, -0.1); stackG.rotation.y = 0.12; g.add(stackG);
  const trayG = new THREE.Group(); trayG.position.set(-0.36, 0, 0.2); trayG.rotation.y = -0.35; trayG.scale.setScalar(0.8); g.add(trayG);
  {
    const oak = own(keyed(new THREE.MeshStandardMaterial({ map: tex.planks_brown_10_diff, color: col("#d2a97f"), roughness: 0.6 }), "d-std"));
    const parts = [[0.27, 0.012, 0.36, 0, 0.006, 0], [0.012, 0.04, 0.36, -0.135, 0.02, 0], [0.012, 0.04, 0.36, 0.135, 0.02, 0], [0.27, 0.04, 0.012, 0, 0.02, -0.18], [0.27, 0.04, 0.012, 0, 0.02, 0.18]];
    for (const [w, h, d, x, y, z] of parts) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), oak); m.position.set(x, y, z); trayG.add(m); }
  }
  const R = (i) => Math.sin(i * 12.9898) * 0.5;
  const stack = new THREE.InstancedMesh(sheetGeo, sheetMats, STACK_MAX); stack.count = 0; stackG.add(stack);
  const TRAY_MAX = 12;
  const tray = new THREE.InstancedMesh(sheetGeo, sheetMats, TRAY_MAX); tray.count = 0; trayG.add(tray);
  const M = new THREE.Matrix4(), Qr = new THREE.Quaternion(), Eu = new THREE.Euler(), ONE = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
  const sheetAt = (i, drop = 0) => M.compose(P.set(R(i) * 0.02, 0.0008 + i * STEP + drop, R(i + 3) * 0.016), Qr.setFromEuler(Eu.set(0, R(i + 7) * 0.14, 0)), ONE);
  const trayAt = (i) => M.compose(P.set(R(i + 11) * 0.02, 0.013 + i * STEP, R(i + 5) * 0.02), Qr.setFromEuler(Eu.set(0, R(i + 2) * 0.3, 0)), ONE);

  // contact shade under the stack, the tray, the board and the lamp
  const blot = blotTexture();
  const blotM = own(new THREE.MeshBasicMaterial({ map: blot, color: col("#000000"), transparent: true, opacity: 0.55, depthWrite: false }));
  const blotG = new THREE.PlaneGeometry(1, 1);
  const blots = [];
  const addBlot = (parent, x, z, w, d, k = 1, ry = 0) => { const m = new THREE.Mesh(blotG, blotM); m.rotation.set(-Math.PI / 2, 0, ry); m.position.set(x, 0.0007, z); m.scale.set(w, d, 1); m.renderOrder = 1; m.userData.k = k; parent.add(m); blots.push(m); return m; };
  const stackBlot = addBlot(stackG, 0, 0, SW * 1.5, SL * 1.35);
  addBlot(trayG, 0, 0, 0.42, 0.5);
  addBlot(model, 0.01, 0.02, bw * 1.15, 0.5);
  addBlot(g, -0.2, -0.62, 0.3, 0.3);

  // the stack's state: n sheets now, the newest dropping in when the queue grows
  let n = 0, drop = 0, asideN = 0;
  function drawStack() {
    stack.count = n;
    for (let i = 0; i < n; i++) stack.setMatrixAt(i, sheetAt(i, i >= n - dropN ? drop : 0));
    stack.instanceMatrix.needsUpdate = true;
    stackBlot.visible = n > 0;
    tray.count = Math.min(TRAY_MAX, asideN);
    for (let i = 0; i < tray.count; i++) tray.setMatrixAt(i, trayAt(i));
    tray.instanceMatrix.needsUpdate = true;
  }
  let dropN = 0;
  function setStack(count, { animate = false } = {}) {
    const next = Math.max(0, Math.min(STACK_MAX, count | 0));
    if (next === n) return false;
    dropN = animate && next > n ? next - n : 0;
    drop = dropN ? 0.08 : 0;
    n = next; drawStack();
    return true;
  }

  // a sheet in flight: from the top of the stack into a room of the model, or across to the tray
  const flyM = own(keyed(new THREE.MeshStandardMaterial({ map: ruled, color: col("#ffffff"), roughness: 0.9, emissive: col("#ffdcae"), emissiveIntensity: 0.15, transparent: true }), "d-fly"));
  const flyer = new THREE.Mesh(sheetGeo, flyM); flyer.visible = false; g.add(flyer);
  let flight = null;
  const local = (obj, v) => g.worldToLocal(obj.localToWorld(v.clone()));
  function topOfStack() { return local(stackG, new THREE.Vector3(0, 0.0008 + Math.max(0, n - 1) * STEP + 0.002, 0)); }
  function roomPoint(id) {
    const rm = id && b.rooms[id];
    if (!rm) return local(model, new THREE.Vector3(0, 0.05, -0.4)); // no room known: off the desk's far edge
    return local(b.root, rm.centre);
  }
  function approve(roomId, { still = false } = {}) {
    const from = topOfStack(), to = roomPoint(roomId);
    flight = { kind: "approve", from, to, t: 0, dur: still ? 240 : 620, still, room: roomId && b.rooms[roomId] ? roomId : null };
    return true;
  }
  function aside({ still = false } = {}) {
    flight = { kind: "aside", from: topOfStack(), to: local(trayG, new THREE.Vector3(0, 0.02 + Math.min(TRAY_MAX, asideN) * STEP, 0)), t: 0, dur: still ? 240 : 480, still };
    return true;
  }
  function stepFlight(dt) {
    if (!flight) return false;
    const f = flight;
    f.t = Math.min(1, f.t + dt / f.dur);
    const e = ease(f.t);
    flyer.visible = true;
    if (f.still) {
      flyer.position.copy(f.t < 0.5 ? f.from : f.to); flyMat(f.t < 0.5 ? 1 - f.t * 2 : (f.t - 0.5) * 2, 1);
      flyer.rotation.set(0, 0, 0);
    } else if (f.kind === "approve") {
      flyer.position.lerpVectors(f.from, f.to, e); flyer.position.y += Math.sin(e * Math.PI) * 0.12;
      flyer.rotation.set(Math.sin(e * Math.PI) * 0.5, e * 0.8, 0);
      flyMat(1 - smoothEnd(f.t), 1 - 0.92 * e);
    } else {
      flyer.position.lerpVectors(f.from, f.to, e); flyer.position.y += Math.sin(e * Math.PI) * 0.05;
      flyer.rotation.set(0, -0.35 * e, 0);
      flyMat(1, 1 - 0.2 * e);
    }
    if (f.t >= 1) {
      flyer.visible = false; flight = null;
      if (f.kind === "aside") { asideN++; drawStack(); }
      else if (f.room) b.flash(f.room);
    }
    return true;
  }
  const smoothEnd = (t) => Math.max(0, (t - 0.75) / 0.25);
  function flyMat(opacity, scale) { flyM.opacity = opacity; flyer.scale.setScalar(Math.max(0.02, scale)); }

  function update(dt) {
    let moving = b.update(dt);
    if (drop > 0) { drop = Math.max(0, drop - dt / 450 * 0.08); drawStack(); moving = true; }
    if (stepFlight(dt)) moving = true;
    return moving;
  }
  function snap() {
    b.snap();
    drop = 0; dropN = 0;
    if (flight) { const k = flight.kind; flight = null; flyer.visible = false; if (k === "aside") asideN++; }
    drawStack();
  }

  return {
    group: g, lights, building: b, model, stackG, trayG,
    setStack, approve, aside, update, snap,
    anchor(id) {
      if (id === "stack") return g.localToWorld(topOfStack().add(new THREE.Vector3(0, 0.0, 0.2)));
      if (id === "tray") return trayG.localToWorld(new THREE.Vector3(0.16, 0.05, 0.05));
      return null;
    },
    roomWorld(id) { return g.localToWorld(roomPoint(id)); },
    focusPoint() { return g.localToWorld(new THREE.Vector3(0.16, 0.02, -0.5)); },
    sync(sunDir) { g.updateMatrixWorld(true); b.sync(sunDir); },
    dispose() {
      b.dispose();
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      for (const x of owned) x.dispose();
      lamp.group.traverse((o) => { if (o.material) o.material.dispose(); });
      ruled.dispose(); blot.dispose();
      stack.dispose(); tray.dispose();
      g.removeFromParent(); lights.removeFromParent();
    },
  };
}
