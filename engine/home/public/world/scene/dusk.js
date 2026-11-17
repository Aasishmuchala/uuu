// Dusk around the studio (PLAN-3D D5, T6; from the approved prototype's world.js): the renderer, the photographed
// sunset (Poly Haven, CC0) as an HDR for the light and a picture for the eye, the hemisphere and the sun, the stony
// meadow, the far ridges in aerial perspective, the baked fir impostors and the environment light, prefiltered once.
// The sun throws a real shadow (REAL-1 revisits D21's "no shadow maps": the map is drawn only when something moved,
// and while the picture settles the sun is moved a hair each frame, so the settled shadow has a soft edge). Shader
// text is built from constants only.
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";

export const col = (h) => new THREE.Color(h);
export const DEG = Math.PI / 180;
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A seeded random sequence: the same picture every time.
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }

// The two keys of the light (D5). Dusk: the lake-house's first key, the sky turned so the sunset glows behind the
// building, to the left. Morning (T12): the Lake House p10 key, a low sun from the east raking across the front from
// the right, a pale blue sky with a warm cast, cool shade; inside, daylight with sun patches through the open fronts.
// Beside the sky's numbers each key carries the inside's: how far an unlit room's daylight falls (`dim`), how strong a
// lamp's pool is (`lampK`), whether the sun reaches into the rooms (`sunIn`), and what the desk's window shows.
// (REAL-1: the camera's white balance sits between the lamps and the sky, so at dusk the sky's light reads cool and
// the rooms warm, as in a photograph of a house at blue hour; the haze is the sky's blue-grey, not brown.)
export const DUSK = { theme: "dark", sunAz: -128, sunEl: 14, skyExp: 0.72, tint: "#dcdcea", envExp: 1.3, sunCol: "#ffa878", sunI: 1.3, hemiS: "#7389ab", hemiG: "#1d1e20", hemiI: 0.36, exp: 1.0, fog: "#434d5e", fogD: 0.0052,
  envGround: 0.09, ridge: "#141d24", dim: 0.3, lampK: 1, sunIn: 0, deskSun: 0, ringDark: "#0a0f12", ringGlow: "#b98f80", ringHaze: [0.27, 0.31, 0.4], paths: 0.9 };
export const MORNING = { theme: "light", sunAz: 36, sunEl: 19, skyExp: 1.5, tint: "#fff3e4", envExp: 0.55, sunCol: "#ffc48a", sunI: 10.0, hemiS: "#9fbcdc", hemiG: "#4b4535", hemiI: 0.22, exp: 0.95, fog: "#c9cdd0", fogD: 0.0013,
  envGround: 0.22, ridge: "#33453a", dim: 0.6, lampK: 1.7, sunIn: 1, deskSun: 0.4, ringDark: "#21402b", ringGlow: "#ffe0b0", ringHaze: [0.4, 0.5, 0.62], paths: 0.1 };
export const KEYS = { dark: DUSK, light: MORNING };

export function makeRenderer(canvas) {
  // the scene is drawn into the camera's own picture (post.js), which smooths its edges; the canvas needs no samples
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = DUSK.exp;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // the settled picture softens the edge further (the sun is moved a hair a frame)
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  return renderer;
}

// The decoded .hdr as a half-float texture, with the direction of its brightest pixel (the sun).
export function hdrTexture(h) {
  const W = h.width, H = h.height, d = new Uint16Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((H - 1 - y) * W + x) * 3, o = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) d[o + c] = THREE.DataUtils.toHalfFloat(Math.min(h.data[i + c], 30000));
    d[o + 3] = 15360;
  }
  const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.wrapS = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
  let best = -1, bi = 0;
  for (let i = 0; i < h.data.length; i += 3) { const L = h.data[i] + h.data[i + 1] + h.data[i + 2]; if (L > best) { best = L; bi = i / 3; } }
  const u = (bi % W + 0.5) / W, v = 1 - (Math.floor(bi / W) + 0.5) / H;
  const phi = (u - 0.5) * 2 * Math.PI, el = (v - 0.5) * Math.PI;
  t.userData.sun = new THREE.Vector3(Math.cos(el) * Math.cos(phi), Math.sin(el), Math.cos(el) * Math.sin(phi));
  return t;
}

const EQ_GLSL = `
vec4 eqSample(sampler2D t, vec3 d, float rot){
  float c = cos(rot), s = sin(rot);
  vec3 r = vec3(c*d.x + s*d.z, d.y, -s*d.x + c*d.z);
  vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + .5, asin(clamp(r.y, -1., 1.)) * 0.31830989 + .5);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + .5); dy.x -= floor(dy.x + .5);
  return textureGrad(t, uv, dx, dy);
}`;
// The sky: one photograph, or while the theme changes two, mixed by uMix (the second is read only then).
function makeSkyMat(hdr, tex, rot, exp, tint, fog) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: hdr,
    uniforms: { tA: { value: tex }, uRot: { value: rot }, uExp: { value: exp }, uTint: { value: col(tint) }, uFog: { value: fog.clone() },
      tB: { value: tex }, uRotB: { value: rot }, uExpB: { value: exp }, uTintB: { value: col(tint) }, uMix: { value: 0 } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; gl_Position.z = gl_Position.w; }",
    fragmentShader: `uniform sampler2D tA, tB; uniform float uRot, uExp, uRotB, uExpB, uMix; uniform vec3 uTint, uTintB, uFog; varying vec3 vW;
    ${EQ_GLSL}
    void main(){
      vec3 d = normalize(vW - cameraPosition);
      vec3 c = eqSample(tA, d, uRot).rgb * uExp * uTint;
      if (uMix > 0.) c = mix(c, eqSample(tB, d, uRotB).rgb * uExpB * uTintB, uMix);
      ${hdr ? "c = min(c, vec3(10.));" : "c = c * (1. + .9 * c * c);"}
      c = mix(c, uFog, 1. - smoothstep(-.08, .03, d.y));
      gl_FragColor = vec4(c, 1.);
      ${hdr ? "#include <tonemapping_fragment>" : ""}
      #include <colorspace_fragment>
    }`,
  });
}

// A key's sky turned so its photographed sun stands at the key's azimuth, and the sun's light a little higher than the
// photographed sun, so it rakes across the slabs instead of skimming the ground.
export function orient(key, hdr) {
  const hs = hdr.userData.sun;
  const rot = key.sunAz * DEG - Math.atan2(hs.z, hs.x);
  const c = Math.cos(rot), s = Math.sin(rot);
  const sunDir = new THREE.Vector3(c * hs.x - s * hs.z, hs.y, s * hs.x + c * hs.z);
  { const a = Math.atan2(sunDir.z, sunDir.x), e = key.sunEl * DEG; sunDir.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)); }
  return { rot, sunDir };
}

// The sky, the sun and the hemisphere, lit by one key: `look` = { key, sky, hdr, rot, sunDir } (the key's photograph
// and HDR, turned). lookAt() moves them from one look to another.
export function makeDusk(scene, look) {
  const K = look.key;
  const fog = col(K.fog);
  scene.fog = new THREE.FogExp2(fog.clone(), K.fogD);
  const group = new THREE.Group();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), makeSkyMat(false, look.sky, look.rot, K.skyExp, K.tint, fog));
  sky.frustumCulled = false; sky.renderOrder = -10;
  sky.onBeforeRender = (r, sc, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  const hemi = new THREE.HemisphereLight(col(K.hemiS), col(K.hemiG), K.hemiI);
  const sun = new THREE.DirectionalLight(col(K.sunCol), K.sunI);
  const sunDir = look.sunDir.clone();
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
  group.add(sky, hemi, sun, sun.target);
  scene.add(group);
  return { group, sky, sun, hemi, sunDir, rot: look.rot, fog, scene, exp: K.exp, key: K };
}

// Aim the sun and its shadow at a box of half-width `half` round `centre`; jx, jy turn it a hair (radians) for the
// settled picture's soft edge. The shadow map is drawn again with the next frame.
const sx = new THREE.Vector3(), sy = new THREE.Vector3();
export function aimSun(d, renderer, centre, half, size, jx = 0, jy = 0) {
  const sun = d.sun, cam = sun.shadow.camera;
  sx.set(d.sunDir.z, 0, -d.sunDir.x).normalize(); sy.crossVectors(d.sunDir, sx);
  sun.target.position.copy(centre); sun.target.updateMatrixWorld();
  sun.position.copy(d.sunDir).addScaledVector(sx, jx).addScaledVector(sy, jy).normalize().multiplyScalar(half * 4 + 40).add(centre);
  if (cam.right !== half || sun.shadow.mapSize.x !== size) {
    cam.left = cam.bottom = -half; cam.right = cam.top = half; cam.near = 1; cam.far = half * 8 + 80; cam.updateProjectionMatrix();
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  }
  renderer.shadowMap.needsUpdate = true;
}

const ca = new THREE.Color(), cb = new THREE.Color();
const lerpCol = (out, a, b, f) => out.copy(ca.set(a)).lerp(cb.set(b), f);
// The light part way (f from 0 to 1) from look `a` to look `b`: the two photographs mixed, the sun, the hemisphere,
// the fog and the exposure in between. Returns the key's numbers at f, for the inside (lamps.js) and the desk.
export function lookAt(d, a, b, f) {
  const A = a.key, B = b.key, m = (x, y) => x + (y - x) * f;
  const u = d.sky.material.uniforms;
  u.tA.value = a.sky; u.uRot.value = a.rot; u.uExp.value = A.skyExp; u.uTint.value.set(A.tint);
  u.tB.value = b.sky; u.uRotB.value = b.rot; u.uExpB.value = B.skyExp; u.uTintB.value.set(B.tint);
  u.uMix.value = f >= 1 ? 0 : f;
  if (f >= 1) { u.tA.value = b.sky; u.uRot.value = b.rot; u.uExp.value = B.skyExp; u.uTint.value.set(B.tint); }
  lerpCol(d.fog, A.fog, B.fog, f);
  d.scene.fog.color.copy(d.fog); d.scene.fog.density = m(A.fogD, B.fogD);
  u.uFog.value.copy(d.fog);
  lerpCol(d.sun.color, A.sunCol, B.sunCol, f); d.sun.intensity = m(A.sunI, B.sunI);
  lerpCol(d.hemi.color, A.hemiS, B.hemiS, f); lerpCol(d.hemi.groundColor, A.hemiG, B.hemiG, f); d.hemi.intensity = m(A.hemiI, B.hemiI);
  // the sun swings through the sky between the two, never through the ground
  d.sunDir.copy(a.sunDir).lerp(b.sunDir, f);
  if (d.sunDir.lengthSq() < 1e-4) d.sunDir.copy(f < 0.5 ? a.sunDir : b.sunDir);
  d.sunDir.y = Math.max(d.sunDir.y, 0.08); d.sunDir.normalize();
  d.exp = m(A.exp, B.exp);
  d.key = f < 0.5 ? A : B;
  return { dim: m(A.dim, B.dim), lampK: m(A.lampK, B.lampK), sunIn: m(A.sunIn, B.sunIn), deskSun: m(A.deskSun, B.deskSun), paths: m(A.paths, B.paths),
    ridge: lerpCol(new THREE.Color(), A.ridge, B.ridge, f), ringDark: lerpCol(new THREE.Color(), A.ringDark, B.ringDark, f),
    ringGlow: lerpCol(new THREE.Color(), A.ringGlow, B.ringGlow, f), ringHaze: new THREE.Color(...A.ringHaze.map((v, i) => m(v, B.ringHaze[i]))), fog: d.fog };
}

// The light from the sky: a look's photographed sky, prefiltered once into an environment (one per theme, kept).
export function makeEnvironment(renderer, look, { phone = false, centre = new THREE.Vector3(0, 0, 0) } = {}) {
  const K = look.key;
  const fog = col(K.fog);
  const skyHdr = makeSkyMat(true, look.hdr, look.rot, K.envExp, K.tint, fog.clone().multiplyScalar(K.envExp * 0.22));
  const cubeRT = new THREE.WebGLCubeRenderTarget(phone ? 128 : 256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.5, 3000, cubeRT);
  cubeCam.position.copy(centre).add(new THREE.Vector3(0, 4, 10));
  const envScene = new THREE.Scene();
  const sphere = new THREE.SphereGeometry(100, 48, 24);
  const envSky = new THREE.Mesh(sphere, skyHdr);
  envSky.position.copy(cubeCam.position);
  const disc = new THREE.CircleGeometry(400, 32);
  const discM = new THREE.MeshBasicMaterial({ color: fog.clone().multiplyScalar(K.envGround), side: THREE.DoubleSide });
  const envGround = new THREE.Mesh(disc, discM);
  envGround.rotation.x = -Math.PI / 2; envGround.position.y = cubeCam.position.y - 4;
  envScene.add(envSky, envGround);
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  cubeCam.update(renderer, envScene);
  renderer.toneMapping = tm;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromCubemap(cubeRT.texture);
  pmrem.dispose(); cubeRT.dispose(); sphere.dispose(); disc.dispose(); discM.dispose(); skyHdr.dispose();
  return envRT;
}

// Far ridges in aerial perspective: drawn from constants, no file (both modes see them).
export function makeRidges(fog) {
  const g = new THREE.Group();
  const ridgeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false,
    uniforms: { uFog: { value: fog.clone() }, uDark: { value: col("#1c2a24").multiplyScalar(0.6) }, uHaze: { value: 0.5 } },
    vertexShader: "varying vec3 vP; varying float vH; void main(){ vP = position; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
    fragmentShader: `uniform vec3 uFog, uDark; uniform float uHaze; varying vec3 vP; varying float vH;
      float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n1(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f); return mix(mix(h1(i), h1(i+vec2(1,0)), u.x), mix(h1(i+vec2(0,1)), h1(i+vec2(1,1)), u.x), u.y); }
      void main(){ float a = atan(vP.z, vP.x); vec2 q = vec2(a * 260., vH * .5);
        float canopy = n1(q) * .5 + n1(q * 2.7) * .3 + n1(vec2(a * 60., vH * .12)) * .2;
        float haze = clamp(uHaze + (1. - smoothstep(0., 90., vH)) * .22 + (canopy - .5) * .05, 0., 1.);
        gl_FragColor = vec4(mix(uDark, uFog, haze), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for (const [R, amp, seed, haze] of [[560, 70, 10, 0.62], [860, 120, 31, 0.84]]) {
    const ridge = new THREE.CylinderGeometry(R, R, 1, 220, 1, true);
    const rp = ridge.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), z = rp.getZ(i);
      if (rp.getY(i) > 0) { const a = Math.atan2(z, x); rp.setY(i, 18 + fbm(a * 4 + seed, 2.1) * amp + vnoise(a * 23 + seed, 7) * 8); } else rp.setY(i, -2);
    }
    const m = ridgeMat.clone(); m.uniforms.uHaze.value = haze;
    const mesh = new THREE.Mesh(ridge, m); mesh.position.set(0, 0, 60); mesh.renderOrder = R > 600 ? -9 : -8;
    g.add(mesh);
  }
  ridgeMat.dispose();
  return g;
}

// The meadow: stony ground with grass in drifts, a concrete-dark contact shade round the plinth, rising behind.
// `foot` is the building's footprint { x0, x1, z0, z1 } in metres.
export function makeTerrain(A, { phone = false, foot }) {
  const tg = new THREE.PlaneGeometry(600, 400, phone ? 90 : 140, phone ? 60 : 96);
  tg.rotateX(-Math.PI / 2); tg.translate(0, 0, -120);
  const tp = tg.attributes.position, tuv = tg.attributes.uv, tc = new Float32Array(tp.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const far = Math.max(0, -z - 30);
    tp.setY(i, Math.pow(Math.min(far / 220, 1), 1.4) * 22 + fbm(x * 0.025, z * 0.025) * 3 * Math.min(far / 40, 1));
    tuv.setXY(i, x / 3.2, z / 3.2);
    const v = 0.78 + fbm(x * 0.3, z * 0.3) * 0.32 - 0.38 * smooth(-12, -40, z);
    const dx = Math.max(0, x < foot.x0 ? foot.x0 - x : x - foot.x1), dz = Math.max(0, z < foot.z0 ? foot.z0 - z : z - foot.z1);
    tmp.setRGB(v, v, v).multiplyScalar(1 - 0.15 * Math.exp(-Math.hypot(dx, dz) / 1.3));
    tc[i * 3] = tmp.r; tc[i * 3 + 1] = tmp.g; tc[i * 3 + 2] = tmp.b;
  }
  tg.setAttribute("color", new THREE.BufferAttribute(tc, 3));
  tg.computeVertexNormals();
  const gm = new THREE.MeshStandardMaterial({ vertexColors: true, map: A.tex.forest_ground_04_diff, normalMap: A.tex.forest_ground_04_nor, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, metalness: 0 });
  const tGrass = A.tex.forrest_ground_01_diff;
  // the yard (deck and beds) and the path, as rectangles x0, x1, z0, z1: gravel meets them, grass beyond, then the
  // forest floor, each edge broken by noise (T11)
  const yard = foot.yard || [foot.x0, foot.x1, foot.z0, foot.z1], path = foot.path || [0, 0, 0, 0];
  gm.onBeforeCompile = (sh) => {
    sh.uniforms.tGrass = { value: tGrass };
    sh.uniforms.tGravel = { value: A.tex.concrete_floor_02_diff || A.tex.forest_ground_04_diff };
    sh.uniforms.uYard = { value: new THREE.Vector4(...yard.map((v) => +v || 0)) };
    sh.uniforms.uPath = { value: new THREE.Vector4(...path.map((v) => +v || 0)) };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGW;").replace("#include <project_vertex>", "#include <project_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      uniform sampler2D tGrass, tGravel; uniform vec4 uYard, uPath; varying vec3 vGW;
      float sdr(vec2 p, vec4 r){ vec2 c = vec2(r.x + r.y, r.z + r.w) * .5, h = abs(vec2(r.y - r.x, r.w - r.z)) * .5; vec2 q = abs(p - c) - h; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }
      float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f); return mix(mix(gh(i), gh(i+vec2(1,0)), u.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), u.x), u.y); }`)
      .replace("#include <map_fragment>", `#ifdef USE_MAP
      vec3 soil = mix(texture2D(map, vMapUv).rgb, texture2D(map, vMapUv * .19 + vec2(.43, .17)).rgb, .5);
      vec3 grass = mix(texture2D(tGrass, vMapUv * .9).rgb, texture2D(tGrass, vMapUv * .23 + vec2(.2, .6)).rgb, .4) * vec3(.6, .78, .5);
      // a mown lawn near the house: the mower's passes show as soft bands, each a little lighter or darker
      float pass = sin(vGW.x * 2.6 + gn(vGW.xz * .3) * 1.2);
      float n = gn(vGW.xz * .06) * .6 + gn(vGW.xz * .17) * .4;
      float w = clamp(smoothstep(.35, .7, n) * 1.2, 0., 1.);
      float dy = min(sdr(vGW.xz, uYard), sdr(vGW.xz, uPath));
      float en = gn(vGW.xz * 1.7) * .55 + gn(vGW.xz * .45) * .45;
      // near the yard: a gravel margin, then a mown meadow; far off: the forest floor, in drifts
      float gravel = 1. - smoothstep(.5, 1.5, dy + (en - .5) * 1.4);
      float far = smoothstep(12., 32., dy + (n - .5) * 14.);
      w = mix(clamp(.82 + w * .3 + (en - .5) * .3, 0., 1.), w * .55, far);
      grass *= 1. + .07 * pass * (1. - far);
      vec3 grav = texture2D(tGravel, vGW.xz * .7).rgb * vec3(.92, .86, .78) * (.72 + .5 * gh(floor(vGW.xz * 16.)));
      diffuseColor.rgb *= mix(mix(soil * vec3(.62, .6, .52), grass * .8, w), grav * .7, gravel);
      #endif`);
  };
  gm.customProgramCacheKey = () => "terrain";
  const mesh = new THREE.Mesh(tg, gm);
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- the forest: baked fir impostors, one quad per tree turning to face the camera ----------
const IMP_GLSL = (frames, types) => `
attribute vec4 aI0; attribute vec4 aI1; attribute vec3 aTone;
uniform vec2 uSize[${types}]; uniform vec3 uFaceDir; uniform float uUseDir;
varying vec2 vAt; varying vec2 vAt2; varying float vBl; varying vec3 vRight; varying vec3 vToward; varying vec3 vTone; varying float vMir;
vec3 impostor(out vec3 tcv){
  vec3 C = aI0.xyz; float S = aI0.w; int ty = int(aI1.y + .5);
  vec3 tc = mix(cameraPosition - C, uFaceDir, uUseDir); tc.y = 0.; tc = normalize(tc + vec3(1e-4, 0., 0.));
  vec3 rgt = vec3(tc.z, 0., -tc.x);
  float az = atan(tc.x, tc.z) - aI1.x; if (aI1.z < 0.) az = -az;
  float fa = fract(az / 6.2831853) * ${frames}.;
  float f0 = mod(floor(fa), ${frames}.), f1 = mod(f0 + 1., ${frames}.); vBl = fract(fa);
  float ux = aI1.z < 0. ? 1. - uv.x : uv.x, vy = (${types}. - 1. - float(ty) + uv.y) / ${types}.;
  vAt = vec2((f0 + ux) / ${frames}., vy); vAt2 = vec2((f1 + ux) / ${frames}., vy);
  vRight = rgt; vToward = tc; vTone = aTone; vMir = aI1.z; tcv = tc;
  vec2 sz = uSize[ty] * S;
  return C + rgt * position.x * sz.x + vec3(0., position.y * sz.y, 0.);
}`;
export function makeForest(A, { phone = false, sunDir }) {
  const info = A.treesInfo;
  const F = Math.max(1, Math.min(64, info.frames | 0)), types = info.types.slice(0, 4), NT = types.length;
  const r = rng(7), N = phone ? 80 : 170, list = [];
  let guard = 0;
  // the nearest ring first (T11): firs close round the sides of the clearing and just behind the studio, each varied
  // in size, kind and tone, kept out of the cameras' line to the building
  const rc = rng(13), NC = phone ? 16 : 34;
  for (let k = 0; list.length < NC && k < 4000; k++) {
    const side = rc() < 0.5 ? -1 : 1;
    const behind = rc() < 0.35;
    const x = behind ? (rc() - 0.5) * 52 : side * (17 + rc() * 22);
    const z = behind ? -11 - rc() * 12 : -12 + rc() * (side > 0 ? 14 : 22);
    if (list.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    const type = Math.min(NT - 1, rc() < 0.3 ? 2 : rc() < 0.5 ? 0 : 1);
    const sc = [0.62, 0.85, 1.0][type] * (0.75 + rc() * 0.75);
    const v = 0.45 + rc() * 0.5, hue = rc();
    list.push({ x, y: -0.25, z, s: sc, yaw: rc() * 6.283, type, mirror: rc() < 0.5 ? -1 : 1, tone: [v * (0.78 + hue * 0.2), v, v * (0.95 - hue * 0.15)] });
  }
  while (list.length < N && guard++ < 60000) {
    const near = r() < 0.5;
    // backdrop only: the trees the camera sees behind and beside the studio, fewer and larger
    const x = near ? (r() - 0.5) * 110 : (r() - 0.5) * 300;
    const z = near ? -24 - r() * 40 : -40 - r() * 120;
    if (Math.abs(x) > 18 + (-z) * 1.2) continue;
    const groups = smooth(0.3, 0.6, fbm(x * 0.03 + 3.1, z * 0.03 - 7.4));
    if (r() > groups * 0.9 + 0.15) continue;
    const far = Math.max(0, -z - 30);
    const h = Math.pow(Math.min(far / 220, 1), 1.4) * 22;
    const type = Math.min(NT - 1, z > -30 && r() < 0.35 ? 2 : (r() < 0.45 ? 0 : 1));
    const sc = [0.62, 0.85, 1.0][type] * (0.95 + r() * 0.45) * (z < -70 ? 1.25 : 1);
    const v = 0.55 + r() * 0.4, hue = r();
    list.push({ x, y: h - 0.25, z, s: sc, yaw: r() * 6.283, type, mirror: r() < 0.5 ? -1 : 1, tone: [v * (0.8 + hue * 0.16), v, v * (0.98 - hue * 0.12)] });
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const i0 = new Float32Array(list.length * 4), i1 = new Float32Array(list.length * 4), tn = new Float32Array(list.length * 3);
  list.forEach((t, k) => { i0.set([t.x, t.y, t.z, t.s], k * 4); i1.set([t.yaw, t.type, t.mirror, 0], k * 4); tn.set(t.tone, k * 3); });
  g.setAttribute("aI0", new THREE.InstancedBufferAttribute(i0, 4)); g.setAttribute("aI1", new THREE.InstancedBufferAttribute(i1, 4)); g.setAttribute("aTone", new THREE.InstancedBufferAttribute(tn, 3));
  g.instanceCount = list.length;
  const tC = A.treesColor, tN = A.treesNormal;
  for (const t of [tC, tN]) { t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; t.needsUpdate = true; }
  const uni = { uSize: { value: types.map((t) => new THREE.Vector2(+t.width || 1, +t.height || 1)) }, uFaceDir: { value: sunDir.clone() }, uUseDir: { value: 0 }, tC: { value: tC }, tN: { value: tN } };
  const head = IMP_GLSL(F, NT);
  // the leaf outline comes from the colour atlas alone (the normal atlas carries no transparency)
  const mat = new THREE.MeshStandardMaterial({ color: col("#7b9a8c"), roughness: 0.92, metalness: 0, envMapIntensity: 0.75, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${head}`)
      .replace("#include <beginnormal_vertex>", "vec3 impTc; vec3 impPos = impostor(impTc);\nvec3 objectNormal = impTc;")
      .replace("#include <begin_vertex>", "vec3 transformed = impPos;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform sampler2D tC, tN; varying vec2 vAt; varying vec2 vAt2; varying float vBl; varying vec3 vRight; varying vec3 vToward; varying vec3 vTone; varying float vMir;")
      .replace("#include <map_fragment>", "vec4 cA = texture2D(tC, vAt), cB = texture2D(tC, vAt2); vec4 impC = mix(cA, cB, vBl); impC.rgb = (cA.rgb * cA.a * (1. - vBl) + cB.rgb * cB.a * vBl) / max(impC.a, .001); diffuseColor.rgb *= impC.rgb * vTone; diffuseColor.a = impC.a;")
      .replace("#include <normal_fragment_maps>", `vec3 nb = normalize(mix(texture2D(tN, vAt).xyz, texture2D(tN, vAt2).xyz, vBl) * 2. - 1.); nb.x *= vMir;
        normal = normalize((viewMatrix * vec4(normalize(vRight * nb.x + vec3(0., 1., 0.) * nb.y + vToward * nb.z), 0.)).xyz);`);
  };
  mat.customProgramCacheKey = () => `forest${F}x${NT}`;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  // the firs throw the sun's shadow too: in the shadow's own pass every tree turns to face the sun
  const face = sunDir.clone();
  mesh.customDepthMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uSize: uni.uSize, uFaceDir: { value: face }, uUseDir: { value: 1 }, tC: uni.tC },
    vertexShader: `${head}\nvoid main(){ vec3 tcv; vec3 p = impostor(tcv); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: "#include <packing>\nuniform sampler2D tC; varying vec2 vAt;\nvoid main(){ if (texture2D(tC, vAt).a < .5) discard; gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }",
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.setSun = (dir) => { face.copy(dir); };
  mesh.userData.dispose = () => { mesh.customDepthMaterial.dispose(); };
  return mesh;
}
