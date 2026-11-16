// The studio building's plan from the company's departments (PLAN-3D D8, 2.5): which floor each room is on, where it
// starts and ends, where its desks stand, the annex with the three doors and the roof terrace. Plain numbers in
// world metres (x along the front, z from the back wall to the cut, y up), the same answer for the same input, and
// no imports, no page, no clock and no randomness, so the scene, the drawn fallback and the tests read one plan.
//
// Rules: rooms keep the server's order; the ground floor takes the first two, each floor above up to three, at most
// four floors (11 rooms); the rest are `overflow` (list only). A room's width follows its agent count clamped 2 to 6,
// never under 4.0 m; floors narrower than the widest are stretched to the building's span, except the top floor,
// which leaves the rest of its length to the terrace when that is at least 4.0 m (else the terrace is on the roof).
// At most six desks a room, in one row; more agents are `more` (the "+N" on the last desk).

export const FLOOR_H = 3.3;          // floor to floor
export const GROUND_Y = 0.6;         // the ground floor's top, over the plinth
export const ROOM_Z = [-3.6, 3.6];   // back wall to the cut
export const DESK_Z = -1.25;         // the desks' row, towards the back
export const MIN_ROOM = 4.0;         // no room is narrower
export const DESK_PITCH = 1.7;       // a desk's share of a room's length
export const ROOM_EDGE = 0.7;        // free floor at each end of the desk row
export const MAX_DESKS = 6;
export const MAX_FLOORS = 4;
export const GROUND_ROOMS = 2;
export const FLOOR_ROOMS = 3;
export const MAX_ROOMS = GROUND_ROOMS + FLOOR_ROOMS * (MAX_FLOORS - 1);
export const ANNEX_W = 3.1;          // the annex at ground right, three doors a metre apart
export const DOOR_IDS = Object.freeze(["web", "generation", "higgsfield"]);
export const TERRACE_MIN = 4.0;      // the least terrace kept beside the top floor's rooms
export const TERRACE_W = 4.6;        // the terrace's length when it stands on the roof
export const EMPTY_SPAN = 9.6;       // the dark shell drawn when there is no department

const ID = /^[a-z][a-z0-9-]{0,40}$/;
const arr = (v) => (Array.isArray(v) ? v : []);
const r2 = (v) => Math.round(v * 100) / 100;
const slugOf = (a) => (typeof a === "string" ? a : a && typeof a === "object" && typeof a.slug === "string" ? a.slug : null);

// A room's natural length for `n` agents.
export function roomWidth(n) {
  const c = Math.min(MAX_DESKS, Math.max(2, Number.isFinite(n) ? Math.floor(n) : 0));
  return Math.max(MIN_ROOM, r2(DESK_PITCH * c + 2 * ROOM_EDGE));
}

// The rooms the plan can use: objects with an id that is a plain slug, the first of each id, with the slugs of
// their agents (plain slugs only, each once in the whole building).
function cleanRooms(rooms) {
  const seenRooms = new Set();
  const seenAgents = new Set();
  const out = [];
  for (const r of arr(rooms)) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !ID.test(r.id) || seenRooms.has(r.id)) continue;
    seenRooms.add(r.id);
    const slugs = [];
    for (const a of arr(r.agents)) {
      const s = slugOf(a);
      if (typeof s !== "string" || !ID.test(s) || seenAgents.has(s)) continue;
      seenAgents.add(s);
      slugs.push(s);
    }
    out.push({ id: r.id, slugs });
  }
  return out;
}

// Which rooms go on which floor: two on the ground, three on each floor above, at most four floors.
function floorsOf(list) {
  const floors = [];
  let i = 0;
  while (i < list.length && floors.length < MAX_FLOORS) {
    const take = floors.length === 0 ? GROUND_ROOMS : FLOOR_ROOMS;
    floors.push(list.slice(i, i + take));
    i += take;
  }
  return { floors, overflow: list.slice(i) };
}

function annexAt(x1) {
  return { floor: 0, x0: r2(x1), x1: r2(x1 + ANNEX_W), doors: DOOR_IDS.map((id, i) => ({ id, x: r2(x1 + 0.55 + i) })) };
}

// planBuilding(rooms) -> { floors, rooms, annex, terrace, overflow, empty, building }.
// `rooms`: [{ id, agents: [{ slug } | slug] }] in the server's order.
export function planBuilding(rooms) {
  const list = cleanRooms(rooms);
  if (!list.length) {
    const x0 = r2(-(EMPTY_SPAN + ANNEX_W) / 2);
    const x1 = r2(x0 + EMPTY_SPAN);
    return {
      floors: [], rooms: [], annex: annexAt(x1), terrace: null, overflow: [], empty: true,
      building: { x0, x1, storeys: 1, floorH: FLOOR_H, groundY: GROUND_Y, z0: ROOM_Z[0], z1: ROOM_Z[1] },
    };
  }
  const { floors, overflow } = floorsOf(list);
  const natural = floors.map((f) => f.map((r) => roomWidth(r.slugs.length)));
  const sums = natural.map((ws) => ws.reduce((s, w) => s + w, 0));
  const span = Math.max(...sums);
  const top = floors.length - 1;
  const terraceBeside = floors.length > 1 && sums[top] <= span - TERRACE_MIN;
  const x0 = r2(-(span + ANNEX_W) / 2);
  const x1 = r2(x0 + span);

  const placed = [];
  floors.forEach((f, fi) => {
    const keep = fi === top && terraceBeside;
    const scale = keep ? 1 : span / sums[fi];
    let at = x0;
    f.forEach((r, ri) => {
      const from = at;
      at = ri === f.length - 1 && !keep ? x0 + span : at + natural[fi][ri] * scale;
      const rx0 = r2(from);
      const rx1 = r2(at);
      const shown = r.slugs.slice(0, MAX_DESKS);
      const pitch = (rx1 - rx0 - 2 * ROOM_EDGE) / Math.max(1, shown.length);
      placed.push({
        id: r.id, floor: fi, y: r2(GROUND_Y + FLOOR_H * fi), x0: rx0, x1: rx1,
        desks: shown.map((slug, i) => ({ slug, x: r2(rx0 + ROOM_EDGE + (i + 0.5) * pitch), z: DESK_Z })),
        more: Math.max(0, r.slugs.length - MAX_DESKS),
      });
    });
  });

  const topEnd = r2(x0 + sums[top]);
  const terrace = terraceBeside
    ? { floor: top, x0: topEnd, x1, onRoof: false }
    : { floor: floors.length, x0: r2(x1 - Math.min(TERRACE_W, span)), x1, onRoof: true };

  return {
    floors: floors.map((f) => f.map((r) => r.id)),
    rooms: placed,
    annex: annexAt(x1),
    terrace,
    overflow: overflow.map((r) => r.id),
    empty: false,
    building: { x0, x1, storeys: floors.length, floorH: FLOOR_H, groundY: GROUND_Y, z0: ROOM_Z[0], z1: ROOM_Z[1] },
  };
}
