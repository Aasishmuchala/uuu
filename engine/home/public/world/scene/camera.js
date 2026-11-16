// The two camera rigs (PLAN-3D D15, T6 g; from the approved prototype's map.js and needs.js).
// Rig A, the Map: the whole studio in a low three-quarter view, or framed on one room. Rig B, Needs you: the desk
// seen from the owner's chair. Both frame their subject inside the page's free rectangle (`safeRect`, the stage minus
// the rail, the panel, the sheet and the list): the subject is fitted to the rectangle's size and moved to its centre
// with a view offset, so a resize keeps it there.
import * as THREE from "../../vendor/three-0.169.0/three.module.min.js";
import { ease } from "./dusk.js";

const DEG = Math.PI / 180;

// The free rectangle inside a stage of w x h, or the whole stage.
export function safeOf(size, safe) {
  const W = Math.max(1, size.w), H = Math.max(1, size.h);
  const ok = safe && [safe.x, safe.y, safe.w, safe.h].every(Number.isFinite) && safe.w >= 40 && safe.h >= 40;
  if (!ok) return { x: 0, y: 0, w: W, h: H };
  const x = Math.max(0, Math.min(W - 40, safe.x)), y = Math.max(0, Math.min(H - 40, safe.y));
  return { x, y, w: Math.min(W - x, safe.w), h: Math.min(H - y, safe.h) };
}

const view = (pos, look, fov, cx, cy) => ({ pos, look, fov, cx, cy });

// Rig A. The plan's building and annex give the overview's extent; a room gives its own.
export function mapView(plan, focus, size, safe, tier) {
  const s = safeOf(size, safe);
  const H = Math.max(1, size.h);
  const t = Math.tan(15 * DEG);
  const phone = tier === "phone";
  const B = plan.building;
  const room = focus && plan.rooms.find((r) => r.id === focus);
  let tx, ty, tz, az, el, r;
  if (!room) {
    const top = B.groundY + B.storeys * B.floorH + 0.12 + (plan.terrace && plan.terrace.onRoof ? 2.6 : 0);
    const x0 = B.x0, x1 = plan.annex.x1;
    // the studio is the picture: a low three-quarter view, the whole building with the forecourt in front
    const wide = x1 - x0 + (phone ? 3.4 : 8.9), tall = top + (phone ? 2.0 : 3.5);
    r = Math.max(wide * H / (2 * t * s.w), tall / (2 * t) * H / s.h);
    tx = (x0 + x1) / 2 + 0.15; ty = top * 0.47; tz = 0; az = 24; el = 10;
  } else {
    const wide = room.x1 - room.x0 + 1.2, tall = 4.0;
    r = Math.max(wide * H / (2 * t * s.w), tall / (2 * t) * H / s.h) * 1.22 + 3.0;
    tx = (room.x0 + room.x1) / 2; ty = room.y + 1.45; tz = 0.4; az = 12; el = 5;
  }
  const a = az * DEG, e = el * DEG;
  const look = new THREE.Vector3(tx, ty, tz);
  const pos = new THREE.Vector3(tx + Math.sin(a) * Math.cos(e) * r, ty + Math.sin(e) * r, tz + Math.cos(a) * Math.cos(e) * r);
  return view(pos, look, 30, s.x + s.w / 2, s.y + s.h / 2 + (phone ? 0 : 30));
}

// Rig B. `at` is the desk's place in the world; `empty` turns to the model and the empty tray.
export function deskView(at, size, safe, tier, { empty = false } = {}) {
  const s = safeOf(size, safe);
  const H = Math.max(1, size.h);
  const phone = tier === "phone";
  const v = empty
    ? (phone ? { x: 0.92, y: 0.55, z: 0.45, tx: 0.28, ty: 0.08, tz: -0.62, fov: 40 } : { x: 0.92, y: 0.62, z: 0.62, tx: 0.28, ty: 0.08, tz: -0.62, fov: 36 })
    : (phone ? { x: 0.1, y: 0.62, z: 0.56, tx: 0.26, ty: 0, tz: -0.38, fov: 42 } : { x: -0.02, y: 0.6, z: 0.86, tx: 0.16, ty: 0.02, tz: -0.5, fov: 38 });
  const look = new THREE.Vector3(at.x + v.tx, at.y + v.ty, at.z + v.tz);
  const pos = new THREE.Vector3(at.x + v.x, at.y + v.y, at.z + v.z);
  // the model and the stack (about 0.65 m across) fit inside the free rectangle: step back when it is narrow; the
  // lamp and the tray may run under the sheet and the list (T11: at 1280 the 0.85 m fit left the model small)
  const d = pos.distanceTo(look), t = Math.tan(v.fov * DEG / 2);
  const across = 2 * d * t * s.w / H;
  const need = phone ? 0.6 : 0.66;
  if (across < need) pos.sub(look).multiplyScalar(Math.min(2.2, need / across)).add(look);
  return view(pos, look, v.fov, s.x + s.w / 2, s.y + s.h / 2);
}

// Put a view on the camera for a stage of w x h.
export function applyView(camera, v, size) {
  const W = Math.max(1, size.w), H = Math.max(1, size.h);
  camera.aspect = W / H;
  camera.fov = v.fov;
  camera.position.copy(v.pos);
  camera.lookAt(v.look);
  camera.setViewOffset(W, H, W / 2 - v.cx, H / 2 - v.cy, W, H);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

// A glide between two views (650 ms on the Map, 900 ms at the desk), eased.
export function makeGlide() {
  let from = null, to = null, t = 1, dur = 650;
  const cur = view(new THREE.Vector3(), new THREE.Vector3(), 30, 0, 0);
  const set = (v) => { cur.pos.copy(v.pos); cur.look.copy(v.look); cur.fov = v.fov; cur.cx = v.cx; cur.cy = v.cy; };
  return {
    cur,
    jump(v) { set(v); from = to = null; t = 1; },
    go(v, ms) { from = view(cur.pos.clone(), cur.look.clone(), cur.fov, cur.cx, cur.cy); to = v; t = 0; dur = ms; },
    retarget(v) { if (to) to = v; else set(v); },
    moving: () => t < 1,
    step(dt) {
      if (t >= 1 || !to) return false;
      t = Math.min(1, t + dt / dur);
      const e = ease(t);
      cur.pos.lerpVectors(from.pos, to.pos, e); cur.look.lerpVectors(from.look, to.look, e);
      cur.fov = from.fov + (to.fov - from.fov) * e; cur.cx = from.cx + (to.cx - from.cx) * e; cur.cy = from.cy + (to.cy - from.cy) * e;
      if (t >= 1) { set(to); from = to = null; }
      return true;
    },
  };
}
