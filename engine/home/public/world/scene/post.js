// The camera's half of the picture (REAL-1): the scene is drawn into a half-float picture with its depth, and a short
// chain of full-screen passes turns that into a photograph: ambient occlusion found from the depth, bloom round
// whatever is brighter than paper, the exposure and the film curve (AgX), a lens vignette and a little grain.
//
// The scene is almost always still, so the picture is finished after the camera settles: each further frame is drawn
// with the pixel grid, the lens and the lights moved a hair (world.js gives the hairs) and averaged into the one
// before. A few dozen frames give soft shadows, clean edges and a real depth of field; then nothing is drawn (D4).
//
// Shader text is built from constants only; what changes enters as uniforms (D9).
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";

const VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }";
const BLOOM_LEVELS = 5;

function fsMaterial(fragmentShader, uniforms, extra = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, fog: false, toneMapped: false, ...extra });
}

// Ambient occlusion from the depth alone (after McGuire's scalable obscurance): the normal from the depth's own
// neighbours, a spiral of taps turned per pixel and per frame, so the settled picture averages the noise away.
const AO_FRAG = `
uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uTexel; uniform float uRadius, uScale, uTurn;
varying vec2 vUv;
vec3 posAt(vec2 uv){ float d = texture2D(tDepth, uv).x; vec4 c = uProjInv * vec4(uv * 2. - 1., d * 2. - 1., 1.); return c.xyz / c.w; }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
void main(){
  // this pass is half the depth's size: read from the middle of one of the depth's own pixels, so the point and its
  // four neighbours are five different pixels (from a corner the normal comes out in bands)
  vec2 c0 = (floor(vUv / uTexel) + .5) * uTexel;
  float d0 = texture2D(tDepth, c0).x;
  if (d0 >= .99999) { gl_FragColor = vec4(1.); return; }
  vec3 p = posAt(c0);
  vec3 l = p - posAt(c0 - vec2(uTexel.x, 0.)), r = posAt(c0 + vec2(uTexel.x, 0.)) - p;
  vec3 dn = p - posAt(c0 - vec2(0., uTexel.y)), up = posAt(c0 + vec2(0., uTexel.y)) - p;
  vec3 n = normalize(cross(abs(l.z) < abs(r.z) ? l : r, abs(dn.z) < abs(up.z) ? dn : up));
  float R = uRadius, R2 = R * R;
  float rpx = min(uScale * R / max(-p.z, .001), .12);
  float a0 = (ign(gl_FragCoord.xy) + uTurn) * 6.2831853, sum = 0.;
  for (int i = 0; i < 8; i++) {
    float t = (float(i) + .5) / 8., a = a0 + float(i) * 2.3999632;
    vec2 uv = c0 + vec2(cos(a) * uTexel.x / uTexel.y, sin(a)) * t * rpx;
    vec3 v = posAt(uv) - p;
    float vv = dot(v, v), vn = dot(v, n) - .012 * R - .002 * -p.z;
    float f = max(R2 - vv, 0.);
    sum += f * f * f * max(vn / (vv + .0001 * R2), 0.);
  }
  float ao = max(0., 1. - sum * 5. / (8. * R2 * R2 * R2) * R);
  gl_FragColor = vec4(vec3(ao), 1.);
}`;

const BLOOM_PRE = `
uniform sampler2D tMap; uniform vec2 uTexel; uniform float uKnee; varying vec2 vUv;
vec3 pre(vec2 uv){ vec3 c = min(texture2D(tMap, uv).rgb, vec3(60.)); float l = max(c.r, max(c.g, c.b)); return c * max(l - uKnee, 0.) / max(l, 1e-4) / (1. + l * .04); }
void main(){
  vec3 c = pre(vUv + uTexel * vec2(-1., -1.)) + pre(vUv + uTexel * vec2(1., -1.)) + pre(vUv + uTexel * vec2(-1., 1.)) + pre(vUv + uTexel * vec2(1., 1.));
  gl_FragColor = vec4(c * .25, 1.);
}`;
const BLOOM_DOWN = `
uniform sampler2D tMap; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tMap, vUv).rgb * 4.;
  c += texture2D(tMap, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tMap, vUv + uTexel * vec2(1., -1.)).rgb + texture2D(tMap, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tMap, vUv + uTexel * vec2(1., 1.)).rgb;
  gl_FragColor = vec4(c * .125, 1.);
}`;
const BLOOM_UP = `
uniform sampler2D tMap, tAdd; uniform vec2 uTexel; uniform float uSpread; varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 c = texture2D(tMap, vUv).rgb * 4.;
  c += (texture2D(tMap, vUv + vec2(t.x, 0.)).rgb + texture2D(tMap, vUv - vec2(t.x, 0.)).rgb + texture2D(tMap, vUv + vec2(0., t.y)).rgb + texture2D(tMap, vUv - vec2(0., t.y)).rgb) * 2.;
  c += texture2D(tMap, vUv + t).rgb + texture2D(tMap, vUv - t).rgb + texture2D(tMap, vUv + vec2(t.x, -t.y)).rgb + texture2D(tMap, vUv + vec2(-t.x, t.y)).rgb;
  gl_FragColor = vec4(c / 16. * uSpread + texture2D(tAdd, vUv).rgb, 1.);
}`;

// The scene with its occlusion and its bloom, still in scene light, laid into the settled picture with weight uMix.
const MIX_FRAG = `
uniform sampler2D tScene, tAO, tBloom; uniform vec2 uAOTexel; uniform float uMix, uAO, uBloom; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tScene, vUv).rgb;
  float ao = (texture2D(tAO, vUv + uAOTexel * vec2(-1., -1.)).r + texture2D(tAO, vUv + uAOTexel * vec2(1., -1.)).r + texture2D(tAO, vUv + uAOTexel * vec2(-1., 1.)).r + texture2D(tAO, vUv + uAOTexel * vec2(1., 1.)).r) * .25;
  float l = max(c.r, max(c.g, c.b));
  // what glows is not shaded by its neighbours
  ao = mix(mix(1., ao, uAO), 1., smoothstep(1.2, 4., l));
  // occlusion darkens toward a warm dark, as light bounced in a corner does, never to grey soot
  c *= mix(vec3(ao), vec3(1.), vec3(.16, .1, .06) * (1. - ao));
  c += texture2D(tBloom, vUv).rgb * uBloom;
  gl_FragColor = vec4(c, uMix);
}`;

// The print: exposure and the film curve (the renderer's AgX), a little more contrast and colour than AgX's base
// look, the lens vignette, and grain that stands still, as in a photograph.
const SHOW_FRAG = `
uniform sampler2D tMap; uniform vec2 uSize; uniform float uVignette, uGrain, uContrast, uSat; uniform vec3 uLift;
varying vec2 vUv;
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  vec3 c = texture2D(tMap, vUv).rgb;
  vec2 q = (vUv - .5) * vec2(uSize.x / uSize.y, 1.);
  float v = dot(q, q);
  c *= 1. / pow(1. + v * uVignette, 2.);
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  c = gl_FragColor.rgb;
  float l = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(l), c, uSat);
  c = pow(max(c, 0.), vec3(uContrast)) * pow(.18, 1. - uContrast);
  c += uLift * (1. - smoothstep(0., .25, l));
  gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
  #include <colorspace_fragment>
  float g = h21(gl_FragCoord.xy) + h21(gl_FragCoord.yx + 17.3) - 1.;
  gl_FragColor.rgb += g * uGrain * (1. - .6 * dot(gl_FragColor.rgb, vec3(.33)));
}`;

export function makePost(renderer, { phone = false } = {}) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(tri, null); quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const half = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
  // (a float depth: with fewer bits the occlusion shows the depth's own steps as bands on ground seen at a low angle)
  const depth = new THREE.DepthTexture(4, 4, THREE.FloatType); depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const scene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: phone ? 2 : 4, depthTexture: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const ao = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const acc = new THREE.WebGLRenderTarget(4, 4, { ...half });
  const down = Array.from({ length: BLOOM_LEVELS }, () => new THREE.WebGLRenderTarget(4, 4, { ...half }));
  const up = Array.from({ length: BLOOM_LEVELS - 1 }, () => new THREE.WebGLRenderTarget(4, 4, { ...half }));

  const aoM = fsMaterial(AO_FRAG, { tDepth: { value: depth }, uProjInv: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.6 }, uScale: { value: 1 }, uTurn: { value: 0 } });
  const preM = fsMaterial(BLOOM_PRE, { tMap: { value: scene.texture }, uTexel: { value: new THREE.Vector2() }, uKnee: { value: 1.1 } });
  const downM = fsMaterial(BLOOM_DOWN, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const upM = fsMaterial(BLOOM_UP, { tMap: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 0.85 } });
  const mixM = fsMaterial(MIX_FRAG, { tScene: { value: scene.texture }, tAO: { value: ao.texture }, tBloom: { value: up[0].texture }, uAOTexel: { value: new THREE.Vector2() }, uMix: { value: 1 }, uAO: { value: 1 }, uBloom: { value: 0.1 } },
    { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor });
  const showM = fsMaterial(SHOW_FRAG, { tMap: { value: acc.texture }, uSize: { value: new THREE.Vector2(1, 1) }, uVignette: { value: 0.32 }, uGrain: { value: 0.018 }, uContrast: { value: 1.12 }, uSat: { value: 1.12 }, uLift: { value: new THREE.Color(0, 0, 0) } }, { toneMapped: true });
  const mats = [aoM, preM, downM, upM, mixM, showM];
  let W = 0, H = 0;

  const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, cam); };

  return {
    target: scene,
    look: { ao: aoM.uniforms, mix: mixM.uniforms, show: showM.uniforms, pre: preM.uniforms, up: upM.uniforms },
    // (samples: how many the scene's picture takes a pixel; fewer while something moves)
    setSize(w, h, samples = scene.samples) {
      w = Math.max(2, w | 0); h = Math.max(2, h | 0);
      if (w === W && h === H && samples === scene.samples) return;
      if (samples !== scene.samples) { scene.samples = samples; scene.dispose(); }
      W = w; H = h;
      scene.setSize(w, h); acc.setSize(w, h);
      const aw = Math.max(1, w >> 1), ah = Math.max(1, h >> 1);
      ao.setSize(aw, ah);
      down.forEach((t, i) => t.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
      up.forEach((t, i) => t.setSize(Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))));
      showM.uniforms.uSize.value.set(w, h);
    },
    // Draw one frame. n = 1: a whole new picture (something moved). n > 1: the nth frame of the settled picture,
    // averaged in with weight 1/n.
    render(sceneGraph, camera, n = 1) {
      const auto = renderer.autoClear;
      renderer.setRenderTarget(scene);
      renderer.autoClear = true;
      renderer.render(sceneGraph, camera);
      renderer.autoClear = false;
      aoM.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      aoM.uniforms.uTexel.value.set(1 / W, 1 / H);
      aoM.uniforms.uScale.value = camera.projectionMatrix.elements[5] * 0.5;
      aoM.uniforms.uTurn.value = (n * 0.61803398875) % 1;
      pass(aoM, ao);
      preM.uniforms.uTexel.value.set(1 / W, 1 / H);
      pass(preM, down[0]);
      for (let i = 1; i < BLOOM_LEVELS; i++) { downM.uniforms.tMap.value = down[i - 1].texture; downM.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height); pass(downM, down[i]); }
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const src = i === BLOOM_LEVELS - 2 ? down[i + 1] : up[i + 1];
        upM.uniforms.tMap.value = src.texture; upM.uniforms.tAdd.value = down[i].texture; upM.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        pass(upM, up[i]);
      }
      mixM.uniforms.uAOTexel.value.set(0.5 / ao.width, 0.5 / ao.height);
      mixM.uniforms.uMix.value = 1 / Math.max(1, n);
      pass(mixM, acc);
      pass(showM, null);
      renderer.autoClear = auto;
    },
    dispose() {
      for (const t of [scene, ao, acc, ...down, ...up]) t.dispose();
      depth.dispose(); tri.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

// The nth point of the Halton sequence in base b (0..1): the same hairs every time, so the same picture every time.
export function halton(n, b) { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; }
// A point of the unit disc from two numbers in 0..1 (Shirley's concentric map).
export function disc(u, v) {
  const a = 2 * u - 1, b = 2 * v - 1;
  if (a === 0 && b === 0) return [0, 0];
  const [r, t] = Math.abs(a) > Math.abs(b) ? [a, (Math.PI / 4) * (b / a)] : [b, Math.PI / 2 - (Math.PI / 4) * (a / b)];
  return [r * Math.cos(t), r * Math.sin(t)];
}
