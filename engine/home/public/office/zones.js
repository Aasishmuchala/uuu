// The loft's zones (the owner chose photographs over 3D on 18 Nov 2026): where each department stands in the
// pictures of assets/office/v1/, measured on the pictures' own pixels (5504 x 3072, the dusk and the morning loft
// share one camera, and the two desks one), and how a stage frames a picture. Pure: no imports, no page, no clock.
//
// Every place is in percent of the picture: `x` from its left edge, `y` from its top. A zone has a rectangle (`box`:
// x, y, w, h) round its furniture, used for the light over it, and an `anchor` where its marker stands. No two boxes
// cross and every anchor lies in its own box only (test/office/zones.test.mjs).
//
// framing: the picture is laid out as a frame of its own shape (`cover`: the smallest frame that covers the stage,
// as object-fit: cover would), then moved and scaled by `viewOf` so a target (a few zones, one zone, the desk's
// objects) sits in the free part of the stage. The Map may show the frame smaller than the stage (the loft stands on
// a plain dusk or morning ground, which the stage paints round it); the desk always covers the stage.

// The picture's shape: 5504 x 3072.
export const ASPECT = 5504 / 3072;

// The seven departments of the seed, each at its furniture. People is at the drafting tables under the mezzanine
// (the plant group in front is cut by the picture's lower edge on most screens, so a marker there would be lost).
export const ZONES = Object.freeze({
  studio: Object.freeze({ id: "studio", what: "the model-making bench with the white massing models", box: { x: 11.5, y: 57, w: 25.5, h: 26 }, anchor: { x: 28.5, y: 66 } }),
  books: Object.freeze({ id: "books", what: "the library wall with the ladder", box: { x: 28.5, y: 22, w: 16.5, h: 35 }, anchor: { x: 36.5, y: 40 } }),
  operations: Object.freeze({ id: "operations", what: "the long table with the laptops", box: { x: 42, y: 62, w: 21, h: 21 }, anchor: { x: 52.5, y: 69 } }),
  support: Object.freeze({ id: "support", what: "the lounge with the leather sofa and the rug", box: { x: 66, y: 62, w: 21, h: 21 }, anchor: { x: 76.5, y: 70 } }),
  people: Object.freeze({ id: "people", what: "the drafting tables under the mezzanine", box: { x: 61, y: 51, w: 12.5, h: 11 }, anchor: { x: 66.5, y: 56 } }),
  sales: Object.freeze({ id: "sales", what: "the round table on the mezzanine", box: { x: 55.5, y: 25, w: 10, h: 18 }, anchor: { x: 61.2, y: 33.5 } }),
  marketing: Object.freeze({ id: "marketing", what: "the desks with screens and the print wall on the mezzanine", box: { x: 65.5, y: 11, w: 23.5, h: 37.5 }, anchor: { x: 78.3, y: 36.5 } }),
});

// The order zones are handed to departments the loft does not know by name (the seed's order).
export const ZONE_ORDER = Object.freeze(["operations", "sales", "marketing", "studio", "support", "people", "books"]);
export const ZONE_COUNT = ZONE_ORDER.length;

// The one marker for the three doors: by the tall steel window wall at the loft's left.
export const DOORS = Object.freeze({ id: "doors", what: "the big window wall", box: { x: 10.5, y: 25.5, w: 13.5, h: 31 }, anchor: { x: 17, y: 42 } });

// The whole building, and the part of it the overview keeps in the free area (every zone and the doors).
export const BUILDING = Object.freeze({ x: 2.4, y: 0.3, w: 93.6, h: 99.7 });
export const OVERVIEW = Object.freeze({ x: 9, y: 9, w: 82, h: 77 });

// The desk (Needs you): the paper stack under the lamp, the white model of the loft, the tray, and what the stage
// keeps in its free area.
export const DESK = Object.freeze({
  stack: { x: 30.5, y: 72.5 },
  model: { x: 44, y: 62 },
  tray: { x: 37.5, y: 85 },
  focus: { x: 22, y: 52, w: 34, h: 38 },
});

const fin = (v) => Number.isFinite(v);
const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ID = /^[a-z][a-z0-9-]{0,40}$/;

// Which zone each room takes: a room whose id names a zone takes it; every other room, in the server's order, the
// first zone still free in ZONE_ORDER; at most seven rooms are placed, the rest are in the list only.
// zonesFor(rooms) -> Map(roomId -> zoneId), in the rooms' order.
export function zonesFor(rooms) {
  const list = (Array.isArray(rooms) ? rooms : []).filter((r) => obj(r) && typeof r.id === "string" && ID.test(r.id));
  const seen = new Set();
  const ids = list.map((r) => r.id).filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  const taken = new Map();
  for (const id of ids) if (Object.hasOwn(ZONES, id)) taken.set(id, id);
  const free = ZONE_ORDER.filter((z) => !taken.has(z));
  const out = new Map();
  for (const id of ids) {
    if (taken.has(id)) out.set(id, id);
    else if (free.length) out.set(id, free.shift());
  }
  return out;
}

// The smallest frame of the picture's shape that covers a stage of w x h: { w, h } in pixels.
export function coverOf(w, h) {
  const W = fin(w) && w > 0 ? w : 0;
  const H = fin(h) && h > 0 ? h : 0;
  return W / Math.max(1, H) > ASPECT ? { w: W, h: W / ASPECT } : { w: H * ASPECT, h: H };
}

// One axis: where the frame's edge goes so `at` (pixels along the frame) lands on `want`, kept so the frame covers
// the stage when it is larger than it, or stays wholly on the stage when it is smaller.
function place(at, want, size, length) {
  const t = want - at;
  if (size >= length) return Math.min(0, Math.max(length - size, t));
  return Math.min(length - size, Math.max(0, t));
}

// viewOf({ stage: { w, h }, safe: { x, y, w, h } | null, target: { x, y, w, h } in percent, fill, least, most })
// -> { x, y, s, w, h }: the frame's top left in stage pixels, its scale over the cover frame and the cover frame's size.
// The target is fitted into the free rectangle with `fill` of it used (0.92 by default); the scale is kept between
// `least` and `most`; `cover: true` keeps it at least 1, so the picture always covers the stage.
export function viewOf({ stage, safe = null, target = OVERVIEW, fill = 0.92, least = 0.45, most = 1, cover = false } = {}) {
  const W = obj(stage) && fin(stage.w) && stage.w > 0 ? stage.w : 0;
  const H = obj(stage) && fin(stage.h) && stage.h > 0 ? stage.h : 0;
  if (!W || !H) return null;
  const base = coverOf(W, H);
  const S = obj(safe) && fin(safe.w) && fin(safe.h) && safe.w > 40 && safe.h > 40
    ? { x: fin(safe.x) ? safe.x : 0, y: fin(safe.y) ? safe.y : 0, w: safe.w, h: safe.h } : { x: 0, y: 0, w: W, h: H };
  const T = obj(target) ? target : OVERVIEW;
  const tw = Math.max(1, T.w) / 100;
  const th = Math.max(1, T.h) / 100;
  const fit = Math.min((S.w * fill) / (tw * base.w), (S.h * fill) / (th * base.h));
  const s = Math.max(cover ? 1 : 0, Math.min(Math.max(most, cover ? 1 : 0), Math.max(least, fit)));
  const fw = base.w * s;
  const fh = base.h * s;
  const cx = ((T.x + T.w / 2) / 100) * fw;
  const cy = ((T.y + T.h / 2) / 100) * fh;
  const x = place(cx, S.x + S.w / 2, fw, W);
  const y = place(cy, S.y + S.h / 2, fh, H);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, s: Math.round(s * 10000) / 10000, w: Math.round(base.w * 10) / 10, h: Math.round(base.h * 10) / 10 };
}

// A point of the picture (percent) in stage pixels under a view.
export function project(view, p) {
  if (!obj(view) || !obj(p)) return null;
  return { x: view.x + (p.x / 100) * view.w * view.s, y: view.y + (p.y / 100) * view.h * view.s };
}

// What the camera looks at for one zone opened: its box grown to at least 30 x 34 percent round its centre.
export function roomTarget(zoneId) {
  const z = Object.hasOwn(ZONES, zoneId) ? ZONES[zoneId] : null;
  if (!z) return OVERVIEW;
  const w = Math.max(30, z.box.w * 1.35);
  const h = Math.max(34, z.box.h * 1.35);
  const cx = z.box.x + z.box.w / 2;
  const cy = z.box.y + z.box.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
