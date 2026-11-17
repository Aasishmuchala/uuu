// The forecourt (PLAN-3D T6; from the approved prototype's world.js): a timber deck with joints along the front, a
// paved path from the annex doors out across the grass, a planted bed of grasses and ferns, and low path lights that
// stay on when everything else is off. Sized from the plan's building and annex.
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { col, rng } from "./dusk.js";
import { boxUV, bx, cbx, grade, keyed, merge } from "./building.js";
import { ZF } from "./lamps.js";

// A soft round pool of light as a small data texture (no canvas, no picture file).
function poolTexture() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.hypot(x - S / 2 + 0.5, y - S / 2 + 0.5) / (S / 2);
    const v = Math.max(0, 1 - r);
    const a = Math.round(255 * v * v * (3 - 2 * v));
    const o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.needsUpdate = true; t.magFilter = t.minFilter = THREE.LinearFilter;
  return t;
}

export function makeForecourt(A, building, plan, { phone = false } = {}) {
  const g = new THREE.Group();
  const lit = building.lit;
  const owned = [];
  const X0 = plan.building.x0, X1 = plan.building.x1, DX1 = plan.annex.x1;
  const dx0 = X0 - 0.9, dx1 = X1 - 0.1, px0 = X1 + 0.2, px1 = DX1 - 0.2;

  const deckM = lit(new THREE.MeshStandardMaterial({ map: A.tex.wood_floor_deck_diff, normalMap: A.tex.wood_floor_deck_nor, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.8, color: col("#ffffff"), envMapIntensity: 0.35 }), 1);
  deckM.onBeforeCompile = ((prev) => (sh, r) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
    { float b = vMapUv.y * 12.; float id = floor(b + .5); float d = abs(b - id); float w = fwidth(b); float gap = 1. - smoothstep(.05, .05 + max(w, .02), d);
      float run = floor(vMapUv.x * .5 + fract(id * .618) * 3.); float tone = fract(sin(id * 12.9898 + run * 78.233) * 43758.5453);
      { float l = dot(diffuseColor.rgb, vec3(.3, .59, .11)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, .45); }
      diffuseColor.rgb *= (.8 + tone * .3) * (1. - gap * .85) * vec3(.72, .7, .66); }`);
  })(deckM.onBeforeCompile);
  keyed(deckM, "f-deck");
  const S = 1.68;
  const dp = [cbx(dx0, dx1, 0.32, 0.44, 4.3, 6.9, 0.012, "#ffffff", (p, n) => (Math.abs(n.y) > 0.7 ? [p.x / S, p.z / S] : boxUV(S)(p, n))), bx(dx0 - 0.1, dx1 + 0.1, -0.1, 0.32, 4.32, 6.88, "#4a4038", boxUV(S))];
  g.add(new THREE.Mesh(merge(dp), deckM));
  // the path: concrete slabs in running bond from the doors out across the grass
  const pm = keyed(lit(grade(new THREE.MeshStandardMaterial({ vertexColors: true, map: A.tex.concrete_floor_02_diff, normalMap: A.tex.concrete_floor_02_nor, roughness: 0.95 }), 0.2, 0.85, 0.45), 1), "f-path");
  const pv = []; const r = rng(4);
  for (let z = 4.3, k = 0; z < 24; z += 0.62, k++) {
    const off = k % 2 ? 0.35 : 0;
    for (let x = px0 + off - 0.35; x < px1; x += 0.7) { const x0 = Math.max(px0, x), x1 = Math.min(px1, x + 0.68); if (x1 - x0 > 0.1) pv.push(bx(x0, x1, -0.05, 0.06 + (z < 7.6 ? 0.3 : 0), z, z + 0.6, (r() > 0.5 ? "#ffffff" : "#e7e2da"), boxUV(2.6))); }
  }
  g.add(new THREE.Mesh(merge(pv), pm));
  // planting: a long bed in front of the deck, grasses and ferns
  const bedM = keyed(lit(new THREE.MeshStandardMaterial({ map: A.tex.forest_ground_04_diff, color: col("#8a7663"), roughness: 1 }), 1), "f-bed");
  // the beds: along the deck, round the left end of the studio, and beside the path; each with a stone kerb (T11)
  const lx0 = dx0 - 2.6, lx1 = dx0 - 0.15, rx0 = px1 + 0.45, rx1 = px1 + 2.5;
  const beds = [[dx0, dx1, 6.9, 8.9], [lx0, lx1, -3.4, 8.9], [rx0, rx1, 4.6, 10.4]];
  const bedParts = [];
  for (const [a, b, c, d] of beds) {
    bedParts.push(bx(a, b, -0.05, 0.12, c, d, "#ffffff", boxUV(2)));
    bedParts.push(bx(a - 0.1, b + 0.1, -0.05, 0.2, d, d + 0.15, "#9a958d", boxUV(2)));
  }
  bedParts.push(bx(lx0 - 0.15, lx0, -0.05, 0.2, -3.4, 9.05, "#9a958d", boxUV(2)), bx(rx1, rx1 + 0.15, -0.05, 0.2, 4.6, 10.55, "#9a958d", boxUV(2)));
  g.add(new THREE.Mesh(merge(bedParts), bedM));
  owned.push(deckM, pm, bedM);
  const nodesOf = (gltf, re) => { const out = []; if (!gltf) return out; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse((o) => { if (o.isMesh && (!re || re.test(o.name))) out.push(o); }); return out; };
  // where a plant goes: inside a box [x0, x1, z0, z1], or a function that gives a spot or null
  const spots = (nodes, count, where, sc, seed, tint, key) => {
    const rr = rng(seed), by = nodes.map(() => []);
    const pick = typeof where === "function" ? () => where(rr) : () => [where[0] + rr() * (where[1] - where[0]), where[2] + rr() * (where[3] - where[2])];
    for (let i = 0, guard = 0; i < count && guard < count * 20; guard++) {
      const at2 = pick(); if (!at2) continue; const [x, z] = at2; i++;
      const y = where.ground ? 0 : 0.1;
      by[i % nodes.length].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr() * 6.28, 0)), new THREE.Vector3().setScalar(sc * (0.8 + rr() * 0.5)))); }
    nodes.forEach((n, k) => {
      if (!by[k].length) return;
      const mat = n.material.clone(); mat.color.copy(tint); mat.side = THREE.DoubleSide; mat.envMapIntensity = 0.4; keyed(lit(mat, 1), key); owned.push(mat);
      const im = new THREE.InstancedMesh(n.geometry, mat, by[k].length);
      const local = n.matrixWorld.clone().setPosition(0, 0, 0);
      by[k].forEach((m, j) => im.setMatrixAt(j, m.clone().multiply(local)));
      g.add(im);
    });
  };
  const span = (dx1 - dx0) / 17.8;
  const grass = nodesOf(A.models.grass_medium_01, /tall|mid/);
  const ferns = nodesOf(A.models.fern_02);
  const bedSpots = (bi) => (rr) => { const [a, b, c, d] = beds[bi]; return [a + 0.2 + rr() * (b - a - 0.4), c + 0.15 + rr() * (d - c - 0.3)]; };
  if (grass.length) {
    spots(grass, Math.round(90 * span), [dx0 + 0.2, dx1 - 0.2, 7.0, 8.8], 2.0, 21, col("#a8ad74"), "f-model");
    spots(grass, 26, bedSpots(1), 2.1, 25, col("#a3a870"), "f-model");
    spots(grass, 14, bedSpots(2), 2.0, 26, col("#a3a870"), "f-model");
  }
  if (ferns.length) {
    spots(ferns, Math.round(30 * span), [dx0 + 0.3, dx1 - 0.3, 7.1, 8.7], 1.9, 22, col("#7f8f58"), "f-model");
    spots(ferns, 12, bedSpots(1), 2.2, 27, col("#7b8a55"), "f-model");
    spots(ferns, 6, bedSpots(2), 2.0, 28, col("#7b8a55"), "f-model");
  }
  // the meadow beyond: tufts of the small grasses and a few ferns, thick by the yard and thinning out, never on the
  // gravel margin or the path, so no flat plane shows from either camera
  const yard = [lx0 - 0.15, rx1 + 0.15, -4.3, 10.55], path = [px0 - 0.1, px1 + 0.1, 4.3, 24];
  const out = (r, x, z, m) => x < r[0] - m || x > r[1] + m || z < r[2] - m || z > r[3] + m;
  const meadow = (near) => Object.assign((rr) => {
    const x = X0 - 18 + rr() * (DX1 - X0 + 36), z = -9 + rr() * 34;
    if (!out(yard, x, z, 1.6) || !out(path, x, z, 1.2)) return null;
    const d = Math.min(Math.abs(x - (X0 + DX1) / 2) / 14, Math.hypot(Math.max(0, x - yard[1], yard[0] - x), Math.max(0, z - yard[3])) / 9);
    return rr() < (near ? 1.1 - d : 0.9 - d * 0.6) ? [x, z] : null;
  }, { ground: true });
  const tufts = nodesOf(A.models.grass_medium_01, /small_a|mid_a|mid_b|large_a/);
  if (tufts.length) spots(tufts, phone ? 110 : 320, meadow(true), 2.9, 31, col("#9aa06a"), "f-model");
  if (ferns.length) spots(ferns.slice(0, 2), phone ? 24 : 70, meadow(false), 2.6, 32, col("#76854f"), "f-model");

  // path lights: low posts along both sides of the path, each with a small pool on the ground
  const at = [];
  for (let z = 9.6; z < 23; z += 3.2) for (const x of [px0 - 0.25, px1 + 0.25]) at.push([x, z]);
  const postM = keyed(lit(new THREE.MeshStandardMaterial({ color: col("#2a2724"), roughness: 0.5, metalness: 0.5 }), 1), "f-plain");
  const capM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1, 0.78, 0.5, THREE.LinearSRGBColorSpace).multiplyScalar(7) });
  const poolT = poolTexture();
  const poolM = new THREE.MeshBasicMaterial({ map: poolT, color: col("#ffb36b").multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  owned.push(postM, capM, poolM);
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 10), postM, at.length);
  const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 10), capM, at.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 2.2), poolM, at.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
  at.forEach(([x, z], i) => {
    posts.setMatrixAt(i, m.makeTranslation(x, 0.27, z));
    caps.setMatrixAt(i, m.makeTranslation(x, 0.52, z));
    pools.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.08, z), q, one));
  });
  pools.renderOrder = 1;
  g.add(posts, caps, pools);
  // the pools fade by day (T12): in the morning sun a path light is a small warm cap, not a pool on the grass
  g.userData.look = (k) => { poolM.color.setRGB(1, 0.72, 0.42, THREE.LinearSRGBColorSpace).multiplyScalar(k); };
  g.traverse((o) => { if (o.isMesh && o.material.isMeshStandardMaterial) { o.receiveShadow = true; o.castShadow = !o.material.transparent; } });
  g.userData.foot = { x0: dx0 - 0.3, x1: DX1 + 0.3, z0: -4.1, z1: ZF + 0.7, yard, path };
  g.userData.dispose = () => {
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const x of owned) x.dispose();
    poolT.dispose();
  };
  return g;
}
