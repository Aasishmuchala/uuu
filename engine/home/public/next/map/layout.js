// The map's layout maths (CONTRACTS-V3 29.4): where the brain, the hubs, the job dots and every
// label sit, for any catalogue. Pure: numbers in, numbers out. No page, no randomness, no imports,
// so the same catalogue always gives the same map. Every coordinate is rounded to half a pixel.
//
// Label points: a hub's label is the point its text starts from (`anchor` as in SVG). A job's label
// box is `w` × `h`; `x` is the side it starts from (its left edge for `start`, its right edge for
// `end`) and `y` is the middle of the box.

const W0 = 1200;
const H0 = 760;
const INSET = 16;

const half = (v) => Math.round(v * 2) / 2 + 0;
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const point = (x, y) => ({ x: half(x), y: half(y) });

// ---- The overview: the brain, the hubs on an ellipse, the job dots on arcs outside each hub ----

const BRAIN_Y = 372;
const BRAIN_R = 46;
const HUB_RX = 300;
const HUB_RY = 215;
const HUB_R = 20;
const LABEL_RX = 440;
const LABEL_RY = 300;
const ARCS = [46, 70, 94];
const ARC_STEP = 24; // only used when a hub has more jobs than three arcs can hold
const SPREAD = 56; // degrees either side of the hub's outward ray
const DOT_EASY = 20; // the spacing dots get when there is room
const DOT_MIN = 14; // the closest two dots on one arc ever sit
const CLUSTER_GAP = 0.5; // an extra half step between two clusters, when the arc has room

// The angle between neighbours on an arc of radius r so that they are `chord` px apart.
const stepFor = (r, chord) => deg(2 * Math.asin(Math.min(1, chord / 2 / r)));
const capacity = (r, chord) => Math.floor((2 * SPREAD) / stepFor(r, chord) + 1e-9) + 1;

function arcsFor(count) {
  const easy = ARCS.reduce((n, r) => n + capacity(r, DOT_EASY), 0);
  const chord = count <= easy ? DOT_EASY : DOT_MIN;
  const radii = ARCS.slice();
  let room = radii.reduce((n, r) => n + capacity(r, chord), 0);
  while (room < count) {
    const r = radii[radii.length - 1] + ARC_STEP;
    radii.push(r);
    room += capacity(r, chord);
  }
  return { radii, chord };
}

function jobsOf(department) {
  const out = [];
  for (const cluster of department.clusters || []) {
    for (const job of cluster.jobs || []) out.push({ id: typeof job === "string" ? job : job.id, cluster: cluster.id });
  }
  return out;
}

// Dots fill the inner arc first, cluster by cluster in file order, then the next arc out.
function placeDots(jobs, hx, hy, outward) {
  const placed = [];
  if (!jobs.length) return placed;
  const { radii, chord } = arcsFor(jobs.length);
  let next = 0;
  for (const r of radii) {
    if (next >= jobs.length) break;
    const take = jobs.slice(next, next + capacity(r, chord));
    next += take.length;
    const step = stepFor(r, chord);
    let breaks = 0;
    for (let i = 1; i < take.length; i++) if (take[i].cluster !== take[i - 1].cluster) breaks++;
    const gap = (take.length - 1 + CLUSTER_GAP * breaks) * step <= 2 * SPREAD ? CLUSTER_GAP : 0;
    const total = (take.length - 1 + gap * breaks) * step;
    let a = outward - total / 2;
    take.forEach((job, i) => {
      if (i > 0) a += step + (job.cluster !== take[i - 1].cluster ? gap * step : 0);
      placed.push({ ...job, x: hx + r * Math.cos(rad(a)), y: hy + r * Math.sin(rad(a)) });
    });
  }
  return placed;
}

export function layoutOverview({ departments = [], width = W0, height = H0 } = {}) {
  const sx = width / W0;
  const sy = height / H0;
  const cx = width / 2;
  const cy = BRAIN_Y * sy;
  const n = departments.length;
  const hubs = [];
  const dots = [];
  const links = [];
  departments.forEach((department, i) => {
    const angle = -90 + (i * 360) / n;
    const c = Math.cos(rad(angle));
    const s = Math.sin(rad(angle));
    const hx = cx + HUB_RX * sx * c;
    const hy = cy + HUB_RY * sy * s;
    const anchor = Math.abs(c) < 0.3 ? "middle" : c > 0 ? "start" : "end";
    const hub = point(hx, hy);
    hubs.push({ id: department.id, x: hub.x, y: hub.y, r: HUB_R, angle, label: { ...point(cx + LABEL_RX * sx * c, cy + LABEL_RY * sy * s), anchor } });
    for (const dot of placeDots(jobsOf(department), hx, hy, angle)) {
      const at = point(dot.x, dot.y);
      dots.push({ id: dot.id, department: department.id, cluster: dot.cluster, x: at.x, y: at.y });
      links.push({ department: department.id, from: hub, to: at });
    }
  });
  return { viewBox: [0, 0, width, height], brain: { ...point(cx, cy), r: BRAIN_R }, hubs, dots, links };
}

// ---- One department: the hub at the bottom, the clusters fanned upward, each job with its title ----

const DEPT_HUB_Y = 640;
const DEPT_HUB_R = 28;
const FAN_R = 300;
const FAN_FROM = 200;
const FAN_TO = 340;
const JOB_R = 14;
const LABEL_H = 24;
const LABEL_PAD = 6; // between a disc and its label
const ROW = 32; // from one job to the next in a column
const FIRST = 40; // from a cluster's anchor up to its first job
const HEAD = 30; // from a column's top job up to the cluster's overline
const HEAD_H = 20; // the overline's row in the grid
const COL_GAP = 16;
const GRID_GAP = 24;
const OVERLINE_EXTRA = 10; // room for " · 8 JOBS" after the cluster's title, in characters

export const labelWidth = (title) => 7.2 * String(title ?? "").length + 34;
const overlineWidth = (title) => 7.2 * (String(title ?? "").length + OVERLINE_EXTRA);

function jobLabel(x, y, title, anchor) {
  const w = labelWidth(title);
  const lx = anchor === "end" ? x - JOB_R - LABEL_PAD : x + JOB_R + LABEL_PAD;
  return { ...point(lx, y), w: half(w), h: LABEL_H, anchor };
}

export function labelBox(label) {
  const left = label.anchor === "end" ? label.x - label.w : label.anchor === "middle" ? label.x - label.w / 2 : label.x;
  return { left, right: left + label.w, top: label.y - label.h / 2, bottom: label.y + label.h / 2 };
}

const circleHitsBox = (cx, cy, r, b) => {
  const dx = cx - Math.max(b.left, Math.min(cx, b.right));
  const dy = cy - Math.max(b.top, Math.min(cy, b.bottom));
  return dx * dx + dy * dy < r * r;
};
const boxesOverlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// The department view's rules (29.4), used to choose between the fan and the grid.
function holds(view, width, height) {
  const { hub, jobs } = view;
  const boxes = jobs.map((j) => labelBox(j.label));
  const inside = (l, t, r, b) => l >= INSET && t >= INSET && r <= width - INSET && b <= height - INSET;
  for (let i = 0; i < jobs.length; i++) {
    const b = boxes[i];
    if (!inside(b.left, b.top, b.right, b.bottom)) return false;
    if (!inside(jobs[i].x - JOB_R, jobs[i].y - JOB_R, jobs[i].x + JOB_R, jobs[i].y + JOB_R)) return false;
    if (circleHitsBox(hub.x, hub.y, hub.r, b)) return false;
    for (let k = 0; k < jobs.length; k++) {
      if (k === i) continue;
      if (k > i && boxesOverlap(b, boxes[k])) return false;
      if (circleHitsBox(jobs[k].x, jobs[k].y, JOB_R, b)) return false;
    }
  }
  return true;
}

// The fan: each cluster is a column of jobs rising from its anchor, its overline on top. Columns on
// the left read leftward, the others rightward. Columns are pushed apart so none overlap.
function fan(clusters, anchors, hub, width) {
  const cols = clusters.map((cluster, i) => {
    const a = anchors[i];
    const side = a.x < hub.x - 1 ? "end" : "start";
    const jobs = cluster.jobs || [];
    const reach = Math.max(JOB_R, ...jobs.map((j) => JOB_R + LABEL_PAD + labelWidth(j.title)), overlineWidth(cluster.title) - JOB_R);
    return { side, ideal: a.x, left: side === "end" ? reach : JOB_R, right: side === "end" ? JOB_R : reach };
  });
  const xs = cols.map((c) => c.ideal);
  for (let i = 0; i < cols.length; i++) {
    const floor = i ? xs[i - 1] + cols[i - 1].right + COL_GAP + cols[i].left : INSET + cols[i].left;
    xs[i] = Math.max(xs[i], floor);
  }
  for (let i = cols.length - 1; i >= 0; i--) {
    const ceil = i < cols.length - 1 ? xs[i + 1] - cols[i + 1].left - COL_GAP - cols[i].right : width - INSET - cols[i].right;
    xs[i] = Math.min(xs[i], ceil);
  }
  if (cols.length && xs[0] - cols[0].left < INSET) return null;
  const outClusters = [];
  const jobs = [];
  clusters.forEach((cluster, i) => {
    const a = anchors[i];
    const side = cols[i].side;
    const list = cluster.jobs || [];
    let top = a.y - FIRST + ROW;
    list.forEach((job, k) => {
      const y = a.y - FIRST - k * ROW;
      top = y;
      jobs.push({ id: job.id, cluster: cluster.id, ...point(xs[i], y), label: jobLabel(xs[i], y, job.title, side) });
    });
    const lx = side === "end" ? xs[i] + JOB_R : xs[i] - JOB_R;
    outClusters.push({ id: cluster.id, ...point(a.x, a.y), label: { ...point(lx, top - HEAD), anchor: side } });
  });
  if (outClusters.some((c) => c.label.y < INSET + HEAD_H / 2)) return null;
  return { clusters: outClusters, jobs };
}

// The grid, for catalogues the fan cannot hold: columns read top to bottom, cluster by cluster, each
// cluster under its overline. Columns spread across the width; one over the hub stops above it.
function grid(clusters, anchors, hub, width, height) {
  const all = clusters.flatMap((c) => c.jobs || []);
  const colW = Math.max(JOB_R * 2, ...all.map((j) => JOB_R * 2 + LABEL_PAD + labelWidth(j.title)), ...clusters.map((c) => overlineWidth(c.title)));
  const maxCols = Math.max(1, Math.floor((width - 2 * INSET + GRID_GAP) / (colW + GRID_GAP)));
  const lefts = (nc) =>
    Array.from({ length: nc }, (_, c) => (nc === 1 ? (width - colW) / 2 : INSET + (c * (width - 2 * INSET - colW)) / (nc - 1)));
  const fill = (nc, row) => {
    const xs = lefts(nc);
    const bottoms = xs.map((l) =>
      l < hub.x + hub.r + COL_GAP && l + colW > hub.x - hub.r - COL_GAP ? hub.y - hub.r - COL_GAP : height - INSET,
    );
    let col = 0;
    let y = INSET;
    const heads = [];
    const jobs = [];
    for (const cluster of clusters) {
      const list = cluster.jobs || [];
      if (y + HEAD_H + (list.length ? row : 0) > bottoms[col]) {
        col++;
        y = INSET;
        if (col >= nc) return null;
      }
      heads.push({ cluster, x: xs[col], y: y + HEAD_H / 2 });
      y += HEAD_H;
      for (const job of list) {
        if (y + row > bottoms[col]) {
          col++;
          y = INSET;
          if (col >= nc) return null;
        }
        const x = xs[col] + JOB_R;
        jobs.push({ id: job.id, cluster: cluster.id, ...point(x, y + row / 2), label: jobLabel(x, y + row / 2, job.title, "start") });
        y += row;
      }
    }
    return {
      clusters: heads.map((h, i) => ({ id: h.cluster.id, ...point(anchors[i].x, anchors[i].y), label: { ...point(h.x, h.y), anchor: "start" } })),
      jobs,
    };
  };
  for (let nc = 1; nc <= maxCols; nc++) {
    const out = fill(nc, ROW);
    if (out) return out;
  }
  for (let row = ROW - 1; row >= JOB_R * 2; row--) {
    const out = fill(maxCols, row);
    if (out) return out;
  }
  return fill(maxCols, JOB_R * 2) || { clusters: [], jobs: [] };
}

export function layoutDepartment({ clusters = [], width = W0, height = H0 } = {}) {
  const sx = width / W0;
  const sy = height / H0;
  const s = Math.min(sx, sy);
  const hx = width / 2;
  const hy = DEPT_HUB_Y * sy;
  const hub = { ...point(hx, hy), r: DEPT_HUB_R };
  const k = clusters.length;
  const anchors = clusters.map((_, i) => {
    const a = k === 1 ? 270 : FAN_FROM + (i * (FAN_TO - FAN_FROM)) / (k - 1);
    return point(hx + FAN_R * s * Math.cos(rad(a)), hy + FAN_R * s * Math.sin(rad(a)));
  });
  let body = fan(clusters, anchors, hub, width);
  if (!body || !holds({ hub, jobs: body.jobs }, width, height)) body = grid(clusters, anchors, hub, width, height);
  const links = [];
  for (const c of body.clusters) links.push({ cluster: c.id, from: { x: hub.x, y: hub.y }, to: { x: c.x, y: c.y } });
  for (const j of body.jobs) {
    const c = body.clusters.find((x) => x.id === j.cluster);
    links.push({ cluster: j.cluster, from: { x: c.x, y: c.y }, to: { x: j.x, y: j.y } });
  }
  return { viewBox: [0, 0, width, height], hub, clusters: body.clusters, jobs: body.jobs, links };
}

// ---- Moving between departments ----

export function neighbours(ids, id) {
  const list = Array.isArray(ids) ? ids : [];
  const i = list.indexOf(id);
  if (i < 0) return { prev: null, next: null };
  return { prev: list[(i - 1 + list.length) % list.length], next: list[(i + 1) % list.length] };
}

// The arrow keys on a focused hub: right and down go clockwise (the file order), left and up back.
export function nearestHub(hubs, id, key) {
  const ids = (Array.isArray(hubs) ? hubs : []).map((h) => (typeof h === "string" ? h : h.id));
  if (!ids.length) return null;
  if (!ids.includes(id)) return ids[0];
  const { prev, next } = neighbours(ids, id);
  if (key === "ArrowRight" || key === "ArrowDown") return next;
  if (key === "ArrowLeft" || key === "ArrowUp") return prev;
  return id;
}
