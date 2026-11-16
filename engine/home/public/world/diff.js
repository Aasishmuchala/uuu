// What changed between two readings of the company, as events for the world to play (PLAN-3D D22). Pure: no imports
// but the state's own checks, no page, no clock, no randomness.
//
// diffWorld(prev, next, { visible }) takes two results of worldState() and gives, in this order:
// - lamp    { type, slug, room, from, to, animate }: red and amber changes first, then room order; at most four
//           animate, the rest change at once;
// - handoff { type, from, to, animate }: one agent stopped working a task and another started working the same task;
//           at most one an update, the first in room order (of the agent who stopped);
// - door    { type, id, from, to, animate };
// - app     { type, slug, on, allowance, animate };
// - sheet   { type, delta, animate }: the queue grew or shrank.
// The first reading (`prev` null) never animates, so it gives nothing; with `visible: false` (the tab hidden) every
// event has `animate: false`. Events carry slugs and enums only, never a name or a task id.
import { ID, LAMPS } from "./state.js";

export const LAMPS_ANIMATED = 4;

const obj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const isId = (v) => typeof v === "string" && ID.test(v);
const DOOR_STATES = ["open", "shut", "blocked"];

// slug -> { room, order, lamp, task } over every room, in room order.
function agentsOf(ws) {
  const out = new Map();
  let order = 0;
  for (const r of arr(obj(ws) ? ws.rooms : null)) {
    if (!obj(r) || !isId(r.id)) continue;
    for (const a of arr(r.agents)) {
      if (!obj(a) || !isId(a.slug) || out.has(a.slug)) continue;
      const working = a.state === "working";
      const task = working && obj(a.doing) && typeof a.doing.taskId === "string" && a.doing.taskId ? a.doing.taskId : null;
      out.set(a.slug, { room: r.id, order: order++, lamp: LAMPS.includes(a.lamp) ? a.lamp : "off", task });
    }
  }
  return out;
}

const urgency = (lamp) => (lamp === "red" ? 0 : lamp === "amber" ? 1 : 2);

export function diffWorld(prev, next, options) {
  if (!obj(prev) || !obj(next)) return [];
  const visible = !(obj(options) && options.visible === false);
  const events = [];

  // lamps
  const before = agentsOf(prev);
  const after = agentsOf(next);
  const lamps = [];
  for (const [slug, a] of after) {
    const b = before.get(slug);
    const from = b ? b.lamp : "off";
    if (from !== a.lamp) lamps.push({ slug, room: a.room, from, to: a.lamp, order: a.order });
  }
  lamps.sort((x, y) => urgency(x.to) - urgency(y.to) || x.order - y.order);
  lamps.forEach((l, i) => events.push({ type: "lamp", slug: l.slug, room: l.room, from: l.from, to: l.to, animate: visible && i < LAMPS_ANIMATED }));

  // one hand-off: A worked task T before and does not now; B works T now and did not before
  const stopped = [...before].filter(([slug, b]) => b.task && after.get(slug)?.task !== b.task)
    .sort((x, y) => (after.get(x[0])?.order ?? x[1].order + 1e6) - (after.get(y[0])?.order ?? y[1].order + 1e6));
  for (const [slug, b] of stopped) {
    const taker = [...after].find(([s, a]) => s !== slug && a.task === b.task && before.get(s)?.task !== b.task);
    if (taker) {
      events.push({ type: "handoff", from: slug, to: taker[0], animate: visible });
      break;
    }
  }

  // doors
  const doorsBefore = new Map(arr(prev.doors).filter((d) => obj(d) && isId(d.id)).map((d) => [d.id, d.state]));
  for (const d of arr(next.doors)) {
    if (!obj(d) || !isId(d.id) || !DOOR_STATES.includes(d.state)) continue;
    const from = DOOR_STATES.includes(doorsBefore.get(d.id)) ? doorsBefore.get(d.id) : "shut";
    if (from !== d.state) events.push({ type: "door", id: d.id, from, to: d.state, animate: visible });
  }

  // apps
  const appKey = (a) => ({ on: a.on === true, allowance: obj(a.spending) && a.spending.open === true });
  const appsBefore = new Map(arr(prev.apps).filter((a) => obj(a) && isId(a.slug)).map((a) => [a.slug, appKey(a)]));
  for (const a of arr(next.apps)) {
    if (!obj(a) || !isId(a.slug)) continue;
    const now = appKey(a);
    const was = appsBefore.get(a.slug) || { on: false, allowance: false };
    if (was.on !== now.on || was.allowance !== now.allowance) events.push({ type: "app", slug: a.slug, on: now.on, allowance: now.allowance, animate: visible });
  }

  // the queue
  const queue = (ws) => (obj(ws.counts) && Number.isFinite(ws.counts.queue) ? Math.max(0, Math.floor(ws.counts.queue)) : 0);
  const delta = queue(next) - queue(prev);
  if (delta) events.push({ type: "sheet", delta, animate: visible });

  return events;
}
