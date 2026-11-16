// Dusk around the studio (PLAN-3D D5, T6; from the approved prototype's world.js): the renderer, the photographed
// sunset (Poly Haven, CC0) as an HDR for the light and a picture for the eye, the hemisphere and the sun, the stony
// meadow, the far ridges in aerial perspective, the baked fir impostors and the environment light, prefiltered once.
// No shadow maps (D21): the building's shadow is found in its own materials (lamps.js). Shader text is built from
// constants only.
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

// The lake-house's first key, the sky turned so the sunset glows behind the building, to the left.
export const DUSK = { sunAz: -128, skyExp: 0.8, tint: "#ffd6bd", envExp: 0.5, sunCol: "#ff9a62", sunI: 1.25, hemiS: "#4d6383", hemiG: "#1c1712", hemiI: 0.06, exp: 1.0, fog: "#5d4c4c", fogD: 0.0055 };

export function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", stencil: false, preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DUSK.exp;
  renderer.shadowMap.enabled = false;
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
function makeSkyMat(hdr, tex, rot, exp, tint, fog) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: hdr,
    uniforms: { tA: { value: tex }, uRot: { value: rot }, uExp: { value: exp }, uTint: { value: col(tint) }, uFog: { value: fog.clone() } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; gl_Position.z = gl_Position.w; }",
    fragmentShader: `uniform sampler2D tA; uniform float uRot, uExp; uniform vec3 uTint, uFog; varying vec3 vW;
    ${EQ_GLSL}
    void main(){
      vec3 d = normalize(vW - cameraPosition);
      vec3 c = eqSample(tA, d, uRot).rgb * uExp * uTint;
      ${hdr ? "c = min(c, vec3(10.));" : ""}
      c = mix(c, uFog, 1. - smoothstep(-.08, .03, d.y));
      gl_FragColor = vec4(c, 1.);
      ${hdr ? "#include <tonemapping_fragment>" : ""}
      #include <colorspace_fragment>
    }`,
  });
}

// The sky, the sun and the hemisphere; returns what the other parts need (the sun's direction, the sky's turn).
export function makeDusk(scene, A) {
  const fog = col(DUSK.fog);
  scene.fog = new THREE.FogExp2(fog, DUSK.fogD);
  const hs = A.hdr.userData.sun;
  const rot = DUSK.sunAz * DEG - Math.atan2(hs.z, hs.x);
  const c = Math.cos(rot), s = Math.sin(rot);
  const sunW = new THREE.Vector3(c * hs.x - s * hs.z, hs.y, s * hs.x + c * hs.z);
  // the light stands a little higher than the photographed sun, so it rakes across the slabs instead of skimming the ground
  const sunDir = sunW.clone();
  { const a = Math.atan2(sunDir.z, sunDir.x), e = 16 * DEG; sunDir.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)); }

  const group = new THREE.Group();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), makeSkyMat(false, A.sky, rot, DUSK.skyExp, DUSK.tint, fog));
  sky.frustumCulled = false; sky.renderOrder = -10;
  sky.onBeforeRender = (r, sc, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  const hemi = new THREE.HemisphereLight(col(DUSK.hemiS), col(DUSK.hemiG), DUSK.hemiI);
  const sun = new THREE.DirectionalLight(col(DUSK.sunCol), DUSK.sunI);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.target.position.set(0, 0, 0);
  group.add(sky, hemi, sun, sun.target);
  scene.add(group);
  return { group, sky, sun, hemi, sunDir, rot, fog, skyHdr: makeSkyMat(true, A.hdr, rot, DUSK.envExp, DUSK.tint, fog.clone().multiplyScalar(DUSK.envExp * 0.22)) };
}

// The light from the sky: the photographed sunset, prefiltered once into the scene's environment.
export function makeEnvironment(renderer, scene, dusk, { phone = false, centre = new THREE.Vector3(0, 0, 0) } = {}) {
  const cubeRT = new THREE.WebGLCubeRenderTarget(phone ? 128 : 256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.5, 3000, cubeRT);
  cubeCam.position.copy(centre).add(new THREE.Vector3(0, 4, 10));
  const envScene = new THREE.Scene();
  const sphere = new THREE.SphereGeometry(100, 48, 24);
  const envSky = new THREE.Mesh(sphere, dusk.skyHdr);
  envSky.position.copy(cubeCam.position);
  const disc = new THREE.CircleGeometry(400, 32);
  const discM = new THREE.MeshBasicMaterial({ color: col(DUSK.fog).multiplyScalar(0.09), side: THREE.DoubleSide });
  const envGround = new THREE.Mesh(disc, discM);
  envGround.rotation.x = -Math.PI / 2; envGround.position.y = cubeCam.position.y - 4;
  envScene.add(envSky, envGround);
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  cubeCam.update(renderer, envScene);
  renderer.toneMapping = tm;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  pmrem.dispose(); cubeRT.dispose(); sphere.dispose(); disc.dispose(); discM.dispose(); dusk.skyHdr.dispose();
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
        float haze = clamp(uHaze + (1. - smoothstep(0., 70., vH)) * .14 + (canopy - .5) * .06, 0., 1.);
        gl_FragColor = vec4(mix(uDark, uFog, haze), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for (const [R, amp, seed, haze] of [[560, 70, 10, 0.5], [860, 120, 31, 0.72]]) {
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
    tmp.setRGB(v, v, v).multiplyScalar(1 - 0.5 * Math.exp(-Math.hypot(dx, dz) / 1.3));
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
      vec3 grass = mix(texture2D(tGrass, vMapUv * .9).rgb, texture2D(tGrass, vMapUv * .23 + vec2(.2, .6)).rgb, .4) * vec3(.62, .7, .56);
      float n = gn(vGW.xz * .06) * .6 + gn(vGW.xz * .17) * .4;
      float w = clamp(smoothstep(.35, .7, n) * 1.2, 0., 1.);
      float dy = min(sdr(vGW.xz, uYard), sdr(vGW.xz, uPath));
      float en = gn(vGW.xz * 1.7) * .55 + gn(vGW.xz * .45) * .45;
      // near the yard: a gravel margin, then a mown meadow; far off: the forest floor, in drifts
      float gravel = 1. - smoothstep(.5, 1.5, dy + (en - .5) * 1.4);
      float far = smoothstep(12., 32., dy + (n - .5) * 14.);
      w = mix(clamp(.55 + w * .6 + (en - .5) * .5, 0., 1.), w * .55, far);
      vec3 grav = texture2D(tGravel, vGW.xz * .7).rgb * vec3(.92, .86, .78) * (.72 + .5 * gh(floor(vGW.xz * 16.)));
      diffuseColor.rgb *= mix(mix(soil, grass, w) * vec3(.62, .6, .52), grav * .62, gravel);
      #endif`);
  };
  gm.customProgramCacheKey = () => "terrain";
  return new THREE.Mesh(tg, gm);
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
  return mesh;
}
