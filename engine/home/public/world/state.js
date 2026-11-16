// From the server's answers to what the Map and Needs you show (PLAN-3D D8, D9, 2.5). Pure: no imports but the
// plan and the words, no page, no clock, no randomness; every function takes null, undefined and wrong types.
//
// Two results, kept apart on purpose:
// - worldState(...) is for the DOM (the rail, the panel, the tags, the lists): names, titles and sentences cut to
//   the sizes below, money and safety sentences whole, as sent.
// - sceneOf(worldState) is the SceneState of D9, the only thing the 3D world and the drawn fallback receive: plain
//   slugs (`agent:` and `door:` for anchors), enums, booleans and clamped numbers. No server text ever enters it.
import { DOOR_IDS, MAX_DESKS, planBuilding } from "./layout.js";
import { doorSettingsHref } from "./words.js";

export const ID = /^[a-z][a-z0-9-]{0,40}$/;
export const NAME_MAX = 80;
export const TAG_MAX = 24;
export const TITLE_MAX = 120;
export const STACK_MAX = 12;
export const BENCHES = 4;
export const LAMPS = Object.freeze(["on", "amber", "red", "off", "down"]);
export const DOOR_STATES = Object.freeze(["open", "shut", "blocked"]);
const AGENT_STATES = new Set(["free", "working", "paused", "problem", "waiting_for_you"]);

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : "");
const isId = (v) => typeof v === "string" && ID.test(v);
const count = (v, most = 9999) => (Number.isFinite(v) ? Math.max(0, Math.min(most, Math.floor(v))) : 0);

// One line, cut to `n` characters with an ellipsis as the last one (the server's own `cut`).
export function cut(v, n) {
  const t = str(v).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

// A sentence shown whole (money and safety words are never cut or reworded): a string, or "".
const whole = (v) => str(v);

// The lamp at an agent's desk, first match wins (D8).
export function lampOf(agent) {
  if (!obj(agent)) return "off";
  const s = agent.state;
  if (s === "paused") return "down";
  if (s === "problem") return "red";
  if (agent.waitingForYou === true || s === "waiting_for_you") return "amber";
  if (s === "working") return "on";
  return "off";
}

// A door as the annex draws it: on is open; off is shut, with the amber mark when Settings would refuse to open it.
export function doorStateOf(door) {
  if (!obj(door)) return "shut";
  if (door.on === true) return "open";
  if (door.blocked === true) return "blocked";
  return "shut";
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "12 agents in 7 rooms. 6 working, 3 need you." from { agents, rooms, working, needsYou }.
export function summaryLine(counts) {
  const c = obj(counts) ? counts : {};
  const agents = count(c.agents);
  const rooms = count(c.rooms);
  if (!agents) return rooms ? "No agents yet." : "";
  const working = count(c.working);
  const needs = count(c.needsYou);
  const w = working ? `${working} working` : "Nobody is working";
  const n = needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : "nothing needs you";
  return `${plural(agents, "agent", "agents")} in ${plural(rooms, "room", "rooms")}. ${w}, ${n}.`;
}

// The desk's stack of blank sheets: at most twelve drawn, the rest counted.
export function stackOf(items) {
  const n = Array.isArray(items) ? items.length : count(items, 1e6);
  return { sheets: Math.min(n, STACK_MAX), more: Math.max(0, n - STACK_MAX) };
}

// ---- worldState ----

function taskOf(d) {
  if (!obj(d)) return null;
  return {
    title: cut(d.title, TITLE_MAX),
    taskId: typeof d.taskId === "string" && d.taskId ? d.taskId.slice(0, 64) : null,
    identifier: typeof d.identifier === "string" && d.identifier ? cut(d.identifier, TAG_MAX) : null,
  };
}

function agentOf(a, queued) {
  const slug = typeof a === "string" ? a : obj(a) ? a.slug : null;
  if (!isId(slug)) return null;
  const src = obj(a) ? a : {};
  const state = AGENT_STATES.has(src.state) ? src.state : "free";
  const waitingForYou = src.waitingForYou === true || queued.has(slug);
  const lamp = lampOf({ state, waitingForYou });
  const name = cut(src.name, NAME_MAX) || slug;
  return {
    id: typeof src.id === "string" && src.id ? src.id.slice(0, 64) : null,
    slug, name, tag: cut(name, TAG_MAX), anchor: `agent:${slug}`,
    state, plainState: cut(src.plainState, NAME_MAX), waitingForYou, lamp,
    needsYou: lamp === "amber" || lamp === "red",
    doing: taskOf(src.doing),
    lastActiveAt: typeof src.lastActiveAt === "string" ? src.lastActiveAt.slice(0, 40) : null,
  };
}

function countsOf(c) {
  const o = obj(c) ? c : {};
  return { working: count(o.working), needsYou: count(o.needsYou), jobs: count(o.jobs) };
}

// The queue: the inbox's items when it was read, else the home's.
function queueOf(home, inbox) {
  if (obj(inbox) && Array.isArray(inbox.items)) return { items: inbox.items, total: inbox.items.length };
  const n = obj(home) && obj(home.needsYou) ? home.needsYou : null;
  if (n) return { items: arr(n.items), total: Number.isFinite(n.total) ? count(n.total, 1e6) : arr(n.items).length };
  return { items: [], total: 0 };
}

function doorsOf(list) {
  const out = [];
  for (const id of DOOR_IDS) {
    const d = arr(list).find((x) => obj(x) && x.id === id);
    if (!d) continue;
    out.push({
      id, anchor: `door:${id}`, title: cut(d.title, NAME_MAX), sentence: whole(d.sentence),
      on: d.on === true, blocked: d.blocked === true, spends: d.spends === true,
      state: doorStateOf(d), href: doorSettingsHref(id),
      agents: arr(d.agents).filter(isId),
    });
  }
  return out;
}

function appsOf(list) {
  const seen = new Set();
  const out = [];
  for (const a of arr(list)) {
    if (!obj(a) || !isId(a.slug) || seen.has(a.slug)) continue;
    seen.add(a.slug);
    const sp = obj(a.spending) ? a.spending : {};
    out.push({
      slug: a.slug, name: cut(a.name, NAME_MAX) || a.slug, state: cut(a.state, 40), on: a.on === true,
      sentence: whole(a.sentence), spending: { open: sp.open === true, words: whole(sp.words) },
      href: `#/apps/${a.slug}`,
    });
  }
  return out;
}

// The money line of GET /api/world, whole, with its amounts as numbers (cents) or null.
function moneyOf(m) {
  if (!obj(m)) return null;
  const amount = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : null);
  const part = (p) => (obj(p) ? { spent: amount(p.spent), limit: amount(p.limit) } : { spent: null, limit: null });
  return { ok: m.ok === true, today: part(m.today), month: part(m.month), line: whole(m.line) };
}

// worldState({ world, map, home, inbox }) -> { rooms, doors, apps, counts, summary, scene, ... }.
// Rooms come from GET /api/world, else from GET /api/map's departments (names only, every lamp off).
export function worldState(input) {
  const src = obj(input) ? input : {};
  const world = obj(src.world) ? src.world : null;
  const map = obj(src.map) ? src.map : null;
  const queue = queueOf(src.home, src.inbox);
  const queued = new Set(queue.items.map((i) => (obj(i) && obj(i.agent) && isId(i.agent.slug) ? i.agent.slug : null)).filter(Boolean));

  const given = world && Array.isArray(world.rooms) ? world.rooms : map && Array.isArray(map.departments) ? map.departments : [];
  const seenRooms = new Set();
  const seenAgents = new Set();
  const rooms = [];
  for (const r of given) {
    if (!obj(r) || !isId(r.id) || seenRooms.has(r.id)) continue;
    seenRooms.add(r.id);
    const agents = [];
    for (const a of arr(r.agents)) {
      const ag = agentOf(a, queued);
      if (!ag || seenAgents.has(ag.slug)) continue;
      seenAgents.add(ag.slug);
      agents.push(ag);
    }
    rooms.push({
      id: r.id, anchor: r.id, href: `#/map/${r.id}`, title: cut(r.title, NAME_MAX) || r.id, line: cut(r.line, TITLE_MAX),
      counts: countsOf(r.counts), agents, more: Math.max(0, agents.length - MAX_DESKS), inPlan: false,
    });
  }
  const plan = planBuilding(rooms);
  const planned = new Set(plan.rooms.map((r) => r.id));
  for (const r of rooms) r.inPlan = planned.has(r.id);

  const all = rooms.flatMap((r) => r.agents);
  const counts = {
    agents: all.length,
    rooms: rooms.length,
    working: all.filter((a) => a.state === "working").length,
    needsYou: all.filter((a) => a.needsYou).length,
    queue: queue.total,
  };
  const boardOffSrc = (world && world.boardOff) || (map && map.boardOff) || (obj(src.home) && src.home.boardOff) || null;
  const studio = world && obj(world.studio) ? { state: cut(world.studio.state, 40), sentence: whole(world.studio.sentence) } : null;
  const asking = !!(map && obj(map.brain) && obj(map.brain.asking));

  const out = {
    company: { name: cut(world && obj(world.company) ? world.company.name : map && obj(map.company) ? map.company.name : "", NAME_MAX) },
    boardOff: obj(boardOffSrc) ? { reason: whole(boardOffSrc.reason), next: whole(boardOffSrc.next) } : null,
    rooms,
    overflow: plan.overflow.slice(),
    doors: doorsOf(world && world.doors),
    apps: appsOf(world && world.apps),
    studio,
    money: moneyOf(world && world.money),
    asking,
    counts,
    summary: summaryLine(counts),
    stack: stackOf(queue.total),
    plan,
  };
  out.scene = sceneOf(out);
  return out;
}

// ---- sceneOf: the SceneState (D9) ----

// sceneOf(worldState) -> { dark, asking, plan, rooms, doors, apps, stack, overflow }. Everything is checked
// again here, so a hand-made or damaged state cannot carry text into the world either.
export function sceneOf(ws) {
  const s = obj(ws) ? ws : {};
  const seenAgents = new Set();
  const seenRooms = new Set();
  const rooms = [];
  for (const r of arr(s.rooms)) {
    if (!obj(r) || !isId(r.id) || seenRooms.has(r.id)) continue;
    seenRooms.add(r.id);
    const lamps = [];
    for (const a of arr(r.agents)) {
      if (!obj(a) || !isId(a.slug) || seenAgents.has(a.slug)) continue;
      seenAgents.add(a.slug);
      lamps.push({ id: `agent:${a.slug}`, slug: a.slug, lamp: LAMPS.includes(a.lamp) ? a.lamp : "off" });
    }
    rooms.push({ id: r.id, lamps });
  }
  const plan = planBuilding(rooms.map((r) => ({ id: r.id, agents: r.lamps.map((l) => l.slug) })));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const sceneRooms = plan.rooms.map((p) => {
    const r = byId.get(p.id);
    const lamps = r.lamps.map((l) => ({ id: l.id, lamp: l.lamp }));
    return {
      id: p.id,
      dim: !lamps.length,
      working: lamps.filter((l) => l.lamp === "on").length,
      needsYou: lamps.filter((l) => l.lamp === "amber" || l.lamp === "red").length,
      more: p.more,
      lamps,
    };
  });

  const doorList = arr(s.doors);
  const doors = DOOR_IDS.map((id) => {
    const d = doorList.find((x) => obj(x) && x.id === id);
    return { id: `door:${id}`, state: d && DOOR_STATES.includes(d.state) ? d.state : "shut" };
  });
  const apps = arr(s.apps).filter((a) => obj(a) && isId(a.slug)).slice(0, BENCHES)
    .map((a) => ({ id: a.slug, on: a.on === true, allowance: obj(a.spending) && a.spending.open === true }));
  const st = obj(s.stack) ? s.stack : {};

  return {
    dark: plan.empty || obj(s.boardOff),
    asking: s.asking === true,
    plan,
    rooms: sceneRooms,
    doors,
    apps,
    stack: { sheets: count(st.sheets, STACK_MAX), more: count(st.more, 1e6) },
    overflow: plan.overflow.length,
  };
}
