// Where the tags over the studio go (PLAN-3D D23.2): boxes placed in the order given (the first wins its spot), each
// moved as little as it takes to cross no tag already placed and to stay inside the bounds, or hidden when no such
// spot is near. Pure: no imports, no page, no clock, no randomness.
//
// The move is measured from the asked spot brought inside the bounds; a tag that would go further than three rows
// from it is hidden rather than left far from what it names.
// placeTags(boxes, bounds) -> the boxes in the same order, each `{ ...box, x, y, hidden }`. `boxes`: [{ id, x, y, w, h }]
// in pixels, x and y the top left; `bounds`: { x = 0, y = 0, w, h }. A shown box never crosses another shown box (with
// GAP pixels between them) and lies wholly inside the bounds; a hidden box keeps the place it asked for.

export const GAP = 4;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const crosses = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

export function placeTags(boxes, bounds) {
  const bd = bounds !== null && typeof bounds === "object" ? bounds : {};
  const B = { x: num(bd.x), y: num(bd.y), w: Math.max(0, num(bd.w)), h: Math.max(0, num(bd.h)) };
  const placed = [];
  const out = [];
  for (const raw of Array.isArray(boxes) ? boxes : []) {
    if (raw === null || typeof raw !== "object") continue;
    const box = { ...raw, x: num(raw.x), y: num(raw.y), w: Math.max(0, num(raw.w)), h: Math.max(0, num(raw.h)) };
    const most = Math.max(48, 3 * (box.h + GAP));
    const fits = (c) => c.x >= B.x && c.y >= B.y && c.x + box.w <= B.x + B.w && c.y + box.h <= B.y + B.h && !placed.some((p) => crosses({ ...box, ...c }, p));
    const clampX = (x) => Math.min(Math.max(x, B.x), B.x + B.w - box.w);
    const clampY = (y) => Math.min(Math.max(y, B.y), B.y + B.h - box.h);
    // the spot it asked for, held inside the bounds, then beside every tag already placed
    const base = { x: clampX(box.x), y: clampY(box.y) };
    const tries = [base];
    for (const p of placed) {
      tries.push({ x: clampX(box.x), y: p.y + p.h + GAP }, { x: clampX(box.x), y: p.y - box.h - GAP });
      tries.push({ x: p.x + p.w + GAP, y: clampY(box.y) }, { x: p.x - box.w - GAP, y: clampY(box.y) });
    }
    let best = null;
    let bestD = Infinity;
    for (const c of tries) {
      const d = Math.hypot(c.x - base.x, c.y - base.y);
      if (d < bestD && d <= most && fits(c)) { best = c; bestD = d; }
    }
    if (best && box.w <= B.w && box.h <= B.h) {
      const shown = { ...box, x: best.x, y: best.y, hidden: false };
      placed.push(shown);
      out.push(shown);
    } else {
      out.push({ ...box, hidden: true });
    }
  }
  return out;
}
